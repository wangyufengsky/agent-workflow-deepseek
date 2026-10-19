import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../../packages/server/src/index.ts';

test('OpenCode detection probes the current configured binary and reports its version', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-detect-'));
  const bin = join(mkdtempSync(join(tmpdir(), 'aw-detbin-')), 'opencode');
  writeFileSync(bin, '#!/bin/sh\necho "1.19.0"\n', 'utf8');
  chmodSync(bin, 0o755);
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    app.engine.updateSettings({ ...app.engine.settings, opencode: { ...app.engine.settings.opencode, binaryPath: bin } });
    const response = await app.app.inject({ method: 'GET', url: '/api/opencode/detect' });
    assert.equal(response.statusCode, 200, response.body);
    const data = response.json().data as { current: string; candidates: { path: string; version?: string; source: string }[] };
    assert.equal(data.current, bin);
    const candidate = data.candidates.find((item) => item.path === realpathSync(bin));
    assert.ok(candidate !== undefined);
    assert.equal(candidate.version, '1.19.0');
    assert.equal(candidate.source, 'current');
  } finally {
    await app.close();
  }
});
