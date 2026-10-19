import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../../packages/server/src/index.ts';
import { GitCliAdapter } from '../../packages/server/src/index.ts';

function requestKey(prefix: string): string {
  return `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;
}

function createRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'aw-git-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# demo\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  return root;
}

test('git read API: repos, commits, commit detail, files, diff, branches', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-git-data-'));
  const repoRoot = createRepo();
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: requestKey('prj'), name: 'Git Demo', rootPath: repoRoot } });
    const projectId = project.json().data.resource.project.id;

    const overview = await app.app.inject({ method: 'GET', url: '/api/git/repos' });
    assert.equal(overview.statusCode, 200, overview.body);
    assert.equal(overview.json().data.repos.length, 1);
    assert.equal(overview.json().data.repos[0].gitState, 'git');

    const commits = await app.app.inject({ method: 'GET', url: `/api/git/repos/${projectId}/commits` });
    assert.equal(commits.statusCode, 200, commits.body);
    const sha = commits.json().data.commits[0].sha as string;
    assert.match(sha, /^[0-9a-f]{40}$/);

    const commit = await app.app.inject({ method: 'GET', url: `/api/git/repos/${projectId}/commits/${sha}` });
    assert.equal(commit.statusCode, 200, commit.body);
    assert.equal(commit.json().data.commit.subject, 'init');
    // A root commit must still expose a review baseline (empty tree) and real stats.
    const rootCompareOptions = commit.json().data.commit.compareOptions as readonly { kind: string; baseSha: string }[];
    assert.equal(rootCompareOptions.length, 1);
    assert.equal(rootCompareOptions[0]?.kind, 'empty_tree');
    assert.equal(rootCompareOptions[0]?.baseSha, '4b825dc642cb6eb9a060e54bf8d69288fbee4904');
    assert.ok((commit.json().data.commit.stats as { files: number }).files >= 1);

    const files = await app.app.inject({ method: 'GET', url: `/api/git/repos/${projectId}/commits/${sha}/files` });
    assert.equal(files.statusCode, 200, files.body);
    assert.ok(files.json().data.files.some((file: { path: string }) => file.path === 'README.md'));

    const branchList = await app.app.inject({ method: 'GET', url: `/api/git/repos/${projectId}/branches` });
    assert.equal(branchList.statusCode, 200, branchList.body);
    assert.ok(branchList.json().data.branches.some((branch: { name: string }) => branch.name === 'main'));
  } finally {
    await app.close();
  }
});

test('GitCliAdapter merges a task branch into main and rejects conflicts', async () => {
  const repoRoot = createRepo();
  const worktreesRoot = mkdtempSync(join(tmpdir(), 'aw-git-wt-'));
  const tempRoot = mkdtempSync(join(tmpdir(), 'aw-git-merge-'));
  const adapter = new GitCliAdapter(30000, tempRoot);
  const initial = (await adapter.status(repoRoot))?.head.sha;
  assert.ok(initial);

  const handle = await adapter.createWorktree({ repoRoot, worktreesRoot, taskId: 'task_merge', baseRef: 'main', baseSha: initial, branch: 'task/merge-demo' });
  writeFileSync(join(handle.path, 'feature.txt'), 'feature\n', 'utf8');
  const commit = await adapter.commit({ worktreePath: handle.path, filePaths: ['feature.txt'], message: 'add feature', author: { name: 'Test', email: 'test@example.com' } });
  assert.match(commit.sha, /^[0-9a-f]{40}$/);

  const merged = await adapter.mergeTaskBranch({
    repoRoot,
    targetBranch: 'main',
    expectedTargetSha: initial,
    sourceSha: commit.sha,
    message: 'merge task/merge-demo',
    tempRoot,
    strategy: 'no_ff',
  });
  assert.notEqual(merged.mergeSha, initial);
  const head = (await adapter.status(repoRoot))?.head.sha;
  assert.equal(head, merged.mergeSha);
  const files = execFileSync('git', ['ls-tree', '--name-only', 'main'], { cwd: repoRoot }).toString();
  assert.ok(files.includes('feature.txt'));

  // stale target is rejected
  await assert.rejects(
    adapter.mergeTaskBranch({ repoRoot, targetBranch: 'main', expectedTargetSha: initial, sourceSha: commit.sha, message: 'stale', tempRoot, strategy: 'no_ff' }),
    (error: unknown) => (error as { code?: string }).code === 'STALE_TARGET',
  );

  // conflicting branch is aborted cleanly and main is unchanged
  const headBeforeConflict = (await adapter.status(repoRoot))?.head.sha;
  const conflictHandle = await adapter.createWorktree({ repoRoot, worktreesRoot, taskId: 'task_conflict', baseRef: 'main', baseSha: headBeforeConflict!, branch: 'task/conflict-demo' });
  writeFileSync(join(conflictHandle.path, 'README.md'), '# branch change\n', 'utf8');
  const conflictCommit = await adapter.commit({ worktreePath: conflictHandle.path, filePaths: ['README.md'], message: 'branch change', author: { name: 'Test', email: 'test@example.com' } });
  execFileSync('git', ['checkout', '-q', 'main'], { cwd: repoRoot });
  writeFileSync(join(repoRoot, 'README.md'), '# main change\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: repoRoot });
  execFileSync('git', ['commit', '-qm', 'main change'], { cwd: repoRoot });
  const mainTip = (await adapter.status(repoRoot))?.head.sha;
  await assert.rejects(
    adapter.mergeTaskBranch({ repoRoot, targetBranch: 'main', expectedTargetSha: mainTip!, sourceSha: conflictCommit.sha, message: 'conflict merge', tempRoot, strategy: 'no_ff' }),
    (error: unknown) => (error as { code?: string }).code === 'MERGE_CONFLICT',
  );
  assert.equal((await adapter.status(repoRoot))?.head.sha, mainTip);
});
