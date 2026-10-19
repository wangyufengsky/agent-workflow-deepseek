import { createHash } from 'node:crypto';
import type { ChangeStatusValue, DiffHunk, DiffLine, DiffPage, FileChange } from '@agent-workflow/shared';
import { GIT_LIMITS } from './config.ts';

/* ------------------------------------------------------------------ */
/* Raw name/status parsing (`git diff --raw -z`, `--numstat -z`)       */
/* ------------------------------------------------------------------ */

export interface RawDiffEntry {
  readonly status: ChangeStatusValue;
  readonly path: string;
  readonly oldPath?: string;
  readonly oldMode: string;
  readonly newMode: string;
  readonly oldSha: string;
  readonly newSha: string;
}

export interface NumstatEntry {
  readonly additions: number | null;
  readonly deletions: number | null;
  readonly binary: boolean;
}

const STATUS_BY_LETTER: Readonly<Record<string, ChangeStatusValue>> = {
  A: 'A',
  M: 'M',
  D: 'D',
  R: 'R',
  C: 'C',
  T: 'T',
};

/** Parse `git diff --raw -z` output. Tolerant of leading/trailing junk. */
export function parseRawDiff(stdout: string): RawDiffEntry[] {
  const chunks = stdout.split('\0');
  const entries: RawDiffEntry[] = [];
  let index = 0;
  while (index < chunks.length) {
    const chunk = chunks[index];
    index += 1;
    if (chunk === undefined || !chunk.startsWith(':')) continue;
    const fields = chunk.slice(1).split(' ');
    if (fields.length < 5) continue;
    const oldMode = fields[0] ?? '000000';
    const newMode = fields[1] ?? '000000';
    const oldSha = fields[2] ?? '';
    const newSha = fields[3] ?? '';
    const statusRaw = fields[4] ?? '';
    const letter = statusRaw.slice(0, 1);
    const status = STATUS_BY_LETTER[letter];
    if (status === undefined) continue;
    if (status === 'R' || status === 'C') {
      const first = chunks[index];
      const second = chunks[index + 1];
      if (first === undefined || second === undefined) break;
      index += 2;
      if (first.length === 0 || second.length === 0) continue;
      entries.push({ status, path: second, oldPath: first, oldMode, newMode, oldSha, newSha });
    } else {
      const path = chunks[index];
      if (path === undefined) break;
      index += 1;
      if (path.length === 0) continue;
      entries.push({ status, path, oldMode, newMode, oldSha, newSha });
    }
  }
  return entries;
}

/**
 * Parse `git diff --numstat -z` output. The map is keyed by the new path (or
 * the sole path for add/modify/delete). Rename records are encoded as
 * `a\td\t\0<old>\0<new>\0`.
 */
export function parseNumstat(stdout: string): Map<string, NumstatEntry> {
  const chunks = stdout.split('\0');
  const stats = new Map<string, NumstatEntry>();
  let index = 0;
  while (index < chunks.length) {
    const chunk = chunks[index];
    index += 1;
    if (chunk === undefined || chunk.length === 0) continue;
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(chunk);
    if (match === null) continue;
    const additionsRaw = match[1] ?? '-';
    const deletionsRaw = match[2] ?? '-';
    const binary = additionsRaw === '-' || deletionsRaw === '-';
    const additions = binary ? null : Number(additionsRaw);
    const deletions = binary ? null : Number(deletionsRaw);
    let path = match[3] ?? '';
    if (path.length === 0) {
      // Rename/copy record: the paths follow as separate NUL-delimited chunks.
      const oldPath = chunks[index];
      const newPath = chunks[index + 1];
      index += 2;
      if (oldPath === undefined || newPath === undefined || newPath.length === 0) continue;
      path = newPath;
    }
    stats.set(path, { additions, deletions, binary });
  }
  return stats;
}

/* ------------------------------------------------------------------ */
/* FileChange mapping                                                  */
/* ------------------------------------------------------------------ */

/** Stable, non-secret file id derived from the compared revisions and path. */
export function fileIdFor(baseRef: string, headRef: string, path: string): string {
  const digest = createHash('sha256').update(`${baseRef}\0${headRef}\0${path}`).digest('hex').slice(0, 16);
  return `file_${digest}`;
}

export function sizeClassFor(additions: number | null, deletions: number | null): FileChange['sizeClass'] {
  const changed = (additions ?? 0) + (deletions ?? 0);
  if (changed > GIT_LIMITS.tooLargeFileLines) return 'too_large';
  if (changed > GIT_LIMITS.largeFileLines) return 'large';
  return 'normal';
}

export function modeFor(entry: RawDiffEntry): FileChange['mode'] | undefined {
  const oldMode = entry.oldMode === '000000' ? undefined : entry.oldMode;
  const newMode = entry.newMode === '000000' ? undefined : entry.newMode;
  if (oldMode === undefined && newMode === undefined) return undefined;
  return { old: oldMode, new: newMode };
}

