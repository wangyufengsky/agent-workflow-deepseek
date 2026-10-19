import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequestKey, nowIso, type PlanGraph } from '@agent-workflow/shared';
import { createApplication, type RunningApplication } from '../../packages/server/src/index.ts';

/**
 * W2-4: the three recovery modes must produce real, defensible differences in
 * the derived draft (requirement context, attention and what may follow), not
 * just a different title. Executions/plans/workspaces are never copied and are
 * never created by recovery itself.
 */

interface ParentFixture {
  readonly projectId: string;
  readonly taskId: string;
  readonly planId: string;
  readonly executionId: string;
  readonly nodeId: string;
}

async function createParentWithFailure(app: RunningApplication): Promise<ParentFixture> {
  const repo = mkdtempSync(join(tmpdir(), 'aw-recovery-modes-repo-'));
  writeFileSync(join(repo, 'README.md'), '# repo\n', 'utf8');
  const project = await app.app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { requestKey: createRequestKey(), name: 'Recovery modes', rootPath: repo },
  });
  assert.equal(project.statusCode, 201, project.body);
  const projectId = project.json().data.resource.project.id as string;
  const task = await app.app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: { requestKey: createRequestKey(), projectId, title: '月报生成', requirementText: 'R1 生成月报\n验收：包含风险章节', methodId: 'method.requirement-development' },
  });
  assert.equal(task.statusCode, 201, task.body);
  const taskId = task.json().data.resource.task.id as string;
  const skeleton = await app.app.inject({
    method: 'POST',
    url: `/api/tasks/${taskId}/plan/skeleton`,
    payload: { requestKey: createRequestKey(), confirmUseSkeleton: true },
  });
  assert.equal(skeleton.statusCode, 200, skeleton.body);
  const plan = skeleton.json().data.resource.plan as { id: string; revisionNumber: number; graph: PlanGraph };

  const execution = app.store.executions.create({ taskId, planRevisionId: plan.id, graph: plan.graph, autoAdvance: false });
  const node = plan.graph.nodes[0]!;
  app.store.executions.updateNode(execution.id, node.id, {
    status: 'failed',
    error: { code: 'VALIDATION_FAILED', message: '月报缺少风险章节（2 个校验失败）' },
  });
  const attempt = app.store.executions.createAttempt({ executionId: execution.id, nodeId: node.id, ordinal: 1 });
  app.store.executions.finishAttempt(attempt.id, 'failed', {
    resultRevision: 'res_recovery_modes',
    summary: '生成了初稿，但风险章节为空',
    artifacts: [],
    errors: [{ code: 'VALIDATION_FAILED', message: '缺少风险章节' }],
    warnings: [],
    verification: { state: 'failed', passed: 3, failed: 2, summary: '2 个验收项未通过' },
  }, '验证未通过');
  app.store.executions.update(execution.id, { status: 'failed', notice: { kind: 'failed', message: '1 个步骤失败' } });
  app.store.tasks.update(taskId, { executionId: execution.id, attention: 'failed' });

  // Parent already carries an answered planning supplement: from_failed_stage
  // must keep it, all_stages must not.
  const parent = app.store.tasks.get(taskId)!;
  app.store.tasks.update(taskId, {
    requirement: {
      ...parent.requirement,
      supplements: [{ id: 'sup_parent_1', revision: parent.requirement.revision + 1, text: '已确认：风险章节必须包含数据来源', savedAt: nowIso() }],
      revision: parent.requirement.revision + 1,
      updatedAt: nowIso(),
    },
  });
  return { projectId, taskId, planId: plan.id, executionId: execution.id, nodeId: node.id };
}

async function recover(app: RunningApplication, taskId: string, mode: string): Promise<{
  readonly statusCode: number;
  readonly body: string;
  readonly json: {
    readonly data?: { readonly receipt: { readonly status: string; readonly outcome?: Record<string, unknown> }; readonly resource: { readonly task: Record<string, unknown>; readonly recovery: Record<string, unknown> } };
    readonly error?: { readonly code: string };
  };
}> {
  const response = await app.app.inject({
    method: 'POST',
    url: `/api/tasks/${taskId}/recovery`,
    payload: { requestKey: createRequestKey(), mode, confirmCreate: true, note: `${mode} 测试` },
  });
  return { statusCode: response.statusCode, body: response.body, json: response.json() };
}

