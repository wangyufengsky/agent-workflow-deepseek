import { nowIso, type TaskUsageView, type InsightsResponse } from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';

/** Real aggregate counters read from SQLite; no synthetic usage/cost numbers. */
export class InsightsService {
  readonly #store: Store;

  constructor(store: Store) {
    this.#store = store;
  }

  summary(): InsightsResponse {
    const db = this.#store.db;
    const count = (sql: string): number => {
      const row = db.prepare(sql).get() as { n: number } | undefined;
      return Number(row?.n ?? 0);
    };
    const costs = new Map<string, number>();
    for (const row of this.taskUsage()) for (const cost of row.costs) costs.set(cost.currency, (costs.get(cost.currency) ?? 0) + cost.amount);
    const costRows = [...costs].map(([currency, amount]) => ({ currency, amount }));
    return {
      generatedAt: nowIso(),
      tasks: {
        total: count('SELECT COUNT(*) AS n FROM tasks'),
        active: count("SELECT COUNT(*) AS n FROM tasks WHERE lifecycle = 'active'"),
        completed: count("SELECT COUNT(*) AS n FROM tasks WHERE lifecycle = 'completed'"),
        cancelled: count("SELECT COUNT(*) AS n FROM tasks WHERE lifecycle = 'cancelled'"),
        attention: count("SELECT COUNT(*) AS n FROM tasks WHERE attention != 'none'"),
      },
      planning: {
        rounds: count('SELECT COUNT(*) AS n FROM planning_rounds'),
        completed: count("SELECT COUNT(*) AS n FROM planning_rounds WHERE status = 'completed'"),
        failed: count("SELECT COUNT(*) AS n FROM planning_rounds WHERE status = 'failed'"),
        running: count("SELECT COUNT(*) AS n FROM planning_rounds WHERE status IN ('queued','running','stopping')"),
        costKnown: costRows.length === 1 ? costRows[0]!.amount : undefined,
        costs: costRows,
        budgetUnknownRounds: count("SELECT COUNT(*) AS n FROM planning_rounds WHERE CAST(COALESCE(json_extract(usage_json, '$.budget.unknown'), 0) AS INTEGER) > 0"),
        tokens: {
          input: count("SELECT COALESCE(SUM(CAST(json_extract(usage_json, '$.tokens.input') AS INTEGER)), 0) AS n FROM planning_rounds"),
          output: count("SELECT COALESCE(SUM(CAST(json_extract(usage_json, '$.tokens.output') AS INTEGER)), 0) AS n FROM planning_rounds"),
          reasoning: count("SELECT COALESCE(SUM(CAST(json_extract(usage_json, '$.tokens.reasoning') AS INTEGER)), 0) AS n FROM planning_rounds"),
          cache: count("SELECT COALESCE(SUM(CAST(json_extract(usage_json, '$.tokens.cache') AS INTEGER)), 0) AS n FROM planning_rounds"),
          total: count("SELECT COALESCE(SUM(CAST(json_extract(usage_json, '$.tokens.total') AS INTEGER)), 0) AS n FROM planning_rounds"),
        },
        currency: costRows.length === 1 ? costRows[0]!.currency : undefined,
      },
      executions: {
        total: count('SELECT COUNT(*) AS n FROM executions'),
        running: count("SELECT COUNT(*) AS n FROM executions WHERE status IN ('running','pausing','stopping')"),
        failed: count("SELECT COUNT(*) AS n FROM executions WHERE status = 'failed'"),
        attempts: count('SELECT COUNT(*) AS n FROM attempts'),
        tokens: {
          input: count("SELECT COALESCE(SUM(CAST(json_extract(usage_json, '$.input') AS INTEGER)), 0) AS n FROM attempts"),
          output: count("SELECT COALESCE(SUM(CAST(json_extract(usage_json, '$.output') AS INTEGER)), 0) AS n FROM attempts"),
          reasoning: count("SELECT COALESCE(SUM(CAST(json_extract(usage_json, '$.reasoning') AS INTEGER)), 0) AS n FROM attempts"),
          cache: count("SELECT COALESCE(SUM(CAST(json_extract(usage_json, '$.cache') AS INTEGER)), 0) AS n FROM attempts"),
          total: count("SELECT COALESCE(SUM(CAST(json_extract(usage_json, '$.total') AS INTEGER)), 0) AS n FROM attempts"),
        },
      },
      reviews: {
        total: count('SELECT COUNT(*) AS n FROM reviews'),
        completed: count("SELECT COUNT(*) AS n FROM reviews WHERE state = 'completed'"),
        failed: count("SELECT COUNT(*) AS n FROM reviews WHERE state = 'failed'"),
        tokens: {
          input: count("SELECT COALESCE(SUM(CAST(json_extract(usage_json, '$.input') AS INTEGER)), 0) AS n FROM reviews"),
          output: count("SELECT COALESCE(SUM(CAST(json_extract(usage_json, '$.output') AS INTEGER)), 0) AS n FROM reviews"),
          total: count("SELECT COALESCE(SUM(CAST(json_extract(usage_json, '$.total') AS INTEGER)), 0) AS n FROM reviews"),
        },
        openFindings: count("SELECT COUNT(*) AS n FROM reviews r, json_each(r.findings_json) j WHERE json_extract(j.value, '$.status') = 'open'"),
      },
      fixes: {
        total: count('SELECT COUNT(*) AS n FROM fixes'),
        ready: count("SELECT COUNT(*) AS n FROM fixes WHERE state = 'ready'"),
        discarded: count("SELECT COUNT(*) AS n FROM fixes WHERE state = 'discarded'"),
        tokens: {
          input: count("SELECT COALESCE(SUM(CAST(json_extract(usage_json, '$.input') AS INTEGER)), 0) AS n FROM fixes"),
          output: count("SELECT COALESCE(SUM(CAST(json_extract(usage_json, '$.output') AS INTEGER)), 0) AS n FROM fixes"),
          total: count("SELECT COALESCE(SUM(CAST(json_extract(usage_json, '$.total') AS INTEGER)), 0) AS n FROM fixes"),
        },
      },
      deliveries: {
        delivered: count("SELECT COUNT(*) AS n FROM deliveries WHERE projection = 'delivered'"),
        blocked: count("SELECT COUNT(*) AS n FROM deliveries WHERE projection = 'blocked'"),
        inProgress: count("SELECT COUNT(*) AS n FROM deliveries WHERE projection = 'in_progress'"),
      },
    };
  }

