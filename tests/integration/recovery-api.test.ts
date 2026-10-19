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

function createRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'aw-recovery-api-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# recovery\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  return root;
}

test('recovery API creates an idempotent derived draft and lists its history', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-recovery-api-data-'));
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: requestKey('prj'), name: 'Recovery API', rootPath: createRepo() } });
    const projectId = project.json().data.resource.project.id as string;
    const task = await app.app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { requestKey: requestKey('task'), projectId, title: '月报任务', requirementText: 'R1 月报', methodId: 'method.requirement-development' },
    });
    const taskId = task.json().data.resource.task.id as string;
    app.store.tasks.update(taskId, { attention: 'failed', lifecycle: 'active' });

    const key = requestKey('recovery');
    const created = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/recovery`,
      payload: { requestKey: key, mode: 'from_failed_stage', confirmCreate: true, note: '从失败阶段恢复' },
    });
    assert.equal(created.statusCode, 200, created.body);
    const data = created.json().data as { receipt: { status: string }; resource: { task: { id: string; title: string; stage: string }; recovery: { parentTaskId: string; mode: string } } };
    assert.equal(data.receipt.status, 'succeeded');
    assert.equal(data.resource.recovery.parentTaskId, taskId);
    assert.equal(data.resource.recovery.mode, 'from_failed_stage');
    assert.equal(data.resource.task.stage, 'draft');
    assert.match(data.resource.task.title, /从失败阶段恢复/);

    // Same requestKey replays the same derived task instead of creating another.
    const replay = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/recovery`,
      payload: { requestKey: key, mode: 'from_failed_stage', confirmCreate: true, note: '从失败阶段恢复' },
    });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().data.resource.task.id, data.resource.task.id);

    const history = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/recoveries` });
    assert.equal(history.statusCode, 200, history.body);
    assert.equal(history.json().data.recoveries.length, 1);
    assert.equal(history.json().data.recoveries[0].taskId, data.resource.task.id);

    const parent = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/detail` });
    assert.equal(parent.json().data.task.attention, 'failed');
    assert.equal(parent.json().data.task.lifecycle, 'active');

    // A task with no failure/blocked attention is not recoverable.
    const healthy = await app.app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { requestKey: requestKey('task2'), projectId, title: '正常任务', requirementText: 'R1', methodId: 'method.requirement-development' },
    });
    const healthyId = healthy.json().data.resource.task.id;
    const rejected = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${healthyId}/recovery`,
      payload: { requestKey: requestKey('bad'), mode: 'all_stages', confirmCreate: true },
    });
    assert.equal(rejected.statusCode, 400, rejected.body);
    assert.equal(rejected.json().error.code, 'VALIDATION_FAILED');

    // Retry is a recovery command, but requires an existing execution.
    const retry = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${healthyId}/execution/retry`,
      payload: { requestKey: requestKey('retry'), confirm: true },
    });
    assert.equal(retry.statusCode, 404, retry.body);
    assert.equal(retry.json().error.code, 'NOT_FOUND');
  } finally {
    await app.close();
  }
});
