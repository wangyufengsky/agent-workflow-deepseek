#!/usr/bin/env node
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, '.build/desktop');
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: {
    main: resolve(root, 'apps/desktop/src/main.ts'),
  },
  outdir: outDir,
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  external: ['electron'],
  outExtension: { '.js': '.mjs' },
  logLevel: 'info',
});
// Sandboxed Electron preload uses its restricted CommonJS loader, not ESM.
// Keep source ESM; emit the host-compatible bridge without disabling sandboxing.
await build({
  entryPoints: [resolve(root, 'apps/desktop/src/preload.ts')],
  outfile: resolve(outDir, 'preload.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  sourcemap: true,
  external: ['electron'],
  logLevel: 'info',
});
console.log(`[build-desktop] wrote ${outDir}`);
