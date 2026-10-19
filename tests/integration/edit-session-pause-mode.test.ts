import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequestKey, nowIso, type PlanGraph, type PlanNode } from '@agent-workflow/shared';
import { createApplication, type RunningApplication } from '../../packages/server/src/index.ts';

/**
 * W2-15: an edit session remembers whether the task was already paused when the
 * edit began. Abandoning (and ending) the edit restores that pause state instead
 * of blindly resuming; only an explicit resume continues a user-paused task.
 */

type App = RunningApplication;

function createRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'aw-editpause-repo-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# edit pause\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  return root;
}

function graph(): PlanGraph {
  const node = (id: string): PlanNode => ({
    id,
    key: id,
    title: id,
    kind: 'implementation',
    groupId: 'group_main',
    summary: '',
    inputs: [],
    outputs: [],
    acceptance: [],
    resources: { read: [], write: [] },
  });
  return {
    nodes: [node('node_a'), node('node_b')],
    edges: [{ id: 'edge_01', from: 'node_a', to: 'node_b', kind: 'order' }],
    groups: [{ id: 'group_main', label: '实现', kind: 'implementation', refined: false, collapsible: false, collapsedByDefault: false }],
  };
}

interface Seeded {
  readonly taskId: string;
  readonly executionId: string;
  readonly planId: string;
}

async function seed(app: App, options: { readonly status: 'running' | 'paused'; readonly autoAdvance: boolean; readonly userPaused: boolean }): Promise<Seeded> {
  const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: createRequestKey(), name: 'Edit pause', rootPath: createRepo() } });
  assert.equal(project.statusCode, 201, project.body);
  const projectId = project.json().data.resource.project.id as string;
  const task = await app.app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: { requestKey: createRequestKey(), projectId, title: '调整暂停', requirementText: 'R1 调整计划', methodId: 'method.requirement-development' },
  });
  assert.equal(task.statusCode, 201, task.body);
  const taskId = task.json().data.resource.task.id as string;
  const plan = app.store.plans.create({ taskId, source: 'skeleton', graph: graph(), status: 'confirmed' });
  app.store.tasks.update(taskId, { currentPlanRevisionId: plan.id });
  const execution = app.store.executions.create({ taskId, planRevisionId: plan.id, graph: graph(), autoAdvance: options.autoAdvance });
  app.store.tasks.update(taskId, { executionId: execution.id });
  app.store.executions.update(execution.id, {
    status: options.status,
    ...(options.userPaused ? { pause: { requestKey: createRequestKey(), settledAt: nowIso() } } : {}),
  });
  return { taskId, executionId: execution.id, planId: plan.id };
}

async function editBegin(app: App, seeded: Seeded): Promise<{ statusCode: number; body: string }> {
  const response = await app.app.inject({
    method: 'POST',
    url: `/api/tasks/${seeded.taskId}/plan/edit/begin`,
    payload: { requestKey: createRequestKey(), planRevisionId: seeded.planId, confirmPause: true },
  });
  return { statusCode: response.statusCode, body: response.body };
}