test('recovery modes differ in inherited context, attention and follow-up actions', async () => {
  const app = await createApplication({
    dataDir: mkdtempSync(join(tmpdir(), 'aw-recovery-modes-data-')),
    disableOpenCode: true,
    disableListen: true,
  });
  try {
    const parent = await createParentWithFailure(app);
    const before = app.store.tasks.get(parent.taskId)!;

    const fromFailed = await recover(app, parent.taskId, 'from_failed_stage');
    const allStages = await recover(app, parent.taskId, 'all_stages');
    const verifyOnly = await recover(app, parent.taskId, 'verify_only');
    for (const [label, response] of [['from_failed_stage', fromFailed], ['all_stages', allStages], ['verify_only', verifyOnly]] as const) {
      assert.equal(response.statusCode, 200, `${label}: ${response.body}`);
      assert.equal(response.json.data?.receipt.status, 'succeeded', label);
    }

    const fromTask = fromFailed.json.data!.resource.task as { id: string; title: string; attention: string; requirement: { revision: number; supplements: { text: string }[]; entries: unknown[] } };
    const allTask = allStages.json.data!.resource.task as { id: string; title: string; attention: string; requirement: { revision: number; supplements: { text: string }[]; entries: unknown[] } };
    const verifyTask = verifyOnly.json.data!.resource.task as { id: string; title: string; attention: string; requirement: { revision: number; supplements: { text: string }[] } };

    assert.match(fromTask.title, /从失败阶段恢复/);
    assert.match(allTask.title, /全阶段恢复/);
    assert.match(verifyTask.title, /只读验证恢复/);

    // from_failed_stage: keeps parent supplements and appends the failure context.
    assert.equal(fromTask.requirement.supplements.length, 2);
    assert.equal(fromTask.requirement.supplements[0]!.text, '已确认：风险章节必须包含数据来源');
    assert.match(fromTask.requirement.supplements[1]!.text, /恢复上下文（从失败阶段恢复）/);
    assert.match(fromTask.requirement.supplements[1]!.text, /VALIDATION_FAILED/);
    assert.match(fromTask.requirement.supplements[1]!.text, /月报缺少风险章节/);
    assert.equal(fromTask.requirement.revision, before.requirement.revision + 1);
    assert.equal(fromTask.requirement.entries.length, before.requirement.entries.length, 'requirement entries are inherited');
    assert.equal(fromTask.attention, 'none');

    // all_stages: full restart from the requirement phase; nothing inherited.
    assert.equal(allTask.requirement.supplements.length, 0);
    assert.equal(allTask.requirement.revision, 1);
    assert.equal(allTask.attention, 'none');

    // verify_only: read-only verification scope with parent artifacts, flagged
    // for the human check, and no executable records created.
    assert.equal(verifyTask.requirement.supplements.length, 2);
    assert.match(verifyTask.requirement.supplements[1]!.text, /只读验证范围/);
    assert.match(verifyTask.requirement.supplements[1]!.text, /不创建计划、工作区或执行/);
    assert.match(verifyTask.requirement.supplements[1]!.text, /验证：failed/);
    assert.equal(verifyTask.attention, 'waiting_user');

    for (const taskId of [fromTask.id, allTask.id, verifyTask.id]) {
      assert.equal(app.store.plans.list(taskId).length, 0, `${taskId} has no plan`);
      assert.equal(app.store.executions.byTask(taskId), undefined, `${taskId} has no execution`);
      assert.equal(app.store.workspaces.byTask(taskId), undefined, `${taskId} has no workspace`);
    }
    const verifyCapabilities = app.engine.tasks.detail(verifyTask.id).capabilities;
    assert.equal(verifyCapabilities.confirmPlan?.allowed, false);
    assert.equal(verifyCapabilities.startExecution?.allowed, false);
    assert.equal(verifyCapabilities.prepareWorkspace?.allowed, false);
    const fromCapabilities = app.engine.tasks.detail(fromTask.id).capabilities;
    assert.equal(fromCapabilities.startExecution?.allowed, false, 'no mode creates an executable draft');

    // History exposes all three modes; replaying a requestKey stays idempotent.
    const history = await app.app.inject({ method: 'GET', url: `/api/tasks/${parent.taskId}/recoveries` });
    assert.equal(history.statusCode, 200, history.body);
    assert.deepEqual(
      (history.json().data.recoveries as { mode: string }[]).map((record) => record.mode).sort(),
      ['all_stages', 'from_failed_stage', 'verify_only'],
    );

    // The parent task and its execution evidence are untouched.
    const after = app.store.tasks.get(parent.taskId)!;
    assert.equal(after.title, before.title);
    assert.equal(after.stage, before.stage);
    assert.equal(after.attention, 'failed');
    assert.equal(after.requirement.revision, before.requirement.revision);
    assert.equal(after.requirement.supplements.length, 1);
    const execution = app.store.executions.get(parent.executionId)!;
    assert.equal(execution.status, 'failed');
    assert.equal(execution.nodes.find((node) => node.nodeId === parent.nodeId)?.status, 'failed');
    assert.equal(app.store.executions.listAttempts(parent.executionId).length, 1);
  } finally {
    await app.close();
  }
});

