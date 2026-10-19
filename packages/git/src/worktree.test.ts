import assert from 'node:assert/strict';
import { existsSync, realpathSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import { ErrorCode, isAppError } from '@agent-workflow/shared';
import { createFixtureRepo, makeTempDir, type FixtureRepo } from './testing.ts';
import { buildHandle, WorktreeManager } from './worktree.ts';

function fixture(t: TestContext): FixtureRepo {
  const repo = createFixtureRepo();
  t.after(() => repo.cleanup());
  return repo;
}

interface ManagerFixture {
  readonly repo: FixtureRepo;
  readonly manager: WorktreeManager;
  readonly worktreesRoot: string;
}

async function managerFixture(t: TestContext): Promise<ManagerFixture> {
  const repo = fixture(t);
  const parent = makeTempDir();
  const worktreesRoot = join(parent, 'nested', 'worktrees');
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const manager = await WorktreeManager.open({ repoRoot: repo.root, worktreesRoot });
  return { repo, manager, worktreesRoot };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    assert.fail(`expected rejection with ${code}`);
  } catch (error) {
    assert.ok(isAppError(error), `expected AppError, got ${String(error)}`);
    assert.equal(error.code, code);
  }
}

describe('WorktreeManager.create', () => {
  it('creates an isolated worktree on a task branch under worktreesRoot', async (t) => {
    const { repo, manager, worktreesRoot } = await managerFixture(t);
    const baseSha = repo.sha();
    const created = await manager.create({ taskId: 'Task 01', branch: 'task/feature', baseSha });
    assert.equal(created.worktreeHandle, buildHandle('Task 01', 'task/feature'));
    assert.equal(created.branch, 'task/feature');
    assert.equal(created.headSha, baseSha);
    assert.equal(created.baseSha, baseSha);
    assert.ok(created.path.startsWith(join(worktreesRoot)));
    assert.equal(statSync(created.path).isDirectory(), true);
    assert.equal(repo.git(['rev-parse', '--verify', 'refs/heads/task/feature']).trim(), baseSha);
    assert.equal(repo.git(['rev-parse', 'HEAD'], { cwd: created.path }).trim(), baseSha);
  });

  it('accepts a complete ref as the base', async (t) => {
    const { repo, manager } = await managerFixture(t);
    const created = await manager.create({ taskId: 't1', branch: 'ai-fix/ref-base', baseSha: 'refs/heads/main' });
    assert.equal(created.headSha, repo.sha());
  });

  it('lists and reports managed worktrees', async (t) => {
    const { repo, manager } = await managerFixture(t);
    const created = await manager.create({ taskId: 't2', branch: 'task/listed', baseSha: repo.sha() });
    const list = await manager.list();
    assert.equal(list.length, 1);
    assert.equal(list[0]?.worktreeHandle, created.worktreeHandle);
    assert.equal(realpathSync(list[0]?.path ?? ''), realpathSync(created.path));
    assert.equal(list[0]?.branch, 'task/listed');
    assert.equal(list[0]?.headSha, repo.sha());
    assert.equal(await manager.has(created.worktreeHandle), true);
    assert.equal(await manager.has('does-not-exist'), false);
  });

  it('confines all paths to worktreesRoot', async (t) => {
    const { repo, manager, worktreesRoot } = await managerFixture(t);
    const created = await manager.create({ taskId: 't3', branch: 'task/path', baseSha: repo.sha() });
    assert.equal(created.path.startsWith(join(worktreesRoot) + '/'), true);
    assert.equal(existsSync(created.path), true);
  });
});

