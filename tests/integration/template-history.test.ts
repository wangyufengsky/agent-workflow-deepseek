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
  const root = mkdtempSync(join(tmpdir(), 'aw-tpl-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# tpl\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  return root;
}

test('template history lists only tasks created from that fixed template', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-tpl-data-'));
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: requestKey('prj'), name: 'Templates', rootPath: createRepo() } });
    const projectId = project.json().data.resource.project.id as string;
    const created = await app.app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        requestKey: requestKey('tpl'),
        projectId,
        title: '单元测试任务',
        requirementText: 'R1 为 readName 写测试',
        methodId: 'method.unit-test-development',
        template: { templateId: 'template.unit-test-development', parameters: {} },
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    const taskId = created.json().data.resource.task.id as string;

    const normal = await app.app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { requestKey: requestKey('normal'), projectId, title: '普通任务', requirementText: 'R1', methodId: 'method.requirement-development' },
    });
    assert.equal(normal.statusCode, 201, normal.body);

    const history = await app.app.inject({ method: 'GET', url: '/api/templates/template.unit-test-development/tasks' });
    assert.equal(history.statusCode, 200, history.body);
    const tasks = history.json().data.tasks as { id: string; title: string }[];
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]!.id, taskId);
    assert.equal(tasks[0]!.title, '单元测试任务');

    const empty = await app.app.inject({ method: 'GET', url: '/api/templates/template.unknown/tasks' });
    assert.equal(empty.statusCode, 200, empty.body);
    assert.deepEqual(empty.json().data.tasks, []);
  } finally {
    await app.close();
  }
});
