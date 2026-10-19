import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../../packages/server/src/index.ts';

function requestKey(prefix: string): string {
  return `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;
}

test('projects can be archived, hidden from the default list and restored', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'aw-archive-repo-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), '# archive\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-archive-')), disableOpenCode: true, disableListen: true });
  try {
    const created = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: requestKey('prj'), name: 'Archive', rootPath: repo } });
    const projectId = created.json().data.resource.project.id as string;
    const archived = await app.app.inject({ method: 'PATCH', url: `/api/projects/${projectId}`, payload: { requestKey: requestKey('arch'), archived: true } });
    assert.equal(archived.statusCode, 200, archived.body);
    const defaultList = await app.app.inject({ method: 'GET', url: '/api/projects' });
    assert.equal(defaultList.json().data.items.length, 0);
    const withArchived = await app.app.inject({ method: 'GET', url: '/api/projects?includeArchived=1' });
    assert.equal(withArchived.json().data.items.length, 1);
    assert.equal(withArchived.json().data.items[0].archived, true);
    const restored = await app.app.inject({ method: 'PATCH', url: `/api/projects/${projectId}`, payload: { requestKey: requestKey('restore'), archived: false } });
    assert.equal(restored.statusCode, 200, restored.body);
    assert.equal((await app.app.inject({ method: 'GET', url: '/api/projects' })).json().data.items.length, 1);
  } finally {
    await app.close();
  }
});
