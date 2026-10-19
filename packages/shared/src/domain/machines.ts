import { AppError, ErrorCode } from '../errors.ts';
import {
  DeliveryProjection,
  ExecutionStatus,
  FixRunState,
  NodeStatus,
  PlanRevisionStatus,
  PlanningRunStatus,
  PlanningStage,
  ReceiptStatus,
  ReviewRunState,
  TaskLifecycle,
  TaskStage,
  WorkspaceState,
  type DeliveryProjectionValue,
  type ExecutionStatusValue,
  type FixRunStateValue,
  type NodeStatusValue,
  type PlanRevisionStatusValue,
  type PlanningRunStatusValue,
  type PlanningStageValue,
  type ReceiptStatusValue,
  type ReviewRunStateValue,
  type TaskLifecycleValue,
  type TaskStageValue,
  type WorkspaceStateValue,
} from './enums.ts';

/**
 * Small declarative state machine used across the domain. Transition lists are
 * the single authority for "which changes are legal"; services assert them
 * before persisting, UI derives disabled actions from the same definitions.
 */
export interface TransitionDef<S extends string> {
  readonly from: readonly S[];
  readonly to: S;
  readonly event: string;
  readonly description: string;
}

export interface StateMachineDef<S extends string> {
  readonly id: string;
  readonly initial: S;
  readonly states: readonly S[];
  readonly terminal: readonly S[];
  readonly transitions: readonly TransitionDef<S>[];
}

export type TransitionResult<S extends string> = { ok: true; to: S } | { ok: false; reason: string };

export function findTransition<S extends string>(def: StateMachineDef<S>, from: S, to: S): TransitionDef<S> | undefined {
  return def.transitions.find((t) => t.to === to && t.from.includes(from));
}

export function canTransition<S extends string>(def: StateMachineDef<S>, from: S, to: S): boolean {
  return findTransition(def, from, to) !== undefined;
}

export function nextStates<S extends string>(def: StateMachineDef<S>, from: S): readonly S[] {
  return def.transitions.filter((t) => t.from.includes(from)).map((t) => t.to);
}

export function transitionEvent<S extends string>(def: StateMachineDef<S>, from: S, to: S): string | undefined {
  return findTransition(def, from, to)?.event;
}

export function assertTransition<S extends string>(def: StateMachineDef<S>, from: S, to: S, errorCode = ErrorCode.CONFLICT): S {
  if (!canTransition(def, from, to)) {
    throw new AppError(errorCode, `状态不能从 ${from} 变为 ${to}（${def.id}）`, {
      details: { machine: def.id, from, to, allowed: nextStates(def, from) },
    });
  }
  return to;
}

export function isTerminal<S extends string>(def: StateMachineDef<S>, state: S): boolean {
  return def.terminal.includes(state);
}

export const taskStageMachine: StateMachineDef<TaskStageValue> = {
  id: 'task.stage',
  initial: TaskStage.DRAFT,
  states: [TaskStage.DRAFT, TaskStage.PLANNING, TaskStage.CONFIRMING, TaskStage.PREPARING, TaskStage.EXECUTING],
  terminal: [],
  transitions: [
    t([TaskStage.DRAFT], TaskStage.PLANNING, 'planning.start', '开始 AI 规划'),
    t([TaskStage.DRAFT], TaskStage.CONFIRMING, 'plan.skeleton.use', '使用方法骨架'),
    t([TaskStage.PLANNING], TaskStage.CONFIRMING, 'planning.apply', '应用候选到草稿'),
    t([TaskStage.PLANNING], TaskStage.CONFIRMING, 'plan.skeleton.use', '规划中改用方法骨架'),
    t([TaskStage.CONFIRMING], TaskStage.PLANNING, 'planning.start', '从确认计划重新规划'),
    t([TaskStage.CONFIRMING], TaskStage.DRAFT, 'plan.reset', '撤销未确认草稿回到需求草稿'),
    t([TaskStage.CONFIRMING], TaskStage.PREPARING, 'plan.confirm', '确认计划'),
    t([TaskStage.PREPARING], TaskStage.CONFIRMING, 'plan.reconfirm', '计划变更后回到确认'),
    t([TaskStage.PREPARING], TaskStage.EXECUTING, 'execution.start', '开始执行'),
    t([TaskStage.EXECUTING], TaskStage.CONFIRMING, 'plan.edit.abandon', '放弃执行中调整并回到确认'),
  ],
};

