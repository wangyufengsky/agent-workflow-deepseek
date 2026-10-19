import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../../packages/server/src/index.ts';

function requestKey(prefix: string): string {
  return `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;
}

test('project recheck refreshes git state after the directory disappears', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'aw-recheck-repo-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), '# recheck\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-recheck-')), disableOpenCode: true, disableListen: true });
  try {
    const created = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: requestKey('prj'), name: 'Recheck', rootPath: repo } });
    const projectId = created.json().data.resource.project.id as string;
    assert.equal(created.json().data.resource.project.gitState, 'git');
    rmSync(repo, { recursive: true, force: true });
    const rechecked = await app.app.inject({ method: 'POST', url: `/api/projects/${projectId}/recheck`, payload: { requestKey: requestKey('recheck') } });
    assert.equal(rechecked.statusCode, 200, rechecked.body);
    const project = rechecked.json().data.resource.project as { gitState: string };
    assert.equal(project.gitState, 'path_unavailable');
    assert.equal((await app.app.inject({ method: 'GET', url: '/api/projects' })).json().data.items[0].gitState, 'path_unavailable');
  } finally {
    await app.close();
  }
});
