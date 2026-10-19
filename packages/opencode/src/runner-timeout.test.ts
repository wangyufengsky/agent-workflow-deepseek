import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OpenCodeClient } from './client.ts';
import { SessionRunner } from './runner.ts';

// Driver control-flow fixture; this never invokes a model.
function client(idleAfter: number) {
  let aborts = 0;
  const fake = {
    promptAsync: async () => {},
    messages: async () => [],
    abort: async () => { aborts++; return true; },
    events: async function* () {
      await new Promise((resolve) => setTimeout(resolve, idleAfter));
      yield { type: 'session.idle', properties: { sessionID: 's' } };
    },
  };
  return { value: fake as unknown as OpenCodeClient, aborts: () => aborts };
}

test('zero business timeout waits for explicit idle instead of firing an immediate timer', async () => {
  const c = client(15);
  const outcome = await new SessionRunner(c.value, 's').run({ text: 'offline', model: { providerID: 'offline', modelID: 'offline' } }, { timeoutMs: 0 });
  assert.equal(outcome.idle, true);
  assert.equal(outcome.timedOut, false);
  assert.equal(c.aborts(), 0);
});

test('positive timeout requests abort and still records the eventual idle evidence', async () => {
  const c = client(25);
  const outcome = await new SessionRunner(c.value, 's').run({ text: 'offline', model: { providerID: 'offline', modelID: 'offline' } }, { timeoutMs: 5 });
  assert.equal(outcome.timedOut, true);
  assert.equal(c.aborts(), 1);
});

for (const acknowledged of [true, false]) test(`result-submit stream closure records runtime abort acknowledgement=${String(acknowledged)}`, async () => {
  let aborts = 0;
  const fake = {
    promptAsync: async () => {}, messages: async () => [],
    abort: async () => { aborts++; return acknowledged; },
    events: async function* (signal: AbortSignal) {
      yield { type: 'session.next.tool.called', properties: { sessionID: 's', tool: 'workflow.result.submit' } };
      await new Promise<void>((resolve) => { signal.addEventListener('abort', () => resolve(), { once: true }); });
    },
  };
  const outcome = await new SessionRunner(fake as unknown as OpenCodeClient, 's').run({ text: 'offline', model: { providerID: 'offline', modelID: 'offline' } }, { timeoutMs: 0, abortGraceMs: 5, abortOnEvent: (event) => event.type === 'session.next.tool.called' });
  assert.equal(aborts, 1);
  assert.equal(outcome.idle, false);
  assert.equal(outcome.stoppedConfirmed, acknowledged);
  assert.equal(outcome.timedOut, false);
});
