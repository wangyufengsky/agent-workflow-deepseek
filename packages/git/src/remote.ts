import type { GitConnectionStatus, GitMergeRequest, GitProviderValue } from '@agent-workflow/shared';
import { AppError, ErrorCode, GitProvider, isAppError, nowIso } from '@agent-workflow/shared';
import { REMOTE_DEFAULTS } from './config.ts';
import { RemoteHttpClient, remoteBoolean, remoteNumber, remoteObject, remoteString, type FetchLike, type TokenSource } from './http.ts';
import { redactSecrets, safeHost } from './redact.ts';
import { gitPerson } from './repository.ts';
import { isValidBranchShortName } from './validation.ts';

/* ------------------------------------------------------------------ */
/* Provider contract                                                   */
/* ------------------------------------------------------------------ */

export interface RemoteProject {
  readonly id: string;
  readonly name: string;
  readonly pathWithNamespace: string;
  readonly webUrl: string;
  readonly defaultBranch: string;
}

export type MergeRequestStateInput = 'opened' | 'merged' | 'closed' | 'all';

export interface ListMergeRequestsOptions {
  readonly state?: MergeRequestStateInput;
  /** 1..100, defaults to 30. */
  readonly limit?: number;
}

export interface CreateMergeRequestInput {
  readonly sourceBranch: string;
  readonly targetBranch: string;
  readonly title: string;
  readonly description?: string;
  readonly draft?: boolean;
  readonly removeSourceBranch?: boolean;
}

/**
 * Provider-agnostic merge-request surface used by delivery and fix flows.
 * Tokens are injected at construction; implementations never persist them.
 */
export interface RemoteProvider {
  readonly provider: GitProviderValue;
  testConnection(): Promise<GitConnectionStatus>;
  getProject(): Promise<RemoteProject>;
  getDefaultBranch(): Promise<string>;
  listMergeRequests(options?: ListMergeRequestsOptions): Promise<readonly GitMergeRequest[]>;
  createMergeRequest(input: CreateMergeRequestInput): Promise<GitMergeRequest>;
  listProtectedBranches(): Promise<readonly string[]>;
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

const DEFAULT_LIST_LIMIT = 30;
const MAX_LIST_LIMIT = 100;

function normalizeListLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LIST_LIMIT;
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIST_LIMIT) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `limit 必须是 1..${MAX_LIST_LIMIT} 的整数`);
  }
  return value;
}

function normalizeBaseUrl(value: string | undefined, fallback: string): string {
  const raw = value === undefined || value.length === 0 ? fallback : value;
  return raw.replace(/\/+$/, '');
}

function normalizeRemoteIso(value: string): string {
  if (value.length > 0 && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return nowIso();
}

async function testRemoteConnection(
  client: RemoteHttpClient,
  provider: GitProviderValue,
  probe: () => Promise<string>,
): Promise<GitConnectionStatus> {
  const base = { provider, hostDisplayName: client.hostDisplayName };
  try {
    const username = (await probe()).trim();
    return {
      ...base,
      state: 'connected',
      accountUsername: username.length > 0 ? username : undefined,
      lastVerifiedAt: nowIso(),
    };
  } catch (error) {
    if (isAppError(error)) {
      if (error.code === ErrorCode.GITLAB_AUTH_FAILED) {
        return { ...base, state: 'auth_failed', message: redactSecrets(error.message) };
      }
      if (error.code === ErrorCode.GITLAB_NOT_CONFIGURED || error.code === ErrorCode.NOT_CONFIGURED) {
        return { ...base, state: 'not_configured', message: redactSecrets(error.message) };
      }
      if (error.code === ErrorCode.NETWORK_UNREACHABLE) {
        return { ...base, state: 'unreachable', message: redactSecrets(error.message) };
      }
      return { ...base, state: 'unreachable', message: redactSecrets(error.message) };
    }
    return { ...base, state: 'unreachable', message: '远程服务校验失败' };
  }
}

function normalizeCreateInput(input: CreateMergeRequestInput): Required<Omit<CreateMergeRequestInput, 'description'>> & { readonly description: string } {
  if (!isValidBranchShortName(input.sourceBranch)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'sourceBranch 不是合法分支名');
  }
  if (!isValidBranchShortName(input.targetBranch)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'targetBranch 不是合法分支名');
  }
  const title = input.title.trim();
  if (title.length === 0) throw new AppError(ErrorCode.VALIDATION_FAILED, '合并请求标题不能为空');
  if (title.length > 255) throw new AppError(ErrorCode.VALIDATION_FAILED, '合并请求标题过长');
  return {
    sourceBranch: input.sourceBranch,
    targetBranch: input.targetBranch,
    title,
    description: input.description ?? '',
    draft: input.draft === true,
    removeSourceBranch: input.removeSourceBranch === true,
  };
}

