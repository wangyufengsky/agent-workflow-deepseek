import { join, resolve } from 'node:path';
import type {
  ActionAvailability,
  CatalogSnapshot,
  ChangeStatusValue,
  CommandResponse,
  DeliveryStepState,
  FileChange,
  FixCommitRequest,
  FixDiscardRequest,
  FixFileRevertRequest,
  FixMergeRequestRequest,
  FixOutcomeValue,
  FixPushRequest,
  FixResponse,
  FixRun,
  FixRunStateValue,
  FixStartRequest,
  GitBranch,
  GitPerson,
  ModelProfile,
  Project,
  ReviewFinding,
  ReviewRun,
  Revision,
} from '@agent-workflow/shared';
import {
  AppError,
  DEFAULT_CATALOG,
  ErrorCode,
  FixOutcome,
  FixRunState,
  Rationale,
  createId,
  nowIso,
} from '@agent-workflow/shared';
import type { SessionSink } from '@agent-workflow/opencode';
import type { Store } from '@agent-workflow/storage';
import { allowed, denied, type EngineContext } from './actions.ts';
import type { CommandService } from './operations.ts';
import type { GitPort, OpenCodePort } from './ports.ts';
import { extractJsonObject } from './review.ts';
import { decodeFileId } from './workspace.ts';

/**
 * AI fix in an isolated worktree on an `ai-fix/*` branch.
 *
 * The user worktree, index, current branch and stash are never touched. Every
 * write step (commit / push / merge request / discard / revert) is its own
 * request-key command with its own receipt; nothing chains automatically and
 * nothing is retried. Authoritative changes always come from the Git port, not
 * from the model's claims.
 */

const AI_FIX_BRANCH_PREFIX = 'ai-fix/';
const WORKTREE_SETTING_PREFIX = 'fix.worktree.';
const ACTIVE_FIX_STATES: readonly FixRunStateValue[] = [
  FixRunState.PREPARING,
  FixRunState.EDITING,
  FixRunState.VERIFYING,
  FixRunState.READY,
  FixRunState.STOPPING,
  FixRunState.UNKNOWN,
];
const IN_PROGRESS_FIX_STATES: readonly FixRunStateValue[] = [FixRunState.PREPARING, FixRunState.EDITING, FixRunState.VERIFYING];
const MAX_PROMPT_FINDINGS = 40;

export interface StoredFixWorktree {
  readonly path: string;
  readonly branch: string;
  readonly baseSha: string;
  readonly createdAt: string;
}

/** Server-owned restore capability (the engine Git port has no restore method). */
export interface FixWorkspacePort {
  restoreFile(input: {
    readonly worktreePath: string;
    readonly path: string;
    readonly status: ChangeStatusValue;
    readonly oldPath?: string;
  }): Promise<void>;
}

/** Structural subset of the server RemotePort used for merge requests. */
export interface FixRemotePort {
  createMergeRequest(projectId: string, input: {
    readonly sourceBranch: string;
    readonly targetBranch: string;
    readonly title: string;
    readonly description: string;
  }): Promise<{ readonly iid: number; readonly webUrl: string }>;
}

export interface FixServiceOptions {
  readonly store: Store;
  readonly commands: CommandService;
  readonly context: EngineContext;
  readonly git: GitPort;
  readonly opencode: OpenCodePort;
  readonly catalog?: CatalogSnapshot;
  readonly workspace?: FixWorkspacePort;
  readonly remote?: FixRemotePort;
  /** Override for tests; defaults to the execution node timeout. */
  readonly timeoutMs?: number;
}

export const FIX_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'outcomes'],
  properties: {
    summary: { type: 'string', description: '一句话说明改了什么' },
    outcomes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['findingId', 'outcome', 'relocation'],
        properties: {
          findingId: { type: 'string' },
          outcome: { type: 'string', enum: ['fixed', 'partial', 'not_fixed'] },
          relocation: { type: 'string', enum: ['exact', 'moved', 'not_found'] },
          reason: { type: 'string' },
        },
      },
    },
    verification: {
      type: 'object',
      additionalProperties: false,
      properties: {
        state: { type: 'string', enum: ['passed', 'failed', 'not_configured', 'error'] },
        passed: { type: 'integer', minimum: 0 },
        failed: { type: 'integer', minimum: 0 },
        summary: { type: 'string' },
      },
    },
  },
};

export const FIX_SYSTEM_PROMPT = `你是「修复工程师（repairer）」，在服务提供的隔离修复副本里修改代码，修复指定的审查问题。
硬性规则：
1. 只修改与给定问题相关的文件；不要提交、不要推送、不要切换分支、不要删除仓库或 .git，不要访问网络。
2. 所有写操作必须通过 MCP 工具：workspace.file.read / workspace.file.list / workspace.file.write / workspace.exec。
   这些工具的 taskId 参数一律填本次修复的 fixRunId（服务会解析到修复副本）。原生编辑/命令工具已被禁用。
3. 不要修改修复副本之外的任何路径；不要尝试修改用户工作区。
4. 如果某个问题无法修复，不要编造改动：把该问题的 outcome 设为 not_fixed 并说明 reason。
5. 最终回复只输出一个 JSON 对象，不要 Markdown 代码块、不要解释：
   {"summary":"改了什么","outcomes":[{"findingId":"...","outcome":"fixed|partial|not_fixed","relocation":"exact|moved|not_found","reason":"..."}],"verification":{"state":"passed|failed|not_configured","summary":"..."}}
   verification 只在你确实运行了校验命令时提供；没有运行就不要提供。`;

export class FixService {
  readonly #store: Store;
  readonly #commands: CommandService;
  readonly #context: EngineContext;
  readonly #git: GitPort;
  readonly #opencode: OpenCodePort;
  readonly #catalog: CatalogSnapshot;
  readonly #workspace: FixWorkspacePort | undefined;
  readonly #remote: FixRemotePort | undefined;
  readonly #timeoutMs: number | undefined;
  readonly #startKeys = new Map<string, string>();
  readonly #stopKeys = new Map<string, string>();
  readonly #pendingStarts = new Set<string>();
  readonly #sessions = new Map<string, string>();

