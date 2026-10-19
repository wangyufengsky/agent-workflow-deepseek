/* Git 仓库页 + 任务交付面板的读写口。
 *
 * 这里只面对服务端应用操作（见 @agent-workflow/shared 的 ROUTES / 契约）。
 * renderer 从不接触路径、revspec、远端 URL、令牌或 git 命令；只发送服务签发
 * 的 id（projectId / sha / fileId / reviewRunId / fixRunId / findingId）与用户
 * 可编辑字段（提交信息、MR 标题与描述），并随写操作发送 requestKey。
 *
 * 回执规则：每条写命令都返回 { receipt }，状态可能是 accepted / succeeded /
 * failed / unknown。UNKNOWN 只能通过 operations.by-key 核对原 requestKey，
 * 本模块不提供任何自动重发入口。
 */

import {
  ROUTES,
  createRequestKey,
  type ActionAvailability,
  type CommandResponse,
  type DeliveryCommitRequest,
  type DeliveryMergeRequestRequest,
  type DeliveryPushRequest,
  type DeliveryResponse,
  type DeliverySelectRequest,
  type DiffPage,
  type FileChange,
  type FixCommitRequest,
  type FixDiscardRequest,
  type FixFileRevertRequest,
  type FixMergeRequestRequest,
  type FixPushRequest,
  type FixResponse,
  type FixRun,
  type FixStartRequest,
  type GitBranchesResponse,
  type GitBranch,
  type GitCommit,
  type GitCommitFilesResponse,
  type GitCommitResponse,
  type GitCommitSummary,
  type GitCommitsResponse,
  type GitDiffResponse,
  type GitFetchRequest,
  type GitMergeRequestsResponse,
  type GitOverviewResponse,
  type GitRepo,
  type GitRepoResponse,
  type OperationReceipt,
  type OperationsByKeyResponse,
  type ProjectDetailResponse,
  type ReviewFindingUpdateRequest,
  type ReviewResponse,
  type ReviewRun,
  type ReviewStartRequest,
  type TaskChanges,
  type TaskDelivery,
  type TaskDetailResponse,
} from '@agent-workflow/shared';
import { ApiClientError, apiGet, apiPost, isServiceUnavailable } from './client.ts';

/* ------------------------------------------------------------------ */
/* 查询键                                                              */
/* ------------------------------------------------------------------ */

export const gitKeys = {
  overview: ['git', 'overview'] as const,
  repo: (projectId: string) => ['git', projectId, 'repo'] as const,
  commits: (projectId: string, ref: string | null) => ['git', projectId, 'commits', ref] as const,
  commit: (projectId: string, sha: string) => ['git', projectId, 'commit', sha] as const,
  commitFiles: (projectId: string, sha: string, compareId: string | null) =>
    ['git', projectId, 'commit', sha, 'files', compareId] as const,
  diff: (projectId: string, fileId: string, ignoreWhitespace: boolean) =>
    ['git', projectId, 'diff', fileId, ignoreWhitespace] as const,
  branches: (projectId: string) => ['git', projectId, 'branches'] as const,
  mergeRequests: (projectId: string) => ['git', projectId, 'mergeRequests'] as const,
  review: (projectId: string, reviewRunId: string) => ['git', projectId, 'review', reviewRunId] as const,
  fix: (projectId: string, fixRunId: string) => ['git', projectId, 'fix', fixRunId] as const,
  fixDiff: (projectId: string, fixRunId: string, fileId: string) =>
    ['git', projectId, 'fix', fixRunId, 'diff', fileId] as const,
  operation: (requestKey: string) => ['operations', requestKey] as const,
  projectDetail: (projectId: string) => ['project', projectId, 'detail'] as const,
  taskDetail: (taskId: string) => ['task', taskId, 'detail'] as const,
  taskChanges: (taskId: string) => ['task', taskId, 'changes'] as const,
  delivery: (taskId: string) => ['task', taskId, 'delivery'] as const,
};

/* ------------------------------------------------------------------ */
/* 失败分类                                                            */
/* ------------------------------------------------------------------ */

export type GitFailureKind = 'not_connected' | 'unavailable' | 'failed';

/**
 * 区分三种失败，界面文案不同：
 * - `not_connected`：服务端还没有注册该路由（HTTP 404 且不是应用错误信封），
 *   页面显示「未接通」并禁用动作，绝不拿示例数据填充；
 * - `unavailable`：本地服务未启动 / 超时 / 5xx；
 * - `failed`：业务读取或校验失败，显示服务给出的原因。
 */
