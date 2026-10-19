import type { QuestionChoices } from './questions.ts';
import type { NodeKindValue } from '../domain/enums.ts';
import { createId, type IsoDateTime } from '../ids.ts';
import type { PlanEdge, PlanGraph, PlanGroup, PlanNode } from './models.ts';

/**
 * The only shape the planning model is allowed to submit. Validated by the
 * engine before it becomes a candidate plan revision; never trusted directly.
 */
export interface PlanningCandidatePayload {
  readonly summary: string;
  readonly groups: readonly PlanningCandidateGroup[];
  readonly nodes: readonly PlanningCandidateNode[];
  readonly edges: readonly PlanningCandidateEdge[];
  readonly questions?: readonly PlanningCandidateQuestion[];
  readonly assumptions?: readonly PlanningCandidateAssumption[];
  readonly humanDecisions?: readonly PlanningCandidateHumanDecision[];
}

export interface PlanningCandidateGroup {
  readonly id: string;
  readonly label: string;
  readonly kind: 'requirement' | 'design' | 'implementation' | 'test' | 'delivery';
  readonly refined?: boolean;
}

export interface PlanningCandidateNode {
  readonly key: string;
  readonly title: string;
  readonly kind: NodeKindValue;
  readonly groupId: string;
  readonly summary: string;
  readonly inputs?: readonly { readonly name: string; readonly source: 'requirement' | 'upstream' | 'artifact' | 'manual'; readonly fromKey?: string }[];
  readonly outputs?: readonly { readonly name: string; readonly kind: 'artifact' | 'evidence' | 'summary' }[];
  readonly acceptance?: readonly string[];
  readonly resources?: {
    readonly read?: readonly { readonly kind: 'file' | 'directory' | 'database' | 'http' | 'mcp'; readonly label: string }[];
    readonly write?: readonly { readonly kind: 'file' | 'directory' | 'database' | 'http' | 'mcp'; readonly label: string }[];
  };
  readonly roleId?: string;
  readonly optional?: boolean;
}

export interface PlanningCandidateEdge {
  readonly fromKey: string;
  readonly toKey: string;
  readonly kind: 'data' | 'order' | 'resource';
  readonly label?: string;
}

export interface PlanningCandidateQuestion extends QuestionChoices {
  readonly question: string;
  readonly required: boolean;
  readonly nodeKeys?: readonly string[];
}

export interface PlanningCandidateAssumption {
  readonly statement: string;
  readonly critical: boolean;
  readonly nodeKeys?: readonly string[];
}

export interface PlanningCandidateHumanDecision {
  readonly title: string;
  readonly detail: string;
  readonly nodeKeys?: readonly string[];
}

export interface PlanningValidationInput {
  readonly candidate: PlanningCandidatePayload;
  readonly requiredSteps: readonly { readonly key: string; readonly title?: string; readonly kind: NodeKindValue; readonly group: string; readonly optional?: boolean; readonly requires?: readonly string[] }[];
  readonly refinableGroups: readonly string[];
  readonly limits: { readonly maxNodes: number; readonly maxEdges: number; readonly maxGroups: number; readonly maxDepth: number };
}

export interface PlanningValidationOutput {
  readonly structural: 'passed' | 'failed';
  readonly problems: readonly {
    readonly id: string;
    readonly code: string;
    readonly severity: 'hard' | 'warning' | 'info';
    readonly title: string;
    readonly detail: string;
    readonly nodeKey?: string;
    readonly edgeKey?: string;
  }[];
  readonly humanDecisions: readonly { readonly id: string; readonly title: string; readonly detail: string; readonly nodeKey?: string }[];
  readonly coverage: readonly { readonly requirementId: string; readonly label: string; readonly covered: boolean; readonly nodeKeys: readonly string[] }[];
  readonly checks: readonly { readonly id: string; readonly label: string; readonly state: 'passed' | 'failed'; readonly detail?: string }[];
}

const NODE_KEY_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;

