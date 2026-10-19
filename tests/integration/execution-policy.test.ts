import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '@agent-workflow/storage';
import { Engine, type OpenCodePort, type OpenCodeRunRequest, type OpenCodeRunResult } from '../../packages/engine/src/index.ts';
import type { ExecutionSettings, PlanGraph, PlanNode } from '@agent-workflow/shared';

// Offline scheduler/control-flow evidence. No model or runtime is used.
function fixture(input: Partial<ExecutionSettings> = {}, writes = false, kind: PlanNode['kind'] = 'implementation') {
  const store = new Store({ dataDir: mkdtempSync(join(tmpdir(), 'aw-policy-')) });
  const calls: Array<{ request: OpenCodeRunRequest; resolve: (result: OpenCodeRunResult) => void }> = [];
  const aborts: string[] = [];
  let rejectSecondAbort = false;
  let beforeSessionFailure: string | undefined;
  let preflightCalls = 0;
  let inspected: 'idle' | 'running' | 'unknown' = 'unknown';
  const port: OpenCodePort = {
    status: () => ({ state: 'ready' }) as ReturnType<OpenCodePort['status']>, ensureReady: async () => {}, findSessions: async () => [], inspectSession: async () => inspected,
    abortSession: async (id) => { aborts.push(id); if (rejectSecondAbort && id === 'session-2') throw new Error('offline second abort failed'); },
    runSession: (request) => {
      if (beforeSessionFailure !== undefined) { preflightCalls++; return Promise.reject(new Error(beforeSessionFailure)); }
      return new Promise((resolve) => { calls.push({ request, resolve }); request.onSessionId?.(`session-${calls.length}`); });
    },
  };
  const engine = new Engine({ store, ports: { git: {} as never, opencode: port }, integration: { opencodeReady: () => true, gitlabConfigured: () => false } });
  engine.updateSettings({ ...engine.settings, execution: { ...engine.settings.execution, maxConcurrentNodes: 2, pauseTimeoutMs: 5, ...input } });
  const project = store.projects.create({ name: 'policy', rootPath: store.dataDir, gitState: 'not_git' });
  const task = store.tasks.create({ projectId: project.id, title: 'policy', requirementText: 'offline', methodId: 'method.requirement-development', methodRevision: 'r12' });
  const role = structuredClone(engine.catalog.roles.find((item) => item.id === 'role.developer')!);
  Object.assign(role, { resourcePermissions: { files: [{ kind: writes ? 'write' : 'read', path: '.' }], commands: [], tools: [], resources: [] } });
  const node = (id: string): PlanNode => Object.assign({ id, key: id, title: id, kind, groupId: 'g', summary: '', inputs: [], outputs: [], acceptance: [], resources: { read: [], write: [] }, roleId: role.id }, { roleSnapshot: role });
  const graph: PlanGraph = { nodes: [node('a'), node('b'), node('c')], edges: [{ id: 'ac', from: 'a', to: 'c', kind: 'order' }, { id: 'bc', from: 'b', to: 'c', kind: 'order' }], groups: [{ id: 'g', label: 'g', kind: 'implementation', refined: false, collapsible: false, collapsedByDefault: false }] };
  const plan = store.plans.create({ taskId: task.id, source: 'manual', graph, status: 'confirmed' });
  const workspace = store.workspaces.create({ taskId: task.id, kind: 'directory_copy', displayRoot: store.dataDir });
  store.workspaces.update(workspace.id, { state: 'ready' });
  const execution = store.executions.create({ taskId: task.id, planRevisionId: plan.id, graph, autoAdvance: true });
  store.tasks.update(task.id, { currentPlanRevisionId: plan.id, workspaceId: workspace.id, executionId: execution.id });
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
  const finish = async (index: number, failed = false) => {
    const call = calls[index]!;
    engine.executions.submitResult({ taskId: task.id, nodeId: call.request.metadata.nodeId!, attemptId: call.request.metadata.attemptId!, summary: 'offline', verification: { state: failed ? 'failed' : 'passed' } });
    call.resolve({ sessionId: `session-${index + 1}`, outcome: { idle: true, timedOut: false, assistantText: '', messages: [] } });
    await tick();
  };
  const start = () => engine.executions.start(task.id, { requestKey: 'req_policy_start', confirm: true });
  const stop = async () => {
    await engine.executions.cancel(task.id, { requestKey: 'req_policy_stop', confirm: true });
    for (const [index, call] of calls.entries()) call.resolve({ sessionId: `session-${index + 1}`, outcome: { idle: true, timedOut: false, assistantText: '', messages: [] } });
    await tick();
  };
  return { store, engine, port, task, execution, calls, aborts, start, finish, stop, tick, failBeforeSession: (message: string) => { beforeSessionFailure = message; }, preflightCalls: () => preflightCalls, inspect: (state: typeof inspected) => { inspected = state; }, rejectSecond: () => { rejectSecondAbort = true; } };
}

