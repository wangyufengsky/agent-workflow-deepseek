import type {
  ActionAvailability,
  AppSettings,
  DeliveryProjectionValue,
  ExecutionView,
  PlanRevision,
  PlanningRound,
  PlanningView,
  Project,
  Task,
  TaskDelivery,
  TaskWorkspace,
} from '@agent-workflow/shared';
import { Rationale, TaskAttention, TaskLifecycle, TaskStage, nowIso } from '@agent-workflow/shared';

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
  actions.startExecution = planConfirmed && workspaceReady
    ? allowed()
    : denied(Rationale.WORKSPACE_NOT_READY, workspaceReady ? '计划尚未确认' : '准备成功前不能开始执行');
  actions.pauseExecution = execution?.status === 'running' ? allowed() : denied(Rationale.OPERATION_IN_PROGRESS, '当前没有运行中的执行');
  actions.resumeExecution = execution?.status === 'paused' ? allowed() : denied(Rationale.OPERATION_IN_PROGRESS, '当前没有暂停的执行');
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
  actions.cleanupWorkspace = workspace?.state === 'ready' ? allowed() : denied(Rationale.WORKSPACE_NOT_READY, '没有可清理的工作区');

  return actions;
}

export function computePlanningActions(input: {
  readonly round?: PlanningRound;
  readonly opencodeReady: boolean;
  readonly budgetConfigured: boolean;
}): Record<string, ActionAvailability> {
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
