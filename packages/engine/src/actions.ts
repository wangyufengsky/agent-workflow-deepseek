import type {
  ActionAvailability,
  AppSettings,
  DeliveryProjectionValue,
  ExecutionView,
  ExecutionSettings,
  PlanNode,
  PlanRevision,
  PlanningRound,
  PlanningView,
  Project,
  Task,
  TaskDelivery,
  TaskWorkspace,
} from '@agent-workflow/shared';
import {
  AppError,
  ErrorCode,
  NodeManualAcceptanceState,
  Rationale,
  TaskAttention,
  TaskLifecycle,
  TaskStage,
  nowIso,
  type NodeManualAcceptanceStateValue,
} from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';

export interface EngineContext {
  readonly store: import('@agent-workflow/storage').Store;
  readonly settings: () => AppSettings;
  readonly projects: () => readonly Project[];
  readonly opencodeReady: () => boolean;
  readonly gitlabConfigured: () => boolean;
  readonly planningBudgetConfigured: () => boolean;
}

export function allowed(): ActionAvailability {
  return { allowed: true };
}

export function denied(reasonCode: string, reason: string): ActionAvailability {
  return { allowed: false, reasonCode, reason };
}

/* ------------------------------------------------------------------ */
/* Manual node acceptance (audit verdict stored in the settings store) */
/* ------------------------------------------------------------------ */

export const NODE_ACCEPTANCE_KEY_PREFIX = 'execution.node.acceptance.';

/**
 * Stored human verdict for one succeeded node. Acceptance is an audit fact and
 * never rewrites the node status; `pending` is derived when no record exists.
 */
export interface StoredNodeAcceptance {
  readonly nodeId: string;
  readonly state: 'accepted' | 'rejected';
  readonly verdictAt: string;
  readonly note?: string;
  readonly requestKey: string;
}

export function nodeAcceptanceKey(executionId: string, nodeId: string): string {
  return `${NODE_ACCEPTANCE_KEY_PREFIX}${executionId}.${nodeId}`;
}

export function readNodeAcceptance(store: Store, executionId: string | undefined, nodeId: string): StoredNodeAcceptance | undefined {
  if (executionId === undefined) return undefined;
  return store.settings.getJson<StoredNodeAcceptance>(nodeAcceptanceKey(executionId, nodeId));
}

export function nodeAcceptanceState(store: Store, executionId: string, nodeId: string): NodeManualAcceptanceStateValue {
  const stored = readNodeAcceptance(store, executionId, nodeId);
  if (stored === undefined) return NodeManualAcceptanceState.PENDING;
  return stored.state;
}

/** A plan node with declared acceptance criteria needs a human verdict before it counts as done. */
export function planNodeRequiresAcceptance(node: PlanNode): boolean {
  return node.acceptance.length > 0;
}

export interface ExecutionAcceptanceGate {
  /** Executed (succeeded) nodes still waiting for the human verdict. */
  readonly pending: readonly string[];
  /** Executed nodes the human sent back for rework. */
  readonly rejected: readonly string[];
  /** Every gated node has an accepted verdict. */
  readonly satisfied: boolean;
}

/**
 * W0-4b completion gate: derive which executed nodes still need a human verdict.
 * Nodes without acceptance criteria are not gated (legacy/no-acceptance plans
 * keep completing on `succeeded` alone).
 */
export function executionAcceptanceGate(store: Store, execution: ExecutionView, plan: PlanRevision | undefined): ExecutionAcceptanceGate {
  if (plan === undefined) return { pending: [], rejected: [], satisfied: true };
  const required = new Set(plan.graph.nodes.filter(planNodeRequiresAcceptance).map((node) => node.id));
  const pending: string[] = [];
  const rejected: string[] = [];
  for (const node of execution.nodes) {
    if (node.status !== 'succeeded' || !required.has(node.nodeId)) continue;
    const state = nodeAcceptanceState(store, execution.id, node.nodeId);
    if (state === NodeManualAcceptanceState.ACCEPTED) continue;
    if (state === NodeManualAcceptanceState.REJECTED) rejected.push(node.nodeId);
    else pending.push(node.nodeId);
  }
  return { pending, rejected, satisfied: pending.length === 0 && rejected.length === 0 };
}