export const taskLifecycleMachine: StateMachineDef<TaskLifecycleValue> = {
  id: 'task.lifecycle',
  initial: TaskLifecycle.ACTIVE,
  states: [TaskLifecycle.ACTIVE, TaskLifecycle.COMPLETED, TaskLifecycle.CANCELLED],
  terminal: [TaskLifecycle.COMPLETED, TaskLifecycle.CANCELLED],
  transitions: [
    t([TaskLifecycle.ACTIVE], TaskLifecycle.COMPLETED, 'task.complete', '任务交付完成'),
    t([TaskLifecycle.ACTIVE], TaskLifecycle.CANCELLED, 'task.cancel', '取消任务'),
  ],
};

export const planningRunMachine: StateMachineDef<PlanningRunStatusValue> = {
  id: 'planning.run',
  initial: PlanningRunStatus.QUEUED,
  states: [
    PlanningRunStatus.QUEUED,
    PlanningRunStatus.RUNNING,
    PlanningRunStatus.STOPPING,
    PlanningRunStatus.STOPPED,
    PlanningRunStatus.FAILED,
    PlanningRunStatus.UNKNOWN,
    PlanningRunStatus.COMPLETED,
  ],
  terminal: [PlanningRunStatus.STOPPED, PlanningRunStatus.FAILED, PlanningRunStatus.COMPLETED],
  transitions: [
    t([PlanningRunStatus.QUEUED], PlanningRunStatus.RUNNING, 'planning.dispatch', '派发到 OpenCode'),
    t([PlanningRunStatus.QUEUED], PlanningRunStatus.FAILED, 'planning.fail', '派发前失败'),
    t([PlanningRunStatus.RUNNING], PlanningRunStatus.STOPPING, 'planning.stop', '请求停止'),
    t([PlanningRunStatus.RUNNING], PlanningRunStatus.FAILED, 'planning.fail', '规划失败'),
    t([PlanningRunStatus.RUNNING], PlanningRunStatus.UNKNOWN, 'planning.unknown', '结果不明'),
    t([PlanningRunStatus.RUNNING], PlanningRunStatus.COMPLETED, 'planning.complete', '候选与检查完成'),
    t([PlanningRunStatus.STOPPING], PlanningRunStatus.STOPPED, 'planning.stopped', '进程停稳且用量结账'),
    t([PlanningRunStatus.STOPPING], PlanningRunStatus.UNKNOWN, 'planning.unknown', '停止回执不明'),
    t([PlanningRunStatus.UNKNOWN], PlanningRunStatus.RUNNING, 'planning.reconcile.running', '核对确认原轮仍在运行'),
    t([PlanningRunStatus.UNKNOWN], PlanningRunStatus.STOPPED, 'planning.reconcile.stopped', '核对确认已停稳'),
    t([PlanningRunStatus.UNKNOWN], PlanningRunStatus.FAILED, 'planning.reconcile.failed', '核对确认失败'),
    t([PlanningRunStatus.UNKNOWN], PlanningRunStatus.COMPLETED, 'planning.reconcile.completed', '核对确认已完成'),
    // A completed run may be stopped for accounting or re-checked after a restart.
    t([PlanningRunStatus.COMPLETED], PlanningRunStatus.UNKNOWN, 'planning.unknown', '结账结果不明'),
  ],
};

export const planningStageOrder: readonly PlanningStageValue[] = [
  PlanningStage.PREPARING_INPUT,
  PlanningStage.GENERATING,
  PlanningStage.VALIDATING,
  PlanningStage.AWAITING_REVIEW,
];