test('attempt ordinals start at one, advance monotonically and preserve historical values', () => {
  const f = fixture();
  const create = (nodeId: string, ordinal: number) => f.store.executions.createAttempt({ executionId: f.execution.id, nodeId, ordinal });
  const first = create('a', 1);
  const second = create('a', 1);
  const explicit = create('a', 7);
  const following = create('a', 1);
  assert.deepEqual([first.ordinal, second.ordinal, explicit.ordinal, following.ordinal], [1, 2, 7, 8]);
  // Historical numbering is retained; the fix only changes the next insert.
  const historical = create('b', 2);
  assert.equal(create('b', 1).ordinal, 3);
  assert.equal(f.store.executions.getAttempt(historical.id)?.ordinal, 2);
  assert.equal(f.store.executions.getAttempt(first.id)?.ordinal, 1);
  assert.equal(f.store.executions.getAttempt(second.id)?.ordinal, 2);
  f.engine.executions.shutdown();
  f.store.close();
});

test('bounded readers run concurrently; joins wait for every predecessor and writes are exclusive', async () => {
  const readers = fixture();
  readers.start();
  assert.equal(readers.calls.length, 2);
  assert.equal(readers.store.executions.getAttempt(readers.calls[0]!.request.metadata.attemptId!)?.ordinal, 1, 'first attempt is numbered 1');
  assert.equal(readers.engine.executions.get(readers.task.id)?.progress.running, 2);
  assert.ok(readers.calls.every((call) => call.request.permission === 'read_only'));
  await readers.finish(0);
  assert.equal(readers.calls.length, 2, 'join is not released before b');
  await readers.finish(1);
  assert.equal(readers.calls.length, 3);
  await readers.finish(2);
  assert.equal(readers.engine.executions.get(readers.task.id)?.status, 'completed');
  readers.store.close();
  const writers = fixture({}, true);
  writers.start();
  assert.equal(writers.calls.length, 1);
  await writers.finish(0);
  assert.equal(writers.calls.length, 2);
  await writers.stop();
  writers.store.close();
});

test('stop confirms every parallel session; one rejection leaves UNKNOWN and prevents retry', async () => {
  const f = fixture();
  f.start();
  f.rejectSecond();
  assert.equal((await f.engine.executions.cancel(f.task.id, { requestKey: 'req_parallel_stop', confirm: true })).receipt.status, 'unknown');
  assert.deepEqual(f.aborts.sort(), ['session-1', 'session-2']);
  assert.equal(f.engine.executions.get(f.task.id)?.status, 'unknown');
  assert.throws(() => f.engine.executions.retry(f.task.id, { requestKey: 'req_parallel_retry', confirm: true }));
  for (const [index, call] of f.calls.entries()) call.resolve({ sessionId: `session-${index + 1}`, outcome: { idle: true, timedOut: false, assistantText: '', messages: [] } });
  await f.tick();
  assert.equal(f.engine.executions.get(f.task.id)?.status, 'stopped');
  assert.equal(f.engine.executions.get(f.task.id)?.progress.running, 0);
  f.store.close();
});

test('attempt cap includes first dispatch and remains frozen after settings change', async () => {
  const f = fixture({ maxConcurrentNodes: 1, maxAttempts: 1 });
  f.start();
  f.engine.updateSettings({ ...f.engine.settings, execution: { ...f.engine.settings.execution, maxAttempts: 10 } });
  await f.finish(0, true);
  assert.equal(f.engine.executions.get(f.task.id)?.status, 'paused');
  assert.equal(f.calls.length, 1, 'failure pauses new claims');
  assert.throws(() => f.engine.executions.retry(f.task.id, { requestKey: 'req_budget_retry', confirm: true }), /尝试次数已用完/);
  assert.equal(f.calls.length, 1);
  f.store.close();
});

