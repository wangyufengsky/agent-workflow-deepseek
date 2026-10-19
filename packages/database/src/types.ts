import type { DatabaseConnectionId } from '@agent-workflow/shared';

/** Options the database service hands to a driver factory. Password lives only here. */
export interface MySqlDriverOptions {
  readonly connectionId: DatabaseConnectionId;
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  /** Empty string means "connect without selecting a database". */
  readonly database: string;
  readonly ssl: boolean;
  readonly connectTimeoutMs: number;
}

export interface MySqlProbeMeasurement {
  readonly serverVersion: string;
  readonly sessionReadOnly?: boolean;
  readonly latencyMs: number;
}

export interface MySqlColumn {
  readonly name: string;
  readonly type?: string;
}

export interface MySqlRawResult {
  readonly sessionReadOnly?: boolean;
  readonly columns: readonly MySqlColumn[];
  /** Rows already materialised as arrays (mysql2 `rowsAsArray`). */
  readonly rows: readonly (readonly unknown[])[];
}

/**
 * Low-level driver seam. Tests inject fake drivers so read-only guard and error
 * mapping can be verified without a real MySQL server.
 */
export interface MySqlDriver {
  probe(timeoutMs: number): Promise<MySqlProbeMeasurement>;
  query(sql: string, options: { readonly timeoutMs: number }): Promise<MySqlRawResult>;
  close(): Promise<void>;
}

export type MySqlDriverFactory = (options: MySqlDriverOptions) => MySqlDriver;
