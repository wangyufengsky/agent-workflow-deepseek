import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DeliveryApplyRequest, DirectoryApplyPreview } from '@agent-workflow/shared';
import { AppError, ErrorCode, createRequestKey, nowIso } from '@agent-workflow/shared';
import { Store } from '@agent-workflow/storage';
import { CommandService } from './operations.ts';
import { DirectoryApplyService, encodeFileId, restoreBackupEntry } from './directory-apply.ts';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

interface Fixture {
  readonly store: Store;
  readonly service: DirectoryApplyService;
  readonly dataDir: string;
  readonly sourceRoot: string;
  readonly copyRoot: string;
  readonly baselineRoot: string;
  readonly workspaceId: string;
  readonly taskId: string;
  readonly projectId: string;
  close(): void;
}

interface FixtureOptions {
  readonly gitState?: 'git' | 'not_git';
  readonly withBaseline?: boolean;
}

function writeTreeFile(root: string, relativePath: string, content: string | Buffer): void {
  const target = join(root, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function createFixture(initial: Record<string, string | Buffer>, options: FixtureOptions = {}): Fixture {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-dir-apply-data-'));
  const sourceRoot = mkdtempSync(join(tmpdir(), 'aw-dir-apply-source-'));
  for (const [path, content] of Object.entries(initial)) writeTreeFile(sourceRoot, path, content);
  const store = new Store({ dataDir });
  const project = store.projects.create({ name: '月报项目', rootPath: sourceRoot, gitState: options.gitState ?? 'not_git' });
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
  const baselineRoot = join(dataDir, 'baselines', workspace.id);
  cpSync(sourceRoot, baselineRoot, { recursive: true });
  const copyRoot = join(dataDir, 'workspaces', task.id);
  cpSync(baselineRoot, copyRoot, { recursive: true });
  store.workspaces.update(workspace.id, { state: 'ready', displayRoot: copyRoot });
  store.tasks.update(task.id, { workspaceId: workspace.id });
  if (options.withBaseline !== false) {
    store.settings.putJson(`directory.baseline.${workspace.id}`, { baselineRoot, sourceRoot, createdAt: nowIso() });
  }
  return {
    store,
    service: new DirectoryApplyService(store, new CommandService(store)),
    dataDir,
    sourceRoot,
    copyRoot,
    baselineRoot,
    workspaceId: workspace.id,
    taskId: task.id,
    projectId: project.id,
    close() {
      store.close();
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(sourceRoot, { recursive: true, force: true });
    },
  };
}

function copyWrite(fx: Fixture, relativePath: string, content: string | Buffer): void {
  writeTreeFile(fx.copyRoot, relativePath, content);
}

function copyDelete(fx: Fixture, relativePath: string): void {
  rmSync(join(fx.copyRoot, relativePath), { recursive: true, force: true });
}

function sourceWrite(fx: Fixture, relativePath: string, content: string | Buffer): void {
  writeTreeFile(fx.sourceRoot, relativePath, content);
}

function sourceDelete(fx: Fixture, relativePath: string): void {
  rmSync(join(fx.sourceRoot, relativePath), { recursive: true, force: true });
}

function readSource(fx: Fixture, relativePath: string): string {
  return readFileSync(join(fx.sourceRoot, relativePath), 'utf8');
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function applyRequest(
  preview: DirectoryApplyPreview,
  resolutions: DeliveryApplyRequest['resolutions'] = [],
  requestKey: string = createRequestKey(),
): DeliveryApplyRequest {
  return {
    requestKey,
    previewRef: preview.previewRef,
    previewRevision: preview.revision,
    resolutions,
    confirmApply: true,
  };
}

function itemAt(preview: DirectoryApplyPreview, relativePath: string) {
  const item = preview.items.find((candidate) => candidate.path === relativePath);
  assert.ok(item, `缺少预览项 ${relativePath}`);
  return item;
}

async function rejectsWithCode(promise: Promise<unknown>, code: ErrorCodeValueLike): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof AppError, `期望 AppError，实际 ${String(error)}`);
    assert.equal(error.code, code);
    return error;
  }
  assert.fail(`期望抛出 ${code}`);
}