test('disabling failure pause continues independent nodes but never releases a failed join', async () => {
  const f = fixture({ maxConcurrentNodes: 1, pauseAfterFailure: false });
  f.start();
  await f.finish(0, true);
  assert.equal(f.calls.length, 2);
  await f.finish(1);
  assert.equal(f.calls.length, 2);
  assert.equal(f.engine.executions.get(f.task.id)?.status, 'failed');
  f.store.close();
});


test('resuming a paused parallel run drains its original attempts then releases the join', async () => {
  const f = fixture({ nodeTimeoutMinutes: 2, timeoutEnabled: true });
  f.start();
  f.engine.executions.pause(f.task.id, { requestKey: 'req_policy_pause', confirm: true });
  await f.finish(0);
  assert.equal(f.calls.length, 2);
  f.engine.executions.resume(f.task.id, { requestKey: 'req_policy_resume', confirm: true });
  f.engine.updateSettings({ ...f.engine.settings, execution: { ...f.engine.settings.execution, nodeTimeoutMinutes: 99 } });
  await f.finish(1);
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[2]!.request.timeoutMs, 120000, 'old execution retains frozen timeout');
  await f.finish(2);
  assert.equal(f.engine.executions.get(f.task.id)?.status, 'completed');
  f.store.close();
});


test('whole-task attempt budget stops further dispatches, including independent nodes', async () => {
  const f = fixture({ maxTaskAttempts: 1, maxConcurrentNodes: 2 });
  f.start();
  assert.equal(f.calls.length, 1);
  await f.finish(0);
  assert.equal(f.calls.length, 1);
  assert.throws(() => f.engine.executions.retry(f.task.id, { requestKey: 'req_total_budget', confirm: true }), /总尝试次数/);
  f.store.close();
});

test('enabled total business deadline stops every active session; disabled business deadlines keep timeout zero', async () => {
  const limited = fixture({ timeoutEnabled: true, taskTimeoutMinutes: 1 });
  limited.store.executions.update(limited.execution.id, { startedAt: new Date(Date.now() - 60000 + 50).toISOString() });
  limited.start();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.deepEqual(limited.aborts.sort(), ['session-1', 'session-2']);
  assert.equal(limited.engine.executions.get(limited.task.id)?.status, 'stopped');
  assert.throws(() => limited.engine.executions.retry(limited.task.id, { requestKey: 'req_total_deadline_retry', confirm: true }), /业务总时限/);
  for (const [index, call] of limited.calls.entries()) call.resolve({ sessionId: `session-${index + 1}`, outcome: { idle: true, timedOut: false, assistantText: '', messages: [] } });
  await limited.tick();
  limited.store.close();
  const unlimited = fixture({ timeoutEnabled: false });
  unlimited.start();
  assert.equal(unlimited.calls[0]!.request.timeoutMs, 0);
  await unlimited.stop();
  unlimited.store.close();
});

test('design deadline prevents a new design attempt and timeout UNKNOWN only reconciles through an original operation', async () => {
  const expired = fixture({ timeoutEnabled: true, designTimeoutMinutes: 1 }, false, 'design');
  expired.store.settings.putJson(`execution.design-started.${expired.execution.id}.g`, new Date(Date.now() - 120000).toISOString());
  expired.start();
  await expired.tick();
  assert.equal(expired.calls.length, 0);
  assert.match(expired.engine.executions.get(expired.task.id)?.nodes[0]?.error?.message ?? '', /设计阶段/);
  expired.store.close();
  const f = fixture({ timeoutEnabled: true, maxConcurrentNodes: 1, pauseAfterFailure: false });
  f.start();
  const request = f.calls[0]!.request;
  f.engine.executions.submitResult({ taskId: f.task.id, nodeId: request.metadata.nodeId!, attemptId: request.metadata.attemptId!, summary: 'submitted before lost stop acknowledgement', verification: { state: 'passed' } });
  f.calls[0]!.resolve({ sessionId: 'session-1', outcome: { idle: false, timedOut: true, assistantText: '', messages: [] } });
  await f.tick();
  assert.equal(f.engine.executions.get(f.task.id)?.status, 'unknown');
  assert.throws(() => f.engine.executions.retry(f.task.id, { requestKey: 'req_unknown_timeout_retry', confirm: true }));
  f.inspect('running');
  await f.engine.executions.reconcileOperation('req_policy_start');
  assert.equal(f.engine.executions.get(f.task.id)?.status, 'unknown');
  f.inspect('idle');
  await f.engine.executions.reconcileOperation('req_policy_start');
  assert.equal(f.engine.executions.get(f.task.id)?.status, 'paused');
  assert.equal(f.calls.length, 1, 'reconciliation never dispatches a model');
  assert.equal(f.engine.executions.get(f.task.id)?.nodes[0]?.status, 'succeeded');
  f.store.close();
});

