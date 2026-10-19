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

test('existing plain directories remain usable non-Git projects and stale method selection cannot create a different version', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aw-plain-project-'));
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-plain-data-')), disableOpenCode: true, disableListen: true });
  try {
    const created = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: requestKey('plain'), name: 'Plain', rootPath: root } });
    assert.equal(created.statusCode, 201, created.body);
    const bootstrap = (await app.app.inject({ method: 'GET', url: '/api/bootstrap' })).json().data;
    assert.equal(bootstrap.data.dbPath, app.store.dbPath);
    assert.equal(bootstrap.data.jsonlPath, join(app.store.dataDir, 'journal'));
    const project = created.json().data.resource.project;
    assert.equal(project.gitState, 'not_git');
    const method = app.engine.catalog.methods[0]!;
    const badBody = { requestKey: requestKey('stale'), projectId: project.id, title: 'Draft', requirementText: 'Goal', methodId: method.id, expectedMethodRevision: 'obsolete-revision' };
    const stale = await app.app.inject({ method: 'POST', url: '/api/tasks', payload: badBody });
    assert.equal(stale.json().error.code, 'STALE_TARGET');
    assert.equal(app.store.tasks.list().length, 0);
    const body = { ...badBody, requestKey: requestKey('current'), expectedMethodRevision: method.revision };
    const accepted = await app.app.inject({ method: 'POST', url: '/api/tasks', payload: body });
    assert.equal(accepted.statusCode, 201, accepted.body);
    assert.equal(accepted.json().data.resource.task.methodRevision, method.revision);
    const replay = await app.app.inject({ method: 'POST', url: '/api/tasks', payload: body });
    assert.equal(replay.json().data.resource.task.id, accepted.json().data.resource.task.id);
    const mutated = await app.app.inject({ method: 'POST', url: '/api/tasks', payload: { ...body, expectedMethodRevision: 'other' } });
    assert.equal(mutated.json().error.code, 'REQUEST_KEY_REUSED');
  } finally { await app.close(); }
});
