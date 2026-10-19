import { nowIso, type InsightsResponse } from '@agent-workflow/shared';
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
        costKnown: count("SELECT COALESCE(SUM(CAST(json_extract(usage_json, '$.budget.known') AS REAL)), 0) AS n FROM planning_rounds"),
        budgetUnknownRounds: count("SELECT COUNT(*) AS n FROM planning_rounds WHERE CAST(COALESCE(json_extract(usage_json, '$.budget.unknown'), 0) AS INTEGER) > 0"),
        tokens: {
          input: count("SELECT COALESCE(SUM(CAST(json_extract(usage_json, '$.tokens.input') AS INTEGER)), 0) AS n FROM planning_rounds"),
          output: count("SELECT COALESCE(SUM(CAST(json_extract(usage_json, '$.tokens.output') AS INTEGER)), 0) AS n FROM planning_rounds"),
          reasoning: count("SELECT COALESCE(SUM(CAST(json_extract(usage_json, '$.tokens.reasoning') AS INTEGER)), 0) AS n FROM planning_rounds"),
          cache: count("SELECT COALESCE(SUM(CAST(json_extract(usage_json, '$.tokens.cache') AS INTEGER)), 0) AS n FROM planning_rounds"),
          total: count("SELECT COALESCE(SUM(CAST(json_extract(usage_json, '$.tokens.total') AS INTEGER)), 0) AS n FROM planning_rounds"),
        },
        currency: String(this.#store.settings.getSettings()?.planning?.currency ?? 'USD'),
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

  taskUsage(): readonly { readonly taskId: string; readonly tokens: number }[] {
    const rows = this.#store.db
      .prepare("SELECT task_id AS taskId, COALESCE(SUM(CAST(json_extract(usage_json, '$.tokens.total') AS INTEGER)), 0) AS tokens FROM planning_rounds GROUP BY task_id ORDER BY task_id")
      .all() as unknown as { taskId: string; tokens: number }[];
    return rows.map((row) => ({ taskId: row.taskId, tokens: Number(row.tokens) }));
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
    return rows.map((row) => ({ taskId: row.taskId, passed: Number(row.passed), failed: Number(row.failed), total: Number(row.total) }));
  }
}
