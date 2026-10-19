import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MODEL_PROFILES, DEFAULT_SETTINGS } from '@agent-workflow/shared';
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

for (const timeoutMs of [0, 60_000]) {
  test(`session grant respects ${timeoutMs === 0 ? 'unlimited' : 'bounded'} run lifetime and explicit revocation`, (context) => {
    const started = new Date('2026-10-20T00:00:00Z');
    context.mock.timers.enable({ apis: ['Date'], now: started });
    const scope = createSessionScope({ kind: 'execution', metadata: { taskId: 'lifetime-fixture' }, cwd: '.', prompt: '', permission: 'read_only', model: DEFAULT_SETTINGS.models[0]!, sink: {}, timeoutMs });
    try {
      context.mock.timers.tick(31_000);
      assert.equal(requireSessionScope(scope.token).request.metadata.taskId, 'lifetime-fixture', 'ordinary model work or a user answer must not lose its scope at 30 seconds');
      context.mock.timers.tick(60_000);
      if (timeoutMs > 0) assert.throws(() => requireSessionScope(scope.token), /已过期/);
      else {
        assert.equal(requireSessionScope(scope.token).request.timeoutMs, 0);
        scope.revoke();
        assert.throws(() => requireSessionScope(scope.token), /已结束/);
      }
    } finally { scope.revoke(); }
  });
}