type ErrorCodeValueLike = (typeof ErrorCode)[keyof typeof ErrorCode];

/* ------------------------------------------------------------------ */
/* No-conflict apply                                                   */
/* ------------------------------------------------------------------ */

test('无冲突：逐项新增/替换/删除，备份原文件，交付与任务结算', async () => {
  const fx = createFixture({ 'report/a.txt': 'base-a', 'report/c.txt': 'base-c', 'keep.txt': 'same' });
  try {
    copyWrite(fx, 'report/a.txt', 'task-a');
    copyWrite(fx, 'report/b.txt', 'task-b');
    copyDelete(fx, 'report/c.txt');

    const preview = await fx.service.preview(fx.taskId, {
      fileIds: [encodeFileId('report/a.txt'), encodeFileId('report/b.txt'), encodeFileId('report/c.txt')],
    });
    assert.equal(preview.counts.applicable, 3);
    assert.equal(preview.counts.conflict, 0);
    assert.equal(preview.counts.unresolved, 0);
    assert.equal(itemAt(preview, 'report/a.txt').change, 'M');
    assert.equal(itemAt(preview, 'report/a.txt').plannedEffect, 'replace');
    assert.equal(itemAt(preview, 'report/b.txt').change, 'A');
    assert.equal(itemAt(preview, 'report/b.txt').plannedEffect, 'add');
    assert.equal(itemAt(preview, 'report/c.txt').change, 'D');
    assert.equal(itemAt(preview, 'report/c.txt').plannedEffect, 'delete');
    assert.equal(preview.actions.apply?.allowed, true);

    const request = applyRequest(preview);
    const response = await fx.service.apply(fx.taskId, request);
    assert.equal(response.receipt.status, 'succeeded');
    const result = response.resource!.result;
    assert.equal(result.applied, 3);
    assert.equal(result.blocked, 0);
    assert.equal(result.unknown, 0);
    assert.equal(result.notExecuted, 0);

    assert.equal(readSource(fx, 'report/a.txt'), 'task-a');
    assert.equal(readSource(fx, 'report/b.txt'), 'task-b');
    assert.equal(existsSync(join(fx.sourceRoot, 'report/c.txt')), false);
    assert.equal(readSource(fx, 'keep.txt'), 'same');

    const backupA = result.backups.find((backup) => backup.path === 'report/a.txt');
    assert.ok(backupA?.backupPath);
    assert.equal(readFileSync(backupA.backupPath, 'utf8'), 'base-a');
    assert.equal(backupA.sha256, sha256('base-a'));
    const backupC = result.backups.find((backup) => backup.path === 'report/c.txt');
    assert.ok(backupC?.backupPath);
    assert.equal(readFileSync(backupC.backupPath, 'utf8'), 'base-c');
    const backupB = result.backups.find((backup) => backup.path === 'report/b.txt');
    assert.equal(backupB?.originalExisted, false);

    const delivery = fx.store.deliveries.byTask(fx.taskId)!;
    assert.equal(delivery.projection, 'delivered');
    assert.equal(delivery.applyPreview?.previewRef, preview.previewRef);
    assert.equal(delivery.steps.find((step) => step.step === 'apply')?.state, 'succeeded');
    assert.equal(fx.store.tasks.get(fx.taskId)!.lifecycle, 'completed');

    // Same request key replays the receipt without writing again.
    const replay = await fx.service.apply(fx.taskId, request);
    assert.equal(replay.receipt.status, 'succeeded');
    assert.equal(replay.receipt.requestKey, request.requestKey);
    assert.equal(readSource(fx, 'report/a.txt'), 'task-a');

    // Backup evidence can restore the original bytes (rollback primitive).
    await restoreBackupEntry({ backupRoot: result.backupRoot!, targetRoot: fx.sourceRoot, entry: backupA });
    assert.equal(readSource(fx, 'report/a.txt'), 'base-a');
    const addedEntry = result.backups.find((backup) => backup.path === 'report/b.txt')!;
    await restoreBackupEntry({ backupRoot: result.backupRoot!, targetRoot: fx.sourceRoot, entry: addedEntry });
    assert.equal(existsSync(join(fx.sourceRoot, 'report/b.txt')), false);
  } finally {
    fx.close();
  }
});

