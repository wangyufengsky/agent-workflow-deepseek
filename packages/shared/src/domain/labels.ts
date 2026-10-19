import {
  DeliveryGoal,
  DeliveryProjection,
  ExecutionStatus,
  FindingStatus,
  FixOutcome,
  FixRunState,
  NodeStatus,
  PlanRevisionStatus,
  PlanningRunStatus,
  PlanningStage,
  ReviewRunState,
  Severity,
  TaskAttention,
  TaskLifecycle,
  TaskStage,
  WorkspaceState,
  type DeliveryGoalValue,
  type DeliveryProjectionValue,
  type ExecutionStatusValue,
  type FindingStatusValue,
  type FixOutcomeValue,
  type FixRunStateValue,
  type NodeStatusValue,
  type PlanRevisionStatusValue,
  type PlanningRunStatusValue,
  type PlanningStageValue,
  type ReviewRunStateValue,
  type SeverityValue,
  type TaskAttentionValue,
  type TaskLifecycleValue,
  type TaskStageValue,
  type WorkspaceStateValue,
} from './enums.ts';

/** Chinese product labels from the design showcase. UI must use these, not ad-hoc strings. */
export const TASK_STAGE_LABEL: Record<TaskStageValue, string> = {
  [TaskStage.DRAFT]: '需求草稿',
  [TaskStage.PLANNING]: '规划',
  [TaskStage.CONFIRMING]: '确认计划',
  [TaskStage.PREPARING]: '准备工作区',
  [TaskStage.EXECUTING]: '开始执行',
};

export const TASK_LIFECYCLE_LABEL: Record<TaskLifecycleValue, string> = {
  [TaskLifecycle.ACTIVE]: '进行中',
  [TaskLifecycle.COMPLETED]: '已完成',
  [TaskLifecycle.CANCELLED]: '已取消',
};

export const TASK_ATTENTION_LABEL: Record<TaskAttentionValue, string> = {
  [TaskAttention.NONE]: '',
  [TaskAttention.WAITING_USER]: '需要你处理',
  [TaskAttention.BLOCKED]: '受阻',
  [TaskAttention.FAILED]: '失败',
  [TaskAttention.UNKNOWN]: '待核对',
};

export const PLANNING_STATUS_LABEL: Record<PlanningRunStatusValue, string> = {
  [PlanningRunStatus.QUEUED]: '排队中',
  [PlanningRunStatus.RUNNING]: '规划中',
  [PlanningRunStatus.STOPPING]: '正在停止',
  [PlanningRunStatus.STOPPED]: '已停止',
  [PlanningRunStatus.FAILED]: '失败',
  [PlanningRunStatus.UNKNOWN]: '待核对',
  [PlanningRunStatus.COMPLETED]: '已完成',
};

export const PLANNING_STAGE_LABEL: Record<PlanningStageValue, string> = {
  [PlanningStage.PREPARING_INPUT]: '准备输入',
  [PlanningStage.GENERATING]: '生成候选',
  [PlanningStage.VALIDATING]: '检查计划',
  [PlanningStage.REVISING]: '修订候选',
  [PlanningStage.AWAITING_REVIEW]: '等待审阅',
  [PlanningStage.NEEDS_ANSWER]: '需要你答复',
  [PlanningStage.DONE]: '已完成',
  [PlanningStage.STOPPED]: '已停止',
  [PlanningStage.FAILED]: '失败',
  [PlanningStage.UNKNOWN]: '待核对',
};

export const PLAN_REVISION_STATUS_LABEL: Record<PlanRevisionStatusValue, string> = {
  [PlanRevisionStatus.DRAFT]: '草稿',
  [PlanRevisionStatus.UNCONFIRMED]: '未确认',
  [PlanRevisionStatus.CONFIRMED]: '已确认',
  [PlanRevisionStatus.SUPERSEDED]: '已被替代',
};

export const NODE_STATUS_LABEL: Record<NodeStatusValue, string> = {
  [NodeStatus.PENDING]: '待执行',
  [NodeStatus.READY]: '可执行',
  [NodeStatus.RUNNING]: '执行中',
  [NodeStatus.SUCCEEDED]: '已完成',
  [NodeStatus.FAILED]: '失败',
  [NodeStatus.SKIPPED]: '已跳过',
  [NodeStatus.CANCELLED]: '已取消',
  [NodeStatus.UNKNOWN]: '未知',
};

