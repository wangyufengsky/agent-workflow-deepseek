import { QualityReviewKind, type QualityReviewKindValue, type QualityReviewVerdictValue } from './enums.ts';
export interface QualityReviewContract { readonly kind: QualityReviewKindValue; readonly criteria: readonly string[] }
export interface QualityReviewFinding { readonly criterion: number; readonly verdict: QualityReviewVerdictValue; readonly rationale: string; readonly evidence: readonly { readonly path: string; readonly sha256: string; readonly quote: string }[] }
export interface QualityReviewReport {
  readonly kind: QualityReviewKindValue; readonly verdict: QualityReviewVerdictValue; readonly summary: string;
  readonly findings: readonly QualityReviewFinding[];
  readonly source: { readonly taskId: string; readonly executionId: string; readonly planRevisionId: string; readonly nodeId: string; readonly attemptId: string; readonly sessionId: string };
  readonly contract: QualityReviewContract;
}
export function validQualityReviewContract(value: unknown, nodeKind: string): value is QualityReviewContract {
  if (!value || typeof value !== 'object' || Array.isArray(value) || nodeKind !== 'verify') return false;
  const raw = value as Record<string, unknown>;
  return (Object.values(QualityReviewKind) as readonly string[]).includes(String(raw.kind)) && Array.isArray(raw.criteria) && raw.criteria.length > 0 && raw.criteria.length <= 50 && raw.criteria.every(item => typeof item === 'string' && item.trim().length > 0 && item.length <= 2000) && new Set(raw.criteria).size === raw.criteria.length;
}
