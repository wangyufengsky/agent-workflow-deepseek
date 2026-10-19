import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MIGRATIONS, type Migration } from './migrations.ts';

export interface SqliteOptions {
  readonly dbPath: string;
  readonly migrations?: readonly Migration[];
}

export class SqliteDatabase {
  readonly path: string;
  readonly #db: DatabaseSync;
  #closed = false;

  constructor(options: SqliteOptions) {
    this.path = options.dbPath;
    mkdirSync(dirname(options.dbPath), { recursive: true });
    this.#db = new DatabaseSync(options.dbPath);
    this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec('PRAGMA synchronous = NORMAL');
    this.#db.exec('PRAGMA foreign_keys = ON');
    this.#db.exec('PRAGMA busy_timeout = 5000');
    this.#migrate(options.migrations ?? MIGRATIONS);
  }

  get raw(): DatabaseSync {
    this.#assertOpen();
    return this.#db;
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('database is closed');
  }

  #migrate(migrations: readonly Migration[]): void {
    this.#db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`);
    const applied = new Set(
      (this.#db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((row) => row.version),
    );
    for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
      if (applied.has(migration.version)) continue;
      this.transaction(() => {
        this.#db.exec(migration.sql);
        this.#db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(migration.version, migration.name, new Date().toISOString());
      });
    }
  }

  prepare(sql: string): StatementSync {
    this.#assertOpen();
    return this.#db.prepare(sql);
  }

  exec(sql: string): void {
    this.#assertOpen();
    this.#db.exec(sql);
  }

  transaction<T>(fn: () => T): T {
    this.#assertOpen();
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.#db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.#db.exec('ROLLBACK');
      } catch {
        // A failed rollback must not mask the original error.
      }
      throw error;
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#db.close();
  }
}

export function jsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function jsonStringify(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function toBool(value: unknown): boolean {
  return value === 1 || value === true || value === '1';
}

export function fromBool(value: boolean): number {
  return value ? 1 : 0;
}
