import { createHash } from 'node:crypto';
import {
  AppError,
  databaseScopeIssues,
  sameDatabaseTarget,
  type DatabaseDraftProbeRequest,
  DATABASE_TYPE_META,
  DatabaseConnectionState,
  ErrorCode,
  type DatabaseConnection,
  type DatabaseConnectionConfig,
  type DatabaseConnectionStateValue,
  type DatabaseProbeResult,
  type DatabaseQueryResult,
  type DatabaseSettings,
  type ErrorCodeValue,
} from '@agent-workflow/shared';
import { assertDatabaseQueryAccess } from './access.ts';
import { MAX_QUERY_LIMIT, assertQueryLimit, prepareReadOnlyQuery } from './guard.ts';
import { mapMySqlError, redactSecrets, stateFromErrorCode } from './errors.ts';
import { createMySqlDriverFactory } from './mysql.ts';
import { createPostgresDriverFactory } from './postgres.ts';
import type { MySqlDriver, MySqlDriverFactory } from './types.ts';

/** Minimal secret-store seam; `SecretStore` from `@agent-workflow/storage` satisfies it. */
export interface SecretResolver {
  get(ref: string): string | undefined;
}

export interface DatabaseServiceOptions {
  readonly settings: DatabaseSettings;
  readonly secrets: SecretResolver;
  readonly driverFactory?: MySqlDriverFactory;
  readonly postgresDriverFactory?: MySqlDriverFactory;
  readonly connectTimeoutMs?: number;
  readonly clock?: () => Date;
}

export interface QueryReadOnlyOptions {
  readonly config?: DatabaseConnectionConfig;
  readonly limit?: number;
  readonly timeoutMs?: number;
}

interface ConnectionRuntime {
  readonly config: DatabaseConnectionConfig;
  state: DatabaseConnectionStateValue;
  message: string | undefined;
  lastCheckedAt: string | undefined;
  driver: MySqlDriver | undefined;
  fingerprint: string | undefined;
  sessionReadOnly?: boolean;
  lastProbe?: DatabaseProbeResult;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const MAX_QUERY_TIMEOUT_MS = 600_000;

/**
 * Owns database connection definitions, password resolution and the read-only
 * query path. Passwords are resolved from the local secret store at call time
 * and never appear in models, errors or logs.
 */
export class DatabaseService {
  #settings: DatabaseSettings;
  readonly #secrets: SecretResolver;
  readonly #driverFactory: MySqlDriverFactory;
  readonly #postgresDriverFactory: MySqlDriverFactory;
  readonly #connectTimeoutMs: number;
  readonly #clock: () => Date;
  readonly #connections = new Map<string, ConnectionRuntime>();

  constructor(options: DatabaseServiceOptions) {
    this.#settings = options.settings;
    this.#secrets = options.secrets;
    this.#driverFactory = options.driverFactory ?? createMySqlDriverFactory;
    this.#postgresDriverFactory = options.postgresDriverFactory ?? createPostgresDriverFactory;
    this.#connectTimeoutMs = Math.max(1, options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);
    this.#clock = options.clock ?? (() => new Date());
    this.#syncConnections(options.settings.connections);
  }

  get settings(): DatabaseSettings {
    return this.#settings;
  }

