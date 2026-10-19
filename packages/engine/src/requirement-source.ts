import { createHash } from 'node:crypto';
import type { Store } from '@agent-workflow/storage';
import { AppError, ErrorCode, type NodeDetail, type PlanNode, type PlanRevision, type RequirementInput, type RequirementSourceResponse, type Task } from '@agent-workflow/shared';

const hash = (requirement: RequirementInput) => createHash('sha256').update(JSON.stringify(requirement)).digest('hex');
export function freezeRequirement(store: Store, task: Task, planId: string): void {
  if (store.settings.getJson(`plan.requirement.${planId}`) === undefined) store.settings.putJson(`plan.requirement.${planId}`, task.requirement);
}
function snapshot(store: Store, task: Task, plan: PlanRevision): RequirementInput | undefined {
  return store.settings.getJson<RequirementInput>(`plan.requirement.${plan.id}`) ?? (plan.status === 'draft' || plan.status === 'unconfirmed' ? task.requirement : undefined);
}
export function requirementLinks(store: Store, task: Task, plan: PlanRevision, node: PlanNode): NodeDetail['requirementLinks'] {
  const source = snapshot(store, task, plan);
  const links = new Map<string, NodeDetail['requirementLinks'][number]>();
  for (const input of node.inputs.filter((item) => item.source === 'requirement')) {
    const entry = source?.entries.find((item) => input.sourceEntryId !== undefined ? item.id === input.sourceEntryId : item.id === input.name || item.text === input.name);
    if (entry === undefined) { links.set(input.name, { entryId: input.sourceEntryId ?? input.name, label: input.name, text: '', unavailableReason: source === undefined ? '这份历史计划未保存需求来源快照' : '引用未绑定到明确的需求条目' }); continue; }
    links.set(entry.id, { entryId: entry.id, label: input.name, text: entry.text, sourceRef: { planRevisionId: plan.id, requirementRevision: source!.revision, sha256: hash(source!) } });
  }
  for (const coverage of plan.validation?.requirementCoverage ?? []) {
    if (!coverage.nodeIds.includes(node.id)) continue;
    const entry = source?.entries.find((item) => item.id === coverage.requirementId);
    if (entry !== undefined) links.set(entry.id, { entryId: entry.id, label: coverage.label || entry.id, text: entry.text, sourceRef: { planRevisionId: plan.id, requirementRevision: source!.revision, sha256: hash(source!) } });
  }
  return [...links.values()];
}
export function readRequirementSource(store: Store, taskId: string, nodeId: string, planId: string, entryId: string, revision: number, sha256: string): RequirementSourceResponse {
  const task = store.tasks.get(taskId); const plan = store.plans.get(planId);
  if (!task || !plan || plan.taskId !== taskId) throw new AppError(ErrorCode.NOT_FOUND, '引用来源不存在');
  const node = plan.graph.nodes.find((item) => item.id === nodeId);
  if (!node) throw new AppError(ErrorCode.NOT_FOUND, '引用节点不存在');
  const source = snapshot(store, task, plan);
  if (!source) throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, '这份历史计划未保留需求原文');
  if (source.revision !== revision || hash(source) !== sha256) throw new AppError(ErrorCode.STALE_TARGET, '来源版本已变化，请重新打开引用');
  const link = requirementLinks(store, task, plan, node).find((item) => item.entryId === entryId && item.sourceRef !== undefined);
  const entry = source.entries.find((item) => item.id === entryId);
  if (!link || !entry) throw new AppError(ErrorCode.NOT_FOUND, '这个节点没有绑定该引用');
  const start = entry.sourceStart; const end = entry.sourceEnd;
  const located = start !== undefined && end !== undefined && start >= 0 && end > start && source.text.slice(start, end) === entry.text;
  return { taskId, nodeId, planRevisionId: planId, entryId, requirementRevision: revision, sha256, content: located ? source.text : entry.text, scope: located ? 'full' : 'excerpt', ...(located ? { start, end } : {}) };
}