/* ------------------------------------------------------------------ */
/* Conflicts                                                           */
/* ------------------------------------------------------------------ */

test('冲突：五类冲突逐项分类，未处理时拒绝应用，处理后逐项结算', async () => {
  const fx = createFixture({
    'both.txt': 'base-both',
    'delete.txt': 'base-delete',
    'modified.txt': 'base-mod',
    'type.txt': 'base-type',
  });
  try {
    copyWrite(fx, 'both.txt', 'task-both');
    copyWrite(fx, 'added.txt', 'task-added');
    copyDelete(fx, 'delete.txt');
    copyWrite(fx, 'modified.txt', 'task-mod');
    copyDelete(fx, 'type.txt');
    mkdirSync(join(fx.copyRoot, 'type.txt'), { recursive: true });
    copyWrite(fx, 'type.txt/inner.txt', 'task-inner');

    sourceWrite(fx, 'both.txt', 'user-both');
    sourceWrite(fx, 'added.txt', 'user-added');
    sourceWrite(fx, 'delete.txt', 'user-delete');
    sourceDelete(fx, 'modified.txt');

    const preview = await fx.service.preview(fx.taskId);
    assert.equal(preview.counts.conflict, 5);
    assert.equal(preview.counts.unsupported, 0);
    assert.equal(preview.counts.unresolved, 5);
    assert.equal(itemAt(preview, 'both.txt').conflictType, 'both_modified');
    assert.equal(itemAt(preview, 'added.txt').conflictType, 'add_add');
    assert.equal(itemAt(preview, 'delete.txt').conflictType, 'delete_vs_modified');
    assert.equal(itemAt(preview, 'modified.txt').conflictType, 'modified_vs_deleted');
    assert.equal(itemAt(preview, 'type.txt').conflictType, 'type_conflict');
    assert.equal(preview.actions.apply?.allowed, false);

    await rejectsWithCode(fx.service.apply(fx.taskId, applyRequest(preview)), ErrorCode.DELIVERY_BLOCKED);
    await rejectsWithCode(
      fx.service.preview(fx.taskId, { resolutions: [{ fileId: encodeFileId('type.txt'), resolution: 'take_task' }] }),
      ErrorCode.VALIDATION_FAILED,
    );

    const resolutions: DeliveryApplyRequest['resolutions'] = [
      { fileId: encodeFileId('both.txt'), resolution: 'take_task' },
      { fileId: encodeFileId('added.txt'), resolution: 'keep_original' },
      { fileId: encodeFileId('delete.txt'), resolution: 'exclude' },
      { fileId: encodeFileId('modified.txt'), resolution: 'keep_original' },
      { fileId: encodeFileId('type.txt'), resolution: 'keep_original' },
    ];
    const frozen = await fx.service.preview(fx.taskId, { resolutions });
    assert.equal(frozen.counts.unresolved, 0);
    assert.equal(itemAt(frozen, 'both.txt').resolution, 'take_task');
    assert.equal(frozen.actions.apply?.allowed, true);

    const response = await fx.service.apply(fx.taskId, applyRequest(frozen, resolutions));
    assert.equal(response.receipt.status, 'succeeded');
    const result = response.resource!.result;
    assert.equal(result.applied, 1);
    assert.equal(result.notExecuted, 4);
    assert.equal(result.blocked, 0);
    assert.deepEqual(
      result.items.filter((item) => item.path === 'both.txt').map((item) => item.result),
      ['applied'],
    );

    assert.equal(readSource(fx, 'both.txt'), 'task-both');
    assert.equal(readSource(fx, 'added.txt'), 'user-added');
    assert.equal(readSource(fx, 'delete.txt'), 'user-delete');
    assert.equal(existsSync(join(fx.sourceRoot, 'modified.txt')), false);
    assert.equal(readSource(fx, 'type.txt'), 'base-type');
    assert.equal(response.resource!.delivery.projection, 'delivered');
  } finally {
    fx.close();
  }
});

