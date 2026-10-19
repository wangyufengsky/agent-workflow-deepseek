import type { DatabaseTypeValue, DeliveryGoalValue, DisplayModeValue, GitProviderValue, ThemeIdValue } from '../domain/enums.ts';
import type { ModelProfile } from '../domain/models.ts';

export interface DatabaseConnectionConfig {
  readonly id: string;
  readonly name: string;
  readonly type: DatabaseTypeValue;
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  /** Opaque reference into the local secrets store. Never a raw password. */
  readonly passwordRef?: string;
  readonly readOnly: boolean;
  readonly ssl: boolean;
}

export interface GitAuthorSettings {
  readonly name: string;
  readonly email: string;
}

export interface OpenCodeSettings {
  readonly enabled: boolean;
  readonly binaryPath: string;
  readonly expectedVersion: string;
  readonly host: string;
  readonly port: number;
  readonly autoStart: boolean;
  readonly startupTimeoutMs: number;
  readonly shutdownTimeoutMs: number;
  readonly agent: string;
  readonly permissionMode: 'allow' | 'ask' | 'deny';
  readonly mcpServerName: string;
  readonly toolsets: readonly string[];
  readonly maxSessions: number;
  readonly baseUrl?: string;
}

export interface GitSettings {
  readonly author: GitAuthorSettings;
  readonly defaultProvider: GitProviderValue;
  readonly github: { readonly baseUrl: string; readonly apiBaseUrl: string };
  readonly gitlab: { readonly baseUrl: string; readonly apiBaseUrl: string };
  readonly worktreeRoot: string;
  readonly branchPrefix: string;
  readonly defaultTestCommand: string;
  readonly fetchTimeoutMs: number;
  readonly commandTimeoutMs: number;
}

export interface DatabaseSettings {
  readonly connections: readonly DatabaseConnectionConfig[];
  readonly queryTimeoutMs: number;
  readonly rowLimit: number;
  readonly statementLimit: number;
}

export interface PlanningSettings {
  readonly maxDrafts: number;
  readonly maxRevisions: number;
  readonly transportRetries: number;
  readonly perDispatchLimitMinutes: number;
  readonly timeLimitMinutes: number;
  readonly budgetLimit: number;
  readonly currency: string;
  readonly maxNodes: number;
  readonly maxEdges: number;
  readonly maxGroups: number;
  readonly maxDepth: number;
  readonly previewTtlMinutes: number;
  readonly recordRetentionDays: number;
}

export interface ExecutionSettings {
  readonly autoAdvanceByDefault: boolean;
  readonly maxConcurrentNodes: number;
  readonly maxAttempts: number;
  readonly nodeTimeoutMinutes: number;
  readonly pauseTimeoutMs: number;
  readonly verifyCommandTimeoutMs: number;
}

export interface DeliverySettings {
  readonly defaultGoal: DeliveryGoalValue;
  readonly requirePushConfirmation: boolean;
  readonly requireMergeRequestConfirmation: boolean;
  readonly remoteBranchPrefix: string;
}

export interface UiSettings {
  readonly theme: ThemeIdValue;
  readonly displayMode: DisplayModeValue;
  readonly reducedMotion: boolean;
  readonly sidebarCollapsed: boolean;
  readonly locale: 'zh-CN' | 'en-US';
}

export interface ServerSettings {
  readonly host: string;
  readonly port: number;
  readonly corsOrigins: readonly string[];
}

export interface AppSettings {
  readonly ui: UiSettings;
  readonly server: ServerSettings;
  readonly opencode: OpenCodeSettings;
  readonly git: GitSettings;
  readonly database: DatabaseSettings;
  readonly planning: PlanningSettings;
  readonly execution: ExecutionSettings;
  readonly delivery: DeliverySettings;
  readonly models: readonly ModelProfile[];
}

/** Public (wire-safe) settings: secrets are never part of AppSettings. */
export type PublicSettings = AppSettings;

export const DEFAULT_MODEL_PROFILES: readonly ModelProfile[] = [
  { id: 'planner-go-pro', label: '规划 · opencode-go/deepseek-v4-pro', provider: 'opencode-go', model: 'deepseek-v4-pro', roles: ['planner'], enabled: true },
  { id: 'coder-go-pro', label: '开发 · opencode-go/deepseek-v4-pro', provider: 'opencode-go', model: 'deepseek-v4-pro', roles: ['coder'], enabled: true },
  { id: 'reviewer-go-pro', label: '审查 · opencode-go/deepseek-v4-pro', provider: 'opencode-go', model: 'deepseek-v4-pro', roles: ['reviewer'], enabled: true },
  { id: 'repairer-go-pro', label: '修复 · opencode-go/deepseek-v4-pro', provider: 'opencode-go', model: 'deepseek-v4-pro', roles: ['repairer'], enabled: true },
  // deepseek-v4.1-flash rejects tool_choice while thinking; keep it only for tool-free calls.
  { id: 'planner-go-flash', label: '规划（无工具）· opencode-go/deepseek-v4.1-flash', provider: 'opencode-go', model: 'deepseek-v4.1-flash', roles: [], enabled: false },
];

