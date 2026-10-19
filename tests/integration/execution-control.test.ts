import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecutionStatusValue, NodeStatusValue, PlanGraph, PlanNode } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/index.ts';
import { isPathInside } from '../../packages/server/src/http.ts';

type App = Awaited<ReturnType<typeof createApplication>>;

function requestKey(prefix: string): string {
  return `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;
}

function createRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'aw-exec-repo-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# exec\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  return root;
}

function planNode(id: string, title: string): PlanNode {
  return {
    id,
    key: id,
    title,
    kind: 'implementation',
    groupId: 'group_main',
    summary: '',
    inputs: [],
    outputs: [],
    acceptance: [],
    resources: { read: [], write: [] },
  };
}

/** A -> B -> C chain (single root, one direct successor per node). */
function chainGraph(): PlanGraph {
  return {
    nodes: [planNode('node_a', '步骤 A'), planNode('node_b', '步骤 B'), planNode('node_c', '步骤 C')],
    edges: [
      { id: 'edge_ab', from: 'node_a', to: 'node_b', kind: 'order' },
      { id: 'edge_bc', from: 'node_b', to: 'node_c', kind: 'order' },
    ],
    groups: [{ id: 'group_main', label: '实现', kind: 'implementation', refined: false, collapsible: false, collapsedByDefault: false }],
  };
}

/** A -> (B, C) -> D parallel join. */
function joinGraph(): PlanGraph {
  return {
    nodes: [planNode('node_a', '步骤 A'), planNode('node_b', '步骤 B'), planNode('node_c', '步骤 C'), planNode('node_d', '步骤 D')],
    edges: [
      { id: 'edge_ab', from: 'node_a', to: 'node_b', kind: 'order' },
      { id: 'edge_ac', from: 'node_a', to: 'node_c', kind: 'order' },
      { id: 'edge_bd', from: 'node_b', to: 'node_d', kind: 'order' },
      { id: 'edge_cd', from: 'node_c', to: 'node_d', kind: 'order' },
    ],
    groups: [{ id: 'group_main', label: '实现', kind: 'implementation', refined: false, collapsible: false, collapsedByDefault: false }],
  };
}

interface Seeded {
  readonly projectId: string;
  readonly taskId: string;
  readonly planId: string;
  readonly executionId: string;
}

/**
 * Seeds a task with a stored confirmed plan revision and an execution over the
 * given graph. The scheduler is deterministic here: with no workspace every
 * dispatch attempt fails immediately, so asynchronous ticks cannot corrupt the
 * assertions (we assert receipts/outcomes and persisted flags, not live node
 * statuses that a background tick may already have moved).
 */
async function seedTask(app: App, input: { readonly graph: PlanGraph; readonly autoAdvance: boolean; readonly status?: ExecutionStatusValue }): Promise<Seeded> {
  const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: requestKey('prj'), name: 'Exec Control', rootPath: createRepo() } });
  assert.equal(project.statusCode, 201, project.body);
  const projectId = project.json().data.resource.project.id as string;
  const task = await app.app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: { requestKey: requestKey('task'), projectId, title: '执行控制', requirementText: 'R1 执行控制', methodId: 'method.requirement-development' },
  });
  assert.equal(task.statusCode, 201, task.body);
  const taskId = task.json().data.resource.task.id as string;
  const plan = app.store.plans.create({ taskId, source: 'skeleton', graph: input.graph, status: 'confirmed' });
  app.store.tasks.update(taskId, { currentPlanRevisionId: plan.id });
  const execution = app.store.executions.create({ taskId, planRevisionId: plan.id, graph: input.graph, autoAdvance: input.autoAdvance });
  app.store.tasks.update(taskId, { executionId: execution.id });
  if (input.status !== undefined) app.store.executions.update(execution.id, { status: input.status });
  return { projectId, taskId, planId: plan.id, executionId: execution.id };
}

function setNodeStatus(app: App, executionId: string, nodeId: string, status: NodeStatusValue): void {
  app.store.executions.updateNode(executionId, nodeId, { status });
}

async function operationOf(app: App, key: string): Promise<Record<string, unknown>> {
  const response = await app.app.inject({ method: 'GET', url: `/api/operations/${key}` });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().data.operation as Record<string, unknown>;
}

test('W2-1: auto-advance toggle persists the flag, returns a receipt and replays idempotently', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-auto-')), disableOpenCode: true, disableListen: true });
  try {
    const seeded = await seedTask(app, { graph: chainGraph(), autoAdvance: true, status: 'running' });

    const missingKey = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/execution/auto-advance`, payload: { autoAdvance: false, confirmChange: true } });
    assert.equal(missingKey.statusCode, 400, missingKey.body);
    assert.equal(missingKey.json().error.code, 'VALIDATION_FAILED');

    const noConfirm = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/execution/auto-advance`, payload: { requestKey: requestKey('auto'), autoAdvance: false } });
    assert.equal(noConfirm.statusCode, 400, noConfirm.body);

    const key = requestKey('auto');
    const payload = { requestKey: key, autoAdvance: false, confirmChange: true };
    const off = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/execution/auto-advance`, payload });
    assert.equal(off.statusCode, 200, off.body);
    const offData = off.json().data as {
      receipt: { requestKey: string; status: string; operation: string };
      resource: { execution: { autoAdvance: boolean } };
    };
    assert.equal(offData.receipt.requestKey, key);
    assert.equal(offData.receipt.status, 'succeeded');
    assert.equal(offData.receipt.operation, 'execution.autoAdvance');
    assert.equal(offData.resource.execution.autoAdvance, false);
    assert.equal(app.store.executions.get(seeded.executionId)?.autoAdvance, false);

    // Same key + same body replays the stored receipt (no second write).
    const replay = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/execution/auto-advance`, payload });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().data.receipt.requestKey, key);
    assert.equal(replay.json().data.receipt.status, 'succeeded');

    // Same key + different body is a conflict, never a silent second apply.
    const conflict = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/execution/auto-advance`, payload: { ...payload, autoAdvance: true } });
    assert.equal(conflict.statusCode, 409, conflict.body);
    assert.equal(conflict.json().error.code, 'REQUEST_KEY_REUSED');

    const onKey = requestKey('auto-on');
    const on = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/execution/auto-advance`, payload: { requestKey: onKey, autoAdvance: true, confirmChange: true } });
    assert.equal(on.statusCode, 200, on.body);
    assert.equal(app.store.executions.get(seeded.executionId)?.autoAdvance, true);
    const operation = await operationOf(app, onKey);
    assert.equal(operation.operation, 'execution.autoAdvance');
    assert.equal(operation.status, 'succeeded');
    assert.deepEqual(operation.outcome, { autoAdvance: true });

    // Terminal executions cannot toggle the switch any more.
    app.store.executions.update(seeded.executionId, { status: 'completed' });
    const completed = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/execution/auto-advance`, payload: { requestKey: requestKey('auto-done'), autoAdvance: false, confirmChange: true } });
    assert.equal(completed.statusCode, 409, completed.body);
    assert.equal(completed.json().error.code, 'OPERATION_IN_PROGRESS');

    // The switch is disabled while an edit session owns claiming.
    app.store.executions.update(seeded.executionId, {
      status: 'paused',
      editSession: { id: 'edit_x', state: 'editing', requestKey: requestKey('edit'), autoAdvanceBeforeEdit: true, lockedNodeIds: [], localChanges: [] },
    });
    const duringEdit = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/execution/auto-advance`, payload: { requestKey: requestKey('auto-edit'), autoAdvance: false, confirmChange: true } });
    assert.equal(duringEdit.statusCode, 409, duringEdit.body);

    const unknownTask = await app.app.inject({ method: 'POST', url: '/api/tasks/task_missing/execution/auto-advance', payload: { requestKey: requestKey('auto-missing'), autoAdvance: false, confirmChange: true } });
    assert.equal(unknownTask.statusCode, 404, unknownTask.body);
  } finally {
    await app.close();
  }
});

test('W2-1: manual advance releases eligible successors, scopes direct successors and waits on joins', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-advance-')), disableOpenCode: true, disableListen: true });
  try {
    const seeded = await seedTask(app, { graph: chainGraph(), autoAdvance: false, status: 'running' });

    const noConfirm = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/execution/advance`, payload: { requestKey: requestKey('adv'), nodeId: 'node_a' } });
    assert.equal(noConfirm.statusCode, 400, noConfirm.body);

    // Auto-advance on: manual advance must not act (the switch is the authority).
    app.store.executions.update(seeded.executionId, { autoAdvance: true });
    const autoOn = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/execution/advance`, payload: { requestKey: requestKey('adv-auto'), nodeId: 'node_a', confirmAdvance: true } });
    assert.equal(autoOn.statusCode, 409, autoOn.body);
    assert.equal(autoOn.json().error.code, 'OPERATION_IN_PROGRESS');
    app.store.executions.update(seeded.executionId, { autoAdvance: false });

    // A is accepted and B already accepted: a direct-successor advance from A
    // finds nothing to release (B done) even though C is eligible for "all".
    setNodeStatus(app, seeded.executionId, 'node_a', 'succeeded');
    setNodeStatus(app, seeded.executionId, 'node_b', 'succeeded');
    const direct = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/execution/advance`, payload: { requestKey: requestKey('adv-direct'), nodeId: 'node_a', confirmAdvance: true } });
    assert.equal(direct.statusCode, 400, direct.body);
    assert.equal(direct.json().error.code, 'VALIDATION_FAILED');
    assert.match(String(direct.json().error.message), /直接后继/);

    const key = requestKey('adv-all');
    const all = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/execution/advance`, payload: { requestKey: key, confirmAdvance: true } });
    assert.equal(all.statusCode, 200, all.body);
    const allData = all.json().data as { receipt: { requestKey: string; status: string; operation: string } };
    assert.equal(allData.receipt.requestKey, key);
    assert.equal(allData.receipt.status, 'succeeded');
    assert.equal(allData.receipt.operation, 'execution.advance');
    const operation = await operationOf(app, key);
    const outcome = operation.outcome as { released?: string[]; waitingFor?: unknown[] };
    assert.deepEqual(outcome.released, ['node_c']);
    assert.deepEqual(outcome.waitingFor, []);

    // Replaying the same key/body returns the stored receipt instead of
    // releasing again; a different body under the same key conflicts.
    const replay = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/execution/advance`, payload: { requestKey: key, confirmAdvance: true } });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().data.receipt.requestKey, key);
    const conflict = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/execution/advance`, payload: { requestKey: key, nodeId: 'node_a', confirmAdvance: true } });
    assert.equal(conflict.statusCode, 409, conflict.body);
    assert.equal(conflict.json().error.code, 'REQUEST_KEY_REUSED');

    // Parallel join: D is only advanced once BOTH B and C are accepted.
    const joined = await seedTask(app, { graph: joinGraph(), autoAdvance: false, status: 'running' });
    setNodeStatus(app, joined.executionId, 'node_a', 'succeeded');
    const waiting = await app.app.inject({ method: 'POST', url: `/api/tasks/${joined.taskId}/execution/advance`, payload: { requestKey: requestKey('adv-join'), nodeId: 'node_b', confirmAdvance: true } });
    assert.equal(waiting.statusCode, 400, waiting.body);
    const waitingDetails = waiting.json().error.details as { waitingFor?: { nodeId: string; prerequisites: string[] }[] };
    assert.deepEqual(waitingDetails.waitingFor, [{ nodeId: 'node_d', prerequisites: ['node_b', 'node_c'] }]);

    const joinAll = await app.app.inject({ method: 'POST', url: `/api/tasks/${joined.taskId}/execution/advance`, payload: { requestKey: requestKey('adv-join-all'), confirmAdvance: true } });
    assert.equal(joinAll.statusCode, 200, joinAll.body);
    const joinOutcome = (await operationOf(app, joinAll.json().data.receipt.requestKey)).outcome as { released?: string[] };
    assert.deepEqual(joinOutcome.released, ['node_b', 'node_c']);

    // Nothing eligible: root failed and its successor waits on it.
    const empty = await seedTask(app, { graph: chainGraph(), autoAdvance: false, status: 'running' });
    setNodeStatus(app, empty.executionId, 'node_a', 'failed');
    const nothing = await app.app.inject({ method: 'POST', url: `/api/tasks/${empty.taskId}/execution/advance`, payload: { requestKey: requestKey('adv-none'), confirmAdvance: true } });
    assert.equal(nothing.statusCode, 400, nothing.body);
    assert.equal(nothing.json().error.code, 'VALIDATION_FAILED');
    assert.match(String(nothing.json().error.message), /没有可以推进/);

    // A user pause must be resumed explicitly; advance is not a hidden resume.
    app.store.executions.update(empty.executionId, { status: 'paused', pause: { requestKey: requestKey('user-pause'), settledAt: new Date().toISOString() } });
    const userPaused = await app.app.inject({ method: 'POST', url: `/api/tasks/${empty.taskId}/execution/advance`, payload: { requestKey: requestKey('adv-paused'), confirmAdvance: true } });
    assert.equal(userPaused.statusCode, 409, userPaused.body);
    assert.match(String(userPaused.json().error.message), /用户暂停/);

    // Unknown step / unknown task (fresh running execution, otherwise the pause
    // guard would answer first).
    const fresh = await seedTask(app, { graph: chainGraph(), autoAdvance: false, status: 'running' });
    const missingNode = await app.app.inject({ method: 'POST', url: `/api/tasks/${fresh.taskId}/execution/advance`, payload: { requestKey: requestKey('adv-node'), nodeId: 'node_missing', confirmAdvance: true } });
    assert.equal(missingNode.statusCode, 404, missingNode.body);
    const missingTask = await app.app.inject({ method: 'POST', url: '/api/tasks/task_missing/execution/advance', payload: { requestKey: requestKey('adv-task'), confirmAdvance: true } });
    assert.equal(missingTask.statusCode, 404, missingTask.body);
  } finally {
    await app.close();
  }
});

test('W2-2: abandon discards the edit draft, restores auto-advance and keeps the confirmed plan', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-abandon-')), disableOpenCode: true, disableListen: true });
  try {
    const seeded = await seedTask(app, { graph: chainGraph(), autoAdvance: false, status: 'running' });
    const planCountBefore = app.store.plans.list(seeded.taskId).length;

    const begin = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${seeded.taskId}/plan/edit/begin`,
      payload: { requestKey: requestKey('edit-begin'), planRevisionId: seeded.planId, confirmPause: true },
    });
    assert.equal(begin.statusCode, 200, begin.body);
    const session = app.store.executions.get(seeded.executionId)?.editSession;
    assert.ok(session !== undefined);
    assert.equal(session.state, 'editing');
    assert.equal(session.autoAdvanceBeforeEdit, false);
    assert.equal(app.store.executions.get(seeded.executionId)?.status, 'paused');

    const missingKey = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/plan/edit/abandon`, payload: { editSessionId: session.id, confirmAbandon: true } });
    assert.equal(missingKey.statusCode, 400, missingKey.body);

    const noConfirm = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/plan/edit/abandon`, payload: { requestKey: requestKey('abandon-noconfirm'), editSessionId: session.id } });
    assert.equal(noConfirm.statusCode, 400, noConfirm.body);

    const stale = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/plan/edit/abandon`, payload: { requestKey: requestKey('abandon-stale'), editSessionId: 'edit_stale', confirmAbandon: true } });
    assert.equal(stale.statusCode, 409, stale.body);
    assert.equal(stale.json().error.code, 'STALE_TARGET');

    const key = requestKey('abandon');
    const payload = { requestKey: key, editSessionId: session.id, confirmAbandon: true };
    const abandoned = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/plan/edit/abandon`, payload });
    assert.equal(abandoned.statusCode, 200, abandoned.body);
    const data = abandoned.json().data as {
      receipt: { requestKey: string; status: string; operation: string };
      resource: { plan?: { id: string }; planHistory: readonly unknown[]; editSession?: { state: string; localChanges: readonly unknown[] } };
    };
    assert.equal(data.receipt.requestKey, key);
    assert.equal(data.receipt.status, 'succeeded');
    assert.equal(data.receipt.operation, 'plan.edit.abandon');
    assert.equal(data.resource.plan?.id, seeded.planId, 'the last confirmed plan revision stays authoritative');
    assert.equal(data.resource.planHistory.length, planCountBefore, 'abandon must not create a plan revision');
    assert.equal(data.resource.editSession?.state, 'abandoned');
    assert.deepEqual(data.resource.editSession?.localChanges, []);

    const after = app.store.executions.get(seeded.executionId)!;
    assert.equal(after.editSession?.state, 'abandoned');
    assert.equal(after.editSession?.localChanges.length, 0);
    assert.equal(after.autoAdvance, false, 'pre-edit auto-advance setting is restored');
    assert.equal(app.store.tasks.get(seeded.taskId)?.currentPlanRevisionId, seeded.planId);
    assert.equal(app.store.plans.list(seeded.taskId).length, planCountBefore);

    // Same key/body replays; a finished session cannot be abandoned twice.
    const replay = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/plan/edit/abandon`, payload });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().data.receipt.requestKey, key);
    const again = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/plan/edit/abandon`, payload: { requestKey: requestKey('abandon-again'), editSessionId: session.id, confirmAbandon: true } });
    assert.equal(again.statusCode, 409, again.body);
    assert.equal(again.json().error.code, 'OPERATION_IN_PROGRESS');

    // A saved (unconfirmed revision created) session must be reconfirmed/continued
    // instead of being silently thrown away.
    app.store.executions.update(seeded.executionId, { editSession: { ...after.editSession!, state: 'saved' } });
    const saved = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/plan/edit/abandon`, payload: { requestKey: requestKey('abandon-saved'), editSessionId: session.id, confirmAbandon: true } });
    assert.equal(saved.statusCode, 409, saved.body);
    assert.match(String(saved.json().error.message), /重新确认/);

    const unknownTask = await app.app.inject({ method: 'POST', url: '/api/tasks/task_missing/plan/edit/abandon', payload: { requestKey: requestKey('abandon-task'), editSessionId: 'edit_x', confirmAbandon: true } });
    assert.equal(unknownTask.statusCode, 404, unknownTask.body);
  } finally {
    await app.close();
  }
});

test('W2-13: unknown task views return JSON 404 and normal task actions stay complete', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-views-')), disableOpenCode: true, disableListen: true });
  try {
    for (const view of ['execution', 'workspace', 'delivery']) {
      const response = await app.app.inject({ method: 'GET', url: `/api/tasks/task_missing/${view}` });
      assert.equal(response.statusCode, 404, `${view}: ${response.body}`);
      assert.match(response.headers['content-type'] ?? '', /application\/json/);
      const body = response.json() as { error?: { code: string; requestId: string } };
      assert.equal(body.error?.code, 'NOT_FOUND');
      assert.equal(typeof body.error?.requestId, 'string');
    }

    // Normal task with a prepared workspace: every view exposes the same
    // capability projection instead of a constant `{}`.
    const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: requestKey('prj'), name: 'Views', rootPath: createRepo() } });
    const projectId = project.json().data.resource.project.id as string;
    const task = await app.app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { requestKey: requestKey('task'), projectId, title: '视图动作', requirementText: 'R1 视图', methodId: 'method.requirement-development' },
    });
    const taskId = task.json().data.resource.task.id as string;
    const skeleton = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/plan/skeleton`, payload: { requestKey: requestKey('skel'), confirmUseSkeleton: true } });
    const planId = skeleton.json().data.resource.plan.id as string;
    const confirm = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/plan/confirm`, payload: { requestKey: requestKey('conf'), planRevisionId: planId, expectedRevisionNumber: 1, confirmPlan: true } });
    assert.equal(confirm.statusCode, 200, confirm.body);
    const prepare = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/workspace/prepare`, payload: { requestKey: requestKey('prep'), expectedPlanRevisionNumber: 1, expectedBaseRef: 'main', confirmPrepare: true } });
    assert.equal(prepare.statusCode, 200, prepare.body);

    const expectedKeys = [
      'generatePlan',
      'useSkeleton',
      'applyCandidate',
      'rejectCandidate',
      'stopPlanning',
      'reconcile',
      'saveAnswer',
      'confirmPlan',
      'editPlan',
      'adjustExecutionPlan',
      'prepareWorkspace',
      'startExecution',
      'pauseExecution',
      'resumeExecution',
      'cancelExecution',
      'continueExecution',
      'deliver',
      'cleanupWorkspace',
    ];
    for (const [view, url] of [['execution', `/api/tasks/${taskId}/execution`], ['workspace', `/api/tasks/${taskId}/workspace`], ['delivery', `/api/tasks/${taskId}/delivery`]] as const) {
      const response = await app.app.inject({ method: 'GET', url });
      assert.equal(response.statusCode, 200, `${view}: ${response.body}`);
      const actions = response.json().data.actions as Record<string, { allowed: boolean }>;
      for (const key of expectedKeys) {
        assert.ok(actions[key] !== undefined, `${view} actions missing ${key}`);
        assert.equal(typeof actions[key]!.allowed, 'boolean');
      }
    }
  } finally {
    await app.close();
  }
});

