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

test('custom fixed templates can be imported, used for tasks and plan generation, then archived', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'aw-tplimp-repo-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), '# import\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-tplimp-')), disableOpenCode: true, disableListen: true });
  try {
    const template = {
      id: 'template.custom.demo',
      name: '自定义演示模板',
      version: 1,
      lockedAfterCreate: true,
      steps: [
        { key: 'custom.read', title: '读取输入', kind: 'implementation', group: '固定步骤' },
        { key: 'custom.build', title: '实现变更', kind: 'implementation', group: '固定步骤' },
        { key: 'custom.verify', title: '运行验证', kind: 'test', group: '固定步骤' },
      ],
      parameters: [{ key: 'target', label: '目标路径', required: true }],
    };
    const imported = await app.app.inject({ method: 'POST', url: '/api/catalog/templates/import', payload: { requestKey: requestKey('imp'), template, confirmImport: true } });
    assert.equal(imported.statusCode, 200, imported.body);
    const duplicate = await app.app.inject({ method: 'POST', url: '/api/catalog/templates/import', payload: { requestKey: requestKey('imp2'), template, confirmImport: true } });
    assert.equal(duplicate.statusCode, 409, duplicate.body);

    const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: requestKey('prj'), name: 'Tpl Import', rootPath: repo } });
    const projectId = project.json().data.resource.project.id as string;
    const task = await app.app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { requestKey: requestKey('task'), projectId, title: '自定义模板任务', requirementText: 'R1', methodId: 'method.requirement-development', template: { templateId: 'template.custom.demo', parameters: { target: 'README.md' } } },
    });
    assert.equal(task.statusCode, 201, task.body);
    const taskId = task.json().data.resource.task.id as string;
    assert.equal(task.json().data.resource.task.fixedTemplate.templateVersion, 1);
    const plan = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/plan/from-template`, payload: { requestKey: requestKey('plan'), confirmUseTemplate: true } });
    assert.equal(plan.statusCode, 200, plan.body);
    const graph = plan.json().data.resource.plan.graph as { nodes: unknown[]; edges: unknown[] };
    assert.equal(graph.nodes.length, 3);
    assert.equal(graph.edges.length, 2);
  } finally {
    await app.close();
  }
});
