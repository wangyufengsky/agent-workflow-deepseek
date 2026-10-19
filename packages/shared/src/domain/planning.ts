import type { NodeKindValue } from '../domain/enums.ts';

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

export interface PlanningCandidateQuestion {
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
  readonly requiredSteps: readonly { readonly key: string; readonly title?: string; readonly kind: NodeKindValue; readonly group: string; readonly optional?: boolean }[];
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
    { id: 'V1', label: '必经步骤齐全', state: problems.some((p) => p.code === 'MISSING_STEP') ? 'failed' : 'passed' },
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
