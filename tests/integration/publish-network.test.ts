import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DEFAULT_SETTINGS, mergeSettings, validateSettings } from '@agent-workflow/shared';
import { networkFetch } from '../../packages/server/src/remote-network.ts';

test('publishing blocks unapproved HTTP and redirects before credentials reach another host', async () => {
  let requests = 0;
  const server = createServer((request, response) => { requests++; if (request.url === '/redirect') { response.writeHead(302, { location: '/target' }); response.end(); } else { response.end('{"ok":true}'); } });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await assert.rejects(networkFetch({ ...DEFAULT_SETTINGS.git.network, allowedHttpHosts: [] })(url, { headers: { authorization: 'fixture-only' } }), /HTTP 主机未获/);
    assert.equal(requests, 0);
    assert.deepEqual(await (await networkFetch(DEFAULT_SETTINGS.git.network)(url)).json(), { ok: true });
    await assert.rejects(networkFetch(DEFAULT_SETTINGS.git.network)(`${url}/redirect`));
    assert.equal(requests, 2, 'redirect destination must not receive a request');
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test('publishing request deadline includes a stalled response body; saved settings validate bounds', async () => {
  const server = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.write('{'); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const started = Date.now();
    await assert.rejects(networkFetch({ ...DEFAULT_SETTINGS.git.network, requestTimeoutMs: 60 })(`http://127.0.0.1:${(server.address() as { port: number }).port}`));
    assert.ok(Date.now() - started < 1500);
    const bad = mergeSettings(DEFAULT_SETTINGS, { git: { network: { allowedHttpHosts: ['https://example.test/path'], connectTimeoutMs: 0, requestTimeoutMs: 999999 } } });
    assert.equal(validateSettings(bad).filter((item) => item.path.startsWith('git.network.')).length, 3);
    assert.equal(validateSettings(DEFAULT_SETTINGS).length, 0);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
