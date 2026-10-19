import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ModelProfile, RoleDefinition } from '@agent-workflow/shared';
import { AppError, ErrorCode } from '@agent-workflow/shared';
import { OpenCodeManager, SessionRunner, type OpenCodeManagerStatus, type OpenCodeSession, type PromptOutcome, type SessionSink } from '@agent-workflow/opencode';
import type { OpenCodePort, OpenCodeRunRequest, OpenCodeRunResult } from '@agent-workflow/engine';

export interface OpenCodeAdapterOptions {
  readonly dataDir: string;
  readonly repoRoot: string;
  readonly binaryPath: string;
  readonly expectedVersion: string;
  readonly host: string;
  readonly port: number;
  readonly startupTimeoutMs: number;
  readonly shutdownTimeoutMs: number;
  readonly mcpServerName: string;
  readonly mcpCommand: readonly string[];
  readonly mcpEnvironment: Record<string, string>;
  readonly maxSessions: number;
  readonly model: ModelProfile;
  readonly defaultAgent: string;
  readonly logPath: string;
  readonly configPath: string;
  readonly cwd?: string;
  readonly providerOverrides?: Record<string, unknown>;
}

export function readOnlyPermission(): unknown[] {
  return [
    { permission: '*', pattern: '*', action: 'allow' },
    { permission: 'edit', pattern: '*', action: 'deny' },
    { permission: 'bash', pattern: '*', action: 'deny' },
    { permission: 'webfetch', pattern: '*', action: 'deny' },
    { permission: 'websearch', pattern: '*', action: 'deny' },
    { permission: 'external_directory', pattern: '*', action: 'deny' },
  ];
}

export function workspacePermission(): unknown[] {
  return [
    { permission: '*', pattern: '*', action: 'allow' },
    { permission: 'edit', pattern: '*', action: 'deny' },
    { permission: 'bash', pattern: '*', action: 'deny' },
    { permission: 'webfetch', pattern: '*', action: 'deny' },
    { permission: 'websearch', pattern: '*', action: 'deny' },
    { permission: 'external_directory', pattern: '*', action: 'deny' },
  ];
}

/** Freeze the effective tool ceiling into the actual OpenCode session. */
export function rolePermission(role: RoleDefinition, mcpServerName: string): unknown[] {
  const tools = role.resourcePermissions?.tools ?? [];
  const enabled = (id: string) => role.capabilityGroups?.flatMap((group) => group.items).find((item) => item.id === id)?.enabled === true;
  const names = tools.filter((tool) => tool.kind === 'mcp' && enabled('external_mcp')).map((tool) => tool.name);
  return [
    { permission: '*', pattern: '*', action: 'deny' },
    ...['workflow.context.get', 'workflow.result.submit', ...names].map((name) => ({ permission: `${mcpServerName}_${name.replaceAll('.', '_')}`, pattern: '*', action: 'allow' })),
  ];
}

/**
 * Single managed OpenCode 1.19.0 service. All file/command effects flow through
 * this product's MCP server, so the service cwd stays neutral and built-in
 * write tools are denied.
 */
export class OpenCodeAdapter implements OpenCodePort {
  readonly #manager: OpenCodeManager;
  readonly #options: OpenCodeAdapterOptions;
  #activeSessions = 0;
  #starting: Promise<void> | undefined;

