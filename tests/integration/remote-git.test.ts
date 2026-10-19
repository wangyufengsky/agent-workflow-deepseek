import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../../packages/server/src/index.ts';

function requestKey(prefix: string): string {
  return `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;
}

function createRepo(remoteUrl?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'aw-remote-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# demo\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  if (remoteUrl !== undefined) execFileSync('git', ['remote', 'add', 'origin', remoteUrl], { cwd: root });
  return root;
}

async function startStubGitHub(token: string): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    const auth = request.headers.authorization;
    if (auth !== `Bearer ${token}`) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ message: 'Bad credentials' }));
      return;
    }
    if (request.method === 'GET' && request.url === '/user') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ login: 'stub-user' }));
      return;
    }
    if (request.method === 'GET' && request.url?.startsWith('/repos/acme/demo/pulls')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify([
        {
          number: 12,
          title: 'Task: refund export',
          state: 'open',
          draft: false,
          user: { login: 'stub-user' },
          head: { ref: 'task/demo', sha: 'a'.repeat(40) },
          base: { ref: 'main' },
          html_url: 'https://example.invalid/acme/demo/pull/12',
          updated_at: new Date().toISOString(),
        },
      ]));
      return;
    }
    if (request.method === 'POST' && request.url === '/repos/acme/demo/pulls') {
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ number: 13, title: 'new', state: 'open', head: { ref: 'task/demo' }, base: { ref: 'main' }, html_url: 'https://example.invalid/acme/demo/pull/13', updated_at: new Date().toISOString(), user: { login: 'stub-user' } }));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ message: 'not found' }));
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', () => resolveListen()));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('stub server address missing');
  return { server, url: `http://127.0.0.1:${address.port}` };
}

test('GitHub token save, connection test, MR reads and token redaction', async () => {
  const token = 'ghp_test_token_should_not_leak';
  const stub = await startStubGitHub(token);
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-remote-data-'));
  const repo = createRepo('https://github.com/acme/demo.git');
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: requestKey('prj'), name: 'Remote Demo', rootPath: repo } });
    assert.equal(project.statusCode, 201, project.body);
    const projectId = project.json().data.resource.project.id as string;

    const save = await app.app.inject({
      method: 'POST',
      url: '/api/settings/gitlab',
      payload: { requestKey: requestKey('tok'), provider: 'github', baseUrl: stub.url, apiBaseUrl: stub.url, token },
    });
    assert.equal(save.statusCode, 200, save.body);
    assert.equal(save.json().data.connection.state, 'connected', save.body);
    assert.equal(save.json().data.connection.accountUsername, 'stub-user');
    assert.ok(!save.body.includes(token), 'token must not be echoed');

    const status = await app.app.inject({ method: 'GET', url: '/api/settings/git' });
    assert.equal(status.statusCode, 200, status.body);
    assert.equal(status.json().data.connection.github.state, 'connected');
    assert.ok(!status.body.includes(token));

    const bootstrap = await app.app.inject({ method: 'GET', url: '/api/bootstrap' });
    assert.equal(bootstrap.json().data.integration.git.github.authState, 'connected');
    assert.ok(!bootstrap.body.includes(token));

    const mrs = await app.app.inject({ method: 'GET', url: `/api/git/repos/${projectId}/merge-requests` });
    assert.equal(mrs.statusCode, 200, mrs.body);
    assert.equal(mrs.json().data.mergeRequests.length, 1);
    assert.equal(mrs.json().data.mergeRequests[0].iid, 12);
    assert.ok(!mrs.body.includes(token));

    const test = await app.app.inject({ method: 'POST', url: '/api/settings/gitlab/test', payload: { provider: 'github' } });
    assert.equal(test.statusCode, 200, test.body);
    assert.equal(test.json().data.connection.state, 'connected');

    const badToken = await app.app.inject({ method: 'POST', url: '/api/settings/gitlab', payload: { requestKey: requestKey('tok2'), provider: 'github', baseUrl: stub.url, apiBaseUrl: stub.url, token: 'wrong-token' } });
    assert.equal(badToken.statusCode, 200, badToken.body);
    assert.equal(badToken.json().data.connection.state, 'auth_failed');
  } finally {
    await app.close();
    await new Promise<void>((resolveClose) => stub.server.close(() => resolveClose()));
  }
});

test('fetch updates remote refs from a local remote without exposing credentials', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-fetch-data-'));
  const upstream = createRepo();
  const clone = mkdtempSync(join(tmpdir(), 'aw-fetch-clone-'));
  execFileSync('git', ['clone', '-q', upstream, clone]);
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: requestKey('prj'), name: 'Fetch Demo', rootPath: clone } });
    const projectId = project.json().data.resource.project.id as string;

    writeFileSync(join(upstream, 'fetched.txt'), 'from upstream\n', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: upstream });
    execFileSync('git', ['commit', '-qm', 'upstream change'], { cwd: upstream });

    const fetchResult = await app.app.inject({ method: 'POST', url: `/api/git/repos/${projectId}/fetch`, payload: { requestKey: requestKey('fetch') } });
    assert.equal(fetchResult.statusCode, 200, fetchResult.body);
    const remoteLog = execFileSync('git', ['log', '--oneline', 'origin/main'], { cwd: clone }).toString();
    assert.ok(remoteLog.includes('upstream change'));
  } finally {
    await app.close();
  }
});

test('non-Git task prepares an isolated directory copy', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-copy-data-'));
  const source = mkdtempSync(join(tmpdir(), 'aw-copy-src-'));
  writeFileSync(join(source, 'app.txt'), 'content\n', 'utf8');
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: requestKey('prj'), name: 'Plain Dir', rootPath: source } });
    const projectId = project.json().data.resource.project.id as string;
    const task = await app.app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { requestKey: requestKey('task'), projectId, title: 'Plain task', requirementText: 'R1 copy', methodId: 'method.requirement-development' },
    });
    const taskId = task.json().data.resource.task.id as string;
    const skeleton = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/plan/skeleton`, payload: { requestKey: requestKey('skel'), confirmUseSkeleton: true } });
    const plan = skeleton.json().data.resource.plan;
    const confirm = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan/confirm`,
      payload: { requestKey: requestKey('confirm'), planRevisionId: plan.id, expectedRevisionNumber: plan.revisionNumber, confirmPlan: true },
    });
    assert.equal(confirm.statusCode, 200, confirm.body);
    const prepare = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/workspace/prepare`,
      payload: { requestKey: requestKey('prep'), expectedPlanRevisionNumber: plan.revisionNumber, baselineSelectionRef: 'all', confirmPrepare: true },
    });
    assert.equal(prepare.statusCode, 200, prepare.body);
    const workspace = prepare.json().data.resource.workspace;
    assert.equal(workspace.state, 'ready');
    assert.equal(workspace.kind, 'directory_copy');
    assert.ok(existsSync(join(workspace.displayRoot, 'app.txt')));
  } finally {
    await app.close();
  }
});
