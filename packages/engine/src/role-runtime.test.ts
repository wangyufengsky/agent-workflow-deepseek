import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CATALOG, DEFAULT_MODEL_PROFILES } from '@agent-workflow/shared';
import { methodToGraph } from './graph.ts';
import { freezeGraphRoles, roleCommandAllowed, roleFileAllowed, roleModel } from './role-runtime.ts';

test('method occupation survives skeleton creation and published revisions freeze independently', () => {
  const method = DEFAULT_CATALOG.methods[0]!;
  const graph = methodToGraph({ ...method, requiredSteps: [{ ...method.requiredSteps[0]!, kind: 'implementation', roleId: 'role.reviewer' }] });
  assert.equal(graph.nodes[0]?.roleId, 'role.reviewer');
  const reviewer = { ...DEFAULT_CATALOG.roles.find((role) => role.id === 'role.reviewer')!, instructions: 'review only', revision: 'r77' };
  const frozen = freezeGraphRoles(graph, [reviewer]);
  reviewer.instructions = 'new instructions';
  assert.equal(frozen.nodes[0]?.roleSnapshot?.instructions, 'review only');
  assert.equal(frozen.nodes[0]?.roleSnapshot?.revision, 'r77');
  assert.equal(freezeGraphRoles(frozen, []).nodes[0]?.roleSnapshot?.revision, 'r77');
  assert.throws(() => freezeGraphRoles(graph, []));
});

test('role model is selected explicitly and unavailable choices fail closed', () => {
  const role = DEFAULT_CATALOG.roles[0]!;
  const selected = DEFAULT_MODEL_PROFILES.find((model) => model.roles.includes('reviewer'))!;
  assert.equal(roleModel({ ...role, model: selected.id }, DEFAULT_MODEL_PROFILES).id, selected.id);
  assert.throws(() => roleModel({ ...role, model: 'missing' }, DEFAULT_MODEL_PROFILES));
});

test('file and command ceilings reject traversal, sibling paths, expanded argv and writes', () => {
  const role = { ...DEFAULT_CATALOG.roles[0]!, resourcePermissions: { tools: [], resources: [], files: [{ kind: 'read' as const, path: 'src' }], commands: [{ kind: 'argv' as const, argv: ['npm', 'test'] }] } };
  assert.equal(roleFileAllowed(role, 'src/app.ts', 'read'), true);
  assert.equal(roleFileAllowed(role, 'src-other/app.ts', 'read'), false);
  assert.equal(roleFileAllowed(role, 'src/../secret', 'read'), false);
  assert.equal(roleFileAllowed(role, 'src/app.ts', 'write'), false);
  assert.equal(roleCommandAllowed(role, ['npm', 'test']), true);
  assert.equal(roleCommandAllowed(role, ['npm', 'test', '--', 'shell']), false);
});
