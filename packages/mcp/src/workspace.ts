import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { AppError, ErrorCode } from '@agent-workflow/shared';

/**
 * Local workspace sandbox used as a fallback when the internal loopback service
 * is unavailable. The authoritative implementation lives in `packages/server`
 * (`/internal/mcp/workspace/*`); this class mirrors its response shapes:
 *
 * - `read` works on **lines** (`offset` line index, `limit` line count, 0 = all)
 * - `list` returns a flattened recursive entry list
 * - `write` returns `{path, sizeBytes, sha}`
 */
export interface WorkspaceServiceOptions {
  /** Absolute worktree root. */
  readonly root: string;
  readonly allowWrite: boolean;
  readonly maxFileBytes?: number;
  readonly maxListEntries?: number;
}

export interface FileReadOptions {
  /** Zero-based line offset. */
  readonly offset?: number;
  /** Maximum number of lines (0 = all lines). */
  readonly limit?: number;
}

export interface FileReadResult {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha: string;
  readonly totalLines: number;
  readonly offset: number;
  readonly lines: readonly string[];
  readonly truncated: boolean;
  readonly readOnly: boolean;
}

export type FileEntryKind = 'file' | 'directory';

export interface FileListEntry {
  readonly path: string;
  readonly kind: FileEntryKind;
  readonly sizeBytes?: number;
}

export interface FileListResult {
  readonly root: string;
  readonly entries: readonly FileListEntry[];
  readonly truncated: boolean;
}

export interface FileWriteResult {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha: string;
}

const DEFAULT_MAX_FILE_BYTES = 512 * 1024;
const DEFAULT_MAX_LIST_ENTRIES = 200;
const MAX_LIST_DEPTH = 4;
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', '.data']);

export class WorkspaceService {
  readonly root: string;
  readonly allowWrite: boolean;
  readonly maxFileBytes: number;
  readonly maxListEntries: number;

  constructor(options: WorkspaceServiceOptions) {
    this.root = options.root;
    this.allowWrite = options.allowWrite;
    this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    this.maxListEntries = options.maxListEntries ?? DEFAULT_MAX_LIST_ENTRIES;
  }

  get configured(): boolean {
    return this.root.trim().length > 0;
  }

  async read(relativePath: unknown, options: FileReadOptions = {}): Promise<FileReadResult> {
    const normalized = normalizeRelativePath(relativePath);
    const root = await this.#realRoot();
    const absolute = await resolveExistingPath(root, normalized);
    const info = await stat(absolute);
    if (info.isDirectory()) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `路径是目录，不能作为文件读取：${normalized}`, {
        details: { path: normalized },
      });
    }
    if (!info.isFile()) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `路径不是普通文件：${normalized}`, { details: { path: normalized } });
    }
    if (info.size > this.maxFileBytes) {
      throw new AppError(ErrorCode.TRUNCATED, `文件超过 ${this.maxFileBytes} 字节，请改用读取片段`, {
        details: { path: normalized, sizeBytes: info.size, maxFileBytes: this.maxFileBytes },
      });
    }
    const content = await readFile(absolute, 'utf8');
    if (content.includes('\u0000')) {
      throw new AppError(ErrorCode.BINARY_FILE, `文件是二进制，不能按文本读取：${normalized}`, { details: { path: normalized } });
    }
    const offset = normalizeOffset(options.offset);
    const limit = normalizeLineLimit(options.limit);
    const allLines = content.split('\n');
    const selected = limit > 0 ? allLines.slice(offset, offset + limit) : allLines.slice(offset);
    const truncated = limit > 0 && offset + limit < allLines.length;
    return {
      path: normalized,
      sizeBytes: info.size,
      sha: sha256(content),
      totalLines: allLines.length,
      offset,
      lines: selected,
      truncated,
      readOnly: !this.allowWrite,
    };
  }

  async list(relativePath: unknown = '.'): Promise<FileListResult> {
    const normalized = normalizeRelativePath(relativePath);
    const root = await this.#realRoot();
    const absolute = await resolveExistingPath(root, normalized);
    const info = await stat(absolute);
    if (!info.isDirectory()) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `路径不是目录：${normalized}`, { details: { path: normalized } });
    }
    const entries: FileListEntry[] = [];
    let truncated = false;
    const walk = async (directory: string, depth: number): Promise<void> => {
      if (entries.length >= this.maxListEntries) {
        truncated = true;
        return;
      }
      if (depth > MAX_LIST_DEPTH) return;
      const dirents = await readdir(directory, { withFileTypes: true });
      dirents.sort((a, b) => a.name.localeCompare(b.name));
      for (const dirent of dirents) {
        if (entries.length >= this.maxListEntries) {
          truncated = true;
          return;
        }
        if (SKIPPED_DIRECTORIES.has(dirent.name)) continue;
        const child = join(directory, dirent.name);
        const rel = relative(root, child).split(sep).join('/');
        if (dirent.isDirectory()) {
          entries.push({ path: rel, kind: 'directory' });
          await walk(child, depth + 1);
        } else if (dirent.isFile()) {
          const childInfo = await lstat(child);
          entries.push({ path: rel, kind: 'file', sizeBytes: childInfo.size });
        }
      }
    };
    await walk(absolute, 0);
    return { root: this.root, entries, truncated };
  }

  async write(relativePath: unknown, content: unknown, expectedSha?: string): Promise<FileWriteResult> {
    if (!this.allowWrite) {
      throw new AppError(ErrorCode.FORBIDDEN, '写入未启用（AGENT_WORKFLOW_ALLOW_WRITE 未设置为 1）', {
        details: { reason: 'write_disabled' },
      });
    }
    const normalized = normalizeRelativePath(relativePath);
    if (normalized === '.') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '写入路径必须是具体文件', { details: { path: normalized } });
    }
    if (typeof content !== 'string') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'content 必须是字符串', { details: { field: 'content' } });
    }
    const bytes = Buffer.from(content, 'utf8');
    if (bytes.length > this.maxFileBytes) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `写入内容超过 ${this.maxFileBytes} 字节上限`, {
        details: { field: 'content', bytes: bytes.length, maxFileBytes: this.maxFileBytes },
      });
    }
    const root = await this.#realRoot();
    const segments = normalized.split('/');
    const parentReal = await ensureSafeParent(root, segments.slice(0, -1), normalized);
    const target = join(parentReal, segments[segments.length - 1] ?? '');
    const existing = await lstatOrUndefined(target);
    if (existing !== undefined) {
      if (existing.isSymbolicLink()) {
        throw new AppError(ErrorCode.FORBIDDEN, `拒绝通过符号链接写入：${normalized}`, {
          details: { path: normalized, reason: 'symlink_write' },
        });
      }
      if (existing.isDirectory()) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, `路径是目录，不能写入文件：${normalized}`, { details: { path: normalized } });
      }
      if (expectedSha !== undefined && expectedSha.length > 0) {
        const current = await readFile(target, 'utf8');
        const actual = sha256(current);
        if (actual !== expectedSha) {
          throw new AppError(ErrorCode.STALE_TARGET, `文件已被修改，请重新读取：${normalized}`, {
            details: { path: normalized, currentSha: actual },
          });
        }
      }
    }
    await writeFileAtomic(target, bytes);
    return { path: normalized, sizeBytes: bytes.length, sha: sha256(content) };
  }

  /** Resolve a path and verify it stays inside the sandbox; throws on escape. */
  async resolvePath(relativePath: unknown): Promise<string> {
    const normalized = normalizeRelativePath(relativePath);
    const root = await this.#realRoot();
    return resolveExistingPath(root, normalized);
  }

  async #realRoot(): Promise<string> {
    if (!this.configured) {
      throw new AppError(ErrorCode.NOT_CONFIGURED, '本地 workspace 根未配置（AGENT_WORKFLOW_WORKTREE）', {
        details: { field: 'AGENT_WORKFLOW_WORKTREE' },
      });
    }
    try {
      return await realpath(this.root);
    } catch {
      throw new AppError(ErrorCode.WORKSPACE_NOT_READY, '本地 workspace 根不存在', {
        details: { reason: 'root_missing' },
      });
    }
  }
}