export function classifyGitFailure(error: unknown): GitFailureKind {
  if (isServiceUnavailable(error)) return 'unavailable';
  if (error instanceof ApiClientError && error.kind === 'http' && error.status === 404 && error.code === null) {
    return 'not_connected';
  }
  return 'failed';
}

export function failureKindLabel(kind: GitFailureKind): string {
  switch (kind) {
    case 'not_connected':
      return '接口未接通';
    case 'unavailable':
      return '服务未连接';
    case 'failed':
      return '读取失败';
  }
}

export function failureKindDetail(kind: GitFailureKind): string {
  switch (kind) {
    case 'not_connected':
      return '服务端还没有提供这个 Git 读口；本页不会显示示例数据。等接口接通后重新加载即可。';
    case 'unavailable':
      return '无法连接本地服务（默认 127.0.0.1:5177）。请启动后端后重试；连接前不展示示例数据。';
    case 'failed':
      return '服务明确返回了失败原因，见下方详情。';
  }
}

/* ------------------------------------------------------------------ */
/* 查询参数                                                            */
/* ------------------------------------------------------------------ */

type QueryValue = string | number | boolean | undefined;

function queryString(params: Readonly<Record<string, QueryValue>>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text.length === 0 ? '' : `?${text}`;
}

/* ------------------------------------------------------------------ */
/* Git 读口                                                            */
/* ------------------------------------------------------------------ */

export async function fetchGitOverview(): Promise<GitOverviewResponse> {
  const response = await apiGet<GitOverviewResponse>(ROUTES.gitOverview);
  return response.data;
}

export async function fetchGitRepo(projectId: string): Promise<GitRepoResponse> {
  const response = await apiGet<GitRepoResponse>(ROUTES.gitRepo(projectId));
  return response.data;
}

