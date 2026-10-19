import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InternalApiClient } from './client.ts';
import { defineTool } from './registry.ts';

test('concurrent MCP handlers carry independent scopes into HTTP and clear after return', async () => {
  const seen: string[] = [];
  const client = new InternalApiClient({ baseUrl: 'http://localhost', fetchImpl: async (_url, init) => {
    seen.push((init?.headers as Record<string, string>)['x-agent-workflow-scope'] ?? 'none');
    return new Response(JSON.stringify({ data: true }), { status: 200 });
  } });
  const tool = defineTool({ name: 'scope.test', description: 'scope isolation test', inputSchema: { type: 'object' }, handler: async (args) => {
    await new Promise((resolve) => setTimeout(resolve, args.delay as number));
    return client.get('/scope');
  } });
  await Promise.all([tool.handler({ scopeToken: 'session-one', delay: 15 }), tool.handler({ scopeToken: 'session-two', delay: 1 })]);
  await client.get('/scope');
  assert.deepEqual(seen, ['session-two', 'session-one', 'none']);
  assert.ok(tool.inputSchema.properties?.scopeToken);
});
