import type {
  CommandResponse,
  DeliveryMergeRequest,
  DeliveryCommitRequest,
  DeliveryPushRequest,
  DeliveryResponse,
  DeliverySelectRequest,
  DeliveryStepState,
  TaskDelivery,
} from '@agent-workflow/shared';
import { AppError, ErrorCode, TaskAttention, TaskLifecycle, nowIso } from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';
import type { EngineContext } from './actions.ts';
import type { CommandService } from './operations.ts';
import type { GitPort } from './ports.ts';
import { decodeFileId, type WorkspaceService } from './workspace.ts';

export class DeliveryService {
  readonly #store: Store;
  readonly #commands: CommandService;
  readonly #context: EngineContext;
  readonly #git: GitPort;
  readonly #workspaces: WorkspaceService;

  constructor(store: Store, commands: CommandService, context: EngineContext, git: GitPort, workspaces: WorkspaceService) {
    this.#store = store;
    this.#commands = commands;
    this.#context = context;
    this.#git = git;
    this.#workspaces = workspaces;
  }

  get(taskId: string): TaskDelivery {
    const task = this.#requireTask(taskId);
    const existing = task.deliveryId === undefined ? this.#store.deliveries.byTask(taskId) : this.#store.deliveries.get(task.deliveryId);
    if (existing !== undefined) return existing;
    const workspace = task.workspaceId === undefined ? this.#store.workspaces.byTask(taskId) : this.#store.workspaces.get(task.workspaceId);
    if (workspace === undefined) throw new AppError(ErrorCode.DELIVERY_BLOCKED, '任务还没有工作区，不能交付');
    const created = this.#store.deliveries.create({
      taskId,
      workspaceId: workspace.id,
      eligibility: { allowed: workspace.state === 'ready', reason: workspace.state === 'ready' ? undefined : '工作区未准备完成' },
    });
    this.#store.tasks.update(taskId, { deliveryId: created.id });
    return created;
  }

  async select(taskId: string, input: DeliverySelectRequest): Promise<CommandResponse<DeliveryResponse>> {
    const delivery = this.get(taskId);
    const task = this.#requireTask(taskId);
    const workspace = task.workspaceId === undefined ? this.#store.workspaces.byTask(taskId) : this.#store.workspaces.get(task.workspaceId);
    if (workspace === undefined || workspace.state !== 'ready') throw new AppError(ErrorCode.WORKSPACE_NOT_READY, '工作区未准备完成');
    if (input.changesRevision !== undefined && delivery.changesRevision !== undefined && input.changesRevision !== delivery.changesRevision) {
      throw new AppError(ErrorCode.STALE_TARGET, '变更集已更新，请重新读取');
    }
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'task.delivery.select',
      body: { taskId, goal: input.goal, fileIds: input.fileIds, changesRevision: input.changesRevision, expectedDeliveryRevision: input.expectedDeliveryRevision },
      target: { taskId },
    });
    if (replayed && record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record), resource: { delivery: this.get(taskId), actions: {} } };
    const changes = await this.#workspaces.changes(taskId).catch(() => undefined);
    const updated = this.#store.deliveries.update(delivery.id, {
      goal: input.goal,
      selectedFileIds: input.fileIds,
      changesRevision: input.changesRevision ?? changes?.changesRevision,
      projection: 'awaiting_confirmation',
      projectionReason: '已选择交付目标与范围，下一步需要确认',
      remaining: { unselected: Math.max(0, (changes?.files.length ?? input.fileIds.length) - input.fileIds.length), detail: '未选择文件不会交付' },
      eligibility: { allowed: true },
    });
    this.#store.events.publish('task.delivery.updated', { taskId, deliveryId: delivery.id, revision: updated!.revision, projection: updated!.projection });
    this.#commands.settle(input.requestKey, { deliveryId: delivery.id, goal: input.goal });
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: { delivery: updated!, changes, actions: {} } };
  }

  async commit(taskId: string, input: DeliveryCommitRequest): Promise<CommandResponse<DeliveryResponse>> {
    const delivery = this.get(taskId);
    const task = this.#requireTask(taskId);
    const workspace = task.workspaceId === undefined ? this.#store.workspaces.byTask(taskId) : this.#store.workspaces.get(task.workspaceId);
    if (workspace?.displayRoot === undefined) throw new AppError(ErrorCode.WORKSPACE_NOT_READY, '工作区未准备完成');
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'task.delivery.commit',
      body: { taskId, fileIds: input.fileIds, message: input.message, expectedChangesRevision: input.expectedChangesRevision, expectedBranchHead: input.expectedBranchHead, confirmCommit: true },
      target: { taskId },
    });
    if (replayed && record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record), resource: { delivery: this.get(taskId), actions: {} } };
    const changes = await this.#workspaces.changes(taskId);
    if (input.expectedChangesRevision !== undefined && changes.changesRevision !== input.expectedChangesRevision) {
      throw new AppError(ErrorCode.STALE_TARGET, '内容版本已变化，请重新读取后确认', { details: { actual: changes.changesRevision } });
    }
    const paths = input.fileIds.map(decodeFileId).filter((path) => changes.files.some((file) => file.path === path));
    if (paths.length === 0) throw new AppError(ErrorCode.VALIDATION_FAILED, '没有选择可提交的文件');
    try {
      const commit = await this.#git.commit({
        worktreePath: workspace.displayRoot,
        filePaths: paths,
        message: input.message,
        author: this.#context.settings().git.author,
        expectedHeadSha: input.expectedBranchHead,
      });
      const steps = updateStep(delivery.steps, {
        step: 'commit',
        state: 'succeeded',
        requestKey: input.requestKey,
        settledAt: nowIso(),
        commitSha: commit.sha,
      });
      const updated = this.#store.deliveries.update(delivery.id, {
        projection: 'awaiting_confirmation',
        projectionReason: '提交完成，等待推送或创建合并请求确认',
        goal: delivery.goal ?? 'local_commit',
        steps,
      });
      this.#store.events.publish('task.delivery.updated', { taskId, deliveryId: delivery.id, revision: updated!.revision, projection: updated!.projection });
      this.#commands.settle(input.requestKey, { commitSha: commit.sha });
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: { delivery: updated!, changes, actions: {} } };
    } catch (error) {
      this.#commands.fail(input.requestKey, error as Error);
      throw error;
    }
  }

  async push(taskId: string, input: DeliveryPushRequest): Promise<CommandResponse<DeliveryResponse>> {
    const delivery = this.get(taskId);
    const task = this.#requireTask(taskId);
    const project = this.#requireProject(task.projectId);
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'task.delivery.push',
      body: { taskId, expectedLocalSha: input.expectedLocalSha, remoteBranchName: input.remoteBranchName, confirmPush: true },
      target: { taskId },
    });
    if (replayed && record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record), resource: { delivery: this.get(taskId), actions: {} } };
    if (project.gitState !== 'git') throw new AppError(ErrorCode.GIT_CAPABILITY_UNAVAILABLE, '非 Git 项目不支持推送');
    try {
      const result = await this.#git.push({
        repoRoot: project.rootPath,
        localSha: input.expectedLocalSha,
        remote: 'origin',
        remoteRef: `refs/heads/${input.remoteBranchName}`,
      });
      const steps = updateStep(delivery.steps, {
        step: 'push',
        state: 'succeeded',
        requestKey: input.requestKey,
        settledAt: nowIso(),
        remoteRef: result.remoteRef,
        pushedSha: result.pushedSha,
      });
      const updated = this.#store.deliveries.update(delivery.id, {
        projection: 'awaiting_confirmation',
        projectionReason: '推送完成，等待创建合并请求确认',
        steps,
      });
      this.#store.events.publish('task.delivery.updated', { taskId, deliveryId: delivery.id, revision: updated!.revision, projection: updated!.projection });
      this.#commands.settle(input.requestKey, { remoteRef: result.remoteRef, pushedSha: result.pushedSha });
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: { delivery: updated!, actions: {} } };
    } catch (error) {
      this.#commands.fail(input.requestKey, error as Error);
      throw error;
    }
  }

  async createMergeRequest(taskId: string, input: { requestKey: string; sourceRef: string; pushedSha: string; targetBranch: string; expectedTargetTip: string; title: string; description: string; confirmMergeRequest: true }): Promise<CommandResponse<DeliveryResponse>> {
    const delivery = this.get(taskId);
    const task = this.#requireTask(taskId);
    const project = this.#requireProject(task.projectId);
    if (this.#git.createMergeRequest === undefined) throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, '当前未配置 GitHub/GitLab 连接，无法创建合并请求');
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'task.delivery.mergeRequest.create',
      body: { taskId, sourceRef: input.sourceRef, pushedSha: input.pushedSha, targetBranch: input.targetBranch, expectedTargetTip: input.expectedTargetTip, title: input.title, description: input.description, confirmMergeRequest: true },
      target: { taskId },
    });
    if (replayed && record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record), resource: { delivery: this.get(taskId), actions: {} } };
    try {
      const mr = await this.#git.createMergeRequest({
        repoRoot: project.rootPath,
        sourceBranch: input.sourceRef,
        targetBranch: input.targetBranch,
        title: input.title,
        description: input.description,
      });
      const steps = updateStep(delivery.steps, {
        step: 'mergeRequest',
        state: 'succeeded',
        requestKey: input.requestKey,
        settledAt: nowIso(),
        mrIid: mr.iid,
        mrWebUrl: mr.webUrl,
      });
      const updated = this.#store.deliveries.update(delivery.id, {
        projection: 'delivered',
        projectionReason: '任务已交付',
        steps,
        taskCompletionRef: `mr:${mr.iid}`,
        verificationOutcome: delivery.verificationOutcome ?? 'not_run',
      });
      this.#store.tasks.update(taskId, { attention: TaskAttention.NONE, lifecycle: TaskLifecycle.COMPLETED });
      this.#store.events.publish('task.delivery.updated', { taskId, deliveryId: delivery.id, revision: updated!.revision, projection: 'delivered' });
      this.#store.events.publish('task.changed', { taskId, projectId: task.projectId, stage: task.stage, revision: 1 });
      this.#commands.settle(input.requestKey, { iid: mr.iid, webUrl: mr.webUrl });
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: { delivery: updated!, actions: {} } };
    } catch (error) {
      this.#commands.fail(input.requestKey, error as Error);
      throw error;
    }
  }

  async merge(taskId: string, input: DeliveryMergeRequest): Promise<CommandResponse<DeliveryResponse>> {
    const delivery = this.get(taskId);
    const task = this.#requireTask(taskId);
    const project = this.#requireProject(task.projectId);
    const commitStep = delivery.steps.find((step) => step.step === 'commit');
    const sourceSha = commitStep?.commitSha ?? input.sourceSha;
    if (commitStep?.state !== 'succeeded' || commitStep.commitSha === undefined) {
      throw new AppError(ErrorCode.DELIVERY_BLOCKED, '需要先成功提交任务变更，才能合并');
    }
    if (this.#git.mergeTaskBranch === undefined) {
      throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, '当前 Git 适配未提供合并能力');
    }
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'task.delivery.merge',
      body: { taskId, targetBranch: input.targetBranch, expectedTargetSha: input.expectedTargetSha, sourceSha, message: input.message, strategy: input.strategy, confirmMerge: true },
      target: { taskId, ref: input.targetBranch, expectedSha: input.expectedTargetSha },
    });
    if (replayed && record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record), resource: { delivery: this.get(taskId), actions: {} } };
    try {
      const result = await this.#git.mergeTaskBranch({
        repoRoot: project.rootPath,
        targetBranch: input.targetBranch,
        expectedTargetSha: input.expectedTargetSha,
        sourceSha,
        message: input.message,
        tempRoot: `${this.#context.store.dataDir}/merge-tmp`,
        strategy: input.strategy,
      });
      const steps = updateStep(delivery.steps, {
        step: 'merge',
        state: 'succeeded',
        requestKey: input.requestKey,
        settledAt: nowIso(),
        commitSha: result.mergeSha,
      });
      const updated = this.#store.deliveries.update(delivery.id, {
        projection: 'delivered',
        projectionReason: `已合并到 ${input.targetBranch}`,
        steps,
        taskCompletionRef: `merge:${result.mergeSha}`,
        verificationOutcome: delivery.verificationOutcome ?? 'not_run',
      });
      this.#store.tasks.update(taskId, { attention: 'none', lifecycle: 'completed' });
      this.#store.events.publish('task.delivery.updated', { taskId, deliveryId: delivery.id, revision: updated!.revision, projection: 'delivered' });
      this.#store.events.publish('task.changed', { taskId, projectId: task.projectId, stage: task.stage, revision: 1 });
      this.#commands.settle(input.requestKey, { mergeSha: result.mergeSha, kind: result.kind });
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: { delivery: updated!, actions: {} } };
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

function updateStep(steps: readonly DeliveryStepState[], next: DeliveryStepState): DeliveryStepState[] {
  const filtered = steps.filter((step) => step.step !== next.step);
  return [...filtered, next];
}
