import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { statSync } from 'node:fs';
import { AppError, ErrorCode, type ErrorCodeValue } from '@agent-workflow/shared';
import { GIT_CHILD_ENV, GIT_LIMITS } from './config.ts';
import { redactSecrets } from './redact.ts';
import { assertCliValue } from './validation.ts';

/**
 * Safe git CLI executor.
 *
 * - arguments are always passed as an array (never through a shell);
 * - child processes never inherit a terminal prompt (no credential prompts);
 * - every command runs with `--no-optional-locks --no-pager` in a fixed cwd;
 * - output is bounded and every error message is credential-redacted.
 *
 * `runGit` is the trusted internal entry point: the caller constructs the
 * argument list from constants plus values that already passed `validation.ts`.
 * `runGitChecked` is the defensive variant for values that are passed straight
 * from an untrusted caller: no argument may start with `-`.
 */

export interface GitRunOptions {
  /** Directory the command runs in. Must exist. */
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  /**
   * When true, an output overflow stops the process but returns the partial
   * output with `truncated: true` instead of throwing `TRUNCATED`. Used for
   * diff pagination.
   */
  readonly allowOutputOverflow?: boolean;
  /** Non-zero exit codes that should be returned instead of thrown. */
  readonly allowedExitCodes?: readonly number[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Overridable only for tests; production always uses `git` from PATH. */
  readonly gitBinary?: string;
  readonly input?: string;
}

export interface GitRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly truncated: boolean;
}

export interface GitRunBytesResult {
  readonly stdout: Buffer;
  readonly stderr: string;
  readonly exitCode: number;
  readonly truncated: boolean;
}

/** Error raised for a non-zero git exit code. */
export class GitCommandError extends AppError {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly args: readonly string[];

  constructor(input: {
    readonly args: readonly string[];
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode: number;
    readonly code: ErrorCodeValue;
    readonly message?: string;
  }) {
    const safeStderr = redactSecrets(input.stderr).trim().slice(0, 4_000);
    super(input.code, input.message ?? `git ${safeCommand(input.args)} 失败（退出码 ${input.exitCode}）：${safeStderr || '无输出'}`, {
      details: {
        exitCode: input.exitCode,
        command: safeCommand(input.args),
        stderr: safeStderr,
        stdout: redactSecrets(input.stdout).slice(0, 2_000),
      },
    });
    this.exitCode = input.exitCode;
    this.stdout = redactSecrets(input.stdout);
    this.stderr = safeStderr;
    this.args = [...input.args];
  }
}

const GIT_GLOBAL_ARGS = ['-c', 'core.quotepath=false', '--no-optional-locks', '--no-pager'] as const;

function safeCommand(args: readonly string[]): string {
  const rendered = args.map((arg) => (/^[A-Za-z0-9._/:=@%+-]+$/.test(arg) ? arg : JSON.stringify(arg))).join(' ');
  return redactSecrets(`git ${rendered}`).slice(0, 500);
}

/**
 * Map git stderr to a shared `ErrorCode`. Exported so callers can re-classify
 * failures without re-implementing the heuristics.
 */
export function classifyGitFailure(stderr: string, exitCode: number): ErrorCodeValue {
  const text = stderr.toLowerCase();
  if (text.includes('not a git repository') || text.includes('not a working tree') || text.includes('this operation must be run in a work tree')) {
    return ErrorCode.NOT_A_GIT_REPO;
  }
  if (
    text.includes('unknown revision') ||
    text.includes('bad revision') ||
    text.includes('ambiguous argument') ||
    text.includes('needed a single revision') ||
    text.includes('not a valid object name') ||
    text.includes('bad object') ||
    text.includes('invalid object name') ||
    text.includes('does not have any commits yet')
  ) {
    return ErrorCode.REVISION_NOT_FOUND;
  }
  if (text.includes('did not match any file') || text.includes('pathspec') || text.includes('does not exist in')) {
    return ErrorCode.NOT_FOUND;
  }
  if (text.includes('shallow') || text.includes('grafted')) {
    return ErrorCode.SHALLOW_HISTORY;
  }
  if (text.includes('is not a blob') || text.includes('is a tree') || text.includes('is a directory')) {
    return ErrorCode.UNSUPPORTED_FORMAT;
  }
  if (text.includes('pre-receive hook declined') || text.includes('hook declined') || text.includes('hook rejected')) {
    return ErrorCode.HOOK_REJECTED;
  }
  if (text.includes('non-fast-forward') || text.includes('fetch first') || text.includes('updates were rejected')) {
    return ErrorCode.PUSH_REJECTED_NON_FF;
  }
  if (text.includes('could not resolve host') || text.includes('failed to connect') || text.includes('connection timed out') || text.includes('network is unreachable') || text.includes('unable to access') || text.includes('connection refused') || text.includes('operation timed out')) {
    return ErrorCode.NETWORK_UNREACHABLE;
  }
  if (
    text.includes('authentication failed') ||
    text.includes('could not read username') ||
    text.includes('could not read password') ||
    text.includes('terminal prompts disabled') ||
    text.includes('permission denied (publickey)') ||
    text.includes('access denied') ||
    text.includes('invalid username or password')
  ) {
    return ErrorCode.GITLAB_AUTH_FAILED;
  }
  if (text.includes('already exists') && (text.includes('branch') || text.includes('worktree') || text.includes('directory'))) {
    return ErrorCode.WORKSPACE_NAME_CONFLICT;
  }
  if (text.includes('already checked out') || text.includes('already registered') || text.includes('would be overwritten')) {
    return ErrorCode.CONFLICT;
  }
  if (exitCode === 129) return ErrorCode.VALIDATION_FAILED;
  return ErrorCode.INTERNAL_ERROR;
}

