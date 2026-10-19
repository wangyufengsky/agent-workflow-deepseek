import { createId, nowIso, type PptSlide, type PptWork, type PptWorkStatusValue } from '@agent-workflow/shared';
import type { SqliteDatabase } from './db.ts';

interface Row {
  id: string;
  project_id: string | null;
  title: string;
  topic: string;
  status: string;
  outline_json: string;
  slides_json: string;
  created_at: string;
  updated_at: string;
}

export interface CreatePptWorkInput {
  readonly projectId?: string;
  readonly title: string;
  readonly topic: string;
}

export class PptWorkRepository {
  readonly #db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.#db = db;
  }

  create(input: CreatePptWorkInput): PptWork {
    const at = nowIso();
    const work: PptWork = {
      id: createId('ppt'),
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      title: input.title,
      topic: input.topic,
      status: 'draft',
      outline: [],
      slides: [],
      createdAt: at,
      updatedAt: at,
    };
    this.#db
      .prepare('INSERT INTO ppt_works (id, project_id, title, topic, status, outline_json, slides_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(work.id, work.projectId ?? null, work.title, work.topic, work.status, JSON.stringify(work.outline), JSON.stringify(work.slides), work.createdAt, work.updatedAt);
    return work;
  }

  list(): readonly PptWork[] {
    const rows = this.#db.prepare('SELECT * FROM ppt_works ORDER BY updated_at DESC').all() as unknown as Row[];
    return rows.map(mapRow);
  }

  get(id: string): PptWork | undefined {
    const row = this.#db.prepare('SELECT * FROM ppt_works WHERE id = ?').get(id) as Row | undefined;
    return row === undefined ? undefined : mapRow(row);
  }

  update(work: PptWork): PptWork {
    this.#db
      .prepare('UPDATE ppt_works SET title = ?, topic = ?, status = ?, outline_json = ?, slides_json = ?, updated_at = ? WHERE id = ?')
      .run(work.title, work.topic, work.status, JSON.stringify(work.outline), JSON.stringify(work.slides), nowIso(), work.id);
    return this.get(work.id) ?? work;
  }

  delete(id: string): boolean {
    const result = this.#db.prepare('DELETE FROM ppt_works WHERE id = ?').run(id);
    return Number(result.changes) > 0;
  }
}

function mapRow(row: Row): PptWork {
  let outline: string[] = [];
  try {
    const parsed = JSON.parse(row.outline_json) as unknown;
    if (Array.isArray(parsed)) outline = parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    outline = [];
  }
  let slides: PptSlide[] = [];
  try {
    const parsed = JSON.parse(row.slides_json ?? '[]') as unknown;
    if (Array.isArray(parsed)) {
      slides = parsed.filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object' && typeof (item as { title?: unknown }).title === 'string').map((item) => ({
        title: String(item.title),
        bullets: Array.isArray(item.bullets) ? item.bullets.filter((bullet): bullet is string => typeof bullet === 'string').slice(0, 8) : [],
      }));
    }
  } catch {
    slides = [];
  }
  return {
    id: row.id,
    ...(row.project_id === null ? {} : { projectId: row.project_id }),
    title: row.title,
    topic: row.topic,
    status: row.status as PptWorkStatusValue,
    outline,
    slides,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