export const planningStageMachine: StateMachineDef<PlanningStageValue> = {
  id: 'planning.stage',
  initial: PlanningStage.PREPARING_INPUT,
  states: [
    PlanningStage.PREPARING_INPUT,
    PlanningStage.GENERATING,
    PlanningStage.VALIDATING,
    PlanningStage.REVISING,
    PlanningStage.AWAITING_REVIEW,
    PlanningStage.NEEDS_ANSWER,
    PlanningStage.DONE,
    PlanningStage.STOPPED,
    PlanningStage.FAILED,
    PlanningStage.UNKNOWN,
  ],
  terminal: [PlanningStage.DONE, PlanningStage.STOPPED, PlanningStage.FAILED],
  transitions: [
    t([PlanningStage.PREPARING_INPUT], PlanningStage.GENERATING, 'planning.generate', '输入就绪，开始生成'),
    t([PlanningStage.GENERATING], PlanningStage.VALIDATING, 'planning.candidate', '候选生成完毕'),
    t([PlanningStage.GENERATING], PlanningStage.REVISING, 'planning.revise', '生成后需有界修订'),
    t([PlanningStage.VALIDATING], PlanningStage.REVISING, 'planning.revise', '检查发现问题，有界修订'),
    t([PlanningStage.VALIDATING], PlanningStage.AWAITING_REVIEW, 'planning.review', '检查完成，等待审阅'),
    t([PlanningStage.VALIDATING], PlanningStage.NEEDS_ANSWER, 'planning.answer', '有必须答复的问题'),
    t([PlanningStage.REVISING], PlanningStage.VALIDATING, 'planning.revise.done', '修订完成，重新检查'),
    t([PlanningStage.AWAITING_REVIEW], PlanningStage.GENERATING, 'planning.generate', '新一轮规划'),
    t([PlanningStage.NEEDS_ANSWER], PlanningStage.GENERATING, 'planning.answer.saved', '答复已保存，预览新一轮'),
    t(
      [
        PlanningStage.PREPARING_INPUT,
        PlanningStage.GENERATING,
        PlanningStage.VALIDATING,
        PlanningStage.REVISING,
        PlanningStage.AWAITING_REVIEW,
        PlanningStage.NEEDS_ANSWER,
      ],
      PlanningStage.STOPPED,
      'planning.stop.settled',
      '停止并结账',
    ),
    t(
      [
        PlanningStage.PREPARING_INPUT,
        PlanningStage.GENERATING,
        PlanningStage.VALIDATING,
        PlanningStage.REVISING,
      ],
      PlanningStage.FAILED,
      'planning.fail.settled',
      '明确失败',
    ),
    t(
      [PlanningStage.PREPARING_INPUT, PlanningStage.GENERATING, PlanningStage.VALIDATING, PlanningStage.REVISING, PlanningStage.AWAITING_REVIEW],
      PlanningStage.UNKNOWN,
      'planning.unknown',
      '结果不明',
    ),
    t([PlanningStage.UNKNOWN], PlanningStage.AWAITING_REVIEW, 'planning.reconcile.review', '核对确认候选可用'),
    t([PlanningStage.UNKNOWN], PlanningStage.STOPPED, 'planning.reconcile.stopped', '核对确认已停止'),
    t([PlanningStage.UNKNOWN], PlanningStage.FAILED, 'planning.reconcile.failed', '核对确认失败'),
    t([PlanningStage.AWAITING_REVIEW], PlanningStage.DONE, 'planning.applied', '候选已应用'),
  ],
};

export const planRevisionMachine: StateMachineDef<PlanRevisionStatusValue> = {
  id: 'plan.revision',
  initial: PlanRevisionStatus.DRAFT,
  states: [PlanRevisionStatus.DRAFT, PlanRevisionStatus.UNCONFIRMED, PlanRevisionStatus.CONFIRMED, PlanRevisionStatus.SUPERSEDED],
  terminal: [PlanRevisionStatus.SUPERSEDED],
  transitions: [
    t([PlanRevisionStatus.DRAFT], PlanRevisionStatus.UNCONFIRMED, 'plan.materialize', '草稿可确认'),
    t([PlanRevisionStatus.DRAFT], PlanRevisionStatus.SUPERSEDED, 'plan.supersede', '被新修订替代'),
    t([PlanRevisionStatus.UNCONFIRMED], PlanRevisionStatus.CONFIRMED, 'plan.confirm', '确认计划'),
    t([PlanRevisionStatus.UNCONFIRMED], PlanRevisionStatus.SUPERSEDED, 'plan.supersede', '被新修订替代'),
    t([PlanRevisionStatus.CONFIRMED], PlanRevisionStatus.UNCONFIRMED, 'plan.reopen', '计划变更后重新确认'),
    t([PlanRevisionStatus.CONFIRMED], PlanRevisionStatus.SUPERSEDED, 'plan.supersede', '被新修订替代'),
  ],
};