/**
 * Deterministic validation (V1–V8 in the design):
 * V1 required skeleton steps present, V2 unique keys, V3 edges reference known nodes,
 * V4 no self edges, V5 acyclic, V6 required inputs bound, V7 write-resource collisions,
 * V8 limits (nodes / edges / groups / depth).
 */
export function validatePlanningCandidate(input: PlanningValidationInput): PlanningValidationOutput {
  const problems: PlanningValidationOutput['problems'][number][] = [];
  const { candidate, limits } = input;
  const nodeKeys = new Set(candidate.nodes.map((n) => n.key));

  const push = (
    code: string,
    title: string,
    detail: string,
    nodeKey?: string,
    edgeKey?: string,
    severity: 'hard' | 'warning' | 'info' = 'hard',
  ) => {
    problems.push({ id: `${code}-${problems.length + 1}`, code, severity, title, detail, nodeKey, edgeKey });
  };

  if (candidate.nodes.length > limits.maxNodes) push('LIMIT_NODES', '步骤数超过上限', `候选 ${candidate.nodes.length} 个步骤，上限 ${limits.maxNodes}`);
  if (candidate.edges.length > limits.maxEdges) push('LIMIT_EDGES', '依赖数超过上限', `候选 ${candidate.edges.length} 条依赖，上限 ${limits.maxEdges}`);
  if (candidate.groups.length > limits.maxGroups) push('LIMIT_GROUPS', '分组数超过上限', `候选 ${candidate.groups.length} 个分组，上限 ${limits.maxGroups}`);

  for (const node of candidate.nodes) {
    if (!NODE_KEY_PATTERN.test(node.key)) push('INVALID_KEY', '步骤键不合法', `键 ${node.key} 不符合 ${NODE_KEY_PATTERN.source}`, node.key);
    if (!node.title.trim()) push('EMPTY_TITLE', '步骤缺少名称', `步骤 ${node.key} 没有名称`, node.key);
    for (const inputRef of node.inputs ?? []) {
      if (inputRef.source === 'upstream' && (!inputRef.fromKey || !nodeKeys.has(inputRef.fromKey))) {
        push('UNBOUND_INPUT', '必需输入未绑定', `步骤 ${node.key} 的输入 ${inputRef.name} 指向不存在的上游`, node.key);
      }
    }
  }

  const seen = new Set<string>();
  for (const node of candidate.nodes) {
    if (seen.has(node.key)) push('DUPLICATE_KEY', '步骤键重复', `键 ${node.key} 出现了多次`, node.key);
    seen.add(node.key);
  }

  const groupIds = new Set(candidate.groups.map((g) => g.id));
  for (const node of candidate.nodes) {
    if (!groupIds.has(node.groupId)) push('UNKNOWN_GROUP', '步骤分组不存在', `步骤 ${node.key} 引用了不存在的分组 ${node.groupId}`, node.key);
  }

  for (const edge of candidate.edges) {
    if (!nodeKeys.has(edge.fromKey)) push('UNKNOWN_EDGE_SOURCE', '依赖起点不存在', `${edge.fromKey} → ${edge.toKey}`, undefined, `${edge.fromKey}->${edge.toKey}`);
    if (!nodeKeys.has(edge.toKey)) push('UNKNOWN_EDGE_TARGET', '依赖终点不存在', `${edge.fromKey} → ${edge.toKey}`, undefined, `${edge.fromKey}->${edge.toKey}`);
    if (edge.fromKey === edge.toKey) push('SELF_EDGE', '步骤依赖自身', `步骤 ${edge.fromKey} 依赖自身`, edge.fromKey);
  }

  const cycle = findCycle(candidate.nodes.map((n) => n.key), candidate.edges);
  if (cycle !== null) push('CYCLE', '存在循环依赖', cycle.join(' → '));

  const requiredKeys = new Set(candidate.nodes.map((n) => n.key));
  for (const step of input.requiredSteps) {
    if (step.optional) continue;
    if (!requiredKeys.has(step.key)) push('MISSING_STEP', '缺少必经步骤', `方法要求步骤 ${step.key}（${step.title ?? step.key}）`);
  }

  // Explicit editor dependencies are hard method constraints; an AI candidate
  // may insert steps between endpoints but cannot remove their ordering.
  const successors = new Map<string, string[]>();
  for (const edge of candidate.edges) successors.set(edge.fromKey, [...(successors.get(edge.fromKey) ?? []), edge.toKey]);
  const reaches = (from: string, to: string, seen = new Set<string>()): boolean => {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return (successors.get(from) ?? []).some((next) => reaches(next, to, seen));
  };
  for (const step of input.requiredSteps) {
    if (!requiredKeys.has(step.key)) continue;
    for (const dependency of step.requires ?? []) {
      if (!requiredKeys.has(dependency)) continue; // Missing mandatory steps are reported above; omitted optional steps add no edge.
      if (!reaches(dependency, step.key)) push('METHOD_DEPENDENCY_MISSING', '流程前驱依赖被移除', `${dependency} 必须先于 ${step.key} 完成`, step.key);
    }
  }

  for (const step of input.requiredSteps) {
    if (step.requires === undefined) continue;
    for (const edge of candidate.edges.filter((item) => item.toKey === step.key)) {
      if (step.requires.some((dependency) => dependency === edge.fromKey || reaches(dependency, edge.fromKey))) continue;
      const from = candidate.nodes.find((item) => item.key === edge.fromKey);
      const to = candidate.nodes.find((item) => item.key === edge.toKey);
      const mappedInput = edge.kind === 'data' && to?.inputs?.some((item) => item.source === 'upstream' && item.fromKey === edge.fromKey);
      const sameResource = (left: { kind: string; label: string }, right: { kind: string; label: string }) => left.kind === right.kind && left.label === right.label;
      const resourceBasis = edge.kind === 'resource' && (
        from?.resources?.write?.some((left) => [...(to?.resources?.read ?? []), ...(to?.resources?.write ?? [])].some((right) => sameResource(left, right)))
        || to?.resources?.write?.some((left) => [...(from?.resources?.read ?? []), ...(from?.resources?.write ?? [])].some((right) => sameResource(left, right))));
      const reviewedOrder = edge.kind === 'order' && candidate.humanDecisions?.some((decision) => decision.nodeKeys?.includes(step.key) && decision.detail.trim().length > 0);
      if (!edge.label?.trim() || (!mappedInput && !resourceBasis && !reviewedOrder)) {
        push('METHOD_DEPENDENCY_UNJUSTIFIED', '新增流程前驱缺少依据', `${edge.fromKey} → ${step.key} 改变了已配置的前驱；需给出输入映射/资源依据，或明确列入需人工判断的顺序调整`, step.key);
      }
    }
  }

  const writeOwners = new Map<string, string[]>();
  for (const node of candidate.nodes) {
    for (const resource of node.resources?.write ?? []) {
      const key = `${resource.kind}:${resource.label}`;
      const owners = writeOwners.get(key) ?? [];
      owners.push(node.key);
      writeOwners.set(key, owners);
    }
  }
  for (const [resource, owners] of writeOwners) {
    if (owners.length > 1) {
      push('WRITE_COLLISION', '多个步骤写同一资源', `${owners.join('、')} 同时写 ${resource}；需改为先后执行或申请子隔离（后续分期）`, owners[0]);
    }
  }

  const depth = maxDepth(candidate.nodes.map((n) => n.key), candidate.edges);
  if (depth > limits.maxDepth) push('LIMIT_DEPTH', '依赖深度超过上限', `深度 ${depth}，上限 ${limits.maxDepth}`);

  const humanDecisions = (candidate.humanDecisions ?? []).map((decision, index) => ({
    id: `hd-${index + 1}`,
    title: decision.title,
    detail: decision.detail,
    nodeKey: decision.nodeKeys?.[0],
  }));
  for (const assumption of candidate.assumptions ?? []) {
    if (assumption.critical) {
      humanDecisions.push({ id: `hd-${humanDecisions.length + 1}`, title: `确认关键假设：${assumption.statement}`, detail: '模型陈述 · 未确认', nodeKey: assumption.nodeKeys?.[0] });
    }
  }

  const hard = questionsForHard(candidate);
  if (hard > 0) push('ANSWER_REQUIRED', '存在必须答复的问题', `${hard} 个问题必须由用户回答后才能应用`);

  const coverage = buildCoverage(input.requiredSteps, candidate);
  const checks = [
    { id: 'V1', label: '必经步骤齐全', state: problems.some((p) => p.code === 'MISSING_STEP' || p.code === 'METHOD_DEPENDENCY_MISSING' || p.code === 'METHOD_DEPENDENCY_UNJUSTIFIED') ? 'failed' : 'passed' },
    { id: 'V2', label: '步骤键唯一', state: problems.some((p) => p.code === 'DUPLICATE_KEY') ? 'failed' : 'passed' },
    { id: 'V3', label: '依赖引用有效', state: problems.some((p) => p.code.startsWith('UNKNOWN_EDGE')) ? 'failed' : 'passed' },
    { id: 'V4', label: '无自依赖', state: problems.some((p) => p.code === 'SELF_EDGE') ? 'failed' : 'passed' },
    { id: 'V5', label: '无循环依赖', state: cycle === null ? 'passed' : 'failed' },
    { id: 'V6', label: '必需输入已绑定', state: problems.some((p) => p.code === 'UNBOUND_INPUT') ? 'failed' : 'passed' },
    { id: 'V7', label: '写资源无冲突', state: problems.some((p) => p.code === 'WRITE_COLLISION') ? 'failed' : 'passed' },
    { id: 'V8', label: '规模在限额内', state: problems.some((p) => p.code.startsWith('LIMIT_')) ? 'failed' : 'passed' },
  ] as const;

  return {
    structural: problems.some((p) => p.severity === 'hard') ? 'failed' : 'passed',
    problems,
    humanDecisions,
    coverage,
    checks,
  };
}

