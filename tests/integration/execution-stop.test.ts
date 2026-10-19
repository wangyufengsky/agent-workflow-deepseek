import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '@agent-workflow/storage';
import { Engine, type OpenCodePort, type OpenCodeRunRequest, type OpenCodeRunResult } from '../../packages/engine/src/index.ts';
import type { PlanGraph } from '@agent-workflow/shared';

// Offline failure-injection control-flow tests, never model acceptance.
function fixture(mode: 'reject' | 'hang' | 'success', delayedSession = false, chain = false) {
  const root = mkdtempSync(join(tmpdir(), 'aw-stop-'));
  const store = new Store({ dataDir: root });
  let request: OpenCodeRunRequest;
  const finishes: Array<(value: OpenCodeRunResult) => void> = [];
  const requests: OpenCodeRunRequest[] = [];
  let inspected: 'idle' | 'running' | 'unknown' = 'unknown';
  let acknowledge!: () => void;
  let aborts = 0;
  const abortIds: string[] = [];
  const port: OpenCodePort = {
    status: () => ({ state: 'ready' }) as ReturnType<OpenCodePort['status']>,
    ensureReady: async () => {}, findSessions: async () => [{ id: 'session-stop' }],
    inspectSession: async () => inspected,
    abortSession: async (sessionId) => {
      aborts++;
      abortIds.push(sessionId);
      if (mode === 'reject') throw new Error('offline abort rejection');
      if (mode === 'hang') await new Promise<void>((resolve) => { acknowledge = resolve; });
    },
    runSession: (input) => {
      request = input;
      requests.push(input);
      if (!delayedSession) input.onSessionId?.(`session-stop-${requests.length}`);
      return new Promise((resolve) => { finishes.push(resolve); });
    },
  };
  const engine = new Engine({ store, ports: { git: {} as never, opencode: port }, integration: { opencodeReady: () => true, gitlabConfigured: () => false } });
  const settings = engine.settings;
  // Set only the durable local timeout; no external runtime is started.
  engine.updateSettings({ ...settings, execution: { ...settings.execution, pauseTimeoutMs: 5 } });
  const project = store.projects.create({ name: 'offline', rootPath: root, gitState: 'not_git' });
  const task = store.tasks.create({ projectId: project.id, title: 'stop', requirementText: 'offline', methodId: 'method.requirement-development', methodRevision: 'r12' });
  const graph: PlanGraph = { nodes: [{ id: 'node_stop', key: 'stop', title: 'stop', kind: 'implementation', groupId: 'g', summary: '', inputs: [], outputs: [], acceptance: [], resources: { read: [], write: [] } }], edges: [], groups: [] };
  if (chain) {
    const first = graph.nodes[0]!;
    Object.assign(graph, { nodes: [first, { ...first, id: 'node_future', key: 'future', title: 'future' }, { ...first, id: 'node_done', key: 'done', title: 'done' }], edges: [{ id: 'edge_future', from: first.id, to: 'node_future', kind: 'order' }] });
  }
  for (const node of graph.nodes) Object.assign(node, { roleId: 'role.developer', roleSnapshot: structuredClone(engine.catalog.roles.find((role) => role.id === 'role.developer')!) });
  const plan = store.plans.create({ taskId: task.id, source: 'skeleton', graph, status: 'confirmed' });
  const workspace = store.workspaces.create({ taskId: task.id, kind: 'directory_copy', displayRoot: root });
  store.workspaces.update(workspace.id, { state: 'ready' });
  const execution = store.executions.create({ taskId: task.id, planRevisionId: plan.id, graph, autoAdvance: true });
  if (chain) store.executions.updateNode(execution.id, 'node_done', { status: 'succeeded' });
  store.tasks.update(task.id, { currentPlanRevisionId: plan.id, workspaceId: workspace.id, executionId: execution.id });
  engine.executions.start(task.id, { requestKey: 'req_start_stop', confirm: true });
  const cancel = () => engine.executions.cancel(task.id, { requestKey: 'req_cancel_stop', confirm: true });
  return { store, engine, task, execution, port, cancel, requests, abortIds, inspect: (state: typeof inspected) => { inspected = state; }, request: () => request!, aborts: () => aborts, acknowledge: () => acknowledge(), finish: (index = finishes.length - 1) => finishes[index]!({ sessionId: `session-stop-${index + 1}`, outcome: { idle: true, timedOut: false, assistantText: '', messages: [] } }) };
}