function normalizeRelativePath(input: unknown): string {
  if (input === undefined || input === null) return '.';
  if (typeof input !== 'string') {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'path 必须是字符串', { details: { field: 'path' } });
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) return '.';
  if (trimmed.includes('\u0000')) {
    throw new AppError(ErrorCode.FORBIDDEN, '路径包含非法字符', { details: { reason: 'nul_byte' } });
  }
  if (isAbsolute(trimmed) || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    throw new AppError(ErrorCode.FORBIDDEN, '只允许 workspace 内的相对路径', {
      details: { path: trimmed, reason: 'absolute_path' },
    });
  }
  const parts = trimmed.split(/[\\/]+/).filter((part) => part.length > 0 && part !== '.');
  for (const part of parts) {
    if (part === '..') {
      throw new AppError(ErrorCode.FORBIDDEN, '拒绝路径穿越（..）', { details: { path: trimmed, reason: 'path_traversal' } });
    }
  }
  return parts.length === 0 ? '.' : parts.join('/');
}

async function resolveExistingPath(root: string, normalized: string): Promise<string> {
  const candidate = normalized === '.' ? root : resolve(root, normalized);
  let resolved: string;
  try {
    resolved = await realpath(candidate);
  } catch {
    throw new AppError(ErrorCode.NOT_FOUND, `文件不存在：${normalized}`, { details: { path: normalized } });
  }
  assertContained(root, resolved, normalized);
  return resolved;
}

function assertContained(root: string, resolved: string, displayPath: string): void {
  const rel = relative(root, resolved);
  if (rel === '') return;
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new AppError(ErrorCode.FORBIDDEN, `路径越出 workspace：${displayPath}`, {
      details: { path: displayPath, reason: 'path_escape' },
    });
  }
}

function normalizeOffset(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'offset 必须是非负整数', { details: { field: 'offset' } });
  }
  return value;
}

function normalizeLineLimit(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'limit 必须是非负整数', { details: { field: 'limit' } });
  }
  return value;
}

/** Walk parent directories one level at a time so symlinks cannot escape before validation. */
async function ensureSafeParent(root: string, parentSegments: readonly string[], displayPath: string): Promise<string> {
  let current = root;
  for (const segment of parentSegments) {
    current = join(current, segment);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (isMissing(error)) {
        try {
          await mkdir(current);
        } catch (mkdirError) {
          if (!isAlreadyExists(mkdirError)) throw mkdirError;
        }
        continue;
      }
      throw error;
    }
    if (info.isSymbolicLink()) {
      current = await realpath(current);
      assertContained(root, current, displayPath);
      const resolvedInfo = await stat(current);
      if (!resolvedInfo.isDirectory()) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, `父级路径不是目录：${displayPath}`, { details: { path: displayPath } });
      }
      continue;
    }
    if (!info.isDirectory()) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `父级路径不是目录：${displayPath}`, { details: { path: displayPath } });
    }
  }
  const parentReal = await realpath(current);
  assertContained(root, parentReal, displayPath);
  return parentReal;
}

async function writeFileAtomic(target: string, bytes: Buffer): Promise<void> {
  const temporary = `${target}.aw-${process.pid}-${Date.now()}.tmp`;
  await writeFile(temporary, bytes, { mode: 0o644 });
  try {
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function lstatOrUndefined(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'EEXIST';
}