/** Reset the verdict when a rejected node is retried, so the next attempt starts fresh. */
export function clearNodeAcceptance(store: Store, executionId: string, nodeId: string): void {
  store.settings.removeJson(nodeAcceptanceKey(executionId, nodeId));
}

/** Thrown by services when a write command targets a read-only recovery draft. */
export function readOnlyRecoveryError(action: string): AppError {
  return new AppError(ErrorCode.FORBIDDEN, `该任务是只读验证草稿（verify_only）：不能${action}`, {
    details: { reason: 'RECOVERY_READ_ONLY' },
  });
}

/** Recovery mode `verify_only` drafts are read-only by domain contract. */
export const READ_ONLY_RECOVERY_REASON = '该任务是只读验证草稿（verify_only）：只核对父任务已有产物，不能规划、确认计划、准备工作区或执行。';

/**
 * Actions that would create or mutate plans/executions/workspaces. On a
 * read-only recovery draft they are always denied, independent of what the
 * project/round state would otherwise allow.
 */
const READ_ONLY_DENIED_ACTIONS = [
  'generatePlan',
  'useSkeleton',
  'startPlanning',
  'reconcile',
  'previewNextRound',
  'applyCandidate',
  'rejectCandidate',
  'stopPlanning',
  'saveAnswer',
  'confirmPlan',
  'editPlan',
  'adjustExecutionPlan',
  'prepareWorkspace',
  'startExecution',
  'pauseExecution',
  'resumeExecution',
  'retryExecution',
  'cancelExecution',
  'continueExecution',
  'deliver',
] as const;

function denyReadOnly(actions: Record<string, ActionAvailability>): void {
  const available = denied('RECOVERY_READ_ONLY', READ_ONLY_RECOVERY_REASON);
  for (const key of READ_ONLY_DENIED_ACTIONS) actions[key] = available;
}

