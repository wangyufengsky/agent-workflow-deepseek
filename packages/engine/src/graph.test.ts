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
