import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from '../../apps/web/src/api/client.ts';
import { pendingCommands, settleCommand } from '../../apps/web/src/api/pending-commands.ts';
const originalFetch = globalThis.fetch;
const values = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } });
afterEach(() => { globalThis.fetch = originalFetch; for (const pending of pendingCommands()) settleCommand(pending.requestKey); });
const envelope = (data: unknown) => new Response(JSON.stringify({ data, meta: {} }), { status: 200 });
test('lost write response persists original key, blocks second dispatch, and only terminal lookup unlocks', async () => {
  let writes = 0;
  globalThis.fetch = async () => { writes++; throw new TypeError('response lost after commit'); };
  await assert.rejects(request('/api/tasks/t1/stop', { method: 'POST', body: { requestKey: 'original-key' } }), /original-key/);
  assert.equal(pendingCommands()[0]?.requestKey, 'original-key');
  // Reading durable storage reconstructs the identity used after a route/reload.
  assert.match([...values.values()][0] ?? '', /original-key/);
  await assert.rejects(request('/api/tasks/t1/start', { method: 'POST', body: { requestKey: 'new-key' } }), /original-key/);
  assert.equal(writes, 1);
  globalThis.fetch = async () => envelope({ operation: { requestKey: 'original-key', status: 'accepted' } });
  await request('/api/operations/original-key');
  assert.equal(pendingCommands().length, 1);
  globalThis.fetch = async () => envelope({ operation: { requestKey: 'original-key', status: 'succeeded' } });
  await request('/api/operations/original-key');
  assert.equal(pendingCommands().length, 0);
});
test('structured HTTP rejection unlocks; malformed success and server failure remain unknown', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'invalid input', code: 'VALIDATION_FAILED' } }), { status: 400 });
  await assert.rejects(request('/api/settings', { method: 'PATCH', body: { requestKey: 'rejected' } }), /invalid input/);
  assert.equal(pendingCommands().length, 0);
  globalThis.fetch = async () => new Response('broken', { status: 200 });
  await assert.rejects(request('/api/settings', { method: 'PATCH', body: { requestKey: 'malformed' } }), /malformed/);
  assert.equal(pendingCommands()[0]?.requestKey, 'malformed');
  settleCommand('malformed');
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'failed after write' } }), { status: 500 });
  await assert.rejects(request('/api/settings', { method: 'PATCH', body: { requestKey: 'server-error' } }), /server-error/);
  assert.equal(pendingCommands()[0]?.requestKey, 'server-error');
});
test('accepted PPT deletion prevents duplicate deletion but permits another operation', async () => {
  globalThis.fetch = async () => envelope({ receipt: { status: 'accepted' } });
  await request('/api/ppt/works/w1', { method: 'DELETE', body: { requestKey: 'delete-key' } });
  await assert.rejects(request('/api/ppt/works/w1', { method: 'DELETE', body: { requestKey: 'another-delete' } }), /delete-key/);
  await request('/api/ppt/works/w2', { method: 'PATCH', body: { requestKey: 'edit-key' } });
});