function bodyText(parsed: unknown): string {
  const object = remoteObject(parsed);
  const pieces: string[] = [];
  for (const key of ['message', 'error', 'error_description']) {
    const value = object[key];
    if (typeof value === 'string') pieces.push(value);
  }
  const errors = object.errors;
  if (Array.isArray(errors)) {
    for (const entry of errors) {
      const message = remoteObject(entry).message;
      if (typeof message === 'string') pieces.push(message);
    }
  }
  return pieces.join(' ').toLowerCase();
}

function duplicateMergeRequest(status: number, parsed: unknown, text: string): AppError | undefined {
  if (status !== 409 && status !== 422 && status !== 400) return undefined;
  const haystack = `${bodyText(parsed)} ${text}`.toLowerCase();
  if (haystack.includes('already exists') || haystack.includes('already been taken') || haystack.includes('another open merge request')) {
    return new AppError(ErrorCode.MR_ALREADY_EXISTS, '合并请求已存在', { details: { status } });
  }
  return undefined;
}

function requireMapped(value: GitMergeRequest | undefined): GitMergeRequest {
  if (value === undefined) {
    throw new AppError(ErrorCode.UNSUPPORTED_FORMAT, '合并请求响应缺少必要字段');
  }
  return value;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/* ------------------------------------------------------------------ */
/* GitHub                                                              */
/* ------------------------------------------------------------------ */

export interface GitHubAdapterOptions {
  readonly owner: string;
  readonly repo: string;
  readonly token: TokenSource;
  readonly apiBaseUrl?: string;
  readonly webBaseUrl?: string;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
}

function assertGithubSegment(value: string, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(value)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `GitHub ${field} 非法`);
  }
  return value;
}

/** GitHub REST adapter (`/repos/{owner}/{repo}/pulls`). */
export class GitHubAdapter implements RemoteProvider {
  readonly provider = GitProvider.GITHUB;
  readonly #client: RemoteHttpClient;
  readonly #owner: string;
  readonly #repo: string;
  readonly #webBaseUrl: string;

  constructor(options: GitHubAdapterOptions) {
    this.#owner = assertGithubSegment(options.owner, 'owner');
    this.#repo = assertGithubSegment(options.repo, 'repo');
    this.#webBaseUrl = normalizeBaseUrl(options.webBaseUrl, REMOTE_DEFAULTS.github.webBaseUrl);
    this.#client = new RemoteHttpClient({
      providerLabel: 'GitHub',
      apiBaseUrl: normalizeBaseUrl(options.apiBaseUrl, REMOTE_DEFAULTS.github.apiBaseUrl),
      token: options.token,
      authStyle: 'bearer',
      notConfiguredCode: ErrorCode.NOT_CONFIGURED,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
    });
  }

  get hostDisplayName(): string {
    return this.#client.hostDisplayName;
  }

  #reposPath(suffix = ''): string {
    return `/repos/${encodeURIComponent(this.#owner)}/${encodeURIComponent(this.#repo)}${suffix}`;
  }

  async testConnection(): Promise<GitConnectionStatus> {
    return testRemoteConnection(this.#client, this.provider, async () => {
      const user = remoteObject(await this.#client.requestJson({ method: 'GET', path: '/user' }));
      return remoteString(user.login) || remoteString(user.name);
    });
  }

  async getProject(): Promise<RemoteProject> {
    const raw = remoteObject(await this.#client.requestJson({ method: 'GET', path: this.#reposPath() }));
    return {
      id: remoteString(raw.id),
      name: remoteString(raw.name),
      pathWithNamespace: remoteString(raw.full_name, `${this.#owner}/${this.#repo}`),
      webUrl: remoteString(raw.html_url, `${this.#webBaseUrl}/${this.#owner}/${this.#repo}`),
      defaultBranch: remoteString(raw.default_branch),
    };
  }

  async getDefaultBranch(): Promise<string> {
    const project = await this.getProject();
    if (project.defaultBranch.length === 0) {
      throw new AppError(ErrorCode.UNSUPPORTED_FORMAT, 'GitHub 仓库未返回默认分支');
    }
    return project.defaultBranch;
  }

  async listMergeRequests(options: ListMergeRequestsOptions = {}): Promise<readonly GitMergeRequest[]> {
    const limit = normalizeListLimit(options.limit);
    const wanted = options.state ?? 'all';
    const queryState = wanted === 'merged' ? 'closed' : wanted === 'opened' ? 'open' : wanted === 'closed' ? 'closed' : 'all';
    const raw = await this.#client.requestJson({
      method: 'GET',
      path: this.#reposPath('/pulls'),
      query: { state: queryState, per_page: limit, sort: 'updated', direction: 'desc' },
    });
    const mapped = asArray(raw)
      .map((entry) => mapGitHubPull(entry))
      .filter((entry): entry is GitMergeRequest => entry !== undefined);
    const filtered = wanted === 'merged' ? mapped.filter((entry) => entry.state === 'merged') : mapped;
    return filtered.slice(0, limit);
  }

  async createMergeRequest(input: CreateMergeRequestInput): Promise<GitMergeRequest> {
    const normalized = normalizeCreateInput(input);
    const raw = await this.#client.requestJson({
      method: 'POST',
      path: this.#reposPath('/pulls'),
      body: {
        title: normalized.title,
        head: normalized.sourceBranch,
        base: normalized.targetBranch,
        body: normalized.description,
        draft: normalized.draft,
      },
      mapStatus: duplicateMergeRequest,
    });
    return requireMapped(mapGitHubPull(raw));
  }

  async listProtectedBranches(): Promise<readonly string[]> {
    const raw = await this.#client.requestJson({
      method: 'GET',
      path: this.#reposPath('/branches'),
      query: { per_page: 100, protected: 'true' },
    });
    return asArray(raw)
      .map((entry) => remoteObject(entry))
      .filter((entry) => remoteBoolean(entry.protected))
      .map((entry) => remoteString(entry.name))
      .filter((name) => name.length > 0);
  }
}

