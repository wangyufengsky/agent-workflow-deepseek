import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecutionView, PlanGraph, PlanNode } from '@agent-workflow/shared';
import { createRequestKey } from '@agent-workflow/shared';
import { readNodeAcceptance } from '../../packages/engine/src/actions.ts';
import { createApplication, type RunningApplication } from '../../packages/server/src/index.ts';

/**
 * W0-4b: a succeeded node whose plan declares acceptance criteria is only "done"
 * after the human verdict. Pending/rejected verdicts gate completion and
 * downstream release; accepting unblocks, rejecting enables an explicit retry.
 * Plans without acceptance criteria keep the legacy "succeeded = done" flow.
 */

type App = RunningApplication;

function createRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'aw-gating-repo-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# gating\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  return root;
}

function planNode(id: string, title: string, acceptance: readonly string[]): PlanNode {
  return {
    id,
    key: id,
    title,
    kind: 'implementation',
    groupId: 'group_main',
    summary: '',
    inputs: [],
    outputs: [],
    acceptance,
    resources: { read: [], write: [] },
  };
}

function graphWith(nodes: readonly PlanNode[], edges: readonly [string, string][]): PlanGraph {
  return {
    nodes,
    edges: edges.map(([from, to], index) => ({ id: `edge_${String(index)}`, from, to, kind: 'order' })),
    groups: [{ id: 'group_main', label: '实现', kind: 'implementation', refined: false, collapsible: false, collapsedByDefault: false }],
  };
}

interface Seeded {
  readonly taskId: string;
  readonly executionId: string;
  readonly nodeIds: readonly string[];
}

async function seedExecution(app: App, graph: PlanGraph, options: { readonly statuses: readonly ('succeeded' | 'pending')[]; readonly autoAdvance: boolean; readonly status?: 'running' | 'paused' }): Promise<Seeded> {
  const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: createRequestKey(), name: 'Gating', rootPath: createRepo() } });
  assert.equal(project.statusCode, 201, project.body);
  const projectId = project.json().data.resource.project.id as string;
  const task = await app.app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: { requestKey: createRequestKey(), projectId, title: '验收 gating', requirementText: 'R1 生成导出', methodId: 'method.requirement-development' },
  });
  assert.equal(task.statusCode, 201, task.body);
  const taskId = task.json().data.resource.task.id as string;
  const plan = app.store.plans.create({ taskId, source: 'skeleton', graph, status: 'confirmed' });
  app.store.tasks.update(taskId, { currentPlanRevisionId: plan.id });
  const execution = app.store.executions.create({ taskId, planRevisionId: plan.id, graph, autoAdvance: options.autoAdvance });
  app.store.tasks.update(taskId, { executionId: execution.id });
  graph.nodes.forEach((node, index) => {
    const status = options.statuses[index];
    if (status !== undefined) app.store.executions.updateNode(execution.id, node.id, { status });
  });
  app.store.executions.update(execution.id, { status: options.status ?? 'running' });
  return { taskId, executionId: execution.id, nodeIds: graph.nodes.map((node) => node.id) };
}

async function waitFor(app: App, taskId: string, predicate: (execution: ExecutionView | undefined) => boolean, label: string): Promise<ExecutionView> {
  const started = Date.now();
  for (;;) {
    const execution = app.engine.executions.get(taskId);
    if (predicate(execution)) return execution!;
    if (Date.now() - started > 5_000) throw new Error(`timed out waiting for ${label}; last status=${execution?.status ?? 'missing'}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function decide(app: App, taskId: string, nodeId: string, verdict: 'accept' | 'reject', note?: string): Promise<{ statusCode: number; body: string }> {
  const payload = verdict === 'accept'
    ? { requestKey: createRequestKey(), confirmAccept: true, ...(note === undefined ? {} : { note }) }
    : { requestKey: createRequestKey(), confirmReject: true, note: note ?? '退回修改' };
  const response = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/nodes/${nodeId}/${verdict}`, payload });
  return { statusCode: response.statusCode, body: response.body };
}

