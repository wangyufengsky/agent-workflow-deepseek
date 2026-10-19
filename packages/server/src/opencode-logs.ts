import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/ghp_[A-Za-z0-9]+/g, 'ghp_***'],
  [/github_pat_[A-Za-z0-9_]+/g, 'github_pat_***'],
  [/glpat-[A-Za-z0-9_-]+/g, 'glpat-***'],
  [/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***'],
  [/(authorization["']?\s*[:=]\s*["']?)(bearer\s+)?[A-Za-z0-9._~+/-]+=*/gi, '$1$2***'],
  [/(OPENCODE_SERVER_PASSWORD=)[^\s"']+/g, '$1***'],
  [/(PRIVATE-TOKEN["']?\s*[:=]\s*["']?)[A-Za-z0-9_-]+/gi, '$1***'],
];

/** Tail of the managed OpenCode log with credential-shaped strings redacted. */
export function readOpenCodeLogTail(dataDir: string, lines = 100): { path: string; lines: readonly string[]; truncated: boolean } {
  const path = join(dataDir, 'logs', 'opencode.log');
  if (!existsSync(path)) return { path, lines: [], truncated: false };
  const limit = Math.min(Math.max(lines, 1), 500);
  const content = readFileSync(path, 'utf8');
  const all = content.split(/\r?\n/).filter((line) => line !== '');
  const tail = all.slice(-limit).map(redact);
  return { path, lines: tail, truncated: all.length > limit };
}

function redact(line: string): string {
  let value = line;
  for (const [pattern, replacement] of SECRET_PATTERNS) value = value.replace(pattern, replacement);
  return value.slice(0, 2_000);
}
