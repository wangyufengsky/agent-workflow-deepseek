import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { snapshotReport } from './snapshot-review.ts';
import { createHash } from 'node:crypto';
import type {
  Attempt,
  ExecutionView,
  IsoDateTime,
  OperationRecord,
  PlanNode,
  PlanRevision,
  Task,
  TaskDelivery,
  TaskTemplate,
  TaskWorkspace,
} from '@agent-workflow/shared';
import { AppError, DEFAULT_CATALOG, ErrorCode, NodeStatus, createId, nowIso } from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';

/**
 * W3-5 · Task-canvas extras read models (backend core, not wired to HTTP yet).
 *
 * Covers the four "更多" entries of the task canvas plus the B-07 snapshot
 * review panel:
 *
 * 1. Frozen plan snapshot — an immutable, locally attributed freeze of one plan
 *    revision, persisted in the settings JSON (`task.freeze.<taskId>`). Freezing
 *    never mutates the plan or the execution.
 * 2. Audit timeline — read-only, derived from the durable event log plus the
 *    operation ledger (plan confirm, execution commands, node verdicts,
 *    delivery). Paged newest-first.
 * 3. Snapshot review panel — for fixed-template tasks: execution progress,
 *    review scope/versions, feature batches grouped by template step and an
 *    honest empty partial report (the review-report service does not exist yet;
 *    nothing is fabricated).
 * 4. Run content — plan nodes + latest attempts + output fragments grouped into
 *    documents / source / tests for the "运行内容" entry.
 *
 * This service is instantiable on its own (`new TaskExtrasService({ store })`)
 * so tests do not need an Engine or HTTP server. The next wave wires it into
 * Engine/routes/contracts.
 */

const FREEZE_KEY_PREFIX = 'task.freeze.';
const FREEZE_LIMIT_PER_TASK = 20;
const MAX_NOTE = 500;
const MAX_ACTOR = 120;
const AUDIT_EVENT_SCAN_LIMIT = 5_000;
const AUDIT_LEDGER_SCAN_LIMIT = 500;
const AUDIT_DEFAULT_LIMIT = 30;
const AUDIT_MAX_LIMIT = 100;
const SNAPSHOT_DEFAULT_BATCH_LIMIT = 10;
const SNAPSHOT_MAX_BATCH_LIMIT = 50;
const OUTPUT_FRAGMENT_SCAN_LIMIT = 500;

export interface TaskExtrasServiceOptions {
  readonly store: Store;
  /** Effective fixed-template catalog (may be mutated in place by the engine). */
  readonly templates?: () => readonly TaskTemplate[];
  /** Local operator label used for frozen snapshots ("操作人（本地）"). */
  readonly actor?: () => string;
}

/* ------------------------------------------------------------------ */
/* 1 · Frozen plan snapshot                                            */
/* ------------------------------------------------------------------ */

export interface FrozenPlanSnapshot {
  readonly snapshotId: string;
  readonly taskId: string;
  readonly planRevisionId: string;
  readonly planRevisionNumber: number;
  readonly planStatus: string;
  readonly planHash: string;
  readonly frozenAt: IsoDateTime;
  readonly actor: string;
  readonly note?: string;
  readonly requestKey?: string;
  readonly requirementRevision: number;
  readonly methodId: string;
  readonly methodRevision: string;
  readonly template?: { readonly id: string; readonly version: number; readonly name: string };
  readonly summary: {
    readonly nodes: number;
    readonly edges: number;
    readonly groups: number;
    readonly groupLabels: readonly string[];
    readonly nodeKeys: readonly string[];
  };
  readonly executionAtFreeze?: {
    readonly executionId: string;
    readonly status: string;
    readonly progress: { readonly done: number; readonly total: number; readonly running: number; readonly failed: number };
  };
}

export interface FreezePlanInput {
  readonly requestKey?: string;
  readonly planRevisionId?: string;
  readonly note?: string;
  readonly actor?: string;
}

export interface FreezePlanResult {
  readonly replayed: boolean;
  readonly snapshot: FrozenPlanSnapshot;
}

/* ------------------------------------------------------------------ */
/* 2 · Audit timeline                                                  */
/* ------------------------------------------------------------------ */

export interface TaskAuditEntry {
  readonly id: string;
  readonly at: IsoDateTime;
  readonly source: 'event' | 'operation';
  readonly action: string;
  readonly summary: string;
  readonly status?: string;
  readonly requestKey?: string;
  readonly refs: {
    readonly projectId?: string;
    readonly planRevisionId?: string;
    readonly roundId?: string;
    readonly executionId?: string;
    readonly workspaceId?: string;
    readonly deliveryId?: string;
    readonly nodeId?: string;
  };
}

export interface TaskAuditQuery {
  readonly limit?: number;
  readonly cursor?: string;
  /** Only include actions matching one of these prefixes (e.g. `plan.`, `execution.`). */
  readonly kinds?: readonly string[];
}

export interface TaskAuditPage {
  readonly taskId: string;
  readonly items: readonly TaskAuditEntry[];
  readonly total: number;
  readonly limit: number;
  readonly cursor: string;
  readonly nextCursor?: string;
}

/* ------------------------------------------------------------------ */
/* 3 · Snapshot review panel (fixed template tasks)                    */
/* ------------------------------------------------------------------ */

export type SnapshotBatchState = 'verified' | 'unverified' | 'running' | 'attention' | 'pending' | 'skipped';