function questionsForHard(candidate: PlanningCandidatePayload): number {
  return (candidate.questions ?? []).filter((q) => q.required).length;
}

function buildCoverage(requiredSteps: readonly { readonly key: string }[], candidate: PlanningCandidatePayload): PlanningValidationOutput['coverage'] {
  return requiredSteps.map((step) => {
    const hit = candidate.nodes.filter((node) => node.key === step.key || node.key.startsWith(`${step.key}.`));
    return { requirementId: step.key, label: step.key, covered: hit.length > 0, nodeKeys: hit.map((h) => h.key) };
  });
}

function findCycle(nodeKeys: readonly string[], edges: readonly { readonly fromKey: string; readonly toKey: string }[]): string[] | null {
  const adjacency = new Map<string, string[]>();
  for (const key of nodeKeys) adjacency.set(key, []);
  for (const edge of edges) adjacency.get(edge.fromKey)?.push(edge.toKey);
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const visit = (key: string): string[] | null => {
    const current = state.get(key) ?? 0;
    if (current === 1) {
      const start = stack.indexOf(key);
      return [...stack.slice(start), key];
    }
    if (current === 2) return null;
    state.set(key, 1);
    stack.push(key);
    for (const next of adjacency.get(key) ?? []) {
      const cycle = visit(next);
      if (cycle !== null) return cycle;
    }
    stack.pop();
    state.set(key, 2);
    return null;
  };
  for (const key of nodeKeys) {
    const cycle = visit(key);
    if (cycle !== null) return cycle;
  }
  return null;
}

