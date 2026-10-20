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
  const root = mkdtempSync(join(tmpdir(), 'aw-mr-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# demo\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/demo.git'], { cwd: root });
  return root;
}

async function startStub(token: string): Promise<{ server: Server; url: string; seen: { createCalls: number; auth: string | undefined } }> {
  const seen = { createCalls: 0, auth: undefined as string | undefined };
  const server = createServer((request, response) => {
    seen.auth = request.headers.authorization;
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ message: 'Bad credentials' }));
      return;
    }
    if (request.method === 'GET' && request.url === '/user') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ login: 'mr-user' }));
      return;
    }
    if (request.method === 'GET' && request.url?.startsWith('/repos/acme/demo/pulls')) {
      // DEL-14 pre-check: read existing MRs before creating (never create a duplicate).
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify([]));
      return;
    }
    if (request.method === 'POST' && request.url === '/repos/acme/demo/pulls') {
      seen.createCalls += 1;
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        number: 42,
        title: 'Task delivery',
        state: 'open',
        head: { ref: 'task/demo' },
        base: { ref: 'main' },
        html_url: 'https://example.invalid/acme/demo/pull/42',
        updated_at: new Date().toISOString(),
        user: { login: 'mr-user' },
      }));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ message: 'not found' }));
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', () => resolveListen()));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('stub missing');
  return { server, url: `http://127.0.0.1:${address.port}`, seen };
}

test('delivery merge-request route creates a real REST pull request and marks the task delivered', async () => {
  const token = 'ghp_mr_test_token_not_for_reality';
  const stub = await startStub(token);
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-mr-data-'));
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: requestKey('prj'), name: 'MR Demo', rootPath: createRepo() } });
    const projectId = project.json().data.resource.project.id as string;
    const task = await app.app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { requestKey: requestKey('task'), projectId, title: 'MR task', requirementText: 'R1 deliver', methodId: 'method.requirement-development' },
    });
    const taskId = task.json().data.resource.task.id as string;
    const delivery = app.store.deliveries.create({ taskId, workspaceId: createId('ws'), changesRevision: 'rev1', eligibility: { allowed: true } });
    app.store.deliveries.update(delivery.id, {
      goal: 'create_merge_request',
      steps: [{ step: 'commit', state: 'succeeded', requestKey: requestKey('commit'), settledAt: new Date().toISOString(), commitSha: 'a'.repeat(40) }],
    });
    app.store.tasks.update(taskId, { deliveryId: delivery.id });

    const save = await app.app.inject({ method: 'POST', url: '/api/settings/gitlab', payload: { requestKey: requestKey('tok'), provider: 'github', baseUrl: stub.url, apiBaseUrl: stub.url, token } });
    assert.equal(save.json().data.connection.state, 'connected', save.body);

    const mr = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/delivery/merge-request`,
      payload: {
        requestKey: requestKey('mr'),
        sourceRef: 'task/demo',
        pushedSha: 'a'.repeat(40),
        targetBranch: 'main',
        expectedTargetTip: 'b'.repeat(40),
        title: 'Task delivery',
        description: 'Deliver task branch',
        confirmMergeRequest: true,
      },
    });
    assert.equal(mr.statusCode, 200, mr.body);
    const body = mr.json().data.resource;
    assert.equal(body.delivery.projection, 'delivered');
    assert.equal(body.delivery.steps.find((step: { step: string }) => step.step === 'mergeRequest').mrIid, 42);
    assert.equal(body.delivery.taskCompletionRef, 'mr:42');
    assert.equal(stub.seen.createCalls, 1);
    assert.equal(stub.seen.auth, `Bearer ${token}`);
    const taskAfter = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/detail` });
    assert.equal(taskAfter.json().data.task.lifecycle, 'completed');
    assert.ok(!mr.body.includes(token), 'token must never be echoed');
  } finally {
    await app.close();
    await new Promise<void>((resolveClose) => stub.server.close(() => resolveClose()));
  }
});