for (const mode of ['reject', 'hang'] as const) test(`stop ${mode} stays UNKNOWN and replay never aborts twice`, async () => {
  const f = fixture(mode);
  const response = await f.cancel();
  assert.equal(response.receipt.status, 'unknown');
  assert.equal(f.engine.executions.get(f.task.id)?.status, 'unknown');
  await f.cancel();
  assert.equal(f.aborts(), 1);
  const node = f.engine.executions.get(f.task.id)!.nodes[0]!;
  assert.throws(() => f.engine.executions.submitResult({ taskId: f.task.id, nodeId: node.nodeId, attemptId: node.currentAttemptId!, summary: 'late' }));
  if (mode === 'hang') f.acknowledge();
  else f.finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.engine.executions.get(f.task.id)?.status, 'stopped');
  assert.equal(f.engine.commands.get('req_cancel_stop')?.status, 'succeeded');
  assert.equal(f.engine.executions.get(f.task.id)?.nodes[0]?.status, 'failed');
  if (mode === 'hang') f.finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.engine.executions.get(f.task.id)?.nodes[0]?.status, 'failed');
  f.store.close();
});

test('stop while session creation is pending prevents late prompt dispatch', async () => {
  const f = fixture('success', true);
  assert.equal((await f.cancel()).receipt.status, 'unknown');
  assert.throws(() => f.request().onSessionId?.('late-created-session'));
  assert.equal(f.engine.executions.get(f.task.id)?.status, 'stopped');
  assert.equal(f.aborts(), 0);
  f.finish();
  await new Promise((resolve) => setImmediate(resolve));
  f.store.close();
});

test('acknowledged abort retains a retryable node and late callbacks cannot revive it', async () => {
  const f = fixture('success');
  const node = f.engine.executions.get(f.task.id)!.nodes[0]!;
  assert.equal((await f.cancel()).receipt.status, 'succeeded');
  assert.equal(f.store.executions.getAttempt(node.currentAttemptId!)?.status, 'cancelled');
  f.finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.engine.executions.get(f.task.id)?.status, 'stopped');
  assert.equal(f.engine.executions.get(f.task.id)?.progress.running, 0);
  assert.equal(f.engine.executions.get(f.task.id)?.nodes[0]?.status, 'failed');
  f.store.close();
});


