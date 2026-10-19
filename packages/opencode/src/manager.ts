import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { OpenCodeClient, buildConfig } from './client.ts';
import type { OpenCodeConfigInput, OpenCodeManagerStatus, StartOptions } from './types.ts';

export interface ManagerOptions {
  readonly binaryPath: string;
  readonly expectedVersion: string;
  readonly host: string;
  readonly port: number;
  readonly cwd: string;
  readonly dataDir: string;
  readonly startupTimeoutMs: number;
  readonly shutdownTimeoutMs: number;
  readonly configPath: string;
  readonly logPath: string;
  readonly config: Omit<OpenCodeConfigInput, 'model'> & { readonly model: OpenCodeConfigInput['model'] };
  readonly env?: Record<string, string>;
}

/**
 * Owns exactly one OpenCode 1.19.0 server per application instance. The config
 * file is generated on every start and injects this project's MCP server, so
 * OpenCode↔product interactions always go through the managed MCP boundary.
 */
export class OpenCodeManager {
  readonly #options: ManagerOptions;
  #process: ChildProcess | undefined;
  #client: OpenCodeClient | undefined;
  #status: OpenCodeManagerStatus = { state: 'stopped' };
  #password: string | undefined;
  #listeners = new Set<(status: OpenCodeManagerStatus) => void>();
  #stopRequested = false;
  #exitHandled = false;

  constructor(options: ManagerOptions) {
    this.#options = options;
  }

  get status(): OpenCodeManagerStatus {
    return this.#status;
  }

  get client(): OpenCodeClient {
    if (this.#client === undefined) throw new Error('OpenCode server is not ready');
    return this.#client;
  }

  onChange(listener: (status: OpenCodeManagerStatus) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #setStatus(status: OpenCodeManagerStatus): void {
    this.#status = status;
    for (const listener of this.#listeners) {
      try {
        listener(status);
      } catch {
        // Listener failures are isolated from lifecycle handling.
      }
    }
  }

  async start(): Promise<OpenCodeManagerStatus> {
    if (this.#status.state === 'ready' || this.#status.state === 'starting') return this.#status;
    this.#stopRequested = false;
    this.#exitHandled = false;
    const options = this.#options;
    this.#setStatus({ state: 'starting' });
    try {
      mkdirSync(join(options.dataDir, 'opencode'), { recursive: true });
      mkdirSync(dirname(options.logPath), { recursive: true });
      const password = randomBytes(24).toString('base64url');
      this.#password = password;
      const config = buildConfig({
        model: options.config.model,
        mcp: options.config.mcp,
        permission: options.config.permission,
        agent: options.config.agent,
        instructions: options.config.instructions,
        extra: options.config.extra,
      });
      writeFileSync(options.configPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });

      const args = ['serve', '--hostname', options.host, '--port', String(options.port)];
      const child = spawn(options.binaryPath, args, {
        cwd: options.cwd,
        env: {
          ...process.env,
          ...options.env,
          OPENCODE_CONFIG: options.configPath,
          OPENCODE_SERVER_PASSWORD: password,
          OPENCODE_DISABLE_AUTOUPDATE: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.#process = child;
      const log = createWriteStream(options.logPath, { flags: 'a' });
      const start = Date.now();
      const pid = child.pid;
      this.#setStatus({ ...this.#status, pid });

      const endpoint = await new Promise<{ host: string; port: number }>((resolve, reject) => {
        let buffer = '';
        const timer = setTimeout(() => reject(new Error(`OpenCode 启动超时（${options.startupTimeoutMs}ms）`)), options.startupTimeoutMs);
        const onData = (chunk: Buffer) => {
          const text = chunk.toString();
          buffer += text;
          log.write(text);
          const match = /opencode server listening on http:\/\/([^\s:]+):(\d+)/.exec(buffer);
          if (match) {
            clearTimeout(timer);
            resolve({ host: match[1] ?? options.host, port: Number(match[2]) });
          }
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', (chunk: Buffer) => {
          log.write(chunk);
          if (/error/i.test(chunk.toString()) && buffer.length < 4000) buffer += chunk.toString();
        });
        child.once('exit', (code, signal) => {
          clearTimeout(timer);
          reject(new Error(`OpenCode 进程提前退出（code=${code ?? 'null'}, signal=${signal ?? 'null'}）`));
        });
        child.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });

      const client = new OpenCodeClient(`http://${endpoint.host}:${endpoint.port}`, password);
      let health: { healthy: boolean; version: string } | undefined;
      for (let attempt = 0; attempt < 40; attempt++) {
        try {
          health = await client.health();
          if (health.healthy) break;
        } catch {
          // The listening socket may accept slightly before health is ready.
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (health === undefined || !health.healthy) throw new Error('OpenCode 健康检查失败');
      if (health.version !== options.expectedVersion) {
        throw new Error(`OpenCode 版本不符：需要 ${options.expectedVersion}，实际 ${health.version}`);
      }
      this.#client = client;
      this.#exitHandled = false;
      child.once('exit', (code, signal) => {
        this.#exitHandled = true;
        this.#client = undefined;
        this.#process = undefined;
        if (!this.#stopRequested) {
          this.#setStatus({ state: 'failed', version: health?.version, lastError: `OpenCode 进程退出（code=${code ?? 'null'}, signal=${signal ?? 'null'}）` });
        }
      });
      this.#setStatus({
        state: 'ready',
        version: health.version,
        host: endpoint.host,
        port: endpoint.port,
        pid,
        startedAt: new Date(start).toISOString(),
        baseUrl: `http://${endpoint.host}:${endpoint.port}`,
      });
      return this.#status;
    } catch (error) {
      await this.stop();
      this.#setStatus({ state: 'failed', lastError: error instanceof Error ? redactMessage(error.message) : '未知错误' });
      return this.#status;
    }
  }

  async stop(): Promise<void> {
    this.#stopRequested = true;
    const child = this.#process;
    this.#process = undefined;
    this.#client = undefined;
    if (child !== undefined && child.exitCode === null) {
      child.kill('SIGTERM');
      await waitForExit(child, this.#options.shutdownTimeoutMs);
      if (child.exitCode === null) {
        child.kill('SIGKILL');
        await waitForExit(child, 2000);
      }
    }
    this.#setStatus({ state: 'stopped' });
  }

  async restart(): Promise<OpenCodeManagerStatus> {
    await this.stop();
    return this.start();
  }
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function redactMessage(message: string): string {
  return message.replace(/st_[A-Za-z0-9-]{8,}/g, '[key]').replace(/sk-[A-Za-z0-9-]{8,}/g, '[key]');
}

export function defaultOpenCodePaths(dataDir: string, cwd: string): Pick<StartOptions, 'configPath' | 'logPath' | 'cwd'> {
  const dir = join(dataDir, 'opencode');
  mkdirSync(dir, { recursive: true });
  return { configPath: join(dir, 'opencode.json'), logPath: join(dataDir, 'logs', 'opencode.log'), cwd };
}
