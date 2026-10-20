import type { DiffLine } from '@agent-workflow/shared';

/**
 * 成对改动的行内高亮（审计 GIT-02）。
 *
 * 在同一个删除块 / 新增块里按行配对，取公共前后缀，把中间真正变化的字符
 * 标出来。只对成对且长度可控的行计算；完全不同的行不做标记，避免整行噪声。
 * 返回 anchorId → 字符区间，供渲染器套 `<mark class="intra">`。
 */

export interface IntraRange {
  readonly start: number;
  readonly end: number;
}

/** 每行最长按 600 字符计算，防止超长行在渲染时反复扫描。 */
const MAX_LINE_CHARS = 600;

function commonPrefixLength(left: string, right: string, max: number): number {
  let index = 0;
  while (index < max && left[index] === right[index]) index += 1;
  return index;
}

function commonSuffixLength(left: string, right: string, max: number): number {
  let index = 0;
  while (index < max && left[left.length - 1 - index] === right[right.length - 1 - index]) index += 1;
  return index;
}

/** 计算一对删除 / 新增行的行内差异；任一侧没有变化或整行都变则返回 undefined。 */
export function pairLineRange(deleted: string, added: string): { readonly old: IntraRange; readonly new: IntraRange } | undefined {
  if (deleted.length > MAX_LINE_CHARS || added.length > MAX_LINE_CHARS) return undefined;
  const maxPrefix = Math.min(deleted.length, added.length);
  const prefix = commonPrefixLength(deleted, added, maxPrefix);
  const maxSuffix = Math.min(deleted.length, added.length) - prefix;
  const suffix = commonSuffixLength(deleted.slice(prefix), added.slice(prefix), maxSuffix);
  const oldStart = prefix;
  const oldEnd = deleted.length - suffix;
  const newStart = prefix;
  const newEnd = added.length - suffix;
  if (oldEnd <= oldStart && newEnd <= newStart) return undefined;
  // 整行都被替换（没有任何公共前后缀）时不做行内标记：整行本来就是改动。
  if (prefix === 0 && suffix === 0) return undefined;
  return {
    old: { start: oldStart, end: oldEnd },
    new: { start: newStart, end: newEnd },
  };
}

const KIND_ORDER: readonly DiffLine['kind'][] = ['del', 'add'];

/**
 * 对一组 hunk 行做行内配对：相邻的 `del` 块和紧随其后的 `add` 块按行号对齐，
 * 第 i 对删 / 增行互相比较。返回 anchorId → 需要标出的字符区间。
 */
export function buildIntraLineRanges(lines: readonly DiffLine[]): ReadonlyMap<string, IntraRange> {
  const ranges = new Map<string, IntraRange>();
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined) break;
    if (line.kind !== KIND_ORDER[0]) {
      index += 1;
      continue;
    }
    const deleted: DiffLine[] = [];
    while (lines[index]?.kind === 'del') {
      const current = lines[index];
      if (current !== undefined) deleted.push(current);
      index += 1;
    }
    const added: DiffLine[] = [];
    while (lines[index]?.kind === 'add') {
      const current = lines[index];
      if (current !== undefined) added.push(current);
      index += 1;
    }
    const pairs = Math.min(deleted.length, added.length);
    for (let offset = 0; offset < pairs; offset += 1) {
      const left = deleted[offset];
      const right = added[offset];
      if (left === undefined || right === undefined) continue;
      const pair = pairLineRange(left.text, right.text);
      if (pair === undefined) continue;
      ranges.set(left.anchorId, pair.old);
      ranges.set(right.anchorId, pair.new);
    }
  }
  return ranges;
}