  /** Replace settings (connection list, limits) and close pools that are gone. */
  async applySettings(settings: DatabaseSettings): Promise<void> {
    this.#settings = settings;
    const removed = this.#syncConnections(settings.connections);
    await Promise.all(removed.map((runtime) => this.#disposeDriver(runtime)));
  }

  /** Register or replace one connection definition. */
  registerConnection(config: DatabaseConnectionConfig): DatabaseConnection {
    assertConnectionConfig(config);
    const existing = this.#connections.get(config.id);
    if (existing !== undefined) {
      const unchanged = JSON.stringify(config) === JSON.stringify(existing.config);
      this.#connections.set(config.id, {
        config,
        state: unchanged ? existing.state : DatabaseConnectionState.NOT_CONFIGURED,
        message: unchanged ? existing.message : undefined,
        lastCheckedAt: unchanged ? existing.lastCheckedAt : undefined,
        sessionReadOnly: unchanged ? existing.sessionReadOnly : undefined,
        lastProbe: unchanged ? existing.lastProbe : undefined,
        driver: existing.driver,
        fingerprint: existing.fingerprint,
      });
    } else {
      this.#connections.set(config.id, {
        config,
        state: DatabaseConnectionState.NOT_CONFIGURED,
        message: undefined,
        lastCheckedAt: undefined,
        driver: undefined,
        fingerprint: undefined,
      });
    }
    const runtime = this.#connections.get(config.id);
    if (runtime === undefined) throw new AppError(ErrorCode.INTERNAL_ERROR, '数据库连接注册失败');
    return toConnectionModel(runtime);
  }

  list(): readonly DatabaseConnection[] {
    return [...this.#connections.values()].map(toConnectionModel);
  }

  get(connectionId: string): DatabaseConnection {
    return toConnectionModel(this.#runtime(connectionId));
  }

  /** Probe the connection; throws a mapped `AppError` on failure. */
  async probe(connectionId: string): Promise<DatabaseProbeResult> {
    const runtime = this.#runtime(connectionId);
    const checkedAt = this.#clock().toISOString();
    let password = '';
    try {
      this.#assertSupported(runtime);
      password = this.#resolvePassword(runtime);
      const driver = await this.#getDriver(runtime, password);
      const measurement = await driver.probe(this.#settings.queryTimeoutMs);
      runtime.state = DatabaseConnectionState.CONNECTED;
      runtime.message = undefined;
      runtime.lastCheckedAt = checkedAt;
      runtime.sessionReadOnly = measurement.sessionReadOnly;
      const capabilities = capabilitiesForVersion(measurement.serverVersion);
      const result: DatabaseProbeResult = {
        connectionId,
        state: DatabaseConnectionState.CONNECTED,
        checkedAt,
        serverVersion: measurement.serverVersion,
        latencyMs: measurement.latencyMs,
        capabilities,
        sessionReadOnly: measurement.sessionReadOnly,
        readOnlyEnforced: measurement.sessionReadOnly,
      };
      runtime.lastProbe = result;
      return result;
    } catch (error) {
      const appError = mapMySqlError(error, {
        connectionId,
        phase: 'probe',
        secretValues: [password],
        timeoutMs: this.#settings.queryTimeoutMs,
      });
      runtime.state = this.#stateForFailure(runtime, appError.code);
      runtime.message = redactSecrets(appError.message, [password]);
      runtime.lastCheckedAt = checkedAt;
      runtime.sessionReadOnly = undefined;
      runtime.lastProbe = { connectionId, state: runtime.state, checkedAt, message: runtime.message, capabilities: { query: false, explain: false, schemaRead: false } };
      await this.#disposeDriver(runtime);
      throw appError;
    }
  }

  /** Probe without throwing; failures are reported as a probe result state. */
  async tryProbe(connectionId: string): Promise<DatabaseProbeResult> {
    try {
      return await this.probe(connectionId);
    } catch (error) {
      const appError = error instanceof AppError ? error : mapMySqlError(error, { connectionId, phase: 'probe' });
      const runtime = this.#connections.get(connectionId);
      const result: DatabaseProbeResult = {
        connectionId,
        state: runtime === undefined ? stateFromErrorCode(appError.code) : this.#stateForFailure(runtime, appError.code),
        checkedAt: this.#clock().toISOString(),
        message: appError.message,
        capabilities: { query: false, explain: false, schemaRead: false },
      };
      if (runtime !== undefined) { runtime.lastProbe = result; runtime.lastCheckedAt = result.checkedAt; runtime.state = result.state; runtime.sessionReadOnly = undefined; }
      return result;
    }
  }

  /** Probe a form in an isolated service; never register it or write a secret. */
  async probeDraft(input: DatabaseDraftProbeRequest['connection']): Promise<DatabaseProbeResult> {
    if (input === null || typeof input !== 'object') throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少连接草稿');
    const issues = databaseScopeIssues(input);
    if (issues.length > 0) throw new AppError(ErrorCode.VALIDATION_FAILED, issues.join('；'));
    const original = input.id === undefined ? undefined : this.#connections.get(input.id)?.config;
    if (input.id !== undefined && original === undefined) throw new AppError(ErrorCode.NOT_FOUND, '原连接不存在');
    if (input.password !== undefined && typeof input.password !== 'string') throw new AppError(ErrorCode.VALIDATION_FAILED, '密码必须是字符串');
    const passwordSupplied = typeof input.password === 'string' && input.password.length > 0;
    const sameTarget = sameDatabaseTarget(input, original);
    if (!passwordSupplied && !sameTarget) throw new AppError(ErrorCode.VALIDATION_FAILED, '新增连接或修改连接目标后，请重新输入密码再检查');
    if (input.readOnly === false) throw new AppError(ErrorCode.VALIDATION_FAILED, '数据库连接必须保持只读');
    const config: DatabaseConnectionConfig = { id: 'draft', name: input.name, type: input.type, host: input.host, port: input.port, database: input.database, user: input.user, ssl: input.ssl ?? false, readOnly: true, schemas: input.schemas, tables: input.tables ?? [], passwordRef: 'draft-password' };
    assertConnectionConfig(config);
    const temporary = new DatabaseService({ settings: { ...this.#settings, connections: [config] }, secrets: { get: () => passwordSupplied ? input.password : original?.passwordRef === undefined ? undefined : this.#secrets.get(original.passwordRef) }, driverFactory: this.#driverFactory, postgresDriverFactory: this.#postgresDriverFactory, connectTimeoutMs: this.#connectTimeoutMs, clock: this.#clock });
    try { return await temporary.tryProbe('draft'); } finally { await temporary.closeAll(); }
  }

  /**
   * Execute one guarded read-only statement. SQL is validated before any
   * connection is acquired; the caller never sees a password in errors.
   */
  async queryReadOnly(connectionId: string, sql: unknown, options: QueryReadOnlyOptions = {}): Promise<DatabaseQueryResult> {
    if (options.config !== undefined) {
      if (options.config.id !== connectionId) throw new AppError(ErrorCode.FORBIDDEN, '连接身份与会话冻结配置不一致');
      const scoped = new DatabaseService({ settings: { ...this.#settings, connections: [options.config] }, secrets: this.#secrets, driverFactory: this.#driverFactory, postgresDriverFactory: this.#postgresDriverFactory, connectTimeoutMs: this.#connectTimeoutMs });
      try { return await scoped.queryReadOnly(connectionId, sql, { limit: options.limit, timeoutMs: options.timeoutMs }); } finally { await scoped.closeAll(); }
    }
    const requestedLimit = options.limit === undefined ? this.#settings.rowLimit : options.limit;
    const prepared = prepareReadOnlyQuery(sql, {
      limit: requestedLimit,
      statementLimit: this.#settings.statementLimit,
    });
    const limit = Math.min(prepared.limit, MAX_QUERY_LIMIT);
    const timeoutMs = normalizeTimeout(options.timeoutMs, this.#settings.queryTimeoutMs);

    const runtime = this.#runtime(connectionId);
    if (runtime.config.enabled === false) throw new AppError(ErrorCode.FORBIDDEN, '数据库连接已停用');
    assertDatabaseQueryAccess(String(sql), { connectionId, projectIds: runtime.config.projectIds ?? [], schemas: runtime.config.schemas ?? [], tables: runtime.config.tables ?? [], defaultSchema: runtime.config.type === 'postgresql' ? 'public' : runtime.config.database });
    this.#assertSupported(runtime);
    const password = this.#resolvePassword(runtime);
    const startedAt = performance.now();
    try {
      const driver = await this.#getDriver(runtime, password);
      const raw = await driver.query(prepared.sql, { timeoutMs });
      runtime.sessionReadOnly = raw.sessionReadOnly === true;
      const rows = raw.rows.map(normalizeRow);
      const truncated = rows.length > limit;
      const visible = truncated ? rows.slice(0, limit) : rows;
      runtime.state = DatabaseConnectionState.CONNECTED;
      runtime.message = undefined;
      runtime.lastCheckedAt = this.#clock().toISOString();
      return {
        connectionId,
        columns: raw.columns.map((column) => (column.type === undefined ? { name: column.name } : { name: column.name, type: column.type })),
        rows: visible,
        rowCount: visible.length,
        truncated,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      };
    } catch (error) {
      const appError = mapMySqlError(error, {
        connectionId,
        phase: 'query',
        secretValues: [password],
        timeoutMs,
      });
      runtime.lastCheckedAt = this.#clock().toISOString();
      if (appError.code === ErrorCode.NETWORK_UNREACHABLE || appError.code === ErrorCode.DATABASE_AUTH_FAILED) {
        runtime.state = this.#stateForFailure(runtime, appError.code);
        runtime.message = redactSecrets(appError.message, [password]);
        await this.#disposeDriver(runtime);
      }
      throw appError;
    }
  }

  /** Close one pooled driver but keep the connection definition. */
  async close(connectionId: string): Promise<void> {
    const runtime = this.#connections.get(connectionId);
    if (runtime === undefined) return;
    await this.#disposeDriver(runtime);
    runtime.state = DatabaseConnectionState.NOT_CONFIGURED;
    runtime.message = undefined;
    runtime.lastCheckedAt = undefined;
  }

  async closeAll(): Promise<void> {
    const runtimes = [...this.#connections.values()];
    await Promise.all(runtimes.map((runtime) => this.#disposeDriver(runtime)));
    this.#connections.clear();
  }

  #syncConnections(configs: readonly DatabaseConnectionConfig[]): readonly ConnectionRuntime[] {
    const seen = new Set<string>();
    for (const config of configs) {
      assertConnectionConfig(config);
      if (seen.has(config.id)) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, `数据库连接 id 重复：${config.id}`, {
          details: { field: 'database.connections', connectionId: config.id },
        });
      }
      seen.add(config.id);
    }
    const removed: ConnectionRuntime[] = [];
    for (const [id, runtime] of this.#connections) {
      if (!seen.has(id)) {
        removed.push(runtime);
        this.#connections.delete(id);
      }
    }
    for (const config of configs) {
      const existing = this.#connections.get(config.id);
      if (existing !== undefined) {
        const unchanged = JSON.stringify(config) === JSON.stringify(existing.config);
        this.#connections.set(config.id, {
          config,
          state: unchanged ? existing.state : DatabaseConnectionState.NOT_CONFIGURED,
          message: unchanged ? existing.message : undefined,
          lastCheckedAt: unchanged ? existing.lastCheckedAt : undefined,
          sessionReadOnly: unchanged ? existing.sessionReadOnly : undefined,
          lastProbe: unchanged ? existing.lastProbe : undefined,
          driver: existing.driver,
          fingerprint: existing.fingerprint,
        });
      } else {
        this.#connections.set(config.id, {
          config,
          state: DatabaseConnectionState.NOT_CONFIGURED,
          message: undefined,
          lastCheckedAt: undefined,
          driver: undefined,
          fingerprint: undefined,
        });
      }
    }
    return removed;
  }

  #runtime(connectionId: string): ConnectionRuntime {
    const runtime = this.#connections.get(connectionId);
    if (runtime === undefined) {
      throw new AppError(ErrorCode.DATABASE_NOT_CONFIGURED, `数据库连接 ${connectionId} 未配置`, {
        details: { connectionId },
      });
    }
    return runtime;
  }

  #assertSupported(runtime: ConnectionRuntime): void {
    const meta = DATABASE_TYPE_META[runtime.config.type];
    if (meta === undefined || (meta.driver !== 'mysql2' && meta.driver !== 'pg')) {
      throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, `数据库类型 ${runtime.config.type} 暂不支持查询`, {
        details: { connectionId: runtime.config.id, type: runtime.config.type },
      });
    }
  }

  #stateForFailure(runtime: ConnectionRuntime, code: ErrorCodeValue): DatabaseConnectionStateValue {
    const meta = DATABASE_TYPE_META[runtime.config.type];
    if (meta === undefined || (meta.driver !== 'mysql2' && meta.driver !== 'pg')) return DatabaseConnectionState.UNSUPPORTED;
    return stateFromErrorCode(code);
  }

  #resolvePassword(runtime: ConnectionRuntime): string {
    const ref = runtime.config.passwordRef?.trim();
    if (ref === undefined || ref.length === 0) {
      throw new AppError(ErrorCode.DATABASE_NOT_CONFIGURED, '数据库连接未配置密码引用（passwordRef）', {
        details: { connectionId: runtime.config.id },
      });
    }
    let password: string | undefined;
    try {
      password = this.#secrets.get(ref);
    } catch {
      throw new AppError(ErrorCode.DATABASE_NOT_CONFIGURED, '数据库凭据无法读取，请重新保存密码', {
        details: { connectionId: runtime.config.id },
      });
    }
    if (password === undefined) {
      throw new AppError(ErrorCode.DATABASE_NOT_CONFIGURED, '数据库密码未保存，请先在设置中填写', {
        details: { connectionId: runtime.config.id },
      });
    }
    return password;
  }

  async #getDriver(runtime: ConnectionRuntime, password: string): Promise<MySqlDriver> {
    const fingerprint = fingerprintFor(runtime.config, password, this.#connectTimeoutMs);
    if (runtime.driver !== undefined && runtime.fingerprint === fingerprint) return runtime.driver;
    await this.#disposeDriver(runtime);
    const factory = DATABASE_TYPE_META[runtime.config.type]?.driver === 'pg' ? this.#postgresDriverFactory : this.#driverFactory;
    const driver = factory({
      connectionId: runtime.config.id,
      host: runtime.config.host,
      port: runtime.config.port,
      user: runtime.config.user,
      password,
      database: runtime.config.database,
      ssl: runtime.config.ssl,
      connectTimeoutMs: this.#connectTimeoutMs,
    });
    runtime.driver = driver;
    runtime.fingerprint = fingerprint;
    return driver;
  }

  async #disposeDriver(runtime: ConnectionRuntime): Promise<void> {
    const driver = runtime.driver;
    runtime.driver = undefined;
    runtime.fingerprint = undefined;
    if (driver === undefined) return;
    try {
      await driver.close();
    } catch {
      // A broken pool must not mask the original database error.
    }
  }
}

