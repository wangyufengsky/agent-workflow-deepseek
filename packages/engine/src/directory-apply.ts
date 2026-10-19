import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import fs from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import type {
  ApplyPreviewItem,
  ChangeStatusValue,
  CommandResponse,
  ConflictResolutionValue,
  ConflictTypeValue,
  DeliveryApplyRequest,
  DirectoryApplyPreview,
  Project,
  Task,
  TaskDelivery,
  TaskWorkspace,
} from '@agent-workflow/shared';
import {
  AppError,
  ConflictResolution,
  ConflictType,
  ErrorCode,
  TaskAttention,
  TaskLifecycle,
  createId,
  nowIso,
} from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';
import type { CommandService } from './operations.ts';
import { stableHash } from './operations.ts';
import { decodeFileId, encodeFileId } from './workspace.ts';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const PREVIEW_TTL_MS = 10 * 60_000;
const MAX_SUPPORTED_BYTES = 1024 * 1024;
const MAX_HASHED_BYTES = 8 * 1024 * 1024;
const MAX_SCAN_ENTRIES = 20_000;
const BINARY_PROBE_BYTES = 8 * 1024;
const BACKUP_ROOT_SEGMENT = 'backups';
const BASELINE_KEY_PREFIX = 'directory.baseline.';
const PREVIEW_KEY_PREFIX = 'directory.apply.preview.';
const LATEST_PREVIEW_KEY_PREFIX = 'directory.apply.latest.';
const PREVIEW_REF_PATTERN = /^pv_[a-z0-9]{6,}$/;

/** Directories never copied by the workspace preparation adapter, hence never compared. */
const EXCLUDED_DIRECTORY_NAMES = new Set(['.git', 'node_modules', '.data', 'dist', '.build', '.tmp', '.agent-workflow']);

/* ------------------------------------------------------------------ */
/* Public types                                                        */
/* ------------------------------------------------------------------ */

export interface DirectoryApplyPreviewOptions {
  readonly fileIds?: readonly string[];
  readonly resolutions?: readonly { readonly fileId: string; readonly resolution: ConflictResolutionValue }[];
}

export type DirectoryApplyItemResultValue = 'applied' | 'blocked' | 'unknown' | 'not_executed';

export interface DirectoryApplyBackupEvidence {
  readonly path: string;
  readonly originalExisted: boolean;
  readonly backupPath?: string;
  readonly sha256?: string;
  readonly sizeBytes?: number;
  readonly backedUpAt?: string;
}

export interface DirectoryApplyItemResult {
  readonly fileId: string;
  readonly path: string;
  readonly change: ChangeStatusValue;
  readonly result: DirectoryApplyItemResultValue;
  readonly resolution?: ConflictResolutionValue;
  readonly detail?: string;
  readonly backup?: DirectoryApplyBackupEvidence;
}

export interface DirectoryApplySummary {
  readonly previewRef: string;
  readonly revision: string;
  readonly completedAt: string;
  readonly applied: number;
  readonly blocked: number;
  readonly unknown: number;
  readonly notExecuted: number;
  readonly items: readonly DirectoryApplyItemResult[];
  readonly backups: readonly DirectoryApplyBackupEvidence[];
  readonly backupRoot?: string;
  readonly rolledBack: boolean;
}

export interface DirectoryApplyResource {
  readonly delivery: TaskDelivery;
  readonly preview: DirectoryApplyPreview;
  readonly result: DirectoryApplySummary;
}

/* ------------------------------------------------------------------ */
/* Internal snapshot model                                             */
/* ------------------------------------------------------------------ */

type TaskChangeKind = 'added' | 'modified' | 'deleted' | 'type_changed';

interface AbsentState {
  readonly kind: 'absent';
}

interface FileState {
  readonly kind: 'file';
  readonly size: number;
  readonly sha256: string;
  readonly mode: number;
  readonly binary: boolean;
  readonly tooLarge: boolean;
}

interface DirState {
  readonly kind: 'dir';
}

interface SymlinkState {
  readonly kind: 'symlink';
  readonly target: string;
}

interface SpecialState {
  readonly kind: 'special';
  readonly detail: string;
}

interface UnreadableState {
  readonly kind: 'unreadable';
  readonly detail: string;
}

type NodeState = AbsentState | FileState | DirState | SymlinkState | SpecialState | UnreadableState;

interface TreeSnapshot {
  readonly root: string;
  readonly realRoot: string;
  readonly states: ReadonlyMap<string, NodeState>;
  readonly excluded: readonly string[];
}

interface ClassifiedItem {
  readonly change: ChangeStatusValue;
  readonly check: 'applicable' | 'conflict' | 'unsupported';
  readonly conflictType?: ConflictTypeValue;
  readonly plannedEffect: 'add' | 'replace' | 'delete';
  readonly detail?: string;
  readonly unsupportedKind?: 'binary' | 'too_large' | 'symlink' | 'special' | 'unreadable';
  readonly canTakeTask: boolean;
}

interface InternalApplyItem extends ApplyPreviewItem {
  readonly taskChange: TaskChangeKind;
  readonly baselineState: NodeState;
  readonly copyState: NodeState;
  readonly originalState: NodeState;
  readonly unsupportedKind?: 'binary' | 'too_large' | 'symlink' | 'special' | 'unreadable';
  readonly canTakeTask: boolean;
}

interface StoredApplyPreview {
  readonly previewRef: string;
  readonly taskId: string;
  readonly workspaceId: string;
  readonly revision: string;
  readonly checkedAt: string;
  readonly expiresAt: string;
  readonly sourceRoot: string;
  readonly copyRoot: string;
  readonly baselineRoot: string;
  readonly baselineCreatedAt?: string;
  readonly fileIds: readonly string[];
  readonly items: readonly InternalApplyItem[];
  readonly counts: DirectoryApplyPreview['counts'];
  readonly untouchedSummary: string;
  readonly actions: DirectoryApplyPreview['actions'];
}

interface BaselineRecord {
  readonly baselineRoot: string;
  readonly sourceRoot: string;
  readonly createdAt?: string;
}

interface DirectoryApplyContext {
  readonly task: Task;
  readonly project: Project;
  readonly workspace: TaskWorkspace;
  readonly sourceRoot: string;
  readonly sourceReal: string;
  readonly copyRoot: string;
  readonly copyReal: string;
  readonly baselineRoot: string;
  readonly baselineReal: string;
  readonly baselineCreatedAt?: string;
}

const ABSENT_STATE: AbsentState = { kind: 'absent' };

/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */

/**
 * Three-way compare and item-by-item apply for non-Git tasks (TD05).
 *
 * The service is the only authority: the original directory is never touched
 * while reading; every write is backed up first, atomic, and reported per item.
 * Nothing is merged automatically and Git is never initialized or committed.
 */
export class DirectoryApplyService {
  readonly #store: Store;
  readonly #commands: CommandService;

  constructor(store: Store, commands: CommandService) {
    this.#store = store;
    this.#commands = commands;
  }

  async preview(taskId: string, options: DirectoryApplyPreviewOptions = {}): Promise<DirectoryApplyPreview> {
    const context = await this.#requireContext(taskId);
    const stored = await this.#buildPreview(context, options);
    this.#persistPreview(context, stored);
    return toPublicPreview(stored);
  }

