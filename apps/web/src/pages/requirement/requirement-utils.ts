import type { PlanRevision, PlanningRound, TaskDetailResponse } from '@agent-workflow/shared';
import { PLANNING_STAGE_LABEL, PLAN_REVISION_STATUS_LABEL, TASK_STAGE_LABEL } from '@agent-workflow/shared';

export function formatElapsed(startedAt: string | undefined, endedAt: string | undefined, now: number): string {
  if (startedAt === undefined) return '未开始';
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return '—';
  const end = endedAt === undefined ? now : Date.parse(endedAt);
  if (Number.isNaN(end)) return '—';
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  if (seconds < 60) return `${String(seconds)} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return `${String(minutes)} 分 ${String(rest)} 秒`;
  const hours = Math.floor(minutes / 60);
  return `${String(hours)} 小时 ${String(minutes % 60)} 分`;
}

export function roundIsActive(round: PlanningRound | undefined): boolean {
  if (round === undefined) return false;
  return round.status === 'queued' || round.status === 'running' || round.status === 'stopping';
}

export function roundIsUnknown(round: PlanningRound | undefined): boolean {
  return round !== undefined && (round.status === 'unknown' || round.stage === 'unknown');
}

export function roundIsSettledForApply(round: PlanningRound | undefined): boolean {
  if (round === undefined) return false;
  return round.status === 'completed' || round.status === 'stopped' || round.status === 'failed' || round.status === 'unknown';
}

export function planStatusTone(plan: PlanRevision | undefined): 'wait' | 'done' | 'idle' | 'unknown' {
  if (plan === undefined) return 'idle';
  if (plan.status === 'confirmed') return 'done';
  if (plan.status === 'superseded') return 'idle';
  if (plan.status === 'draft') return 'unknown';
  return 'wait';
}

export function planStatusText(plan: PlanRevision | undefined): string {
  if (plan === undefined) return '没有计划';
  return `计划修订 ${String(plan.revisionNumber)} · ${PLAN_REVISION_STATUS_LABEL[plan.status]}`;
}

export function roundLabel(round: PlanningRound | undefined): string {
  if (round === undefined) return '尚无规划轮次';
  return `第 ${String(round.ordinal)} 轮 · ${PLANNING_STAGE_LABEL[round.stage]}`;
}

export function taskStageText(detail: TaskDetailResponse | undefined): string {
  if (detail === undefined) return '—';
  return TASK_STAGE_LABEL[detail.task.stage];
}

export function isExecutingStage(detail: TaskDetailResponse | undefined): boolean {
  return detail !== undefined && (detail.task.stage === 'preparing' || detail.task.stage === 'executing');
}

/** Round selector value used in the URL (`round=<id>`); falls back to the current round. */
export function selectRound(rounds: readonly PlanningRound[], roundId: string | null, currentRoundId: string | undefined): PlanningRound | undefined {
  if (roundId !== null) {
    const found = rounds.find((round) => round.id === roundId);
    if (found !== undefined) return found;
  }
  if (currentRoundId !== undefined) {
    const found = rounds.find((round) => round.id === currentRoundId);
    if (found !== undefined) return found;
  }
  return rounds[0];
}
