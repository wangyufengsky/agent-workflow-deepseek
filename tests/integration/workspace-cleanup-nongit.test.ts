import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequestKey } from '@agent-workflow/shared';
import { createApplication, type RunningApplication } from '../../packages/server/src/index.ts';

/**
 * W2-3: non-Git workspace cleanup must actually delete the independent copy and
 * the baseline snapshot (plus the `directory.baseline.<workspaceId>` settings
 * key), never the project's original directory, and stay retryable on failure.
 */

async function prepareNonGitWorkspace(app: RunningApplication, sourceRoot: string): Promise<{
  readonly taskId: string;
  readonly workspaceId: string;
  readonly copyRoot: string;
  readonly baselineRoot: string;
}> {
  const project = await app.app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { requestKey: createRequestKey(), name: 'Plain cleanup', rootPath: sourceRoot },
  });
  assert.equal(project.statusCode, 201, project.body);
  const projectId = project.json().data.resource.project.id as string;
  const task = await app.app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: { requestKey: createRequestKey(), projectId, title: 'Plain cleanup', requirementText: 'R1 修改报告', methodId: 'method.requirement-development' },
  });
  assert.equal(task.statusCode, 201, task.body);
  const taskId = task.json().data.resource.task.id as string;
  const skeleton = await app.app.inject({
    method: 'POST',
    url: `/api/tasks/${taskId}/plan/skeleton`,
    payload: { requestKey: createRequestKey(), confirmUseSkeleton: true },
  });
  assert.equal(skeleton.statusCode, 200, skeleton.body);
  const plan = skeleton.json().data.resource.plan as { id: string; revisionNumber: number };
  const confirm = await app.app.inject({
    method: 'POST',
    url: `/api/tasks/${taskId}/plan/confirm`,
    payload: { requestKey: createRequestKey(), planRevisionId: plan.id, expectedRevisionNumber: plan.revisionNumber, confirmPlan: true },
  });
  assert.equal(confirm.statusCode, 200, confirm.body);
  const prepare = await app.app.inject({
    method: 'POST',
    url: `/api/tasks/${taskId}/workspace/prepare`,
    payload: { requestKey: createRequestKey(), expectedPlanRevisionNumber: plan.revisionNumber, expectedBaseRef: 'baseline', confirmPrepare: true },
  });
  assert.equal(prepare.statusCode, 200, prepare.body);
  const workspace = prepare.json().data.resource.workspace as { id: string; kind: string; state: string; displayRoot: string };
  assert.equal(workspace.kind, 'directory_copy');
  assert.equal(workspace.state, 'ready');
  const baseline = app.store.settings.getJson<{ baselineRoot?: string }>(`directory.baseline.${workspace.id}`);
  assert.ok(baseline?.baselineRoot !== undefined, 'prepare registers the baseline settings key');
  return { taskId, workspaceId: workspace.id, copyRoot: workspace.displayRoot, baselineRoot: baseline.baselineRoot! };
}

