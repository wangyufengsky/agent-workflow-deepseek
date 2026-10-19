import {
  NodeKind,
  NodeStatus,
  ROUTES,
  createRequestKey,
  type CommandResponse,
  type PlanningProposal,
  type PlanningProposalResponse,
  type PlanningRefinePreviewResponse,
  type PlanningResponse,
  type PlanningStartRequest,
  type RefineScopePreview,
} from '@agent-workflow/shared';
import type { FlowGraphView, FlowGroupView, FlowNodeView } from '../../flow/types.ts';
import { apiGet, apiPost } from '../../api/client.ts';

/**
 * PE37 read models. These live in the page layer because W3-6b exposes them as
 * dedicated endpoints; they never mutate until the explicit scoped start below.
 */
export async function fetchPlanningProposal(taskId: string): Promise<PlanningProposal> {
  const response = await apiGet<PlanningProposalResponse>(ROUTES.planningProposal(taskId));
  return response.data.proposal;
}

export async function previewRefineScope(taskId: string, groupRef: string): Promise<RefineScopePreview> {
  const response = await apiPost<PlanningRefinePreviewResponse>(ROUTES.planningRefinePreview(taskId), { groupRef });
  return response.data.preview;
}

export interface ScopedPlanningStartInput {
  readonly previewRef: string;
  readonly sourceInputRevision: number;
  readonly groupRef: string;
}

/** Existing planning/start, extended with the scoped group; still one explicit model dispatch. */
export async function startScopedPlanning(taskId: string, input: ScopedPlanningStartInput): Promise<CommandResponse<PlanningResponse>> {
  const body: PlanningStartRequest = {
    requestKey: createRequestKey(),
    previewId: input.previewRef,
    sourceInputRevision: input.sourceInputRevision,
    confirmModelDispatch: true,
    scope: { groupRef: input.groupRef },
  };
  const response = await apiPost<CommandResponse<PlanningResponse>>(ROUTES.planningStart(taskId), body);
  return response.data;
}

const STATE_LABEL = {
  refined: '已细化',
  unrefined: '未细化',
  planning: '规划中',
  candidate: '候选待审阅',
} as const;

type GroupState = keyof typeof STATE_LABEL;

function isPlaceholderId(id: string): boolean {
  return id.startsWith('placeholder.') || id.startsWith('placeholder:') || id.startsWith('gap:');
}

/**
 * Adds visible, dashed placeholders for groups that have no leaf nodes yet.
 * They are display-only; group frames and real service nodes keep their ids.
 * No synthetic edges or executable flags are created.
 */
