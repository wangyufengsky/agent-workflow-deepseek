import { readFileSync } from 'node:fs';
import { AppError, DEFAULT_SETTINGS, ErrorCode, mergeSettings, nowIso, type AppSettings, type GitConnectionStatus, type GitMergeRequest } from '@agent-workflow/shared';
import type { RemoteProvider } from '@agent-workflow/git';
import { GitHubAdapter, GitLabAdapter } from '@agent-workflow/git';
import type { RemotePort } from '@agent-workflow/engine';
import type { Store } from '@agent-workflow/storage';

interface RemoteCoordinates {
  readonly provider: 'github' | 'gitlab';
  readonly host: string;
  readonly owner?: string;
  readonly repo?: string;
  readonly pathWithNamespace: string;
  readonly webUrl: string;
}

export interface GitConnectionInput {
  readonly provider: 'github' | 'gitlab';
  readonly baseUrl?: string;
  readonly apiBaseUrl?: string;
  readonly token: string;
}

export interface GitConnectionState {
  readonly provider: 'github' | 'gitlab';
  readonly state: GitConnectionStatus['state'];
  readonly hostDisplayName?: string;
  readonly accountUsername?: string;
  readonly lastVerifiedAt?: string;
  readonly message?: string;
}

/**
 * GitHub/GitLab connections and merge-request operations. Tokens live only in
 * the local encrypted secret store and are injected at call time.
 */
export class RemoteService implements RemotePort {
  readonly #store: Store;

  constructor(store: Store) {
    this.#store = store;
  }

