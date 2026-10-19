import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, validateSettings, type PlanNode } from '@agent-workflow/shared';
import { executionTimeoutMs, retryDelayMs } from './execution-policy.ts';

const node: PlanNode = { id: 'n', key: 'n', title: 'n', kind: 'design', groupId: 'g', summary: '', inputs: [], outputs: [], acceptance: [], resources: { read: [], write: [] } };

test('retry delay classification is bounded exponential waiting, never a dispatch policy', () => {
  const policy = { ...DEFAULT_SETTINGS.execution, retryDelays: { modelRateLimit: { initialMs: 100, maxMs: 250 }, sessionError: { initialMs: 10, maxMs: 40 }, verificationFailure: { initialMs: 0, maxMs: 0 } } };
  assert.equal(retryDelayMs(policy, { code: 'OPENCODE_NOT_READY', message: '429 rate limit' }, 1), 100);
  assert.equal(retryDelayMs(policy, { code: 'OPENCODE_NOT_READY', message: '429 rate limit' }, 3), 250);
  assert.equal(retryDelayMs(policy, { code: 'OPENCODE_NOT_READY', message: 'session unavailable' }, 4), 40);
  assert.equal(retryDelayMs(policy, { code: 'VALIDATION_FAILED', message: 'validation failed' }, 10), 0);
  assert.equal(retryDelayMs(policy, { code: 'STOPPED', message: 'user stopped' }, 10), 0);
});

test('business deadlines use the tightest task/attempt/design budget and retain independent role limits', () => {
  const policy = { ...DEFAULT_SETTINGS.execution, timeoutEnabled: true, nodeTimeoutMinutes: 20, taskTimeoutMinutes: 30, designTimeoutMinutes: 5 };
  const now = Date.parse('2026-10-20T00:10:00Z');
  assert.equal(executionTimeoutMs(policy, node, '2026-10-20T00:00:00Z', '2026-10-20T00:08:00Z', now), 180000);
  assert.equal(executionTimeoutMs({ ...policy, timeoutEnabled: false }, node, undefined, undefined, now), 0);
  const bounded = Object.assign({}, node, { roleSnapshot: { maxRuntimeMinutes: 2 } });
  assert.equal(executionTimeoutMs({ ...policy, timeoutEnabled: false }, bounded, undefined, undefined, now), 120000);
});

test('budget, business timeout and retry wait settings reject invalid values', () => {
  const invalid = { ...DEFAULT_SETTINGS, execution: { ...DEFAULT_SETTINGS.execution, maxTaskAttempts: 0, sessionErrorThreshold: 11, taskTimeoutMinutes: 10081, retryDelays: { ...DEFAULT_SETTINGS.execution.retryDelays, modelRateLimit: { initialMs: 100, maxMs: 99 } } } };
  const paths = validateSettings(invalid).map((issue) => issue.path);
  for (const path of ['execution.maxTaskAttempts', 'execution.sessionErrorThreshold', 'execution.taskTimeoutMinutes', 'execution.retryDelays.modelRateLimit']) assert.ok(paths.includes(path));
});
