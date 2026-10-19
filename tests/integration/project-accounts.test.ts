import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { createApplication } from '../../packages/server/src/application.ts';
import { RemoteService } from '../../packages/server/src/remote.ts';
import { DEFAULT_SETTINGS } from '@agent-workflow/shared';
const temp = () => mkdtempSync(join(tmpdir(), 'aw-project-account-'));
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
async function fixture() {
    const base = temp();
    const root = join(base, 'repo');
    mkdirSync(root);
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'config', 'user.email', 'fixture@example.invalid');
    git(root, 'config', 'user.name', 'Fixture');
    writeFileSync(join(root, 'file.txt'), 'fixture');
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'fixture');
    git(base, 'clone', '--bare', '-q', root, 'remote.git');
    git(join(base, 'remote.git'), 'config', 'http.receivepack', 'true');
    const seen: string[] = [];
    let expected = 'oauth2:fixture-project-token';
    let hold: Promise<void> | undefined;
    const server = createServer(async (req, res) => {
        const authorization = req.headers.authorization;
        const actual = req.headers['private-token'] ? `oauth2:${req.headers['private-token']}` : authorization?.startsWith('Basic ') ? Buffer.from(authorization.slice(6), 'base64').toString() : undefined;
        seen.push(actual === 'oauth2:fixture-global-token' ? 'global' : actual === expected ? 'project' : 'other');
        if (actual !== expected) {
            res.writeHead(401, { 'www-authenticate': 'Basic realm="offline-fixture"' });
            res.end();
            return;
        }
        if (hold) await hold;
        if (req.url?.startsWith('/api/v4/projects/')) {
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ id: 1, path_with_namespace: 'fixture/remote', default_branch: 'main', web_url: 'http://fixture.invalid/remote' }));
            return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of req)
            chunks.push(Buffer.from(chunk));
        const url = new URL(req.url!, 'http://fixture');
        const output = execFileSync('git', ['http-backend'], { input: Buffer.concat(chunks), env: { ...process.env, GIT_PROJECT_ROOT: base, GIT_HTTP_EXPORT_ALL: '1', PATH_INFO: url.pathname, QUERY_STRING: url.search.slice(1), REQUEST_METHOD: req.method!, CONTENT_TYPE: req.headers['content-type'] ?? '', REMOTE_USER: 'offline-fixture' }, maxBuffer: 4 * 1024 * 1024 });
        const boundary = output.indexOf('\r\n\r\n');
        const headers = output.subarray(0, boundary).toString();
        let status = 200;
        for (const line of headers.split('\r\n')) {
            const split = line.indexOf(':');
            if (split < 0)
                continue;
            const name = line.slice(0, split), value = line.slice(split + 1).trim();
            if (name.toLowerCase() === 'status')
                status = Number(value.split(' ')[0]);
            else
                res.setHeader(name, value);
        }
        res.writeHead(status);
        res.end(output.subarray(boundary + 4));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
    const repositoryUrl = `${origin}/remote.git`;
    git(root, 'remote', 'add', 'origin', repositoryUrl);
    const app = await createApplication({ dataDir: temp(), disableOpenCode: true, disableListen: true });
    const project = app.store.projects.create({ name: 'Offline actual Git HTTP fixture', rootPath: root, gitState: 'git', remoteDisplayUrl: repositoryUrl });
    const post = (suffix: string, body: Record<string, unknown>) => app.app.inject({ method: 'POST', url: `/api/projects/${project.id}/git-account${suffix}`, payload: body });
    const draft = { source: 'custom', provider: 'gitlab', authentication: 'token', username: '', credential: 'fixture-project-token', repositoryUrl, expectedRevision: 0 };
    return { app, root, base, origin, repositoryUrl, project, draft, post, seen, setExpected(value: string) { expected = value; }, pause() { let release!: () => void; hold = new Promise<void>(resolve => { release = resolve; }); return () => { hold = undefined; release(); }; }, async close() { await app.close(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
test('candidate verification is a real read-only Git HTTP call and saves neither account nor plaintext credential', async () => {
    const f = await fixture();
    try {
        const response = await f.post('/test', { ...f.draft, requestKey: 'req_project_account_probe_12345' });
        assert.equal(response.statusCode, 200, response.body);
        assert.equal(response.json().data.resource.refs, 1);
        const account = await f.app.app.inject({ method: 'GET', url: `/api/projects/${f.project.id}/git-account` });
        assert.equal(account.json().data.account.revision, 0);
        assert.equal(account.json().data.account.credentialSaved, false);
        assert.equal(f.app.store.secrets.has(`git:project:${f.project.id}:1`), false);
        assert.ok(f.seen.includes('project'));
        const replay = await f.post('/test', { ...f.draft, requestKey: 'req_project_account_probe_12345' });
        assert.equal(replay.statusCode, 200);
        assert.equal(f.seen.length, 1, 'original receipt does not repeat network probe');
        const operation = f.app.engine.commands.get('req_project_account_probe_12345');
        assert.equal(JSON.stringify(operation).includes('fixture-project-token'), false);
    }
    finally {
        await f.close();
    }
});
test('saved project token and password drive actual fetch/push, blank retains secret, inherit restores global and cross-host is denied', async () => {
    const f = await fixture();
    try {
        f.app.store.settings.putJson(`project.binding-check.${f.project.id}`, { stale: true });
        const response = await f.post('', { ...f.draft, requestKey: 'req_project_account_save_12345' });
        assert.equal(f.app.store.settings.getJson(`project.binding-check.${f.project.id}`), undefined, 'account changes invalidate old binding checks');
        assert.equal(response.statusCode, 200, response.body);
        assert.equal(response.json().data.resource.credentialSaved, true);
        assert.equal(JSON.stringify(response.json()).includes('fixture-project-token'), false);
        const remote = new RemoteService(f.app.store);
        f.app.store.secrets.put('git:gitlab', 'fixture-global-token');
        f.app.engine.updateSettings({ ...f.app.engine.settings, git: { ...f.app.engine.settings.git, defaultProvider: 'gitlab', gitlab: { baseUrl: f.origin, apiBaseUrl: `${f.origin}/api/v4` } } });
        assert.equal((await remote.inspectProjectBinding(f.project.id)).state, 'connected', 'actual project API consumer uses independent token');
        const fetched = await f.app.app.inject({ method: 'POST', url: `/api/git/repos/${f.project.id}/fetch`, payload: { requestKey: 'req_project_actual_fetch_12345' } });
        assert.equal(fetched.statusCode, 200, fetched.body);
        assert.equal(git(f.root, 'rev-parse', 'origin/main'), git(f.root, 'rev-parse', 'HEAD'));
        const pushed = await f.app.engine.ports.git.push!({ repoRoot: f.root, localSha: git(f.root, 'rev-parse', 'HEAD'), remote: 'origin', remoteRef: 'refs/heads/account-fixture' });
        assert.equal(pushed.created, true);
        assert.ok(f.seen.every(value => value === 'project'));
        const blank = await f.post('', { ...f.draft, credential: '', expectedRevision: 1, requestKey: 'req_project_account_blank_12345' });
        assert.equal(blank.statusCode, 200, blank.body);
        assert.equal(blank.json().data.resource.revision, 2);
        assert.throws(() => remote.authForRoot(f.root, 'http://localhost:1/remote.git'), /不同/);
        assert.throws(() => remote.authForRoot(f.root, f.repositoryUrl, 'wrong-project'), /不属于/);
        assert.equal(remote.authForRoot(f.root, f.repositoryUrl, f.project.id)?.provider, 'gitlab');
        const stale = await f.post('', { ...f.draft, requestKey: 'req_project_account_stale_12345' });
        assert.equal(stale.json().error.code, 'STALE_TARGET');
        const password = await f.post('', { ...f.draft, authentication: 'password', username: 'fixture-user', credential: 'fixture-password', expectedRevision: 2, requestKey: 'req_project_account_password_12345' });
        assert.equal(password.statusCode, 200, password.body);
        f.setExpected('fixture-user:fixture-password');
        await f.app.engine.ports.git.fetch!({ repoRoot: f.root });
        const inherit = await f.post('', { ...f.draft, source: 'inherit', credential: undefined, expectedRevision: 3, requestKey: 'req_project_account_inherit_12345' });
        assert.equal(inherit.statusCode, 200, inherit.body);
        f.setExpected('oauth2:fixture-global-token');
        await f.app.engine.ports.git.fetch!({ repoRoot: f.root });
        assert.equal(f.seen.at(-1), 'global');
        const otherRoot = temp();
        const other = f.app.store.projects.create({ name: 'Other project identity fixture', rootPath: otherRoot, gitState: 'not_git' });
        const task = f.app.store.tasks.create({ projectId: other.id, title: 'Ambiguous workspace fixture', requirementText: 'Offline identity regression', methodId: 'method.full-development', methodRevision: 'fixture' });
        const workspace = f.app.store.workspaces.create({ taskId: task.id, kind: 'directory_copy', displayRoot: f.root, branch: 'fixture' });
        f.app.store.tasks.update(task.id, { workspaceId: workspace.id });
        assert.throws(() => remote.authForRoot(f.root, f.repositoryUrl), /归属不唯一/);
        assert.equal(remote.authForRoot(f.root, f.repositoryUrl, f.project.id)?.provider, 'gitlab');
        const content = readFileSync(f.app.store.dbPath);
        assert.equal(content.includes(Buffer.from('fixture-password')), false);
        assert.equal(content.includes(Buffer.from('fixture-project-token')), false);
    }
    finally {
        await f.close();
    }
});
test('allowed roots settings enforce real path containment only for new registrations and preserve existing projects', async () => {
    const app = await createApplication({ dataDir: temp(), disableOpenCode: true, disableListen: true });
    try {
        const base = temp(), allowed = join(base, 'allowed'), outside = join(base, 'outside');
        mkdirSync(allowed);
        mkdirSync(outside);
        mkdirSync(join(allowed, 'inside'));
        symlinkSync(outside, join(allowed, 'escape'));
        const existing = app.store.projects.create({ name: 'Existing', rootPath: outside, gitState: 'not_git' });
        const saved = await app.app.inject({ method: 'PATCH', url: '/api/settings', payload: { requestKey: 'req_allowed_root_settings_12345', patch: { server: { allowedProjectRoots: [allowed] } } } });
        assert.equal(saved.statusCode, 200, saved.body);
        const register = (rootPath: string, key: string) => app.app.inject({ method: 'POST', url: '/api/projects', payload: { rootPath, name: 'Root fixture', requestKey: `req_root_${key}_123456789` } });
        assert.equal((await register(join(allowed, 'inside'), 'inside')).statusCode, 201);
        assert.equal((await register(join(allowed, 'escape'), 'escape')).json().error.code, 'FORBIDDEN');
        mkdirSync(join(base, 'allowed-sibling'));
        assert.equal((await register(join(base, 'allowed-sibling'), 'sibling')).json().error.code, 'FORBIDDEN');
        assert.equal(app.engine.projects.get(existing.id).rootPath, outside);
        assert.equal((await register(outside, 'existing')).statusCode, 201, 'existing registration is not destroyed');
        const invalid = await app.app.inject({ method: 'PATCH', url: '/api/settings', payload: { requestKey: 'req_allowed_root_invalid_12345', patch: { server: { allowedProjectRoots: ['../escape'] } } } });
        assert.equal(invalid.json().error.code, 'VALIDATION_FAILED');
    }
    finally {
        await app.close();
    }
});

test('a candidate verification finishing after an account revision changes cannot bind its late result', async () => {
    const f = await fixture(); const release = f.pause();
    try {
        const pending = Promise.resolve(f.post('/test', { ...f.draft, requestKey: 'req_project_account_racing_probe_12345' }));
        for (let i = 0; i < 100 && f.seen.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 5));
        assert.ok(f.seen.length > 0, 'actual HTTP read has started');
        const save = await f.post('', { ...f.draft, requestKey: 'req_project_account_racing_save_12345' });
        assert.equal(save.statusCode, 200, save.body); release();
        const late = await pending; assert.equal(late.json().error.code, 'STALE_TARGET');
        assert.equal(f.app.engine.commands.get('req_project_account_racing_probe_12345')?.status, 'failed');
    } finally { release(); await f.close(); }
});