/**
 * Combine raw name-status entries with numstat data into shared `FileChange`
 * rows. Binary files are marked `binary: true` with null additions/deletions,
 * as required by the delivery/diff contracts.
 */
export function buildFileChanges(entries: readonly RawDiffEntry[], stats: ReadonlyMap<string, NumstatEntry>, baseRef: string, headRef: string): FileChange[] {
  return entries.map((entry) => {
    const stat = stats.get(entry.path);
    const binary = stat?.binary ?? false;
    const additions = stat === undefined ? 0 : stat.additions;
    const deletions = stat === undefined ? 0 : stat.deletions;
    const change: FileChange = {
      fileId: fileIdFor(baseRef, headRef, entry.path),
      status: entry.status,
      path: entry.path,
      oldPath: entry.oldPath,
      binary,
      additions: binary ? null : additions,
      deletions: binary ? null : deletions,
      sizeClass: sizeClassFor(additions, deletions),
      mode: modeFor(entry),
      versionRef: `${baseRef}..${headRef}`,
    };
    return change;
  });
}

/* ------------------------------------------------------------------ */
/* Unified diff parsing                                                */
/* ------------------------------------------------------------------ */

export interface UnifiedDiffParseOptions {
  readonly fileId: string;
  readonly baseSha?: string;
  readonly headSha?: string;
  readonly worktreeRevision?: string;
  readonly ignoreWhitespace: boolean;
  readonly maxLines?: number;
  /** Cursor returned by a previous call (`h<index>l<offset>`). */
  readonly cursor?: string;
  /** Set when the raw diff had to be cut because of the byte limit. */
  readonly byteTruncated?: boolean;
}

