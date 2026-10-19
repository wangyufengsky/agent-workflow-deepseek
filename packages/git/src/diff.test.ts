import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildFileChanges, looksBinary, parseNumstat, parseRawDiff, parseUnifiedDiff, sliceTextLines, sizeClassFor } from './diff.ts';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

describe('raw diff parsing', () => {
  it('parses modify/add/rename records with NUL separators', () => {
    const stdout = [
      `:100644 100644 ${A} ${B} M`,
      'src/a.ts',
      ':000000 100644 0000000000000000000000000000000000000000 ' + B + ' A',
      'new.ts',
      ':100644 100644 ' + A + ' ' + B + ' R100',
      'old.ts',
      'renamed.ts',
      '',
    ].join('\0');
    const entries = parseRawDiff(stdout);
    assert.equal(entries.length, 3);
    assert.deepEqual(
      entries.map((entry) => entry.status),
      ['M', 'A', 'R'],
    );
    assert.equal(entries[1]?.path, 'new.ts');
    assert.equal(entries[2]?.path, 'renamed.ts');
    assert.equal(entries[2]?.oldPath, 'old.ts');
  });

  it('parses numstat including binary and rename records', () => {
    const stdout = ['1\t2\tsrc/a.ts', '-\t-\tbin.dat', '3\t0\t', 'old.ts', 'new.ts', ''].join('\0');
    const stats = parseNumstat(stdout);
    assert.deepEqual(stats.get('src/a.ts'), { additions: 1, deletions: 2, binary: false });
    assert.deepEqual(stats.get('bin.dat'), { additions: null, deletions: null, binary: true });
    assert.deepEqual(stats.get('new.ts'), { additions: 3, deletions: 0, binary: false });
  });
});

describe('FileChange mapping', () => {
  it('marks binary files with null additions/deletions and stable ids', () => {
    const entries = parseRawDiff([
      `:100644 100644 ${A} ${B} M`,
      'src/a.ts',
      ':000000 100644 0000000000000000000000000000000000000000 ' + B + ' A',
      'bin.dat',
      '',
    ].join('\0'));
    const stats = parseNumstat(['5\t3\tsrc/a.ts', '-\t-\tbin.dat', ''].join('\0'));
    const files = buildFileChanges(entries, stats, A, B);
    assert.equal(files.length, 2);
    const text = files[0];
    assert.equal(text?.status, 'M');
    assert.equal(text?.binary, false);
    assert.equal(text?.additions, 5);
    assert.equal(text?.versionRef, `${A}..${B}`);
    assert.equal(text?.fileId, buildFileChanges(entries, stats, A, B)[0]?.fileId);
    assert.equal(typeof text?.mode?.old, 'string');
    const binary = files[1];
    assert.equal(binary?.binary, true);
    assert.equal(binary?.additions, null);
    assert.equal(binary?.deletions, null);
  });

  it('classifies large and too-large files', () => {
    assert.equal(sizeClassFor(10, 10), 'normal');
    assert.equal(sizeClassFor(300, 300), 'large');
    assert.equal(sizeClassFor(2_000, 2_000), 'too_large');
    assert.equal(sizeClassFor(null, null), 'normal');
  });
});

