import type { CommandResponse, PrepareWorkspaceRequest, TaskChanges, TaskWorkspace, WorkspaceCleanupPreview } from '@agent-workflow/shared';
import { AppError, ErrorCode, nowIso } from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';
import type { EngineContext } from './actions.ts';
import type { CommandService } from './operations.ts';
import type { GitPort } from './ports.ts';

const FILE_ID_PREFIX = 'file_';

export function encodeFileId(path: string): string {
  return `${FILE_ID_PREFIX}${Buffer.from(path, 'utf8').toString('base64url')}`;
}

export function decodeFileId(fileId: string): string {
  if (!fileId.startsWith(FILE_ID_PREFIX)) throw new AppError(ErrorCode.NOT_FOUND, '文件引用不存在');
  try {
    return Buffer.from(fileId.slice(FILE_ID_PREFIX.length), 'base64url').toString('utf8');
  } catch {
    throw new AppError(ErrorCode.NOT_FOUND, '文件引用不存在');
  }
}

export class WorkspaceService {
  readonly #store: Store;
  readonly #commands: CommandService;
  readonly #context: EngineContext;
  readonly #git: GitPort;

  constructor(store: Store, commands: CommandService, context: EngineContext, git: GitPort) {
    this.#store = store;
    this.#commands = commands;
    this.#context = context;
    this.#git = git;
  }

