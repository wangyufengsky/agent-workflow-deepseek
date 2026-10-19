import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../../packages/server/src/index.ts';
import { createId } from '../../packages/shared/src/index.ts';

/**
 * Live execution: after a confirmed plan and prepared worktree, the managed
 * OpenCode model edits the worktree through this product's MCP tools and submits
 * a result. Off by default; run with AGENT_WORKFLOW_LIVE=1.
 */
const live = process.env.AGENT_WORKFLOW_LIVE === '1';

function requestKey(prefix: string): string {
  return `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;
}

function createRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'aw-exec-repo-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# demo service\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  return root;
}

test('live: execution runs a node through MCP workspace tools and submits a result', { skip: !live, timeout: 300000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-exec-data-'));
  const app = await createApplication({ dataDir, port: 0, host: '127.0.0.1' });
  try {
    assert.ok(app.adapter);
    await app.adapter.ensureReady();
    const repo = createRepo();
    const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: requestKey('prj'), name: 'Demo', rootPath: repo } });
    const projectId = project.json().data.resource.project.id;
    const task = await app.app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        requestKey: requestKey('task'),
        projectId,
        title: '补充 README 使用说明',
        requirementText: '在 README.md 末尾追加一节“使用说明”，内容包含一行示例命令。\n验收：README.md 有新增内容。',
        methodId: 'method.defect-fix',
      },
    });
    const taskId = task.json().data.resource.task.id;
    // Deterministic single write node: exercises the MCP file-write + result-submit path
    // without waiting for several model steps.
    const nodeId = createId('pn');
    const plan = app.store.plans.create({
      taskId,
      source: 'skeleton',
      status: 'unconfirmed',
      graph: {
        nodes: [{
          id: nodeId,
          key: 'impl.append-note',
          title: '在 README 追加使用说明',
          kind: 'implementation',
          groupId: 'g1',
          summary: '在 README.md 末尾追加“使用说明”小节和一行示例命令。',
          inputs: [{ name: 'README.md', source: 'requirement' }],
          outputs: [{ name: 'README.md 更新', kind: 'artifact' }],
          acceptance: ['README.md 末尾出现“使用说明”小节'],
          resources: { read: [{ kind: 'file', label: 'README.md', basis: 'declared' }], write: [{ kind: 'file', label: 'README.md', basis: 'declared' }] },
          roleId: 'role.developer',
          position: { x: 80, y: 80 },
        }],
        edges: [],
        groups: [{ id: 'g1', label: '实现', kind: 'implementation', refined: true, collapsible: true, collapsedByDefault: false }],
      },
    });
    app.store.tasks.update(taskId, { currentPlanRevisionId: plan.id, stage: 'confirming' });
    const planId = plan.id;
    const revisionNumber = plan.revisionNumber;
    const confirm = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan/confirm`,
      payload: { requestKey: requestKey('confirm'), planRevisionId: planId, expectedRevisionNumber: revisionNumber, confirmPlan: true },
    });
    assert.equal(confirm.statusCode, 200, confirm.body);
    const prepare = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/workspace/prepare`,
      payload: { requestKey: requestKey('prep'), expectedPlanRevisionNumber: revisionNumber, expectedBaseRef: 'main', confirmPrepare: true },
    });
    assert.equal(prepare.statusCode, 200, prepare.body);
    const workspace = prepare.json().data.resource.workspace;
    assert.equal(workspace.state, 'ready');

    const start = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/execution/start`,
      payload: { requestKey: requestKey('start'), confirm: true },
    });
    assert.equal(start.statusCode, 200, start.body);

    let execution: any;
    let succeeded = 0;
    let files: { path: string }[] = [];
    const deadline = Date.now() + 240000;
    while (Date.now() < deadline) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 3000));
      const detail = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/detail` });
      execution = detail.json().data.execution;
      succeeded = execution?.nodes.filter((node: { status: string }) => node.status === 'succeeded').length ?? 0;
      const changes = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/changes` });
      files = changes.json().data?.changes?.files ?? [];
      if (files.length > 0 && succeeded >= 1) break;
      if (execution?.status === 'failed' || execution?.status === 'completed' || execution?.status === 'stopped') break;
    }
    console.log('[live-exec] execution:', JSON.stringify({ status: execution?.status, succeeded, nodes: execution?.nodes?.map((node: { status: string }) => node.status) }));
    console.log('[live-exec] changed files:', JSON.stringify(files.map((file) => file.path)));
    console.log('[live-exec] attempt results:', JSON.stringify(execution?.nodes?.map((node: { status: string }) => node.status)));
    assert.ok(succeeded >= 1, `at least one node should succeed; execution=${JSON.stringify(execution?.nodes)}`);
    assert.ok(files.length > 0, 'worktree should contain changes written through MCP file tools');

    await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/execution/cancel`, payload: { requestKey: requestKey('cancel'), confirm: true } });
    console.log('[live-exec] execution e2e PASS');
  } finally {
    await app.close();
  }
});
