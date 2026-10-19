import type {
  AttemptId,
  DatabaseConnectionId,
  DeliveryId,
  ExecutionId,
  FindingId,
  FixRunId,
  IsoDateTime,
  PlanEdgeId,
  PlanId,
  PlanNodeId,
  PlanningRoundId,
  ProjectId,
  RepoId,
  RequestKey,
  ReviewRunId,
  Revision,
  TaskId,
  WorkspaceId,
} from '../ids.ts';
import type {
  ChangeCheckValue,
  ChangeStatusValue,
  ConflictResolutionValue,
  ConflictTypeValue,
  DatabaseConnectionStateValue,
  DatabaseTypeValue,
  DeliveryGoalValue,
  DeliveryProjectionValue,
  DeliveryStepValue,
  DimensionValue,
  ExecutionStatusValue,
  FindingStatusValue,
  FixOutcomeValue,
  FixRunStateValue,
  GitConnectionStateValue,
  GitProviderValue,
  NodeKindValue,
  NodeStatusValue,
  PlanRevisionStatusValue,
  PlanningApplyStatusValue,
  PlanningRunStatusValue,
  PlanningStageValue,
  PptWorkStatusValue,
  ReceiptStatusValue,
  RepoGitStateValue,
  ReviewRunStateValue,
  SeverityValue,
  TaskAttentionValue,
  TaskLifecycleValue,
  TaskMethodSupportValue,
  TaskStageValue,
  VerificationStateValue,
  WorkspaceKindValue,
  WorkspaceStateValue,
} from './enums.ts';

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

/** Server-computed availability. UI disables but the service re-checks on command. */
export interface ActionAvailability {
  readonly allowed: boolean;
  readonly reasonCode?: string;
  readonly reason?: string;
}

export interface Binding {
  readonly projectId: ProjectId;
  readonly readAt: IsoDateTime;
  readonly revision?: Revision;
}

/* ------------------------------------------------------------------ */
/* Project                                                             */
/* ------------------------------------------------------------------ */

export interface ProjectSettings {
  readonly testCommand?: string;
  readonly gitProvider?: GitProviderValue;
  readonly defaultModelProfileId?: string;
  readonly defaultMethodId?: string;
}