test('acceptance-pending nodes gate completion until every verdict is accepted', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-gating-complete-')), disableOpenCode: true, disableListen: true });
  try {
    const graph = graphWith([planNode('node_a', '步骤 A', ['A 的验收标准']), planNode('node_b', '步骤 B', ['B 的验收标准'])], [['node_a', 'node_b']]);
    const seeded = await seedExecution(app, graph, { statuses: ['succeeded', 'succeeded'], autoAdvance: true });
    app.engine.executions.kick(seeded.taskId);

    const parked = await waitFor(app, seeded.taskId, (execution) => execution?.status === 'paused', 'acceptance-pending park');
    assert.match(parked.notice?.message ?? '', /待人工验收/);
    assert.notEqual(parked.status, 'completed');
    assert.deepEqual(parked.acceptance?.pending, ['node_a', 'node_b']);
    assert.equal(app.store.tasks.get(seeded.taskId)?.attention, 'waiting_user');
    assert.equal(app.store.deliveries.byTask(seeded.taskId), undefined, 'no delivery exists before completion');

    // Node panel exposes the verdict actions while the execution is parked.
    const nodeDetail = await app.app.inject({ method: 'GET', url: `/api/tasks/${seeded.taskId}/nodes/node_a` });
    assert.equal(nodeDetail.statusCode, 200, nodeDetail.body);
    assert.equal(nodeDetail.json().data.acceptance?.state, 'pending');
    assert.equal(nodeDetail.json().data.actions.accept?.allowed, true);
    // The execution API projection exposes the gate; starting/execution actions
    // stay denied while the execution waits for the verdict.
    const executionView = await app.app.inject({ method: 'GET', url: `/api/tasks/${seeded.taskId}/execution` });
    assert.equal(executionView.statusCode, 200, executionView.body);
    assert.deepEqual(executionView.json().data.execution.acceptance?.pending, ['node_a', 'node_b']);
    const capabilities = app.engine.tasks.detail(seeded.taskId).capabilities;
    assert.equal(capabilities.startExecution?.allowed, false);

    // One verdict is not enough: the second pending node keeps the gate closed.
    assert.equal((await decide(app, seeded.taskId, 'node_a', 'accept', 'A 通过')).statusCode, 200);
    const stillParked = app.engine.executions.get(seeded.taskId);
    assert.equal(stillParked?.status, 'paused');
    assert.deepEqual(stillParked?.acceptance?.pending, ['node_b']);

    assert.equal((await decide(app, seeded.taskId, 'node_b', 'accept')).statusCode, 200);
    const completed = await waitFor(app, seeded.taskId, (execution) => execution?.status === 'completed', 'completion after acceptance');
    assert.match(completed.notice?.message ?? '', /完成|验收/);
    assert.deepEqual(completed.acceptance, { pending: [], rejected: [] }, 'confirmed empty gate distinguishes accepted from an unavailable verdict');
    assert.equal(app.store.tasks.get(seeded.taskId)?.attention, 'waiting_user', 'completed task waits for delivery');
    assert.ok(app.store.deliveries.byTask(seeded.taskId) !== undefined, 'completion creates the delivery record');
    const detail = await app.app.inject({ method: 'GET', url: `/api/tasks/${seeded.taskId}/detail` });
    assert.equal(detail.json().data.execution.status, 'completed');
    assert.deepEqual(detail.json().data.execution.acceptance, { pending: [], rejected: [] });
  } finally {
    await app.close();
  }
});

test('plans without acceptance criteria still complete on succeeded alone (legacy no-acceptance flow)', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-gating-legacy-')), disableOpenCode: true, disableListen: true });
  try {
    const graph = graphWith([planNode('node_a', '步骤 A', []), planNode('node_b', '步骤 B', [])], [['node_a', 'node_b']]);
    const seeded = await seedExecution(app, graph, { statuses: ['succeeded', 'succeeded'], autoAdvance: true });
    app.engine.executions.kick(seeded.taskId);
    const completed = await waitFor(app, seeded.taskId, (execution) => execution?.status === 'completed', 'legacy completion');
    assert.deepEqual(completed.acceptance, { pending: [], rejected: [] });
    assert.ok(app.store.deliveries.byTask(seeded.taskId) !== undefined);
  } finally {
    await app.close();
  }
});