function maxDepth(nodeKeys: readonly string[], edges: readonly { readonly fromKey: string; readonly toKey: string }[]): number {
  const incoming = new Map<string, string[]>();
  for (const key of nodeKeys) incoming.set(key, []);
  for (const edge of edges) incoming.get(edge.toKey)?.push(edge.fromKey);
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (key: string): number => {
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    if (visiting.has(key)) return 0;
    visiting.add(key);
    const parents = incoming.get(key) ?? [];
    const value = parents.length === 0 ? 1 : 1 + Math.max(...parents.map(depth));
    visiting.delete(key);
    memo.set(key, value);
    return value;
  };
  return nodeKeys.reduce((max, key) => Math.max(max, depth(key)), 0);
}

export function isPlanningCandidatePayload(value: unknown): value is PlanningCandidatePayload {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<PlanningCandidatePayload>;
  return typeof candidate.summary === 'string' && Array.isArray(candidate.groups) && Array.isArray(candidate.nodes) && Array.isArray(candidate.edges);
}

/* ------------------------------------------------------------------ */
/* PE37 · incremental group refinement (design v5 Q10)                 */
/* ------------------------------------------------------------------ */

/** Unrefined groups are drawn as dashed placeholder nodes, never executable. */
export const PLACEHOLDER_KEY_PREFIX = 'placeholder.';
export const SCOPE_VIOLATION = 'SCOPE_VIOLATION';
export const SCOPE_UNREFINED = 'SCOPE_UNREFINED';