  taskUsage(): readonly TaskUsageView[] {
    const db = this.#store.db;
    const records = db.prepare(`SELECT task_id, 'planning' AS stage, usage_json, started_at, ended_at, 0 AS retry FROM planning_rounds
      UNION ALL SELECT e.task_id, 'execution', a.usage_json, a.started_at, a.ended_at, CASE WHEN a.ordinal > 1 THEN 1 ELSE 0 END FROM attempts a JOIN executions e ON e.id=a.execution_id
      UNION ALL SELECT e.task_id, 'review', r.usage_json, r.started_at, r.ended_at, 0 FROM reviews r JOIN executions e ON e.id=r.execution_id
      UNION ALL SELECT e.task_id, 'fix', f.usage_json, NULL, NULL, 0 FROM fixes f JOIN executions e ON e.id=f.execution_id`).all() as unknown as { task_id: string; stage: 'planning'|'execution'|'review'|'fix'; usage_json: string | null; started_at: string | null; ended_at: string | null; retry: number }[];
    const qualities = new Map(this.taskQuality().map((item) => [item.taskId, item]));
    const verdicts = new Map(this.#store.acceptances.list().map((item) => [item.taskId, item.verdict]));
    const latestReviews = new Map<string, { state: string; executionId: string }>();
    for (const row of db.prepare('SELECT e.task_id, r.execution_id, r.state FROM reviews r JOIN executions e ON e.id=r.execution_id ORDER BY r.rowid DESC').all() as { task_id: string; execution_id: string; state: string }[]) if (!latestReviews.has(row.task_id)) latestReviews.set(row.task_id, { state: row.state, executionId: row.execution_id });
    return this.#store.tasks.list().map((task): TaskUsageView => {
      const taskRecords = records.filter((record) => record.task_id === task.id); let tokens = 0; let knownRecords = 0; let unknownRecords = 0; let unknownCostRecords = 0; let durationMs = 0; let knownDuration = 0; let unknownDurationRecords = 0; const costs = new Map<string, number>();
      const stages = { planning: 0, execution: 0, review: 0, fix: 0 };
      for (const record of taskRecords) {
        stages[record.stage]++; let usage: Record<string, any> = {}; try { usage = JSON.parse(record.usage_json ?? '{}') ?? {}; } catch { /* Malformed legacy telemetry is unknown. */ }
        const measured = record.stage === 'planning' ? usage.tokens : usage;
        const tokenKnown = typeof measured?.total === 'number' && Number.isFinite(measured.total) && measured.total >= 0;
        if (tokenKnown) { tokens += measured.total; knownRecords++; } else unknownRecords++;
        const budget = record.stage === 'planning' ? usage.budget : undefined;
        if (typeof budget?.known === 'number' && Number.isFinite(budget.known) && budget.known >= 0 && typeof budget.currency === 'string' && /^[A-Z]{3}$/.test(budget.currency) && (budget.known > 0 || usage.dispatches?.used > 0)) { costs.set(budget.currency, (costs.get(budget.currency) ?? 0) + budget.known); if (budget.unknown > 0) unknownCostRecords++; } else unknownCostRecords++;
        const from = Date.parse(record.started_at ?? ''); const to = Date.parse(record.ended_at ?? '');
        if (Number.isFinite(from) && Number.isFinite(to) && to >= from) { durationMs += to - from; knownDuration++; } else unknownDurationRecords++;
      }
      const hasIssues = verdicts.get(task.id) === 'rejected' || (qualities.get(task.id)?.openFindings ?? 0) > 0;
      const quality = hasIssues ? 'issues' : task.lifecycle === 'completed' && verdicts.get(task.id) === 'accepted' && latestReviews.get(task.id)?.state === 'completed' && latestReviews.get(task.id)?.executionId === task.executionId ? 'passed' : verdicts.get(task.id) === 'accepted' ? 'pending_review' : 'pending_acceptance';
      return { taskId: task.id, ...(knownRecords ? { tokens } : {}), knownRecords, unknownRecords, costs: [...costs].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amount]) => ({ currency, amount })), unknownCostRecords, ...(knownDuration ? { durationMs } : {}), unknownDurationRecords, retries: taskRecords.reduce((sum, record) => sum + record.retry, 0), stages, quality };
    });
  }

  taskQuality(): readonly { readonly taskId: string; readonly reviews: number; readonly openFindings: number }[] {
    const rows = this.#store.db
      .prepare(
        `SELECT e.task_id AS taskId,
                COUNT(r.id) AS reviews,
                COALESCE(SUM((SELECT COUNT(*) FROM json_each(r.findings_json) j WHERE json_extract(j.value, '$.status') = 'open')), 0) AS openFindings
           FROM reviews r
           JOIN executions e ON e.id = r.execution_id
          GROUP BY e.task_id
          ORDER BY e.task_id`,
      )
      .all() as unknown as { taskId: string; reviews: number; openFindings: number }[];
    return rows.map((row) => ({ taskId: row.taskId, reviews: Number(row.reviews), openFindings: Number(row.openFindings) }));
  }

  taskAcceptance(): readonly { readonly taskId: string; readonly passed: number; readonly failed: number; readonly total: number }[] {
    const rows = this.#store.db
      .prepare(
        `SELECT e.task_id AS taskId,
                SUM(CASE WHEN en.status = 'succeeded' THEN 1 ELSE 0 END) AS passed,
                SUM(CASE WHEN en.status IN ('failed', 'unknown') THEN 1 ELSE 0 END) AS failed,
                COUNT(en.node_id) AS total
           FROM executions e
           JOIN execution_nodes en ON en.execution_id = e.id
          GROUP BY e.task_id
          ORDER BY e.task_id`,
      )
      .all() as unknown as { taskId: string; passed: number; failed: number; total: number }[];
    const verdicts = new Map(this.#store.acceptances.list().map((item) => [item.taskId, item.verdict]));
    return rows.map((row) => ({ taskId: row.taskId, passed: Number(row.passed), failed: Number(row.failed), total: Number(row.total), ...(verdicts.get(row.taskId) === undefined ? {} : { verdict: verdicts.get(row.taskId) }) }));
  }
}