export function computeTaskActions(input: {
  readonly task: Task;
  readonly plan?: PlanRevision;
  readonly round?: PlanningRound;
  readonly execution?: ExecutionView;
  readonly workspace?: TaskWorkspace;
  readonly delivery?: TaskDelivery;
  readonly opencodeReady: boolean;
  readonly planningBudgetConfigured: boolean;
  readonly gitlabConfigured: boolean;
  readonly executionPolicy?: ExecutionSettings;
  readonly retryRejectedNodeIds?: readonly string[];
  readonly taskAttemptCount?: number;
  readonly sessionErrorCount?: number;
}): Record<string, ActionAvailability> {
  const { task, plan, round, execution, workspace, delivery } = input;
  const fixed = task.fixedTemplate !== undefined;
  const fixedReason = '该任务使用固定模板，创建后不能修改步骤；要改要求，请新建模板任务。';
  const actions: Record<string, ActionAvailability> = {};

  // Planning actions
  const planningRunning = round !== undefined && (round.status === 'running' || round.status === 'queued' || round.status === 'stopping');
  const candidateReady = round?.stage === 'awaiting_review' && round.candidate !== undefined;
  const roundUnknown = round?.status === 'unknown' || round?.stage === 'unknown';
  if (!input.opencodeReady) {
    actions.generatePlan = denied(Rationale.OPENCODE_NOT_READY, '受管 OpenCode 服务未就绪，无法调用模型');
    actions.useSkeleton = fixed ? denied(Rationale.FIXED_TEMPLATE, fixedReason) : allowed();
  } else if (fixed) {
    actions.generatePlan = denied(Rationale.FIXED_TEMPLATE, fixedReason);
    actions.useSkeleton = denied(Rationale.FIXED_TEMPLATE, fixedReason);
  } else if (planningRunning) {
    actions.generatePlan = denied(Rationale.OPERATION_IN_PROGRESS, '本轮规划仍在进行');
    actions.useSkeleton = denied(Rationale.OPERATION_IN_PROGRESS, '本轮规划仍在进行');
  } else if (candidateReady) {
    actions.generatePlan = denied(Rationale.CANDIDATE_PENDING, '已有候选待审阅，请先应用或不采用');
    actions.useSkeleton = allowed();
  } else if (roundUnknown) {
    actions.generatePlan = denied(Rationale.ROUND_UNKNOWN, '原轮次结果待核对，先核对原轮次');
    actions.useSkeleton = allowed();
  } else if (task.stage === TaskStage.DRAFT || task.stage === TaskStage.PLANNING) {
    actions.generatePlan = input.planningBudgetConfigured
      ? allowed()
      : denied(Rationale.BUDGET_MISSING, '规划预算未设置；请先在设置中配置本轮预算');
    actions.useSkeleton = allowed();
  } else {
    actions.generatePlan = allowed();
    actions.useSkeleton = allowed();
  }

  actions.applyCandidate = candidateReady ? allowed() : denied(Rationale.CANDIDATE_PENDING, '当前没有可应用的候选');
  actions.rejectCandidate = candidateReady ? allowed() : denied(Rationale.CANDIDATE_PENDING, '当前没有可审阅的候选');
  actions.stopPlanning = planningRunning ? allowed() : denied(Rationale.OPERATION_IN_PROGRESS, '当前没有进行中的规划');
  actions.reconcile = roundUnknown ? allowed() : denied(Rationale.ROUND_UNKNOWN, '原轮次结果已知，无需核对');
  actions.saveAnswer = round?.stage === 'needs_answer' ? allowed() : denied(Rationale.ANSWER_REQUIRED, '当前没有必须答复的问题');

  // Plan / confirmation
  const planStatus = plan?.status;
  const planConfirmable = planStatus === 'unconfirmed' || planStatus === 'draft';
  actions.confirmPlan = planConfirmable && !fixed ? allowed() : planConfirmable && fixed ? allowed() : denied(Rationale.PLAN_NOT_CONFIRMED, '当前没有未确认的计划');
  actions.editPlan = task.stage === TaskStage.CONFIRMING && !fixed && plan !== undefined
    ? allowed()
    : fixed
      ? denied(Rationale.FIXED_TEMPLATE, fixedReason)
      : denied(Rationale.PLAN_NOT_CONFIRMED, '当前阶段不能编辑计划');

  // Workspace / execution
  const workspaceReady = workspace?.state === 'ready';
  const workspacePreparing = workspace?.state === 'preparing';
  const planConfirmed = planStatus === 'confirmed';
  if (fixed) {
    actions.adjustExecutionPlan = denied(Rationale.FIXED_TEMPLATE, fixedReason);
  } else if (execution === undefined) {
    actions.adjustExecutionPlan = denied(Rationale.PLAN_NOT_CONFIRMED, '执行尚未开始');
  } else if (execution.status === 'running') {
    actions.adjustExecutionPlan = allowed();
  } else {
    actions.adjustExecutionPlan = denied(Rationale.OPERATION_IN_PROGRESS, '当前执行状态不能调整计划');
  }
  actions.prepareWorkspace = planConfirmed && !workspaceReady && !workspacePreparing
    ? allowed()
    : workspaceReady
      ? denied(Rationale.WORKSPACE_NOT_READY, '工作区已准备')
      : denied(Rationale.WORKSPACE_NOT_READY, '计划尚未确认');
  const executionStartable = execution === undefined || ['idle', 'ready', 'paused'].includes(execution.status);
  actions.startExecution = planConfirmed && workspaceReady && executionStartable
    ? allowed()
    : denied(
        Rationale.WORKSPACE_NOT_READY,
        !workspaceReady ? '准备成功前不能开始执行' : !planConfirmed ? '计划尚未确认' : `当前执行状态为 ${execution?.status ?? '未知'}，不能开始`,
      );
  actions.pauseExecution = execution?.status === 'running' ? allowed() : denied(Rationale.OPERATION_IN_PROGRESS, '当前没有运行中的执行');
  const retryNodes = execution?.nodes.filter((node) => node.status === 'failed' || input.retryRejectedNodeIds?.includes(node.nodeId)) ?? [];
  const totalExhausted = input.executionPolicy !== undefined && (input.taskAttemptCount ?? 0) >= input.executionPolicy.maxTaskAttempts;
  const sessionExhausted = input.executionPolicy !== undefined && (input.sessionErrorCount ?? 0) >= input.executionPolicy.sessionErrorThreshold;
  const deadlineExhausted = input.executionPolicy?.timeoutEnabled === true && execution?.startedAt !== undefined && Date.now() >= Date.parse(execution.startedAt) + input.executionPolicy.taskTimeoutMinutes * 60000;
  const attemptsExhausted = retryNodes.some((node) => node.attemptCount >= (input.executionPolicy?.maxAttempts ?? 3));
  const activeNodes = execution?.nodes.some((node) => node.status === 'running' || node.status === 'unknown') ?? false;
  actions.retryExecution = execution !== undefined && ['failed', 'stopped', 'paused', 'unknown'].includes(execution.status) && !activeNodes && (retryNodes.length > 0 || (execution.status === 'stopped' && execution.nodes.some((node) => node.status === 'pending' || node.status === 'ready'))) && !attemptsExhausted && !totalExhausted && !sessionExhausted && !deadlineExhausted
    ? allowed()
    : denied(Rationale.OPERATION_IN_PROGRESS, activeNodes || execution?.status === 'unknown' ? '仍有活动或未知步骤，请先只读核对停稳' : totalExhausted ? '任务总尝试次数已用完；请创建恢复任务' : sessionExhausted ? '会话异常已达阈值；请检查环境后创建恢复任务' : deadlineExhausted ? '任务业务总时限已用完；请创建恢复任务' : attemptsExhausted ? `已达到单节点总尝试上限（${input.executionPolicy?.maxAttempts ?? 3} 次，含首次）；请创建恢复任务` : '当前没有可按原配置重试的失败或退回步骤');
  actions.resumeExecution = execution?.status === 'paused' && !deadlineExhausted && !(retryNodes.length > 0 && input.executionPolicy?.pauseAfterFailure === true)
    ? allowed()
    : denied(Rationale.OPERATION_IN_PROGRESS, deadlineExhausted ? '任务业务总时限已用完；请停止后创建恢复任务' : retryNodes.length > 0 ? '先处理失败或退回步骤，再继续执行' : '当前没有暂停的执行');
  actions.cancelExecution = execution !== undefined && (execution.status === 'running' || execution.status === 'paused' || execution.status === 'pausing')
    ? allowed()
    : denied(Rationale.OPERATION_IN_PROGRESS, '当前没有可取消的执行');
  actions.continueExecution = execution?.editSession?.state === 'saved'
    ? allowed()
    : denied(Rationale.RECONFIRM_PENDING, '计划变更后需要先重新确认');

  // Delivery
  const deliveryProjection: DeliveryProjectionValue | undefined = delivery?.projection;
  actions.deliver = deliveryProjection === 'awaiting_selection'
    ? allowed()
    : deliveryProjection === 'awaiting_confirmation'
      ? allowed()
      : denied(Rationale.DELIVERY_BLOCKED, '当前没有待交付的变更');
  const executionUnsettled = execution !== undefined && (['running', 'pausing', 'stopping', 'unknown'].includes(execution.status) || execution.nodes.some((node) => node.status === 'running' || node.status === 'unknown'));
  actions.cleanupWorkspace = executionUnsettled
    ? denied(Rationale.OPERATION_IN_PROGRESS, '执行仍在进行或停稳待核对，确认停止后才能清理工作区')
    : workspace?.state === 'ready' ? allowed() : denied(Rationale.WORKSPACE_NOT_READY, '没有可清理的工作区');

  // W0-4b: executed nodes awaiting a human verdict gate completion; expose the
  // entry point so the UI can point the user at the node panel.
  const acceptancePending = execution?.acceptance !== undefined && (execution.acceptance.pending.length > 0 || execution.acceptance.rejected.length > 0);
  actions.reviewNodeAcceptance = acceptancePending
    ? allowed()
    : denied('NO_PENDING_ACCEPTANCE', '当前没有待人工验收的已执行步骤');

  // A read-only verification draft can never start writable work, even if a
  // stale plan/round/workspace record somehow existed for it.
  if (task.readOnly === true) {
    denyReadOnly(actions);
    actions.cleanupWorkspace = denied('RECOVERY_READ_ONLY', READ_ONLY_RECOVERY_REASON);
  }

  return actions;
}

