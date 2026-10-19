import { readFileSync, readdirSync, realpathSync, statSync, type Dirent } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { KnowledgeSearchMatch, KnowledgeSource } from '@agent-workflow/shared';

const DOCUMENT_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.rst', '.json', '.yaml', '.yml']);
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.java', '.py', '.go', '.rs', '.sql', '.css', '.scss', '.html', '.vue', '.svelte', '.sh', '.kt', '.swift', '.c', '.h', '.cpp', '.cs', '.rb', '.php']);
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
      const extension = entry.name.slice(dot).toLowerCase();
      if (dot < 0 || (!DOCUMENT_EXTENSIONS.has(extension) && !CODE_EXTENSIONS.has(extension))) continue;
      const info = statSync(full);
      if (info.size > MAX_BYTES) continue;
      sources.push({
        kind: CODE_EXTENSIONS.has(extension) ? 'code' : 'document',
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
      text = readKnowledgeSource(rootPath, source.path).content;
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


const MAX_CONTENT_BYTES = 512 * 1024;

/** Read one source by its inventory-relative path; never follows symlinks outside the root. */
export function readKnowledgeSource(rootPath: string, relativePath: string): { path: string; content: string; bytes: number } {
  if (relativePath.trim() === '' || relativePath.startsWith('/') || relativePath.split('/').includes('..')) {
    throw new Error('PATH_ESCAPE');
  }
  const root = realpathSync(rootPath);
  const candidate = resolve(root, relativePath);
  const real = existsInRoot(candidate, root);
  if (real === undefined) throw new Error('PATH_ESCAPE');
  const info = statSync(real);
  if (!info.isFile() || info.size > MAX_CONTENT_BYTES) throw new Error('SOURCE_NOT_READABLE');
  const text = readFileSync(real, 'utf8');
  if (text.includes('\u0000')) throw new Error('SOURCE_NOT_TEXT');
  return { path: relativePath, content: text, bytes: info.size };
}

function existsInRoot(candidate: string, root: string): string | undefined {
  try {
    const real = realpathSync(candidate);
    if (real !== root && !real.startsWith(`${root}${sep}`)) return undefined;
    return real;
  } catch {
    return undefined;
  }
}
