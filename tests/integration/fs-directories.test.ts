import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../../packages/server/src/index.ts';

test('directory picker lists only directories and marks git repositories', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aw-fspick-'));
  mkdirSync(join(root, 'alpha', '.git'), { recursive: true });
  mkdirSync(join(root, 'beta'), { recursive: true });
  writeFileSync(join(root, 'file.txt'), 'x', 'utf8');
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-fspick-data-')), disableOpenCode: true, disableListen: true });
  try {
    const response = await app.app.inject({ method: 'GET', url: `/api/fs/directories?path=${encodeURIComponent(root)}` });
    assert.equal(response.statusCode, 200, response.body);
    const data = response.json().data as { path: string; parent?: string; entries: { name: string; path: string; isGit: boolean }[] };
    assert.equal(data.path, realpathSync(root));
    assert.ok(data.parent !== undefined);
    assert.deepEqual(data.entries.map((entry) => entry.name), ['alpha', 'beta']);
    assert.equal(data.entries[0]!.isGit, true);
    assert.equal(data.entries[1]!.isGit, false);
    assert.equal(data.entries.some((entry) => entry.name === 'file.txt'), false);

    assert.equal((await app.app.inject({ method: 'GET', url: `/api/fs/directories?path=${encodeURIComponent(join(root, 'missing'))}` })).statusCode, 404);
    assert.equal((await app.app.inject({ method: 'GET', url: '/api/fs/directories?path=relative/path' })).statusCode, 400);

    const home = await app.app.inject({ method: 'GET', url: '/api/fs/directories' });
    assert.equal(home.statusCode, 200, home.body);
    assert.ok(String(home.json().data.path).startsWith('/'));
  } finally {
    await app.close();
  }
});
