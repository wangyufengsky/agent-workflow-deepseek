import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { DiffPage, FileChange, GitBranch, GitCommit, GitCommitSummary, GitRepo, RepoGitStateValue } from '@agent-workflow/shared';
import { AppError, ErrorCode } from '@agent-workflow/shared';
import type { GitPort } from '@agent-workflow/engine';

interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

/** Minimal local Git CLI adapter implementing the engine GitPort. */
export class GitCliAdapter implements GitPort {
  readonly #timeoutMs: number;
  readonly #tempRoot: string;

  constructor(timeoutMs = 120000, tempRoot = join(process.cwd(), '.data', 'merge-tmp')) {
    this.#timeoutMs = timeoutMs;
    this.#tempRoot = tempRoot;
  }

  async detect(rootPath: string): Promise<{ gitState: RepoGitStateValue; defaultBranch?: string; remoteDisplayUrl?: string; detail?: string }> {
    if (!existsSync(rootPath)) return { gitState: 'path_unavailable', detail: '路径不存在' };
    if (!statSync(rootPath).isDirectory()) return { gitState: 'path_unavailable', detail: '不是目录' };
    const inside = await this.#run(['rev-parse', '--is-inside-work-tree'], rootPath).catch((error: unknown) => {
      if (error instanceof AppError) return null;
      throw error;
    });
    if (inside === null) return { gitState: 'path_unavailable', detail: '无法读取 Git 信息' };
    if (inside.stdout.trim() !== 'true') return { gitState: 'not_git', detail: '不是 Git 仓库' };
    const defaultBranch = await this.#defaultBranch(rootPath);
    const remote = await this.#run(['remote', 'get-url', 'origin'], rootPath).catch(() => undefined);
    return {
      gitState: 'git',
      defaultBranch,
      remoteDisplayUrl: remote?.stdout.trim().replace(/\/\/[^@/]+@/, '//[已隐藏]@') || undefined,
    };
  }

  async #defaultBranch(rootPath: string): Promise<string> {
    const head = await this.#run(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], rootPath).catch(() => undefined);
    if (head !== undefined) return head.stdout.trim().replace(/^origin\//, '');
    for (const candidate of ['main', 'master']) {
      const exists = await this.#run(['rev-parse', '--verify', '--quiet', `refs/heads/${candidate}`], rootPath).catch(() => undefined);
      if (exists !== undefined) return candidate;
    }
    return 'main';
  }

  async status(rootPath: string): Promise<GitRepo['status'] | undefined> {
    const headSha = await this.#run(['rev-parse', 'HEAD'], rootPath).catch(() => undefined);
    if (headSha === undefined) {
      return {
        head: { kind: 'unborn', branch: await this.#currentBranch(rootPath) },
        workingTree: { uncommitted: 0, staged: 0, untracked: 0 },
        isEmpty: true,
      };
    }
    const branchName = await this.#run(['symbolic-ref', '--short', '-q', 'HEAD'], rootPath).catch(() => undefined);
    const status = await this.#run(['status', '--porcelain=v1', '--untracked-files=normal'], rootPath);
    const lines = status.stdout.split('\n').filter((line) => line.trim() !== '');
    const staged = lines.filter((line) => /^[MARCDT]/.test(line)).length;
    const untracked = lines.filter((line) => line.startsWith('??')).length;
    const uncommitted = lines.length - untracked;
    const upstreamRef = await this.#run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], rootPath).catch(() => undefined);
    let upstream: { ref: string; ahead: number; behind: number } | undefined;
    if (upstreamRef !== undefined) {
      const counts = await this.#run(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], rootPath).catch(() => undefined);
      const [ahead, behind] = (counts?.stdout.trim() ?? '0 0').split(/\s+/).map(Number);
      upstream = { ref: upstreamRef.stdout.trim(), ahead: ahead ?? 0, behind: behind ?? 0 };
    }
    const shallow = await this.#run(['rev-parse', '--is-shallow-repository'], rootPath).catch(() => undefined);
    return {
      head: branchName === undefined ? { kind: 'detached', sha: headSha.stdout.trim() } : { kind: 'branch', branch: branchName.stdout.trim(), sha: headSha.stdout.trim() },
      upstream,
      workingTree: { uncommitted, staged, untracked },
      isEmpty: false,
      shallow: shallow?.stdout.trim() === 'true' ? { depth: undefined } : undefined,
    };
  }

  async #currentBranch(rootPath: string): Promise<string> {
    const branch = await this.#run(['symbolic-ref', '--short', '-q', 'HEAD'], rootPath).catch(() => undefined);
    return branch?.stdout.trim() || 'main';
  }

  async listCommits(input: { rootPath: string; ref?: string; limit?: number; cursor?: string; query?: string; author?: string }): Promise<{ commits: readonly GitCommitSummary[]; nextCursor?: string }> {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const args = ['log', '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%D', `--max-count=${limit + 1}`];
    if (input.author !== undefined) args.push(`--author=${input.author}`);
    if (input.query !== undefined) args.push(`--grep=${input.query}`);
    if (input.cursor !== undefined) args.push(`${input.cursor}^`);
    args.push(input.ref ?? 'HEAD');
    const out = await this.#run(args, input.rootPath);
    const rows = out.stdout.split('\n').filter((line) => line.trim() !== '');
    const hasMore = rows.length > limit;
    const commits = rows.slice(0, limit).map((line) => {
      const [sha, parents, name, email, authoredAt, subject, refs] = line.split('\x1f');
      return {
        sha: sha ?? '',
        parents: (parents ?? '').split(' ').filter(Boolean),
        subject: subject ?? '',
        author: { name: name ?? '', email: email ?? '', initials: initials(name ?? '') },
        authoredAt: authoredAt ?? new Date().toISOString(),
        refs: (refs ?? '')
          .split(',')
          .map((ref) => ref.trim())
          .filter(Boolean)
          .map((ref) => ({
            kind: ref.startsWith('HEAD') ? ('head' as const) : ref.startsWith('tag:') ? ('tag' as const) : ref.includes('origin/') ? ('remote' as const) : ('local' as const),
            name: ref.replace(/^HEAD -> /, '').replace(/^tag: /, ''),
          })),
      };
    });
    return { commits, nextCursor: hasMore ? commits.at(-1)?.sha : undefined };
  }

  async commitShow(rootPath: string, sha: string): Promise<GitCommit | undefined> {
    this.#assertSha(sha);
    const out = await this.#run(['show', '-s', '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%ce%x1f%cI%x1f%s%x1f%b', sha], rootPath).catch(() => undefined);
    if (out === undefined) return undefined;
    const [full, parents, author, authorEmail, authoredAt, committer, committerEmail, committedAt, subject, body] = out.stdout.split('\x1f');
    const files = await this.#diffNumStat(rootPath, `${sha}^`, sha).catch(() => ({ files: 0, additions: 0, deletions: 0 }));
    return {
      sha: full ?? sha,
      parents: (parents ?? '').split(' ').filter(Boolean),
      subject: subject ?? '',
      body: body ?? '',
      author: { name: author ?? '', email: authorEmail ?? '', initials: initials(author ?? '') },
      authoredAt: authoredAt ?? '',
      committer: { name: committer ?? '', email: committerEmail ?? '', initials: initials(committer ?? '') },
      committedAt: committedAt ?? '',
      refs: [],
      containedIn: { branches: [], truncated: false },
      stats: files,
      compareOptions: (parents ?? '').split(' ').filter(Boolean).map((parent, index) => ({
        compareId: `parent:${index}`,
        kind: 'parent' as const,
        label: `父提交 ${index + 1}`,
        baseSha: parent,
      })),
    };
  }

  async diffFiles(input: { repoRoot: string; baseSha: string; headSha?: string; worktreePath?: string }): Promise<readonly FileChange[]> {
    const cwd = input.worktreePath ?? input.repoRoot;
    const base = input.baseSha;
    this.#assertSha(base);
    const head = input.headSha;
    if (head !== undefined) this.#assertSha(head);
    const names = await this.#run(['diff', '--name-status', '-z', base, head ?? ''], cwd);
    const numstat = await this.#run(['diff', '--numstat', '-z', base, head ?? ''], cwd);
    const stats = parseNumstat(numstat.stdout);
    const entries = parseNameStatus(names.stdout);
    return entries.map((entry) => {
      const stat = stats.get(entry.path) ?? { additions: null, deletions: null, binary: false };
      return {
        fileId: fileIdFor(entry.path),
        status: entry.status,
        path: entry.path,
        oldPath: entry.oldPath,
        binary: stat.binary,
        additions: stat.additions,
        deletions: stat.deletions,
        sizeClass: 'normal' as const,
        versionRef: createHash('sha1').update(`${base}:${head ?? 'worktree'}:${entry.path}`).digest('hex').slice(0, 12),
      };
    });
  }

  async diffPage(input: { repoRoot?: string; worktreePath?: string; baseSha: string; headSha?: string; path: string; ignoreWhitespace?: boolean; cursor?: string }): Promise<DiffPage> {
    const cwd = input.worktreePath ?? input.repoRoot ?? process.cwd();
    this.#assertSha(input.baseSha);
    const args = ['diff', '-U3', '--no-color'];
    if (input.ignoreWhitespace === true) args.push('-w');
    args.push(input.baseSha, input.headSha ?? '', '--', input.path);
    const out = await this.#run(args, cwd);
    if (out.stdout.trim() === '') {
      return { fileId: fileIdFor(input.path), baseSha: input.baseSha, headSha: input.headSha, ignoreWhitespace: input.ignoreWhitespace ?? false, hunks: [] };
    }
    return { fileId: fileIdFor(input.path), baseSha: input.baseSha, headSha: input.headSha, ignoreWhitespace: input.ignoreWhitespace ?? false, hunks: parseUnifiedDiff(out.stdout) };
  }

  async branches(rootPath: string): Promise<readonly GitBranch[]> {
    const out = await this.#run(['for-each-ref', '--format=%(refname)%09%(objectname)%09%(upstream:short)', 'refs/heads', 'refs/remotes'], rootPath);
    const current = (await this.#run(['symbolic-ref', '--short', '-q', 'HEAD'], rootPath).catch(() => undefined))?.stdout.trim();
    return out.stdout
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => {
        const [refname, sha, upstream] = line.split('\t');
        const fullRef = refname ?? '';
        const name = fullRef.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\//, '');
        return {
          name,
          fullRef,
          kind: fullRef.startsWith('refs/remotes/') ? ('remote' as const) : ('local' as const),
          tipSha: sha ?? '',
          isCurrent: name === current,
          checkedOutInUserWorktree: name === current,
          upstream: upstream || undefined,
          protected: null,
        };
      });
  }

  async createWorktree(input: { repoRoot: string; worktreesRoot: string; taskId: string; baseRef: string; baseSha: string; branch: string }): Promise<{ path: string; handle: string; branch: string; headSha: string }> {
    const root = resolve(input.worktreesRoot);
    const safeTask = input.taskId.replace(/[^a-zA-Z0-9_-]/g, '-');
    const path = join(root, safeTask);
    if (existsSync(path)) throw new AppError(ErrorCode.WORKSPACE_NAME_CONFLICT, `工作区目录已存在：${path}`);
    const branchExists = await this.#run(['rev-parse', '--verify', '--quiet', `refs/heads/${input.branch}`], input.repoRoot).catch(() => undefined);
    if (branchExists !== undefined) throw new AppError(ErrorCode.WORKSPACE_NAME_CONFLICT, `本地分支已存在：${input.branch}`);
    await this.#run(['worktree', 'add', '-b', input.branch, path, input.baseSha], input.repoRoot);
    const headSha = (await this.#run(['rev-parse', 'HEAD'], path)).stdout.trim();
    return { path, handle: `wt_${createHash('sha1').update(path).digest('hex').slice(0, 12)}`, branch: input.branch, headSha };
  }

  async removeWorktree(input: { repoRoot: string; worktreePath: string; branch?: string; deleteBranch: boolean }): Promise<void> {
    await this.#run(['worktree', 'remove', '--force', input.worktreePath], input.repoRoot).catch(() => undefined);
    if (input.deleteBranch && input.branch !== undefined) {
      await this.#run(['branch', '-D', input.branch], input.repoRoot).catch(() => undefined);
    }
    await this.#run(['worktree', 'prune'], input.repoRoot).catch(() => undefined);
  }

  async worktreeChangedFiles(input: { worktreePath: string; baseSha: string }): Promise<{ files: readonly FileChange[]; changesRevision: string }> {
    const names = await this.#run(['diff', '--name-status', '-z', input.baseSha], input.worktreePath);
    const stats = parseNumstat((await this.#run(['diff', '--numstat', '-z', input.baseSha], input.worktreePath)).stdout);
    const entries = parseNameStatus(names.stdout);
    const files: FileChange[] = entries.map((entry) => {
      const stat = stats.get(entry.path) ?? { additions: null, deletions: null, binary: false };
      return {
        fileId: fileIdFor(entry.path),
        status: entry.status,
        path: entry.path,
        oldPath: entry.oldPath,
        binary: stat.binary,
        additions: stat.additions,
        deletions: stat.deletions,
        sizeClass: 'normal',
        versionRef: createHash('sha1').update(`${entry.path}:${stat.additions}:${stat.deletions}`).digest('hex').slice(0, 12),
      };
    });
    const untracked = await this.#run(['ls-files', '--others', '--exclude-standard', '-z'], input.worktreePath);
    for (const path of untracked.stdout.split('\0').filter(Boolean)) {
      if (files.some((file) => file.path === path)) continue;
      files.push({
        fileId: fileIdFor(path),
        status: 'A',
        path,
        binary: false,
        additions: null,
        deletions: null,
        sizeClass: 'normal',
        versionRef: createHash('sha1').update(`${path}:untracked`).digest('hex').slice(0, 12),
      });
    }
    const changesRevision = createHash('sha1')
      .update(files.map((file) => `${file.status}:${file.path}:${file.versionRef}`).join('|'))
      .digest('hex')
      .slice(0, 16);
    return { files, changesRevision };
  }

  async commit(input: { worktreePath: string; filePaths: readonly string[]; message: string; author: { name: string; email: string }; expectedHeadSha?: string }): Promise<{ sha: string }> {
    if (input.expectedHeadSha !== undefined) {
      const head = (await this.#run(['rev-parse', 'HEAD'], input.worktreePath)).stdout.trim();
      if (head !== input.expectedHeadSha) throw new AppError(ErrorCode.STALE_TARGET, '分支 HEAD 已变化，请重新读取');
    }
    for (const path of input.filePaths) {
      await this.#run(['add', '--', path], input.worktreePath);
    }
    const env = {
      GIT_AUTHOR_NAME: input.author.name,
      GIT_AUTHOR_EMAIL: input.author.email,
      GIT_COMMITTER_NAME: input.author.name,
      GIT_COMMITTER_EMAIL: input.author.email,
    };
    const result = await this.#run(['commit', '-m', input.message], input.worktreePath, env).catch((error: unknown) => {
      if (error instanceof AppError && /nothing to commit|no changes added/i.test(error.message)) throw new AppError(ErrorCode.FIX_NO_CHANGES, '没有可提交的改动');
      if (error instanceof AppError && /hook/i.test(error.message)) throw new AppError(ErrorCode.HOOK_REJECTED, '提交被 Git hook 拒绝', { details: { output: error.message } });
      throw error;
    });
    const sha = (await this.#run(['rev-parse', 'HEAD'], input.worktreePath)).stdout.trim();
    void result;
    return { sha };
  }

  async push(input: { repoRoot: string; localSha: string; remote: string; remoteRef: string; token?: string }): Promise<{ remoteRef: string; pushedSha: string; created: boolean }> {
    if (input.remoteRef.includes(':refs/heads/')) throw new AppError(ErrorCode.VALIDATION_FAILED, '推送引用不合法');
    await this.#run(['push', input.remote, `${input.localSha}:${input.remoteRef}`], input.repoRoot).catch((error: unknown) => {
      if (error instanceof AppError && /non-fast-forward|fetch first|rejected/i.test(error.message)) {
        throw new AppError(ErrorCode.PUSH_REJECTED_NON_FF, '远端已有新提交，推送被拒；请先获取远端更新', { details: { output: error.message } });
      }
      if (error instanceof AppError && /authentication|permission|403|401/i.test(error.message)) {
        throw new AppError(ErrorCode.GITLAB_AUTH_FAILED, '推送认证失败');
      }
      throw error;
    });
    return { remoteRef: input.remoteRef, pushedSha: input.localSha, created: true };
  }

  async mergeTaskBranch(input: {
    repoRoot: string;
    targetBranch: string;
    expectedTargetSha: string;
    sourceSha: string;
    message: string;
    tempRoot: string;
    strategy: 'no_ff' | 'ff_only';
  }): Promise<{ mergeSha: string; kind: 'merge' | 'ff' }> {
    this.#assertSha(input.expectedTargetSha);
    this.#assertSha(input.sourceSha);
    if (!/^[A-Za-z0-9._/-]+$/.test(input.targetBranch) || input.targetBranch.startsWith('-')) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '目标分支不合法');
    }
    const current = (await this.#run(['rev-parse', `refs/heads/${input.targetBranch}`], input.repoRoot)).stdout.trim();
    if (current !== input.expectedTargetSha) {
      throw new AppError(ErrorCode.STALE_TARGET, '目标分支已前移，请重新读取后确认', { details: { expected: input.expectedTargetSha, actual: current } });
    }
    mkdirSync(this.#tempRoot, { recursive: true });
    const temporary = join(this.#tempRoot, `merge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await this.#run(['worktree', 'add', '--detach', temporary, input.expectedTargetSha], input.repoRoot);
    try {
      const mergeArgs = ['-C', temporary, 'merge'];
      if (input.strategy === 'ff_only') mergeArgs.push('--ff-only');
      else mergeArgs.push('--no-ff');
      mergeArgs.push(input.sourceSha, '-m', input.message);
      await this.#run(mergeArgs, input.repoRoot).catch((error: unknown) => {
        if (error instanceof AppError && /conflict|CONFLICT/i.test(error.message)) {
          throw new AppError(ErrorCode.MERGE_CONFLICT, '合并存在冲突；已中止合并，目标分支未改变', { details: { output: error.message } });
        }
        throw error;
      });
      const mergeSha = (await this.#run(['-C', temporary, 'rev-parse', 'HEAD'], input.repoRoot)).stdout.trim();
      const parentCount = (await this.#run(['-C', temporary, 'rev-list', '--parents', '-n', '1', 'HEAD'], input.repoRoot)).stdout.trim().split(/\s+/).length - 1;
      await this.#run(['update-ref', `refs/heads/${input.targetBranch}`, mergeSha, input.expectedTargetSha], input.repoRoot).catch((error: unknown) => {
        if (error instanceof AppError && /cannot lock ref|is at|expected/i.test(error.message)) {
          throw new AppError(ErrorCode.STALE_TARGET, '目标分支在合并期间发生变化，未更新', { details: { output: error.message } });
        }
        throw error;
      });
      return { mergeSha, kind: parentCount > 1 ? 'merge' : 'ff' };
    } catch (error) {
      await this.#run(['-C', temporary, 'merge', '--abort'], input.repoRoot).catch(() => undefined);
      throw error;
    } finally {
      await this.#run(['worktree', 'remove', '--force', temporary], input.repoRoot).catch(() => undefined);
    }
  }

  async #diffNumStat(rootPath: string, base: string, head: string): Promise<{ files: number; additions: number; deletions: number }> {
    const out = await this.#run(['diff', '--numstat', base, head], rootPath);
    let files = 0;
    let additions = 0;
    let deletions = 0;
    for (const line of out.stdout.split('\n').filter(Boolean)) {
      const [add, del] = line.split('\t');
      files += 1;
      additions += Number(add) || 0;
      deletions += Number(del) || 0;
    }
    return { files, additions, deletions };
  }

  #assertSha(sha: string): void {
    if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha) && !/^[0-9a-f]{7,64}$/.test(sha)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'revision 必须是完整 SHA');
    }
    if (sha.startsWith('-')) throw new AppError(ErrorCode.VALIDATION_FAILED, 'revision 不合法');
  }

  #run(args: readonly string[], cwd: string, env?: Record<string, string>): Promise<ExecResult> {
    return new Promise<ExecResult>((resolvePromise, rejectPromise) => {
      execFile('git', ['--no-optional-locks', ...args], { cwd, timeout: this.#timeoutMs, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env } }, (error, stdout, stderr) => {
        const result = { stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code: error === null ? 0 : typeof error.code === 'number' ? error.code : 1 };
        if (error !== null) {
          rejectPromise(new AppError(mapGitError(result.stderr || result.stdout), result.stderr.trim() || error.message, { details: { exitCode: result.code } }));
          return;
        }
        resolvePromise(result);
      });
    });
  }
}

