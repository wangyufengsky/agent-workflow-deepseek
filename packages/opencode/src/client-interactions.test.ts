import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { OpenCodeClient } from './client.ts';

// Actual HTTP transport against a deterministic protocol fixture, no model.
test('1.19 V2 session-scoped permission/question APIs handle 204, preserve body and never use legacy global writes', async () => {
  const seen: { path: string; method: string; body: unknown }[] = [];
  const server = createServer(async (request, response) => {
    let text = ''; for await (const chunk of request) text += chunk;
    seen.push({ path: request.url!, method: request.method!, body: text ? JSON.parse(text) : undefined });
    if (request.method === 'GET') { response.setHeader('content-type','application/json'); response.end(JSON.stringify({ data: [{ id: 'per_a', sessionID: 'ses_a', action: 'read', resources: ['/a'] }, { id: 'per_b', sessionID: 'ses_other' }] })); }
    else { response.writeHead(204); response.end(); }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    const client = new OpenCodeClient(`http://127.0.0.1:${address.port}`, 'offline');
    assert.equal((await client.runtimeRequests('ses_a','permission','v2')).length, 1);
    await client.replyRuntimePermission('ses_a','per_a','once','v2');
    await client.replyRuntimeQuestion('ses_a','que_a',[['A','B']],'v2');
    await client.replyRuntimeQuestion('ses_a','que_b',undefined,'v2');
    assert.deepEqual(seen, [
      { path: '/api/session/ses_a/permission', method: 'GET', body: undefined },
      { path: '/api/session/ses_a/permission/per_a/reply', method: 'POST', body: { reply: 'once' } },
      { path: '/api/session/ses_a/question/que_a/reply', method: 'POST', body: { answers: [['A','B']] } },
      { path: '/api/session/ses_a/question/que_b/reject', method: 'POST', body: undefined },
    ]);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
