import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { OpenCodeClient } from './client.ts';

test('available models use actual connected provider response and expose only public identity fields', async () => {
  let invalid = false;
  const server = createServer((request, response) => {
    assert.equal(request.url, '/provider');
    assert.ok(request.headers.authorization?.startsWith('Basic '));
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(invalid ? { unexpected: true } : { connected: ['actual'], all: [
      { id: 'actual', name: 'Actual provider', key: 'private-fixture-key', options: { apiKey: 'private-fixture-key' }, models: { selected: { name: 'Available model' }, old: { name: 'Old model', status: 'deprecated' } } },
      { id: 'unconnected', name: 'Not connected', models: { unavailable: { name: 'Unavailable' } } },
    ] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const client = new OpenCodeClient(`http://127.0.0.1:${(server.address() as { port: number }).port}`, 'fixture-only');
    const catalog = await client.availableModels();
    assert.deepEqual(catalog.models, [{ provider: 'actual', providerLabel: 'Actual provider', model: 'selected', label: 'Available model' }]);
    assert.ok(Number.isFinite(Date.parse(catalog.readAt)));
    assert.doesNotMatch(JSON.stringify(catalog), /private-fixture-key/);
    invalid = true;
    await assert.rejects(client.availableModels(), /格式无效/);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
