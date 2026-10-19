import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, renameSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitCliAdapter } from '../../packages/server/src/index.ts';
const author = { name: 'Test', email: 'test@example.com' };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aw-selected-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root }).toString();
  git('init', '-q', '-b', 'main'); git('config', 'user.name', author.name); git('config', 'user.email', author.email);
  for (const path of ['a', 'b', 'c', 'old', 'deleted']) writeFileSync(join(root, path), path + '\n');
  git('add', '.'); git('commit', '-qm', 'initial');
  return { root, git, adapter: new GitCliAdapter(30000, root) };
}
test('confirmed whole-file commit excludes staged and unstaged unselected files, including literal pathspecs', async () => {
  const { root, git, adapter } = fixture();
  writeFileSync(join(root, 'a'), 'selected\n'); writeFileSync(join(root, 'b'), 'staged\n'); git('add', 'b');
  writeFileSync(join(root, 'b'), 'unstaged-after-staging\n'); writeFileSync(join(root, 'c'), 'unselected\n');
  writeFileSync(join(root, 'new[1]'), 'literal\n'); writeFileSync(join(root, 'new1'), 'exclude\n');
  const indexBefore = git('ls-files', '--stage', 'b');
  await adapter.commit({ worktreePath: root, filePaths: ['a', 'new[1]'], message: 'selected', author });
  assert.deepEqual(git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').trim().split('\n'), ['a', 'new[1]']);
  assert.equal(git('ls-files', '--stage', 'b'), indexBefore);
  assert.match(git('diff', '--cached', '--name-only'), /^b\n$/);
  assert.equal(git('show', ':b'), 'staged\n'); assert.match(git('diff', '--name-only'), /c/);
});
test('selected rename and deletion are committed while unrelated staged content remains', async () => {
  const { root, git, adapter } = fixture(); renameSync(join(root, 'old'), join(root, 'renamed')); unlinkSync(join(root, 'deleted'));
  writeFileSync(join(root, 'b'), 'keep staged\n'); git('add', 'b');
  await adapter.commit({ worktreePath: root, filePaths: ['old', 'renamed', 'deleted'], message: 'rename delete', author });
  assert.match(git('ls-tree', '--name-only', 'HEAD'), /renamed/); assert.doesNotMatch(git('ls-tree', '--name-only', 'HEAD'), /deleted|old/);
  assert.equal(git('diff', '--cached', '--name-only'), 'b\n');
});
test('hook rejection restores selected index entries and absent entry without reverting working tree', async () => {
  const { root, git, adapter } = fixture();
  writeFileSync(join(root, 'a'), 'old staged\n'); git('add', 'a'); writeFileSync(join(root, 'a'), 'new unstaged\n');
  writeFileSync(join(root, 'new'), 'new\n'); writeFileSync(join(root, 'b'), 'keep\n'); git('add', 'b');
  const before = git('ls-files', '--stage', '-z'); const head = git('rev-parse', 'HEAD');
  const hook = join(root, '.git/hooks/pre-commit'); writeFileSync(hook, '#!/bin/sh\necho hook rejected >&2\nexit 1\n'); chmodSync(hook, 0o755);
  await assert.rejects(adapter.commit({ worktreePath: root, filePaths: ['a', 'new'], message: 'rejected', author }));
  assert.equal(git('rev-parse', 'HEAD'), head); assert.equal(git('ls-files', '--stage', '-z'), before);
  assert.match(git('diff', '--', 'a'), /new unstaged/); assert.match(git('ls-files', '--others', '--exclude-standard'), /new/);
});
test('unmerged selected index stages are rejected before changing any index entry', async () => {
  const { root, git, adapter } = fixture();
  git('checkout', '-qb', 'other'); writeFileSync(join(root, 'a'), 'other\n'); git('commit', '-qam', 'other');
  git('checkout', '-q', 'main'); writeFileSync(join(root, 'a'), 'main\n'); git('commit', '-qam', 'main');
  try { git('merge', 'other'); } catch { /* Actual merge conflict is the fixture. */ }
  const before = git('ls-files', '--stage', '-z');
  assert.match(before, / 1\ta/);
  await assert.rejects(adapter.commit({ worktreePath: root, filePaths: ['a'], message: 'not resolved', author }), /合并冲突/);
  assert.equal(git('ls-files', '--stage', '-z'), before);
});
