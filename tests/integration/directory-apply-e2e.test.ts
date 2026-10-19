import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequestKey } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/index.ts';

function requestKey(prefix: string): string {
  return createRequestKey();
}

function writeSource(root: string, relativePath: string, content: string): void {
  const target = join(root, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

test('non-Git task: real prepare captures baseline, preview and apply write the original directory', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-dir-e2e-data-'));
  const sourceRoot = mkdtempSync(join(tmpdir(), 'aw-dir-e2e-src-'));
  writeSource(sourceRoot, 'report/a.txt', 'original-a');
  writeSource(sourceRoot, 'report/keep.txt', 'keep');
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: requestKey('prj'), name: 'Plain E2E', rootPath: sourceRoot } });
    assert.equal(project.statusCode, 201, project.body);
    const projectId = project.json().data.resource.project.id as string;
    const task = await app.app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { requestKey: requestKey('task'), projectId, title: 'Plain apply', requirementText: 'R1 modify report', methodId: 'method.requirement-development' },
    });
    const taskId = task.json().data.resource.task.id as string;
    const skeleton = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/plan/skeleton`, payload: { requestKey: requestKey('skel'), confirmUseSkeleton: true } });
    const plan = skeleton.json().data.resource.plan;
    const confirm = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan/confirm`,
      payload: { requestKey: requestKey('conf'), planRevisionId: plan.id, expectedRevisionNumber: plan.revisionNumber, confirmPlan: true },
    });
    assert.equal(confirm.statusCode, 200, confirm.body);
    const prepare = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/workspace/prepare`,
      payload: { requestKey: requestKey('prep'), expectedPlanRevisionNumber: plan.revisionNumber, expectedBaseRef: 'baseline', confirmPrepare: true },
    });
    assert.equal(prepare.statusCode, 200, prepare.body);
    const workspace = prepare.json().data.resource.workspace;
    assert.equal(workspace.state, 'ready');
    assert.equal(workspace.kind, 'directory_copy');
    const baseline = app.store.settings.getJson<{ baselineRoot?: string }>(`directory.baseline.${workspace.id}`);
    assert.ok(baseline?.baselineRoot !== undefined);

    writeSource(workspace.displayRoot, 'report/a.txt', 'task-a');
    writeSource(workspace.displayRoot, 'report/new.txt', 'task-new');

    const previewRes = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/delivery/apply/preview`, payload: {} });
    assert.equal(previewRes.statusCode, 200, previewRes.body);
    const preview = previewRes.json().data.preview as { previewRef: string; revision: string; counts: { applicable: number; unresolved: number } };
    assert.ok(preview.counts.applicable >= 2);
    assert.equal(preview.counts.unresolved, 0);
    // Preview did not touch the original directory.
    assert.equal(readFileSync(join(sourceRoot, 'report/a.txt'), 'utf8'), 'original-a');

    const applyRes = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/delivery/apply`,
      payload: { requestKey: requestKey('apply'), previewRef: preview.previewRef, previewRevision: preview.revision, resolutions: [], confirmApply: true },
    });
    assert.equal(applyRes.statusCode, 200, applyRes.body);
    const data = applyRes.json().data as {
      receipt: { status: string };
      resource: { result: { applied: number; blocked: number; notExecuted: number } };
    };
    assert.equal(data.receipt.status, 'succeeded');
    assert.ok(data.resource.result.applied >= 2);
    assert.equal(readFileSync(join(sourceRoot, 'report/a.txt'), 'utf8'), 'task-a');
    assert.equal(readFileSync(join(sourceRoot, 'report/new.txt'), 'utf8'), 'task-new');
    assert.equal(readFileSync(join(sourceRoot, 'report/keep.txt'), 'utf8'), 'keep');

    const delivery = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/delivery` });
    assert.equal(delivery.statusCode, 200, delivery.body);
    assert.equal(delivery.json().data.delivery.projection, 'delivered');
    assert.ok(delivery.json().data.delivery.applyPreview !== undefined);
    const detail = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/detail` });
    assert.equal(detail.json().data.task.lifecycle, 'completed');
  } finally {
    await app.close();
  }
});
