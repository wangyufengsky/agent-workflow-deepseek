import type {
  EditSession,
  ExecutionNodeState,
  ExecutionStatusValue,
  ExecutionView,
  NodeStatusValue,
  OutputFragment,
  PlanGraph,
  PlanNode,
  PlanNodeId,
  PlanningUsage,
  Attempt,
  AttemptResult,
  WorkspaceCleanupPreview,
  WorkspacePreparationStep,
  TaskWorkspace,
  WorkspaceKindValue,
  WorkspaceStateValue,
} from '@agent-workflow/shared';
import { createId, nowIso } from '@agent-workflow/shared';
import type { SqliteDatabase } from './db.ts';
import { fromBool, jsonParse, jsonStringify, toBool } from './db.ts';

type Row = Record<string, unknown>;

export interface CreateExecutionInput {
  readonly taskId: string;
  readonly planRevisionId: string;
  readonly graph: PlanGraph;
  readonly autoAdvance: boolean;
}

export interface ExecutionPatch {
  readonly planRevisionId?: string;
  readonly status?: ExecutionStatusValue;
  readonly autoAdvance?: boolean;
  readonly progress?: ExecutionView['progress'];
  readonly startedAt?: string;
  readonly endedAt?: string | null;
  readonly pause?: ExecutionView['pause'] | null;
  readonly editSession?: EditSession;
  readonly notice?: ExecutionView['notice'] | null;
}

export interface ExecutionNodePatch {
  readonly status?: NodeStatusValue;
  readonly currentAttemptId?: string | null;
  readonly attemptCount?: number;
  readonly startedAt?: string | null;
  readonly endedAt?: string | null;
  readonly error?: { readonly code: string; readonly message: string } | null;
}

// Evaluate against the stored row in the same UPDATE: a late completion must
// never grant back content access revoked while its session was running.
const preserveRevokedReadability = `json_patch(json_patch(json_patch(?,
  CASE WHEN json_extract(readability_json, '$.output') = 'forbidden' THEN '{"output":"forbidden"}' ELSE '{}' END),
  CASE WHEN json_extract(readability_json, '$.tools') = 'forbidden' THEN '{"tools":"forbidden"}' ELSE '{}' END),
  CASE WHEN json_extract(readability_json, '$.result') = 'forbidden' THEN '{"result":"forbidden"}' ELSE '{}' END)`;

