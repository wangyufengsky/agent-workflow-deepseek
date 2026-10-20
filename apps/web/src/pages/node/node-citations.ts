import type { OutputFragment } from '@agent-workflow/shared';
import type { IconName } from '../../components/Icon.tsx';

/**
 * Structured citations (design N16). The current `OutputFragment` read model does
 * not send them yet — this module keeps the reader/`[1]` entry ready and honest:
 * text is only linked when the service actually sent a matching structured entry
 * (`API-REQUIREMENTS.md` §2.10: `[1]` may only come from structured citations).
 */
export type CitationKind = 'source' | 'code' | 'excerpt' | 'summary';

export interface NodeCitation {
  readonly index: number;
  readonly kind: CitationKind;
  readonly label: string;
  readonly path?: string;
  readonly section?: string;
  readonly lines?: { readonly from: number; readonly to: number };
  readonly revision?: string;
  readonly latestRevision?: string;
  readonly quote?: string;
  readonly content?: string;
}

const CITATION_KINDS: readonly CitationKind[] = ['source', 'code', 'excerpt', 'summary'];

function readKind(value: unknown): CitationKind {
  return typeof value === 'string' && (CITATION_KINDS as readonly string[]).includes(value) ? (value as CitationKind) : 'summary';
}

function readLines(value: unknown): { readonly from: number; readonly to: number } | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const from = (value as { from?: unknown }).from;
  const to = (value as { to?: unknown }).to;
  if (typeof from !== 'number' || typeof to !== 'number' || !Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) return undefined;
  return { from, to };
}

/** Defensive read: only well-formed entries survive; unknown shapes are dropped. */
export function readCitations(fragment: OutputFragment): readonly NodeCitation[] {
  const raw = (fragment as OutputFragment & { readonly citations?: unknown }).citations;
  if (!Array.isArray(raw)) return [];
  const result: NodeCitation[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const index = record.index;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 1) continue;
    const label = typeof record.label === 'string' && record.label.length > 0 ? record.label : `结构引用 ${String(index)}`;
    result.push({
      index,
      kind: readKind(record.kind),
      label,
      ...(typeof record.path === 'string' ? { path: record.path } : {}),
      ...(typeof record.section === 'string' ? { section: record.section } : {}),
      ...(() => {
        const lines = readLines(record.lines);
        return lines === undefined ? {} : { lines };
      })(),
      ...(typeof record.revision === 'string' ? { revision: record.revision } : {}),
      ...(typeof record.latestRevision === 'string' ? { latestRevision: record.latestRevision } : {}),
      ...(typeof record.quote === 'string' ? { quote: record.quote } : {}),
      ...(typeof record.content === 'string' ? { content: record.content } : {}),
    });
  }
  return result.sort((left, right) => left.index - right.index);
}

/** True when `[n]` in the body corresponds to a structured citation entry. */
export function hasStructuredCitations(fragment: OutputFragment): boolean {
  return readCitations(fragment).length > 0;
}

/**
 * Turn `[1]` into `[1](#node-cite-1)` — only for indices the service really sent,
 * and never inside fenced code blocks or inline code spans.
 */
export function linkifyCitations(markdown: string, citations: readonly NodeCitation[]): string {
  if (citations.length === 0) return markdown;
  const known = new Set(citations.map((citation) => citation.index));
  const lines = markdown.split('\n');
  let fence = false;
  return lines
    .map((line) => {
      if (/^\s*```/.test(line)) {
        fence = !fence;
        return line;
      }
      if (fence) return line;
      return line
        .split('`')
        .map((segment, index) => {
          if (index % 2 === 1) return segment;
          return segment.replace(/\[(\d+)\]/g, (match, digits: string) => {
            const number = Number(digits);
            return known.has(number) ? `[${String(number)}](#node-cite-${String(number)})` : match;
          });
        })
        .join('`');
    })
    .join('\n');
}

/** Unclosed code fence: the design marks it as still streaming. */
export function hasUnclosedFence(text: string): boolean {
  let open = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) open = !open;
  }
  return open;
}

export interface CitationVisual {
  readonly locator: string;
  readonly tone: 'accent' | 'unknown';
  readonly icon: IconName;
}

/** Design `readerMain` cite locator rows. */
export function citationVisual(citation: NodeCitation): CitationVisual {
  const revision = citation.revision === undefined ? '' : ` · 来源版本 ${citation.revision}`;
  const newer =
    citation.latestRevision !== undefined && citation.latestRevision !== citation.revision
      ? `（此文件已有更新版本 ${citation.latestRevision}，引用仍指向 ${citation.revision ?? '引用版本'}）`
      : '';
  if (citation.kind === 'code' && citation.lines !== undefined) {
    return { locator: `引用定位：第 ${String(citation.lines.from)}–${String(citation.lines.to)} 行${revision}${newer}`, tone: 'accent', icon: 'target' };
  }
  if (citation.kind === 'excerpt') {
    const range = citation.lines === undefined ? '' : `（第 ${String(citation.lines.from)}–${String(citation.lines.to)} 行附近）`;
    return { locator: `仅提供节选${range}，不是完整原文`, tone: 'unknown', icon: 'info' };
  }
  if (citation.kind === 'source') {
    return { locator: `引用定位：${citation.section ?? '原文段落'}${revision}`, tone: 'accent', icon: 'target' };
  }
  return { locator: '摘要 · 无原文定位', tone: 'unknown', icon: 'help' };
}
