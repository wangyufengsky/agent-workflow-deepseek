import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApplication } from '../../packages/server/src/application.ts';

test('application shutdown closes an active event stream before waiting for HTTP connections', { timeout: 10_000 }, async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-sse-close-')), port: 0, disableOpenCode: true });
  const request = get(`${app.url}/api/events`);
  const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => { request.once('response', resolve); request.once('error', reject); });
  const first = await new Promise<string>((resolve) => response.once('data', (value) => resolve(String(value))));
  assert.match(first, /"type":"ready"/);
  response.resume();
  const ended = new Promise<void>((resolve) => response.once('end', resolve));
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([Promise.all([app.close(), ended]), new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('active SSE prevented service shutdown')), 2000); })]);
    assert.equal(response.complete, true);
  } finally { if (deadline) clearTimeout(deadline); response.destroy(); request.destroy(); await app.close(); }
});
