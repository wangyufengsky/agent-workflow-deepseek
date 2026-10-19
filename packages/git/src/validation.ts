import { createHash } from 'node:crypto';
import { AppError, ErrorCode } from '@agent-workflow/shared';
import { GIT_LIMITS } from './config.ts';
import { redactSecrets } from './redact.ts';

/**
 * Input validation for values that end up as git arguments.
 *
 * Only complete object ids (`40`/`64` hex chars) and complete refs
 * (`refs/heads/...`, `refs/remotes/...`, `refs/tags/...`) are accepted as
 * revisions. Short names such as `HEAD~1`, `main`, `origin/main` or anything
 * starting with `-` are rejected: allowing them would either be ambiguous or
 * turn a value into a git option (for example `--upload-pack=`).
 */

const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const FULL_REF = /^refs\/[A-Za-z0-9._/-]+$/;
const BRANCH_SHORT = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const WORKTREE_BRANCH = /^(?:task|ai-fix)\/[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const WORKTREE_HANDLE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DRIVE_LETTER = /^[A-Za-z]:/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function invalid(message: string, details?: Record<string, unknown>): AppError {
  return new AppError(ErrorCode.VALIDATION_FAILED, redactSecrets(message), details === undefined ? {} : { details });
}

function describe(value: unknown): string {
  if (typeof value !== 'string') return typeof value;
  const redacted = redactSecrets(value).slice(0, 120);
  return `"${redacted}"`;
}

/** True for a complete lowercase or uppercase SHA-1/SHA-256 object id. */
export function isFullSha(value: unknown): value is string {
  return typeof value === 'string' && FULL_SHA.test(value);
}

/** True for a complete ref such as `refs/heads/task/abc`. */
export function isFullRef(value: unknown): value is string {
  if (typeof value !== 'string' || !FULL_REF.test(value)) return false;
  return isValidRefPathComponents(value.slice('refs/'.length));
}

/** True for a valid short branch name (`main`, `task/abc`), not a ref. */
export function isValidBranchShortName(value: unknown): value is string {
  if (typeof value !== 'string' || !BRANCH_SHORT.test(value)) return false;
  return isValidRefPathComponents(value);
}

/**
 * Shared component rules for refs/branches: no empty, `.` or `..` segments,
 * no leading dots, no `.lock` suffix, no trailing slash or dot.
 */
function isValidRefPathComponents(path: string): boolean {
  if (path.length === 0 || path.length > 255) return false;
  if (path.startsWith('/') || path.endsWith('/') || path.endsWith('.')) return false;
  if (path.includes('//') || path.includes('..') || path.includes('@{') || path.includes('\\')) return false;
  const parts = path.split('/');
  for (const part of parts) {
    if (part.length === 0) return false;
    if (part.startsWith('.')) return false;
    if (part.toLowerCase().endsWith('.lock')) return false;
  }
  return true;
}

/** Normalize and validate a complete SHA, throwing `VALIDATION_FAILED`. */
export function assertFullSha(value: unknown, field = 'revision'): string {
  if (!isFullSha(value)) {
    throw invalid(`${field} 必须是完整的 40/64 位 SHA，收到 ${describe(value)}`);
  }
  return value.toLowerCase();
}

/** Validate a complete SHA or complete ref and return it unchanged. */
export function assertRevision(value: unknown, field = 'revision'): string {
  if (isFullSha(value)) return value.toLowerCase();
  if (isFullRef(value)) return value;
  throw invalid(`${field} 只接受完整 SHA 或完整 ref，收到 ${describe(value)}`);
}

/** Validate a full ref (`refs/...`). */
export function assertFullRef(value: unknown, field = 'ref'): string {
  if (!isFullRef(value)) {
    throw invalid(`${field} 必须是完整 ref（refs/...），收到 ${describe(value)}`);
  }
  return value;
}

/**
 * Validate an agent-worktree branch name. Agent branches are confined to the
 * `task/` and `ai-fix/` namespaces so cleanup can never delete a user branch.
 */
export function assertWorktreeBranchName(value: unknown): string {
  if (typeof value !== 'string' || !WORKTREE_BRANCH.test(value) || !isValidRefPathComponents(value)) {
    const prefixes = GIT_LIMITS.worktreeBranchPrefixes.join(' 或 ');
    throw invalid(`worktree 分支名必须以 ${prefixes} 开头且是合法 git 分支名，收到 ${describe(value)}`);
  }
  return value;
}

/** True when a branch name is inside the managed namespaces. */
export function isWorktreeBranchName(value: unknown): value is string {
  return typeof value === 'string' && WORKTREE_BRANCH.test(value) && isValidRefPathComponents(value);
}

/**
 * Validate a repository-relative path.
 *
 * Absolute paths, `..` traversal, Windows drive letters, pathspec magic
 * (`:(...)`), leading option dashes, backslashes, control characters and `:`
 * (which could be read as a revision/path separator) are rejected.
 */
export function assertRelativePath(value: unknown, field = 'path'): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw invalid(`${field} 必须是非空相对路径`);
  }
  if (CONTROL_CHARS.test(value)) throw invalid(`${field} 不能包含控制字符`);
  if (value.includes('\0')) throw invalid(`${field} 不能包含 NUL`);
  if (value.includes('\\')) throw invalid(`${field} 不能包含反斜杠`);
  if (value.includes(':')) throw invalid(`${field} 不能包含冒号`);
  if (value.startsWith('/') || DRIVE_LETTER.test(value) || value.startsWith('~')) {
    throw invalid(`${field} 必须是仓库内相对路径，收到 ${describe(value)}`);
  }
  if (value.startsWith('-')) throw invalid(`${field} 不能以 - 开头`);
  if (value.startsWith(':(exclude)') || value.startsWith(':(') || value.startsWith(':')) {
    throw invalid(`${field} 不能包含 pathspec 魔法前缀`);
  }
  const segments = value.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw invalid(`${field} 不能包含空路径段或 .. 片段，收到 ${describe(value)}`);
    }
  }
  return value;
}