function assertArgsShape(args: readonly string[]): void {
  if (!Array.isArray(args) || args.length === 0) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'git 参数必须是非空字符串数组');
  }
  for (const arg of args) {
    if (typeof arg !== 'string') throw new AppError(ErrorCode.VALIDATION_FAILED, 'git 参数必须是字符串');
    if (arg.includes('\0')) throw new AppError(ErrorCode.VALIDATION_FAILED, 'git 参数不能包含 NUL');
  }
}

function resolveCwd(cwd: string): string {
  if (typeof cwd !== 'string' || cwd.length === 0) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'git 执行目录不能为空');
  }
  try {
    const stat = statSync(cwd);
    if (!stat.isDirectory()) throw new AppError(ErrorCode.REPO_PATH_UNAVAILABLE, 'git 执行目录不是文件夹');
    return cwd;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(ErrorCode.REPO_PATH_UNAVAILABLE, 'git 执行目录不存在或不可访问', { details: { reason: 'cwd_unavailable' } });
  }
}

function execute(args: readonly string[], options: GitRunOptions): Promise<GitRunBytesResult> {
  assertArgsShape(args);
  const cwd = resolveCwd(options.cwd);
  const timeoutMs = options.timeoutMs ?? GIT_LIMITS.defaultTimeoutMs;
  const maxOutputBytes = options.maxOutputBytes ?? GIT_LIMITS.maxOutputBytes;
  const allowOutputOverflow = options.allowOutputOverflow === true;
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...GIT_CHILD_ENV,
    ...options.env,
  };
  const binary = options.gitBinary ?? 'git';

  return new Promise<GitRunBytesResult>((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(binary, [...GIT_GLOBAL_ARGS, ...args], {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(new AppError(ErrorCode.GIT_CAPABILITY_UNAVAILABLE, '无法启动 git 进程', { details: { reason: error instanceof Error ? error.message : 'spawn_failed' } }));
      return;
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timedOut = false;
    let overflow = false;
    let overflowTruncated = false;
    let timer: NodeJS.Timeout | undefined;

    const settleReject = (error: unknown): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      reject(error);
    };
    const settleResolve = (result: GitRunBytesResult): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(result);
    };
    const kill = (): void => {
      if (!child.killed) child.kill('SIGKILL');
    };

    timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    timer.unref?.();

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxOutputBytes) {
        overflow = true;
        if (allowOutputOverflow) {
          overflowTruncated = true;
          const used = stdoutBytes - chunk.length;
          const remaining = Math.max(0, maxOutputBytes - used);
          if (remaining > 0) stdoutChunks.push(chunk.subarray(0, remaining));
        }
        kill();
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      // Keep stderr bounded too; it is only ever used for diagnostics.
      if (stderrBytes >= 1_000_000) return;
      const remaining = Math.max(0, 1_000_000 - stderrBytes);
      const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      stderrChunks.push(slice);
      stderrBytes += slice.length;
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      const code = error.code === 'ENOENT' ? ErrorCode.GIT_CAPABILITY_UNAVAILABLE : ErrorCode.INTERNAL_ERROR;
      const message = error.code === 'ENOENT' ? '未找到 git 可执行文件（需要本机安装 git）' : 'git 进程启动失败';
      settleReject(new AppError(code, message, { details: { reason: error.code ?? 'spawn_error' } }));
    });
    child.on('close', (code, signal) => {
      const stdout = Buffer.concat(stdoutChunks);
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      if (timedOut) {
        settleReject(new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, 'git 命令执行超时', { details: { timeoutMs, signal: signal ?? 'SIGKILL' } }));
        return;
      }
      if (overflow && !allowOutputOverflow) {
        settleReject(new AppError(ErrorCode.TRUNCATED, `git 输出超过上限（${maxOutputBytes} 字节）`, { details: { maxOutputBytes } }));
        return;
      }
      if (overflow && allowOutputOverflow) {
        settleResolve({ stdout, stderr, exitCode: 0, truncated: true });
        return;
      }
      const exitCode = typeof code === 'number' ? code : 1;
      if (exitCode !== 0) {
        const allowed = options.allowedExitCodes ?? [];
        if (!allowed.includes(exitCode)) {
          settleReject(
            new GitCommandError({
              args,
              stdout: stdout.toString('utf8'),
              stderr,
              exitCode,
              code: classifyGitFailure(stderr, exitCode),
            }),
          );
          return;
        }
      }
      settleResolve({ stdout, stderr, exitCode, truncated: overflowTruncated });
    });

    if (options.input !== undefined) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
}

/** Execute git with trusted arguments and capture UTF-8 output. */
export async function runGit(args: readonly string[], options: GitRunOptions): Promise<GitRunResult> {
  const result = await execute(args, options);
  return { stdout: result.stdout.toString('utf8'), stderr: result.stderr, exitCode: result.exitCode, truncated: result.truncated };
}

/** Execute git with trusted arguments and capture raw bytes (binary-safe). */
export async function runGitBytes(args: readonly string[], options: GitRunOptions): Promise<GitRunBytesResult> {
  return execute(args, options);
}

/**
 * Defensive variant: rejects any argument that starts with `-`, so caller
 * values can never be interpreted as git options. The subcommand itself is
 * passed separately and must not start with `-`.
 */
export async function runGitChecked(subcommand: string, values: readonly string[], options: GitRunOptions): Promise<GitRunResult> {
  const command = assertCliValue(subcommand, 'git subcommand');
  if (command.startsWith('-')) throw new AppError(ErrorCode.VALIDATION_FAILED, 'git subcommand 不能以 - 开头');
  const safeValues = values.map((value, index) => assertCliValue(value, `git 参数 #${index}`));
  return runGit([command, ...safeValues], options);
}
