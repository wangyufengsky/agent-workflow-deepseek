import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type {
  DiffPage,
  FileChange,
  GitBranch,
  GitCommit,
  GitCommitSummary,
  GitCompareBase,
  GitPerson,
  GitRepo,
  RepoGitStateValue,
} from '@agent-workflow/shared';
import { AppError, ErrorCode, isAppError } from '@agent-workflow/shared';
import { GitCommandError, runGit, runGitBytes } from './cli.ts';
import { GIT_LIMITS } from './config.ts';
import {
  buildFileChanges,
  fileIdFor,
  parseNumstat,
  parseRawDiff,
  parseUnifiedDiff,
  sliceTextLines,
  type RawDiffEntry,
} from './diff.ts';
import {
  assertFullSha,
  assertIntInRange,
  assertLineRange,
  assertRelativePath,
  assertRevision,
  isValidBranchShortName,
} from './validation.ts';

/** Shared status shape reused from the `GitRepo` contract. */
export type GitRepositoryStatus = NonNullable<GitRepo['status']>;

export interface GitRepositoryOptions {
  /** Overridable only for tests. */
  readonly gitBinary?: string;
  readonly timeoutMs?: number;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Optional project setting; falls back to remote HEAD / current / init.defaultBranch. */
  readonly defaultBranch?: string;
}

export interface GitLogOptions {
  /** Complete SHA or complete ref. Defaults to HEAD. */
  readonly ref?: string;
  /** 1..200, defaults to 50. */
  readonly limit?: number;
  /** Exclusive cursor: the last SHA returned by the previous page. */
  readonly cursor?: string;
}

export interface GitLogPage {
  readonly commits: readonly GitCommitSummary[];
  readonly nextCursor?: string;
  readonly resolvedTipSha?: string;
  readonly shallowBoundaryReached?: boolean;
}

export interface CommitFileChanges {
  readonly files: readonly FileChange[];
  readonly truncated: boolean;
}

export interface RepositoryRemote {
  readonly name: string;
  readonly fetchUrl: string;
  readonly pushUrl?: string;
}

export interface DiffHunksRequest {
  readonly path: string;
  readonly oldPath?: string;
  readonly baseSha: string;
  /** Omit to diff the working tree against `baseSha`. */
  readonly headSha?: string;
  readonly ignoreWhitespace?: boolean;
  readonly maxLines?: number;
  readonly maxBytes?: number;
  readonly cursor?: string;
}

export interface FileAtRevisionResult {
  readonly sha: string;
  readonly path: string;
  readonly binary: boolean;
  readonly totalLines: number;
  readonly start: number;
  readonly end: number;
  readonly truncated: boolean;
  readonly content: string;
  readonly lines: readonly { readonly number: number; readonly text: string }[];
}

export interface ContainedInBranches {
  readonly branches: readonly string[];
  readonly truncated: boolean;
}

const LOG_FIELDS = ['%H', '%P', '%s', '%an', '%ae', '%aI', '%D'] as const;
const LOG_FORMAT = LOG_FIELDS.join('%x00') + '%x00';
const SHOW_FORMAT = [...LOG_FIELDS, '%cn', '%ce', '%cI', '%B'].join('%x00') + '%x00';

const OPERATION_MARKERS: readonly { readonly gitPath: string; readonly operation: string }[] = [
  { gitPath: 'MERGE_HEAD', operation: 'merge' },
  { gitPath: 'rebase-merge', operation: 'rebase' },
  { gitPath: 'rebase-apply', operation: 'rebase' },
  { gitPath: 'CHERRY_PICK_HEAD', operation: 'cherry-pick' },
  { gitPath: 'REVERT_HEAD', operation: 'revert' },
  { gitPath: 'BISECT_LOG', operation: 'bisect' },
];

/**
 * Detect whether a path is a usable git working tree.
 *
 * `capability_unavailable` is returned when git itself is missing or cannot be
 * executed; `path_unavailable` when the directory does not exist or is not
 * readable.
 */
