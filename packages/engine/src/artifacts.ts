import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { AppError, ErrorCode, createId, type ArtifactRef, type ArtifactSubmission } from '@agent-workflow/shared';

const MAX_BYTES = 8 * 1024 * 1024;
const MIME: Readonly<Record<string, string>> = { '.md': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json', '.csv': 'text/csv', '.log': 'text/plain', '.ts': 'text/plain', '.tsx': 'text/plain', '.js': 'text/plain', '.py': 'text/plain', '.java': 'text/plain', '.sql': 'text/plain', '.html': 'text/plain', '.svg': 'text/plain', '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.zip': 'application/zip', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
function fail(message: string): never { throw new AppError(ErrorCode.READ_FAILED, message); }
function readBounded(fd: number): Buffer {
  const out = Buffer.alloc(MAX_BYTES + 1);
  let length = 0;
  for (;;) {
    const count = readSync(fd, out, length, out.length - length, null);
    length += count;
    if (length > MAX_BYTES) fail('产物超过8 MiB');
    if (count === 0) return out.subarray(0, length);
  }
}
function digest(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }

/** Snapshot regular workspace files, never links, into immutable server-owned blobs. */
export function captureArtifacts(dataDir: string, workspaceRoot: string, attemptId: string, input: readonly ArtifactSubmission[], allowed: (path: string) => boolean): readonly ArtifactRef[] {
  if (!Array.isArray(input) || input.length > 32) throw new AppError(ErrorCode.VALIDATION_FAILED, '一次最多提交32个产物');
  const root = realpathSync(workspaceRoot);
  const prepared = input.map((item) => {
    if (item === null || typeof item !== 'object' || typeof item.path !== 'string' || !item.path || isAbsolute(item.path) || item.path.includes('\\') || item.path.split('/').some((p: string) => p === '..' || p === '.git' || p === '.env')) fail('产物必须是工作区内允许读取的相对文件路径');
    const path = resolve(root, item.path);
    const rel = relative(root, path);
    if (!rel || rel.startsWith(`..${sep}`) || isAbsolute(rel) || !allowed(rel)) fail('职业未获准读取这个产物');
    let cursor = root;
    for (const part of rel.split(sep)) {
      cursor = join(cursor, part);
      if (lstatSync(cursor).isSymbolicLink()) fail('产物路径不能经过符号链接');
    }
    const actual = realpathSync(path);
    if (!actual.startsWith(`${root}${sep}`)) fail('产物超出工作区');
    const fd = openSync(actual, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let bytes: Buffer;
    try {
      const before = fstatSync(fd);
      if (!before.isFile() || before.size > MAX_BYTES) fail('仅支持不超过8 MiB的普通文件产物');
      bytes = readBounded(fd);
      const after = fstatSync(fd);
      if (bytes.length > MAX_BYTES || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) fail('文件正在变化，请完成写入后再提交');
    } finally { closeSync(fd); }
    const ref: ArtifactRef = { id: createId('art'), revision: createId('rev'), sha256: digest(bytes), mediaType: MIME[extname(path).toLowerCase()] ?? 'application/octet-stream', name: basename(path), sizeBytes: bytes.length, sourceAttemptId: attemptId };
    return { ref, bytes };
  });
  const dir = join(dataDir, 'artifacts');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const { ref, bytes } of prepared) writeFileSync(join(dir, `${ref.id}.blob`), bytes, { flag: 'wx', mode: 0o600 });
  return prepared.map(({ ref }) => ref);
}

export function readArtifactBytes(dataDir: string, ref: ArtifactRef): Buffer {
  if (!/^art_[A-Za-z0-9_-]+$/.test(ref.id)) fail('产物标识无效');
  let bytes: Buffer;
  try {
    const fd = openSync(join(dataDir, 'artifacts', `${ref.id}.blob`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_BYTES) fail('产物文件不可读取');
      bytes = readBounded(fd);
    } finally { closeSync(fd); }
  } catch { fail('产物文件已缺失或不可读取'); }
  if (bytes.length !== ref.sizeBytes || digest(bytes) !== ref.sha256) fail('产物内容校验失败，请重新读取产物信息');
  return bytes;
}
