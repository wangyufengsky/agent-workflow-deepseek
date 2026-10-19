#!/usr/bin/env node
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, '.build/mcp/server.mjs');
mkdirSync(dirname(out), { recursive: true });

await build({
  entryPoints: [resolve(root, 'packages/mcp/src/entry.ts')],
  outfile: out,
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'info',
});
console.log(`[build-mcp] wrote ${out}`);