export function computePlanningActions(input: {
  readonly round?: PlanningRound;
  readonly opencodeReady: boolean;
  readonly budgetConfigured: boolean;
  readonly readOnly?: boolean;
}): Record<string, ActionAvailability> {
  if (input.readOnly === true) {
    const actions: Record<string, ActionAvailability> = {};
    denyReadOnly(actions);
    return actions;
  }
  const round = input.round;
  const running = round?.status === 'running' || round?.status === 'queued' || round?.status === 'stopping';
  const unknown = round?.status === 'unknown' || round?.stage === 'unknown';
  return {
    startPlanning: input.opencodeReady && !running && !unknown
      ? allowed()
      : denied(
          input.opencodeReady ? (running ? Rationale.OPERATION_IN_PROGRESS : Rationale.ROUND_UNKNOWN) : Rationale.OPENCODE_NOT_READY,
          input.opencodeReady ? (running ? '本轮规划仍在进行' : '原轮次结果待核对') : '受管 OpenCode 服务未就绪',
        ),
    stopPlanning: running ? allowed() : denied(Rationale.OPERATION_IN_PROGRESS, '当前没有进行中的规划'),
    reconcile: unknown ? allowed() : denied(Rationale.ROUND_UNKNOWN, '没有待核对的轮次'),
    previewNextRound: input.opencodeReady ? allowed() : denied(Rationale.OPENCODE_NOT_READY, '受管 OpenCode 服务未就绪'),
  };
}

