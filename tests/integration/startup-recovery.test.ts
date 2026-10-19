import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequestKey, nowIso, type PlanRevision } from '@agent-workflow/shared';
import { createApplication, type RunningApplication } from '../../packages/server/src/index.ts';

/**
 * Startup recovery (P0-4): a process restart must not leave executions,
 * planning rounds or workspaces permanently "running"/"preparing".
 *
 * Each scenario seeds persisted in-flight state in one application instance,
 * closes it, reopens the same data directory and asserts the migration plus the
 * settled receipt. All temp directories are unique per test.
 */

function createRepo(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `aw-startup-${label}-`));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), `# ${label}\n`, 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  return root;
}

interface Fixture {
  readonly projectId: string;
  readonly taskId: string;
  readonly plan: PlanRevision;
}

/** Project + task + generated skeleton plan (a real graph to build an execution on). */
async function createFixture(app: RunningApplication, label: string): Promise<Fixture> {
  const project = await app.app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { requestKey: createRequestKey(), name: label, rootPath: createRepo(label) },
  });
  assert.equal(project.statusCode, 201, project.body);
  const projectId = project.json().data.resource.project.id as string;

  const task = await app.app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: {
      requestKey: createRequestKey(),
      projectId,
      title: label,
      requirementText: '启动恢复：进程重启后不得永久停在进行中。',
      methodId: 'method.requirement-development',
    },
  });
  assert.equal(task.statusCode, 201, task.body);
  const taskId = task.json().data.resource.task.id as string;

  const skeleton = await app.app.inject({
    method: 'POST',
    url: `/api/tasks/${taskId}/plan/skeleton`,
    payload: { requestKey: createRequestKey(), confirmUseSkeleton: true },
  });
  assert.equal(skeleton.statusCode, 200, skeleton.body);
  const plan = skeleton.json().data.resource.plan as PlanRevision;
  return { projectId, taskId, plan };
}

async function open(dataDir: string): Promise<RunningApplication> {
  return createApplication({ dataDir, disableOpenCode: true, disableListen: true });
}

function createPlanningRound(app: RunningApplication, taskId: string, status: 'queued' | 'running' | 'stopping'): string {
  const settings = app.engine.settings;
  const round = app.store.planning.create({
    taskId,
    ordinal: 1,
    inputRevision: 1,
    method: { id: 'method.requirement-development', revision: 'r1', name: '需求开发' },
    strategy: { id: 'planning', version: 'v1' },
    model: settings.models[0]!,
    usage: {
      dispatches: { used: 0, maximum: 2 },
      revisions: { used: 0, maximum: 1 },
      budget: { known: 0, reserved: 0, unknown: 0, currency: settings.planning.currency },
      tokens: { input: 0, output: 0, reasoning: 0, cache: 0, total: 0 },
    },
  });
  app.store.tasks.update(taskId, { stage: 'planning', currentPlanningRoundId: round.id });
  if (status !== 'queued') {
    app.store.planning.update(round.id, {
      status,
      stage: 'generating',
      startedAt: nowIso(),
      stageRuns: [
        { stage: 'preparing_input', state: 'completed', startedAt: nowIso(), endedAt: nowIso() },
        { stage: 'generating', state: 'running', startedAt: nowIso() },
      ],
    });
  }
  return round.id;
}