  async apply(taskId: string, request: DeliveryApplyRequest): Promise<CommandResponse<DirectoryApplyResource>> {
    validateApplyRequest(request);
    const originalReceipt = this.#commands.replay({ requestKey: request.requestKey, operation: 'task.delivery.apply', body: { taskId, previewRef: request.previewRef, previewRevision: request.previewRevision, resolutions: request.resolutions, confirmApply: true } }, (record) => {
      const delivery = this.#deliveryFor(taskId);
      const stored = this.#store.settings.getJson<StoredApplyPreview>(previewKey(request.previewRef));
      return delivery === undefined || stored === undefined || stored.taskId !== taskId || !Array.isArray(stored.items) ? undefined : { delivery, preview: toPublicPreview(stored), result: summaryFromRecord(record.outcome) };
    });
    if (originalReceipt !== undefined) return originalReceipt;
    const context = await this.#requireContext(taskId);
    const stored = this.#loadStoredPreview(taskId, request.previewRef);
    if (stored.revision !== request.previewRevision) {
      throw new AppError(ErrorCode.STALE_TARGET, '预览版本已变化，请重新检查并冻结预览', {
        details: { expected: stored.revision, actual: request.previewRevision },
      });
    }
    if (Date.parse(stored.expiresAt) <= Date.now()) {
      throw new AppError(ErrorCode.STALE_TARGET, '预览已过期，请重新检查并冻结预览', { details: { expiresAt: stored.expiresAt } });
    }
    const latest = this.#store.settings.getJson<{ readonly previewRef?: string }>(latestPreviewKey(taskId));
    if (latest !== undefined && latest !== null && latest.previewRef !== undefined && latest.previewRef !== stored.previewRef) {
      throw new AppError(ErrorCode.STALE_TARGET, '已有更新的预览，请使用最新预览', {
        details: { latestPreviewRef: latest.previewRef },
      });
    }
    const delivery = this.#ensureDelivery(context);
    if (delivery.applyPreview !== undefined && delivery.applyPreview.previewRef !== stored.previewRef) {
      throw new AppError(ErrorCode.STALE_TARGET, '交付面板中的预览已更新，请使用最新预览', {
        details: { latestPreviewRef: delivery.applyPreview.previewRef },
      });
    }
    const frozenResolutions = this.#validateFrozenResolutions(stored, request.resolutions);
    const unresolved = stored.items.filter((item) => needsResolution(item) && frozenResolutions.get(item.fileId) === undefined);
    if (unresolved.length > 0) {
      throw new AppError(ErrorCode.DELIVERY_BLOCKED, `还有 ${unresolved.length} 个冲突没有处理`, {
        details: { unresolved: unresolved.map((item) => item.path) },
      });
    }

    const { record, replayed } = this.#commands.begin({
      requestKey: request.requestKey,
      operation: 'task.delivery.apply',
      body: {
        taskId,
        previewRef: request.previewRef,
        previewRevision: request.previewRevision,
        resolutions: request.resolutions,
        confirmApply: true,
      },
      target: { taskId, ref: request.previewRef },
      resultResource: { kind: 'delivery', id: delivery.id },
    });
    if (replayed) {
      return {
        receipt: this.#commands.toReceipt(record),
        resource: { delivery: this.#deliveryFor(taskId) ?? delivery, preview: toPublicPreview(stored), result: summaryFromRecord(record.outcome) },
      };
    }

    try {
      // Re-check the frozen preview against current disk state before any write.
      const refreshed = await this.#buildPreview(context, {
        fileIds: stored.fileIds,
        resolutions: frozenResolutionList(stored),
      });
      if (refreshed.revision !== stored.revision) {
        throw new AppError(ErrorCode.STALE_TARGET, '原目录或任务副本在预览后发生变化，请重新检查并冻结预览', {
          details: { expected: stored.revision, actual: refreshed.revision },
        });
      }

      const inProgress = this.#store.deliveries.update(delivery.id, {
        goal: 'apply_to_original',
        projection: 'in_progress',
        projectionReason: '正在把所选变更应用到原目录',
        steps: upsertDeliveryStep(delivery.steps, {
          step: 'apply',
          state: 'in_progress',
          requestKey: request.requestKey,
        }),
      });
      if (inProgress !== undefined) {
        this.#store.events.publish('task.delivery.updated', {
          taskId,
          deliveryId: inProgress.id,
          revision: inProgress.revision,
          projection: inProgress.projection,
        });
      }

      const backupRoot = resolve(this.#store.dataDir, BACKUP_ROOT_SEGMENT, stored.previewRef);
      await requireInsideDataDir(this.#store.dataDir, backupRoot);
      const results: DirectoryApplyItemResult[] = [];
      const backups: DirectoryApplyBackupEvidence[] = [];
      const written: { readonly item: InternalApplyItem; readonly backup: DirectoryApplyBackupEvidence }[] = [];

      try {
        for (const item of stored.items) {
          const resolution = frozenResolutions.get(item.fileId);
          if (resolution === ConflictResolution.KEEP_ORIGINAL || resolution === ConflictResolution.EXCLUDE) {
            results.push({
              fileId: item.fileId,
              path: item.path,
              change: item.change,
              result: 'not_executed',
              resolution,
              detail: resolution === ConflictResolution.KEEP_ORIGINAL ? '保留当前原文件，未写入' : '按选择暂不交付该项，文件留在独立副本',
            });
            continue;
          }
          const outcome = await this.#applyItem(context, item, resolution, backupRoot);
          results.push(outcome.result);
          if (outcome.backup !== undefined) backups.push(outcome.backup);
          if (outcome.result.result === 'applied') written.push({ item, backup: outcome.backup ?? { path: item.path, originalExisted: false } });
        }
      } catch (error) {
        const rolledBack = await this.#rollback(context, backupRoot, written);
        await this.#markDeliveryFailed(taskId, delivery, request.requestKey, error).catch(() => undefined);
        throw new AppError(
          error instanceof AppError ? error.code : ErrorCode.INTERNAL_ERROR,
          error instanceof Error ? error.message : '应用过程中发生未知错误',
          { details: { rolledBack: rolledBack.restored, rollbackFailed: rolledBack.failed } },
        );
      }

      const summary: DirectoryApplySummary = {
        previewRef: stored.previewRef,
        revision: stored.revision,
        completedAt: nowIso(),
        applied: results.filter((result) => result.result === 'applied').length,
        blocked: results.filter((result) => result.result === 'blocked').length,
        unknown: results.filter((result) => result.result === 'unknown').length,
        notExecuted: results.filter((result) => result.result === 'not_executed').length,
        items: results,
        backups,
        backupRoot: results.some((result) => result.backup !== undefined) ? backupRoot : undefined,
        rolledBack: false,
      };
      const projection = projectionFor(summary);
      const projectionReason = projectionReasonFor(projection, summary);
      const settled = this.#store.deliveries.update(delivery.id, {
        goal: 'apply_to_original',
        projection,
        projectionReason,
        steps: upsertDeliveryStep(delivery.steps, {
          step: 'apply',
          state: projection === 'delivered' ? 'succeeded' : projection === 'unknown_receipt' ? 'unknown' : 'blocked',
          requestKey: request.requestKey,
          settledAt: summary.completedAt,
          items: results.map((result) => ({ fileId: result.fileId, result: result.result })),
          ...(projection === 'delivered'
            ? {}
            : {
                error: {
                  code: projection === 'unknown_receipt' ? ErrorCode.RECEIPT_UNKNOWN : ErrorCode.DELIVERY_BLOCKED,
                  message: projectionReason,
                },
              }),
        }),
        applyPreview: toPublicPreview(stored),
        ...(projection === 'delivered' ? { taskCompletionRef: `directory-apply:${stored.previewRef}` } : {}),
      });
      this.#store.tasks.update(taskId, {
        attention: projection === 'delivered' ? TaskAttention.NONE : projection === 'unknown_receipt' ? TaskAttention.UNKNOWN : TaskAttention.BLOCKED,
        ...(projection === 'delivered' ? { lifecycle: TaskLifecycle.COMPLETED } : {}),
      });
      const updatedDelivery = settled ?? this.#store.deliveries.get(delivery.id)!;
      this.#store.events.publish('task.delivery.updated', {
        taskId,
        deliveryId: updatedDelivery.id,
        revision: updatedDelivery.revision,
        projection: updatedDelivery.projection,
      });
      this.#store.events.publish('task.changed', {
        taskId,
        projectId: context.project.id,
        stage: context.task.stage,
        revision: 1,
      });
      this.#commands.settle(request.requestKey, {
        previewRef: stored.previewRef,
        revision: stored.revision,
        projection,
        completedAt: summary.completedAt,
        applied: summary.applied,
        blocked: summary.blocked,
        unknown: summary.unknown,
        notExecuted: summary.notExecuted,
        backupRoot: summary.backupRoot,
        backups: summary.backups,
        items: results.map((result) => ({
          fileId: result.fileId,
          path: result.path,
          change: result.change,
          result: result.result,
          ...(result.resolution === undefined ? {} : { resolution: result.resolution }),
          ...(result.detail === undefined ? {} : { detail: result.detail }),
        })),
      });
      return {
        receipt: this.#commands.toReceipt(this.#commands.get(request.requestKey)!),
        resource: { delivery: updatedDelivery, preview: toPublicPreview(stored), result: summary },
      };
    } catch (error) {
      this.#commands.fail(request.requestKey, error as Error);
      throw error;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Context, preview persistence                                      */
  /* ---------------------------------------------------------------- */

  async #requireContext(taskId: string): Promise<DirectoryApplyContext> {
    const task = this.#store.tasks.get(taskId);
    if (task === undefined) throw new AppError(ErrorCode.NOT_FOUND, '任务不存在');
    const project = this.#store.projects.get(task.projectId);
    if (project === undefined) throw new AppError(ErrorCode.NOT_FOUND, '项目不存在');
    const workspace = task.workspaceId === undefined ? this.#store.workspaces.byTask(taskId) : this.#store.workspaces.get(task.workspaceId);
    if (workspace === undefined) throw new AppError(ErrorCode.WORKSPACE_NOT_READY, '任务还没有独立副本');
    if (project.gitState === 'git' || workspace.kind !== 'directory_copy') {
      throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, '该任务使用 Git 工作区，请在 Git 交付流程中处理');
    }
    if (workspace.state !== 'ready') throw new AppError(ErrorCode.WORKSPACE_NOT_READY, '独立副本尚未准备完成');
    const copyRoot = workspace.displayRoot;
    if (copyRoot === undefined) throw new AppError(ErrorCode.WORKSPACE_NOT_READY, '独立副本目录不可用');
    const sourceRoot = workspace.originalRootDisplay ?? project.rootPath;
    const baseline = this.#store.settings.getJson<BaselineRecord | undefined>(`${BASELINE_KEY_PREFIX}${workspace.id}`);
    if (baseline === undefined || baseline === null || typeof baseline.baselineRoot !== 'string' || typeof baseline.sourceRoot !== 'string') {
      throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, '该任务没有准备阶段的基线快照，无法进行三方检查', {
        details: { workspaceId: workspace.id },
      });
    }
    const source = await requireDirectory(sourceRoot, '原项目目录');
    const copy = await requireDirectory(copyRoot, '任务副本目录');
    const baselineDir = await requireDirectory(baseline.baselineRoot, '基线快照目录');
    const baselineSourceReal = await realpathOf(baseline.sourceRoot);
    if (baselineSourceReal !== source.real) {
      throw new AppError(ErrorCode.STALE_TARGET, '基线快照对应的原项目路径已变化，请重新准备独立副本', {
        details: { baselineSourceRoot: baseline.sourceRoot, currentSourceRoot: project.rootPath },
      });
    }
    return {
      task,
      project,
      workspace,
      sourceRoot: source.abs,
      sourceReal: source.real,
      copyRoot: copy.abs,
      copyReal: copy.real,
      baselineRoot: baselineDir.abs,
      baselineReal: baselineDir.real,
      baselineCreatedAt: baseline.createdAt,
    };
  }

  async #buildPreview(context: DirectoryApplyContext, options: DirectoryApplyPreviewOptions): Promise<StoredApplyPreview> {
    const [baseline, copy, original] = await Promise.all([
      scanTree(context.baselineRoot, '基线快照'),
      scanTree(context.copyRoot, '任务副本'),
      scanTree(context.sourceRoot, '原项目目录'),
    ]);
    const changed = dropDescendantsOfTypeChanges(diffSnapshots(baseline.states, copy.states));
    const itemsAll: InternalApplyItem[] = [];
    for (const [path, taskChange] of changed) {
      const baselineState = baseline.states.get(path) ?? ABSENT_STATE;
      const copyState = copy.states.get(path) ?? ABSENT_STATE;
      // A nested path may not exist in the scan (for example under a file that
      // the task replaced by a directory); read it explicitly for an honest state.
      const originalState = original.states.get(path) ?? (await readRelativeState(context.sourceRoot, context.sourceReal, path));
      const classified = classifyItem(taskChange, baselineState, copyState, originalState);
      itemsAll.push({
        fileId: encodeFileId(path),
        path,
        change: classified.change,
        check: classified.check,
        ...(classified.conflictType === undefined ? {} : { conflictType: classified.conflictType }),
        plannedEffect: classified.plannedEffect,
        ...(classified.detail === undefined ? {} : { detail: classified.detail }),
        ...(classified.unsupportedKind === undefined ? {} : { unsupportedKind: classified.unsupportedKind }),
        canTakeTask: classified.canTakeTask,
        taskChange,
        baselineState,
        copyState,
        originalState,
      });
    }
    itemsAll.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    const requestedResolutions = new Map<string, ConflictResolutionValue>();
    for (const entry of options.resolutions ?? []) {
      if (typeof entry.fileId !== 'string' || !isConflictResolution(entry.resolution)) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, '处理选择不合法');
      }
      if (requestedResolutions.has(entry.fileId)) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, '同一文件重复给出了处理选择', { details: { fileId: entry.fileId } });
      }
      requestedResolutions.set(entry.fileId, entry.resolution);
    }

    let selected = itemsAll;
    if (options.fileIds !== undefined) {
      const wanted = new Set<string>();
      for (const fileId of options.fileIds) {
        if (typeof fileId !== 'string' || fileId === '') throw new AppError(ErrorCode.VALIDATION_FAILED, '文件引用不合法');
        // Validate path safety before membership so escaping references are
        // rejected as PATH_ESCAPE instead of a generic validation error.
        resolveInside(context.copyRoot, decodeFileId(fileId));
        if (!itemsAll.some((item) => item.fileId === fileId)) {
          throw new AppError(ErrorCode.VALIDATION_FAILED, '所选文件没有任务变更', { details: { fileId } });
        }
        wanted.add(fileId);
      }
      selected = itemsAll.filter((item) => wanted.has(item.fileId));
    }

    const selectedIds = new Set(selected.map((item) => item.fileId));
    for (const fileId of requestedResolutions.keys()) {
      if (!selectedIds.has(fileId)) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, '处理选择引用了未包含在本次预览中的文件', { details: { fileId } });
      }
    }

    const items = selected.map((item) => applyResolutionRequest(item, requestedResolutions.get(item.fileId)));
    for (const item of items) {
      if (item.resolution !== undefined) {
        // Path safety: the file id must decode back inside the copy root.
        resolveInside(context.copyRoot, decodeFileId(item.fileId));
      }
    }

    const counts = countItems(items);
    const checkedAt = nowIso();
    const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS).toISOString();
    const actions = previewActions(items, expiresAt);
    const untouchedSummary = buildUntouchedSummary({
      changedCount: itemsAll.length,
      selectedCount: items.length,
      unchangedOriginalFiles: countUnchangedOriginalFiles(original, changed),
      excluded: [...new Set([...baseline.excluded, ...original.excluded])].sort(),
    });
    return {
      previewRef: createId('pv'),
      taskId: context.task.id,
      workspaceId: context.workspace.id,
      revision: previewRevision(context, items),
      checkedAt,
      expiresAt,
      sourceRoot: context.sourceRoot,
      copyRoot: context.copyRoot,
      baselineRoot: context.baselineRoot,
      ...(context.baselineCreatedAt === undefined ? {} : { baselineCreatedAt: context.baselineCreatedAt }),
      fileIds: items.map((item) => item.fileId),
      items,
      counts,
      untouchedSummary,
      actions,
    };
  }

  #persistPreview(context: DirectoryApplyContext, stored: StoredApplyPreview): void {
    this.#store.settings.putJson(previewKey(stored.previewRef), stored);
    this.#store.settings.putJson(latestPreviewKey(stored.taskId), {
      previewRef: stored.previewRef,
      revision: stored.revision,
      checkedAt: stored.checkedAt,
    });
    const delivery = this.#ensureDelivery(context);
    const updated = this.#store.deliveries.update(delivery.id, {
      ...(delivery.goal === undefined ? { goal: 'apply_to_original' as const } : {}),
      applyPreview: toPublicPreview(stored),
    });
    if (updated !== undefined) {
      this.#store.events.publish('task.delivery.updated', {
        taskId: stored.taskId,
        deliveryId: updated.id,
        revision: updated.revision,
        projection: updated.projection,
      });
    }
  }

  #ensureDelivery(context: DirectoryApplyContext): TaskDelivery {
    const task = context.task;
    const existing = task.deliveryId === undefined ? this.#store.deliveries.byTask(task.id) : this.#store.deliveries.get(task.deliveryId);
    if (existing !== undefined) return existing;
    const created = this.#store.deliveries.create({
      taskId: task.id,
      workspaceId: context.workspace.id,
      eligibility: { allowed: true },
    });
    this.#store.tasks.update(task.id, { deliveryId: created.id });
    return created;
  }

  #deliveryFor(taskId: string): TaskDelivery | undefined {
    const task = this.#store.tasks.get(taskId);
    return task?.deliveryId === undefined ? this.#store.deliveries.byTask(taskId) : this.#store.deliveries.get(task.deliveryId);
  }

  #loadStoredPreview(taskId: string, previewRef: string): StoredApplyPreview {
    const stored = this.#store.settings.getJson<StoredApplyPreview | undefined>(previewKey(previewRef));
    if (stored === undefined || stored === null || typeof stored !== 'object' || stored.taskId !== taskId || !Array.isArray(stored.items)) {
      throw new AppError(ErrorCode.STALE_TARGET, '预览不存在或已失效，请重新检查并冻结预览', { details: { previewRef } });
    }
    return stored;
  }

  #validateFrozenResolutions(
    stored: StoredApplyPreview,
    requested: DeliveryApplyRequest['resolutions'],
  ): Map<string, ConflictResolutionValue> {
    const byFile = new Map<string, ConflictResolutionValue>();
    for (const item of stored.items) {
      if (item.resolution !== undefined) byFile.set(item.fileId, item.resolution);
    }
    for (const entry of requested) {
      if (!isConflictResolution(entry.resolution)) throw new AppError(ErrorCode.VALIDATION_FAILED, '处理选择不合法');
      const frozen = byFile.get(entry.fileId);
      if (frozen === undefined) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, '该项没有冻结处理结果，请重新检查并冻结预览', {
          details: { fileId: entry.fileId },
        });
      }
      if (frozen !== entry.resolution) {
        throw new AppError(ErrorCode.STALE_TARGET, '处理选择与冻结预览不一致，请重新检查并冻结预览', {
          details: { fileId: entry.fileId, frozen, requested: entry.resolution },
        });
      }
    }
    for (const resolution of byFile.values()) {
      if (resolution === ConflictResolution.MANUAL_THEN_RECHECK) {
        throw new AppError(ErrorCode.DELIVERY_BLOCKED, '手动处理后必须重新检查并冻结预览');
      }
    }
    return byFile;
  }

  /* ---------------------------------------------------------------- */
  /* Item execution                                                    */
  /* ---------------------------------------------------------------- */

  async #applyItem(
    context: DirectoryApplyContext,
    item: InternalApplyItem,
    resolution: ConflictResolutionValue | undefined,
    backupRoot: string,
  ): Promise<{ readonly result: DirectoryApplyItemResult; readonly backup?: DirectoryApplyBackupEvidence }> {
    if (needsResolution(item) && resolution === undefined) {
      return {
        result: {
          fileId: item.fileId,
          path: item.path,
          change: item.change,
          result: 'blocked',
          detail: '该冲突没有处理结果，未执行',
        },
      };
    }
    const originalNow = await readRelativeState(context.sourceRoot, context.sourceReal, item.path);
    const copyNow = await readRelativeState(context.copyRoot, context.copyReal, item.path);

    // Idempotence: the original may already have reached the planned target.
    if (targetAlreadyReached(item, originalNow)) {
      return {
        result: {
          fileId: item.fileId,
          path: item.path,
          change: item.change,
          result: 'applied',
          resolution,
          detail: '原目录已是任务版本，无需重复写入',
        },
      };
    }
    if (!sameState(originalNow, item.originalState)) {
      return {
        result: {
          fileId: item.fileId,
          path: item.path,
          change: item.change,
          result: 'blocked',
          resolution,
          detail: '原目录在预览后发生变化，该项被阻塞，未写入',
        },
      };
    }
    if (!sameState(copyNow, item.copyState)) {
      return {
        result: {
          fileId: item.fileId,
          path: item.path,
          change: item.change,
          result: 'blocked',
          resolution,
          detail: '任务副本在预览后发生变化，该项被阻塞，未写入',
        },
      };
    }
    if (item.plannedEffect !== 'delete' && copyNow.kind !== 'file') {
      return {
        result: {
          fileId: item.fileId,
          path: item.path,
          change: item.change,
          result: 'blocked',
          resolution,
          detail: '任务版本不是普通文件，未写入',
        },
      };
    }

    let backup: DirectoryApplyBackupEvidence;
    if (originalNow.kind === 'file') {
      try {
        backup = await backupOriginalFile(backupRoot, item.path, resolveInside(context.sourceRoot, item.path), item.originalState as FileState);
      } catch (error) {
        return {
          result: {
            fileId: item.fileId,
            path: item.path,
            change: item.change,
            result: 'blocked',
            resolution,
            detail: `备份原文件失败，未写入：${errorMessage(error)}`,
          },
        };
      }
    } else {
      backup = { path: item.path, originalExisted: false };
    }

    try {
      if (item.plannedEffect === 'delete') {
        await deleteRegularFile(context.sourceRoot, context.sourceReal, item.path);
      } else {
        const sourceAbs = resolveInside(context.copyRoot, item.path);
        await assertRegularFileInside(context.copyReal, sourceAbs);
        await copyFileAtomic(context.sourceRoot, context.sourceReal, item.path, sourceAbs, item.copyState.kind === 'file' ? item.copyState.mode : undefined);
      }
      const after = await readRelativeState(context.sourceRoot, context.sourceReal, item.path);
      const ok = item.plannedEffect === 'delete' ? after.kind === 'absent' : targetAlreadyReached(item, after);
      return {
        result: {
          fileId: item.fileId,
          path: item.path,
          change: item.change,
          result: ok ? 'applied' : 'unknown',
          resolution,
          detail: ok ? undefined : '写入后核对原目录不一致，结果待核实',
          backup,
        },
        backup,
      };
    } catch (error) {
      const after = await readRelativeState(context.sourceRoot, context.sourceReal, item.path).catch(() => undefined);
      if (after !== undefined && (item.plannedEffect === 'delete' ? after.kind === 'absent' : targetAlreadyReached(item, after))) {
        return {
          result: {
            fileId: item.fileId,
            path: item.path,
            change: item.change,
            result: 'applied',
            resolution,
            detail: `写入过程报错，但核对原目录已是目标状态：${errorMessage(error)}`,
            backup,
          },
          backup,
        };
      }
      return {
        result: {
          fileId: item.fileId,
          path: item.path,
          change: item.change,
          result: after === undefined ? 'unknown' : 'blocked',
          resolution,
          detail: `${after === undefined ? '写入结果无法核对' : '写入失败，原目录未变'}：${errorMessage(error)}`,
          backup,
        },
        backup,
      };
    }
  }

  async #rollback(
    context: DirectoryApplyContext,
    backupRoot: string,
    written: readonly { readonly item: InternalApplyItem; readonly backup: DirectoryApplyBackupEvidence }[],
  ): Promise<{ readonly restored: number; readonly failed: number }> {
    let restored = 0;
    let failed = 0;
    for (const entry of [...written].reverse()) {
      try {
        await restoreBackupEntry({ backupRoot, targetRoot: context.sourceRoot, entry: entry.backup });
        restored += 1;
      } catch {
        failed += 1;
      }
    }
    return { restored, failed };
  }

  async #markDeliveryFailed(
    taskId: string,
    delivery: TaskDelivery,
    requestKey: string,
    error: unknown,
  ): Promise<void> {
    const code = error instanceof AppError ? error.code : ErrorCode.INTERNAL_ERROR;
    const message = errorMessage(error);
    const updated = this.#store.deliveries.update(delivery.id, {
      projection: code === ErrorCode.RECEIPT_UNKNOWN ? 'unknown_receipt' : 'blocked',
      projectionReason: message,
      steps: upsertDeliveryStep(delivery.steps, {
        step: 'apply',
        state: code === ErrorCode.RECEIPT_UNKNOWN ? 'unknown' : 'failed',
        requestKey,
        settledAt: nowIso(),
        error: { code, message },
      }),
    });
    if (updated !== undefined) {
      this.#store.events.publish('task.delivery.updated', {
        taskId,
        deliveryId: updated.id,
        revision: updated.revision,
        projection: updated.projection,
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Request validation                                                  */
/* ------------------------------------------------------------------ */

function validateApplyRequest(request: DeliveryApplyRequest): void {
  if (typeof request.requestKey !== 'string' || !request.requestKey.startsWith('req_')) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少合法的 requestKey');
  }
  if (request.confirmApply !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '必须确认应用');
  if (typeof request.previewRef !== 'string' || !PREVIEW_REF_PATTERN.test(request.previewRef)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'previewRef 不合法');
  }
  if (typeof request.previewRevision !== 'string' || request.previewRevision === '') {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'previewRevision 不合法');
  }
  if (!Array.isArray(request.resolutions)) throw new AppError(ErrorCode.VALIDATION_FAILED, 'resolutions 必须是数组');
  for (const entry of request.resolutions) {
    if (entry === null || typeof entry !== 'object' || typeof entry.fileId !== 'string' || !isConflictResolution(entry.resolution)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '处理选择不合法');
    }
  }
}