export const executionMachine: StateMachineDef<ExecutionStatusValue> = {
  id: 'execution',
  initial: ExecutionStatus.IDLE,
  states: [
    ExecutionStatus.IDLE,
    ExecutionStatus.READY,
    ExecutionStatus.RUNNING,
    ExecutionStatus.PAUSING,
    ExecutionStatus.PAUSED,
    ExecutionStatus.WAITING_CONFIRMATION,
    ExecutionStatus.STOPPING,
    ExecutionStatus.STOPPED,
    ExecutionStatus.COMPLETED,
    ExecutionStatus.FAILED,
    ExecutionStatus.UNKNOWN,
  ],
  terminal: [ExecutionStatus.COMPLETED, ExecutionStatus.STOPPED, ExecutionStatus.FAILED],
  transitions: [
    t([ExecutionStatus.IDLE], ExecutionStatus.READY, 'execution.ready', '计划确认且工作区已准备'),
    t([ExecutionStatus.READY], ExecutionStatus.RUNNING, 'execution.start', '开始执行'),
    t([ExecutionStatus.RUNNING], ExecutionStatus.PAUSING, 'execution.pause', '请求暂停新增领取'),
    t([ExecutionStatus.PAUSING], ExecutionStatus.PAUSED, 'execution.paused', '暂停生效'),
    t([ExecutionStatus.PAUSED], ExecutionStatus.RUNNING, 'execution.resume', '继续执行'),
    t([ExecutionStatus.RUNNING], ExecutionStatus.WAITING_CONFIRMATION, 'plan.edit.saved', '语义变更后等待重新确认'),
    t([ExecutionStatus.WAITING_CONFIRMATION], ExecutionStatus.RUNNING, 'plan.reconfirmed', '重新确认并继续'),
    t([ExecutionStatus.RUNNING], ExecutionStatus.STOPPING, 'execution.cancel', '请求停止执行'),
    t([ExecutionStatus.PAUSING], ExecutionStatus.STOPPING, 'execution.cancel', '暂停中转为停止'),
    t([ExecutionStatus.STOPPING], ExecutionStatus.STOPPED, 'execution.stopped', '已停稳'),
    t([ExecutionStatus.RUNNING], ExecutionStatus.COMPLETED, 'execution.complete', '全部节点完成且验收通过'),
    t([ExecutionStatus.RUNNING], ExecutionStatus.FAILED, 'execution.fail', '执行失败且无法继续'),
    t([ExecutionStatus.PAUSING], ExecutionStatus.UNKNOWN, 'execution.unknown', '暂停回执不明'),
    t([ExecutionStatus.STOPPING], ExecutionStatus.UNKNOWN, 'execution.unknown', '停止回执不明'),
    t([ExecutionStatus.UNKNOWN], ExecutionStatus.RUNNING, 'execution.reconcile.running', '核对确认仍在运行'),
    t([ExecutionStatus.UNKNOWN], ExecutionStatus.STOPPED, 'execution.reconcile.stopped', '核对确认已停止'),
    t([ExecutionStatus.UNKNOWN], ExecutionStatus.FAILED, 'execution.reconcile.failed', '核对确认失败'),
    t([ExecutionStatus.UNKNOWN], ExecutionStatus.COMPLETED, 'execution.reconcile.completed', '核对确认完成'),
  ],
};

export const nodeMachine: StateMachineDef<NodeStatusValue> = {
  id: 'plan.node',
  initial: NodeStatus.PENDING,
  states: [
    NodeStatus.PENDING,
    NodeStatus.READY,
    NodeStatus.RUNNING,
    NodeStatus.SUCCEEDED,
    NodeStatus.FAILED,
    NodeStatus.SKIPPED,
    NodeStatus.CANCELLED,
    NodeStatus.UNKNOWN,
  ],
  terminal: [NodeStatus.SUCCEEDED, NodeStatus.SKIPPED, NodeStatus.CANCELLED],
  transitions: [
    t([NodeStatus.PENDING], NodeStatus.READY, 'node.ready', '依赖满足'),
    t([NodeStatus.PENDING], NodeStatus.SKIPPED, 'node.skip', '跳过'),
    t([NodeStatus.PENDING], NodeStatus.CANCELLED, 'node.cancel', '取消'),
    t([NodeStatus.READY], NodeStatus.RUNNING, 'node.claim', '领取'),
    t([NodeStatus.READY], NodeStatus.CANCELLED, 'node.cancel', '取消'),
    t([NodeStatus.RUNNING], NodeStatus.SUCCEEDED, 'node.succeed', '结果提交且验收通过'),
    t([NodeStatus.RUNNING], NodeStatus.FAILED, 'node.fail', '失败'),
    t([NodeStatus.RUNNING], NodeStatus.CANCELLED, 'node.cancel', '取消'),
    t([NodeStatus.RUNNING], NodeStatus.UNKNOWN, 'node.unknown', '回执不明'),
    t([NodeStatus.FAILED], NodeStatus.READY, 'node.retry', '按原配置重试'),
    t([NodeStatus.FAILED], NodeStatus.CANCELLED, 'node.cancel', '取消'),
    t([NodeStatus.UNKNOWN], NodeStatus.SUCCEEDED, 'node.reconcile.succeeded', '核对确认成功'),
    t([NodeStatus.UNKNOWN], NodeStatus.FAILED, 'node.reconcile.failed', '核对确认失败'),
    t([NodeStatus.UNKNOWN], NodeStatus.RUNNING, 'node.reconcile.running', '核对确认仍在运行'),
  ],
};

