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

test('original lookup distinguishes an accepted request from an unknown result without redispatch', async () => {
  let writes = 0;
  globalThis.fetch = async () => { writes++; return envelope({ receipt: { status: 'accepted' } }); };
  await request('/api/projects/p1/charter/generate', { method: 'POST', body: { requestKey: 'charter-original' } });
  assert.equal(pendingCommands()[0]?.phase, 'accepted');
  await assert.rejects(request('/api/projects/p1/charter/generate', { method: 'POST', body: { requestKey: 'new-generation' } }), /原请求已受理/);
  globalThis.fetch = async () => envelope({ operation: { requestKey: 'charter-original', status: 'unknown' } });
  await request('/api/operations/charter-original');
  assert.equal(pendingCommands()[0]?.phase, undefined);
  await assert.rejects(request('/api/projects/p1/charter/stop', { method: 'POST', body: { requestKey: 'new-stop' } }), /待核对/);
  assert.equal(writes, 1);
});

test('an in-flight write shows sending only in this page lifetime, then a lost response remains unknown', async () => {
  let rejectResponse: ((error: Error) => void) | undefined;
  globalThis.fetch = async () => new Promise<Response>((_resolve, reject) => { rejectResponse = reject; });
  const pending = request('/api/opencode/start', { method: 'POST', body: { requestKey: 'runtime-sending' } });
  assert.equal(pendingCommands()[0]?.phase, 'sending');
  assert.equal(JSON.parse([...values.values()][0] ?? '[]')[0]?.phase, undefined);
  rejectResponse!(new Error('connection lost'));
  await assert.rejects(pending, /runtime-sending/);
  assert.equal(pendingCommands()[0]?.phase, undefined);
});

test('valid envelope without receipt retains key; create project and task are tracked too', async () => {
  globalThis.fetch = async () => envelope({});
  await assert.rejects(request('/api/projects', { method: 'POST', body: { requestKey: 'missing-receipt' } }), /missing-receipt/);
  assert.equal(pendingCommands()[0]?.requestKey, 'missing-receipt');
  globalThis.fetch = async () => { throw new TypeError('lost'); };
  await assert.rejects(request('/api/tasks', { method: 'POST', body: { requestKey: 'create-task-key' } }), /create-task-key/);
  assert.ok(pendingCommands().some((item) => item.requestKey === 'create-task-key'));
});

test('a confirmed original receipt supersedes sending while the long response is still pending', async () => {
  let finish: ((response: Response) => void) | undefined;
  globalThis.fetch = async (input) => String(input).includes('/operations/') ? envelope({ operation: { requestKey: 'long-ask', status: 'accepted' } }) : new Promise<Response>((resolve) => { finish = resolve; });
  const running = request('/api/knowledge/ask', { method: 'POST', body: { requestKey: 'long-ask' } });
  assert.equal(pendingCommands()[0]?.phase, 'sending');
  await request('/api/operations/long-ask');
  assert.equal(pendingCommands()[0]?.phase, 'accepted');
  await assert.rejects(request('/api/knowledge/ask', { method: 'POST', body: { requestKey: 'duplicate' } }), /原请求已受理/);
  finish!(envelope({ receipt: { status: 'succeeded' } }));
  await running;
  assert.equal(pendingCommands().length, 0);
});
test('failed durable storage prevents dispatch', async () => {
  const storage = globalThis.localStorage;
  let writes = 0;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => '[]', setItem: () => { throw new Error('quota'); } } });
  globalThis.fetch = async () => { writes++; return envelope({ receipt: { status: 'succeeded' } }); };
  try {
    await assert.rejects(request('/api/settings', { method: 'PATCH', body: { requestKey: 'no-storage' } }), /尚未发送/);
    assert.equal(writes, 0);
  } finally { Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage }); }
});