test('classified retry wait is durable, idempotent, pausable, and never redispatched on startup', async () => {
  const f = fixture({ maxConcurrentNodes: 1, retryDelays: { modelRateLimit: { initialMs: 60, maxMs: 60 }, sessionError: { initialMs: 0, maxMs: 0 }, verificationFailure: { initialMs: 0, maxMs: 0 } } });
  const prior = f.store.executions.createAttempt({ executionId: f.execution.id, nodeId: 'a', ordinal: 1 });
  f.store.executions.finishAttempt(prior.id, 'failed');
  f.store.executions.updateNode(f.execution.id, 'a', { status: 'failed', attemptCount: 1, currentAttemptId: prior.id, error: { code: 'OPENCODE_NOT_READY', message: '429 rate limit' } });
  for (const id of ['b', 'c']) f.store.executions.updateNode(f.execution.id, id, { status: 'cancelled' });
  f.store.executions.update(f.execution.id, { status: 'failed' });
  const input = { requestKey: 'req_delayed_retry', confirm: true as const };
  const first = f.engine.executions.retry(f.task.id, input);
  assert.equal(first.receipt.status, 'succeeded');
  assert.equal(f.engine.executions.retry(f.task.id, input).receipt.requestKey, input.requestKey);
  assert.equal(f.calls.length, 0);
  const saved = f.store.settings.getJson<{ readyAt: number; delayMs: number }>(`execution.retry-ready-at.${f.execution.id}.a`)!;
  assert.equal(saved.delayMs, 60);
  f.engine.executions.pause(f.task.id, { requestKey: 'req_delayed_pause', confirm: true });
  await f.tick();
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(f.calls.length, 0);
  f.engine.executions.resume(f.task.id, { requestKey: 'req_delayed_resume', confirm: true });
  assert.equal(f.calls.length, 1);
  await f.finish(0);
  f.store.close();

  const restart = fixture();
  restart.store.executions.update(restart.execution.id, { status: 'running' });
  restart.store.settings.putJson(`execution.retry-ready-at.${restart.execution.id}.a`, { readyAt: Date.now() + 10000, requestKey: 'req_before_restart' });
  restart.engine.executions.recoverOnStartup();
  assert.equal(restart.engine.executions.get(restart.task.id)?.status, 'paused');
  assert.equal(restart.calls.length, 0);
  restart.store.close();
});

test('session error threshold blocks new user retries independently of attempt cap', async () => {
  const f = fixture({ maxAttempts: 5, sessionErrorThreshold: 1, maxConcurrentNodes: 1 });
  f.failBeforeSession('session unavailable before prompt');
  f.start();
  await f.tick();
  assert.equal(f.engine.executions.get(f.task.id)?.status, 'paused');
  assert.equal(f.preflightCalls(), 1);
  assert.equal(f.store.settings.getJson(`execution.session-errors.${f.execution.id}`), 1);
  assert.throws(() => f.engine.executions.retry(f.task.id, { requestKey: 'req_session_threshold_retry', confirm: true }), /会话异常次数/);
  assert.equal(f.engine.tasks.detail(f.task.id).capabilities.retryExecution?.allowed, false);
  assert.equal(f.preflightCalls(), 1);
  f.store.close();
});