export async function detectGitState(path: string): Promise<RepoGitStateValue> {
  let directory = false;
  try {
    directory = statSync(path).isDirectory();
  } catch {
    return 'path_unavailable';
  }
  if (!directory) return 'path_unavailable';
  try {
    const result = await runGit(['rev-parse', '--git-dir'], { cwd: path, allowedExitCodes: [128, 129] });
    if (result.exitCode === 0) return 'git';
    const stderr = result.stderr.toLowerCase();
    if (stderr.includes('permission denied') || stderr.includes('cannot change to')) return 'path_unavailable';
    return 'not_git';
  } catch (error) {
    if (isAppError(error) && error.code === ErrorCode.GIT_CAPABILITY_UNAVAILABLE) return 'capability_unavailable';
    if (isAppError(error) && error.code === ErrorCode.REPO_PATH_UNAVAILABLE) return 'path_unavailable';
    return 'not_git';
  }
}

function normalizeIso(value: string | undefined): string {
  if (value !== undefined && value.length > 0 && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return new Date(0).toISOString();
}

function parseAheadBehind(value: string | undefined): GitBranch['vsDefault'] {
  if (value === undefined) return undefined;
  const match = /^(\d+) (\d+)$/.exec(value);
  if (match === null) return undefined;
  return { ahead: Number(match[1]), behind: Number(match[2]) };
}

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter((part) => part.length > 0);
  const first = parts[0];
  if (first === undefined) return '?';
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1] ?? first;
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
}

export function gitPerson(name: string, email?: string): GitPerson {
  const trimmedName = name.trim();
  const trimmedEmail = email?.trim();
  return {
    name: trimmedName.length === 0 ? 'unknown' : trimmedName,
    email: trimmedEmail !== undefined && trimmedEmail.length > 0 ? trimmedEmail : undefined,
    initials: initialsFor(trimmedName),
  };
}

/** Parse `%D` decoration text from `git log`. */
export function parseRefDecorations(text: string, remoteNames: readonly string[]): GitCommitSummary['refs'] {
  const refs: { kind: 'head' | 'local' | 'remote' | 'tag'; name: string }[] = [];
  for (const rawPart of text.split(',')) {
    const part = rawPart.trim();
    if (part.length === 0) continue;
    if (part.startsWith('HEAD -> ')) {
      refs.push({ kind: 'head', name: part.slice('HEAD -> '.length) });
      continue;
    }
    if (part === 'HEAD') {
      refs.push({ kind: 'head', name: 'HEAD' });
      continue;
    }
    if (part.startsWith('tag: ')) {
      refs.push({ kind: 'tag', name: part.slice('tag: '.length) });
      continue;
    }
    const remote = remoteNames.find((name) => part.startsWith(`${name}/`));
    refs.push(remote === undefined ? { kind: 'local', name: part } : { kind: 'remote', name: part });
  }
  return refs;
}

/**
 * Read model over a local git repository.
 *
 * All revisions passed by callers must be complete SHAs or complete refs; the
 * class never accepts short names, ranges or option-like values.
 */
export class GitRepository {
  readonly root: string;
  readonly #options: GitRepositoryOptions;
  #remoteCache: readonly RepositoryRemote[] | undefined;
  #defaultBranchCache: string | undefined;
  #shallowCache: boolean | undefined;

  constructor(root: string, options: GitRepositoryOptions = {}) {
    this.root = resolve(root);
    this.#options = options;
  }

  /**
   * Open a repository from any directory inside its working tree. Resolves the
   * worktree top level so subsequent worktree operations use the repo root.
   */
  static async open(path: string, options: GitRepositoryOptions = {}): Promise<GitRepository> {
    const state = await detectGitState(path);
    if (state === 'path_unavailable') {
      throw new AppError(ErrorCode.REPO_PATH_UNAVAILABLE, '项目路径不存在或不可访问');
    }
    if (state === 'capability_unavailable') {
      throw new AppError(ErrorCode.GIT_CAPABILITY_UNAVAILABLE, '本机 git 不可用');
    }
    if (state !== 'git') {
      throw new AppError(ErrorCode.NOT_A_GIT_REPO, '项目路径不是 Git 仓库');
    }
    const probe = new GitRepository(path, options);
    let root = probe.root;
    try {
      const top = await probe.#run(['rev-parse', '--show-toplevel']);
      const trimmed = top.stdout.trim();
      if (trimmed.length > 0) root = trimmed;
    } catch {
      // Linked/bare layouts can fail here; keep the caller supplied path.
    }
    return new GitRepository(root, options);
  }