test('W2-9: static path containment uses separator boundaries; legacy DELETE database still gets a receipt', async () => {
  const root = '/srv/apps/web/dist';
  assert.equal(isPathInside(root, '/srv/apps/web/dist/index.html'), true);
  assert.equal(isPathInside(root, '/srv/apps/web/dist/assets/app.js'), true);
  assert.equal(isPathInside(root, root), true);
  // A sibling whose name merely starts with the root must never pass.
  assert.equal(isPathInside(root, '/srv/apps/web/dist-evil/secret.txt'), false);
  assert.equal(isPathInside(root, '/srv/apps/web/dist/../dist-evil/secret.txt'), false);
  assert.equal(isPathInside(root, '/srv/apps/web/other/index.html'), false);

  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-static-')), disableOpenCode: true, disableListen: true });
  try {
    const traversal = await app.app.inject({ method: 'GET', url: '/assets/..%2F..%2Fpackage.json' });
    assert.ok(traversal.statusCode === 403 || traversal.statusCode === 404, `${traversal.statusCode}: ${traversal.body.slice(0, 160)}`);
    assert.match(traversal.headers['content-type'] ?? '', /application\/json/);
    assert.ok(!traversal.body.includes('"name": "agent-workflow"'), 'package.json must never be served through /assets');

    // Missing requestKey is 400 for all three new command routes, before any domain code.
    for (const [url, payload] of [
      ['/api/tasks/task_x/execution/auto-advance', { autoAdvance: false, confirmChange: true }],
      ['/api/tasks/task_x/execution/advance', { confirmAdvance: true }],
      ['/api/tasks/task_x/plan/edit/abandon', { editSessionId: 'edit_x', confirmAbandon: true }],
    ] as const) {
      const response = await app.app.inject({ method: 'POST', url, payload });
      assert.equal(response.statusCode, 400, `${url}: ${response.body}`);
      assert.equal(response.json().error.code, 'VALIDATION_FAILED');
    }

    // Documented compatibility: legacy DatabasesPage deletes without a body, so
    // the server generates an auditable requestKey and still answers a receipt.
    const created = await app.app.inject({
      method: 'POST',
      url: '/api/settings/databases',
      payload: { requestKey: requestKey('db'), connection: { name: 'Legacy Delete', type: 'mysql', host: '127.0.0.1', port: 3310, database: 'legacy_delete', user: 'legacy', readOnly: true } },
    });
    assert.equal(created.statusCode, 200, created.body);
    const connectionId = created.json().data.connection.id as string;
    const removed = await app.app.inject({ method: 'DELETE', url: `/api/settings/databases/${encodeURIComponent(connectionId)}` });
    assert.equal(removed.statusCode, 200, removed.body);
    const removedData = removed.json().data as { receipt: { requestKey: string; status: string }; connections: readonly unknown[] };
    assert.equal(removedData.receipt.status, 'succeeded');
    assert.ok(removedData.receipt.requestKey.startsWith('req_'));
    assert.equal(removedData.connections.length, 0);
  } finally {
    await app.close();
  }
});
