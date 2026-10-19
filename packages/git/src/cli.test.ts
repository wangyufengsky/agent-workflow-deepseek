import assert from 'node:assert/strict';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ErrorCode, isAppError } from '@agent-workflow/shared';
import { classifyGitFailure, GitCommandError, runGit, runGitBytes, runGitChecked } from './cli.ts';
import { createFixtureRepo, makeTempDir } from './testing.ts';

function writeScript(root: string, name: string, body: string): string {
  const path = join(root, name);
  writeFileSync(path, body, { encoding: 'utf8', mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
}

function expectCode(fn: () => Promise<unknown>, code: string): Promise<void> {
  return fn().then(
    () => assert.fail(`expected rejection with ${code}`),
    (error: unknown) => {
      assert.ok(isAppError(error), `expected AppError, got ${String(error)}`);
      assert.equal(error.code, code);
    },
  );
}

describe('runGit argument handling', () => {
  it('passes arguments as an array without shell splitting', async () => {
    const dir = makeTempDir();
    try {
      const script = writeScript(dir, 'echo-args.sh', '#!/bin/sh\nprintf "ARG:%s\\n" "$@"\n');
      const result = await runGit(['rev-parse', 'a b', '--format=%H'], { cwd: dir, gitBinary: script });
      assert.equal(result.exitCode, 0);
      assert.match(result.stdout, /ARG:a b/);
      assert.match(result.stdout, /ARG:--format=%H/);
      assert.match(result.stdout, /ARG:--no-optional-locks/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs real git with --no-optional-locks and captures output', async () => {
    const repo = createFixtureRepo();
    try {
      const result = await runGit(['rev-parse', '--is-inside-work-tree'], { cwd: repo.root });
      assert.equal(result.stdout.trim(), 'true');
      assert.equal(result.exitCode, 0);
      assert.equal(result.truncated, false);
    } finally {
      repo.cleanup();
    }
  });

  it('captures binary stdout without corrupting it', async () => {
    const dir = makeTempDir();
    const script = writeScript(dir, 'binary.sh', "#!/bin/sh\nprintf '\\000\\001\\377'\n");
    const result = await runGitBytes(['whatever'], { cwd: dir, gitBinary: script });
    assert.deepEqual([...result.stdout], [0, 1, 255]);
  });

  it('maps a missing cwd to REPO_PATH_UNAVAILABLE', async () => {
    await expectCode(() => runGit(['version'], { cwd: join(makeTempDir(), 'does-not-exist') }), ErrorCode.REPO_PATH_UNAVAILABLE);
  });

  it('maps a missing git binary to GIT_CAPABILITY_UNAVAILABLE', async () => {
    const dir = makeTempDir();
    await expectCode(() => runGit(['version'], { cwd: dir, gitBinary: join(dir, 'no-such-git') }), ErrorCode.GIT_CAPABILITY_UNAVAILABLE);
  });
});

describe('runGit safety limits', () => {
  it('times out and reports a redacted error', async () => {
    const dir = makeTempDir();
    const script = writeScript(dir, 'slow.sh', '#!/bin/sh\nsleep 5\n');
    const started = Date.now();
    await expectCode(() => runGit(['status'], { cwd: dir, gitBinary: script, timeoutMs: 200 }), ErrorCode.CAPABILITY_UNAVAILABLE);
    assert.ok(Date.now() - started < 3_000, 'timeout should abort quickly');
  });

  it('throws TRUNCATED when output exceeds the cap', async () => {
    const dir = makeTempDir();
    const script = writeScript(dir, 'flood.sh', "#!/bin/sh\nhead -c 5000 /dev/zero | tr '\\0' 'x'\n");
    await expectCode(() => runGit(['log'], { cwd: dir, gitBinary: script, maxOutputBytes: 100 }), ErrorCode.TRUNCATED);
  });

  it('returns partial output when overflow is allowed (diff paging)', async () => {
    const dir = makeTempDir();
    const script = writeScript(dir, 'flood2.sh', "#!/bin/sh\nhead -c 5000 /dev/zero | tr '\\0' 'x'\n");
    const result = await runGit(['diff'], { cwd: dir, gitBinary: script, maxOutputBytes: 100, allowOutputOverflow: true });
    assert.equal(result.truncated, true);
    assert.ok(result.stdout.length <= 100);
  });
});

describe('git failure classification and redaction', () => {
  it('classifies common failure modes', () => {
    assert.equal(classifyGitFailure('fatal: not a git repository (or any of the parent directories)', 128), ErrorCode.NOT_A_GIT_REPO);
    assert.equal(classifyGitFailure('fatal: ambiguous argument \'HEAD~9\'', 128), ErrorCode.REVISION_NOT_FOUND);
    assert.equal(classifyGitFailure('fatal: could not resolve host: github.com', 128), ErrorCode.NETWORK_UNREACHABLE);
    assert.equal(classifyGitFailure('fatal: Authentication failed for repository', 128), ErrorCode.GITLAB_AUTH_FAILED);
    assert.equal(classifyGitFailure('! [remote rejected] main -> main (non-fast-forward)', 1), ErrorCode.PUSH_REJECTED_NON_FF);
    assert.equal(classifyGitFailure('remote: pre-receive hook declined', 1), ErrorCode.HOOK_REJECTED);
    assert.equal(classifyGitFailure('fatal: shallow file has changed', 128), ErrorCode.SHALLOW_HISTORY);
    assert.equal(classifyGitFailure('fatal: A branch named task/x already exists.', 128), ErrorCode.WORKSPACE_NAME_CONFLICT);
  });

  it('never echoes credentials from stderr', async () => {
    const dir = makeTempDir();
    const script = writeScript(
      dir,
      'leaky.sh',
      "#!/bin/sh\necho 'fatal: not a git repository; token=glpat-abcdefghij0123456789' >&2\nexit 128\n",
    );
    try {
      await runGit(['status'], { cwd: dir, gitBinary: script });
      assert.fail('expected failure');
    } catch (error) {
      assert.ok(error instanceof GitCommandError);
      assert.equal(error.code, ErrorCode.NOT_A_GIT_REPO);
      assert.doesNotMatch(error.message, /glpat-/);
      assert.doesNotMatch(JSON.stringify(error.toJSON()), /glpat-/);
      assert.equal(error.exitCode, 128);
    }
  });

  it('runGitChecked rejects option-like values', async () => {
    const repo = createFixtureRepo();
    try {
      await expectCode(() => runGitChecked('rev-parse', ['--show-toplevel'], { cwd: repo.root }), ErrorCode.VALIDATION_FAILED);
      const result = await runGitChecked('rev-parse', ['HEAD'], { cwd: repo.root });
      assert.equal(result.exitCode, 0);
    } finally {
      repo.cleanup();
    }
  });
});
