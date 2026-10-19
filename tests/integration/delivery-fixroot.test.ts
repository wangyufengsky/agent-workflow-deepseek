import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../../packages/server/src/index.ts';

function requestKey(prefix: string): string {
  return `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;
}

function createRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'aw-merge-api-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# demo\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  return root;
}

test('delivery merge API merges a task worktree branch into main (CAS + delivered projection)', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-merge-api-data-'));
  const repoRoot = createRepo();
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: requestKey('prj'), name: 'Merge Demo', rootPath: repoRoot } });
    const projectId = project.json().data.resource.project.id as string;
    const task = await app.app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { requestKey: requestKey('task'), projectId, title: 'Merge task', requirementText: 'R1 change', methodId: 'method.requirement-development' },
    });
    const taskId = task.json().data.resource.task.id as string;
    const skeleton = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/plan/skeleton`, payload: { requestKey: requestKey('skel'), confirmUseSkeleton: true } });
    const plan = skeleton.json().data.resource.plan;
    await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/plan/confirm`, payload: { requestKey: requestKey('conf'), planRevisionId: plan.id, expectedRevisionNumber: plan.revisionNumber, confirmPlan: true } });
    const prepare = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/workspace/prepare`,
      payload: { requestKey: requestKey('prep'), expectedPlanRevisionNumber: plan.revisionNumber, expectedBaseRef: 'main', confirmPrepare: true },
    });
    assert.equal(prepare.statusCode, 200, prepare.body);
    const workspace = prepare.json().data.resource.workspace;
    const status = await app.engine.ports.git.status(repoRoot);
    const baseSha = status?.head.sha;
    assert.ok(baseSha);

    writeFileSync(join(workspace.displayRoot, 'feature.txt'), 'feature from task\n', 'utf8');
    const commit = await app.engine.ports.git.commit({
      worktreePath: workspace.displayRoot,
      filePaths: ['feature.txt'],
      message: 'task change',
      author: { name: 'Test', email: 'test@example.com' },
    });
    const delivery = app.store.deliveries.create({ taskId, workspaceId: workspace.id, changesRevision: 'rev1', eligibility: { allowed: true } });
    app.store.deliveries.update(delivery.id, {
      goal: 'local_commit',
      steps: [{ step: 'commit', state: 'succeeded', requestKey: requestKey('commit'), settledAt: new Date().toISOString(), commitSha: commit.sha }],
    });
    app.store.tasks.update(taskId, { deliveryId: delivery.id });

    const merge = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/delivery/merge`,
      payload: {
        requestKey: requestKey('merge'),
        targetBranch: 'main',
        expectedTargetSha: baseSha,
        sourceSha: commit.sha,
        message: 'merge task branch',
        strategy: 'no_ff',
        confirmMerge: true,
      },
    });
    assert.equal(merge.statusCode, 200, merge.body);
    assert.equal(merge.json().data.resource.delivery.projection, 'delivered');
    const newTip = execFileSync('git', ['rev-parse', 'main'], { cwd: repoRoot }).toString().trim();
    assert.notEqual(newTip, baseSha);
    assert.equal(execFileSync('git', ['show', 'main:feature.txt'], { cwd: repoRoot }).toString(), 'feature from task\n');
    const taskAfter = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/detail` });
    assert.equal(taskAfter.json().data.task.lifecycle, 'completed');
  } finally {
    await app.close();
  }
});

test('internal MCP workspace tools resolve a fix worktree root by fixRunId reference', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-fix-root-data-'));
  const fixRoot = mkdtempSync(join(tmpdir(), 'aw-fix-root-'));
  writeFileSync(join(fixRoot, 'existing.txt'), 'before\n', 'utf8');
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    app.store.settings.putJson('fix.worktree.fix_demo_1', { path: fixRoot, branch: 'ai-fix/demo', baseSha: 'a'.repeat(40) });
    const headers = { authorization: `Bearer ${app.internalToken}` };
    const read = await app.app.inject({ method: 'GET', url: '/internal/mcp/workspace/file?taskId=fix_demo_1&path=existing.txt', headers });
    assert.equal(read.statusCode, 200, read.body);
    assert.equal((read.json().data.lines as string[]).join('\n').trimEnd(), 'before');
    assert.equal(read.json().data.readOnly, false);

    const write = await app.app.inject({
      method: 'POST',
      url: '/internal/mcp/workspace/file-write',
      headers,
      payload: { taskId: 'fix_demo_1', path: 'new.txt', content: 'written by fix\n' },
    });
    assert.equal(write.statusCode, 200, write.body);
    assert.equal(readFileSync(join(fixRoot, 'new.txt'), 'utf8'), 'written by fix\n');

    const escape = await app.app.inject({ method: 'GET', url: '/internal/mcp/workspace/file?taskId=fix_demo_1&path=../escape.txt', headers });
    assert.equal(escape.statusCode, 400, escape.body);
    assert.equal(escape.json().error.code, 'PATH_ESCAPE');

    app.store.settings.putJson('fix.worktree.fix_gone', { path: join(fixRoot, 'missing') });
    const gone = await app.app.inject({ method: 'GET', url: '/internal/mcp/workspace/file?taskId=fix_gone&path=existing.txt', headers });
    assert.equal(gone.statusCode, 503, gone.body);
    assert.equal(gone.json().error.code, 'WORKSPACE_NOT_READY');
  } finally {
    await app.close();
  }
});
