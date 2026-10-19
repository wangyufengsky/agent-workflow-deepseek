import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../../packages/server/src/index.ts';

function requestKey(prefix: string): string {
  return `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;
}

test('monitoring poll interval is persisted, validated and merged into bootstrap settings', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-settings-'));
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const bootstrap = await app.app.inject({ method: 'GET', url: '/api/bootstrap' });
    assert.equal(bootstrap.statusCode, 200, bootstrap.body);
    assert.equal(bootstrap.json().data.settings.monitoring.pollIntervalMs, 1500);

    const update = await app.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { requestKey: requestKey('set'), patch: { monitoring: { pollIntervalMs: 2500 } } },
    });
    assert.equal(update.statusCode, 200, update.body);
    const after = await app.app.inject({ method: 'GET', url: '/api/bootstrap' });
    assert.equal(after.json().data.settings.monitoring.pollIntervalMs, 2500);

    const invalid = await app.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { requestKey: requestKey('bad'), patch: { monitoring: { pollIntervalMs: 100 } } },
    });
    assert.equal(invalid.statusCode, 400, invalid.body);
    assert.equal(invalid.json().error.code, 'VALIDATION_FAILED');
  } finally {
    await app.close();
  }
});
