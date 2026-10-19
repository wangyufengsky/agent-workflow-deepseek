import { performance } from 'node:perf_hooks';
import pg from 'pg';
import type { MySqlDriver, MySqlDriverFactory, MySqlProbeMeasurement, MySqlRawResult } from './types.ts';

/** Each operation runs in its own read-only transaction; the single client is serialized. */
export const createPostgresDriverFactory: MySqlDriverFactory = (options) => {
  let client: pg.Client | undefined;
  let queue = Promise.resolve();
  const getClient = async (): Promise<pg.Client> => {
    if (client !== undefined) return client;
    const next = new pg.Client({ host: options.host, port: options.port, user: options.user, password: options.password,
      ...(options.database === '' ? {} : { database: options.database }), ...(options.ssl ? { ssl: { rejectUnauthorized: true } } : {}),
      connectionTimeoutMillis: options.connectTimeoutMs, application_name: 'agent-workflow-readonly' });
    await next.connect(); client = next; return next;
  };
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const pending = queue.then(fn, fn); queue = pending.then(() => undefined, () => undefined); return pending;
  };
  const readOnly = async <T>(timeoutMs: number, fn: (active: pg.Client) => Promise<T>): Promise<T> => {
    const active = await getClient();
    try {
      await active.query({ text: 'BEGIN READ ONLY', query_timeout: timeoutMs } as pg.QueryConfig);
      await active.query(`SET LOCAL statement_timeout = ${Math.max(1, Math.floor(timeoutMs))}`);
      return await fn(active);
    } finally {
      try { await active.query({ text: 'ROLLBACK', query_timeout: timeoutMs } as pg.QueryConfig); }
      catch { client = undefined; await active.end().catch(() => undefined); }
    }
  };
  const driver: MySqlDriver = {
    probe: (timeoutMs): Promise<MySqlProbeMeasurement> => serial(() => readOnly(timeoutMs, async (active) => {
      const started = performance.now();
      const result = await active.query({ text: "SELECT version() AS version, current_setting('transaction_read_only') AS readonly", query_timeout: timeoutMs } as pg.QueryConfig);
      if (result.rows[0]?.readonly !== 'on') throw new Error('PostgreSQL 会话没有进入只读事务');
      return { serverVersion: String(result.rows[0]?.version ?? 'PostgreSQL'), latencyMs: Math.round(performance.now() - started), sessionReadOnly: true };
    })),
    query: (sql, queryOptions): Promise<MySqlRawResult> => serial(() => readOnly(queryOptions.timeoutMs, async (active) => {
      const result = await active.query({ text: sql, rowMode: 'array', query_timeout: queryOptions.timeoutMs } as pg.QueryArrayConfig);
      return { sessionReadOnly: true, columns: result.fields.map((field) => ({ name: field.name, type: String(field.dataTypeID) })), rows: result.rows as readonly (readonly unknown[])[] };
    })),
    async close() { await queue; const active = client; client = undefined; if (active !== undefined) await active.end(); },
  };
  return driver;
};
