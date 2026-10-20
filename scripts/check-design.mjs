#!/usr/bin/env node
/**
 * Design-system guard (GLB-11): makes the contract documented in
 * docs/design-system.md actually verifiable.
 *
 * 1. `apps/web/src/styles/ds.css` must stay byte-identical to the read-only
 *    design authority `opencode-workflow-design-showcase/originals/main/assets/ds.css`.
 * 2. `packages/shared/src/config/themes.ts` must equal the generator output for
 *    the current design `skins.css` / `ds.css` (no silent token drift).
 *
 * Usage: npm run check:design  (also part of `npm run verify`)
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderThemeConfig } from './generate-theme-config.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const designDs = resolve(root, 'opencode-workflow-design-showcase/originals/main/assets/ds.css');
const productDs = resolve(root, 'apps/web/src/styles/ds.css');
const themesTs = resolve(root, 'packages/shared/src/config/themes.ts');

const failures = [];

const designCss = readFileSync(designDs);
const productCss = readFileSync(productDs);
if (!designCss.equals(productCss)) {
  failures.push(
    `ds.css 与设计稿不一致：${productDs} 必须逐字节复制 ${designDs}（禁止手工修改产品侧 ds.css）。`,
  );
}

const { output, tokenNames, baseNames } = renderThemeConfig();
const currentThemes = readFileSync(themesTs, 'utf8');
if (currentThemes !== output) {
  failures.push(
    `themes.ts 与设计稿生成结果不一致：请运行 \`node scripts/generate-theme-config.mjs\` 重新生成 ${themesTs}。`,
  );
}

if (failures.length > 0) {
  console.error('check:design 失败：');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `check:design OK · ds.css 与设计稿逐字节一致（${String(designCss.length)} 字节）；` +
    `themes.ts 与生成器输出一致（${String(tokenNames.length)} 个主题令牌 × 4 主题，${String(baseNames.length)} 个基础令牌）。`,
);