  #run(
    args: readonly string[],
    extra: {
      readonly timeoutMs?: number;
      readonly allowedExitCodes?: readonly number[];
      readonly maxOutputBytes?: number;
      readonly allowOutputOverflow?: boolean;
    } = {},
  ): Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number; readonly truncated: boolean }> {
    return runGit(args, {
      cwd: this.root,
      gitBinary: this.#options.gitBinary,
      timeoutMs: extra.timeoutMs ?? this.#options.timeoutMs,
      env: this.#options.env,
      allowedExitCodes: extra.allowedExitCodes,
      maxOutputBytes: extra.maxOutputBytes,
      allowOutputOverflow: extra.allowOutputOverflow,
    });
  }

  #runBytes(args: readonly string[], extra: { readonly timeoutMs?: number; readonly maxOutputBytes?: number; readonly allowOutputOverflow?: boolean } = {}) {
    return runGitBytes(args, {
      cwd: this.root,
      gitBinary: this.#options.gitBinary,
      timeoutMs: extra.timeoutMs ?? this.#options.timeoutMs,
      env: this.#options.env,
      maxOutputBytes: extra.maxOutputBytes,
      allowOutputOverflow: extra.allowOutputOverflow,
    });
  }

  /** Resolve a complete SHA or full ref to a commit SHA. */
  async resolveCommit(revision: string): Promise<string> {
    const value = assertRevision(revision);
    const result = await this.#run(['rev-parse', '--verify', `${value}^{commit}`]);
    const sha = result.stdout.trim();
    if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(sha)) {
      throw new AppError(ErrorCode.REVISION_NOT_FOUND, '无法解析为提交', { details: { revision: value } });
    }
    return sha;
  }

  /** HEAD commit, or undefined for an unborn repository. Internal default only. */
  async #resolveHead(): Promise<string | undefined> {
    const result = await this.#run(['rev-parse', '--verify', 'HEAD^{commit}'], { allowedExitCodes: [1, 128] });
    if (result.exitCode !== 0) return undefined;
    const sha = result.stdout.trim();
    return /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(sha) ? sha : undefined;
  }

  async #tryRun(args: readonly string[]): Promise<string | undefined> {
    try {
      const result = await this.#run(args, { allowedExitCodes: [1, 128, 129] });
      return result.exitCode === 0 ? result.stdout.trim() : undefined;
    } catch {
      return undefined;
    }
  }

  /** Current HEAD, upstream, working tree, shallow and in-progress operation. */
  async status(): Promise<GitRepositoryStatus> {
    const pathFlags = OPERATION_MARKERS.flatMap((marker) => ['--git-path', marker.gitPath]);
    const [porcelain, shallowResult, pathsResult] = await Promise.all([
      this.#run(['status', '--porcelain=v2', '--branch', '-z']),
      this.#run(['rev-parse', '--is-shallow-repository']),
      this.#run(['rev-parse', ...pathFlags]),
    ]);

    const tokens = porcelain.stdout.split('\0');
    let oid = '';
    let branchName = '';
    let upstreamRef: string | undefined;
    let ahead = 0;
    let behind = 0;
    let hasUpstream = false;
    let staged = 0;
    let uncommitted = 0;
    let untracked = 0;

    for (const token of tokens) {
      if (token.length === 0) continue;
      if (token.startsWith('# branch.oid ')) {
        oid = token.slice('# branch.oid '.length);
      } else if (token.startsWith('# branch.head ')) {
        branchName = token.slice('# branch.head '.length);
      } else if (token.startsWith('# branch.upstream ')) {
        upstreamRef = token.slice('# branch.upstream '.length);
        hasUpstream = true;
      } else if (token.startsWith('# branch.ab ')) {
        const match = /^\+(\d+) -(\d+)$/.exec(token.slice('# branch.ab '.length));
        if (match !== null) {
          ahead = Number(match[1]);
          behind = Number(match[2]);
        }
      } else if (token.startsWith('1 ') || token.startsWith('2 ')) {
        const xy = token.slice(2, 4);
        if (xy[0] !== undefined && xy[0] !== '.') staged += 1;
        if (xy[1] !== undefined && xy[1] !== '.') uncommitted += 1;
      } else if (token.startsWith('u ')) {
        staged += 1;
        uncommitted += 1;
      } else if (token.startsWith('? ')) {
        untracked += 1;
      }
    }

    const unborn = oid === '(initial)' || oid.length === 0;
    const head: GitRepositoryStatus['head'] = unborn
      ? { kind: 'unborn' }
      : branchName === '(detached)'
        ? { kind: 'detached', sha: oid }
        : { kind: 'branch', branch: branchName, sha: oid };

    const gitPaths = pathsResult.stdout.split('\n').filter((line) => line.length > 0);
    let userOperationInProgress: string | undefined;
    for (let index = 0; index < OPERATION_MARKERS.length; index += 1) {
      const marker = OPERATION_MARKERS[index];
      const gitPath = gitPaths[index];
      if (marker === undefined || gitPath === undefined) continue;
      if (existsSync(resolve(this.root, gitPath))) {
        userOperationInProgress = marker.operation;
        break;
      }
    }

    const shallow = shallowResult.stdout.trim() === 'true';
    this.#shallowCache = shallow;

    const fetchHeadPath = await this.#tryRun(['rev-parse', '--git-path', 'FETCH_HEAD']);
    let lastFetchAt: string | undefined;
    if (fetchHeadPath !== undefined) {
      try {
        lastFetchAt = statSync(resolve(this.root, fetchHeadPath)).mtime.toISOString();
      } catch {
        lastFetchAt = undefined;
      }
    }

    const status: GitRepositoryStatus = {
      head,
      upstream: hasUpstream && upstreamRef !== undefined ? { ref: upstreamRef, ahead, behind } : undefined,
      lastFetchAt,
      workingTree: { uncommitted, staged, untracked },
      isEmpty: unborn,
      shallow: shallow ? {} : undefined,
      userOperationInProgress,
    };
    return status;
  }

  /** Commit page for the Git workbench history list. */
  async log(options: GitLogOptions = {}): Promise<GitLogPage> {
    const limit = options.limit === undefined ? GIT_LIMITS.defaultLogLimit : assertIntInRange(options.limit, 'limit', 1, GIT_LIMITS.maxLogLimit);
    const ref = options.ref === undefined ? undefined : assertRevision(options.ref, 'ref');
    const tip = ref === undefined ? await this.#resolveHead() : await this.resolveCommit(ref);
    if (tip === undefined) {
      // Unborn repository: an empty page is a valid, non-destructive answer.
      return { commits: [] };
    }
    const cursor = options.cursor === undefined ? undefined : assertFullSha(options.cursor, 'cursor');
    if (cursor !== undefined && cursor !== tip) {
      const ancestor = await this.#run(['merge-base', '--is-ancestor', cursor, tip], { allowedExitCodes: [1] });
      if (ancestor.exitCode !== 0) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, 'cursor 不是当前 ref 的祖先提交');
      }
    }

    const start = cursor ?? tip;
    const args = ['log', `--format=${LOG_FORMAT}`, `--max-count=${limit + 1}`];
    if (cursor !== undefined) args.push('--skip=1');
    args.push(start);
    const result = await this.#run(args);
    const remotes = await this.remoteNames();
    const parsed = this.#parseSummaries(result.stdout, remotes);
    const hasMore = parsed.length > limit;
    const commits = hasMore ? parsed.slice(0, limit) : parsed;
    const last = commits[commits.length - 1];
    const nextCursor = hasMore && last !== undefined ? last.sha : undefined;
    const shallowBoundaryReached = await this.#touchesShallowBoundary(commits.map((commit) => commit.sha));
    return {
      commits,
      nextCursor,
      resolvedTipSha: tip,
      shallowBoundaryReached: shallowBoundaryReached ? true : undefined,
    };
  }

  #parseSummaries(stdout: string, remotes: readonly string[]): GitCommitSummary[] {
    const summaries: GitCommitSummary[] = [];
    for (const line of stdout.split('\n')) {
      if (line.length === 0) continue;
      const fields = line.split('\0');
      const sha = fields[0];
      if (sha === undefined || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(sha)) continue;
      const parents = (fields[1] ?? '').split(' ').filter((parent) => parent.length > 0);
      const summary: GitCommitSummary = {
        sha,
        parents,
        subject: fields[2] ?? '',
        author: gitPerson(fields[3] ?? '', fields[4]),
        authoredAt: normalizeIso(fields[5]),
        refs: parseRefDecorations(fields[6] ?? '', remotes),
      };
      summaries.push(summary);
    }
    return summaries;
  }

  async #touchesShallowBoundary(shas: readonly string[]): Promise<boolean> {
    if (shas.length === 0) return false;
    const shallow = this.#shallowCache ?? (await this.isShallow());
    if (!shallow) return false;
    const shallowPath = await this.#tryRun(['rev-parse', '--git-path', 'shallow']);
    if (shallowPath === undefined) return false;
    try {
      const known = new Set(readFileSync(resolve(this.root, shallowPath), 'utf8').split('\n').map((line) => line.trim()).filter((line) => line.length > 0));
      return shas.some((sha) => known.has(sha));
    } catch {
      return false;
    }
  }

  /** Full commit detail for the commit detail panel. */
  async commitShow(revision: string): Promise<GitCommit> {
    const sha = await this.resolveCommit(revision);
    const result = await this.#run(['log', '-1', `--format=${SHOW_FORMAT}`, sha]);
    const line = result.stdout.replace(/\n$/, '');
    const fields = line.split('\0');
    const parents = (fields[1] ?? '').split(' ').filter((parent) => parent.length > 0);
    const subject = fields[2] ?? '';
    const remoteNames = await this.remoteNames();
    const rawMessage = fields[10] ?? '';
    const containedIn = await this.refsContaining(sha);
    const stats = await this.#commitStats(sha, parents);
    const compareOptions = await this.#compareOptions(sha, parents);
    return {
      sha,
      parents,
      subject,
      author: gitPerson(fields[3] ?? '', fields[4]),
      authoredAt: normalizeIso(fields[5]),
      refs: parseRefDecorations(fields[6] ?? '', remoteNames),
      body: extractBody(rawMessage, subject),
      committer: gitPerson(fields[7] ?? '', fields[8]),
      committedAt: normalizeIso(fields[9]),
      containedIn,
      stats,
      compareOptions,
    };
  }

  async #compareOptions(sha: string, parents: readonly string[]): Promise<GitCompareBase[]> {
    const options: GitCompareBase[] = parents.map((parent) => ({
      compareId: `parent-${parent.slice(0, 12)}`,
      kind: 'parent',
      label: `父提交 ${parent.slice(0, 7)}`,
      baseSha: parent,
    }));
    const commitish = await this.#defaultCommitish();
    if (commitish !== undefined && commitish !== sha) {
      try {
        const base = await this.mergeBase(sha, commitish);
        if (base !== undefined && base !== sha && !parents.includes(base)) {
          options.push({
            compareId: `merge-base-${base.slice(0, 12)}`,
            kind: 'merge_base',
            label: `合并基线 ${await this.getDefaultBranch()}`,
            baseSha: base,
          });
        }
      } catch {
        // A missing default branch simply removes the merge-base option.
      }
    }
    return options;
  }

  async #commitParents(sha: string): Promise<string[]> {
    const result = await this.#run(['rev-list', '--parents', '-n', '1', sha]);
    const parts = result.stdout.trim().split(' ');
    return parts.slice(1).filter((parent) => parent.length > 0);
  }

  async #commitStats(sha: string, parents: readonly string[]): Promise<GitCommit['stats']> {
    const base = parents[0];
    const stats = await this.#numstat(base, sha);
    let additions = 0;
    let deletions = 0;
    for (const entry of stats.values()) {
      additions += entry.additions ?? 0;
      deletions += entry.deletions ?? 0;
    }
    return { files: stats.size, additions, deletions };
  }

  async #numstat(base: string | undefined, head: string) {
    const stdout =
      base === undefined
        ? (await this.#run(['diff-tree', '--root', '--no-commit-id', '-M', '-r', '-z', '--numstat', head])).stdout
        : (await this.#run(['diff', '--numstat', '-z', '-M', base, head])).stdout;
    return parseNumstat(stdout);
  }

  /** Files changed by a commit (compared with its first parent). */
  async commitFiles(revision: string): Promise<CommitFileChanges> {
    const sha = await this.resolveCommit(revision);
    const parents = await this.#commitParents(sha);
    return this.#diffFiles(parents[0], sha);
  }

  /** Files changed between two commits (tree comparison, not ancestry). */
  async commitDiff(baseSha: string, headSha: string): Promise<CommitFileChanges> {
    const base = assertFullSha(baseSha, 'baseSha');
    const head = assertFullSha(headSha, 'headSha');
    return this.#diffFiles(base, head);
  }

  async #diffFiles(base: string | undefined, head: string): Promise<CommitFileChanges> {
    const [rawResult, stats] = await Promise.all([
      base === undefined
        ? this.#run(['diff-tree', '--root', '--no-commit-id', '-M', '-r', '-z', '--raw', head])
        : this.#run(['diff', '--raw', '-z', '-M', base, head]),
      this.#numstat(base, head),
    ]);
    const entries: RawDiffEntry[] = parseRawDiff(rawResult.stdout);
    const truncated = entries.length > GIT_LIMITS.maxDiffFiles;
    const limited = truncated ? entries.slice(0, GIT_LIMITS.maxDiffFiles) : entries;
    const files = buildFileChanges(limited, stats, base ?? 'root', head);
    return { files, truncated };
  }

  /**
   * Unified diff for a single file. When `headSha` is omitted the working tree
   * is compared against `baseSha` (safe: revision is a validated SHA).
   */
  async diffHunks(request: DiffHunksRequest): Promise<DiffPage> {
    const path = assertRelativePath(request.path, 'path');
    const oldPath = request.oldPath === undefined ? undefined : assertRelativePath(request.oldPath, 'oldPath');
    const baseSha = assertFullSha(request.baseSha, 'baseSha');
    const headSha = request.headSha === undefined ? undefined : assertFullSha(request.headSha, 'headSha');
    const maxLines = request.maxLines === undefined ? GIT_LIMITS.defaultDiffMaxLines : assertIntInRange(request.maxLines, 'maxLines', 1, GIT_LIMITS.maxDiffLines);
    const maxBytes = request.maxBytes === undefined ? GIT_LIMITS.maxDiffBytes : assertIntInRange(request.maxBytes, 'maxBytes', 1, GIT_LIMITS.maxDiffBytes);
    const ignoreWhitespace = request.ignoreWhitespace === true;
    const paths = oldPath !== undefined && oldPath !== path ? [oldPath, path] : [path];

    const baseRef = baseSha;
    const headRef = headSha ?? 'WORKTREE';
    const fileId = fileIdFor(baseRef, headRef, path);

    // Binary files have no hunks; detect them before producing a diff body.
    const numstatArgs = ['diff', '--numstat', '-z', ...(ignoreWhitespace ? ['--ignore-all-space'] : []), baseSha, ...(headSha !== undefined ? [headSha] : []), '--', ...paths];
    const numstat = parseNumstat((await this.#run(numstatArgs)).stdout);
    if ([...numstat.values()].some((entry) => entry.binary)) {
      return {
        fileId,
        baseSha,
        headSha,
        ignoreWhitespace,
        hunks: [],
        nextCursor: undefined,
        truncated: undefined,
      };
    }

    const diffArgs = [
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--unified=3',
      ...(ignoreWhitespace ? ['--ignore-all-space'] : []),
      baseSha,
      ...(headSha !== undefined ? [headSha] : []),
      '--',
      ...paths,
    ];
    const result = await this.#run(diffArgs, { maxOutputBytes: maxBytes, allowOutputOverflow: true });
    const page = parseUnifiedDiff(result.stdout, {
      fileId,
      baseSha,
      headSha,
      ignoreWhitespace,
      maxLines,
      cursor: request.cursor,
      byteTruncated: result.truncated,
    });
    return page;
  }

  /** Content of a file at a revision, optionally sliced to an inclusive line range. */
  async fileAtRevision(revision: string, path: string, lineRange?: { readonly start: number; readonly end: number }): Promise<FileAtRevisionResult> {
    const sha = await this.resolveCommit(revision);
    const safePath = assertRelativePath(path, 'path');
    const range = assertLineRange(lineRange);
    const result = await this.#runBytes(['cat-file', 'blob', `${sha}:${safePath}`], {
      maxOutputBytes: GIT_LIMITS.maxDiffBytes,
      allowOutputOverflow: true,
    });
    const sliced = sliceTextLines(result.stdout, range);
    return {
      sha,
      path: safePath,
      ...sliced,
      truncated: sliced.truncated || result.truncated,
    };
  }

  /** Merge base of two revisions, or undefined when histories are unrelated. */
  async mergeBase(a: string, b: string): Promise<string | undefined> {
    const left = assertRevision(a, 'a');
    const right = assertRevision(b, 'b');
    const result = await this.#run(['merge-base', left, right], { allowedExitCodes: [1] });
    if (result.exitCode !== 0) return undefined;
    const sha = result.stdout.trim();
    if (sha.length === 0) return undefined;
    if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(sha)) {
      throw new AppError(ErrorCode.REVISION_NOT_FOUND, 'merge-base 输出不是完整 SHA');
    }
    return sha;
  }

  /** Branches (local and remote) with ahead/behind relative to the default branch. */
  async branches(): Promise<readonly GitBranch[]> {
    const worktreeRefs = await this.#worktreeBranchRefs();
    const defaultCommitish = await this.#defaultCommitish();
    const baseAtoms = [
      '%(refname)',
      '%(refname:short)',
      '%(objectname)',
      '%(upstream:short)',
      '%(HEAD)',
      '%(subject)',
      '%(authorname)',
      '%(authoremail)',
      '%(authordate:iso-strict)',
    ];
    let formatHasAheadBehind = defaultCommitish !== undefined;
    const buildFormat = (withAheadBehind: boolean): string => {
      const atoms = [...baseAtoms];
      if (withAheadBehind && defaultCommitish !== undefined) {
        atoms.splice(4, 0, `%(ahead-behind:${defaultCommitish})`);
      }
      // `for-each-ref` uses %00 (pretty formats use %x00) for NUL separators.
      return atoms.join('%00');
    };
    const refArgs = (format: string): string[] => ['for-each-ref', `--format=${format}`, `--count=${GIT_LIMITS.maxBranches + 1}`, 'refs/heads', 'refs/remotes'];
    let result;
    try {
      result = await this.#run(refArgs(buildFormat(formatHasAheadBehind)));
    } catch (error) {
      // `%(ahead-behind:)` needs git >= 2.41; retry without it on older git.
      if (!(error instanceof GitCommandError) || !/ahead-behind|unknown field/i.test(error.stderr)) throw error;
      formatHasAheadBehind = false;
      result = await this.#run(refArgs(buildFormat(false)));
    }

    const localBranches: GitBranch[] = [];
    const remoteBranches: GitBranch[] = [];
    for (const line of result.stdout.split('\n')) {
      if (line.length === 0) continue;
      const fields = line.split('\0');
      const fullRef = fields[0];
      if (fullRef === undefined || fullRef.length === 0) continue;
      const isLocal = fullRef.startsWith('refs/heads/');
      if (!isLocal && !fullRef.startsWith('refs/remotes/')) continue;
      if (fullRef.endsWith('/HEAD')) continue;
      const baseIndex = formatHasAheadBehind ? 5 : 4;
      const vsDefault = formatHasAheadBehind ? parseAheadBehind(fields[4]) : undefined;
      const subject = fields[baseIndex + 1] ?? '';
      const authorName = fields[baseIndex + 2] ?? '';
      const authorEmail = (fields[baseIndex + 3] ?? '').replace(/^<|>$/g, '');
      const authoredAt = fields[baseIndex + 4] ?? '';
      const branch: GitBranch = {
        name: fields[1] ?? fullRef,
        fullRef,
        kind: isLocal ? 'local' : 'remote',
        tipSha: fields[2] ?? '',
        isCurrent: fields[baseIndex] === '*',
        checkedOutInUserWorktree: worktreeRefs.has(fullRef),
        upstream: (fields[3] ?? '').length > 0 ? (fields[3] ?? '') : undefined,
        vsDefault,
        lastCommit:
          subject.length > 0
            ? { subject, author: gitPerson(authorName, authorEmail.length > 0 ? authorEmail : undefined), authoredAt: normalizeIso(authoredAt) }
            : undefined,
        protected: null,
      };
      if (isLocal) localBranches.push(branch);
      else remoteBranches.push(branch);
    }

    const all = [...localBranches, ...remoteBranches];
    all.sort((left, right) => {
      if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1;
      if (left.kind !== right.kind) return left.kind === 'local' ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
    return all.slice(0, GIT_LIMITS.maxBranches);
  }

  async #worktreeBranchRefs(): Promise<Set<string>> {
    const refs = new Set<string>();
    const result = await this.#run(['worktree', 'list', '--porcelain']);
    for (const line of result.stdout.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('branch ')) refs.add(trimmed.slice('branch '.length));
    }
    return refs;
  }

  /** Complete refs containing a commit, rendered as branch-ish names. */
  async refsContaining(revision: string): Promise<ContainedInBranches> {
    const sha = await this.resolveCommit(revision);
    const result = await this.#run(['for-each-ref', `--count=${GIT_LIMITS.maxRefsContaining + 1}`, '--contains', sha, '--format=%(refname)']);
    const names: string[] = [];
    for (const line of result.stdout.split('\n')) {
      const ref = line.trim();
      if (ref.length === 0 || ref.endsWith('/HEAD') || !ref.startsWith('refs/')) continue;
      if (ref.startsWith('refs/heads/')) names.push(ref.slice('refs/heads/'.length));
      else if (ref.startsWith('refs/remotes/')) names.push(ref.slice('refs/remotes/'.length));
    }
    const truncated = names.length > GIT_LIMITS.maxRefsContaining;
    return { branches: truncated ? names.slice(0, GIT_LIMITS.maxRefsContaining) : names, truncated };
  }

  /** Configured remotes (used to classify decorations and assemble GitRepo). */
  async listRemotes(): Promise<readonly RepositoryRemote[]> {
    if (this.#remoteCache !== undefined) return this.#remoteCache;
    const result = await this.#run(['remote', '-v']);
    const byName = new Map<string, { fetchUrl?: string; pushUrl?: string }>();
    for (const line of result.stdout.split('\n')) {
      const match = /^(\S+)\s+(.+?)\s+\((fetch|push)\)$/.exec(line.trim());
      if (match === null) continue;
      const name = match[1];
      const url = match[2];
      const kind = match[3];
      if (name === undefined || url === undefined) continue;
      const entry = byName.get(name) ?? {};
      if (kind === 'fetch') entry.fetchUrl = url;
      else entry.pushUrl = url;
      byName.set(name, entry);
    }
    const remotes: RepositoryRemote[] = [];
    for (const [name, entry] of byName) {
      remotes.push({ name, fetchUrl: entry.fetchUrl ?? entry.pushUrl ?? '', pushUrl: entry.pushUrl });
    }
    this.#remoteCache = remotes;
    return remotes;
  }

  async remoteNames(): Promise<readonly string[]> {
    return (await this.listRemotes()).map((remote) => remote.name);
  }

  /** Short name of the repository default branch (`main`, `master`, ...). */
  async getDefaultBranch(): Promise<string> {
    if (this.#defaultBranchCache !== undefined) return this.#defaultBranchCache;
    const configured = this.#options.defaultBranch;
    if (configured !== undefined && isValidBranchShortName(configured)) {
      this.#defaultBranchCache = configured;
      return configured;
    }
    const remoteHead = await this.#tryRun(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
    if (remoteHead !== undefined && remoteHead.startsWith('origin/')) {
      this.#defaultBranchCache = remoteHead.slice('origin/'.length);
      return this.#defaultBranchCache;
    }
    const current = await this.#tryRun(['symbolic-ref', '--short', 'HEAD']);
    if (current !== undefined && isValidBranchShortName(current)) {
      this.#defaultBranchCache = current;
      return current;
    }
    const configuredInit = await this.#tryRun(['config', '--get', 'init.defaultBranch']);
    if (configuredInit !== undefined && isValidBranchShortName(configuredInit)) {
      this.#defaultBranchCache = configuredInit;
      return configuredInit;
    }
    this.#defaultBranchCache = 'main';
    return 'main';
  }

  async #defaultCommitish(): Promise<string | undefined> {
    const branch = await this.getDefaultBranch();
    if (isValidBranchShortName(branch)) {
      const remote = await this.#tryRun(['rev-parse', '--verify', `refs/remotes/origin/${branch}^{commit}`]);
      if (remote !== undefined) return `refs/remotes/origin/${branch}`;
      const local = await this.#tryRun(['rev-parse', '--verify', `refs/heads/${branch}^{commit}`]);
      if (local !== undefined) return `refs/heads/${branch}`;
    }
    const head = await this.#tryRun(['rev-parse', '--verify', 'HEAD^{commit}']);
    return head === undefined ? undefined : 'HEAD';
  }

  async isShallow(): Promise<boolean> {
    if (this.#shallowCache !== undefined) return this.#shallowCache;
    const result = await this.#run(['rev-parse', '--is-shallow-repository']);
    this.#shallowCache = result.stdout.trim() === 'true';
    return this.#shallowCache;
  }
}

function extractBody(rawMessage: string, subject: string): string {
  const trimmed = rawMessage.replace(/\n+$/, '');
  if (trimmed.length === 0) return '';
  const lines = trimmed.split('\n');
  const first = lines[0] ?? '';
  // `%B` includes the subject as its first line; subtract it when it matches.
  if (first.trim() === subject.trim()) {
    return lines.slice(1).join('\n').trim();
  }
  return trimmed;
}
