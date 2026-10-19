import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../../packages/server/src/index.ts';

function requestKey(prefix: string): string {
  return `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;
}

function createRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'aw-repo-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# demo\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  return root;
}

test('HTTP API smoke: project → task → skeleton → confirm → workspace', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-data-'));
  const repoRoot = createRepo();
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const health = await app.app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(health.statusCode, 200);
    const bootstrap = await app.app.inject({ method: 'GET', url: '/api/bootstrap' });
    assert.equal(bootstrap.statusCode, 200);
    assert.equal(bootstrap.json().data.themes.length, 4);

    const projectRes = await app.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { requestKey: requestKey('prj'), name: '订单服务', rootPath: repoRoot, description: '测试项目' },
    });
    assert.equal(projectRes.statusCode, 201, projectRes.body);
    const projectId = projectRes.json().data.resource.project.id as string;

    const taskRes = await app.app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        requestKey: requestKey('task'),
        projectId,
        title: '退款单分页查询与导出',
        requirementText: 'R1 支持按状态与日期筛选\nR2 支持导出 CSV\n验收：分页与导出一致',
        methodId: 'method.requirement-development',
      },
    });
    assert.equal(taskRes.statusCode, 201, taskRes.body);
    const taskId = taskRes.json().data.resource.task.id as string;

    const skeleton = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan/skeleton`,
      payload: { requestKey: requestKey('skel'), confirmUseSkeleton: true },
    });
    assert.equal(skeleton.statusCode, 200, skeleton.body);
    const planId = skeleton.json().data.resource.plan.id as string;
    assert.ok(skeleton.json().data.resource.plan.graph.nodes.length >= 10);

    const confirm = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan/confirm`,
      payload: { requestKey: requestKey('conf'), planRevisionId: planId, expectedRevisionNumber: 1, confirmPlan: true },
    });
    assert.equal(confirm.statusCode, 200, confirm.body);
    const detail = confirm.json().data.resource;
    assert.equal(detail.task.stage, 'preparing');
    assert.ok(detail.workspace);

    const prepare = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/workspace/prepare`,
      payload: { requestKey: requestKey('prep'), expectedPlanRevisionNumber: 1, expectedBaseRef: 'main', confirmPrepare: true },
    });
    assert.equal(prepare.statusCode, 200, prepare.body);
    const workspace = prepare.json().data.resource.workspace;
    assert.equal(workspace.state, 'ready');
    assert.ok(workspace.branch.startsWith('task/'));
    assert.ok(workspace.displayRoot.includes('worktrees'));

    const tasks = await app.app.inject({ method: 'GET', url: '/api/tasks' });
    assert.equal(tasks.json().data.items.length, 1);

    const preview = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/planning/preview`, payload: {} });
    assert.equal(preview.statusCode, 200);
    assert.equal(preview.json().data.preview.blockers.some((blocker: { code: string }) => blocker.code === 'OPENCODE_NOT_READY'), true);
  } finally {
    await app.close();
  }
});

test('request key is idempotent and body-conflict is rejected', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-data-'));
  const repoRoot = createRepo();
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const key = requestKey('idem');
    const first = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: key, name: 'P1', rootPath: repoRoot } });
    assert.equal(first.statusCode, 201, first.body);
    const replay = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: key, name: 'P1', rootPath: repoRoot } });
    assert.equal(replay.statusCode, 201, replay.body);
    assert.equal(replay.json().data.receipt.requestKey, key);
    const conflict = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: key, name: 'P2', rootPath: repoRoot } });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().error.code, 'REQUEST_KEY_REUSED');
  } finally {
    await app.close();
  }
});

test('internal MCP routes require the bearer token', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-data-'));
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const unauthorized = await app.app.inject({ method: 'GET', url: '/internal/mcp/git/status?projectId=x' });
    assert.equal(unauthorized.statusCode, 401);
    const authorized = await app.app.inject({
      method: 'GET',
      url: '/internal/mcp/git/status?projectId=x',
      headers: { authorization: `Bearer ${app.internalToken}` },
    });
    assert.equal(authorized.statusCode, 403, 'service bearer alone is insufficient without a live session scope');
  } finally {
    await app.close();
  }
});
