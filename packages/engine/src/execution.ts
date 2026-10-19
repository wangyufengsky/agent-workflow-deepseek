import { boundAttempt } from './node-read.ts';
import { templateScopePrompt } from './template-scope.ts';
import { toolEvidence } from './tool-evidence.ts';
import { projectDocumentInstructions } from './project-documents.ts';
import { canShareWorkspace, executionPolicy, executionTimeoutMs, retryClass, retryDelayMs } from './execution-policy.ts';
import { snapshotEvidenceState, snapshotExpectedUnitIds, snapshotReport, validateSnapshotUnitEvidence } from './snapshot-review.ts';
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
import { AppError, ErrorCode, NodeManualAcceptanceState, NodeStatus, TaskAttention, TaskStage, assertTransition, createId, executionMachine, nodeMachine, nowIso } from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';
import {
  clearNodeAcceptance,
  executionAcceptanceGate,
  nodeAcceptanceState,
  planNodeRequiresAcceptance,
  readOnlyRecoveryError,
  type EngineContext,
  type ExecutionAcceptanceGate,
} from './actions.ts';
import type { CommandService } from './operations.ts';
import { captureArtifacts, readArtifactBytes } from './artifacts.ts';
import { roleFileAllowed, roleModel } from './role-runtime.ts';
import type { OpenCodePort } from './ports.ts';

interface StopContext {
  readonly requestKey: string;
  readonly reason?: string;
  confirmed: boolean;
  settled: boolean;
  readonly attemptIds: readonly string[];
  readonly confirmedAttempts: Set<string>;
}

interface ResultWaiter {
  resolve(result: AttemptResult): void;
}

interface AdvanceRelease {
  readonly ready: readonly string[];
  readonly waitingFor: readonly { readonly nodeId: string; readonly prerequisites: readonly string[] }[];
  /** Predecessors whose human-acceptance verdict is still pending/rejected. */
  readonly awaitingAcceptance: readonly string[];
  readonly reason: string;
}

export interface SubmitNodeResultInput {
  readonly taskId: string;
  readonly nodeId: string;
  readonly attemptId: string;
  readonly summary: string;
  readonly payload?: Record<string, unknown>;
  readonly verification?: AttemptResult['verification'];
  readonly artifacts?: readonly import('@agent-workflow/shared').ArtifactSubmission[];
}

export class ExecutionService {
  readonly #store: Store;
  readonly #commands: CommandService;
  readonly #context: EngineContext;
  readonly #opencode: OpenCodePort;
  readonly #resultWaiters = new Map<string, ResultWaiter>();
  readonly #loops = new Map<string, symbol>();
  readonly #activeSessions = new Map<string, Map<string, string>>();
  readonly #idleAttempts = new Set<string>();
  readonly #wakes = new Map<string, Set<() => void>>();
  #closed = false;
  readonly #stops = new Map<string, StopContext>();

  constructor(store: Store, commands: CommandService, context: EngineContext, opencode: OpenCodePort) {
    this.#store = store;
    this.#commands = commands;
    this.#context = context;
    this.#opencode = opencode;
  }