export class ExecutionRepository {
  readonly #db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.#db = db;
  }

  create(input: CreateExecutionInput): ExecutionView {
    const id = createId('exec');
    const graphNodes = input.graph.nodes;
    const incoming = new Map<string, number>();
    for (const node of graphNodes) incoming.set(node.id, 0);
    for (const edge of input.graph.edges) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    const frontier = graphNodes.filter((node) => (incoming.get(node.id) ?? 0) === 0).map((node) => node.id);

    this.#db.transaction(() => {
      this.#db
        .prepare(
          `INSERT INTO executions (id, task_id, plan_revision_id, status, auto_advance, progress_json, revision)
           VALUES (?, ?, ?, 'idle', ?, ?, 0)`,
        )
        .run(
          id,
          input.taskId,
          input.planRevisionId,
          fromBool(input.autoAdvance),
          jsonStringify({ done: 0, total: graphNodes.length, running: 0, failed: 0 }),
        );
      const insert = this.#db.prepare(
        `INSERT INTO execution_nodes (execution_id, node_id, status, attempt_count) VALUES (?, ?, ?, 0)`,
      );
      for (const node of graphNodes) {
        insert.run(id, node.id, frontier.includes(node.id) ? 'ready' : 'pending');
      }
    });

    return this.get(id) ?? this.#emptyView(id, input);
  }

  #emptyView(id: string, input: CreateExecutionInput): ExecutionView {
    return {
      id,
      taskId: input.taskId,
      planRevisionId: input.planRevisionId,
      status: 'idle',
      autoAdvance: input.autoAdvance,
      nodes: [],
      frontier: [],
      progress: { done: 0, total: input.graph.nodes.length, running: 0, failed: 0 },
      actions: {},
    };
  }

  list(): readonly ExecutionView[] {
    const rows = this.#db.prepare('SELECT * FROM executions ORDER BY rowid DESC').all() as unknown as Row[];
    return rows.map((row) => mapExecution(row, this.nodes(String(row.id))));
  }

  get(id: string): ExecutionView | undefined {
    const row = this.#db.prepare('SELECT * FROM executions WHERE id = ?').get(id) as Row | undefined;
    return row === undefined ? undefined : mapExecution(row, this.nodes(id));
  }

  byTask(taskId: string): ExecutionView | undefined {
    const row = this.#db.prepare('SELECT * FROM executions WHERE task_id = ? ORDER BY rowid DESC LIMIT 1').get(taskId) as Row | undefined;
    return row === undefined ? undefined : mapExecution(row, this.nodes(String(row.id)));
  }

  nodes(executionId: string): readonly ExecutionNodeState[] {
    const rows = this.#db.prepare('SELECT * FROM execution_nodes WHERE execution_id = ? ORDER BY rowid ASC').all(executionId) as unknown as Row[];
    return rows.map((row) => ({
      nodeId: String(row.node_id),
      status: row.status as NodeStatusValue,
      currentAttemptId: row.current_attempt_id === null ? undefined : String(row.current_attempt_id),
      attemptCount: Number(row.attempt_count),
      startedAt: row.started_at === null ? undefined : String(row.started_at),
      endedAt: row.ended_at === null ? undefined : String(row.ended_at),
      error: jsonParse<ExecutionNodeState['error'] | undefined>(row.error_json as string | null, undefined),
    }));
  }

  update(id: string, patch: ExecutionPatch): ExecutionView | undefined {
    const current = this.get(id);
    if (current === undefined) return undefined;
    const next: ExecutionView = {
      ...current,
      planRevisionId: patch.planRevisionId ?? current.planRevisionId,
      status: patch.status ?? current.status,
      autoAdvance: patch.autoAdvance ?? current.autoAdvance,
      progress: patch.progress ?? current.progress,
      startedAt: patch.startedAt ?? current.startedAt,
      endedAt: patch.endedAt === null ? undefined : patch.endedAt ?? current.endedAt,
      pause: patch.pause === null ? undefined : patch.pause ?? current.pause,
      editSession: patch.editSession ?? current.editSession,
      notice: patch.notice === null ? undefined : patch.notice === undefined ? current.notice : patch.notice,
    };
    this.#db
      .prepare(
        `UPDATE executions SET plan_revision_id = ?, status = ?, auto_advance = ?, progress_json = ?, started_at = ?, ended_at = ?, pause_json = ?, edit_session_json = ?, notice_json = ?, revision = revision + 1 WHERE id = ?`,
      )
      .run(
        next.planRevisionId,
        next.status,
        fromBool(next.autoAdvance),
        jsonStringify(next.progress),
        next.startedAt ?? null,
        next.endedAt ?? null,
        next.pause === undefined ? null : jsonStringify(next.pause),
        next.editSession === undefined ? null : jsonStringify(next.editSession),
        next.notice === undefined ? null : jsonStringify(next.notice),
        id,
      );
    return this.get(id);
  }

  updateNode(executionId: string, nodeId: string, patch: ExecutionNodePatch): void {
    const current = this.#db.prepare('SELECT * FROM execution_nodes WHERE execution_id = ? AND node_id = ?').get(executionId, nodeId) as Row | undefined;
    if (current === undefined) return;
    this.#db
      .prepare(
        `UPDATE execution_nodes SET status = ?, current_attempt_id = ?, attempt_count = ?, started_at = ?, ended_at = ?, error_json = ?
         WHERE execution_id = ? AND node_id = ?`,
      )
      .run(
        patch.status ?? String(current.status),
        patch.currentAttemptId === undefined ? (current.current_attempt_id as string | null) : patch.currentAttemptId,
        patch.attemptCount ?? Number(current.attempt_count),
        patch.startedAt === undefined ? (current.started_at as string | null) : patch.startedAt,
        patch.endedAt === undefined ? (current.ended_at as string | null) : patch.endedAt,
        patch.error === undefined ? (current.error_json as string | null) : patch.error === null ? null : jsonStringify(patch.error),
        executionId,
        nodeId,
      );
  }

  setFrontier(executionId: string, frontier: readonly string[]): void {
    const execution = this.get(executionId);
    if (execution === undefined) return;
    this.#db
      .prepare('UPDATE executions SET progress_json = ?, revision = revision + 1 WHERE id = ?')
      .run(jsonStringify({ ...execution.progress, frontier }), executionId);
  }

  /** Atomically change the current graph binding without erasing any attempted-node history. */
  rebindPlan(executionId: string, planRevisionId: string, graph: PlanGraph): ExecutionView | undefined {
    const current = this.get(executionId);
    if (current === undefined) return undefined;
    this.#db.transaction(() => {
      const keep = new Set(graph.nodes.map((node) => node.id));
      for (const node of current.nodes) {
        if (!keep.has(node.nodeId) && node.attemptCount === 0) this.#db.prepare('DELETE FROM execution_nodes WHERE execution_id = ? AND node_id = ?').run(executionId, node.nodeId);
      }
      for (const definition of graph.nodes) {
        const node = current.nodes.find((item) => item.nodeId === definition.id);
        if (node === undefined) this.#db.prepare("INSERT INTO execution_nodes (execution_id,node_id,status,attempt_count) VALUES (?,?,'pending',0)").run(executionId, definition.id);
        else if (node.attemptCount === 0 && ['ready', 'pending'].includes(node.status)) this.updateNode(executionId, node.nodeId, { status: 'pending' });
      }
      this.update(executionId, { planRevisionId });
    });
    return this.get(executionId);
  }

  preserveAttemptDefinition(attemptId: string, planRevisionId: string, node: PlanNode): void {
    this.#db.prepare('INSERT INTO settings (key,value_json,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO NOTHING')
      .run(`execution.attempt-definition.${attemptId}`, jsonStringify({ planRevisionId, node }), nowIso());
  }

  #attempt(row: Row): Attempt {
    const attempt = mapAttempt(row);
    const definition = this.#db.prepare('SELECT value_json FROM settings WHERE key = ?').get(`execution.attempt-definition.${attempt.id}`) as { value_json: string } | undefined;
    return definition === undefined ? attempt : { ...attempt, definition: jsonParse<Attempt['definition']>(definition.value_json, undefined) };
  }

  createAttempt(input: { executionId: string; nodeId: string; ordinal: number; definition?: { readonly planRevisionId: string; readonly node: PlanNode } }): Attempt {
    const dbRow = this.#db.prepare('SELECT MAX(ordinal) AS max FROM attempts WHERE execution_id = ? AND node_id = ?').get(input.executionId, input.nodeId) as { max: number | null };
    const ordinal = Math.max(Number(dbRow.max ?? 0) + 1, input.ordinal);
    const attempt: Attempt = {
      id: createId('attempt'),
      executionId: input.executionId,
      nodeId: input.nodeId,
      ordinal,
      status: 'running',
      startedAt: nowIso(),
      readability: { output: 'ok', tools: 'ok', result: 'ok' },
    };
    this.#db.transaction(() => {
      this.#db.prepare('INSERT INTO attempts (id, execution_id, node_id, ordinal, status, started_at, result_json, readability_json) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)')
        .run(attempt.id, attempt.executionId, attempt.nodeId, attempt.ordinal, attempt.status, attempt.startedAt ?? nowIso(), jsonStringify(attempt.readability));
      if (input.definition !== undefined) this.preserveAttemptDefinition(attempt.id, input.definition.planRevisionId, input.definition.node);
    });
    return this.getAttempt(attempt.id)!;
  }

  getAttempt(id: string): Attempt | undefined {
    const row = this.#db.prepare('SELECT * FROM attempts WHERE id = ?').get(id) as Row | undefined;
    return row === undefined ? undefined : this.#attempt(row);
  }

  listAttempts(executionId: string, nodeId?: string): readonly Attempt[] {
    const rows = nodeId === undefined
      ? (this.#db.prepare('SELECT * FROM attempts WHERE execution_id = ? ORDER BY ordinal DESC').all(executionId) as unknown as Row[])
      : (this.#db.prepare('SELECT * FROM attempts WHERE execution_id = ? AND node_id = ? ORDER BY ordinal DESC').all(executionId, nodeId) as unknown as Row[]);
    return rows.map((row) => this.#attempt(row));
  }

  /** Persist a submission before the remote session ends, without claiming execution success. */
  saveSubmittedResult(id: string, result: AttemptResult): boolean {
    const saved = this.#db.prepare(`UPDATE attempts SET result_json = ?, readability_json = ${preserveRevokedReadability} WHERE id = ? AND status = 'running' AND result_json IS NULL`)
      .run(jsonStringify(result), jsonStringify({ output: 'ok', tools: 'ok', result: 'ok' }), id);
    return Number(saved.changes) === 1;
  }

  finishAttempt(id: string, status: NodeStatusValue, result?: AttemptResult, error?: string, usage?: Attempt['usage']): void {
    const endedAt = nowIso();
    result ??= this.getAttempt(id)?.result;
    this.#db
      .prepare(`UPDATE attempts SET status = ?, ended_at = ?, result_json = ?, readability_json = ${preserveRevokedReadability}, usage_json = ? WHERE id = ?`)
      .run(
        status,
        endedAt,
        result === undefined ? null : jsonStringify(result),
        jsonStringify({ output: 'ok', tools: 'ok', result: result === undefined ? 'not_submitted' : 'ok', error }),
        usage === undefined ? null : jsonStringify(usage),
        id,
      );
  }

  appendOutput(input: { attemptId: string; seq: number; fragment: OutputFragment }): void {
    const previous = input.fragment.toolCallRef?.callId ? this.readToolRecord(input.attemptId, input.fragment.toolCallRef.callId)?.evidence : undefined;
    const evidence = input.fragment.toolEvidence === undefined ? previous : { ...previous, ...input.fragment.toolEvidence, redacted: previous?.redacted === true || input.fragment.toolEvidence.redacted, truncated: previous?.truncated === true || input.fragment.toolEvidence.truncated };
    this.#db
      .prepare('INSERT OR IGNORE INTO node_output (attempt_id, seq, fragment_id, category, at, text, block_id, tool_call_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        input.attemptId,
        input.seq,
        input.fragment.fragmentId,
        input.fragment.category,
        input.fragment.recordedAt ?? null,
        input.fragment.text ?? null,
        input.fragment.blockId ?? null,
        input.fragment.toolCallRef === undefined ? null : jsonStringify({ ...input.fragment.toolCallRef, ...(evidence === undefined ? {} : { evidence }) }),
      );
  }

  readToolRecord(attemptId: string, callId: string): { revision: string; reference: NonNullable<OutputFragment['toolCallRef']>; evidence?: OutputFragment['toolEvidence'] } | undefined {
    const row = this.#db.prepare("SELECT fragment_id, tool_call_json FROM node_output WHERE attempt_id = ? AND json_extract(tool_call_json, '$.callId') = ? ORDER BY seq DESC LIMIT 1").get(attemptId, callId) as Row | undefined;
    if (row === undefined) return undefined;
    const record = jsonParse<NonNullable<OutputFragment['toolCallRef']> & { evidence?: OutputFragment['toolEvidence'] }>(row.tool_call_json as string, { callId, status: 'unknown', source: 'opencode' });
    return { revision: String(row.fragment_id), reference: { callId: record.callId, status: record.status, source: record.source }, evidence: record.evidence };
  }

  listOutput(attemptId: string, afterSeq = 0, limit = 500): readonly OutputFragment[] {
    const rows = this.#db
      .prepare('SELECT * FROM node_output WHERE attempt_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?')
      .all(attemptId, afterSeq, limit) as unknown as Row[];
    return rows.map((row) => ({
      fragmentId: String(row.fragment_id),
      seq: Number(row.seq),
      category: row.category as OutputFragment['category'],
      recordedAt: row.at === null ? undefined : String(row.at),
      format: row.category === 'model_text' ? 'markdown' : undefined,
      text: row.text === null ? undefined : String(row.text),
      blockId: row.block_id === null ? undefined : String(row.block_id),
      toolCallRef: jsonParse<OutputFragment['toolCallRef'] | undefined>(row.tool_call_json as string | null, undefined),
      toolEvidence: jsonParse<{ evidence?: OutputFragment['toolEvidence'] }>(row.tool_call_json as string | null, {}).evidence,
    }));
  }
}

function mapExecution(row: Row, nodes: readonly ExecutionNodeState[]): ExecutionView {
  const progress = jsonParse<ExecutionView['progress']>(row.progress_json as string, { done: 0, total: 0, running: 0, failed: 0 });
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    planRevisionId: String(row.plan_revision_id),
    status: row.status as ExecutionStatusValue,
    autoAdvance: toBool(row.auto_advance),
    nodes,
    frontier: nodes.filter((node) => node.status === 'ready' || node.status === 'running').map((node) => node.nodeId),
    progress,
    startedAt: row.started_at === null ? undefined : String(row.started_at),
    endedAt: row.ended_at === null ? undefined : String(row.ended_at),
    pause: jsonParse<ExecutionView['pause'] | undefined>(row.pause_json as string | null, undefined),
    editSession: jsonParse<EditSession | undefined>(row.edit_session_json as string | null, undefined),
    notice: jsonParse<ExecutionView['notice'] | undefined>(row.notice_json as string | null, undefined),
    actions: {},
  };
}

function mapAttempt(row: Row): Attempt {
  return {
    id: String(row.id),
    executionId: String(row.execution_id),
    nodeId: String(row.node_id),
    ordinal: Number(row.ordinal),
    status: row.status as NodeStatusValue,
    startedAt: row.started_at === null ? undefined : String(row.started_at),
    endedAt: row.ended_at === null ? undefined : String(row.ended_at),
    result: jsonParse<AttemptResult | undefined>(row.result_json as string | null, undefined),
    usage: jsonParse<Attempt['usage']>(row.usage_json as string | null, undefined),
    readability: jsonParse<Attempt['readability']>(row.readability_json as string, { output: 'unknown', tools: 'unknown', result: 'unknown' }),
  };
}

/* ------------------------------------------------------------------ */
/* Workspaces                                                          */
/* ------------------------------------------------------------------ */

export interface CreateWorkspaceInput {
  readonly taskId: string;
  readonly kind: WorkspaceKindValue;
  readonly displayRoot?: string;
  readonly originalRootDisplay?: string;
  readonly branch?: string;
  readonly baseRef?: string;
  readonly baseSha?: string;
  readonly worktreeHandle?: string;
}

export class WorkspaceRepository {
  readonly #db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.#db = db;
  }

  create(input: CreateWorkspaceInput): TaskWorkspace {
    const workspace: TaskWorkspace = {
      id: createId('ws'),
      taskId: input.taskId,
      kind: input.kind,
      state: 'not_started',
      revision: '1',
      displayRoot: input.displayRoot,
      originalRootDisplay: input.originalRootDisplay,
      branch: input.branch,
      baseRef: input.baseRef,
      baseSha: input.baseSha,
      worktreeHandle: input.worktreeHandle,
      steps: [],
      parallelWritePolicy: 'serial',
      children: [],
      activeWrites: [],
      retention: 'retained',
      actions: {},
      createdAt: nowIso(),
    };
    this.#db
      .prepare(
        `INSERT INTO workspaces (id, task_id, kind, state, revision, display_root, original_root_display, branch, base_ref, base_sha, worktree_handle,
           steps_json, parallel_write_policy, children_json, active_writes_json, pending_operation_ref, retention, created_at, last_checked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'serial', '[]', '[]', NULL, 'retained', ?, NULL)`,
      )
      .run(
        workspace.id,
        workspace.taskId,
        workspace.kind,
        workspace.state,
        workspace.revision,
        workspace.displayRoot ?? null,
        workspace.originalRootDisplay ?? null,
        workspace.branch ?? null,
        workspace.baseRef ?? null,
        workspace.baseSha ?? null,
        workspace.worktreeHandle ?? null,
        workspace.createdAt ?? nowIso(),
      );
    return workspace;
  }

  get(id: string): TaskWorkspace | undefined {
    const row = this.#db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as Row | undefined;
    return row === undefined ? undefined : mapWorkspace(row);
  }

  byTask(taskId: string): TaskWorkspace | undefined {
    const row = this.#db.prepare('SELECT * FROM workspaces WHERE task_id = ? ORDER BY rowid DESC LIMIT 1').get(taskId) as Row | undefined;
    return row === undefined ? undefined : mapWorkspace(row);
  }

  update(
    id: string,
    patch: Partial<
      Pick<
        TaskWorkspace,
        | 'state'
        | 'displayRoot'
        | 'originalRootDisplay'
        | 'branch'
        | 'baseRef'
        | 'baseSha'
        | 'worktreeHandle'
        | 'steps'
        | 'parallelWritePolicy'
        | 'children'
        | 'activeWrites'
        | 'pendingOperationRef'
        | 'retention'
        | 'lastCheckedAt'
      >
    >,
  ): TaskWorkspace | undefined {
    const current = this.get(id);
    if (current === undefined) return undefined;
    const revision = String(Number(current.revision) + 1);
    this.#db
      .prepare(
        `UPDATE workspaces SET state = ?, revision = ?, display_root = ?, original_root_display = ?, branch = ?, base_ref = ?, base_sha = ?,
           worktree_handle = ?, steps_json = ?, parallel_write_policy = ?, children_json = ?, active_writes_json = ?, pending_operation_ref = ?,
           retention = ?, last_checked_at = ? WHERE id = ?`,
      )
      .run(
        patch.state ?? current.state,
        revision,
        patch.displayRoot ?? current.displayRoot ?? null,
        patch.originalRootDisplay ?? current.originalRootDisplay ?? null,
        patch.branch ?? current.branch ?? null,
        patch.baseRef ?? current.baseRef ?? null,
        patch.baseSha ?? current.baseSha ?? null,
        patch.worktreeHandle ?? current.worktreeHandle ?? null,
        jsonStringify(patch.steps ?? current.steps),
        patch.parallelWritePolicy ?? current.parallelWritePolicy,
        jsonStringify(patch.children ?? current.children),
        jsonStringify(patch.activeWrites ?? current.activeWrites),
        patch.pendingOperationRef ?? current.pendingOperationRef ?? null,
        patch.retention ?? current.retention,
        patch.lastCheckedAt ?? current.lastCheckedAt ?? nowIso(),
        id,
      );
    return this.get(id);
  }
}

