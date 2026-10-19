#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const children = [];

function run(name, command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) console.error(`[${name}] exited with ${code}`);
    for (const other of children) if (other !== child && other.exitCode === null) other.kill('SIGTERM');
    if (name !== 'build-mcp') process.exit(code ?? 0);
  });
  children.push(child);
  return child;
}

const build = run('build-mcp', process.execPath, ['scripts/build-mcp.mjs']);
build.on('exit', (code) => {
  if (code !== 0) {
    console.error('[dev] MCP build failed — planning/execution tools will be unavailable until it compiles');
  }
  run('server', process.execPath, ['--import', 'tsx', '--watch', 'packages/server/src/main.ts'], {
    AGENT_WORKFLOW_ROOT: root,
    AGENT_WORKFLOW_PORT: process.env.AGENT_WORKFLOW_PORT ?? '5177',
  });
  run('web', process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev', '--workspace', '@agent-workflow/web']);
});

const shutdown = () => {
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