export const workspaceMachine: StateMachineDef<WorkspaceStateValue> = {
  id: 'workspace',
  initial: WorkspaceState.NOT_STARTED,
  states: [
    WorkspaceState.NOT_STARTED,
    WorkspaceState.PREPARING,
    WorkspaceState.READY,
    WorkspaceState.PARTIAL,
    WorkspaceState.BLOCKED,
    WorkspaceState.UNKNOWN,
    WorkspaceState.CLEANING,
    WorkspaceState.CLEANED,
  ],
  terminal: [WorkspaceState.CLEANED],
  transitions: [
    t([WorkspaceState.NOT_STARTED], WorkspaceState.PREPARING, 'workspace.prepare', '开始准备'),
    t([WorkspaceState.PREPARING], WorkspaceState.READY, 'workspace.ready', '准备完成'),
    t([WorkspaceState.PREPARING], WorkspaceState.PARTIAL, 'workspace.partial', '部分创建'),
    t([WorkspaceState.PREPARING], WorkspaceState.BLOCKED, 'workspace.blocked', '准备受阻'),
    t([WorkspaceState.PREPARING], WorkspaceState.UNKNOWN, 'workspace.unknown', '准备回执不明'),
    t([WorkspaceState.PARTIAL], WorkspaceState.PREPARING, 'workspace.prepare', '定向重试'),
    t([WorkspaceState.PARTIAL], WorkspaceState.UNKNOWN, 'workspace.unknown', '核对不明'),
    t([WorkspaceState.BLOCKED], WorkspaceState.PREPARING, 'workspace.prepare', '解除阻塞后重试'),
    t([WorkspaceState.UNKNOWN], WorkspaceState.READY, 'workspace.reconcile.ready', '核对确认已准备'),
    t([WorkspaceState.UNKNOWN], WorkspaceState.PARTIAL, 'workspace.reconcile.partial', '核对确认部分创建'),
    t([WorkspaceState.UNKNOWN], WorkspaceState.NOT_STARTED, 'workspace.reconcile.none', '核对确认未创建'),
    t([WorkspaceState.READY], WorkspaceState.CLEANING, 'workspace.cleanup', '开始清理'),
    t([WorkspaceState.CLEANING], WorkspaceState.CLEANED, 'workspace.cleaned', '清理完成'),
    t([WorkspaceState.CLEANING], WorkspaceState.PARTIAL, 'workspace.cleanup.partial', '部分清理'),
    t([WorkspaceState.CLEANING], WorkspaceState.UNKNOWN, 'workspace.unknown', '清理回执不明'),
  ],
};

export const receiptMachine: StateMachineDef<ReceiptStatusValue> = {
  id: 'receipt',
  initial: ReceiptStatus.ACCEPTED,
  states: [ReceiptStatus.ACCEPTED, ReceiptStatus.SUCCEEDED, ReceiptStatus.FAILED, ReceiptStatus.UNKNOWN],
  terminal: [ReceiptStatus.SUCCEEDED, ReceiptStatus.FAILED],
  transitions: [
    t([ReceiptStatus.ACCEPTED], ReceiptStatus.SUCCEEDED, 'receipt.succeed', '副作用已确认'),
    t([ReceiptStatus.ACCEPTED], ReceiptStatus.FAILED, 'receipt.fail', '明确失败'),
    t([ReceiptStatus.ACCEPTED], ReceiptStatus.UNKNOWN, 'receipt.unknown', '回执不明'),
    t([ReceiptStatus.UNKNOWN], ReceiptStatus.SUCCEEDED, 'receipt.reconcile.succeeded', '核对确认成功'),
    t([ReceiptStatus.UNKNOWN], ReceiptStatus.FAILED, 'receipt.reconcile.failed', '核对确认失败'),
  ],
};

