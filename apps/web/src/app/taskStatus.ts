import {
  taskListGroup,
  taskStepCaption,
  DELIVERY_PROJECTION_LABEL,
  EXECUTION_STATUS_LABEL,
  PLANNING_STAGE_LABEL,
  PLANNING_STATUS_LABEL,
  TASK_ATTENTION_LABEL,
  TASK_LIFECYCLE_LABEL,
  TaskAttention,
  TaskLifecycle,
  TaskStage,
  type InboxItem,
  type InboxKindValue,
  type DeliveryProjectionValue,
  type PlanningRunStatusValue,
  type PlanningStageValue,
  type TaskAttentionValue,
  type TaskStageValue,
  type TaskSummary,
} from '@agent-workflow/shared';
import type { BadgeTone } from '../components/Badge.tsx';
import type { IconName } from '../components/Icon.tsx';

export interface TaskStatusView {
  readonly label: string;
  readonly icon: IconName;
  readonly tone: BadgeTone;
}

const PLANNING_STATUS_ICON: Record<PlanningRunStatusValue, IconName> = {
  queued: 'clock',
  running: 'sparkle',
  stopping: 'stop',
  stopped: 'stop',
  failed: 'x',
  unknown: 'help',
  completed: 'check',
};

const PLANNING_STATUS_TONE: Record<PlanningRunStatusValue, BadgeTone> = {
  queued: 'idle',
  running: 'accent',
  stopping: 'idle',
  stopped: 'idle',
  failed: 'fail',
  unknown: 'unknown',
  completed: 'ok',
};

const PLANNING_STAGE_ATTENTION: Partial<Record<PlanningStageValue, TaskStatusView>> = {
  needs_answer: { label: PLANNING_STAGE_LABEL.needs_answer, icon: 'help', tone: 'wait' },
  awaiting_review: { label: PLANNING_STAGE_LABEL.awaiting_review, icon: 'eye', tone: 'wait' },
};

const ATTENTION_VIEW: Record<TaskAttentionValue, TaskStatusView | null> = {
  [TaskAttention.NONE]: null,
  [TaskAttention.WAITING_USER]: { label: TASK_ATTENTION_LABEL.waiting_user, icon: 'help', tone: 'wait' },
  [TaskAttention.BLOCKED]: { label: TASK_ATTENTION_LABEL.blocked, icon: 'alert', tone: 'stall' },
  [TaskAttention.FAILED]: { label: TASK_ATTENTION_LABEL.failed, icon: 'x', tone: 'fail' },
  [TaskAttention.UNKNOWN]: { label: TASK_ATTENTION_LABEL.unknown, icon: 'help', tone: 'unknown' },
};

const DELIVERY_ICON: Record<DeliveryProjectionValue, IconName> = {
  awaiting_selection: 'upload',
  awaiting_confirmation: 'clock',
  in_progress: 'play',
  blocked: 'alert',
  unknown_receipt: 'help',
  delivered: 'check',
};

const DELIVERY_TONE: Record<DeliveryProjectionValue, BadgeTone> = {
  awaiting_selection: 'wait',
  awaiting_confirmation: 'wait',
  in_progress: 'run',
  blocked: 'stall',
  unknown_receipt: 'unknown',
  delivered: 'done',
};

/**
 * P12-02: derives the list status from real service facts in this order:
 * lifecycle → delivery fact → execution fact (pending acceptance / paused) →
 * planning stage → attention → stage. Attention never generalises a concrete
 * execution/delivery state into a generic “需要你处理”.
 */
