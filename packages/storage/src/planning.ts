import type {
  ModelProfile,
  NodeDiff,
  PlanGraph,
  PlanRevision,
  PlanRevisionStatusValue,
  PlanValidation,
  PlanningAssumption,
  PlanningCheckpoint,
  PlanningQuestion,
  PlanningRecordGap,
  PlanningRound,
  PlanningStageRun,
  PlanningUsage,
} from '@agent-workflow/shared';
import { createId, nowIso } from '@agent-workflow/shared';
import type { SqliteDatabase } from './db.ts';
import { jsonParse, jsonStringify } from './db.ts';

type Row = Record<string, unknown>;

export interface CreatePlanRevisionInput {
  readonly taskId: string;
  readonly source: PlanRevision['source'];
  readonly graph: PlanGraph;
  readonly baseRevisionId?: string;
  readonly status?: PlanRevisionStatusValue;
  readonly validation?: PlanValidation;
  readonly diff?: readonly NodeDiff[];
}

export class PlanRepository {
  readonly #db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.#db = db;
  }

  create(input: CreatePlanRevisionInput): PlanRevision {
    const row = this.#db.prepare('SELECT COALESCE(MAX(revision_number), 0) AS max FROM plan_revisions WHERE task_id = ?').get(input.taskId) as { max: number };
    const revisionNumber = Number(row.max) + 1;
    const plan: PlanRevision = {
      id: createId('plan'),
      taskId: input.taskId,
      revisionNumber,
      status: input.status ?? 'draft',
      source: input.source,
      baseRevisionId: input.baseRevisionId,
      graph: input.graph,
      validation: input.validation,
      diff: input.diff,
      createdAt: nowIso(),
    };
    this.#db
      .prepare(
        `INSERT INTO plan_revisions (id, task_id, revision_number, status, source, base_revision_id, graph_json, validation_json, diff_json, created_at, confirmed_at, confirmed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        plan.id,
        plan.taskId,
        plan.revisionNumber,
        plan.status,
        plan.source,
        plan.baseRevisionId ?? null,
        jsonStringify(plan.graph),
        plan.validation === undefined ? null : jsonStringify(plan.validation),
        plan.diff === undefined ? null : jsonStringify(plan.diff),
        plan.createdAt,
        plan.confirmedAt ?? null,
        plan.confirmedBy ?? null,
      );
    return plan;
  }

  get(id: string): PlanRevision | undefined {
    const row = this.#db.prepare('SELECT * FROM plan_revisions WHERE id = ?').get(id) as Row | undefined;
    return row === undefined ? undefined : mapPlan(row);
  }

  latest(taskId: string): PlanRevision | undefined {
    const row = this.#db.prepare('SELECT * FROM plan_revisions WHERE task_id = ? ORDER BY revision_number DESC LIMIT 1').get(taskId) as Row | undefined;
    return row === undefined ? undefined : mapPlan(row);
  }

  latestConfirmed(taskId: string): PlanRevision | undefined {
    const row = this.#db
      .prepare("SELECT * FROM plan_revisions WHERE task_id = ? AND status = 'confirmed' ORDER BY revision_number DESC LIMIT 1")
      .get(taskId) as Row | undefined;
    return row === undefined ? undefined : mapPlan(row);
  }

  list(taskId: string): readonly PlanRevision[] {
    const rows = this.#db.prepare('SELECT * FROM plan_revisions WHERE task_id = ? ORDER BY revision_number DESC').all(taskId) as unknown as Row[];
    return rows.map(mapPlan);
  }

  setStatus(id: string, status: PlanRevisionStatusValue, options: { confirmedBy?: string; supersedeSiblingsForTaskId?: string } = {}): PlanRevision | undefined {
    const current = this.get(id);
    if (current === undefined) return undefined;
    if (options.supersedeSiblingsForTaskId !== undefined && status === 'confirmed') {
      this.#db
        .prepare("UPDATE plan_revisions SET status = 'superseded' WHERE task_id = ? AND id != ? AND status IN ('draft','unconfirmed','confirmed')")
        .run(options.supersedeSiblingsForTaskId, id);
    }
    const confirmedAt = status === 'confirmed' ? nowIso() : current.confirmedAt;
    this.#db
      .prepare('UPDATE plan_revisions SET status = ?, confirmed_at = ?, confirmed_by = ? WHERE id = ?')
      .run(status, confirmedAt ?? null, options.confirmedBy ?? current.confirmedBy ?? null, id);
    return this.get(id);
  }

  updateGraph(id: string, graph: PlanGraph, diff?: readonly NodeDiff[]): PlanRevision | undefined {
    this.#db
      .prepare('UPDATE plan_revisions SET graph_json = ?, diff_json = COALESCE(?, diff_json) WHERE id = ?')
      .run(jsonStringify(graph), diff === undefined ? null : jsonStringify(diff), id);
    return this.get(id);
  }

  setValidation(id: string, validation: PlanValidation, diff?: readonly NodeDiff[]): void {
    this.#db
      .prepare('UPDATE plan_revisions SET validation_json = ?, diff_json = COALESCE(?, diff_json) WHERE id = ?')
      .run(jsonStringify(validation), diff === undefined ? null : jsonStringify(diff), id);
  }
}

function mapPlan(row: Row): PlanRevision {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    revisionNumber: Number(row.revision_number),
    status: row.status as PlanRevision['status'],
    source: row.source as PlanRevision['source'],
    baseRevisionId: row.base_revision_id === null ? undefined : String(row.base_revision_id),
    graph: jsonParse<PlanGraph>(row.graph_json as string, { nodes: [], edges: [], groups: [] }),
    validation: jsonParse<PlanValidation | undefined>(row.validation_json as string | null, undefined),
    diff: jsonParse<readonly NodeDiff[] | undefined>(row.diff_json as string | null, undefined),
    createdAt: String(row.created_at),
    confirmedAt: row.confirmed_at === null ? undefined : String(row.confirmed_at),
    confirmedBy: row.confirmed_by === null ? undefined : String(row.confirmed_by),
  };
}

/* ------------------------------------------------------------------ */
/* Planning rounds                                                     */
/* ------------------------------------------------------------------ */

export interface CreatePlanningRoundInput {
  readonly taskId: string;
  readonly ordinal: number;
  readonly inputRevision: number;
  readonly method: PlanningRound['method'];
  readonly strategy: PlanningRound['strategy'];
  readonly model: ModelProfile;
  readonly usage: PlanningUsage;
  readonly previousRoundId?: string;
  readonly sessionId?: string;
}

export interface PlanningRoundPatch {
  readonly status?: PlanningRound['status'];
  readonly stage?: PlanningRound['stage'];
  readonly applyStatus?: PlanningRound['applyStatus'];
  readonly stageRuns?: readonly PlanningStageRun[];
  readonly usage?: PlanningUsage;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly lastActivity?: string;
  readonly candidate?: PlanningRound['candidate'];
  readonly questions?: readonly PlanningQuestion[];
  readonly assumptions?: readonly PlanningAssumption[];
  readonly stop?: PlanningRound['stop'];
  readonly failure?: PlanningRound['failure'];
  readonly reconcile?: PlanningRound['reconcile'];
  readonly gaps?: readonly PlanningRecordGap[];
  readonly recordFirstSeq?: number;
  readonly recordLastSeq?: number;
  readonly sessionId?: string;
}

export interface PlanningRecordInput {
  readonly fragmentId: string;
  readonly category: string;
  readonly at?: string;
  readonly text?: string;
  readonly blockId?: string;
  readonly toolCall?: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
}

export interface PlanningRecordRow {
  readonly roundId: string;
  readonly seq: number;
  readonly fragmentId: string;
  readonly category: string;
  readonly at?: string;
  readonly text?: string;
  readonly blockId?: string;
  readonly toolCall?: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
}

export class PlanningRepository {
  readonly #db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.#db = db;
  }

  create(input: CreatePlanningRoundInput): PlanningRound {
    const round: PlanningRound = {
      id: createId('planning'),
      taskId: input.taskId,
      ordinal: input.ordinal,
      status: 'queued',
      stage: 'preparing_input',
      applyStatus: 'not_applied',
      inputRevision: input.inputRevision,
      method: input.method,
      strategy: input.strategy,
      model: input.model,
      stageRuns: [],
      usage: input.usage,
      questions: [],
      assumptions: [],
      previousRoundId: input.previousRoundId,
    sessionId: undefined,
      recordSeq: { first: 1, last: 0, gaps: [] },
    };
    this.#db
      .prepare(
        `INSERT INTO planning_rounds (id, task_id, ordinal, status, stage, apply_status, input_revision, method_json, strategy_json, model_json,
           stage_runs_json, usage_json, questions_json, assumptions_json, previous_round_id, record_first_seq, record_last_seq, gaps_json, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, '[]', '[]', ?, 1, 0, '[]', 0)`,
      )
      .run(
        round.id,
        round.taskId,
        round.ordinal,
        round.status,
        round.stage,
        round.applyStatus,
        round.inputRevision,
        jsonStringify(round.method),
        jsonStringify(round.strategy),
        jsonStringify(round.model),
        jsonStringify(round.usage),
        round.previousRoundId ?? null,
      );
    return round;
  }

  get(id: string): PlanningRound | undefined {
    const row = this.#db.prepare('SELECT * FROM planning_rounds WHERE id = ?').get(id) as Row | undefined;
    return row === undefined ? undefined : mapRound(row);
  }

  latest(taskId: string): PlanningRound | undefined {
    const row = this.#db.prepare('SELECT * FROM planning_rounds WHERE task_id = ? ORDER BY ordinal DESC LIMIT 1').get(taskId) as Row | undefined;
    return row === undefined ? undefined : mapRound(row);
  }

  list(taskId: string): readonly PlanningRound[] {
    const rows = this.#db.prepare('SELECT * FROM planning_rounds WHERE task_id = ? ORDER BY ordinal DESC').all(taskId) as unknown as Row[];
    return rows.map(mapRound);
  }

  count(taskId: string): number {
    const row = this.#db.prepare('SELECT COUNT(*) AS n FROM planning_rounds WHERE task_id = ?').get(taskId) as { n: number };
    return Number(row.n);
  }

  update(id: string, patch: PlanningRoundPatch): PlanningRound | undefined {
    const current = this.get(id);
    if (current === undefined) return undefined;
    const next: PlanningRound = {
      ...current,
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.stage === undefined ? {} : { stage: patch.stage }),
      ...(patch.applyStatus === undefined ? {} : { applyStatus: patch.applyStatus }),
      ...(patch.stageRuns === undefined ? {} : { stageRuns: patch.stageRuns }),
      ...(patch.usage === undefined ? {} : { usage: patch.usage }),
      ...(patch.startedAt === undefined ? {} : { startedAt: patch.startedAt }),
      ...(patch.endedAt === undefined ? {} : { endedAt: patch.endedAt }),
      ...(patch.lastActivity === undefined ? {} : { lastActivity: patch.lastActivity }),
      ...(patch.candidate === undefined ? {} : { candidate: patch.candidate }),
      ...(patch.questions === undefined ? {} : { questions: patch.questions }),
      ...(patch.assumptions === undefined ? {} : { assumptions: patch.assumptions }),
      ...(patch.stop === undefined ? {} : { stop: patch.stop }),
      ...(patch.failure === undefined ? {} : { failure: patch.failure }),
      ...(patch.reconcile === undefined ? {} : { reconcile: patch.reconcile }),
      ...(patch.gaps === undefined ? {} : { recordSeq: { ...current.recordSeq, gaps: patch.gaps } }),
      ...(patch.recordFirstSeq === undefined ? {} : { recordSeq: { ...current.recordSeq, first: patch.recordFirstSeq } }),
      ...(patch.recordLastSeq === undefined ? {} : { recordSeq: { ...current.recordSeq, last: patch.recordLastSeq } }),
      ...(patch.sessionId === undefined ? {} : { sessionId: patch.sessionId }),
    };
    this.#db
      .prepare(
        `UPDATE planning_rounds SET status = ?, stage = ?, apply_status = ?, stage_runs_json = ?, usage_json = ?, started_at = ?, ended_at = ?,
           last_activity = ?, candidate_json = ?, questions_json = ?, assumptions_json = ?, stop_json = ?, failure_json = ?, reconcile_json = ?,
           record_first_seq = ?, record_last_seq = ?, gaps_json = ?, session_id = ?, revision = revision + 1
         WHERE id = ?`,
      )
      .run(
        next.status,
        next.stage,
        next.applyStatus,
        jsonStringify(next.stageRuns),
        jsonStringify(next.usage),
        next.startedAt ?? null,
        next.endedAt ?? null,
        next.lastActivity ?? null,
        next.candidate === undefined ? null : jsonStringify(next.candidate),
        jsonStringify(next.questions),
        jsonStringify(next.assumptions),
        next.stop === undefined ? null : jsonStringify(next.stop),
        next.failure === undefined ? null : jsonStringify(next.failure),
        next.reconcile === undefined ? null : jsonStringify(next.reconcile),
        next.recordSeq.first,
        next.recordSeq.last,
        jsonStringify(next.recordSeq.gaps),
        next.sessionId ?? null,
        id,
      );
    return this.get(id);
  }

  appendRecord(roundId: string, record: PlanningRecordInput): number {
    const row = this.#db.prepare('SELECT COALESCE(MAX(seq), 0) AS max FROM planning_records WHERE round_id = ?').get(roundId) as { max: number };
    const seq = Number(row.max) + 1;
    this.#db
      .prepare(
        `INSERT INTO planning_records (round_id, seq, fragment_id, category, at, text, block_id, tool_call_json, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        roundId,
        seq,
        record.fragmentId,
        record.category,
        record.at ?? null,
        record.text ?? null,
        record.blockId ?? null,
        record.toolCall === undefined ? null : jsonStringify(record.toolCall),
        record.metadata === undefined ? null : jsonStringify(record.metadata),
      );
    this.#db.prepare('UPDATE planning_rounds SET record_last_seq = ? WHERE id = ?').run(seq, roundId);
    return seq;
  }

  listRecords(roundId: string, afterSeq = 0, limit = 500): readonly PlanningRecordRow[] {
    const rows = this.#db
      .prepare('SELECT * FROM planning_records WHERE round_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?')
      .all(roundId, afterSeq, limit) as unknown as Row[];
    return rows.map((row) => ({
      roundId: String(row.round_id),
      seq: Number(row.seq),
      fragmentId: String(row.fragment_id),
      category: String(row.category),
      at: row.at === null ? undefined : String(row.at),
      text: row.text === null ? undefined : String(row.text),
      blockId: row.block_id === null ? undefined : String(row.block_id),
      toolCall: jsonParse<Record<string, unknown> | undefined>(row.tool_call_json as string | null, undefined),
      metadata: jsonParse<Record<string, unknown> | undefined>(row.metadata_json as string | null, undefined),
    }));
  }

  setCheckpoint(roundId: string, checkpoint: PlanningCheckpoint): void {
    const round = this.get(roundId);
    if (round === undefined || round.candidate === undefined) return;
    this.update(roundId, { candidate: { ...round.candidate, checkpoint } });
  }
}

