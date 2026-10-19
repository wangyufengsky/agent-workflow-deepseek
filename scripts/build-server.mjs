#!/usr/bin/env node
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, '.build/server/main.mjs');
mkdirSync(dirname(out), { recursive: true });

await build({
  entryPoints: [resolve(root, 'packages/server/src/main.ts')],
  outfile: out,
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  packages: 'bundle',
  external: ['fastify', 'mysql2', 'electron', 'pino', 'pino-pretty'],
  logLevel: 'info',
});
console.log(`[build-server] wrote ${out}`);
