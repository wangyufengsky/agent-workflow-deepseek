import type { DatabaseTypeValue } from '../domain/enums.ts';

export interface JdbcDatabaseTarget {
  readonly type: DatabaseTypeValue;
  readonly host: string;
  readonly port: number;
  readonly database: string;
}

const DEFAULT_PORTS: Readonly<Record<string, number>> = {
  mysql: 3306,
  mariadb: 3306,
  goldendb: 3306,
  postgresql: 5432,
  postgres: 5432,
};

/**
 * Parse a Spring-style JDBC datasource URL into the discrete connection fields
 * used by the UI. Query parameters (`connectionTimeZone`, etc.) are ignored.
 */
export function parseJdbcDatabaseUrl(raw: string): JdbcDatabaseTarget | undefined {
  let value = raw.trim();
  // Accept a YAML line and Spring placeholder with a default value, e.g.
  // url: ${WF_DB_URL:jdbc:mysql://127.0.0.1:3306/db?...}
  value = value.replace(/^url:\s*/i, '');
  const placeholder = /^\$\{[^:}]+:([\s\S]*)\}$/.exec(value);
  if (placeholder !== null) value = placeholder[1]!.trim();
  if (value === '' || !value.includes('://')) return undefined;
  const normalized = value.replace(/^jdbc:/i, '');
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return undefined;
  }
  const scheme = url.protocol.replace(/:$/, '').toLowerCase();
  const type: DatabaseTypeValue | undefined = scheme === 'mysql'
    ? 'mysql'
    : scheme === 'mariadb'
      ? 'mariadb'
      : scheme === 'goldendb'
        ? 'goldendb'
        : scheme === 'postgresql' || scheme === 'postgres'
          ? 'postgresql'
          : undefined;
  if (type === undefined) return undefined;
  const port = url.port === '' ? (DEFAULT_PORTS[scheme] ?? 3306) : Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, '').split('/')[0] ?? '');
  if (database === '') return undefined;
  return {
    type,
    host: url.hostname === '' ? '127.0.0.1' : url.hostname,
    port,
    database,
  };
}
