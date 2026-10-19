import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as git from './index.ts';

describe('public exports', () => {
  it('exports the local, worktree and remote surfaces', () => {
    assert.equal(typeof git.runGit, 'function');
    assert.equal(typeof git.runGitChecked, 'function');
    assert.equal(typeof git.classifyGitFailure, 'function');
    assert.equal(typeof git.detectGitState, 'function');
    assert.equal(typeof git.GitRepository, 'function');
    assert.equal(typeof git.WorktreeManager, 'function');
    assert.equal(typeof git.GitHubAdapter, 'function');
    assert.equal(typeof git.GitLabAdapter, 'function');
    assert.equal(typeof git.createRemoteProvider, 'function');
    assert.equal(typeof git.parseUnifiedDiff, 'function');
    assert.equal(typeof git.redactSecrets, 'function');
    assert.equal(typeof git.assertRevision, 'function');
    assert.ok(git.GIT_LIMITS.maxLogLimit >= 1);
  });
});