test('a pending upstream verdict blocks manual advance; rejecting enables retry', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-gating-downstream-')), disableOpenCode: true, disableListen: true });
  try {
    // node_a is gated, node_b must not be released before node_a is accepted.
    const graph = graphWith([planNode('node_a', '步骤 A', ['A 的验收标准']), planNode('node_b', '步骤 B', [])], [['node_a', 'node_b']]);
    const seeded = await seedExecution(app, graph, { statuses: ['succeeded', 'pending'], autoAdvance: false });
    const blocked = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/execution/advance`, payload: { requestKey: createRequestKey(), confirmAdvance: true } });
    assert.equal(blocked.statusCode, 400, blocked.body);
    assert.match(String(blocked.json().error.message), /待人工验收/);
    assert.deepEqual(blocked.json().error.details.awaitingAcceptance, ['node_a']);
    assert.equal(app.store.executions.get(seeded.executionId)?.nodes.find((node) => node.nodeId === 'node_b')?.status, 'pending', 'downstream node is not released');

    assert.equal((await decide(app, seeded.taskId, 'node_a', 'accept')).statusCode, 200);
    const released = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/execution/advance`, payload: { requestKey: createRequestKey(), confirmAdvance: true } });
    assert.equal(released.statusCode, 200, released.body);
    assert.deepEqual(released.json().data.receipt.outcome?.released, ['node_b']);

    // Rejecting a gated node keeps the execution unfinished and allows an explicit retry.
    const single = graphWith([planNode('node_x', '步骤 X', ['X 的验收标准'])], []);
    const rejectedSeed = await seedExecution(app, single, { statuses: ['succeeded'], autoAdvance: true });
    app.engine.executions.kick(rejectedSeed.taskId);
    await waitFor(app, rejectedSeed.taskId, (execution) => execution?.status === 'paused', 'park before reject');
    assert.equal((await decide(app, rejectedSeed.taskId, 'node_x', 'reject', '导出列名不符合验收标准')).statusCode, 200);
    const afterReject = app.engine.executions.get(rejectedSeed.taskId);
    assert.equal(afterReject?.status, 'paused');
    assert.notEqual(afterReject?.status, 'completed');
    assert.deepEqual(afterReject?.acceptance?.rejected, ['node_x']);
    assert.match(afterReject?.notice?.message ?? '', /退回/);
    // The verdict does not rewrite the node result (W0-4 boundary stays intact).
    assert.equal(app.store.executions.get(rejectedSeed.executionId)?.nodes.find((node) => node.nodeId === 'node_x')?.status, 'succeeded');
    assert.equal(readNodeAcceptance(app.store, rejectedSeed.executionId, 'node_x')?.state, 'rejected');

    const retry = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${rejectedSeed.taskId}/execution/retry`,
      payload: { requestKey: createRequestKey(), confirm: true },
    });
    assert.equal(retry.statusCode, 200, retry.body);
    const outcome = retry.json().data.receipt.outcome as { retried?: number; rejectedRetried?: number };
    assert.equal(outcome.rejectedRetried, 1, 'retry retries the rejected node');
    assert.equal(readNodeAcceptance(app.store, rejectedSeed.executionId, 'node_x'), undefined, 'retry clears the rejected verdict');
    // With no workspace the retried node fails deterministically; the execution
    // must not magically complete.
    await waitFor(app, rejectedSeed.taskId, (execution) => execution?.status === 'paused' && execution.nodes.some((node) => node.nodeId === 'node_x' && node.status === 'failed'), 'rejected node fails without a workspace and pauses per policy');
  } finally {
    await app.close();
  }
});