test('全部保留/排除：没有任何写入时投影为 blocked', async () => {
  const fx = createFixture({ 'a.txt': 'base-a' });
  try {
    copyWrite(fx, 'a.txt', 'task-a');
    const resolutions: DeliveryApplyRequest['resolutions'] = [{ fileId: encodeFileId('a.txt'), resolution: 'exclude' }];
    const frozen = await fx.service.preview(fx.taskId, { resolutions });
    const response = await fx.service.apply(fx.taskId, applyRequest(frozen, resolutions));
    assert.equal(response.resource!.result.applied, 0);
    assert.equal(response.resource!.result.notExecuted, 1);
    assert.equal(response.resource!.delivery.projection, 'blocked');
    assert.equal(readSource(fx, 'a.txt'), 'base-a');
    assert.equal(fx.store.tasks.get(fx.taskId)!.lifecycle, 'active');
  } finally {
    fx.close();
  }
});

test('冲突：task 版本删除/重建在采用任务版本后如实执行', async () => {
  const fx = createFixture({ 'delete.txt': 'base-delete', 'restore.txt': 'base-restore' });
  try {
    copyDelete(fx, 'delete.txt');
    copyWrite(fx, 'restore.txt', 'task-restore');
    sourceWrite(fx, 'delete.txt', 'user-delete');
    sourceDelete(fx, 'restore.txt');

    const preview = await fx.service.preview(fx.taskId);
    assert.equal(itemAt(preview, 'delete.txt').conflictType, 'delete_vs_modified');
    assert.equal(itemAt(preview, 'restore.txt').conflictType, 'modified_vs_deleted');
    const resolutions: DeliveryApplyRequest['resolutions'] = [
      { fileId: encodeFileId('delete.txt'), resolution: 'take_task' },
      { fileId: encodeFileId('restore.txt'), resolution: 'take_task' },
    ];
    const frozen = await fx.service.preview(fx.taskId, { resolutions });
    const response = await fx.service.apply(fx.taskId, applyRequest(frozen, resolutions));
    assert.equal(response.resource!.result.applied, 2);
    assert.equal(existsSync(join(fx.sourceRoot, 'delete.txt')), false);
    assert.equal(readSource(fx, 'restore.txt'), 'task-restore');
    const backedUp = response.resource!.result.backups.find((backup) => backup.path === 'delete.txt');
    assert.equal(readFileSync(backedUp!.backupPath!, 'utf8'), 'user-delete');
    assert.equal(response.resource!.delivery.projection, 'delivered');
  } finally {
    fx.close();
  }
});

/* ------------------------------------------------------------------ */
/* Manual resolution                                                   */
/* ------------------------------------------------------------------ */

