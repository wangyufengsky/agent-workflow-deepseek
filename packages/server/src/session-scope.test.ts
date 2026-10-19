import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MODEL_PROFILES } from '@agent-workflow/shared';
import { createSessionScope, requireSessionScope } from './session-scope.ts';

test('session authorities are unpredictable, immutable, revocable and expire independently', () => {
  const request = { kind: 'execution' as const, metadata: { taskId: 'one' }, cwd: '.', prompt: '', model: DEFAULT_MODEL_PROFILES[0]!, permission: 'workspace_write' as const, sink: {}, timeoutMs: 1000 };
  const one = createSessionScope(request);
  const two = createSessionScope({ ...request, metadata: { taskId: 'two' } });
  request.metadata.taskId = 'mutated';
  assert.notEqual(one.token, two.token);
  assert.equal(requireSessionScope(one.token).request.metadata.taskId, 'one');
  assert.equal(requireSessionScope(two.token).request.metadata.taskId, 'two');
  assert.throws(() => requireSessionScope('guessed-token'));
  one.revoke();
  assert.throws(() => requireSessionScope(one.token));
  assert.equal(requireSessionScope(two.token).request.metadata.taskId, 'two');
  two.revoke();
  const expired = createSessionScope({ ...request, timeoutMs: -31_000 });
  assert.throws(() => requireSessionScope(expired.token));
});
