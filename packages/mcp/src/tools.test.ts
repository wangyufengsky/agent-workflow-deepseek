import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { AppError, ErrorCode } from '@agent-workflow/shared';
import { InternalMcpApi } from './api.ts';
import { InternalApiClient } from './client.ts';
import { WorkspaceExec } from './exec.ts';
import { ToolRegistry } from './registry.ts';
import { createAllTools } from './tools/index.ts';
import { validateResultSubmitArgs } from './tools/workflow.ts';
import { WorkspaceService } from './workspace.ts';

interface RecordedRequest {
  readonly method: string;
  readonly pathname: string;
  readonly query: Record<string, string>;
  readonly body: unknown;
}

interface FakeServer {
  readonly baseUrl: string;
  readonly requests: RecordedRequest[];
  close(): Promise<void>;
}

type RouteHandler = (request: RecordedRequest, response: ServerResponse) => void;

async function startFakeServer(handler: RouteHandler): Promise<FakeServer> {
  const requests: RecordedRequest[] = [];
  const server: Server = createServer((incoming: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    incoming.on('end', () => {
      const url = new URL(incoming.url ?? '/', 'http://127.0.0.1');
      const rawBody = Buffer.concat(chunks).toString('utf8');
      const request: RecordedRequest = {
        method: incoming.method ?? 'GET',
        pathname: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        body: rawBody.length === 0 ? undefined : (JSON.parse(rawBody) as unknown),
      };
      requests.push(request);
      handler(request, response);
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function routeHandler(request: RecordedRequest, response: ServerResponse): void {
  switch (request.pathname) {
    case '/internal/mcp/context':
      send(response, 200, { data: { taskId: request.query.taskId, nodeId: request.query.nodeId ?? null, attemptId: request.query.attemptId ?? null } });
      return;
    case '/internal/mcp/plan-submit': {
      const candidate = (request.body as { candidate?: { summary?: string } } | undefined)?.candidate;
      if (candidate?.summary === 'bad') {
        send(response, 400, {
          error: { code: 'VALIDATION_FAILED', message: '规划候选校验失败', details: { problems: [{ code: 'MISSING_STEP', message: '缺少 design 步骤' }] } },
        });
        return;
      }
      send(response, 200, { data: { ok: true, planRevisionId: 'plan_1', problems: [], humanDecisions: [] } });
      return;
    }
    case '/internal/mcp/question':
      send(response, 200, { data: { ok: true, questionId: 'q1' } });
      return;
    case '/internal/mcp/result-submit':
      send(response, 200, { data: { ok: true } });
      return;
    case '/internal/mcp/git/status':
    case '/internal/mcp/git/log':
    case '/internal/mcp/git/diff-files':
    case '/internal/mcp/git/commit-show':
      send(response, 200, { data: { pathname: request.pathname, query: request.query } });
      return;
    case '/internal/mcp/database/query':
      send(response, 200, { data: { connectionId: 'conn-1', rows: [], rowCount: 0, truncated: false, durationMs: 1, echo: request.body } });
      return;
    case '/internal/mcp/workspace/file':
      if (request.query.path === 'forbidden.txt') {
        send(response, 403, { error: { code: 'FORBIDDEN', message: '路径越界', details: { reason: 'path_escape' } } });
        return;
      }
      send(response, 200, {
        data: { path: request.query.path, sizeBytes: 14, sha: 'a'.repeat(64), totalLines: 1, offset: 0, lines: ['proxy-content'], truncated: false, readOnly: true },
      });
      return;
    case '/internal/mcp/workspace/files':
      send(response, 200, {
        data: { root: '/worktree', entries: [{ path: 'src/proxy.txt', kind: 'file', sizeBytes: 3 }], truncated: false },
      });
      return;
    case '/internal/mcp/workspace/file-write':
      send(response, 200, { data: { path: (request.body as { path?: string }).path, sizeBytes: 3, sha: 'b'.repeat(64) } });
      return;
    case '/internal/mcp/workspace/exec':
      send(response, 200, { data: { exitCode: 0, stdout: 'proxy-exec', stderr: '', timedOut: false } });
      return;
    default:
      send(response, 404, { error: { code: 'NOT_FOUND', message: `unknown route ${request.pathname}` } });
  }
}

interface Harness {
  readonly registry: ToolRegistry;
  readonly server: FakeServer;
  readonly close: () => Promise<void>;
}

async function harness(): Promise<Harness> {
  const server = await startFakeServer(routeHandler);
  const api = new InternalMcpApi(new InternalApiClient({ baseUrl: server.baseUrl, token: 'tok', timeoutMs: 2000 }));
  const registry = new ToolRegistry();
  registry.registerAll(createAllTools({ api }));
  return { registry, server, close: () => server.close() };
}

async function call(registry: ToolRegistry, name: string, args: Record<string, unknown>): Promise<unknown> {
  return registry.require(name).handler(args);
}

async function rejected(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof AppError, `expected AppError, got ${String(error)}`);
    return error;
  }
  assert.fail('expected rejection');
}

function onlyRequest(server: FakeServer): RecordedRequest {
  assert.equal(server.requests.length, 1);
  const request = server.requests[0];
  assert.ok(request !== undefined);
  return request;
}

const CANDIDATE = {
  summary: '实现登录改造',
  groups: [{ id: 'design', label: '设计', kind: 'design' }],
  nodes: [{ key: 'design', title: '设计', kind: 'planner', groupId: 'design', summary: '梳理改造点' }],
  edges: [],
};

describe('workflow tools', () => {
  it('reads context with optional node/attempt ids', async () => {
    const environment = await harness();
    try {
      const result = (await call(environment.registry, 'workflow.context.get', { taskId: 't1', nodeId: 'n1', attemptId: 'a1' })) as {
        taskId: string;
        nodeId: string;
        attemptId: string;
      };
      assert.deepEqual(result, { taskId: 't1', nodeId: 'n1', attemptId: 'a1' });
      assert.deepEqual(onlyRequest(environment.server).query, { taskId: 't1', nodeId: 'n1', attemptId: 'a1' });
    } finally {
      await environment.close();
    }
  });

  it('submits the planning candidate unchanged', async () => {
    const environment = await harness();
    try {
      const candidate = { ...CANDIDATE, extra: { keep: true } };
      const result = (await call(environment.registry, 'workflow.plan.submit', { taskId: 't1', roundId: 'r1', candidate })) as {
        ok: boolean;
        planRevisionId: string;
      };
      assert.deepEqual(result, { ok: true, planRevisionId: 'plan_1', problems: [], humanDecisions: [] });
      const request = onlyRequest(environment.server);
      assert.equal(request.method, 'POST');
      assert.deepEqual(request.body, { taskId: 't1', roundId: 'r1', candidate });
    } finally {
      await environment.close();
    }
  });

  it('rejects malformed candidates locally with fixable problems', async () => {
    const environment = await harness();
    try {
      const invalid = await rejected(
        call(environment.registry, 'workflow.plan.submit', {
          taskId: 't1',
          roundId: 'r1',
          candidate: { summary: '', groups: [], nodes: [], edges: [] },
        }),
      );
      assert.equal(invalid.code, ErrorCode.VALIDATION_FAILED);
      const problems = invalid.details?.problems as { code: string }[];
      assert.ok(problems.some((problem) => problem.code === 'EMPTY_SUMMARY'));
      assert.ok(problems.some((problem) => problem.code === 'EMPTY_NODES'));
      const unknownGroup = await rejected(
        call(environment.registry, 'workflow.plan.submit', {
          taskId: 't1',
          roundId: 'r1',
          candidate: {
            summary: 'x',
            groups: [],
            nodes: [{ key: 'design', title: '设计', kind: 'planner', groupId: 'missing', summary: '' }],
            edges: [],
          },
        }),
      );
      assert.ok((unknownGroup.details?.problems as { code: string }[]).some((problem) => problem.code === 'UNKNOWN_GROUP'));
      assert.equal(environment.server.requests.length, 0);
    } finally {
      await environment.close();
    }
  });

  it('propagates server-side validation problems for the model to fix', async () => {
    const environment = await harness();
    try {
      const error = await rejected(
        call(environment.registry, 'workflow.plan.submit', {
          taskId: 't1',
          roundId: 'r1',
          candidate: { ...CANDIDATE, summary: 'bad' },
        }),
      );
      assert.equal(error.code, ErrorCode.VALIDATION_FAILED);
      assert.deepEqual(error.details?.problems, [{ code: 'MISSING_STEP', message: '缺少 design 步骤' }]);
      assert.equal(environment.server.requests.length, 1);
    } finally {
      await environment.close();
    }
  });

  it('asks questions with the expected body', async () => {
    const environment = await harness();
    try {
      const result = await call(environment.registry, 'workflow.question.ask', {
        taskId: 't1',
        roundId: 'r1',
        question: '是否保留旧接口？',
        required: true,
        nodeKeys: ['design'],
      });
      assert.deepEqual(result, { ok: true, questionId: 'q1' });
      assert.deepEqual(onlyRequest(environment.server).body, {
        taskId: 't1',
        roundId: 'r1',
        question: '是否保留旧接口？',
        required: true,
        nodeKeys: ['design'],
      });
    } finally {
      await environment.close();
    }
  });

  it('submits node results with payload and verification verbatim', async () => {
    const environment = await harness();
    try {
      const payload = { files: ['a.ts'], extra: 1 };
      const verification = { state: 'passed', passed: 3, failed: 0, summary: 'ok' };
      const result = await call(environment.registry, 'workflow.result.submit', {
        taskId: 't1',
        nodeId: 'n1',
        attemptId: 'a1',
        summary: '完成实现',
        payload,
        verification,
      });
      assert.deepEqual(result, { ok: true });
      assert.deepEqual(onlyRequest(environment.server).body, { taskId: 't1', nodeId: 'n1', attemptId: 'a1', summary: '完成实现', payload, verification });
    } finally {
      await environment.close();
    }
  });

  it('validates result submissions locally', async () => {
    const environment = await harness();
    try {
      const error = await rejected(
        call(environment.registry, 'workflow.result.submit', {
          taskId: 't1',
          nodeId: 'n1',
          attemptId: 'a1',
          summary: 'done',
          verification: { state: 'maybe' },
        }),
      );
      assert.equal(error.code, ErrorCode.VALIDATION_FAILED);
      assert.ok((error.details?.problems as { code: string }[]).some((problem) => problem.code === 'INVALID_VERIFICATION_STATE'));
      assert.equal(environment.server.requests.length, 0);
      const validation = validateResultSubmitArgs({ taskId: 't1', nodeId: 'n1', attemptId: 'a1', summary: 's' });
      assert.equal(validation.ok, true);
    } finally {
      await environment.close();
    }
  });
});

describe('git tools', () => {
  it('forwards read-only git queries to the internal API', async () => {
    const environment = await harness();
    try {
      await call(environment.registry, 'git.repo.status', { projectId: 'p1' });
      assert.deepEqual(onlyRequest(environment.server), {
        method: 'GET',
        pathname: '/internal/mcp/git/status',
        query: { projectId: 'p1' },
        body: undefined,
      });
      environment.server.requests.length = 0;
      await call(environment.registry, 'git.log', { projectId: 'p1', limit: 20, ref: 'main' });
      assert.deepEqual(onlyRequest(environment.server).query, { projectId: 'p1', limit: '20', ref: 'main' });
      environment.server.requests.length = 0;
      await call(environment.registry, 'git.diff.files', { projectId: 'p1', baseSha: 'aaa', headSha: 'bbb' });
      assert.deepEqual(onlyRequest(environment.server).query, { projectId: 'p1', baseSha: 'aaa', headSha: 'bbb' });
      environment.server.requests.length = 0;
      await call(environment.registry, 'git.commit.show', { projectId: 'p1' });
      assert.deepEqual(onlyRequest(environment.server).query, { projectId: 'p1', sha: 'HEAD' });
      environment.server.requests.length = 0;
      await call(environment.registry, 'git.commit.show', { projectId: 'p1', sha: 'abc123' });
      assert.deepEqual(onlyRequest(environment.server).query, { projectId: 'p1', sha: 'abc123' });
    } finally {
      await environment.close();
    }
  });
});

describe('database tool', () => {
  it('proxies read-only queries with connection and limit', async () => {
    const environment = await harness();
    try {
      const result = (await call(environment.registry, 'database.query', { connectionId: 'conn-1', sql: 'SELECT 1', limit: 10 })) as {
        echo: unknown;
      };
      assert.deepEqual(result.echo, { connectionId: 'conn-1', sql: 'SELECT 1', limit: 10 });
      const request = onlyRequest(environment.server);
      assert.equal(request.method, 'POST');
      assert.equal(request.pathname, '/internal/mcp/database/query');
    } finally {
      await environment.close();
    }
  });
});

describe('workspace proxied tools', () => {
  it('proxies read/list/write/exec with taskId', async () => {
    const environment = await harness();
    try {
      const read = (await call(environment.registry, 'workspace.file.read', { taskId: 't1', path: 'src/a.ts', offset: 2, limit: 10 })) as {
        lines: string[];
      };
      assert.deepEqual(read.lines, ['proxy-content']);
      assert.deepEqual(onlyRequest(environment.server).query, { taskId: 't1', path: 'src/a.ts', offset: '2', limit: '10' });

      environment.server.requests.length = 0;
      const listed = (await call(environment.registry, 'workspace.file.list', { taskId: 't1' })) as { entries: { path: string; kind: string }[] };
      assert.equal(listed.entries[0]?.path, 'src/proxy.txt');
      assert.equal(listed.entries[0]?.kind, 'file');
      assert.deepEqual(onlyRequest(environment.server).query, { taskId: 't1' });

      environment.server.requests.length = 0;
      await call(environment.registry, 'workspace.file.write', { taskId: 't1', path: 'src/a.ts', content: 'abc' });
      assert.deepEqual(onlyRequest(environment.server).body, { taskId: 't1', path: 'src/a.ts', content: 'abc' });

      environment.server.requests.length = 0;
      const exec = (await call(environment.registry, 'workspace.exec', { taskId: 't1', command: 'git status' })) as { stdout: string };
      assert.equal(exec.stdout, 'proxy-exec');
      assert.deepEqual(onlyRequest(environment.server).body, { taskId: 't1', command: 'git status' });
    } finally {
      await environment.close();
    }
  });

  it('falls back to the local sandbox only when the service is unavailable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aw-mcp-tools-'));
    try {
      await writeFile(join(root, 'hello.txt'), 'local-content');
      const api = new InternalMcpApi(new InternalApiClient({ baseUrl: '', token: '', timeoutMs: 100 }));
      const workspace = new WorkspaceService({ root, allowWrite: false });
      const exec = new WorkspaceExec({ cwd: root, allowedCommands: ['node'], timeoutMs: 5000 });
      const registry = new ToolRegistry();
      registry.registerAll(createAllTools({ api, workspace, exec }));

      const read = (await call(registry, 'workspace.file.read', { taskId: 't1', path: 'hello.txt' })) as { lines: string[] };
      assert.deepEqual(read.lines, ['local-content']);
      const listed = (await call(registry, 'workspace.file.list', { taskId: 't1' })) as { entries: { path: string; kind: string }[] };
      assert.ok(listed.entries.some((entry) => entry.path === 'hello.txt' && entry.kind === 'file'));
      const execResult = (await call(registry, 'workspace.exec', { taskId: 't1', command: 'node -e "console.log(42)"' })) as { stdout: string };
      assert.equal(execResult.stdout.trim(), '42');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not fall back on security or validation errors from the service', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aw-mcp-tools-secure-'));
    try {
      await writeFile(join(root, 'forbidden.txt'), 'secret');
      const server = await startFakeServer(routeHandler);
      try {
        const api = new InternalMcpApi(new InternalApiClient({ baseUrl: server.baseUrl, token: 'tok', timeoutMs: 1000 }));
        const workspace = new WorkspaceService({ root, allowWrite: false });
        const registry = new ToolRegistry();
        registry.registerAll(createAllTools({ api, workspace }));
        const error = await rejected(call(registry, 'workspace.file.read', { taskId: 't1', path: 'forbidden.txt' }));
        assert.equal(error.code, ErrorCode.FORBIDDEN);
        assert.equal(error.details?.reason, 'path_escape');
      } finally {
        await server.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('requires taskId for workspace tools', async () => {
    const environment = await harness();
    try {
      const error = await rejected(call(environment.registry, 'workspace.file.list', {}));
      assert.equal(error.code, ErrorCode.VALIDATION_FAILED);
      assert.equal(environment.server.requests.length, 0);
    } finally {
      await environment.close();
    }
  });
});