export interface GitCommitsOptions {
  readonly ref?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export async function fetchGitCommits(projectId: string, options: GitCommitsOptions = {}): Promise<GitCommitsResponse> {
  const query = queryString({ ref: options.ref, limit: options.limit, cursor: options.cursor });
  const response = await apiGet<GitCommitsResponse>(`${ROUTES.gitCommits(projectId)}${query}`);
  return response.data;
}

export async function fetchGitCommit(projectId: string, sha: string): Promise<GitCommit> {
  const response = await apiGet<GitCommitResponse>(ROUTES.gitCommit(projectId, sha));
  return response.data.commit;
}

export async function fetchGitCommitFiles(
  projectId: string,
  sha: string,
  compareId?: string,
): Promise<GitCommitFilesResponse> {
  const query = queryString({ compareId });
  const response = await apiGet<GitCommitFilesResponse>(`${ROUTES.gitCommitFiles(projectId, sha)}${query}`);
  return response.data;
}

export interface GitDiffOptions {
  /** 文件路径（服务端以 path 选择文件；不传 fileId）。 */
  readonly path: string;
  readonly baseSha?: string;
  readonly headSha?: string;
  readonly ignoreWhitespace?: boolean;
  readonly cursor?: string;
}

export async function fetchGitDiff(projectId: string, options: GitDiffOptions): Promise<DiffPage> {
  const query = queryString({
    path: options.path,
    baseSha: options.baseSha,
    headSha: options.headSha,
    ignoreWhitespace: options.ignoreWhitespace,
    cursor: options.cursor,
  });
  const response = await apiGet<GitDiffResponse>(`${ROUTES.gitDiff(projectId)}${query}`);
  return response.data.diff;
}

export async function fetchGitBranches(projectId: string): Promise<readonly GitBranch[]> {
  const response = await apiGet<GitBranchesResponse>(ROUTES.gitBranches(projectId));
  return response.data.branches;
}

export async function fetchGitMergeRequests(projectId: string): Promise<GitMergeRequestsResponse> {
  const response = await apiGet<GitMergeRequestsResponse>(ROUTES.gitMergeRequests(projectId));
  return response.data;
}

export async function fetchReview(projectId: string, reviewRunId: string): Promise<ReviewRun> {
  const response = await apiGet<ReviewResponse>(ROUTES.review(projectId, reviewRunId));
  return response.data.review;
}

export async function fetchFix(projectId: string, fixRunId: string): Promise<FixRun> {
  const response = await apiGet<FixResponse>(ROUTES.fix(projectId, fixRunId));
  return response.data.fix;
}

/**
 * 修复副本的差异：以 fixRunId 选择服务私有的修复 worktree（renderer 传不了路径）。
 * 路由沿用 `fix.read` 资源下的 diff 子路径；未接通时面板显示原因并禁用加载全部。
 */
export async function fetchFixDiff(
  projectId: string,
  fixRunId: string,
  file: Pick<FileChange, 'path'>,
  ignoreWhitespace = false,
  cursor?: string,
): Promise<DiffPage> {
  const query = queryString({ path: file.path, ignoreWhitespace, cursor });
  const response = await apiGet<GitDiffResponse>(`${ROUTES.fix(projectId, fixRunId)}/diff${query}`);
  return response.data.diff;
}

export async function fetchOperationByKey(requestKey: string): Promise<OperationsByKeyResponse> {
  const response = await apiGet<OperationsByKeyResponse>(ROUTES.operationsByKey(requestKey));
  return response.data;
}

/* ------------------------------------------------------------------ */
/* Git 命令（回执）                                                     */
/* ------------------------------------------------------------------ */

export async function fetchRemote(projectId: string, remote = 'origin'): Promise<CommandResponse> {
  const body: GitFetchRequest = { requestKey: createRequestKey(), projectId, remote };
  const response = await apiPost<CommandResponse>(ROUTES.gitFetch(projectId), body);
  return response.data;
}

export interface StartReviewInput {
  readonly projectId: string;
  readonly sha: string;
  readonly compareId: string;
  readonly dimensions: readonly string[];
  readonly context: 'diff_only' | 'diff_and_related';
  readonly professionId: string;
  readonly professionRevision: string;
}

export async function startReview(input: StartReviewInput): Promise<CommandResponse<ReviewResponse>> {
  const body: ReviewStartRequest = {
    requestKey: createRequestKey(),
    projectId: input.projectId,
    sha: input.sha,
    compareId: input.compareId,
    dimensions: [...input.dimensions],
    context: input.context,
    professionId: input.professionId,
    professionRevision: input.professionRevision,
  };
  const response = await apiPost<CommandResponse<ReviewResponse>>(ROUTES.reviewStart(input.projectId), body);
  return response.data;
}

export async function stopReview(projectId: string, reviewRunId: string): Promise<CommandResponse> {
  const response = await apiPost<CommandResponse>(ROUTES.reviewStop(projectId, reviewRunId), {
    requestKey: createRequestKey(),
    projectId,
    reviewRunId,
  });
  return response.data;
}

export interface UpdateFindingInput {
  readonly projectId: string;
  readonly findingId: string;
  readonly status: 'accepted' | 'dismissed' | 'false_positive' | 'open';
  readonly reason?: string;
}

export async function updateFinding(input: UpdateFindingInput): Promise<CommandResponse> {
  const body: ReviewFindingUpdateRequest = {
    requestKey: createRequestKey(),
    projectId: input.projectId,
    findingId: input.findingId,
    status: input.status,
    reason: input.reason,
  };
  const response = await apiPost<CommandResponse>(ROUTES.reviewFinding(input.projectId, input.findingId), body);
  return response.data;
}

export interface StartFixInput {
  readonly projectId: string;
  readonly reviewRunId: string;
  readonly findingIds: readonly string[];
  readonly baseBranch: string;
  readonly expectedBaseTip: string;
  readonly professionId: string;
  readonly professionRevision: string;
}

export async function startFix(input: StartFixInput): Promise<CommandResponse<FixResponse>> {
  const body: FixStartRequest = {
    requestKey: createRequestKey(),
    projectId: input.projectId,
    reviewRunId: input.reviewRunId,
    findingIds: [...input.findingIds],
    baseBranch: input.baseBranch,
    expectedBaseTip: input.expectedBaseTip,
    professionId: input.professionId,
    professionRevision: input.professionRevision,
  };
  const response = await apiPost<CommandResponse<FixResponse>>(ROUTES.fixStart(input.projectId), body);
  return response.data;
}

/** `fix.file.revert`——修复资源下的文件动作（服务端按 fixRunId 解析 worktree）。 */
export async function revertFixFile(
  projectId: string,
  fixRunId: string,
  fileId: string,
  expectedFixRevision: string,
): Promise<CommandResponse<FixResponse>> {
  const body: FixFileRevertRequest = {
    requestKey: createRequestKey(),
    projectId,
    fixRunId,
    fileId,
    expectedFixRevision,
  };
  const response = await apiPost<CommandResponse<FixResponse>>(
    `${ROUTES.fix(projectId, fixRunId)}/files/${encodeURIComponent(fileId)}/revert`,
    body,
  );
  return response.data;
}

export interface FixCommitInput {
  readonly projectId: string;
  readonly fixRunId: string;
  readonly message: string;
  readonly fileIds: readonly string[];
  readonly expectedFixRevision: string;
  readonly confirmVerifyFailed?: boolean;
}

export async function commitFix(input: FixCommitInput): Promise<CommandResponse<FixResponse>> {
  const body: FixCommitRequest = {
    requestKey: createRequestKey(),
    projectId: input.projectId,
    fixRunId: input.fixRunId,
    message: input.message,
    fileIds: [...input.fileIds],
    expectedFixRevision: input.expectedFixRevision,
    ...(input.confirmVerifyFailed === true ? { confirmVerifyFailed: true } : {}),
  };
  const response = await apiPost<CommandResponse<FixResponse>>(`${ROUTES.fix(input.projectId, input.fixRunId)}/commit`, body);
  return response.data;
}

export async function pushFix(
  projectId: string,
  fixRunId: string,
  expectedLocalSha: string,
): Promise<CommandResponse<FixResponse>> {
  const body: FixPushRequest = {
    requestKey: createRequestKey(),
    projectId,
    fixRunId,
    expectedLocalSha,
  };
  const response = await apiPost<CommandResponse<FixResponse>>(`${ROUTES.fix(projectId, fixRunId)}/push`, body);
  return response.data;
}

export interface FixMergeRequestInput {
  readonly projectId: string;
  readonly fixRunId: string;
  readonly targetBranch: string;
  readonly title: string;
  readonly description: string;
}

export async function createFixMergeRequest(input: FixMergeRequestInput): Promise<CommandResponse<FixResponse>> {
  const body: FixMergeRequestRequest = {
    requestKey: createRequestKey(),
    projectId: input.projectId,
    fixRunId: input.fixRunId,
    targetBranch: input.targetBranch,
    title: input.title,
    description: input.description,
  };
  const response = await apiPost<CommandResponse<FixResponse>>(
    `${ROUTES.fix(input.projectId, input.fixRunId)}/merge-request`,
    body,
  );
  return response.data;
}

export async function discardFix(projectId: string, fixRunId: string): Promise<CommandResponse<FixResponse>> {
  const body: FixDiscardRequest = {
    requestKey: createRequestKey(),
    projectId,
    fixRunId,
    confirmDiscard: true,
  };
  const response = await apiPost<CommandResponse<FixResponse>>(`${ROUTES.fix(projectId, fixRunId)}/discard`, body);
  return response.data;
}

/* ------------------------------------------------------------------ */
/* 任务交付                                                            */
/* ------------------------------------------------------------------ */

export async function fetchTaskDetail(taskId: string): Promise<TaskDetailResponse> {
  const response = await apiGet<TaskDetailResponse>(ROUTES.taskDetail(taskId));
  return response.data;
}

export async function fetchTaskChanges(taskId: string): Promise<TaskChanges> {
  const response = await apiGet<{ changes: TaskChanges }>(ROUTES.changes(taskId));
  return response.data.changes;
}

export async function fetchTaskDelivery(taskId: string): Promise<DeliveryResponse> {
  const response = await apiGet<DeliveryResponse>(ROUTES.delivery(taskId));
  return response.data;
}

export async function fetchProjectDetail(projectId: string): Promise<ProjectDetailResponse> {
  const response = await apiGet<ProjectDetailResponse>(ROUTES.project(projectId));
  return response.data;
}

export interface DeliverySelectInput {
  readonly taskId: string;
  readonly goal: DeliverySelectRequest['goal'];
  readonly fileIds: readonly string[];
  readonly changesRevision: string;
  readonly expectedDeliveryRevision?: string;
}

export async function selectDelivery(input: DeliverySelectInput): Promise<CommandResponse<DeliveryResponse>> {
  const body: DeliverySelectRequest = {
    requestKey: createRequestKey(),
    goal: input.goal,
    fileIds: [...input.fileIds],
    changesRevision: input.changesRevision,
    ...(input.expectedDeliveryRevision === undefined
      ? {}
      : { expectedDeliveryRevision: input.expectedDeliveryRevision }),
  };
  const response = await apiPost<CommandResponse<DeliveryResponse>>(ROUTES.deliverySelect(input.taskId), body);
  return response.data;
}

export interface DeliveryCommitInput {
  readonly taskId: string;
  readonly fileIds: readonly string[];
  readonly message: string;
  readonly expectedChangesRevision: string;
  readonly expectedBranchHead: string;
}

export async function commitDelivery(input: DeliveryCommitInput): Promise<CommandResponse<DeliveryResponse>> {
  const body: DeliveryCommitRequest = {
    requestKey: createRequestKey(),
    fileIds: [...input.fileIds],
    message: input.message,
    expectedChangesRevision: input.expectedChangesRevision,
    expectedBranchHead: input.expectedBranchHead,
    confirmCommit: true,
  };
  const response = await apiPost<CommandResponse<DeliveryResponse>>(ROUTES.deliveryCommit(input.taskId), body);
  return response.data;
}

export interface DeliveryPushInput {
  readonly taskId: string;
  readonly expectedLocalSha: string;
  readonly remoteBranchName: string;
}

export async function pushDelivery(input: DeliveryPushInput): Promise<CommandResponse<DeliveryResponse>> {
  const body: DeliveryPushRequest = {
    requestKey: createRequestKey(),
    expectedLocalSha: input.expectedLocalSha,
    remoteBranchName: input.remoteBranchName,
    expectRemote: 'absent',
    confirmPush: true,
  };
  const response = await apiPost<CommandResponse<DeliveryResponse>>(ROUTES.deliveryPush(input.taskId), body);
  return response.data;
}

export interface DeliveryMergeRequestInput {
  readonly taskId: string;
  readonly sourceRef: string;
  readonly pushedSha: string;
  readonly targetBranch: string;
  readonly expectedTargetTip: string;
  readonly title: string;
  readonly description: string;
}

export async function createDeliveryMergeRequest(
  input: DeliveryMergeRequestInput,
): Promise<CommandResponse<DeliveryResponse>> {
  const body: DeliveryMergeRequestRequest = {
    requestKey: createRequestKey(),
    sourceRef: input.sourceRef,
    pushedSha: input.pushedSha,
    targetBranch: input.targetBranch,
    expectedTargetTip: input.expectedTargetTip,
    title: input.title,
    description: input.description,
    confirmMergeRequest: true,
  };
  const response = await apiPost<CommandResponse<DeliveryResponse>>(ROUTES.deliveryMergeRequest(input.taskId), body);
  return response.data;
}

/* ------------------------------------------------------------------ */
/* 回执工具                                                            */
/* ------------------------------------------------------------------ */

export type ReceiptState = OperationReceipt['status'];

export interface ReceiptView {
  readonly requestKey: string;
  readonly status: ReceiptState;
  readonly operation: string;
  readonly acceptedAt: string;
  readonly settledAt?: string;
  readonly error?: { readonly code: string; readonly message: string; readonly output?: string };
}

export function toReceiptView(receipt: OperationReceipt): ReceiptView {
  return {
    requestKey: receipt.requestKey,
    status: receipt.status,
    operation: receipt.operation,
    acceptedAt: receipt.acceptedAt,
    settledAt: receipt.settledAt,
    error: receipt.error,
  };
}

/** 取命令结果里的资源：契约是 { receipt, resource }（容忍服务把资源平铺在顶层）。 */
export function commandResource<T extends object>(data: CommandResponse<T>, key: keyof T): T | undefined {
  if (data.resource !== undefined) return data.resource;
  const flat = data as unknown as T;
  return flat[key] === undefined ? undefined : flat;
}

/** 供界面显示的动作可用性：缺失时按「未知」处理，不擅自放行。 */
export function actionAllowed(actions: Record<string, ActionAvailability> | undefined, key: string): ActionAvailability {
  const action = actions?.[key];
  if (action === undefined) return { allowed: false, reason: '服务没有返回该动作的可用性，界面不会自行放行。' };
  return action;
}

/** 交付记录里的某一交付步骤。 */
export function deliveryStep(delivery: TaskDelivery | undefined, step: string) {
  return delivery?.steps.find((item) => item.step === step);
}

export type { DiffPage, FileChange, FixRun, GitBranch, GitCommit, GitCommitSummary, GitRepo, ReviewRun, TaskDelivery };
