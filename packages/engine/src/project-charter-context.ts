import { constants } from 'node:fs';
import { open, opendir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';

const FILES = new Set(['package.json', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'go.mod', 'Cargo.toml', 'pyproject.toml', 'requirements.txt', 'README.md', 'AGENTS.md']);
const OMIT = new Set(['node_modules', 'data', 'dist', 'build', 'target', 'vendor', 'coverage']);
const MAX_ENTRIES = 120;
const MAX_FILES = 16;
const MAX_BYTES = 128_000;

export interface CharterSourceContext {
  readonly capturedAt: string;
  readonly entries: readonly string[];
  readonly files: readonly { path: string; sha256: string; content: string }[];
  readonly limitations: readonly string[];
}

/** No project code or commands are executed. Only bounded, regular allowlisted text is supplied to the model. */
export async function captureCharterContext(rootPath: string): Promise<CharterSourceContext> {
  const root = await realpath(rootPath);
  const entries: string[] = []; const files: { path: string; sha256: string; content: string }[] = [];
  const limitations = new Set<string>(['目录仅扫描三层，最多 120 项；仅读取列出的说明、公约和构建清单，未读取源码全文。', '不读取隐藏目录、运行数据、依赖、构建产物或符号链接；未执行任何命令，测试结果和未列出的配置均未知。']);
  let bytes = 0;
  async function walk(directory: string, depth: number): Promise<void> {
    if (entries.length >= MAX_ENTRIES) { limitations.add('目录条目达到上限，结构不完整。'); return; }
    const absolute = resolve(root, directory);
    // A directory changed to a symlink during capture must not broaden the scope.
    if (await realpath(absolute) !== absolute) { limitations.add(`${directory || '.'}：目录已变化，未读取。`); return; }
    const handle = await opendir(absolute);
    const children: { name: string; directory: boolean; file: boolean }[] = [];
    for await (const entry of handle) {
      if (children.length >= MAX_ENTRIES) { limitations.add(`${directory || '.'}：目录过大，仅保留部分条目。`); break; }
      if (entry.name.startsWith('.') || OMIT.has(entry.name) || entry.isSymbolicLink()) continue;
      children.push({ name: entry.name, directory: entry.isDirectory(), file: entry.isFile() });
    }
    for (const entry of children.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entries.length >= MAX_ENTRIES) { limitations.add('目录条目达到上限，结构不完整。'); break; }
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      entries.push(`${path}${entry.directory ? '/' : ''}`);
      if (entry.file && FILES.has(basename(path))) {
        if (files.length >= MAX_FILES || bytes >= MAX_BYTES) { limitations.add('说明与清单总量达到上限，部分文件未读取。'); continue; }
        try {
          const content = await readCharterSource(root, path, Math.min(64_000, MAX_BYTES - bytes));
          bytes += Buffer.byteLength(content);
          files.push({ path, sha256: createHash('sha256').update(content).digest('hex'), content });
        } catch { limitations.add(`${path}：不可读取、非普通文件、已变化或超过大小上限。`); }
      }
      if (entry.directory && depth < 2) {
        try { await walk(path, depth + 1); } catch { limitations.add(`${path}：目录不可读取。`); }
      }
    }
  }
  await walk('', 0);
  return { capturedAt: new Date().toISOString(), entries, files, limitations: [...limitations] };
}

export async function readCharterSource(rootPath: string, path: string, maxBytes = 64_000): Promise<string> {
  const root = await realpath(rootPath); const absolute = resolve(root, path);
  const rel = relative(root, absolute);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`) || await realpath(absolute) !== absolute) throw new Error('文件不在允许的项目路径内');
  const file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > maxBytes) throw new Error('文件不是普通文件或超过大小上限');
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) { const result = await file.read(buffer, length, buffer.length - length, null); if (result.bytesRead === 0) break; length += result.bytesRead; }
    const after = await file.stat();
    if (length > maxBytes || before.size !== after.size || before.mtimeMs !== after.mtimeMs || await realpath(absolute) !== absolute) throw new Error('文件读取期间已变化');
    const content = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
    if (content.includes('\0')) throw new Error('文件不是文本');
    return content;
  } finally { await file.close(); }
}