export const deliveryMachine: StateMachineDef<DeliveryProjectionValue> = {
  id: 'delivery.projection',
  initial: DeliveryProjection.AWAITING_SELECTION,
  states: [
    DeliveryProjection.AWAITING_SELECTION,
    DeliveryProjection.AWAITING_CONFIRMATION,
    DeliveryProjection.IN_PROGRESS,
    DeliveryProjection.BLOCKED,
    DeliveryProjection.UNKNOWN_RECEIPT,
    DeliveryProjection.DELIVERED,
  ],
  terminal: [DeliveryProjection.DELIVERED],
  transitions: [
    t([DeliveryProjection.AWAITING_SELECTION], DeliveryProjection.AWAITING_CONFIRMATION, 'delivery.select', '已选择目标与范围'),
    t([DeliveryProjection.AWAITING_CONFIRMATION], DeliveryProjection.IN_PROGRESS, 'delivery.command', '命令已受理'),
    t([DeliveryProjection.IN_PROGRESS], DeliveryProjection.AWAITING_CONFIRMATION, 'delivery.step.done', '某步完成，等待下一步确认'),
    t([DeliveryProjection.IN_PROGRESS], DeliveryProjection.UNKNOWN_RECEIPT, 'delivery.unknown', '回执不明'),
    t([DeliveryProjection.IN_PROGRESS], DeliveryProjection.BLOCKED, 'delivery.blocked', '版本漂移 / 冲突 / 权限'),
    t([DeliveryProjection.AWAITING_CONFIRMATION], DeliveryProjection.BLOCKED, 'delivery.blocked', '前置条件缺失'),
    t([DeliveryProjection.IN_PROGRESS], DeliveryProjection.DELIVERED, 'delivery.settled', '完成结算'),
    t([DeliveryProjection.UNKNOWN_RECEIPT], DeliveryProjection.DELIVERED, 'delivery.settled', '核对后结算'),
    t([DeliveryProjection.UNKNOWN_RECEIPT], DeliveryProjection.BLOCKED, 'delivery.blocked', '核对后仍受阻'),
    t([DeliveryProjection.BLOCKED], DeliveryProjection.AWAITING_CONFIRMATION, 'delivery.unblock', '阻塞解除，重新确认'),
    t([DeliveryProjection.BLOCKED], DeliveryProjection.DELIVERED, 'delivery.settled', '完成结算'),
  ],
};

export const reviewRunMachine: StateMachineDef<ReviewRunStateValue> = {
  id: 'review.run',
  initial: ReviewRunState.QUEUED,
  states: [
    ReviewRunState.QUEUED,
    ReviewRunState.RUNNING,
    ReviewRunState.STOPPING,
    ReviewRunState.COMPLETED,
    ReviewRunState.FAILED,
    ReviewRunState.STOPPED,
    ReviewRunState.UNKNOWN,
  ],
  terminal: [ReviewRunState.COMPLETED, ReviewRunState.FAILED, ReviewRunState.STOPPED],
  transitions: [
    t([ReviewRunState.QUEUED], ReviewRunState.RUNNING, 'review.start', '开始审查'),
    t([ReviewRunState.QUEUED], ReviewRunState.FAILED, 'review.fail', '启动失败'),
    t([ReviewRunState.RUNNING], ReviewRunState.STOPPING, 'review.stop', '请求停止'),
    t([ReviewRunState.RUNNING], ReviewRunState.COMPLETED, 'review.complete', '审查完成'),
    t([ReviewRunState.RUNNING], ReviewRunState.FAILED, 'review.fail', '审查失败'),
    t([ReviewRunState.RUNNING], ReviewRunState.UNKNOWN, 'review.unknown', '结果不明'),
    t([ReviewRunState.STOPPING], ReviewRunState.STOPPED, 'review.stopped', '已停止'),
    t([ReviewRunState.STOPPING], ReviewRunState.UNKNOWN, 'review.unknown', '停止不明'),
    t([ReviewRunState.UNKNOWN], ReviewRunState.COMPLETED, 'review.reconcile.completed', '核对确认完成'),
    t([ReviewRunState.UNKNOWN], ReviewRunState.FAILED, 'review.reconcile.failed', '核对确认失败'),
    t([ReviewRunState.UNKNOWN], ReviewRunState.STOPPED, 'review.reconcile.stopped', '核对确认停止'),
  ],
};

