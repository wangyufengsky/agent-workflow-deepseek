import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMcpRuntime } from './runtime.ts';

test('toolsets filter the managed MCP registry by prefix', () => {
  const runtime = buildMcpRuntime({
    AGENT_WORKFLOW_INTERNAL_URL: 'http://127.0.0.1:1',
    AGENT_WORKFLOW_MCP_TOKEN: 'test-token',
    AGENT_WORKFLOW_TOOLSETS: 'git',
  });
  const names = runtime.registry.list().map((tool) => tool.name);
  assert.ok(names.length > 0);
  assert.equal(names.every((name) => name.startsWith('git.')), true);
  assert.ok(names.includes('git.repo.status'));
  const all = buildMcpRuntime({ AGENT_WORKFLOW_INTERNAL_URL: 'http://127.0.0.1:1', AGENT_WORKFLOW_MCP_TOKEN: 'test-token' });
  assert.ok(all.registry.size > runtime.registry.size);
});