describe('WorktreeManager conflicts and validation', () => {
  it('returns WORKSPACE_NAME_CONFLICT for an existing directory/branch', async (t) => {
    const { repo, manager } = await managerFixture(t);
    const request = { taskId: 'dup', branch: 'task/dup', baseSha: repo.sha() };
    await manager.create(request);
    await expectCode(manager.create(request), ErrorCode.WORKSPACE_NAME_CONFLICT);
    await expectCode(manager.create({ ...request, taskId: 'other' }), ErrorCode.WORKSPACE_NAME_CONFLICT);
  });

  it('rejects branches outside the managed namespaces', async (t) => {
    const { repo, manager } = await managerFixture(t);
    await expectCode(manager.create({ taskId: 'bad', branch: 'feature/x', baseSha: repo.sha() }), ErrorCode.VALIDATION_FAILED);
    await expectCode(manager.create({ taskId: 'bad', branch: 'main', baseSha: repo.sha() }), ErrorCode.VALIDATION_FAILED);
  });

  it('rejects invalid base revisions and empty task ids', async (t) => {
    const { repo, manager } = await managerFixture(t);
    await expectCode(manager.create({ taskId: 'bad', branch: 'task/x', baseSha: 'HEAD' }), ErrorCode.VALIDATION_FAILED);
    await expectCode(manager.create({ taskId: 'bad', branch: 'task/x', baseSha: 'f'.repeat(40) }), ErrorCode.REVISION_NOT_FOUND);
    await expectCode(manager.create({ taskId: '', branch: 'task/x', baseSha: repo.sha() }), ErrorCode.VALIDATION_FAILED);
  });

  it('refuses paths outside worktreesRoot on remove', async (t) => {
    const { manager } = await managerFixture(t);
    await expectCode(manager.remove('../escape'), ErrorCode.VALIDATION_FAILED);
    await expectCode(manager.remove('/etc'), ErrorCode.VALIDATION_FAILED);
    await expectCode(manager.remove('missing-handle'), ErrorCode.NOT_FOUND);
  });
});

describe('WorktreeManager.remove', () => {
  it('removes the worktree but keeps the branch by default', async (t) => {
    const { repo, manager } = await managerFixture(t);
    const created = await manager.create({ taskId: 'keep', branch: 'task/keep', baseSha: repo.sha() });
    const result = await manager.remove(created.worktreeHandle);
    assert.equal(result.removed, true);
    assert.equal(result.branchDeleted, false);
    assert.equal(existsSync(created.path), false);
    assert.equal(repo.git(['rev-parse', '--verify', 'refs/heads/task/keep']).trim(), repo.sha());
    assert.deepEqual(await manager.list(), []);
  });

  it('deletes the branch only when explicitly requested', async (t) => {
    const { repo, manager } = await managerFixture(t);
    const created = await manager.create({ taskId: 'del', branch: 'task/del', baseSha: repo.sha() });
    const result = await manager.remove(created.worktreeHandle, { deleteBranch: true });
    assert.equal(result.branchDeleted, true);
    assert.throws(() => repo.git(['rev-parse', '--verify', 'refs/heads/task/del']));
    await expectCode(manager.remove(created.worktreeHandle), ErrorCode.NOT_FOUND);
  });

  it('never touches the user working tree', async (t) => {
    const { repo, manager } = await managerFixture(t);
    repo.write('user-untracked.txt', 'untracked\n');
    repo.write('README.md', '# changed by user\n');
    const created = await manager.create({ taskId: 'safe', branch: 'task/safe', baseSha: repo.sha() });
    await manager.remove(created.worktreeHandle, { deleteBranch: true });
    assert.equal(existsSync(join(repo.root, 'user-untracked.txt')), true);
    assert.match(repo.git(['status', '--porcelain']), / user-untracked\.txt/);
    assert.match(repo.git(['status', '--porcelain']), / M README\.md/);
    assert.equal(repo.git(['rev-parse', '--abbrev-ref', 'HEAD']).trim(), 'main');
  });

  it('only lists worktrees inside worktreesRoot', async (t) => {
    const { repo, manager } = await managerFixture(t);
    const outsideParent = makeTempDir();
    const outside = join(outsideParent, 'external-worktree');
    t.after(() => rmSync(outsideParent, { recursive: true, force: true }));
    repo.git(['worktree', 'add', '-q', '-b', 'task/external', outside, 'HEAD']);
    try {
      const inside = await manager.create({ taskId: 'inside', branch: 'task/inside', baseSha: repo.sha() });
      const list = await manager.list();
      assert.deepEqual(
        list.map((entry) => entry.worktreeHandle),
        [inside.worktreeHandle],
      );
    } finally {
      repo.git(['worktree', 'remove', '--force', outside]);
      repo.git(['branch', '-D', 'task/external']);
    }
  });

  it('open() rejects a non-git repository', async (t) => {
    const plain = makeTempDir();
    t.after(() => rmSync(plain, { recursive: true, force: true }));
    await expectCode(WorktreeManager.open({ repoRoot: plain, worktreesRoot: join(plain, 'wt') }), ErrorCode.NOT_A_GIT_REPO);
  });
});