/* ------------------------------------------------------------------ */
/* Scanning                                                            */
/* ------------------------------------------------------------------ */

async function scanTree(root: string, label: string): Promise<TreeSnapshot> {
  const rootAbs = resolve(root);
  const rootStat = await fs.lstat(rootAbs).catch(() => undefined);
  if (rootStat === undefined || !rootStat.isDirectory()) {
    throw new AppError(ErrorCode.REPO_PATH_UNAVAILABLE, `${label}不可用或不是目录`, { details: { path: rootAbs } });
  }
  const realRoot = await fs.realpath(rootAbs).catch(() => undefined);
  if (realRoot === undefined) {
    throw new AppError(ErrorCode.READ_FAILED, `${label}无法读取`, { details: { path: rootAbs } });
  }
  const states = new Map<string, NodeState>();
  const excluded = new Set<string>();
  const pending: { readonly abs: string; readonly rel: string }[] = [{ abs: rootAbs, rel: '' }];
  while (pending.length > 0) {
    const current = pending.pop()!;
    let entries;
    try {
      entries = await fs.readdir(current.abs, { withFileTypes: true });
    } catch (error) {
      throw new AppError(ErrorCode.READ_FAILED, `${label}读取失败：${errorMessage(error)}`, { details: { path: current.abs } });
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const rel = current.rel === '' ? entry.name : `${current.rel}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        const target = await fs.readlink(join(current.abs, entry.name)).catch(() => '');
        states.set(rel, { kind: 'symlink', target });
        continue;
      }
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORY_NAMES.has(entry.name)) {
          excluded.add(rel);
          continue;
        }
        states.set(rel, { kind: 'dir' });
        pending.push({ abs: join(current.abs, entry.name), rel });
        continue;
      }
      states.set(rel, await readRelativeState(rootAbs, realRoot, rel));
      if (states.size > MAX_SCAN_ENTRIES) {
        throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, '目录条目过多，无法完成三方检查', {
          details: { root: label, limit: MAX_SCAN_ENTRIES },
        });
      }
    }
  }
  return { root: rootAbs, realRoot, states, excluded: [...excluded].sort() };
}

async function readRelativeState(rootAbs: string, rootReal: string, rel: string): Promise<NodeState> {
  const abs = resolveInside(rootAbs, rel);
  const stat = await fs.lstat(abs).catch((error: unknown) => {
    if (isNotFoundError(error)) return undefined;
    return null;
  });
  if (stat === undefined) return ABSENT_STATE;
  if (stat === null) return { kind: 'unreadable', detail: '无法读取文件状态' };
  if (stat.isSymbolicLink()) {
    const target = await fs.readlink(abs).catch(() => '');
    return { kind: 'symlink', target };
  }
  if (stat.isDirectory()) return { kind: 'dir' };
  if (!stat.isFile()) return { kind: 'special', detail: '不是普通文件' };
  const real = await fs.realpath(abs).catch(() => undefined);
  if (real === undefined || !isInside(real, rootReal)) {
    return { kind: 'unreadable', detail: '路径越出工作目录' };
  }
  try {
    return await describeFile(abs, stat);
  } catch {
    return { kind: 'unreadable', detail: '文件无法读取' };
  }
}

async function describeFile(abs: string, stat: Stats): Promise<FileState> {
  const size = stat.size;
  if (size > MAX_HASHED_BYTES) {
    return {
      kind: 'file',
      size,
      sha256: `weak:${size}:${Math.floor(stat.mtimeMs)}`,
      mode: stat.mode & 0o777,
      binary: false,
      tooLarge: true,
    };
  }
  const buffer = await fs.readFile(abs);
  return {
    kind: 'file',
    size,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    mode: stat.mode & 0o777,
    binary: isBinaryBuffer(buffer),
    tooLarge: size > MAX_SUPPORTED_BYTES,
  };
}

function isBinaryBuffer(buffer: Buffer): boolean {
  const limit = Math.min(buffer.length, BINARY_PROBE_BYTES);
  for (let index = 0; index < limit; index += 1) {
    if (buffer[index] === 0) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

function diffSnapshots(baseline: ReadonlyMap<string, NodeState>, copy: ReadonlyMap<string, NodeState>): Map<string, TaskChangeKind> {
  const paths = new Set<string>([...baseline.keys(), ...copy.keys()]);
  const changed = new Map<string, TaskChangeKind>();
  for (const path of [...paths].sort()) {
    const base = baseline.get(path) ?? ABSENT_STATE;
    const current = copy.get(path) ?? ABSENT_STATE;
    if (sameState(base, current)) continue;
    if (base.kind === 'dir' || current.kind === 'dir') {
      // Pure directory bookkeeping is represented by the files inside it.
      if (base.kind === 'dir' && current.kind === 'absent') continue;
      if (base.kind === 'absent' && current.kind === 'dir') continue;
    }
    changed.set(path, taskChangeKind(base, current));
  }
  return changed;
}

/** A file/dir type change at a path also explains every nested path below it. */
function dropDescendantsOfTypeChanges(changes: Map<string, TaskChangeKind>): Map<string, TaskChangeKind> {
  const typeChanged = [...changes.entries()].filter(([, kind]) => kind === 'type_changed').map(([path]) => path);
  if (typeChanged.length === 0) return changes;
  const filtered = new Map<string, TaskChangeKind>();
  for (const [path, kind] of changes) {
    if (typeChanged.some((parent) => path.startsWith(`${parent}/`))) continue;
    filtered.set(path, kind);
  }
  return filtered;
}

function taskChangeKind(base: NodeState, copy: NodeState): TaskChangeKind {
  if (base.kind === 'absent' && copy.kind !== 'absent') return 'added';
  if (copy.kind === 'absent' && base.kind !== 'absent') return 'deleted';
  if (base.kind !== copy.kind) return 'type_changed';
  return 'modified';
}

function classifyItem(taskChange: TaskChangeKind, baseline: NodeState, copy: NodeState, original: NodeState): ClassifiedItem {
  const change: ChangeStatusValue = taskChange === 'added' ? 'A' : taskChange === 'deleted' ? 'D' : taskChange === 'type_changed' ? 'T' : 'M';
  const plannedEffect: ClassifiedItem['plannedEffect'] = taskChange === 'added' ? 'add' : taskChange === 'deleted' ? 'delete' : 'replace';

  const unsupported = detectUnsupported(taskChange, baseline, copy, original);
  if (unsupported !== undefined) {
    return {
      change,
      check: 'unsupported',
      conflictType: ConflictType.UNSUPPORTED_BINARY_OR_LINK,
      plannedEffect,
      detail: unsupported.detail,
      unsupportedKind: unsupported.kind,
      canTakeTask: unsupported.kind === 'binary' || unsupported.kind === 'too_large',
    };
  }

  const originalChange = originalChangeKind(baseline, original);
  if (taskChange === 'type_changed' || originalChange === 'type_changed') {
    return {
      change,
      check: 'conflict',
      conflictType: ConflictType.TYPE_CONFLICT,
      plannedEffect,
      detail: '原目录中的文件/目录类型与任务版本不一致，需要人工处理',
      canTakeTask: false,
    };
  }
  // A manual resolution makes the original match the task version; re-checking
  // then needs no write and is no longer a conflict.
  if (sameState(copy, original)) {
    return {
      change,
      check: 'applicable',
      plannedEffect,
      detail: '原目录已是任务版本，重新检查后无需写入',
      canTakeTask: true,
    };
  }

  if (originalChange === 'unchanged') {
    return {
      change,
      check: 'applicable',
      plannedEffect,
      detail: applicableDetail(plannedEffect),
      canTakeTask: true,
    };
  }
  if (originalChange === 'added') {
    return taskChange === 'added'
      ? {
          change,
          check: 'conflict',
          conflictType: ConflictType.ADD_ADD,
          plannedEffect,
          detail: '任务新增的路径在原目录中已经存在，需要选择处理方式',
          canTakeTask: true,
        }
      : {
          change,
          check: 'conflict',
          conflictType: ConflictType.TYPE_CONFLICT,
          plannedEffect,
          detail: '原目录在该路径出现了基线中没有的条目，需要人工处理',
          canTakeTask: false,
        };
  }
  if (originalChange === 'modified') {
    if (taskChange === 'modified') {
      return {
        change,
        check: 'conflict',
        conflictType: ConflictType.BOTH_MODIFIED,
        plannedEffect,
        detail: '原目录文件与任务副本都相对基线做了修改，需要选择处理方式',
        canTakeTask: true,
      };
    }
    if (taskChange === 'deleted') {
      return {
        change,
        check: 'conflict',
        conflictType: ConflictType.DELETE_VS_MODIFIED,
        plannedEffect,
        detail: '任务删除了该文件，但原目录中的文件在基线后又被修改',
        canTakeTask: true,
      };
    }
    return {
      change,
      check: 'conflict',
      conflictType: ConflictType.TYPE_CONFLICT,
      plannedEffect,
      detail: '原目录变更类型与任务版本不一致，需要人工处理',
      canTakeTask: false,
    };
  }
  // original deleted
  if (taskChange === 'modified') {
    return {
      change,
      check: 'conflict',
      conflictType: ConflictType.MODIFIED_VS_DELETED,
      plannedEffect,
      detail: '原目录中的文件已删除，但任务副本仍修改了该文件',
      canTakeTask: true,
    };
  }
  if (taskChange === 'deleted') {
    return {
      change,
      check: 'applicable',
      plannedEffect,
      detail: '原目录已不存在该文件，无需写入',
      canTakeTask: true,
    };
  }
  return {
    change,
    check: 'conflict',
    conflictType: ConflictType.TYPE_CONFLICT,
    plannedEffect,
    detail: '原目录变更类型与任务版本不一致，需要人工处理',
    canTakeTask: false,
  };
}

function detectUnsupported(
  taskChange: TaskChangeKind,
  baseline: NodeState,
  copy: NodeState,
  original: NodeState,
): { readonly kind: NonNullable<InternalApplyItem['unsupportedKind']>; readonly detail: string } | undefined {
  for (const [state, where] of [
    [baseline, '基线'],
    [copy, '任务副本'],
    [original, '原目录'],
  ] as const) {
    if (state.kind === 'symlink') {
      return { kind: 'symlink', detail: `${where}中该项是符号链接，不支持自动写入原目录` };
    }
    if (state.kind === 'special') {
      return { kind: 'special', detail: `${where}中该项不是普通文件，不支持自动写入原目录` };
    }
    if (state.kind === 'unreadable') {
      return { kind: 'unreadable', detail: `${where}中该项无法读取：${state.detail}` };
    }
  }
  if (copy.kind === 'file' && taskChange !== 'deleted') {
    if (copy.binary) return { kind: 'binary', detail: '任务版本是二进制文件，不能按文本合并，只能选择保留或采用' };
    if (copy.tooLarge) return { kind: 'too_large', detail: '任务版本超过 1 MB，不能自动应用，只能选择保留或采用' };
  }
  return undefined;
}

function originalChangeKind(baseline: NodeState, original: NodeState): 'unchanged' | 'added' | 'modified' | 'deleted' | 'type_changed' {
  if (sameState(baseline, original)) return 'unchanged';
  if (baseline.kind === 'absent' && original.kind !== 'absent') return 'added';
  if (original.kind === 'absent' && baseline.kind !== 'absent') return 'deleted';
  if (baseline.kind !== original.kind) return 'type_changed';
  return 'modified';
}

function applicableDetail(effect: 'add' | 'replace' | 'delete'): string {
  if (effect === 'add') return '原目录该路径不存在，将按任务版本新增';
  if (effect === 'delete') return '原目录该路径已不存在，无需写入';
  return '原目录该路径与基线一致，将替换为任务版本';
}

/* ------------------------------------------------------------------ */
/* Preview helpers                                                     */
/* ------------------------------------------------------------------ */

function applyResolutionRequest(item: InternalApplyItem, resolution: ConflictResolutionValue | undefined): InternalApplyItem {
  if (resolution === undefined) return item;
  validateResolutionForItem(item, resolution);
  if (resolution === ConflictResolution.MANUAL_THEN_RECHECK) {
    if (item.check === 'applicable') {
      return {
        ...item,
        resolution: undefined,
        detail: '手动处理已生效：重新检查后不再冲突',
      };
    }
    return {
      ...item,
      resolution: undefined,
      detail: `${item.detail ?? '该项仍需处理'}；手动处理尚未生效，仍需选择处理方式`,
    };
  }
  return { ...item, resolution };
}

function validateResolutionForItem(item: InternalApplyItem, resolution: ConflictResolutionValue): void {
  if (resolution === ConflictResolution.KEEP_ORIGINAL || resolution === ConflictResolution.EXCLUDE || resolution === ConflictResolution.MANUAL_THEN_RECHECK) {
    return;
  }
  if (resolution !== ConflictResolution.TAKE_TASK) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, '未知的冲突处理方式');
  }
  if (item.check === 'unsupported' && !item.canTakeTask) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, '该项是不支持的符号链接或特殊文件，只能保留当前原文件或暂不交付', {
      details: { fileId: item.fileId },
    });
  }
  if (item.check === 'conflict' && item.conflictType === ConflictType.TYPE_CONFLICT) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, '文件/目录类型冲突不能直接采用任务版本，请先手动处理并重新检查', {
      details: { fileId: item.fileId },
    });
  }
}

function needsResolution(item: InternalApplyItem): boolean {
  return item.check === 'conflict' || item.check === 'unsupported';
}

function countItems(items: readonly InternalApplyItem[]): DirectoryApplyPreview['counts'] {
  let applicable = 0;
  let conflict = 0;
  let unsupported = 0;
  let unresolved = 0;
  for (const item of items) {
    if (item.check === 'applicable') applicable += 1;
    if (item.check === 'conflict') conflict += 1;
    if (item.check === 'unsupported') unsupported += 1;
    if (needsResolution(item) && item.resolution === undefined) unresolved += 1;
  }
  return { applicable, conflict, unsupported, unresolved };
}

function previewActions(items: readonly InternalApplyItem[], expiresAt: string): DirectoryApplyPreview['actions'] {
  const counts = countItems(items);
  const recheck = { allowed: true };
  if (Date.parse(expiresAt) <= Date.now()) {
    return { apply: { allowed: false, reasonCode: 'PREVIEW_EXPIRED', reason: '预览已过期，重新检查后再确认' }, recheck };
  }
  if (counts.unresolved > 0) {
    return {
      apply: { allowed: false, reasonCode: 'CONFLICT_PENDING', reason: `还有 ${counts.unresolved} 个冲突没有处理` },
      recheck,
    };
  }
  return { apply: { allowed: true }, recheck };
}

function buildUntouchedSummary(input: {
  readonly changedCount: number;
  readonly selectedCount: number;
  readonly unchangedOriginalFiles: number;
  readonly excluded: readonly string[];
}): string {
  const parts = [`原目录中 ${input.unchangedOriginalFiles} 个未变更条目不会被改动`];
  const unselected = input.changedCount - input.selectedCount;
  if (unselected > 0) parts.push(`未选中的 ${unselected} 个变更留在独立副本`);
  if (input.excluded.length > 0) {
    const shown = input.excluded.slice(0, 6).join('、');
    parts.push(`未复制/已排除目录：${shown}${input.excluded.length > 6 ? ' 等' : ''}`);
  }
  parts.push('本次应用不是文件系统事务，逐项写入前会校验预览版本并备份原文件');
  return parts.join('；');
}

function countUnchangedOriginalFiles(snapshot: TreeSnapshot, changed: ReadonlyMap<string, TaskChangeKind>): number {
  let count = 0;
  for (const [path, state] of snapshot.states) {
    if (state.kind === 'dir') continue;
    if (!changed.has(path)) count += 1;
  }
  return count;
}

function previewRevision(context: DirectoryApplyContext, items: readonly InternalApplyItem[]): string {
  return stableHash({
    taskId: context.task.id,
    workspaceId: context.workspace.id,
    items: items.map((item) => ({
      fileId: item.fileId,
      path: item.path,
      change: item.change,
      check: item.check,
      conflictType: item.conflictType ?? null,
      plannedEffect: item.plannedEffect,
      resolution: item.resolution ?? null,
      baseline: stateFingerprint(item.baselineState),
      copy: stateFingerprint(item.copyState),
      original: stateFingerprint(item.originalState),
      unsupportedKind: item.unsupportedKind ?? null,
    })),
  });
}

function frozenResolutionList(stored: StoredApplyPreview): { readonly fileId: string; readonly resolution: ConflictResolutionValue }[] {
  return stored.items
    .filter((item) => item.resolution !== undefined)
    .map((item) => ({ fileId: item.fileId, resolution: item.resolution as ConflictResolutionValue }));
}

function toPublicPreview(stored: StoredApplyPreview): DirectoryApplyPreview {
  return {
    previewRef: stored.previewRef,
    revision: stored.revision,
    checkedAt: stored.checkedAt,
    expiresAt: stored.expiresAt,
    items: stored.items.map((item) => ({
      fileId: item.fileId,
      path: item.path,
      change: item.change,
      check: item.check,
      ...(item.conflictType === undefined ? {} : { conflictType: item.conflictType }),
      plannedEffect: item.plannedEffect,
      ...(item.resolution === undefined ? {} : { resolution: item.resolution }),
      ...(item.detail === undefined ? {} : { detail: item.detail }),
    })),
    counts: stored.counts,
    untouchedSummary: stored.untouchedSummary,
    actions: stored.actions,
  };
}

function summaryFromRecord(outcome: Record<string, unknown> | undefined): DirectoryApplySummary {
  const record = outcome ?? {};
  const items = Array.isArray(record.items)
    ? (record.items as Record<string, unknown>[]).map((item) => ({
        fileId: String(item.fileId ?? ''),
        path: String(item.path ?? ''),
        change: (typeof item.change === 'string' ? item.change : 'M') as ChangeStatusValue,
        result: (typeof item.result === 'string' ? item.result : 'unknown') as DirectoryApplyItemResultValue,
        ...(typeof item.resolution === 'string' ? { resolution: item.resolution as ConflictResolutionValue } : {}),
        ...(typeof item.detail === 'string' ? { detail: item.detail } : {}),
      }))
    : [];
  const backups = Array.isArray(record.backups)
    ? (record.backups as unknown[]).filter((entry): entry is DirectoryApplyBackupEvidence => typeof entry === 'object' && entry !== null)
    : [];
  return {
    previewRef: String(record.previewRef ?? ''),
    revision: String(record.revision ?? ''),
    completedAt: typeof record.completedAt === 'string' ? record.completedAt : nowIso(),
    applied: Number(record.applied ?? 0),
    blocked: Number(record.blocked ?? 0),
    unknown: Number(record.unknown ?? 0),
    notExecuted: Number(record.notExecuted ?? 0),
    items,
    backups,
    ...(typeof record.backupRoot === 'string' ? { backupRoot: record.backupRoot } : {}),
    rolledBack: false,
  };
}

/* ------------------------------------------------------------------ */
/* Delivery projection helpers                                         */
/* ------------------------------------------------------------------ */

function projectionFor(summary: DirectoryApplySummary): TaskDelivery['projection'] {
  if (summary.unknown > 0) return 'unknown_receipt';
  if (summary.applied > 0 && summary.blocked === 0) return 'delivered';
  return 'blocked';
}

function projectionReasonFor(projection: TaskDelivery['projection'], summary: DirectoryApplySummary): string {
  if (projection === 'delivered') return `所选项已应用到原目录（${summary.applied} 项）`;
  if (projection === 'unknown_receipt') return `有 ${summary.unknown} 项写入结果待核实，请核对原操作`;
  if (summary.applied > 0) return `部分成功：已应用 ${summary.applied} 项，阻塞 ${summary.blocked} 项，任务尚未交付`;
  return '没有任何项被写入原目录，任务尚未交付';
}

function upsertDeliveryStep(
  steps: TaskDelivery['steps'],
  next: TaskDelivery['steps'][number],
): TaskDelivery['steps'] {
  return [...steps.filter((step) => step.step !== next.step), next];
}

/* ------------------------------------------------------------------ */
/* Filesystem safety and atomic writes                                 */
/* ------------------------------------------------------------------ */

async function requireDirectory(root: string, label: string): Promise<{ readonly abs: string; readonly real: string }> {
  const abs = resolve(root);
  const stat = await fs.lstat(abs).catch(() => undefined);
  if (stat === undefined || !stat.isDirectory()) {
    throw new AppError(ErrorCode.REPO_PATH_UNAVAILABLE, `${label}不可用或不是目录`, { details: { path: abs } });
  }
  const real = await fs.realpath(abs).catch(() => undefined);
  if (real === undefined) throw new AppError(ErrorCode.READ_FAILED, `${label}无法读取`, { details: { path: abs } });
  return { abs, real };
}

async function realpathOf(path: string): Promise<string> {
  return fs.realpath(path).catch(() => resolve(path));
}

function isInside(child: string, root: string): boolean {
  const normalizedRoot = root.endsWith(sep) ? root.slice(0, -1) : root;
  return child === normalizedRoot || child.startsWith(`${normalizedRoot}${sep}`);
}

function validateRelativePath(rel: string): string {
  if (typeof rel !== 'string' || rel === '' || rel.includes('\0')) {
    throw new AppError(ErrorCode.PATH_ESCAPE, '文件路径不合法', { details: { path: rel } });
  }
  if (isAbsolute(rel)) throw new AppError(ErrorCode.PATH_ESCAPE, '不允许绝对路径', { details: { path: rel } });
  const normalized = normalize(rel);
  if (normalized === '.' || normalized === '..' || normalized.startsWith(`..${sep}`) || isAbsolute(normalized)) {
    throw new AppError(ErrorCode.PATH_ESCAPE, '路径越出工作目录', { details: { path: rel } });
  }
  return normalized;
}

function resolveInside(root: string, rel: string): string {
  const normalized = validateRelativePath(rel);
  const rootAbs = resolve(root);
  const abs = resolve(rootAbs, normalized);
  if (!isInside(abs, rootAbs)) throw new AppError(ErrorCode.PATH_ESCAPE, '路径越出工作目录', { details: { path: rel } });
  return abs;
}

async function assertNoSymlinkComponents(root: string, rel: string): Promise<void> {
  const normalized = validateRelativePath(rel);
  let current = resolve(root);
  for (const segment of normalized.split(sep)) {
    current = join(current, segment);
    const stat = await fs.lstat(current).catch((error: unknown) => {
      if (isNotFoundError(error)) return undefined;
      throw error;
    });
    if (stat === undefined) return;
    if (stat.isSymbolicLink()) {
      throw new AppError(ErrorCode.PATH_ESCAPE, '路径包含符号链接，拒绝写入', { details: { path: rel } });
    }
  }
}

async function assertRegularFileInside(realRoot: string, abs: string): Promise<void> {
  const stat = await fs.lstat(abs).catch(() => undefined);
  if (stat === undefined || !stat.isFile()) {
    throw new AppError(ErrorCode.READ_FAILED, '任务版本不是普通文件', { details: { path: abs } });
  }
  const real = await fs.realpath(abs).catch(() => undefined);
  if (real === undefined || !isInside(real, realRoot)) {
    throw new AppError(ErrorCode.PATH_ESCAPE, '源文件越出任务副本目录', { details: { path: abs } });
  }
}

async function copyFileAtomic(
  root: string,
  rootReal: string,
  rel: string,
  sourceAbs: string,
  mode: number | undefined,
): Promise<void> {
  const abs = resolveInside(root, rel);
  await assertNoSymlinkComponents(root, rel);
  const parent = dirname(abs);
  await fs.mkdir(parent, { recursive: true });
  await assertNoSymlinkComponents(root, rel);
  const parentReal = await fs.realpath(parent).catch(() => undefined);
  if (parentReal === undefined || !isInside(parentReal, rootReal)) {
    throw new AppError(ErrorCode.PATH_ESCAPE, '目标父目录越出原项目目录', { details: { path: rel } });
  }
  const existing = await fs.lstat(abs).catch(() => undefined);
  if (existing !== undefined && !existing.isFile()) {
    throw new AppError(ErrorCode.PATH_ESCAPE, '目标不是普通文件，拒绝写入', { details: { path: rel } });
  }
  const temp = join(parent, `.${basename(abs)}.aw-apply-${createId('tmp').slice(4)}.tmp`);
  try {
    await fs.copyFile(sourceAbs, temp);
    if (mode !== undefined) await fs.chmod(temp, mode).catch(() => undefined);
    await fs.rename(temp, abs);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function deleteRegularFile(root: string, rootReal: string, rel: string): Promise<void> {
  const abs = resolveInside(root, rel);
  await assertNoSymlinkComponents(root, rel);
  const stat = await fs.lstat(abs).catch(() => undefined);
  if (stat === undefined) return;
  if (!stat.isFile()) throw new AppError(ErrorCode.PATH_ESCAPE, '目标不是普通文件，拒绝删除', { details: { path: rel } });
  const real = await fs.realpath(abs).catch(() => undefined);
  if (real === undefined || !isInside(real, rootReal)) {
    throw new AppError(ErrorCode.PATH_ESCAPE, '目标越出原项目目录', { details: { path: rel } });
  }
  await fs.unlink(abs);
}

async function backupOriginalFile(backupRoot: string, rel: string, sourceAbs: string, expected: FileState): Promise<DirectoryApplyBackupEvidence> {
  await fs.mkdir(backupRoot, { recursive: true });
  const backupReal = await fs.realpath(backupRoot);
  const target = resolveInside(backupRoot, rel);
  await assertNoSymlinkComponents(backupRoot, rel);
  await fs.mkdir(dirname(target), { recursive: true });
  const parentReal = await fs.realpath(dirname(target));
  if (!isInside(parentReal, backupReal)) {
    throw new AppError(ErrorCode.PATH_ESCAPE, '备份路径越出备份目录', { details: { path: rel } });
  }
  await fs.copyFile(sourceAbs, target);
  const sha256 = await sha256File(target);
  if (sha256 !== expected.sha256) {
    await fs.rm(target, { force: true }).catch(() => undefined);
    throw new AppError(ErrorCode.STALE_TARGET, '备份内容与预览时不一致', { details: { path: rel } });
  }
  return {
    path: rel,
    originalExisted: true,
    backupPath: target,
    sha256,
    sizeBytes: expected.size,
    backedUpAt: nowIso(),
  };
}

async function requireInsideDataDir(dataDir: string, target: string): Promise<void> {
  const dataDirAbs = resolve(dataDir);
  const dataDirReal = await fs.realpath(dataDirAbs).catch(() => undefined);
  if (dataDirReal === undefined) throw new AppError(ErrorCode.READ_FAILED, '数据目录不可用');
  if (!isInside(resolve(target), dataDirReal) && !isInside(resolve(target), dataDirAbs)) {
    throw new AppError(ErrorCode.PATH_ESCAPE, '备份目录越出数据目录');
  }
}

async function sha256File(path: string): Promise<string> {
  const buffer = await fs.readFile(path);
  return createHash('sha256').update(buffer).digest('hex');
}

/* ------------------------------------------------------------------ */
/* Restore (best-effort rollback support, also used by recovery)       */
/* ------------------------------------------------------------------ */

/**
 * Restore one original path from its backup evidence. Used by the best-effort
 * rollback after an unexpected failure and by recovery tooling. It never
 * follows symlinks and refuses paths outside either root.
 */
export async function restoreBackupEntry(input: {
  readonly backupRoot: string;
  readonly targetRoot: string;
  readonly entry: DirectoryApplyBackupEvidence;
}): Promise<void> {
  const target = await requireDirectory(input.targetRoot, '原项目目录');
  if (!input.entry.originalExisted) {
    await deleteRegularFile(target.abs, target.real, input.entry.path);
    return;
  }
  const backup = await requireDirectory(input.backupRoot, '备份目录');
  if (input.entry.backupPath === undefined) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, '备份证据缺少备份路径');
  }
  const backupAbs = resolve(input.entry.backupPath);
  const backupReal = await fs.realpath(backupAbs).catch(() => undefined);
  if (backupReal === undefined || !isInside(backupReal, backup.real)) {
    throw new AppError(ErrorCode.PATH_ESCAPE, '备份文件越出备份目录', { details: { path: input.entry.path } });
  }
  const stat = await fs.lstat(backupAbs);
  if (!stat.isFile()) throw new AppError(ErrorCode.PATH_ESCAPE, '备份不是普通文件');
  await copyFileAtomic(target.abs, target.real, input.entry.path, backupAbs, undefined);
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function sameState(left: NodeState, right: NodeState): boolean {
  return stateFingerprint(left) === stateFingerprint(right);
}

function stateFingerprint(state: NodeState): string {
  switch (state.kind) {
    case 'absent':
      return 'absent';
    case 'dir':
      return 'dir';
    case 'file':
      return `file:${state.size}:${state.sha256}`;
    case 'symlink':
      return `symlink:${state.target}`;
    case 'special':
      return `special:${state.detail}`;
    case 'unreadable':
      return `unreadable:${state.detail}`;
  }
}

function targetAlreadyReached(item: InternalApplyItem, current: NodeState): boolean {
  if (item.plannedEffect === 'delete') return current.kind === 'absent';
  if (current.kind !== 'file') return false;
  if (item.copyState.kind !== 'file') return false;
  return current.size === item.copyState.size && current.sha256 === item.copyState.sha256;
}

function isConflictResolution(value: unknown): value is ConflictResolutionValue {
  return value === ConflictResolution.KEEP_ORIGINAL
    || value === ConflictResolution.TAKE_TASK
    || value === ConflictResolution.MANUAL_THEN_RECHECK
    || value === ConflictResolution.EXCLUDE;
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { readonly code?: unknown }).code === 'ENOENT';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误';
}

function previewKey(previewRef: string): string {
  return `${PREVIEW_KEY_PREFIX}${previewRef}`;
}

function latestPreviewKey(taskId: string): string {
  return `${LATEST_PREVIEW_KEY_PREFIX}${taskId}`;
}

/** Exported for HTTP/tests that need to build file references consistently. */
export { encodeFileId, decodeFileId };