export function mapGitHubPull(value: unknown): GitMergeRequest | undefined {
  const raw = remoteObject(value);
  const number = remoteNumber(raw.number);
  if (number <= 0) return undefined;
  const head = remoteObject(raw.head);
  const base = remoteObject(raw.base);
  const user = remoteObject(raw.user);
  const merged = (raw.merged_at !== null && raw.merged_at !== undefined) || remoteBoolean(raw.merged);
  const locked = remoteBoolean(raw.locked);
  const state: GitMergeRequest['state'] = merged ? 'merged' : remoteString(raw.state) === 'closed' ? 'closed' : locked ? 'locked' : 'opened';
  const mergeableState = remoteString(raw.mergeable_state);
  const hasConflicts = mergeableState === 'dirty' || (raw.mergeable === false && mergeableState === 'dirty');
  return {
    iid: number,
    title: remoteString(raw.title),
    sourceBranch: remoteString(head.ref),
    targetBranch: remoteString(base.ref),
    state,
    hasConflicts,
    draft: remoteBoolean(raw.draft),
    author: gitPerson(remoteString(user.login) || remoteString(user.name)),
    updatedAt: normalizeRemoteIso(remoteString(raw.updated_at) || remoteString(raw.created_at)),
    webUrl: remoteString(raw.html_url),
    pipeline: null,
    approvals: null,
  };
}

/* ------------------------------------------------------------------ */
/* GitLab                                                              */
/* ------------------------------------------------------------------ */

export interface GitLabAdapterOptions {
  readonly projectId: string | number;
  readonly token: TokenSource;
  readonly apiBaseUrl?: string;
  readonly webBaseUrl?: string;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
}

function assertGitlabProjectId(value: string | number): string {
  const project = String(value);
  if (project.length === 0 || project.length > 512) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'GitLab projectId 非法');
  }
  if (/[\u0000-\u001f\u007f]/.test(project) || project.startsWith('-')) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'GitLab projectId 非法');
  }
  return project;
}

/** GitLab REST adapter (`/projects/{id}/merge_requests`). */
export class GitLabAdapter implements RemoteProvider {
  readonly provider = GitProvider.GITLAB;
  readonly #client: RemoteHttpClient;
  readonly #projectId: string;
  readonly #webBaseUrl: string;

