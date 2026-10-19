import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CATALOG } from '@agent-workflow/shared';
import { candidateToGraph, diffGraphs, methodToGraph } from './graph.ts';
import { validatePlanningCandidate } from '@agent-workflow/shared';

const method = DEFAULT_CATALOG.methods.find((item) => item.id === 'method.requirement-development')!;

function candidateFor(methodKeys: readonly string[]) {
  const groups = [
    { id: 'g1', label: '需求', kind: 'requirement' as const },
    { id: 'g2', label: '实现', kind: 'implementation' as const },
    { id: 'g3', label: '测试', kind: 'test' as const },
  ];
  const nodes = methodKeys.map((key, index) => ({
    key,
    title: key,
    kind: 'implementation' as const,
    groupId: index % 2 === 0 ? 'g2' : 'g3',
    summary: `${key} 说明`,
    acceptance: [`${key} 验收`],
  }));
  const edges = nodes.slice(1).map((node, index) => ({ fromKey: nodes[index]!.key, toKey: node.key, kind: 'order' as const }));
  return { summary: '候选', groups, nodes, edges };
}

test('methodToGraph keeps every required step and links them in order', () => {
  const graph = methodToGraph(method);
  assert.equal(graph.nodes.length, method.requiredSteps.length);
  assert.equal(graph.edges.length, method.requiredSteps.length - 1);
  for (const step of method.requiredSteps) assert.ok(graph.nodes.some((node) => node.key === step.key));
  for (const edge of graph.edges) {
    assert.ok(graph.nodes.some((node) => node.id === edge.from));
    assert.ok(graph.nodes.some((node) => node.id === edge.to));
  }
});

test('candidateToGraph maps keys to ids and keeps edges', () => {
  const candidate = candidateFor(method.requiredSteps.map((step) => step.key));
  const graph = candidateToGraph(candidate);
  assert.equal(graph.nodes.length, candidate.nodes.length);
  assert.equal(graph.edges.length, candidate.edges.length);
  assert.equal(new Set(graph.nodes.map((node) => node.id)).size, graph.nodes.length);
  const diff = diffGraphs(undefined, graph);
  assert.equal(diff.length, graph.nodes.length);
  assert.ok(diff.every((item) => item.kind === 'added'));
});

test('validatePlanningCandidate accepts a complete acyclic candidate', () => {
  const candidate = candidateFor(method.requiredSteps.map((step) => step.key));
  const result = validatePlanningCandidate({
    candidate,
    requiredSteps: method.requiredSteps,
    refinableGroups: method.refinableGroups,
    limits: { maxNodes: 40, maxEdges: 80, maxGroups: 8, maxDepth: 12 },
  });
  assert.equal(result.structural, 'passed', JSON.stringify(result.problems));
  assert.ok(result.checks.every((check) => check.state === 'passed'));
});

test('validatePlanningCandidate rejects cycles, missing steps and write collisions', () => {
  const candidate = candidateFor(method.requiredSteps.map((step) => step.key));
  const cyclic = {
    ...candidate,
    edges: [...candidate.edges, { fromKey: candidate.nodes.at(-1)!.key, toKey: candidate.nodes[0]!.key, kind: 'order' as const }],
  };
  const cycleResult = validatePlanningCandidate({
    candidate: cyclic,
    requiredSteps: method.requiredSteps,
    refinableGroups: method.refinableGroups,
    limits: { maxNodes: 40, maxEdges: 80, maxGroups: 8, maxDepth: 12 },
  });
  assert.equal(cycleResult.structural, 'failed');
  assert.ok(cycleResult.problems.some((problem) => problem.code === 'CYCLE'));

  const missing = candidateFor([method.requiredSteps[0]!.key]);
  const missingResult = validatePlanningCandidate({
    candidate: missing,
    requiredSteps: method.requiredSteps,
    refinableGroups: method.refinableGroups,
    limits: { maxNodes: 40, maxEdges: 80, maxGroups: 8, maxDepth: 12 },
  });
  assert.ok(missingResult.problems.some((problem) => problem.code === 'MISSING_STEP'));

  const colliding = {
    ...candidateFor(method.requiredSteps.map((step) => step.key)),
    nodes: candidateFor(method.requiredSteps.map((step) => step.key)).nodes.map((node) => ({
      ...node,
      resources: { write: [{ kind: 'file' as const, label: 'src/app.ts' }] },
    })),
  };
  const collisionResult = validatePlanningCandidate({
    candidate: colliding,
    requiredSteps: method.requiredSteps,
    refinableGroups: method.refinableGroups,
    limits: { maxNodes: 40, maxEdges: 80, maxGroups: 8, maxDepth: 12 },
  });
  assert.ok(collisionResult.problems.some((problem) => problem.code === 'WRITE_COLLISION'));
});

