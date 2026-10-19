#!/usr/bin/env node
import { readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const patterns = process.argv.slice(2);
const roots = patterns.length > 0
  ? patterns.map((pattern) => resolve(root, pattern))
  : [resolve(root, 'packages'), resolve(root, 'tests')];

const files = [];
function walk(target) {
  let stat;
  try {
    stat = statSync(target);
  } catch {
    return;
  }
  if (stat.isFile()) {
    if (target.endsWith('.test.ts') || target.endsWith('.test.mjs')) files.push(target);
    return;
  }
  for (const entry of readdirSync(target)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.build') continue;
    walk(join(target, entry));
  }
}
for (const target of roots) walk(target);

if (files.length === 0) {
  console.log('[test] no test files found');
  process.exit(0);
}
files.sort();
console.log(`[test] running ${files.length} files`);
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', '--test-force-exit', ...files], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: '' },
});
process.exit(result.status ?? 1);