export const fixRunMachine: StateMachineDef<FixRunStateValue> = {
  id: 'fix.run',
  initial: FixRunState.PREPARING,
  states: [
    FixRunState.PREPARING,
    FixRunState.EDITING,
    FixRunState.VERIFYING,
    FixRunState.READY,
    FixRunState.NO_CHANGES,
    FixRunState.FAILED,
    FixRunState.STOPPING,
    FixRunState.STOPPED,
    FixRunState.DISCARDED,
    FixRunState.UNKNOWN,
  ],
  terminal: [FixRunState.READY, FixRunState.NO_CHANGES, FixRunState.FAILED, FixRunState.STOPPED, FixRunState.DISCARDED],
  transitions: [
    t([FixRunState.PREPARING], FixRunState.EDITING, 'fix.ready', '修复工作区就绪'),
    t([FixRunState.PREPARING], FixRunState.FAILED, 'fix.fail', '准备失败'),
    t([FixRunState.EDITING], FixRunState.VERIFYING, 'fix.verify', '开始校验'),
    t([FixRunState.EDITING], FixRunState.READY, 'fix.done', '修改完成'),
    t([FixRunState.EDITING], FixRunState.NO_CHANGES, 'fix.noChanges', '无改动'),
    t([FixRunState.EDITING], FixRunState.FAILED, 'fix.fail', '修复失败'),
    t([FixRunState.EDITING], FixRunState.STOPPING, 'fix.stop', '请求停止'),
    t([FixRunState.VERIFYING], FixRunState.READY, 'fix.done', '校验并完成'),
    t([FixRunState.VERIFYING], FixRunState.FAILED, 'fix.fail', '校验失败'),
    t([FixRunState.VERIFYING], FixRunState.STOPPING, 'fix.stop', '请求停止'),
    t([FixRunState.STOPPING], FixRunState.STOPPED, 'fix.stopped', '已停止'),
    t([FixRunState.STOPPING], FixRunState.UNKNOWN, 'fix.unknown', '停止不明'),
    t([FixRunState.STOPPING], FixRunState.READY, 'fix.reconcile.ready', '核对确认已就绪'),
    t([FixRunState.UNKNOWN], FixRunState.READY, 'fix.reconcile.ready', '核对确认已就绪'),
    t([FixRunState.UNKNOWN], FixRunState.FAILED, 'fix.reconcile.failed', '核对确认失败'),
    t([FixRunState.UNKNOWN], FixRunState.STOPPED, 'fix.reconcile.stopped', '核对确认停止'),
    t([FixRunState.READY], FixRunState.DISCARDED, 'fix.discard', '放弃修复'),
    t([FixRunState.STOPPED], FixRunState.DISCARDED, 'fix.discard', '放弃修复'),
    t([FixRunState.NO_CHANGES], FixRunState.DISCARDED, 'fix.discard', '放弃修复'),
  ],
};

export const MACHINES = {
  'task.stage': taskStageMachine,
  'task.lifecycle': taskLifecycleMachine,
  'planning.run': planningRunMachine,
  'planning.stage': planningStageMachine,
  'plan.revision': planRevisionMachine,
  execution: executionMachine,
  'plan.node': nodeMachine,
  workspace: workspaceMachine,
  receipt: receiptMachine,
  'delivery.projection': deliveryMachine,
  'review.run': reviewRunMachine,
  'fix.run': fixRunMachine,
} as const;

function t<S extends string>(from: readonly S[], to: S, event: string, description: string): TransitionDef<S> {
  return { from, to, event, description };
}

export function describeMachine<S extends string>(def: StateMachineDef<S>): string {
  return [
    `# ${def.id}`,
    `initial: ${def.initial}`,
    ...def.transitions.map((tr) => `${tr.from.join('|')} --${tr.event}--> ${tr.to} (${tr.description})`),
  ].join('\n');
}
