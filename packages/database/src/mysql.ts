import { createPool, type Pool, type PoolConnection } from 'mysql2/promise';
import { AppError, ErrorCode } from '@agent-workflow/shared';
import type { MySqlColumn, MySqlDriver, MySqlDriverFactory, MySqlDriverOptions, MySqlProbeMeasurement, MySqlRawResult } from './types.ts';

/** `mysql2` field type codes to readable names; keeps the wire result self-describing. */
const MYSQL_TYPE_NAMES: Readonly<Record<number, string>> = {
  0: 'DECIMAL',
  1: 'TINYINT',
  2: 'SMALLINT',
  3: 'INT',
  4: 'FLOAT',
  5: 'DOUBLE',
  6: 'NULL',
  7: 'TIMESTAMP',
  8: 'BIGINT',
  9: 'MEDIUMINT',
  10: 'DATE',
  11: 'TIME',
  12: 'DATETIME',
  13: 'YEAR',
  14: 'DATE',
  15: 'VARCHAR',
  16: 'BIT',
  17: 'TIMESTAMP',
  18: 'DATETIME',
  19: 'TIME',
  20: 'YEAR',
  21: 'DATE',
  245: 'JSON',
  246: 'NEWDECIMAL',
  247: 'ENUM',
  248: 'SET',
  249: 'TINYBLOB',
  250: 'MEDIUMBLOB',
  251: 'LONGBLOB',
  252: 'BLOB',
  253: 'VAR_STRING',
  254: 'STRING',
  255: 'GEOMETRY',
};

interface FieldLike {
  readonly name?: unknown;
  readonly type?: unknown;
  readonly columnType?: unknown;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

/** Create the real `mysql2/promise` pool-backed driver. */
export function createMySqlPoolDriver(options: MySqlDriverOptions): MySqlDriver {
  return new MySqlPoolDriver(options);
}

export const createMySqlDriverFactory: MySqlDriverFactory = (options) => createMySqlPoolDriver(options);

class MySqlPoolDriver implements MySqlDriver {
  readonly #pool: Pool;
  readonly #connectTimeoutMs: number;
  #closed = false;

