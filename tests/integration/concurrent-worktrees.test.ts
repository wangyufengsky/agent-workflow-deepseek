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
  const root = mkdtempSync(join(tmpdir(), 'aw-concurrent-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'base.txt'), 'base\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  return root;
}

async function createPreparedTask(app: Awaited<ReturnType<typeof createApplication>>, projectId: string, title: string): Promise<{ taskId: string; workspace: { id: string; displayRoot: string; branch: string; state: string } }> {
  const task = await app.app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: { requestKey: requestKey('task'), projectId, title, requirementText: 'R1 isolated', methodId: 'method.requirement-development' },
  });
  const taskId = task.json().data.resource.task.id as string;
  const skeleton = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/plan/skeleton`, payload: { requestKey: requestKey('skel'), confirmUseSkeleton: true } });
  const plan = skeleton.json().data.resource.plan;
  const confirm = await app.app.inject({
    method: 'POST',
    url: `/api/tasks/${taskId}/plan/confirm`,
    payload: { requestKey: requestKey('confirm'), planRevisionId: plan.id, expectedRevisionNumber: plan.revisionNumber, confirmPlan: true },
  });
  assert.equal(confirm.statusCode, 200, confirm.body);
  const prepare = await app.app.inject({
    method: 'POST',
    url: `/api/tasks/${taskId}/workspace/prepare`,
    payload: { requestKey: requestKey('prep'), expectedPlanRevisionNumber: plan.revisionNumber, expectedBaseRef: 'main', confirmPrepare: true },
  });
  assert.equal(prepare.statusCode, 200, prepare.body);
  return { taskId, workspace: prepare.json().data.resource.workspace };
}

test('two tasks prepare isolated worktrees concurrently without touching main', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-concurrent-data-'));
  const repoRoot = createRepo();
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: requestKey('prj'), name: 'Concurrency', rootPath: repoRoot } });
    const projectId = project.json().data.resource.project.id as string;

    const [first, second] = await Promise.all([
      createPreparedTask(app, projectId, 'Task A'),
      createPreparedTask(app, projectId, 'Task B'),
    ]);
    assert.notEqual(first.workspace.displayRoot, second.workspace.displayRoot);
    assert.notEqual(first.workspace.branch, second.workspace.branch);
    assert.equal(first.workspace.state, 'ready');
    assert.equal(second.workspace.state, 'ready');

    writeFileSync(join(first.workspace.displayRoot, 'only-a.txt'), 'A\n', 'utf8');
    writeFileSync(join(second.workspace.displayRoot, 'only-b.txt'), 'B\n', 'utf8');
    assert.equal(readFileSync(join(first.workspace.displayRoot, 'only-a.txt'), 'utf8'), 'A\n');
    assert.equal(readFileSync(join(second.workspace.displayRoot, 'only-b.txt'), 'utf8'), 'B\n');
    execFileSync('git', ['add', '.'], { cwd: first.workspace.displayRoot });
    execFileSync('git', ['commit', '-qm', 'task a change'], { cwd: first.workspace.displayRoot });

    const worktrees = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot }).toString();
    assert.ok(worktrees.includes(first.workspace.displayRoot));
    assert.ok(worktrees.includes(second.workspace.displayRoot));
    const mainTip = execFileSync('git', ['rev-parse', 'main'], { cwd: repoRoot }).toString().trim();
    const mainFiles = execFileSync('git', ['ls-tree', '--name-only', 'main'], { cwd: repoRoot }).toString();
    assert.ok(!mainFiles.includes('only-a.txt'));
    assert.ok(!mainFiles.includes('only-b.txt'));
    assert.equal(execFileSync('git', ['rev-parse', 'main'], { cwd: repoRoot }).toString().trim(), mainTip);

    // Cleanup both, in reverse order, and verify the repository returns to baseline.
    for (const prepared of [first, second]) {
      const preview = await app.app.inject({ method: 'POST', url: `/api/tasks/${prepared.taskId}/workspace/cleanup/preview`, payload: {} });
      assert.equal(preview.statusCode, 200, preview.body);
      const cleanupPreview = preview.json().data.preview as { previewRef: string; workspaceRevision: string };
      const cleanup = await app.app.inject({
        method: 'POST',
        url: `/api/tasks/${prepared.taskId}/workspace/cleanup/confirm`,
        payload: { requestKey: requestKey('clean'), previewRef: cleanupPreview.previewRef, workspaceRevision: cleanupPreview.workspaceRevision, confirmCleanup: true },
      });
      assert.equal(cleanup.statusCode, 200, cleanup.body);
    }
    const branches = execFileSync('git', ['branch', '--list', 'task/*'], { cwd: repoRoot }).toString().trim();
    assert.equal(branches, '');
  } finally {
    await app.close();
  }
});
