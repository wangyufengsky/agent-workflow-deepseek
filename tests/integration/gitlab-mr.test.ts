import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createId } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/index.ts';

function requestKey(prefix: string): string {
  return `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;
}

function createRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'aw-gl-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# gitlab demo\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'https://gitlab.example.com/group/demo.git'], { cwd: root });
  return root;
}

async function startStub(token: string): Promise<{ server: Server; url: string; paths: string[] }> {
  const paths: string[] = [];
  const server = createServer((request, response) => {
    paths.push(`${request.method ?? 'GET'} ${request.url ?? ''}`);
    if (request.headers['private-token'] !== token) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ message: '401 Unauthorized' }));
      return;
    }
    if (request.method === 'GET' && request.url === '/api/v4/user') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ username: 'gitlab-user', name: 'GitLab User' }));
      return;
    }
    if (request.method === 'GET' && request.url?.startsWith('/api/v4/projects/group%2Fdemo/merge_requests')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify([
        {
          iid: 3,
          title: 'Task: GitLab delivery',
          state: 'opened',
          draft: false,
          author: { username: 'gitlab-user', name: 'GitLab User' },
          // different source branch: not the delivery's task branch (DEL-14 pre-check must not reuse it)
          source_branch: 'feature/other',
          target_branch: 'main',
          web_url: 'https://gitlab.example.com/group/demo/-/merge_requests/3',
          updated_at: new Date().toISOString(),
        },
      ]));
      return;
    }
    if (request.method === 'POST' && request.url === '/api/v4/projects/group%2Fdemo/merge_requests') {
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        iid: 4,
        title: 'Task delivery',
        state: 'opened',
        draft: false,
        author: { username: 'gitlab-user', name: 'GitLab User' },
        source_branch: 'task/gitlab',
        target_branch: 'main',
        web_url: 'https://gitlab.example.com/group/demo/-/merge_requests/4',
        updated_at: new Date().toISOString(),
      }));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ message: '404 Not Found' }));
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', () => resolveListen()));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('stub missing');
  return { server, url: `http://127.0.0.1:${address.port}`, paths };
}

test('GitLab token connects, lists merge requests and creates an MR through the delivery route', async () => {
  const token = 'glpat-test-token-not-real';
  const stub = await startStub(token);
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-gl-data-'));
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const save = await app.app.inject({
      method: 'POST',
      url: '/api/settings/gitlab',
      payload: { requestKey: requestKey('tok'), provider: 'gitlab', baseUrl: 'http://127.0.0.1:1', apiBaseUrl: `${stub.url}/api/v4`, token },
    });
    assert.equal(save.statusCode, 200, save.body);
    assert.equal(save.json().data.connection.state, 'connected', save.body);
    assert.equal(save.json().data.connection.accountUsername, 'gitlab-user');
    assert.ok(!save.body.includes(token));

    const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: requestKey('prj'), name: 'GitLab Demo', rootPath: createRepo() } });
    const projectId = project.json().data.resource.project.id as string;
    const mrs = await app.app.inject({ method: 'GET', url: `/api/git/repos/${projectId}/merge-requests` });
    assert.equal(mrs.statusCode, 200, mrs.body);
    assert.equal(mrs.json().data.mergeRequests.length, 1);
    assert.equal(mrs.json().data.mergeRequests[0].iid, 3);
    assert.equal(execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: project.json().data.resource.project.rootPath }).toString().trim(), 'https://gitlab.example.com/group/demo.git');
    assert.ok(stub.paths.some((path) => path.includes('/api/v4/projects/group%2Fdemo/merge_requests')));

    const task = await app.app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { requestKey: requestKey('task'), projectId, title: 'GitLab MR task', requirementText: 'R1 delivery', methodId: 'method.requirement-development' },
    });
    const taskId = task.json().data.resource.task.id as string;
    const delivery = app.store.deliveries.create({ taskId, workspaceId: createId('ws'), changesRevision: 'rev1', eligibility: { allowed: true } });
    app.store.deliveries.update(delivery.id, {
      goal: 'create_merge_request',
      steps: [{ step: 'commit', state: 'succeeded', requestKey: requestKey('commit'), settledAt: new Date().toISOString(), commitSha: 'a'.repeat(40) }],
    });
    app.store.tasks.update(taskId, { deliveryId: delivery.id });
    const mr = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/delivery/merge-request`,
      payload: {
        requestKey: requestKey('mr'),
        sourceRef: 'task/gitlab',
        pushedSha: 'a'.repeat(40),
        targetBranch: 'main',
        expectedTargetTip: 'b'.repeat(40),
        title: 'Task delivery',
        description: 'GitLab delivery',
        confirmMergeRequest: true,
      },
    });
    assert.equal(mr.statusCode, 200, mr.body);
    const deliveryResource = mr.json().data.resource.delivery;
    assert.equal(deliveryResource.projection, 'delivered');
    assert.equal(deliveryResource.steps.find((step: { step: string }) => step.step === 'mergeRequest').mrIid, 4);
    assert.equal(deliveryResource.taskCompletionRef, 'mr:4');
    assert.ok(!mr.body.includes(token));
  } finally {
    await app.close();
    await new Promise<void>((resolveClose) => stub.server.close(() => resolveClose()));
  }
});
