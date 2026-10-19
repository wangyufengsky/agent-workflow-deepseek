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
  metadata_json: string;
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
      revision: 1, versions: [], archived: false,
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
    const before = this.get(work.id);
    const versions = before?.versions ?? work.versions ?? [];
    const revision = (before?.revision ?? 1) + 1;
    const snapshot = before === undefined ? [] : [{ revision: before.revision ?? 1, savedAt: before.updatedAt, productionPages:before.productionPages, cover: before.cover, plan: before.plan, title: before.title, topic: before.topic, outline: before.outline, slides: before.slides, theme: before.theme, ...(before.brief === undefined ? {} : { brief: before.brief }), ...(before.direction === undefined ? {} : { direction: before.direction }) }];
    const metadata = { revision, productionPages:work.productionPages, brief: work.brief, direction: work.direction, cover: work.cover, plan: work.plan, archived: work.archived ?? false, versions: [...snapshot, ...versions].slice(0, 30) };

    this.#db
      .prepare('UPDATE ppt_works SET title = ?, topic = ?, status = ?, outline_json = ?, slides_json = ?, updated_at = ?, usage_json = ?, attachments_json = ?, theme = ?, metadata_json = ? WHERE id = ?')
      .run(work.title, work.topic, work.status, JSON.stringify(work.outline), JSON.stringify(work.slides), nowIso(), work.usage === undefined ? null : JSON.stringify(work.usage), JSON.stringify(work.attachments), work.theme, JSON.stringify(metadata), work.id);
    return this.get(work.id) ?? work;
  }

  delete(id: string): boolean {
    const result = this.#db.prepare('DELETE FROM ppt_works WHERE id = ?').run(id);
    return Number(result.changes) > 0;
  }
}

function mapRow(row: Row): PptWork {
  const metadata = JSON.parse(row.metadata_json ?? '{}') as Pick<PptWork, 'revision' | 'brief' | 'direction' | 'archived' | 'versions' | 'plan' | 'cover' | 'productionPages'>;
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
        ...item,
        title: String(item.title),
        ...(typeof item.notes === 'string' ? { notes: item.notes } : {}),
        ...(typeof item.imageName === 'string' ? { imageName: item.imageName } : {}),
        bullets: Array.isArray(item.bullets) ? item.bullets.filter((bullet): bullet is string => typeof bullet === 'string').slice(0, 8) : [],
      }));
    }
  } catch {
    slides = [];
  }
  return {
    ...metadata,
    revision: metadata.revision ?? 1,
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
      content: item.content.slice(0, item.kind === 'image' ? 3_000_000 : 200_000),
      kind: item.kind === 'image' ? 'image' as const : 'text' as const,
      addedAt: typeof item.addedAt === 'string' ? item.addedAt : nowIso(),
    })).slice(0, 10);
  } catch {
    return [];
  }
}