/** Settings-store keys shared by the engine and the next HTTP wave. */
export const PLANNING_ROUND_SCOPE_KEY = 'planning.round.scope.';
export const PLANNING_CANDIDATE_SCOPE_KEY = 'planning.candidate.scope.';
export const PLANNING_GROUP_REFINED_KEY = 'planning.group.refined.';

export const PlanningGroupState = {
  REFINED: 'refined',
  UNREFINED: 'unrefined',
  PLANNING: 'planning',
  CANDIDATE: 'candidate',
} as const;
export type PlanningGroupStateValue = (typeof PlanningGroupState)[keyof typeof PlanningGroupState];

/** One scoped refinement round: only this group may change. */
export interface PlanningRoundScope {
  readonly groupRef: string;
  readonly groupTitle: string;
  readonly placeholderNodeIds: readonly string[];
  /** Plan revision the scope preview was computed on (stale check). */
  readonly basePlanRevisionId: string;
}

/** Candidate scope persisted next to the candidate plan revision. */
export interface PlanningCandidateScope {
  readonly roundId: string;
  readonly groupRef: string;
  readonly basePlanRevisionId: string;
}

export interface PlanningGroupProposal {
  /** Stable plan group id (PlanGroup.id); the overview/diff scope key. */
  readonly groupRef: string;
  readonly title: string;
  readonly coverage: readonly string[];
  readonly state: PlanningGroupStateValue;
  /** Round ordinal that refined this group (undefined while unrefined). */
  readonly refinedInRound?: number;
  readonly leafCount: number;
  readonly placeholderNodeIds: readonly string[];
}

export interface PlanningProposal {
  readonly taskId: string;
  readonly planRevisionId?: string;
  readonly revisionNumber?: number;
  readonly groups: readonly PlanningGroupProposal[];
  readonly unresolvedScopes: readonly { readonly groupRef: string; readonly title: string }[];
  readonly limits: {
    readonly maxNodes: number;
    readonly maxGroups: number;
    readonly maxDepth: number;
    readonly currentNodes: number;
    readonly currentGroups: number;
    readonly projectedLeafCount: number;
  };
}

export interface RefineScopePreview {
  readonly previewRef: string;
  readonly taskId: string;
  readonly groupRef: string;
  readonly groupTitle: string;
  /** Ordinal the scoped round will get (rounds.length + 1). */
  readonly round: number;
  readonly scope: {
    readonly groupRef: string;
    readonly groupTitle: string;
    readonly placeholderNodeIds: readonly string[];
    readonly basePlanRevisionId: string;
  };
  readonly limits: {
    readonly maxNodes: number;
    readonly maxGroups: number;
    readonly maxDepth: number;
    readonly currentNodes: number;
    readonly currentGroups: number;
    readonly projectedLeafCount: number;
  };
  readonly budget: {
    readonly dispatches: number;
    readonly revisions: number;
    readonly budgetLimit: number;
    readonly currency: string;
    readonly perDispatchLimitMinutes: number;
    readonly timeLimitMinutes: number;
  };
  readonly expiresAt: IsoDateTime;
  readonly blockers: readonly { readonly code: string; readonly message: string }[];
  readonly instructions: readonly string[];
}

