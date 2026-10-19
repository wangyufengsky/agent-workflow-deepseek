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
  const root = mkdtempSync(join(tmpdir(), 'aw-merge-api-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# demo\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  return root;
}

async function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-delivery-goals-'));
  const repoRoot = createRepo();
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
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
    return { app, repoRoot, projectId, taskId, workspace };
}
for (const goal of ['local_commit', 'push_branch', 'create_merge_request'] as const) test(`delivery ${goal} finishes only at selected goal, real local Git`, async () => {
  const { app, repoRoot, taskId, workspace } = await fixture();
  try {
    const bare = mkdtempSync(join(tmpdir(), 'aw-delivery-bare-'));
    execFileSync('git', ['init', '--bare', '-q', bare]);
    execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: repoRoot });
    writeFileSync(join(workspace.displayRoot, 'feature.txt'), 'selected feature\n');
    const changes = await app.engine.workspaces.changes(taskId);
    const fileIds = changes.files.filter(file => file.path === 'feature.txt').map(file => file.fileId);
    const delivery = app.engine.deliveries.get(taskId);
    const selected = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/delivery/select`, payload: { requestKey: requestKey('select'), goal, fileIds, changesRevision: changes.changesRevision, expectedDeliveryRevision: delivery.revision } });
    assert.equal(selected.statusCode, 200, selected.body);
    const commitKey = requestKey('commit');
    const payload = { requestKey: commitKey, fileIds, message: 'confirmed feature', expectedChangesRevision: changes.changesRevision, confirmCommit: true };
    const committed = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/delivery/commit`, payload });
    assert.equal(committed.statusCode, 200, committed.body);
    const committedDelivery = committed.json().data.resource.delivery;
    assert.equal(committedDelivery.projection, goal === 'local_commit' ? 'delivered' : 'awaiting_confirmation');
    assert.equal(committedDelivery.verificationOutcome, goal === 'local_commit' ? 'not_run' : undefined);
    const replay = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/delivery/commit`, payload });
    assert.equal(replay.statusCode, 200, replay.body);
    if (goal !== 'local_commit') {
      const sha = committedDelivery.steps.find((step: {step: string}) => step.step === 'commit').commitSha;
      const pushed = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/delivery/push`, payload: { requestKey: requestKey('push'), expectedLocalSha: sha, remoteBranchName: 'confirmed-feature', confirmPush: true } });
      assert.equal(pushed.statusCode, 200, pushed.body);
      assert.equal(pushed.json().data.resource.delivery.projection, goal === 'push_branch' ? 'delivered' : 'awaiting_confirmation');
      assert.equal(execFileSync('git', ['--git-dir', bare, 'rev-parse', 'refs/heads/confirmed-feature']).toString().trim(), sha);
    }
    assert.equal(app.store.tasks.get(taskId)?.lifecycle, goal === 'create_merge_request' ? 'active' : 'completed');
  } finally { await app.close(); }
});
test('delivery deterministic stale and empty path failures settle accepted receipts', async () => {
  const { app, taskId, workspace } = await fixture();
  try {
    writeFileSync(join(workspace.displayRoot, 'feature.txt'), 'new\n');
    const changes = await app.engine.workspaces.changes(taskId);
    for (const stale of [true, false]) {
      const key = requestKey('failure');
      const payload = { requestKey: key, fileIds: stale ? changes.files.map(file => file.fileId) : [], message: 'never committed', expectedChangesRevision: stale ? 'outdated' : changes.changesRevision, confirmCommit: true };
      const result = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/delivery/commit`, payload });
      assert.notEqual(result.statusCode, 200);
      assert.equal(app.store.operations.get(key)?.status, 'failed');
      const replay = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/delivery/commit`, payload });
      assert.equal(replay.json().data.receipt.status, 'failed');
    }
  } finally { await app.close(); }
});
test('delivery confirmed rename item expands only its old path and new path', async () => {
  const { app, taskId, workspace } = await fixture();
  try {
    execFileSync('git', ['mv', 'README.md', 'renamed.md'], { cwd: workspace.displayRoot });
    writeFileSync(join(workspace.displayRoot, 'unselected'), 'retained staged\n');
    execFileSync('git', ['add', 'unselected'], { cwd: workspace.displayRoot });
    const changes = await app.engine.workspaces.changes(taskId);
    const rename = changes.files.find(file => file.path === 'renamed.md');
    assert.equal(rename?.status, 'R'); assert.equal(rename?.oldPath, 'README.md');
    const result = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/delivery/commit`, payload: { requestKey: requestKey('rename'), fileIds: [rename!.fileId], message: 'rename selected item', expectedChangesRevision: changes.changesRevision, confirmCommit: true } });
    assert.equal(result.statusCode, 200, result.body);
    const files = execFileSync('git', ['ls-tree', '--name-only', 'HEAD'], { cwd: workspace.displayRoot }).toString();
    assert.match(files, /renamed.md/); assert.doesNotMatch(files, /README.md|unselected/);
    assert.equal(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: workspace.displayRoot }).toString(), 'unselected\n');
  } finally { await app.close(); }
});
test('non-Git push precondition settles receipt as failed instead of leaving accepted', async () => {
  const { app, taskId, projectId } = await fixture();
  try {
    app.store.projects.update(projectId, { gitState: 'not_git' });
    const key = requestKey('nongit');
    const result = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/delivery/push`, payload: { requestKey: key, expectedLocalSha: 'a'.repeat(40), remoteBranchName: 'branch', confirmPush: true } });
    assert.notEqual(result.statusCode, 200);
    assert.equal(app.store.operations.get(key)?.status, 'failed');
  } finally { await app.close(); }
});