export function deriveTaskStatus(task: TaskSummary): TaskStatusView {
  if (task.lifecycle === TaskLifecycle.COMPLETED) {
    return { label: '任务已交付', icon: 'check', tone: 'done' };
  }
  if (task.lifecycle === TaskLifecycle.CANCELLED) {
    return { label: TASK_LIFECYCLE_LABEL.cancelled, icon: 'stop', tone: 'idle' };
  }

  // Delivery facts come before attention: awaiting delivery is not “需要处理”.
  if (task.deliveryProjection !== undefined) {
    const projection = task.deliveryProjection;
    if (projection === 'delivered') return { label: DELIVERY_PROJECTION_LABEL.delivered, icon: 'check', tone: 'done' };
    if (projection === 'awaiting_selection' || projection === 'awaiting_confirmation') {
      return { label: DELIVERY_PROJECTION_LABEL[projection], icon: 'clock', tone: 'wait' };
    }
    if (projection === 'blocked') return { label: '交付受阻', icon: 'lock', tone: 'stall' };
    if (projection === 'unknown_receipt') return { label: '交付待核对', icon: 'help', tone: 'unknown' };
    if (projection === 'in_progress') return { label: DELIVERY_PROJECTION_LABEL.in_progress, icon: 'play', tone: 'run' };
  }

  // Execution facts: a paused task or pending human acceptance is not “执行中”.
  if ((task.execution?.pendingAcceptance ?? 0) > 0) {
    return { label: '待人工验收', icon: 'eye', tone: 'wait' };
  }
  if (task.execution?.status === 'waiting_confirmation') {
    return { label: '等待重新确认', icon: 'refresh', tone: 'wait' };
  }
  if (task.execution?.status === 'paused') {
    return { label: '已暂停', icon: 'pause', tone: 'idle' };
  }
  if (task.execution?.status === 'unknown') {
    return { label: '状态待核对', icon: 'help', tone: 'unknown' };
  }

  // Planning stage before attention: awaiting review has its own design word.
  if (task.planning !== undefined) {
    if (task.planning.stage === 'awaiting_review') return { label: PLANNING_STAGE_LABEL.awaiting_review, icon: 'eye', tone: 'wait' };
    if (task.planning.stage === 'needs_answer') return { label: '需要你回答', icon: 'help', tone: 'wait' };
  }

  const attention = ATTENTION_VIEW[task.attention];
  if (attention !== null) return attention;

  if (task.stage === TaskStage.PLANNING && task.planning !== undefined) {
    return {
      label: PLANNING_STATUS_LABEL[task.planning.status],
      icon: PLANNING_STATUS_ICON[task.planning.status],
      tone: PLANNING_STATUS_TONE[task.planning.status],
    };
  }

  if (task.stage === TaskStage.EXECUTING && task.execution !== undefined) {
    const status = task.execution.status;
    if (status === 'running') return { label: EXECUTION_STATUS_LABEL.running, icon: 'play', tone: 'run' };
    if (status === 'failed') return { label: '有步骤失败', icon: 'x', tone: 'fail' };
    if (status === 'stopped') return { label: EXECUTION_STATUS_LABEL.stopped, icon: 'stop', tone: 'idle' };
    if (status === 'stopping' || status === 'pausing') return { label: EXECUTION_STATUS_LABEL[status], icon: 'pause', tone: 'wait' };
    if (status === 'completed') return { label: '执行已结束 · 等待交付', icon: 'clock', tone: 'wait' };
  }

  switch (task.stage) {
    case TaskStage.DRAFT:
      return { label: '需求草稿', icon: 'file', tone: 'idle' };
    case TaskStage.PLANNING:
      return { label: '规划中', icon: 'sparkle', tone: 'accent' };
    case TaskStage.CONFIRMING:
      return { label: '待确认计划', icon: 'clock', tone: 'wait' };
    case TaskStage.PREPARING:
      return { label: '待准备工作区', icon: 'folder', tone: 'wait' };
    case TaskStage.EXECUTING:
      return { label: '执行中', icon: 'play', tone: 'run' };
    default:
      return { label: '未知状态', icon: 'help', tone: 'unknown' };
  }
}

/**
 * P12-01: the “需要处理” column carries the concrete step name + service reason
 * (failing step error, pending acceptance, paused, delivery) instead of a
 * generic sentence or the aggregate progress counter.
 */