export function isPlaceholderNode(node: { readonly key: string }): boolean {
  return node.key.startsWith(PLACEHOLDER_KEY_PREFIX);
}

export function placeholderKeyFor(groupRef: string): string {
  return `${PLACEHOLDER_KEY_PREFIX}${groupRef}`;
}

export function groupLeafNodes(graph: PlanGraph, groupRef: string): readonly PlanNode[] {
  return graph.nodes.filter((node) => node.groupId === groupRef && !isPlaceholderNode(node));
}

/** Groups whose placeholder/unrefined state still blocks confirm (design S5). */
export function unresolvedPlanScopes(graph: PlanGraph): readonly { readonly groupRef: string; readonly title: string }[] {
  return graph.groups
    .filter((group) => {
      const placeholders = graph.nodes.filter((node) => node.groupId === group.id && isPlaceholderNode(node));
      return group.refined === false || placeholders.length > 0;
    })
    .map((group) => ({ groupRef: group.id, title: group.label }));
}

function scopedProblem(
  code: string,
  title: string,
  detail: string,
  nodeKey?: string,
): PlanningValidationOutput['problems'][number] {
  return { id: `${code}-${code.length}-${title.length}`, code, severity: 'hard', title, detail, ...(nodeKey === undefined ? {} : { nodeKey }) };
}

export interface ScopeValidationInput {
  readonly candidate: PlanningCandidatePayload;
  readonly baseGraph: PlanGraph;
  readonly scope: PlanningRoundScope;
  readonly limits: { readonly maxNodes: number; readonly maxEdges: number; readonly maxGroups: number; readonly maxDepth: number };
}

export interface ScopeValidationResult {
  readonly structural: 'passed' | 'failed';
  readonly problems: PlanningValidationOutput['problems'];
  readonly checks: PlanningValidationOutput['checks'];
}

/**
 * Validate a group-scoped candidate (design S3). Structural checks run on the
 * scoped subgraph; scope checks reject nodes/groups outside the group, keys that
 * collide with other refined groups, and edges that would add a new outer node.
 * Cross-group edges may point at nodes that already exist in the base graph.
 */