interface ParsedHunk {
  readonly hunkId: string;
  readonly header: string;
  readonly section?: string;
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: DiffLine[];
  /** False when the byte limit cut the hunk before all lines arrived. */
  readonly complete: boolean;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;
const CURSOR = /^h(\d{1,6})l(\d{1,7})$/;

export interface DiffCursor {
  readonly hunkIndex: number;
  readonly lineOffset: number;
}

export function decodeCursor(cursor: string): DiffCursor {
  const match = CURSOR.exec(cursor);
  if (match === null) return { hunkIndex: 0, lineOffset: 0 };
  return { hunkIndex: Number(match[1]), lineOffset: Number(match[2]) };
}

export function encodeCursor(hunkIndex: number, lineOffset: number): string {
  return `h${hunkIndex}l${lineOffset}`;
}

function parseHunks(fileId: string, raw: string): ParsedHunk[] {
  const lines = raw.split('\n');
  const hunks: ParsedHunk[] = [];
  let current: ParsedHunk | undefined;
  let oldRemaining = 0;
  let newRemaining = 0;

  const finish = (): void => {
    if (current === undefined) return;
    hunks.push({ ...current, complete: oldRemaining === 0 && newRemaining === 0 });
    current = undefined;
  };

  for (const rawLine of lines) {
    if (rawLine.startsWith('@@ ')) {
      finish();
      const match = HUNK_HEADER.exec(rawLine);
      if (match === null) continue;
      const oldStart = Number(match[1]);
      const oldLines = match[2] === undefined ? 1 : Number(match[2]);
      const newStart = Number(match[3]);
      const newLines = match[4] === undefined ? 1 : Number(match[4]);
      const section = (match[5] ?? '').trim();
      const hunkIndex = hunks.length;
      current = {
        hunkId: `h${hunkIndex}`,
        header: rawLine,
        section: section.length === 0 ? undefined : section,
        oldStart,
        oldLines,
        newStart,
        newLines,
        lines: [],
        complete: false,
      };
      oldRemaining = oldLines;
      newRemaining = newLines;
      continue;
    }
    if (current === undefined) continue;
    if (rawLine.startsWith('\\')) {
      current.lines.push({
        kind: 'no_newline',
        anchorId: `${fileId}:${current.hunkId}:${current.lines.length}`,
        text: '',
      });
      continue;
    }
    const marker = rawLine.slice(0, 1);
    if (marker !== ' ' && marker !== '+' && marker !== '-') {
      // `diff --git`, `index`, `---`, `+++`, binary notices end the hunk.
      if (oldRemaining <= 0 && newRemaining <= 0) finish();
      continue;
    }
    const oldLine = marker === '+' ? undefined : current.oldStart + (current.oldLines - oldRemaining);
    const newLine = marker === '-' ? undefined : current.newStart + (current.newLines - newRemaining);
    if (marker === '+') newRemaining -= 1;
    else if (marker === '-') oldRemaining -= 1;
    else {
      oldRemaining -= 1;
      newRemaining -= 1;
    }
    current.lines.push({
      kind: marker === '+' ? 'add' : marker === '-' ? 'del' : 'context',
      oldLine,
      newLine,
      anchorId: `${fileId}:${current.hunkId}:${current.lines.length}`,
      text: rawLine.slice(1),
    });
  }
  finish();
  return hunks;
}

/**
 * Parse a single-file unified diff into the shared `DiffPage` shape. Hunk line
 * offsets are preserved so the UI can render add/del gutters consistently.
 */
export function parseUnifiedDiff(raw: string, options: UnifiedDiffParseOptions): DiffPage {
  const maxLines = options.maxLines ?? GIT_LIMITS.defaultDiffMaxLines;
  const cursors = options.cursor === undefined ? { hunkIndex: 0, lineOffset: 0 } : decodeCursor(options.cursor);
  const allHunks = parseHunks(options.fileId, raw);
  const hunks: DiffHunk[] = [];
  let usedLines = 0;
  let nextCursor: string | undefined;
  let cutByLineLimit = false;

  for (let hunkIndex = cursors.hunkIndex; hunkIndex < allHunks.length; hunkIndex += 1) {
    const hunk = allHunks[hunkIndex];
    if (hunk === undefined) break;
    const lineOffset = hunkIndex === cursors.hunkIndex ? cursors.lineOffset : 0;
    if (lineOffset >= hunk.lines.length) continue;
    if (!hunk.complete && hunkIndex === allHunks.length - 1) {
      // Byte truncation: do not show a hunk whose lines are incomplete.
      break;
    }
    const available = maxLines - usedLines;
    if (available <= 0) {
      cutByLineLimit = true;
      nextCursor = encodeCursor(hunkIndex, lineOffset);
      break;
    }
    const remaining = hunk.lines.length - lineOffset;
    const take = Math.min(available, remaining);
    hunks.push({
      hunkId: hunk.hunkId,
      header: hunk.header,
      section: hunk.section,
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart,
      newLines: hunk.newLines,
      lines: hunk.lines.slice(lineOffset, lineOffset + take),
    });
    usedLines += take;
    if (take < remaining) {
      cutByLineLimit = true;
      nextCursor = encodeCursor(hunkIndex, lineOffset + take);
      break;
    }
  }

  const shownLines = usedLines;
  let truncated: DiffPage['truncated'];
  if (options.byteTruncated === true) {
    truncated = { reason: 'BYTE_LIMIT', shownLines };
  } else if (cutByLineLimit) {
    truncated = { reason: 'LINE_LIMIT', shownLines };
  }

  const page: DiffPage = {
    fileId: options.fileId,
    baseSha: options.baseSha,
    headSha: options.headSha,
    worktreeRevision: options.worktreeRevision,
    ignoreWhitespace: options.ignoreWhitespace,
    hunks,
    truncated,
    nextCursor,
  };
  return page;
}

/** True when the content looks binary (NUL byte in the probe window). */
export function looksBinary(buffer: Buffer): boolean {
  const probe = buffer.subarray(0, 8_000);
  return probe.includes(0);
}

/**
 * Split a buffer into 1-based numbered lines, applying an optional inclusive
 * line range. Returns binary when a NUL byte is present.
 */
export function sliceTextLines(
  buffer: Buffer,
  lineRange?: { readonly start: number; readonly end: number },
  maxLines: number = GIT_LIMITS.maxFileLines,
): {
  readonly binary: boolean;
  readonly totalLines: number;
  readonly start: number;
  readonly end: number;
  readonly truncated: boolean;
  readonly content: string;
  readonly lines: readonly { readonly number: number; readonly text: string }[];
} {
  if (looksBinary(buffer)) {
    return { binary: true, totalLines: 0, start: 0, end: 0, truncated: false, content: '', lines: [] };
  }
  const text = buffer.toString('utf8');
  const all = text.length === 0 ? [] : text.split('\n');
  if (all.length > 0 && all[all.length - 1] === '') all.pop();
  const totalLines = all.length;
  const requestedStart = lineRange?.start ?? 1;
  const requestedEnd = lineRange?.end ?? totalLines;
  const start = Math.max(1, Math.min(requestedStart, Math.max(totalLines, 1)));
  const end = Math.max(start - 1, Math.min(requestedEnd, totalLines));
  const selected = all.slice(start - 1, end);
  const truncated = selected.length > maxLines;
  const capped = truncated ? selected.slice(0, maxLines) : selected;
  return {
    binary: false,
    totalLines,
    start,
    end: capped.length === 0 ? 0 : start + capped.length - 1,
    truncated: truncated || (lineRange !== undefined && lineRange.end < totalLines),
    content: capped.join('\n'),
    lines: capped.map((line, index) => ({ number: start + index, text: line })),
  };
}