test('verify_only requires settled execution attempts; replaying a recovery request is idempotent', async () => {
  const app = await createApplication({
    dataDir: mkdtempSync(join(tmpdir(), 'aw-recovery-modes-audit-')),
    disableOpenCode: true,
    disableListen: true,
  });
  try {
    const parent = await createParentWithFailure(app);
    const requestKey = createRequestKey();
    const first = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${parent.taskId}/recovery`,
      payload: { requestKey, mode: 'from_failed_stage', confirmCreate: true },
    });
    assert.equal(first.statusCode, 200, first.body);
    const derivedId = first.json().data.resource.task.id as string;
    const replay = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${parent.taskId}/recovery`,
      payload: { requestKey, mode: 'from_failed_stage', confirmCreate: true },
    });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().data.resource.task.id, derivedId, 'same requestKey returns the same draft');
    assert.equal(app.store.tasks.list().filter((task) => task.title.includes('从失败阶段恢复')).length, 1);

    // A task without execution evidence cannot produce a read-only verification draft.
    const repo = mkdtempSync(join(tmpdir(), 'aw-recovery-modes-plain-'));
    const project = await app.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { requestKey: createRequestKey(), name: 'No evidence', rootPath: repo },
    });
    const projectId = project.json().data.resource.project.id as string;
    const task = await app.app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { requestKey: createRequestKey(), projectId, title: '无产物任务', requirementText: 'R1', methodId: 'method.requirement-development' },
    });
    const noEvidenceId = task.json().data.resource.task.id as string;
    app.store.tasks.update(noEvidenceId, { attention: 'failed' });
    const verify = await recover(app, noEvidenceId, 'verify_only');
    assert.equal(verify.statusCode, 400, verify.body);
    assert.equal(verify.json.error?.code, 'VALIDATION_FAILED');
    const all = await recover(app, noEvidenceId, 'all_stages');
    assert.equal(all.statusCode, 200, all.body);
  } finally {
    await app.close();
  }
});

test('recovery rejects an in-flight parent task before creating any draft', async () => {
  const app = await createApplication({
    dataDir: mkdtempSync(join(tmpdir(), 'aw-recovery-modes-inflight-')),
    disableOpenCode: true,
    disableListen: true,
  });
  try {
    const parent = await createParentWithFailure(app);
    app.store.executions.update(parent.executionId, { status: 'running' });
    const response = await recover(app, parent.taskId, 'all_stages');
    assert.equal(response.statusCode, 409, response.body);
    assert.equal(response.json.error?.code, 'HUMAN_REVIEW_REQUIRED');
    assert.equal(app.store.tasks.list().filter((task) => task.title.includes('全阶段恢复')).length, 0);
  } finally {
    await app.close();
  }
});