test('abandoning an edit on a user-paused task keeps it paused; a running task resumes', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-editpause-')), disableOpenCode: true, disableListen: true });
  try {
    // 1) Originally paused (user pause) + auto-advance on.
    const paused = await seed(app, { status: 'paused', autoAdvance: true, userPaused: true });
    assert.equal((await editBegin(app, paused)).statusCode, 200);
    const pausedSession = app.store.executions.get(paused.executionId)?.editSession;
    assert.equal(pausedSession?.wasPausedBeforeEdit, true, 'pre-edit pause mode is persisted');
    const abandonPaused = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${paused.taskId}/plan/edit/abandon`,
      payload: { requestKey: createRequestKey(), editSessionId: pausedSession!.id, confirmAbandon: true },
    });
    assert.equal(abandonPaused.statusCode, 200, abandonPaused.body);
    assert.equal(abandonPaused.json().data.receipt.outcome?.restoredStatus, 'paused');
    const afterPaused = app.store.executions.get(paused.executionId)!;
    assert.equal(afterPaused.status, 'paused', 'a paused task stays paused after abandoning the edit');
    assert.match(afterPaused.notice?.message ?? '', /保持.*暂停/);
    assert.equal(afterPaused.autoAdvance, true, 'pre-edit auto-advance is restored');
    assert.equal(afterPaused.editSession?.state, 'abandoned');

    // 2) Originally running + auto-advance off. Node A already succeeded so the
    // scheduler has nothing to run: the restored execution parks on the normal
    // "waiting for manual advance" state instead of a user pause.
    const running = await seed(app, { status: 'running', autoAdvance: false, userPaused: false });
    app.store.executions.updateNode(running.executionId, 'node_a', { status: 'succeeded' });
    assert.equal((await editBegin(app, running)).statusCode, 200);
    const runningSession = app.store.executions.get(running.executionId)?.editSession;
    assert.equal(runningSession?.wasPausedBeforeEdit, false);
    const abandonRunning = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${running.taskId}/plan/edit/abandon`,
      payload: { requestKey: createRequestKey(), editSessionId: runningSession!.id, confirmAbandon: true },
    });
    assert.equal(abandonRunning.statusCode, 200, abandonRunning.body);
    assert.equal(abandonRunning.json().data.receipt.outcome?.restoredStatus, 'running');
    // The HTTP route kicks the scheduler after abandon; with auto-advance off the
    // execution parks in the normal "waiting for manual advance" pause (not a
    // user pause, no requestKey) rather than resuming a user pause.
    const started = Date.now();
    let afterRunning = app.store.executions.get(running.executionId)!;
    while (afterRunning.status === 'running' && Date.now() - started < 4_000) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      afterRunning = app.store.executions.get(running.executionId)!;
    }
    assert.equal(afterRunning.status, 'paused', 'running task is rescheduled, not left stuck');
    assert.match(afterRunning.notice?.message ?? '', /等待推进/);
    assert.equal(afterRunning.pause?.requestKey, undefined, 'not a user pause');
    assert.equal(afterRunning.autoAdvance, false);
  } finally {
    await app.close();
  }
});

test('ending an edit on a user-paused task keeps it paused even with continueExecution', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-editpause-finish-')), disableOpenCode: true, disableListen: true });
  try {
    const paused = await seed(app, { status: 'paused', autoAdvance: false, userPaused: true });
    assert.equal((await editBegin(app, paused)).statusCode, 200);
    const session = app.store.executions.get(paused.executionId)!.editSession!;
    const finished = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${paused.taskId}/plan/edit/finish`,
      payload: { requestKey: createRequestKey(), editSessionId: session.id, continueExecution: true },
    });
    assert.equal(finished.statusCode, 200, finished.body);
    const outcome = finished.json().data.receipt.outcome as { continued?: boolean; keptPaused?: boolean };
    assert.equal(outcome.continued, false, 'continueExecution does not override a user pause');
    assert.equal(outcome.keptPaused, true);
    const after = app.store.executions.get(paused.executionId)!;
    assert.equal(after.status, 'paused');
    assert.match(after.notice?.message ?? '', /保持.*暂停/);
    assert.equal(after.autoAdvance, false);
  } finally {
    await app.close();
  }
});

test('the pre-edit pause mode survives a process restart and still restores paused', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-editpause-restart-'));
  const first = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  let taskId = '';
  let executionId = '';
  let sessionId = '';
  try {
    const seeded = await seed(first, { status: 'paused', autoAdvance: true, userPaused: true });
    taskId = seeded.taskId;
    executionId = seeded.executionId;
    assert.equal((await editBegin(first, seeded)).statusCode, 200);
    sessionId = first.store.executions.get(executionId)!.editSession!.id;
  } finally {
    await first.close();
  }

  const second = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const execution = second.store.executions.get(executionId)!;
    assert.equal(execution.status, 'paused');
    assert.equal(execution.editSession?.state, 'editing');
    assert.equal(execution.editSession?.wasPausedBeforeEdit, true, 'pause mode is durable');
    const abandoned = await second.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan/edit/abandon`,
      payload: { requestKey: createRequestKey(), editSessionId: sessionId, confirmAbandon: true },
    });
    assert.equal(abandoned.statusCode, 200, abandoned.body);
    assert.equal(second.store.executions.get(executionId)?.status, 'paused', 'still paused after restart + abandon');
  } finally {
    await second.close();
  }
});