export function validateScopedCandidate(input: ScopeValidationInput): ScopeValidationResult {
  const { candidate, baseGraph, scope } = input;
  const candidateKeys = new Set(candidate.nodes.map((node) => node.key));
  const scopedProblemList: PlanningValidationOutput['problems'][number][] = [];

  if (candidate.groups.some((group) => group.id !== scope.groupRef)) {
    for (const group of candidate.groups.filter((item) => item.id !== scope.groupRef)) {
      scopedProblemList.push(scopedProblem(SCOPE_VIOLATION, '候选包含范围外分组', `本轮只允许细化分组 ${scope.groupRef}（${scope.groupTitle}），候选包含 ${group.id}（${group.label}）`));
    }
  }
  for (const node of candidate.nodes) {
    if (node.groupId !== scope.groupRef) {
      scopedProblemList.push(scopedProblem(SCOPE_VIOLATION, '候选包含组外步骤', `步骤 ${node.key} 属于分组 ${node.groupId}，本轮只允许 ${scope.groupRef}`, node.key));
    }
  }
  const outsideKeys = new Set(baseGraph.nodes.filter((node) => node.groupId !== scope.groupRef).map((node) => node.key));
  for (const node of candidate.nodes) {
    if (outsideKeys.has(node.key)) {
      scopedProblemList.push(scopedProblem(SCOPE_VIOLATION, '步骤键与组外步骤冲突', `键 ${node.key} 已存在于其他分组，不能在本轮新增或替换`, node.key));
    }
  }
  const baseByKey = new Map(baseGraph.nodes.map((node) => [node.key, node]));
  for (const edge of candidate.edges) {
    for (const endpoint of [edge.fromKey, edge.toKey]) {
      if (candidateKeys.has(endpoint)) continue;
      const baseNode = baseByKey.get(endpoint);
      if (baseNode === undefined) {
        scopedProblemList.push(scopedProblem(SCOPE_VIOLATION, '依赖引用组外未知步骤', `边 ${edge.fromKey} → ${edge.toKey} 引用了不存在的组外步骤 ${endpoint}`));
      } else if (baseNode.groupId === scope.groupRef) {
        scopedProblemList.push(scopedProblem(SCOPE_VIOLATION, '依赖引用本组旧步骤', `边 ${edge.fromKey} → ${edge.toKey} 引用了本轮将被替换的旧步骤 ${endpoint}`));
      }
    }
  }

  // Structural validation only sees the scoped subgraph: outer endpoints are
  // checked by the scope rules above and merged afterwards.
  const scopedEdges = candidate.edges.filter((edge) => candidateKeys.has(edge.fromKey) && candidateKeys.has(edge.toKey));
  const structuralCandidate: PlanningCandidatePayload = { ...candidate, edges: scopedEdges, questions: [], assumptions: [], humanDecisions: [] };
  const structural = validatePlanningCandidate({
    candidate: structuralCandidate,
    requiredSteps: [],
    refinableGroups: [],
    limits: { ...input.limits, maxNodes: Number.MAX_SAFE_INTEGER, maxEdges: Number.MAX_SAFE_INTEGER, maxGroups: Number.MAX_SAFE_INTEGER, maxDepth: Number.MAX_SAFE_INTEGER },
  });
  const problems = [...structural.problems, ...scopedProblemList];

  const outsideLeafNodes = baseGraph.nodes.filter((node) => node.groupId !== scope.groupRef && !isPlaceholderNode(node));
  const mergedNodeCount = outsideLeafNodes.length + candidate.nodes.length;
  if (mergedNodeCount > input.limits.maxNodes) {
    problems.push(scopedProblem('LIMIT_NODES', '合并后步骤数超过上限', `合并后 ${mergedNodeCount} 个步骤，上限 ${input.limits.maxNodes}`));
  }
  if (baseGraph.groups.length > input.limits.maxGroups) {
    problems.push(scopedProblem('LIMIT_GROUPS', '分组数超过上限', `当前 ${baseGraph.groups.length} 个分组，上限 ${input.limits.maxGroups}`));
  }
  const checks: PlanningValidationOutput['checks'] = [
    ...structural.checks.map((check) => check.id === 'V1' ? { ...check, label: '组内步骤结构有效' } : check),
    { id: 'S1', label: '细化范围合法（只改本组）', state: scopedProblemList.length === 0 ? 'passed' : 'failed' },
    { id: 'S2', label: '合并后在规模上限内', state: problems.some((problem) => problem.code === 'LIMIT_NODES' || problem.code === 'LIMIT_GROUPS') ? 'failed' : 'passed' },
  ];
  return {
    structural: problems.some((problem) => problem.severity === 'hard') ? 'failed' : 'passed',
    problems,
    checks,
  };
}

/**
 * Merge one scoped candidate into the overview draft (design S3/S4). Other
 * groups keep their exact nodes/ids; the scoped group's placeholder nodes are
 * replaced by the candidate leaves; cross-group edges that referenced the
 * placeholder are rewired to the new entry/exit nodes so the overview wiring is
 * preserved.
 */
