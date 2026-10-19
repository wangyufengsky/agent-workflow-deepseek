import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { AppError, ErrorCode } from '@agent-workflow/shared';

/**
 * Sandboxed local command runner used as a fallback when the internal loopback
 * service is unavailable. Commands never go through a shell: the string is
 * tokenised, matched against configured token prefixes and spawned directly.
 * Output is truncated and child processes get a sanitised environment so the
 * MCP token can never leak into a tool run.
 */
export interface WorkspaceExecOptions {
  readonly cwd: string;
  readonly allowedCommands: readonly string[];
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  /** Extra environment overrides; merged over the sanitised allowlist. */
  readonly env?: Record<string, string>;
}

export interface ExecTruncation {
  readonly stdout: boolean;
  readonly stderr: boolean;
}

export interface ExecResult {
  readonly command: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly truncated: ExecTruncation;
}

export interface CommandAllowlist {
  readonly entries: readonly string[];
  allows(command: string): boolean;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_COMMAND_LENGTH = 16_384;
const KILL_GRACE_MS = 2_000;

/** Parse a command line into argv without invoking a shell. */
export function tokenizeCommand(command: string): string[] {
  if (typeof command !== 'string') {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'command 必须是字符串', { details: { field: 'command' } });
  }
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'command 不能为空', { details: { field: 'command' } });
  }
  if (trimmed.length > MAX_COMMAND_LENGTH) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `command 长度超过 ${MAX_COMMAND_LENGTH} 字符`, { details: { field: 'command' } });
  }
  if (trimmed.includes('\u0000')) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'command 包含非法字符', { details: { field: 'command' } });
  }
  const argv: string[] = [];
  let current = '';
  let tokenStarted = false;
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index] ?? '';
    if (quote !== undefined) {
      if (char === '\\' && quote === '"' && trimmed[index + 1] !== undefined) {
        current += trimmed[index + 1] ?? '';
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = undefined;
        continue;
      }
      current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      tokenStarted = true;
      continue;
    }
    if (char === '\\' && trimmed[index + 1] !== undefined) {
      current += trimmed[index + 1] ?? '';
      index += 1;
      tokenStarted = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (tokenStarted) {
        argv.push(current);
        current = '';
        tokenStarted = false;
      }
      continue;
    }
    current += char;
    tokenStarted = true;
  }
  if (quote !== undefined) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'command 引号未闭合', { details: { field: 'command' } });
  }
  if (tokenStarted) argv.push(current);
  if (argv.length === 0 || argv[0] === undefined || argv[0].length === 0) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'command 不能为空', { details: { field: 'command' } });
  }
  return argv;
}

/** Token-prefix allowlist: `["git status"]` permits `git status --short` but not `git push`. */
export function createCommandAllowlist(entries: readonly string[]): CommandAllowlist {
  const prefixes: string[][] = [];
  for (const entry of entries) {
    if (typeof entry !== 'string' || entry.trim().length === 0) continue;
    try {
      prefixes.push(tokenizeCommand(entry));
    } catch {
      // Ignore malformed configuration entries; they can never match.
    }
  }
  return {
    entries: [...entries],
    allows(command: string): boolean {
      let argv: string[];
      try {
        argv = tokenizeCommand(command);
      } catch {
        return false;
      }
      return prefixes.some((prefix) => prefix.length <= argv.length && prefix.every((token, index) => argv[index] === token));
    },
  };
}

export class WorkspaceExec {
  readonly cwd: string;
  readonly allowlist: CommandAllowlist;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly #envOverrides: Record<string, string>;

  constructor(options: WorkspaceExecOptions) {
    this.cwd = options.cwd;
    this.allowlist = createCommandAllowlist(options.allowedCommands);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    this.#envOverrides = options.env ?? {};
  }

  get enabled(): boolean {
    return this.allowlist.entries.length > 0;
  }

  get configured(): boolean {
    return this.cwd.trim().length > 0;
  }