test('手动处理：必须重新检查，冲突消失后按任务版本结算', async () => {
  const fx = createFixture({ 'both.txt': 'base-both' });
  try {
    copyWrite(fx, 'both.txt', 'task-both');
    sourceWrite(fx, 'both.txt', 'user-both');
    const fileId = encodeFileId('both.txt');
    const first = await fx.service.preview(fx.taskId);
    assert.equal(itemAt(first, 'both.txt').conflictType, 'both_modified');

    await rejectsWithCode(
      fx.service.apply(fx.taskId, applyRequest(first, [{ fileId, resolution: 'manual_then_recheck' }])),
      ErrorCode.VALIDATION_FAILED,
    );

    const manual = await fx.service.preview(fx.taskId, { resolutions: [{ fileId, resolution: 'manual_then_recheck' }] });
    assert.equal(itemAt(manual, 'both.txt').check, 'conflict');
    assert.equal(itemAt(manual, 'both.txt').resolution, undefined);
    assert.equal(manual.counts.unresolved, 1);

    // The user resolves the file manually so the original matches the task version.
    sourceWrite(fx, 'both.txt', 'task-both');
    const rechecked = await fx.service.preview(fx.taskId, { resolutions: [{ fileId, resolution: 'manual_then_recheck' }] });
    assert.equal(itemAt(rechecked, 'both.txt').check, 'applicable');
    assert.equal(rechecked.counts.unresolved, 0);
    assert.equal(rechecked.actions.apply?.allowed, true);

    const response = await fx.service.apply(fx.taskId, applyRequest(rechecked));
    assert.equal(response.receipt.status, 'succeeded');
    assert.equal(response.resource!.result.applied, 1);
    assert.equal(response.resource!.delivery.projection, 'delivered');
    assert.equal(readSource(fx, 'both.txt'), 'task-both');
  } finally {
    fx.close();
  }
});

/* ------------------------------------------------------------------ */
/* Drift / stale previews                                              */
/* ------------------------------------------------------------------ */

test('漂移：副本或原目录在预览后变化时返回 STALE_TARGET 且不写入', async () => {
  const fx = createFixture({ 'a.txt': 'base-a' });
  try {
    copyWrite(fx, 'a.txt', 'task-a');
    const preview = await fx.service.preview(fx.taskId);

    copyWrite(fx, 'a.txt', 'task-a-v2');
    await rejectsWithCode(fx.service.apply(fx.taskId, applyRequest(preview)), ErrorCode.STALE_TARGET);
    assert.equal(readSource(fx, 'a.txt'), 'base-a');

    const preview2 = await fx.service.preview(fx.taskId);
    sourceWrite(fx, 'a.txt', 'user-a');
    await rejectsWithCode(fx.service.apply(fx.taskId, applyRequest(preview2)), ErrorCode.STALE_TARGET);
    assert.equal(readSource(fx, 'a.txt'), 'user-a');
  } finally {
    fx.close();
  }
});