export interface SnapshotReviewBatch {
  readonly batchId: string;
  readonly title: string;
  readonly purpose: string;
  readonly state: SnapshotBatchState;
  readonly source: 'execution' | 'template';
  readonly templateStepKey?: string;
  readonly nodeId?: string;
  readonly groupLabel?: string;
  readonly attemptId?: string;
  readonly attemptCount: number;
  readonly attemptStatus?: string;
  readonly verificationState?: string;
  readonly fragmentCount: number;
  readonly errorMessage?: string;
  readonly updatedAt?: IsoDateTime;
}

export interface SnapshotReviewProgress {
  readonly available: boolean;
  /** Null while the batch total is not determined (no execution yet). */
  readonly totalBatches: number | null;
  readonly verifiedBatches: number;
  readonly unverifiedBatches: number;
  readonly runningBatches: number;
  readonly attentionBatches: number;
  readonly skippedBatches: number;
  readonly remainingBatches: number | null;
  readonly phases: readonly { readonly label: string; readonly total: number | null; readonly completed: number }[];
  readonly note: string;
}

export interface SnapshotReviewScope {
  readonly outputDirectory?: string;
  readonly planRevisionNumber?: number;
  readonly planStatus?: string;
  readonly template?: { readonly id: string; readonly version: number; readonly name: string };
  /** Review mode/depth require review-run data that does not exist yet → honest unknown. */
  readonly mode: 'full' | 'incremental' | 'unknown';
  readonly depth: 'full' | 'lightweight' | 'unknown';
  readonly modeSource: 'unavailable' | 'frozen_snapshot';
  readonly baselineSha?: string;
  readonly targetSha?: string;
  readonly targetShaSource: 'delivery' | 'snapshot' | 'none';
  readonly branch?: string;
  readonly versionsFixed: true;
  readonly limitations: readonly string[];
}

export interface SnapshotReviewBatchesPage {
  readonly items: readonly SnapshotReviewBatch[];
  readonly total: number;
  readonly limit: number;
  readonly cursor: string;
  readonly nextCursor?: string;
}

export interface SnapshotPartialReport {
  readonly reportId?: string;
  readonly available: boolean;
  readonly readAt?: IsoDateTime;
  readonly analyzedUnits: number | null;
  readonly pendingUnits: number | null;
  readonly excludedUnits: number | null;
  readonly contentMarkdown: string | null;
  readonly download: { readonly available: boolean; readonly reason: string };
  readonly reason: string;
  readonly note: string;
}

export interface SnapshotReviewModel {
  readonly taskId: string;
  /** Only fixed-template tasks expose the B-07 panel. */
  readonly applicable: boolean;
  readonly reason?: string;
  readonly readOnly: true;
  readonly note: string;
  readonly scope?: SnapshotReviewScope;
  readonly progress?: SnapshotReviewProgress;
  readonly batches?: SnapshotReviewBatchesPage;
  readonly partialReport: SnapshotPartialReport;
}

export interface SnapshotReviewQuery {
  readonly limit?: number;
  readonly cursor?: string;
}

/* ------------------------------------------------------------------ */
/* 4 · Run content                                                     */
/* ------------------------------------------------------------------ */

export type RunContentCategory = 'documents' | 'source' | 'tests' | 'other';

export interface RunContentNode {
  readonly nodeId: string;
  readonly key: string;
  readonly title: string;
  readonly kind: string;
  readonly category: RunContentCategory;
  readonly status: string;
  readonly attemptCount: number;
  readonly confirmedAcceptance?: 'accepted' | 'rejected' | 'pending';
  readonly latestAttempt?: {
    readonly attemptId: string;
    readonly ordinal: number;
    readonly status: string;
    readonly startedAt?: IsoDateTime;
    readonly endedAt?: IsoDateTime;
    readonly summary?: string;
    readonly verification?: { readonly state: string; readonly summary?: string };
    readonly artifactCount: number;
    readonly errorCount: number;
    readonly fragmentCount: number;
  };
  readonly outputs: readonly string[];
  readonly writes: readonly string[];
  readonly errorMessage?: string;
}

export interface RunContentGroup {
  readonly category: RunContentCategory;
  readonly label: string;
  readonly total: number;
  readonly nodes: readonly RunContentNode[];
}

export interface RunContentModel {
  readonly taskId: string;
  readonly available: boolean;
  readonly note: string;
  readonly planRevisionId?: string;
  readonly executionId?: string;
  readonly workspace?: {
    readonly state: string;
    readonly kind: string;
    readonly displayRoot?: string;
    readonly baseSha?: string;
    readonly retention: string;
  };
  readonly deliveryEvidence?: {
    readonly projection: string;
    readonly commitSha?: string;
    readonly pushedSha?: string;
    readonly remoteRef?: string;
    readonly mrIid?: number;
    readonly mrWebUrl?: string;
  };
  readonly groups: readonly RunContentGroup[];
  readonly totals: { readonly nodes: number; readonly attempts: number; readonly fragments: number };
}

export class TaskExtrasService {
  readonly #store: Store;
  readonly #templates: () => readonly TaskTemplate[];
  readonly #actor: () => string;

  constructor(options: TaskExtrasServiceOptions) {
    this.#store = options.store;
    this.#templates = options.templates ?? (() => DEFAULT_CATALOG.templates);
    this.#actor = options.actor ?? (() => 'local-user');
  }

  /* ---------------------------------------------------------------- */
  /* Frozen plan snapshot                                             */
  /* ---------------------------------------------------------------- */

