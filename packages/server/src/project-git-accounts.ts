import { assertPublishUrl } from './remote-network.ts';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { Store } from '@agent-workflow/storage';
import type { Engine } from '@agent-workflow/engine';
import { AppError, ErrorCode, nowIso, type ProjectGitAccountCommand, type ProjectGitAccountView, type ProjectGitAccountDraft } from '@agent-workflow/shared';
import type { RemoteService } from './remote.ts';
import { envelope } from './http.ts';
interface StoredAccount extends Omit<ProjectGitAccountView, 'credentialSaved'> {
    readonly secretRef?: string;
}
export interface ResolvedGitAuth {
    readonly provider: 'github' | 'gitlab';
    readonly token: string;
    readonly username?: string;
    readonly origin?: string;
    readonly authentication?: 'token' | 'password';
}
const key = (id: string) => `project.git-account.${id}`;
function url(value: string): URL { let parsed: URL; try {
    parsed = new URL(value);
}
catch {
    throw new AppError(ErrorCode.VALIDATION_FAILED, '验证用仓库须为合法HTTP(S)地址');
} if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash)
    throw new AppError(ErrorCode.VALIDATION_FAILED, '仓库地址不得包含凭据、查询或片段'); return parsed; }
export function projectAccountView(store: Store, id: string, fallback: 'github' | 'gitlab'): ProjectGitAccountView {
    if (!store.projects.get(id))
        throw new AppError(ErrorCode.NOT_FOUND, '项目不存在');
    const stored = store.settings.getJson<StoredAccount>(key(id));
    return stored ? { projectId: id, revision: stored.revision, source: stored.source, provider: stored.provider, authentication: stored.authentication, username: stored.username, ...(stored.origin ? { origin: stored.origin } : {}), credentialSaved: !!stored.secretRef && store.secrets.has(stored.secretRef) } : { projectId: id, revision: 0, source: 'inherit', provider: fallback, authentication: 'token', username: '', credentialSaved: false };
}
export function projectAccountAuth(store: Store, id: string, origin: string): ResolvedGitAuth | undefined {
    const stored = store.settings.getJson<StoredAccount>(key(id));
    if (!stored || stored.source === 'inherit')
        return undefined;
    if (stored.origin !== origin)
        throw new AppError(ErrorCode.FORBIDDEN, '项目账号绑定服务器与目标仓库不同，未发送凭据');
    const token = stored.secretRef ? store.secrets.get(stored.secretRef) : undefined;
    if (!token)
        throw new AppError(ErrorCode.NOT_CONFIGURED, '项目独立账号凭据不可用，不回退全局账号');
    return { provider: stored.provider, token, username: stored.authentication === 'password' ? stored.username : stored.provider === 'github' ? 'x-access-token' : 'oauth2', origin, authentication: stored.authentication };
}
export function projectForGitRoot(store: Store, root: string, expectedProjectId?: string): string | undefined {
    let actual: string;
    try {
        actual = realpathSync(root);
    }
    catch {
        return undefined;
    }
    const ids = new Set<string>();
    for (const project of store.projects.list(true)) {
        try {
            if (realpathSync(project.rootPath) === actual)
                ids.add(project.id);
        }
        catch { }
    }
    for (const task of store.tasks.list()) {
        const workspace = task.workspaceId ? store.workspaces.get(task.workspaceId) : undefined;
        try {
            if (workspace?.displayRoot && realpathSync(workspace.displayRoot) === actual)
                ids.add(task.projectId);
        }
        catch { }
    }
    if (expectedProjectId !== undefined) { if (!ids.has(expectedProjectId)) throw new AppError(ErrorCode.FORBIDDEN, 'Git目录不属于指定项目或其任务工作区'); return expectedProjectId; }
    if (ids.size > 1) throw new AppError(ErrorCode.FORBIDDEN, 'Git目录归属不唯一，需要明确项目身份');
    return [...ids][0];
}
function prepare(store: Store, remote: RemoteService, id: string, input: ProjectGitAccountCommand, test = false) {
    const project = store.projects.get(id);
    if (!project)
        throw new AppError(ErrorCode.NOT_FOUND, '项目不存在');
    const current = projectAccountView(store, id, remote.settings().git.defaultProvider);
    if (!input || !['inherit', 'custom'].includes(input.source) || !['github', 'gitlab'].includes(input.provider) || !['token', 'password'].includes(input.authentication) || typeof input.username !== 'string' || input.username.length > 200 || /[:\0\r\n]/.test(input.username) || input.credential !== undefined && (typeof input.credential !== 'string' || input.credential.length > 4096 || /[\0\r\n]/.test(input.credential)))
        throw new AppError(ErrorCode.VALIDATION_FAILED, '项目Git账号字段无效');
    if (input.expectedRevision !== current.revision)
        throw new AppError(ErrorCode.STALE_TARGET, '项目Git账号修订已变化，请重新读取');
    const repository = input.repositoryUrl?.trim() || (project.settings.gitlab?.inheritGlobal === false && project.settings.gitlab.baseUrl && project.settings.gitlab.projectPath ? `${project.settings.gitlab.baseUrl}/${project.settings.gitlab.projectPath}.git` : project.remoteDisplayUrl);
    const target = repository && (input.source === 'custom' || test) ? url(repository) : undefined;
    if (input.source === 'inherit')
        return { current, target, credential: undefined, origin: undefined };
    if (!target)
        throw new AppError(ErrorCode.VALIDATION_FAILED, '独立账号需要HTTP(S)项目远端或验证用仓库，以固定凭据服务器范围');
    if (input.authentication === 'password' && !input.username.trim())
        throw new AppError(ErrorCode.VALIDATION_FAILED, '用户名密码认证需要用户名');
    const stored = store.settings.getJson<StoredAccount>(key(id));
    const compatible = stored?.provider === input.provider && stored.authentication === input.authentication && stored.username === input.username.trim() && stored.origin === target.origin;
    const credential = input.credential || (compatible && stored?.secretRef ? store.secrets.get(stored.secretRef) : undefined);
    if (!credential)
        throw new AppError(ErrorCode.VALIDATION_FAILED, '首次独立配置或认证范围改变时必须填写凭据');
    return { current, target, credential, origin: target.origin };
}
function authEnv(auth: ResolvedGitAuth, target: URL): Record<string, string> {
    return { GIT_CONFIG_COUNT: '3', GIT_CONFIG_KEY_0: `http.${target.origin}/.extraheader`, GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`${auth.username ?? (auth.provider === 'github' ? 'x-access-token' : 'oauth2')}:${auth.token}`).toString('base64')}`, GIT_CONFIG_KEY_1: 'http.followRedirects', GIT_CONFIG_VALUE_1: 'false', GIT_CONFIG_KEY_2: 'credential.helper', GIT_CONFIG_VALUE_2: '' };
}
export async function probeGitRepository(repository: URL, auth: ResolvedGitAuth | undefined, cwd: string): Promise<number> {
    // No mutation, no shell, no credential-bearing URL/argv, no prompts or redirect credential forwarding.
    return new Promise((resolve, reject) => execFile('git', ['-c', 'core.hooksPath=/dev/null', 'ls-remote', '--heads', repository.href], { cwd, timeout: 15000, maxBuffer: 256 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', ...(auth ? authEnv(auth, repository) : {}) } }, (error, stdout) => { if (error)
        reject(new AppError(ErrorCode.GITLAB_AUTH_FAILED, '无法读取候选仓库；请检查地址、网络与账号，验证未保存配置'));
    else
        resolve(stdout.trim() ? stdout.trim().split('\n').length : 0); }));
}
export function registerProjectGitAccountRoutes(app: FastifyInstance, store: Store, engine: Engine, remote: RemoteService): void {
    app.get<{
        Params: {
            id: string;
        };
    }>('/api/projects/:id/git-account', async (request) => envelope({ account: projectAccountView(store, request.params.id, remote.settings().git.defaultProvider) }, request.id));
    const command = (test: boolean) => async (request: import('fastify').FastifyRequest<{
        Params: {
            id: string;
        };
    }>) => {
        const input = request.body as ProjectGitAccountCommand;
        const id = request.params.id;
        if (!input || typeof input.requestKey !== 'string')
            throw new AppError(ErrorCode.VALIDATION_FAILED, '需要原请求号');
        const { credential } = input;
        if (typeof input.source !== 'string' || typeof input.provider !== 'string' || typeof input.authentication !== 'string' || typeof input.username !== 'string' || input.repositoryUrl !== undefined && typeof input.repositoryUrl !== 'string' || credential !== undefined && typeof credential !== 'string')
            throw new AppError(ErrorCode.VALIDATION_FAILED, '项目Git账号字段无效');
        const canonical = { source: input.source, provider: input.provider, authentication: input.authentication, username: input.username, expectedRevision: input.expectedRevision, repositoryHash: input.repositoryUrl === undefined ? undefined : createHash('sha256').update(input.repositoryUrl).digest('hex'), credentialHash: credential === undefined ? undefined : createHash('sha256').update(credential).digest('hex') };
        const { record, replayed } = engine.commands.begin({ requestKey: input.requestKey, operation: test ? 'project.git-account.test' : 'project.git-account.save', body: { projectId: id, ...canonical }, target: { projectId: id } });
        if (replayed)
            return envelope({ receipt: engine.commands.toReceipt(record), resource: record.outcome?.resource }, request.id);
        try {
            const prepared = prepare(store, remote, id, input, test);
            let resource: unknown;
            if (test) {
                if (!prepared.target)
                    throw new AppError(ErrorCode.VALIDATION_FAILED, '验证连接需要仓库地址');
                const auth = input.source === 'custom' ? { provider: input.provider, token: prepared.credential!, username: input.authentication === 'password' ? input.username : input.provider === 'github' ? 'x-access-token' : 'oauth2', origin: prepared.origin } : remote.globalAuth(prepared.target.href);
                assertPublishUrl(prepared.target, remote.settings().git.network);
                const refs = await probeGitRepository(prepared.target, auth, store.projects.get(id)!.rootPath);
                if (projectAccountView(store, id, remote.settings().git.defaultProvider).revision !== input.expectedRevision)
                    throw new AppError(ErrorCode.STALE_TARGET, '验证期间项目账号已变化，未把旧验证绑定到新账号');
                resource = { readable: true, checkedAt: nowIso(), refs, message: '候选仓库可读取；验证没有保存账号或配置' };
            }
            else {
                const revision = prepared.current.revision + 1;
                const secretRef = input.source === 'custom' ? `git:project:${id}:${revision}` : undefined;
                if (secretRef)
                    store.secrets.put(secretRef, prepared.credential!);
                const saved: StoredAccount = { projectId: id, revision, source: input.source, provider: input.provider, authentication: input.authentication, username: input.username.trim(), ...(secretRef ? { secretRef } : {}), ...(prepared.origin ? { origin: prepared.origin } : {}) };
                store.settings.putJson(key(id), saved);
                store.settings.removeJson(`project.binding-check.${id}`);
                resource = projectAccountView(store, id, remote.settings().git.defaultProvider);
            }
            engine.commands.settle(input.requestKey, { resource });
            return envelope({ receipt: engine.commands.toReceipt(engine.commands.get(input.requestKey)!), resource }, request.id);
        }
        catch (error) {
            engine.commands.fail(input.requestKey, error as Error);
            throw error;
        }
    };
    app.post<{
        Params: {
            id: string;
        };
    }>('/api/projects/:id/git-account', command(false));
    app.post<{
        Params: {
            id: string;
        };
    }>('/api/projects/:id/git-account/test', command(true));
}
