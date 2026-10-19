import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../../packages/server/src/index.ts';

function requestKey(prefix: string): string {
  return `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;
}

function createRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'aw-clean-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# clean\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  return root;
}

test('cleanup preview blocks on active execution and confirm rejects blockers', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-clean-data-'));
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: requestKey('prj'), name: 'Clean', rootPath: createRepo() } });
    const projectId = project.json().data.resource.project.id as string;
    const task = await app.app.inject({ method: 'POST', url: '/api/tasks', payload: { requestKey: requestKey('task'), projectId, title: 'Clean task', requirementText: 'R1', methodId: 'method.requirement-development' } });
    const taskId = task.json().data.resource.task.id as string;
    const skeleton = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/plan/skeleton`, payload: { requestKey: requestKey('skel'), confirmUseSkeleton: true } });
    const plan = skeleton.json().data.resource.plan as { id: string; graph: { nodes: { id: string }[]; edges: { from: string; to: string }[] } };
    const confirm = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/plan/confirm`, payload: { requestKey: requestKey('conf'), planRevisionId: plan.id, expectedRevisionNumber: 1, confirmPlan: true } });
    assert.equal(confirm.statusCode, 200, confirm.body);
    const prepare = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/workspace/prepare`, payload: { requestKey: requestKey('prep'), expectedPlanRevisionNumber: 1, expectedBaseRef: 'main', confirmPrepare: true } as never });
    assert.equal(prepare.statusCode, 200, prepare.body);

    const execution = app.store.executions.create({ taskId, planRevisionId: plan.id, graph: plan.graph as never, autoAdvance: false });
    app.store.executions.update(execution.id, { status: 'running' });
    app.store.tasks.update(taskId, { executionId: execution.id });

    const preview = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/workspace/cleanup/preview`, payload: {} });
    assert.equal(preview.statusCode, 200, preview.body);
    const blockers = preview.json().data.preview.blockers as { kind: string }[];
    assert.ok(blockers.some((blocker) => blocker.kind === 'execution_active'));
    const pv = preview.json().data.preview as { previewRef: string; workspaceRevision: string };
    const blocked = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/workspace/cleanup/confirm`, payload: { requestKey: requestKey('bad'), previewRef: pv.previewRef, workspaceRevision: pv.workspaceRevision, confirmCleanup: true } });
    assert.equal(blocked.statusCode, 409, blocked.body);
    assert.equal(blocked.json().error.code, 'DELIVERY_BLOCKED');

    app.store.executions.update(execution.id, { status: 'stopped' });
    const after = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/workspace/cleanup/preview`, payload: {} });
    const afterPreview = after.json().data.preview as { previewRef: string; workspaceRevision: string; blockers: { kind: string }[] };
    assert.equal(afterPreview.blockers.some((blocker) => blocker.kind === 'execution_active'), false);
    const cleaned = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/workspace/cleanup/confirm`, payload: { requestKey: requestKey('ok'), previewRef: afterPreview.previewRef, workspaceRevision: afterPreview.workspaceRevision, confirmCleanup: true } });
    assert.equal(cleaned.statusCode, 200, cleaned.body);
    assert.equal(cleaned.json().data.resource.workspace.state, 'cleaned');
  } finally {
    await app.close();
  }
});
