import { createHash } from 'node:crypto';
import type { CommandResponse, OperationKindValue, OperationReceipt, OperationRecord } from '@agent-workflow/shared';
import { AppError, ErrorCode, createId, OPERATIONS, nowIso } from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';

export const CONTRACT_VERSION = '1';

export function stableHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
  return `{${entries.join(',')}}`;
}

/**
 * Request-key command envelope. Reusing a key with the same body returns the
 * original receipt; a different body is rejected. Unknown outcomes stay unknown
 * until the service settles them via reconcile.
 */
export class CommandService {
  readonly #store: Store;

  constructor(store: Store) {
    this.#store = store;
  }

  /** Check an original request before mutable resource/state preconditions. Never accepts or resumes work. */
  replay<T = Record<string, unknown>>(input: { readonly requestKey: string; readonly operation: OperationKindValue; readonly body: unknown; readonly legacyBodies?: readonly unknown[] }, read?: (record: OperationRecord) => T | undefined): CommandResponse<T> | undefined {
    const record = this.#store.operations.get(input.requestKey);
    if (record === undefined) return undefined;
    const matches = record.bodyHash === stableHash(input.body) || (this.#store.settings.getJson(`operation.identity.${input.requestKey}`) === undefined && input.legacyBodies?.some((body) => record.bodyHash === stableHash(body)) === true);
    if (record.operation !== input.operation || !matches) {
      throw new AppError(ErrorCode.REQUEST_KEY_REUSED, '同一请求号对应了不同的操作或请求内容，请使用新的请求号', { details: { requestKey: input.requestKey } });
    }
    let resource: T | undefined;
    try { resource = read?.(record); } catch (error) {
      if (!(error instanceof AppError) || error.code !== ErrorCode.NOT_FOUND) throw error;
      // The original receipt remains queryable even when its resource was removed.
    }
    return { receipt: this.toReceipt(record), ...(resource === undefined ? {} : { resource }) };
  }

  /** Frozen canonical body for service-resolved fields; it never changes on replay. */
  originalBody<T>(requestKey: string): T | undefined {
    return this.#store.settings.getJson<T>(`operation.body.${requestKey}`);
  }

  begin(input: {
    readonly requestKey: string;
    readonly operation: OperationKindValue;
    readonly body: unknown;
    readonly target: OperationRecord['target'];
    readonly resultResource?: OperationRecord['resultResource'];
  }): { readonly record: OperationRecord; readonly replayed: boolean } {
    const definition = OPERATIONS[input.operation];
    if (definition === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, `未知操作 ${input.operation}`);
    if (definition.requiresRequestKey && (typeof input.requestKey !== 'string' || !input.requestKey.startsWith('req_'))) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'requestKey 不合法');
    }
    const bodyHash = stableHash(input.body);
    const existing = this.#store.operations.get(input.requestKey);
    if (existing !== undefined) {
      if (existing.operation !== input.operation || existing.bodyHash !== bodyHash) {
        throw new AppError(ErrorCode.REQUEST_KEY_REUSED, '同一请求号对应了不同的请求内容，请使用新的请求号', {
          details: { requestKey: input.requestKey },
        });
      }
      return { record: existing, replayed: true };
    }
    const record = this.#store.operations.accept({
      requestKey: input.requestKey,
      operation: input.operation,
      bodyHash,
      contractVersion: CONTRACT_VERSION,
      target: input.target,
      resultResource: input.resultResource,
    });
    this.#store.settings.putJson(`operation.identity.${input.requestKey}`, 1);
    // Only these canonical bodies contain service-derived non-secret identifiers.
    // Never copy arbitrary settings/database command bodies (which can contain credentials).
    if (['plan.template.use', 'review.start', 'fix.start', 'fix.merge'].includes(input.operation)) this.#store.settings.putJson(`operation.body.${input.requestKey}`, input.body);
    return { record, replayed: false };
  }

  settle(requestKey: string, outcome: Record<string, unknown> = {}): OperationRecord {
    const record = this.#store.operations.settle(requestKey, 'succeeded', { outcome });
    if (record === undefined) throw new AppError(ErrorCode.NOT_FOUND, '操作记录不存在');
    this.#store.events.publish('operation.settled', {
      requestKey,
      operation: record.operation,
      status: 'succeeded',
      target: record.target.taskId ?? record.target.projectId,
    });
    return record;
  }

  fail(requestKey: string, error: Error, unknown = false): OperationRecord {
    const code = error instanceof AppError ? error.code : ErrorCode.INTERNAL_ERROR;
    const record = this.#store.operations.settle(requestKey, unknown ? 'unknown' : 'failed', {
      error: { code, message: error.message },
    });
    if (record !== undefined) {
      this.#store.events.publish('operation.settled', {
        requestKey,
        operation: record.operation,
        status: unknown ? 'unknown' : 'failed',
        target: record.target.taskId ?? record.target.projectId,
      });
    }
    if (record === undefined) throw new AppError(ErrorCode.NOT_FOUND, '操作记录不存在');
    return record;
  }

  get(requestKey: string): OperationRecord | undefined {
    return this.#store.operations.get(requestKey);
  }

  toReceipt(record: OperationRecord): OperationReceipt {
    return {
      operation: record.operation,
      requestKey: record.requestKey,
      bodyHash: record.bodyHash,
      contractVersion: record.contractVersion,
      status: record.status,
      target: record.target,
      outcome: record.outcome,
      error: record.error,
      acceptedAt: record.acceptedAt,
      settledAt: record.settledAt,
      auditId: record.auditId,
    };
  }

  auditId(): string {
    return createId('audit');
  }

  now(): string {
    return nowIso();
  }
}
