import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ErrorCode, isAppError } from '@agent-workflow/shared';
import { containsLikelySecret, redactSecrets, safeHost } from './redact.ts';
import {
  assertFullRef,
  assertFullSha,
  assertLineRange,
  assertRelativePath,
  assertRevision,
  assertWorktreeBranchName,
  assertWorktreeHandle,
  isFullRef,
  isFullSha,
  isValidBranchShortName,
  sanitizeWorktreeSegment,
} from './validation.ts';

const SHA40 = 'a'.repeat(40);
const SHA64 = 'b'.repeat(64);

function expectCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (error) => {
    assert.ok(isAppError(error), `expected AppError, got ${String(error)}`);
    assert.equal(error.code, code);
    return true;
  });
}

describe('sha / revision validation', () => {
  it('accepts complete 40 and 64 character SHAs', () => {
    assert.equal(assertFullSha(SHA40), SHA40);
    assert.equal(assertFullSha(SHA64), SHA64);
    assert.equal(assertFullSha(SHA40.toUpperCase()), SHA40);
    assert.equal(isFullSha(SHA40), true);
    assert.equal(isFullSha('a'.repeat(39)), false);
  });

  it('rejects short names, ranges and option-like revisions', () => {
    for (const value of ['HEAD', 'HEAD~1', 'main', 'origin/main', '-c', '--upload-pack=evil', 'main..dev', 'abc1234']) {
      expectCode(() => assertRevision(value), ErrorCode.VALIDATION_FAILED);
    }
  });

  it('accepts only complete refs', () => {
    assert.equal(assertRevision('refs/heads/task/abc'), 'refs/heads/task/abc');
    assert.equal(assertRevision('refs/remotes/origin/main'), 'refs/remotes/origin/main');
    assert.equal(isFullRef('refs/tags/v1.0.0'), true);
    for (const value of ['refs/heads/../evil', 'refs/heads/a..b', 'refs/heads/a.lock', 'refs/heads/foo bar', 'refs/heads/']) {
      assert.equal(isFullRef(value), false, value);
    }
    expectCode(() => assertFullRef('heads/main'), ErrorCode.VALIDATION_FAILED);
  });

  it('validates short branch names', () => {
    assert.equal(isValidBranchShortName('main'), true);
    assert.equal(isValidBranchShortName('task/abc-1'), true);
    assert.equal(isValidBranchShortName('-bad'), false);
    assert.equal(isValidBranchShortName('bad..name'), false);
  });
});

describe('path validation', () => {
  it('accepts repository-relative paths', () => {
    assert.equal(assertRelativePath('src/a.ts'), 'src/a.ts');
    assert.equal(assertRelativePath('docs/a b.md'), 'docs/a b.md');
  });

  it('rejects absolute paths and traversal', () => {
    for (const value of ['/etc/passwd', '../secret', 'a/../../b', 'a/../b', './a', 'a//b', 'C:\\temp', '\\\\server\\share']) {
      expectCode(() => assertRelativePath(value), ErrorCode.VALIDATION_FAILED);
    }
  });

  it('rejects option-like values, pathspec magic and control characters', () => {
    for (const value of ['-n', ':(glob)src/**', 'src/a.ts:b', 'src/\u0000x', 'src/\u001b[31m']) {
      expectCode(() => assertRelativePath(value), ErrorCode.VALIDATION_FAILED);
    }
  });
});

describe('worktree namespace validation', () => {
  it('accepts task/ and ai-fix/ namespaces', () => {
    assert.equal(assertWorktreeBranchName('task/abc-1'), 'task/abc-1');
    assert.equal(assertWorktreeBranchName('ai-fix/finding-7'), 'ai-fix/finding-7');
  });

  it('rejects user branches and malformed names', () => {
    for (const value of ['feature/x', 'main', 'task/', 'task/../x', 'task/.hidden', 'task/x.lock', 'task/x y', '-task/x', 'task/x\u0000']) {
      expectCode(() => assertWorktreeBranchName(value), ErrorCode.VALIDATION_FAILED);
    }
  });

  it('validates handles', () => {
    assert.equal(assertWorktreeHandle('t-1-abc'), 't-1-abc');
    for (const value of ['../tmp', '.', '..', '-x', 'a/b', '']) {
      expectCode(() => assertWorktreeHandle(value), ErrorCode.VALIDATION_FAILED);
    }
  });

  it('sanitizes task ids into readable directory segments', () => {
    assert.equal(sanitizeWorktreeSegment('Task 01'), 'task-01');
    const unicode = sanitizeWorktreeSegment('任务#42');
    assert.match(unicode, /^[a-z0-9][a-z0-9._-]*-[0-9a-f]{6}$/);
    assert.ok(sanitizeWorktreeSegment('x'.repeat(200)).length <= 48);
  });
});

describe('line ranges', () => {
  it('accepts 1-based inclusive ranges', () => {
    assert.deepEqual(assertLineRange({ start: 1, end: 10 }), { start: 1, end: 10 });
    assert.equal(assertLineRange(undefined), undefined);
  });

  it('rejects invalid ranges', () => {
    expectCode(() => assertLineRange({ start: 0, end: 1 }), ErrorCode.VALIDATION_FAILED);
    expectCode(() => assertLineRange({ start: 5, end: 2 }), ErrorCode.VALIDATION_FAILED);
    expectCode(() => assertLineRange({ start: 1.5, end: 2 }), ErrorCode.VALIDATION_FAILED);
  });
});

describe('secret redaction', () => {
  it('masks well-known token shapes', () => {
    const input = [
      'token ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'github_pat_11ABCDEFG0123456789_abcdefghij',
      'glpat-abcdefghij0123456789',
      'Authorization: Bearer abcdefghijklmnop',
    ].join('\n');
    const output = redactSecrets(input);
    assert.doesNotMatch(output, /ghp_|glpat-|github_pat_|Bearer abc/);
    assert.ok(containsLikelySecret(input));
    assert.equal(containsLikelySecret(output), false);
  });

  it('masks credentials embedded in URLs and key=value pairs', () => {
    const output = redactSecrets('https://user:supersecret@git.example.com/repo.git access_token=abcdef123456');
    assert.doesNotMatch(output, /supersecret|abcdef123456/);
  });

  it('renders host-only URLs', () => {
    assert.equal(safeHost('https://user:token@git.example.com/group/repo?x=1'), 'git.example.com');
    assert.equal(safeHost('not a url'), '<invalid-url>');
  });
});