test('startup recovery interrupts a running execution and settles its accepted receipt', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-startup-exec-data-'));
  const first = await open(dataDir);
  let taskId = '';
  let executionId = '';
  let attemptId = '';
  let startKey = '';
  try {
    const fixture = await createFixture(first, 'execution');
    taskId = fixture.taskId;
    const execution = first.store.executions.create({
      taskId,
      planRevisionId: fixture.plan.id,
      graph: fixture.plan.graph,
      autoAdvance: false,
    });
    executionId = execution.id;
    first.store.tasks.update(taskId, { executionId, stage: 'executing' });
    first.store.executions.update(executionId, { status: 'running' });
    const node = execution.nodes[0]!;
    first.store.executions.updateNode(executionId, node.nodeId, { status: 'running', startedAt: nowIso() });
    const attempt = first.store.executions.createAttempt({ executionId, nodeId: node.nodeId, ordinal: 1 });
    attemptId = attempt.id;
    first.store.executions.updateNode(executionId, node.nodeId, { currentAttemptId: attemptId });
    startKey = createRequestKey();
    first.store.operations.accept({
      requestKey: startKey,
      operation: 'execution.start',
      bodyHash: 'startup-recovery-exec',
      contractVersion: '1',
      target: { taskId, executionId },
    });
  } finally {
    await first.close();
  }

  const second = await open(dataDir);
  try {
    const recovered = second.store.executions.get(executionId);
    assert.ok(recovered !== undefined);
    assert.equal(recovered.status, 'unknown');
    assert.equal(recovered.notice?.kind, 'unknown');
    assert.match(recovered.notice?.message ?? '', /进程重启/);
    const nodeState = recovered.nodes.find((node) => node.status === 'failed' || node.status === 'unknown');
    assert.ok(nodeState !== undefined, 'interrupted node leaves running');
    assert.equal(nodeState.status, 'failed');
    assert.equal(nodeState.error?.code, 'INTERRUPTED');
    assert.equal(second.store.executions.getAttempt(attemptId)?.status, 'failed');
    assert.equal(second.store.tasks.get(taskId)?.attention, 'unknown', 'task no longer looks idle');

    const receipt = second.store.operations.get(startKey);
    assert.equal(receipt?.status, 'unknown', 'accepted receipt is settled');
    assert.equal(receipt?.error?.code, 'INTERNAL_ERROR');
    const byKey = await second.app.inject({ method: 'GET', url: `/api/operations/${startKey}` });
    assert.equal(byKey.statusCode, 200, byKey.body);
    assert.equal(byKey.json().data.operation.status, 'unknown');
    assert.match(byKey.json().data.operation.error.message, /进程重启/);

    // Idempotent: a second recovery pass finds nothing and changes nothing.
    const again = second.engine.recoverOnStartup();
    assert.equal(again.executions, 0);
    assert.equal(second.store.executions.get(executionId)?.status, 'unknown');
  } finally {
    await second.close();
  }

  // A third start must not throw and must keep the settled state.
  const third = await open(dataDir);
  try {
    assert.equal(third.store.executions.get(executionId)?.status, 'unknown');
    assert.equal(third.store.operations.get(startKey)?.status, 'unknown');
  } finally {
    await third.close();
  }
});

test('startup recovery marks an interrupted workspace unknown without touching its directory', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-startup-ws-data-'));
  const marker = join(dataDir, 'worktrees', 'startup-recovery-marker.txt');
  let taskId = '';
  let workspaceId = '';
  let prepareKey = '';
  const first = await open(dataDir);
  try {
    const fixture = await createFixture(first, 'workspace');
    taskId = fixture.taskId;
    mkdirSync(join(dataDir, 'worktrees'), { recursive: true });
    writeFileSync(marker, 'prepared by a crashed process\n', 'utf8');
    const workspace = first.store.workspaces.create({ taskId, kind: 'git_worktree', originalRootDisplay: '/tmp/original' });
    workspaceId = workspace.id;
    first.store.tasks.update(taskId, { workspaceId, stage: 'preparing' });
    first.store.workspaces.update(workspaceId, {
      state: 'preparing',
      steps: [
        { step: 'resolve_baseline', state: 'completed' },
        { step: 'create_branch', state: 'running' },
        { step: 'create_worktree', state: 'not_started' },
        { step: 'verify_worktree', state: 'not_started' },
        { step: 'bind_task', state: 'not_started' },
      ],
    });
    prepareKey = createRequestKey();
    first.store.operations.accept({
      requestKey: prepareKey,
      operation: 'task.workspace.prepare',
      bodyHash: 'startup-recovery-ws',
      contractVersion: '1',
      target: { taskId },
    });
  } finally {
    await first.close();
  }

  const second = await open(dataDir);
  try {
    const workspace = second.store.workspaces.get(workspaceId);
    assert.ok(workspace !== undefined);
    assert.equal(workspace.state, 'unknown');
    const runningStep = workspace.steps.find((step) => step.step === 'create_branch');
    assert.equal(runningStep?.state, 'failed');
    assert.match(runningStep?.detail ?? '', /核对/);
    assert.ok(workspace.steps.some((step) => (step.detail ?? '').includes('进程重启')), 'verification hint written');
    assert.equal(second.store.tasks.get(taskId)?.attention, 'unknown');
    assert.equal(second.store.operations.get(prepareKey)?.status, 'unknown');
    assert.ok(existsSync(marker), 'recovery never deletes workspace content');
  } finally {
    await second.close();
  }
});

