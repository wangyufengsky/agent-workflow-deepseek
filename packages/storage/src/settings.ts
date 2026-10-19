import type { AppSettings, DatabaseConnection, DatabaseTypeValue } from '@agent-workflow/shared';
import { nowIso } from '@agent-workflow/shared';
import type { SqliteDatabase } from './db.ts';
import { jsonParse, jsonStringify } from './db.ts';

type Row = Record<string, unknown>;

export class SettingsRepository {
  readonly #db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.#db = db;
  }

  /**
   * Removes a settings entry. Used by workspace cleanup to drop the
   * `directory.baseline.<workspaceId>` index after the baseline directory is
   * deleted; a missing key is a no-op so callers stay idempotent.
   */
  removeJson(key: string): void {
    this.#db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  }

  getJson<T>(key: string): T | undefined {
    const row = this.#db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as { value_json: string } | undefined;
    return row === undefined ? undefined : jsonParse<T | undefined>(row.value_json, undefined);
  }

  putJson(key: string, value: unknown): void {
    this.#db
      .prepare('INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at')
      .run(key, jsonStringify(value), nowIso());
  }

  getSettings(): Partial<AppSettings> | undefined {
    return this.getJson<Partial<AppSettings>>('app');
  }

  saveSettings(settings: AppSettings): void {
    this.putJson('app', settings);
  }
}

export interface DatabaseConnectionRecord {
  readonly id: string;
  readonly name: string;
  readonly type: DatabaseTypeValue;
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly passwordRef?: string;
  readonly readOnly: boolean;
  readonly ssl: boolean;
  readonly state: DatabaseConnection['state'];
  readonly lastCheckedAt?: string;
  readonly message?: string;
}

export class DatabaseConnectionRepository {
  readonly #db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.#db = db;
  }

  list(): readonly DatabaseConnectionRecord[] {
    const rows = this.#db.prepare('SELECT * FROM database_connections ORDER BY rowid ASC').all() as unknown as Row[];
    return rows.map(mapConnection);
  }

  get(id: string): DatabaseConnectionRecord | undefined {
    const row = this.#db.prepare('SELECT * FROM database_connections WHERE id = ?').get(id) as Row | undefined;
    return row === undefined ? undefined : mapConnection(row);
  }

  upsert(record: DatabaseConnectionRecord): DatabaseConnectionRecord {
    this.#db
      .prepare(
        `INSERT INTO database_connections (id, config_json, state, last_checked_at, message) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, state = excluded.state, last_checked_at = excluded.last_checked_at, message = excluded.message`,
      )
      .run(record.id, jsonStringify(record), record.state, record.lastCheckedAt ?? null, record.message ?? null);
    return record;
  }

  setState(id: string, state: DatabaseConnection['state'], message?: string): void {
    this.#db.prepare('UPDATE database_connections SET state = ?, last_checked_at = ?, message = ? WHERE id = ?').run(state, nowIso(), message ?? null, id);
  }

  delete(id: string): void {
    this.#db.prepare('DELETE FROM database_connections WHERE id = ?').run(id);
  }
}

function mapConnection(row: Row): DatabaseConnectionRecord {
  const config = jsonParse<DatabaseConnectionRecord>(row.config_json as string, {
    id: String(row.id),
    name: '',
    type: 'mysql',
    host: '',
    port: 3306,
    database: '',
    user: '',
    readOnly: true,
    ssl: false,
    state: 'not_configured',
  });
  return {
    ...config,
    id: String(row.id),
    state: row.state as DatabaseConnection['state'],
    lastCheckedAt: row.last_checked_at === null ? undefined : String(row.last_checked_at),
    message: row.message === null ? undefined : String(row.message),
  };
}