  constructor(options: FixServiceOptions) {
    this.#store = options.store;
    this.#commands = options.commands;
    this.#context = options.context;
    this.#git = options.git;
    this.#opencode = options.opencode;
    this.#catalog = options.catalog ?? DEFAULT_CATALOG;
    this.#workspace = options.workspace;
    this.#remote = options.remote;
    this.#timeoutMs = options.timeoutMs;
  }

  async start(projectId: string, input: FixStartRequest): Promise<CommandResponse<FixResponse>> {
    if (input === null || typeof input !== 'object') throw new AppError(ErrorCode.VALIDATION_FAILED, '修复请求体不合法');
    const project = this.#requireProject(projectId);
    this.#assertGitProject(project);
    const review = this.#requireReview(projectId, requireNonEmpty(input.reviewRunId, '审查记录'));
    if (review.state !== 'completed') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '审查尚未完成，不能开始修复', { details: { reviewState: review.state } });
    }
    const findings = this.#selectFindings(review, input.findingIds);
    const profession = this.#resolveProfession(input.professionId, input.professionRevision);
    const model = this.#requireModel(['repairer', 'coder']);
    this.#assertOpencodeUsable();
    const baseBranch = normalizeBranchName(requireNonEmpty(input.baseBranch, '基线分支'));
    const expectedBaseTip = requireNonEmpty(input.expectedBaseTip, '基线提交');
    if (!/^[0-9a-f]{7,40}$/i.test(expectedBaseTip)) throw new AppError(ErrorCode.VALIDATION_FAILED, '基线提交必须是一个 SHA');
    const settings = this.#context.settings();
    const branches = await this.#git.branches(project.rootPath);
    const base = resolveBaseBranch(branches, baseBranch);
    if (base === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, `基线分支不存在：${baseBranch}`);
    if (base.tipSha !== expectedBaseTip) {
      throw new AppError(ErrorCode.STALE_TARGET, '基线分支已前移，请重新读取后确认', {
        details: { expected: expectedBaseTip, actual: base.tipSha },
      });
    }
    const commitsAfterReviewed = await this.#commitsAfterReviewed(project.rootPath, baseBranch, review.subject.commitSha, base.tipSha);

    const fixRunId = createId('fix');
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'fix.start',
      body: {
        projectId,
        reviewRunId: review.reviewRunId,
        findingIds: input.findingIds,
        baseBranch,
        expectedBaseTip,
        professionId: profession.professionId,
        professionRevision: profession.revision,
        model: model.id,
      },
      target: { projectId, ref: baseBranch, expectedSha: expectedBaseTip },
      resultResource: { kind: 'git', id: fixRunId },
    });
    if (replayed) {
      const existingId = record.resultResource?.id;
      const existing = existingId === undefined ? undefined : this.#store.fixes.get(existingId);
      if (existing !== undefined) return { receipt: this.#commands.toReceipt(record), resource: { fix: existing } };
      if (record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record) };
      throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '同一请求号已受理但还没有修复记录；请按 requestKey 核对回执', {
        details: { requestKey: input.requestKey },
      });
    }

    const guardKey = `${projectId}:${baseBranch}`;
    const active = this.#activeFix(projectId, baseBranch);
    if (active !== undefined || this.#pendingStarts.has(guardKey)) {
      const conflict = new AppError(ErrorCode.OPERATION_IN_PROGRESS, '该基线分支已有进行中的修复；请先完成或放弃它', {
        details: active === undefined ? { baseBranch } : { fixRunId: active.fixRunId, state: active.state },
      });
      this.#commands.fail(input.requestKey, conflict);
      throw conflict;
    }
    this.#pendingStarts.add(guardKey);

    const fixBranch = this.#allocateBranch(branches, base.tipSha);
    const worktreesRoot = this.#worktreesRoot();
    let handle: { path: string; handle: string; branch: string; headSha: string };
    try {
      handle = await this.#git.createWorktree({
        repoRoot: project.rootPath,
        worktreesRoot,
        taskId: fixRunId,
        baseRef: baseBranch,
        baseSha: base.tipSha,
        branch: fixBranch,
      });
    } catch (error) {
      this.#pendingStarts.delete(guardKey);
      this.#commands.fail(input.requestKey, error as Error);
      throw error;
    }
    try {
      this.#store.settings.putJson(`${WORKTREE_SETTING_PREFIX}${fixRunId}`, {
        path: handle.path,
        branch: handle.branch,
        baseSha: base.tipSha,
        createdAt: nowIso(),
      } satisfies StoredFixWorktree);
    } catch (error) {
      this.#pendingStarts.delete(guardKey);
      this.#commands.fail(input.requestKey, error as Error);
      throw error;
    }

    const verifyCommand = resolveVerifyCommand(project, settings.git.defaultTestCommand);
    const fix: FixRun = {
      fixRunId,
      projectId,
      executionId: createId('exec'),
      reviewRunId: review.reviewRunId,
      findingIds: findings.map((finding) => finding.findingId),
      base: { branch: baseBranch, tipSha: base.tipSha, reviewedSha: review.subject.commitSha, commitsAfterReviewed },
      fixBranch: handle.branch,
      worktreeId: handle.handle,
      profession,
      verifyCommand,
      state: FixRunState.PREPARING,
      outcomes: [],
      steps: [],
      commitDraft: { message: draftCommitMessage(review, ''), author: toGitPerson(settings.git.author) },
      fixRevision: '1',
      actions: {},
    };
    let created: FixRun;
    try {
      created = this.#store.fixes.create({ ...fix, actions: fixActions(fix) });
    } catch (error) {
      this.#pendingStarts.delete(guardKey);
      this.#commands.fail(input.requestKey, error as Error);
      throw error;
    }
    this.#pendingStarts.delete(guardKey);
    this.#startKeys.set(fixRunId, input.requestKey);
    this.#publish(created);
    void this.#run(created.fixRunId).catch((error: unknown) => {
      this.#fail(created.fixRunId, error, false);
    });
    return {
      receipt: this.#commands.toReceipt(record),
      resource: { fix: this.#store.fixes.get(created.fixRunId) ?? created },
    };
  }

  get(projectId: string, fixRunId: string): FixRun {
    return this.#requireFix(projectId, fixRunId);
  }

  list(projectId: string): readonly FixRun[] {
    this.#requireProject(projectId);
    return this.#store.fixes.listByProject(projectId);
  }

  async diff(projectId: string, fixRunId: string, path: string, ignoreWhitespace = false, cursor?: string) {
    const fix = this.#requireFix(projectId, fixRunId);
    if (fix.changes === undefined) throw new AppError(ErrorCode.WORKSPACE_NOT_READY, '修复还没有产生变更');
    const file = fix.changes.files.find((item) => item.path === path);
    if (file === undefined) throw new AppError(ErrorCode.NOT_FOUND, '文件不在本次修复的变更集内', { details: { path } });
    return this.#git.diffPage({
      worktreePath: await this.#worktreePath(fix),
      baseSha: fix.base.tipSha,
      path,
      ignoreWhitespace,
      cursor,
    });
  }

  async stop(projectId: string, fixRunId: string, input: { readonly requestKey: string }): Promise<CommandResponse<FixResponse>> {
    const fix = this.#requireFix(projectId, fixRunId);
    if (!IN_PROGRESS_FIX_STATES.includes(fix.state)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '修复已结束，无需停止', { details: { state: fix.state } });
    }
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'fix.stop',
      body: { projectId, fixRunId },
      target: { projectId, ref: fix.fixBranch },
    });
    if (replayed && record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record), resource: { fix: this.#requireFix(projectId, fixRunId) } };
    if (fix.state !== FixRunState.STOPPING) {
      const updated = this.#store.fixes.update({
        ...fix,
        state: FixRunState.STOPPING,
        fixRevision: nextFixRevision(fix.fixRevision),
        actions: fixActions({ ...fix, state: FixRunState.STOPPING }),
      });
      this.#publish(updated);
    }
    this.#stopKeys.set(fixRunId, input.requestKey);
    const sessionId = this.#sessions.get(fixRunId);
    if (sessionId !== undefined) await this.#opencode.abortSession(sessionId).catch(() => undefined);
    return {
      receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey) ?? record),
      resource: { fix: this.#requireFix(projectId, fixRunId) },
    };
  }

  async revertFile(projectId: string, fixRunId: string, input: FixFileRevertRequest): Promise<CommandResponse<FixResponse>> {
    const fix = this.#requireFix(projectId, fixRunId);
    if (fix.state !== FixRunState.READY) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '只有就绪且未提交的修复才能撤销文件', { details: { state: fix.state } });
    }
    if (stepOf(fix, 'commit')?.state === 'succeeded') throw new AppError(ErrorCode.VALIDATION_FAILED, '修复已提交，不能撤销单个文件');
    if (input.expectedFixRevision !== fix.fixRevision) {
      throw new AppError(ErrorCode.STALE_TARGET, '修复内容已变化，请重新读取后确认', { details: { expected: input.expectedFixRevision, actual: fix.fixRevision } });
    }
    const file = this.#findFile(fix, requireNonEmpty(input.fileId, '文件引用'));
    if (this.#workspace === undefined) throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, '当前服务未提供撤销文件能力');
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'fix.file.revert',
      body: { projectId, fixRunId, fileId: input.fileId, expectedFixRevision: input.expectedFixRevision },
      target: { projectId, ref: fix.fixBranch },
    });
    if (replayed && record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record), resource: { fix: this.#requireFix(projectId, fixRunId) } };
    try {
      await this.#workspace.restoreFile({
        worktreePath: await this.#worktreePath(fix),
        path: file.path,
        status: file.status,
        ...(file.oldPath === undefined ? {} : { oldPath: file.oldPath }),
      });
      const changes = await this.#readChanges(fix);
      const ready = changes.files.length > 0;
      const next: FixRun = {
        ...fix,
        state: ready ? FixRunState.READY : FixRunState.NO_CHANGES,
        changes,
        fixRevision: nextFixRevision(fix.fixRevision),
      };
      const updated = this.#store.fixes.update({ ...next, actions: fixActions(next) });
      this.#commands.settle(input.requestKey, { fileId: input.fileId, fixRevision: updated.fixRevision, files: changes.files.length });
      this.#publish(updated);
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: { fix: updated } };
    } catch (error) {
      this.#failCommand(input.requestKey, error);
      throw error;
    }
  }

  async commit(projectId: string, fixRunId: string, input: FixCommitRequest): Promise<CommandResponse<FixResponse>> {
    const fix = this.#requireFix(projectId, fixRunId);
    if (fix.state === FixRunState.NO_CHANGES) throw new AppError(ErrorCode.FIX_NO_CHANGES, '没有可提交的修复改动');
    if (fix.state !== FixRunState.READY) throw new AppError(ErrorCode.VALIDATION_FAILED, '修复尚未就绪，不能提交', { details: { state: fix.state } });
    if (stepOf(fix, 'commit')?.state === 'succeeded') throw new AppError(ErrorCode.VALIDATION_FAILED, '本次修复已经提交过');
    if (input.expectedFixRevision !== fix.fixRevision) {
      throw new AppError(ErrorCode.STALE_TARGET, '修复内容已变化，请重新读取后确认', { details: { expected: input.expectedFixRevision, actual: fix.fixRevision } });
    }
    if (fix.verification?.state === 'failed' && input.confirmVerifyFailed !== true) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '校验未通过；确认仍要提交时需要显式确认');
    }
    const changes = fix.changes;
    if (changes === undefined || changes.files.length === 0) throw new AppError(ErrorCode.FIX_NO_CHANGES, '没有可提交的修复改动');
    const paths = input.fileIds.map((fileId) => this.#findFile(fix, fileId).path);
    if (paths.length === 0) throw new AppError(ErrorCode.VALIDATION_FAILED, '没有选择可提交的文件');
    const message = requireNonEmpty(input.message, '提交信息').slice(0, 4_000);
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'fix.commit',
      body: {
        projectId,
        fixRunId,
        message,
        fileIds: input.fileIds,
        expectedFixRevision: input.expectedFixRevision,
        confirmVerifyFailed: input.confirmVerifyFailed === true,
      },
      target: { projectId, ref: fix.fixBranch, expectedSha: fix.base.tipSha },
    });
    if (replayed && record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record), resource: { fix: this.#requireFix(projectId, fixRunId) } };
    try {
      const commit = await this.#git.commit({
        worktreePath: await this.#worktreePath(fix),
        filePaths: paths,
        message,
        author: this.#context.settings().git.author,
        expectedHeadSha: fix.base.tipSha,
      });
      const steps = setStep(fix.steps, {
        step: 'commit',
        state: 'succeeded',
        requestKey: input.requestKey,
        settledAt: nowIso(),
        commitSha: commit.sha,
      });
      const next: FixRun = {
        ...fix,
        steps,
        fixRevision: nextFixRevision(fix.fixRevision),
        commitDraft: fix.commitDraft === undefined ? undefined : { ...fix.commitDraft, message },
      };
      const updated = this.#store.fixes.update({ ...next, actions: fixActions(next) });
      this.#commands.settle(input.requestKey, { fixRunId, commitSha: commit.sha, files: paths.length });
      this.#publish(updated);
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: { fix: updated } };
    } catch (error) {
      this.#recordStepFailure(fix, 'commit', input.requestKey, error);
      this.#failCommand(input.requestKey, error);
      throw error;
    }
  }

  async push(projectId: string, fixRunId: string, input: FixPushRequest): Promise<CommandResponse<FixResponse>> {
    const fix = this.#requireFix(projectId, fixRunId);
    const project = this.#requireProject(projectId);
    const commitStep = stepOf(fix, 'commit');
    if (commitStep?.state !== 'succeeded' || commitStep.commitSha === undefined) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '需要先成功提交修复，才能推送');
    }
    if (input.expectedLocalSha !== commitStep.commitSha) {
      throw new AppError(ErrorCode.STALE_TARGET, '本地修复提交已变化，请重新读取', {
        details: { expected: input.expectedLocalSha, actual: commitStep.commitSha },
      });
    }
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'fix.push',
      body: { projectId, fixRunId, expectedLocalSha: input.expectedLocalSha },
      target: { projectId, ref: fix.fixBranch },
    });
    if (replayed && record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record), resource: { fix: this.#requireFix(projectId, fixRunId) } };
    if (fix.fixBranch.startsWith('-')) throw new AppError(ErrorCode.VALIDATION_FAILED, '修复分支名不合法');
    try {
      const result = await this.#git.push({
        repoRoot: project.rootPath,
        localSha: input.expectedLocalSha,
        remote: 'origin',
        remoteRef: `refs/heads/${fix.fixBranch}`,
      });
      const steps = setStep(fix.steps, {
        step: 'push',
        state: 'succeeded',
        requestKey: input.requestKey,
        settledAt: nowIso(),
        remoteRef: result.remoteRef,
        pushedSha: result.pushedSha,
      });
      const next: FixRun = { ...fix, steps, fixRevision: nextFixRevision(fix.fixRevision) };
      const updated = this.#store.fixes.update({ ...next, actions: fixActions(next) });
      this.#commands.settle(input.requestKey, { remoteRef: result.remoteRef, pushedSha: result.pushedSha, created: result.created });
      this.#publish(updated);
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: { fix: updated } };
    } catch (error) {
      this.#recordStepFailure(fix, 'push', input.requestKey, error);
      this.#failCommand(input.requestKey, error);
      throw error;
    }
  }

  async createMergeRequest(projectId: string, fixRunId: string, input: FixMergeRequestRequest): Promise<CommandResponse<FixResponse>> {
    const fix = this.#requireFix(projectId, fixRunId);
    const project = this.#requireProject(projectId);
    const pushStep = stepOf(fix, 'push');
    if (pushStep?.state !== 'succeeded') throw new AppError(ErrorCode.VALIDATION_FAILED, '需要先成功推送修复分支，才能创建合并请求');
    const targetBranch = normalizeBranchName(requireNonEmpty(input.targetBranch, '目标分支'));
    const title = requireNonEmpty(input.title, '合并请求标题').slice(0, 300);
    const description = typeof input.description === 'string' ? input.description.slice(0, 10_000) : '';
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'fix.mergeRequest.create',
      body: { projectId, fixRunId, targetBranch, title, description },
      target: { projectId, ref: fix.fixBranch },
    });
    if (replayed && record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record), resource: { fix: this.#requireFix(projectId, fixRunId) } };
    try {
      let mr: { iid: number; webUrl: string };
      if (this.#remote !== undefined) {
        mr = await this.#remote.createMergeRequest(projectId, {
          sourceBranch: fix.fixBranch,
          targetBranch,
          title,
          description,
        });
      } else if (this.#git.createMergeRequest !== undefined) {
        mr = await this.#git.createMergeRequest({
          repoRoot: project.rootPath,
          sourceBranch: fix.fixBranch,
          targetBranch,
          title,
          description,
        });
      } else {
        throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, '当前未配置 GitHub/GitLab 连接，无法创建合并请求');
      }
      const steps = setStep(fix.steps, {
        step: 'mergeRequest',
        state: 'succeeded',
        requestKey: input.requestKey,
        settledAt: nowIso(),
        mrIid: mr.iid,
        mrWebUrl: mr.webUrl,
      });
      const next: FixRun = { ...fix, steps, fixRevision: nextFixRevision(fix.fixRevision) };
      const updated = this.#store.fixes.update({ ...next, actions: fixActions(next) });
      this.#commands.settle(input.requestKey, { iid: mr.iid, webUrl: mr.webUrl, targetBranch });
      this.#publish(updated);
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: { fix: updated } };
    } catch (error) {
      this.#recordStepFailure(fix, 'mergeRequest', input.requestKey, error);
      this.#failCommand(input.requestKey, error);
      throw error;
    }
  }

  async discard(projectId: string, fixRunId: string, input: FixDiscardRequest): Promise<CommandResponse<FixResponse>> {
    const fix = this.#requireFix(projectId, fixRunId);
    const project = this.#requireProject(projectId);
    if (input.confirmDiscard !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '放弃修复需要显式确认');
    if (IN_PROGRESS_FIX_STATES.includes(fix.state)) {
      throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '修复仍在进行，请先停止并等待停稳再放弃', { details: { state: fix.state } });
    }
    const unresolved = fix.steps.find((step) => step.state === 'unknown' || step.state === 'in_progress');
    if (unresolved !== undefined) {
      throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, `步骤 ${unresolved.step} 结果待核对；请先按原请求号核对回执`, {
        details: { step: unresolved.step, requestKey: unresolved.requestKey },
      });
    }
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'fix.discard',
      body: { projectId, fixRunId, confirmDiscard: true },
      target: { projectId, ref: fix.fixBranch },
    });
    if (replayed && record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record), resource: { fix: this.#requireFix(projectId, fixRunId) } };
    try {
      const worktreePath = await this.#worktreePath(fix);
      await this.#git.removeWorktree({ repoRoot: project.rootPath, worktreePath, branch: fix.fixBranch, deleteBranch: true });
      this.#deleteWorktreeSetting(fixRunId);
      const next: FixRun = { ...fix, state: FixRunState.DISCARDED, fixRevision: nextFixRevision(fix.fixRevision) };
      const updated = this.#store.fixes.update({ ...next, actions: fixActions(next) });
      this.#startKeys.delete(fixRunId);
      this.#stopKeys.delete(fixRunId);
      this.#sessions.delete(fixRunId);
      this.#commands.settle(input.requestKey, { fixRunId, discarded: true, remoteBranchRetained: true });
      this.#publish(updated);
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: { fix: updated } };
    } catch (error) {
      this.#failCommand(input.requestKey, error);
      throw error;
    }
  }

  async #run(fixRunId: string): Promise<void> {
    const original = this.#store.fixes.get(fixRunId);
    if (original === undefined) return;
    const project = this.#requireProject(original.projectId);
    const startKey = this.#startKeys.get(fixRunId);
    try {
      const editing: FixRun = { ...original, state: FixRunState.EDITING };
      const updatedEditing = this.#store.fixes.update({ ...editing, actions: fixActions(editing) });
      this.#publish(updatedEditing);

      const model = this.#requireModel(['repairer', 'coder']);
      const review = this.#store.reviews.get(original.reviewRunId);
      if (review === undefined) throw new AppError(ErrorCode.NOT_FOUND, '关联的审查记录不存在');
      const selected = review.findings.filter((finding) => original.findingIds.includes(finding.findingId));
      const prompt = this.#buildPrompt(original, review, selected);
      const worktreePath = await this.#worktreePath(original);
      if (this.#isStopping(fixRunId)) {
        this.#markStopped(fixRunId);
        return;
      }
      const result = await this.#opencode.runSession({
        kind: 'fix',
        metadata: { projectId: original.projectId, fixRunId, reviewRunId: original.reviewRunId },
        cwd: worktreePath,
        prompt,
        system: FIX_SYSTEM_PROMPT,
        model,
        permission: 'workspace_write',
        sink: this.#sink(fixRunId),
        timeoutMs: this.#timeoutBudget(),
        onSessionId: (sessionId) => {
          this.#sessions.set(fixRunId, sessionId);
        },
      });

      if (this.#isStopping(fixRunId)) {
        this.#markStopped(fixRunId);
        return;
      }
      if (result.outcome.timedOut) {
        this.#fail(fixRunId, new AppError(ErrorCode.MODEL_BUDGET_EXCEEDED, '修复超过时限，结果待核对'), true);
        return;
      }
      if (result.outcome.error !== undefined && result.outcome.error !== '') {
        this.#fail(fixRunId, new AppError(ErrorCode.OPENCODE_PROVIDER_FAILED, `修复会话失败：${result.outcome.error}`), false);
        return;
      }

      const parsed = extractJsonObject(result.outcome.assistantText);
      if (!isRecord(parsed) || !Array.isArray(parsed.outcomes)) {
        this.#fail(fixRunId, new AppError(ErrorCode.VALIDATION_FAILED, '模型输出不是约定的严格 JSON（缺少 outcomes 数组），本次修复按失败处理'), false);
        return;
      }
      const current = this.#store.fixes.get(fixRunId);
      if (current === undefined) return;
      const changes = await this.#readChanges(current);
      const outcomes = parseOutcomes(parsed.outcomes, current);
      const verification = parseVerification(parsed.verification, current);
      const summary = typeof parsed.summary === 'string' ? parsed.summary.trim().slice(0, 2_000) : '';
      const state = changes.files.length === 0 ? FixRunState.NO_CHANGES : FixRunState.READY;
      const next: FixRun = {
        ...current,
        state,
        outcomes,
        changes,
        ...(verification === undefined ? {} : { verification }),
        commitDraft: { message: draftCommitMessage(review, summary), author: toGitPerson(this.#context.settings().git.author) },
        fixRevision: nextFixRevision(current.fixRevision),
      };
      const updated = this.#store.fixes.update({ ...next, actions: fixActions(next) });
      this.#linkFindings(updated, outcomes);
      if (startKey !== undefined) this.#settle(startKey, { fixRunId, state, files: changes.files.length, outcomes: outcomes.length });
      this.#publish(updated);
    } catch (error) {
      if (this.#isStopping(fixRunId)) {
        this.#markStopped(fixRunId);
        return;
      }
      this.#fail(fixRunId, error, false);
    } finally {
      this.#sessions.delete(fixRunId);
    }
  }

  #fail(fixRunId: string, error: unknown, unknown: boolean): void {
    const current = this.#store.fixes.get(fixRunId);
    if (current === undefined) return;
    const failure = error instanceof AppError ? error : new AppError(ErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : '修复失败');
    const state: FixRunStateValue = unknown ? FixRunState.UNKNOWN : FixRunState.FAILED;
    const next: FixRun = { ...current, state, fixRevision: nextFixRevision(current.fixRevision) };
    const updated = this.#store.fixes.update({ ...next, actions: fixActions(next) });
    const startKey = this.#startKeys.get(fixRunId);
    if (startKey !== undefined) {
      const record = this.#commands.get(startKey);
      if (record !== undefined && record.status === 'accepted') this.#commands.fail(startKey, failure, unknown);
    }
    this.#publish(updated);
  }

  #markStopped(fixRunId: string): void {
    const current = this.#store.fixes.get(fixRunId);
    if (current === undefined) return;
    const next: FixRun = { ...current, state: FixRunState.STOPPED, fixRevision: nextFixRevision(current.fixRevision) };
    const updated = this.#store.fixes.update({ ...next, actions: fixActions(next) });
    const startKey = this.#startKeys.get(fixRunId);
    if (startKey !== undefined) {
      const record = this.#commands.get(startKey);
      if (record !== undefined && record.status === 'accepted') this.#commands.settle(startKey, { stopped: true });
    }
    const stopKey = this.#stopKeys.get(fixRunId);
    if (stopKey !== undefined) {
      const record = this.#commands.get(stopKey);
      if (record !== undefined && record.status === 'accepted') this.#commands.settle(stopKey, { stopped: true });
    }
    this.#stopKeys.delete(fixRunId);
    this.#publish(updated);
  }

  #isStopping(fixRunId: string): boolean {
    return this.#store.fixes.get(fixRunId)?.state === FixRunState.STOPPING;
  }

  #recordStepFailure(fix: FixRun, step: DeliveryStepState['step'], requestKey: string, error: unknown): void {
    const failure = error instanceof AppError ? error : undefined;
    const steps = setStep(fix.steps, {
      step,
      state: 'failed',
      requestKey,
      error: { code: failure?.code ?? ErrorCode.INTERNAL_ERROR, message: failure?.message ?? (error instanceof Error ? error.message : '操作失败') },
    });
    const next: FixRun = { ...fix, steps, fixRevision: nextFixRevision(fix.fixRevision) };
    this.#store.fixes.update({ ...next, actions: fixActions(next) });
    this.#publish(next);
  }

  #failCommand(requestKey: string, error: unknown): void {
    this.#commands.fail(requestKey, error instanceof Error ? error : new Error('操作失败'));
  }

  #settle(requestKey: string, outcome: Record<string, unknown>): void {
    const record = this.#commands.get(requestKey);
    if (record !== undefined && record.status === 'accepted') this.#commands.settle(requestKey, outcome);
  }

  #publish(fix: FixRun): void {
    this.#store.events.publish('fix.changed', {
      projectId: fix.projectId,
      fixRunId: fix.fixRunId,
      state: fix.state,
      revision: Date.now(),
    });
  }

  #linkFindings(fix: FixRun, outcomes: readonly FixRun['outcomes'][number][]): void {
    const review = this.#store.reviews.get(fix.reviewRunId);
    if (review === undefined) return;
    const byFinding = new Map(outcomes.map((outcome) => [outcome.findingId, outcome]));
    let changed = false;
    const findings: ReviewFinding[] = review.findings.map((finding) => {
      const outcome = byFinding.get(finding.findingId);
      if (outcome === undefined) return finding;
      changed = true;
      return { ...finding, fix: { fixRunId: fix.fixRunId, outcome: outcome.outcome } };
    });
    if (!changed) return;
    const updated: ReviewRun = { ...review, findings };
    this.#store.reviews.update(updated);
    this.#store.events.publish('review.changed', {
      projectId: review.projectId,
      reviewRunId: review.reviewRunId,
      state: review.state,
      revision: Date.now(),
    });
  }

  #buildPrompt(fix: FixRun, review: ReviewRun, findings: readonly ReviewFinding[]): string {
    const settings = this.#context.settings();
    const listed = findings.slice(0, MAX_PROMPT_FINDINGS).map((finding, index) => {
      const location = finding.location === undefined
        ? '位置：未提供'
        : `位置：${finding.location.path}:${finding.location.startLine}-${finding.location.endLine}（${finding.location.side === 'new' ? '新版本' : '旧版本'}行号）`;
      return [
        `${index + 1}. [${finding.severity}/${finding.dimension}] ${finding.title}`,
        `   findingId: ${finding.findingId}`,
        `   ${location}`,
        `   详情：${finding.detail.replace(/\s+/g, ' ').slice(0, 1_500)}`,
      ].join('\n');
    }).join('\n');
    const verify = fix.verifyCommand === null ? '（项目未配置校验命令）' : fix.verifyCommand.display;
    return `# 修复任务
修复 ID：${fix.fixRunId}
项目：${fix.projectId}
审查：${review.reviewRunId}（审查提交 ${shortSha(review.subject.commitSha)}）
修复分支：${fix.fixBranch}
基线：${fix.base.branch} @ ${fix.base.tipSha}（审查后已有 ${String(fix.base.commitsAfterReviewed)} 个提交）
当前目录就是服务私有的修复副本；用户工作区不会被改动。
MCP 工具 taskId 参数：固定填写 ${fix.fixRunId}

# 需要修复的问题
${listed}

# 校验命令（可选，仅当项目配置了）
${verify}
如需运行校验，只能通过 workspace.exec（taskId=${fix.fixRunId}）执行上述命令；命令不在允许列表内会被拒绝。
不要为了让校验通过而修改无关文件或伪造输出。

# 输出
最终只输出一个 JSON 对象：
{"summary":"改了什么","outcomes":[{"findingId":"...","outcome":"fixed|partial|not_fixed","relocation":"exact|moved|not_found","reason":"..."}],"verification":{"state":"passed|failed|not_configured","summary":"..."}}
每个给定问题都要有一条 outcome。没有改动或没有运行校验时不要编造。
提交作者：${settings.git.author.name} <${settings.git.author.email}>（提交动作由用户命令触发，你不要提交）。`;
  }

  #sink(fixRunId: string): SessionSink {
    const touch = (): void => {
      const current = this.#store.fixes.get(fixRunId);
      if (current === undefined || (current.state !== FixRunState.EDITING && current.state !== FixRunState.VERIFYING)) return;
      this.#store.fixes.update({ ...current, actions: fixActions(current) });
    };
    return {
      onTool: (part) => {
        touch();
        void part;
      },
      onPermission: (permission) => {
        const writeTools = ['edit', 'bash', 'webfetch', 'websearch', 'external_directory'];
        return writeTools.includes(permission.permission) ? 'reject' : 'once';
      },
    };
  }

  #timeoutBudget(): number {
    if (this.#timeoutMs !== undefined) return this.#timeoutMs;
    const minutes = this.#context.settings().execution.nodeTimeoutMinutes;
    return Math.max(1, Number.isFinite(minutes) ? minutes : 30) * 60_000;
  }

  async #readChanges(fix: FixRun): Promise<NonNullable<FixRun['changes']>> {
    const { files, changesRevision } = await this.#git.worktreeChangedFiles({
      worktreePath: await this.#worktreePath(fix),
      baseSha: fix.base.tipSha,
    });
    return { files, worktreeRevision: changesRevision };
  }

  async #worktreePath(fix: FixRun): Promise<string> {
    const stored = this.#store.settings.getJson<StoredFixWorktree>(`${WORKTREE_SETTING_PREFIX}${fix.fixRunId}`);
    if (stored !== undefined && typeof stored.path === 'string' && stored.path.trim() !== '') return stored.path;
    return join(this.#worktreesRoot(), fix.fixRunId);
  }

  #worktreesRoot(): string {
    const configured = this.#context.settings().git.worktreeRoot;
    if (configured.startsWith('/')) return resolve(configured);
    return new URL(configured, `file://${this.#store.dataDir}/`).pathname;
  }

  #deleteWorktreeSetting(fixRunId: string): void {
    // SettingsRepository has no delete(); a direct key delete keeps the fix
    // worktree binding from outliving a discarded run.
    this.#store.db.prepare('DELETE FROM settings WHERE key = ?').run(`${WORKTREE_SETTING_PREFIX}${fixRunId}`);
  }

  #allocateBranch(branches: readonly GitBranch[], baseSha: string): string {
    const short = baseSha.slice(0, 7);
    const now = this.#clockNow();
    const stamp = `${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
    const taken = new Set(branches.map((branch) => branch.name));
    const base = `${AI_FIX_BRANCH_PREFIX}${short}-${stamp}`;
    if (!taken.has(base)) return base;
    for (let index = 2; index <= 99; index += 1) {
      const candidate = `${base}-${index}`;
      if (!taken.has(candidate)) return candidate;
    }
    throw new AppError(ErrorCode.WORKSPACE_NAME_CONFLICT, '无法分配唯一的修复分支名');
  }

  #clockNow(): Date {
    return new Date();
  }

  async #commitsAfterReviewed(rootPath: string, baseBranch: string, reviewedSha: string, tipSha: string): Promise<number> {
    if (reviewedSha === tipSha) return 0;
    const limit = 50;
    try {
      const result = await this.#git.listCommits({ rootPath, ref: baseBranch, limit });
      const index = result.commits.findIndex((commit) => commit.sha === reviewedSha);
      return index >= 0 ? index : limit;
    } catch {
      return 0;
    }
  }

  #selectFindings(review: ReviewRun, findingIds: readonly string[]): readonly ReviewFinding[] {
    if (!Array.isArray(findingIds) || findingIds.length === 0) throw new AppError(ErrorCode.VALIDATION_FAILED, '至少选择一个要修复的问题');
    const selected: ReviewFinding[] = [];
    for (const id of findingIds) {
      const finding = review.findings.find((item) => item.findingId === id);
      if (finding === undefined) throw new AppError(ErrorCode.NOT_FOUND, '问题不属于该审查', { details: { findingId: id } });
      if (finding.status === 'dismissed' || finding.status === 'false_positive') {
        throw new AppError(ErrorCode.VALIDATION_FAILED, '已忽略或标记为误报的问题不能修复', { details: { findingId: id, status: finding.status } });
      }
      if (!selected.some((item) => item.findingId === id)) selected.push(finding);
    }
    return selected;
  }

  #findFile(fix: FixRun, fileId: string): FileChange {
    const path = decodeFileId(fileId);
    const file = fix.changes?.files.find((item) => item.path === path);
    if (file === undefined) throw new AppError(ErrorCode.NOT_FOUND, '文件不在本次修复的变更集内', { details: { fileId } });
    return file;
  }

  #resolveProfession(professionId: unknown, revision: unknown): FixRun['profession'] {
    const id = requireNonEmpty(professionId, '修复职业');
    const rev = requireNonEmpty(revision, '职业版本');
    const role = this.#catalog.roles.find((item) => item.id === id);
    if (role === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '修复职业不存在或未发布', { details: { professionId: id } });
    if (role.revision !== rev) {
      throw new AppError(ErrorCode.STALE_TARGET, '修复职业版本已更新，请重新选择', { details: { professionId: id, expected: role.revision, actual: rev } });
    }
    return { professionId: id, revision: rev, displayName: role.name };
  }

  #requireModel(roles: readonly string[]): ModelProfile {
    const models = this.#context.settings().models;
    const model = models.find((item) => item.enabled && roles.some((role) => item.roles.includes(role)));
    if (model === undefined) throw new AppError(ErrorCode.MODEL_NOT_CONFIGURED, `没有启用的 ${roles.join('/')} 模型；请先在设置中配置`, { details: { roles } });
    return model;
  }

  #assertOpencodeUsable(): void {
    const status = this.#opencode.status();
    if (status.state !== 'ready' && status.state !== 'starting') {
      throw new AppError(ErrorCode.OPENCODE_NOT_READY, '受管 OpenCode 服务未就绪，无法开始修复');
    }
  }

  #activeFix(projectId: string, baseBranch: string): FixRun | undefined {
    return this.#store.fixes.listByProject(projectId).find((fix) => ACTIVE_FIX_STATES.includes(fix.state) && fix.base.branch === baseBranch);
  }

  #requireFix(projectId: string, fixRunId: string): FixRun {
    const fix = this.#store.fixes.get(fixRunId);
    if (fix === undefined || fix.projectId !== projectId) throw new AppError(ErrorCode.NOT_FOUND, '修复记录不存在');
    return fix;
  }

  #requireReview(projectId: string, reviewRunId: string): ReviewRun {
    const review = this.#store.reviews.get(reviewRunId);
    if (review === undefined || review.projectId !== projectId) throw new AppError(ErrorCode.NOT_FOUND, '审查记录不存在');
    return review;
  }

  #requireProject(projectId: string): Project {
    const project = this.#store.projects.get(projectId);
    if (project === undefined) throw new AppError(ErrorCode.NOT_FOUND, '项目不存在');
    return project;
  }

  #assertGitProject(project: Project): void {
    if (project.gitState !== 'git') throw new AppError(ErrorCode.GIT_CAPABILITY_UNAVAILABLE, '非 Git 项目不支持 AI 修复');
    if (project.rootPath.trim() === '') throw new AppError(ErrorCode.REPO_PATH_UNAVAILABLE, '项目路径不可用');
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function fixActions(fix: FixRun): Record<string, ActionAvailability> {
  const inProgress = IN_PROGRESS_FIX_STATES.includes(fix.state);
  const stopping = fix.state === FixRunState.STOPPING;
  const ready = fix.state === FixRunState.READY;
  const commitStep = stepOf(fix, 'commit');
  const pushStep = stepOf(fix, 'push');
  const mrStep = stepOf(fix, 'mergeRequest');
  const files = fix.changes?.files.length ?? 0;
  const committed = commitStep?.state === 'succeeded';
  const pushed = pushStep?.state === 'succeeded';
  const mrCreated = mrStep?.state === 'succeeded';
  return {
    stop: inProgress ? allowed() : denied(Rationale.OPERATION_IN_PROGRESS, '当前没有进行中的修复'),
    revertFile: ready && !committed && files > 0 ? allowed() : denied(committed ? 'ALREADY_COMMITTED' : Rationale.NO_CHANGES, committed ? '修复已提交，不能撤销文件' : '当前没有可撤销的文件'),
    commit: ready && !committed && files > 0 ? allowed() : denied(committed ? 'ALREADY_COMMITTED' : Rationale.NO_CHANGES, committed ? '已提交；下一步是推送' : '没有可提交的修复改动'),
    push: committed && !pushed ? allowed() : denied(committed ? 'ALREADY_PUSHED' : 'NOT_COMMITTED', committed ? '已推送；下一步是创建合并请求' : '需要先成功提交修复'),
    createMr: pushed && !mrCreated ? allowed() : denied(pushed ? 'ALREADY_CREATED' : 'NOT_PUSHED', pushed ? '已创建合并请求' : '需要先成功推送修复分支'),
    merge: denied('NOT_IMPLEMENTED', '直接合并尚未接通；请通过合并请求交付'),
    discard: !inProgress && !stopping ? allowed() : denied(Rationale.OPERATION_IN_PROGRESS, '修复进行中不能放弃；先停止并等停稳'),
  };
}

function parseOutcomes(raw: readonly unknown[], fix: FixRun): FixRun['outcomes'] {
  const outcomes: FixRun['outcomes'][number][] = [];
  let discarded = 0;
  for (const item of raw) {
    if (!isRecord(item)) {
      discarded += 1;
      continue;
    }
    const findingId = typeof item.findingId === 'string' ? item.findingId : undefined;
    const outcome = typeof item.outcome === 'string' && isFixOutcome(item.outcome) ? item.outcome : undefined;
    const relocation = item.relocation === 'exact' || item.relocation === 'moved' || item.relocation === 'not_found' ? item.relocation : undefined;
    if (findingId === undefined || outcome === undefined || !fix.findingIds.includes(findingId)) {
      discarded += 1;
      continue;
    }
    if (outcomes.some((entry) => entry.findingId === findingId)) {
      discarded += 1;
      continue;
    }
    const reason = typeof item.reason === 'string' && item.reason.trim() !== '' ? item.reason.trim().slice(0, 1_000) : undefined;
    outcomes.push({
      findingId,
      outcome,
      relocation: relocation ?? (fix.base.reviewedSha === fix.base.tipSha ? 'exact' : 'moved'),
      ...(reason === undefined ? {} : { reason }),
    });
  }
  for (const findingId of fix.findingIds) {
    if (outcomes.some((entry) => entry.findingId === findingId)) continue;
    outcomes.push({
      findingId,
      outcome: FixOutcome.NOT_FIXED,
      relocation: 'not_found',
      reason: `模型没有报告该问题的处理结果${discarded > 0 ? '（部分输出条目被丢弃）' : ''}`,
    });
  }
  return outcomes;
}

function parseVerification(raw: unknown, fix: FixRun): FixRun['verification'] {
  if (fix.verifyCommand === null) return { state: 'not_configured' };
  if (!isRecord(raw)) return undefined;
  const state = raw.state;
  if (state !== 'passed' && state !== 'failed' && state !== 'not_configured' && state !== 'error') return undefined;
  const passed = typeof raw.passed === 'number' && Number.isInteger(raw.passed) && raw.passed >= 0 ? raw.passed : undefined;
  const failed = typeof raw.failed === 'number' && Number.isInteger(raw.failed) && raw.failed >= 0 ? raw.failed : undefined;
  const summary = typeof raw.summary === 'string' && raw.summary.trim() !== '' ? raw.summary.trim().slice(0, 1_000) : undefined;
  return {
    state,
    ...(passed === undefined ? {} : { passed }),
    ...(failed === undefined ? {} : { failed }),
    summary: summary === undefined ? '模型自报的校验结果；服务没有独立执行校验命令' : `模型自报：${summary}`,
  };
}

function isFixOutcome(value: string): value is FixOutcomeValue {
  return value === FixOutcome.FIXED || value === FixOutcome.PARTIAL || value === FixOutcome.NOT_FIXED;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stepOf(fix: Pick<FixRun, 'steps'>, step: DeliveryStepState['step']): DeliveryStepState | undefined {
  return fix.steps.find((item) => item.step === step);
}

function setStep(steps: readonly DeliveryStepState[], next: DeliveryStepState): DeliveryStepState[] {
  return [...steps.filter((step) => step.step !== next.step), next];
}

function nextFixRevision(revision: Revision): Revision {
  const parsed = Number.parseInt(revision, 10);
  return String(Number.isFinite(parsed) && parsed > 0 ? parsed + 1 : 2);
}

function resolveBaseBranch(branches: readonly GitBranch[], name: string): GitBranch | undefined {
  return branches.find((branch) => branch.kind === 'local' && branch.name === name) ?? branches.find((branch) => branch.name === name);
}

function normalizeBranchName(value: string): string {
  const name = value.startsWith('refs/heads/') ? value.slice('refs/heads/'.length) : value;
  if (name === '' || name.startsWith('-') || name.includes('..') || /\s/.test(name)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, '分支名不合法');
  }
  return name;
}

function resolveVerifyCommand(project: Project, fallback: string): FixRun['verifyCommand'] {
  const configured = project.settings.testCommand?.trim();
  const display = configured !== undefined && configured !== '' ? configured : fallback.trim();
  return display === '' ? null : { display, source: 'project_config' };
}

function draftCommitMessage(review: ReviewRun, summary: string): string {
  const head = `fix: 修复审查问题（${review.subject.commitSha.slice(0, 8)}）`;
  const body = summary.trim() === '' ? '' : `\n\n${summary.trim().slice(0, 1_500)}`;
  return `${head}${body}`.slice(0, 2_000);
}

function toGitPerson(author: { readonly name: string; readonly email: string }): GitPerson {
  const initials = author.name
    .split(/\s+/)
    .filter((part) => part !== '')
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'AW';
  return { name: author.name, email: author.email, initials };
}

function requireNonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new AppError(ErrorCode.VALIDATION_FAILED, `${label}不能为空`);
  return value.trim();
}

function shortSha(sha: string): string {
  return sha.slice(0, 8);
}