  settings(): AppSettings {
    return mergeSettings(DEFAULT_SETTINGS, this.#store.settings.getSettings() ?? {}) as AppSettings;
  }

  token(provider: 'github' | 'gitlab'): string | undefined {
    return this.#store.secrets.get(`git:${provider}`);
  }

  currentToken(): { provider: 'github' | 'gitlab'; token: string } | undefined {
    const settings = this.settings();
    const provider = settings.git.defaultProvider;
    const token = this.token(provider);
    return token === undefined ? undefined : { provider, token };
  }

  connectionState(provider: 'github' | 'gitlab'): GitConnectionState {
    const stored = this.#store.settings.getJson<GitConnectionState>(`git.connection.${provider}`);
    const configured = this.token(provider) !== undefined;
    if (!configured) {
      return { provider, state: 'not_configured', message: '尚未配置个人访问令牌' };
    }
    if (stored !== undefined) return stored;
    return { provider, state: 'not_configured', message: '已保存令牌，尚未验证连接' };
  }

  async saveConnection(input: GitConnectionInput): Promise<GitConnectionState> {
    const token = input.token.trim();
    if (token === '') throw new AppError(ErrorCode.VALIDATION_FAILED, '访问令牌不能为空');
    if (token.length > 4096) throw new AppError(ErrorCode.VALIDATION_FAILED, '访问令牌过长');
    const baseUrl = normalizeUrl(input.baseUrl ?? (input.provider === 'github' ? this.settings().git.github.baseUrl : this.settings().git.gitlab.baseUrl));
    const apiBaseUrl = normalizeUrl(
      input.apiBaseUrl ?? (input.provider === 'github' ? this.settings().git.github.apiBaseUrl : this.settings().git.gitlab.apiBaseUrl),
    );
    this.#store.secrets.put(`git:${input.provider}`, token);
    const settings = this.settings();
    const next: AppSettings = {
      ...settings,
      git: {
        ...settings.git,
        defaultProvider: input.provider,
        github: input.provider === 'github' ? { baseUrl, apiBaseUrl } : settings.git.github,
        gitlab: input.provider === 'gitlab' ? { baseUrl, apiBaseUrl } : settings.git.gitlab,
      },
    };
    this.#store.settings.saveSettings(next);
    const state = await this.testConnection(input.provider);
    this.#store.settings.putJson(`git.connection.${input.provider}`, state);
    return state;
  }

  async testConnection(provider: 'github' | 'gitlab'): Promise<GitConnectionState> {
    const token = this.token(provider);
    const settings = this.settings();
    const apiBaseUrl = provider === 'github' ? settings.git.github.apiBaseUrl : settings.git.gitlab.apiBaseUrl;
    if (token === undefined) {
      const state: GitConnectionState = { provider, state: 'not_configured', message: '尚未配置个人访问令牌' };
      this.#store.settings.putJson(`git.connection.${provider}`, state);
      return state;
    }
    const started = Date.now();
    try {
      const response = await fetch(`${apiBaseUrl.replace(/\/+$/, '')}/user`, {
        headers: provider === 'github'
          ? { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'agent-workflow' }
          : { 'PRIVATE-TOKEN': token, accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (response.status === 401 || response.status === 403) {
        const state: GitConnectionState = { provider, state: 'auth_failed', lastVerifiedAt: nowIso(), message: '账户认证失败，请检查令牌权限' };
        this.#store.settings.putJson(`git.connection.${provider}`, state);
        return state;
      }
      if (!response.ok) {
        const state: GitConnectionState = { provider, state: 'unreachable', lastVerifiedAt: nowIso(), message: `服务返回 ${response.status}` };
        this.#store.settings.putJson(`git.connection.${provider}`, state);
        return state;
      }
      const body = (await response.json()) as Record<string, unknown>;
      const username = typeof body.login === 'string' ? body.login : typeof body.username === 'string' ? body.username : undefined;
      const state: GitConnectionState = {
        provider,
        state: 'connected',
        hostDisplayName: new URL(apiBaseUrl).host,
        ...(username === undefined ? {} : { accountUsername: username }),
        lastVerifiedAt: nowIso(),
        message: `连接正常（${Date.now() - started}ms）`,
      };
      this.#store.settings.putJson(`git.connection.${provider}`, state);
      return state;
    } catch (error) {
      const state: GitConnectionState = {
        provider,
        state: 'unreachable',
        lastVerifiedAt: nowIso(),
        message: error instanceof Error ? `无法连接：${error.message}` : '无法连接',
      };
      this.#store.settings.putJson(`git.connection.${provider}`, state);
      return state;
    }
  }

  async connection(projectId?: string): Promise<GitConnectionState> {
    const settings = this.settings();
    const provider = settings.git.defaultProvider;
    const base = this.connectionState(provider);
    if (projectId === undefined) return base;
    const project = this.#store.projects.get(projectId);
    if (project === undefined) throw new AppError(ErrorCode.NOT_FOUND, '项目不存在');
    const coordinates = await this.#coordinates(project.rootPath, project.remoteDisplayUrl);
    if (coordinates === undefined) return { ...base, state: base.state === 'connected' ? 'connected' : base.state, message: '项目没有可识别的远端仓库' };
    return { ...base, hostDisplayName: coordinates.host };
  }

  integrationStatus(): { github: { configured: boolean; authState: string }; gitlab: { configured: boolean; authState: string }; provider: 'github' | 'gitlab' } {
    const settings = this.settings();
    const github = this.connectionState('github');
    const gitlab = this.connectionState('gitlab');
    return {
      provider: settings.git.defaultProvider,
      github: { configured: this.token('github') !== undefined, authState: github.state },
      gitlab: { configured: this.token('gitlab') !== undefined, authState: gitlab.state },
    };
  }

  async listMergeRequests(projectId: string, state: 'opened' | 'merged' | 'closed' | 'all' = 'opened'): Promise<readonly GitMergeRequest[]> {
    const project = this.#requireProject(projectId);
    const provider = await this.#providerFor(project.rootPath, project.remoteDisplayUrl);
    if (provider === undefined) return [];
    return provider.listMergeRequests({ state, limit: 50 });
  }

  async createMergeRequest(projectId: string, input: { sourceBranch: string; targetBranch: string; title: string; description: string }): Promise<{ iid: number; webUrl: string }> {
    const project = this.#requireProject(projectId);
    const provider = await this.#providerFor(project.rootPath, project.remoteDisplayUrl);
    if (provider === undefined) throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, '当前未配置 GitHub/GitLab 连接，无法创建合并请求');
    const mr = await provider.createMergeRequest({ sourceBranch: input.sourceBranch, targetBranch: input.targetBranch, title: input.title, description: input.description });
    return { iid: mr.iid, webUrl: mr.webUrl };
  }

  async listProtectedBranches(projectId: string): Promise<readonly string[]> {
    const project = this.#requireProject(projectId);
    const provider = await this.#providerFor(project.rootPath, project.remoteDisplayUrl);
    if (provider === undefined) return [];
    return provider.listProtectedBranches();
  }

  #requireProject(projectId: string) {
    const project = this.#store.projects.get(projectId);
    if (project === undefined) throw new AppError(ErrorCode.NOT_FOUND, '项目不存在');
    return project;
  }

  async #providerFor(rootPath: string, remoteUrl: string | undefined): Promise<RemoteProvider | undefined> {
    const coordinates = await this.#coordinates(rootPath, remoteUrl);
    if (coordinates === undefined) return undefined;
    const token = this.token(coordinates.provider);
    if (token === undefined) return undefined;
    const settings = this.settings();
    if (coordinates.provider === 'github') {
      return new GitHubAdapter({
        owner: coordinates.owner ?? '',
        repo: coordinates.repo ?? '',
        token,
        apiBaseUrl: settings.git.github.apiBaseUrl,
        webBaseUrl: settings.git.github.baseUrl,
      });
    }
    return new GitLabAdapter({
      projectId: encodeURIComponent(coordinates.pathWithNamespace),
      token,
      apiBaseUrl: settings.git.gitlab.apiBaseUrl,
      webBaseUrl: settings.git.gitlab.baseUrl,
    });
  }

  async #coordinates(rootPath: string, remoteUrl: string | undefined): Promise<RemoteCoordinates | undefined> {
    const raw = remoteUrl ?? readRemoteUrlFromGitConfig(rootPath);
    if (raw === undefined || raw === '') return undefined;
    const normalized = normalizeRemoteUrl(raw);
    if (normalized === undefined) return undefined;
    const { host, path } = normalized;
    if (host.includes('github') || /github\./i.test(host)) {
      const [owner, repo] = path.replace(/\.git$/, '').split('/');
      if (owner === undefined || repo === undefined) return undefined;
      return { provider: 'github', host, owner, repo, pathWithNamespace: `${owner}/${repo}`, webUrl: `https://${host}/${owner}/${repo}` };
    }
    const projectPath = path.replace(/\.git$/, '');
    if (projectPath === '') return undefined;
    return { provider: 'gitlab', host, pathWithNamespace: projectPath, webUrl: `https://${host}/${projectPath}` };
  }
}

function normalizeUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(ErrorCode.VALIDATION_FAILED, '地址必须是合法的 http(s) URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new AppError(ErrorCode.VALIDATION_FAILED, '地址必须是 http(s) URL');
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
}

function normalizeRemoteUrl(raw: string): { host: string; path: string } | undefined {
  const value = raw.trim();
  if (value === '') return undefined;
  const scp = /^(?:[^@]+@)?([^:]+):(.+)$/.exec(value);
  if (scp !== null && !value.includes('://')) {
    return { host: scp[1] ?? '', path: scp[2] ?? '' };
  }
  try {
    const url = new URL(value);
    return { host: url.hostname, path: url.pathname.replace(/^\/+/, '') };
  } catch {
    return undefined;
  }
}

function readRemoteUrlFromGitConfig(rootPath: string): string | undefined {
  try {
    const config = readFileSync(`${rootPath}/.git/config`, 'utf8');
    const match = /\[remote "origin"\][\s\S]*?url\s*=\s*(.+)/.exec(config);
    return match?.[1]?.trim();
  } catch {
    return undefined;
  }
}
