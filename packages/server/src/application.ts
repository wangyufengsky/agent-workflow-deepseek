import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import type { AppSettings, ModelProfile } from '@agent-workflow/shared';
import { DEFAULT_SETTINGS, AppError, ErrorCode, mergeSettings, nowIso } from '@agent-workflow/shared';
import { Store } from '@agent-workflow/storage';
import { Engine, type OpenCodePort, type OpenCodeRunRequest, type OpenCodeRunResult, type DatabasePort } from '@agent-workflow/engine';
import type { OpenCodeManagerStatus, OpenCodeSession } from '@agent-workflow/opencode';
import { DatabaseService, createDatabasePort } from '@agent-workflow/database';
import { GitCliAdapter } from './adapters/git-cli.ts';
import { OpenCodeAdapter } from './adapters/opencode.ts';
import { registerCors, registerErrorHandler, registerRoutes } from './http.ts';
import { registerInternalRoutes } from './internal.ts';
import { registerProviderGateway } from './opencode-gateway.ts';
import { RemoteService } from './remote.ts';
import { registerReviewRoutes } from './review-plugin.ts';
import { registerDirectoryApplyRoutes } from './directory-apply-plugin.ts';
import { mcpCommand, resolveRuntime, type RuntimePaths } from './runtime.ts';

export interface CreateApplicationOptions {
  readonly dataDir?: string;
  readonly port?: number;
  readonly host?: string;
  readonly disableOpenCode?: boolean;
  readonly disableListen?: boolean;
  readonly settings?: Partial<AppSettings>;
  readonly internalToken?: string;
}

export interface RunningApplication {
  readonly app: FastifyInstance;
  readonly store: Store;
  readonly engine: Engine;
  readonly paths: RuntimePaths;
  readonly internalToken: string;
  readonly adapter: OpenCodeAdapter | undefined;
  readonly url: string;
  close(): Promise<void>;
}

const APP_VERSION = '0.1.0';