export function taskNeedText(task: TaskSummary): string {
  const steps = task.stepStates ?? [];
  const named = (status: string): string | undefined => steps.find((step) => step.status === status)?.title;
  const failed = steps.find((step) => step.status === 'failed');
  const unknown = steps.find((step) => step.status === 'unknown');
  const pending = steps.find((step) => step.pendingAcceptance === true);
  const rejected = steps.find((step) => step.rejectedAcceptance === true);

  if (rejected !== undefined) return `“${rejected.title}”已退回修改，按原配置重试后再验收`;
  if (failed !== undefined) {
    const reason = failed.errorMessage === undefined || failed.errorMessage.length === 0 ? '服务报告失败' : failed.errorMessage;
    return `“${failed.title}”失败：${reason}`;
  }
  if (unknown !== undefined) return `“${unknown.title}”状态待核对，不自动重试`;
  if (pending !== undefined) return `“${pending.title}”待人工验收`;
  if (task.deliveryProjection === 'awaiting_selection') return '执行已结束，等待选择交付目标';
  if (task.deliveryProjection === 'awaiting_confirmation') return '交付步骤等待你确认';
  if (task.deliveryProjection === 'blocked') return '交付受阻，仍有活动写入';
  if (task.deliveryProjection === 'unknown_receipt') return '交付回执待核对，只核对原请求';
  if (task.deliveryProjection === 'in_progress') return '交付进行中，等待服务回执';
  if (task.execution?.status === 'paused') return '任务已暂停 · 可调整待执行计划后单独恢复';
  if (task.execution?.status === 'waiting_confirmation') return '计划已变更，等待重新确认后继续';
  if (task.execution?.status === 'unknown') return '执行结果待核对，只核对原请求';

  if (task.attention === TaskAttention.WAITING_USER) return '需要你处理';
  if (task.attention === TaskAttention.BLOCKED) return '受阻，等待处理';
  if (task.attention === TaskAttention.FAILED) return '执行失败，可查看后重试';
  if (task.attention === TaskAttention.UNKNOWN) return '状态待核对，不自动重试';

  if (task.planning !== undefined) {
    const activity = task.planning.lastActivity.trim();
    const base = `${PLANNING_STATUS_LABEL[task.planning.status]} · ${PLANNING_STAGE_LABEL[task.planning.stage]}`;
    return activity.length > 0 ? `${base} · 最近活动 ${activity}` : base;
  }

  if (task.stage === TaskStage.PREPARING) return '计划已确认 · 待准备独立工作区';
  if (task.stage === TaskStage.CONFIRMING) return '计划已生成 · 等待确认';
  if (task.stage === TaskStage.DRAFT) return '查看需求草稿，确认规划方式';
  if (task.stage === TaskStage.EXECUTING && task.execution?.status === 'running') return '—';
  const caption = steps.length === 0 ? undefined : taskStepCaption(steps);
  if (caption !== undefined) return caption;
  return '—';
}

export function taskProgressText(task: TaskSummary): string {
  const { done, total } = task.progress;
  return total > 0 ? `${String(done)} / ${String(total)} 步` : '—';
}

export type TaskGroup = 'attention' | 'active' | 'closed';

export function taskGroup(task:TaskSummary):TaskGroup{return taskListGroup(task);}

/** Planning/confirming tasks open the requirement canvas; later stages open the task canvas. */
export function taskHref(task: TaskSummary): string {
  if (task.stage === TaskStage.DRAFT || task.stage === TaskStage.PLANNING || task.stage === TaskStage.CONFIRMING) {
    return `/requirement/${encodeURIComponent(task.id)}`;
  }
  // P12-03: “待准备工作区”行直接回到需求画布「工作区」页签，与设计一致。
  if (task.stage === TaskStage.PREPARING) {
    return `/requirement/${encodeURIComponent(task.id)}?tab=workspace`;
  }
  return `/tasks/${encodeURIComponent(task.id)}`;
}

export function taskStageIcon(stage: TaskStageValue): IconName {
  switch (stage) {
    case TaskStage.DRAFT:
      return 'file';
    case TaskStage.PLANNING:
      return 'sparkle';
    case TaskStage.CONFIRMING:
      return 'clock';
    case TaskStage.PREPARING:
      return 'folder';
    case TaskStage.EXECUTING:
      return 'play';
    default:
      return 'file';
  }
}

const INBOX_KIND_LABEL: Record<InboxKindValue, string> = {
  runtime_question: '运行时问题',
  runtime_permission: '只读授权',
  runtime_policy: '策略已阻止',
  planning_answer: '规划问题',
  planning_review: '候选审阅',
  planning_reconcile: '停止核对',
  delivery_confirm: '交付确认',
  execution_failed: '执行失败',
};

const INBOX_KIND_ICON: Record<InboxKindValue, IconName> = {
  runtime_question: 'help',
  runtime_permission: 'shield',
  runtime_policy: 'lock',
  planning_answer: 'help',
  planning_review: 'eye',
  planning_reconcile: 'refresh',
  delivery_confirm: 'upload',
  execution_failed: 'alert',
};

export function inboxKindLabel(item: InboxItem): string {
  return INBOX_KIND_LABEL[item.kind];
}

export function inboxKindIcon(item: InboxItem): IconName {
  return INBOX_KIND_ICON[item.kind];
}

export function inboxHref(item: InboxItem): string {
  if (item.taskId === undefined || item.kind.startsWith('runtime_')) return '/inbox';
  if (item.kind === 'planning_answer' || item.kind === 'planning_review' || item.kind === 'planning_reconcile') {
    return `/requirement/${encodeURIComponent(item.taskId)}`;
  }
  return `/tasks/${encodeURIComponent(item.taskId)}`;
}

export function sortByUpdatedDesc<T extends { readonly updatedAt: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}
