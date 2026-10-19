import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { DiffPage, FileChange, GitBranch, GitCommit, GitCommitSummary, GitRepo, RepoGitStateValue } from '@agent-workflow/shared';
import { AppError, ErrorCode } from '@agent-workflow/shared';
import type { GitPort } from '@agent-workflow/engine';

interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

/** Git's well-known empty tree; the review baseline for a root commit. */
const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** Minimal local Git CLI adapter implementing the engine GitPort. */
export interface GitAuthToken {
  readonly provider: 'github' | 'gitlab';
  readonly token: string;
}

export class GitCliAdapter implements GitPort {
  readonly #timeoutMs: number;
  readonly #tempRoot: string;
  readonly #tokenProvider: (() => GitAuthToken | undefined) | undefined;

  constructor(timeoutMs = 120000, tempRoot = join(process.cwd(), '.data', 'merge-tmp'), tokenProvider?: () => GitAuthToken | undefined) {
    this.#timeoutMs = timeoutMs;
    this.#tempRoot = tempRoot;
    this.#tokenProvider = tokenProvider;
  }

  /** Token is injected as a one-shot git config http.extraheader; never in argv. */
  async #remoteAuthEnv(repoRoot: string): Promise<Record<string, string>> {
    const auth = this.#tokenProvider?.();
    if (auth === undefined) return {};
    const remoteUrl = await this.#run(['remote', 'get-url', 'origin'], repoRoot).catch(() => undefined);
    if (remoteUrl === undefined) return {};
    let host: string;
    try {
      host = new URL(remoteUrl.stdout.trim()).host;
    } catch {
      return {};
    }
    const credentials = auth.provider === 'github' ? `x-access-token:${auth.token}` : `oauth2:${auth.token}`;
    const header = `Authorization: Basic ${Buffer.from(credentials, 'utf8').toString('base64')}`;
    return {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: `http.https://${host}/.extraheader`,
      GIT_CONFIG_VALUE_0: header,
    };
  }

  async snapshotInventory(input: { repoRoot: string; targetRef: string; baselineRef?: string }): Promise<import('@agent-workflow/shared').GitSnapshotInventory> {
    const commit = async (ref: string) => {
      if (ref.trim() === '' || ref.startsWith('-') || /[\0\r\n]/.test(ref)) throw new AppError(ErrorCode.VALIDATION_FAILED, '源码版本无效');
      const result = await this.#run(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], input.repoRoot);
      const sha = result.stdout.trim(); if (!/^[a-f0-9]{40}$/.test(sha)) throw new AppError(ErrorCode.VALIDATION_FAILED, '源码版本无法固定为完整提交'); return sha;
    };
    const targetSha = await commit(input.targetRef); const baselineSha = input.baselineRef === undefined ? undefined : await commit(input.baselineRef);
    const tree = await this.#run(['ls-tree', '-r', '-z', '--long', targetSha], input.repoRoot);
    const parseTree = (output: string) => output.split('\0').filter(Boolean).map((entry) => {
      const match = /^(\d+) blob ([a-f0-9]{40})\s+(\d+)\t([\s\S]+)$/.exec(entry);
      return match === null ? undefined : { mode: match[1]!, blobSha: match[2]!, sizeBytes: Number(match[3]), path: match[4]! };
    }).filter((file): file is NonNullable<typeof file> => file !== undefined);
    const files: import('@agent-workflow/shared').GitSnapshotInventory['files'][number][] = parseTree(tree.stdout);
    if (files.length > 5000) throw new AppError(ErrorCode.VALIDATION_FAILED, '快照文件超过5000个，请缩小仓库范围后重试');
    const diff = baselineSha === undefined ? undefined : await this.#run(['diff', '--no-renames', '--name-only', '-z', '--diff-filter=ACMRD', baselineSha, targetSha, '--'], input.repoRoot);
    if (baselineSha !== undefined && diff !== undefined) {
      const existing = new Set(files.map((file) => file.path)); const changed = new Set(diff.stdout.split('\0').filter(Boolean));
      const baselineTree = await this.#run(['ls-tree', '-r', '-z', '--long', baselineSha], input.repoRoot);
      files.push(...parseTree(baselineTree.stdout).filter((file) => !existing.has(file.path) && changed.has(file.path)).map((file) => ({ ...file, deletedAtTarget: true })));
    }
    if (files.length > 5000) throw new AppError(ErrorCode.VALIDATION_FAILED, '快照分析与删除单元超过5000个，请缩小范围');
    return { targetSha, baselineSha, files, ...(diff === undefined ? {} : { changedPaths: diff.stdout.split('\0').filter(Boolean) }) };
  }

  async snapshotFile(repoRoot: string, blobSha: string): Promise<string> {
    if (!/^[a-f0-9]{40}$/.test(blobSha)) throw new AppError(ErrorCode.VALIDATION_FAILED, '源码blob版本无效');
    const size = await this.#run(['cat-file', '-s', blobSha], repoRoot);
    if (Number(size.stdout.trim()) > 256 * 1024) throw new AppError(ErrorCode.TRUNCATED, '冻结源码超过读取上限');
    const blob = await this.#run(['cat-file', 'blob', blobSha], repoRoot);
    if (blob.stdout.includes('\0')) throw new AppError(ErrorCode.VALIDATION_FAILED, '二进制源码单元不能按文本读取');
    return blob.stdout;
  }

  async fetch(input: { repoRoot: string; remote?: string; prune?: boolean }): Promise<{ fetchedAt: string }> {
    const args = ['fetch'];
    if (input.prune !== false) args.push('--prune');
    args.push(input.remote ?? 'origin');
    const authEnv = await this.#remoteAuthEnv(input.repoRoot);
    await this.#run(args, input.repoRoot, authEnv).catch((error: unknown) => {
      if (error instanceof AppError) {
        const details = error.details === undefined ? {} : { details: error.details };
        if (error.code === ErrorCode.GITLAB_AUTH_FAILED) throw new AppError(ErrorCode.GITLAB_AUTH_FAILED, '获取远端失败：认证失败', details);
        if (error.code === ErrorCode.NETWORK_UNREACHABLE) throw new AppError(ErrorCode.NETWORK_UNREACHABLE, '获取远端失败：无法连接', details);
      }
      throw error;
    });
    return { fetchedAt: new Date().toISOString() };
  }

  copyToDirectory(input: { sourceRoot: string; targetRoot: string }): Promise<void> {
    const ignored = new Set(['.git', 'node_modules', '.data', 'dist', '.build', '.tmp']);
    cpSync(input.sourceRoot, input.targetRoot, {
      recursive: true,
      errorOnExist: false,
      force: true,
      filter: (source) => {
        const part = source.split('/').at(-1) ?? '';
        return !ignored.has(part);
      },
    });
    return Promise.resolve();
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
    const parentList = (parents ?? '').split(' ').filter((parent) => parent.length > 0);
    // Root commits have no parent, but they still have a reviewable diff against
    // Git's empty tree; `${sha}^` fails for them, so use the empty tree as base.
    const baseSha = parentList[0] ?? EMPTY_TREE_SHA;
    const files = await this.#diffNumStat(rootPath, baseSha, sha).catch(() => ({ files: 0, additions: 0, deletions: 0 }));
    return {
      sha: full ?? sha,
      parents: parentList,
      subject: subject ?? '',
      body: body ?? '',
      author: { name: author ?? '', email: authorEmail ?? '', initials: initials(author ?? '') },
      authoredAt: authoredAt ?? '',
      committer: { name: committer ?? '', email: committerEmail ?? '', initials: initials(committer ?? '') },
      committedAt: committedAt ?? '',
      refs: [],
      containedIn: { branches: [], truncated: false },
      stats: files,
      compareOptions: parentList.length > 0
        ? parentList.map((parent, index) => ({
            compareId: `parent:${index}`,
            kind: 'parent' as const,
            label: `父提交 ${index + 1}`,
            baseSha: parent,
          }))
        : [{
            compareId: 'empty-tree',
            kind: 'empty_tree' as const,
            label: '根提交（空树基线）',
            baseSha: EMPTY_TREE_SHA,
          }],
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
    // With no explicit head, diff the working tree against the base (that is
    // what `workspaces.diff` wants). Passing '' as a revision used to make git
    // fail with `ambiguous argument ''` -> REVISION_NOT_FOUND.
    if (input.headSha === undefined) {
      args.push(input.baseSha, '--', input.path);
    } else {
      args.push(input.baseSha, input.headSha, '--', input.path);
    }
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
    const authEnv = await this.#remoteAuthEnv(input.repoRoot);
    await this.#run(['push', input.remote, `${input.localSha}:${input.remoteRef}`], input.repoRoot, authEnv).catch((error: unknown) => {
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
          // execFile kills the child on timeout; the empty/partial stderr says
          // nothing about the remote outcome, so expose a machine-readable reason
          // (remote writes then settle UNKNOWN instead of a false failure).
          const meta = error as { killed?: boolean; signal?: string | null };
          const killed = meta.killed === true || (typeof meta.signal === 'string' && meta.signal !== '');
          const output = result.stderr.trim() || error.message;
          if (killed) {
            rejectPromise(new AppError(ErrorCode.NETWORK_UNREACHABLE, `git ${args[0] ?? ''} 超时或被中止`, { details: { exitCode: result.code, reason: 'timeout' } }));
            return;
          }
          rejectPromise(new AppError(mapGitError(result.stderr || result.stdout), output, { details: { exitCode: result.code } }));
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
  if (/not a git repository|does not appear to be a git repository/i.test(output)) return ErrorCode.NOT_A_GIT_REPO;
  if (/unknown revision|bad revision|ambiguous argument/i.test(output)) return ErrorCode.REVISION_NOT_FOUND;
  if (/authentication|permission denied|403|401|could not read from remote repository|repository not found/i.test(output)) return ErrorCode.GITLAB_AUTH_FAILED;
  if (/could not resolve host|network|timed out|failed to connect|connection refused|unable to access/i.test(output)) return ErrorCode.NETWORK_UNREACHABLE;
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