function mapRound(row: Row): PlanningRound {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    ordinal: Number(row.ordinal),
    status: row.status as PlanningRound['status'],
    stage: row.stage as PlanningRound['stage'],
    applyStatus: row.apply_status as PlanningRound['applyStatus'],
    inputRevision: Number(row.input_revision),
    method: jsonParse<PlanningRound['method']>(row.method_json as string, { id: '', revision: '', name: '' }),
    strategy: jsonParse<PlanningRound['strategy']>(row.strategy_json as string, { id: '', version: '' }),
    model: jsonParse<ModelProfile>(row.model_json as string, { id: '', label: '', provider: '', model: '', roles: [], enabled: false }),
    stageRuns: jsonParse<readonly PlanningStageRun[]>(row.stage_runs_json as string, []),
    usage: jsonParse<PlanningUsage>(row.usage_json as string, {
      dispatches: { used: 0, maximum: 2 },
      revisions: { used: 0, maximum: 1 },
      budget: { known: 0, reserved: 0, unknown: 0, currency: 'USD' },
    }),
    startedAt: row.started_at === null ? undefined : String(row.started_at),
    endedAt: row.ended_at === null ? undefined : String(row.ended_at),
    lastActivity: row.last_activity === null ? undefined : String(row.last_activity),
    candidate: jsonParse<PlanningRound['candidate'] | undefined>(row.candidate_json as string | null, undefined),
    questions: jsonParse<readonly PlanningQuestion[]>(row.questions_json as string, []),
    assumptions: jsonParse<readonly PlanningAssumption[]>(row.assumptions_json as string, []),
    stop: jsonParse<PlanningRound['stop'] | undefined>(row.stop_json as string | null, undefined),
    failure: jsonParse<PlanningRound['failure'] | undefined>(row.failure_json as string | null, undefined),
    reconcile: jsonParse<PlanningRound['reconcile'] | undefined>(row.reconcile_json as string | null, undefined),
    previousRoundId: row.previous_round_id === null ? undefined : String(row.previous_round_id),
    sessionId: row.session_id === null || row.session_id === undefined ? undefined : String(row.session_id),
    recordSeq: {
      first: Number(row.record_first_seq ?? 1),
      last: Number(row.record_last_seq ?? 0),
      gaps: jsonParse<readonly PlanningRecordGap[]>(row.gaps_json as string, []),
    },
  };
}