test('method compilation uses explicit predecessors, branch roots, authored content and role choices', () => {
  const graph = methodToGraph({ ...method, requiredSteps: [
    { key: 'a', title: 'A', kind: 'implementation', group: '实现', requires: [], roleId: 'role.reviewer', summary: '职责', inputs: [{ name: '输入', source: 'manual' }], outputs: [{ name: '输出', kind: 'summary' }], acceptance: ['验收'], position: { x: 4, y: 8 } },
    { key: 'b', title: 'B', kind: 'test', group: '测试', requires: [] },
    { key: 'join', title: 'C', kind: 'verify', group: '验收', requires: ['a', 'b'] },
  ] });
  const key = (id: string) => graph.nodes.find((node) => node.id === id)!.key;
  assert.deepEqual(graph.edges.map((edge) => `${key(edge.from)}->${key(edge.to)}`).sort(), ['a->join', 'b->join']);
  assert.equal(graph.nodes[0]!.roleId, 'role.reviewer');
  assert.equal(graph.nodes[0]!.summary, '职责');
  assert.deepEqual(graph.nodes[0]!.acceptance, ['验收']);
  assert.deepEqual(graph.nodes[0]!.position, { x: 4, y: 8 });
});


test('AI candidates retain explicit workflow predecessor constraints, allowing intermediate steps', () => {
  const candidate = candidateFor(['a', 'middle', 'b']);
  const input = { candidate, requiredSteps: [{ key: 'a', kind: 'implementation' as const, group: '实现', requires: [] }, { key: 'b', kind: 'implementation' as const, group: '实现', requires: ['a'] }], refinableGroups: [], limits: { maxNodes: 40, maxEdges: 80, maxGroups: 8, maxDepth: 12 } };
  assert.equal(validatePlanningCandidate(input).structural, 'passed');
  const disconnected = validatePlanningCandidate({ ...input, candidate: { ...candidate, edges: [] } });
  assert.ok(disconnected.problems.some((item) => item.code === 'METHOD_DEPENDENCY_MISSING'));
  assert.equal(disconnected.checks.find((item) => item.id === 'V1')!.state, 'failed');
});


test('AI cannot silently serialize an explicit parallel root; additions need mapped input or human review', () => {
  const base = candidateFor(['a', 'b']);
  const input = { candidate: base, requiredSteps: [{ key: 'a', kind: 'implementation' as const, group: '实现', requires: [] }, { key: 'b', kind: 'implementation' as const, group: '实现', requires: [] }], refinableGroups: [], limits: { maxNodes: 40, maxEdges: 80, maxGroups: 8, maxDepth: 12 } };
  assert.ok(validatePlanningCandidate(input).problems.some((item) => item.code === 'METHOD_DEPENDENCY_UNJUSTIFIED'));
  const mapped = { ...base, nodes: base.nodes.map((node) => node.key === 'b' ? { ...node, inputs: [{ name: 'A产物', source: 'upstream' as const, fromKey: 'a' }] } : node), edges: [{ fromKey: 'a', toKey: 'b', kind: 'data' as const, label: 'B读取A生成的产物' }] };
  assert.equal(validatePlanningCandidate({ ...input, candidate: mapped }).structural, 'passed');
  const declaredOrder = { ...base, edges: [{ fromKey: 'a', toKey: 'b', kind: 'order' as const, label: '用户需确认先审阅A再处理B' }], humanDecisions: [{ title: '确认改变并行配置', detail: '原本并行的A/B改为先后执行，由用户决定是否采纳', nodeKeys: ['b'] }] };
  const validation = validatePlanningCandidate({ ...input, candidate: declaredOrder });
  assert.equal(validation.structural, 'passed');
  assert.equal(validation.humanDecisions.length, 1);
});
