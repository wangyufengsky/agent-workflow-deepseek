import type { ArtifactRef } from './models.ts';
import type { TestCaseStatusValue } from './enums.ts';
/** Only the server may materialize these identities from controlled tools. */
export interface ControlledTestCase { readonly name: string; readonly className?: string; readonly fileMapping?: 'reported' | 'classname'; readonly fileReason?: string; readonly status: TestCaseStatusValue; readonly file?: string; readonly line?: number; readonly message?: string; readonly artifact?: ArtifactRef }
export interface ControlledTestRun {
  readonly id: string; readonly taskId: string; readonly executionId: string; readonly nodeId: string; readonly attemptId: string;
  readonly workspaceId?: string; readonly workspaceRevision?: string; readonly argv: readonly string[]; readonly command: string; readonly commandSha256: string; readonly startedAt: string; readonly endedAt: string; readonly exitCode: number; readonly timedOut: boolean;
  readonly format: 'junit'; readonly state: 'passed' | 'failed' | 'unknown'; readonly reason?: string;
  readonly passed?: number; readonly failed?: number; readonly skipped?: number; readonly cases: readonly ControlledTestCase[]; readonly report?: ArtifactRef;
}
export interface SourceFileEvidence {
  readonly path: string; readonly blobSha: string; readonly summary: string; readonly stage: 'write' | 'review' | 'test'; readonly attemptId: string;
  readonly artifacts: readonly ArtifactRef[]; readonly writerAttemptId?: string; readonly verdict?: 'confirmed' | 'rejected'; readonly rationale?: string;
  readonly testRunId?: string;
}
