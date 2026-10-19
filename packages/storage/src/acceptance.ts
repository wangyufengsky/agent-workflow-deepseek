import type { TaskAcceptance } from '@agent-workflow/shared';
import type { SqliteDatabase } from './db.ts';

export class TaskAcceptanceRepository {
  readonly #db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.#db = db;
  }

  get(taskId: string): TaskAcceptance | undefined {
    const row = this.#db.prepare('SELECT * FROM task_acceptance WHERE task_id = ?').get(taskId) as
      | { task_id: string; verdict: string; note: string | null; decided_at: string }
      | undefined;
    return row === undefined ? undefined : {
      taskId: row.task_id,
      verdict: row.verdict === 'accepted' ? 'accepted' : 'rejected',
      ...(row.note === null ? {} : { note: row.note }),
      decidedAt: row.decided_at,
    };
  }

  put(acceptance: TaskAcceptance): TaskAcceptance {
    this.#db
      .prepare('INSERT INTO task_acceptance (task_id, verdict, note, decided_at) VALUES (?, ?, ?, ?) ON CONFLICT(task_id) DO UPDATE SET verdict = excluded.verdict, note = excluded.note, decided_at = excluded.decided_at')
      .run(acceptance.taskId, acceptance.verdict, acceptance.note ?? null, acceptance.decidedAt);
    return acceptance;
  }

  list(): readonly TaskAcceptance[] {
    const rows = this.#db.prepare('SELECT * FROM task_acceptance ORDER BY decided_at DESC').all() as unknown as { task_id: string; verdict: string; note: string | null; decided_at: string }[];
    return rows.map((row) => ({
      taskId: row.task_id,
      verdict: row.verdict === 'accepted' ? 'accepted' as const : 'rejected' as const,
      ...(row.note === null ? {} : { note: row.note }),
      decidedAt: row.decided_at,
    }));
  }
}