export async function createApplication(options: CreateApplicationOptions = {}): Promise<RunningApplication> {
  const paths = resolveRuntime();
  const dataDir = options.dataDir === undefined ? paths.dataDir : options.dataDir;
  const store = new Store({ dataDir });
  const baseSettings = mergeSettings(DEFAULT_SETTINGS, {
    ...(store.settings.getSettings() ?? {}),
    ...(options.settings ?? {}),
  }) as AppSettings;
  const internalToken = options.internalToken ?? randomBytes(24).toString('base64url');
  const gatewaySecret = randomBytes(18).toString('base64url');
  const gatewaySettings = baseSettings.opencode.providerGateway;
  let gateway: ReturnType<typeof registerProviderGateway> | undefined;

  let adapter: OpenCodeAdapter | undefined;
  const opencodeRef: { current?: OpenCodeAdapter | undefined } = {};
  const opencodeProxy: OpenCodePort = {
    status: (): OpenCodeManagerStatus => adapter?.status() ?? { state: 'stopped' },
    ensureReady: async () => {
      if (adapter === undefined) throw new AppError(ErrorCode.OPENCODE_NOT_READY, '受管 OpenCode 服务未启用');
      await adapter.ensureReady();
    },
    runSession: async (request: OpenCodeRunRequest): Promise<OpenCodeRunResult> => {
      if (adapter === undefined) throw new AppError(ErrorCode.OPENCODE_NOT_READY, '受管 OpenCode 服务未启用');
      return adapter.runSession(request);
    },
    abortSession: async (sessionId: string) => {
      await adapter?.abortSession(sessionId);
    },
    findSessions: async (metadata: Record<string, string>): Promise<readonly OpenCodeSession[]> => {
      if (adapter === undefined) return [];
      return adapter.findSessions(metadata);
    },
  };

  const remoteService = new RemoteService(store);
  const git = new GitCliAdapter(baseSettings.git.commandTimeoutMs, `${dataDir}/merge-tmp`, () => remoteService.currentToken());
  const databaseService = new DatabaseService({ settings: baseSettings.database, secrets: store.secrets });
  const database: DatabasePort = createDatabasePort(databaseService);
  const engine = new Engine({
    store,
    ports: { git, opencode: opencodeProxy, database, remote: remoteService },
    integration: {
      opencodeReady: () => opencodeProxy.status().state === 'ready',
      gitlabConfigured: () => false,
    },
  });

  const app = Fastify({ logger: false, bodyLimit: 8 * 1024 * 1024, disableRequestLogging: true });
  const startedAt = nowIso();
  if (gatewaySettings.enabled) {
    gateway = registerProviderGateway(app, {
      secret: gatewaySecret,
      upstreamBaseUrl: gatewaySettings.upstreamBaseUrl,
      stripToolChoiceForModels: gatewaySettings.stripToolChoiceForModels,
      requestTimeoutMs: gatewaySettings.requestTimeoutMs,
      logPath: `${dataDir}/logs/provider-gateway.jsonl`,
    });
  }
  registerCors(app, baseSettings.server.corsOrigins);
  registerErrorHandler(app, (error) => {
    if (process.env.AGENT_WORKFLOW_DEBUG === '1') console.error('[http]', error);
  });
  registerRoutes(app, {
    engine,
    store,
    opencodeRef,
    databaseService,
    gateway,
    remoteService,
    paths: { ...paths, dataDir },
    internalToken,
    appVersion: APP_VERSION,
    startedAt,
  });

  registerInternalRoutes(app, { engine, store, token: internalToken, internalUrl: '' });
  registerReviewRoutes(app, { engine, store });
  registerDirectoryApplyRoutes(app, { engine, store });
  app.addHook('onClose', async () => {
    await adapter?.stop().catch(() => undefined);
    await databaseService.closeAll().catch(() => undefined);
    store.close();
  });

  const host = options.host ?? process.env.AGENT_WORKFLOW_HOST ?? baseSettings.server.host;
  const envPort = process.env.AGENT_WORKFLOW_PORT === undefined ? undefined : Number(process.env.AGENT_WORKFLOW_PORT);
  const port = options.port ?? (Number.isFinite(envPort) ? envPort : undefined) ?? baseSettings.server.port;
  let url = `http://${host}:${port}`;

  if (options.disableListen !== true) {
    await app.listen({ host, port });
    const address = app.server.address();
    if (address !== null && typeof address === 'object') {
      url = `http://${host}:${address.port}`;
    }
  }


  const openCodeDisabled = options.disableOpenCode ?? process.env.AGENT_WORKFLOW_DISABLE_OPENCODE === '1';
  if (openCodeDisabled !== true && baseSettings.opencode.enabled) {
    const mcp = mcpCommand({ ...paths, dataDir });
    if (mcp.entryKind !== 'missing') {
      const planner = pickModel(baseSettings.models, 'planner') ?? baseSettings.models[0]!;
      adapter = new OpenCodeAdapter({
        dataDir,
        repoRoot: paths.repoRoot,
        binaryPath: baseSettings.opencode.binaryPath,
        expectedVersion: baseSettings.opencode.expectedVersion,
        host: baseSettings.opencode.host,
        port: baseSettings.opencode.port,
        startupTimeoutMs: baseSettings.opencode.startupTimeoutMs,
        shutdownTimeoutMs: baseSettings.opencode.shutdownTimeoutMs,
        mcpServerName: baseSettings.opencode.mcpServerName,
        maxSessions: baseSettings.opencode.maxSessions,
        mcpCommand: mcp.command,
        mcpEnvironment: {
          AGENT_WORKFLOW_INTERNAL_URL: url,
          AGENT_WORKFLOW_MCP_TOKEN: internalToken,
          AGENT_WORKFLOW_ALLOW_WRITE: '1',
          AGENT_WORKFLOW_DATA_DIR: dataDir,
          AGENT_WORKFLOW_ALLOWED_COMMANDS: baseSettings.git.defaultTestCommand,
          AGENT_WORKFLOW_TOOLSETS: baseSettings.opencode.toolsets.join(','),
          NODE_OPTIONS: '',
        },
        model: planner,
        defaultAgent: baseSettings.opencode.agent,
        logPath: `${dataDir}/logs/opencode.log`,
        configPath: `${dataDir}/opencode/opencode.json`,
        cwd: paths.repoRoot,
        ...(gatewaySettings.enabled
          ? {
              providerOverrides: {
                'opencode-go': {
                  options: {
                    baseURL: `${url}/api/opencode/gateway/${gatewaySecret}/v1`,
                  },
                },
              },
            }
          : {}),
      });
      opencodeRef.current = adapter;
      // Start in the background: the HTTP API must be reachable immediately.
      void adapter.ensureReady().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'OpenCode 启动失败';
        store.events.publish('opencode.status.changed', { status: 'failed', message });
      });
      adapter.onChange((status) => {
        store.events.publish('opencode.status.changed', { status: status.state, pid: status.pid, port: status.port, message: status.lastError });
      });
    }
  }

  return {
    app,
    store,
    engine,
    paths: { ...paths, dataDir },
    internalToken,
    adapter,
    url,
    async close() {
      await app.close();
    },
  };
}

function pickModel(models: readonly ModelProfile[], role: string): ModelProfile | undefined {
  return models.find((model) => model.enabled && model.roles.includes(role)) ?? models.find((model) => model.enabled);
}
