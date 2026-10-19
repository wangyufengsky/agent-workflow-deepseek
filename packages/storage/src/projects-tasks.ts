import type {
  Project,
  ProjectSettings,
  ProjectSummary,
  RequirementInput,
  Task,
  TaskStageValue,
  TaskSummary,
  FixedTemplateBinding,
  TaskAttentionValue,
  TaskLifecycleValue,
} from '@agent-workflow/shared';
import { createId, nowIso } from '@agent-workflow/shared';
import type { SqliteDatabase } from './db.ts';
import { fromBool, jsonParse, jsonStringify, toBool } from './db.ts';

type Row = Record<string, unknown>;

export interface CreateProjectInput {
  readonly name: string;
  readonly description?: string;
  readonly rootPath: string;
  readonly gitState: Project['gitState'];
  readonly defaultBranch?: string;
  readonly remoteDisplayUrl?: string;
  readonly settings?: ProjectSettings;
}

export class ProjectRepository {
  readonly #db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.#db = db;
  }

  create(input: CreateProjectInput): Project {
    const at = nowIso();
    const project: Project = {
      id: createId('prj'),
      name: input.name,
      description: input.description ?? '',
      rootPath: input.rootPath,
      gitState: input.gitState,
      defaultBranch: input.defaultBranch,
      remoteDisplayUrl: input.remoteDisplayUrl,
      settings: input.settings ?? {},
      archived: false,
      createdAt: at,
      updatedAt: at,
    };
    this.#db
      .prepare(
        `INSERT INTO projects (id, name, description, root_path, git_state, default_branch, remote_display_url, settings_json, archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(
        project.id,
        project.name,
        project.description,
        project.rootPath,
        project.gitState,
        project.defaultBranch ?? null,
        project.remoteDisplayUrl ?? null,
        jsonStringify(project.settings),
        project.createdAt,
        project.updatedAt,
      );
    return project;
  }

  get(id: string): Project | undefined {
    const row = this.#db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined;
    return row === undefined ? undefined : mapProject(row);
  }

  list(includeArchived = false): readonly Project[] {
    const rows = this.#db
      .prepare(`SELECT * FROM projects ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY updated_at DESC`)
      .all() as unknown as Row[];
    return rows.map(mapProject);
  }

  listSummaries(): readonly ProjectSummary[] {
    const rows = this.#db
      .prepare(
        `SELECT p.*,
                (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.lifecycle = 'active') AS open_tasks,
                (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.lifecycle = 'active' AND t.attention != 'none') AS attention_tasks
         FROM projects p WHERE p.archived = 0 ORDER BY p.updated_at DESC`,
      )
      .all() as unknown as Row[];
    return rows.map((row) => ({
      ...mapProject(row),
      openTaskCount: Number(row.open_tasks ?? 0),
      attentionCount: Number(row.attention_tasks ?? 0),
    }));
  }

  update(id: string, patch: Partial<Pick<Project, 'name' | 'description' | 'archived'>> & { settings?: ProjectSettings }): Project | undefined {
    const current = this.get(id);
    if (current === undefined) return undefined;
    const next: Project = {
      ...current,
      name: patch.name ?? current.name,
      description: patch.description ?? current.description,
      settings: patch.settings ?? current.settings,
      archived: patch.archived ?? current.archived,
      updatedAt: nowIso(),
    };
    this.#db
      .prepare('UPDATE projects SET name = ?, description = ?, settings_json = ?, archived = ?, updated_at = ? WHERE id = ?')
      .run(next.name, next.description, jsonStringify(next.settings), fromBool(next.archived), next.updatedAt, id);
    return next;
  }

  findByPath(rootPath: string): Project | undefined {
    const row = this.#db.prepare('SELECT * FROM projects WHERE root_path = ?').get(rootPath) as Row | undefined;
    return row === undefined ? undefined : mapProject(row);
  }
}

function mapProject(row: Row): Project {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ''),
    rootPath: String(row.root_path),
    gitState: row.git_state as Project['gitState'],
    defaultBranch: row.default_branch === null ? undefined : String(row.default_branch),
    remoteDisplayUrl: row.remote_display_url === null ? undefined : String(row.remote_display_url),
    settings: jsonParse<ProjectSettings>(row.settings_json as string, {}),
    archived: toBool(row.archived),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/* ------------------------------------------------------------------ */
/* Tasks                                                               */
/* ------------------------------------------------------------------ */

export interface CreateTaskInput {
  readonly projectId: string;
  readonly title: string;
  readonly requirementText: string;
  readonly methodId: string;
  readonly methodRevision: string;
  readonly stage?: TaskStageValue;
  readonly fixedTemplate?: FixedTemplateBinding;
}

export interface TaskSummaryRow {
  readonly task: Task;
  readonly projectName: string;
  readonly methodName?: string;
}

export class TaskRepository {
  readonly #db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.#db = db;
  }

  create(input: CreateTaskInput): Task {
    const at = nowIso();
    const requirement: RequirementInput = {
      text: input.requirementText,
      supplements: [],
      entries: deriveRequirementEntries(input.requirementText),
      revision: 1,
      updatedAt: at,
    };
    const task: Task = {
      id: createId('task'),
      projectId: input.projectId,
      title: input.title,
      stage: input.stage ?? 'draft',
      lifecycle: 'active',
      attention: 'none',
      methodId: input.methodId,
      methodRevision: input.methodRevision,
      fixedTemplate: input.fixedTemplate,
      requirement,
      createdAt: at,
      updatedAt: at,
    };
    this.#db
      .prepare(
        `INSERT INTO tasks (id, project_id, title, stage, lifecycle, attention, method_id, method_revision, fixed_template_json, requirement_json, revision, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(
        task.id,
        task.projectId,
        task.title,
        task.stage,
        task.lifecycle,
        task.attention,
        task.methodId,
        task.methodRevision,
        task.fixedTemplate === undefined ? null : jsonStringify(task.fixedTemplate),
        jsonStringify(task.requirement),
        task.createdAt,
        task.updatedAt,
      );
    return task;
  }

  get(id: string): Task | undefined {
    const row = this.#db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row | undefined;
    return row === undefined ? undefined : mapTask(row);
  }

  list(): readonly Task[] {
    const rows = this.#db.prepare('SELECT * FROM tasks ORDER BY updated_at DESC').all() as unknown as Row[];
    return rows.map(mapTask);
  }

  listByProject(projectId: string): readonly Task[] {
    const rows = this.#db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY updated_at DESC').all(projectId) as unknown as Row[];
    return rows.map(mapTask);
  }

  update(id: string, patch: Partial<Omit<Task, 'id' | 'projectId' | 'createdAt'>>): Task | undefined {
    const current = this.get(id);
    if (current === undefined) return undefined;
    const next: Task = { ...current, ...patch, updatedAt: nowIso() };
    this.#db
      .prepare(
        `UPDATE tasks SET title = ?, stage = ?, lifecycle = ?, attention = ?, method_id = ?, method_revision = ?,
           fixed_template_json = ?, requirement_json = ?, current_plan_revision_id = ?, current_planning_round_id = ?,
           workspace_id = ?, execution_id = ?, delivery_id = ?, revision = revision + 1, updated_at = ? WHERE id = ?`,
      )
      .run(
        next.title,
        next.stage,
        next.lifecycle,
        next.attention,
        next.methodId,
        next.methodRevision,
        next.fixedTemplate === undefined ? null : jsonStringify(next.fixedTemplate),
        jsonStringify(next.requirement),
        next.currentPlanRevisionId ?? null,
        next.currentPlanningRoundId ?? null,
        next.workspaceId ?? null,
        next.executionId ?? null,
        next.deliveryId ?? null,
        next.updatedAt,
        id,
      );
    return next;
  }

  incrementRevision(id: string): number {
    const row = this.#db.prepare('SELECT revision FROM tasks WHERE id = ?').get(id) as { revision: number } | undefined;
    const revision = Number(row?.revision ?? 0) + 1;
    this.#db.prepare('UPDATE tasks SET revision = ?, updated_at = ? WHERE id = ?').run(revision, nowIso(), id);
    return revision;
  }

  summaries(): readonly TaskSummary[] {
    const tasks = this.list();
    const projectNames = new Map(
      (this.#db.prepare('SELECT id, name FROM projects').all() as unknown as { id: string; name: string }[]).map((row) => [row.id, row.name]),
    );
    const methodNames = new Map<string, string>();
    for (const task of tasks) methodNames.set(task.methodId, task.methodId);
    return tasks.map((task) => ({
      id: task.id,
      projectId: task.projectId,
      projectName: projectNames.get(task.projectId) ?? '未知项目',
      title: task.title,
      stage: task.stage,
      lifecycle: task.lifecycle,
      attention: task.attention,
      methodName: methodNames.get(task.methodId) ?? task.methodId,
      progress: { done: 0, total: 0, running: 0, failed: 0 },
      updatedAt: task.updatedAt,
    }));
  }

  setAttention(id: string, attention: TaskAttentionValue, stage?: TaskStageValue, lifecycle?: TaskLifecycleValue): void {
    const task = this.get(id);
    if (task === undefined) return;
    this.update(id, { attention, stage: stage ?? task.stage, lifecycle: lifecycle ?? task.lifecycle });
  }
}

function mapTask(row: Row): Task {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    title: String(row.title),
    stage: row.stage as Task['stage'],
    lifecycle: row.lifecycle as Task['lifecycle'],
    attention: row.attention as Task['attention'],
    methodId: String(row.method_id),
    methodRevision: String(row.method_revision),
    fixedTemplate: jsonParse<FixedTemplateBinding | undefined>(row.fixed_template_json as string | null, undefined),
    requirement: jsonParse<RequirementInput>(row.requirement_json as string, {
      text: '',
      supplements: [],
      entries: [],
      revision: 1,
      updatedAt: String(row.updated_at),
    }),
    currentPlanRevisionId: row.current_plan_revision_id === null ? undefined : String(row.current_plan_revision_id),
    currentPlanningRoundId: row.current_planning_round_id === null ? undefined : String(row.current_planning_round_id),
    workspaceId: row.workspace_id === null ? undefined : String(row.workspace_id),
    executionId: row.execution_id === null ? undefined : String(row.execution_id),
    deliveryId: row.delivery_id === null ? undefined : String(row.delivery_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/** Very small deterministic requirement entry derivation for the first slice. */
export function deriveRequirementEntries(text: string): RequirementInput['entries'] {
  const entries: { id: string; kind: 'requirement' | 'constraint' | 'acceptance'; text: string }[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  lines.forEach((line, index) => {
    const kind = /验收|必须|不得|校验/.test(line) ? 'acceptance' : /约束|限制|权限|预算/.test(line) ? 'constraint' : 'requirement';
    entries.push({ id: `R${index + 1}`, kind, text: line });
  });
  return entries;
}
