import { EXECUTION_STATUS_LABEL, type ExecutionView, type PlanRevision } from '@agent-workflow/shared';

/** Statuses the service accepts for toggling auto advance (edit session active → rejected). */
export const AUTO_ADVANCE_STATUSES: readonly string[] = ['running', 'pausing', 'paused', 'waiting_confirmation', 'unknown', 'failed'];
export const MANUAL_ADVANCE_STATUSES: readonly string[] = ['running', 'paused'];

export function nodeIsDone(status: string | undefined): boolean {
  return status === 'succeeded' || status === 'skipped';
}

export function nodeTitle(plan: PlanRevision, nodeId: string): string {
  return plan.graph.nodes.find((node) => node.id === nodeId)?.title ?? nodeId;
}

export function hasActiveEditSession(execution: ExecutionView | undefined): boolean {
  if (execution?.editSession === undefined) return false;
  return !['finished', 'abandoned'].includes(execution.editSession.state);
}

export interface AdvanceTargets {
  /** Pending/ready nodes whose every predecessor is already accepted/skipped. */
  readonly candidates: readonly string[];
  /** Direct successors still blocked by another predecessor (parallel join). */
  readonly waiting: readonly string[];
}

/**
 * Predict which nodes a manual advance can release. The service remains
 * authoritative (it returns VALIDATION_FAILED + waitingFor when nothing is
 * releasable); this mirrors the documented join rule so the button can carry a
 * visible reason.
 */
export function advanceTargets(plan: PlanRevision, execution: ExecutionView, fromNodeId?: string): AdvanceTargets {
  const statuses = new Map(execution.nodes.map((node) => [node.nodeId, node.status]));
  const awaitingAcceptance = new Set([...(execution.acceptance?.pending ?? []), ...(execution.acceptance?.rejected ?? [])]);
  const unknownAcceptance = execution.acceptance === undefined ? new Set(plan.graph.nodes.filter((node) => node.acceptance.length > 0).map((node) => node.id)) : new Set<string>();
  const predecessorDone = (id: string) => statuses.get(id) === 'skipped' || statuses.get(id) === 'succeeded' && !awaitingAcceptance.has(id) && !unknownAcceptance.has(id);
  const directSuccessors = fromNodeId === undefined
    ? undefined
    : new Set(plan.graph.edges.filter((edge) => edge.from === fromNodeId).map((edge) => edge.to));
  const candidates: string[] = [];
  const waiting: string[] = [];
  for (const node of plan.graph.nodes) {
    if (directSuccessors !== undefined && !directSuccessors.has(node.id)) continue;
    const nodeStatus = statuses.get(node.id);
    if (nodeStatus !== 'pending' && nodeStatus !== 'ready') continue;
    const incoming = plan.graph.edges.filter((edge) => edge.to === node.id);
    const blocked = incoming.some((edge) => !predecessorDone(edge.from));
    if (!blocked) candidates.push(node.id);
    else waiting.push(node.id);
  }
  return { candidates, waiting };
}

export function manualAdvanceReason(execution: ExecutionView | undefined, targets: AdvanceTargets, plan: PlanRevision | undefined, busy: boolean): string | undefined {
  if (busy) return '正在提交操作，等待服务回执…';
  if (execution === undefined) return '执行尚未创建。';
  if (hasActiveEditSession(execution)) return '正在调整待执行计划：结束或放弃调整后才能手动推进。';
  if (!MANUAL_ADVANCE_STATUSES.includes(execution.status)) {
    if (execution.status === 'unknown') return '执行结果待核对：先按原请求核对，再到恢复页重试失败步骤或跳过节点。';
    if (execution.status === 'failed') return '执行已失败：先到恢复页按原配置重试失败步骤。';
    if (execution.status === 'stopped') return '执行已停止：先到恢复页重试或恢复执行。';
    if (execution.status === 'waiting_confirmation') return '计划变更等待重新确认；确认后才可手动推进。';
    if (execution.status === 'completed') return '执行已完成，没有可推进的步骤。';
    return `当前执行状态（${EXECUTION_STATUS_LABEL[execution.status]}）不能手动推进。`;
  }
  if (execution.status === 'paused' && execution.pause?.requestKey !== undefined) {
    return '任务是你主动暂停的：先“继续执行”，再手动推进。';
  }
  if (targets.candidates.length > 0) return undefined;
  if (plan === undefined) return '计划尚未读取，无法判断可推进的步骤。';
  if (targets.waiting.length > 0) {
    return `并行汇合等待全部前置验收：${targets.waiting.slice(0, 3).map((id) => nodeTitle(plan, id)).join('、')}。`;
  }
  return '当前没有满足条件的待执行后继步骤（可能已开始或已完成）。';
}

export function successorReason(plan: PlanRevision, execution: ExecutionView, targets: AdvanceTargets, busy: boolean): string | undefined {
  if (busy) return '正在提交操作，等待服务回执…';
  if (hasActiveEditSession(execution)) return '正在调整待执行计划：结束或放弃调整后才能推进直接后继。';
  if (!MANUAL_ADVANCE_STATUSES.includes(execution.status)) {
    return execution.status === 'unknown' ? '执行结果待核对：先按原请求核对，再推进直接后继。' : `当前执行状态（${EXECUTION_STATUS_LABEL[execution.status]}）不能推进直接后继。`;
  }
  if (execution.status === 'paused' && execution.pause?.requestKey !== undefined) {
    return '任务是你主动暂停的：先“继续执行”，再推进直接后继。';
  }
  if (targets.candidates.length > 0) return undefined;
  if (targets.waiting.length > 0) {
    return `并行汇合等待全部前置验收：${targets.waiting.slice(0, 3).map((id) => nodeTitle(plan, id)).join('、')}。`;
  }
  return '直接后继已开始或已完成，没有可推进的步骤。';
}