test('漂移：过期预览与更新的预览都不能再确认', async () => {
  const fx = createFixture({ 'a.txt': 'base-a' });
  try {
    copyWrite(fx, 'a.txt', 'task-a');
    const expired = await fx.service.preview(fx.taskId);
    const stored = fx.store.settings.getJson<Record<string, unknown>>(`directory.apply.preview.${expired.previewRef}`)!;
    fx.store.settings.putJson(`directory.apply.preview.${expired.previewRef}`, {
      ...stored,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    await rejectsWithCode(fx.service.apply(fx.taskId, applyRequest(expired)), ErrorCode.STALE_TARGET);
    assert.equal(readSource(fx, 'a.txt'), 'base-a');

    const previous = await fx.service.preview(fx.taskId);
    const newest = await fx.service.preview(fx.taskId);
    await rejectsWithCode(fx.service.apply(fx.taskId, applyRequest(previous)), ErrorCode.STALE_TARGET);
    assert.equal(readSource(fx, 'a.txt'), 'base-a');

    const response = await fx.service.apply(fx.taskId, applyRequest(newest));
    assert.equal(response.receipt.status, 'succeeded');
    assert.equal(readSource(fx, 'a.txt'), 'task-a');
  } finally {
    fx.close();
  }
});

test('漂移：请求版本与冻结预览不一致时返回 STALE_TARGET', async () => {
  const fx = createFixture({ 'a.txt': 'base-a' });
  try {
    copyWrite(fx, 'a.txt', 'task-a');
    const preview = await fx.service.preview(fx.taskId);
    const request = { ...applyRequest(preview), previewRevision: 'rev_tampered' };
    await rejectsWithCode(fx.service.apply(fx.taskId, request), ErrorCode.STALE_TARGET);
    assert.equal(readSource(fx, 'a.txt'), 'base-a');
  } finally {
    fx.close();
  }
});

/* ------------------------------------------------------------------ */
/* Path safety                                                         */
/* ------------------------------------------------------------------ */

test('路径安全：绝对路径、..、符号链接逃逸全部拒绝', async () => {
  const fx = createFixture({ 'ok.txt': 'ok' });
  const outsideRoot = mkdtempSync(join(tmpdir(), 'aw-dir-apply-outside-'));
  try {
    await rejectsWithCode(
      fx.service.preview(fx.taskId, { fileIds: [encodeFileId('../escape.txt')] }),
      ErrorCode.PATH_ESCAPE,
    );
    await rejectsWithCode(
      fx.service.preview(fx.taskId, { fileIds: [encodeFileId('/etc/passwd')] }),
      ErrorCode.PATH_ESCAPE,
    );

    // The task copy adds a file under a directory that is a symlink in the original project.
    mkdirSync(join(fx.copyRoot, 'linked'), { recursive: true });
    copyWrite(fx, 'linked/evil.txt', 'evil');
    symlinkSync(outsideRoot, join(fx.sourceRoot, 'linked'));
    const preview = await fx.service.preview(fx.taskId);
    const item = itemAt(preview, 'linked/evil.txt');
    assert.equal(item.check, 'applicable');

    const response = await fx.service.apply(fx.taskId, applyRequest(preview));
    const applied = response.resource!.result.items.find((entry) => entry.path === 'linked/evil.txt');
    assert.equal(applied?.result, 'blocked');
    assert.match(applied?.detail ?? '', /符号链接/);
    assert.equal(existsSync(join(outsideRoot, 'evil.txt')), false);

    // A symlink at the changed path itself is unsupported and cannot take_task.
    const fx2 = createFixture({ 'link.txt': 'base-link' });
    try {
      copyWrite(fx2, 'link.txt', 'task-link');
      rmSync(join(fx2.sourceRoot, 'link.txt'));
      symlinkSync(join(outsideRoot, 'target.txt'), join(fx2.sourceRoot, 'link.txt'));
      const symlinkPreview = await fx2.service.preview(fx2.taskId);
      const symlinkItem = itemAt(symlinkPreview, 'link.txt');
      assert.equal(symlinkItem.check, 'unsupported');
      assert.equal(symlinkItem.conflictType, 'unsupported_binary_or_link');
      await rejectsWithCode(
        fx2.service.preview(fx2.taskId, {
          resolutions: [{ fileId: encodeFileId('link.txt'), resolution: 'take_task' }],
        }),
        ErrorCode.VALIDATION_FAILED,
      );
    } finally {
      fx2.close();
    }
  } finally {
    rmSync(outsideRoot, { recursive: true, force: true });
    fx.close();
  }
});

/* ------------------------------------------------------------------ */
/* Binary / large files                                                */
/* ------------------------------------------------------------------ */

test('二进制与超大文件标记 unsupported，二进制只能保留或整文件采用', async () => {
  const fx = createFixture({ 'logo.bin': Buffer.from('old-bytes') });
  try {
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0xff]);
    copyWrite(fx, 'logo.bin', binary);
    const large = Buffer.alloc(1024 * 1024 + 16, 'a');
    copyWrite(fx, 'large.txt', large);

    const preview = await fx.service.preview(fx.taskId);
    assert.equal(itemAt(preview, 'logo.bin').check, 'unsupported');
    assert.equal(itemAt(preview, 'logo.bin').conflictType, 'unsupported_binary_or_link');
    assert.match(itemAt(preview, 'logo.bin').detail ?? '', /二进制/);
    assert.equal(itemAt(preview, 'large.txt').check, 'unsupported');
    assert.match(itemAt(preview, 'large.txt').detail ?? '', /1 MB/);

    const resolutions: DeliveryApplyRequest['resolutions'] = [
      { fileId: encodeFileId('logo.bin'), resolution: 'take_task' },
      { fileId: encodeFileId('large.txt'), resolution: 'exclude' },
    ];
    const frozen = await fx.service.preview(fx.taskId, { resolutions });
    assert.equal(frozen.counts.unresolved, 0);
    const response = await fx.service.apply(fx.taskId, applyRequest(frozen, resolutions));
    assert.equal(response.receipt.status, 'succeeded');
    assert.deepEqual(readFileSync(join(fx.sourceRoot, 'logo.bin')), binary);
    assert.equal(existsSync(join(fx.sourceRoot, 'large.txt')), false);
    assert.equal(response.resource!.result.applied, 1);
    assert.equal(response.resource!.result.notExecuted, 1);
  } finally {
    fx.close();
  }
});

