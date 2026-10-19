import type {
  AttemptResult,
  CommandResponse,
  ExecutionCommandRequest,
  ExecutionResponse,
  ExecutionView,
  ModelProfile,
  NodeStatusValue,
  PlanNode,
  PlanRevision,
  Task,
  TaskDelivery,
} from '@agent-workflow/shared';
import { AppError, ErrorCode, NodeStatus, TaskAttention, TaskStage, createId, nowIso } from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';
import type { EngineContext } from './actions.ts';
import type { CommandService } from './operations.ts';
import type { OpenCodePort } from './ports.ts';

interface ResultWaiter {
  resolve(result: AttemptResult): void;
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
        this.#recomputeReady(execution, plan);
        const current = this.#store.executions.get(executionId)!;
        const next = current.nodes.find((node) => node.status === NodeStatus.READY);
        if (next === undefined) {
          const failed = current.nodes.filter((node) => node.status === NodeStatus.FAILED);
          const unfinished = current.nodes.filter((node) => node.status !== NodeStatus.SUCCEEDED && node.status !== NodeStatus.SKIPPED && node.status !== NodeStatus.CANCELLED);
          if (unfinished.length === 0) {
            this.#completeExecution(task, current);
          } else if (failed.length > 0) {
            this.#store.executions.update(executionId, { status: 'failed', endedAt: nowIso(), notice: { kind: 'failed', message: `${failed.length} 个步骤失败` } });
            this.#store.tasks.update(task.id, { attention: TaskAttention.FAILED });
            this.#store.events.publish('execution.changed', { taskId: task.id, executionId, status: 'failed', revision: 1 });
          }
          return;
        }
        const planNode = plan.graph.nodes.find((node) => node.id === next.nodeId);
        if (planNode === undefined) {
          this.#store.executions.updateNode(executionId, next.nodeId, { status: 'failed', error: { code: 'NODE_NOT_EXECUTABLE', message: '步骤不在计划中' } });
          continue;
        }
        await this.#runNode(task, execution, plan, planNode);
        const after = this.#store.executions.get(executionId);
        if (after === undefined || after.status !== 'running' || !after.autoAdvance) {
          if (after !== undefined && after.autoAdvance === false && after.status === 'running') {
            this.#store.executions.update(executionId, { status: 'paused', pause: { settledAt: nowIso() }, notice: { kind: 'paused', message: '自动推进已关闭，等待继续' } });
            this.#store.events.publish('execution.changed', { taskId: task.id, executionId, status: 'paused', revision: 1 });
          }
          return;
        }
      }
    } finally {
      this.#loops.delete(executionId);
    }
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
      if (ready && incoming.length > 0) {
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
    const settled = await Promise.race([
      resultPromise,
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 2500)),
    ]);
    if (settled === 'timeout') {
      const error = outcome.outcome.error ?? (outcome.outcome.timedOut ? '步骤执行超时' : '模型未通过 workflow.result.submit 提交结果');
      this.#finishNode(execution.id, node.id, attempt.id, outcome.outcome.timedOut ? NodeStatus.UNKNOWN : NodeStatus.FAILED, undefined, {
        code: outcome.outcome.timedOut ? 'MODEL_BUDGET_EXCEEDED' : 'NODE_NOT_EXECUTABLE',
        message: error,
      });
      return;
    }
    const verificationFailed = settled.verification?.state === 'failed';
    this.#finishNode(execution.id, node.id, attempt.id, verificationFailed ? NodeStatus.FAILED : NodeStatus.SUCCEEDED, settled, verificationFailed ? { code: 'VALIDATION_FAILED', message: '验证未通过' } : undefined);
  }

  #finishNode(executionId: string, nodeId: string, attemptId: string, status: NodeStatusValue, result?: AttemptResult, error?: { code: string; message: string }): void {
    this.#store.executions.finishAttempt(attemptId, status, result, error?.message);
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
