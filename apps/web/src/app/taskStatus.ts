import {
  DELIVERY_PROJECTION_LABEL,
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

/** Derives the visible status from real task fields; never invents a state. */
export function deriveTaskStatus(task: TaskSummary): TaskStatusView {
  if (task.lifecycle === TaskLifecycle.COMPLETED) {
    return { label: TASK_LIFECYCLE_LABEL.completed, icon: 'check', tone: 'done' };
  }
  if (task.lifecycle === TaskLifecycle.CANCELLED) {
    return { label: TASK_LIFECYCLE_LABEL.cancelled, icon: 'stop', tone: 'idle' };
  }

  const attention = ATTENTION_VIEW[task.attention];
  if (attention !== null) return attention;

  if (task.stage === TaskStage.PLANNING && task.planning !== undefined) {
    const stageAttention = PLANNING_STAGE_ATTENTION[task.planning.stage];
    if (stageAttention !== undefined) return stageAttention;
    return {
      label: PLANNING_STATUS_LABEL[task.planning.status],
      icon: PLANNING_STATUS_ICON[task.planning.status],
      tone: PLANNING_STATUS_TONE[task.planning.status],
    };
  }

  if (task.stage === TaskStage.EXECUTING && task.deliveryProjection !== undefined) {
    return {
      label: DELIVERY_PROJECTION_LABEL[task.deliveryProjection],
      icon: DELIVERY_ICON[task.deliveryProjection],
      tone: DELIVERY_TONE[task.deliveryProjection],
    };
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

/** Secondary line shown in list rows; derived only from real fields. */
export function taskNeedText(task: TaskSummary): string {
  if (task.attention === TaskAttention.WAITING_USER) return '需要你处理';
  if (task.attention === TaskAttention.BLOCKED) return '受阻，等待处理';
  if (task.attention === TaskAttention.FAILED) return '执行失败，可查看后重试';
  if (task.attention === TaskAttention.UNKNOWN) return '状态待核对，不自动重试';

  if (task.stage === TaskStage.PLANNING && task.planning !== undefined) {
    const activity = task.planning.lastActivity.trim();
    const base = `${PLANNING_STATUS_LABEL[task.planning.status]} · ${PLANNING_STAGE_LABEL[task.planning.stage]}`;
    return activity.length > 0 ? `${base} · 最近活动 ${activity}` : base;
  }

  if (task.stage === TaskStage.EXECUTING && task.deliveryProjection !== undefined) {
    return DELIVERY_PROJECTION_LABEL[task.deliveryProjection];
  }
  if (task.stage === TaskStage.EXECUTING) {
    const { done, total, running, failed } = task.progress;
    if (total > 0) {
      const parts = [`进度 ${String(done)} / ${String(total)} 步`];
      if (running > 0) parts.push(`${String(running)} 步执行中`);
      if (failed > 0) parts.push(`${String(failed)} 步失败`);
      return parts.join(' · ');
    }
    return '等待执行';
  }
  if (task.stage === TaskStage.PREPARING) return '计划已确认 · 待准备独立工作区';
  if (task.stage === TaskStage.CONFIRMING) return '计划已生成 · 等待确认';
  if (task.stage === TaskStage.DRAFT) return '查看需求草稿，确认规划方式';
  return '—';
}

export function taskProgressText(task: TaskSummary): string {
  const { done, total } = task.progress;
  return total > 0 ? `${String(done)} / ${String(total)} 步` : '—';
}

export type TaskGroup = 'attention' | 'active' | 'closed';

export function taskGroup(task: TaskSummary): TaskGroup {
  if (task.lifecycle !== TaskLifecycle.ACTIVE) return 'closed';
  if (task.deliveryProjection === 'delivered') return 'closed';
  if (task.attention !== TaskAttention.NONE) return 'attention';
  if (
    task.deliveryProjection === 'awaiting_selection' ||
    task.deliveryProjection === 'awaiting_confirmation' ||
    task.deliveryProjection === 'blocked' ||
    task.deliveryProjection === 'unknown_receipt'
  ) {
    return 'attention';
  }
  if (task.planning !== undefined) {
    if (task.planning.status === 'stopped' || task.planning.status === 'failed' || task.planning.status === 'unknown') {
      return 'attention';
    }
  }
  return 'active';
}

/** Planning/confirming tasks open the requirement canvas; later stages open the task canvas. */
export function taskHref(task: TaskSummary): string {
  if (task.stage === TaskStage.DRAFT || task.stage === TaskStage.PLANNING || task.stage === TaskStage.CONFIRMING) {
    return `/requirement/${encodeURIComponent(task.id)}`;
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
  planning_answer: '规划问题',
  planning_review: '候选审阅',
  planning_reconcile: '停止核对',
  delivery_confirm: '交付确认',
  execution_failed: '执行失败',
};

const INBOX_KIND_ICON: Record<InboxKindValue, IconName> = {
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
  if (item.kind === 'planning_answer' || item.kind === 'planning_review' || item.kind === 'planning_reconcile') {
    return `/requirement/${encodeURIComponent(item.taskId)}`;
  }
  return `/tasks/${encodeURIComponent(item.taskId)}`;
}

export function sortByUpdatedDesc<T extends { readonly updatedAt: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}
