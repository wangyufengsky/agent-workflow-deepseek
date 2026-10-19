#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = (command, args, env = {}) => spawn(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });

const build = run(process.execPath, ['scripts/build-desktop.mjs']);
build.on('exit', (code) => {
  if (code !== 0) process.exit(code ?? 1);
  const electron = run(process.execPath, ['node_modules/electron/cli.js', '.build/desktop/main.mjs'], {
    AGENT_WORKFLOW_DEV_URL: process.env.AGENT_WORKFLOW_DEV_URL ?? 'http://127.0.0.1:5173',
    AGENT_WORKFLOW_ROOT: root,
  });
  electron.on('exit', (electronCode) => process.exit(electronCode ?? 0));
});
