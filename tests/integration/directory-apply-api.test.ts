import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequestKey, nowIso } from '@agent-workflow/shared';
import { encodeFileId } from '../../packages/engine/src/directory-apply.ts';
import { createApplication, type RunningApplication } from '../../packages/server/src/index.ts';
import { registerDirectoryApplyRoutes } from '../../packages/server/src/directory-apply-plugin.ts';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

interface Harness {
  readonly app: RunningApplication;
  readonly sourceRoot: string;
  close(): Promise<void>;
}

interface TaskFixture {
  readonly projectId: string;
  readonly taskId: string;
  readonly workspaceId: string;
  readonly copyRoot: string;
}

function writeTreeFile(root: string, relativePath: string, content: string): void {
  const target = join(root, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

async function createHarness(initial: Record<string, string> = { 'report/a.txt': 'base-a' }): Promise<Harness> {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-dir-apply-http-data-'));
  const sourceRoot = mkdtempSync(join(tmpdir(), 'aw-dir-apply-http-src-'));
  for (const [path, content] of Object.entries(initial)) writeTreeFile(sourceRoot, path, content);
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  if (!app.app.hasRoute({ method: 'POST', url: '/api/tasks/:id/delivery/apply/preview' })) {
    registerDirectoryApplyRoutes(app.app, { engine: app.engine, store: app.store });
  }
  return {
    app,
    sourceRoot,
    async close() {
      await app.close();
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(sourceRoot, { recursive: true, force: true });
    },
  };
}

function createDirectoryTask(app: RunningApplication, sourceRoot: string, options: { withBaseline?: boolean } = {}): TaskFixture {
  const { store } = app;
  const project = store.projects.create({ name: '非 Git 项目', rootPath: sourceRoot, gitState: 'not_git' });
  const task = store.tasks.create({
    projectId: project.id,
    title: '月报改为按自然月汇总',
    requirementText: 'R1 按自然月汇总',
    methodId: 'method.requirement-development',
    methodRevision: '1',
  });
  const workspace = store.workspaces.create({
    taskId: task.id,
    kind: 'directory_copy',
    originalRootDisplay: sourceRoot,
    baseRef: 'baseline',
  });
  const baselineRoot = join(store.dataDir, 'baselines', workspace.id);
  cpSync(sourceRoot, baselineRoot, { recursive: true });
  const copyRoot = join(store.dataDir, 'workspaces', task.id);
  cpSync(baselineRoot, copyRoot, { recursive: true });
  store.workspaces.update(workspace.id, { state: 'ready', displayRoot: copyRoot });
  store.tasks.update(task.id, { workspaceId: workspace.id });
  if (options.withBaseline !== false) {
    store.settings.putJson(`directory.baseline.${workspace.id}`, { baselineRoot, sourceRoot, createdAt: nowIso() });
  }
  return { projectId: project.id, taskId: task.id, workspaceId: workspace.id, copyRoot };
}

function copyWrite(task: TaskFixture, relativePath: string, content: string): void {
  writeTreeFile(task.copyRoot, relativePath, content);
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

test('HTTP：preview 只读检查 + apply 写入原目录、交付结算与面板预览', async () => {
  const harness = await createHarness();
  try {
    const task = createDirectoryTask(harness.app, harness.sourceRoot);
    copyWrite(task, 'report/a.txt', 'task-a');
    copyWrite(task, 'report/b.txt', 'task-b');

    const previewRes = await harness.app.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.taskId}/delivery/apply/preview`,
      payload: { fileIds: [encodeFileId('report/a.txt'), encodeFileId('report/b.txt')] },
    });
    assert.equal(previewRes.statusCode, 200, previewRes.body);
    const preview = previewRes.json().data.preview as {
      previewRef: string;
      revision: string;
      counts: { applicable: number; conflict: number; unsupported: number; unresolved: number };
      items: { path: string; check: string; change: string }[];
    };
    assert.equal(preview.counts.applicable, 2);
    assert.equal(preview.counts.unresolved, 0);
    assert.equal(preview.items.length, 2);
    assert.equal(readFileSync(join(harness.sourceRoot, 'report/a.txt'), 'utf8'), 'base-a');

    // The read-only preview is exposed through the delivery panel contract too.
    const deliveryBefore = await harness.app.app.inject({ method: 'GET', url: `/api/tasks/${task.taskId}/delivery` });
    assert.equal(deliveryBefore.statusCode, 200, deliveryBefore.body);
    assert.equal(deliveryBefore.json().data.delivery.applyPreview.previewRef, preview.previewRef);

    const requestKey = createRequestKey();
    const applyRes = await harness.app.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.taskId}/delivery/apply`,
      payload: {
        requestKey,
        previewRef: preview.previewRef,
        previewRevision: preview.revision,
        resolutions: [],
        confirmApply: true,
      },
    });
    assert.equal(applyRes.statusCode, 200, applyRes.body);
    const body = applyRes.json().data as {
      receipt: { status: string; requestKey: string };
      resource: { delivery: { projection: string; applyPreview?: { previewRef: string } }; result: { applied: number; blocked: number } };
    };
    assert.equal(body.receipt.status, 'succeeded');
    assert.equal(body.receipt.requestKey, requestKey);
    assert.equal(body.resource.result.applied, 2);
    assert.equal(body.resource.result.blocked, 0);
    assert.equal(body.resource.delivery.projection, 'delivered');
    assert.equal(body.resource.delivery.applyPreview?.previewRef, preview.previewRef);
    assert.equal(readFileSync(join(harness.sourceRoot, 'report/a.txt'), 'utf8'), 'task-a');
    assert.equal(readFileSync(join(harness.sourceRoot, 'report/b.txt'), 'utf8'), 'task-b');
    assert.equal(harness.app.store.tasks.get(task.taskId)!.lifecycle, 'completed');

    // Same request key replays the receipt instead of writing again.
    const replayRes = await harness.app.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.taskId}/delivery/apply`,
      payload: {
        requestKey,
        previewRef: preview.previewRef,
        previewRevision: preview.revision,
        resolutions: [],
        confirmApply: true,
      },
    });
    assert.equal(replayRes.statusCode, 200, replayRes.body);
    assert.equal(replayRes.json().data.receipt.status, 'succeeded');
  } finally {
    await harness.close();
  }
});

test('HTTP：冻结预览的冲突处理与逐项结果', async () => {
  const harness = await createHarness({ 'both.txt': 'base-both', 'added.txt': 'base-added' });
  try {
    const task = createDirectoryTask(harness.app, harness.sourceRoot);
    copyWrite(task, 'both.txt', 'task-both');
    copyWrite(task, 'added.txt', 'task-added');
    rmSync(join(harness.sourceRoot, 'added.txt'));
    writeTreeFile(harness.sourceRoot, 'added.txt', 'user-added');

    const firstRes = await harness.app.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.taskId}/delivery/apply/preview`,
      payload: {},
    });
    assert.equal(firstRes.statusCode, 200, firstRes.body);
    const first = firstRes.json().data.preview as { previewRef: string; revision: string; counts: { conflict: number; unresolved: number } };
    assert.equal(first.counts.conflict, 1);
    assert.equal(first.counts.unresolved, 1);

    const blockedRes = await harness.app.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.taskId}/delivery/apply`,
      payload: {
        requestKey: createRequestKey(),
        previewRef: first.previewRef,
        previewRevision: first.revision,
        resolutions: [],
        confirmApply: true,
      },
    });
    assert.equal(blockedRes.statusCode, 409, blockedRes.body);
    assert.equal(blockedRes.json().error.code, 'DELIVERY_BLOCKED');

    const resolutions = [{ fileId: encodeFileId('added.txt'), resolution: 'keep_original' }];
    const frozenRes = await harness.app.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.taskId}/delivery/apply/preview`,
      payload: { resolutions },
    });
    assert.equal(frozenRes.statusCode, 200, frozenRes.body);
    const frozen = frozenRes.json().data.preview as { previewRef: string; revision: string; counts: { unresolved: number } };
    assert.equal(frozen.counts.unresolved, 0);

    const applyRes = await harness.app.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.taskId}/delivery/apply`,
      payload: {
        requestKey: createRequestKey(),
        previewRef: frozen.previewRef,
        previewRevision: frozen.revision,
        resolutions: [{ fileId: encodeFileId('added.txt'), resolution: 'keep_original' }],
        confirmApply: true,
      },
    });
    assert.equal(applyRes.statusCode, 200, applyRes.body);
    const data = applyRes.json().data as {
      resource: { result: { applied: number; notExecuted: number; items: { path: string; result: string }[] } };
    };
    assert.equal(data.resource.result.applied, 1);
    assert.equal(data.resource.result.notExecuted, 1);
    assert.equal(readFileSync(join(harness.sourceRoot, 'both.txt'), 'utf8'), 'task-both');
    assert.equal(readFileSync(join(harness.sourceRoot, 'added.txt'), 'utf8'), 'user-added');
  } finally {
    await harness.close();
  }
});

test('HTTP：错误码 — 缺少 requestKey、无效预览、漂移、缺少基线', async () => {
  const harness = await createHarness();
  try {
    const task = createDirectoryTask(harness.app, harness.sourceRoot);
    copyWrite(task, 'report/a.txt', 'task-a');

    const noKey = await harness.app.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.taskId}/delivery/apply`,
      payload: { previewRef: 'pv_123456', previewRevision: 'rev', resolutions: [], confirmApply: true },
    });
    assert.equal(noKey.statusCode, 400, noKey.body);
    assert.equal(noKey.json().error.code, 'VALIDATION_FAILED');

    const unknownPreview = await harness.app.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.taskId}/delivery/apply`,
      payload: {
        requestKey: createRequestKey(),
        previewRef: 'pv_123456',
        previewRevision: 'rev-unknown',
        resolutions: [],
        confirmApply: true,
      },
    });
    assert.equal(unknownPreview.statusCode, 409, unknownPreview.body);
    assert.equal(unknownPreview.json().error.code, 'STALE_TARGET');

    const previewRes = await harness.app.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.taskId}/delivery/apply/preview`,
      payload: {},
    });
    const preview = previewRes.json().data.preview as { previewRef: string; revision: string };
    copyWrite(task, 'report/a.txt', 'task-a-changed');
    const driftRes = await harness.app.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.taskId}/delivery/apply`,
      payload: {
        requestKey: createRequestKey(),
        previewRef: preview.previewRef,
        previewRevision: preview.revision,
        resolutions: [],
        confirmApply: true,
      },
    });
    assert.equal(driftRes.statusCode, 409, driftRes.body);
    assert.equal(driftRes.json().error.code, 'STALE_TARGET');
    assert.equal(readFileSync(join(harness.sourceRoot, 'report/a.txt'), 'utf8'), 'base-a');

    const missingTask = await harness.app.app.inject({
      method: 'POST',
      url: '/api/tasks/task_missing/delivery/apply/preview',
      payload: {},
    });
    assert.equal(missingTask.statusCode, 404, missingTask.body);
    assert.equal(missingTask.json().error.code, 'NOT_FOUND');

    const noBaselineTask = createDirectoryTask(harness.app, harness.sourceRoot, { withBaseline: false });
    const capability = await harness.app.app.inject({
      method: 'POST',
      url: `/api/tasks/${noBaselineTask.taskId}/delivery/apply/preview`,
      payload: {},
    });
    assert.equal(capability.statusCode, 503, capability.body);
    assert.equal(capability.json().error.code, 'CAPABILITY_UNAVAILABLE');
  } finally {
    await harness.close();
  }
});

test('HTTP：非法预览请求体与路径逃逸被拒绝', async () => {
  const harness = await createHarness();
  try {
    const task = createDirectoryTask(harness.app, harness.sourceRoot);
    copyWrite(task, 'report/a.txt', 'task-a');

    const badBody = await harness.app.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.taskId}/delivery/apply/preview`,
      payload: { fileIds: 'not-an-array' },
    });
    assert.equal(badBody.statusCode, 400, badBody.body);
    assert.equal(badBody.json().error.code, 'VALIDATION_FAILED');

    const escape = await harness.app.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.taskId}/delivery/apply/preview`,
      payload: { fileIds: [encodeFileId('../../etc/passwd')] },
    });
    assert.equal(escape.statusCode, 400, escape.body);
    assert.equal(escape.json().error.code, 'PATH_ESCAPE');

    const badResolution = await harness.app.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.taskId}/delivery/apply/preview`,
      payload: { resolutions: [{ fileId: encodeFileId('report/a.txt'), resolution: 'merge' }] },
    });
    assert.equal(badResolution.statusCode, 400, badResolution.body);
    assert.equal(badResolution.json().error.code, 'VALIDATION_FAILED');
  } finally {
    await harness.close();
  }
});
