import assert from 'node:assert/strict';
import { realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import { ErrorCode, isAppError } from '@agent-workflow/shared';
import { detectGitState, GitRepository } from './repository.ts';
import { createBareRemote, createFixtureRepo, makeTempDir, runFixtureGit, type FixtureRepo } from './testing.ts';

function fixture(t: TestContext, options: { empty?: boolean } = {}): FixtureRepo {
  const repo = createFixtureRepo(options);
  t.after(() => repo.cleanup());
  return repo;
}

async function open(repo: FixtureRepo): Promise<GitRepository> {
  return GitRepository.open(repo.root);
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

describe('detectGitState / open', () => {
  it('detects repositories, non-repositories and missing paths', async (t) => {
    const repo = fixture(t);
    assert.equal(await detectGitState(repo.root), 'git');
    const plain = makeTempDir();
    t.after(() => rmSync(plain, { recursive: true, force: true }));
    assert.equal(await detectGitState(plain), 'not_git');
    assert.equal(await detectGitState(join(plain, 'missing')), 'path_unavailable');
  });

  it('opens a repository and resolves nested directories to the worktree root', async (t) => {
    const repo = fixture(t);
    repo.write('src/nested/file.txt', 'x');
    const opened = await GitRepository.open(join(repo.root, 'src', 'nested'));
    assert.equal(realpathSync(opened.root), realpathSync(repo.root));
  });

  it('rejects non-git and missing paths with shared error codes', async (t) => {
    const plain = makeTempDir();
    t.after(() => rmSync(plain, { recursive: true, force: true }));
    await expectCode(GitRepository.open(plain), ErrorCode.NOT_A_GIT_REPO);
    await expectCode(GitRepository.open(join(plain, 'nope')), ErrorCode.REPO_PATH_UNAVAILABLE);
  });
});

describe('status', () => {
  it('reports an empty repository as unborn', async (t) => {
    const repo = fixture(t, { empty: true });
    const git = await open(repo);
    const status = await git.status();
    assert.equal(status.isEmpty, true);
    assert.deepEqual(status.head, { kind: 'unborn' });
    assert.deepEqual(status.workingTree, { uncommitted: 0, staged: 0, untracked: 0 });
    assert.equal(status.upstream, undefined);
    assert.equal(status.shallow, undefined);
  });

  it('counts untracked and staged files', async (t) => {
    const repo = fixture(t, { empty: true });
    const git = await open(repo);
    repo.write('a.txt', 'a');
    repo.write('dir/b.txt', 'b');
    let status = await git.status();
    assert.equal(status.workingTree.untracked, 2);
    repo.git(['add', '-A']);
    status = await git.status();
    assert.equal(status.workingTree.staged, 2);
  });

  it('reports branch head, sha and clean working tree after a commit', async (t) => {
    const repo = fixture(t);
    const git = await open(repo);
    const status = await git.status();
    assert.deepEqual(status.head, { kind: 'branch', branch: 'main', sha: repo.sha() });
    assert.equal(status.isEmpty, false);
    assert.deepEqual(status.workingTree, { uncommitted: 0, staged: 0, untracked: 0 });
  });

  it('reports detached HEAD', async (t) => {
    const repo = fixture(t);
    const sha = repo.sha();
    repo.git(['checkout', '-q', '--detach', sha]);
    const status = await (await open(repo)).status();
    assert.deepEqual(status.head, { kind: 'detached', sha });
  });

  it('reports an in-progress merge', async (t) => {
    const repo = fixture(t);
    repo.write('conflict.txt', 'base\n');
    repo.commit('base conflict');
    repo.git(['checkout', '-q', '-b', 'other']);
    repo.write('conflict.txt', 'other\n');
    repo.commit('other side');
    repo.git(['checkout', '-q', 'main']);
    repo.write('conflict.txt', 'main\n');
    repo.commit('main side');
    assert.throws(() => repo.git(['merge', 'other']));
    const status = await (await open(repo)).status();
    assert.equal(status.userOperationInProgress, 'merge');
    repo.git(['merge', '--abort']);
  });
});

describe('log', () => {
  it('returns newest-first pages with parents and decoration refs', async (t) => {
    const repo = fixture(t);
    const first = repo.sha();
    repo.commit('second commit', { 'b.txt': 'b\n' });
    const second = repo.sha();
    repo.commit('third commit', { 'c.txt': 'c\n' });
    const third = repo.sha();
    const git = await open(repo);

    const page = await git.log();
    assert.equal(page.commits.length, 3);
    assert.equal(page.resolvedTipSha, third);
    assert.equal(page.commits[0]?.sha, third);
    assert.deepEqual(page.commits[0]?.parents, [second]);
    assert.equal(page.commits[0]?.subject, 'third commit');
    assert.deepEqual(page.commits[2]?.parents, []);
    assert.equal(page.commits[1]?.sha, second);
    assert.equal(page.commits[2]?.sha, first);
    assert.ok(page.commits[0]?.refs.some((ref) => ref.kind === 'head'));
    assert.equal(page.commits[0]?.author.name, 'Test Author');
    assert.equal(page.commits[0]?.author.initials, 'TA');
    assert.ok(Number.isFinite(Date.parse(page.commits[0]?.authoredAt ?? '')));
  });

  it('paginates with an exclusive cursor', async (t) => {
    const repo = fixture(t);
    const first = repo.sha();
    repo.commit('second', { 'b.txt': 'b\n' });
    const second = repo.sha();
    repo.commit('third', { 'c.txt': 'c\n' });
    const git = await open(repo);
    const pageOne = await git.log({ limit: 2 });
    assert.equal(pageOne.commits.length, 2);
    assert.equal(pageOne.nextCursor, second);
    const pageTwo = await git.log({ limit: 2, cursor: pageOne.nextCursor });
    assert.equal(pageTwo.commits.length, 1);
    assert.equal(pageTwo.commits[0]?.sha, first);
    assert.equal(pageTwo.nextCursor, undefined);
  });

  it('returns an empty page for an unborn repository', async (t) => {
    const repo = fixture(t, { empty: true });
    const git = await open(repo);
    const page = await git.log();
    assert.deepEqual(page, { commits: [] });
    assert.deepEqual(await git.branches(), []);
  });

  it('accepts full refs but rejects short names and out-of-range limits', async (t) => {
    const repo = fixture(t);
    const git = await open(repo);
    const refPage = await git.log({ ref: 'refs/heads/main' });
    assert.equal(refPage.commits.length, 1);
    await expectCode(git.log({ ref: 'main' }), ErrorCode.VALIDATION_FAILED);
    await expectCode(git.log({ ref: 'HEAD~1' }), ErrorCode.VALIDATION_FAILED);
    await expectCode(git.log({ limit: 0 }), ErrorCode.VALIDATION_FAILED);
    await expectCode(git.log({ limit: 201 }), ErrorCode.VALIDATION_FAILED);
  });

  it('flags shallow boundaries for depth-limited clones', async (t) => {
    const repo = fixture(t);
    repo.commit('second', { 'b.txt': 'b\n' });
    repo.commit('third', { 'c.txt': 'c\n' });
    const parent = makeTempDir();
    const clonePath = join(parent, 'clone');
    t.after(() => rmSync(parent, { recursive: true, force: true }));
    runFixtureGit(['clone', '-q', '--depth', '1', `file://${repo.root}`, 'clone'], parent);
    const git = await GitRepository.open(clonePath);
    const status = await git.status();
    assert.deepEqual(status.shallow, {});
    const page = await git.log();
    assert.equal(page.shallowBoundaryReached, true);
    assert.equal(page.commits.length, 1);
  });
});

describe('commitShow', () => {
  it('returns body, committer, stats, contained refs and compare options', async (t) => {
    const repo = fixture(t);
    const first = repo.sha();
    repo.write('README.md', '# v2\n');
    const second = repo.commit('feat: second\n\nbody line 1\nbody line 2', { 'new.txt': 'new\n' });
    const git = await open(repo);
    const commit = await git.commitShow(second);
    assert.equal(commit.subject, 'feat: second');
    assert.equal(commit.body, 'body line 1\nbody line 2');
    assert.equal(commit.committer.name, 'Test Committer');
    assert.deepEqual(commit.parents, [first]);
    assert.equal(commit.stats.files, 2);
    assert.equal(commit.stats.additions, 2);
    assert.equal(commit.stats.deletions, 1);
    assert.ok(commit.containedIn.branches.includes('main'));
    assert.equal(commit.containedIn.truncated, false);
    assert.equal(commit.compareOptions[0]?.kind, 'parent');
    assert.equal(commit.compareOptions[0]?.baseSha, first);
    assert.ok(commit.refs.some((ref) => ref.kind === 'head'));
  });

  it('handles the root commit and rejects short/fake revisions', async (t) => {
    const repo = fixture(t);
    const rootSha = repo.sha();
    const git = await open(repo);
    const root = await git.commitShow(rootSha);
    assert.deepEqual(root.parents, []);
    // Root commits are reviewable against Git's well-known empty tree.
    assert.equal(root.compareOptions.length, 1);
    assert.equal(root.compareOptions[0]?.kind, 'empty_tree');
    assert.equal(root.compareOptions[0]?.baseSha, '4b825dc642cb6eb9a060e54bf8d69288fbee4904');
    await expectCode(git.commitShow('HEAD'), ErrorCode.VALIDATION_FAILED);
    await expectCode(git.commitShow('f'.repeat(40)), ErrorCode.REVISION_NOT_FOUND);
  });
});

describe('commitFiles / commitDiff', () => {
  function setup(t: TestContext): { repo: FixtureRepo; baseSha: string; headSha: string } {
    const repo = fixture(t);
    repo.write('old.txt', 'delete me\n');
    repo.write('src/rename-old.ts', 'rename me\n');
    repo.write('bin.dat', Uint8Array.from([0, 1, 2]));
    const baseSha = repo.commit('base');
    repo.write('README.md', '# v2\n');
    repo.write('src/new.ts', 'export const x = 1;\n');
    repo.remove('old.txt');
    repo.git(['mv', 'src/rename-old.ts', 'src/rename-new.ts']);
    repo.write('bin.dat', Uint8Array.from([0, 1, 3]));
    const headSha = repo.commit('changes');
    return { repo, baseSha, headSha };
  }

  it('lists changed files for a commit with statuses and binary markers', async (t) => {
    const { repo, baseSha, headSha } = setup(t);
    const git = await open(repo);
    const result = await git.commitFiles(headSha);
    assert.equal(result.truncated, false);
    const byPath = new Map(result.files.map((file) => [file.path, file]));
    assert.equal(byPath.get('README.md')?.status, 'M');
    assert.equal(byPath.get('src/new.ts')?.status, 'A');
    assert.equal(byPath.get('old.txt')?.status, 'D');
    const renamed = byPath.get('src/rename-new.ts');
    assert.equal(renamed?.status, 'R');
    assert.equal(renamed?.oldPath, 'src/rename-old.ts');
    const binary = byPath.get('bin.dat');
    assert.equal(binary?.binary, true);
    assert.equal(binary?.additions, null);
    assert.equal(binary?.deletions, null);
    assert.ok(result.files.every((file) => file.versionRef === `${baseSha}..${headSha}`));
  });

  it('lists the files of a root commit', async (t) => {
    const repo = fixture(t);
    const git = await open(repo);
    const result = await git.commitFiles(repo.sha());
    assert.deepEqual(
      result.files.map((file) => file.status),
      ['A'],
    );
    assert.equal(result.files[0]?.path, 'README.md');
  });

  it('diffs two commits and validates both SHAs', async (t) => {
    const { repo, baseSha, headSha } = setup(t);
    const git = await open(repo);
    const result = await git.commitDiff(baseSha, headSha);
    assert.ok(result.files.length >= 5);
    await expectCode(git.commitDiff('HEAD', headSha), ErrorCode.VALIDATION_FAILED);
    await expectCode(git.commitDiff(baseSha, 'HEAD'), ErrorCode.VALIDATION_FAILED);
  });
});

describe('diffHunks', () => {
  it('parses a commit-to-commit diff with line numbers', async (t) => {
    const repo = fixture(t);
    repo.write('file.txt', 'a\nb\nc\n');
    const baseSha = repo.commit('base');
    repo.write('file.txt', 'a\nB\nc\n');
    const headSha = repo.commit('change');
    const git = await open(repo);
    const page = await git.diffHunks({ baseSha, headSha, path: 'file.txt' });
    assert.equal(page.hunks.length, 1);
    assert.deepEqual(
      page.hunks[0]?.lines.map((line) => line.kind),
      ['context', 'del', 'add', 'context'],
    );
    assert.equal(page.hunks[0]?.lines[1]?.text, 'b');
    assert.equal(page.hunks[0]?.lines[2]?.text, 'B');
    assert.equal(page.baseSha, baseSha);
    assert.equal(page.headSha, headSha);
    assert.equal(page.ignoreWhitespace, false);
  });

  it('diffs the working tree when headSha is omitted', async (t) => {
    const repo = fixture(t);
    repo.write('file.txt', 'a\nb\n');
    const baseSha = repo.commit('base');
    repo.write('file.txt', 'a\nB\n');
    const page = await (await open(repo)).diffHunks({ baseSha, path: 'file.txt' });
    assert.equal(page.headSha, undefined);
    assert.equal(page.hunks.length, 1);
    assert.ok(page.hunks[0]?.lines.some((line) => line.kind === 'add'));
  });

  it('can ignore whitespace-only changes', async (t) => {
    const repo = fixture(t);
    repo.write('space.txt', 'a b\n');
    const baseSha = repo.commit('base');
    repo.write('space.txt', 'a    b\n');
    const headSha = repo.commit('spacing');
    const git = await open(repo);
    const visible = await git.diffHunks({ baseSha, headSha, path: 'space.txt' });
    assert.equal(visible.hunks.length, 1);
    const ignored = await git.diffHunks({ baseSha, headSha, path: 'space.txt', ignoreWhitespace: true });
    assert.deepEqual(ignored.hunks, []);
    assert.equal(ignored.ignoreWhitespace, true);
  });

  it('expands unchanged context with a larger unified radius (GIT-02) and validates the request', async (t) => {
    const repo = fixture(t);
    const lines = Array.from({ length: 30 }, (_, index) => `line ${String(index + 1)}`);
    repo.write('context.txt', `${lines.join('\n')}\n`);
    const baseSha = repo.commit('base');
    const changed = lines.map((line, index) => (index === 14 ? 'line 15 changed' : line));
    repo.write('context.txt', `${changed.join('\n')}\n`);
    const headSha = repo.commit('change middle');
    const git = await open(repo);
    const tight = await git.diffHunks({ baseSha, headSha, path: 'context.txt' });
    const mid = await git.diffHunks({ baseSha, headSha, path: 'context.txt', contextLines: 10 });
    const wide = await git.diffHunks({ baseSha, headSha, path: 'context.txt', contextLines: 25 });
    const tightLines = tight.hunks.reduce((total, hunk) => total + hunk.lines.length, 0);
    const midLines = mid.hunks.reduce((total, hunk) => total + hunk.lines.length, 0);
    const wideLines = wide.hunks.reduce((total, hunk) => total + hunk.lines.length, 0);
    assert.ok(midLines > tightLines, `expected expanded context, tight=${String(tightLines)} mid=${String(midLines)}`);
    assert.ok(wideLines > midLines);
    assert.ok((mid.hunks[0]?.oldStart ?? 99) < (tight.hunks[0]?.oldStart ?? 0));
    // 展开后的上下文来自真实文件行，不是补齐的占位文本。
    assert.ok(wide.hunks[0]?.lines.some((line) => line.text === 'line 1'));
    await expectCode(git.diffHunks({ baseSha, headSha, path: 'context.txt', contextLines: 0 }), ErrorCode.VALIDATION_FAILED);
    await expectCode(git.diffHunks({ baseSha, headSha, path: 'context.txt', contextLines: 2_001 }), ErrorCode.VALIDATION_FAILED);
  });

  it('returns no hunks for binary files', async (t) => {
    const repo = fixture(t);
    repo.write('bin.dat', Uint8Array.from([0, 1, 2]));
    const baseSha = repo.commit('base');
    repo.write('bin.dat', Uint8Array.from([0, 1, 3]));
    const headSha = repo.commit('change binary');
    const page = await (await open(repo)).diffHunks({ baseSha, headSha, path: 'bin.dat' });
    assert.deepEqual(page.hunks, []);
  });

  it('paginates hunks and reports truncation', async (t) => {
    const repo = fixture(t);
    const original = Array.from({ length: 12 }, (_, index) => `line ${index}`).join('\n') + '\n';
    repo.write('big.txt', original);
    const baseSha = repo.commit('base');
    const changed = Array.from({ length: 12 }, (_, index) => `changed ${index}`).join('\n') + '\n';
    repo.write('big.txt', changed);
    const headSha = repo.commit('change');
    const git = await open(repo);
    const first = await git.diffHunks({ baseSha, headSha, path: 'big.txt', maxLines: 4 });
    assert.equal(first.truncated?.reason, 'LINE_LIMIT');
    assert.ok(first.nextCursor !== undefined);
    const second = await git.diffHunks({ baseSha, headSha, path: 'big.txt', maxLines: 20, cursor: first.nextCursor });
    assert.ok(second.hunks.length > 0);
    assert.equal(second.truncated, undefined);
  });

  it('reports byte-limit truncation', async (t) => {
    const repo = fixture(t);
    repo.write('big.txt', 'a\n');
    const baseSha = repo.commit('base');
    repo.write('big.txt', Array.from({ length: 50 }, (_, index) => `changed ${index}`).join('\n') + '\n');
    const headSha = repo.commit('change');
    const page = await (await open(repo)).diffHunks({ baseSha, headSha, path: 'big.txt', maxBytes: 80 });
    assert.equal(page.truncated?.reason, 'BYTE_LIMIT');
  });

  it('rejects path traversal, option-like values and short revisions', async (t) => {
    const repo = fixture(t);
    const sha = repo.sha();
    const git = await open(repo);
    await expectCode(git.diffHunks({ baseSha: sha, path: '../secret' }), ErrorCode.VALIDATION_FAILED);
    await expectCode(git.diffHunks({ baseSha: sha, path: '/etc/passwd' }), ErrorCode.VALIDATION_FAILED);
    await expectCode(git.diffHunks({ baseSha: sha, path: '--output=/tmp/x' }), ErrorCode.VALIDATION_FAILED);
    await expectCode(git.diffHunks({ baseSha: 'HEAD', path: 'README.md' }), ErrorCode.VALIDATION_FAILED);
    await expectCode(git.diffHunks({ baseSha: sha, headSha: 'HEAD', path: 'README.md' }), ErrorCode.VALIDATION_FAILED);
  });
});

describe('fileAtRevision', () => {
  it('returns numbered lines and applies line ranges', async (t) => {
    const repo = fixture(t);
    repo.write('lines.txt', 'one\ntwo\nthree\n');
    const sha = repo.commit('lines');
    const git = await open(repo);
    const all = await git.fileAtRevision(sha, 'lines.txt');
    assert.equal(all.binary, false);
    assert.equal(all.totalLines, 3);
    assert.deepEqual(
      all.lines.map((line) => line.number),
      [1, 2, 3],
    );
    assert.deepEqual(
      all.lines.map((line) => line.text),
      ['one', 'two', 'three'],
    );
    const range = await git.fileAtRevision(sha, 'lines.txt', { start: 2, end: 3 });
    assert.equal(range.content, 'two\nthree');
    assert.equal(range.start, 2);
    assert.equal(range.end, 3);
  });

  it('accepts complete refs and rejects bad paths/revisions', async (t) => {
    const repo = fixture(t);
    const git = await open(repo);
    const fromRef = await git.fileAtRevision('refs/heads/main', 'README.md');
    assert.match(fromRef.content, /fixture/);
    await expectCode(git.fileAtRevision(repo.sha(), '../etc/passwd'), ErrorCode.VALIDATION_FAILED);
    await expectCode(git.fileAtRevision(repo.sha(), 'missing.txt'), ErrorCode.NOT_FOUND);
    await expectCode(git.fileAtRevision('f'.repeat(40), 'README.md'), ErrorCode.REVISION_NOT_FOUND);
  });

  it('marks binary files', async (t) => {
    const repo = fixture(t);
    repo.write('bin.dat', Uint8Array.from([0, 1, 2]));
    const sha = repo.commit('bin');
    const result = await (await open(repo)).fileAtRevision(sha, 'bin.dat');
    assert.equal(result.binary, true);
    assert.equal(result.lines.length, 0);
  });
});

describe('mergeBase / refsContaining', () => {
  it('finds the merge base of two branches', async (t) => {
    const repo = fixture(t);
    const base = repo.sha();
    repo.git(['checkout', '-q', '-b', 'feature']);
    repo.commit('feature work', { 'feature.txt': 'f\n' });
    repo.git(['checkout', '-q', 'main']);
    repo.commit('main work', { 'main.txt': 'm\n' });
    const git = await open(repo);
    const mergeBase = await git.mergeBase('refs/heads/main', 'refs/heads/feature');
    assert.equal(mergeBase, base);
    await expectCode(git.mergeBase('main', 'refs/heads/feature'), ErrorCode.VALIDATION_FAILED);
  });

  it('lists branches containing a commit', async (t) => {
    const repo = fixture(t);
    const base = repo.sha();
    repo.git(['checkout', '-q', '-b', 'feature']);
    repo.commit('feature work', { 'feature.txt': 'f\n' });
    repo.git(['checkout', '-q', 'main']);
    repo.commit('main work', { 'main.txt': 'm\n' });
    const git = await open(repo);
    const contained = await git.refsContaining(base);
    assert.ok(contained.branches.includes('main'));
    assert.ok(contained.branches.includes('feature'));
    assert.equal(contained.truncated, false);
    await expectCode(git.refsContaining('f'.repeat(40)), ErrorCode.REVISION_NOT_FOUND);
  });
});

describe('branches / remotes', () => {
  it('lists local branches with current flags and ahead/behind', async (t) => {
    const repo = fixture(t);
    repo.git(['checkout', '-q', '-b', 'feature']);
    repo.commit('feature work', { 'feature.txt': 'f\n' });
    repo.git(['checkout', '-q', 'main']);
    const git = await open(repo);
    const branches = await git.branches();
    const main = branches.find((branch) => branch.name === 'main');
    const feature = branches.find((branch) => branch.name === 'feature');
    assert.ok(main !== undefined);
    assert.ok(feature !== undefined);
    assert.equal(main.kind, 'local');
    assert.equal(main.isCurrent, true);
    assert.equal(main.checkedOutInUserWorktree, true);
    assert.equal(main.tipSha, repo.sha());
    assert.equal(main.protected, null);
    assert.equal(main.vsDefault?.ahead, 0);
    assert.equal(feature.isCurrent, false);
    assert.equal(feature.vsDefault?.ahead, 1);
    assert.equal(feature.lastCommit?.subject, 'feature work');
    assert.equal(feature.lastCommit?.author.email, 'author@example.com');
    assert.equal(feature.lastCommit?.author.initials, 'TA');
  });

  it('lists remote branches and upstream after a push', async (t) => {
    const repo = fixture(t);
    const remote = createBareRemote();
    t.after(() => remote.cleanup());
    repo.git(['remote', 'add', 'origin', remote.root]);
    repo.git(['push', '-q', '-u', 'origin', 'main']);
    const git = await open(repo);
    const branches = await git.branches();
    const current = branches.find((branch) => branch.kind === 'local' && branch.name === 'main');
    const remoteMain = branches.find((branch) => branch.kind === 'remote' && branch.name === 'origin/main');
    assert.equal(current?.upstream, 'origin/main');
    assert.ok(remoteMain !== undefined);
    assert.equal(remoteMain.fullRef, 'refs/remotes/origin/main');
    const remotes = await git.listRemotes();
    assert.equal(remotes[0]?.name, 'origin');
    assert.equal(remotes[0]?.fetchUrl, remote.root);
    repo.git(['fetch', '-q', 'origin']);
    const status = await git.status();
    assert.ok(status.lastFetchAt !== undefined);
    assert.deepEqual(status.upstream, { ref: 'origin/main', ahead: 0, behind: 0 });
  });
});
