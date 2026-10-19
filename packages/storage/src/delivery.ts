import type { DeliveryProjectionValue, DeliveryStepState, DeliveryGoalValue, TaskDelivery, DirectoryApplyPreview } from '@agent-workflow/shared';
import { createId, nowIso } from '@agent-workflow/shared';
import type { SqliteDatabase } from './db.ts';
import { jsonParse, jsonStringify } from './db.ts';

type Row = Record<string, unknown>;

export interface CreateDeliveryInput {
  readonly taskId: string;
  readonly workspaceId?: string;
  readonly changesRevision?: string;
  readonly eligibility: TaskDelivery['eligibility'];
}

export interface DeliveryPatch {
  readonly projection?: DeliveryProjectionValue;
  readonly projectionReason?: string;
  readonly goal?: DeliveryGoalValue;
  readonly changesRevision?: string;
  readonly selectedFileIds?: readonly string[];
  readonly remaining?: TaskDelivery['remaining'];
  readonly eligibility?: TaskDelivery['eligibility'];
  readonly steps?: readonly DeliveryStepState[];
  readonly verificationOutcome?: TaskDelivery['verificationOutcome'];
  readonly taskCompletionRef?: string;
  readonly applyPreview?: DirectoryApplyPreview;
  readonly workspaceRetention?: TaskDelivery['workspaceRetention'];
}

export class DeliveryRepository {
  readonly #db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.#db = db;
  }

  create(input: CreateDeliveryInput): TaskDelivery {
    const delivery: TaskDelivery = {
      id: createId('delivery'),
      taskId: input.taskId,
      workspaceId: input.workspaceId,
      revision: '1',
      projection: 'awaiting_selection',
      changesRevision: input.changesRevision,
      selectedFileIds: [],
      remaining: { unselected: 0, detail: '' },
      eligibility: input.eligibility,
      steps: [],
      lastUpdatedAt: nowIso(),
      actions: {},
    };
    this.#db
      .prepare(
        `INSERT INTO deliveries (id, task_id, workspace_id, revision, projection, changes_revision, selected_file_ids_json, remaining_json,
           eligibility_json, steps_json, last_updated_at)
         VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, '[]', ?)`,
      )
      .run(
        delivery.id,
        delivery.taskId,
        input.workspaceId ?? null,
        delivery.revision,
        delivery.projection,
        input.changesRevision ?? null,
        jsonStringify(delivery.remaining),
        jsonStringify(delivery.eligibility),
        delivery.lastUpdatedAt,
      );
    return delivery;
  }

  get(id: string): TaskDelivery | undefined {
    const row = this.#db.prepare('SELECT * FROM deliveries WHERE id = ?').get(id) as Row | undefined;
    return row === undefined ? undefined : mapDelivery(row);
  }

  byTask(taskId: string): TaskDelivery | undefined {
    const row = this.#db.prepare('SELECT * FROM deliveries WHERE task_id = ? ORDER BY rowid DESC LIMIT 1').get(taskId) as Row | undefined;
    return row === undefined ? undefined : mapDelivery(row);
  }

  update(id: string, patch: DeliveryPatch): TaskDelivery | undefined {
    const current = this.get(id);
    if (current === undefined) return undefined;
    const revision = String(Number(current.revision) + 1);
    this.#db
      .prepare(
        `UPDATE deliveries SET revision = ?, projection = ?, projection_reason = ?, goal = ?, changes_revision = ?, selected_file_ids_json = ?,
           remaining_json = ?, eligibility_json = ?, steps_json = ?, verification_outcome = ?, task_completion_ref = ?, apply_preview_json = ?,
           workspace_retention = ?, last_updated_at = ? WHERE id = ?`,
      )
      .run(
        revision,
        patch.projection ?? current.projection,
        patch.projectionReason ?? current.projectionReason ?? null,
        patch.goal ?? current.goal ?? null,
        patch.changesRevision ?? current.changesRevision ?? null,
        jsonStringify(patch.selectedFileIds ?? current.selectedFileIds),
        jsonStringify(patch.remaining ?? current.remaining),
        jsonStringify(patch.eligibility ?? current.eligibility),
        jsonStringify(patch.steps ?? current.steps),
        patch.verificationOutcome ?? current.verificationOutcome ?? null,
        patch.taskCompletionRef ?? current.taskCompletionRef ?? null,
        patch.applyPreview === undefined ? (current.applyPreview === undefined ? null : jsonStringify(current.applyPreview)) : jsonStringify(patch.applyPreview),
        patch.workspaceRetention ?? current.workspaceRetention ?? null,
        nowIso(),
        id,
      );
    return this.get(id);
  }
}

function mapDelivery(row: Row): TaskDelivery {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    workspaceId: row.workspace_id === null ? undefined : String(row.workspace_id),
    revision: String(row.revision),
    projection: row.projection as DeliveryProjectionValue,
    projectionReason: row.projection_reason === null ? undefined : String(row.projection_reason),
    goal: row.goal === null ? undefined : (row.goal as DeliveryGoalValue),
    changesRevision: row.changes_revision === null ? undefined : String(row.changes_revision),
    selectedFileIds: jsonParse<readonly string[]>(row.selected_file_ids_json as string, []),
    remaining: jsonParse<TaskDelivery['remaining']>(row.remaining_json as string, { unselected: 0, detail: '' }),
    eligibility: jsonParse<TaskDelivery['eligibility']>(row.eligibility_json as string, { allowed: false, reason: '未知' }),
    steps: jsonParse<readonly DeliveryStepState[]>(row.steps_json as string, []),
    verificationOutcome: row.verification_outcome === null ? undefined : (row.verification_outcome as TaskDelivery['verificationOutcome']),
    taskCompletionRef: row.task_completion_ref === null ? undefined : String(row.task_completion_ref),
    applyPreview: jsonParse<DirectoryApplyPreview | undefined>(row.apply_preview_json as string | null, undefined),
    workspaceRetention: row.workspace_retention === null ? undefined : (row.workspace_retention as TaskDelivery['workspaceRetention']),
    lastUpdatedAt: String(row.last_updated_at),
    actions: {},
  };
}