function mapWorkspace(row: Row): TaskWorkspace {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    kind: row.kind as WorkspaceKindValue,
    state: row.state as WorkspaceStateValue,
    revision: String(row.revision),
    displayRoot: row.display_root === null ? undefined : String(row.display_root),
    originalRootDisplay: row.original_root_display === null ? undefined : String(row.original_root_display),
    branch: row.branch === null ? undefined : String(row.branch),
    baseRef: row.base_ref === null ? undefined : String(row.base_ref),
    baseSha: row.base_sha === null ? undefined : String(row.base_sha),
    worktreeHandle: row.worktree_handle === null ? undefined : String(row.worktree_handle),
    steps: jsonParse<readonly WorkspacePreparationStep[]>(row.steps_json as string, []),
    parallelWritePolicy: (row.parallel_write_policy as TaskWorkspace['parallelWritePolicy']) ?? 'serial',
    children: jsonParse<TaskWorkspace['children']>(row.children_json as string, []),
    activeWrites: jsonParse<readonly string[]>(row.active_writes_json as string, []) as readonly PlanNodeId[],
    pendingOperationRef: row.pending_operation_ref === null ? undefined : String(row.pending_operation_ref),
    retention: (row.retention as TaskWorkspace['retention']) ?? 'retained',
    createdAt: row.created_at === null ? undefined : String(row.created_at),
    lastCheckedAt: row.last_checked_at === null ? undefined : String(row.last_checked_at),
    actions: {},
  };
}
