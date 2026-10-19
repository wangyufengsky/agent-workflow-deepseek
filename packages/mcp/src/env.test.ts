import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_EXEC_TIMEOUT_MS,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_REQUEST_TIMEOUT_MS,
  parseAllowedCommands,
  parseFlag,
  readMcpRuntimeConfig,
} from './env.ts';

describe('MCP environment', () => {
  it('parses flags conservatively', () => {
    for (const raw of ['1', 'true', 'TRUE', 'yes', 'on']) assert.equal(parseFlag(raw), true, raw);
    for (const raw of [undefined, '', '0', 'false', 'no', 'off', '2']) assert.equal(parseFlag(raw), false, String(raw));
  });

  it('parses JSON array command allowlists', () => {
    assert.deepEqual(parseAllowedCommands('["git status","npm test"]'), ['git status', 'npm test']);
    assert.deepEqual(parseAllowedCommands(' ["git", "git", "node"] '), ['git', 'node']);
  });

  it('parses comma-separated command allowlists and falls back on broken JSON', () => {
    assert.deepEqual(parseAllowedCommands('git status, npm test'), ['git status', 'npm test']);
    assert.deepEqual(parseAllowedCommands('["git", broken'), ['["git"', 'broken']);
    assert.deepEqual(parseAllowedCommands(''), []);
    assert.deepEqual(parseAllowedCommands(undefined), []);
  });

  it('reads defaults when env is empty', () => {
    const config = readMcpRuntimeConfig({});
    assert.equal(config.internalUrl, '');
    assert.equal(config.token, '');
    assert.equal(config.worktreeRoot, '');
    assert.equal(config.allowWrite, false);
    assert.deepEqual(config.allowedCommands, []);
    assert.equal(config.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);
    assert.equal(config.execTimeoutMs, DEFAULT_EXEC_TIMEOUT_MS);
    assert.equal(config.maxFileBytes, DEFAULT_MAX_FILE_BYTES);
    assert.equal(config.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES);
  });

  it('reads and normalises explicit env configuration', () => {
    const config = readMcpRuntimeConfig({
      AGENT_WORKFLOW_INTERNAL_URL: 'http://127.0.0.1:5177/',
      AGENT_WORKFLOW_MCP_TOKEN: 'tok',
      AGENT_WORKFLOW_WORKTREE: '/tmp/worktree',
      AGENT_WORKFLOW_ALLOW_WRITE: '1',
      AGENT_WORKFLOW_ALLOWED_COMMANDS: '["git"]',
      AGENT_WORKFLOW_MCP_REQUEST_TIMEOUT_MS: '1234',
      AGENT_WORKFLOW_MCP_EXEC_TIMEOUT_MS: 'not-a-number',
      AGENT_WORKFLOW_MCP_MAX_OUTPUT_BYTES: '0',
    });
    assert.equal(config.internalUrl, 'http://127.0.0.1:5177');
    assert.equal(config.token, 'tok');
    assert.equal(config.worktreeRoot, '/tmp/worktree');
    assert.equal(config.allowWrite, true);
    assert.deepEqual(config.allowedCommands, ['git']);
    assert.equal(config.requestTimeoutMs, 1234);
    assert.equal(config.execTimeoutMs, DEFAULT_EXEC_TIMEOUT_MS);
    assert.equal(config.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES);
  });
});
