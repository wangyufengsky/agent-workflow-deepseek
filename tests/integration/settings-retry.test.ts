import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequestKey } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/application.ts';
import { retryDelayMs } from '../../packages/engine/src/execution-policy.ts';

test('retry settings accept design ranges, reject reversed limits and keep original receipts from applying again', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-retry-settings-')), disableOpenCode: true, disableListen: true });
  try {
    const before = app.engine.publicSettings().execution;
    const key = createRequestKey();
    const patch = { execution: { retryDelays: { modelRateLimit: { initialMs: 600000, maxMs: 3600000 }, sessionError: { initialMs: 10000, maxMs: 120000 }, verificationFailure: { initialMs: 15000, maxMs: 300000 } } } };
    const save = await app.app.inject({ method: 'PATCH', url: '/api/settings', payload: { requestKey: key, patch } });
    assert.equal(save.statusCode, 200, save.body); assert.equal(save.json().data.receipt.status, 'succeeded');
    const settings = app.engine.publicSettings().execution;
    assert.equal(retryDelayMs(settings, { code: 'OPENCODE_NOT_READY', message: '429 rate limit' }, 1), 600000);
    assert.equal(retryDelayMs(settings, { code: 'OPENCODE_NOT_READY', message: '429 rate limit' }, 5), 3600000);
    assert.deepEqual(settings.retryDelays, patch.execution.retryDelays);
    const invalid = await app.app.inject({ method: 'PATCH', url: '/api/settings', payload: { requestKey: createRequestKey(), patch: { execution: { retryDelays: { sessionError: { initialMs: 120000, maxMs: 10000 } } } } } });
    assert.equal(invalid.statusCode, 400, invalid.body); assert.deepEqual(app.engine.publicSettings().execution.retryDelays, settings.retryDelays);
    for (const status of ['accepted', 'unknown']) {
      app.store.db.prepare('UPDATE operations SET status = ? WHERE request_key = ?').run(status, key);
      const receipt = await app.app.inject({ method: 'PATCH', url: '/api/settings', payload: { requestKey: key, patch } });
      assert.equal(receipt.json().data.receipt.status, status); assert.deepEqual(app.engine.publicSettings().execution.retryDelays, settings.retryDelays);
    }
    assert.notDeepEqual(before.retryDelays, settings.retryDelays);
  } finally { await app.close(); }
});