export function computeTaskAttention(input: {
  readonly task: Task;
  readonly round?: PlanningRound;
  readonly execution?: ExecutionView;
  readonly workspace?: TaskWorkspace;
  readonly delivery?: TaskDelivery;
}): { attention: Task['attention']; reason?: string } {
  const { task, round, execution, workspace, delivery } = input;
  if (task.lifecycle !== TaskLifecycle.ACTIVE) return { attention: TaskAttention.NONE };
  if (task.readOnly === true) return { attention: TaskAttention.WAITING_USER, reason: '只读验证草稿待人工核对' };
  if (round?.status === 'unknown' || round?.stage === 'unknown') return { attention: TaskAttention.UNKNOWN, reason: '规划结果待核对' };
  if (round?.stage === 'needs_answer') return { attention: TaskAttention.WAITING_USER, reason: '有必须答复的问题' };
  if (round?.stage === 'awaiting_review') return { attention: TaskAttention.WAITING_USER, reason: '候选待审阅' };
  if (execution?.status === 'failed') return { attention: TaskAttention.FAILED, reason: '执行失败' };
  if (execution?.status === 'unknown') return { attention: TaskAttention.UNKNOWN, reason: '执行结果待核对' };
  if (execution?.notice?.kind === 'race') return { attention: TaskAttention.WAITING_USER, reason: '待执行计划调整遇到领取竞态' };
  if (workspace?.state === 'partial' || workspace?.state === 'unknown') return { attention: TaskAttention.UNKNOWN, reason: '工作区准备待核对' };
  if (delivery?.projection === 'unknown_receipt') return { attention: TaskAttention.UNKNOWN, reason: '交付回执待核对' };
  if (delivery?.projection === 'blocked') return { attention: TaskAttention.BLOCKED, reason: delivery.projectionReason ?? '交付受阻' };
  if (delivery?.projection === 'awaiting_selection') return { attention: TaskAttention.WAITING_USER, reason: '执行已结束，等待交付' };
  return { attention: TaskAttention.NONE };
}

export function planningView(taskId: string, rounds: readonly PlanningRound[]): PlanningView {
  const current = rounds[0];
  return { taskId, currentRoundId: current?.id, rounds, actions: {} };
}

export function emptyPlanningUsage(currency = 'USD'): PlanningRound['usage'] {
  return {
    dispatches: { used: 0, maximum: 2 },
    revisions: { used: 0, maximum: 1 },
    budget: { known: 0, reserved: 0, unknown: 0, currency },
  };
}

export function now(): string {
  return nowIso();
}