  constructor(options: OpenCodeAdapterOptions) {
    this.#options = options;
    mkdirSync(resolve(options.dataDir, 'opencode'), { recursive: true });
    this.#manager = new OpenCodeManager({
      binaryPath: options.binaryPath,
      expectedVersion: options.expectedVersion,
      host: options.host,
      port: options.port,
      cwd: options.cwd ?? options.repoRoot,
      dataDir: options.dataDir,
      startupTimeoutMs: options.startupTimeoutMs,
      shutdownTimeoutMs: options.shutdownTimeoutMs,
      configPath: options.configPath,
      logPath: options.logPath,
      config: {
        model: { providerID: options.model.provider, modelID: options.model.model },
        mcp: {
          [options.mcpServerName]: {
            type: 'local',
            command: [...options.mcpCommand],
            environment: options.mcpEnvironment,
            enabled: true,
            timeout: 30000,
          },
        },
        permission: {
          read: 'allow',
          glob: 'allow',
          grep: 'allow',
          list: 'allow',
          edit: 'deny',
          bash: 'deny',
          webfetch: 'deny',
          websearch: 'deny',
          external_directory: 'deny',
          todowrite: 'allow',
          question: 'allow',
        },
        agent: {
          build: { model: `${options.model.provider}/${options.model.model}` },
        },
        extra: {
          autoupdate: false,
          ...(options.providerOverrides === undefined ? {} : { provider: options.providerOverrides }),
        },
      },
    });
  }

  status(): OpenCodeManagerStatus {
    return this.#manager.status;
  }

  async ensureReady(): Promise<void> {
    if (this.#manager.status.state === 'ready') return;
    if (this.#starting === undefined) {
      this.#starting = this.#manager.start().then((status) => {
        this.#starting = undefined;
        if (status.state !== 'ready') throw new AppError(ErrorCode.OPENCODE_NOT_READY, status.lastError ?? '受管 OpenCode 服务未就绪');
      });
    }
    await this.#starting;
  }

  async runSession(request: OpenCodeRunRequest): Promise<OpenCodeRunResult> {
    await this.ensureReady();
    if (this.#activeSessions >= this.#options.maxSessions) {
      throw new AppError(ErrorCode.OPENCODE_SESSION_LIMIT, `受管 OpenCode 并发会话已达上限（${String(this.#options.maxSessions)}），请稍后重试或调高设置`, {
        details: { maxSessions: this.#options.maxSessions, activeSessions: this.#activeSessions },
      });
    }
    this.#activeSessions += 1;
    try {
    const client = this.#manager.client;
    const session = await client.createSession({
      title: `${request.kind} · ${request.metadata.taskId ?? request.metadata.projectId ?? ''}`.slice(0, 120),
      metadata: { ...request.metadata, managedBy: 'agent-workflow' },
      agent: this.#options.defaultAgent,
      model: { id: request.model.model, providerID: request.model.provider },
      permission: request.rolePolicy === undefined
        ? request.permission === 'read_only' ? readOnlyPermission() : workspacePermission()
        : rolePermission(request.rolePolicy, this.#options.mcpServerName),
    });
    request.onSessionId?.(session.id);
    const runner = new SessionRunner(client, session.id, request.sink);
    const outcome: PromptOutcome = await runner.run(
      {
        text: request.prompt,
        model: { providerID: request.model.provider, modelID: request.model.model },
        agent: this.#options.defaultAgent,
        system: request.system,
        jsonSchema: request.jsonSchema,
      },
      {
        timeoutMs: request.timeoutMs,
        abortOnEvent: (event) => {
          if (event.type !== 'session.next.tool.success' && event.type !== 'session.next.tool.called') return false;
          const haystack = JSON.stringify(event.properties).toLowerCase();
          return (request.abortOnToolCall ?? []).some((name) => haystack.includes(name.toLowerCase()));
        },
        abortGraceMs: 1500,
      },
    );
    return { sessionId: session.id, outcome };
    } finally {
      this.#activeSessions = Math.max(0, this.#activeSessions - 1);
    }
  }

  async abortSession(sessionId: string): Promise<void> {
    if (this.#manager.status.state !== 'ready') throw new AppError(ErrorCode.OPENCODE_NOT_READY, '运行时不可用，无法确认停止');
    const aborted = await this.#manager.client.abort(sessionId);
    if (!aborted) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '运行时未确认会话停止');
  }

  async inspectSession(sessionId: string): Promise<'idle' | 'running' | 'unknown'> {
    if (this.#manager.status.state !== 'ready') return 'unknown';
    const statuses = await this.#manager.client.sessionStatuses();
    const state = statuses[sessionId]?.type;
    if (state === 'idle') return 'idle';
    if (state === 'busy' || state === 'retry') return 'running';
    return 'unknown';
  }

  async findSessions(metadata: Record<string, string>): Promise<readonly OpenCodeSession[]> {
    if (this.#manager.status.state !== 'ready') return [];
    const sessions = await this.#manager.client.listSessions();
    return sessions.filter((session) => {
      const sessionMetadata = (session as OpenCodeSession & { metadata?: Record<string, unknown> }).metadata;
      if (sessionMetadata === undefined) return false;
      return Object.entries(metadata).every(([key, value]) => sessionMetadata[key] === value);
    });
  }

  async stop(): Promise<void> {
    await this.#manager.stop();
  }

  onChange(listener: (status: OpenCodeManagerStatus) => void): () => void {
    return this.#manager.onChange(listener);
  }

  managerStatus(): OpenCodeManagerStatus {
    return this.#manager.status;
  }

  /** For diagnostics only; never exposes provider keys. */
  async diagnostics(): Promise<{ mcp: Record<string, { status: string }>; sessions: number; totalSessions: number }> {
    if (this.#manager.status.state !== 'ready') return { mcp: {}, sessions: 0, totalSessions: 0 };
    const client = this.#manager.client;
    const [mcp, sessions] = await Promise.all([client.mcpStatus().catch(() => ({})), client.listSessions().catch(() => [])]);
    // `sessions` is the enforced concurrency counter; listSessions includes
    // historical sessions that must not be compared with the live limit.
    return { mcp, sessions: this.#activeSessions, totalSessions: sessions.length };
  }
}

export type { SessionSink };
