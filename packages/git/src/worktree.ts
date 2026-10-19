import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { AppError, ErrorCode, isAppError } from '@agent-workflow/shared';
import { GitCommandError, runGit } from './cli.ts';
import { GIT_LIMITS } from './config.ts';
import { GitRepository } from './repository.ts';
import {
  assertRevision,
  assertWorktreeBranchName,
  assertWorktreeHandle,
  isWorktreeBranchName,
  sanitizeWorktreeSegment,
} from './validation.ts';

/**
 * Worktree manager for isolated task checkouts.
 *
 * Write scope is strictly `worktreesRoot`: every created worktree lives
 * directly under it, and create/remove/list only ever touch paths inside it.
 * The user's own worktree (the project directory) is never modified: we only
 * run `git worktree add/remove` against the repository metadata.
 */

export interface WorktreeManagerOptions {
  readonly repoRoot: string;
  readonly worktreesRoot: string;
  /** Overridable only for tests. */
  readonly gitBinary?: string;
  readonly timeoutMs?: number;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface CreateWorktreeRequest {
  readonly taskId: string;
  /** Must be inside the `task/` or `ai-fix/` namespace. */
  readonly branch: string;
  /** Complete SHA or complete ref. */
  readonly baseSha: string;
}

export interface WorktreeHandle {
  readonly worktreeHandle: string;
  readonly path: string;
  readonly branch: string;
  readonly headSha: string;
  /** Present on create(); worktree list cannot reconstruct the original base. */
  readonly baseSha?: string;
}

export interface RemoveWorktreeOptions {
  /** Explicitly delete the local branch after removing the worktree. */
  readonly deleteBranch?: boolean;
}

export interface RemoveWorktreeResult {
  readonly removed: boolean;
  readonly branchDeleted: boolean;
  readonly branch?: string;
}

interface WorktreeEntry {
  readonly path: string;
  readonly headSha?: string;
  readonly branchRef?: string;
}

export class WorktreeManager {
  readonly repoRoot: string;
  readonly worktreesRoot: string;
  readonly #options: WorktreeManagerOptions;

  constructor(options: WorktreeManagerOptions) {
    this.repoRoot = resolve(options.repoRoot);
    this.worktreesRoot = resolve(options.worktreesRoot);
    this.#options = options;
    try {
      mkdirSync(this.worktreesRoot, { recursive: true, mode: 0o755 });
    } catch {
      throw new AppError(ErrorCode.REPO_PATH_UNAVAILABLE, '无法创建 worktree 根目录', { details: { reason: 'worktrees_root_unavailable' } });
    }
  }

  /** Open after verifying the repository (throws NOT_A_GIT_REPO otherwise). */
  static async open(options: WorktreeManagerOptions): Promise<WorktreeManager> {
    const manager = new WorktreeManager(options);
    await GitRepository.open(options.repoRoot, { gitBinary: options.gitBinary, timeoutMs: options.timeoutMs, env: options.env });
    return manager;
  }

  #run(args: readonly string[], extra: { readonly allowedExitCodes?: readonly number[]; readonly timeoutMs?: number } = {}) {
    return runGit(args, {
      cwd: this.repoRoot,
      gitBinary: this.#options.gitBinary,
      timeoutMs: extra.timeoutMs ?? this.#options.timeoutMs,
      env: this.#options.env,
      allowedExitCodes: extra.allowedExitCodes,
    });
  }

