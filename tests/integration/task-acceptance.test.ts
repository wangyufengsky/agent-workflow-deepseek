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

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'aw-accept-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# accept\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  return root;
}

test('human acceptance can be recorded and replaced with audit receipt', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-accept-data-')), disableOpenCode: true, disableListen: true });
  try {
    const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: requestKey('prj'), name: 'Accept', rootPath: repo() } });
    const projectId = project.json().data.resource.project.id as string;
    const task = await app.app.inject({ method: 'POST', url: '/api/tasks', payload: { requestKey: requestKey('task'), projectId, title: '验收任务', requirementText: 'R1', methodId: 'method.requirement-development' } });
    const taskId = task.json().data.resource.task.id as string;
    const empty = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/acceptance` });
    assert.equal(empty.statusCode, 200, empty.body);
    assert.equal(empty.json().data.acceptance, undefined);

    const accepted = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/acceptance`, payload: { requestKey: requestKey('acc'), verdict: 'accepted', note: '通过验收', confirmDecide: true } });
    assert.equal(accepted.statusCode, 200, accepted.body);
    const first = accepted.json().data.resource.acceptance as { verdict: string; note: string };
    assert.equal(first.verdict, 'accepted');
    assert.equal(first.note, '通过验收');
    assert.equal(accepted.json().data.receipt.status, 'succeeded');

    const rejected = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/acceptance`, payload: { requestKey: requestKey('acc2'), verdict: 'rejected', confirmDecide: true } });
    assert.equal(rejected.statusCode, 200, rejected.body);
    const current = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/acceptance` });
    assert.equal(current.json().data.acceptance.verdict, 'rejected');

    const invalid = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/acceptance`, payload: { requestKey: requestKey('acc3'), verdict: 'maybe', confirmDecide: true } });
    assert.equal(invalid.statusCode, 400, invalid.body);
    assert.equal((await app.app.inject({ method: 'GET', url: '/api/tasks/task_missing/acceptance' })).statusCode, 404);
  } finally {
    await app.close();
  }
});
