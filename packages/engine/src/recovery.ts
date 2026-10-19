import { readNodeAcceptance } from './actions.ts';
import { createRecoveryWorkspace } from './recovery-workspace.ts';
import type { GitPort } from './ports.ts';
import { executionPolicy, executionSettingsKey } from './execution-policy.ts';
import {
  AppError,
  DEFAULT_SETTINGS,
  DELIVERY_PROJECTION_LABEL,
  ErrorCode,
  EXECUTION_STATUS_LABEL,
  NODE_STATUS_LABEL,
  PLANNING_STAGE_LABEL,
  PLANNING_STATUS_LABEL,
  RECOVERY_MODES,
  TASK_ATTENTION_LABEL,
  TASK_LIFECYCLE_LABEL,
  TASK_STAGE_LABEL,
  WORKSPACE_STATE_LABEL,
  createId,
  isOperationKind,
  nowIso,
  type Attempt,
  type ExecutionSettings,
  type PlanGraph,
  type CommandResponse,
  type ExecutionNodeState,
  type ExecutionView,
  type PlanningRound,
  type RecoveryCreateRequest,
  type RecoveryCreateResponse,
  type RecoveryHistoryResponse,
  type RecoveryModeValue,
  type RecoveryRecord,
  type RequirementInput,
  type Task,
  type TaskAcceptance,
  type TaskDelivery,
  type WorkspaceStateValue,
} from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';
import type { CommandService } from './operations.ts';

const RECOVERY_KEY_PREFIX = 'task.recovery.';
const MAX_NOTE = 2_000;
const MAX_EVIDENCE = 1_800;

const FAILURE_CONTEXT_TITLE = '恢复上下文（从失败阶段恢复）';
const VERIFY_SCOPE_TITLE = '只读验证范围';

/**
 * Everything a recovery draft may inherit from its parent. The parent itself is
 * never mutated; this is a read-only snapshot used to write the derived
 * requirement only.
 */
interface RecoveryEvidence {
  readonly execution?: ExecutionView;
  readonly attempts: readonly Attempt[];
  readonly failedNodes: readonly ExecutionNodeState[];
  readonly planningRound?: PlanningRound;
  readonly delivery?: TaskDelivery;
  readonly acceptance?: TaskAcceptance;
  readonly workspaceState?: WorkspaceStateValue;
}

export interface RecoveryServiceOptions {
  readonly store: Store;
  readonly commands: CommandService;
  readonly git: GitPort;
}

/**
 * Creates a derived draft from a stopped/failed task. Recovery never mutates the
 * parent task, its execution evidence or its delivery records; the lineage is
 * stored next to the derived task and exposed as a read-only history.
 *
 * Writable recovery copies the frozen plan into an unconfirmed revision and,
 * when available, snapshots the parent's settled workspace to a new owned path.
 * from_failed_stage retains failed/downstream nodes and prior successful output
 * as read-only source context. all_stages restarts the full frozen graph from its
 * baseline. verify_only stays a read-only evidence draft with no executable path.
 */
export class RecoveryService {
  readonly #store: Store;
  readonly #commands: CommandService;
  readonly #git: GitPort;

  constructor(options: RecoveryServiceOptions) {
    this.#store = options.store;
    this.#commands = options.commands;
    this.#git = options.git;
  }