async function cleanup(app: RunningApplication, taskId: string): Promise<{ preview: Record<string, unknown>; confirm: { statusCode: number; body: string } }> {
  const preview = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/workspace/cleanup/preview`, payload: {} });
  assert.equal(preview.statusCode, 200, preview.body);
  const data = preview.json().data.preview as { previewRef: string; workspaceRevision: string };
  const confirm = await app.app.inject({
    method: 'POST',
    url: `/api/tasks/${taskId}/workspace/cleanup/confirm`,
    payload: { requestKey: createRequestKey(), previewRef: data.previewRef, workspaceRevision: data.workspaceRevision, confirmCleanup: true },
  });
  return { preview: preview.json().data.preview as Record<string, unknown>, confirm: { statusCode: confirm.statusCode, body: confirm.body } };
}

test('non-Git cleanup really deletes the managed copy, baseline and settings key, and is idempotent', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-nongit-clean-data-'));
  const sourceRoot = mkdtempSync(join(tmpdir(), 'aw-nongit-clean-src-'));
  writeFileSync(join(sourceRoot, 'a.txt'), 'original-a', 'utf8');
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const workspace = await prepareNonGitWorkspace(app, sourceRoot);
    assert.ok(workspace.copyRoot.startsWith(join(dataDir, 'workspaces')), workspace.copyRoot);
    assert.ok(workspace.baselineRoot.startsWith(join(dataDir, 'baselines')), workspace.baselineRoot);
    writeFileSync(join(workspace.copyRoot, 'task-work.txt'), 'done by agent', 'utf8');

    const first = await cleanup(app, workspace.taskId);
    const preview = first.preview as {
      deleteObjects: { kind: string; label: string }[];
      retainObjects: { kind: string; label: string }[];
      blockers: unknown[];
    };
    assert.deepEqual(preview.blockers, []);
    assert.ok(preview.deleteObjects.some((item) => item.kind === 'copy_directory' && item.label === workspace.copyRoot));
    assert.ok(preview.deleteObjects.some((item) => item.kind === 'internal_cache' && item.label === workspace.baselineRoot));
    const retain = preview.retainObjects.map((item) => item.label).join('|');
    assert.ok(retain.includes('项目原目录'), retain);
    assert.ok(retain.includes(sourceRoot), retain);

    assert.equal(first.confirm.statusCode, 200, first.confirm.body);
    const confirmed = JSON.parse(first.confirm.body) as {
      data: { receipt: { status: string; outcome?: { removed?: string[] } }; resource: { workspace: { state: string; retention: string } } };
    };
    assert.equal(confirmed.data.receipt.status, 'succeeded');
    assert.equal(confirmed.data.resource.workspace.state, 'cleaned');
    assert.equal(confirmed.data.resource.workspace.retention, 'cleaned');
    assert.ok((confirmed.data.receipt.outcome?.removed ?? []).length >= 2, 'receipt lists removed managed directories');

    assert.equal(existsSync(workspace.copyRoot), false, 'independent copy removed');
    assert.equal(existsSync(workspace.baselineRoot), false, 'baseline snapshot removed');
    assert.equal(app.store.settings.getJson(`directory.baseline.${workspace.workspaceId}`), undefined, 'baseline settings key removed');
    assert.equal(readFileSync(join(sourceRoot, 'a.txt'), 'utf8'), 'original-a', 'source directory untouched');
    assert.equal(existsSync(join(sourceRoot, 'task-work.txt')), false, 'agent work never leaks into the source');

    // Repeating the cleanup is idempotent: same success receipt, still cleaned,
    // and nothing is recreated or deleted from the source.
    const second = await cleanup(app, workspace.taskId);
    assert.equal(second.confirm.statusCode, 200, second.confirm.body);
    const again = JSON.parse(second.confirm.body) as { data: { receipt: { status: string }; resource: { workspace: { state: string } } } };
    assert.equal(again.data.receipt.status, 'succeeded');
    assert.equal(again.data.resource.workspace.state, 'cleaned');
    assert.equal(existsSync(workspace.copyRoot), false);
    assert.equal(readFileSync(join(sourceRoot, 'a.txt'), 'utf8'), 'original-a');
  } finally {
    await app.close();
  }
});

test('non-Git cleanup refuses paths outside the managed roots and stays retryable', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-nongit-guard-data-'));
  const sourceRoot = mkdtempSync(join(tmpdir(), 'aw-nongit-guard-src-'));
  writeFileSync(join(sourceRoot, 'keep.txt'), 'keep-me', 'utf8');
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const workspace = await prepareNonGitWorkspace(app, sourceRoot);
    // Tamper the persisted displayRoot so it points at the source directory: the
    // cleanup must refuse instead of deleting the project.
    app.store.workspaces.update(workspace.workspaceId, { displayRoot: sourceRoot });

    const blocked = await cleanup(app, workspace.taskId);
    const preview = blocked.preview as { blockers: { kind: string }[] };
    assert.ok(preview.blockers.some((blocker) => blocker.kind === 'workspace_unmanaged'), JSON.stringify(preview.blockers));
    assert.equal(blocked.confirm.statusCode, 409, blocked.confirm.body);
    assert.equal((JSON.parse(blocked.confirm.body) as { error: { code: string } }).error.code, 'DELIVERY_BLOCKED');
    assert.equal(readFileSync(join(sourceRoot, 'keep.txt'), 'utf8'), 'keep-me', 'source directory never deleted');
    assert.equal(app.store.workspaces.get(workspace.workspaceId)?.state, 'ready', 'refused cleanup leaves a retryable state');

    // Restore the real managed root and retry: the same command now succeeds.
    app.store.workspaces.update(workspace.workspaceId, { displayRoot: workspace.copyRoot });
    const retried = await cleanup(app, workspace.taskId);
    assert.equal(retried.confirm.statusCode, 200, retried.confirm.body);
    assert.equal(existsSync(workspace.copyRoot), false);
    assert.equal(existsSync(workspace.baselineRoot), false);
    assert.equal(readFileSync(join(sourceRoot, 'keep.txt'), 'utf8'), 'keep-me');
  } finally {
    await app.close();
  }
});

test('an interrupted non-Git cleanup is recovered as partial and can be retried after restart', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-nongit-recover-data-'));
  const sourceRoot = mkdtempSync(join(tmpdir(), 'aw-nongit-recover-src-'));
  writeFileSync(join(sourceRoot, 'a.txt'), 'original-a', 'utf8');
  let taskId = '';
  let workspaceId = '';
  let cleanupKey = '';
  const first = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const workspace = await prepareNonGitWorkspace(first, sourceRoot);
    taskId = workspace.taskId;
    workspaceId = workspace.workspaceId;
    // Simulate a crash in the middle of cleanup: DB says cleaning, receipt is
    // accepted and the managed directories still exist.
    first.store.workspaces.update(workspaceId, { state: 'cleaning', retention: 'cleaning' });
    cleanupKey = createRequestKey();
    first.store.operations.accept({
      requestKey: cleanupKey,
      operation: 'task.workspace.cleanup.confirm',
      bodyHash: 'nongit-cleanup-recovery',
      contractVersion: '1',
      target: { taskId },
    });
    assert.ok(existsSync(workspace.copyRoot));
  } finally {
    await first.close();
  }

  const second = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const recovered = second.store.workspaces.get(workspaceId);
    assert.equal(recovered?.state, 'partial');
    assert.equal(recovered?.retention, 'partial');
    assert.equal(second.store.operations.get(cleanupKey)?.status, 'unknown');
    // Recovery never deletes by itself.
    assert.ok(existsSync(recovered?.displayRoot ?? ''));
    const retried = await cleanup(second, taskId);
    assert.equal(retried.confirm.statusCode, 200, retried.confirm.body);
    assert.equal(existsSync(recovered?.displayRoot ?? ''), false);
    const preview = await second.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/workspace/cleanup/preview`, payload: {} });
    assert.equal(preview.statusCode, 200, preview.body);
    assert.ok((preview.json().data.preview.blockers as unknown[]).length === 0);
  } finally {
    await second.close();
  }
});

