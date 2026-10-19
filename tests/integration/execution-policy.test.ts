import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '@agent-workflow/storage';
import { Engine, type OpenCodePort, type OpenCodeRunRequest, type OpenCodeRunResult } from '../../packages/engine/src/index.ts';
import type { ExecutionSettings, PlanGraph, PlanNode } from '@agent-workflow/shared';

// Offline scheduler/control-flow evidence. No model or runtime is used.
function fixture(input: Partial<ExecutionSettings> = {}, writes = false) {
  const store = new Store({ dataDir: mkdtempSync(join(tmpdir(), 'aw-policy-')) });
  const calls: Array<{ request: OpenCodeRunRequest; resolve: (result: OpenCodeRunResult) => void }> = [];
  const aborts: string[] = [];
  let rejectSecondAbort = false;
  const port: OpenCodePort = {
    status: () => ({ state: 'ready' }) as ReturnType<OpenCodePort['status']>, ensureReady: async () => {}, findSessions: async () => [],
    abortSession: async (id) => { aborts.push(id); if (rejectSecondAbort && id === 'session-2') throw new Error('offline second abort failed'); },
    runSession: (request) => new Promise((resolve) => { calls.push({ request, resolve }); request.onSessionId?.(`session-${calls.length}`); }),
  };
  const engine = new Engine({ store, ports: { git: {} as never, opencode: port }, integration: { opencodeReady: () => true, gitlabConfigured: () => false } });
  engine.updateSettings({ ...engine.settings, execution: { ...engine.settings.execution, maxConcurrentNodes: 2, pauseTimeoutMs: 5, ...input } });
  const project = store.projects.create({ name: 'policy', rootPath: store.dataDir, gitState: 'not_git' });
  const task = store.tasks.create({ projectId: project.id, title: 'policy', requirementText: 'offline', methodId: 'method.requirement-development', methodRevision: 'r12' });
  const role = structuredClone(engine.catalog.roles.find((item) => item.id === 'role.developer')!);
  Object.assign(role, { resourcePermissions: { files: [{ kind: writes ? 'write' : 'read', path: '.' }], commands: [], tools: [], resources: [] } });
  const node = (id: string): PlanNode => Object.assign({ id, key: id, title: id, kind: 'implementation' as const, groupId: 'g', summary: '', inputs: [], outputs: [], acceptance: [], resources: { read: [], write: [] }, roleId: role.id }, { roleSnapshot: role });
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
  return { store, engine, task, execution, calls, aborts, start, finish, stop, tick, rejectSecond: () => { rejectSecondAbort = true; } };
}

test('bounded readers run concurrently; joins wait for every predecessor and writes are exclusive', async () => {
  const readers = fixture();
  readers.start();
  assert.equal(readers.calls.length, 2);
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
  const f = fixture({ nodeTimeoutMinutes: 2 });
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