/* ------------------------------------------------------------------ */
/* Missing capability / Git project                                    */
/* ------------------------------------------------------------------ */

test('缺少基线快照或 Git 项目：返回 CAPABILITY_UNAVAILABLE，不猜测', async () => {
  const noBaseline = createFixture({ 'a.txt': 'a' }, { withBaseline: false });
  try {
    await rejectsWithCode(noBaseline.service.preview(noBaseline.taskId), ErrorCode.CAPABILITY_UNAVAILABLE);
  } finally {
    noBaseline.close();
  }

  const gitProject = createFixture({ 'a.txt': 'a' }, { gitState: 'git' });
  try {
    await rejectsWithCode(gitProject.service.preview(gitProject.taskId), ErrorCode.CAPABILITY_UNAVAILABLE);
  } finally {
    gitProject.close();
  }
});

/* ------------------------------------------------------------------ */
/* Selection scope                                                     */
/* ------------------------------------------------------------------ */

test('未选中的变更留在独立副本，不会被写入原目录', async () => {
  const fx = createFixture({ 'a.txt': 'base-a', 'b.txt': 'base-b' });
  try {
    copyWrite(fx, 'a.txt', 'task-a');
    copyWrite(fx, 'b.txt', 'task-b');
    const preview = await fx.service.preview(fx.taskId, { fileIds: [encodeFileId('a.txt')] });
    assert.equal(preview.items.length, 1);
    assert.match(preview.untouchedSummary, /未选中的 1 个变更留在独立副本/);

    const response = await fx.service.apply(fx.taskId, applyRequest(preview));
    assert.equal(response.receipt.status, 'succeeded');
    assert.equal(readSource(fx, 'a.txt'), 'task-a');
    assert.equal(readSource(fx, 'b.txt'), 'base-b');
  } finally {
    fx.close();
  }
});

test('未知文件引用与重复/未冻结处理选择被拒绝', async () => {
  const fx = createFixture({ 'a.txt': 'base-a' });
  try {
    copyWrite(fx, 'a.txt', 'task-a');
    await rejectsWithCode(
      fx.service.preview(fx.taskId, { fileIds: [encodeFileId('missing.txt')] }),
      ErrorCode.VALIDATION_FAILED,
    );
    const preview = await fx.service.preview(fx.taskId);
    const request: DeliveryApplyRequest = {
      ...applyRequest(preview),
      resolutions: [{ fileId: encodeFileId('a.txt'), resolution: 'exclude' }],
    };
    // The file is applicable and had no frozen resolution, so changing the choice requires a re-preview.
    await rejectsWithCode(fx.service.apply(fx.taskId, request), ErrorCode.VALIDATION_FAILED);
    assert.equal(readSource(fx, 'a.txt'), 'base-a');
  } finally {
    fx.close();
  }
});
