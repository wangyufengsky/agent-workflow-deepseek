import { constants, closeSync, fstatSync, lstatSync, openSync, opendirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { AppError, ErrorCode, projectBindingIdentity, type EvidenceSourceCheck, type ProjectEvidenceSource, type ProjectSettings } from '@agent-workflow/shared';
const invalid = (message: string): never => { throw new AppError(ErrorCode.VALIDATION_FAILED, message); };
export function normalizeEvidenceSources(value: unknown): readonly ProjectEvidenceSource[] {
  if (!Array.isArray(value)) return invalid('执行证据来源必须为数组，最多16条');
  if (value.length > 16) return invalid('执行证据来源必须为数组，最多16条');
  const seen = new Set<string>();
  return value.map((raw) => {
    if (!raw || typeof raw !== 'object' || !['junit', 'logs'].includes(raw.kind) || typeof raw.path !== 'string') invalid('证据来源须包含junit/logs类型与路径');
    const path = raw.kind === 'junit' ? raw.path.trim().replace(/^\.\//, '') : raw.path.trim();
    if (!path || path.length > 500 || path.split('/').length > 32 || /[\0-\x1f\x7f\\]/.test(path) || path.split('/').includes('..')) invalid('证据来源路径无效');
    if (raw.kind === 'junit') {
      if (isAbsolute(path) || /[\[\]{}]/.test(path) || path.split('/').some((part: string) => ['.git', 'node_modules', '.env'].includes(part)) || !path.endsWith('.xml')) invalid('JUnit须为项目内.xml相对匹配规则，仅支持*、**、?');
    } else if (!isAbsolute(path) || /[*?\[\]{}]/.test(path) || resolve(path) === sep) invalid('日志来源须为明确的绝对目录，不支持根目录或通配符');
    const key = `${raw.kind}:${path}`; if (seen.has(key)) invalid('证据来源重复'); seen.add(key); return { kind: raw.kind, path };
  });
}
export const projectBindingHash = (settings: ProjectSettings) => createHash('sha256').update(projectBindingIdentity(settings)).digest('hex');
function segmentExpression(pattern: string): RegExp { let expression = ''; for (const char of pattern) expression += char === '*' ? '[^/]*' : char === '?' ? '[^/]' : char.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&'); return new RegExp(`^${expression}$`); }
export function matchesEvidencePath(pattern: string, path: string): boolean {
  const expected = pattern.split('/'); const actual = path.split('/');
  const memo = new Map<string, boolean>();
  const match = (p: number, a: number): boolean => { const key = `${p}:${a}`; const cached = memo.get(key); if (cached !== undefined) return cached; const result = p === expected.length ? a === actual.length : expected[p] === '**' ? match(p + 1, a) || a < actual.length && match(p, a + 1) : a < actual.length && segmentExpression(expected[p]!).test(actual[a]!) && match(p + 1, a + 1); memo.set(key, result); return result; };
  return match(0, 0);
}
/** Bounded project-only discovery. Never traverses a symlink or reads report text. */
export function evidenceReportFiles(rootPath: string, patterns: readonly string[], allowed: (path: string) => boolean = () => true): { readonly paths: readonly string[]; readonly truncated: boolean } {
  if (patterns.length > 16) invalid('JUnit来源超过16条'); normalizeEvidenceSources(patterns.map((path) => ({ kind: 'junit', path })));
  const root = realpathSync(rootPath); const found = new Set<string>(); let visited = 0; let directories = 0; let truncated = false;
  const walk = (directory: string, prefix: string, depth: number) => {
    if (depth > 8 || ++directories > 200) { truncated = true; return; }
    if (realpathSync(directory) !== directory || lstatSync(directory).isSymbolicLink()) return;
    const handle = opendirSync(directory);
    try { for (let entry = handle.readSync(); entry; entry = handle.readSync()) {
      if (++visited > 2000 || found.size >= 64) { truncated = true; break; }
      if (entry.name.startsWith('.') || ['node_modules', 'vendor', 'target-cache'].includes(entry.name) || entry.isSymbolicLink()) continue;
      const path = prefix + entry.name; const absolute = join(directory, entry.name);
      if (realpathSync(absolute) !== absolute || lstatSync(absolute).isSymbolicLink()) continue;
      if (entry.isDirectory()) { const segments = path.split('/'); const possible = patterns.some((pattern) => { const parts = pattern.split('/'); const memo = new Map<string, boolean>(); const matchPrefix = (p: number, a: number): boolean => { const key = `${p}:${a}`; const cached = memo.get(key); if (cached !== undefined) return cached; const result = a === segments.length ? p < parts.length : p === parts.length ? false : parts[p] === '**' ? matchPrefix(p + 1, a) || matchPrefix(p, a + 1) : segmentExpression(parts[p]!).test(segments[a]!) && matchPrefix(p + 1, a + 1); memo.set(key, result); return result; }; return matchPrefix(0, 0); }); if (possible) walk(absolute, `${path}/`, depth + 1); }
      else if (entry.isFile() && allowed(path) && patterns.some((pattern) => matchesEvidencePath(pattern, path))) found.add(path);
      if (truncated) break;
    } } finally { handle.closeSync(); }
  };
  walk(root, '', 0); return { paths: [...found].sort(), truncated };
}
export function inspectEvidenceSource(rootPath: string, source: ProjectEvidenceSource): EvidenceSourceCheck {
  try {
    if (source.kind === 'logs') {
      if (lstatSync(source.path).isSymbolicLink() || !lstatSync(source.path).isDirectory()) throw new Error('日志来源不是可读取的普通目录');
      const directory = opendirSync(realpathSync(source.path)); directory.closeSync();
      return { source, state: 'readable', reason: '已确认明确保存的目录可打开；未扫描日志、未读取正文、未发送给模型' };
    }
    const result = evidenceReportFiles(rootPath, [source.path]);
    for (const path of result.paths) {
      const absolute = join(realpathSync(rootPath), path); const before = lstatSync(absolute); const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { const actual = fstatSync(fd); if (!actual.isFile() || before.dev !== actual.dev || before.ino !== actual.ino || realpathSync(absolute) !== absolute) throw new Error('报告路径发生变化'); } finally { closeSync(fd); }
    }
    return { source, state: result.paths.length && !result.truncated ? 'readable' : 'empty', matchedFiles: result.paths.length, truncated: result.truncated, ...(result.truncated ? { reason: '匹配达到有界扫描上限，未判全部来源可读' } : result.paths.length ? {} : { reason: '没有匹配的项目内JUnit报告；没有推断测试通过' }) };
  } catch { return { source, state: 'unavailable', reason: '来源不存在、不可读或不是安全的普通文件/目录' }; }
}