test('retry after confirmed stop preserves future nodes and isolates old idle / abort / output callbacks', async () => {
  const f = fixture('hang', false, true);
  const firstAttempt = f.engine.executions.get(f.task.id)!.nodes[0]!.currentAttemptId!;
  // The scheduler already owns the initial attempt; verify the original stop.
  assert.equal((await f.cancel()).receipt.status, 'unknown');
  f.inspect('idle');
  await f.engine.executions.reconcileOperation('req_cancel_stop');
  assert.equal(f.engine.executions.get(f.task.id)?.status, 'stopped');
  assert.equal(f.engine.executions.get(f.task.id)?.nodes.find((node) => node.nodeId === 'node_future')?.status, 'pending');
  assert.equal(f.engine.executions.get(f.task.id)?.nodes.find((node) => node.nodeId === 'node_done')?.status, 'succeeded');
  f.engine.executions.retry(f.task.id, { requestKey: 'req_retry_stop', confirm: true });
  const secondAttempt = f.engine.executions.get(f.task.id)!.nodes[0]!.currentAttemptId!;
  assert.notEqual(secondAttempt, firstAttempt);
  assert.equal(f.requests.length, 2);
  f.acknowledge(); // late acknowledgement of the old timed-out abort
  f.finish(0); // old loop must neither finish the new node nor delete its loop
  f.requests[0]!.sink.onTextDelta?.('late output', { messageId: 'old', partId: 'old' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.engine.executions.get(f.task.id)?.status, 'running');
  assert.equal(f.engine.executions.get(f.task.id)?.nodes[0]?.currentAttemptId, secondAttempt);
  assert.equal(f.store.executions.getAttempt(secondAttempt)?.status, 'running');
  // A fresh stop must abort the new active session rather than an old id.
  f.inspect('idle');
  await f.engine.executions.cancel(f.task.id, { requestKey: 'req_second_stop', confirm: true });
  assert.equal(f.abortIds[1], 'session-stop-2');
  await f.engine.executions.reconcileOperation('req_second_stop');
  f.finish(1);
  await new Promise((resolve) => setImmediate(resolve));
  f.store.close();
});

test('restart UNKNOWN reconciles only explicit runtime idle and never redispatches', async () => {
  const f = fixture('reject');
  await f.cancel();
  const restarted = new Engine({ store: f.store, ports: { git: {} as never, opencode: f.port }, integration: { opencodeReady: () => true, gitlabConfigured: () => false } });
  f.store.executions.update(f.execution.id, { status: 'stopping' });
  restarted.executions.recoverOnStartup();
  assert.equal(restarted.executions.get(f.task.id)?.nodes[0]?.status, 'unknown');
  f.inspect('running');
  await restarted.executions.reconcileOperation('req_cancel_stop');
  assert.equal(restarted.commands.get('req_cancel_stop')?.status, 'unknown');
  assert.throws(() => restarted.executions.retry(f.task.id, { requestKey: 'req_unsafe_retry', confirm: true }));
  f.inspect('unknown');
  await restarted.executions.reconcileOperation('req_cancel_stop');
  assert.equal(restarted.commands.get('req_cancel_stop')?.status, 'unknown');
  f.inspect('idle');
  await restarted.executions.reconcileOperation('req_cancel_stop');
  assert.equal(restarted.commands.get('req_cancel_stop')?.status, 'succeeded');
  assert.equal(restarted.executions.get(f.task.id)?.status, 'stopped');
  assert.equal(f.aborts(), 1);
  assert.equal(f.requests.length, 1);
  f.finish();
  await new Promise((resolve) => setImmediate(resolve));
  f.store.close();
});


test('UNKNOWN and paused active nodes block workspace cleanup in both service and action projection', async () => {
  const f = fixture('reject');
  await f.cancel();
  assert.ok(f.engine.workspaces.cleanupPreview(f.task.id).blockers.some((blocker) => blocker.kind === 'execution_active'));
  assert.equal(f.engine.tasks.detail(f.task.id).capabilities.cleanupWorkspace?.allowed, false);
  f.store.executions.update(f.execution.id, { status: 'paused' });
  assert.ok(f.engine.workspaces.cleanupPreview(f.task.id).blockers.some((blocker) => blocker.kind === 'execution_active'));
  assert.equal(f.engine.tasks.detail(f.task.id).capabilities.cleanupWorkspace?.allowed, false);
  f.store.executions.update(f.execution.id, { status: 'unknown' });
  f.finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.engine.workspaces.cleanupPreview(f.task.id).blockers.some((blocker) => blocker.kind === 'execution_active'), false);
  f.store.close();
});


test('retry with automatic advancement disabled still explicitly releases the interrupted node', async () => {
  const f = fixture('success');
  f.engine.executions.setAutoAdvance(f.task.id, { requestKey: 'req_auto_stop', autoAdvance: false, confirmChange: true });
  await f.cancel();
  f.engine.executions.retry(f.task.id, { requestKey: 'req_manual_retry', confirm: true });
  assert.equal(f.requests.length, 2);
  assert.equal(f.engine.executions.get(f.task.id)?.nodes[0]?.status, 'running');
  await f.engine.executions.cancel(f.task.id, { requestKey: 'req_manual_stop_again', confirm: true });
  f.finish(0);
  f.finish(1);
  await new Promise((resolve) => setImmediate(resolve));
  f.store.close();
});
