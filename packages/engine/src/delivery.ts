import type {
  CommandResponse,
  DeliveryMergeRequestRequest,
  DeliveryMergeRequestVerifyRequest,
  DeliveryMergeRequestVerifyResponse,
  DeliveryMergeRequestFactResponse,
  DeliveryPushVerifyRequest,
  DeliveryPushVerifyResponse,
  DeliveryCommitRequest,
  DeliveryPushRequest,
  DeliveryResponse,
  DeliverySelectRequest,
  DeliveryStepState,
  GitMergeRequest,
  Task,
  TaskDelivery,
} from '@agent-workflow/shared';
import { AppError, ErrorCode, TaskAttention, TaskLifecycle, nowIso } from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';
import { readOnlyRecoveryError, type EngineContext } from './actions.ts';
import type { CommandService } from './operations.ts';
import type { GitPort, RemotePort } from './ports.ts';
import { decodeFileId, type WorkspaceService } from './workspace.ts';

export class DeliveryService {
  readonly #store: Store;
  readonly #commands: CommandService;
  readonly #context: EngineContext;
  readonly #git: GitPort;
  readonly #remote: RemotePort | undefined;
  readonly #workspaces: WorkspaceService;

  constructor(store: Store, commands: CommandService, context: EngineContext, git: GitPort, workspaces: WorkspaceService, remote?: RemotePort) {
    this.#store = store;
    this.#commands = commands;
    this.#context = context;
    this.#git = git;
    this.#remote = remote;
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
    const originalReceipt = this.#commands.replay({ requestKey: input.requestKey, operation: 'task.delivery.select', body: { taskId, goal: input.goal, fileIds: input.fileIds, changesRevision: input.changesRevision, expectedDeliveryRevision: input.expectedDeliveryRevision } }, () => { const delivery = this.#store.deliveries.byTask(taskId); return delivery === undefined ? undefined : { delivery, actions: {} }; });
    if (originalReceipt !== undefined) return originalReceipt;
    const delivery = this.get(taskId);
    const task = this.#assertWritable(taskId, '交付任务');
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
    if (replayed) return { receipt: this.#commands.toReceipt(record), resource: { delivery: this.get(taskId), actions: {} } };
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
    const originalReceipt = this.#commands.replay({ requestKey: input.requestKey, operation: 'task.delivery.commit', body: { taskId, fileIds: input.fileIds, message: input.message, expectedChangesRevision: input.expectedChangesRevision, expectedBranchHead: input.expectedBranchHead, confirmCommit: true } }, () => { const delivery = this.#store.deliveries.byTask(taskId); return delivery === undefined ? undefined : { delivery, actions: {} }; });
    if (originalReceipt !== undefined) return originalReceipt;
    if (input?.confirmCommit !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '提交任务变更需要 confirmCommit=true 确认');
    const delivery = this.get(taskId);
    const task = this.#assertWritable(taskId, '交付任务');
    const workspace = task.workspaceId === undefined ? this.#store.workspaces.byTask(taskId) : this.#store.workspaces.get(task.workspaceId);
    if (workspace?.displayRoot === undefined) throw new AppError(ErrorCode.WORKSPACE_NOT_READY, '工作区未准备完成');
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'task.delivery.commit',
      body: { taskId, fileIds: input.fileIds, message: input.message, expectedChangesRevision: input.expectedChangesRevision, expectedBranchHead: input.expectedBranchHead, confirmCommit: true },
      target: { taskId },
    });
    if (replayed) return { receipt: this.#commands.toReceipt(record), resource: { delivery: this.get(taskId), actions: {} } };
    try {
      const changes = await this.#workspaces.changes(taskId);
      if (input.expectedChangesRevision !== undefined && changes.changesRevision !== input.expectedChangesRevision) {
        throw new AppError(ErrorCode.STALE_TARGET, '内容版本已变化，请重新读取后确认', { details: { actual: changes.changesRevision } });
      }
      const selectedPaths = input.fileIds.map(decodeFileId);
      const paths = [...new Set(changes.files.filter((file) => selectedPaths.includes(file.path)).flatMap((file) => file.status === 'R' && file.oldPath !== undefined ? [file.oldPath, file.path] : [file.path]))];
      if (paths.length === 0) throw new AppError(ErrorCode.VALIDATION_FAILED, '没有选择可提交的文件');
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
        projection: (delivery.goal ?? 'local_commit') === 'local_commit' ? 'delivered' : 'awaiting_confirmation',
        projectionReason: (delivery.goal ?? 'local_commit') === 'local_commit' ? '本地提交目标已完成' : '提交完成，等待推送确认',
        ...((delivery.goal ?? 'local_commit') === 'local_commit' ? { taskCompletionRef: `commit:${commit.sha}`, verificationOutcome: delivery.verificationOutcome ?? 'not_run' } : {}),
        goal: delivery.goal ?? 'local_commit',
        steps,
      });
      this.#store.events.publish('task.delivery.updated', { taskId, deliveryId: delivery.id, revision: updated!.revision, projection: updated!.projection });
      if (updated!.projection === 'delivered') {
        this.#store.tasks.update(taskId, { attention: TaskAttention.NONE, lifecycle: TaskLifecycle.COMPLETED });
        this.#store.events.publish('task.changed', { taskId, projectId: task.projectId, stage: task.stage, revision: 1 });
      }
      this.#commands.settle(input.requestKey, { commitSha: commit.sha });
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: { delivery: updated!, changes, actions: {} } };
    } catch (error) {
      const unknown = error instanceof AppError && error.code === ErrorCode.RECEIPT_UNKNOWN;
      this.#commands.fail(input.requestKey, error as Error, unknown);
      if (unknown) {
        const updated = this.#store.deliveries.update(delivery.id, { projection: 'unknown_receipt', projectionReason: error.message, steps: updateStep(delivery.steps, { step: 'commit', state: 'unknown', requestKey: input.requestKey, settledAt: nowIso(), error: { code: error.code, message: error.message } }) });
        this.#store.events.publish('task.delivery.updated', { taskId, deliveryId: delivery.id, revision: updated!.revision, projection: 'unknown_receipt' });
      }
      throw error;
    }
  }

  async push(taskId: string, input: DeliveryPushRequest): Promise<CommandResponse<DeliveryResponse>> {
    const originalReceipt = this.#commands.replay({ requestKey: input.requestKey, operation: 'task.delivery.push', body: { taskId, expectedLocalSha: input.expectedLocalSha, remoteBranchName: input.remoteBranchName, expectRemote: input.expectRemote, confirmPush: true }, legacyBodies: [{ taskId, expectedLocalSha: input.expectedLocalSha, remoteBranchName: input.remoteBranchName, confirmPush: true }] }, () => { const delivery = this.#store.deliveries.byTask(taskId); return delivery === undefined ? undefined : { delivery, actions: {} }; });
    if (originalReceipt !== undefined) return originalReceipt;
    if (input?.confirmPush !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '推送任务分支需要 confirmPush=true 确认');
    const delivery = this.get(taskId);
    const task = this.#assertWritable(taskId, '交付任务');
    const project = this.#requireProject(task.projectId);
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'task.delivery.push',
      body: { taskId, expectedLocalSha: input.expectedLocalSha, remoteBranchName: input.remoteBranchName, expectRemote: input.expectRemote, confirmPush: true },
      target: { taskId },
    });
    if (replayed) return { receipt: this.#commands.toReceipt(record), resource: { delivery: this.get(taskId), actions: {} } };
    try {
      if (project.gitState !== 'git') throw new AppError(ErrorCode.GIT_CAPABILITY_UNAVAILABLE, '非 Git 项目不支持推送');
      const result = await this.#git.push({
        projectId: task.projectId,
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
        projection: delivery.goal === 'push_branch' ? 'delivered' : 'awaiting_confirmation',
        projectionReason: delivery.goal === 'push_branch' ? '分支推送目标已完成' : '推送完成，等待创建合并请求确认',
        ...(delivery.goal === 'push_branch' ? { taskCompletionRef: `push:${result.remoteRef}@${result.pushedSha}`, verificationOutcome: delivery.verificationOutcome ?? 'not_run' } : {}),
        steps,
      });
      this.#store.events.publish('task.delivery.updated', { taskId, deliveryId: delivery.id, revision: updated!.revision, projection: updated!.projection });
      if (updated!.projection === 'delivered') {
        this.#store.tasks.update(taskId, { attention: TaskAttention.NONE, lifecycle: TaskLifecycle.COMPLETED });
        this.#store.events.publish('task.changed', { taskId, projectId: task.projectId, stage: task.stage, revision: 1 });
      }
      this.#commands.settle(input.requestKey, { remoteRef: result.remoteRef, pushedSha: result.pushedSha });
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: { delivery: updated!, actions: {} } };
    } catch (error) {
      const unknown = remoteOutcomeUnknownReason(error);
      if (unknown !== undefined) {
        this.#recordUnknownRemoteOutcome({ taskId, delivery, requestKey: input.requestKey, operation: 'task.delivery.push', step: 'push', reason: unknown });
      }
      this.#recordRemoteFailure({ taskId, delivery, requestKey: input.requestKey, step: 'push' }, error);
      throw error;
    }
  }

  async createMergeRequest(taskId: string, input: DeliveryMergeRequestRequest): Promise<CommandResponse<DeliveryResponse>> {
    const originalReceipt = this.#commands.replay({ requestKey: input.requestKey, operation: 'task.delivery.mergeRequest.create', body: { taskId, sourceRef: input.sourceRef, pushedSha: input.pushedSha, targetBranch: input.targetBranch, expectedTargetTip: input.expectedTargetTip, title: input.title, description: input.description, confirmMergeRequest: true } }, () => { const delivery = this.#store.deliveries.byTask(taskId); return delivery === undefined ? undefined : { delivery, actions: {} }; });
    if (originalReceipt !== undefined) return originalReceipt;
    if (input?.confirmMergeRequest !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '创建合并请求需要 confirmMergeRequest=true 确认');
    let delivery = this.get(taskId);
    const task = this.#assertWritable(taskId, '交付任务');
    const project = this.#requireProject(task.projectId);
    if (this.#remote === undefined && this.#git.createMergeRequest === undefined) throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, '当前未配置 GitHub/GitLab 连接，无法创建合并请求');
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'task.delivery.mergeRequest.create',
      body: { taskId, sourceRef: input.sourceRef, pushedSha: input.pushedSha, targetBranch: input.targetBranch, expectedTargetTip: input.expectedTargetTip, title: input.title, description: input.description, confirmMergeRequest: true },
      target: { taskId },
    });
    if (replayed) return { receipt: this.#commands.toReceipt(record), resource: { delivery: this.get(taskId), actions: {} } };
    try {
      // 同一原请求/同一任务已经成功创建过合法 MR：只显示原链接，绝不创建第二个。
      const created = delivery.steps.find((step) => step.step === 'mergeRequest' && step.state === 'succeeded' && step.mrIid !== undefined && step.mrWebUrl !== undefined);
      if (created !== undefined) {
        this.#commands.settle(input.requestKey, { iid: created.mrIid, webUrl: created.mrWebUrl, existing: true, settledBy: 'delivery-step' });
        return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: { delivery: this.get(taskId), actions: {} } };
      }
      // 设计允许的“已有原操作”核对：按只读读口查找同源 → 目标的 MR（含已合并/已关闭）。
      // 打开/锁定 → 按原 MR 结算（不 POST）；已合并/已关闭 → 仅按只读事实展示，
      // 不据此把交付/任务置完成（避免把 GitLab 合并状态当成任务完成）。
      const existing = await this.#findExistingMergeRequest(project, input.sourceRef, input.targetBranch);
      const unknownStep = delivery.steps.find((step) => step.step === 'mergeRequest' && step.state === 'unknown');
      if (existing !== undefined) {
        if (existing.state === 'merged' || existing.state === 'closed') {
          const stateLabel = existing.state === 'merged' ? '已合并' : '已关闭';
          throw new AppError(
            ErrorCode.DELIVERY_BLOCKED,
            `远端已有同源 → 目标合并请求 !${existing.iid}（GitLab 只读事实：${stateLabel}）；不会重复创建，也不会仅凭该状态把任务置完成。请到 GitLab 核对后人工确认交付。`,
            { details: { iid: existing.iid, webUrl: existing.webUrl, state: existing.state, neverCompletedByReadback: true } },
          );
        }
        const updated = this.#settleExistingMergeRequest(task, delivery, input.requestKey, existing);
        this.#commands.settle(input.requestKey, { iid: existing.iid, webUrl: existing.webUrl, existing: true, settledBy: 'remote-lookup' });
        return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: { delivery: updated, actions: {} } };
      }
      // 原创建回执 UNKNOWN 且远端没有可识别的同源 MR：不判定“未创建”、不重复 POST。
      if (unknownStep !== undefined) {
        throw new AppError(
          ErrorCode.RECEIPT_UNKNOWN,
          '原创建回执未知，且未发现打开中的同源 → 目标合并请求（可能已被合并/关闭，或列表读取不完整，请到 GitLab 核对）；不会重复创建，也不会判定原请求未创建。',
          { httpStatus: 409, details: { requestKey: unknownStep.requestKey, notFoundIsNotProof: true } },
        );
      }
      // 原请求标记写进 MR 说明，供之后按原请求核对（GitLab 侧可审计）；不重复追加。
      const marker = `<!-- agent-workflow:delivery:${taskId}:${input.requestKey} -->`;
      const description = input.description.includes('agent-workflow:delivery:') ? input.description : `${input.description}${input.description.trim() === '' ? '' : '\n\n'}${marker}`;
      const mr = this.#remote !== undefined
        ? await this.#remote.createMergeRequest(task.projectId, { sourceBranch: input.sourceRef, targetBranch: input.targetBranch, title: input.title, description })
        : await this.#git.createMergeRequest!({ repoRoot: project.rootPath, sourceBranch: input.sourceRef, targetBranch: input.targetBranch, title: input.title, description });
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
      const unknown = remoteOutcomeUnknownReason(error);
      if (unknown !== undefined) {
        this.#recordUnknownRemoteOutcome({ taskId, delivery, requestKey: input.requestKey, operation: 'task.delivery.mergeRequest.create', step: 'mergeRequest', reason: unknown });
      }
      this.#recordRemoteFailure({ taskId, delivery, requestKey: input.requestKey, step: 'mergeRequest' }, error);
      throw error;
    }
  }

  /**
   * 「核对原操作」：MR 创建回执未知时，只读按远端事实核对，不重复 POST。
   * - 找到以该已推送源分支为源的打开 MR：按已有原 MR 结算交付；
   * - 没找到：把原未知步结算为明确失败（远端未创建），允许用户重新发起新请求。
   */
  async verifyMergeRequest(taskId: string, input: DeliveryMergeRequestVerifyRequest): Promise<CommandResponse<DeliveryMergeRequestVerifyResponse>> {
    const originalReceipt = this.#commands.replay({ requestKey: input.requestKey, operation: 'task.delivery.mergeRequest.verify', body: { taskId, targetRequestKey: input.targetRequestKey, confirmVerify: true } }, (record) => ({ found: false, delivery: this.get(taskId), note: record.status === 'succeeded' ? '已核对' : '核对中' }));
    if (originalReceipt !== undefined) return originalReceipt;
    if (input?.confirmVerify !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '核对合并请求创建回执需要 confirmVerify=true 确认');
    const delivery = this.get(taskId);
    const task = this.#assertWritable(taskId, '核对交付回执');
    const project = this.#requireProject(task.projectId);
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'task.delivery.mergeRequest.verify',
      body: { taskId, targetRequestKey: input.targetRequestKey, confirmVerify: true },
      target: { taskId },
    });
    if (replayed) return { receipt: this.#commands.toReceipt(record), resource: { found: false, delivery: this.get(taskId), note: '原请求已结算' } };
    try {
      const unknownStep = delivery.steps.find((step) => step.step === 'mergeRequest' && step.state === 'unknown' && (input.targetRequestKey === undefined || step.requestKey === input.targetRequestKey));
      if (unknownStep === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '没有待核对的合并请求创建回执');
      const sourceRef = delivery.steps.find((step) => step.step === 'push')?.remoteRef;
      if (sourceRef === undefined) throw new AppError(ErrorCode.DELIVERY_BLOCKED, '没有已推送的源分支，无法按远端事实核对合并请求');
      const existing = await this.#findExistingMergeRequest(project, sourceRef, undefined);
      if (existing !== undefined) {
        if (existing.state === 'opened' || existing.state === 'locked') {
          const updated = this.#settleExistingMergeRequest(task, delivery, unknownStep.requestKey ?? input.requestKey, existing);
          this.#commands.settle(input.requestKey, { found: true, iid: existing.iid, webUrl: existing.webUrl, state: existing.state });
          return {
            receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!),
            resource: { found: true, delivery: updated, mergeRequest: existing, note: '已核对远端：存在以该源分支为源的打开合并请求，按原 MR 结算交付，不会重复创建。' },
          };
        }
        // 已合并/已关闭：只记只读事实，不据此把任务置完成（Lead 定；交付结算需人工确认）。
        const stateLabel = existing.state === 'merged' ? '已合并' : '已关闭';
        const steps = updateStep(delivery.steps, {
          step: 'mergeRequest',
          state: 'succeeded',
          requestKey: unknownStep.requestKey ?? input.requestKey,
          settledAt: nowIso(),
          mrIid: existing.iid,
          mrWebUrl: existing.webUrl,
        });
        const updated = this.#store.deliveries.update(delivery.id, {
          projection: 'awaiting_confirmation',
          projectionReason: `已核对到原合并请求 !${existing.iid}（GitLab 只读事实：${stateLabel}）；不据此把任务置完成，交付事实需人工确认`,
          steps,
        })!;
        this.#store.events.publish('task.delivery.updated', { taskId, deliveryId: delivery.id, revision: updated.revision, projection: updated.projection });
        this.#commands.settle(input.requestKey, { found: true, iid: existing.iid, webUrl: existing.webUrl, state: existing.state, noCompletionByReadback: true });
        return {
          receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!),
          resource: {
            found: true,
            delivery: updated,
            mergeRequest: existing,
            note: `已核对到原合并请求 !${existing.iid}（GitLab 只读事实：${stateLabel}）；不会重复创建，也不会仅凭该状态把任务置完成。交付事实保持待人工确认，请到 GitLab 核对。`,
          },
        };
      }
      const message = `未发现打开中的同源 → 目标合并请求（可能已被合并/关闭，或列表读取不完整，请到 GitLab 核对）；不会判定原请求未创建，也不会重复 POST。`;
      const updated = this.#store.deliveries.update(delivery.id, { projection: 'unknown_receipt', projectionReason: message })!;
      this.#store.events.publish('task.delivery.updated', { taskId, deliveryId: delivery.id, revision: updated.revision, projection: updated.projection });
      this.#commands.settle(input.requestKey, { found: false, notFoundIsNotProof: true });
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: { found: false, delivery: updated, note: message } };
    } catch (error) {
      this.#commands.fail(input.requestKey, error as Error);
      throw error;
    }
  }

  /**
   * 「核对原推送」：推送回执未知时只读远端事实（fetch + 远端分支 tip 比对），不重发推送。
   * - 远端存在 tip 等于已提交 SHA 的分支：按已推送结算（不重新 push）；
   * - 远端没有该提交：原未知步结算为明确失败，允许用新请求重新推送；
   * - 远端读取失败（认证/网络）：保持未知，只提示稍后再核对，绝不判定失败。
   */
  async verifyPush(taskId: string, input: DeliveryPushVerifyRequest): Promise<CommandResponse<DeliveryPushVerifyResponse>> {
    const originalReceipt = this.#commands.replay({ requestKey: input.requestKey, operation: 'task.delivery.push.verify', body: { taskId, targetRequestKey: input.targetRequestKey, confirmVerify: true } }, () => ({ found: false, delivery: this.get(taskId), note: '原请求已结算' }));
    if (originalReceipt !== undefined) return originalReceipt;
    if (input?.confirmVerify !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '核对推送回执需要 confirmVerify=true 确认');
    const delivery = this.get(taskId);
    const task = this.#assertWritable(taskId, '核对交付回执');
    const project = this.#requireProject(task.projectId);
    if (this.#git.fetch === undefined) throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, '当前 Git 适配不提供远端读取，无法核对推送回执');
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'task.delivery.push.verify',
      body: { taskId, targetRequestKey: input.targetRequestKey, confirmVerify: true },
      target: { taskId },
    });
    if (replayed) return { receipt: this.#commands.toReceipt(record), resource: { found: false, delivery: this.get(taskId), note: '原请求已结算' } };
    try {
      const unknownStep = delivery.steps.find((step) => step.step === 'push' && step.state === 'unknown' && (input.targetRequestKey === undefined || step.requestKey === input.targetRequestKey));
      if (unknownStep === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '没有待核对的推送回执');
      const commitStep = delivery.steps.find((step) => step.step === 'commit');
      const commitSha = commitStep?.commitSha;
      if (commitSha === undefined) throw new AppError(ErrorCode.DELIVERY_BLOCKED, '没有已成功的提交，无法按远端事实核对推送');
      try {
        await this.#git.fetch({ projectId: task.projectId, repoRoot: project.rootPath, remote: 'origin' });
      } catch (error) {
        // 只读核对失败不是推送失败：保留 UNKNOWN，不结算、不重发。
        throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, `读取远端失败，推送结果仍未知；稍后再核对原推送，不会重发。${error instanceof Error ? `（${error.message}）` : ''}`, { details: { requestKey: unknownStep.requestKey, readonlyVerifyFailed: true } });
      }
      const branches = await this.#git.branches(project.rootPath);
      const remoteBranch = branches.find((branch) => branch.kind === 'remote' && branch.tipSha === commitSha);
      if (remoteBranch === undefined) {
        const message = `已核对远端：没有 tip 为 ${commitSha.slice(0, 10)} 的分支，原推送未生效；可用新请求重新确认推送。`;
        const steps = updateStep(delivery.steps, {
          step: 'push',
          state: 'failed',
          requestKey: unknownStep.requestKey,
          settledAt: nowIso(),
          error: { code: ErrorCode.PUSH_REJECTED_NON_FF, message },
        });
        const updated = this.#store.deliveries.update(delivery.id, { projection: 'blocked', projectionReason: message, steps })!;
        this.#store.events.publish('task.delivery.updated', { taskId, deliveryId: delivery.id, revision: updated.revision, projection: 'blocked' });
        this.#commands.settle(input.requestKey, { found: false });
        return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: { found: false, delivery: updated, note: message } };
      }
      const remoteRef = `refs/heads/${remoteBranch.name.replace(/^origin\//, '')}`;
      const steps = updateStep(delivery.steps, {
        step: 'push',
        state: 'succeeded',
        requestKey: unknownStep.requestKey,
        settledAt: nowIso(),
        remoteRef,
        pushedSha: commitSha,
      });
      const delivered = delivery.goal === 'push_branch';
      const updated = this.#store.deliveries.update(delivery.id, {
        projection: delivered ? 'delivered' : 'awaiting_confirmation',
        projectionReason: delivered ? '分支推送目标已完成' : '推送完成，等待创建合并请求确认',
        ...(delivered ? { taskCompletionRef: `push:${remoteRef}@${commitSha}`, verificationOutcome: delivery.verificationOutcome ?? 'not_run' } : {}),
        steps,
      })!;
      this.#store.events.publish('task.delivery.updated', { taskId, deliveryId: delivery.id, revision: updated.revision, projection: updated.projection });
      if (delivered) {
        this.#store.tasks.update(taskId, { attention: TaskAttention.NONE, lifecycle: TaskLifecycle.COMPLETED });
        this.#store.events.publish('task.changed', { taskId, projectId: task.projectId, stage: task.stage, revision: 1 });
      }
      const note = `已核对远端：${remoteBranch.name} 指向 ${commitSha.slice(0, 10)}，按已推送结算，未重新推送。`;
      this.#commands.settle(input.requestKey, { found: true, remoteRef, pushedSha: commitSha });
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: { found: true, delivery: updated, remoteRef, note } };
    } catch (error) {
      this.#commands.fail(input.requestKey, error as Error);
      throw error;
    }
  }

  /**
   * 已交付任务的 MR 状态：GitLab 只读事实，独立于任务交付记录（DEL-12）。
   * 未配置连接 / 读不到时不伪造状态，返回 available=false + 原因。
   */
  async mergeRequestFact(taskId: string): Promise<DeliveryMergeRequestFactResponse> {
    const delivery = this.get(taskId);
    const mrStep = delivery.steps.find((step) => step.step === 'mergeRequest' && step.mrIid !== undefined);
    if (mrStep?.mrIid === undefined) return { available: false, reason: '该交付没有合并请求回执' };
    if (this.#remote === undefined) return { available: false, reason: '未配置 GitHub/GitLab 连接，无法读取 MR 状态（不代表 MR 未合并）' };
    const task = this.#requireTask(taskId);
    let list: readonly GitMergeRequest[];
    try {
      list = await this.#remote.listMergeRequests(task.projectId, 'all');
    } catch (error) {
      return { available: false, reason: `读取 GitLab MR 失败：${error instanceof Error ? error.message : '未知错误'}；交付事实不受影响` };
    }
    const mr = list.find((candidate) => candidate.iid === mrStep.mrIid);
    if (mr === undefined) return { available: false, reason: 'GitLab 未返回该 MR（可能地址或权限已变化）；交付事实不受影响' };
    return {
      available: true,
      mergeRequest: {
        iid: mr.iid,
        webUrl: mr.webUrl,
        state: mr.state,
        sourceBranch: mr.sourceBranch,
        targetBranch: mr.targetBranch,
        updatedAt: mr.updatedAt,
      },
    };
  }

  /**
   * Read-only lookup of an existing merge request for this source branch.
   * Returns the first opened (or locked) MR: creating a second one would duplicate
   * an external side effect, so an unreadable remote is an explicit refusal, not a
   * silent blind create.
   */
  async #findExistingMergeRequest(
    project: { readonly id: string; readonly rootPath: string },
    sourceRef: string,
    targetBranch: string | undefined,
  ): Promise<{ readonly iid: number; readonly webUrl: string; readonly state: string } | undefined> {
    // 同源 → 目标视为同一原 MR，包含已合并/已关闭：缺了它们会把“已被手动合并/关闭”
    // 误判成“原请求未创建”。是否结算由调用方按 state 决定（合并/关闭不置任务完成）。
    const pick = (list: readonly GitMergeRequest[]) => list.find((mr) =>
      mr.sourceBranch === sourceRef
      && (targetBranch === undefined || mr.targetBranch === targetBranch));
    const unreachable = (error: unknown) => new AppError(
      ErrorCode.CAPABILITY_UNAVAILABLE,
      '无法读取已有合并请求，为避免重复创建，本次不创建；请稍后重试或到 GitLab 核对。',
      { details: { reason: error instanceof Error ? error.message : 'remote read failed' } },
    );
    if (this.#remote !== undefined) {
      let list: readonly GitMergeRequest[];
      try {
        list = await this.#remote.listMergeRequests(project.id, 'all');
      } catch (error) {
        throw unreachable(error);
      }
      const hit = pick(list);
      return hit === undefined ? undefined : { iid: hit.iid, webUrl: hit.webUrl, state: hit.state };
    }
    if (this.#git.mergeRequests !== undefined) {
      let list: readonly GitMergeRequest[];
      try {
        list = await this.#git.mergeRequests(project.rootPath);
      } catch (error) {
        throw unreachable(error);
      }
      const hit = pick(list);
      return hit === undefined ? undefined : { iid: hit.iid, webUrl: hit.webUrl, state: hit.state };
    }
    throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, '当前 Git 适配不支持读取已有合并请求，无法安全创建（避免重复创建）');
  }

  /** Settle the delivery from an existing legal MR receipt: read back, never re-POST. */
  #settleExistingMergeRequest(
    task: Task,
    delivery: TaskDelivery,
    requestKey: string,
    mr: { readonly iid: number; readonly webUrl: string },
  ): TaskDelivery {
    const steps = updateStep(delivery.steps, {
      step: 'mergeRequest',
      state: 'succeeded',
      requestKey,
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
    })!;
    this.#store.tasks.update(task.id, { attention: TaskAttention.NONE, lifecycle: TaskLifecycle.COMPLETED });
    this.#store.events.publish('task.delivery.updated', { taskId: task.id, deliveryId: delivery.id, revision: updated.revision, projection: 'delivered' });
    this.#store.events.publish('task.changed', { taskId: task.id, projectId: task.projectId, stage: task.stage, revision: 1 });
    return updated;
  }

  /** Read-only recovery drafts may be viewed, never delivered. */
  #assertWritable(taskId: string, action: string) {
    const task = this.#requireTask(taskId);
    if (task.readOnly === true) throw readOnlyRecoveryError(action);
    return task;
  }

  /**
   * A remote write that timed out or got no usable answer may still have taken
   * effect remotely. Settle the receipt UNKNOWN, mark the delivery step unknown
   * and the projection `unknown_receipt` instead of claiming a definite failure;
   * the caller reconciles by requestKey and nothing is retried automatically.
   */
  #recordUnknownRemoteOutcome(input: {
    readonly taskId: string;
    readonly delivery: TaskDelivery;
    readonly requestKey: string;
    readonly operation: string;
    readonly step: 'push' | 'mergeRequest';
    readonly reason: RemoteWriteUnknownReason;
  }): never {
    const label = input.step === 'push' ? '推送' : '创建合并请求';
    const reasonLabel = input.reason === 'timeout' ? '请求超时' : input.reason === 'network_error' ? '网络连接失败' : '远端响应无法判定';
    const message = `${label}结果未明（${reasonLabel}），远端可能已成功；不会自动重发，请按 requestKey 核对后再操作。`;
    const error = new AppError(ErrorCode.RECEIPT_UNKNOWN, message, {
      httpStatus: 409,
      details: { requestKey: input.requestKey, operation: input.operation, outcomeUnknown: true, reason: input.reason },
    });
    this.#commands.fail(input.requestKey, error, true);
    const steps = updateStep(input.delivery.steps, {
      step: input.step,
      state: 'unknown',
      requestKey: input.requestKey,
      settledAt: nowIso(),
      error: { code: ErrorCode.RECEIPT_UNKNOWN, message },
    });
    const updated = this.#store.deliveries.update(input.delivery.id, { projection: 'unknown_receipt', projectionReason: message, steps });
    this.#store.events.publish('task.delivery.updated', { taskId: input.taskId, deliveryId: input.delivery.id, revision: updated!.revision, projection: 'unknown_receipt' });
    throw error;
  }

  /** A definite remote rejection stays a failure and blocks the delivery step. */
  #recordRemoteFailure(
    input: { readonly taskId: string; readonly delivery: TaskDelivery; readonly requestKey: string; readonly step: 'push' | 'mergeRequest' },
    error: unknown,
  ): void {
    const message = error instanceof Error ? error.message : '远端操作失败';
    const code = error instanceof AppError ? error.code : ErrorCode.INTERNAL_ERROR;
    const steps = updateStep(input.delivery.steps, {
      step: input.step,
      state: 'failed',
      requestKey: input.requestKey,
      settledAt: nowIso(),
      error: { code, message },
    });
    const updated = this.#store.deliveries.update(input.delivery.id, { projection: 'blocked', projectionReason: message, steps });
    this.#store.events.publish('task.delivery.updated', { taskId: input.taskId, deliveryId: input.delivery.id, revision: updated!.revision, projection: 'blocked' });
    this.#commands.fail(input.requestKey, error instanceof Error ? error : new Error('远端操作失败'));
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


export type RemoteWriteUnknownReason = 'timeout' | 'network_error' | 'undetermined';

/**
 * Classify a remote-write error by whether the request may still have taken
 * effect remotely. Definite business rejections (auth, non-fast-forward,
 * conflict, 4xx payloads) stay `failed`; timeouts, network loss and an
 * unparseable response for a write are undetermined and must settle `unknown`.
 *
 * The same helper is exported for the HTTP `git fetch` command (whose route
 * lives outside this module) so a timeout is not reported as a definite failure.
 */
export function remoteOutcomeUnknownReason(error: unknown): RemoteWriteUnknownReason | undefined {
  if (!(error instanceof AppError)) {
    if (error instanceof Error && /timed out|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|fetch failed/i.test(error.message)) {
      return 'undetermined';
    }
    return undefined;
  }
  if (error.code === ErrorCode.NETWORK_UNREACHABLE) {
    return error.details?.['reason'] === 'timeout' ? 'timeout' : 'network_error';
  }
  // We sent a write and could not parse the answer: the side effect is unknown.
  if (error.code === ErrorCode.UNSUPPORTED_FORMAT) return 'undetermined';
  // The local git CLI surfaces a killed/timed-out child as INTERNAL_ERROR without
  // a machine-readable reason; for a remote write that is undetermined, not failed.
  if (error.code === ErrorCode.INTERNAL_ERROR) return 'undetermined';
  return undefined;
}