  async run(command: unknown): Promise<ExecResult> {
    if (!this.enabled) {
      throw new AppError(ErrorCode.FORBIDDEN, 'workspace.exec 未启用（AGENT_WORKFLOW_ALLOWED_COMMANDS 为空）', {
        details: { reason: 'exec_disabled' },
      });
    }
    if (!this.configured) {
      throw new AppError(ErrorCode.NOT_CONFIGURED, '本地 workspace 根未配置（AGENT_WORKFLOW_WORKTREE）', {
        details: { field: 'AGENT_WORKFLOW_WORKTREE' },
      });
    }
    if (typeof command !== 'string') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'command 必须是字符串', { details: { field: 'command' } });
    }
    const argv = tokenizeCommand(command);
    if (!this.allowlist.allows(command)) {
      throw new AppError(ErrorCode.FORBIDDEN, `命令不在白名单内：${argv[0]}`, {
        details: { reason: 'command_not_allowed', program: argv[0] },
      });
    }
    const cwd = await resolveCwd(this.cwd);
    return spawnCommand(argv, {
      cwd,
      timeoutMs: this.timeoutMs,
      maxOutputBytes: this.maxOutputBytes,
      env: sanitizedEnv(this.#envOverrides),
    });
  }
}

interface SpawnOptions {
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly env: NodeJS.ProcessEnv;
}

function spawnCommand(argv: readonly string[], options: SpawnOptions): Promise<ExecResult> {
  const program = argv[0];
  if (program === undefined) {
    return Promise.reject(new AppError(ErrorCode.VALIDATION_FAILED, 'command 不能为空'));
  }
  const startedAt = performance.now();
  return new Promise<ExecResult>((resolvePromise, rejectPromise) => {
    let settled = false;
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;

    const child = spawn(program, argv.slice(1), {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const append = (chunks: Buffer[], current: number, chunk: Buffer): { bytes: number; truncated: boolean } => {
      const remaining = options.maxOutputBytes - current;
      if (remaining <= 0) return { bytes: current, truncated: true };
      if (chunk.length <= remaining) {
        chunks.push(chunk);
        return { bytes: current + chunk.length, truncated: false };
      }
      chunks.push(chunk.subarray(0, remaining));
      return { bytes: options.maxOutputBytes, truncated: true };
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      const result = append(stdoutChunks, stdoutBytes, chunk);
      stdoutBytes = result.bytes;
      stdoutTruncated = stdoutTruncated || result.truncated;
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const result = append(stderrChunks, stderrBytes, chunk);
      stderrBytes = result.bytes;
      stderrTruncated = stderrTruncated || result.truncated;
    });

    const finish = (result: { exitCode: number | null; signal: string | null }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer !== undefined) clearTimeout(killTimer);
      resolvePromise({
        command: argv.join(' '),
        exitCode: result.exitCode,
        signal: result.signal,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        timedOut,
        truncated: { stdout: stdoutTruncated, stderr: stderrTruncated },
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
      killTimer.unref();
    }, options.timeoutMs);

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer !== undefined) clearTimeout(killTimer);
      const code = error.code === 'ENOENT' ? ErrorCode.VALIDATION_FAILED : ErrorCode.INTERNAL_ERROR;
      rejectPromise(
        new AppError(code, error.code === 'ENOENT' ? `命令不存在：${program}` : '命令启动失败', {
          details: { reason: 'spawn_failed', program, spawnCode: error.code },
        }),
      );
    });

    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => finish({ exitCode: code, signal }));
  });
}

async function resolveCwd(cwd: string): Promise<string> {
  try {
    return await realpath(cwd);
  } catch {
    throw new AppError(ErrorCode.WORKSPACE_NOT_READY, '本地 workspace 根不存在', { details: { reason: 'root_missing' } });
  }
}

const ENV_ALLOWLIST = ['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ'] as const;

/** Child processes get a minimal env; credentials such as the MCP token are dropped. */
function sanitizedEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { TERM: 'dumb' };
  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) env[key] = value;
  return env;
}