  #targetPath(handle: string): string {
    const safeHandle = assertWorktreeHandle(handle);
    const path = resolve(this.worktreesRoot, safeHandle);
    this.#assertInsideRoot(path);
    return path;
  }

  #assertInsideRoot(path: string): void {
    const root = resolve(this.worktreesRoot);
    const lexical = resolve(path);
    const rel = relative(root, lexical);
    if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel)) {
      throw new AppError(ErrorCode.FORBIDDEN, 'worktree 路径不在受管目录内', { details: { reason: 'outside_worktrees_root' } });
    }
    // Existing paths must also resolve inside the root (symlink escape guard).
    if (existsSync(lexical)) {
      const realRoot = realpathSync(root);
      const realPath = realpathSync(lexical);
      const realRel = relative(realRoot, realPath);
      if (realRel.startsWith('..') || isAbsolute(realRel)) {
        throw new AppError(ErrorCode.FORBIDDEN, 'worktree 路径解析后不在受管目录内', { details: { reason: 'symlink_escape' } });
      }
    }
  }

  /** Compute the deterministic handle/directory for a task branch. */
  handleFor(request: Pick<CreateWorktreeRequest, 'taskId' | 'branch'>): string {
    return buildHandle(request.taskId, request.branch);
  }

  /** Create `<worktreesRoot>/<taskId>-<short>` on a new branch from `baseSha`. */
  async create(request: CreateWorktreeRequest): Promise<WorktreeHandle> {
    if (typeof request.taskId !== 'string' || request.taskId.trim().length === 0) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'taskId 不能为空');
    }
    if (request.taskId.length > 200) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'taskId 过长');
    }
    const branch = assertWorktreeBranchName(request.branch);
    const handle = buildHandle(request.taskId, branch);
    const targetPath = this.#targetPath(handle);

    const resolvedBase = (await this.#run(['rev-parse', '--verify', `${assertRevision(request.baseSha, 'baseSha')}^{commit}`])).stdout.trim();
    if (resolvedBase.length === 0) throw new AppError(ErrorCode.REVISION_NOT_FOUND, 'baseSha 不是有效提交');

    // Fail deterministically with WORKSPACE_NAME_CONFLICT rather than leaking
    // a raw git error for the common "already exists" cases.
    if (existsSync(targetPath)) {
      throw new AppError(ErrorCode.WORKSPACE_NAME_CONFLICT, 'worktree 目录已存在', { details: { worktreeHandle: handle } });
    }
    const existingEntries = await this.#entries();
    if (existingEntries.some((entry) => this.#samePath(entry.path, targetPath))) {
      throw new AppError(ErrorCode.WORKSPACE_NAME_CONFLICT, 'worktree 已注册', { details: { worktreeHandle: handle } });
    }
    const branchCheck = await this.#run(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { allowedExitCodes: [1] });
    if (branchCheck.exitCode === 0) {
      throw new AppError(ErrorCode.WORKSPACE_NAME_CONFLICT, '同名分支已存在', { details: { branch } });
    }

    try {
      await this.#run(['worktree', 'add', '-b', branch, targetPath, resolvedBase], { timeoutMs: GIT_LIMITS.fetchTimeoutMs });
    } catch (error) {
      // Race or partially-created state: clean up only what we just created.
      await this.#cleanupFailedCreate(targetPath);
      if (isAppError(error) && /already exists|already registered|already checked out/i.test(error.message)) {
        throw new AppError(ErrorCode.WORKSPACE_NAME_CONFLICT, '同名分支或 worktree 已存在', { details: { branch, worktreeHandle: handle } });
      }
      throw error;
    }

    this.#assertInsideRoot(targetPath);
    const headSha = (await runGit(['rev-parse', 'HEAD'], { cwd: targetPath, gitBinary: this.#options.gitBinary, env: this.#options.env })).stdout.trim();
    if (headSha !== resolvedBase) {
      throw new AppError(ErrorCode.WORKSPACE_PARTIAL, 'worktree HEAD 与 baseSha 不一致', { details: { expected: resolvedBase, actual: headSha } });
    }
    return { worktreeHandle: handle, path: targetPath, branch, headSha, baseSha: resolvedBase };
  }

  async #cleanupFailedCreate(targetPath: string): Promise<void> {
    try {
      if (!existsSync(targetPath)) return;
      const entries = await this.#entries();
      const registered = entries.some((entry) => this.#samePath(entry.path, targetPath));
      if (!registered) return;
      this.#assertInsideRoot(targetPath);
      await this.#run(['worktree', 'remove', '--force', targetPath], { allowedExitCodes: [1, 128] });
      // Deliberately do not delete the branch here: a concurrent actor could
      // own the same branch name, and cleanup must never remove user data.
    } catch {
      // Best effort only; the original error is more useful to the caller.
    }
  }

  /** Remove a managed worktree; never touches the user's worktree. */
  async remove(handle: string, options: RemoveWorktreeOptions = {}): Promise<RemoveWorktreeResult> {
    const targetPath = this.#targetPath(handle);
    const entries = await this.#entries();
    const entry = entries.find((candidate) => this.#samePath(candidate.path, targetPath));
    if (entry === undefined) {
      if (existsSync(targetPath)) {
        // Unregistered directory under our root: refuse to delete it silently.
        throw new AppError(ErrorCode.NOT_FOUND, 'worktree 未注册但目录存在，需人工核对', { details: { worktreeHandle: handle } });
      }
      throw new AppError(ErrorCode.NOT_FOUND, 'worktree 不存在', { details: { worktreeHandle: handle } });
    }
    const branchRef = entry.branchRef;
    const branch = branchRef?.startsWith('refs/heads/') ? branchRef.slice('refs/heads/'.length) : undefined;

    try {
      await this.#run(['worktree', 'remove', '--force', targetPath], { allowedExitCodes: [0] });
    } catch (error) {
      const stderr = error instanceof GitCommandError ? error.stderr : '';
      if (!/is not a working tree|no such file|cannot remove/i.test(stderr)) throw error;
      // Directory was removed out-of-band; prune the registration and continue.
      await this.#run(['worktree', 'prune'], { allowedExitCodes: [0] });
    }

    if (options.deleteBranch !== true) return { removed: true, branchDeleted: false, branch };
    if (branch === undefined) return { removed: true, branchDeleted: false };
    if (!isWorktreeBranchName(branch)) {
      throw new AppError(ErrorCode.FORBIDDEN, '拒绝删除非任务命名空间的本地分支', { details: { branch } });
    }
    // Never delete a branch that another worktree still has checked out.
    const remaining = await this.#entries();
    if (remaining.some((candidate) => candidate.branchRef === branchRef)) {
      return { removed: true, branchDeleted: false, branch };
    }
    const branchCheck = await this.#run(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { allowedExitCodes: [1] });
    if (branchCheck.exitCode !== 0) return { removed: true, branchDeleted: false, branch };
    await this.#run(['branch', '-D', branch], { allowedExitCodes: [1, 128] });
    return { removed: true, branchDeleted: true, branch };
  }

  /** Managed worktrees under `worktreesRoot`, including ones created elsewhere. */
  async list(): Promise<readonly WorktreeHandle[]> {
    const entries = await this.#entries();
    const handles: WorktreeHandle[] = [];
    for (const entry of entries) {
      if (!this.#insideRootLexically(entry.path)) continue;
      const handle = basename(entry.path);
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(handle)) continue;
      const branch = entry.branchRef?.startsWith('refs/heads/') ? entry.branchRef.slice('refs/heads/'.length) : '';
      handles.push({
        worktreeHandle: handle,
        path: resolve(entry.path),
        branch,
        headSha: entry.headSha ?? '',
      });
    }
    handles.sort((left, right) => left.worktreeHandle.localeCompare(right.worktreeHandle));
    return handles;
  }

  async has(handle: string): Promise<boolean> {
    const safe = assertWorktreeHandle(handle);
    const entries = await this.#entries();
    return entries.some((entry) => basename(entry.path) === safe && this.#insideRootLexically(entry.path));
  }

  async #entries(): Promise<WorktreeEntry[]> {
    const result = await this.#run(['worktree', 'list', '--porcelain']);
    const entries: WorktreeEntry[] = [];
    let current: { path?: string; headSha?: string; branchRef?: string } = {};
    const flush = (): void => {
      if (current.path !== undefined && current.path.length > 0) {
        entries.push({ path: current.path, headSha: current.headSha, branchRef: current.branchRef });
      }
      current = {};
    };
    for (const line of result.stdout.split('\n')) {
      if (line.length === 0) {
        flush();
        continue;
      }
      if (line.startsWith('worktree ')) current.path = line.slice('worktree '.length);
      else if (line.startsWith('HEAD ')) current.headSha = line.slice('HEAD '.length);
      else if (line.startsWith('branch ')) current.branchRef = line.slice('branch '.length);
    }
    flush();
    return entries;
  }

  #insideRootLexically(path: string): boolean {
    // git reports canonical paths (/private/... on macOS) while callers may
    // pass the symlinked spelling (/var/...); compare both spellings.
    const roots = new Set<string>([resolve(this.worktreesRoot)]);
    try {
      roots.add(realpathSync(this.worktreesRoot));
    } catch {
      // Root should exist (constructor creates it), but stay lenient.
    }
    const targets = new Set<string>([resolve(path)]);
    try {
      targets.add(realpathSync(resolve(path)));
    } catch {
      // Missing worktree directory: lexical check only.
    }
    for (const root of roots) {
      for (const target of targets) {
        const rel = relative(root, target);
        if (rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel)) return true;
      }
    }
    return false;
  }

  #samePath(left: string, right: string): boolean {
    const normalizedLeft = resolve(left);
    const normalizedRight = resolve(right);
    if (normalizedLeft === normalizedRight) return true;
    try {
      return realpathSync(normalizedLeft) === realpathSync(normalizedRight);
    } catch {
      return false;
    }
  }
}

/**
 * Deterministic directory/handle: `<taskId>-<branch suffix>`, sanitized to
 * lowercase ASCII. `task/abc` under task `T-1` becomes `t-1-abc`.
 */
export function buildHandle(taskId: string, branch: string): string {
  const taskSegment = sanitizeWorktreeSegment(taskId, 40);
  const slash = branch.indexOf('/');
  const suffix = slash >= 0 ? branch.slice(slash + 1) : branch;
  const branchSegment = sanitizeWorktreeSegment(suffix, 32) || 'work';
  const handle = `${taskSegment}-${branchSegment}`.slice(0, 96).replace(/-+$/, '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(handle)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, '无法从 taskId/branch 生成合法 worktree 目录名');
  }
  return handle;
}

/** Join a handle onto the managed root after validating containment. */
export function resolveWorktreePath(worktreesRoot: string, handle: string): string {
  const root = resolve(worktreesRoot);
  const target = join(root, assertWorktreeHandle(handle));
  const rel = relative(root, target);
  if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel)) {
    throw new AppError(ErrorCode.FORBIDDEN, 'worktree 路径不在受管目录内');
  }
  return target;
}