export function withPe37Placeholders(graph: FlowGraphView, proposal: PlanningProposal | undefined): FlowGraphView {
  if (proposal === undefined || proposal.groups.length === 0) return graph;
  const groupByRef = new Map(proposal.groups.map((group) => [group.groupRef, group]));
  const placeholderIds = new Set(proposal.groups.flatMap((group) => group.placeholderNodeIds));

  const nodes = graph.nodes.map((node) => {
    const group = groupByRef.get(node.groupId);
    if (group === undefined || (group.state === 'refined' && !isPlaceholderId(node.id))) return node;
    if (!isPlaceholderId(node.id) && !placeholderIds.has(node.id)) return node;
    return placeholderView(node, group.state, group.title);
  });

  const existingGroups = new Set(graph.groups.map((group) => group.id));
  const synthetic: FlowNodeView[] = [];
  for (const group of proposal.groups) {
    if (group.state === 'refined') continue;
    const realNodes = nodes.filter((node) => node.groupId === group.groupRef && !isPlaceholderId(node.id));
    if (realNodes.length > 0) continue;
    if (nodes.some((node) => node.id === `placeholder:${group.groupRef}`)) continue;
    synthetic.push({
      id: `placeholder:${group.groupRef}`,
      title: `${group.state === 'planning' ? '规划中' : group.state === 'candidate' ? '候选待审阅' : '未细化'}：${group.title}`,
      kind: NodeKind.SYSTEM,
      groupId: group.groupRef,
      groupLabel: group.title,
      summary: '这是分组占位，不是可执行步骤；请选择该组「继续规划选区」。',
      badgeLabel: `${STATE_LABEL[group.state]} · 不可执行`,
      badgeTone: group.state === 'planning' ? 'run' : group.state === 'candidate' ? 'wait' : 'unknown',
      badgeIcon: group.state === 'planning' ? 'play' : group.state === 'candidate' ? 'eye' : 'help',
      status: NodeStatus.UNKNOWN,
      meta: `${group.coverage.length === 0 ? '覆盖待服务返回' : `覆盖 ${group.coverage.join('、')}`} · ${String(group.leafCount)} 个叶子步骤`,
      flag: 'warn',
      lock: true,
      lockReason: '未细化占位不是执行节点；该组细化并确认后才可能执行。',
    });
  }

  const groups: FlowGroupView[] = graph.groups.map((group) => {
    const state = groupByRef.get(group.id)?.state;
    if (state === undefined) return group;
    return {
      ...group,
      refined: state === 'refined',
      tone: state === 'refined' ? 'default' : state === 'candidate' ? 'scope' : 'unrefined',
    };
  });
  for (const group of proposal.groups) {
    if (existingGroups.has(group.groupRef)) continue;
    groups.push({
      id: group.groupRef,
      label: group.title,
      kind: 'group',
      refined: group.state === 'refined',
      nodeCount: group.leafCount,
      tone: group.state === 'candidate' ? 'scope' : group.state === 'refined' ? 'default' : 'unrefined',
    });
  }

  return {
    nodes: [...nodes, ...synthetic],
    edges: graph.edges,
    groups,
  };
}

function placeholderView(node: FlowNodeView, state: GroupState, groupTitle: string): FlowNodeView {
  return {
    ...node,
    title: node.title.trim().length === 0 ? `未细化：${groupTitle}` : node.title,
    badgeLabel: `${STATE_LABEL[state]} · 不可执行`,
    badgeTone: state === 'planning' ? 'run' : state === 'candidate' ? 'wait' : 'unknown',
    badgeIcon: state === 'planning' ? 'play' : state === 'candidate' ? 'eye' : 'help',
    status: NodeStatus.UNKNOWN,
    meta: `分组占位 · ${groupTitle}`,
    flag: 'warn',
    lock: true,
    lockReason: '未细化占位不是执行节点；该组细化并确认后才可能执行。',
  };
}

export interface Pe37ScopeIssue {
  readonly code: string;
  readonly groups: readonly string[];
  readonly problems: readonly string[];
}

export function pe37ScopeFromError(error: unknown): Pe37ScopeIssue | undefined {
  if (!(error instanceof Error) || !('details' in error)) return undefined;
  const details = (error as Error & { readonly details?: unknown }).details;
  if (typeof details !== 'object' || details === null) return undefined;
  const record = details as Record<string, unknown>;
  const code = typeof record.code === 'string' ? record.code : undefined;
  const groups = Array.isArray(record.groups)
    ? record.groups.filter((item): item is string => typeof item === 'string')
    : Array.isArray(record.unresolvedScopes)
      ? record.unresolvedScopes.filter((item): item is string => typeof item === 'string')
      : [];
  const problems = Array.isArray(record.problems)
    ? record.problems.flatMap((item) => {
        if (typeof item !== 'object' || item === null) return [];
        const problem = item as Record<string, unknown>;
        if (problem.code !== 'SCOPE_VIOLATION') return [];
        return [typeof problem.detail === 'string' ? problem.detail : typeof problem.title === 'string' ? problem.title : '候选越界'];
      })
    : [];
  if (code !== 'SCOPE_UNREFINED' && problems.length === 0) return undefined;
  return { code: code ?? 'SCOPE_VIOLATION', groups, problems };
}