export const EXECUTION_STATUS_LABEL: Record<ExecutionStatusValue, string> = {
  [ExecutionStatus.IDLE]: '未开始',
  [ExecutionStatus.READY]: '可开始',
  [ExecutionStatus.RUNNING]: '执行中',
  [ExecutionStatus.PAUSING]: '正在暂停',
  [ExecutionStatus.PAUSED]: '已暂停',
  [ExecutionStatus.WAITING_CONFIRMATION]: '等待重新确认',
  [ExecutionStatus.STOPPING]: '正在停止',
  [ExecutionStatus.STOPPED]: '已停止',
  [ExecutionStatus.COMPLETED]: '已完成',
  [ExecutionStatus.FAILED]: '失败',
  [ExecutionStatus.UNKNOWN]: '待核对',
};

export const WORKSPACE_STATE_LABEL: Record<WorkspaceStateValue, string> = {
  [WorkspaceState.NOT_STARTED]: '未准备',
  [WorkspaceState.PREPARING]: '准备中',
  [WorkspaceState.READY]: '已准备',
  [WorkspaceState.PARTIAL]: '部分创建',
  [WorkspaceState.BLOCKED]: '受阻',
  [WorkspaceState.UNKNOWN]: '待核对',
  [WorkspaceState.CLEANING]: '清理中',
  [WorkspaceState.CLEANED]: '已清理',
};

export const DELIVERY_GOAL_LABEL: Record<DeliveryGoalValue, string> = {
  [DeliveryGoal.LOCAL_COMMIT]: '仅提交到本地',
  [DeliveryGoal.PUSH_BRANCH]: '推送到远端分支',
  [DeliveryGoal.CREATE_MERGE_REQUEST]: '创建合并请求',
  [DeliveryGoal.APPLY_TO_ORIGINAL]: '应用到原目录',
};

export const DELIVERY_PROJECTION_LABEL: Record<DeliveryProjectionValue, string> = {
  [DeliveryProjection.AWAITING_SELECTION]: '执行已结束 · 等待交付',
  [DeliveryProjection.AWAITING_CONFIRMATION]: '等待确认下一步',
  [DeliveryProjection.IN_PROGRESS]: '交付进行中',
  [DeliveryProjection.BLOCKED]: '交付受阻',
  [DeliveryProjection.UNKNOWN_RECEIPT]: '结果待核对',
  [DeliveryProjection.DELIVERED]: '任务已交付',
};

export const SEVERITY_LABEL: Record<SeverityValue, string> = {
  [Severity.BLOCKER]: '阻断',
  [Severity.CRITICAL]: '严重',
  [Severity.MAJOR]: '一般',
  [Severity.SUGGESTION]: '建议',
};

export const REVIEW_STATE_LABEL: Record<ReviewRunStateValue, string> = {
  [ReviewRunState.QUEUED]: '排队中',
  [ReviewRunState.RUNNING]: '审查中',
  [ReviewRunState.STOPPING]: '正在停止',
  [ReviewRunState.COMPLETED]: '已完成',
  [ReviewRunState.FAILED]: '失败',
  [ReviewRunState.STOPPED]: '已停止',
  [ReviewRunState.UNKNOWN]: '待核对',
};

export const FINDING_STATUS_LABEL: Record<FindingStatusValue, string> = {
  [FindingStatus.OPEN]: '待处理',
  [FindingStatus.ACCEPTED]: '接受',
  [FindingStatus.DISMISSED]: '忽略',
  [FindingStatus.FALSE_POSITIVE]: '误报',
};

export const FIX_STATE_LABEL: Record<FixRunStateValue, string> = {
  [FixRunState.PREPARING]: '准备修复分支',
  [FixRunState.EDITING]: '修改中',
  [FixRunState.VERIFYING]: '校验中',
  [FixRunState.READY]: '修复完成',
  [FixRunState.NO_CHANGES]: '修复无改动',
  [FixRunState.FAILED]: '修复失败',
  [FixRunState.STOPPING]: '正在停止',
  [FixRunState.STOPPED]: '已停止',
  [FixRunState.DISCARDED]: '已放弃',
  [FixRunState.UNKNOWN]: '待核对',
};

export const FIX_OUTCOME_LABEL: Record<FixOutcomeValue, string> = {
  [FixOutcome.FIXED]: '已修复',
  [FixOutcome.PARTIAL]: '部分修复',
  [FixOutcome.NOT_FIXED]: '未修复',
};

export function labelFor<T extends string>(map: Record<T, string>, value: T | null | undefined): string {
  return value === null || value === undefined ? '未知' : (map[value] ?? value);
}