describe('unified diff parsing', () => {
  it('parses hunk headers, sections and add/del/context line numbers', () => {
    const raw = [
      'diff --git a/f.txt b/f.txt',
      'index 111..222 100644',
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -1,3 +1,3 @@ function demo',
      ' a',
      '-b',
      '+B',
      ' c',
      '',
    ].join('\n');
    const page = parseUnifiedDiff(raw, { fileId: 'file_x', ignoreWhitespace: false });
    assert.equal(page.hunks.length, 1);
    const hunk = page.hunks[0];
    assert.equal(hunk?.header, '@@ -1,3 +1,3 @@ function demo');
    assert.equal(hunk?.section, 'function demo');
    assert.equal(hunk?.oldStart, 1);
    assert.equal(hunk?.newStart, 1);
    assert.equal(hunk?.lines.length, 4);
    assert.deepEqual(
      hunk?.lines.map((line) => line.kind),
      ['context', 'del', 'add', 'context'],
    );
    assert.equal(hunk?.lines[0]?.oldLine, 1);
    assert.equal(hunk?.lines[0]?.newLine, 1);
    assert.equal(hunk?.lines[1]?.oldLine, 2);
    assert.equal(hunk?.lines[1]?.newLine, undefined);
    assert.equal(hunk?.lines[2]?.oldLine, undefined);
    assert.equal(hunk?.lines[2]?.newLine, 2);
    assert.equal(hunk?.lines[3]?.oldLine, 3);
    assert.equal(hunk?.lines[3]?.newLine, 3);
    assert.equal(page.truncated, undefined);
    assert.equal(page.nextCursor, undefined);
  });

  it('preserves no-newline markers at end of file', () => {
    const raw = ['@@ -1 +1 @@', '-x', '\\ No newline at end of file', '+x', '\\ No newline at end of file', ''].join('\n');
    const page = parseUnifiedDiff(raw, { fileId: 'f', ignoreWhitespace: false });
    assert.deepEqual(
      page.hunks[0]?.lines.map((line) => line.kind),
      ['del', 'no_newline', 'add', 'no_newline'],
    );
    assert.equal(page.hunks[0]?.lines[1]?.text, '');
  });

  it('paginates by line limit and resumes from the cursor', () => {
    const raw = ['@@ -1,4 +1,4 @@', ' a', ' b', '-c', '+C', ' d', ''].join('\n');
    const first = parseUnifiedDiff(raw, { fileId: 'f', ignoreWhitespace: false, maxLines: 2 });
    assert.equal(first.hunks[0]?.lines.length, 2);
    assert.equal(first.truncated?.reason, 'LINE_LIMIT');
    assert.equal(first.truncated?.shownLines, 2);
    assert.ok(first.nextCursor !== undefined);
    const second = parseUnifiedDiff(raw, { fileId: 'f', ignoreWhitespace: false, maxLines: 10, cursor: first.nextCursor });
    assert.deepEqual(
      second.hunks[0]?.lines.map((line) => line.kind),
      ['del', 'add', 'context'],
    );
    assert.equal(second.truncated, undefined);
  });

  it('drops an incomplete trailing hunk when the raw diff was byte-truncated', () => {
    const complete = ['@@ -1,1 +1,1 @@', '-a', '+A', ''].join('\n');
    const truncated = ['@@ -10,3 +10,3 @@', '-x', '+X', ''].join('\n');
    const page = parseUnifiedDiff(complete + truncated, { fileId: 'f', ignoreWhitespace: true, byteTruncated: true });
    assert.equal(page.hunks.length, 1);
    assert.equal(page.truncated?.reason, 'BYTE_LIMIT');
  });
});

describe('text slicing', () => {
  const buffer = Buffer.from('one\ntwo\nthree\n');

  it('slices inclusive 1-based line ranges', () => {
    const result = sliceTextLines(buffer, { start: 2, end: 3 });
    assert.equal(result.binary, false);
    assert.equal(result.totalLines, 3);
    assert.deepEqual(
      result.lines.map((line) => line.text),
      ['two', 'three'],
    );
    assert.equal(result.content, 'two\nthree');
  });

  it('detects binary content via NUL bytes', () => {
    assert.equal(looksBinary(Buffer.from([1, 2, 0, 4])), true);
    assert.equal(looksBinary(Buffer.from('plain text')), false);
    const result = sliceTextLines(Buffer.from([0, 1, 2]));
    assert.equal(result.binary, true);
    assert.equal(result.lines.length, 0);
  });

  it('caps returned lines', () => {
    const result = sliceTextLines(buffer, { start: 1, end: 3 }, 1);
    assert.equal(result.lines.length, 1);
    assert.equal(result.truncated, true);
  });
});
