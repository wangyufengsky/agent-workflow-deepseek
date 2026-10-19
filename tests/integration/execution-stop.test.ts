import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '@agent-workflow/storage';
import { Engine, type OpenCodePort, type OpenCodeRunRequest, type OpenCodeRunResult } from '../../packages/engine/src/index.ts';
import type { PlanGraph } from '@agent-workflow/shared';

// Offline failure-injection control-flow tests, never model acceptance.
function fixture(mode: 'reject' | 'hang' | 'success', delayedSession = false) {
  const root = mkdtempSync(join(tmpdir(), 'aw-stop-'));
  const store = new Store({ dataDir: root });
  let request: OpenCodeRunRequest;
  let finish!: (value: OpenCodeRunResult) => void;
  let acknowledge!: () => void;
  let aborts = 0;
  const port: OpenCodePort = {
    status: () => ({ state: 'ready' }) as ReturnType<OpenCodePort['status']>,
    ensureReady: async () => {}, findSessions: async () => [],
    abortSession: async () => {
      aborts++;
      if (mode === 'reject') throw new Error('offline abort rejection');
      if (mode === 'hang') await new Promise<void>((resolve) => { acknowledge = resolve; });
    },
    runSession: (input) => {
      request = input;
      if (!delayedSession) input.onSessionId?.('session-stop');
      return new Promise((resolve) => { finish = resolve; });
    },
  };
  const engine = new Engine({ store, ports: { git: {} as never, opencode: port }, integration: { opencodeReady: () => true, gitlabConfigured: () => false } });
  const settings = engine.settings;
  // Set only the durable local timeout; no external runtime is started.
  engine.updateSettings({ ...settings, execution: { ...settings.execution, pauseTimeoutMs: 5 } });
  const project = store.projects.create({ name: 'offline', rootPath: root, gitState: 'not_git' });
  const task = store.tasks.create({ projectId: project.id, title: 'stop', requirementText: 'offline', methodId: 'method.requirement-development', methodRevision: 'r12' });
  const graph: PlanGraph = { nodes: [{ id: 'node_stop', key: 'stop', title: 'stop', kind: 'implementation', groupId: 'g', summary: '', inputs: [], outputs: [], acceptance: [], resources: { read: [], write: [] } }], edges: [], groups: [] };
  const plan = store.plans.create({ taskId: task.id, source: 'skeleton', graph, status: 'confirmed' });
  const workspace = store.workspaces.create({ taskId: task.id, kind: 'directory_copy', displayRoot: root });
  store.workspaces.update(workspace.id, { state: 'ready' });
  const execution = store.executions.create({ taskId: task.id, planRevisionId: plan.id, graph, autoAdvance: true });
  store.tasks.update(task.id, { currentPlanRevisionId: plan.id, workspaceId: workspace.id, executionId: execution.id });
  engine.executions.start(task.id, { requestKey: 'req_start_stop', confirm: true });
  const cancel = () => engine.executions.cancel(task.id, { requestKey: 'req_cancel_stop', confirm: true });
  return { store, engine, task, execution, cancel, request: () => request!, aborts: () => aborts, acknowledge: () => acknowledge(), finish: () => finish({ sessionId: 'session-stop', outcome: { idle: true, timedOut: false, assistantText: '', messages: [] } }) };
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
  assert.equal(f.engine.executions.get(f.task.id)?.nodes[0]?.status, 'cancelled');
  if (mode === 'hang') f.finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.engine.executions.get(f.task.id)?.nodes[0]?.status, 'cancelled');
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

test('acknowledged abort cancels active attempt and late callbacks cannot revive it', async () => {
  const f = fixture('success');
  const node = f.engine.executions.get(f.task.id)!.nodes[0]!;
  assert.equal((await f.cancel()).receipt.status, 'succeeded');
  assert.equal(f.store.executions.getAttempt(node.currentAttemptId!)?.status, 'cancelled');
  f.finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.engine.executions.get(f.task.id)?.status, 'stopped');
  assert.equal(f.engine.executions.get(f.task.id)?.progress.running, 0);
  assert.equal(f.engine.executions.get(f.task.id)?.nodes[0]?.status, 'cancelled');
  f.store.close();
});