export function mergeScopedCandidate(base: PlanGraph, candidate: PlanningCandidatePayload, scope: PlanningRoundScope): PlanGraph {
  const placeholderIds = new Set(base.nodes.filter((node) => node.groupId === scope.groupRef && isPlaceholderNode(node)).map((node) => node.id));
  const groups: PlanGroup[] = base.groups.map((group) => (group.id === scope.groupRef ? { ...group, refined: true } : group));
  const groupIndex = Math.max(0, groups.findIndex((group) => group.id === scope.groupRef));
  const nodeIds = new Map<string, string>();
  const scopedNodes: PlanNode[] = candidate.nodes.map((node, index) => {
    const id = createId('pn');
    nodeIds.set(node.key, id);
    return {
      id,
      key: node.key,
      title: node.title,
      kind: node.kind,
      groupId: scope.groupRef,
      summary: node.summary,
      inputs: (node.inputs ?? []).map((inputRef) => ({
        name: inputRef.name,
        source: inputRef.source,
        sourceNodeId: inputRef.fromKey === undefined ? undefined : nodeIds.get(inputRef.fromKey),
      })),
      outputs: (node.outputs ?? []).map((output) => ({ name: output.name, kind: output.kind })),
      acceptance: node.acceptance ?? [],
      resources: {
        read: (node.resources?.read ?? []).map((resource) => ({ ...resource, basis: 'declared' as const })),
        write: (node.resources?.write ?? []).map((resource) => ({ ...resource, basis: 'declared' as const })),
      },
      roleId: node.roleId,
      position: { x: 80 + groupIndex * 300, y: 80 + index * 130 },
    };
  });
  const baseNodeIds = new Map(base.nodes.map((node) => [node.key, node.id]));
  const keptNodes = base.nodes.filter((node) => !placeholderIds.has(node.id));
  const internalEdges = candidate.edges.filter((edge) => nodeIds.has(edge.fromKey) && nodeIds.has(edge.toKey));
  const candidateRoots = candidate.nodes.filter((node) => !internalEdges.some((edge) => edge.toKey === node.key)).map((node) => node.key);
  const candidateSinks = candidate.nodes.filter((node) => !internalEdges.some((edge) => edge.fromKey === node.key)).map((node) => node.key);

  const edges: PlanEdge[] = base.edges
    .filter((edge) => !placeholderIds.has(edge.from) && !placeholderIds.has(edge.to))
    .map((edge) => ({ ...edge }));
  for (const edge of internalEdges) {
    edges.push({ id: createId('pe'), from: nodeIds.get(edge.fromKey)!, to: nodeIds.get(edge.toKey)!, kind: edge.kind, label: edge.label });
  }
  // Edges originally pointing into/out of the placeholder are rewired to the
  // scoped entry/exit leaves (overview cross-group wiring preserved).
  for (const edge of base.edges) {
    const fromPlaceholder = placeholderIds.has(edge.from);
    const toPlaceholder = placeholderIds.has(edge.to);
    if (!fromPlaceholder && !toPlaceholder) continue;
    if (toPlaceholder && !fromPlaceholder) {
      for (const key of candidateRoots) edges.push({ id: createId('pe'), from: edge.from, to: nodeIds.get(key)!, kind: edge.kind, label: edge.label });
    } else if (fromPlaceholder && !toPlaceholder) {
      for (const key of candidateSinks) edges.push({ id: createId('pe'), from: nodeIds.get(key)!, to: edge.to, kind: edge.kind, label: edge.label });
    }
  }
  // Candidate edges that point at preserved outside nodes become cross-group edges.
  for (const edge of candidate.edges) {
    if (internalEdges.includes(edge)) continue;
    const from = nodeIds.get(edge.fromKey) ?? (placeholderIds.has(baseNodeIds.get(edge.fromKey) ?? '') ? undefined : baseNodeIds.get(edge.fromKey));
    const to = nodeIds.get(edge.toKey) ?? (placeholderIds.has(baseNodeIds.get(edge.toKey) ?? '') ? undefined : baseNodeIds.get(edge.toKey));
    if (from === undefined || to === undefined) continue;
    edges.push({ id: createId('pe'), from, to, kind: edge.kind, label: edge.label });
  }
  const seen = new Set<string>();
  const deduped = edges.filter((edge) => {
    const key = `${edge.from}->${edge.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { nodes: [...keptNodes, ...scopedNodes], edges: deduped, groups };
}

/** Record that a group was refined in a concrete round (carried per plan revision). */
export function withRefinedGroup(map: Readonly<Record<string, number>>, groupRef: string, roundOrdinal: number): Record<string, number> {
  return { ...map, [groupRef]: roundOrdinal };
}