export const DEFAULT_SETTINGS: AppSettings = {
  ui: { theme: 'deepseek', displayMode: 'present', reducedMotion: false, sidebarCollapsed: false, locale: 'zh-CN' },
  server: { host: '127.0.0.1', port: 5177, corsOrigins: ['http://127.0.0.1:5173', 'http://localhost:5173'] },
  opencode: {
    enabled: true,
    binaryPath: 'opencode',
    expectedVersion: '1.19.0',
    host: '127.0.0.1',
    port: 0,
    autoStart: true,
    startupTimeoutMs: 30000,
    shutdownTimeoutMs: 8000,
    agent: 'build',
    permissionMode: 'ask',
    mcpServerName: 'agent-workflow',
    toolsets: ['workflow', 'git', 'database', 'workspace'],
    maxSessions: 8,
  },
  git: {
    author: { name: 'Agent Workflow', email: 'agent-workflow@localhost' },
    defaultProvider: 'github',
    github: { baseUrl: 'https://github.com', apiBaseUrl: 'https://api.github.com' },
    gitlab: { baseUrl: 'https://gitlab.com', apiBaseUrl: 'https://gitlab.com/api/v4' },
    worktreeRoot: '.data/worktrees',
    branchPrefix: 'task/',
    defaultTestCommand: '',
    fetchTimeoutMs: 60000,
    commandTimeoutMs: 120000,
  },
  database: { connections: [], queryTimeoutMs: 15000, rowLimit: 200, statementLimit: 50000 },
  planning: {
    maxDrafts: 1,
    maxRevisions: 1,
    transportRetries: 0,
    perDispatchLimitMinutes: 20,
    timeLimitMinutes: 45,
    budgetLimit: 2,
    currency: 'USD',
    maxNodes: 40,
    maxEdges: 80,
    maxGroups: 8,
    maxDepth: 12,
    previewTtlMinutes: 15,
    recordRetentionDays: 30,
  },
  execution: {
    autoAdvanceByDefault: true,
    maxConcurrentNodes: 1,
    maxAttempts: 3,
    nodeTimeoutMinutes: 30,
    pauseTimeoutMs: 15000,
    verifyCommandTimeoutMs: 300000,
  },
  delivery: {
    defaultGoal: 'create_merge_request',
    requirePushConfirmation: true,
    requireMergeRequestConfirmation: true,
    remoteBranchPrefix: 'task/',
  },
  models: DEFAULT_MODEL_PROFILES,
};

export const DATABASE_TYPE_META: Record<
  DatabaseTypeValue,
  { label: string; defaultPort: number; driver: 'mysql2' | 'planned'; urlExample: string }
> = {
  mysql: { label: 'MySQL', defaultPort: 3306, driver: 'mysql2', urlExample: 'jdbc:mysql://127.0.0.1:3306/db?connectionTimeZone=UTC' },
  mariadb: { label: 'MariaDB', defaultPort: 3306, driver: 'mysql2', urlExample: 'jdbc:mysql://127.0.0.1:3306/db' },
  goldendb: { label: 'GoldenDB', defaultPort: 3306, driver: 'mysql2', urlExample: 'jdbc:mysql://127.0.0.1:3306/db' },
  postgresql: { label: 'PostgreSQL', defaultPort: 5432, driver: 'planned', urlExample: 'jdbc:postgresql://127.0.0.1:5432/db' },
  oracle: { label: 'Oracle', defaultPort: 1521, driver: 'planned', urlExample: 'jdbc:oracle:thin:@127.0.0.1:1521/ORCL' },
  dm: { label: '达梦 DM', defaultPort: 5236, driver: 'planned', urlExample: 'jdbc:dm://127.0.0.1:5236' },
  db2: { label: 'DB2', defaultPort: 50000, driver: 'planned', urlExample: 'jdbc:db2://127.0.0.1:50000/db' },
};

export function cloneSettings(settings: AppSettings = DEFAULT_SETTINGS): AppSettings {
  return structuredClone(settings);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep merge used for persisted settings over defaults; arrays replace wholesale. */
export function mergeSettings(base: AppSettings, patch: unknown): AppSettings {
  if (!isPlainObject(patch)) return base;
  return deepMerge(base, patch) as AppSettings;
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch === undefined ? base : patch;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return out;
}

export interface SettingsIssue {
  readonly path: string;
  readonly message: string;
}

export function validateSettings(settings: AppSettings): SettingsIssue[] {
  const issues: SettingsIssue[] = [];
  const port = settings.server.port;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) issues.push({ path: 'server.port', message: '端口必须在 1024–65535 之间' });
  if (settings.opencode.expectedVersion !== '1.19.0') {
    issues.push({ path: 'opencode.expectedVersion', message: '当前受管运行时固定 OpenCode 1.19.0' });
  }
  if (!settings.opencode.binaryPath.trim()) issues.push({ path: 'opencode.binaryPath', message: 'OpenCode 可执行路径不能为空' });
  if (settings.planning.maxRevisions < 0 || settings.planning.maxRevisions > 1) {
    issues.push({ path: 'planning.maxRevisions', message: '有界修订最多 1 次（MVP 决定）' });
  }
  if (settings.execution.maxConcurrentNodes < 1) issues.push({ path: 'execution.maxConcurrentNodes', message: '至少允许 1 个节点执行' });
  if (!settings.git.author.name.trim() || !settings.git.author.email.trim()) {
    issues.push({ path: 'git.author', message: '提交作者名称与邮箱不能为空' });
  }
  for (const connection of settings.database.connections) {
    const meta = DATABASE_TYPE_META[connection.type];
    if (meta === undefined) issues.push({ path: `database.connections.${connection.id}.type`, message: '不支持的数据库类型' });
    if (connection.port < 1 || connection.port > 65535) issues.push({ path: `database.connections.${connection.id}.port`, message: '数据库端口无效' });
  }
  return issues;
}

/** Redacted summary safe for the UI; tokens and passwords never appear here. */
export interface IntegrationStatus {
  readonly opencode: { readonly status: string; readonly version?: string; readonly port?: number };
  readonly git: {
    readonly provider: GitProviderValue;
    readonly github: { readonly configured: boolean; readonly authState: string };
    readonly gitlab: { readonly configured: boolean; readonly authState: string };
  };
  readonly database: { readonly configured: number; readonly connected: number };
}
