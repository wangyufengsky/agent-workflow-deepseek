import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AppError, ErrorCode } from '@agent-workflow/shared';
import { ToolRegistry, defineTool } from './registry.ts';
import { createMcpServer, toZodInputSchema } from './server.ts';
import { objectSchema, stringSchema, type JsonSchemaObject } from './schema.ts';
import { buildMcpRuntime } from './runtime.ts';
import { MANAGED_TOOL_NAMES } from './tools/index.ts';

interface TextContent {
  readonly type: string;
  readonly text: string;
}

function textOf(result: unknown): string {
  assert.ok(typeof result === 'object' && result !== null);
  const content = (result as { content?: unknown }).content;
  assert.ok(Array.isArray(content) && content.length > 0);
  const first = content[0] as TextContent;
  assert.equal(first.type, 'text');
  return first.text;
}

async function connect(registry: ToolRegistry): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = createMcpServer(registry);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

function demoRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(
    defineTool({
      name: 'demo.echo',
      title: 'Echo',
      description: '返回参数',
      inputSchema: objectSchema({ value: stringSchema('值', { minLength: 1 }) }, ['value']),
      handler: async (args) => ({ echoed: args.value }),
    }),
  );
  registry.register(
    defineTool({
      name: 'demo.fail',
      description: '总是失败',
      inputSchema: objectSchema({}, []),
      handler: async () => {
        throw new AppError(ErrorCode.DATABASE_QUERY_BLOCKED, '写语句被拒绝', { details: { reason: 'forbidden_keyword', keyword: 'DELETE' } });
      },
    }),
  );
  registry.register(
    defineTool({
      name: 'demo.crash',
      description: '抛出普通错误',
      inputSchema: objectSchema({}, []),
      handler: async () => {
        throw new Error('内部堆栈不应泄露');
      },
    }),
  );
  return registry;
}

describe('tool registry', () => {
  it('registers tools and exposes deterministic metadata', () => {
    const registry = demoRegistry();
    assert.deepEqual(registry.names(), ['demo.echo', 'demo.fail', 'demo.crash']);
    const echo = registry.require('demo.echo');
    assert.equal(echo.inputSchema.type, 'object');
    assert.deepEqual(echo.inputSchema.required, ['value']);
  });

  it('rejects duplicate names and invalid definitions', () => {
    const registry = new ToolRegistry();
    const definition = defineTool({
      name: 'demo.one',
      description: 'one',
      inputSchema: objectSchema({}, []),
      handler: async () => ({}),
    });
    registry.register(definition);
    assert.throws(
      () => registry.register(definition),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.VALIDATION_FAILED,
    );
    for (const name of ['Bad Name', '1bad', 'UPPER']) {
      assert.throws(() => defineTool({ name, description: 'x', inputSchema: objectSchema({}, []), handler: async () => ({}) }));
    }
    assert.throws(() => defineTool({ name: 'demo.empty', description: '  ', inputSchema: objectSchema({}, []), handler: async () => ({}) }));
    assert.throws(
      () =>
        defineTool({
          name: 'demo.schema',
          description: 'x',
          inputSchema: { type: 'string' } as unknown as JsonSchemaObject,
          handler: async () => ({}),
        }),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.VALIDATION_FAILED,
    );
  });

  it('requires known tool names', () => {
    assert.throws(
      () => new ToolRegistry().require('missing.tool'),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.NOT_FOUND,
    );
  });

  it('converts JSON schema input definitions once', () => {
    const schema = objectSchema({ a: stringSchema('a') }, ['a']);
    assert.equal(toZodInputSchema(schema), toZodInputSchema(schema));
  });
});

describe('MCP server over in-memory transport', () => {
  it('lists tools with input schemas', async () => {
    const { client, close } = await connect(demoRegistry());
    try {
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name);
      assert.deepEqual(names, ['demo.echo', 'demo.fail', 'demo.crash']);
      const echo = listed.tools.find((tool) => tool.name === 'demo.echo');
      assert.equal(echo?.inputSchema.type, 'object');
      assert.deepEqual(echo?.inputSchema.required, ['value']);
    } finally {
      await close();
    }
  });

  it('returns successful tool payloads as JSON text', async () => {
    const { client, close } = await connect(demoRegistry());
    try {
      const result = await client.callTool({ name: 'demo.echo', arguments: { value: 'hello' } });
      assert.equal(result.isError ?? false, false);
      assert.deepEqual(JSON.parse(textOf(result)), { echoed: 'hello' });
    } finally {
      await close();
    }
  });

  it('returns structured AppError envelopes with details', async () => {
    const { client, close } = await connect(demoRegistry());
    try {
      const result = await client.callTool({ name: 'demo.fail', arguments: {} });
      assert.equal(result.isError, true);
      const payload = JSON.parse(textOf(result)) as { code: string; message: string; details?: Record<string, unknown> };
      assert.equal(payload.code, ErrorCode.DATABASE_QUERY_BLOCKED);
      assert.equal(payload.message, '写语句被拒绝');
      assert.equal(payload.details?.reason, 'forbidden_keyword');
      assert.equal(payload.details?.keyword, 'DELETE');
    } finally {
      await close();
    }
  });

  it('never leaks stack traces for unexpected errors', async () => {
    const { client, close } = await connect(demoRegistry());
    try {
      const result = await client.callTool({ name: 'demo.crash', arguments: {} });
      assert.equal(result.isError, true);
      const text = textOf(result);
      assert.equal(text.includes('内部堆栈不应泄露'), false);
      const payload = JSON.parse(text) as { code: string; details?: Record<string, unknown> };
      assert.equal(payload.code, ErrorCode.INTERNAL_ERROR);
      assert.deepEqual(payload.details, { errorName: 'Error' });
    } finally {
      await close();
    }
  });

  it('surfaces input validation failures as tool errors', async () => {
    const { client, close } = await connect(demoRegistry());
    try {
      const result = await client.callTool({ name: 'demo.echo', arguments: {} });
      assert.equal(result.isError, true);
      assert.ok(textOf(result).length > 0);
    } finally {
      await close();
    }
  });
});

describe('MCP runtime assembly', () => {
  it('registers the full managed toolset from environment configuration', () => {
    const runtime = buildMcpRuntime({
      AGENT_WORKFLOW_INTERNAL_URL: 'http://127.0.0.1:5177',
      AGENT_WORKFLOW_MCP_TOKEN: 'tok',
    });
    assert.deepEqual(runtime.registry.names(), [...MANAGED_TOOL_NAMES]);
    assert.equal(runtime.workspace, undefined);
    assert.equal(runtime.exec, undefined);
  });

  it('enables the local fallback only when a worktree is configured', () => {
    const runtime = buildMcpRuntime({
      AGENT_WORKFLOW_INTERNAL_URL: 'http://127.0.0.1:5177',
      AGENT_WORKFLOW_WORKTREE: '/tmp/worktree',
      AGENT_WORKFLOW_ALLOW_WRITE: '1',
      AGENT_WORKFLOW_ALLOWED_COMMANDS: '["git"]',
    });
    assert.ok(runtime.workspace !== undefined);
    assert.ok(runtime.exec !== undefined);
    assert.equal(runtime.workspace.allowWrite, true);
    assert.equal(runtime.exec.enabled, true);
  });
});
