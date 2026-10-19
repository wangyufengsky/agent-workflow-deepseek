import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { describe, it } from 'node:test';
import { AppError, ErrorCode } from '@agent-workflow/shared';
import { InternalApiClient, buildQueryString } from './client.ts';

interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingMessage['headers'];
  readonly body: string;
}

interface FakeServer {
  readonly baseUrl: string;
  readonly requests: RecordedRequest[];
  close(): Promise<void>;
}

async function startFakeServer(handler: (request: RecordedRequest, response: ServerResponse) => void): Promise<FakeServer> {
  const requests: RecordedRequest[] = [];
  const server: Server = createServer((incoming, response) => {
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    incoming.on('end', () => {
      const request: RecordedRequest = {
        method: incoming.method ?? 'GET',
        url: incoming.url ?? '/',
        headers: incoming.headers,
        body: Buffer.concat(chunks).toString('utf8'),
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

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function codeOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof AppError, `expected AppError, got ${String(error)}`);
    return error;
  }
  assert.fail('expected the client to reject');
}

describe('internal API client: envelopes', () => {
  it('sends bearer auth and returns the data envelope', async () => {
    const server = await startFakeServer((_request, response) => json(response, 200, { data: { task: { id: 't1' } } }));
    try {
      const client = new InternalApiClient({ baseUrl: server.baseUrl, token: 'secret-token', timeoutMs: 1000 });
      const data = await client.get<{ task: { id: string } }>('/internal/mcp/context', { taskId: 't1', nodeId: 'n1' });
      assert.deepEqual(data, { task: { id: 't1' } });
      const [request] = server.requests;
      assert.equal(request?.method, 'GET');
      assert.match(request?.url ?? '', /^\/internal\/mcp\/context\?/);
      assert.match(request?.url ?? '', /taskId=t1/);
      assert.match(request?.url ?? '', /nodeId=n1/);
      assert.equal(request?.headers.authorization, 'Bearer secret-token');
      assert.equal(request?.headers['x-agent-workflow-client'], 'mcp');
    } finally {
      await server.close();
    }
  });

  it('posts JSON bodies with the right method and content type', async () => {
    const server = await startFakeServer((_request, response) => json(response, 200, { data: { ok: true } }));
    try {
      const client = new InternalApiClient({ baseUrl: server.baseUrl, token: 'tok', timeoutMs: 1000 });
      const data = await client.post('/internal/mcp/plan-submit', { taskId: 't1', roundId: 'r1', candidate: { summary: 'x' } });
      assert.deepEqual(data, { ok: true });
      const [request] = server.requests;
      assert.equal(request?.method, 'POST');
      assert.equal(request?.headers['content-type'], 'application/json');
      assert.deepEqual(JSON.parse(request?.body ?? '{}'), { taskId: 't1', roundId: 'r1', candidate: { summary: 'x' } });
    } finally {
      await server.close();
    }
  });

  it('maps an error envelope to the shared error code and keeps details', async () => {
    const server = await startFakeServer((_request, response) =>
      json(response, 400, {
        error: {
          code: 'VALIDATION_FAILED',
          message: '规划候选校验失败',
          details: { problems: [{ code: 'MISSING_STEP', message: '缺少 design 步骤' }] },
        },
      }),
    );
    try {
      const client = new InternalApiClient({ baseUrl: server.baseUrl, token: 'tok', timeoutMs: 1000 });
      const error = await codeOf(client.post('/internal/mcp/plan-submit', {}));
      assert.equal(error.code, ErrorCode.VALIDATION_FAILED);
      assert.deepEqual((error.details?.problems as unknown[]).length, 1);
      assert.equal(error.details?.status, 400);
    } finally {
      await server.close();
    }
  });

  it('preserves extended workspace codes returned by the server', async () => {
    const server = await startFakeServer((_request, response) =>
      json(response, 403, { error: { code: 'PATH_ESCAPE', message: '路径越界', details: { path: '../x' } } }),
    );
    try {
      const client = new InternalApiClient({ baseUrl: server.baseUrl, token: 'tok', timeoutMs: 1000 });
      const error = await codeOf(client.get('/internal/mcp/workspace/file', { taskId: 't', path: '../x' }));
      assert.equal(error.code, 'PATH_ESCAPE');
      assert.equal(error.message, '路径越界');
    } finally {
      await server.close();
    }
  });

  it('maps HTTP status when the body has no error envelope', async () => {
    const server = await startFakeServer((_request, response) => {
      response.writeHead(401, { 'content-type': 'text/plain' });
      response.end('unauthorized');
    });
    try {
      const client = new InternalApiClient({ baseUrl: server.baseUrl, token: 'tok', timeoutMs: 1000 });
      const error = await codeOf(client.get('/internal/mcp/context', { taskId: 't' }));
      assert.equal(error.code, ErrorCode.UNAUTHORIZED);
    } finally {
      await server.close();
    }
  });

  it('maps a non-JSON body and a missing data envelope to INTERNAL_ERROR', async () => {
    const server = await startFakeServer((request, response) => {
      if (request.url.includes('plain')) {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('not json');
        return;
      }
      json(response, 200, { unexpected: true });
    });
    try {
      const client = new InternalApiClient({ baseUrl: server.baseUrl, token: 'tok', timeoutMs: 1000 });
      assert.equal((await codeOf(client.get('/plain'))).code, ErrorCode.INTERNAL_ERROR);
      assert.equal((await codeOf(client.get('/internal/mcp/context'))).code, ErrorCode.INTERNAL_ERROR);
    } finally {
      await server.close();
    }
  });
});

describe('internal API client: transport failures', () => {
  it('maps request timeouts to MCP_NOT_AVAILABLE', async () => {
    const server = await startFakeServer((_request, response) => {
      setTimeout(() => json(response, 200, { data: { late: true } }), 300);
    });
    try {
      const client = new InternalApiClient({ baseUrl: server.baseUrl, token: 'tok', timeoutMs: 50 });
      const error = await codeOf(client.get('/slow'));
      assert.equal(error.code, ErrorCode.MCP_NOT_AVAILABLE);
      assert.equal(error.details?.reason, 'timeout');
    } finally {
      await server.close();
    }
  });

  it('maps refused connections to MCP_NOT_AVAILABLE without leaking the token', async () => {
    const server = await startFakeServer((_request, response) => json(response, 200, { data: {} }));
    const baseUrl = server.baseUrl;
    await server.close();
    const client = new InternalApiClient({ baseUrl, token: 'super-secret-token', timeoutMs: 500 });
    const error = await codeOf(client.get('/internal/mcp/context', { taskId: 't' }));
    assert.equal(error.code, ErrorCode.MCP_NOT_AVAILABLE);
    assert.equal(JSON.stringify(error.toJSON()).includes('super-secret-token'), false);
  });

  it('fails a request when the internal URL is not configured', async () => {
    const client = new InternalApiClient({ baseUrl: '', token: '', timeoutMs: 100 });
    const error = await codeOf(client.get('/internal/mcp/context', { taskId: 't' }));
    assert.equal(error.code, ErrorCode.MCP_NOT_AVAILABLE);
    assert.equal(error.details?.reason, 'not_configured');
  });

  it('rejects a malformed internal URL at construction', () => {
    assert.throws(
      () => new InternalApiClient({ baseUrl: 'mysql://127.0.0.1:3306', token: '' }),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.VALIDATION_FAILED,
    );
  });
});

describe('internal API client: helpers', () => {
  it('builds query strings and skips empty values', () => {
    assert.equal(buildQueryString(undefined), '');
    assert.equal(buildQueryString({ a: 1, b: undefined, c: null }), '?a=1');
    assert.equal(buildQueryString({ a: [1, 2] }), '?a=1&a=2');
    assert.match(buildQueryString({ path: 'a b' }), /path=a\+b/);
  });
});