  /**
   * Freeze the current plan revision (or an explicit one) into an immutable
   * snapshot. Idempotent: freezing the same plan revision again returns the
   * existing snapshot instead of adding a duplicate; the execution is untouched.
   */
  freezePlan(taskId: string, input: FreezePlanInput = {}): FreezePlanResult {
    const task = this.#requireTask(taskId);
    if (input.requestKey !== undefined && (typeof input.requestKey !== 'string' || !input.requestKey.startsWith('req_'))) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'requestKey 不合法');
    }
    const plan = this.#resolvePlan(task, input.planRevisionId);
    const planHash = planHashOf(plan);
    const existing = this.#freezes(taskId);
    if (input.requestKey !== undefined) {
      const byKey = existing.find((snapshot) => snapshot.requestKey === input.requestKey);
      if (byKey !== undefined) {
        if (byKey.planHash !== planHash) {
          throw new AppError(ErrorCode.REQUEST_KEY_REUSED, '同一请求号对应了不同的冻结点，请使用新的请求号', { details: { requestKey: input.requestKey } });
        }
        return { replayed: true, snapshot: byKey };
      }
    }
    const samePlan = existing.find((snapshot) => snapshot.planRevisionId === plan.id && snapshot.planHash === planHash);
    if (samePlan !== undefined) return { replayed: true, snapshot: samePlan };

    const execution = task.executionId === undefined ? this.#store.executions.byTask(taskId) : this.#store.executions.get(task.executionId);
    const actor = (input.actor ?? this.#actor()).trim();
    if (actor === '' || actor.length > MAX_ACTOR) throw new AppError(ErrorCode.VALIDATION_FAILED, `操作人需要 1–${String(MAX_ACTOR)} 个字符`);
    const note = typeof input.note === 'string' ? input.note.trim().slice(0, MAX_NOTE) : '';
    const snapshot: FrozenPlanSnapshot = {
      snapshotId: createId('freeze'),
      taskId,
      planRevisionId: plan.id,
      planRevisionNumber: plan.revisionNumber,
      planStatus: plan.status,
      planHash,
      frozenAt: nowIso(),
      actor,
      ...(note === '' ? {} : { note }),
      ...(input.requestKey === undefined ? {} : { requestKey: input.requestKey }),
      requirementRevision: task.requirement.revision,
      methodId: task.methodId,
      methodRevision: task.methodRevision,
      ...(task.fixedTemplate === undefined
        ? {}
        : {
            template: {
              id: task.fixedTemplate.templateId,
              version: task.fixedTemplate.templateVersion,
              name: this.#templates().find((template) => template.id === task.fixedTemplate!.templateId)?.name ?? task.fixedTemplate.templateId,
            },
          }),
      summary: {
        nodes: plan.graph.nodes.length,
        edges: plan.graph.edges.length,
        groups: plan.graph.groups.length,
        groupLabels: plan.graph.groups.map((group) => group.label),
        nodeKeys: plan.graph.nodes.map((node) => node.key),
      },
      ...(execution === undefined
        ? {}
        : {
            executionAtFreeze: {
              executionId: execution.id,
              status: execution.status,
              progress: { ...execution.progress },
            },
          }),
    };
    this.#writeFreezes(taskId, [snapshot, ...existing].slice(0, FREEZE_LIMIT_PER_TASK));
    return { replayed: false, snapshot };
  }

  /** Most recent frozen snapshot for a task, newest first. */
  latestPlanFreeze(taskId: string): FrozenPlanSnapshot | undefined {
    this.#requireTask(taskId);
    return this.#freezes(taskId)[0];
  }

  listPlanFreezes(taskId: string): readonly FrozenPlanSnapshot[] {
    this.#requireTask(taskId);
    return this.#freezes(taskId);
  }

  #freezes(taskId: string): readonly FrozenPlanSnapshot[] {
    const raw = this.#store.settings.getJson<unknown>(`${FREEZE_KEY_PREFIX}${taskId}`);
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is FrozenPlanSnapshot => {
      return item !== null && typeof item === 'object' && typeof (item as { snapshotId?: unknown }).snapshotId === 'string' && typeof (item as { planRevisionId?: unknown }).planRevisionId === 'string';
    });
  }

  #writeFreezes(taskId: string, snapshots: readonly FrozenPlanSnapshot[]): void {
    this.#store.settings.putJson(`${FREEZE_KEY_PREFIX}${taskId}`, snapshots);
  }

  #resolvePlan(task: Task, planRevisionId: string | undefined): PlanRevision {
    const plan = planRevisionId === undefined
      ? task.currentPlanRevisionId === undefined
        ? this.#store.plans.latest(task.id)
        : this.#store.plans.get(task.currentPlanRevisionId)
      : this.#store.plans.get(planRevisionId);
    if (plan === undefined || plan.taskId !== task.id) {
      throw new AppError(ErrorCode.NOT_FOUND, '计划修订不存在，无法冻结', { details: { taskId: task.id, planRevisionId: planRevisionId ?? null } });
    }
    return plan;
  }

  /* ---------------------------------------------------------------- */
  /* Audit timeline                                                   */
  /* ---------------------------------------------------------------- */

  /**
   * Read-only task audit timeline, newest first. Events are the durable domain
   * log; the operation ledger adds request-keyed commands (plan confirm,
   * execution control, node verdicts, delivery). No state is written.
   */
  audit(taskId: string, query: TaskAuditQuery = {}): TaskAuditPage {
    this.#requireTask(taskId);
    const limit = Math.min(Math.max(Math.trunc(query.limit ?? AUDIT_DEFAULT_LIMIT), 1), AUDIT_MAX_LIMIT);
    const offset = parseCursor(query.cursor);
    const kinds = (query.kinds ?? []).filter((kind) => kind.trim() !== '');
    const entries = this.#auditEntries(taskId)
      .filter((entry) => kinds.length === 0 || kinds.some((kind) => entry.action.startsWith(kind)))
      .sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1));
    const items = entries.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    return {
      taskId,
      items,
      total: entries.length,
      limit,
      cursor: String(offset),
      ...(nextOffset < entries.length ? { nextCursor: String(nextOffset) } : {}),
    };
  }

  #auditEntries(taskId: string): TaskAuditEntry[] {
    const entries: TaskAuditEntry[] = [];
    const ledger = this.#store.operations.listRecent(AUDIT_LEDGER_SCAN_LIMIT);
    const ledgerByKey = new Map<string, OperationRecord>();
    for (const operation of ledger) {
      if (operation.target.taskId !== taskId) continue;
      ledgerByKey.set(operation.requestKey, operation);
      entries.push({
        id: `op:${operation.requestKey}`,
        at: operation.settledAt ?? operation.acceptedAt,
        source: 'operation',
        action: operation.operation,
        summary: `${operation.operation} → ${operation.status}`,
        status: operation.status,
        requestKey: operation.requestKey,
        refs: {
          ...(operation.target.projectId === undefined ? {} : { projectId: operation.target.projectId }),
          ...(operation.target.executionId === undefined ? {} : { executionId: operation.target.executionId }),
          ...(operation.target.ref === undefined ? {} : { nodeId: operation.operation.startsWith('plan.') ? undefined : operation.target.ref }),
        },
      });
    }

    let afterSeq = 0;
    let scanned = 0;
    for (;;) {
      const batch = this.#store.events.replay(afterSeq, 500);
      if (batch.length === 0) break;
      for (const event of batch) {
        const payload = (event.payload ?? {}) as Record<string, unknown>;
        const eventTaskId = typeof payload['taskId'] === 'string' ? payload['taskId'] : typeof payload['target'] === 'string' ? payload['target'] : undefined;
        if (eventTaskId !== taskId) continue;
        if (event.type === 'operation.settled') {
          const requestKey = typeof payload['requestKey'] === 'string' ? payload['requestKey'] : undefined;
          // The ledger already carries this operation with its final status.
          if (requestKey !== undefined && ledgerByKey.has(requestKey)) continue;
        }
        const mapped = mapAuditEvent(event.type, payload);
        if (mapped === undefined) continue;
        entries.push({ ...mapped, id: `evt:${event.id}`, at: event.at, source: 'event', refs: { ...mapped.refs, ...(typeof payload['projectId'] === 'string' ? { projectId: payload['projectId'] } : {}) } });
      }
      afterSeq = batch.at(-1)?.seq ?? afterSeq;
      scanned += batch.length;
      if (batch.length < 500 || scanned >= AUDIT_EVENT_SCAN_LIMIT) break;
    }
    return entries;
  }

  /* ---------------------------------------------------------------- */
  /* Snapshot review panel                                            */
  /* ---------------------------------------------------------------- */

  /**
   * B-07 read model for fixed-template tasks. Everything shown is either an
   * execution fact (node/attempt/verification/acceptance) or an explicitly
   * unknown review field. The phase report is honestly unavailable while the
   * review-report service does not exist — no review conclusions are invented.
   */
  snapshotReview(taskId: string, query: SnapshotReviewQuery = {}): SnapshotReviewModel {
    const task = this.#requireTask(taskId);
    const partialReport = task.fixedTemplate?.snapshot === undefined ? this.#emptyPartialReport() : { ...this.#emptyPartialReport(), available: task.lifecycle !== 'completed', reason: task.lifecycle === 'completed' ? '任务已完成，请查看最终报告' : '阶段报告尚未读取，可读取已分析/未完成/排除的真实单元范围' };
    const template = this.#templateFor(task);
    if (task.fixedTemplate?.snapshot === undefined) {
      return {
        taskId,
        applicable: false,
        reason: '此任务没有 templateProgress.snapshot，仅快照代码评审模板提供此面板',
        readOnly: true,
        note: '查看进度和报告不会启动、暂停或改变执行。',
        partialReport,
      };
    }
    const plan = task.currentPlanRevisionId === undefined ? this.#store.plans.latest(taskId) : this.#store.plans.get(task.currentPlanRevisionId);
    const execution = task.executionId === undefined ? this.#store.executions.byTask(taskId) : this.#store.executions.get(task.executionId);
    const workspace = task.workspaceId === undefined ? this.#store.workspaces.byTask(taskId) : this.#store.workspaces.get(task.workspaceId);
    const delivery = task.deliveryId === undefined ? this.#store.deliveries.byTask(taskId) : this.#store.deliveries.get(task.deliveryId);
    const batches = this.#snapshotBatches(template, plan, execution);
    const limit = Math.min(Math.max(Math.trunc(query.limit ?? SNAPSHOT_DEFAULT_BATCH_LIMIT), 1), SNAPSHOT_MAX_BATCH_LIMIT);
    const offset = parseCursor(query.cursor);
    const pageItems = batches.slice(offset, offset + limit);
    const nextOffset = offset + pageItems.length;
    const progress = this.#snapshotProgress(plan, execution, batches);
    return {
      taskId,
      applicable: true,
      readOnly: true,
      note: '查看进度和报告不会启动、暂停或改变执行。',
      scope: this.#snapshotScope(task, plan, workspace, delivery),
      progress,
      batches: {
        items: pageItems,
        total: batches.length,
        limit,
        cursor: String(offset),
        ...(nextOffset < batches.length ? { nextCursor: String(nextOffset) } : {}),
      },
      partialReport,
    };
  }

  readSnapshotReport(taskId: string): SnapshotPartialReport {
    const task = this.#requireTask(taskId);
    if (task.lifecycle === 'completed') throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '任务已完成，请查看最终报告');
    const report = snapshotReport(this.#store, taskId);
    const directory = join(this.#store.dataDir, 'snapshot-reports', taskId);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `${report.reportId}.md`), report.contentMarkdown, 'utf8');
    this.#store.settings.putJson(`snapshot.report.read.${taskId}`, report);
    return report;
  }

  downloadSnapshotReport(taskId: string, reportId: string): { markdown: string; filename: string } {
    this.#requireTask(taskId);
    const report = this.#store.settings.getJson<SnapshotPartialReport>(`snapshot.report.read.${taskId}`);
    if (report === undefined || report.reportId !== reportId || report.contentMarkdown === null) throw new AppError(ErrorCode.STALE_TARGET, '请先读取对应版本的阶段报告，再下载');
    const markdown = readFileSync(join(this.#store.dataDir, 'snapshot-reports', taskId, `${reportId}.md`), 'utf8');
    if (createHash('sha256').update(markdown).digest('hex') !== reportId) throw new AppError(ErrorCode.STALE_TARGET, '报告文件与读取版本不符，请重新读取');
    return { markdown, filename: `snapshot-review-${taskId}.md` };
  }

  #templateFor(task: Task): TaskTemplate | undefined {
    if (task.fixedTemplate === undefined) return undefined;
    return this.#templates().find((template) => template.id === task.fixedTemplate!.templateId);
  }

  #snapshotScope(task: Task, plan: PlanRevision | undefined, workspace: TaskWorkspace | undefined, delivery: TaskDelivery | undefined): SnapshotReviewScope {
    const snapshot = task.fixedTemplate?.snapshot;
    if (snapshot !== undefined) return {
      ...(plan === undefined ? {} : { planRevisionNumber: plan.revisionNumber, planStatus: plan.status }),
      template: { id: task.fixedTemplate!.templateId, version: task.fixedTemplate!.templateVersion, name: this.#templateFor(task)?.name ?? task.fixedTemplate!.templateId },
      outputDirectory: join(this.#store.dataDir, 'snapshot-reports', task.id),
      mode: snapshot.mode, depth: snapshot.depth, modeSource: 'frozen_snapshot', baselineSha: snapshot.baselineSha, targetSha: snapshot.targetSha, targetShaSource: 'snapshot', branch: workspace?.branch, versionsFixed: true,
      limitations: snapshot.depth === 'lightweight' ? ['分析单元固定；只有含候选问题的单元调用独立复核'] : [],
    };
    const pushStep = delivery?.steps.find((step) => step.step === 'push');
    const commitStep = delivery?.steps.find((step) => step.step === 'commit');
    const targetSha = pushStep?.pushedSha ?? commitStep?.commitSha;
    return {
      ...(plan === undefined ? {} : { planRevisionNumber: plan.revisionNumber, planStatus: plan.status }),
      ...(task.fixedTemplate === undefined
        ? {}
        : { template: { id: task.fixedTemplate.templateId, version: task.fixedTemplate.templateVersion, name: this.#templateFor(task)?.name ?? task.fixedTemplate.templateId } }),
      mode: 'unknown',
      depth: 'unknown',
      modeSource: 'unavailable',
      ...(workspace?.baseSha === undefined ? {} : { baselineSha: workspace.baseSha }),
      ...(targetSha === undefined ? {} : { targetSha }),
      targetShaSource: targetSha === undefined ? 'none' : 'delivery',
      ...(workspace?.branch === undefined ? {} : { branch: workspace.branch }),
      versionsFixed: true,
      limitations: ['审查方式与深度需要快照评审服务数据；当前只展示可核对的版本事实'],
    };
  }

  #snapshotBatches(template: TaskTemplate | undefined, plan: PlanRevision | undefined, execution: ExecutionView | undefined): readonly SnapshotReviewBatch[] {
    // No execution yet = batches do not exist; the panel shows the honest
    // "总数待定" empty state instead of inventing pending batches.
    if (execution === undefined) return [];
    const planNodes = plan?.graph.nodes ?? [];
    const byKey = new Map(planNodes.map((node) => [node.key, node]));
    const executionNodes = new Map((execution?.nodes ?? []).map((node) => [node.nodeId, node]));
    const attemptsByNode = new Map<string, Attempt[]>();
    for (const attempt of execution === undefined ? [] : this.#store.executions.listAttempts(execution.id)) {
      const list = attemptsByNode.get(attempt.nodeId) ?? [];
      list.push(attempt);
      attemptsByNode.set(attempt.nodeId, list);
    }
    const batchFromNode = (node: PlanNode, templateStepKey: string | undefined, groupLabel: string | undefined): SnapshotReviewBatch => {
      const state = executionNodes.get(node.id);
      const attempts = attemptsByNode.get(node.id) ?? [];
      const latest = state?.currentAttemptId === undefined ? attempts[0] : attempts.find((item) => item.id === state.currentAttemptId);
      const acceptance = execution === undefined ? undefined : this.#acceptance(execution.id, node.id);
      const fragmentCount = latest === undefined ? 0 : this.#store.executions.listOutput(latest.id, 0, OUTPUT_FRAGMENT_SCAN_LIMIT).length;
      const errorMessage = state?.error?.message
        ?? latest?.result?.errors[0]?.message
        ?? (latest?.result?.verification?.state === 'failed' ? latest.result.verification.summary : undefined);
      const batchState = snapshotBatchState(state?.status, latest, acceptance);
      return {
        batchId: node.id,
        title: node.title,
        purpose: templateStepKey === undefined ? `计划步骤 · ${groupLabel ?? node.groupId}` : `模板步骤 · ${groupLabel ?? ''}`,
        state: batchState,
        source: 'execution',
        ...(templateStepKey === undefined ? {} : { templateStepKey }),
        nodeId: node.id,
        ...(groupLabel === undefined ? {} : { groupLabel }),
        ...(latest === undefined ? {} : { attemptId: latest.id, attemptStatus: latest.status }),
        attemptCount: state?.attemptCount ?? attempts.length,
        ...(latest?.result?.verification === undefined ? {} : { verificationState: latest.result.verification.state }),
        fragmentCount,
        ...(errorMessage === undefined ? {} : { errorMessage }),
        ...(state?.endedAt ?? latest?.endedAt ?? latest?.startedAt ?? state?.startedAt) === undefined
          ? {}
          : { updatedAt: state?.endedAt ?? latest?.endedAt ?? latest?.startedAt ?? state?.startedAt },
      };
    };

    if (planNodes.some((node) => node.snapshotStage !== undefined)) return planNodes.filter((node) => node.snapshotStage === 'analysis').map((node) => {
      const batch = batchFromNode(node, undefined, '源码分析批次');
      const verifier = planNodes.find((item) => item.key === node.key.replace('snapshot.analyze.', 'snapshot.verify.'));
      const verifyStatus = verifier === undefined ? undefined : executionNodes.get(verifier.id)?.status;
      const analyzed = executionNodes.get(node.id)?.status === 'succeeded';
      const state = !analyzed ? batch.state : verifyStatus === 'succeeded' || verifyStatus === 'skipped' ? 'verified' : verifyStatus === 'running' ? 'running' : verifyStatus === 'failed' || verifyStatus === 'unknown' ? 'attention' : 'unverified';
      return { ...batch, state, ...(verifier === undefined || executionNodes.get(verifier.id)?.error?.message === undefined ? {} : { errorMessage: executionNodes.get(verifier.id)!.error!.message }), purpose: `固定源码 ${(node.snapshotUnitIds ?? []).length} 个文件单元；独立复核 ${verifyStatus ?? '待执行'}` };
    });
    const batches: SnapshotReviewBatch[] = [];
    const matchedNodeIds = new Set<string>();
    for (const step of template?.steps ?? []) {
      const node = byKey.get(step.key);
      if (node !== undefined) {
        matchedNodeIds.add(node.id);
        batches.push(batchFromNode(node, step.key, step.group));
      } else {
        batches.push({
          batchId: `template:${step.key}`,
          title: step.title,
          purpose: `模板步骤 · ${step.group}`,
          state: 'pending',
          source: 'template',
          templateStepKey: step.key,
          groupLabel: step.group,
          attemptCount: 0,
          fragmentCount: 0,
        });
      }
    }
    for (const node of planNodes) {
      if (matchedNodeIds.has(node.id)) continue;
      const group = plan?.graph.groups.find((item) => item.id === node.groupId);
      batches.push(batchFromNode(node, undefined, group?.label));
    }
    return batches;
  }

  /** Stored manual verdict for a node, if any (accepted/rejected; absent = pending). */
  #acceptance(executionId: string, nodeId: string): 'accepted' | 'rejected' | undefined {
    const stored = this.#store.settings.getJson<{ state?: string }>(`execution.node.acceptance.${executionId}.${nodeId}`);
    if (stored?.state === 'accepted' || stored?.state === 'rejected') return stored.state;
    return undefined;
  }

  #snapshotProgress(plan: PlanRevision | undefined, execution: ExecutionView | undefined, batches: readonly SnapshotReviewBatch[]): SnapshotReviewProgress {
    const count = (state: SnapshotBatchState): number => batches.filter((batch) => batch.state === state).length;
    const total = execution === undefined ? null : batches.length;
    const phases = plan === undefined
      ? []
      : plan.graph.groups.map((group) => {
          const nodes = plan.graph.nodes.filter((node) => node.groupId === group.id);
          return { label: group.label, total: nodes.length, completed: nodes.filter((node) => execution?.nodes.find((state) => state.nodeId === node.id)?.status === NodeStatus.SUCCEEDED || execution?.nodes.find((state) => state.nodeId === node.id)?.status === NodeStatus.SKIPPED).length };
        });
    return {
      available: execution !== undefined,
      totalBatches: total,
      verifiedBatches: count('verified'),
      unverifiedBatches: count('unverified'),
      runningBatches: count('running'),
      attentionBatches: count('attention'),
      skippedBatches: count('skipped'),
      remainingBatches: total === null ? null : count('pending') + count('unverified'),
      phases,
      note: execution === undefined
        ? '尚未创建执行，批次总数待定；查看进度不会启动执行。'
        : count('unverified') > 0
          ? '有已执行但尚未验证的批次；进度不等于完成，最终状态以执行服务为准。'
          : '进度不等于完成；批次全部验证后仍需执行服务的最终状态。',
    };
  }

  #emptyPartialReport(): SnapshotPartialReport {
    return {
      available: false,
      analyzedUnits: null,
      pendingUnits: null,
      excludedUnits: null,
      contentMarkdown: null,
      download: { available: false, reason: '阶段报告读取后才能下载' },
      reason: '快照评审服务尚未提供阶段报告数据；这里如实置空，不生成审查结论',
      note: '读取和下载都不会启动或改变执行。',
    };
  }

  /* ---------------------------------------------------------------- */
  /* Run content                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * Group plan nodes + latest attempts + output fragments for the "运行内容"
   * entry (documents / source / tests / other). Read-only; honest empty state
   * when there is no plan yet.
   */
  runContent(taskId: string): RunContentModel {
    const task = this.#requireTask(taskId);
    const plan = task.currentPlanRevisionId === undefined ? this.#store.plans.latest(taskId) : this.#store.plans.get(task.currentPlanRevisionId);
    const execution = task.executionId === undefined ? this.#store.executions.byTask(taskId) : this.#store.executions.get(task.executionId);
    const workspace = task.workspaceId === undefined ? this.#store.workspaces.byTask(taskId) : this.#store.workspaces.get(task.workspaceId);
    const delivery = task.deliveryId === undefined ? this.#store.deliveries.byTask(taskId) : this.#store.deliveries.get(task.deliveryId);
    const workspaceSummary = workspace === undefined
      ? undefined
      : {
          state: workspace.state,
          kind: workspace.kind,
          ...(workspace.displayRoot === undefined ? {} : { displayRoot: workspace.displayRoot }),
          ...(workspace.baseSha === undefined ? {} : { baseSha: workspace.baseSha }),
          retention: workspace.retention,
        };
    const deliveryEvidence = delivery === undefined ? undefined : deliveryEvidenceOf(delivery);
    if (plan === undefined) {
      return {
        taskId,
        available: false,
        note: '任务还没有确认计划，运行内容尚未产生。',
        ...(workspaceSummary === undefined ? {} : { workspace: workspaceSummary }),
        ...(deliveryEvidence === undefined ? {} : { deliveryEvidence }),
        groups: [],
        totals: { nodes: 0, attempts: 0, fragments: 0 },
      };
    }
    const executionNodes = new Map((execution?.nodes ?? []).map((node) => [node.nodeId, node]));
    const attemptsByNode = new Map<string, Attempt[]>();
    for (const attempt of execution === undefined ? [] : this.#store.executions.listAttempts(execution.id)) {
      const list = attemptsByNode.get(attempt.nodeId) ?? [];
      list.push(attempt);
      attemptsByNode.set(attempt.nodeId, list);
    }
    let totalAttempts = 0;
    let totalFragments = 0;
    const nodes: RunContentNode[] = plan.graph.nodes.map((node) => {
      const state = executionNodes.get(node.id);
      const attempts = attemptsByNode.get(node.id) ?? [];
      const latest = state?.currentAttemptId === undefined ? attempts[0] : attempts.find((item) => item.id === state.currentAttemptId);
      const fragmentCount = latest === undefined ? 0 : this.#store.executions.listOutput(latest.id, 0, OUTPUT_FRAGMENT_SCAN_LIMIT).length;
      totalAttempts += attempts.length;
      totalFragments += fragmentCount;
      const group = plan.graph.groups.find((item) => item.id === node.groupId);
      const acceptance = execution === undefined ? undefined : this.#acceptance(execution.id, node.id);
      return {
        nodeId: node.id,
        key: node.key,
        title: node.title,
        kind: node.kind,
        category: runContentCategory(node.kind),
        status: state?.status ?? 'pending',
        attemptCount: state?.attemptCount ?? attempts.length,
        ...(acceptance === undefined ? {} : { confirmedAcceptance: acceptance }),
        ...(latest === undefined
          ? {}
          : {
              latestAttempt: {
                attemptId: latest.id,
                ordinal: latest.ordinal,
                status: latest.status,
                ...(latest.startedAt === undefined ? {} : { startedAt: latest.startedAt }),
                ...(latest.endedAt === undefined ? {} : { endedAt: latest.endedAt }),
                ...(latest.result?.summary === undefined ? {} : { summary: latest.result.summary }),
                ...(latest.result?.verification === undefined
                  ? {}
                  : { verification: { state: latest.result.verification.state, ...(latest.result.verification.summary === undefined ? {} : { summary: latest.result.verification.summary }) } }),
                artifactCount: latest.result?.artifacts.length ?? 0,
                errorCount: latest.result?.errors.length ?? 0,
                fragmentCount,
              },
            }),
        outputs: node.outputs.map((output) => output.name),
        writes: node.resources.write.map((resource) => resource.label),
        ...(state?.error === undefined ? {} : { errorMessage: state.error.message }),
      };
    });
    const groups: RunContentGroup[] = (['documents', 'source', 'tests', 'other'] as const)
      .map((category) => ({ category, label: RUN_CONTENT_LABEL[category], total: nodes.filter((node) => node.category === category).length, nodes: nodes.filter((node) => node.category === category) }))
      .filter((group) => group.total > 0);
    return {
      taskId,
      available: execution !== undefined || plan !== undefined,
      note: execution === undefined
        ? '计划已存在但尚未执行；以下按计划步骤列出将要产生的运行内容。'
        : '运行内容来自计划的节点、最近一次尝试与输出片段（每尝试最多统计 500 条片段）。',
      ...(plan === undefined ? {} : { planRevisionId: plan.id }),
      ...(execution === undefined ? {} : { executionId: execution.id }),
      ...(workspaceSummary === undefined ? {} : { workspace: workspaceSummary }),
      ...(deliveryEvidence === undefined ? {} : { deliveryEvidence }),
      groups,
      totals: { nodes: nodes.length, attempts: totalAttempts, fragments: totalFragments },
    };
  }

  #requireTask(taskId: string): Task {
    if (typeof taskId !== 'string' || taskId === '') throw new AppError(ErrorCode.VALIDATION_FAILED, 'taskId 不能为空');
    const task = this.#store.tasks.get(taskId);
    if (task === undefined) throw new AppError(ErrorCode.NOT_FOUND, '任务不存在', { details: { taskId } });
    return task;
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const RUN_CONTENT_LABEL: Record<RunContentCategory, string> = {
  documents: '文档',
  source: '源码',
  tests: '单元测试',
  other: '其他产出',
};

function runContentCategory(kind: string): RunContentCategory {
  if (kind === 'requirement' || kind === 'design') return 'documents';
  if (kind === 'implementation') return 'source';
  if (kind === 'test') return 'tests';
  return 'other';
}

function snapshotBatchState(status: string | undefined, latest: Attempt | undefined, acceptance: 'accepted' | 'rejected' | undefined): SnapshotBatchState {
  if (status === undefined) return 'pending';
  if (status === NodeStatus.SKIPPED || status === NodeStatus.CANCELLED) return 'skipped';
  if (status === NodeStatus.RUNNING) return 'running';
  if (status === NodeStatus.FAILED) return 'attention';
  if (status !== NodeStatus.SUCCEEDED) return 'pending';
  if (acceptance === 'accepted') return 'verified';
  if (acceptance === 'rejected') return 'attention';
  const verification = latest?.result?.verification?.state;
  if (verification === 'passed') return 'verified';
  if (verification === 'failed') return 'attention';
  return 'unverified';
}

function deliveryEvidenceOf(delivery: TaskDelivery): RunContentModel['deliveryEvidence'] {
  const commit = delivery.steps.find((step) => step.step === 'commit');
  const push = delivery.steps.find((step) => step.step === 'push');
  const mr = delivery.steps.find((step) => step.step === 'mergeRequest');
  return {
    projection: delivery.projection,
    ...(commit?.commitSha === undefined ? {} : { commitSha: commit.commitSha }),
    ...(push?.pushedSha === undefined ? {} : { pushedSha: push.pushedSha }),
    ...(push?.remoteRef === undefined ? {} : { remoteRef: push.remoteRef }),
    ...(mr?.mrIid === undefined ? {} : { mrIid: mr.mrIid }),
    ...(mr?.mrWebUrl === undefined ? {} : { mrWebUrl: mr.mrWebUrl }),
  };
}

function mapAuditEvent(type: string, payload: Record<string, unknown>): Omit<TaskAuditEntry, 'id' | 'at' | 'source'> | undefined {
  const text = (key: string): string | undefined => (typeof payload[key] === 'string' ? payload[key] : undefined);
  switch (type) {
    case 'task.changed':
      return {
        action: 'task.changed',
        summary: `任务阶段：${text('stage') ?? 'unknown'}`,
        refs: { ...(text('projectId') === undefined ? {} : { projectId: text('projectId')! }) },
      };
    case 'plan.changed':
      return {
        action: 'plan.changed',
        summary: `计划修订 ${String(payload['revisionNumber'] ?? '?')} · ${text('status') ?? 'unknown'}`,
        refs: { ...(text('planRevisionId') === undefined ? {} : { planRevisionId: text('planRevisionId')! }) },
      };
    case 'planning.changed':
      return {
        action: 'planning.changed',
        summary: `规划轮次 ${text('status') ?? 'unknown'}/${text('stage') ?? 'unknown'}`,
        refs: { ...(text('roundId') === undefined ? {} : { roundId: text('roundId')! }) },
      };
    case 'execution.changed':
      return {
        action: 'execution.changed',
        summary: `执行状态：${text('status') ?? 'unknown'}`,
        refs: { ...(text('executionId') === undefined ? {} : { executionId: text('executionId')! }) },
      };
    case 'task.workspace.updated':
      return {
        action: 'workspace.updated',
        summary: `工作区：${text('state') ?? 'unknown'}`,
        refs: { ...(text('workspaceId') === undefined ? {} : { workspaceId: text('workspaceId')! }) },
      };
    case 'task.changes.updated':
      return {
        action: 'changes.updated',
        summary: `变更集：${text('changesRevision') ?? 'unknown'}`,
        refs: { ...(text('workspaceId') === undefined ? {} : { workspaceId: text('workspaceId')! }) },
      };
    case 'task.delivery.updated':
      return {
        action: 'delivery.updated',
        summary: `交付：${text('projection') ?? 'unknown'}`,
        refs: { ...(text('deliveryId') === undefined ? {} : { deliveryId: text('deliveryId')! }) },
      };
    case 'operation.settled':
      return {
        action: 'operation.settled',
        summary: `${text('operation') ?? 'operation'} → ${text('status') ?? 'unknown'}`,
        ...(text('status') === undefined ? {} : { status: text('status')! }),
        ...(text('requestKey') === undefined ? {} : { requestKey: text('requestKey')! }),
        refs: {},
      };
    default:
      return undefined;
  }
}

function parseCursor(cursor: string | undefined): number {
  if (cursor === undefined || cursor === '') return 0;
  const value = Number(cursor);
  if (!Number.isInteger(value) || value < 0) throw new AppError(ErrorCode.VALIDATION_FAILED, '分页游标不合法', { details: { cursor } });
  return value;
}

function planHashOf(plan: PlanRevision): string {
  const content = JSON.stringify({
    revisionNumber: plan.revisionNumber,
    status: plan.status,
    graph: plan.graph,
  });
  return createHash('sha256').update(content).digest('hex');
}