  constructor(options: MySqlDriverOptions) {
    this.#connectTimeoutMs = Math.max(1, options.connectTimeoutMs || DEFAULT_CONNECT_TIMEOUT_MS);
    this.#pool = createPool({
      host: options.host,
      port: options.port,
      user: options.user,
      password: options.password,
      ...(options.database.length > 0 ? { database: options.database } : {}),
      ...(options.ssl ? { ssl: { rejectUnauthorized: true } } : {}),
      connectTimeout: this.#connectTimeoutMs,
      waitForConnections: true,
      connectionLimit: 4,
      maxIdle: 4,
      idleTimeout: 60_000,
      queueLimit: 0,
      enableKeepAlive: true,
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
      charset: 'utf8mb4',
    });
  }

  async probe(timeoutMs: number): Promise<MySqlProbeMeasurement> {
    const timeout = Math.max(1, timeoutMs);
    const startedAt = performance.now();
    const connection = await acquireConnection(this.#pool, this.#connectTimeoutMs, () =>
      new AppError(ErrorCode.NETWORK_UNREACHABLE, '数据库连接超时', {
        details: { reason: 'connect_timeout', timeoutMs: this.#connectTimeoutMs },
      }),
    );
    let destroyed = false;
    const timeoutFailure = () => { destroyed = true; connection.destroy(); return new AppError(ErrorCode.DATABASE_QUERY_BLOCKED, '只读连接检查超时'); };
    try {
      await runQuery(connection, 'SET TRANSACTION READ ONLY', timeout, timeoutFailure);
      await runQuery(connection, 'START TRANSACTION', timeout, timeoutFailure);
      const [rows] = await runQuery(connection, 'SELECT VERSION() AS version', timeout, timeoutFailure,
      );
      const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
      const first = Array.isArray(rows) ? (rows[0] as unknown) : undefined;
      const version = Array.isArray(first) ? first[0] : undefined;
      return {
        serverVersion: typeof version === 'string' && version.length > 0 ? version : 'unknown',
        sessionReadOnly: true,
        latencyMs,
      };
    } finally {
      if (!destroyed) {
        try { await runQuery(connection, 'ROLLBACK', timeout, timeoutFailure); connection.release(); } catch { connection.destroy(); }
      }
    }
  }

  async query(sql: string, options: { readonly timeoutMs: number }): Promise<MySqlRawResult> {
    const timeout = Math.max(1, options.timeoutMs);
    const connection = await acquireConnection(this.#pool, this.#connectTimeoutMs, () =>
      new AppError(ErrorCode.NETWORK_UNREACHABLE, '数据库连接超时', {
        details: { reason: 'connect_timeout', timeoutMs: this.#connectTimeoutMs },
      }),
    );
    let destroyed = false;
    try {
      const timeoutFailure = () => { destroyed = true; connection.destroy(); return new AppError(ErrorCode.DATABASE_QUERY_BLOCKED, '只读事务初始化超时'); };
      await runQuery(connection, 'SET TRANSACTION READ ONLY', timeout, timeoutFailure);
      await runQuery(connection, 'START TRANSACTION', timeout, timeoutFailure);
      const [rawRows, fields] = await runQuery(connection, sql, timeout, () => {
        destroyed = true;
        connection.destroy();
        return new AppError(ErrorCode.DATABASE_QUERY_BLOCKED, `数据库查询超时（${timeout}ms），连接已销毁`, {
          details: { reason: 'query_timeout', timeoutMs: timeout },
        });
      });
      return { columns: mapColumns(fields), rows: toRowArrays(rawRows), sessionReadOnly: true };
    } finally {
      if (!destroyed) {
        try { await runQuery(connection, 'ROLLBACK', timeout, () => { connection.destroy(); return new AppError(ErrorCode.DATABASE_QUERY_BLOCKED, '只读事务结束超时'); }); connection.release(); } catch { connection.destroy(); }
      }
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#pool.end();
  }
}

/** Acquire a pooled connection with a hard deadline; a late connection is destroyed. */
async function acquireConnection(pool: Pool, timeoutMs: number, onTimeout: () => AppError): Promise<PoolConnection> {
  const pending = pool.getConnection();
  return new Promise<PoolConnection>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      pending.then((connection) => connection.destroy()).catch(() => undefined);
      reject(onTimeout());
    }, timeoutMs);
    pending.then(
      (connection) => {
        if (settled) {
          connection.destroy();
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(connection);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Run one query with a client-side deadline. On timeout the caller-supplied
 * `onTimeout` destroys the connection, which tells MySQL to abort the query.
 */
function runQuery(
  connection: PoolConnection,
  sql: string,
  timeoutMs: number,
  onTimeout: () => AppError,
): Promise<[unknown, readonly FieldLike[]]> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      let timeoutError: AppError;
      try {
        timeoutError = onTimeout();
      } catch {
        timeoutError = new AppError(ErrorCode.DATABASE_QUERY_BLOCKED, '数据库查询超时', { details: { reason: 'query_timeout', timeoutMs } });
      }
      reject(timeoutError);
    }, timeoutMs);
    connection.query({ sql, rowsAsArray: true }).then(
      (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result as unknown as [unknown, readonly FieldLike[]]);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function mapColumns(fields: readonly FieldLike[] | undefined): readonly MySqlColumn[] {
  if (!Array.isArray(fields)) return [];
  return fields.map((field) => {
    const name = typeof field.name === 'string' ? field.name : '';
    const typeCode = typeof field.columnType === 'number' ? field.columnType : typeof field.type === 'number' ? field.type : undefined;
    const type = typeCode === undefined ? undefined : MYSQL_TYPE_NAMES[typeCode];
    return type === undefined ? { name } : { name, type };
  });
}

function toRowArrays(rawRows: unknown): readonly (readonly unknown[])[] {
  if (!Array.isArray(rawRows)) return [];
  return rawRows.map((row) => (Array.isArray(row) ? row : []));
}
