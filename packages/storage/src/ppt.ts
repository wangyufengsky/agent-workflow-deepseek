import { createId, nowIso, type PptAttachment, type PptSlide, type PptWork, type PptWorkStatusValue } from '@agent-workflow/shared';
import type { SqliteDatabase } from './db.ts';

interface Row {
  id: string;
  project_id: string | null;
  title: string;
  topic: string;
  status: string;
  outline_json: string;
  slides_json: string;
  usage_json: string | null;
  attachments_json: string;
  theme: string;
  created_at: string;
  updated_at: string;
}

export interface CreatePptWorkInput {
  readonly projectId?: string;
  readonly title: string;
  readonly topic: string;
  readonly theme?: PptWork['theme'];
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
      attachments: [],
      theme: input.theme ?? 'deepseek',
      createdAt: at,
      updatedAt: at,
    };
    this.#db
      .prepare('INSERT INTO ppt_works (id, project_id, title, topic, status, outline_json, slides_json, created_at, updated_at, usage_json, attachments_json, theme) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(work.id, work.projectId ?? null, work.title, work.topic, work.status, JSON.stringify(work.outline), JSON.stringify(work.slides), work.createdAt, work.updatedAt, work.usage === undefined ? null : JSON.stringify(work.usage), JSON.stringify(work.attachments), work.theme);
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
      .prepare('UPDATE ppt_works SET title = ?, topic = ?, status = ?, outline_json = ?, slides_json = ?, updated_at = ?, usage_json = ?, attachments_json = ?, theme = ? WHERE id = ?')
      .run(work.title, work.topic, work.status, JSON.stringify(work.outline), JSON.stringify(work.slides), nowIso(), work.usage === undefined ? null : JSON.stringify(work.usage), JSON.stringify(work.attachments), work.theme, work.id);
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
    usage: row.usage_json === null ? undefined : JSON.parse(row.usage_json) as PptWork['usage'],
    attachments: parseAttachments(row.attachments_json),
    theme: row.theme as PptWork['theme'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}


function parseAttachments(raw: string | null): readonly PptAttachment[] {
  try {
    const parsed = JSON.parse(raw ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PptAttachment => item !== null && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string' && typeof (item as { content?: unknown }).content === 'string').map((item) => ({
      name: item.name.slice(0, 120),
      size: typeof item.size === 'number' ? item.size : item.content.length,
      content: item.content.slice(0, 200_000),
      addedAt: typeof item.addedAt === 'string' ? item.addedAt : nowIso(),
    })).slice(0, 10);
  } catch {
    return [];
  }
}