/** Build the service from persisted settings and the encrypted secret store. */
export function createDatabaseService(options: DatabaseServiceOptions): DatabaseService {
  return new DatabaseService(options);
}

function assertConnectionConfig(config: DatabaseConnectionConfig): void {
  const issues: string[] = [];
  if (typeof config.id !== 'string' || config.id.trim().length === 0) issues.push('id 不能为空');
  if (typeof config.name !== 'string' || config.name.trim().length === 0) issues.push('名称不能为空');
  if (typeof config.host !== 'string' || config.host.trim().length === 0) issues.push('host 不能为空');
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) issues.push('端口无效');
  if (typeof config.database !== 'string') issues.push('database 必须是字符串');
  if (typeof config.user !== 'string' || config.user.trim().length === 0) issues.push('user 不能为空');
  if (typeof config.readOnly !== 'boolean') issues.push('readOnly 必须是布尔值');
  if (typeof config.ssl !== 'boolean') issues.push('ssl 必须是布尔值');
  if (issues.length > 0) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `数据库连接配置不合法：${issues.join('；')}`, {
      details: { field: 'database.connections', connectionId: typeof config.id === 'string' ? config.id : null, issues },
    });
  }
}

function toConnectionModel(runtime: ConnectionRuntime): DatabaseConnection {
  return {
    id: runtime.config.id,
    ...(runtime.lastProbe === undefined ? {} : { lastProbe: runtime.lastProbe }),
    enabled: runtime.config.enabled ?? true,
    projectIds: runtime.config.projectIds ?? [],
    schemas: runtime.config.schemas ?? [],
    tables: runtime.config.tables ?? [],
    ssl: runtime.config.ssl,
    sessionReadOnly: runtime.sessionReadOnly === true ? 'enforced' : 'unverified',
    name: runtime.config.name,
    type: runtime.config.type,
    host: runtime.config.host,
    port: runtime.config.port,
    database: runtime.config.database,
    user: runtime.config.user,
    state: runtime.state,
    readOnly: runtime.config.readOnly,
    ...(runtime.lastCheckedAt === undefined ? {} : { lastCheckedAt: runtime.lastCheckedAt }),
    ...(runtime.message === undefined ? {} : { message: runtime.message }),
  };
}