  /** Stop local scheduling before closing storage; durable waits require explicit resume after restart. */
  shutdown(): void {
    this.#closed = true;
    this.#loops.clear();
    for (const executionId of this.#wakes.keys()) this.#wake(executionId);
    this.#resultWaiters.clear();
  }

  get(taskId: string): ExecutionView | undefined {
    const task = this.#store.tasks.get(taskId);
    if (task === undefined) return undefined;
    const execution = task.executionId === undefined ? this.#store.executions.byTask(taskId) : this.#store.executions.get(task.executionId);
    if (execution === undefined) return undefined;
    return this.#withAcceptance(execution);
  }

  /** Overlay the W0-4b acceptance gate on the durable execution view. */
  #withAcceptance(execution: ExecutionView): ExecutionView {
    const plan = this.#store.plans.get(execution.planRevisionId);
    const gate = executionAcceptanceGate(this.#store, execution, plan);
    if (gate.pending.length === 0 && gate.rejected.length === 0) return execution;
    return { ...execution, acceptance: { pending: gate.pending, rejected: gate.rejected } };
  }

  start(taskId: string, input: ExecutionCommandRequest): CommandResponse<ExecutionResponse> {
    const originalReceipt = this.#commands.replay({ requestKey: input.requestKey, operation: 'execution.start', body: { taskId, expectedStatus: input.expectedStatus, confirm: true } }, () => this.#viewResponse(taskId));
    if (originalReceipt !== undefined) return originalReceipt;
    const task = this.#assertWritable(taskId, '开始执行');
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
    if (replayed) {
      return { receipt: this.#commands.toReceipt(record), resource: this.#viewResponse(taskId) };
    }
    if (execution.status !== 'idle' && execution.status !== 'ready' && execution.status !== 'paused') {
      throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '当前执行状态不能开始');
    }
    const updated = this.#store.executions.update(execution.id, {
      status: 'running',
      startedAt: execution.startedAt ?? nowIso(),
      notice: null,
      pause: null,
      endedAt: null,
    });
    executionPolicy(this.#store, execution.id, this.#context.settings().execution);
    this.#store.tasks.update(taskId, { stage: TaskStage.EXECUTING, attention: TaskAttention.NONE, executionId: execution.id });
    this.#store.events.publish('execution.changed', { taskId, executionId: execution.id, status: 'running', revision: 1 });
    this.#store.events.publish('task.changed', { taskId, projectId: task.projectId, stage: TaskStage.EXECUTING, revision: 1 });
    this.#commands.settle(input.requestKey, { executionId: execution.id });
    void this.#advance(execution.id);
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: { execution: updated ?? execution, workspace, actions: {} } };
  }

  pause(taskId: string, input: ExecutionCommandRequest): CommandResponse<ExecutionResponse> {
    const originalReceipt = this.#commands.replay({ requestKey: input.requestKey, operation: 'execution.pause', body: { taskId, expectedStatus: input.expectedStatus } }, () => this.#viewResponse(taskId));
    if (originalReceipt !== undefined) return originalReceipt;
    this.#assertWritable(taskId, '暂停执行');
    const task = this.#requireTask(taskId);
    const execution = this.get(taskId);
    if (execution === undefined || execution.status !== 'running') throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '当前没有运行中的执行');
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'execution.pause',
      body: { taskId, expectedStatus: input.expectedStatus },
      target: { taskId, executionId: execution.id },
    });
    if (replayed) return { receipt: this.#commands.toReceipt(record), resource: this.#viewResponse(taskId) };
    this.#store.executions.update(execution.id, { status: 'paused', pause: { requestedAt: nowIso(), settledAt: nowIso(), requestKey: input.requestKey }, notice: { kind: 'paused', message: '已暂停新增领取' } });
    this.#store.events.publish('execution.changed', { taskId, executionId: execution.id, status: 'paused', revision: 1 });
    this.#wake(execution.id);
    this.#commands.settle(input.requestKey, { paused: true });
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.#viewResponse(taskId) };
  }

  resume(taskId: string, input: ExecutionCommandRequest): CommandResponse<ExecutionResponse> {
    const originalReceipt = this.#commands.replay({ requestKey: input.requestKey, operation: 'execution.resume', body: { taskId, expectedStatus: input.expectedStatus } }, () => this.#viewResponse(taskId));
    if (originalReceipt !== undefined) return originalReceipt;
    this.#assertWritable(taskId, '继续执行');
    const task = this.#requireTask(taskId);
    const execution = this.get(taskId);
    if (execution === undefined || execution.status !== 'paused') throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '当前没有暂停的执行');
    if (execution.editSession !== undefined && !['finished', 'abandoned'].includes(execution.editSession.state)) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '计划调整尚未结束，请先重新确认并结束调整');
    if (execution.nodes.some((node) => node.status === NodeStatus.FAILED) && executionPolicy(this.#store, execution.id, this.#context.settings().execution).pauseAfterFailure) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '先重试或处理失败步骤，再继续执行');
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'execution.resume',
      body: { taskId, expectedStatus: input.expectedStatus },
      target: { taskId, executionId: execution.id },
    });
    if (replayed) return { receipt: this.#commands.toReceipt(record), resource: this.#viewResponse(taskId) };
    this.#store.executions.update(execution.id, { status: 'running', notice: null, pause: null, endedAt: null });
    this.#store.events.publish('execution.changed', { taskId, executionId: execution.id, status: 'running', revision: 1 });
    this.#wake(execution.id);
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
    const originalReceipt = this.#commands.replay({ requestKey: input.requestKey, operation: 'execution.autoAdvance', body: { taskId, autoAdvance: input.autoAdvance, confirmChange: true } }, () => this.#viewResponse(taskId));
    if (originalReceipt !== undefined) return originalReceipt;
    this.#assertWritable(taskId, '切换自动推进');
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
    if (replayed) return { receipt: this.#commands.toReceipt(record), resource: this.#viewResponse(taskId) };
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
    const originalReceipt = this.#commands.replay({ requestKey: input.requestKey, operation: 'execution.advance', body: { taskId, nodeId: input.nodeId ?? null, confirmAdvance: true } }, () => this.#viewResponse(taskId));
    if (originalReceipt !== undefined) return originalReceipt;
    this.#assertWritable(taskId, '推进执行');
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
    if (replayed) return { receipt: this.#commands.toReceipt(record), resource: this.#viewResponse(taskId) };
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
        details: { nodeId: input.nodeId ?? null, waitingFor: release.waitingFor, awaitingAcceptance: release.awaitingAcceptance },
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

  /** Validate before switching; active attempts retain their original immutable definitions. */
  validatePlanBinding(executionId: string, plan: PlanRevision): void {
    const execution = this.#store.executions.get(executionId);
    if (execution === undefined) throw new AppError(ErrorCode.NOT_FOUND, '执行不存在');
    if (['unknown', 'stopping'].includes(execution.status)) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '原执行尚未核对停稳，不能切换计划');
    const previous = this.#store.plans.get(execution.planRevisionId);
    if (previous === undefined || plan.taskId !== execution.taskId) throw new AppError(ErrorCode.STALE_TARGET, '执行计划归属不匹配');
    for (const state of execution.nodes) {
      if (state.attemptCount === 0 && ['ready', 'pending'].includes(state.status)) continue;
      const before = previous.graph.nodes.find((node) => node.id === state.nodeId);
      const after = plan.graph.nodes.find((node) => node.id === state.nodeId);
      const incoming = (graph: PlanRevision['graph']) => graph.edges.filter((edge) => edge.to === state.nodeId).map((edge) => ({ from: edge.from, kind: edge.kind })).sort((a, b) => a.from.localeCompare(b.from));
      if (before === undefined || after === undefined || JSON.stringify(before) !== JSON.stringify(after) || JSON.stringify(incoming(previous.graph)) !== JSON.stringify(incoming(plan.graph))) {
        throw new AppError(ErrorCode.STALE_TARGET, '已领取或已尝试的步骤及其前驱不能被计划调整改写', { details: { nodeId: state.nodeId } });
      }
    }
  }

  bindConfirmedPlan(executionId: string, plan: PlanRevision): void {
    if (plan.status !== 'confirmed') throw new AppError(ErrorCode.PLAN_REVISION_CONFLICT, '只有已确认计划可以绑定到执行');
    this.validatePlanBinding(executionId, plan);
    const previous = this.#store.executions.get(executionId)!;
    const graph = this.#store.plans.get(previous.planRevisionId)!.graph;
    for (const attempt of this.#store.executions.listAttempts(executionId)) {
      const node = graph.nodes.find((item) => item.id === attempt.nodeId);
      if (node !== undefined) this.#store.executions.preserveAttemptDefinition(attempt.id, previous.planRevisionId, node);
    }
    const rebound = this.#store.executions.rebindPlan(executionId, plan.id, plan.graph)!;
    this.#recomputeReady(rebound, plan);
  }

  /** Resume scheduling after a plan-edit action put an execution back to `running`. */
  kick(taskId: string): void {
    const execution = this.get(taskId);
    if (execution === undefined || execution.status !== 'running') return;
    void this.#advance(execution.id);
  }

  retry(taskId: string, input: ExecutionCommandRequest): CommandResponse<ExecutionResponse> {
    if (input.nodeIds !== undefined && !Array.isArray(input.nodeIds)) throw new AppError(ErrorCode.VALIDATION_FAILED, '重试步骤必须是步骤集合');
    const nodeIds = input.nodeIds === undefined ? undefined : [...input.nodeIds].sort();
    if (nodeIds !== undefined && (nodeIds.length === 0 || nodeIds.some((id) => typeof id !== 'string' || id.trim().length === 0) || new Set(nodeIds).size !== nodeIds.length)) throw new AppError(ErrorCode.VALIDATION_FAILED, '重试步骤必须是非空且不重复的步骤集合');
    const body = { taskId, expectedStatus: input.expectedStatus, confirm: true, ...(nodeIds === undefined ? {} : { nodeIds }) };
    const originalReceipt = this.#commands.replay({ requestKey: input.requestKey, operation: 'execution.retry', body }, () => this.#viewResponse(taskId));
    if (originalReceipt !== undefined) return originalReceipt;
    const task = this.#assertWritable(taskId, '重试执行');
    const execution = this.get(taskId);
    if (execution === undefined) throw new AppError(ErrorCode.NOT_FOUND, '执行尚未创建');
    if (input.expectedStatus !== undefined && input.expectedStatus !== execution.status) throw new AppError(ErrorCode.STALE_TARGET, '执行状态已变化，请刷新后重试');
    if (nodeIds !== undefined && execution.status === 'unknown') throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '执行结果未知，请先核对原请求');
    if (execution.editSession !== undefined && !['finished', 'abandoned'].includes(execution.editSession.state)) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '计划调整尚未结束，请先确认并结束调整');
    const plan = this.#store.plans.get(execution.planRevisionId);
    if (this.#stops.get(execution.id)?.settled === false || (execution.status === 'unknown' && this.#store.operations.listPending().some((operation) => operation.operation === 'execution.cancel' && operation.target.executionId === execution.id))) {
      throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '停止尚未确认，请先按原请求号核对，不能重试');
    }
    if (execution.nodes.some((node) => node.status === NodeStatus.RUNNING || node.status === NodeStatus.UNKNOWN)) {
      throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '仍有活动或结果未知的步骤，停稳核对前不能重试');
    }
    if (nodeIds !== undefined && nodeIds.some((id) => !execution.nodes.some((node) => node.nodeId === id && node.status === NodeStatus.FAILED))) throw new AppError(ErrorCode.VALIDATION_FAILED, '只能重试当前执行中明确失败的步骤');
    const failedNodes = execution.nodes.filter((node) => node.status === NodeStatus.FAILED && (nodeIds === undefined || nodeIds.includes(node.nodeId)));
    // W0-4b: a node the human sent back for rework (verdict rejected) can be
    // retried even though its last execution succeeded.
    const rejectedNodes = nodeIds !== undefined || plan === undefined
      ? []
      : execution.nodes.filter((node) => node.status === NodeStatus.SUCCEEDED
          && plan.graph.nodes.some((planNode) => planNode.id === node.nodeId && planNodeRequiresAcceptance(planNode))
          && nodeAcceptanceState(this.#store, execution.id, node.nodeId) === NodeManualAcceptanceState.REJECTED);
    const remainingStopped = execution.status === 'stopped' && execution.nodes.some((node) => node.status === NodeStatus.PENDING || node.status === NodeStatus.READY);
    if (failedNodes.length === 0 && rejectedNodes.length === 0 && !remainingStopped) {
      throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '当前没有失败的步骤可以重试');
    }
    // `unknown` is the startup-recovery state: interrupted nodes are persisted as
    // failed, so an explicit retry is the user-approved way out of it.
    if (!['failed', 'stopped', 'paused', 'unknown'].includes(execution.status)) {
      throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '执行仍在运行，先暂停/取消后再重试', { details: { status: execution.status } });
    }
    const policy = executionPolicy(this.#store, execution.id, this.#context.settings().execution);
    if (this.#store.executions.listAttempts(execution.id).length >= policy.maxTaskAttempts) throw new AppError(ErrorCode.MODEL_BUDGET_EXCEEDED, '任务总尝试次数已用完；请创建恢复任务');
    if ((this.#store.settings.getJson<number>(`execution.session-errors.${execution.id}`) ?? 0) >= policy.sessionErrorThreshold) throw new AppError(ErrorCode.MODEL_BUDGET_EXCEEDED, '会话异常次数已达阈值；请检查运行环境后创建恢复任务');
    if (policy.timeoutEnabled && execution.startedAt !== undefined && Date.now() >= Date.parse(execution.startedAt) + policy.taskTimeoutMinutes * 60000) throw new AppError(ErrorCode.MODEL_BUDGET_EXCEEDED, '任务业务总时限已用完；请创建恢复任务');
    const exhausted = [...failedNodes, ...rejectedNodes].filter((node) => node.attemptCount >= policy.maxAttempts);
    if (exhausted.length > 0) throw new AppError(ErrorCode.MODEL_BUDGET_EXCEEDED, '步骤尝试次数已用完（含首次执行）；请创建恢复任务', { details: { nodeIds: exhausted.map((node) => node.nodeId), maxAttempts: policy.maxAttempts } });
    const retriedNodeIds = [...failedNodes.map((node) => node.nodeId), ...rejectedNodes.map((node) => node.nodeId)];
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'execution.retry',
      body,
      target: { taskId, executionId: execution.id },
    });
    if (replayed) return { receipt: this.#commands.toReceipt(record), resource: this.#viewResponse(taskId) };
    this.#beginGeneration(execution.id);
    this.#store.settings.putJson(`execution.retry-scope.${execution.id}`, nodeIds ?? null);
    for (const node of [...failedNodes, ...rejectedNodes]) {
      const delayMs = retryDelayMs(policy, node.error, node.attemptCount);
      this.#store.settings.putJson(`execution.retry-ready-at.${execution.id}.${node.nodeId}`, { readyAt: Date.now() + delayMs, delayMs, reason: retryClass(node.error), requestKey: input.requestKey });
    }
    for (const nodeId of retriedNodeIds) {
      this.#store.executions.updateNode(execution.id, nodeId, {
        status: NodeStatus.PENDING,
        error: null,
        startedAt: null,
        endedAt: null,
        currentAttemptId: null,
      });
    }
    if (plan !== undefined) this.#recomputeReady(this.#store.executions.get(execution.id)!, plan);
    for (const node of rejectedNodes) clearNodeAcceptance(this.#store, execution.id, node.nodeId);
    this.#store.executions.update(execution.id, {
      status: 'running',
      endedAt: null,
      pause: null,
      notice: { kind: 'paused', message: `按原配置重试 ${String(failedNodes.length)} 个失败步骤${rejectedNodes.length === 0 ? '' : `、${String(rejectedNodes.length)} 个被退回步骤`}` },
    });
    this.#store.tasks.update(taskId, { attention: TaskAttention.NONE });
    this.#store.events.publish('execution.changed', { taskId, executionId: execution.id, status: 'running', revision: 1 });
    this.#commands.settle(input.requestKey, { retried: retriedNodeIds.length, nodeIds: retriedNodeIds, failedRetried: failedNodes.length, rejectedRetried: rejectedNodes.length });
    void this.#advance(execution.id);
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.#viewResponse(taskId) };
  }

  /**
   * W0-4b: a human verdict can unblock completion or downstream release. Called
   * by the plan service after accept/reject; only acts on an acceptance-parked
   * execution (paused without a user-pause requestKey, or waiting_confirmation).
   */
  reconcileAcceptance(taskId: string): void {
    const task = this.#store.tasks.get(taskId);
    if (task === undefined) return;
    const execution = this.get(taskId);
    if (execution === undefined) return;
    if (execution.status !== 'paused' && execution.status !== 'waiting_confirmation') return;
    // A user pause stays authoritative: only an explicit resume continues it.
    if (execution.pause?.requestKey !== undefined) return;
    const plan = this.#store.plans.get(execution.planRevisionId);
    if (plan === undefined) return;
    const gate = executionAcceptanceGate(this.#store, execution, plan);
    if (!gate.satisfied) {
      this.#parkForAcceptance(task, execution, gate);
      return;
    }
    if (execution.status === 'paused') assertTransition(executionMachine, execution.status, 'running');
    this.#store.executions.update(execution.id, { status: 'running', notice: { kind: 'paused', message: '验收已通过，继续执行' } });
    this.#store.events.publish('execution.changed', { taskId, executionId: execution.id, status: 'running', revision: 1 });
    void this.#advance(execution.id);
  }

  skipNode(taskId: string, nodeId: string, input: NodeSkipRequest): CommandResponse<ExecutionResponse> {
    const originalReceipt = this.#commands.replay({ requestKey: input.requestKey, operation: 'execution.skipNode', body: { taskId, nodeId, confirmSkip: true } }, () => this.#viewResponse(taskId));
    if (originalReceipt !== undefined) return originalReceipt;
    const task = this.#assertWritable(taskId, '跳过执行节点');
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
    if (replayed) return { receipt: this.#commands.toReceipt(record), resource: this.#viewResponse(taskId) };
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
      this.#completeExecution(task, refreshed, plan);
    } else {
      this.#store.tasks.update(taskId, { attention: TaskAttention.NONE });
    }
    this.#store.events.publish('execution.changed', { taskId, executionId: execution.id, status: this.get(taskId)?.status ?? refreshed.status, revision: 1 });
    this.#commands.settle(input.requestKey, { skipped: [...skipped] });
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.#viewResponse(taskId) };
  }

  #wake(executionId: string): void {
    for (const wake of this.#wakes.get(executionId) ?? []) wake();
  }

  #beginGeneration(executionId: string): void {
    // Invalidate every old loop/callback before permitting another attempt.
    this.#loops.delete(executionId);
    this.#wake(executionId);
    this.#stops.delete(executionId);
    this.#activeSessions.delete(executionId);
  }

  async cancel(taskId: string, input: ExecutionCommandRequest, reason?: string): Promise<CommandResponse<ExecutionResponse>> {
    const originalReceipt = this.#commands.replay({ requestKey: input.requestKey, operation: 'execution.cancel', body: { taskId, expectedStatus: input.expectedStatus, confirm: true } }, () => this.#viewResponse(taskId));
    if (originalReceipt !== undefined) return originalReceipt;
    this.#assertWritable(taskId, '取消执行');
    const task = this.#requireTask(taskId);
    const execution = this.get(taskId);
    if (execution === undefined) throw new AppError(ErrorCode.NOT_FOUND, '执行尚未创建');
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'execution.cancel',
      body: { taskId, expectedStatus: input.expectedStatus, confirm: true },
      target: { taskId, executionId: execution.id },
    });
    if (replayed) return { receipt: this.#commands.toReceipt(record), resource: this.#viewResponse(taskId) };
    if (this.#stops.has(execution.id) || !['running', 'pausing', 'paused'].includes(execution.status)) {
      this.#commands.fail(input.requestKey, new AppError(ErrorCode.OPERATION_IN_PROGRESS, '执行无法重复停止；请核对原请求号'));
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.#viewResponse(taskId) };
    }
    const stop: StopContext = { requestKey: input.requestKey, reason, confirmed: false, settled: false, attemptIds: execution.nodes.filter((node) => node.status === NodeStatus.RUNNING).flatMap((node) => node.currentAttemptId === undefined ? [] : [node.currentAttemptId]), confirmedAttempts: new Set() };
    this.#stops.set(execution.id, stop);
    if (reason !== undefined) this.#store.settings.putJson(`execution.stop-reason.${input.requestKey}`, reason);
    this.#store.executions.update(execution.id, { status: 'stopping' });
    this.#wake(execution.id);
    this.#store.events.publish('execution.changed', { taskId, executionId: execution.id, status: 'stopping', revision: 1 });
    for (const id of stop.attemptIds) if (this.#idleAttempts.has(id)) stop.confirmedAttempts.add(id);
    const requests = stop.attemptIds.filter((id) => !stop.confirmedAttempts.has(id)).map(async (attemptId) => {
      const sessionId = this.#activeSessions.get(execution.id)?.get(attemptId);
      if (sessionId === undefined) throw new Error('会话仍在创建；收到会话后将阻止派发，当前不能确认停稳');
      await this.#opencode.abortSession(sessionId);
      stop.confirmedAttempts.add(attemptId);
      this.#settleStop(execution.id, stop);
    });
    this.#settleStop(execution.id, stop);
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([Promise.all(requests), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('停止确认超时')), executionPolicy(this.#store, execution.id, this.#context.settings().execution).pauseTimeoutMs);
      })]);
    } catch (error) {
      this.#unknownStop(execution.id, error instanceof Error ? error.message : '停止未确认', stop);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.#viewResponse(taskId) };
  }

  #unknownStop(executionId: string, message: string, expectedStop = this.#stops.get(executionId)): void {
    if (this.#closed) return;
    const stop = this.#stops.get(executionId);
    const execution = this.#store.executions.get(executionId);
    if (stop === undefined || stop !== expectedStop || stop.settled || execution === undefined || !['stopping', 'unknown'].includes(execution.status)) return;
    this.#store.executions.update(executionId, { status: 'unknown', notice: { kind: 'unknown', message: `停止尚未确认：${message}。保留原请求号核对，不能重发。` } });
    this.#store.tasks.update(execution.taskId, { attention: TaskAttention.UNKNOWN });
    this.#commands.fail(stop.requestKey, new AppError(ErrorCode.INTERNAL_ERROR, message), true);
    this.#store.events.publish('execution.changed', { taskId: execution.taskId, executionId, status: 'unknown', revision: 1 });
  }

  #settleStop(executionId: string, expectedStop = this.#stops.get(executionId)): void {
    if (this.#closed) return;
    const stop = this.#stops.get(executionId);
    const execution = this.#store.executions.get(executionId);
    if (stop === undefined || stop !== expectedStop || stop.settled || execution === undefined || !['stopping', 'unknown'].includes(execution.status)) return;
    stop.confirmed = stop.attemptIds.every((id) => stop.confirmedAttempts.has(id));
    if (!stop.confirmed) return;
    stop.settled = true;
    for (const node of execution.nodes) {
      if (node.currentAttemptId === undefined || !stop.attemptIds.includes(node.currentAttemptId)) continue;
      if (node.status !== NodeStatus.RUNNING && node.status !== NodeStatus.UNKNOWN && node.error?.code !== 'INTERRUPTED') continue;
      if (node.currentAttemptId !== undefined) {
        this.#store.executions.finishAttempt(node.currentAttemptId, NodeStatus.CANCELLED, undefined, '用户停止执行');
        this.#resultWaiters.delete(node.currentAttemptId);
        this.#idleAttempts.delete(node.currentAttemptId);
      }
      this.#store.executions.updateNode(executionId, node.nodeId, { status: NodeStatus.FAILED, endedAt: nowIso(), error: { code: stop.reason === undefined ? 'STOPPED' : ErrorCode.MODEL_BUDGET_EXCEEDED, message: stop.reason ?? '用户停止，当前步骤未完成；可按原配置重试' } });
    }
    this.#store.executions.update(executionId, { status: 'stopped', endedAt: nowIso(), progress: { ...execution.progress, failed: this.#store.executions.get(executionId)!.nodes.filter((node) => node.status === NodeStatus.FAILED).length, running: 0 }, notice: { kind: stop.reason === undefined ? 'paused' : 'failed', message: stop.reason ?? '执行已确认停止，工作区保留' } });
    this.#store.tasks.update(execution.taskId, { attention: stop.reason === undefined ? TaskAttention.NONE : TaskAttention.FAILED });
    this.#commands.settle(stop.requestKey, { stopped: true });
    this.#activeSessions.delete(executionId);
    this.#store.events.publish('execution.changed', { taskId: execution.taskId, executionId, status: 'stopped', revision: 1 });
  }

  /** Read-only reconciliation of the original cancellation; never sends abort or prompt. */
  async reconcileOperation(requestKey: string): Promise<void> {
    const operation = this.#commands.get(requestKey);
    if (operation === undefined) return;
    if (operation.operation !== 'execution.cancel') {
      if (operation.operation.startsWith('execution.') && operation.target.executionId !== undefined) await this.#reconcileUnknownNodes(operation.target.executionId);
      return;
    }
    if (!['accepted', 'unknown'].includes(operation.status)) return;
    const executionId = operation.target.executionId;
    if (executionId === undefined) return;
    const execution = this.#store.executions.get(executionId);
    if (execution === undefined || !['unknown', 'stopping'].includes(execution.status)) return;
    if (this.#opencode.inspectSession === undefined) return;
    let stop = this.#stops.get(executionId);
    if (stop !== undefined && stop.requestKey !== requestKey) return;
    const active = execution.nodes.filter((node) => node.currentAttemptId !== undefined && (node.status === NodeStatus.RUNNING || node.status === NodeStatus.UNKNOWN || node.error?.code === 'INTERRUPTED'));
    if (stop === undefined) {
      stop = { requestKey, reason: this.#store.settings.getJson<string>(`execution.stop-reason.${requestKey}`), confirmed: false, settled: false, attemptIds: active.map((node) => node.currentAttemptId!), confirmedAttempts: new Set() };
      this.#stops.set(executionId, stop);
    }
    const expectedStop = stop;
    try {
      // Absence from a session listing never proves that a lost create request
      // did not reach the runtime. Require an explicit idle state for every
      // session belonging to this exact attempt.
      if (stop.attemptIds.length === 0) return;
      for (const attemptId of stop.attemptIds) {
        const saved = this.#store.settings.getJson<{ sessionId: string }>(`execution.session.${attemptId}`);
        const sessions = saved === undefined
          ? await this.#opencode.findSessions({ taskId: execution.taskId, executionId, attemptId })
          : [{ id: saved.sessionId }];
        if (sessions.length === 0) continue;
        const states = await Promise.all(sessions.map((session) => this.#opencode.inspectSession!(session.id)));
        if (states.every((state) => state === 'idle')) expectedStop.confirmedAttempts.add(attemptId);
      }
      this.#settleStop(executionId, expectedStop);
    } catch {
      // A read failure leaves the durable UNKNOWN receipt intact.
    }
  }

  async #reconcileUnknownNodes(executionId: string): Promise<void> {
    const execution = this.#store.executions.get(executionId);
    if (execution?.status !== 'unknown' || this.#opencode.inspectSession === undefined || this.#stops.has(executionId)) return;
    this.#store.settings.putJson(`execution.retry-scope.${execution.id}`, null);
    const unknown = execution.nodes.filter((node) => node.status === NodeStatus.UNKNOWN);
    if (unknown.length === 0) return;
    for (const node of unknown) {
      const attemptId = node.currentAttemptId;
      if (attemptId === undefined) return;
      const saved = this.#store.settings.getJson<{ sessionId: string }>(`execution.session.${attemptId}`);
      if (saved === undefined) return;
      try { if (await this.#opencode.inspectSession(saved.sessionId) !== 'idle') return; } catch { return; }
    }
    // All original sessions are explicitly idle. Re-read to exclude a newer generation.
    if (this.#store.executions.get(executionId)?.status !== 'unknown') return;
    for (const node of unknown) {
      const attempt = this.#store.executions.getAttempt(node.currentAttemptId!);
      if (attempt === undefined || attempt.status !== NodeStatus.UNKNOWN) continue;
      const status = attempt.result === undefined || attempt.result.verification?.state === 'failed' ? NodeStatus.FAILED : NodeStatus.SUCCEEDED;
      assertTransition(nodeMachine, node.status, status);
      this.#store.executions.finishAttempt(attempt.id, status, attempt.result, status === NodeStatus.FAILED ? '核对会话已结束；没有可通过的结构化结果，需显式重试' : undefined, attempt.usage);
      this.#store.executions.updateNode(executionId, node.nodeId, { status, endedAt: nowIso(), error: status === NodeStatus.FAILED ? { code: 'OPENCODE_NOT_READY', message: '核对已停稳；结果缺失或验证失败，需显式重试' } : null });
      if (status === NodeStatus.FAILED) this.#recordSessionError(executionId, attempt.id, node.error);
    }
    const refreshed = this.#store.executions.get(executionId)!;
    const failed = refreshed.nodes.some((node) => node.status === NodeStatus.FAILED);
    assertTransition(executionMachine, 'unknown', failed ? 'failed' : 'paused');
    this.#store.executions.update(executionId, { status: failed ? 'failed' : 'paused', notice: { kind: failed ? 'failed' : 'paused', message: '原会话已核对停稳；未派发任何新尝试，请处理结果后显式继续' }, progress: { ...refreshed.progress, running: 0, failed: refreshed.nodes.filter((node) => node.status === NodeStatus.FAILED).length } });
    this.#store.tasks.update(execution.taskId, { attention: failed ? TaskAttention.FAILED : TaskAttention.WAITING_USER });
    this.#store.events.publish('execution.changed', { taskId: execution.taskId, executionId, status: failed ? 'failed' : 'paused', revision: 1 });
  }

  #recordSessionError(executionId: string, attemptId: string, error?: { readonly code: string; readonly message: string }): void {
    if (retryClass(error) !== 'session_error' || this.#store.settings.getJson(`execution.session-error-attempt.${attemptId}`) === true) return;
    this.#store.settings.putJson(`execution.session-error-attempt.${attemptId}`, true);
    const count = this.#store.settings.getJson<number>(`execution.session-errors.${executionId}`) ?? 0;
    this.#store.settings.putJson(`execution.session-errors.${executionId}`, count + 1);
  }

  /**
   * Startup recovery for executions a previous process left in flight.
   *
   * A desktop process ending is not evidence that its runtime session stopped.
   * Pending cancellations retain UNKNOWN attempts and their durable identity for
   * read-only session reconciliation. Other interrupted executions retain the
   * existing failed-step recovery path and an actionable UNKNOWN notice.
   * Accepted receipts belonging to that execution are settled to unknown
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
      if (execution.status === 'running' && !execution.nodes.some((node) => node.status === NodeStatus.RUNNING) && execution.nodes.some((node) => this.#store.settings.getJson(`execution.retry-ready-at.${execution.id}.${node.nodeId}`) !== undefined)) {
        this.#store.executions.update(execution.id, { status: 'paused', pause: null, notice: { kind: 'paused', message: '服务重启，已保留原重试等待时间；请显式继续，不自动派发模型' } });
        affected.push(task.id);
        continue;
      }
      const pendingStop = this.#store.operations.listPending().find((operation) => operation.operation === 'execution.cancel' && operation.target.executionId === execution.id);
      const knownRemote = execution.nodes.some((node) => node.status === NodeStatus.RUNNING && node.currentAttemptId !== undefined && this.#store.settings.getJson(`execution.session.${node.currentAttemptId}`) !== undefined);
      if (pendingStop !== undefined || knownRemote) {
        // The desktop process ending does not prove its remote session ended.
        // Keep attempt identity for read-only reconciliation, never allow retry
        // until the original cancellation has a positive idle observation.
        for (const node of execution.nodes) {
          if (node.status !== NodeStatus.RUNNING) continue;
          this.#store.executions.updateNode(execution.id, node.nodeId, { status: NodeStatus.UNKNOWN });
          if (node.currentAttemptId !== undefined) this.#store.executions.finishAttempt(node.currentAttemptId, NodeStatus.UNKNOWN, undefined, '服务重启，停止待核对');
        }
        this.#store.executions.update(execution.id, { status: 'unknown', notice: { kind: 'unknown', message: '服务重启，原会话停稳尚未确认；请按原请求号只读核对会话' } });
        if (pendingStop !== undefined) this.#commands.fail(pendingStop.requestKey, failure, true);
        else this.#settleInterruptedReceipts(task.id, execution.id, failure);
      } else {
        this.#recoverExecution(task, execution, failure, notice);
      }
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
    if (this.#stops.has(attempt.executionId)) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '执行停止中，不能提交迟到结果');
    if (attempt.status !== 'running') throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '该尝试已结束，不能再提交结果');
    if (attempt.nodeId !== input.nodeId) throw new AppError(ErrorCode.STALE_TARGET, '尝试不属于当前节点');
    const task = this.#requireTask(input.taskId);
    if (task.fixedTemplate?.snapshot !== undefined) {
      const plan = this.#store.plans.get(this.get(task.id)!.planRevisionId);
      const node = plan?.graph.nodes.find((item) => item.id === input.nodeId);
      if (node === undefined || node.snapshotStage === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '快照结果没有绑定分析步骤');
      const evidence = snapshotEvidenceState(this.#store, task.id);
      const units = validateSnapshotUnitEvidence(task.fixedTemplate.snapshot, node, input.payload, snapshotExpectedUnitIds(task.fixedTemplate.snapshot, node, evidence), evidence.analyzed);
      for (const unit of units) {
        const read = this.#store.settings.getJson<{ blobSha: string; totalLines: number }>(`snapshot.read.${input.attemptId}.${unit.unitId}`);
        if (read?.blobSha !== unit.blobSha) throw new AppError(ErrorCode.VALIDATION_FAILED, '此尝试尚未完整读取该冻结源码单元，不能提交已分析证据');
        if (unit.findings.some((finding) => finding.line > read.totalLines)) throw new AppError(ErrorCode.VALIDATION_FAILED, '问题引用的行号超出冻结源码');
      }

    }
    const waiter = this.#resultWaiters.get(input.attemptId);
    if (waiter === undefined) throw new AppError(ErrorCode.STALE_TARGET, '结果等待器不存在');
    const workspace = task.workspaceId === undefined ? this.#store.workspaces.byTask(task.id) : this.#store.workspaces.get(task.workspaceId);
    const execution = this.get(task.id)!;
    const role = this.#store.plans.get(execution.planRevisionId)?.graph.nodes.find((node) => node.id === input.nodeId)?.roleSnapshot;
    if ((input.artifacts?.length ?? 0) > 0 && (!workspace?.displayRoot || !role)) throw new AppError(ErrorCode.WORKSPACE_NOT_READY, '产物工作区或职业权限不可用');
    if (input.artifacts !== undefined && !Array.isArray(input.artifacts)) throw new AppError(ErrorCode.VALIDATION_FAILED, 'artifacts必须是数组');
    const artifacts = input.artifacts === undefined || input.artifacts.length === 0 ? [] : captureArtifacts(this.#store.dataDir, workspace!.displayRoot!, attempt.id, input.artifacts, (path) => roleFileAllowed(role!, path, 'read'));
    const result: AttemptResult = {
      resultRevision: createId('res'),
      summary: input.summary,
      payload: input.payload,
      artifacts,
      verification: input.verification,
      errors: [],
      warnings: [],
    };
    if (!this.#store.executions.saveSubmittedResult(input.attemptId, result)) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '该尝试已经提交结果，不能覆盖');

    waiter.resolve(result);
    this.#resultWaiters.delete(input.attemptId);
    return { ok: true };
  }

  readTool(taskId: string, nodeId: string, attemptId: string, callId: string, part: 'input' | 'output' | 'error', cursor?: string): import('@agent-workflow/shared').ToolCallReadResponse {
    this.#requireTask(taskId);
    const attempt = boundAttempt(this.#store, taskId, attemptId, nodeId);
    if (attempt.readability.tools === 'forbidden' || attempt.readability.output === 'forbidden') throw new AppError(ErrorCode.FORBIDDEN, '你没有查看此调用完整参数的权限');
    const record = this.#store.executions.readToolRecord(attemptId, callId);
    if (!record) throw new AppError(ErrorCode.NOT_FOUND, '工具调用不存在');
    if (!record.evidence) throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, '这条历史记录没有保留工具完整参数');
    if (!['input', 'output', 'error'].includes(part)) throw new AppError(ErrorCode.VALIDATION_FAILED, '读取部分无效');
    let offset = 0;
    if (cursor !== undefined) {
      const [revision, value] = cursor.split('|');
      offset = Number(value);
      if (revision !== record.revision) throw new AppError(ErrorCode.STALE_TARGET, '工具调用内容已更新，请重新读取');
      if (!Number.isSafeInteger(offset) || offset < 0) throw new AppError(ErrorCode.VALIDATION_FAILED, '读取位置无效');
    }
    const { input, output, error, ...evidence } = record.evidence;
    const text = { input, output, error }[part];
    const end = Math.min(offset + 16384, text?.length ?? 0);
    return { taskId, nodeId, attemptId, callId, revision: record.revision, status: record.reference.status, evidence, part, content: text === undefined ? null : text.slice(offset, end), ...(text !== undefined && end < text.length ? { nextCursor: `${record.revision}|${end}` } : {}) };
  }

  readArtifact(taskId: string, attemptId: string, artifactId: string, revision: string, sha256: string) {
    this.#requireTask(taskId);
    const attempt = boundAttempt(this.#store, taskId, attemptId);
    if (attempt.readability.result === 'forbidden') throw new AppError(ErrorCode.FORBIDDEN, '你没有查看这次尝试产物的权限');
    const artifact = attempt.result?.artifacts.find((item) => item.id === artifactId && item.sourceAttemptId === attemptId);
    if (!artifact) throw new AppError(ErrorCode.NOT_FOUND, '产物不存在');
    if (artifact.revision !== revision || artifact.sha256 !== sha256) throw new AppError(ErrorCode.STALE_TARGET, '产物版本已经失效，请重新读取');
    return { artifact, bytes: readArtifactBytes(this.#store.dataDir, artifact) };
  }

  async #advance(executionId: string): Promise<void> {
    if (this.#loops.has(executionId)) return;
    const loop = Symbol(executionId);
    this.#loops.set(executionId, loop);
    const active = new Map<string, Promise<void>>();
    try {
      for (;;) {
        if (this.#closed || this.#loops.get(executionId) !== loop) return;
        const execution = this.#store.executions.get(executionId);
        if (execution === undefined) return;
        if (execution.status !== 'running') {
          if (active.size === 0) return;
          await Promise.race(active.values());
          continue;
        }
        const task = this.#requireTask(execution.taskId);
        const plan = this.#store.plans.get(execution.planRevisionId);
        if (plan === undefined) {
          this.#store.executions.update(executionId, { status: 'failed', notice: { kind: 'failed', message: '计划不存在' } });
          return;
        }
        const policy = executionPolicy(this.#store, executionId, this.#context.settings().execution);
        const taskDeadline = policy.timeoutEnabled && execution.startedAt !== undefined ? Date.parse(execution.startedAt) + policy.taskTimeoutMinutes * 60000 : undefined;
        if (taskDeadline !== undefined && Date.now() >= taskDeadline) {
          await this.cancel(task.id, { requestKey: `req_deadline_${execution.id}`, confirm: true }, '任务业务总时限已用完，已确认停止；请创建恢复任务');
          return;
        }
        if (execution.autoAdvance) this.#recomputeReady(execution, plan);
        const current = this.#store.executions.get(executionId)!;
        const retryScope = this.#store.settings.getJson<string[] | null>(`execution.retry-scope.${executionId}`);
        const inScope = (node: { nodeId: string }) => retryScope == null || retryScope.includes(node.nodeId);
        const failed = current.nodes.some((node) => inScope(node) && (node.status === NodeStatus.FAILED || node.status === NodeStatus.UNKNOWN));
        const sessionErrorsExceeded = (this.#store.settings.getJson<number>(`execution.session-errors.${executionId}`) ?? 0) >= policy.sessionErrorThreshold;
        let waitingUntil: number | undefined;
        const hasUnknown = current.nodes.some((node) => node.status === NodeStatus.UNKNOWN);
        if (!sessionErrorsExceeded && !hasUnknown && !(failed && policy.pauseAfterFailure)) {
          for (const candidate of current.nodes.filter((node) => node.status === NodeStatus.READY && inScope(node))) {
            if (this.#store.executions.get(executionId)!.status !== 'running') break;
            if (policy.pauseAfterFailure && this.#store.executions.get(executionId)!.nodes.some((node) => inScope(node) && (node.status === NodeStatus.FAILED || node.status === NodeStatus.UNKNOWN))) break;
            if (active.size >= policy.maxConcurrentNodes) break;
            const retry = this.#store.settings.getJson<{ readyAt: number }>(`execution.retry-ready-at.${executionId}.${candidate.nodeId}`);
            if (retry !== undefined && retry.readyAt > Date.now()) { waitingUntil = Math.min(waitingUntil ?? retry.readyAt, retry.readyAt); continue; }
            if (this.#store.executions.listAttempts(executionId).length >= policy.maxTaskAttempts) {
              this.#store.executions.updateNode(executionId, candidate.nodeId, { status: NodeStatus.FAILED, error: { code: ErrorCode.MODEL_BUDGET_EXCEEDED, message: '任务总尝试次数已用完，含首次；请创建恢复任务' } });
              continue;
            }
            const definition = plan.graph.nodes.find((node) => node.id === candidate.nodeId);
            if (definition === undefined) {
              this.#store.executions.updateNode(executionId, candidate.nodeId, { status: NodeStatus.FAILED, error: { code: 'NODE_NOT_EXECUTABLE', message: '步骤不在计划中' } });
              continue;
            }
            if (candidate.attemptCount >= policy.maxAttempts) {
              this.#store.executions.updateNode(executionId, candidate.nodeId, { status: NodeStatus.FAILED, error: { code: ErrorCode.MODEL_BUDGET_EXCEEDED, message: '已达到单节点总尝试上限，含首次执行' } });
              continue;
            }
            const activeDefinitions = [...active.keys()].map((id) => plan.graph.nodes.find((node) => node.id === id)!);
            if (active.size > 0 && (!canShareWorkspace(definition) || activeDefinitions.some((node) => !canShareWorkspace(node)))) continue;
            const designKey = `execution.design-started.${executionId}.${definition.groupId}`;
            const designStartedAt = this.#store.settings.getJson<string>(designKey);
            if (policy.timeoutEnabled && definition.kind === 'design' && designStartedAt !== undefined && Date.now() >= Date.parse(designStartedAt) + policy.designTimeoutMinutes * 60000) {
              this.#store.executions.updateNode(executionId, candidate.nodeId, { status: NodeStatus.FAILED, error: { code: ErrorCode.MODEL_BUDGET_EXCEEDED, message: '设计阶段业务时限已用完；请创建恢复任务' } });
              continue;
            }
            if (definition.kind === 'design' && designStartedAt === undefined) this.#store.settings.putJson(designKey, nowIso());
            this.#store.settings.removeJson(`execution.retry-ready-at.${executionId}.${candidate.nodeId}`);
            const run = this.#runNode(task, current, plan, definition).finally(() => { active.delete(candidate.nodeId); });
            active.set(candidate.nodeId, run);
          }
        }
        if (active.size > 0 || waitingUntil !== undefined) {
          if (active.size === 0 && waitingUntil !== undefined) this.#store.executions.update(executionId, { notice: { kind: 'paused', message: `已登记重试，按配置等待至 ${new Date(waitingUntil).toISOString()}；可暂停或停止` } });
          const wakeAt = Math.min(waitingUntil ?? Infinity, taskDeadline ?? Infinity);
          let wakeTimer: NodeJS.Timeout | undefined;
          const waits: Promise<unknown>[] = [...active.values()];
          let wake!: () => void;
          waits.push(new Promise<void>((resolve) => { wake = resolve; }));
          const listeners = this.#wakes.get(executionId) ?? new Set<() => void>();
          listeners.add(wake);
          this.#wakes.set(executionId, listeners);
          if (Number.isFinite(wakeAt)) waits.push(new Promise<void>((resolve) => { wakeTimer = setTimeout(resolve, Math.max(1, wakeAt - Date.now())); }));
          try { await Promise.race(waits); } finally { listeners.delete(wake); if (listeners.size === 0) this.#wakes.delete(executionId); if (wakeTimer !== undefined) clearTimeout(wakeTimer); }
          continue;
        }
        this.#settleIdleExecution(task, this.#store.executions.get(executionId)!, plan);
        return;
      }
    } finally {
      if (this.#loops.get(executionId) === loop) this.#loops.delete(executionId);
    }
  }

  /**
   * No READY node is left. Complete when every node is terminal, fail when a
   * node failed, otherwise (manual advance mode) park the execution in the
   * durable "waiting for advance" state. The pause is composed from the two
   * legal edges RUNNING -> PAUSING -> PAUSED so it matches machines.ts.
   */
  #settleIdleExecution(task: Task, execution: ExecutionView, plan: PlanRevision): void {
    const unknown = execution.nodes.filter((node) => node.status === NodeStatus.UNKNOWN);
    if (unknown.length > 0) {
      this.#store.executions.update(execution.id, { status: 'pausing' });
      this.#store.executions.update(execution.id, { status: 'unknown', notice: { kind: 'unknown', message: `${unknown.length} 个步骤结果未知；核对原请求和会话后再继续` } });
      this.#store.tasks.update(task.id, { attention: TaskAttention.UNKNOWN });
      this.#store.events.publish('execution.changed', { taskId: task.id, executionId: execution.id, status: 'unknown', revision: 1 });
      return;
    }
    const failed = execution.nodes.filter((node) => node.status === NodeStatus.FAILED);
    if (failed.length > 0) {
      const policy = executionPolicy(this.#store, execution.id, this.#context.settings().execution);
      const status = policy.pauseAfterFailure ? 'paused' : 'failed';
      if (status === 'paused') this.#store.executions.update(execution.id, { status: 'pausing' });
      this.#store.executions.update(execution.id, { status, endedAt: status === 'failed' ? nowIso() : undefined, notice: { kind: 'failed', message: `${failed.length} 个步骤失败；${policy.pauseAfterFailure ? '已暂停新增领取，等待处理' : '独立步骤已执行，失败分支待处理'}` } });
      this.#store.tasks.update(task.id, { attention: TaskAttention.FAILED });
      this.#store.events.publish('execution.changed', { taskId: task.id, executionId: execution.id, status, revision: 1 });
      return;
    }
    // W0-4b: executed nodes with acceptance criteria only count as done after the
    // human verdict. Pending/rejected verdicts park the execution instead of
    // completing it or silently claiming more work.
    const gate = executionAcceptanceGate(this.#store, execution, plan);
    if (!gate.satisfied) {
      this.#parkForAcceptance(task, execution, gate);
      return;
    }
    const unresolved = execution.nodes.filter((node) => node.status !== NodeStatus.SUCCEEDED && node.status !== NodeStatus.SKIPPED && node.status !== NodeStatus.CANCELLED);
    if (unresolved.length === 0) {
      this.#completeExecution(task, execution, plan);
      return;
    }
    if (execution.autoAdvance) return;
    assertTransition(executionMachine, execution.status, 'pausing');
    this.#store.executions.update(execution.id, { status: 'pausing' });
    this.#store.executions.update(execution.id, { status: 'paused', pause: { settledAt: nowIso() }, notice: { kind: 'paused', message: '自动推进已关闭，等待推进' } });
    this.#store.events.publish('execution.changed', { taskId: task.id, executionId: execution.id, status: 'paused', revision: 1 });
  }

  /**
   * Park an execution whose executed nodes still need a human verdict. The pause
   * is composed from the two legal RUNNING edges to PAUSED (machines.ts); the
   * notice and the `acceptance` overlay expose which nodes need the verdict.
   */
  #parkForAcceptance(task: Task, execution: ExecutionView, gate: ExecutionAcceptanceGate): void {
    const parts: string[] = [];
    if (gate.rejected.length > 0) parts.push(`${String(gate.rejected.length)} 个步骤已被退回修改`);
    if (gate.pending.length > 0) parts.push(`${String(gate.pending.length)} 个已执行步骤待人工验收`);
    const message = `${parts.join('，')}；在节点面板验收通过或按原配置重试后再继续/结束执行。`;
    const current = this.#store.executions.get(execution.id) ?? execution;
    if (current.status === 'running') {
      assertTransition(executionMachine, current.status, 'pausing');
      this.#store.executions.update(execution.id, { status: 'pausing' });
    }
    const refreshed = this.#store.executions.get(execution.id) ?? current;
    const status = refreshed.status === 'pausing' ? 'paused' : refreshed.status;
    if (status === 'paused') {
      this.#store.executions.update(execution.id, { status: 'paused', pause: { settledAt: nowIso() }, notice: { kind: 'paused', message } });
    } else {
      this.#store.executions.update(execution.id, { notice: { kind: 'paused', message } });
    }
    this.#store.tasks.update(task.id, { attention: TaskAttention.WAITING_USER });
    this.#store.events.publish('execution.changed', { taskId: task.id, executionId: execution.id, status, revision: 1 });
  }

  /** A predecessor counts as done for releasing successors only when its human verdict (if required) is in. */
  #predecessorDone(execution: ExecutionView, plan: PlanRevision, statuses: ReadonlyMap<string, NodeStatusValue>, sourceId: string): boolean {
    const source = statuses.get(sourceId);
    if (source === NodeStatus.SKIPPED) return true;
    if (source !== NodeStatus.SUCCEEDED) return false;
    const planNode = plan.graph.nodes.find((node) => node.id === sourceId);
    if (planNode === undefined || !planNodeRequiresAcceptance(planNode)) return true;
    return nodeAcceptanceState(this.#store, execution.id, sourceId) === NodeManualAcceptanceState.ACCEPTED;
  }

  /**
   * Release the nodes an `advance` call is allowed to start. A node is
   * advanceable when its own status is pending/ready and every incoming edge
   * comes from a succeeded/skipped predecessor whose human verdict (when the
   * plan declares acceptance criteria) is accepted. Nodes that already ran or
   * are running are skipped; unmet joins and acceptance-blocked predecessors are
   * reported so the HTTP layer can explain the disabled action.
   */
  #releaseAdvanceable(execution: ExecutionView, plan: PlanRevision, nodeId?: string): AdvanceRelease {
    const statuses = new Map(execution.nodes.map((node) => [node.nodeId, node.status]));
    const required = new Set(plan.graph.nodes.filter(planNodeRequiresAcceptance).map((node) => node.id));
    const candidateIds = nodeId === undefined
      ? plan.graph.nodes.map((node) => node.id)
      : plan.graph.edges.filter((edge) => edge.from === nodeId).map((edge) => edge.to);
    const unique = [...new Set(candidateIds)];
    const ready: string[] = [];
    const waitingFor: { nodeId: string; prerequisites: string[] }[] = [];
    const awaitingAcceptance = new Set<string>();
    for (const id of unique) {
      const node = execution.nodes.find((item) => item.nodeId === id);
      if (node === undefined) continue;
      if (node.status !== NodeStatus.PENDING && node.status !== NodeStatus.READY) continue;
      const unmet: string[] = [];
      for (const edge of plan.graph.edges) {
        if (edge.to !== id) continue;
        if (this.#predecessorDone(execution, plan, statuses, edge.from)) continue;
        unmet.push(edge.from);
        if (required.has(edge.from) && statuses.get(edge.from) === NodeStatus.SUCCEEDED) awaitingAcceptance.add(edge.from);
      }
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
    const reason = awaitingAcceptance.size > 0
      ? `${String(awaitingAcceptance.size)} 个上游步骤待人工验收；先在节点面板验收通过再推进`
      : nodeId === undefined
        ? '没有可以推进的步骤：正在等待执行中或待验收的步骤'
        : unique.length === 0
          ? '该步骤没有直接后继'
          : ready.length === 0 && waitingFor.length > 0
            ? '直接后继仍在等待未验收的前置步骤（并行汇合）'
            : '直接后继已开始或已完成，没有可推进的步骤';
    return { ready, waitingFor, awaitingAcceptance: [...awaitingAcceptance], reason };
  }

  #recomputeReady(execution: ExecutionView, plan: PlanRevision): void {
    const statuses = new Map(execution.nodes.map((node) => [node.nodeId, node.status]));
    for (const node of execution.nodes) {
      if (node.status !== NodeStatus.PENDING) continue;
      const incoming = plan.graph.edges.filter((edge) => edge.to === node.nodeId);
      const ready = incoming.every((edge) => this.#predecessorDone(execution, plan, statuses, edge.from));
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
    if (workspace === undefined || workspace.state !== 'ready' || workspace.displayRoot === undefined) {
      this.#store.executions.updateNode(execution.id, node.id, { status: 'failed', error: { code: 'WORKSPACE_NOT_READY', message: '工作区不可用' } });
      return;
    }
    const attempt = this.#store.executions.createAttempt({ executionId: execution.id, nodeId: node.id, ordinal: 1, definition: { planRevisionId: plan.id, node } });
    this.#store.executions.updateNode(execution.id, node.id, {
      status: 'running',
      currentAttemptId: attempt.id,
      attemptCount: (execution.nodes.find((item) => item.nodeId === node.id)?.attemptCount ?? 0) + 1,
      startedAt: nowIso(),
    });
    const runningView = this.#store.executions.get(execution.id)!;
    this.#store.executions.update(execution.id, { progress: { done: runningView.nodes.filter((item) => item.status === NodeStatus.SUCCEEDED).length, failed: runningView.nodes.filter((item) => item.status === NodeStatus.FAILED).length, running: runningView.nodes.filter((item) => item.status === NodeStatus.RUNNING).length, total: runningView.nodes.length } });
    this.#store.events.publish('execution.changed', { taskId: task.id, executionId: execution.id, status: 'running', revision: 1 });

    const isCurrent = () => !this.#closed && this.#store.executions.get(execution.id)?.nodes.find((item) => item.nodeId === node.id)?.currentAttemptId === attempt.id
      && this.#store.executions.getAttempt(attempt.id)?.status === NodeStatus.RUNNING;
    const stopped = () => this.#stops.get(execution.id)?.attemptIds.includes(attempt.id) === true;
    if (task.fixedTemplate?.snapshot !== undefined && (node.snapshotStage === 'report' || node.snapshotStage === 'verification' && snapshotExpectedUnitIds(task.fixedTemplate.snapshot, node, snapshotEvidenceState(this.#store, task.id)).length === 0)) {
      const report = snapshotReport(this.#store, task.id);
      const skipped = node.snapshotStage === 'verification';
      const passed = skipped || report.pendingUnits === 0 && report.unverifiedUnits === 0;
      if (!skipped && passed) this.#store.settings.putJson(`snapshot.report.final.${task.id}`, report);
      this.#finishNode(execution.id, node.id, attempt.id, skipped ? NodeStatus.SKIPPED : passed ? NodeStatus.SUCCEEDED : NodeStatus.FAILED, { resultRevision: createId('res'), summary: skipped ? '上游没有候选问题，无需调用独立复核模型' : `服务汇总已分析 ${report.analyzedUnits} 个真实源码单元，未分析 ${report.pendingUnits}，待复核 ${report.unverifiedUnits}`, payload: { generatedBy: 'service', reportId: report.reportId, contentMarkdown: report.contentMarkdown }, artifacts: [], verification: { state: passed ? 'passed' : 'failed', summary: '按冻结源码单元与已提交证据校验覆盖范围' }, errors: [], warnings: [] });
      return;
    }
    const resultPromise = new Promise<AttemptResult>((resolve) => this.#resultWaiters.set(attempt.id, { resolve }));
    const role = node.roleSnapshot;
    let model: ModelProfile;
    try {
      if (role === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '历史计划缺少职业修订快照，请重新确认计划后执行');
      model = roleModel(role, settings.models);
    } catch (error) {
      this.#finishNode(execution.id, node.id, attempt.id, NodeStatus.FAILED, undefined, { code: ErrorCode.VALIDATION_FAILED, message: error instanceof Error ? error.message : String(error) });
      return;
    }
    const prompt = this.#executionPrompt(task, plan, node, attempt.id, workspace.displayRoot);
    let outputSeq = 0;
    let textBuffer = '';
    let textBlock = '';
    let flushTimer: NodeJS.Timeout | undefined;
    const appendFragment = (category: 'model_text' | 'tool_activity', text: string, blockId: string | undefined, extra: { callId?: string; status?: string; tool?: string; evidence?: import('@agent-workflow/shared').ToolCallEvidence } = {}) => {
      if (!isCurrent() || stopped()) return;
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
          ...(category === 'tool_activity' ? { toolCallRef: { callId: extra.callId ?? '', status: extra.status ?? '', source: 'opencode' as const }, toolEvidence: extra.evidence } : {}),
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
        permission: canShareWorkspace(node) ? 'read_only' : 'workspace_write',
        ...(role === undefined ? {} : { rolePolicy: role }),
        onSessionId: (id) => {
          if (!isCurrent()) throw new AppError(ErrorCode.STALE_TARGET, '旧执行尝试不能派发会话');
          this.#store.settings.putJson(`execution.session.${attempt.id}`, { sessionId: id });
          const stop = this.#stops.get(execution.id);
          if (stop?.attemptIds.includes(attempt.id)) {
            // The adapter invokes this before sending the prompt. Throwing here
            // prevents a late createSession response from dispatching work.
            stop.confirmedAttempts.add(attempt.id);
            this.#settleStop(execution.id, stop);
            throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '执行在派发前已停止');
          }
          const sessions = this.#activeSessions.get(execution.id) ?? new Map<string, string>();
          sessions.set(attempt.id, id);
          this.#activeSessions.set(execution.id, sessions);
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
            appendFragment('tool_activity', `${part.tool ?? '工具'} · ${status}`, undefined, { callId: part.callID ?? '', status: status === 'success' ? 'completed' : status === 'called' || status === 'progress' ? 'running' : 'failed', tool: part.tool, evidence: toolEvidence(part) });
          },
          onPermission: (permission) => {
            if (!isCurrent() || stopped()) return 'reject';
            return 'reject'; // Frozen roles use guarded MCP routes exclusively.
          },
        },
        timeoutMs: executionTimeoutMs(executionPolicy(this.#store, execution.id, settings.execution), node, execution.startedAt, this.#store.settings.getJson<string>(`execution.design-started.${execution.id}.${node.groupId}`)),

        abortOnToolCall: ['result.submit', 'result-submit', 'result_submit'],
      });
      if (isCurrent() && !stopped()) {
        const sessions = this.#activeSessions.get(execution.id) ?? new Map<string, string>();
        sessions.set(attempt.id, outcome.sessionId);
        this.#activeSessions.set(execution.id, sessions);
      }
    } catch (error) {
      flushText();
      if (!isCurrent() || stopped()) return;
      const sessionKnown = this.#activeSessions.get(execution.id)?.has(attempt.id) === true;
      if (!sessionKnown) this.#activeSessions.get(execution.id)?.delete(attempt.id);
      const message = error instanceof Error ? error.message : '执行失败';
      this.#finishNode(execution.id, node.id, attempt.id, sessionKnown ? NodeStatus.UNKNOWN : NodeStatus.FAILED, undefined, { code: 'OPENCODE_NOT_READY', message });
      return;
    }

    flushText();
    if (this.#closed) return;
    const stopAfterRun = this.#stops.get(execution.id);
    if (stopAfterRun?.attemptIds.includes(attempt.id)) {
      if (outcome.outcome.idle || outcome.outcome.stoppedConfirmed === true) {
        stopAfterRun.confirmedAttempts.add(attempt.id);
        this.#settleStop(execution.id, stopAfterRun);
      }
      return;
    }
    if (!isCurrent()) return;
    this.#activeSessions.get(execution.id)?.delete(attempt.id);
    if (outcome.outcome.idle || outcome.outcome.stoppedConfirmed === true) this.#idleAttempts.add(attempt.id);
    const attemptUsage = usageFromMessages(outcome.outcome.messages);
    let resultTimer: NodeJS.Timeout | undefined;
    const settled = await Promise.race([
      resultPromise,
      new Promise<'timeout'>((resolve) => { resultTimer = setTimeout(() => resolve('timeout'), 2500); }),
    ]);
    if (resultTimer !== undefined) clearTimeout(resultTimer);
    if (!outcome.outcome.idle && outcome.outcome.stoppedConfirmed !== true) {
      this.#finishNode(execution.id, node.id, attempt.id, NodeStatus.UNKNOWN, settled === 'timeout' ? undefined : settled, { code: outcome.outcome.timedOut ? 'MODEL_BUDGET_EXCEEDED' : 'OPENCODE_NOT_READY', message: outcome.outcome.timedOut ? '尝试/设计/任务时限到达，但会话停稳未确认；只核对原操作，不重投' : '会话连接结束但远端停稳未确认；只核对原操作，不重投' }, attemptUsage);
      return;
    }
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
    if (this.#closed) return;
    const current = this.#store.executions.get(executionId)?.nodes.find((node) => node.nodeId === nodeId);
    if (current?.currentAttemptId !== attemptId || this.#store.executions.getAttempt(attemptId)?.status !== NodeStatus.RUNNING || this.#stops.get(executionId)?.attemptIds.includes(attemptId) === true) return;
    if (status === NodeStatus.FAILED) this.#recordSessionError(executionId, attemptId, error);
    this.#idleAttempts.delete(attemptId);
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

  #completeExecution(task: Task, execution: ExecutionView, plan: PlanRevision): void {
    // Defensive: completion is gated by the human verdict on nodes whose plan
    // declares acceptance criteria (callers usually settle earlier).
    const gate = executionAcceptanceGate(this.#store, execution, plan);
    if (!gate.satisfied) {
      this.#parkForAcceptance(task, execution, gate);
      return;
    }
    const existing = task.deliveryId === undefined ? this.#store.deliveries.byTask(task.id) : this.#store.deliveries.get(task.deliveryId);
    const delivery: TaskDelivery =
      existing ??
      this.#store.deliveries.create({
        taskId: task.id,
        workspaceId: task.workspaceId,
        eligibility: { allowed: true },
      });
    this.#store.executions.update(execution.id, { status: 'completed', endedAt: nowIso(), notice: { kind: 'paused', message: '全部步骤已完成并验收通过，等待交付' } });
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
    const snapshot = task.fixedTemplate?.snapshot;
    const evidence = snapshot === undefined ? undefined : snapshotEvidenceState(this.#store, task.id);
    const unitIds = snapshot === undefined || evidence === undefined ? [] : snapshotExpectedUnitIds(snapshot, node, evidence);
    const snapshotPrompt = snapshot === undefined ? '' : `\n# 固定源码审查\n目标 ${snapshot.targetSha}；${snapshot.mode}/${snapshot.depth}；当前阶段 ${node.snapshotStage}。只读分析，禁止修改任何源码。\n逐个使用 workspace.file.read 读取下列冻结blob；工具返回的是固定版本而非当前工作树。\n${JSON.stringify(snapshot.units.filter((unit) => unitIds.includes(unit.id)))}\n${node.snapshotStage === 'verification' ? `独立检查以下上游候选，逐项给出 confirmed/rejected 与 rationale，不能遗漏候选：${JSON.stringify(unitIds.map((id) => evidence?.analyzed.get(id)))}` : ''}\n结果 payload 必须包含 snapshotUnits: [{unitId, blobSha, summary, findings:[{id,title,detail,line,severity:'high'|'medium'|'low'${node.snapshotStage === 'verification' ? ",verdict:'confirmed'|'rejected',rationale" : ''}}]}]；每个分配单元都必须出现。没有问题的单元 findings 为[]。不得给未读取的单元生成证据。\n`;
    return `${snapshotPrompt}\n# 任务
${task.title}

# 项目与工作区
项目：${task.projectId}
工作区：${worktree}（独立 worktree；不要操作其他目录）
任务阶段：执行中

# 需求原文
${task.requirement.text}
${templateScopePrompt(task.fixedTemplate?.scope)}

# 已冻结职业
${node.roleSnapshot === undefined ? "历史计划未记录职业快照" : `${node.roleSnapshot.name} @ ${node.roleSnapshot.revision}\n${node.roleSnapshot.instructions ?? node.roleSnapshot.purpose}\n职责：${node.roleSnapshot.responsibilities.join("；")}`}

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

${projectDocumentInstructions(task.fixedTemplate?.scope?.outputDirectory ? { ...this.#store.projects.get(task.projectId)?.settings, docPaths: [task.fixedTemplate.scope.outputDirectory] } : this.#store.projects.get(task.projectId)?.settings)}

# 执行要求
1. 只在当前工作区内修改文件；使用 workspace.file.read/list/write 工具；可以用 workspace.exec 运行允许的测试命令。
2. 不要执行 git commit/push/merge，不要联网，不要修改工作区外文件。
3. 完成后必须调用 workflow.result.submit 提交结构化结果：
   { taskId: "${task.id}", nodeId: "${node.id}", attemptId: "${attemptId}", summary: "做了什么、结果如何", verification: { state: "passed" | "failed" | "not_configured", summary: "..." } }
如有文件产物，提交 artifacts: [{ path: "工作区内相对文件路径" }]；只提交已写完且职业获准读取的文件，每个最多8 MiB、合计最多32个。
4. 如果无法完成，也调用 workflow.result.submit，在 summary 中说明失败原因，verification.state 设为 "failed"。
5. 不要声称未实际验证的测试结果。`;
  }

  #viewResponse(taskId: string): ExecutionResponse {
    const execution = this.get(taskId);
    if (execution === undefined) throw new AppError(ErrorCode.NOT_FOUND, '执行尚未创建');
    const task = this.#requireTask(taskId);
    const workspace = task.workspaceId === undefined ? this.#store.workspaces.byTask(taskId) : this.#store.workspaces.get(task.workspaceId);
    return { execution, workspace, actions: {} };
  }

  /** Read-only recovery drafts may be read, never executed. */
  #assertWritable(taskId: string, action: string): Task {
    if (this.#closed) throw new AppError(ErrorCode.OPENCODE_NOT_READY, '服务正在关闭，不能开始新的执行操作');
    const task = this.#requireTask(taskId);
    if (task.readOnly === true) throw readOnlyRecoveryError(action);
    if (this.#store.settings.getJson(`task.recovery-source-lock.${taskId}`) !== undefined) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '原任务正在生成恢复快照，暂不能开始写入');
    return task;
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
