import assert from 'node:assert/strict';
import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http';
import { describe, it, type TestContext } from 'node:test';
import { ErrorCode, isAppError } from '@agent-workflow/shared';
import { createRemoteProvider, GitHubAdapter, GitLabAdapter } from './remote.ts';

interface StubCall {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

interface Stub {
  readonly baseUrl: string;
  readonly calls: StubCall[];
}

type Handler = (call: StubCall, res: ServerResponse) => void;

async function startStub(t: TestContext, handler: Handler): Promise<Stub> {
  const calls: StubCall[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const call: StubCall = {
        method: request.method ?? 'GET',
        path: url.pathname,
        query: url.searchParams,
        headers: request.headers as IncomingHttpHeaders,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      calls.push(call);
      handler(call, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { baseUrl: `http://127.0.0.1:${port}`, calls };
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<unknown> {
  try {
    await promise;
    assert.fail(`expected rejection with ${code}`);
  } catch (error) {
    assert.ok(isAppError(error), `expected AppError, got ${String(error)}`);
    assert.equal(error.code, code);
    return error;
  }
}

const TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
const GITLAB_TOKEN = 'glpat-abcdefghij0123456789';

/* ------------------------------------------------------------------ */
/* GitHub                                                              */
/* ------------------------------------------------------------------ */

describe('GitHubAdapter', () => {
  it('reads the repository and default branch with a bearer token', async (t) => {
    const stub = await startStub(t, (call, res) => {
      if (call.path === '/repos/acme/widgets') {
        json(res, 200, { id: 42, name: 'widgets', full_name: 'acme/widgets', html_url: 'https://github.com/acme/widgets', default_branch: 'trunk' });
        return;
      }
      json(res, 404, { message: 'Not Found' });
    });
    const adapter = new GitHubAdapter({ owner: 'acme', repo: 'widgets', token: TOKEN, apiBaseUrl: stub.baseUrl });
    const project = await adapter.getProject();
    assert.equal(project.id, '42');
    assert.equal(project.name, 'widgets');
    assert.equal(project.pathWithNamespace, 'acme/widgets');
    assert.equal(project.webUrl, 'https://github.com/acme/widgets');
    assert.equal(await adapter.getDefaultBranch(), 'trunk');
    const call = stub.calls[0];
    assert.equal(call?.method, 'GET');
    assert.equal(call?.path, '/repos/acme/widgets');
    assert.equal(call?.headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(stub.calls.length, 2);
  });

  it('maps merge requests including drafts, conflicts and merged state', async (t) => {
    const stub = await startStub(t, (call, res) => {
      if (call.path === '/repos/acme/widgets/pulls') {
        json(res, 200, [
          {
            number: 7,
            title: 'feat: task',
            state: 'open',
            draft: true,
            locked: false,
            mergeable: false,
            mergeable_state: 'dirty',
            user: { login: 'octocat' },
            head: { ref: 'task/abc' },
            base: { ref: 'main' },
            updated_at: '2026-01-02T03:04:05Z',
            html_url: 'https://github.com/acme/widgets/pull/7',
          },
          {
            number: 8,
            title: 'already merged',
            state: 'closed',
            merged_at: '2026-01-01T00:00:00Z',
            user: { login: 'octocat' },
            head: { ref: 'task/merged' },
            base: { ref: 'main' },
            updated_at: '2026-01-01T00:00:00Z',
            html_url: 'https://github.com/acme/widgets/pull/8',
          },
          {
            number: 9,
            title: 'locked',
            state: 'open',
            locked: true,
            user: { login: 'octocat' },
            head: { ref: 'task/locked' },
            base: { ref: 'main' },
            updated_at: '2026-01-01T00:00:00Z',
            html_url: 'https://github.com/acme/widgets/pull/9',
          },
        ]);
        return;
      }
      json(res, 404, { message: 'Not Found' });
    });
    const adapter = new GitHubAdapter({ owner: 'acme', repo: 'widgets', token: TOKEN, apiBaseUrl: stub.baseUrl });
    const mergeRequests = await adapter.listMergeRequests();
    assert.equal(mergeRequests.length, 3);
    assert.equal(mergeRequests[0]?.iid, 7);
    assert.equal(mergeRequests[0]?.sourceBranch, 'task/abc');
    assert.equal(mergeRequests[0]?.targetBranch, 'main');
    assert.equal(mergeRequests[0]?.state, 'opened');
    assert.equal(mergeRequests[0]?.draft, true);
    assert.equal(mergeRequests[0]?.hasConflicts, true);
    assert.equal(mergeRequests[0]?.author.name, 'octocat');
    assert.equal(mergeRequests[1]?.state, 'merged');
    assert.equal(mergeRequests[2]?.state, 'locked');
    assert.equal(mergeRequests[0]?.pipeline, null);
    assert.equal(stub.calls[0]?.query.get('state'), 'all');
    assert.equal(stub.calls[0]?.query.get('per_page'), '30');

    const mergedOnly = await adapter.listMergeRequests({ state: 'merged' });
    assert.equal(mergedOnly.length, 1);
    assert.equal(stub.calls[1]?.query.get('state'), 'closed');
  });

  it('creates a merge request with the expected body', async (t) => {
    const stub = await startStub(t, (call, res) => {
      // 创建前会先核对同 source → target 的打开 MR（DEL-14 口径）。
      if (call.method === 'GET' && call.path === '/repos/acme/widgets/pulls') {
        json(res, 200, []);
        return;
      }
      if (call.method === 'POST' && call.path === '/repos/acme/widgets/pulls') {
        json(res, 201, {
          number: 10,
          title: 'feat: task',
          state: 'open',
          draft: false,
          user: { login: 'octocat' },
          head: { ref: 'task/abc' },
          base: { ref: 'main' },
          updated_at: '2026-01-02T03:04:05Z',
          html_url: 'https://github.com/acme/widgets/pull/10',
        });
        return;
      }
      json(res, 404, { message: 'Not Found' });
    });
    const adapter = new GitHubAdapter({ owner: 'acme', repo: 'widgets', token: TOKEN, apiBaseUrl: stub.baseUrl });
    const created = await adapter.createMergeRequest({
      sourceBranch: 'task/abc',
      targetBranch: 'main',
      title: 'feat: task',
      description: 'body',
      draft: true,
    });
    assert.equal(created.iid, 10);
    const call = stub.calls.find((entry) => entry.method === 'POST');
    assert.equal(call?.method, 'POST');
    assert.equal(call?.headers.authorization, `Bearer ${TOKEN}`);
    const body = JSON.parse(call?.body ?? '{}') as Record<string, unknown>;
    assert.deepEqual(body, { title: 'feat: task', head: 'task/abc', base: 'main', body: 'body', draft: true });
  });

  it('maps duplicate and auth failures to shared error codes without leaking tokens', async (t) => {
    const stub = await startStub(t, (call, res) => {
      if (call.method === 'GET' && call.path === '/repos/acme/widgets/pulls') {
        json(res, 200, []);
        return;
      }
      if (call.method === 'POST') {
        json(res, 422, { message: 'Validation Failed', errors: [{ message: 'A pull request already exists for acme:task/abc.' }] });
        return;
      }
      json(res, 401, { message: `Bad credentials for ${TOKEN}` });
    });
    const adapter = new GitHubAdapter({ owner: 'acme', repo: 'widgets', token: TOKEN, apiBaseUrl: stub.baseUrl });
    const duplicate = await expectCode(
      adapter.createMergeRequest({ sourceBranch: 'task/abc', targetBranch: 'main', title: 'x' }),
      ErrorCode.MR_ALREADY_EXISTS,
    );
    assert.doesNotMatch(JSON.stringify((duplicate as { toJSON(): unknown }).toJSON()), new RegExp(TOKEN));
    const auth = (await expectCode(adapter.getProject(), ErrorCode.GITLAB_AUTH_FAILED)) as { message: string; toJSON(): unknown };
    assert.doesNotMatch(auth.message, new RegExp(TOKEN));
    assert.doesNotMatch(JSON.stringify(auth.toJSON()), new RegExp(TOKEN));
  });

  it('pre-checks an existing open MR and links to it without POSTing (DEL-14 / GIT-06)', async (t) => {
    const stub = await startStub(t, (call, res) => {
      if (call.method === 'GET' && call.path === '/repos/acme/widgets/pulls') {
        json(res, 200, [
          {
            number: 58,
            title: 'fix: refund',
            state: 'open',
            user: { login: 'octocat' },
            head: { ref: 'ai-fix/a1b2c3d-1013' },
            base: { ref: 'main' },
            updated_at: '2026-01-02T03:04:05Z',
            html_url: 'https://github.com/acme/widgets/pull/58',
          },
        ]);
        return;
      }
      json(res, 500, { message: 'POST must not be sent when an open MR already exists' });
    });
    const adapter = new GitHubAdapter({ owner: 'acme', repo: 'widgets', token: TOKEN, apiBaseUrl: stub.baseUrl });
    const error = (await expectCode(
      adapter.createMergeRequest({ sourceBranch: 'ai-fix/a1b2c3d-1013', targetBranch: 'main', title: 'fix: refund' }),
      ErrorCode.MR_ALREADY_EXISTS,
    )) as { toJSON(): { details?: Record<string, unknown> } };
    const details = error.toJSON().details ?? {};
    assert.equal(details.iid, 58);
    assert.equal(details.webUrl, 'https://github.com/acme/widgets/pull/58');
    assert.equal(stub.calls.some((entry) => entry.method === 'POST'), false);
  });

  it('reports connection states and lists protected branches', async (t) => {
    const stub = await startStub(t, (call, res) => {
      if (call.path === '/user') {
        json(res, 200, { login: 'octocat' });
        return;
      }
      if (call.path === '/repos/acme/widgets/branches') {
        json(res, 200, [
          { name: 'main', protected: true },
          { name: 'feature', protected: false },
        ]);
        return;
      }
      json(res, 404, { message: 'Not Found' });
    });
    const adapter = new GitHubAdapter({ owner: 'acme', repo: 'widgets', token: TOKEN, apiBaseUrl: stub.baseUrl });
    const status = await adapter.testConnection();
    assert.equal(status.state, 'connected');
    assert.equal(status.provider, 'github');
    assert.equal(status.accountUsername, 'octocat');
    assert.ok(status.lastVerifiedAt !== undefined);
    assert.deepEqual(await adapter.listProtectedBranches(), ['main']);
    assert.equal(stub.calls[1]?.query.get('protected'), 'true');
  });

  it('maps auth failure and unreachable hosts in testConnection', async (t) => {
    const stub = await startStub(t, (_call, res) => json(res, 401, { message: 'Bad credentials' }));
    const adapter = new GitHubAdapter({ owner: 'acme', repo: 'widgets', token: TOKEN, apiBaseUrl: stub.baseUrl });
    assert.equal((await adapter.testConnection()).state, 'auth_failed');
    const unreachable = new GitHubAdapter({ owner: 'acme', repo: 'widgets', token: TOKEN, apiBaseUrl: 'http://127.0.0.1:1', timeoutMs: 2_000 });
    assert.equal((await unreachable.testConnection()).state, 'unreachable');
  });

  it('rejects invalid owner/repo and validates create input', async (t) => {
    const stub = await startStub(t, (_call, res) => json(res, 500, { message: 'unused' }));
    assert.throws(() => new GitHubAdapter({ owner: 'bad/name', repo: 'x', token: TOKEN, apiBaseUrl: stub.baseUrl }), (error: unknown) => isAppError(error) && error.code === ErrorCode.VALIDATION_FAILED);
    const adapter = new GitHubAdapter({ owner: 'acme', repo: 'widgets', token: TOKEN, apiBaseUrl: stub.baseUrl });
    await expectCode(
      adapter.createMergeRequest({ sourceBranch: 'bad..branch', targetBranch: 'main', title: 'x' }),
      ErrorCode.VALIDATION_FAILED,
    );
    await expectCode(
      adapter.createMergeRequest({ sourceBranch: 'task/x', targetBranch: 'main', title: '   ' }),
      ErrorCode.VALIDATION_FAILED,
    );
  });
});

/* ------------------------------------------------------------------ */
/* GitLab                                                              */
/* ------------------------------------------------------------------ */

describe('GitLabAdapter', () => {
  it('encodes project ids and uses a private token header', async (t) => {
    const stub = await startStub(t, (call, res) => {
      if (call.path === '/projects/group%2Fsubgroup%2Fproj') {
        json(res, 200, {
          id: 9,
          name: 'proj',
          path_with_namespace: 'group/subgroup/proj',
          web_url: 'https://gitlab.example.com/group/subgroup/proj',
          default_branch: 'main',
        });
        return;
      }
      json(res, 404, { message: 'Not Found' });
    });
    const adapter = new GitLabAdapter({
      projectId: 'group/subgroup/proj',
      token: GITLAB_TOKEN,
      apiBaseUrl: stub.baseUrl,
      webBaseUrl: 'https://gitlab.example.com',
    });
    const project = await adapter.getProject();
    assert.equal(project.pathWithNamespace, 'group/subgroup/proj');
    assert.equal(project.defaultBranch, 'main');
    assert.equal(await adapter.getDefaultBranch(), 'main');
    assert.equal(stub.calls[0]?.path, '/projects/group%2Fsubgroup%2Fproj');
    assert.equal(stub.calls[0]?.headers['private-token'], GITLAB_TOKEN);
    assert.equal(stub.calls[0]?.query.get('private_token'), null);
    assert.ok(!(stub.calls[0]?.path ?? '').includes(GITLAB_TOKEN));
  });

  it('maps merge requests, drafts, pipelines and conflicts', async (t) => {
    const stub = await startStub(t, (call, res) => {
      if (call.path === '/projects/9/merge_requests') {
        json(res, 200, [
          {
            iid: 3,
            title: 'Draft: feat',
            state: 'opened',
            draft: true,
            has_conflicts: true,
            source_branch: 'task/abc',
            target_branch: 'main',
            author: { name: 'Zhang San', username: 'zhangsan' },
            updated_at: '2026-01-02T03:04:05Z',
            web_url: 'https://gitlab.example.com/group/proj/-/merge_requests/3',
            head_pipeline: { status: 'running' },
          },
          {
            iid: 4,
            title: 'merged',
            state: 'merged',
            source_branch: 'task/done',
            target_branch: 'main',
            author: { username: 'lisi' },
            updated_at: '2026-01-01T00:00:00Z',
            web_url: 'https://gitlab.example.com/group/proj/-/merge_requests/4',
          },
        ]);
        return;
      }
      json(res, 404, { message: 'Not Found' });
    });
    const adapter = new GitLabAdapter({ projectId: 9, token: GITLAB_TOKEN, apiBaseUrl: stub.baseUrl });
    const mergeRequests = await adapter.listMergeRequests({ limit: 10 });
    assert.equal(mergeRequests.length, 2);
    assert.equal(mergeRequests[0]?.iid, 3);
    assert.equal(mergeRequests[0]?.draft, true);
    assert.equal(mergeRequests[0]?.hasConflicts, true);
    assert.equal(mergeRequests[0]?.author.name, 'Zhang San');
    assert.equal(mergeRequests[0]?.author.initials, 'ZS');
    assert.deepEqual(mergeRequests[0]?.pipeline, { status: 'running' });
    assert.equal(mergeRequests[1]?.state, 'merged');
    assert.equal(stub.calls[0]?.query.get('per_page'), '10');
    assert.equal(stub.calls[0]?.query.get('state'), 'all');
  });

  it('creates a merge request and maps duplicate errors', async (t) => {
    let mode: 'create' | 'duplicate' = 'create';
    const stub = await startStub(t, (call, res) => {
      if (call.path !== '/projects/9/merge_requests') {
        json(res, 404, { message: 'Not Found' });
        return;
      }
      if (call.method === 'GET') {
        json(res, 200, []);
        return;
      }
      if (mode === 'duplicate') {
        json(res, 409, { message: 'Another open merge request already exists for this source branch' });
        return;
      }
      json(res, 201, {
        iid: 11,
        title: 'feat',
        state: 'opened',
        source_branch: 'task/abc',
        target_branch: 'main',
        author: { username: 'zhangsan' },
        updated_at: '2026-01-02T03:04:05Z',
        web_url: 'https://gitlab.example.com/mr/11',
      });
    });
    const adapter = new GitLabAdapter({ projectId: 9, token: GITLAB_TOKEN, apiBaseUrl: stub.baseUrl });
    const created = await adapter.createMergeRequest({
      sourceBranch: 'task/abc',
      targetBranch: 'main',
      title: 'feat',
      removeSourceBranch: true,
    });
    assert.equal(created.iid, 11);
    const body = JSON.parse(stub.calls.find((entry) => entry.method === 'POST')?.body ?? '{}') as Record<string, unknown>;
    assert.deepEqual(body, {
      source_branch: 'task/abc',
      target_branch: 'main',
      title: 'feat',
      description: '',
      remove_source_branch: true,
    });
    mode = 'duplicate';
    await expectCode(
      adapter.createMergeRequest({ sourceBranch: 'task/abc', targetBranch: 'main', title: 'feat' }),
      ErrorCode.MR_ALREADY_EXISTS,
    );
  });

  it('maps 401 to auth failure without leaking the token', async (t) => {
    const stub = await startStub(t, (_call, res) => json(res, 401, { message: '401 Unauthorized' }));
    const adapter = new GitLabAdapter({ projectId: 9, token: GITLAB_TOKEN, apiBaseUrl: stub.baseUrl });
    const error = (await expectCode(adapter.getProject(), ErrorCode.GITLAB_AUTH_FAILED)) as { toJSON(): unknown };
    assert.doesNotMatch(JSON.stringify(error.toJSON()), new RegExp(GITLAB_TOKEN));
    assert.equal((await adapter.testConnection()).state, 'auth_failed');
  });

  it('reports not_configured without making a request', async (t) => {
    const stub = await startStub(t, (_call, res) => json(res, 200, {}));
    const adapter = new GitLabAdapter({ projectId: 9, token: '', apiBaseUrl: stub.baseUrl });
    await expectCode(adapter.getProject(), ErrorCode.GITLAB_NOT_CONFIGURED);
    assert.equal((await adapter.testConnection()).state, 'not_configured');
    assert.equal(stub.calls.length, 0);
  });

  it('resolves tokens from a provider function and never puts them in the URL', async (t) => {
    const stub = await startStub(t, (call, res) => {
      assert.equal(call.path, '/user');
      json(res, 200, { username: 'zhangsan' });
    });
    let tokenCalls = 0;
    const adapter = new GitLabAdapter({
      projectId: 'g/p',
      token: () => {
        tokenCalls += 1;
        return GITLAB_TOKEN;
      },
      apiBaseUrl: stub.baseUrl,
    });
    const status = await adapter.testConnection();
    assert.equal(status.state, 'connected');
    assert.equal(status.accountUsername, 'zhangsan');
    assert.equal(tokenCalls, 1);
    assert.ok(!stub.calls[0]?.path.includes(GITLAB_TOKEN));
    assert.equal(stub.calls[0]?.headers['private-token'], GITLAB_TOKEN);
  });

  it('lists protected branches', async (t) => {
    const stub = await startStub(t, (call, res) => {
      if (call.path === '/projects/9/protected_branches') {
        json(res, 200, [{ name: 'main' }, { name: 'release/*' }]);
        return;
      }
      json(res, 404, { message: 'Not Found' });
    });
    const adapter = new GitLabAdapter({ projectId: 9, token: GITLAB_TOKEN, apiBaseUrl: stub.baseUrl });
    assert.deepEqual(await adapter.listProtectedBranches(), ['main', 'release/*']);
  });

  it('rejects invalid base URLs and project ids', async (t) => {
    const stub = await startStub(t, (_call, res) => json(res, 200, {}));
    assert.throws(
      () => new GitLabAdapter({ projectId: 9, token: GITLAB_TOKEN, apiBaseUrl: 'ftp://example.com' }),
      (error: unknown) => isAppError(error) && error.code === ErrorCode.NOT_CONFIGURED,
    );
    assert.throws(
      () => new GitLabAdapter({ projectId: '-bad', token: GITLAB_TOKEN, apiBaseUrl: stub.baseUrl }),
      (error: unknown) => isAppError(error) && error.code === ErrorCode.VALIDATION_FAILED,
    );
  });
});

describe('createRemoteProvider', () => {
  it('constructs the configured provider', () => {
    const github = createRemoteProvider({ provider: 'github', owner: 'acme', repo: 'widgets', token: TOKEN });
    assert.equal(github.provider, 'github');
    const gitlab = createRemoteProvider({ provider: 'gitlab', projectId: 9, token: GITLAB_TOKEN });
    assert.equal(gitlab.provider, 'gitlab');
  });
});