  async create(parentTaskId: string, input: RecoveryCreateRequest): Promise<CommandResponse<RecoveryCreateResponse>> {
    if (input === null || typeof input !== 'object') throw new AppError(ErrorCode.VALIDATION_FAILED, '恢复请求体不合法');
    if (typeof input.requestKey !== 'string' || input.requestKey.length < 8) throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 requestKey');
    if (input.confirmCreate !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '需要显式确认创建恢复草稿');
    if (!RECOVERY_MODES.includes(input.mode)) throw new AppError(ErrorCode.VALIDATION_FAILED, '恢复方式不合法');
    const note = typeof input.note === 'string' ? input.note.trim().slice(0, MAX_NOTE) : '';
    const parent = this.#requireTask(parentTaskId);
    this.#assertRecoverable(parent);
    const evidence = this.#evidence(parent);
    this.#assertModePreconditions(parent, input.mode, evidence);
    const otherUnknown = this.#store.operations.listPending().find((operation) => operation.operation === 'task.recovery.create' && operation.target.taskId === parentTaskId && operation.requestKey !== input.requestKey);
    if (otherUnknown !== undefined) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '上次恢复结果未明，请按原请求号核对后再创建', { details: { requestKey: otherUnknown.requestKey } });

    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'task.recovery.create',
      body: { parentTaskId, mode: input.mode, note },
      target: { taskId: parentTaskId },
    });
    if (replayed) {
      if (record.status === 'accepted') {
        throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '同一请求号的恢复草稿正在创建；请按 requestKey 核对回执');
      }
      const derivedTaskId = typeof record.outcome?.taskId === 'string' ? record.outcome.taskId : this.#store.tasks.list().find((task) => this.#store.settings.getJson<{ requestKey: string }>(`${RECOVERY_KEY_PREFIX}${task.id}`)?.requestKey === input.requestKey)?.id;
      const derived = derivedTaskId === undefined ? undefined : this.#store.tasks.get(derivedTaskId);
      if (derived === undefined) {
        throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '恢复回执存在但派生任务不可读；请按 requestKey 核对');
      }
      return { receipt: this.#commands.toReceipt(record), resource: { task: derived, recovery: this.#record(derived.id)! } };
    }

    this.#store.settings.putJson(`task.recovery-source-lock.${parent.id}`, { requestKey: input.requestKey });
    try {
      const created = this.#store.tasks.create({
        projectId: parent.projectId,
        title: derivedTitle(parent.title, input.mode),
        requirementText: parent.requirement.text,
        methodId: parent.methodId,
        methodRevision: parent.methodRevision,
        ...(parent.fixedTemplate === undefined ? {} : { fixedTemplate: parent.fixedTemplate }),
        // verify_only is enforced by actions.ts + plan/planning/execution guards.
        readOnly: input.mode === 'verify_only',
      });
      this.#store.settings.putJson(`${RECOVERY_KEY_PREFIX}${created.id}`, { taskId: created.id, parentTaskId, mode: input.mode, title: created.title, stage: created.stage, lifecycle: created.lifecycle, createdAt: nowIso(), requestKey: input.requestKey, ready: false });
      const parentPolicy = this.#store.settings.getJson<ExecutionSettings>(evidence.execution === undefined ? `task.execution-settings.${parent.id}` : executionSettingsKey(evidence.execution.id)) ?? this.#store.settings.getJson<ExecutionSettings>(`task.execution-settings.${parent.id}`);
      if (parentPolicy !== undefined) this.#store.settings.putJson(`task.execution-settings.${created.id}`, parentPolicy);
      const requirement = this.#derivedRequirement(parent, input.mode, evidence, created.requirement);
      const plan = input.mode === 'verify_only' ? undefined : this.#copyPlan(parent, created.id, input.mode, evidence);
      const workspace = plan === undefined ? undefined : await createRecoveryWorkspace(this.#store, this.#git, parent.id, created.id, input.mode as 'from_failed_stage' | 'all_stages');
      const attention = input.mode === 'verify_only' ? 'waiting_user' : 'none';
      const updated = this.#store.tasks.update(created.id, {
        ...(requirement === undefined ? {} : { requirement }),
        attention,
        ...(plan === undefined ? {} : { currentPlanRevisionId: plan.id, stage: 'confirming' as const }),
        ...(workspace === undefined ? {} : { workspaceId: workspace.id }),
      });
      const derived = updated ?? created;
      const recovery: RecoveryRecord = {
        taskId: derived.id,
        parentTaskId,
        mode: input.mode,
        title: derived.title,
        stage: derived.stage,
        lifecycle: derived.lifecycle,
        createdAt: nowIso(),
      };
      this.#store.settings.putJson(`${RECOVERY_KEY_PREFIX}${derived.id}`, {
        ...recovery,
        requestKey: input.requestKey,
        ready: true,
        note,
        parentRequirementRevision: parent.requirement.revision,
        // Writable-vs-read-only intent is part of the recorded mode evidence; the
        // HTTP contract only exposes `mode`, so this stays an audit record.
        writableSession: input.mode !== 'verify_only',
        copiedScope: plan === undefined ? copiedScope(input.mode) : 'frozen_plan+independent_workspace+prior_stage_context',
        sourcePlanRevisionId: parent.currentPlanRevisionId,
        copiedPlanRevisionId: plan?.id,
        sourceWorkspaceId: parent.workspaceId,
        copiedWorkspaceId: workspace?.id,
        parentStage: parent.stage,
        parentAttention: parent.attention,
        ...(requirement === undefined ? {} : { requirementRevision: requirement.revision }),
      });
      this.#store.events.publish('task.changed', { taskId: derived.id, projectId: derived.projectId, stage: derived.stage, revision: 1 });
      this.#commands.settle(input.requestKey, {
        taskId: derived.id,
        parentTaskId,
        mode: input.mode,
        writableSession: input.mode !== 'verify_only',
        requirementRevision: requirement?.revision ?? derived.requirement.revision,
      });
      return {
        receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!),
        resource: { task: derived, recovery },
      };
    } catch (error) {
      this.#commands.fail(input.requestKey, error instanceof Error ? error : new Error('创建恢复草稿失败'));
      throw error;
    } finally {
      this.#store.settings.removeJson(`task.recovery-source-lock.${parent.id}`);
    }
  }

  /** A local snapshot process cannot survive service restart; retain partial files and UNKNOWN receipts. */
  recoverOnStartup(): void {
    for (const operation of this.#store.operations.listPending()) {
      if (operation.operation !== 'task.recovery.create') continue;
      if (operation.target.taskId !== undefined) this.#store.settings.removeJson(`task.recovery-source-lock.${operation.target.taskId}`);
      if (operation.status === 'accepted') this.#commands.fail(operation.requestKey, new AppError(ErrorCode.INTERNAL_ERROR, '服务重启，恢复快照结果待核对；保留已创建现场，不自动重建'), true);
    }
  }

  reconcileOperation(requestKey: string): void {
    const operation = this.#commands.get(requestKey);
    if (operation?.operation !== 'task.recovery.create' || !['accepted', 'unknown'].includes(operation.status)) return;
    for (const task of this.#store.tasks.list()) {
      const record = this.#store.settings.getJson<RecoveryRecord & { requestKey: string; ready?: boolean }>(`${RECOVERY_KEY_PREFIX}${task.id}`);
      if (record?.requestKey === requestKey && record.ready === true) {
        this.#commands.settle(requestKey, { taskId: task.id, parentTaskId: record.parentTaskId, mode: record.mode, reconciled: true });
        return;
      }
    }
  }

  list(parentTaskId: string): RecoveryHistoryResponse {
    this.#requireTask(parentTaskId);
    const recoveries: RecoveryRecord[] = [];
    for (const task of this.#store.tasks.list()) {
      const record = this.#record(task.id);
      if (record !== undefined && record.parentTaskId === parentTaskId) {
        recoveries.push({ ...record, stage: task.stage, lifecycle: task.lifecycle, title: task.title });
      }
    }
    recoveries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return { recoveries };
  }

  #record(derivedTaskId: string): RecoveryRecord | undefined {
    const stored = this.#store.settings.getJson<RecoveryRecord & { requestKey?: string }>(`${RECOVERY_KEY_PREFIX}${derivedTaskId}`);
    if (stored === undefined) return undefined;
    return {
      taskId: stored.taskId,
      parentTaskId: stored.parentTaskId,
      mode: stored.mode,
      title: stored.title,
      stage: stored.stage,
      lifecycle: stored.lifecycle,
      createdAt: stored.createdAt,
    };
  }

  #evidence(task: Task): RecoveryEvidence {
    const execution = task.executionId === undefined ? this.#store.executions.byTask(task.id) : this.#store.executions.get(task.executionId);
    const attempts = execution === undefined ? [] : this.#store.executions.listAttempts(execution.id);
    const failedNodes = execution === undefined ? [] : execution.nodes.filter((node) => node.status === 'failed' || node.status === 'unknown');
    const planningRound = task.currentPlanningRoundId === undefined
      ? this.#store.planning.latest(task.id)
      : this.#store.planning.get(task.currentPlanningRoundId);
    const delivery = task.deliveryId === undefined ? this.#store.deliveries.byTask(task.id) : this.#store.deliveries.get(task.deliveryId);
    const acceptance = this.#store.acceptances.get(task.id);
    const workspace = task.workspaceId === undefined ? this.#store.workspaces.byTask(task.id) : this.#store.workspaces.get(task.workspaceId);
    return { execution, attempts, failedNodes, planningRound, delivery, acceptance, workspaceState: workspace?.state };
  }

  #copyPlan(parent: Task, taskId: string, mode: 'from_failed_stage' | 'all_stages', evidence: RecoveryEvidence) {
    const source = evidence.execution === undefined
      ? (parent.currentPlanRevisionId === undefined ? this.#store.plans.latest(parent.id) : this.#store.plans.get(parent.currentPlanRevisionId))
      : this.#store.plans.get(evidence.execution.planRevisionId);
    if (source === undefined) return undefined;
    let graph: PlanGraph = structuredClone(source.graph);
    if (mode === 'from_failed_stage' && evidence.execution !== undefined) {
      const retained = new Set(evidence.execution.nodes.filter((node) => !['succeeded', 'skipped'].includes(node.status) || (node.status === 'succeeded' && source.graph.nodes.find((item) => item.id === node.nodeId)?.acceptance.length !== 0 && readNodeAcceptance(this.#store, evidence.execution!.id, node.nodeId)?.state !== 'accepted')).map((node) => node.nodeId));
      // A failed predecessor invalidates even a previously successful successor.
      for (let changed = true; changed;) {
        changed = false;
        for (const edge of graph.edges) if (retained.has(edge.from) && !retained.has(edge.to)) { retained.add(edge.to); changed = true; }
      }
      if (retained.size === 0) throw new AppError(ErrorCode.VALIDATION_FAILED, '没有失败或后续阶段可恢复；可选择只读验证或复制全部阶段');
      const nodes = graph.nodes.filter((node) => retained.has(node.id));
      const groups = new Set(nodes.map((node) => node.groupId));
      graph = { ...graph, nodes, edges: graph.edges.filter((edge) => retained.has(edge.from) && retained.has(edge.to)), groups: graph.groups.filter((group) => groups.has(group.id)) };
    }
    const policy = evidence.execution === undefined ? undefined : this.#store.settings.getJson<ExecutionSettings>(executionSettingsKey(evidence.execution.id));
    if (policy !== undefined) this.#store.settings.putJson(`recovery.execution-settings.${taskId}`, policy);
    return this.#store.plans.create({ taskId, source: 'edit', baseRevisionId: source.id, graph, status: 'unconfirmed', diff: graph.nodes.map((node) => ({ nodeId: node.id, nodeKey: node.key, title: node.title, groupId: node.groupId, kind: 'unchanged', summary: '复制原任务冻结阶段，保留职业与输入配置；请重新确认' })) });
  }

  #assertModePreconditions(parent: Task, mode: RecoveryModeValue, evidence: RecoveryEvidence): void {
    if (mode !== 'verify_only') {
      if (evidence.execution?.status === 'unknown' || evidence.execution?.nodes.some((node) => node.status === 'running' || node.status === 'unknown') || evidence.planningRound?.status === 'unknown' || evidence.delivery?.projection === 'unknown_receipt') throw new AppError(ErrorCode.HUMAN_REVIEW_REQUIRED, '原任务仍有活动或未知结果，先只读核对停稳后才能创建可写恢复');
      return;
    }
    const settledAttempts = evidence.attempts.filter((attempt) => attempt.status === 'succeeded' || attempt.status === 'failed');
    if (evidence.execution === undefined || settledAttempts.length === 0) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '只读验证需要原任务已有执行尝试或验证结果；当前没有可核对的产物', {
        details: { mode, parentTaskId: parent.id },
      });
    }
  }

  /**
   * Returns the derived requirement for modes that carry context; `undefined`
   * keeps the fresh requirement created together with the task (all_stages).
   */
  #derivedRequirement(parent: Task, mode: RecoveryModeValue, evidence: RecoveryEvidence, created: RequirementInput): RequirementInput | undefined {
    if (mode === 'all_stages') return undefined;
    const revision = parent.requirement.revision + 1;
    const supplement = mode === 'from_failed_stage'
      ? this.#supplement(FAILURE_CONTEXT_TITLE, this.#failureContext(parent, evidence), revision)
      : this.#supplement(VERIFY_SCOPE_TITLE, this.#verificationContext(parent, evidence), revision);
    return {
      text: parent.requirement.text,
      // `from_failed_stage` keeps the accumulated requirement entries; `verify_only`
      // reuses them as read-only context for the manual check.
      entries: parent.requirement.entries.length > 0 ? parent.requirement.entries : created.entries,
      supplements: [...parent.requirement.supplements, supplement],
      revision,
      updatedAt: nowIso(),
    };
  }

  #supplement(title: string, body: string, revision: number): RequirementInput['supplements'][number] {
    return {
      id: createId('sup'),
      revision,
      text: `${title}：\n${body}`,
      savedAt: nowIso(),
    };
  }

  #failureContext(parent: Task, evidence: RecoveryEvidence): string {
    const lines: string[] = [
      `父任务在「${TASK_STAGE_LABEL[parent.stage]}」阶段中断/失败；父任务状态：${TASK_LIFECYCLE_LABEL[parent.lifecycle]} · ${TASK_ATTENTION_LABEL[parent.attention] || '无注意项'}。`,
    ];
    if (evidence.execution !== undefined) {
      lines.push(
        `执行状态：${EXECUTION_STATUS_LABEL[evidence.execution.status]}；进度 ${String(evidence.execution.progress.done)}/${String(evidence.execution.progress.total)}（失败 ${String(evidence.execution.progress.failed)}）。`,
      );
    }
    if (evidence.failedNodes.length > 0) {
      lines.push(`失败/未知步骤：${evidence.failedNodes.slice(0, 5).map((node) => `${node.nodeId}（${node.error?.code ?? 'FAILED'}：${clip(node.error?.message ?? '无详情', 160)}）`).join('；')}`);
    }
    const round = evidence.planningRound;
    if (round !== undefined && (round.status === 'failed' || round.status === 'unknown' || round.status === 'stopped')) {
      lines.push(`规划轮次：${PLANNING_STATUS_LABEL[round.status]} / ${PLANNING_STAGE_LABEL[round.stage]}${round.failure === undefined ? '' : `；${clip(round.failure.message, 200)}`}`);
    }
    if (evidence.delivery !== undefined) {
      lines.push(`交付投影：${DELIVERY_PROJECTION_LABEL[evidence.delivery.projection]}${evidence.delivery.projectionReason === undefined ? '' : `；${clip(evidence.delivery.projectionReason, 200)}`}`);
    }
    if (evidence.acceptance !== undefined) {
      lines.push(`人工验收：${evidence.acceptance.verdict === 'accepted' ? '已通过' : '未通过'}${evidence.acceptance.note === undefined ? '' : `；${clip(evidence.acceptance.note, 160)}`}`);
    }
    for (const attempt of evidence.attempts.filter((item) => item.status === 'succeeded').slice(0, 20)) {
      lines.push(`沿用只读上下文：原尝试 ${attempt.id} / ${attempt.nodeId}；${clip(attempt.result?.summary ?? '完成结果无正文', 300)}；产物 ${attempt.result?.artifacts.map((artifact) => artifact.id).join('、') ?? '无'}。`);
    }
    lines.push('已有冻结计划时复制失败及后续阶段，成功前序的产物从独立工作区快照沿用；重新审阅确认复制计划后才可执行，不自动重新规划。');
    return clip(lines.join('\n'), MAX_EVIDENCE);
  }

  #verificationContext(parent: Task, evidence: RecoveryEvidence): string {
    const lines: string[] = [
      '本任务为只读验证草稿：复用父任务已有产物核对结果，不创建计划、工作区或执行，也不修改任何文件。',
      `父任务阶段：${TASK_STAGE_LABEL[parent.stage]}；工作区状态：${evidence.workspaceState === undefined ? '无工作区' : WORKSPACE_STATE_LABEL[evidence.workspaceState]}。`,
    ];
    const settled = evidence.attempts.filter((attempt) => attempt.status === 'succeeded' || attempt.status === 'failed').slice(0, 5);
    for (const attempt of settled) {
      const verification = attempt.result?.verification;
      const summary = attempt.result?.summary ?? attempt.readability.result;
      lines.push(
        `尝试 ${attempt.nodeId} #${String(attempt.ordinal)}：${NODE_STATUS_LABEL[attempt.status]}；验证：${verification?.state ?? '未提交'}${verification?.summary === undefined ? '' : `（${clip(verification.summary, 120)}）`}${summary === undefined || summary === 'ok' ? '' : `；结果：${clip(summary, 160)}`}`,
      );
    }
    if (evidence.failedNodes.length > 0) {
      lines.push(`失败/未知步骤：${evidence.failedNodes.slice(0, 5).map((node) => `${node.nodeId}（${node.error?.code ?? 'FAILED'}：${clip(node.error?.message ?? '无详情', 160)}）`).join('；')}`);
    }
    if (evidence.delivery !== undefined) {
      lines.push(
        `交付：${DELIVERY_PROJECTION_LABEL[evidence.delivery.projection]}；验证结论：${evidence.delivery.verificationOutcome ?? '未运行'}；步骤：${evidence.delivery.steps.map((step) => `${step.step}=${step.state}`).join('、') || '无'}。`,
      );
    }
    if (evidence.acceptance !== undefined) {
      lines.push(`人工验收：${evidence.acceptance.verdict === 'accepted' ? '已通过' : '未通过'}${evidence.acceptance.note === undefined ? '' : `；${clip(evidence.acceptance.note, 160)}`}`);
    }
    lines.push('核对方式：打开父任务执行现场/交付记录对照上述产物，不要在本任务上开始执行或修改文件。');
    return clip(lines.join('\n'), MAX_EVIDENCE);
  }

  #assertRecoverable(task: Task): void {
    if (this.#store.settings.getJson(`task.recovery-source-lock.${task.id}`) !== undefined) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '原任务正在创建恢复快照，请先核对原操作');
    if (task.readOnly === true) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '只读验证草稿只用于核对父任务产物，不能再创建恢复草稿', {
        details: { reason: 'RECOVERY_READ_ONLY', taskId: task.id },
      });
    }
    const round = task.currentPlanningRoundId === undefined ? this.#store.planning.latest(task.id) : this.#store.planning.get(task.currentPlanningRoundId);
    if (round !== undefined && ['queued', 'running', 'stopping'].includes(round.status)) {
      throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '原任务仍在规划中，请先停止规划再恢复', { details: { status: round.status } });
    }
    const execution = task.executionId === undefined ? this.#store.executions.byTask(task.id) : this.#store.executions.get(task.executionId);
    if (execution !== undefined && ['running', 'pausing', 'stopping'].includes(execution.status)) {
      throw new AppError(ErrorCode.HUMAN_REVIEW_REQUIRED, '原任务仍在执行中，请先暂停/取消执行再恢复', { details: { status: execution.status } });
    }
    const workspace = task.workspaceId === undefined ? this.#store.workspaces.byTask(task.id) : this.#store.workspaces.get(task.workspaceId);
    if (workspace !== undefined && ['preparing', 'cleaning'].includes(workspace.state)) {
      throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '原任务工作区正在准备/清理，请等待结束再恢复', { details: { state: workspace.state } });
    }
    const policy = execution === undefined ? undefined : executionPolicy(this.#store, execution.id, this.#store.settings.getJson<ExecutionSettings>(`task.execution-settings.${task.id}`) ?? this.#store.settings.getJson<ExecutionSettings>(executionSettingsKey(execution.id)) ?? DEFAULT_SETTINGS.execution);
    const expired = policy?.timeoutEnabled === true && execution?.startedAt !== undefined && Date.now() >= Date.parse(execution.startedAt) + policy.taskTimeoutMinutes * 60000;
    if (task.lifecycle === 'active' && task.attention === 'none' && !expired) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '原任务没有需要恢复的失败或阻断上下文', { details: { stage: task.stage } });
    }
  }

  #requireTask(taskId: string): Task {
    const task = this.#store.tasks.get(taskId);
    if (task === undefined) throw new AppError(ErrorCode.NOT_FOUND, '原任务不存在', { details: { taskId } });
    return task;
  }
}

function copiedScope(mode: RecoveryModeValue): string {
  if (mode === 'from_failed_stage') return 'requirement+supplements+failure_context';
  if (mode === 'all_stages') return 'requirement+method';
  return 'requirement+existing_artifacts_read_only';
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function derivedTitle(parentTitle: string, mode: RecoveryModeValue): string {
  const suffix = mode === 'from_failed_stage' ? '从失败阶段恢复' : mode === 'all_stages' ? '全阶段恢复' : '只读验证恢复';
  const title = `${parentTitle}（${suffix}）`;
  return title.length <= 120 ? title : `${title.slice(0, 117)}…`;
}

export function isRecoveryMode(value: unknown): value is RecoveryModeValue {
  return typeof value === 'string' && (RECOVERY_MODES as readonly string[]).includes(value);
}

/** Guard so a future operation registration cannot silently drop recovery. */
export function assertRecoveryOperationRegistered(): void {
  if (!isOperationKind('task.recovery.create')) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, 'task.recovery.create 未注册到操作表');
  }
}