test('submitted result survives a storage reopen while the original remote session remains UNKNOWN', async () => {
  const f = fixture({ maxConcurrentNodes: 1 });
  f.start();
  const request = f.calls[0]!.request;
  const input = { taskId: f.task.id, nodeId: request.metadata.nodeId!, attemptId: request.metadata.attemptId!, summary: 'durable submitted evidence', verification: { state: 'passed' as const } };
  f.engine.executions.submitResult(input);
  assert.equal(f.store.executions.getAttempt(input.attemptId)?.status, 'running');
  assert.equal(f.store.executions.getAttempt(input.attemptId)?.result?.summary, 'durable submitted evidence');
  assert.throws(() => f.engine.executions.submitResult(input));
  f.engine.executions.shutdown();
  const dataDir = f.store.dataDir;
  f.store.close();
  const reopened = new Store({ dataDir });
  const restarted = new Engine({ store: reopened, ports: { git: {} as never, opencode: f.port } });
  restarted.executions.recoverOnStartup();
  assert.equal(restarted.executions.get(f.task.id)?.status, 'unknown');
  assert.equal(reopened.executions.getAttempt(input.attemptId)?.result?.summary, 'durable submitted evidence');
  f.inspect('idle');
  await restarted.executions.reconcileOperation('req_policy_start');
  assert.equal(restarted.executions.get(f.task.id)?.status, 'paused');
  assert.equal(restarted.executions.get(f.task.id)?.nodes[0]?.status, 'succeeded');
  assert.equal(f.calls.length, 1, 'startup and reconciliation never redispatch');
  f.calls[0]!.resolve({ sessionId: 'session-1', outcome: { idle: true, timedOut: false, assistantText: '', messages: [] } });
  await f.tick();
  assert.equal(restarted.executions.get(f.task.id)?.status, 'paused');
  restarted.executions.shutdown();
  reopened.close();
});

test('service shutdown invalidates a pending classified retry timer before storage closes', async () => {
  const f = fixture({ maxConcurrentNodes: 1, retryDelays: { ...fixtureRetryDelays(), verificationFailure: { initialMs: 40, maxMs: 40 } } });
  f.store.executions.updateNode(f.execution.id, 'a', { status: 'failed', attemptCount: 1, error: { code: 'VALIDATION_FAILED', message: 'failed check' } });
  for (const id of ['b', 'c']) f.store.executions.updateNode(f.execution.id, id, { status: 'cancelled' });
  f.store.executions.update(f.execution.id, { status: 'failed' });
  f.engine.executions.retry(f.task.id, { requestKey: 'req_shutdown_wait', confirm: true });
  assert.equal(f.calls.length, 0);
  f.engine.executions.shutdown();
  f.store.close();
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(f.calls.length, 0);
});

function fixtureRetryDelays(): ExecutionSettings['retryDelays'] {
  return { modelRateLimit: { initialMs: 0, maxMs: 0 }, sessionError: { initialMs: 0, maxMs: 0 }, verificationFailure: { initialMs: 0, maxMs: 0 } };
}

test('scoped retry dispatches only selected failed nodes and preserves other attempts and receipts', async () => {
  const f = fixture({ maxAttempts: 5 });
  f.store.executions.update(f.execution.id, { status: 'paused' });
  for (const id of ['a', 'b']) {
    const attempt = f.store.executions.createAttempt({ executionId: f.execution.id, nodeId: id, ordinal: 1 });
    f.store.executions.updateNode(f.execution.id, id, { status: 'failed', currentAttemptId: attempt.id, attemptCount: 1, error: { code: 'VALIDATION_FAILED', message: 'offline' } });
  }
  const beforeB = f.store.executions.get(f.execution.id)!.nodes.find((n) => n.nodeId === 'b');
  for (const nodeIds of [[], ['a', 'a'], ['missing'], ['c']]) {
    assert.throws(() => f.engine.executions.retry(f.task.id, { requestKey: `req_invalid_${JSON.stringify(nodeIds)}`, nodeIds }));
  }
  assert.throws(() => f.engine.executions.retry(f.task.id, { requestKey: 'req_stale_scope', nodeIds: ['a'], expectedStatus: 'failed' }));
  const input = { requestKey: 'req_scoped_retry', nodeIds: ['a'], expectedStatus: 'paused', confirm: true };
  const response = f.engine.executions.retry(f.task.id, input);
  assert.equal(response.receipt.status, 'succeeded');
  assert.deepEqual(f.calls.map((call) => call.request.metadata.nodeId), ['a']);
  assert.deepEqual(f.store.executions.get(f.execution.id)!.nodes.find((n) => n.nodeId === 'b'), beforeB);
  assert.deepEqual(f.engine.executions.retry(f.task.id, input).receipt, response.receipt);
  assert.throws(() => f.engine.executions.retry(f.task.id, { ...input, nodeIds: ['b'] }));
  await f.finish(0);
  assert.equal(f.calls.length, 1);
  assert.equal(f.engine.executions.get(f.task.id)?.status, 'paused');
  assert.deepEqual(f.store.executions.get(f.execution.id)!.nodes.find((n) => n.nodeId === 'b'), beforeB);
  f.engine.executions.shutdown();
  f.store.close();
});