  constructor(options: GitLabAdapterOptions) {
    this.#projectId = assertGitlabProjectId(options.projectId);
    this.#webBaseUrl = normalizeBaseUrl(options.webBaseUrl, REMOTE_DEFAULTS.gitlab.webBaseUrl);
    this.#client = new RemoteHttpClient({
      providerLabel: 'GitLab',
      apiBaseUrl: normalizeBaseUrl(options.apiBaseUrl, REMOTE_DEFAULTS.gitlab.apiBaseUrl),
      token: options.token,
      authStyle: 'private-token',
      notConfiguredCode: ErrorCode.GITLAB_NOT_CONFIGURED,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
    });
  }

  get hostDisplayName(): string {
    return safeHost(this.#webBaseUrl);
  }

  #projectPath(suffix = ''): string {
    return `/projects/${encodeURIComponent(this.#projectId)}${suffix}`;
  }

  async testConnection(): Promise<GitConnectionStatus> {
    const status = await testRemoteConnection(this.#client, this.provider, async () => {
      const user = remoteObject(await this.#client.requestJson({ method: 'GET', path: '/user' }));
      return remoteString(user.username) || remoteString(user.name);
    });
    return { ...status, hostDisplayName: this.hostDisplayName };
  }

  async getProject(): Promise<RemoteProject> {
    const raw = remoteObject(await this.#client.requestJson({ method: 'GET', path: this.#projectPath() }));
    return {
      id: remoteString(raw.id),
      name: remoteString(raw.name),
      pathWithNamespace: remoteString(raw.path_with_namespace),
      webUrl: remoteString(raw.web_url, `${this.#webBaseUrl}/${this.#projectId}`),
      defaultBranch: remoteString(raw.default_branch),
    };
  }

  async getDefaultBranch(): Promise<string> {
    const project = await this.getProject();
    if (project.defaultBranch.length === 0) {
      throw new AppError(ErrorCode.UNSUPPORTED_FORMAT, 'GitLab 项目未返回默认分支');
    }
    return project.defaultBranch;
  }

  async listMergeRequests(options: ListMergeRequestsOptions = {}): Promise<readonly GitMergeRequest[]> {
    const limit = normalizeListLimit(options.limit);
    const wanted = options.state ?? 'all';
    const raw = await this.#client.requestJson({
      method: 'GET',
      path: this.#projectPath('/merge_requests'),
      query: { state: wanted, per_page: limit, order_by: 'updated_at', sort: 'desc' },
    });
    return asArray(raw)
      .map((entry) => mapGitLabMergeRequest(entry))
      .filter((entry): entry is GitMergeRequest => entry !== undefined)
      .slice(0, limit);
  }

  async createMergeRequest(input: CreateMergeRequestInput): Promise<GitMergeRequest> {
    const normalized = normalizeCreateInput(input);
    const raw = await this.#client.requestJson({
      method: 'POST',
      path: this.#projectPath('/merge_requests'),
      body: {
        source_branch: normalized.sourceBranch,
        target_branch: normalized.targetBranch,
        title: normalized.title,
        description: normalized.description,
        remove_source_branch: normalized.removeSourceBranch,
      },
      mapStatus: duplicateMergeRequest,
    });
    return requireMapped(mapGitLabMergeRequest(raw));
  }

  async listProtectedBranches(): Promise<readonly string[]> {
    const raw = await this.#client.requestJson({
      method: 'GET',
      path: this.#projectPath('/protected_branches'),
      query: { per_page: 100 },
    });
    return asArray(raw)
      .map((entry) => remoteString(remoteObject(entry).name))
      .filter((name) => name.length > 0);
  }
}

export function mapGitLabMergeRequest(value: unknown): GitMergeRequest | undefined {
  const raw = remoteObject(value);
  const iid = remoteNumber(raw.iid);
  if (iid <= 0) return undefined;
  const stateRaw = remoteString(raw.state, 'opened');
  const state: GitMergeRequest['state'] =
    stateRaw === 'merged' || stateRaw === 'closed' || stateRaw === 'locked' ? stateRaw : 'opened';
  const author = remoteObject(raw.author);
  const pipeline = remoteObject(raw.head_pipeline);
  const pipelineStatus = remoteString(pipeline.status);
  const draft = remoteBoolean(raw.draft) || /^draft[:\s]/i.test(remoteString(raw.title));
  return {
    iid,
    title: remoteString(raw.title),
    sourceBranch: remoteString(raw.source_branch),
    targetBranch: remoteString(raw.target_branch),
    state,
    hasConflicts: remoteBoolean(raw.has_conflicts),
    draft,
    author: gitPerson(remoteString(author.name) || remoteString(author.username)),
    updatedAt: normalizeRemoteIso(remoteString(raw.updated_at) || remoteString(raw.created_at)),
    webUrl: remoteString(raw.web_url),
    pipeline: pipelineStatus.length > 0 ? { status: pipelineStatus } : null,
    approvals: null,
  };
}

/* ------------------------------------------------------------------ */
/* Factory                                                             */
/* ------------------------------------------------------------------ */

export type RemoteProviderConfig =
  | ({ readonly provider: 'github' } & GitHubAdapterOptions)
  | ({ readonly provider: 'gitlab' } & GitLabAdapterOptions);

/** Construct a provider from configuration; tokens are passed through only here. */
export function createRemoteProvider(config: RemoteProviderConfig): RemoteProvider {
  return config.provider === 'gitlab' ? new GitLabAdapter(config) : new GitHubAdapter(config);
}