/** True when `assertRelativePath` would accept the value. */
export function isRelativePath(value: unknown): value is string {
  try {
    assertRelativePath(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sanitize a task id for use as a directory-name segment. Keeps it readable
 * and adds a short stable hash when sanitizing changed the value, so two
 * distinct task ids cannot collide.
 */
export function sanitizeWorktreeSegment(value: string, maxLength = 48): string {
  const lowered = value.toLowerCase();
  let slug = lowered
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[^a-z0-9]+$/, '');
  if (slug.length > maxLength) slug = slug.slice(0, maxLength).replace(/[^a-z0-9]+$/, '');
  if (slug === 'item' || slug.length === 0) slug = 'item';
  if (slug !== lowered && slug.length < lowered.length) {
    const digest = createHash('sha256').update(value).digest('hex').slice(0, 6);
    const room = Math.max(1, maxLength - digest.length - 1);
    slug = `${slug.slice(0, room)}-${digest}`;
  }
  return slug;
}

/** Validate the opaque handle returned by `WorktreeManager.create()`. */
export function assertWorktreeHandle(value: unknown): string {
  if (typeof value !== 'string' || !WORKTREE_HANDLE.test(value) || value === '.' || value === '..') {
    throw invalid(`worktree handle 非法，收到 ${describe(value)}`);
  }
  return value;
}

/** Validate a 1-based inclusive line range. */
export function assertLineRange(value: unknown): { readonly start: number; readonly end: number } | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object') throw invalid('lineRange 必须是 {start, end}');
  const range = value as { readonly start?: unknown; readonly end?: unknown };
  const start = range.start;
  const end = range.end;
  if (!Number.isInteger(start) || !Number.isInteger(end)) throw invalid('lineRange.start/end 必须是整数');
  if ((start as number) < 1) throw invalid('lineRange.start 必须 >= 1');
  if ((end as number) < (start as number)) throw invalid('lineRange.end 必须 >= lineRange.start');
  return { start: start as number, end: end as number };
}

/** Validate an integer limit inside [min, max]. */
export function assertIntInRange(value: unknown, field: string, min: number, max: number): number {
  if (value === undefined || value === null) return min;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw invalid(`${field} 必须是 ${min}..${max} 的整数，收到 ${describe(value)}`);
  }
  return value;
}

/**
 * Defensive check for user supplied values passed to the CLI wrapper: values
 * must never look like an option. Used by `runGitChecked`.
 */
export function assertCliValue(value: unknown, field = 'value'): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalid(`${field} 必须是非空字符串`);
  }
  if (value.startsWith('-')) throw invalid(`${field} 不能以 - 开头`);
  if (CONTROL_CHARS.test(value)) throw invalid(`${field} 不能包含控制字符`);
  return value;
}