export function fileIdFor(path: string): string {
  return `file_${Buffer.from(path, 'utf8').toString('base64url')}`;
}

function mapGitError(output: string): (typeof ErrorCode)[keyof typeof ErrorCode] {
  if (/not a git repository/i.test(output)) return ErrorCode.NOT_A_GIT_REPO;
  if (/unknown revision|bad revision|ambiguous argument/i.test(output)) return ErrorCode.REVISION_NOT_FOUND;
  if (/authentication|permission denied|403|401/i.test(output)) return ErrorCode.GITLAB_AUTH_FAILED;
  if (/could not resolve host|network|timed out/i.test(output)) return ErrorCode.NETWORK_UNREACHABLE;
  if (/already exists/i.test(output)) return ErrorCode.WORKSPACE_NAME_CONFLICT;
  return ErrorCode.INTERNAL_ERROR;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function parseNameStatus(raw: string): { status: 'A' | 'M' | 'D' | 'R' | 'C' | 'T'; path: string; oldPath?: string }[] {
  const tokens = raw.split('\0').filter((token) => token !== '');
  const out: { status: 'A' | 'M' | 'D' | 'R' | 'C' | 'T'; path: string; oldPath?: string }[] = [];
  for (let index = 0; index < tokens.length; ) {
    const statusToken = tokens[index++] ?? '';
    const code = statusToken[0] as 'A' | 'M' | 'D' | 'R' | 'C' | 'T';
    if (code === 'R' || code === 'C') {
      const oldPath = tokens[index++];
      const path = tokens[index++];
      if (oldPath !== undefined && path !== undefined) out.push({ status: code, path, oldPath });
    } else {
      const path = tokens[index++];
      if (path !== undefined) out.push({ status: code, path });
    }
  }
  return out;
}

function parseNumstat(raw: string): Map<string, { additions: number | null; deletions: number | null; binary: boolean }> {
  const map = new Map<string, { additions: number | null; deletions: number | null; binary: boolean }>();
  const lines = raw.split('\n').filter((line) => line.trim() !== '');
  for (const line of lines) {
    const parts = line.split('\t');
    const add = parts[0] ?? '';
    const del = parts[1] ?? '';
    const path = parts.slice(2).join('\t') || '';
    const binary = add === '-' || del === '-';
    map.set(path, { additions: binary ? null : Number(add), deletions: binary ? null : Number(del), binary });
  }
  return map;
}

function parseUnifiedDiff(raw: string): DiffPage['hunks'] {
  const lines = raw.split('\n');
  const hunks: { hunkId: string; header: string; section?: string; oldStart: number; oldLines: number; newStart: number; newLines: number; lines: DiffPage['hunks'][number]['lines'][number][] }[] = [];
  let current: (typeof hunks)[number] | undefined;
  let oldLine = 0;
  let newLine = 0;
  let hunkIndex = 0;
  for (const line of lines) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(line);
    if (header) {
      hunkIndex += 1;
      oldLine = Number(header[1]);
      newLine = Number(header[3]);
      current = {
        hunkId: `h${hunkIndex}`,
        header: line,
        section: header[5] || undefined,
        oldStart: oldLine,
        oldLines: Number(header[2] ?? 1),
        newStart: newLine,
        newLines: Number(header[4] ?? 1),
        lines: [],
      };
      hunks.push(current);
      continue;
    }
    if (current === undefined) continue;
    if (line.startsWith('+')) {
      current.lines.push({ kind: 'add', newLine, anchorId: `new:${newLine}`, text: line.slice(1) });
      newLine += 1;
    } else if (line.startsWith('-')) {
      current.lines.push({ kind: 'del', oldLine, anchorId: `old:${oldLine}`, text: line.slice(1) });
      oldLine += 1;
    } else if (line.startsWith(' ')) {
      current.lines.push({ kind: 'context', oldLine, newLine, anchorId: `ctx:${newLine}`, text: line.slice(1) });
      oldLine += 1;
      newLine += 1;
    } else if (line.startsWith('\\')) {
      current.lines.push({ kind: 'no_newline', anchorId: `eof:${newLine}`, text: line.slice(1) });
    }
  }
  return hunks;
}

export { basename };