  /**
   * Startup recovery for workspace preparation a previous process left in flight.
   *
   * The workspace becomes `unknown`, running preparation steps become failed and
   * every step carries the verification hint. Nothing on disk is deleted or
   * modified here: an operator must verify the directory/branch before preparing
   * again or cleaning up. Accepted preparation receipts are settled to unknown so
   * `GET /api/operations/:key` shows the interruption.
   *
   * Returns the affected task ids so the composition root can recompute attention.
   */
  recoverOnStartup(): readonly string[] {
    const affected: string[] = [];
    for (const task of this.#store.tasks.list()) {
      const workspace = task.workspaceId === undefined ? this.#store.workspaces.byTask(task.id) : this.#store.workspaces.get(task.workspaceId);
      if (workspace === undefined || workspace.state !== 'preparing') continue;
      const message = '进程重启，工作区准备中断；请核对工作区目录与分支后再重新准备或清理（不会自动删除或修改目录）。';
      const nextStep = workspace.steps.findIndex((step) => step.state === 'not_started');
      const steps = workspace.steps.map((step, index) => {
        if (step.state === 'running') return { ...step, state: 'failed' as const, detail: message };
        if (index === nextStep) return { ...step, detail: message };
        return step;
      });
      const updated = this.#store.workspaces.update(workspace.id, { state: 'unknown', steps, lastCheckedAt: nowIso() });
      this.#store.events.publish('task.workspace.updated', {
        taskId: task.id,
        workspaceId: workspace.id,
        revision: updated?.revision ?? workspace.revision,
        state: 'unknown',
      });
      this.#settlePrepareReceipts(task.id, new AppError(ErrorCode.INTERNAL_ERROR, message));
      affected.push(task.id);
    }
    return affected;
  }

  #settlePrepareReceipts(taskId: string, failure: AppError): void {
    for (const operation of this.#store.operations.listPending()) {
      if (operation.operation !== 'task.workspace.prepare') continue;
      if (operation.target.taskId !== taskId) continue;
      const record = this.#commands.get(operation.requestKey);
      if (record === undefined || record.status !== 'accepted') continue;
      this.#commands.fail(operation.requestKey, failure, true);
    }
  }

  get(taskId: string): TaskWorkspace | undefined {
    const task = this.#requireTask(taskId);
    return task.workspaceId === undefined ? this.#store.workspaces.byTask(taskId) : this.#store.workspaces.get(task.workspaceId);
  }

  async prepare(taskId: string, input: PrepareWorkspaceRequest): Promise<CommandResponse<{ workspace: TaskWorkspace }>> {
    const task = this.#requireTask(taskId);
    const project = this.#requireProject(task.projectId);
    const plan = task.currentPlanRevisionId === undefined ? undefined : this.#store.plans.get(task.currentPlanRevisionId);
    if (plan === undefined || plan.status !== 'confirmed') {
      throw new AppError(ErrorCode.WORKSPACE_NOT_READY, '计划尚未确认，不能准备工作区');
    }
    const workspace = this.get(taskId) ?? this.#store.workspaces.create({
      taskId,
      kind: project.gitState === 'git' ? 'git_worktree' : 'directory_copy',
      originalRootDisplay: project.rootPath,
      baseRef: project.defaultBranch,
    });
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'task.workspace.prepare',
      body: {
        taskId,
        expectedPlanRevisionNumber: input.expectedPlanRevisionNumber,
        expectedBaseRef: input.expectedBaseRef,
        expectedBaseTip: input.expectedBaseTip,
        confirmPrepare: true,
      },
      target: { taskId },
    });
    if (replayed && record.status !== 'accepted') {
      return { receipt: this.#commands.toReceipt(record), resource: { workspace: this.get(taskId)! } };
    }
    try {
      const settings = this.#context.settings();
      const worktreesRoot = settings.git.worktreeRoot.startsWith('/')
        ? settings.git.worktreeRoot
        : new URL(settings.git.worktreeRoot, `file://${this.#context.store.dataDir}/`).pathname;
      this.#store.workspaces.update(workspace.id, { state: 'preparing', steps: [
        { step: 'resolve_baseline', state: 'running' },
        { step: 'create_branch', state: 'not_started' },
        { step: 'create_worktree', state: 'not_started' },
        { step: 'verify_worktree', state: 'not_started' },
        { step: 'bind_task', state: 'not_started' },
      ] });
      this.#store.events.publish('task.workspace.updated', { taskId, workspaceId: workspace.id, revision: workspace.revision, state: 'preparing' });

      if (project.gitState !== 'git') {
        if (this.#git.copyToDirectory === undefined) {
          throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, '非 Git 目录适配尚未接通');
        }
        const target = `${this.#context.store.dataDir}/workspaces/${taskId}`;
        const baselineRoot = `${this.#context.store.dataDir}/baselines/${workspace.id}`;
        await this.#git.copyToDirectory({ sourceRoot: project.rootPath, targetRoot: baselineRoot });
        await this.#git.copyToDirectory({ sourceRoot: baselineRoot, targetRoot: target });
        this.#context.store.settings.putJson(`directory.baseline.${workspace.id}`, {
          baselineRoot,
          sourceRoot: project.rootPath,
          createdAt: nowIso(),
        });
        const updated = this.#store.workspaces.update(workspace.id, {
          state: 'ready',
          displayRoot: target,
          baseRef: 'baseline',
          steps: [
            { step: 'resolve_baseline', state: 'completed' },
            { step: 'create_branch', state: 'completed', detail: '非 Git：独立副本' },
            { step: 'create_worktree', state: 'completed' },
            { step: 'verify_worktree', state: 'completed' },
            { step: 'bind_task', state: 'completed' },
          ],
        });
        this.#store.events.publish('task.workspace.updated', { taskId, workspaceId: workspace.id, revision: updated!.revision, state: 'ready' });
        this.#store.events.publish('task.changed', { taskId, projectId: task.projectId, stage: task.stage, revision: 1 });
        this.#commands.settle(input.requestKey, { workspaceId: workspace.id, kind: 'directory_copy' });
        return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: { workspace: updated! } };
      }

      const status = await this.#git.status(project.rootPath);
      const baseSha = status?.head.sha ?? input.expectedBaseTip;
      const baseRef = project.defaultBranch ?? 'main';
      if (baseSha === undefined) {
        throw new AppError(ErrorCode.WORKSPACE_PREPARE_FAILED, '无法解析基线提交（可能是空仓库或 HEAD 不可用）', {
          details: { baseRef, empty: status?.isEmpty ?? false },
        });
      }
      if (input.expectedBaseTip !== undefined && input.expectedBaseTip !== baseSha) {
        throw new AppError(ErrorCode.STALE_TARGET, '基线已前移，请重新确认', { details: { expected: input.expectedBaseTip, actual: baseSha } });
      }
      const branch = `${settings.git.branchPrefix}${taskId.replace(/^task_/, '').slice(0, 12)}`;
      const handle = await this.#git.createWorktree({
        repoRoot: project.rootPath,
        worktreesRoot,
        taskId,
        baseRef,
        baseSha,
        branch,
      });
      const updated = this.#store.workspaces.update(workspace.id, {
        state: 'ready',
        branch: handle.branch,
        baseRef,
        baseSha: handle.headSha,
        displayRoot: handle.path,
        worktreeHandle: handle.handle,
        steps: [
          { step: 'resolve_baseline', state: 'completed' },
          { step: 'create_branch', state: 'completed', detail: handle.branch },
          { step: 'create_worktree', state: 'completed' },
          { step: 'verify_worktree', state: 'completed' },
          { step: 'bind_task', state: 'completed' },
        ],
      });
      this.#store.events.publish('task.workspace.updated', { taskId, workspaceId: workspace.id, revision: updated!.revision, state: 'ready' });
      this.#store.events.publish('task.changed', { taskId, projectId: task.projectId, stage: task.stage, revision: 1 });
      this.#commands.settle(input.requestKey, { workspaceId: workspace.id, branch: handle.branch, baseSha: handle.headSha });
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: { workspace: updated! } };
    } catch (error) {
      this.#store.workspaces.update(workspace.id, { state: error instanceof AppError && error.code === ErrorCode.STALE_TARGET ? 'blocked' : 'blocked' });
      this.#store.events.publish('task.workspace.updated', { taskId, workspaceId: workspace.id, revision: workspace.revision, state: 'blocked' });
      this.#commands.fail(input.requestKey, error as Error);
      throw error;
    }
  }

  async changes(taskId: string): Promise<TaskChanges> {
    const task = this.#requireTask(taskId);
    const workspace = this.get(taskId);
    if (workspace === undefined || workspace.state !== 'ready') {
      throw new AppError(ErrorCode.WORKSPACE_NOT_READY, '工作区尚未准备完成');
    }
    if (workspace.kind !== 'git_worktree' || workspace.displayRoot === undefined || workspace.baseSha === undefined) {
      return {
        workspaceId: workspace.id,
        changesRevision: `copy-${workspace.revision}`,
        baselineRef: workspace.baseRef,
        readAt: nowIso(),
        stats: { added: 0, modified: 0, deleted: 0 },
        files: [],
        excluded: [{ path: workspace.displayRoot ?? '', reason: '非 Git 目录不生成 Git 变更集；请在“应用到原目录”的三方预览中查看逐项差异。' }],
      };
    }
    const { files, changesRevision } = await this.#git.worktreeChangedFiles({ worktreePath: workspace.displayRoot, baseSha: workspace.baseSha });
    const stats = { added: 0, modified: 0, deleted: 0 };
    for (const file of files) {
      if (file.status === 'A') stats.added += 1;
      else if (file.status === 'D') stats.deleted += 1;
      else stats.modified += 1;
    }
    return {
      workspaceId: workspace.id,
      changesRevision,
      baselineRef: workspace.baseRef,
      readAt: nowIso(),
      stats,
      files: files.map((file) => ({ ...file, fileId: encodeFileId(file.path) })),
      excluded: [],
    };
  }

  async diff(taskId: string, fileId: string, cursor?: string): Promise<import('@agent-workflow/shared').DiffPage> {
    const workspace = this.get(taskId);
    if (workspace === undefined || workspace.displayRoot === undefined || workspace.baseSha === undefined) {
      throw new AppError(ErrorCode.WORKSPACE_NOT_READY, '工作区尚未准备完成');
    }
    const path = decodeFileId(fileId);
    return this.#git.diffPage({ worktreePath: workspace.displayRoot, baseSha: workspace.baseSha, path, cursor });
  }

  cleanupPreview(taskId: string): WorkspaceCleanupPreview {
    const workspace = this.get(taskId);
    if (workspace === undefined) throw new AppError(ErrorCode.NOT_FOUND, '任务没有工作区');
    const task = this.#requireTask(taskId);
    const execution = task.executionId === undefined ? this.#store.executions.byTask(taskId) : this.#store.executions.get(task.executionId);
    const planning = task.currentPlanningRoundId === undefined ? this.#store.planning.latest(taskId) : this.#store.planning.get(task.currentPlanningRoundId);
    const delivery = task.deliveryId === undefined ? this.#store.deliveries.byTask(taskId) : this.#store.deliveries.get(task.deliveryId);
    const blockers: { kind: string; label: string; ref?: string }[] = [];
    if (workspace.state === 'preparing' || workspace.state === 'cleaning') {
      blockers.push({ kind: 'workspace_busy', label: `工作区正在${workspace.state === 'preparing' ? '准备' : '清理'}，不能重复清理` });
    }
    if (execution !== undefined && ['running', 'starting', 'pausing', 'stopping'].includes(execution.status)) {
      blockers.push({ kind: 'execution_active', label: '执行仍在进行，先停止执行再清理工作区', ref: execution.id });
    }
    if (planning !== undefined && ['queued', 'running', 'stopping'].includes(planning.status)) {
      blockers.push({ kind: 'planning_active', label: '规划仍在进行，先停止规划再清理工作区', ref: planning.id });
    }
    for (const step of delivery?.steps ?? []) {
      if (step.state === 'in_progress') {
        blockers.push({ kind: 'delivery_in_progress', label: '交付步骤正在执行，完成后再清理工作区', ref: step.step });
      }
    }
    const undelivered = delivery !== undefined && delivery.projection !== 'delivered'
      ? { count: 1, reason: '任务变更还没有完成交付；清理会删除工作区与本地分支' }
      : { count: 0, reason: '没有未交付的任务变更' };
    return {
      previewRef: `cleanup_${workspace.id}_${workspace.revision}`,
      workspaceId: workspace.id,
      workspaceRevision: workspace.revision,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      deleteObjects: [
        ...(workspace.branch === undefined ? [] : [{ kind: 'local_branch' as const, label: workspace.branch }]),
        ...(workspace.displayRoot === undefined ? [] : [{ kind: 'worktree_directory' as const, label: workspace.displayRoot }]),
      ],
      retainObjects: [
        { kind: 'remote_branch', label: '远端分支（永不自动删除）' },
        { kind: 'audit', label: '回执与审计记录' },
      ],
      undelivered,
      requiresUndeliveredAck: true,
      blockers,
    };
  }

  async cleanupConfirm(taskId: string, input: { requestKey: string; previewRef: string; workspaceRevision: string; confirmCleanup: true }): Promise<CommandResponse<{ workspace?: TaskWorkspace }>> {
    const workspace = this.get(taskId);
    if (workspace === undefined) throw new AppError(ErrorCode.NOT_FOUND, '任务没有工作区');
    const task = this.#requireTask(taskId);
    const project = this.#requireProject(task.projectId);
    const preview = this.cleanupPreview(taskId);
    if (preview.blockers.length > 0) {
      throw new AppError(ErrorCode.DELIVERY_BLOCKED, preview.blockers.map((blocker) => blocker.label).join('；'), {
        details: { blockers: preview.blockers },
      });
    }
    if (input.previewRef !== preview.previewRef) throw new AppError(ErrorCode.STALE_TARGET, '清理预览已变化，请重新读取后确认');
    if (input.workspaceRevision !== preview.workspaceRevision) throw new AppError(ErrorCode.STALE_TARGET, '工作区已变化，请重新读取后确认');
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'task.workspace.cleanup.confirm',
      body: { taskId, previewRef: input.previewRef, workspaceRevision: input.workspaceRevision, confirmCleanup: true },
      target: { taskId },
    });
    if (replayed && record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record), resource: { workspace: this.get(taskId) } };
    try {
      if (workspace.displayRoot !== undefined && workspace.branch !== undefined) {
        await this.#git.removeWorktree({ repoRoot: project.rootPath, worktreePath: workspace.displayRoot, branch: workspace.branch, deleteBranch: true });
      }
      const updated = this.#store.workspaces.update(workspace.id, { state: 'cleaned', retention: 'cleaned' });
      this.#store.events.publish('task.workspace.updated', { taskId, workspaceId: workspace.id, revision: updated!.revision, state: 'cleaned' });
      this.#commands.settle(input.requestKey, { workspaceId: workspace.id });
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: { workspace: updated } };
    } catch (error) {
      this.#commands.fail(input.requestKey, error as Error);
      throw error;
    }
  }

  #requireTask(taskId: string) {
    const task = this.#store.tasks.get(taskId);
    if (task === undefined) throw new AppError(ErrorCode.NOT_FOUND, '任务不存在');
    return task;
  }

  #requireProject(projectId: string) {
    const project = this.#store.projects.get(projectId);
    if (project === undefined) throw new AppError(ErrorCode.NOT_FOUND, '项目不存在');
    return project;
  }
}
