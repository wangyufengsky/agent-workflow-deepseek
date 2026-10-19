import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequestKey, type PlanGraph } from '@agent-workflow/shared';
import { createApplication, type RunningApplication } from '../../packages/server/src/index.ts';

/**
 * W2-4b: `verify_only` produces a persisted read-only task (`Task.readOnly`).
 * The action projection and the plan/planning/execution service entry points
 * refuse every writable command — not just the UI — while ordinary tasks keep
 * working normally.
 */

function createRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'aw-readonly-repo-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# readonly\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  return root;
}

async function createProjectAndTask(app: RunningApplication, title: string): Promise<{ projectId: string; taskId: string }> {
  const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: createRequestKey(), name: title, rootPath: createRepo() } });
  assert.equal(project.statusCode, 201, project.body);
  const projectId = project.json().data.resource.project.id as string;
  const task = await app.app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: { requestKey: createRequestKey(), projectId, title, requirementText: 'R1 生成月报\n验收：包含风险章节', methodId: 'method.requirement-development' },
  });
  assert.equal(task.statusCode, 201, task.body);
  return { projectId, taskId: task.json().data.resource.task.id as string };
}

async function createVerifyOnlyDraft(app: RunningApplication): Promise<{ parentTaskId: string; draftTaskId: string }> {
  const { taskId } = await createProjectAndTask(app, '只读验证父任务');
  const skeleton = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/plan/skeleton`, payload: { requestKey: createRequestKey(), confirmUseSkeleton: true } });
  assert.equal(skeleton.statusCode, 200, skeleton.body);
  const plan = skeleton.json().data.resource.plan as { id: string; graph: PlanGraph };
  const execution = app.store.executions.create({ taskId, planRevisionId: plan.id, graph: plan.graph, autoAdvance: false });
  const node = plan.graph.nodes[0]!;
  app.store.executions.updateNode(execution.id, node.id, { status: 'failed', error: { code: 'VALIDATION_FAILED', message: '缺少风险章节' } });
  const attempt = app.store.executions.createAttempt({ executionId: execution.id, nodeId: node.id, ordinal: 1 });
  app.store.executions.finishAttempt(attempt.id, 'failed', {
    resultRevision: 'res_readonly',
    summary: '初稿缺少风险章节',
    artifacts: [],
    errors: [],
    warnings: [],
    verification: { state: 'failed', summary: '2 个验收项未通过' },
  }, '验证未通过');
  app.store.executions.update(execution.id, { status: 'failed' });
  app.store.tasks.update(taskId, { executionId: execution.id, attention: 'failed' });
  // Keep the derived-draft title suffix distinct from the parent's title.
  const recovery = await app.app.inject({
    method: 'POST',
    url: `/api/tasks/${taskId}/recovery`,
    payload: { requestKey: createRequestKey(), mode: 'verify_only', confirmCreate: true },
  });
  assert.equal(recovery.statusCode, 200, recovery.body);
  const draft = recovery.json().data.resource.task as { id: string; readOnly?: boolean; attention: string; title: string; requirement: { supplements: { text: string }[] } };
  assert.equal(draft.readOnly, true);
  assert.equal(draft.attention, 'waiting_user');
  assert.match(draft.title, /只读验证恢复/);
  assert.match(draft.requirement.supplements.at(-1)?.text ?? '', /只读验证范围/);
  return { parentTaskId: taskId, draftTaskId: draft.id };
}

test('verify_only drafts reject planning, plan confirmation and execution server-side', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-readonly-data-'));
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  let draftTaskId = '';
  let parentTaskId = '';
  try {
    const draft = await createVerifyOnlyDraft(app);
    draftTaskId = draft.draftTaskId;
    parentTaskId = draft.parentTaskId;

    // Action projection: every writable action is denied with the read-only reason.
    const detail = await app.app.inject({ method: 'GET', url: `/api/tasks/${draftTaskId}/detail` });
    assert.equal(detail.statusCode, 200, detail.body);
    const capabilities = detail.json().data.capabilities as Record<string, { allowed: boolean; reasonCode?: string }>;
    for (const key of ['generatePlan', 'useSkeleton', 'confirmPlan', 'editPlan', 'prepareWorkspace', 'startExecution', 'pauseExecution', 'resumeExecution', 'cancelExecution', 'deliver', 'cleanupWorkspace']) {
      assert.equal(capabilities[key]?.allowed, false, `${key} must be denied`);
      assert.equal(capabilities[key]?.reasonCode, 'RECOVERY_READ_ONLY', `${key} reason`);
    }

    // Server-side second checks: each writable command is refused before any mutation.
    const calls: { readonly name: string; readonly url: string; readonly payload: Record<string, unknown>; readonly expectedCode: string; readonly expectedStatus: number }[] = [
      { name: 'planning preview', url: `/api/tasks/${draftTaskId}/planning/preview`, payload: {}, expectedCode: 'FORBIDDEN', expectedStatus: 403 },
      { name: 'planning start', url: `/api/tasks/${draftTaskId}/planning/start`, payload: { requestKey: createRequestKey(), previewId: 'preview_missing', sourceInputRevision: 1, confirmModelDispatch: true }, expectedCode: 'FORBIDDEN', expectedStatus: 403 },
      { name: 'plan skeleton', url: `/api/tasks/${draftTaskId}/plan/skeleton`, payload: { requestKey: createRequestKey(), confirmUseSkeleton: true }, expectedCode: 'FORBIDDEN', expectedStatus: 403 },
      { name: 'plan confirm', url: `/api/tasks/${draftTaskId}/plan/confirm`, payload: { requestKey: createRequestKey(), planRevisionId: 'plan_missing', expectedRevisionNumber: 1, confirmPlan: true }, expectedCode: 'FORBIDDEN', expectedStatus: 403 },
      { name: 'plan edit begin', url: `/api/tasks/${draftTaskId}/plan/edit/begin`, payload: { requestKey: createRequestKey(), planRevisionId: 'plan_missing', confirmPause: true }, expectedCode: 'FORBIDDEN', expectedStatus: 403 },
      { name: 'execution start', url: `/api/tasks/${draftTaskId}/execution/start`, payload: { requestKey: createRequestKey(), confirm: true }, expectedCode: 'FORBIDDEN', expectedStatus: 403 },
      { name: 'execution pause', url: `/api/tasks/${draftTaskId}/execution/pause`, payload: { requestKey: createRequestKey() }, expectedCode: 'FORBIDDEN', expectedStatus: 403 },
      { name: 'execution cancel', url: `/api/tasks/${draftTaskId}/execution/cancel`, payload: { requestKey: createRequestKey(), confirm: true }, expectedCode: 'FORBIDDEN', expectedStatus: 403 },
      // Workspace preparation has no confirmed plan to work from: it fails before touching disk.
      { name: 'workspace prepare', url: `/api/tasks/${draftTaskId}/workspace/prepare`, payload: { requestKey: createRequestKey(), expectedPlanRevisionNumber: 1, expectedBaseRef: 'main', confirmPrepare: true }, expectedCode: 'WORKSPACE_NOT_READY', expectedStatus: 503 },
    ];
    for (const call of calls) {
      const response = await app.app.inject({ method: 'POST', url: call.url, payload: call.payload });
      assert.equal(response.statusCode, call.expectedStatus, `${call.name}: ${response.body}`);
      assert.equal(response.json().error.code, call.expectedCode, call.name);
    }

    // No plan/round/workspace/execution record was created for the read-only draft.
    assert.equal(app.store.plans.list(draftTaskId).length, 0);
    assert.equal(app.store.planning.list(draftTaskId).length, 0);
    assert.equal(app.store.workspaces.byTask(draftTaskId), undefined);
    assert.equal(app.store.executions.byTask(draftTaskId), undefined);
    // The parent stays read-only intact and the draft can be opened again.
    assert.equal(app.store.tasks.get(parentTaskId)?.readOnly, undefined);
    const reopened = await app.app.inject({ method: 'GET', url: `/api/tasks/${draftTaskId}/detail` });
    assert.equal(reopened.json().data.task.readOnly, true);

    // Read-only drafts cannot spawn further recovery drafts.
    const nested = await app.app.inject({ method: 'POST', url: `/api/tasks/${draftTaskId}/recovery`, payload: { requestKey: createRequestKey(), mode: 'all_stages', confirmCreate: true } });
    assert.equal(nested.statusCode, 400, nested.body);
    assert.equal(nested.json().error.code, 'VALIDATION_FAILED');

    // An ordinary task is unaffected: planning skeleton still works.
    const normal = await createProjectAndTask(app, '普通任务');
    const normalSkeleton = await app.app.inject({ method: 'POST', url: `/api/tasks/${normal.taskId}/plan/skeleton`, payload: { requestKey: createRequestKey(), confirmUseSkeleton: true } });
    assert.equal(normalSkeleton.statusCode, 200, normalSkeleton.body);
  } finally {
    await app.close();
  }

  // `readOnly` is persisted: a restart keeps the same enforcement.
  const restarted = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const detail = await restarted.app.inject({ method: 'GET', url: `/api/tasks/${draftTaskId}/detail` });
    assert.equal(detail.json().data.task.readOnly, true, 'readOnly survives restart');
    const blocked = await restarted.app.inject({ method: 'POST', url: `/api/tasks/${draftTaskId}/planning/preview`, payload: {} });
    assert.equal(blocked.statusCode, 403, blocked.body);
    assert.equal(blocked.json().error.code, 'FORBIDDEN');
    assert.equal(blocked.json().error.details.reason, 'RECOVERY_READ_ONLY');
  } finally {
    await restarted.close();
  }
});

test('writable recovery modes stay writable and can reach planning/confirmation', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-readonly-normal-')), disableOpenCode: true, disableListen: true });
  try {
    const { taskId } = await createProjectAndTask(app, '可写恢复父任务');
    app.store.tasks.update(taskId, { attention: 'failed' });
    const recovery = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/recovery`,
      payload: { requestKey: createRequestKey(), mode: 'all_stages', confirmCreate: true },
    });
    assert.equal(recovery.statusCode, 200, recovery.body);
    const draft = recovery.json().data.resource.task as { id: string; readOnly?: boolean };
    assert.equal(draft.readOnly, undefined, 'all_stages draft is writable');
    const skeleton = await app.app.inject({ method: 'POST', url: `/api/tasks/${draft.id}/plan/skeleton`, payload: { requestKey: createRequestKey(), confirmUseSkeleton: true } });
    assert.equal(skeleton.statusCode, 200, skeleton.body);
    const plan = skeleton.json().data.resource.plan as { id: string; revisionNumber: number };
    const confirm = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${draft.id}/plan/confirm`,
      payload: { requestKey: createRequestKey(), planRevisionId: plan.id, expectedRevisionNumber: plan.revisionNumber, confirmPlan: true },
    });
    assert.equal(confirm.statusCode, 200, confirm.body);
  } finally {
    await app.close();
  }
});

test('readOnly attention is stable and does not leak into delivery or execution views', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-readonly-attention-')), disableOpenCode: true, disableListen: true });
  try {
    const draft = await createVerifyOnlyDraft(app);
    app.engine.tasks.recomputeAttention(draft.draftTaskId);
    const task = app.store.tasks.get(draft.draftTaskId);
    assert.equal(task?.attention, 'waiting_user', 'read-only drafts stay flagged for the human check');
  } finally {
    await app.close();
  }
});
