import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppError, ErrorCode } from '@agent-workflow/shared';
import { GitCliAdapter } from '../../packages/server/src/adapters/git-cli.ts';

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd }).toString().trim();
}

test('push creates a remote branch, rejects non-fast-forward updates and updates fetch refs', async () => {
  const work = mkdtempSync(join(tmpdir(), 'aw-push-'));
  const bare = join(work, 'remote.git');
  const repo = join(work, 'repo');
  execFileSync('git', ['init', '--bare', '-q', '-b', 'main', bare]);
  execFileSync('git', ['clone', '-q', bare, repo]);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test']);
  writeFileSync(join(repo, 'a.txt'), 'a\n', 'utf8');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-qm', 'first']);
  const first = git(repo, ['rev-parse', 'HEAD']);

  const adapter = new GitCliAdapter(30000, join(work, 'merge-tmp'), () => ({ provider: 'github', token: 'ghp_unused_for_file_remote' }));
  const pushed = await adapter.push({ repoRoot: repo, localSha: first, remote: 'origin', remoteRef: 'refs/heads/task/push-test' });
  assert.equal(pushed.created, true);
  assert.equal(git(bare, ['rev-parse', 'task/push-test']), first);

  // A different root commit on the branch cannot fast-forward the remote ref.
  const orphan = git(repo, ['commit-tree', git(repo, ['rev-parse', 'HEAD^{tree}']), '-m', 'orphan']);
  await assert.rejects(
    adapter.push({ repoRoot: repo, localSha: orphan, remote: 'origin', remoteRef: 'refs/heads/task/push-test' }),
    (error: unknown) => error instanceof AppError && error.code === ErrorCode.PUSH_REJECTED_NON_FF,
  );
  assert.equal(git(bare, ['rev-parse', 'task/push-test']), first);

  // fetch --prune still works with the token provider attached to a file:// remote.
  writeFileSync(join(repo, 'b.txt'), 'b\n', 'utf8');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-qm', 'second']);
  const second = git(repo, ['rev-parse', 'HEAD']);
  await adapter.push({ repoRoot: repo, localSha: second, remote: 'origin', remoteRef: 'refs/heads/task/push-test' });
  assert.equal(git(join(work, 'remote.git'), ['rev-parse', 'task/push-test']), second);
  const fetchResult = await adapter.fetch({ repoRoot: repo, remote: 'origin', prune: true });
  assert.ok(fetchResult.fetchedAt.length > 0);
});
