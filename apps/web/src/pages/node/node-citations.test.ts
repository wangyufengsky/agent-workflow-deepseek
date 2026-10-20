import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OutputFragment } from '@agent-workflow/shared';
import { citationVisual, hasStructuredCitations, hasUnclosedFence, linkifyCitations, readCitations } from './node-citations.ts';

const base: OutputFragment = { fragmentId: 'f1', seq: 1, category: 'model_text', text: '' };

test('citations are only read from structured data, malformed entries are dropped', () => {
  const withCitations = {
    ...base,
    citations: [
      { index: 2, kind: 'source', label: '退款规则', section: '第 3 节', revision: 'r3' },
      { index: 1, kind: 'code', label: 'amount.ts', path: 'src/amount.ts', lines: { from: 42, to: 48 }, revision: 'r3' },
      { index: 0, kind: 'summary', label: '坏条目' },
      { index: 4, kind: 'mystery', label: '未知类型' },
    ],
  } as OutputFragment;
  const citations = readCitations(withCitations);
  assert.equal(citations.length, 3);
  assert.equal(citations[0]?.index, 1);
  assert.equal(citations[2]?.kind, 'summary');
  assert.equal(hasStructuredCitations(base), false);
  assert.equal(readCitations(base).length, 0);
});

test('[n] is linked only for structured indices and never inside code', () => {
  const citations = readCitations({ ...base, citations: [{ index: 1, kind: 'code', label: 'a', lines: { from: 1, to: 2 } }] } as OutputFragment);
  const linked = linkifyCitations('见 [1] 与 [2]。\n```\n[1]\n```\n`[1]`', citations);
  assert.match(linked, /见 \[1\]\(#node-cite-1\) 与 \[2\]。/);
  assert.match(linked, /```\n\[1\]\n```/);
  assert.match(linked, /`\[1\]`/);
});

test('unclosed fences are detected for the streaming marker', () => {
  assert.equal(hasUnclosedFence('```ts\nconst a = 1;'), true);
  assert.equal(hasUnclosedFence('```ts\nconst a = 1;\n```'), false);
  assert.equal(hasUnclosedFence('plain text'), false);
});

test('citation locators follow the design wording and never fake line numbers', () => {
  assert.match(citationVisual({ index: 1, kind: 'code', label: 'a', lines: { from: 42, to: 48 }, revision: 'r3', latestRevision: 'r5' }).locator, /第 42–48 行 · 来源版本 r3（此文件已有更新版本 r5，引用仍指向 r3）/);
  assert.match(citationVisual({ index: 2, kind: 'excerpt', label: 'b', lines: { from: 40, to: 60 } }).locator, /仅提供节选（第 40–60 行附近），不是完整原文/);
  assert.match(citationVisual({ index: 3, kind: 'source', label: 'c', section: '第 3 节', revision: 'r3' }).locator, /引用定位：第 3 节 · 来源版本 r3/);
  assert.match(citationVisual({ index: 4, kind: 'summary', label: 'd' }).locator, /摘要 · 无原文定位/);
});