test('non-Git cleanup preserves unrelated managed baselines', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-nongit-other-data-'));
  const sourceRoot = mkdtempSync(join(tmpdir(), 'aw-nongit-other-src-'));
  writeFileSync(join(sourceRoot, 'a.txt'), 'a', 'utf8');
  const otherBaseline = join(dataDir, 'baselines', 'ws_someone_else');
  mkdirSync(otherBaseline, { recursive: true });
  writeFileSync(join(otherBaseline, 'marker.txt'), 'other', 'utf8');
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const workspace = await prepareNonGitWorkspace(app, sourceRoot);
    const result = await cleanup(app, workspace.taskId);
    assert.equal(result.confirm.statusCode, 200, result.confirm.body);
    assert.equal(existsSync(workspace.copyRoot), false);
    assert.equal(existsSync(workspace.baselineRoot), false);
    assert.equal(readFileSync(join(otherBaseline, 'marker.txt'), 'utf8'), 'other', 'other tasks baselines untouched');
  } finally {
    await app.close();
  }
});

test('a filesystem failure keeps a retryable state and a failed receipt instead of a fake success', { skip: process.getuid?.() === 0 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-nongit-fail-data-'));
  const sourceRoot = mkdtempSync(join(tmpdir(), 'aw-nongit-fail-src-'));
  writeFileSync(join(sourceRoot, 'a.txt'), 'original-a', 'utf8');
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const workspace = await prepareNonGitWorkspace(app, sourceRoot);
    const preview = await app.app.inject({ method: 'POST', url: `/api/tasks/${workspace.taskId}/workspace/cleanup/preview`, payload: {} });
    const data = preview.json().data.preview as { previewRef: string; workspaceRevision: string };
    const requestKey = createRequestKey();
    // Make the managed parent read-only so deleting the copy fails with EACCES.
    chmodSync(join(dataDir, 'workspaces'), 0o500);
    let failed: Awaited<ReturnType<RunningApplication['app']['inject']>>;
    try {
      failed = await app.app.inject({
        method: 'POST',
        url: `/api/tasks/${workspace.taskId}/workspace/cleanup/confirm`,
        payload: { requestKey, previewRef: data.previewRef, workspaceRevision: data.workspaceRevision, confirmCleanup: true },
      });
    } finally {
      chmodSync(join(dataDir, 'workspaces'), 0o700);
    }
    assert.equal(failed.statusCode, 500, failed.body);
    assert.equal(app.store.workspaces.get(workspace.workspaceId)?.state, 'ready', 'failure restores a retryable state');
    assert.equal(app.store.workspaces.get(workspace.workspaceId)?.retention, 'partial', 'partial cleanup is recorded');
    assert.equal(app.store.operations.get(requestKey)?.status, 'failed', 'receipt records the failure');
    assert.equal(readFileSync(join(sourceRoot, 'a.txt'), 'utf8'), 'original-a');

    const retried = await cleanup(app, workspace.taskId);
    assert.equal(retried.confirm.statusCode, 200, retried.confirm.body);
    assert.equal(existsSync(workspace.copyRoot), false);
    assert.equal(existsSync(workspace.baselineRoot), false);
    assert.equal(readFileSync(join(sourceRoot, 'a.txt'), 'utf8'), 'original-a');
  } finally {
    await app.close();
  }
});
