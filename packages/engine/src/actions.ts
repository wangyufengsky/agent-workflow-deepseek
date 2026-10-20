import { isPlanningRoundUnknown, isPlanningQuestionAnswered, hasPendingPlanningQuestions, hasPendingPlanningReview } from '@agent-workflow/shared';
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
  WorkspacePrepareProjection,
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
  /** Service-projected workspace prepare result (P11-04); http layer refines it. */
  readonly workspacePrepare?: WorkspacePrepareProjection;
}): Record<string, ActionAvailability> {
  const { task, plan, round, execution, workspace, delivery } = input;
  const fixed = task.fixedTemplate !== undefined;
  const fixedReason = '该任务使用固定模板，创建后不能修改步骤；要改要求，请新建模板任务。';
  const actions: Record<string, ActionAvailability> = {};

  // Planning actions
  const planningRunning = round !== undefined && (round.status === 'running' || round.status === 'queued' || round.status === 'stopping');
  const candidate = round?.candidate;
  const candidateReady = round?.stage === 'awaiting_review' && candidate !== undefined;
  const roundUnknown = round?.status === 'unknown' || round?.stage === 'unknown';
  // REQ-01: required questions of the current round gate a new model dispatch.
  const pendingRequiredQuestions = round?.questions.filter((question) => question.required && !isPlanningQuestionAnswered(question)) ?? [];
  // REQ-02: a candidate that failed deterministic checks is a reviewable blocked
  // candidate (not a failed round): 不采用/补充输入 stay usable, apply is denied
  // with the exact hard-problem reason, and a new round is allowed.
  const hardProblems = (candidate?.validation.structural.problems ?? []).filter((problem) => problem.severity === 'hard');
  const candidateBlocked = candidate !== undefined && candidate.validation.structural.state === 'failed';
  const candidateStale = candidate !== undefined && candidate.validation.basis.state === 'stale';
  const candidateBlockedReason = candidateStale
    ? `候选已过期：答复与候选不一致（${candidate.validation.basis.detail}）；按当前输入预览新一轮，或不采用候选`
    : `有 ${String(hardProblems.length)} 个必须处理的问题：${hardProblems.slice(0, 3).map((problem) => problem.title).join('、')}${hardProblems.length > 3 ? ' 等' : ''}；这些规则不能忽略（补充输入或手改后再试，或不采用候选）`;
  if (!input.opencodeReady) {
    actions.generatePlan = denied(Rationale.OPENCODE_NOT_READY, '受管 OpenCode 服务未就绪，无法调用模型');
    actions.useSkeleton = fixed ? denied(Rationale.FIXED_TEMPLATE, fixedReason) : allowed();
  } else if (fixed) {
    actions.generatePlan = denied(Rationale.FIXED_TEMPLATE, fixedReason);
    actions.useSkeleton = denied(Rationale.FIXED_TEMPLATE, fixedReason);
  } else if (planningRunning) {
    actions.generatePlan = denied(Rationale.OPERATION_IN_PROGRESS, '本轮规划仍在进行');
    actions.useSkeleton = denied(Rationale.OPERATION_IN_PROGRESS, '本轮规划仍在进行');
  } else if (pendingRequiredQuestions.length > 0 && !candidateBlocked) {
    actions.generatePlan = denied(Rationale.ANSWER_REQUIRED, `上一轮还有 ${String(pendingRequiredQuestions.length)} 个必须答复的问题：先保存答复再预览新一轮`);
    actions.useSkeleton = allowed();
  } else if (candidateBlocked) {
    actions.generatePlan = allowed();
    actions.useSkeleton = allowed();
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

  actions.applyCandidate = candidateBlocked
    ? denied(candidateStale ? Rationale.STALE_INPUT : Rationale.HARD_PROBLEMS, candidateBlockedReason)
    : candidateReady
      ? allowed()
      : pendingRequiredQuestions.length > 0
        ? denied(Rationale.ANSWER_REQUIRED, `还有 ${String(pendingRequiredQuestions.length)} 个必须答复的问题未回答，先保存答复`)
        : denied(Rationale.CANDIDATE_PENDING, '当前没有可应用的候选');
  actions.rejectCandidate = candidate !== undefined && !planningRunning
    ? allowed()
    : denied(Rationale.CANDIDATE_PENDING, '当前没有可审阅的候选');
  actions.stopPlanning = planningRunning ? allowed() : denied(Rationale.OPERATION_IN_PROGRESS, '当前没有进行中的规划');
  actions.reconcile = roundUnknown ? allowed() : denied(Rationale.ROUND_UNKNOWN, '原轮次结果已知，无需核对');
  actions.saveAnswer = (round?.questions.length ?? 0) > 0 && !planningRunning
    ? allowed()
    : denied(Rationale.ANSWER_REQUIRED, '当前没有必须答复的问题');

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
  } else if (execution.status === 'running' || execution.status === 'paused') {
    // P13-05: the design keeps "调整待执行计划" available while paused; the domain
    // editBegin accepts both running and paused and keeps the paused state after finish.
    actions.adjustExecutionPlan = allowed();
  } else {
    actions.adjustExecutionPlan = denied(Rationale.OPERATION_IN_PROGRESS, '当前执行状态不能调整计划');
  }
  actions.prepareWorkspace = planConfirmed && !workspaceReady && !workspacePreparing
    ? allowed()
    : workspaceReady
      ? denied(Rationale.WORKSPACE_NOT_READY, '工作区已准备')
      : denied(Rationale.WORKSPACE_NOT_READY, '计划尚未确认');
  // P11-04: the prepare result projection decides the single allowed action of
  // every PW abnormal state; the plain prepare command is never left available
  // for unknown/partial/conflict/drift/denied/empty.
  const prepareActions = workspacePrepareActions(workspace, input.workspacePrepare, planConfirmed);
  for (const [key, value] of Object.entries(prepareActions)) actions[key] = value;
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

/**
 * P11-04: one service projection → the single allowed recovery action per PW
 * abnormal state. The plain `prepareWorkspace` command is only ever allowed when
 * the service says nothing was prepared yet (or for the explicit retry after a
 * conclusively failed prepare). Unknown/partial/conflict/drift/denied/empty each
 * expose their designed unique action instead of "准备独立工作区".
 */
export function workspacePrepareActions(
  workspace: TaskWorkspace | undefined,
  projection: WorkspacePrepareProjection | undefined,
  planConfirmed: boolean,
): Record<string, ActionAvailability> {
  const outcome: WorkspacePrepareProjection['outcome'] = projection?.outcome
    ?? (workspace === undefined || workspace.state === 'not_started' || workspace.state === 'cleaned'
      ? 'none'
      : workspace.state === 'ready'
        ? 'ready'
        : workspace.state === 'preparing'
          ? 'preparing'
          : workspace.state === 'unknown'
            ? 'unknown'
            : workspace.state === 'partial'
              ? 'partial'
              : 'failed');
  const requestKeyNote = projection?.requestKey === undefined ? '' : `（原请求号 ${projection.requestKey}）`;
  const failureNote = projection?.errorCode === undefined ? '' : `（${projection.errorCode}${projection.errorMessage === undefined ? '' : ` · ${projection.errorMessage}`}）`;
  const actions: Record<string, ActionAvailability> = {};
  actions.prepareWorkspace = !planConfirmed
    ? denied(Rationale.PLAN_NOT_CONFIRMED, '计划尚未确认，不能准备工作区')
    : outcome === 'none'
      ? allowed()
      : outcome === 'ready'
        ? denied(Rationale.WORKSPACE_NOT_READY, '工作区已准备')
        : outcome === 'preparing'
          ? denied(Rationale.OPERATION_IN_PROGRESS, '工作区准备中，等待服务回执')
          : outcome === 'unknown'
            ? denied(Rationale.ROUND_UNKNOWN, `工作区创建结果待核对${requestKeyNote}：只按原创建请求号核对，不能再准备新的工作区`)
            : outcome === 'partial'
              ? denied('WORKSPACE_PARTIAL', '工作区部分创建：先补建工作目录，不要重复准备完整工作区')
              : outcome === 'conflict'
                ? denied('WORKSPACE_CONFLICT', '存在同名分支或 worktree：先核对同名对象后再决定是否重新准备')
                : outcome === 'drift'
                  ? denied('STALE_TARGET', '基线已前移：先重读基线并按当前基线重新预览')
                  : outcome === 'denied'
                    ? denied('PERMISSION_DENIED', '没有项目读取权限：先按授权说明处理并重新读取工作区')
                    : outcome === 'empty'
                      ? denied('WORKSPACE_PREPARE_FAILED', 'Git 空仓库没有可固定基线：不能准备独立工作区，请从“开始任务”新建或先初始化仓库')
                      : outcome === 'unavailable'
                        ? denied('CAPABILITY_UNAVAILABLE', '工作区准备能力不可用（例如非 Git 目录适配未接通）：不是前端可修复项；等能力接通后再准备')
                      : denied('WORKSPACE_PREPARE_FAILED', `上次准备明确失败${failureNote}：核对后按“重试准备”重新发起（新请求号）`);
  actions.reconcilePrepare = outcome === 'unknown' ? allowed() : denied(Rationale.ROUND_UNKNOWN, '当前没有待核对的工作区创建请求');
  actions.repairPrepare = outcome === 'partial' ? allowed() : denied('WORKSPACE_PARTIAL', '当前不是部分创建，无需补建工作目录');
  // task-7 服务层已支持 name override：冲突态可用“使用新名称重新预览”生成 -2 名称后再次确认准备。
  actions.renameWorkspace = outcome === 'conflict'
    ? allowed()
    : denied('WORKSPACE_CONFLICT', '当前没有同名冲突');
  actions.rereadBaseline = outcome === 'drift' ? allowed() : denied('STALE_TARGET', '当前没有基线漂移，无需重读基线');
  actions.rereadWorkspace = outcome === 'denied' || outcome === 'conflict' || outcome === 'failed'
    ? allowed()
    : denied(Rationale.WORKSPACE_NOT_READY, '当前没有需要重新读取的工作区异常');
  actions.newTaskFromEmpty = outcome === 'empty' ? allowed() : denied('WORKSPACE_PREPARE_FAILED', '只有空仓库场景需要从“开始任务”新建');
  actions.retryPrepare = outcome === 'failed' ? allowed() : denied('WORKSPACE_PREPARE_FAILED', '上次准备不是明确失败，不能直接重试');
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
  readonly runtimeAttention?: 'waiting_user' | 'unknown';
  readonly round?: PlanningRound;
  readonly execution?: ExecutionView;
  readonly workspace?: TaskWorkspace;
  readonly delivery?: TaskDelivery;
}): { attention: Task['attention']; reason?: string } {
  const { task, round, execution, workspace, delivery } = input;
  if (task.lifecycle !== TaskLifecycle.ACTIVE) return { attention: TaskAttention.NONE };
  if (task.readOnly === true) return { attention: TaskAttention.WAITING_USER, reason: '只读验证草稿待人工核对' };
  if (round !== undefined && isPlanningRoundUnknown(round)) return { attention: TaskAttention.UNKNOWN, reason: '规划结果待核对' };
  if (round !== undefined && hasPendingPlanningQuestions(round)) return { attention: TaskAttention.WAITING_USER, reason: '有必须答复的问题' };
  if (round !== undefined && hasPendingPlanningReview(round)) return { attention: TaskAttention.WAITING_USER, reason: '候选待审阅' };
  if (input.runtimeAttention === 'unknown') return { attention: TaskAttention.UNKNOWN, reason: '运行时互动结果待核对' };
  if (input.runtimeAttention === 'waiting_user') return { attention: TaskAttention.WAITING_USER, reason: '运行时正在等待答复' };
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
