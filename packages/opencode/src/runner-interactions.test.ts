import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionRunner } from './runner.ts';
import type { OpenCodeClient } from './client.ts';

// Offline protocol/control-flow fixture, never a model result.
test('deferred permissions keep SSE flowing; V2 fields, question and confirmation preserve identity', async () => {
  const seen: unknown[] = []; let replies = 0;
  const fake = { promptAsync: async () => {}, messages: async () => [], abort: async () => true,
    replyRuntimePermission: async () => { replies++; },
    events: async function* () {
      yield { type: 'permission.v2.asked', properties: { id: 'per_foreign', sessionID: 'other', action: 'read', resources: ['/other'] } };
      yield { type: 'permission.v2.asked', properties: { id: 'per_ours', sessionID: 's', action: 'read', resources: ['/ours'] } };
      await new Promise((resolve) => setTimeout(resolve, 1));
      yield { type: 'question.v2.asked', properties: { id: 'que_ours', sessionID: 's', questions: [{ question: 'Which?', header: 'Choice', options: [{ label: 'A', description: 'a' }] }] } };
      yield { type: 'permission.v2.replied', properties: { sessionID: 's', requestID: 'per_ours', reply: 'once' } };
      yield { type: 'question.v2.rejected', properties: { sessionID: 's', requestID: 'que_ours' } };
      yield { type: 'session.idle', properties: { sessionID: 's' } };
    } };
  const outcome = await new SessionRunner(fake as unknown as OpenCodeClient, 's', { onPermission: (request) => { seen.push(request); return 'defer'; }, onQuestion: (request) => { seen.push(request); }, onInteractionConfirmed: (value) => { seen.push(value); } }).run({ text: 'offline', model: { providerID: 'offline', modelID: 'offline' } }, { timeoutMs: 100 });
  assert.equal(outcome.idle, true); assert.equal(replies, 0);
  assert.deepEqual(seen[0], { id: 'per_ours', sessionID: 's', protocol: 'v2', permission: 'read', patterns: ['/ours'], metadata: undefined });
  assert.equal(seen.length, 4);
});
test('permission reply failures reach the sink and do not stop stream consumption', async () => {
  const errors: string[] = [];
  const fake = { promptAsync: async () => {}, messages: async () => [], abort: async () => true,
    replyRuntimePermission: async () => { throw new Error('offline reply failed'); },
    events: async function* () { yield { type: 'permission.asked', properties: { id: 'per_a', sessionID: 's', permission: 'read', patterns: ['/a'] } }; await new Promise((resolve) => setTimeout(resolve, 5)); yield { type: 'session.idle', properties: { sessionID: 's' } }; } };
  const outcome = await new SessionRunner(fake as unknown as OpenCodeClient, 's', { onPermission: () => 'reject', onInteractionReplyError: (_, message) => { errors.push(message); } }).run({ text: '', model: { providerID: 'offline', modelID: 'offline' } }, { timeoutMs: 100 });
  assert.equal(outcome.idle, true); assert.deepEqual(errors, ['offline reply failed']);
});

test('an unresolved human permission promise cannot block idle/timeout consumption', async () => {
  let replies = 0;
  const fake = { promptAsync: async () => {}, messages: async () => [], abort: async () => true, replyRuntimePermission: async () => { replies++; }, events: async function* () {
    yield { type: 'permission.asked', properties: { id: 'per_wait', sessionID: 's', permission: 'read', patterns: ['/a'] } };
    yield { type: 'session.idle', properties: { sessionID: 's' } };
  } };
  const result = await new SessionRunner(fake as unknown as OpenCodeClient, 's', { onPermission: () => new Promise(() => {}) }).run({ text: '', model: { providerID: 'offline', modelID: 'offline' } }, { timeoutMs: 30 });
  assert.equal(result.idle, true); assert.equal(result.timedOut, false); assert.equal(replies, 0);
});
