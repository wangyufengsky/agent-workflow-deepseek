import { createSessionScope } from '../session-scope.ts';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ModelProfile, RoleDefinition } from '@agent-workflow/shared';
import { AppError, ErrorCode } from '@agent-workflow/shared';
import { OpenCodeManager, SessionRunner, type OpenCodeManagerStatus, type OpenCodeSession, type PromptOutcome, type SessionSink } from '@agent-workflow/opencode';
import type { OpenCodePort, OpenCodeRunRequest, OpenCodeRunResult } from '@agent-workflow/engine';

export interface OpenCodeAdapterOptions {
  readonly sessionPolicy?: (request: OpenCodeRunRequest) => OpenCodeRunRequest;
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
    { permission: 'question', pattern: '*', action: 'allow' },
    ...['workflow.context.get', 'workflow.result.submit', ...names].map((name) => ({ permission: `${mcpServerName}_${name.replaceAll('.', '_')}`, pattern: '*', action: 'allow' })),
  ];
}

export function sessionPermission(request: OpenCodeRunRequest, mcpServerName: string): unknown[] {
  if ((request as OpenCodeRunRequest & { toolPolicy?: 'none' }).toolPolicy === 'none') return [{ permission: '*', pattern: '*', action: 'deny' }];
  if (request.allowedTools === undefined) return request.rolePolicy === undefined ? request.permission === 'read_only' ? readOnlyPermission() : workspacePermission() : rolePermission(request.rolePolicy, mcpServerName);
  const roleTools = request.rolePolicy?.resourcePermissions?.tools.filter((tool) => tool.kind === 'mcp').map((tool) => tool.name);
  const allowed = request.allowedTools.filter((name) => (roleTools === undefined || name === 'workflow.context.get' || name === 'workflow.result.submit' || roleTools.includes(name)) && (request.permission !== 'read_only' || !['workspace.exec', 'workspace.file.write'].includes(name)));
  return [{ permission: '*', pattern: '*', action: 'deny' }, { permission: 'question', pattern: '*', action: 'allow' }, ...allowed.map((name) => ({ permission: `${mcpServerName}_${name.replaceAll('.', '_')}`, pattern: '*', action: 'allow' }))];
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
  #pendingSessions = 0;
  #maintenance = false;
  readonly #interactionSessions = new Map<string, OpenCodeRunRequest>();
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
        if (status.state !== 'ready') throw new AppError(ErrorCode.OPENCODE_NOT_READY, status.lastError ?? '受管 OpenCode 服务未就绪');
      }).finally(() => { this.#starting = undefined; });
    }
    await this.#starting;
  }

  beginMaintenance(): () => void {
    if (this.#maintenance || this.#pendingSessions > 0) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '运行时仍有活动会话或维护操作，请先停止并核对');
    this.#maintenance = true;
    let released = false;
    return () => { if (!released) { released = true; this.#maintenance = false; } };
  }

  async verifyMaintenanceIdle(): Promise<void> {
    if (!this.#maintenance) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '必须先持有运行时维护锁');
    if (this.#manager.status.state !== 'ready' && this.#manager.status.state !== 'degraded') return;
    const statuses = await this.#manager.client.request<Record<string, { type?: string }>>('/session/status');
    if (statuses === null || typeof statuses !== 'object' || Array.isArray(statuses)) throw new AppError(ErrorCode.OPENCODE_NOT_READY, '远程会话状态未知，禁止重启');
    const activeIds = Object.entries(statuses).filter(([, status]) => status?.type !== 'idle').map(([id]) => id);
    if (activeIds.length > 0) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, 'OpenCode 仍有活动或未知会话，禁止重启', { details: { sessionIds: activeIds } });
  }

  async runSession(request: OpenCodeRunRequest): Promise<OpenCodeRunResult> {
    if (this.#maintenance) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '运行时正在维护，暂不接受新会话');
    this.#pendingSessions += 1;
    try { return await this.#runSession(request); }
    finally { this.#pendingSessions -= 1; }
  }

  async #runSession(request: OpenCodeRunRequest): Promise<OpenCodeRunResult> {
    await this.ensureReady();
    if (this.#activeSessions >= this.#options.maxSessions) {
      throw new AppError(ErrorCode.OPENCODE_SESSION_LIMIT, `受管 OpenCode 并发会话已达上限（${String(this.#options.maxSessions)}），请稍后重试或调高设置`, {
        details: { maxSessions: this.#options.maxSessions, activeSessions: this.#activeSessions },
      });
    }
    request = this.#options.sessionPolicy?.(request) ?? request;
    this.#activeSessions += 1;
    const scope = createSessionScope(request);
    let interactionSessionId: string | undefined;
    try {
    const client = this.#manager.client;
    const session = await client.createSession({
      title: `${request.kind} · ${request.metadata.taskId ?? request.metadata.projectId ?? ''}`.slice(0, 120),
      metadata: { ...request.metadata, managedBy: 'agent-workflow' },
      agent: this.#options.defaultAgent,
      model: { id: request.model.model, providerID: request.model.provider },
      permission: sessionPermission(request, this.#options.mcpServerName),
    });
    interactionSessionId = session.id;
    this.#interactionSessions.set(session.id, structuredClone({ ...request, sink: {}, onSessionId: undefined }));
    request.onSessionId?.(session.id);
    const runner = new SessionRunner(client, session.id, request.sink);
    const outcome: PromptOutcome = await runner.run(
      {
        text: request.prompt,
        model: { providerID: request.model.provider, modelID: request.model.model },
        agent: this.#options.defaultAgent,
        system: `${request.system ?? ""}\n\n会话工具授权：每次 MCP 工具调用必须携带参数 scopeToken: "${scope.token}"。此授权仅用于当前任务，不得改变 taskId、nodeId、attemptId、roundId 或 projectId。`,
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
      scope.revoke();
      if (interactionSessionId !== undefined) this.#interactionSessions.delete(interactionSessionId);
      this.#activeSessions = Math.max(0, this.#activeSessions - 1);
    }
  }

  runtimeRequests(sessionId: string, kind: 'permission' | 'question', protocol: 'legacy' | 'v2') { return this.#manager.client.runtimeRequests(sessionId, kind, protocol); }
  replyRuntimePermission(sessionId: string, requestId: string, reply: 'once' | 'reject', protocol: 'legacy' | 'v2') { return this.#manager.client.replyRuntimePermission(sessionId, requestId, reply, protocol); }
  replyRuntimeQuestion(sessionId: string, requestId: string, answers: readonly (readonly string[])[] | undefined, protocol: 'legacy' | 'v2') { return this.#manager.client.replyRuntimeQuestion(sessionId, requestId, answers, protocol); }
  runtimePermissionAllowed(sessionId: string, permission: import('@agent-workflow/opencode').PermissionRequest): boolean {
    const frozen = this.#interactionSessions.get(sessionId);
    if (frozen === undefined || permission.sessionID !== sessionId || permission.patterns.length === 0) return false;
    const current = this.#options.sessionPolicy?.(frozen) ?? frozen;
    // Only guarded, read-only MCP tools are eligible. Native file/command and
    // unknown permissions never gain access through this interaction surface.
    const readTools = ['workflow.context.get', 'workspace.file.read', 'workspace.file.list', 'git.repo.status', 'git.log', 'git.diff.files', 'git.commit.show', 'database.query'];
    const tool = readTools.find((name) => permission.permission === `${this.#options.mcpServerName}_${name.replaceAll('.', '_')}`);
    if (tool === undefined) return false;
    const includes = (request: OpenCodeRunRequest) => {
      if (request.toolPolicy === 'none' || request.allowedTools?.includes(tool) === false) return false;
      if (request.rolePolicy !== undefined && tool !== 'workflow.context.get' && request.rolePolicy.capabilityGroups?.flatMap((group) => group.items).find((item) => item.id === 'external_mcp')?.enabled !== true) return false;
      const roleTools = request.rolePolicy?.resourcePermissions?.tools.filter((item) => item.kind === 'mcp').map((item) => item.name);
      return roleTools === undefined || tool === 'workflow.context.get' || roleTools.includes(tool);
    };
    return includes(frozen) && includes(current);
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

  async sessionMessages(sessionId: string) {
    if (this.#manager.status.state !== 'ready') throw new AppError(ErrorCode.OPENCODE_NOT_READY, '受管 OpenCode 未就绪，无法读取原会话');
    return this.#manager.client.messages(sessionId);
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
    if (this.#manager.status.state !== 'ready') return { mcp: {}, sessions: this.#pendingSessions, totalSessions: 0 };
    const client = this.#manager.client;
    const [mcp, sessions] = await Promise.all([client.mcpStatus().catch(() => ({})), client.listSessions().catch(() => [])]);
    // `sessions` is the enforced concurrency counter; listSessions includes
    // historical sessions that must not be compared with the live limit.
    return { mcp, sessions: this.#pendingSessions, totalSessions: sessions.length };
  }
}

export type { SessionSink };
