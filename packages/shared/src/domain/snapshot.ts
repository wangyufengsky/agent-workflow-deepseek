import type { SnapshotReviewModeValue, SnapshotReviewDepthValue } from './enums.ts';
import type { IsoDateTime } from '../ids.ts';

export interface SnapshotAnalysisUnit {
  readonly id: string;
  readonly path: string;
  readonly blobSha: string;
  readonly sizeBytes: number;
  readonly excludedReason?: string;
  readonly deletedAtTarget?: boolean;
}
export interface CodeReviewSnapshot {
  readonly mode: SnapshotReviewModeValue;
  readonly depth: SnapshotReviewDepthValue;
  readonly targetSha: string;
  readonly baselineSha?: string;
  readonly frozenAt: IsoDateTime;
  readonly units: readonly SnapshotAnalysisUnit[];
  readonly batchSize: number;
}
export interface SnapshotFinding {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly line: number;
  readonly severity: 'high' | 'medium' | 'low';
  readonly verdict?: 'confirmed' | 'rejected';
  readonly rationale?: string;
}
export interface SnapshotUnitEvidence {
  readonly unitId: string;
  readonly blobSha: string;
  readonly summary: string;
  readonly findings: readonly SnapshotFinding[];
}
export interface GitSnapshotInventory {
  readonly targetSha: string;
  readonly baselineSha?: string;
  readonly files: readonly { readonly path: string; readonly blobSha: string; readonly sizeBytes: number; readonly mode: string; readonly deletedAtTarget?: boolean }[];
  readonly changedPaths?: readonly string[];
}
