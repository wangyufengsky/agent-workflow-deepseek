import type { AppEvent, AppEventEnvelope } from '@agent-workflow/shared';
import { createId, nowIso } from '@agent-workflow/shared';
import type { SqliteDatabase } from './db.ts';
import { jsonParse, jsonStringify } from './db.ts';
import type { JsonlJournal } from './jsonl.ts';

export type EventListener = (event: AppEventEnvelope) => void;

export interface PersistedEventRow {
  readonly seq: number;
  readonly id: string;
  readonly type: string;
  readonly at: string;
  readonly payload_json: string;
}

/**
 * Durable event bus: events are written to SQLite (replay for SSE reconnects)
 * and to the JSONL journal (human-readable audit). Subscribers only get
 * after-persist notifications.
 */
export class EventService {
  readonly #db: SqliteDatabase;
  readonly #journal: JsonlJournal;
  readonly #listeners = new Set<EventListener>();
  #lastSeq = 0;

  constructor(db: SqliteDatabase, journal: JsonlJournal) {
    this.#db = db;
    this.#journal = journal;
    const row = db.prepare('SELECT MAX(seq) AS seq FROM events').get() as { seq: number | null } | undefined;
    this.#lastSeq = row?.seq ?? 0;
  }

  get lastSeq(): number {
    return this.#lastSeq;
  }

  publish<K extends AppEvent['type']>(type: K, payload: Extract<AppEvent, { type: K }>['payload']): AppEventEnvelope {
    const event: AppEventEnvelope = {
      id: createId('evt'),
      seq: ++this.#lastSeq,
      type,
      at: nowIso(),
      payload,
    };
    this.#db.prepare('INSERT INTO events (seq, id, type, at, payload_json) VALUES (?, ?, ?, ?, ?)').run(
      event.seq,
      event.id,
      event.type,
      event.at,
      jsonStringify(event.payload),
    );
    this.#journal.append('events', { type: event.type, at: event.at, id: event.id, eventSeq: event.seq, payload: event.payload });
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        // A broken listener must not break the writer.
      }
    }
    return event;
  }

  replay(afterSeq = 0, limit = 500): readonly AppEventEnvelope[] {
    const rows = this.#db
      .prepare('SELECT seq, id, type, at, payload_json FROM events WHERE seq > ? ORDER BY seq ASC LIMIT ?')
      .all(afterSeq, limit) as unknown as PersistedEventRow[];
    return rows.map((row) => ({
      id: row.id,
      seq: row.seq,
      type: row.type as AppEventEnvelope['type'],
      at: row.at,
      payload: jsonParse<Record<string, unknown>>(row.payload_json, {}),
    }));
  }

  subscribe(listener: EventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
