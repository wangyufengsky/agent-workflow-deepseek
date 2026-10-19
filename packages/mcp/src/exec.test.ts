import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { AppError, ErrorCode } from '@agent-workflow/shared';
import { WorkspaceExec, createCommandAllowlist, tokenizeCommand } from './exec.ts';

async function makeRoot(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'aw-exec-'));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

async function codeOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof AppError, `expected AppError, got ${String(error)}`);
    return error;
  }
  assert.fail('expected the operation to reject');
}

describe('command tokenizer', () => {
  it('splits quoted arguments without invoking a shell', () => {
    assert.deepEqual(tokenizeCommand('git status --short'), ['git', 'status', '--short']);
    assert.deepEqual(tokenizeCommand('echo "hello world" \'second arg\''), ['echo', 'hello world', 'second arg']);
    assert.deepEqual(tokenizeCommand('node -e "console.log(1)"'), ['node', '-e', 'console.log(1)']);
    assert.deepEqual(tokenizeCommand('printf a\\ b'), ['printf', 'a b']);
  });

  it('rejects empty and unterminated commands', () => {
    for (const command of ['', '   ', 'echo "unclosed']) {
      assert.throws(
        () => tokenizeCommand(command),
        (error: unknown) => error instanceof AppError && error.code === ErrorCode.VALIDATION_FAILED,
        command,
      );
    }
  });
});

describe('command allowlist', () => {
  it('matches token prefixes', () => {
    const allowlist = createCommandAllowlist(['git status', 'npm test']);
    assert.equal(allowlist.allows('git status'), true);
    assert.equal(allowlist.allows('git status --short'), true);
    assert.equal(allowlist.allows('git push'), false);
    assert.equal(allowlist.allows('npm test -- --watch'), true);
    assert.equal(allowlist.allows('npm run test'), false);
  });

  it('treats a bare program as a wildcard for its arguments', () => {
    const allowlist = createCommandAllowlist(['node']);
    assert.equal(allowlist.allows('node --version'), true);
    assert.equal(allowlist.allows('nodejs --version'), false);
  });

  it('matches nothing when the allowlist is empty', () => {
    const allowlist = createCommandAllowlist([]);
    assert.equal(allowlist.allows('echo hi'), false);
  });
});

describe('workspace exec', () => {
  it('runs an allowed command in the workspace root', async () => {
    const root = await makeRoot();
    try {
      const exec = new WorkspaceExec({ cwd: root.dir, allowedCommands: ['node'], timeoutMs: 5000 });
      const result = await exec.run('node -e "console.log(process.cwd())"');
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout.trim(), await realpath(root.dir));
      assert.equal(result.timedOut, false);
      assert.equal(result.truncated.stdout, false);
    } finally {
      await root.cleanup();
    }
  });

  it('is disabled when no commands are whitelisted', async () => {
    const root = await makeRoot();
    try {
      const exec = new WorkspaceExec({ cwd: root.dir, allowedCommands: [], timeoutMs: 1000 });
      assert.equal(exec.enabled, false);
      const error = await codeOf(exec.run('echo hi'));
      assert.equal(error.code, ErrorCode.FORBIDDEN);
      assert.equal(error.details?.reason, 'exec_disabled');
    } finally {
      await root.cleanup();
    }
  });

  it('rejects commands outside the allowlist', async () => {
    const root = await makeRoot();
    try {
      const exec = new WorkspaceExec({ cwd: root.dir, allowedCommands: ['echo'], timeoutMs: 1000 });
      const error = await codeOf(exec.run('rm -rf /tmp/nope'));
      assert.equal(error.code, ErrorCode.FORBIDDEN);
      assert.equal(error.details?.reason, 'command_not_allowed');
    } finally {
      await root.cleanup();
    }
  });

  it('truncates oversized stdout and stderr', async () => {
    const root = await makeRoot();
    try {
      const exec = new WorkspaceExec({ cwd: root.dir, allowedCommands: ['node'], timeoutMs: 5000, maxOutputBytes: 64 });
      const result = await exec.run('node -e "process.stdout.write(\'x\'.repeat(1000)); process.stderr.write(\'y\'.repeat(1000))"');
      assert.equal(result.stdout.length, 64);
      assert.equal(result.stderr.length, 64);
      assert.deepEqual(result.truncated, { stdout: true, stderr: true });
    } finally {
      await root.cleanup();
    }
  });

  it('kills a command that exceeds the timeout', async () => {
    const root = await makeRoot();
    try {
      const exec = new WorkspaceExec({ cwd: root.dir, allowedCommands: ['node'], timeoutMs: 150, maxOutputBytes: 1024 });
      const result = await exec.run('node -e "setTimeout(() => {}, 5000)"');
      assert.equal(result.timedOut, true);
      assert.equal(result.exitCode, null);
      assert.ok(result.signal === 'SIGTERM' || result.signal === 'SIGKILL');
      assert.ok(result.durationMs >= 100);
    } finally {
      await root.cleanup();
    }
  });

  it('does not leak the MCP token into the child environment', async () => {
    const root = await makeRoot();
    const previous = process.env.AGENT_WORKFLOW_MCP_TOKEN;
    process.env.AGENT_WORKFLOW_MCP_TOKEN = 'super-secret-token';
    try {
      const exec = new WorkspaceExec({ cwd: root.dir, allowedCommands: ['node'], timeoutMs: 5000 });
      const result = await exec.run('node -e "console.log(process.env.AGENT_WORKFLOW_MCP_TOKEN ?? \'missing\')"');
      assert.equal(result.stdout.trim(), 'missing');
    } finally {
      if (previous === undefined) delete process.env.AGENT_WORKFLOW_MCP_TOKEN;
      else process.env.AGENT_WORKFLOW_MCP_TOKEN = previous;
      await root.cleanup();
    }
  });

  it('reports missing cwd and missing binaries', async () => {
    const root = await makeRoot();
    try {
      assert.equal((await codeOf(new WorkspaceExec({ cwd: join(root.dir, 'missing'), allowedCommands: ['echo'] }).run('echo hi'))).code, ErrorCode.WORKSPACE_NOT_READY);
      const missingBinary = await codeOf(new WorkspaceExec({ cwd: root.dir, allowedCommands: ['definitely-not-a-command-aw'] }).run('definitely-not-a-command-aw'));
      assert.equal(missingBinary.code, ErrorCode.VALIDATION_FAILED);
    } finally {
      await root.cleanup();
    }
  });
});