test('startup recovery marks a running planning round unknown and keeps it reconcilable', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-startup-planning-data-'));
  let taskId = '';
  let roundId = '';
  let startKey = '';
  const first = await open(dataDir);
  try {
    const fixture = await createFixture(first, 'planning');
    taskId = fixture.taskId;
    roundId = createPlanningRound(first, taskId, 'running');
    startKey = createRequestKey();
    first.store.operations.accept({
      requestKey: startKey,
      operation: 'planning.start',
      bodyHash: 'startup-recovery-planning',
      contractVersion: '1',
      target: { taskId },
    });
  } finally {
    await first.close();
  }

  const second = await open(dataDir);
  try {
    const round = second.store.planning.get(roundId);
    assert.ok(round !== undefined);
    assert.equal(round.status, 'unknown', 'never stays running after restart');
    assert.equal(round.stage, 'unknown');
    assert.match(round.lastActivity ?? '', /进程重启/);
    assert.equal(second.store.planning.list(taskId).length, 1, 'no automatic redispatch / new round');
    assert.equal(second.store.operations.get(startKey)?.status, 'unknown');

    const detail = second.engine.tasks.detail(taskId);
    assert.equal(detail.task.attention, 'unknown');
    assert.equal(detail.capabilities.reconcile?.allowed, true, 'candidate round can be reconciled');
    assert.equal(detail.planning?.actions.stopPlanning?.allowed, false, 'UI no longer offers stop for a dead round');
  } finally {
    await second.close();
  }
});

test('startup recovery fails a queued planning round without dispatching a model and is idempotent', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-startup-queued-data-'));
  let taskId = '';
  let roundId = '';
  let startKey = '';
  const first = await open(dataDir);
  try {
    const fixture = await createFixture(first, 'queued');
    taskId = fixture.taskId;
    roundId = createPlanningRound(first, taskId, 'queued');
    startKey = createRequestKey();
    first.store.operations.accept({
      requestKey: startKey,
      operation: 'planning.start',
      bodyHash: 'startup-recovery-queued',
      contractVersion: '1',
      target: { taskId },
    });
  } finally {
    await first.close();
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const app = await open(dataDir);
    try {
      const round = app.store.planning.get(roundId);
      assert.ok(round !== undefined);
      assert.equal(round.status, 'failed');
      assert.equal(round.stage, 'failed');
      assert.equal(round.failure?.code, 'INTERRUPTED');
      assert.equal(app.store.planning.list(taskId).length, 1, 'queued round was never dispatched');
      const receipt = app.store.operations.get(startKey);
      assert.equal(receipt?.status, 'failed', 'queued receipt settles as a definite failure');
      assert.match(receipt?.error?.message ?? '', /进程重启/);
      const summary = app.engine.recoverOnStartup();
      assert.equal(summary.executions, 0);
      assert.equal(summary.planningRounds, 0);
      assert.equal(summary.workspaces, 0);
      assert.equal(app.store.planning.get(roundId)?.status, 'failed');
    } finally {
      await app.close();
    }
  }
});

test('startup recovery is a quiet no-op when nothing was in flight', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-startup-clean-data-'));
  const app = await open(dataDir);
  try {
    const summary = app.engine.recoverOnStartup();
    assert.deepEqual(summary, {
      executions: 0,
      planningRounds: 0,
      workspaces: 0,
      pptWorks: 0,
      affectedTaskIds: [],
      failures: [],
    });
  } finally {
    await app.close();
  }
});
