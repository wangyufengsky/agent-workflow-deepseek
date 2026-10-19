import { performance } from 'node:perf_hooks';
import pg from 'pg';
import type { MySqlDriver, MySqlDriverFactory, MySqlProbeMeasurement, MySqlRawResult } from './types.ts';

/**
 * Read-only PostgreSQL driver. The service guard only lets single SELECT/WITH
 * statements through; this adapter keeps one client per connection definition.
 */
export const createPostgresDriverFactory: MySqlDriverFactory = (options) => {
  let client: pg.Client | undefined;
  const getClient = async (): Promise<pg.Client> => {
    if (client !== undefined) return client;
    const next = new pg.Client({
      host: options.host,
      port: options.port,
      user: options.user,
      password: options.password,
      ...(options.database === '' ? {} : { database: options.database }),
      ...(options.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
      connectionTimeoutMillis: options.connectTimeoutMs,
      statement_timeout: 60_000,
      application_name: 'agent-workflow-readonly',
    });
    await next.connect();
    client = next;
    return next;
  };
  const driver: MySqlDriver = {
    async probe(timeoutMs: number): Promise<MySqlProbeMeasurement> {
      const active = await getClient();
      const started = performance.now();
      void timeoutMs;
      await active.query('SELECT version() AS version');
      return { serverVersion: 'PostgreSQL', latencyMs: Math.round(performance.now() - started) };
    },
    async query(sql: string, queryOptions: { readonly timeoutMs: number }): Promise<MySqlRawResult> {
      const active = await getClient();
      void queryOptions.timeoutMs;
      const result = await active.query({ text: sql, rowMode: 'array' } as pg.QueryConfig);
      const fields = (result.fields ?? []) as { name: string; dataTypeID?: number }[];
      return {
        columns: fields.map((field) => ({ name: field.name, ...(field.dataTypeID === undefined ? {} : { type: String(field.dataTypeID) }) })),
        rows: result.rows as unknown as readonly (readonly unknown[])[],
      };
    },
    async close(): Promise<void> {
      const active = client;
      client = undefined;
      if (active !== undefined) await active.end();
    },
  };
  return driver;
};