export interface Project {
  readonly id: ProjectId;
  readonly name: string;
  readonly description: string;
  readonly rootPath: string;
  readonly gitState: RepoGitStateValue;
  readonly defaultBranch?: string;
  readonly remoteDisplayUrl?: string;
  readonly settings: ProjectSettings;
  readonly archived: boolean;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export interface ProjectSummary extends Project {
  readonly openTaskCount: number;
  readonly attentionCount: number;
}

/* ------------------------------------------------------------------ */
/* Catalog (configurable method / role / template / task types)        */
/* ------------------------------------------------------------------ */

export interface MethodStepDefinition {
  readonly key: string;
  readonly title: string;
  readonly kind: NodeKindValue;
  readonly group: string;
  readonly optional?: boolean;
}

export interface WorkflowMethod {
  readonly id: string;
  readonly name: string;
  readonly revision: string;
  readonly support: TaskMethodSupportValue;
  readonly requiredSteps: readonly MethodStepDefinition[];
  readonly refinableGroups: readonly string[];
  readonly planningStrategy?: { readonly id: string; readonly version: string; readonly roleId: string };
  readonly description: string;
}

export interface RoleDefinition {
  readonly id: string;
  readonly name: string;
  readonly purpose: string;
  readonly revision: string;
  readonly promptRevision: string;
  readonly responsibilities: readonly string[];
}

export interface TaskTemplate {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly steps: readonly MethodStepDefinition[];
  readonly parameters: readonly { readonly key: string; readonly label: string; readonly required: boolean }[];
  readonly lockedAfterCreate: true;
}

export interface TaskTypeDefinition {
  readonly id: string;
  readonly name: string;
  readonly methodId: string;
}

export interface CatalogSnapshot {
  readonly methods: readonly WorkflowMethod[];
  readonly roles: readonly RoleDefinition[];
  readonly templates: readonly TaskTemplate[];
  readonly taskTypes: readonly TaskTypeDefinition[];
  readonly modelProfiles: readonly ModelProfile[];
}

export interface ModelProfile {
  readonly id: string;
  readonly label: string;
  readonly provider: string;
  readonly model: string;
  readonly roles: readonly string[];
  readonly enabled: boolean;
}

/* ------------------------------------------------------------------ */
/* Task and requirement                                                */
/* ------------------------------------------------------------------ */

export interface FixedTemplateBinding {
  readonly templateId: string;
  readonly templateVersion: number;
  readonly locked: true;
  readonly parameters: Record<string, string>;
}

export interface RequirementEntry {
  readonly id: string;
  readonly kind: 'requirement' | 'constraint' | 'acceptance';
  readonly text: string;
  readonly sourceStart?: number;
  readonly sourceEnd?: number;
}

export interface RequirementInput {
  readonly text: string;
  readonly supplements: readonly { readonly id: string; readonly revision: number; readonly text: string; readonly savedAt: IsoDateTime }[];
  readonly entries: readonly RequirementEntry[];
  readonly revision: number;
  readonly updatedAt: IsoDateTime;
}

export interface Task {
  readonly id: TaskId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly stage: TaskStageValue;
  readonly lifecycle: TaskLifecycleValue;
  readonly attention: TaskAttentionValue;
  readonly methodId: string;
  readonly methodRevision: string;
  readonly fixedTemplate?: FixedTemplateBinding;
  readonly requirement: RequirementInput;
  readonly currentPlanRevisionId?: PlanId;
  readonly currentPlanningRoundId?: PlanningRoundId;
  readonly workspaceId?: WorkspaceId;
  readonly executionId?: ExecutionId;
  readonly deliveryId?: DeliveryId;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export interface TaskSummary {
  readonly id: TaskId;
  readonly projectId: ProjectId;
  readonly projectName: string;
  readonly title: string;
  readonly stage: TaskStageValue;
  readonly lifecycle: TaskLifecycleValue;
  readonly attention: TaskAttentionValue;
  readonly methodName: string;
  readonly planning?: {
    readonly status: PlanningRunStatusValue;
    readonly stage: PlanningStageValue;
    readonly lastActivity: string;
  };
  readonly progress: { readonly done: number; readonly total: number; readonly running: number; readonly failed: number };
  readonly deliveryProjection?: DeliveryProjectionValue;
  readonly updatedAt: IsoDateTime;
}

/* ------------------------------------------------------------------ */
/* Plan graph                                                          */
/* ------------------------------------------------------------------ */

export interface PlanNodeInputRef {
  readonly name: string;
  readonly source: 'requirement' | 'upstream' | 'artifact' | 'manual';
  readonly sourceNodeId?: PlanNodeId;
}

export interface PlanNodeOutputRef {
  readonly name: string;
  readonly kind: 'artifact' | 'evidence' | 'summary';
}

export interface ResourceRef {
  readonly kind: 'file' | 'directory' | 'database' | 'http' | 'mcp';
  readonly label: string;
  readonly basis: 'declared' | 'read' | 'truncated';
}

export interface PlanNode {
  readonly id: PlanNodeId;
  readonly key: string;
  readonly title: string;
  readonly kind: NodeKindValue;
  readonly groupId: string;
  readonly summary: string;
  readonly inputs: readonly PlanNodeInputRef[];
  readonly outputs: readonly PlanNodeOutputRef[];
  readonly acceptance: readonly string[];
  readonly resources: { readonly read: readonly ResourceRef[]; readonly write: readonly ResourceRef[] };
  readonly roleId?: string;
  readonly templateRevision?: string;
  /** Position stored by the service so restarts and re-reads keep the same canvas view. */
  readonly position?: { readonly x: number; readonly y: number };
}

export type PlanEdgeKind = 'data' | 'order' | 'resource';

export interface PlanEdge {
  readonly id: PlanEdgeId;
  readonly from: PlanNodeId;
  readonly to: PlanNodeId;
  readonly kind: PlanEdgeKind;
  readonly label?: string;
}

export interface PlanGroup {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly refined: boolean;
  readonly collapsible: boolean;
  readonly collapsedByDefault: boolean;
  readonly refinementScope?: 'whole' | 'selection';
}

export interface PlanGraph {
  readonly nodes: readonly PlanNode[];
  readonly edges: readonly PlanEdge[];
  readonly groups: readonly PlanGroup[];
}

export type NodeDiffKind = 'added' | 'modified' | 'replaced_by_refinement' | 'unchanged';

export interface NodeDiff {
  readonly nodeId: PlanNodeId;
  readonly nodeKey: string;
  readonly title: string;
  readonly kind: NodeDiffKind;
  readonly summary: string;
  readonly groupId: string;
}

export interface HumanDecision {
  readonly id: string;
  readonly nodeId?: PlanNodeId;
  readonly title: string;
  readonly detail: string;
  readonly accepted: boolean;
  readonly acceptedBy?: string;
  readonly acceptedAt?: IsoDateTime;
}

export interface PlanProblem {
  readonly id: string;
  readonly code: string;
  readonly severity: 'hard' | 'warning' | 'info';
  readonly title: string;
  readonly detail: string;
  readonly nodeId?: PlanNodeId;
  readonly edgeId?: PlanEdgeId;
}

export interface PlanValidation {
  readonly structural: { readonly state: 'passed' | 'failed' | 'running' | 'not_started'; readonly problems: readonly PlanProblem[] };
  readonly humanReview: { readonly required: number; readonly accepted: number; readonly items: readonly HumanDecision[] };
  readonly basis: { readonly state: 'complete' | 'partial' | 'missing' | 'stale'; readonly detail: string };
  readonly readiness: { readonly state: 'ready' | 'needs_preparation' | 'blocked' | 'unknown'; readonly detail: string };
  readonly checks: readonly { readonly id: string; readonly label: string; readonly state: 'passed' | 'failed' | 'running' | 'not_started'; readonly detail?: string }[];
  readonly requirementCoverage: readonly {
    readonly requirementId: string;
    readonly label: string;
    readonly covered: boolean;
    readonly nodeIds: readonly PlanNodeId[];
  }[];
}

export interface PlanRevision {
  readonly id: PlanId;
  readonly taskId: TaskId;
  readonly revisionNumber: number;
  readonly status: PlanRevisionStatusValue;
  readonly source: 'initial' | 'skeleton' | 'applied' | 'manual' | 'template' | 'edit';
  readonly baseRevisionId?: PlanId;
  readonly graph: PlanGraph;
  readonly validation?: PlanValidation;
  readonly diff?: readonly NodeDiff[];
  readonly createdAt: IsoDateTime;
  readonly confirmedAt?: IsoDateTime;
  readonly confirmedBy?: string;
}

/* ------------------------------------------------------------------ */
/* Planning runs                                                       */
/* ------------------------------------------------------------------ */

export interface PlanningStageRun {
  readonly stage: Exclude<PlanningStageValue, 'done' | 'stopped' | 'failed'>;
  readonly state: 'completed' | 'running' | 'not_started';
  readonly startedAt?: IsoDateTime;
  readonly endedAt?: IsoDateTime;
  readonly detail?: string;
}

export interface TokenUsage {
  readonly input: number;
  readonly output: number;
  readonly reasoning: number;
  readonly cache: number;
  readonly total: number;
}

export interface PlanningUsage {
  readonly dispatches: { readonly used: number; readonly maximum: number };
  readonly revisions: { readonly used: number; readonly maximum: number };
  readonly budget: {
    readonly known: number;
    readonly reserved: number;
    readonly unknown: number;
    readonly currency: string;
    readonly limit?: number;
  };
  readonly tokens?: TokenUsage;
  readonly deadlineAt?: IsoDateTime;
  readonly modelDisplayName?: string;
}

export interface PlanningQuestion {
  readonly id: string;
  readonly question: string;
  readonly affectedNodeIds: readonly PlanNodeId[];
  readonly answer?: string;
  readonly answeredAt?: IsoDateTime;
  readonly answeredBy?: string;
  readonly required: boolean;
}

export interface PlanningAssumption {
  readonly id: string;
  readonly statement: string;
  readonly affectedNodeIds: readonly PlanNodeId[];
  readonly critical: boolean;
  readonly confirmed: boolean;
}

export interface PlanningCheckpoint {
  readonly id: string;
  readonly roundId: PlanningRoundId;
  readonly planRevisionId: PlanId;
  readonly coveredGroups: readonly string[];
  readonly missingGroups: readonly string[];
  readonly savedAt: IsoDateTime;
  readonly executable: false;
}

export interface PlanningStopState {
  readonly requestKey?: RequestKey;
  readonly requestedAt?: IsoDateTime;
  readonly processState: 'running' | 'stopping' | 'stopped' | 'unknown';
  readonly accountingState: 'open' | 'closed' | 'unknown';
  readonly settledAt?: IsoDateTime;
}

export interface PlanningRecordGap {
  readonly fromSeq: number;
  readonly toSeq: number;
  readonly reason: 'NOT_RETAINED' | 'CAPTURE_UNAVAILABLE';
}

export interface PlanningRound {
  readonly id: PlanningRoundId;
  readonly taskId: TaskId;
  readonly ordinal: number;
  readonly status: PlanningRunStatusValue;
  readonly stage: PlanningStageValue;
  readonly applyStatus: PlanningApplyStatusValue;
  readonly inputRevision: number;
  readonly method: { readonly id: string; readonly revision: string; readonly name: string };
  readonly strategy: { readonly id: string; readonly version: string };
  readonly model: ModelProfile;
  readonly stageRuns: readonly PlanningStageRun[];
  readonly usage: PlanningUsage;
  readonly startedAt?: IsoDateTime;
  readonly endedAt?: IsoDateTime;
  readonly lastActivity?: string;
  readonly candidate?: {
    readonly planRevisionId: PlanId;
    readonly summary: string;
    readonly diff: readonly NodeDiff[];
    readonly validation: PlanValidation;
    readonly checkpoint?: PlanningCheckpoint;
  };
  readonly questions: readonly PlanningQuestion[];
  readonly assumptions: readonly PlanningAssumption[];
  readonly stop?: PlanningStopState;
  readonly failure?: { readonly code: string; readonly message: string };
  readonly reconcile?: {
    readonly state: 'idle' | 'checking' | 'settled' | 'still_unknown';
    readonly checkedAt?: IsoDateTime;
    readonly detail?: string;
  };
  readonly previousRoundId?: PlanningRoundId;
  readonly sessionId?: string;
  readonly recordSeq: { readonly first: number; readonly last: number; readonly gaps: readonly PlanningRecordGap[] };
}

export interface PlanningView {
  readonly taskId: TaskId;
  readonly currentRoundId?: PlanningRoundId;
  readonly rounds: readonly PlanningRound[];
  readonly preview?: PlanningPreview;
  readonly actions: Record<string, ActionAvailability>;
}

export interface PlanningPreview {
  readonly previewId: string;
  readonly taskId: TaskId;
  readonly roundOrdinal: number;
  readonly sourceInputRevision: number;
  readonly project: { readonly id: ProjectId; readonly name: string };
  readonly sources: readonly { readonly label: string; readonly readable: boolean; readonly detail: string }[];
  readonly method: { readonly name: string; readonly revision: string };
  readonly strategy: { readonly name: string; readonly version: string };
  readonly model: ModelProfile;
  readonly dispatchLimit: { readonly drafts: number; readonly revisions: number; readonly transportRetries: number };
  readonly timeLimitMinutes: number;
  readonly perDispatchLimitMinutes: number;
  readonly budget: { readonly limit: number; readonly reserved: number; readonly currency: string };
  readonly graphLimits: { readonly nodes: number; readonly edges: number; readonly groups: number; readonly depth: number };
  readonly expiresAt: IsoDateTime;
  readonly blockers: readonly { readonly code: string; readonly message: string; readonly goTo?: string }[];
  readonly notes: readonly string[];
}

/* ------------------------------------------------------------------ */
/* Execution                                                           */
/* ------------------------------------------------------------------ */

export interface EditSession {
  readonly id: string;
  readonly state: 'requesting_pause' | 'editing' | 'saving' | 'saved' | 'conflict' | 'finished' | 'abandoned';
  readonly requestKey: RequestKey;
  readonly autoAdvanceBeforeEdit: boolean;
  readonly lockedNodeIds: readonly PlanNodeId[];
  readonly localChanges: readonly {
    readonly nodeId: PlanNodeId;
    readonly title?: string;
    readonly prerequisites?: readonly PlanNodeId[];
    readonly acceptance?: readonly string[];
  }[];
}

export interface ExecutionView {
  readonly id: ExecutionId;
  readonly taskId: TaskId;
  readonly planRevisionId: PlanId;
  readonly status: ExecutionStatusValue;
  readonly autoAdvance: boolean;
  readonly nodes: readonly ExecutionNodeState[];
  readonly frontier: readonly PlanNodeId[];
  readonly progress: { readonly done: number; readonly total: number; readonly running: number; readonly failed: number };
  readonly startedAt?: IsoDateTime;
  readonly endedAt?: IsoDateTime;
  readonly pause?: { readonly requestedAt?: IsoDateTime; readonly settledAt?: IsoDateTime; readonly requestKey?: RequestKey };
  readonly editSession?: EditSession;
  readonly notice?: { readonly kind: 'plan_changed' | 'race' | 'paused' | 'failed' | 'unknown'; readonly message: string };
  readonly actions: Record<string, ActionAvailability>;
}

export interface ExecutionNodeState {
  readonly nodeId: PlanNodeId;
  readonly status: NodeStatusValue;
  readonly currentAttemptId?: AttemptId;
  readonly attemptCount: number;
  readonly startedAt?: IsoDateTime;
  readonly endedAt?: IsoDateTime;
  readonly error?: { readonly code: string; readonly message: string };
}

export interface AttemptResult {
  readonly resultRevision: string;
  readonly summary: string;
  readonly payload?: Record<string, unknown>;
  readonly artifacts: readonly ArtifactRef[];
  readonly verification?: {
    readonly state: VerificationStateValue;
    readonly passed?: number;
    readonly failed?: number;
    readonly summary?: string;
    readonly logArtifactId?: string;
  };
  readonly errors: readonly { readonly code: string; readonly message: string }[];
  readonly warnings: readonly string[];
}

export interface ArtifactRef {
  readonly id: string;
  readonly revision: string;
  readonly sha256: string;
  readonly mediaType: string;
  readonly name: string;
  readonly sizeBytes?: number;
  readonly sourceAttemptId?: AttemptId;
}

export interface Attempt {
  readonly id: AttemptId;
  readonly executionId: ExecutionId;
  readonly nodeId: PlanNodeId;
  readonly ordinal: number;
  readonly status: NodeStatusValue;
  readonly startedAt?: IsoDateTime;
  readonly endedAt?: IsoDateTime;
  readonly result?: AttemptResult;
  readonly usage?: TokenUsage;
  readonly readability: { readonly output: string; readonly tools: string; readonly result: string };
}

export interface OutputFragment {
  readonly fragmentId: string;
  readonly seq: number;
  readonly category: 'model_text' | 'public_reasoning_summary' | 'tool_activity' | 'service_event';
  readonly recordedAt?: IsoDateTime;
  readonly format?: 'markdown' | 'text';
  readonly text?: string;
  readonly blockId?: string;
  readonly toolCallRef?: { readonly callId: string; readonly status: string; readonly source: 'managed_mcp' | 'opencode' };
  readonly eventKind?: string;
}

export interface NodeDetail {
  readonly taskId: TaskId;
  readonly nodeId: PlanNodeId;
  readonly planRevisionId: PlanId;
  readonly node: PlanNode;
  readonly group?: PlanGroup;
  readonly requirementLinks: readonly { readonly entryId: string; readonly label: string; readonly text: string; readonly start?: number; readonly end?: number }[];
  readonly dependencyReasons: readonly { readonly fromNodeId: PlanNodeId; readonly kind: PlanEdgeKind; readonly reason: string }[];
  readonly execution?: ExecutionNodeState;
  readonly currentAttempt?: Attempt;
  readonly attempts: readonly Attempt[];
  readonly output: {
    readonly fragments: readonly OutputFragment[];
    readonly nextSeq: number;
    readonly terminal: boolean;
    readonly capabilities: { readonly modelText: string; readonly publicReasoningSummary: string; readonly toolSources: readonly string[] };
  };
  readonly actions: Record<string, ActionAvailability>;
}

/* ------------------------------------------------------------------ */
/* Workspace / changes / delivery                                      */
/* ------------------------------------------------------------------ */

export interface WorkspacePreparationStep {
  readonly step: string;
  readonly state: 'completed' | 'running' | 'not_started' | 'failed';
  readonly detail?: string;
}

export interface TaskWorkspace {
  readonly id: WorkspaceId;
  readonly taskId: TaskId;
  readonly kind: WorkspaceKindValue;
  readonly state: WorkspaceStateValue;
  readonly revision: Revision;
  readonly displayRoot?: string;
  readonly originalRootDisplay?: string;
  readonly branch?: string;
  readonly baseRef?: string;
  readonly baseSha?: string;
  readonly worktreeHandle?: string;
  readonly steps: readonly WorkspacePreparationStep[];
  readonly parallelWritePolicy: 'serial' | 'sub_isolation_merge';
  readonly children: readonly { readonly nodeId: PlanNodeId; readonly name: string; readonly state: string; readonly mergedAt?: IsoDateTime }[];
  readonly activeWrites: readonly PlanNodeId[];
  readonly pendingOperationRef?: RequestKey;
  readonly retention: 'retained' | 'cleaning' | 'partial' | 'cleaned';
  readonly createdAt?: IsoDateTime;
  readonly lastCheckedAt?: IsoDateTime;
  readonly actions: Record<string, ActionAvailability>;
}

export interface FileChange {
  readonly fileId: string;
  readonly status: ChangeStatusValue;
  readonly path: string;
  readonly oldPath?: string;
  readonly binary: boolean;
  readonly additions: number | null;
  readonly deletions: number | null;
  readonly sizeClass: 'normal' | 'large' | 'too_large';
  readonly mode?: { readonly old?: string; readonly new?: string };
  readonly versionRef: string;
  readonly findingCount?: number;
}

export interface TaskChanges {
  readonly workspaceId: WorkspaceId;
  readonly changesRevision: Revision;
  readonly baselineRef?: string;
  readonly readAt: IsoDateTime;
  readonly stats: { readonly added: number; readonly modified: number; readonly deleted: number };
  readonly files: readonly FileChange[];
  readonly excluded: readonly { readonly path: string; readonly reason: string }[];
  readonly verification?: AttemptResult['verification'];
}

export interface DiffLine {
  readonly kind: 'context' | 'add' | 'del' | 'no_newline';
  readonly oldLine?: number;
  readonly newLine?: number;
  readonly anchorId: string;
  readonly text: string;
}

export interface DiffHunk {
  readonly hunkId: string;
  readonly header: string;
  readonly section?: string;
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly DiffLine[];
}

export interface DiffPage {
  readonly fileId: string;
  readonly baseSha?: string;
  readonly headSha?: string;
  readonly worktreeRevision?: string;
  readonly ignoreWhitespace: boolean;
  readonly hunks: readonly DiffHunk[];
  readonly truncated?: { readonly reason: 'LINE_LIMIT' | 'BYTE_LIMIT'; readonly shownLines: number };
  readonly nextCursor?: string;
}

export interface ApplyPreviewItem {
  readonly fileId: string;
  readonly path: string;
  readonly change: ChangeStatusValue;
  readonly check: ChangeCheckValue;
  readonly conflictType?: ConflictTypeValue;
  readonly plannedEffect: 'add' | 'replace' | 'delete';
  readonly resolution?: ConflictResolutionValue;
  readonly detail?: string;
}

export interface DirectoryApplyPreview {
  readonly previewRef: string;
  readonly revision: Revision;
  readonly checkedAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
  readonly items: readonly ApplyPreviewItem[];
  readonly counts: { readonly applicable: number; readonly conflict: number; readonly unsupported: number; readonly unresolved: number };
  readonly untouchedSummary: string;
  readonly actions: Record<string, ActionAvailability>;
}

export interface DeliveryStepState {
  readonly step: DeliveryStepValue;
  readonly state: 'not_started' | 'ready' | 'in_progress' | 'succeeded' | 'failed' | 'unknown' | 'blocked';
  readonly requestKey?: RequestKey;
  readonly settledAt?: IsoDateTime;
  readonly commitSha?: string;
  readonly remoteRef?: string;
  readonly pushedSha?: string;
  readonly mrIid?: number;
  readonly mrWebUrl?: string;
  readonly items?: readonly { readonly fileId: string; readonly result: string }[];
  readonly error?: { readonly code: string; readonly message: string; readonly output?: string };
}

export interface TaskDelivery {
  readonly id: DeliveryId;
  readonly taskId: TaskId;
  readonly workspaceId?: WorkspaceId;
  readonly revision: Revision;
  readonly projection: DeliveryProjectionValue;
  readonly projectionReason?: string;
  readonly goal?: DeliveryGoalValue;
  readonly changesRevision?: Revision;
  readonly selectedFileIds: readonly string[];
  readonly remaining: { readonly unselected: number; readonly detail: string };
  readonly eligibility: ActionAvailability;
  readonly steps: readonly DeliveryStepState[];
  readonly verificationOutcome?: 'all_passed' | 'not_run' | 'failed';
  readonly taskCompletionRef?: string;
  readonly applyPreview?: DirectoryApplyPreview;
  readonly workspaceRetention?: 'retained' | 'cleaning' | 'partial' | 'cleaned';
  readonly lastUpdatedAt: IsoDateTime;
  readonly actions: Record<string, ActionAvailability>;
}

export interface WorkspaceCleanupPreview {
  readonly previewRef: string;
  readonly workspaceId: WorkspaceId;
  readonly workspaceRevision: Revision;
  readonly expiresAt: IsoDateTime;
  readonly deleteObjects: readonly { readonly kind: 'local_branch' | 'worktree_directory' | 'copy_directory' | 'internal_cache'; readonly label: string }[];
  readonly retainObjects: readonly { readonly kind: string; readonly label: string }[];
  readonly undelivered: { readonly count: number; readonly reason: string };
  readonly requiresUndeliveredAck: boolean;
  readonly blockers: readonly { readonly kind: string; readonly label: string; readonly ref?: string }[];
}

/* ------------------------------------------------------------------ */
/* Operations and receipts                                             */
/* ------------------------------------------------------------------ */

export interface OperationTarget {
  readonly projectId?: ProjectId;
  readonly taskId?: TaskId;
  readonly executionId?: ExecutionId;
  readonly ref?: string;
  readonly expectedSha?: string;
}

export interface OperationReceipt {
  readonly operation: string;
  readonly requestKey: RequestKey;
  readonly bodyHash: string;
  readonly contractVersion: string;
  readonly status: ReceiptStatusValue;
  readonly target: OperationTarget;
  readonly outcome?: Record<string, unknown>;
  readonly error?: { readonly code: string; readonly message: string; readonly output?: string };
  readonly acceptedAt: IsoDateTime;
  readonly settledAt?: IsoDateTime;
  readonly auditId: string;
}

export interface OperationRecord extends OperationReceipt {
  readonly operationKind: string;
  readonly reconcileCount: number;
  readonly lastCheckedAt?: IsoDateTime;
  readonly resultResource?: { readonly kind: 'task' | 'plan' | 'planning' | 'workspace' | 'delivery' | 'git'; readonly id: string };
}

/* ------------------------------------------------------------------ */
/* Git                                                                 */
/* ------------------------------------------------------------------ */

export interface GitConnectionStatus {
  readonly provider: GitProviderValue;
  readonly state: GitConnectionStateValue;
  readonly hostDisplayName?: string;
  readonly accountUsername?: string;
  readonly lastVerifiedAt?: IsoDateTime;
  readonly message?: string;
}

export interface GitRepo {
  readonly projectId: ProjectId;
  readonly repoId?: RepoId;
  readonly projectName: string;
  readonly gitState: RepoGitStateValue;
  readonly displayRoot?: string;
  readonly defaultBranch?: string;
  readonly remote?: { readonly name: string; readonly displayUrl: string; readonly webUrl?: string };
  readonly gitStateDetail?: string;
  readonly status?: {
    readonly head: { readonly kind: 'branch' | 'detached' | 'unborn'; readonly branch?: string; readonly sha?: string };
    readonly upstream?: { readonly ref: string; readonly ahead: number; readonly behind: number };
    readonly lastFetchAt?: IsoDateTime;
    readonly workingTree: { readonly uncommitted: number; readonly staged: number; readonly untracked: number };
    readonly isEmpty: boolean;
    readonly shallow?: { readonly depth?: number };
    readonly userOperationInProgress?: string;
  };
  readonly summary?: {
    readonly lastCommit?: GitCommitSummary;
    readonly openMrCount: number | null;
    readonly pendingFindingCount: number;
  };
  readonly gitlab: GitConnectionStateValue;
}

export interface GitPerson {
  readonly name: string;
  readonly email?: string;
  readonly initials: string;
}

export interface GitCommitSummary {
  readonly sha: string;
  readonly parents: readonly string[];
  readonly subject: string;
  readonly author: GitPerson;
  readonly authoredAt: IsoDateTime;
  readonly refs: readonly { readonly kind: 'head' | 'local' | 'remote' | 'tag'; readonly name: string }[];
  readonly review?: { readonly reviewRunId: string; readonly state: ReviewRunStateValue; readonly openCount?: number };
}

export interface GitCompareBase {
  readonly compareId: string;
  readonly kind: 'parent' | 'merge_base';
  readonly label: string;
  readonly baseSha: string;
}

export interface GitCommit extends GitCommitSummary {
  readonly body: string;
  readonly committer: GitPerson;
  readonly committedAt: IsoDateTime;
  readonly containedIn: { readonly branches: readonly string[]; readonly truncated: boolean };
  readonly stats: { readonly files: number; readonly additions: number; readonly deletions: number };
  readonly compareOptions: readonly GitCompareBase[];
}

export interface GitBranch {
  readonly name: string;
  readonly fullRef: string;
  readonly kind: 'local' | 'remote';
  readonly tipSha: string;
  readonly isCurrent: boolean;
  readonly checkedOutInUserWorktree: boolean;
  readonly upstream?: string;
  readonly vsDefault?: { readonly ahead: number; readonly behind: number };
  readonly lastCommit?: { readonly subject: string; readonly author: GitPerson; readonly authoredAt: IsoDateTime };
  readonly protected: boolean | null;
}

export interface GitMergeRequest {
  readonly iid: number;
  readonly title: string;
  readonly sourceBranch: string;
  readonly targetBranch: string;
  readonly state: 'opened' | 'merged' | 'closed' | 'locked';
  readonly hasConflicts: boolean;
  readonly draft: boolean;
  readonly author: GitPerson;
  readonly updatedAt: IsoDateTime;
  readonly webUrl: string;
  readonly pipeline?: { readonly status: string } | null;
  readonly approvals?: { readonly required: number; readonly given: number } | null;
}

export interface ReviewFinding {
  readonly findingId: FindingId;
  readonly reviewRunId: ReviewRunId;
  readonly ordinal: number;
  readonly severity: SeverityValue;
  readonly dimension: DimensionValue;
  readonly location?: {
    readonly path: string;
    readonly revision: string;
    readonly baseRevision: string;
    readonly startLine: number;
    readonly endLine: number;
    readonly side: 'old' | 'new';
  };
  readonly title: string;
  readonly detail: string;
  readonly status: FindingStatusValue;
  readonly statusReason?: string;
  readonly fix?: { readonly fixRunId: FixRunId; readonly outcome: FixOutcomeValue };
}

export interface ReviewRun {
  readonly reviewRunId: ReviewRunId;
  readonly projectId: ProjectId;
  readonly ordinal: number;
  readonly executionId: ExecutionId;
  readonly subject: { readonly commitSha: string; readonly compareBase: GitCompareBase };
  readonly dimensions: readonly DimensionValue[];
  readonly context: 'diff_only' | 'diff_and_related';
  readonly profession: { readonly professionId: string; readonly revision: string; readonly displayName: string };
  readonly state: ReviewRunStateValue;
  readonly stage?: string;
  readonly startedAt?: IsoDateTime;
  readonly endedAt?: IsoDateTime;
  readonly findings: readonly ReviewFinding[];
  readonly summary?: {
    readonly text: string;
    readonly countsBySeverity: Record<SeverityValue, number>;
    readonly countsByDimension: Partial<Record<DimensionValue, number>>;
  };
  readonly usage?: TokenUsage;
  readonly receipt: OperationReceipt;
}

export interface FixRun {
  readonly fixRunId: FixRunId;
  readonly projectId: ProjectId;
  readonly executionId: ExecutionId;
  readonly reviewRunId: ReviewRunId;
  readonly findingIds: readonly FindingId[];
  readonly base: { readonly branch: string; readonly tipSha: string; readonly reviewedSha: string; readonly commitsAfterReviewed: number };
  readonly fixBranch: string;
  readonly worktreeId: string;
  readonly profession: { readonly professionId: string; readonly revision: string; readonly displayName: string };
  readonly verifyCommand: { readonly display: string; readonly source: 'project_config' } | null;
  readonly state: FixRunStateValue;
  readonly outcomes: readonly {
    readonly findingId: FindingId;
    readonly outcome: FixOutcomeValue;
    readonly relocation: 'exact' | 'moved' | 'not_found';
    readonly reason?: string;
  }[];
  readonly changes?: { readonly files: readonly FileChange[]; readonly worktreeRevision: string };
  readonly verification?: AttemptResult['verification'];
  readonly steps: readonly DeliveryStepState[];
  readonly commitDraft?: { readonly message: string; readonly author: GitPerson };
  readonly fixRevision: Revision;
  readonly usage?: TokenUsage;
  readonly actions: Record<string, ActionAvailability>;
}

export interface PptSlide {
  readonly title: string;
  readonly bullets: readonly string[];
}

export interface PptWork {
  readonly id: string;
  readonly projectId?: ProjectId;
  readonly title: string;
  readonly topic: string;
  readonly status: PptWorkStatusValue;
  readonly outline: readonly string[];
  readonly slides: readonly PptSlide[];
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

/* ------------------------------------------------------------------ */
/* Database                                                            */
/* ------------------------------------------------------------------ */

export interface DatabaseConnection {
  readonly id: DatabaseConnectionId;
  readonly name: string;
  readonly type: DatabaseTypeValue;
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly state: DatabaseConnectionStateValue;
  readonly readOnly: boolean;
  readonly lastCheckedAt?: IsoDateTime;
  readonly message?: string;
}

export interface DatabaseProbeResult {
  readonly connectionId: DatabaseConnectionId;
  readonly state: DatabaseConnectionStateValue;
  readonly checkedAt: IsoDateTime;
  readonly serverVersion?: string;
  readonly latencyMs?: number;
  readonly message?: string;
  readonly capabilities: {
    readonly query: boolean;
    readonly explain: boolean;
    readonly schemaRead: boolean;
  };
}

export interface DatabaseQueryResult {
  readonly connectionId: DatabaseConnectionId;
  readonly columns: readonly { readonly name: string; readonly type?: string }[];
  readonly rows: readonly (readonly unknown[])[];
  readonly rowCount: number;
  readonly truncated: boolean;
  readonly durationMs: number;
}
