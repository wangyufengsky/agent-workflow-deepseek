/**
 * Opaque identifiers. The service issues them; clients only compare for equality.
 */
export type ProjectId = string;
export type TaskId = string;
export type PlanId = string;
export type PlanNodeId = string;
export type PlanEdgeId = string;
export type PlanningRoundId = string;
export type ExecutionId = string;
export type AttemptId = string;
export type WorkspaceId = string;
export type DeliveryId = string;
export type OperationId = string;
export type RequestKey = string;
export type RepoId = string;
export type ReviewRunId = string;
export type FindingId = string;
export type FixRunId = string;
export type DatabaseConnectionId = string;
export type EventSeq = number;
export type IsoDateTime = string;
export type Revision = string;

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Monotonic-ish, URL-safe, sortable id: time prefix + randomness. */
export function createId(prefix: string): string {
  const now = Date.now().toString(36).padStart(9, '0');
  let random = '';
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  for (const byte of bytes) random += ALPHABET[byte % ALPHABET.length];
  return `${prefix}_${now}${random}`;
}

export function createRequestKey(): RequestKey {
  return createId('req');
}

export function nowIso(): IsoDateTime {
  return new Date().toISOString();
}

export function isRequestKey(value: unknown): value is RequestKey {
  return typeof value === 'string' && /^req_[a-z0-9]{19,}$/.test(value);
}
