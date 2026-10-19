import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SqliteDatabase } from './db.ts';

/**
 * Local credential store. Values are encrypted with a per-installation key that
 * never leaves the data directory; the API only exposes opaque refs and states.
 */
export class SecretStore {
  readonly #db: SqliteDatabase;
  readonly #key: Buffer;

  constructor(database: SqliteDatabase, dataDir: string) {
    this.#db = database;
    const keyPath = join(dataDir, 'secrets.key');
    mkdirSync(dataDir, { recursive: true });
    if (!existsSync(keyPath)) {
      writeFileSync(keyPath, randomBytes(32).toString('base64'), { encoding: 'utf8', mode: 0o600 });
      chmodSync(keyPath, 0o600);
    }
    this.#key = Buffer.from(readFileSync(keyPath, 'utf8').trim(), 'base64');
  }

  put(ref: string, value: string): void {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
    this.#db.prepare('INSERT INTO secrets (ref, ciphertext, updated_at) VALUES (?, ?, ?) ON CONFLICT(ref) DO UPDATE SET ciphertext = excluded.ciphertext, updated_at = excluded.updated_at').run(
      ref,
      payload,
      new Date().toISOString(),
    );
  }

  get(ref: string): string | undefined {
    const row = this.#db.prepare('SELECT ciphertext FROM secrets WHERE ref = ?').get(ref) as { ciphertext: string } | undefined;
    if (row === undefined) return undefined;
    const [ivPart, tagPart, dataPart] = row.ciphertext.split('.');
    if (!ivPart || !tagPart || !dataPart) return undefined;
    const decipher = createDecipheriv('aes-256-gcm', this.#key, Buffer.from(ivPart, 'base64'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64')), decipher.final()]).toString('utf8');
  }

  has(ref: string): boolean {
    return this.#db.prepare('SELECT 1 AS present FROM secrets WHERE ref = ?').get(ref) !== undefined;
  }

  delete(ref: string): void {
    this.#db.prepare('DELETE FROM secrets WHERE ref = ?').run(ref);
  }
}
