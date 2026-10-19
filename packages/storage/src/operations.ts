import type { OperationReceipt, OperationRecord, OperationTarget, ReceiptStatusValue } from '@agent-workflow/shared';
import { createId, nowIso } from '@agent-workflow/shared';
import type { SqliteDatabase } from './db.ts';
import { jsonParse, jsonStringify } from './db.ts';

type Row = Record<string, unknown>;

export interface AcceptOperationInput {
  readonly requestKey: string;
  readonly operation: string;
  readonly bodyHash: string;
  readonly contractVersion: string;
  readonly target: OperationTarget;
  readonly resultResource?: OperationRecord['resultResource'];
}

export type OperationStatus = ReceiptStatusValue | 'accepted';

/**
 * Request-key ledger: idempotent retransmits (same key + same body hash) return
 * the original receipt; a different body under the same key is rejected.
 */
export class OperationRepository {
  readonly #db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.#db = db;
  }

  get(requestKey: string): OperationRecord | undefined {
    const row = this.#db.prepare('SELECT * FROM operations WHERE request_key = ?').get(requestKey) as Row | undefined;
    return row === undefined ? undefined : mapOperation(row);
  }

  accept(input: AcceptOperationInput): OperationRecord {
    const existing = this.get(input.requestKey);
    if (existing !== undefined) {
      if (existing.bodyHash !== input.bodyHash) {
        return existing;
      }
      return existing;
    }
    const at = nowIso();
    const record: OperationRecord = {
      operation: input.operation,
      operationKind: input.operation,
      requestKey: input.requestKey,
      bodyHash: input.bodyHash,
      contractVersion: input.contractVersion,
      status: 'accepted',
      target: input.target,
      acceptedAt: at,
      auditId: createId('audit'),
      reconcileCount: 0,
      resultResource: input.resultResource,
    };
    this.#db
      .prepare(
        `INSERT INTO operations (request_key, operation, body_hash, contract_version, status, target_json, accepted_at, audit_id, reconcile_count, result_resource_json)
         VALUES (?, ?, ?, ?, 'accepted', ?, ?, ?, 0, ?)`,
      )
      .run(
        record.requestKey,
        record.operation,
        record.bodyHash,
        record.contractVersion,
        jsonStringify(record.target),
        record.acceptedAt,
        record.auditId,
        record.resultResource === undefined ? null : jsonStringify(record.resultResource),
      );
    return record;
  }

  settle(
    requestKey: string,
    status: Exclude<OperationStatus, 'accepted'>,
    options: { outcome?: Record<string, unknown>; error?: OperationReceipt['error'] } = {},
  ): OperationRecord | undefined {
    const settledAt = status === 'unknown' ? null : nowIso();
    this.#db
      .prepare('UPDATE operations SET status = ?, settled_at = ?, outcome_json = ?, error_json = ? WHERE request_key = ?')
      .run(
        status,
        settledAt,
        options.outcome === undefined ? null : jsonStringify(options.outcome),
        options.error === undefined ? null : jsonStringify(options.error),
        requestKey,
      );
    return this.get(requestKey);
  }

  markReconciled(requestKey: string): OperationRecord | undefined {
    this.#db
      .prepare('UPDATE operations SET reconcile_count = reconcile_count + 1, last_checked_at = ? WHERE request_key = ?')
      .run(nowIso(), requestKey);
    return this.get(requestKey);
  }

  listPending(): readonly OperationRecord[] {
    const rows = this.#db
      .prepare("SELECT * FROM operations WHERE status IN ('accepted','unknown') ORDER BY accepted_at DESC")
      .all() as unknown as Row[];
    return rows.map(mapOperation);
  }

  listRecentFor(operations: readonly string[], limit = 30): readonly OperationRecord[] {
    if (operations.length === 0) return [];
    const placeholders = operations.map(() => '?').join(',');
    const rows = this.#db.prepare(`SELECT * FROM operations WHERE operation IN (${placeholders}) ORDER BY accepted_at DESC, rowid DESC LIMIT ?`).all(...operations, limit) as unknown as Row[];
    return rows.map(mapOperation);
  }

  listRecent(limit = 50): readonly OperationRecord[] {
    const rows = this.#db.prepare('SELECT * FROM operations ORDER BY accepted_at DESC LIMIT ?').all(limit) as unknown as Row[];
    return rows.map(mapOperation);
  }
}

function mapOperation(row: Row): OperationRecord {
  return {
    operation: String(row.operation),
    operationKind: String(row.operation),
    requestKey: String(row.request_key),
    bodyHash: String(row.body_hash),
    contractVersion: String(row.contract_version),
    status: row.status as OperationRecord['status'],
    target: jsonParse<OperationTarget>(row.target_json as string, {}),
    outcome: jsonParse<Record<string, unknown> | undefined>(row.outcome_json as string | null, undefined),
    error: jsonParse<OperationReceipt['error'] | undefined>(row.error_json as string | null, undefined),
    acceptedAt: String(row.accepted_at),
    settledAt: row.settled_at === null ? undefined : String(row.settled_at),
    auditId: String(row.audit_id),
    reconcileCount: Number(row.reconcile_count),
    lastCheckedAt: row.last_checked_at === null ? undefined : String(row.last_checked_at),
    resultResource: jsonParse<OperationRecord['resultResource'] | undefined>(row.result_resource_json as string | null, undefined),
  };
}
