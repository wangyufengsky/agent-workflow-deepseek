import { readFileSync, readdirSync, statSync, type Dirent } from 'node:fs';
import { join, relative } from 'node:path';
import type { KnowledgeSearchMatch, KnowledgeSource } from '@agent-workflow/shared';

const EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.rst', '.json', '.yaml', '.yml']);
const SKIP = new Set(['node_modules', '.git', '.build', '.data', 'dist', 'release', '.tmp', 'coverage', 'test-results']);
const MAX_ENTRIES = 200;
const MAX_BYTES = 1024 * 1024;
const MAX_DEPTH = 4;

/** Read-only knowledge source inventory for a project (no content is returned). */
export function listKnowledgeSources(rootPath: string): readonly KnowledgeSource[] {
  const sources: KnowledgeSource[] = [];
  const visit = (directory: string, depth: number): void => {
    if (depth > MAX_DEPTH || sources.length >= MAX_ENTRIES) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (sources.length >= MAX_ENTRIES) return;
      if (entry.name.startsWith('.') && entry.name !== '.github') continue;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (SKIP.has(entry.name)) continue;
        visit(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const dot = entry.name.lastIndexOf('.');
      if (dot < 0 || !EXTENSIONS.has(entry.name.slice(dot).toLowerCase())) continue;
      const info = statSync(full);
      if (info.size > MAX_BYTES) continue;
      sources.push({
        path: relative(rootPath, full),
        bytes: info.size,
        modifiedAt: info.mtime.toISOString(),
      });
    }
  };
  visit(rootPath, 0);
  return sources.sort((a, b) => a.path.localeCompare(b.path));
}


/** Literal, case-insensitive search over the source inventory. Citations carry path + line. */
export function searchKnowledgeSources(rootPath: string, query: string, limit = 30): readonly KnowledgeSearchMatch[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  const matches: KnowledgeSearchMatch[] = [];
  for (const source of listKnowledgeSources(rootPath)) {
    if (matches.length >= limit) break;
    let text: string;
    try {
      text = readFileSync(join(rootPath, source.path), 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\u0000')) continue;
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length && matches.length < limit; index += 1) {
      const line = lines[index] ?? '';
      if (!line.toLowerCase().includes(needle)) continue;
      matches.push({ path: source.path, line: index + 1, text: line.trim().slice(0, 300) });
    }
  }
  return matches;
}
