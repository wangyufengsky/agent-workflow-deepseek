import type {
  MethodStepDefinition,
  NodeDiff,
  PlanEdge,
  PlanGraph,
  PlanGroup,
  PlanNode,
  PlanningCandidatePayload,
  WorkflowMethod,
} from '@agent-workflow/shared';
import { createId, methodDependencies } from '@agent-workflow/shared';

const GROUP_ORDER = ['需求', '设计', '实现', '测试', '验收', '交付'];

function groupIdFor(label: string): string {
  const known = GROUP_ORDER.indexOf(label);
  return known >= 0 ? `group.${known}` : `group.${slug(label)}`;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-|-$/g, '');
}

function groupsFrom(steps: readonly { readonly group: string }[]): PlanGroup[] {
  const labels = [...new Set(steps.map((step) => step.group))];
  labels.sort((a, b) => {
    const ai = GROUP_ORDER.indexOf(a);
    const bi = GROUP_ORDER.indexOf(b);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
  return labels.map((label, index) => ({
    id: `group.${index}`,
    label,
    kind: label,
    refined: true,
    collapsible: true,
    collapsedByDefault: false,
  }));
}

function positionFor(groupIndex: number, indexInGroup: number): { x: number; y: number } {
  return { x: 80 + groupIndex * 300, y: 80 + indexInGroup * 130 };
}

export function methodToGraph(method: WorkflowMethod): PlanGraph {
  const groups = groupsFrom(method.requiredSteps);
  const groupIndex = new Map(groups.map((group, index) => [group.label, index]));
  const nodes: PlanNode[] = method.requiredSteps.map((step, index) => {
    const group = step.group;
    const indexInGroup = method.requiredSteps.slice(0, index).filter((item) => item.group === group).length;
    return {
      id: createId('pn'),
      key: step.key,
      title: step.title,
      kind: step.kind,
      groupId: groups[groupIndex.get(group) ?? 0]?.id ?? 'group.0',
      summary: step.summary ?? `${step.title}（方法骨架步骤）`,
      inputs: step.inputs ?? [],
      outputs: step.outputs ?? [{ name: `${step.title}产物`, kind: 'artifact' }],
      acceptance: step.acceptance ?? [`${step.title}完成，且有可核对的证据`],
      resources: { read: [], write: [] },
      roleId: step.roleId ?? (step.kind === 'test' ? 'role.tester' : step.kind === 'verify' ? 'role.reviewer' : 'role.developer'),
      templateRevision: `${method.id}@${method.revision}`,
      position: step.position ?? positionFor(groupIndex.get(group) ?? 0, indexInGroup),
    };
  });
  const edges: PlanEdge[] = [];
  for (const [index, to] of nodes.entries()) {
    for (const key of methodDependencies(method.requiredSteps, index)) {
      const from = nodes.find((node) => node.key === key);
      if (from !== undefined) edges.push({ id: createId('pe'), from: from.id, to: to.id, kind: 'order', label: '先后' });
    }
  }
  return { nodes, edges, groups };
}

export function candidateToGraph(candidate: PlanningCandidatePayload): PlanGraph {
  const groupIds = new Map<string, string>();
  const groups: PlanGroup[] = candidate.groups.map((group, index) => {
    const id = group.id.startsWith('group.') ? group.id : `group.${index}`;
    groupIds.set(group.id, id);
    return {
      id,
      label: group.label,
      kind: group.kind,
      refined: group.refined ?? true,
      collapsible: true,
      collapsedByDefault: false,
    };
  });
  const nodeIds = new Map<string, string>();
  const nodes: PlanNode[] = candidate.nodes.map((node, index) => {
    const id = createId('pn');
    nodeIds.set(node.key, id);
    const groupIndex = Math.max(0, candidate.groups.findIndex((group) => group.id === node.groupId));
    const indexInGroup = candidate.nodes.slice(0, index).filter((item) => item.groupId === node.groupId).length;
    return {
      id,
      key: node.key,
      title: node.title,
      kind: node.kind,
      groupId: groupIds.get(node.groupId) ?? groups[groupIndex]?.id ?? groups[0]?.id ?? 'group.0',
      summary: node.summary,
      inputs: (node.inputs ?? []).map((inputRef) => ({
        name: inputRef.name,
        source: inputRef.source,
        sourceNodeId: inputRef.fromKey === undefined ? undefined : nodeIds.get(inputRef.fromKey),
      })),
      outputs: (node.outputs ?? []).map((output) => ({ name: output.name, kind: output.kind })),
      acceptance: node.acceptance ?? [],
      resources: {
        read: (node.resources?.read ?? []).map((resource) => ({ ...resource, basis: 'declared' })),
        write: (node.resources?.write ?? []).map((resource) => ({ ...resource, basis: 'declared' })),
      },
      roleId: node.roleId,
      position: positionFor(groupIndex, indexInGroup),
    };
  });
  const edges: PlanEdge[] = candidate.edges.map((edge) => ({
    id: createId('pe'),
    from: nodeIds.get(edge.fromKey) ?? edge.fromKey,
    to: nodeIds.get(edge.toKey) ?? edge.toKey,
    kind: edge.kind,
    label: edge.label,
  }));
  return { nodes, edges, groups };
}

export function diffGraphs(base: PlanGraph | undefined, next: PlanGraph): NodeDiff[] {
  const baseByKey = new Map((base?.nodes ?? []).map((node) => [node.key, node]));
  const nextKeys = new Set(next.nodes.map((node) => node.key));
  const diffs: NodeDiff[] = next.nodes.map((node) => {
    const previous = baseByKey.get(node.key);
    const kind: NodeDiff['kind'] =
      previous === undefined
        ? 'added'
        : previous.title === node.title && previous.summary === node.summary && sameEdges(base, node.id, next, node.id)
          ? 'unchanged'
          : 'modified';
    return { nodeId: node.id, nodeKey: node.key, title: node.title, kind, summary: node.summary, groupId: node.groupId };
  });
  for (const previous of base?.nodes ?? []) {
    if (!nextKeys.has(previous.key)) {
      diffs.push({
        nodeId: previous.id,
        nodeKey: previous.key,
        title: previous.title,
        kind: 'replaced_by_refinement',
        summary: `由细化替换：${previous.title}`,
        groupId: previous.groupId,
      });
    }
  }
  return diffs;
}

function sameEdges(a: PlanGraph | undefined, aId: string, b: PlanGraph, bId: string): boolean {
  if (a === undefined) return false;
  const aEdges = a.edges.filter((edge) => edge.from === aId || edge.to === aId).length;
  const bEdges = b.edges.filter((edge) => edge.from === bId || edge.to === bId).length;
  return aEdges === bEdges;
}

export function graphStats(graph: PlanGraph | undefined): { nodes: number; edges: number; groups: number } {
  return { nodes: graph?.nodes.length ?? 0, edges: graph?.edges.length ?? 0, groups: graph?.groups.length ?? 0 };
}

export function methodStepsForGroup(method: WorkflowMethod, group: string): readonly MethodStepDefinition[] {
  return method.requiredSteps.filter((step) => step.group === group);
}
