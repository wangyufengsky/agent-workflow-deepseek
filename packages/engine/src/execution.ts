import type {
  AttemptResult,
  CommandResponse,
  ExecutionAdvanceRequest,
  ExecutionAutoAdvanceRequest,
  ExecutionCommandRequest,
  ExecutionResponse,
  ExecutionStatusValue,
  ErrorCodeValue,
  ExecutionView,
  NodeSkipRequest,
  ModelProfile,
  NodeStatusValue,
  PlanNode,
  PlanRevision,
  Task,
  TaskDelivery,
  TokenUsage,
} from '@agent-workflow/shared';
import { AppError, ErrorCode, NodeStatus, TaskAttention, TaskStage, assertTransition, createId, executionMachine, nodeMachine, nowIso } from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';
import type { EngineContext } from './actions.ts';
import type { CommandService } from './operations.ts';
import type { OpenCodePort } from './ports.ts';

interface ResultWaiter {
  resolve(result: AttemptResult): void;
}

interface AdvanceRelease {
  readonly ready: readonly string[];
  readonly waitingFor: readonly { readonly nodeId: string; readonly prerequisites: readonly string[] }[];
  readonly reason: string;
}

export interface SubmitNodeResultInput {
  readonly taskId: string;
  readonly nodeId: string;
  readonly attemptId: string;
  readonly summary: string;
  readonly payload?: Record<string, unknown>;
  readonly verification?: AttemptResult['verification'];
}

export class ExecutionService {
  readonly #store: Store;
  readonly #commands: CommandService;
  readonly #context: EngineContext;
  readonly #opencode: OpenCodePort;
  readonly #resultWaiters = new Map<string, ResultWaiter>();
  readonly #loops = new Set<string>();
  readonly #activeSessions = new Map<string, string>();

  constructor(store: Store, commands: CommandService, context: EngineContext, opencode: OpenCodePort) {
    this.#store = store;
    this.#commands = commands;
    this.#context = context;
    this.#opencode = opencode;
  }

  get(taskId: string): ExecutionView | undefined {
    const task = this.#store.tasks.get(taskId);
    if (task === undefined) return undefined;
    return task.executionId === undefined ? this.#store.executions.byTask(taskId) : this.#store.executions.get(task.executionId);
  }

