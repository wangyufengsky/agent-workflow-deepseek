import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explicitMethodSteps, methodCycle, type MethodStepDefinition } from '@agent-workflow/shared';
import { addWorkflowStep, connectWorkflowSteps, removeWorkflowStep, workflowDifferences } from '../../apps/web/src/pages/workflows/workflow-graph.ts';
const step = (key: string): MethodStepDefinition => ({ key, title: key, kind: 'implementation', group: '实现' });

test('parallel insertion retains predecessors and adds every downstream join dependency', () => {
  const before = [step('a'), step('b'), step('join')];
  const after = addWorkflowStep(before, step('parallel'), 'b', 'parallel');
  assert.deepEqual(after.find((item) => item.key === 'parallel')!.requires, ['a']);
  assert.deepEqual(after.find((item) => item.key === 'join')!.requires, ['b', 'parallel']);
  assert.equal(methodCycle(after), undefined);
  const removed = removeWorkflowStep(after, 'b');
  assert.deepEqual(removed.find((item) => item.key === 'join')!.requires, ['a', 'parallel']);
});

test('connections reject real cycles including implicit legacy edges; removed last predecessor stays a root', () => {
  const before = [step('a'), step('b'), step('c')];
  assert.equal(connectWorkflowSteps(before, 'c', 'a'), undefined);
  const explicit = explicitMethodSteps(before);
  const root = explicit.map((item) => item.key === 'b' ? { ...item, requires: [] } : item);
  assert.deepEqual(explicitMethodSteps(root)[1]!.requires, []);
  assert.deepEqual(workflowDifferences(explicit, root).map((item) => [item.key, item.fields]), [['b', ['requires']]]);
});

test('after insertion rewires only outgoing dependencies and version diff reports changed edges and content', () => {
  const before = [step('a'), step('b'), step('c')];
  const after = addWorkflowStep(before, { ...step('inserted'), summary: '职责' }, 'a');
  assert.deepEqual(after.find((item) => item.key === 'b')!.requires, ['inserted']);
  assert.deepEqual(after.find((item) => item.key === 'c')!.requires, ['b']);
  const differences = workflowDifferences(before, after);
  assert.equal(differences.find((item) => item.key === 'inserted')!.kind, 'added');
  assert.deepEqual(differences.find((item) => item.key === 'b')!.fields, ['requires']);
});
