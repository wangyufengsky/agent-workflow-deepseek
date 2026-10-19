import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../../packages/server/src/index.ts';

test('OpenCode log tail returns recent lines with credential-shaped strings redacted', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-logs-'));
  mkdirSync(join(dataDir, 'logs'), { recursive: true });
  writeFileSync(join(dataDir, 'logs', 'opencode.log'), [
    'INFO session start token=ghp_abcdefghijklmnop',
    'INFO auth authorization: Bearer supersecretvalue',
    'INFO password OPENCODE_SERVER_PASSWORD=hunter2',
    'INFO normal line',
  ].join('\n') + '\n', 'utf8');
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const response = await app.app.inject({ method: 'GET', url: '/api/opencode/logs?lines=10' });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json().data as { lines: string[]; truncated: boolean; path: string };
    assert.equal(body.lines.length, 4);
    assert.ok(body.lines.some((line) => line.includes('ghp_***')));
    assert.ok(body.lines.some((line) => line.includes('***')));
    assert.ok(body.lines.some((line) => line.includes('normal line')));
    const all = body.lines.join('\n');
    for (const secret of ['ghp_abcdefghijklmnop', 'supersecretvalue', 'hunter2']) assert.ok(!all.includes(secret), secret);
    assert.ok(body.path.endsWith('opencode.log'));
  } finally {
    await app.close();
  }
});