  start(taskId: string, input: ExecutionCommandRequest): CommandResponse<ExecutionResponse> {
    const task = this.#requireTask(taskId);
    const execution = this.get(taskId);
    if (execution === undefined) throw new AppError(ErrorCode.NOT_FOUND, '执行尚未创建，请先确认计划');
    const workspace = task.workspaceId === undefined ? this.#store.workspaces.byTask(taskId) : this.#store.workspaces.get(task.workspaceId);
    if (workspace === undefined || workspace.state !== 'ready') throw new AppError(ErrorCode.WORKSPACE_NOT_READY, '准备成功前不能开始执行');
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'execution.start',
      body: { taskId, expectedStatus: input.expectedStatus, confirm: true },
      target: { taskId, executionId: execution.id },
    });
    if (replayed && record.status !== 'accepted') {
      return { receipt: this.#commands.toReceipt(record), resource: this.#viewResponse(taskId) };
    }
    if (execution.status !== 'idle' && execution.status !== 'ready' && execution.status !== 'paused') {
      throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '当前执行状态不能开始');
    }
    const updated = this.#store.executions.update(execution.id, {
      status: 'running',
      startedAt: execution.startedAt ?? nowIso(),
      notice: undefined,
    });
    this.#store.tasks.update(taskId, { stage: TaskStage.EXECUTING, attention: TaskAttention.NONE, executionId: execution.id });
    this.#store.events.publish('execution.changed', { taskId, executionId: execution.id, status: 'running', revision: 1 });
    this.#store.events.publish('task.changed', { taskId, projectId: task.projectId, stage: TaskStage.EXECUTING, revision: 1 });
    this.#commands.settle(input.requestKey, { executionId: execution.id });
    void this.#advance(execution.id);
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: { execution: updated ?? execution, workspace, actions: {} } };
  }

  pause(taskId: string, input: ExecutionCommandRequest): CommandResponse<ExecutionResponse> {
    const task = this.#requireTask(taskId);
    const execution = this.get(taskId);
    if (execution === undefined || execution.status !== 'running') throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '当前没有运行中的执行');
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'execution.pause',
      body: { taskId, expectedStatus: input.expectedStatus },
      target: { taskId, executionId: execution.id },
    });
    if (replayed && record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record), resource: this.#viewResponse(taskId) };
    this.#store.executions.update(execution.id, { status: 'paused', pause: { requestedAt: nowIso(), settledAt: nowIso(), requestKey: input.requestKey }, notice: { kind: 'paused', message: '已暂停新增领取' } });
    this.#store.events.publish('execution.changed', { taskId, executionId: execution.id, status: 'paused', revision: 1 });
    this.#commands.settle(input.requestKey, { paused: true });
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.#viewResponse(taskId) };
  }

  resume(taskId: string, input: ExecutionCommandRequest): CommandResponse<ExecutionResponse> {
    const task = this.#requireTask(taskId);
    const execution = this.get(taskId);
    if (execution === undefined || execution.status !== 'paused') throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '当前没有暂停的执行');
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'execution.resume',
      body: { taskId, expectedStatus: input.expectedStatus },
      target: { taskId, executionId: execution.id },
    });
    if (replayed && record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record), resource: this.#viewResponse(taskId) };
    this.#store.executions.update(execution.id, { status: 'running', notice: undefined });
    this.#store.events.publish('execution.changed', { taskId, executionId: execution.id, status: 'running', revision: 1 });
    this.#commands.settle(input.requestKey, { resumed: true });
    void this.#advance(execution.id);
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.#viewResponse(taskId) };
  }

  /**
   * Real "自动节点推进" switch (design v4 C01/C04 / AD05).
   *
   * Turning it off changes only future claiming: a step that is already running
   * finishes under its snapshot, then the scheduler parks the execution in
   * `paused` ("自动推进已关闭，等待推进") where `advance` is the way forward.
   * Turning it on stores the setting; it does not silently resume a paused
   * task — the explicit `resume`/`advance` action stays the user's decision.
   */
  setAutoAdvance(taskId: string, input: ExecutionAutoAdvanceRequest): CommandResponse<ExecutionResponse> {
    this.#requireTask(taskId);
    const execution = this.get(taskId);
    if (execution === undefined) throw new AppError(ErrorCode.NOT_FOUND, '执行尚未创建');
    if (input?.confirmChange !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '切换自动推进需要显式确认');
    if (typeof input.autoAdvance !== 'boolean') throw new AppError(ErrorCode.VALIDATION_FAILED, 'autoAdvance 必须是布尔值');
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'execution.autoAdvance',
      body: { taskId, autoAdvance: input.autoAdvance, confirmChange: true },
      target: { taskId, executionId: execution.id },
    });
    if (replayed && record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record), resource: this.#viewResponse(taskId) };
    const allowed: readonly ExecutionStatusValue[] = ['running', 'pausing', 'paused', 'waiting_confirmation', 'unknown', 'failed'];
    const reject = (message: string, details: Record<string, unknown>): never => {
      const error = new AppError(ErrorCode.OPERATION_IN_PROGRESS, message, { details });
      this.#commands.fail(input.requestKey, error);
      throw error;
    };
    if (!allowed.includes(execution.status)) reject(`当前执行状态（${execution.status}）不能切换自动推进`, { status: execution.status, allowed });
    if (execution.editSession !== undefined && !['finished', 'abandoned'].includes(execution.editSession.state)) {
      reject('调整待执行计划期间新增领取已暂停；结束或放弃调整后再切换自动推进', { editSessionState: execution.editSession.state });
    }
    const updated = this.#store.executions.update(execution.id, { autoAdvance: input.autoAdvance });
    this.#store.events.publish('execution.changed', { taskId, executionId: execution.id, status: updated?.status ?? execution.status, revision: 1 });
    this.#commands.settle(input.requestKey, { autoAdvance: input.autoAdvance });
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.#viewResponse(taskId) };
  }

  /**
   * Manual advance while auto-advance is off (design v4 C01/U5): without a
   * node id every step whose predecessors are all accepted is released; with a
   * node id only that step's direct successors are. Releasing does not cascade
   * in the same call and parallel joins wait for every predecessor to succeed
   * or be skipped. The released batch then runs; the next advance is needed
   * only after that batch finished.
   */
  advance(taskId: string, input: ExecutionAdvanceRequest): CommandResponse<ExecutionResponse> {
    this.#requireTask(taskId);
    const execution = this.get(taskId);
    if (execution === undefined) throw new AppError(ErrorCode.NOT_FOUND, '执行尚未创建');
    if (input?.confirmAdvance !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '推进步骤需要显式确认');
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'execution.advance',
      body: { taskId, nodeId: input.nodeId ?? null, confirmAdvance: true },
      target: { taskId, executionId: execution.id, ...(input.nodeId === undefined ? {} : { ref: input.nodeId }) },
    });
    // A settled replay answers from the stored receipt before any state guard:
    // the execution may have moved on since the first call.
    if (replayed && record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record), resource: this.#viewResponse(taskId) };
    const reject = (code: ErrorCodeValue, message: string, details: Record<string, unknown> = {}): never => {
      const error = new AppError(code, message, { details });
      this.#commands.fail(input.requestKey, error);
      throw error;
    };
    if (execution.autoAdvance) reject(ErrorCode.OPERATION_IN_PROGRESS, '自动节点推进已开启，不需要手动推进', { autoAdvance: true });
    if (execution.editSession !== undefined && !['finished', 'abandoned'].includes(execution.editSession.state)) {
      reject(ErrorCode.OPERATION_IN_PROGRESS, '调整待执行计划期间新增领取已暂停；先结束或放弃调整', { editSessionState: execution.editSession.state });
    }
    if (execution.status !== 'running' && execution.status !== 'paused') {
      reject(ErrorCode.OPERATION_IN_PROGRESS, `当前执行状态（${execution.status}）不能推进`, { status: execution.status });
    }
    if (execution.status === 'paused' && execution.pause?.requestKey !== undefined) {
      reject(ErrorCode.OPERATION_IN_PROGRESS, '任务已由用户暂停，请先恢复任务再推进', { pausedByUser: true });
    }
    const plan = this.#store.plans.get(execution.planRevisionId);
    if (plan === undefined) {
      const error = new AppError(ErrorCode.NOT_FOUND, '执行计划不存在', { details: { planRevisionId: execution.planRevisionId } });
      this.#commands.fail(input.requestKey, error);
      throw error;
    }
    if (input.nodeId !== undefined && !plan.graph.nodes.some((node) => node.id === input.nodeId)) {
      reject(ErrorCode.NOT_FOUND, '步骤不存在', { nodeId: input.nodeId });
    }
    const latest = this.#store.executions.get(execution.id) ?? execution;
    const release = this.#releaseAdvanceable(latest, plan, input.nodeId);
    if (release.ready.length === 0) {
      const error = new AppError(ErrorCode.VALIDATION_FAILED, release.reason, {
        details: { nodeId: input.nodeId ?? null, waitingFor: release.waitingFor },
      });
      this.#commands.fail(input.requestKey, error);
      throw error;
    }
    if (latest.status === 'paused') {
      // PAUSED -> RUNNING is a legal edge; only the auto-off wait state reaches
      // here (a user pause was rejected above).
      assertTransition(executionMachine, latest.status, 'running');
      this.#store.executions.update(execution.id, { status: 'running', notice: { kind: 'paused', message: '已按手动推进放行步骤；该批完成后再等待推进' } });
      this.#store.events.publish('execution.changed', { taskId, executionId: execution.id, status: 'running', revision: 1 });
    }
    this.#commands.settle(input.requestKey, { released: release.ready, waitingFor: release.waitingFor });
    void this.#advance(execution.id);
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.#viewResponse(taskId) };
  }

  /** Resume scheduling after a plan-edit action put an execution back to `running`. */
  kick(taskId: string): void {
    const execution = this.get(taskId);
    if (execution === undefined || execution.status !== 'running') return;
    void this.#advance(execution.id);
  }

  retry(taskId: string, input: ExecutionCommandRequest): CommandResponse<ExecutionResponse> {
    const task = this.#requireTask(taskId);
    const execution = this.get(taskId);
    if (execution === undefined) throw new AppError(ErrorCode.NOT_FOUND, '执行尚未创建');
    const failedNodes = execution.nodes.filter((node) => node.status === NodeStatus.FAILED);
    if (failedNodes.length === 0) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '当前没有失败的步骤可以重试');
    // `unknown` is the startup-recovery state: interrupted nodes are persisted as
    // failed, so an explicit retry is the user-approved way out of it.
    if (!['failed', 'stopped', 'paused', 'unknown'].includes(execution.status)) {
      throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '执行仍在运行，先暂停/取消后再重试', { details: { status: execution.status } });
    }
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'execution.retry',
      body: { taskId, expectedStatus: input.expectedStatus, nodeIds: failedNodes.map((node) => node.nodeId), confirm: true },
      target: { taskId, executionId: execution.id },
    });
    if (replayed && record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record), resource: this.#viewResponse(taskId) };
    for (const node of failedNodes) {
      this.#store.executions.updateNode(execution.id, node.nodeId, {
        status: NodeStatus.PENDING,
        error: null,
        startedAt: null,
        endedAt: null,
        currentAttemptId: null,
      });
    }
    this.#store.executions.update(execution.id, {
      status: 'running',
      endedAt: undefined,
      notice: { kind: 'paused', message: `按原配置重试 ${String(failedNodes.length)} 个失败步骤` },
    });
    this.#store.tasks.update(taskId, { attention: TaskAttention.NONE });
    this.#store.events.publish('execution.changed', { taskId, executionId: execution.id, status: 'running', revision: 1 });
    this.#commands.settle(input.requestKey, { retried: failedNodes.length });
    void this.#advance(execution.id);
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.#viewResponse(taskId) };
  }

  skipNode(taskId: string, nodeId: string, input: NodeSkipRequest): CommandResponse<ExecutionResponse> {
    const task = this.#requireTask(taskId);
    const execution = this.get(taskId);
    if (execution === undefined) throw new AppError(ErrorCode.NOT_FOUND, '执行尚未创建');
    if (input?.confirmSkip !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '跳过节点需要显式确认');
    // `unknown` is the startup-recovery state (interrupted nodes are failed).
    if (!['failed', 'stopped', 'paused', 'unknown'].includes(execution.status)) {
      throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '执行未停止：先暂停/停止执行，再跳过节点', { details: { status: execution.status } });
    }
    const node = execution.nodes.find((item) => item.nodeId === nodeId);
    if (node === undefined) throw new AppError(ErrorCode.NOT_FOUND, '节点不存在', { details: { nodeId } });
    if (node.status === 'succeeded') throw new AppError(ErrorCode.VALIDATION_FAILED, '已成功的节点不能跳过');
    if (node.status === 'running') throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '节点正在执行，先停止执行再跳过');
    if (node.status === 'cancelled') throw new AppError(ErrorCode.VALIDATION_FAILED, '节点已经被跳过');
    const plan = this.#store.plans.get(execution.planRevisionId);
    if (plan === undefined) throw new AppError(ErrorCode.NOT_FOUND, '执行计划不存在');
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'execution.skipNode',
      body: { taskId, nodeId, confirmSkip: true },
      target: { taskId, executionId: execution.id, ref: nodeId },
    });
    if (replayed && record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record), resource: this.#viewResponse(taskId) };
    const skipped = new Set<string>([nodeId]);
    const queue = [nodeId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of plan.graph.edges) {
        if (edge.from !== current || skipped.has(edge.to)) continue;
        skipped.add(edge.to);
        queue.push(edge.to);
      }
    }
    for (const id of skipped) {
      const target = execution.nodes.find((item) => item.nodeId === id);
      if (target === undefined || target.status === 'succeeded' || target.status === 'running') continue;
      this.#store.executions.updateNode(execution.id, id, {
        status: NodeStatus.CANCELLED,
        error: { code: 'SKIPPED', message: '用户跳过节点及下游' },
        endedAt: nowIso(),
        currentAttemptId: null,
      });
    }
    this.#recomputeReady(execution, plan);
    const refreshed = this.#store.executions.get(execution.id)!;
    const failed = refreshed.nodes.filter((item) => item.status === NodeStatus.FAILED).length;
    const unfinished = refreshed.nodes.filter((item) => !([NodeStatus.SUCCEEDED, NodeStatus.SKIPPED, NodeStatus.CANCELLED] as NodeStatusValue[]).includes(item.status)).length;
    if (refreshed.status === 'failed' && failed === 0 && unfinished === 0) {
      this.#completeExecution(task, refreshed);
    } else {
      this.#store.tasks.update(taskId, { attention: TaskAttention.NONE });
    }
    this.#store.events.publish('execution.changed', { taskId, executionId: execution.id, status: this.get(taskId)?.status ?? refreshed.status, revision: 1 });
    this.#commands.settle(input.requestKey, { skipped: [...skipped] });
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.#viewResponse(taskId) };
  }

  async cancel(taskId: string, input: ExecutionCommandRequest): Promise<CommandResponse<ExecutionResponse>> {
    const task = this.#requireTask(taskId);
    const execution = this.get(taskId);
    if (execution === undefined) throw new AppError(ErrorCode.NOT_FOUND, '执行尚未创建');
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'execution.cancel',
      body: { taskId, expectedStatus: input.expectedStatus, confirm: true },
      target: { taskId, executionId: execution.id },
    });
    if (replayed && record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record), resource: this.#viewResponse(taskId) };
    this.#store.executions.update(execution.id, { status: 'stopping' });
    this.#store.events.publish('execution.changed', { taskId, executionId: execution.id, status: 'stopping', revision: 1 });
    const sessionId = this.#activeSessions.get(execution.id);
    if (sessionId !== undefined) await this.#opencode.abortSession(sessionId).catch(() => undefined);
    this.#store.executions.update(execution.id, { status: 'stopped', endedAt: nowIso(), notice: { kind: 'paused', message: '执行已停止，工作区保留' } });
    this.#store.events.publish('execution.changed', { taskId, executionId: execution.id, status: 'stopped', revision: 2 });
    this.#commands.settle(input.requestKey, { stopped: true });
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.#viewResponse(taskId) };
  }

  /**
   * Startup recovery for executions a previous process left in flight.
   *
   * A process that is gone cannot still be running a node, so in-flight nodes and
   * attempts are settled and the execution moves to `unknown` with an actionable
   * notice. Accepted receipts belonging to that execution are settled to unknown
   * as well (`GET /api/operations/:key` then shows the interruption instead of an
   * endless "still accepted"); nothing is redispatched and no model is called.
   *
   * Returns the affected task ids so the composition root can recompute attention.
   */
  recoverOnStartup(): readonly string[] {
    const affected: string[] = [];
    const failure = new AppError(
      ErrorCode.INTERNAL_ERROR,
      '进程重启，执行中断；正在执行的步骤结果未提交。请核对回执后按原配置重试失败步骤，或取消执行。',
    );
    const notice: NonNullable<ExecutionView['notice']> = { kind: 'unknown', message: failure.message };
    for (const task of this.#store.tasks.list()) {
      const execution = task.executionId === undefined ? this.#store.executions.byTask(task.id) : this.#store.executions.get(task.executionId);
      if (execution === undefined) continue;
      if (execution.status !== 'running' && execution.status !== 'pausing' && execution.status !== 'stopping') continue;
      this.#recoverExecution(task, execution, failure, notice);
      affected.push(task.id);
    }
    return affected;
  }

  #recoverExecution(task: Task, execution: ExecutionView, failure: AppError, notice: NonNullable<ExecutionView['notice']>): void {
    const at = nowIso();
    const interrupted = { code: 'INTERRUPTED', message: '进程重启，步骤执行中断；结果未提交，可按原配置重试' };
    // machines.ts (shared, outside this task's write scope) has no direct
    // RUNNING -> UNKNOWN edge; compose the two legal edges instead:
    // RUNNING --execution.pause--> PAUSING --execution.unknown--> UNKNOWN.
    if (execution.status === 'running') this.#store.executions.update(execution.id, { status: 'pausing' });
    for (const node of execution.nodes) {
      if (node.status !== NodeStatus.RUNNING) continue;
      const attempt = node.currentAttemptId === undefined ? undefined : this.#store.executions.getAttempt(node.currentAttemptId);
      if (attempt !== undefined && attempt.status === NodeStatus.RUNNING) {
        this.#store.executions.finishAttempt(attempt.id, NodeStatus.FAILED, undefined, interrupted.message);
      }
      if (attempt !== undefined && (attempt.status === NodeStatus.SUCCEEDED || attempt.status === NodeStatus.FAILED || attempt.status === NodeStatus.UNKNOWN)) {
        // Crash between writing the attempt result and the node state: the
        // attempt is the durable record, so mirror it instead of guessing.
        this.#store.executions.updateNode(execution.id, node.nodeId, {
          status: attempt.status,
          currentAttemptId: null,
          endedAt: attempt.endedAt ?? at,
          ...(attempt.status === NodeStatus.FAILED ? { error: interrupted } : {}),
        });
        continue;
      }
      this.#store.executions.updateNode(execution.id, node.nodeId, {
        status: NodeStatus.FAILED,
        currentAttemptId: null,
        endedAt: at,
        error: interrupted,
      });
    }
    // Attempts left running without a node pointer (crash between attempt and node writes).
    for (const attempt of this.#store.executions.listAttempts(execution.id)) {
      if (attempt.status === NodeStatus.RUNNING) this.#store.executions.finishAttempt(attempt.id, NodeStatus.FAILED, undefined, interrupted.message);
    }
    const refreshed = this.#store.executions.get(execution.id) ?? execution;
    const progress = {
      done: refreshed.nodes.filter((node) => node.status === NodeStatus.SUCCEEDED).length,
      failed: refreshed.nodes.filter((node) => node.status === NodeStatus.FAILED).length,
      running: refreshed.nodes.filter((node) => node.status === NodeStatus.RUNNING).length,
      total: refreshed.nodes.length,
    };
    this.#store.executions.update(execution.id, { status: 'unknown', notice, progress });
    this.#store.events.publish('execution.changed', { taskId: task.id, executionId: execution.id, status: 'unknown', revision: 1 });
    this.#settleInterruptedReceipts(task.id, execution.id, failure);
  }

  #settleInterruptedReceipts(taskId: string, executionId: string, failure: AppError): void {
    for (const operation of this.#store.operations.listPending()) {
      if (!operation.operation.startsWith('execution.')) continue;
      const targetExecution = operation.target.executionId;
      const sameTarget = targetExecution === executionId || (targetExecution === undefined && operation.target.taskId === taskId);
      if (!sameTarget) continue;
      const record = this.#commands.get(operation.requestKey);
      if (record === undefined || record.status !== 'accepted') continue;
      this.#commands.fail(operation.requestKey, failure, true);
    }
  }

  /** Called by the internal MCP result-submit endpoint. */
  submitResult(input: SubmitNodeResultInput): { ok: true } {
    const attempt = this.#store.executions.getAttempt(input.attemptId);
    if (attempt === undefined) throw new AppError(ErrorCode.NOT_FOUND, '尝试不存在');
    if (attempt.executionId !== (this.get(input.taskId)?.id ?? '')) throw new AppError(ErrorCode.STALE_TARGET, '尝试不属于当前执行');
    if (attempt.status !== 'running') throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '该尝试已结束，不能再提交结果');
    const waiter = this.#resultWaiters.get(input.attemptId);
    const result: AttemptResult = {
      resultRevision: createId('res'),
      summary: input.summary,
      payload: input.payload,
      artifacts: [],
      verification: input.verification,
      errors: [],
      warnings: [],
    };
    if (waiter === undefined) throw new AppError(ErrorCode.STALE_TARGET, '结果等待器不存在');
    waiter.resolve(result);
    return { ok: true };
  }

  async #advance(executionId: string): Promise<void> {
    if (this.#loops.has(executionId)) return;
    this.#loops.add(executionId);
    try {
      for (;;) {
        const execution = this.#store.executions.get(executionId);
        if (execution === undefined || execution.status !== 'running') return;
        const task = this.#requireTask(execution.taskId);
        const plan = this.#store.plans.get(execution.planRevisionId);
        if (plan === undefined) {
          this.#store.executions.update(executionId, { status: 'failed', notice: { kind: 'failed', message: '计划不存在' } });
          return;
        }
        // Auto-advance releases eligible successors on its own. With the switch
        // off only an explicit `advance` call releases nodes; the batch already
        // released still runs here one node at a time.
        if (execution.autoAdvance) this.#recomputeReady(execution, plan);
        const current = this.#store.executions.get(executionId)!;
        const next = current.nodes.find((node) => node.status === NodeStatus.READY);
        if (next === undefined) {
          this.#settleIdleExecution(task, current);
          return;
        }
        const planNode = plan.graph.nodes.find((node) => node.id === next.nodeId);
        if (planNode === undefined) {
          this.#store.executions.updateNode(executionId, next.nodeId, { status: 'failed', error: { code: 'NODE_NOT_EXECUTABLE', message: '步骤不在计划中' } });
          continue;
        }
        await this.#runNode(task, execution, plan, planNode);
        const after = this.#store.executions.get(executionId);
        if (after === undefined || after.status !== 'running') return;
      }
    } finally {
      this.#loops.delete(executionId);
    }
  }

  /**
   * No READY node is left. Complete when every node is terminal, fail when a
   * node failed, otherwise (manual advance mode) park the execution in the
   * durable "waiting for advance" state. The pause is composed from the two
   * legal edges RUNNING -> PAUSING -> PAUSED so it matches machines.ts.
   */
  #settleIdleExecution(task: Task, execution: ExecutionView): void {
    const failed = execution.nodes.filter((node) => node.status === NodeStatus.FAILED);
    const unfinished = execution.nodes.filter((node) => node.status !== NodeStatus.SUCCEEDED && node.status !== NodeStatus.SKIPPED && node.status !== NodeStatus.CANCELLED);
    if (unfinished.length === 0) {
      this.#completeExecution(task, execution);
      return;
    }
    if (failed.length > 0) {
      this.#store.executions.update(execution.id, { status: 'failed', endedAt: nowIso(), notice: { kind: 'failed', message: `${failed.length} 个步骤失败` } });
      this.#store.tasks.update(task.id, { attention: TaskAttention.FAILED });
      this.#store.events.publish('execution.changed', { taskId: task.id, executionId: execution.id, status: 'failed', revision: 1 });
      return;
    }
    if (execution.autoAdvance) return;
    assertTransition(executionMachine, execution.status, 'pausing');
    this.#store.executions.update(execution.id, { status: 'pausing' });
    this.#store.executions.update(execution.id, { status: 'paused', pause: { settledAt: nowIso() }, notice: { kind: 'paused', message: '自动推进已关闭，等待推进' } });
    this.#store.events.publish('execution.changed', { taskId: task.id, executionId: execution.id, status: 'paused', revision: 1 });
  }

  /**
   * Release the nodes an `advance` call is allowed to start. A node is
   * advanceable when its own status is pending/ready and every incoming edge
   * comes from a succeeded/skipped predecessor (parallel joins included). Nodes
   * that already ran or are running are skipped; unmet joins are reported so
   * the HTTP layer can explain the disabled action.
   */
  #releaseAdvanceable(execution: ExecutionView, plan: PlanRevision, nodeId?: string): AdvanceRelease {
    const statuses = new Map(execution.nodes.map((node) => [node.nodeId, node.status]));
    const candidateIds = nodeId === undefined
      ? plan.graph.nodes.map((node) => node.id)
      : plan.graph.edges.filter((edge) => edge.from === nodeId).map((edge) => edge.to);
    const unique = [...new Set(candidateIds)];
    const ready: string[] = [];
    const waitingFor: { nodeId: string; prerequisites: string[] }[] = [];
    for (const id of unique) {
      const node = execution.nodes.find((item) => item.nodeId === id);
      if (node === undefined) continue;
      if (node.status !== NodeStatus.PENDING && node.status !== NodeStatus.READY) continue;
      const unmet = plan.graph.edges
        .filter((edge) => edge.to === id)
        .filter((edge) => {
          const source = statuses.get(edge.from);
          return source !== NodeStatus.SUCCEEDED && source !== NodeStatus.SKIPPED;
        })
        .map((edge) => edge.from);
      if (unmet.length > 0) {
        waitingFor.push({ nodeId: id, prerequisites: unmet });
        continue;
      }
      if (node.status === NodeStatus.PENDING) {
        assertTransition(nodeMachine, node.status, NodeStatus.READY);
        this.#store.executions.updateNode(execution.id, id, { status: NodeStatus.READY });
      }
      ready.push(id);
    }
    const reason = nodeId === undefined
      ? '没有可以推进的步骤：正在等待执行中或待验收的步骤'
      : unique.length === 0
        ? '该步骤没有直接后继'
        : ready.length === 0 && waitingFor.length > 0
          ? '直接后继仍在等待未验收的前置步骤（并行汇合）'
          : '直接后继已开始或已完成，没有可推进的步骤';
    return { ready, waitingFor, reason };
  }

  #recomputeReady(execution: ExecutionView, plan: PlanRevision): void {
    const statuses = new Map(execution.nodes.map((node) => [node.nodeId, node.status]));
    for (const node of execution.nodes) {
      if (node.status !== NodeStatus.PENDING) continue;
      const incoming = plan.graph.edges.filter((edge) => edge.to === node.nodeId);
      const ready = incoming.every((edge) => {
        const source = statuses.get(edge.from);
        return source === NodeStatus.SUCCEEDED || source === NodeStatus.SKIPPED;
      });
      // Root nodes have no incoming edges, so they are ready as soon as they are
      // pending again (e.g. after retrying an interrupted first step).
      if (ready) {
        this.#store.executions.updateNode(execution.id, node.nodeId, { status: 'ready' });
      }
    }
    const refreshed = this.#store.executions.get(execution.id);
    if (refreshed !== undefined) {
      const done = refreshed.nodes.filter((node) => node.status === NodeStatus.SUCCEEDED).length;
      const failed = refreshed.nodes.filter((node) => node.status === NodeStatus.FAILED).length;
      const running = refreshed.nodes.filter((node) => node.status === NodeStatus.RUNNING).length;
      this.#store.executions.update(execution.id, { progress: { done, failed, running, total: refreshed.nodes.length } });
    }
  }

  async #runNode(task: Task, execution: ExecutionView, plan: PlanRevision, node: PlanNode): Promise<void> {
    const settings = this.#context.settings();
    const workspace = task.workspaceId === undefined ? this.#store.workspaces.byTask(task.id) : this.#store.workspaces.get(task.workspaceId);
    if (workspace === undefined || workspace.displayRoot === undefined) {
      this.#store.executions.updateNode(execution.id, node.id, { status: 'failed', error: { code: 'WORKSPACE_NOT_READY', message: '工作区不可用' } });
      return;
    }
    const attempt = this.#store.executions.createAttempt({ executionId: execution.id, nodeId: node.id, ordinal: 1 });
    this.#store.executions.updateNode(execution.id, node.id, {
      status: 'running',
      currentAttemptId: attempt.id,
      attemptCount: (execution.nodes.find((item) => item.nodeId === node.id)?.attemptCount ?? 0) + 1,
      startedAt: nowIso(),
    });
    this.#store.events.publish('execution.changed', { taskId: task.id, executionId: execution.id, status: 'running', revision: 1 });

    const resultPromise = new Promise<AttemptResult>((resolve) => this.#resultWaiters.set(attempt.id, { resolve }));
    const model = this.#coderModel();
    const prompt = this.#executionPrompt(task, plan, node, attempt.id, workspace.displayRoot);
    let outputSeq = 0;
    let textBuffer = '';
    let textBlock = '';
    let flushTimer: NodeJS.Timeout | undefined;
    const appendFragment = (category: 'model_text' | 'tool_activity', text: string, blockId: string | undefined, extra: { callId?: string; status?: string; tool?: string } = {}) => {
      outputSeq += 1;
      const fragmentId = `${attempt.id}:${outputSeq}`;
      this.#store.journal.append(`attempt-${attempt.id}`, {
        type: category,
        at: nowIso(),
        text,
        blockId,
      });
      this.#store.executions.appendOutput({
        attemptId: attempt.id,
        seq: outputSeq,
        fragment: {
          fragmentId,
          seq: outputSeq,
          category,
          text,
          blockId,
          recordedAt: nowIso(),
          ...(category === 'tool_activity' ? { toolCallRef: { callId: extra.callId ?? '', status: extra.status ?? '', source: 'opencode' as const } } : {}),
        },
      });
      this.#store.events.publish('node.output.appended', {
        taskId: task.id,
        executionId: execution.id,
        nodeId: node.id,
        attemptId: attempt.id,
        seq: outputSeq,
        fragmentId,
        category,
        text,
        blockId,
      });
    };
    const flushText = () => {
      if (flushTimer !== undefined) {
        clearTimeout(flushTimer);
        flushTimer = undefined;
      }
      if (textBuffer === '') return;
      appendFragment('model_text', textBuffer, textBlock);
      textBuffer = '';
    };
    let outcome;
    try {
      outcome = await this.#opencode.runSession({
        kind: 'execution',
        metadata: { taskId: task.id, executionId: execution.id, nodeId: node.id, attemptId: attempt.id },
        cwd: workspace.displayRoot,
        prompt,
        model,
        permission: 'workspace_write',
        onSessionId: (id) => {
          this.#activeSessions.set(execution.id, id);
        },
        sink: {
          onTextDelta: (delta, info) => {
            textBuffer += delta;
            textBlock = info.partId;
            if (textBuffer.length >= 600) flushText();
            else if (flushTimer === undefined) flushTimer = setTimeout(flushText, 400);
          },
          onTextEnded: () => {
            flushText();
          },
          onTool: (part, status) => {
            flushText();
            appendFragment('tool_activity', `${part.tool ?? '工具'} · ${status}`, undefined, { callId: part.callID ?? '', status, tool: part.tool });
          },
          onPermission: (permission) => {
            if (['webfetch', 'websearch', 'external_directory'].includes(permission.permission)) return 'reject';
            if (['read', 'glob', 'grep', 'list', 'edit', 'write', 'todowrite'].includes(permission.permission)) return 'once';
            if (permission.permission === 'bash') {
              const allowed = settings.git.defaultTestCommand;
              if (allowed !== '' && permission.patterns.some((pattern) => allowed.includes(pattern) || pattern === '*')) return 'once';
            }
            return 'reject';
          },
        },
        timeoutMs: settings.execution.nodeTimeoutMinutes * 60_000,
        abortOnToolCall: ['result.submit', 'result-submit', 'result_submit'],
      });
      this.#activeSessions.set(execution.id, outcome.sessionId);
    } catch (error) {
      flushText();
      const message = error instanceof Error ? error.message : '执行失败';
      this.#finishNode(execution.id, node.id, attempt.id, NodeStatus.FAILED, undefined, { code: 'OPENCODE_NOT_READY', message });
      return;
    }

    flushText();
    const attemptUsage = usageFromMessages(outcome.outcome.messages);
    const settled = await Promise.race([
      resultPromise,
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 2500)),
    ]);
    if (settled === 'timeout') {
      const error = outcome.outcome.error ?? (outcome.outcome.timedOut ? '步骤执行超时' : '模型未通过 workflow.result.submit 提交结果');
      this.#finishNode(execution.id, node.id, attempt.id, outcome.outcome.timedOut ? NodeStatus.UNKNOWN : NodeStatus.FAILED, undefined, {
        code: outcome.outcome.timedOut ? 'MODEL_BUDGET_EXCEEDED' : 'NODE_NOT_EXECUTABLE',
        message: error,
      }, attemptUsage);
      return;
    }
    const verificationFailed = settled.verification?.state === 'failed';
    this.#finishNode(execution.id, node.id, attempt.id, verificationFailed ? NodeStatus.FAILED : NodeStatus.SUCCEEDED, settled, verificationFailed ? { code: 'VALIDATION_FAILED', message: '验证未通过' } : undefined, attemptUsage);
  }

  #finishNode(executionId: string, nodeId: string, attemptId: string, status: NodeStatusValue, result?: AttemptResult, error?: { code: string; message: string }, usage?: TokenUsage): void {
    this.#store.executions.finishAttempt(attemptId, status, result, error?.message, usage);
    this.#resultWaiters.delete(attemptId);
    this.#store.executions.updateNode(executionId, nodeId, { status, endedAt: nowIso(), error });
    const execution = this.#store.executions.get(executionId);
    if (execution !== undefined) {
      const done = execution.nodes.filter((node) => node.status === NodeStatus.SUCCEEDED).length;
      const failed = execution.nodes.filter((node) => node.status === NodeStatus.FAILED).length;
      const running = execution.nodes.filter((node) => node.status === NodeStatus.RUNNING).length;
      this.#store.executions.update(executionId, { progress: { done, failed, running, total: execution.nodes.length } });
      this.#store.events.publish('execution.changed', { taskId: execution.taskId, executionId, status: execution.status, revision: 1 });
    }
  }

  #completeExecution(task: Task, execution: ExecutionView): void {
    const existing = task.deliveryId === undefined ? this.#store.deliveries.byTask(task.id) : this.#store.deliveries.get(task.deliveryId);
    const delivery: TaskDelivery =
      existing ??
      this.#store.deliveries.create({
        taskId: task.id,
        workspaceId: task.workspaceId,
        eligibility: { allowed: true },
      });
    this.#store.executions.update(execution.id, { status: 'completed', endedAt: nowIso() });
    this.#store.tasks.update(task.id, {
      attention: TaskAttention.WAITING_USER,
      deliveryId: delivery.id,
    });
    this.#store.events.publish('execution.changed', { taskId: task.id, executionId: execution.id, status: 'completed', revision: 1 });
    this.#store.events.publish('task.delivery.updated', { taskId: task.id, deliveryId: delivery.id, revision: delivery.revision, projection: delivery.projection });
    this.#store.events.publish('task.changed', { taskId: task.id, projectId: task.projectId, stage: task.stage, revision: 1 });
  }

  #executionPrompt(task: Task, plan: PlanRevision, node: PlanNode, attemptId: string, worktree: string): string {
    const upstream = plan.graph.edges
      .filter((edge) => edge.to === node.id)
      .map((edge) => plan.graph.nodes.find((item) => item.id === edge.from))
      .filter((item): item is PlanNode => item !== undefined)
      .map((item) => `- ${item.title}（${item.key}）`);
    return `# 任务
${task.title}

# 项目与工作区
项目：${task.projectId}
工作区：${worktree}（独立 worktree；不要操作其他目录）
任务阶段：执行中

# 需求原文
${task.requirement.text}

# 当前步骤
标题：${node.title}
分组：${node.groupId}
说明：${node.summary}
输入：${node.inputs.map((input) => input.name).join('、') || '无'}
输出：${node.outputs.map((output) => output.name).join('、') || '无'}
验收：${node.acceptance.join('；') || '无'}
上游依赖步骤：${upstream.join('、') || '无'}
读取资源：${node.resources.read.map((resource) => resource.label).join('、') || '无'}
写入资源：${node.resources.write.map((resource) => resource.label).join('、') || '无'}

# 执行要求
1. 只在当前工作区内修改文件；使用 workspace.file.read/list/write 工具；可以用 workspace.exec 运行允许的测试命令。
2. 不要执行 git commit/push/merge，不要联网，不要修改工作区外文件。
3. 完成后必须调用 workflow.result.submit 提交结构化结果：
   { taskId: "${task.id}", nodeId: "${node.id}", attemptId: "${attemptId}", summary: "做了什么、结果如何", verification: { state: "passed" | "failed" | "not_configured", summary: "..." } }
4. 如果无法完成，也调用 workflow.result.submit，在 summary 中说明失败原因，verification.state 设为 "failed"。
5. 不要声称未实际验证的测试结果。`;
  }

  #coderModel(): ModelProfile {
    const models = this.#context.settings().models;
    return models.find((model) => model.enabled && model.roles.includes('coder')) ?? models.find((model) => model.enabled) ?? models[0]!;
  }

  #viewResponse(taskId: string): ExecutionResponse {
    const execution = this.get(taskId);
    if (execution === undefined) throw new AppError(ErrorCode.NOT_FOUND, '执行尚未创建');
    const task = this.#requireTask(taskId);
    const workspace = task.workspaceId === undefined ? this.#store.workspaces.byTask(taskId) : this.#store.workspaces.get(task.workspaceId);
    return { execution, workspace, actions: {} };
  }

  #requireTask(taskId: string): Task {
    const task = this.#store.tasks.get(taskId);
    if (task === undefined) throw new AppError(ErrorCode.NOT_FOUND, '任务不存在');
    return task;
  }
}


function usageFromMessages(messages: readonly { readonly info: { readonly role: string; readonly tokens?: Record<string, unknown> } }[] | undefined): TokenUsage {
  let input = 0;
  let output = 0;
  let reasoning = 0;
  let cache = 0;
  for (const message of messages ?? []) {
    if (message.info.role !== 'assistant') continue;
    const raw = message.info.tokens ?? {};
    const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
    const cacheInfo = raw['cache'] !== null && typeof raw['cache'] === 'object' ? raw['cache'] as Record<string, unknown> : {};
    input += num(raw['input']);
    output += num(raw['output']);
    reasoning += num(raw['reasoning']);
    cache += num(cacheInfo['read']) + num(cacheInfo['write']);
  }
  return { input, output, reasoning, cache, total: input + output + reasoning + cache };
}