function fingerprintFor(config: DatabaseConnectionConfig, password: string, connectTimeoutMs: number): string {
  // Hashed so the raw secret never sits in a long-lived string.
  return createHash('sha256')
    .update(
      JSON.stringify({
        id: config.id,
        host: config.host,
        port: config.port,
        user: config.user,
        database: config.database,
        ssl: config.ssl,
        password,
        connectTimeoutMs,
      }),
    )
    .digest('hex');
}

function normalizeTimeout(value: unknown, fallback: number): number {
  const timeout = value === undefined ? fallback : value;
  if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 1 || timeout > MAX_QUERY_TIMEOUT_MS) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `查询超时必须是 1–${MAX_QUERY_TIMEOUT_MS} 毫秒之间的整数`, {
      details: { field: 'timeoutMs', timeoutMs: typeof timeout === 'number' ? timeout : null },
    });
  }
  return timeout;
}

function capabilitiesForVersion(serverVersion: string): DatabaseProbeResult['capabilities'] {
  const isMariaDb = /mariadb/i.test(serverVersion);
  const match = /(\d+)\.(\d+)/.exec(serverVersion);
  const explain = isMariaDb || match === null || Number(match[1]) > 5 || (Number(match[1]) === 5 && Number(match[2]) >= 6);
  return { query: true, explain, schemaRead: true };
}

function normalizeRow(row: readonly unknown[]): readonly unknown[] {
  return row.map((value) => normalizeValue(value, 0));
}

function normalizeValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) {
    const preview = value.subarray(0, Math.min(value.length, 4096)).toString('base64');
    return value.length <= 4096 ? `base64:${preview}` : `base64:${preview}…(${value.length} bytes)`;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    if (depth >= 4) return '[nested array]';
    return value.map((item) => normalizeValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    if (depth >= 4) return '[nested object]';
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = normalizeValue(item, depth + 1);
    }
    return output;
  }
  return value;
}
