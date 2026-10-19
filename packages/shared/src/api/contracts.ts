import type { IsoDateTime, RequestKey, TaskId } from '../ids.ts';
import type { ErrorCodeValue } from '../errors.ts';
import type {
  DimensionValue,
  InteractionKindValue,
  InteractionStateValue,
  NodeManualAcceptanceStateValue,
  RoleCapabilityGroupValue,
  RoleResourceFileKindValue,
  RoleResourceToolKindValue,
  SeverityValue,
  TaskMethodSupportValue,
  ThemeIdValue,
} from '../domain/enums.ts';
import type { AppEventEnvelope } from '../domain/events.ts';
import type { PlanningProposal, RefineScopePreview } from '../domain/planning.ts';
import type {
  ActionAvailability,
  CatalogSnapshot,
  DatabaseConnection,
  DatabaseProbeResult,
  DatabaseQueryResult,
  DirectoryApplyPreview,
  DiffPage,
  ExecutionView,
  FileChange,
  FixRun,
  GitBranch,
  GitCommit,
  GitCommitSummary,
  GitConnectionStatus,
  GitMergeRequest,
  GitRepo,
  MethodStepDefinition,
  WorkflowMethod,
  ModelProfile,
  NodeDetail,
  OperationReceipt,
  OperationRecord,
  PlanNode,
  PlanRevision,
  TokenUsage,
  TaskAcceptance,
  PlanningPreview,
  PptWork,
  PlanningView,
  Project,
  ProjectSummary,
  RequirementInput,
  ReviewRun,
  Task,
  TaskChanges,
  TaskDelivery,
  TaskSummary,
  TaskTemplate,
  RoleDefinition,
  RoleDefinitionResolved,
  RoleImageBinding,
  RoleImageHistoryEntry,
  RolePublishCheck,
  RoleCapabilityGroupView,
  RoleResourcePermissions,
  TaskWorkspace,
  WorkspaceCleanupPreview,
} from '../domain/models.ts';
import type { AppSettings, IntegrationStatus, PublicSettings, SettingsIssue } from '../config/settings.ts';
import type { TaskLifecycleValue, TaskStageValue, ThemeMeta } from '../domain/enums.ts';

/* ------------------------------------------------------------------ */
/* Envelope                                                            */
/* ------------------------------------------------------------------ */

export interface ResponseMeta {
  readonly requestId: string;
  readonly at: IsoDateTime;
  readonly revision?: string;
}

export interface ApiEnvelope<T> {
  readonly data: T;
  readonly meta: ResponseMeta;
}

export interface ApiErrorResponse {
  readonly error: {
    readonly code: ErrorCodeValue;
    readonly message: string;
    readonly details?: Record<string, unknown>;
    readonly requestId: string;
    readonly at: IsoDateTime;
    readonly retryable: boolean;
  };
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string;
  readonly total?: number;
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

export interface CommandRequest {
  readonly requestKey: RequestKey;
  readonly expected?: Record<string, string>;
}

export interface CommandResponse<T = Record<string, unknown>> {
  readonly receipt: OperationReceipt;
  readonly resource?: T;
}

/* ------------------------------------------------------------------ */
/* Bootstrap                                                           */
/* ------------------------------------------------------------------ */

export interface BootstrapResponse {
  readonly app: {
    readonly name: string;
    readonly version: string;
    readonly nodeVersion: string;
    readonly platform: string;
    readonly startedAt: IsoDateTime;
  };
  readonly settings: PublicSettings;
  readonly themes: readonly ThemeMeta[];
  readonly catalog: CatalogSnapshot;
  readonly projects: readonly ProjectSummary[];
  readonly tasks: readonly TaskSummary[];
  readonly inbox: readonly InboxItem[];
  readonly integration: IntegrationStatus;
  readonly counts: {
    readonly activeTasks: number;
    readonly waitingUser: number;
    readonly openPlannings: number;
  };
  readonly data: { readonly dataDir: string; readonly dbPath: string; readonly jsonlPath: string };
}

export interface InboxItem {
  readonly id: string;
  readonly kind: 'planning_answer' | 'planning_review' | 'planning_reconcile' | 'delivery_confirm' | 'execution_failed';
  readonly projectId: string;
  readonly taskId: string;
  readonly taskTitle: string;
  readonly projectName: string;
  readonly title: string;
  readonly detail: string;
  readonly createdAt: IsoDateTime;
  readonly returnTo: string;
}

/* ------------------------------------------------------------------ */
/* Inbox interactions (可交互待办)                                      */
/* ------------------------------------------------------------------ */

/**
 * Honest capability snapshot of the inbox. Planning questions/review are real
 * (they are derived from stored planning rounds); permissions/policy have no
 * source in the managed OpenCode + internal MCP architecture, so they report
 * `false` with a reason instead of fabricated items.
 */
export interface InteractionCapabilitiesView {
  readonly planningQuestions: boolean;
  readonly planningReview: boolean;
  readonly permissions: boolean;
  readonly policy: boolean;
  readonly reason?: string;
}

export interface InteractionSummary {
  readonly id: string;
  readonly kind: InteractionKindValue;
  readonly state: InteractionStateValue;
  readonly title: string;
  readonly summary: string;
  readonly taskId: string;
  readonly taskTitle: string;
  readonly projectId: string;
  readonly projectName: string;
  /** Honest display label (e.g. `规划轮次 2`); not a canvas step. */
  readonly stepName: string;
  readonly roundId: string;
  readonly roundOrdinal: number;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly returnTo: string;
}

/**
 * One planning question as the server actually stores it: a single free-text
 * answer. The model has no option/multi-select/recommended-value fields, so the
 * detail exposes `degradation` and the UI must not render fake options.
 */
export interface InteractionQuestion {
  readonly id: string;
  readonly title: string;
  readonly required: boolean;
  readonly answered: boolean;
  readonly answer?: string;
  readonly answeredAt?: IsoDateTime;
  readonly affectedNodeIds: readonly string[];
  readonly inputMode: 'free_text';
}

export interface InteractionResolveAvailability {
  readonly allowed: boolean;
  readonly confirmField: 'confirmResolve';
  readonly reason?: string;
  readonly reasonCode?: string;
}

export interface InteractionDetail extends InteractionSummary {
  readonly source: {
    readonly type: 'planning_round' | 'planning_candidate';
    readonly roundId: string;
    readonly roundOrdinal: number;
    readonly planRevisionId?: string;
    readonly nodeIds?: readonly string[];
  };
  readonly questions: readonly InteractionQuestion[];
  readonly candidate?: {
    readonly planRevisionId: string;
    readonly summary: string;
    readonly validationState: 'passed' | 'failed';
    readonly diffCount: number;
  };
  readonly degradation: {
    readonly options: false;
    readonly multiSelect: false;
    readonly recommendedValue: false;
    readonly reason: string;
  };
  readonly resolve: InteractionResolveAvailability;
  readonly unknown?: { readonly message: string };
  readonly resolvedAt?: IsoDateTime;
  readonly requirementRevision?: number;
}

export interface InteractionListResponse {
  readonly items: readonly InteractionSummary[];
  readonly counts: { readonly open: number; readonly unknown: number };
  readonly capabilities: InteractionCapabilitiesView;
}

export interface InteractionResolveAnswer {
  readonly questionId: string;
  readonly values?: readonly string[];
  readonly other?: string;
}

export interface InteractionResolveRequest extends CommandRequest {
  readonly answers: readonly InteractionResolveAnswer[];
  readonly confirmResolve: true;
}

export interface InteractionResolveResult {
  readonly interaction: InteractionDetail;
  readonly planning: PlanningView;
  readonly requirementRevision: number;
}

export type InteractionResolveResponse = CommandResponse<InteractionResolveResult>;

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

export interface CreateProjectRequest {
  readonly requestKey: RequestKey;
  readonly name: string;
  readonly rootPath: string;
  readonly description?: string;
}

export interface UpdateProjectRequest {
  readonly requestKey: RequestKey;
  readonly name?: string;
  readonly description?: string;
  readonly settings?: {
    readonly testCommand?: string;
    readonly gitProvider?: 'github' | 'gitlab';
    readonly defaultMethodId?: string;
    readonly docPaths?: readonly string[];
    readonly gitlab?: {
      readonly inheritGlobal: boolean;
      readonly baseUrl?: string;
      readonly projectPath?: string;
      readonly enabled?: boolean;
    };
  };
  readonly archived?: boolean;
  readonly expected?: { readonly updatedAt?: string };
}

export const PROJECT_CHARTER_STATUSES = ['none', 'draft', 'generating', 'written', 'unknown'] as const;
export type ProjectCharterStatusValue = (typeof PROJECT_CHARTER_STATUSES)[number];

export interface ProjectCharterDraft {
  readonly version: number;
  readonly content: string;
  readonly source: 'manual' | 'model' | 'existing_file';
  readonly savedAt: IsoDateTime;
}

export interface ProjectCharterVersion {
  readonly version: number;
  readonly status: 'draft' | 'written';
  readonly source: 'manual' | 'model' | 'existing_file';
  readonly savedAt: IsoDateTime;
  readonly writtenAt?: IsoDateTime;
  readonly path?: string;
}

export interface ProjectCharterView {
  readonly projectId: string;
  readonly status: ProjectCharterStatusValue;
  readonly draft?: ProjectCharterDraft;
  readonly written?: { readonly version: number; readonly path: string; readonly writtenAt: IsoDateTime };
  readonly current: { readonly path: 'AGENTS.md'; readonly exists: boolean; readonly content?: string; readonly readError?: string };
  readonly versions: readonly ProjectCharterVersion[];
  /** A previous write was interrupted; re-read the file, never auto-retry. */
  readonly needsReconcile: boolean;
  readonly capabilities: {
    readonly generate: ActionAvailability;
    readonly edit: ActionAvailability;
    readonly confirmWrite: ActionAvailability;
  };
}

export interface ProjectCharterResponse {
  readonly charter: ProjectCharterView;
}

export interface ProjectCharterGenerateRequest extends CommandRequest {
  readonly confirmGenerate: true;
}

export interface ProjectCharterUpdateRequest extends CommandRequest {
  readonly content: string;
  readonly expectedVersion?: number;
}

export interface ProjectCharterConfirmRequest extends CommandRequest {
  readonly confirmWrite: true;
  readonly expectedVersion?: number;
}

export interface ProjectDetailResponse {
  readonly project: Project;
  readonly repos?: GitRepo;
  readonly tasks: readonly TaskSummary[];
}

/* ------------------------------------------------------------------ */
/* Tasks                                                               */
/* ------------------------------------------------------------------ */

export interface ListTasksQuery {
  readonly projectId?: string;
  readonly stage?: string;
  readonly attention?: string;
  readonly planning?: boolean;
  readonly q?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface CreateTaskRequest {
  readonly requestKey: RequestKey;
  readonly projectId: string;
  readonly title: string;
  readonly requirementText: string;
  readonly methodId: string;
  readonly template?: { readonly templateId: string; readonly parameters: Record<string, string> };
}

export interface UpdateDraftRequest {
  readonly requestKey: RequestKey;
  readonly title?: string;
  readonly requirementText?: string;
  readonly supplementText?: string;
  readonly expected?: { readonly requirementRevision?: number };
}

export interface NodeSkipRequest extends CommandRequest {
  readonly nodeId: string;
  readonly confirmSkip: true;
}

export interface KnowledgeSource {
  readonly path: string;
  readonly bytes: number;
  readonly modifiedAt: IsoDateTime;
}

export interface KnowledgeAskRequest extends CommandRequest {
  readonly projectId: string;
  readonly question: string;
  readonly conversationId?: string;
  /** Inventory-relative paths selected for this round; omitted means all current sources. */
  readonly sourcePaths?: readonly string[];
  readonly continueFromRequestKey?: string;
}

export interface KnowledgeStopRequest extends CommandRequest { readonly projectId: string }
export interface KnowledgeRunProgress {
  readonly requestKey: string;
  readonly projectId: string;
  readonly conversationId: string;
  readonly question: string;
  readonly model: string;
  readonly status: import('../domain/enums.ts').KnowledgeRunStatusValue;
  readonly startedAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly answer: string;
  readonly sources: NonNullable<KnowledgeAskResponse['sources']>;
  readonly sessionId?: string;
  readonly stopRequestKey?: string;
  readonly error?: string;
}

export interface KnowledgeCitation {
  readonly path: string;
  readonly line: number;
  readonly snippet?: string;
}

export interface KnowledgeAskResponse {
  readonly projectId: string;
  readonly question: string;
  readonly answer: string;
  readonly status?: 'completed' | 'stopped';
  readonly requestKey?: string;
  readonly citations: readonly KnowledgeCitation[];
  readonly model: string;
  readonly generatedAt: IsoDateTime;
  readonly conversationId: string;
  /** Actual frozen input selection and bounded excerpts used for this answer. */
  readonly sources?: {
    readonly selectedPaths: readonly string[];
    readonly readPaths: readonly string[];
    readonly truncatedPaths: readonly string[];
  };
  readonly usage?: TokenUsage;
  /** Absent for legacy answers recorded before steps were observed. */
  readonly steps?: readonly KnowledgeStep[];
  /** Omitted entirely when the run had no real tool parts. */
  readonly toolActivity?: readonly KnowledgeToolActivity[];
}

export interface KnowledgeHistoryEntry extends KnowledgeAskResponse {
  readonly id: string;
  readonly runStatus?: import('../domain/enums.ts').KnowledgeRunStatusValue;
}

export interface KnowledgeHistoryResponse {
  readonly entries: readonly KnowledgeHistoryEntry[];
}

/* Knowledge research timeline: every field comes from the real ask execution
 * (document reads, assistant message times, real tool parts, citation checks).
 * No fixed/fabricated steps are ever emitted. */

export type KnowledgeStepKind = 'retrieve' | 'model' | 'tool' | 'validate';
export type KnowledgeStepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown';

export interface KnowledgeStep {
  /** Real event id (a tool callID for tool steps, an observed id otherwise). */
  readonly id: string;
  readonly kind: KnowledgeStepKind;
  /** Observed action label, e.g. "读取 3 份文档" or the real tool name. */
  readonly label: string;
  readonly status: KnowledgeStepStatus;
  readonly startedAt: IsoDateTime;
  readonly endedAt?: IsoDateTime;
  /** Only when both real timestamps are available. */
  readonly durationMs?: number;
  readonly detail?: string;
}

export type KnowledgeToolStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown';

export interface KnowledgeToolActivity {
  readonly name: string;
  readonly status: KnowledgeToolStatus;
  readonly summary?: string;
  readonly callId?: string;
  readonly startedAt?: IsoDateTime;
  readonly endedAt?: IsoDateTime;
}

export interface KnowledgeSourceContentResponse {
  readonly projectId: string;
  readonly path: string;
  readonly content: string;
  readonly bytes: number;
}

export interface KnowledgeSearchMatch {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

export interface KnowledgeSearchResponse {
  readonly projectId: string;
  readonly query: string;
  readonly matches: readonly KnowledgeSearchMatch[];
}

export interface KnowledgeSourcesResponse {
  readonly projectId: string;
  readonly sources: readonly KnowledgeSource[];
}

export interface SkillInfo {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly path: string;
  readonly source: string;
}

export interface SkillSourceResponse {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly lines: readonly { readonly number: number; readonly text: string }[];
}

export interface SkillsResponse {
  readonly skills: readonly SkillInfo[];
}

export interface InsightsResponse {
  readonly generatedAt: IsoDateTime;
  readonly tasks: { readonly total: number; readonly active: number; readonly completed: number; readonly cancelled: number; readonly attention: number };
  readonly planning: {
    readonly rounds: number;
    readonly completed: number;
    readonly failed: number;
    readonly running: number;
    readonly costKnown: number;
    readonly budgetUnknownRounds: number;
    readonly tokens: { readonly input: number; readonly output: number; readonly reasoning: number; readonly cache: number; readonly total: number };
    readonly currency: string;
  };
  readonly executions: { readonly total: number; readonly running: number; readonly failed: number; readonly attempts: number; readonly tokens: { readonly input: number; readonly output: number; readonly reasoning: number; readonly cache: number; readonly total: number } };
  readonly reviews: { readonly total: number; readonly completed: number; readonly failed: number; readonly openFindings: number; readonly tokens: { readonly input: number; readonly output: number; readonly total: number } };
  readonly fixes: { readonly total: number; readonly ready: number; readonly discarded: number; readonly tokens: { readonly input: number; readonly output: number; readonly total: number } };
  readonly deliveries: { readonly delivered: number; readonly blocked: number; readonly inProgress: number };
}

/* ------------------------------------------------------------------ */
/* Task canvas extras (freeze / audit / snapshot review / run content) */
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

export interface TaskPlanFreezeRequest extends CommandRequest {
  readonly confirmFreeze: true;
  readonly note?: string;
  readonly planRevisionId?: string;
}

export interface TaskPlanFreezeResponse {
  readonly freeze: FrozenPlanSnapshot;
  readonly replayed: boolean;
}

export interface TaskPlanFreezesResponse {
  readonly items: readonly FrozenPlanSnapshot[];
  readonly latest?: FrozenPlanSnapshot;
}

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

export interface TaskAuditPage {
  readonly taskId: string;
  readonly items: readonly TaskAuditEntry[];
  readonly total: number;
  readonly limit: number;
  readonly cursor: string;
  readonly nextCursor?: string;
}

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
  readonly planRevisionNumber?: number;
  readonly planStatus?: string;
  readonly template?: { readonly id: string; readonly version: number; readonly name: string };
  readonly mode: 'full' | 'incremental' | 'unknown';
  readonly depth: 'full' | 'lightweight' | 'unknown';
  readonly modeSource: 'unavailable';
  readonly baselineSha?: string;
  readonly targetSha?: string;
  readonly targetShaSource: 'delivery' | 'none';
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
  readonly applicable: boolean;
  readonly reason?: string;
  readonly readOnly: true;
  readonly note: string;
  readonly scope?: SnapshotReviewScope;
  readonly progress?: SnapshotReviewProgress;
  readonly batches?: SnapshotReviewBatchesPage;
  readonly partialReport: SnapshotPartialReport;
}

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

export interface TaskAcceptanceRequest extends CommandRequest {
  readonly verdict: 'accepted' | 'rejected';
  readonly note?: string;
  readonly confirmDecide: true;
}

export interface TaskAcceptanceResponse {
  readonly acceptance?: TaskAcceptance;
}

export interface InsightsTaskAcceptanceResponse {
  readonly items: readonly { readonly taskId: string; readonly passed: number; readonly failed: number; readonly total: number; readonly verdict?: 'accepted' | 'rejected' }[];
}

export interface InsightsTaskQualityResponse {
  readonly items: readonly { readonly taskId: string; readonly reviews: number; readonly openFindings: number }[];
}

export interface InsightsTaskUsageResponse {
  readonly usage: readonly { readonly taskId: string; readonly tokens: number }[];
}

export interface PptWorksResponse {
  readonly works: readonly PptWork[];
}

export interface PptWorkExportResponse {
  readonly filename: string;
  readonly content: string;
}

export interface PptWorkGenerateContentRequest extends CommandRequest {
  readonly confirmGenerate: true;
}

export interface PptAttachmentRequest extends CommandRequest {
  readonly name: string;
  readonly content: string;
  readonly kind?: 'text' | 'image';
  readonly confirmAttach: true;
}

export interface PptWorkUpdateRequest extends CommandRequest {
  readonly title?: string;
  readonly topic?: string;
  readonly outline?: readonly string[];
  readonly theme?: ThemeIdValue;
  readonly confirmUpdate: true;
}

export interface PptWorkGenerateRequest extends CommandRequest {
  readonly confirmGenerate: true;
}

export interface PptWorkCreateRequest extends CommandRequest {
  readonly projectId?: string;
  readonly title: string;
  readonly topic: string;
  readonly theme?: ThemeIdValue;
  readonly confirmCreate: true;
}

export interface OpenCodeDetectResponse {
  readonly current: string;
  readonly scannedAt: IsoDateTime;
  readonly candidates: readonly { readonly path: string; readonly version?: string; readonly source: 'current' | 'path' | 'versions-dir' }[];
}

export interface TemplateDetailResponse {
  readonly template: TaskTemplate;
  readonly taskCount: number;
}

export interface TemplateTasksResponse {
  readonly tasks: readonly TaskSummary[];
}

export interface TaskDetailResponse {
  readonly task: Task;
  readonly project: ProjectSummary;
  readonly plan?: PlanRevision;
  readonly planning?: PlanningView;
  readonly execution?: ExecutionView;
  readonly workspace?: TaskWorkspace;
  readonly delivery?: TaskDelivery;
  readonly capabilities: Record<string, ActionAvailability>;
}

export const RECOVERY_MODES = ['from_failed_stage', 'all_stages', 'verify_only'] as const;
export type RecoveryModeValue = (typeof RECOVERY_MODES)[number];

export interface TemplateUpdateRequest extends CommandRequest {
  readonly template: TaskTemplate;
  readonly confirmUpdate: true;
}

/**
 * `DELETE /api/catalog/templates/:id` archives a custom template. It is a
 * mutating command, so it answers with a receipt; the remaining custom
 * templates are flattened as `templates` for clients that read the list at the
 * top level.
 */
export interface TemplateArchiveRequest extends CommandRequest {
  readonly confirmArchive: true;
}

export interface TemplateArchiveResponse extends CommandResponse<{ readonly templates: readonly TaskTemplate[] }> {
  readonly templates: readonly TaskTemplate[];
}

export interface TemplateImportRequest extends CommandRequest {
  readonly template: TaskTemplate;
  readonly confirmImport: true;
}

/** Editable inputs for the extended role tabs (ids only; labels/defaults are server-owned). */
export interface RoleCapabilityGroupInput {
  readonly id: RoleCapabilityGroupValue;
  readonly items: readonly { readonly id: string; readonly enabled: boolean }[];
}

export interface RoleResourcePermissionsInput {
  readonly tools: readonly { readonly kind: RoleResourceToolKindValue; readonly name: string; readonly source?: string }[];
  readonly files: readonly { readonly kind: RoleResourceFileKindValue; readonly path: string; readonly workspace?: string }[];
  readonly commands: readonly { readonly argv: readonly string[]; readonly workspace?: string }[];
  readonly resources: readonly { readonly id: string }[];
}

export interface RoleImageInput {
  readonly id: string;
  readonly kind: 'initials' | 'emoji';
  readonly value: string;
  readonly label?: string;
}

/* ------------------------------------------------------------------ */
/* Workflow (method) catalog                                          */
/* ------------------------------------------------------------------ */

/** Editor draft for a workflow method (built-in methods are read-only). */
export interface MethodDraftDefinition {
  readonly name: string;
  readonly description?: string;
  readonly support?: TaskMethodSupportValue;
  readonly requiredSteps: readonly MethodStepDefinition[];
  readonly refinableGroups?: readonly string[];
  readonly planningStrategy?: { readonly id: string; readonly version: string; readonly roleId: string };
}

export interface MethodValidationProblem {
  readonly code: string;
  readonly message: string;
  readonly field?: 'name' | 'description' | 'support' | 'requiredSteps' | 'refinableGroups' | 'planningStrategy';
  readonly stepKey?: string;
}

export interface MethodValidationCheck {
  readonly id: string;
  readonly label: string;
  readonly state: 'passed' | 'failed';
}

/** Non-mutating `POST /api/workflows/validate` result (no requestKey). */
export interface MethodValidationResult {
  readonly ok: boolean;
  readonly problems: readonly MethodValidationProblem[];
  readonly checks: readonly MethodValidationCheck[];
}

export interface MethodCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly source: 'builtin' | 'custom';
  readonly support: TaskMethodSupportValue;
  readonly version: number;
  readonly revision: string;
  readonly stepCount: number;
  readonly archived: boolean;
  readonly updatedAt?: IsoDateTime;
  readonly copiedFrom?: { readonly id: string; readonly version: number };
}

export interface MethodCatalogDetail extends MethodCatalogEntry {
  readonly requiredSteps: readonly MethodStepDefinition[];
  readonly refinableGroups: readonly string[];
  readonly planningStrategy?: { readonly id: string; readonly version: string; readonly roleId: string };
}

export interface MethodCatalogListResponse {
  readonly items: readonly MethodCatalogEntry[];
}

export interface MethodDetailResponse {
  readonly method: MethodCatalogDetail;
}

export interface MethodMutationResponse {
  readonly method: MethodCatalogDetail;
}

export interface MethodInstantiateResponse {
  readonly method: WorkflowMethod;
  readonly source: 'builtin' | 'custom';
  readonly customVersion?: number;
  /** Deep copy: editing the catalog later never changes an instantiated method. */
  readonly frozen: boolean;
}

export interface MethodCreateRequest extends CommandRequest {
  readonly draft: MethodDraftDefinition;
  readonly confirmCreate: true;
}

export interface MethodCopyRequest extends CommandRequest {
  readonly name?: string;
  readonly confirmCopy: true;
}

export interface MethodSaveRequest extends CommandRequest {
  readonly method: MethodDraftDefinition;
  readonly expectedVersion: number;
  readonly confirmSave: true;
}

export interface MethodArchiveRequest extends CommandRequest {
  readonly confirmArchive: true;
}

export interface MethodValidateRequest {
  readonly draft: MethodDraftDefinition;
  /** Editing an existing method keeps its delivery steps during save-mode validation. */
  readonly id?: string;
}

export interface RoleSaveRequest extends CommandRequest {
  readonly roleId?: string;
  readonly baseId?: string;
  readonly name: string;
  readonly purpose: string;
  readonly responsibilities: readonly string[];
  readonly instructions?: string;
  readonly model?: string;
  readonly maxRuntimeMinutes?: number;
  readonly capabilityGroups?: readonly RoleCapabilityGroupInput[];
  readonly resourcePermissions?: RoleResourcePermissionsInput;
  /** `null` clears the image binding; omitted keeps the previous/draft value. */
  readonly image?: RoleImageInput | null;
  readonly confirmSave: true;
}

export interface RolePublishRequest extends CommandRequest {
  readonly confirmPublish: true;
}

export interface RoleArchiveRequest extends CommandRequest {
  readonly confirmArchive: true;
}

export interface RoleCatalogEntry extends RoleDefinition {
  readonly status: 'published' | 'draft';
  readonly baseId?: string;
  readonly hasDraft: boolean;
  readonly updatedAt?: IsoDateTime;
  /**
   * Full editable draft (all four tabs) when `hasDraft` is true. Top-level
   * fields stay the published/effective content so callers can diff draft vs
   * published; a never-published custom role exposes its draft at both levels.
   */
  readonly draft?: RoleDefinitionResolved;
  /** Published revisions' images; an entry without `image` is a placeholder. */
  readonly imageHistory?: readonly RoleImageHistoryEntry[];
  readonly publishChecks?: readonly RolePublishCheck[];
}

export interface RoleRevisionSnapshot {
  readonly revision: string;
  readonly name: string;
  readonly purpose: string;
  readonly responsibilities: readonly string[];
  readonly publishedAt: IsoDateTime;
  readonly instructions?: string;
  readonly model?: string;
  readonly maxRuntimeMinutes?: number;
  readonly capabilityGroups?: readonly RoleCapabilityGroupView[];
  readonly resourcePermissions?: RoleResourcePermissions;
  readonly image?: RoleImageBinding;
}

export interface RoleValidateResponse {
  readonly roleId: string;
  readonly hasDraft: boolean;
  readonly draftRevision: string;
  readonly publishedRevision?: string;
  readonly canPublish: boolean;
  readonly checks: readonly RolePublishCheck[];
  /** Present when there is nothing to publish (no draft). */
  readonly reason?: string;
}

export interface RoleRestoreRequest extends CommandRequest {
  readonly confirmRestore: true;
}

export interface RoleHistoryResponse {
  readonly roleId: string;
  readonly history: readonly RoleRevisionSnapshot[];
}

export interface RoleCatalogResponse {
  readonly roles: readonly RoleCatalogEntry[];
  readonly actions: Record<string, ActionAvailability>;
}

export interface RecoveryCreateRequest extends CommandRequest {
  readonly mode: RecoveryModeValue;
  readonly confirmCreate: true;
  readonly note?: string;
}

export interface RecoveryRecord {
  readonly taskId: TaskId;
  readonly parentTaskId: TaskId;
  readonly mode: RecoveryModeValue;
  readonly title: string;
  readonly stage: TaskStageValue;
  readonly lifecycle: TaskLifecycleValue;
  readonly createdAt: IsoDateTime;
}

export interface RecoveryCreateResponse {
  readonly task: Task;
  readonly recovery: RecoveryRecord;
}

export interface RecoveryHistoryResponse {
  readonly recoveries: readonly RecoveryRecord[];
}

export interface RequirementResponse {
  readonly taskId: string;
  readonly requirement: RequirementInput;
  readonly method: { readonly id: string; readonly name: string; readonly revision: string; readonly support: string; readonly steps: readonly MethodStepDefinition[]; readonly refinableGroups: readonly string[] };
}

/* ------------------------------------------------------------------ */
/* Planning                                                            */
/* ------------------------------------------------------------------ */

export interface PlanningPreviewRequest {
  readonly roundOrdinal?: number;
  readonly previousRoundId?: string;
}

export interface PlanningStartRequest extends CommandRequest {
  readonly previewId: string;
  readonly confirmModelDispatch: true;
  readonly sourceInputRevision: number;
  /** PE37 S2: required when the preview came from refine-preview. */
  readonly scope?: { readonly groupRef: string };
}

/** PE37 S2 read-only refine preview request (no requestKey: nothing changes). */
export interface PlanningRefinePreviewRequest {
  readonly groupRef: string;
}

export interface PlanningProposalResponse {
  readonly proposal: PlanningProposal;
}

export interface PlanningRefinePreviewResponse {
  readonly preview: RefineScopePreview;
  readonly taskId: string;
}

export interface PlanningStopRequest extends CommandRequest {
  readonly roundId: string;
  readonly confirmStop: true;
}

export interface PlanningReconcileRequest {
  readonly roundId: string;
}

export interface PlanningApplyRequest extends CommandRequest {
  readonly roundId: string;
  readonly candidatePlanRevisionId: string;
  readonly acceptedDecisionIds: readonly string[];
  readonly confirmApply: true;
  readonly expectedPlanRevisionNumber?: number;
}

export interface PlanningRejectRequest extends CommandRequest {
  readonly roundId: string;
  readonly reason: string;
  readonly confirmReject: true;
}

export interface SaveAnswerRequest extends CommandRequest {
  readonly roundId: string;
  readonly answers: readonly { readonly questionId: string; readonly answer: string }[];
}

export interface PlanningResponse {
  readonly taskId: string;
  readonly planning: PlanningView;
  readonly plan?: PlanRevision;
}

export interface PlanningPreviewResponse {
  readonly preview: PlanningPreview;
  readonly taskId: string;
  readonly blockers: readonly { readonly code: string; readonly message: string; readonly goTo?: string }[];
}

export interface PlanningRecordQuery {
  readonly roundId?: string;
  readonly afterSeq?: number;
  readonly limit?: number;
}

export interface PlanningRecordResponse {
  readonly taskId: string;
  readonly roundId: string;
  readonly fragments: readonly {
    readonly seq: number;
    readonly fragmentId: string;
    readonly category: string;
    readonly at?: IsoDateTime;
    readonly text?: string;
    readonly blockId?: string;
    readonly toolCallRef?: { readonly callId: string; readonly status: string; readonly source: string };
  }[];
  readonly nextAfterSeq?: number;
  readonly gaps: readonly { readonly fromSeq: number; readonly toSeq: number; readonly reason: string }[];
  readonly terminal: boolean;
}

/* ------------------------------------------------------------------ */
/* Plan                                                                */
/* ------------------------------------------------------------------ */

export interface UseSkeletonRequest extends CommandRequest {
  readonly confirmUseSkeleton: true;
}

export interface ConfirmPlanRequest extends CommandRequest {
  readonly planRevisionId: string;
  readonly expectedRevisionNumber: number;
  readonly confirmPlan: true;
}

export interface UseTemplateRequest extends CommandRequest {
  readonly confirmUseTemplate: true;
}

export interface EditBeginRequest extends CommandRequest {
  readonly planRevisionId: string;
  readonly confirmPause: true;
}

export interface EditSaveRequest extends CommandRequest {
  readonly editSessionId: string;
  readonly changes: readonly {
    readonly nodeId: string;
    readonly title?: string;
    readonly prerequisites?: readonly string[];
    readonly acceptance?: readonly string[];
  }[];
  readonly expectedPlanRevisionNumber: number;
}

export interface EditFinishRequest extends CommandRequest {
  readonly editSessionId: string;
  readonly continueExecution: boolean;
}

/**
 * Give up an edit session without saving: the local draft is discarded, the
 * last confirmed plan revision stays authoritative and the execution returns to
 * its pre-edit auto-advance setting. Only sessions that have not produced an
 * unconfirmed plan revision (requesting_pause / editing / conflict) can be
 * abandoned.
 */
export interface PlanEditAbandonRequest extends CommandRequest {
  readonly editSessionId: string;
  readonly confirmAbandon: true;
}

export type PlanEditAbandonResponse = CommandResponse<PlanResponse>;

export interface PlanResponse {
  readonly taskId: string;
  readonly plan?: PlanRevision;
  readonly planHistory: readonly { readonly id: string; readonly revisionNumber: number; readonly status: string; readonly createdAt: IsoDateTime; readonly confirmedAt?: IsoDateTime }[];
  readonly editSession?: ExecutionView['editSession'];
  readonly actions: Record<string, ActionAvailability>;
}

export interface NodeEditRequest extends CommandRequest {
  readonly nodeId: string;
  readonly title?: string;
  readonly prerequisites?: readonly string[];
  readonly acceptance?: readonly string[];
  readonly expectedPlanRevisionNumber: number;
}

/* ------------------------------------------------------------------ */
/* Workspace                                                           */
/* ------------------------------------------------------------------ */

export interface WorkspaceResponse {
  readonly taskId: string;
  readonly workspace?: TaskWorkspace;
  readonly changesRevision?: string;
  readonly actions: Record<string, ActionAvailability>;
}

export interface PrepareWorkspaceRequest extends CommandRequest {
  readonly expectedPlanRevisionNumber: number;
  readonly expectedBaseRef?: string;
  readonly expectedBaseTip?: string;
  readonly baselineSelectionRef?: string;
  readonly confirmPrepare: true;
}

export interface ChangesResponse {
  readonly changes: TaskChanges;
  readonly files: readonly FileChange[];
}

export interface CleanupPreviewResponse {
  readonly preview: WorkspaceCleanupPreview;
}

/* ------------------------------------------------------------------ */
/* Execution                                                           */
/* ------------------------------------------------------------------ */

export interface ExecutionCommandRequest extends CommandRequest {
  readonly expectedStatus?: string;
  readonly nodeIds?: readonly string[];
  readonly confirm?: boolean;
}

/** Toggle the real "自动节点推进" switch (design v4 C01/C04, AD05). */
export interface ExecutionAutoAdvanceRequest extends CommandRequest {
  readonly autoAdvance: boolean;
  readonly confirmChange: true;
}

export type ExecutionAutoAdvanceResponse = CommandResponse<ExecutionResponse>;

/**
 * Manual advance while auto-advance is off. Without `nodeId` every step whose
 * predecessors are all accepted is released; with `nodeId` only that step's
 * direct successors are released. Releasing never cascades further in the same
 * call; parallel joins wait until all predecessors are succeeded/skipped.
 */
export interface ExecutionAdvanceRequest extends CommandRequest {
  readonly nodeId?: string;
  readonly confirmAdvance: true;
}

export type ExecutionAdvanceResponse = CommandResponse<ExecutionResponse>;

export interface ExecutionResponse {
  readonly execution: ExecutionView;
  readonly workspace?: TaskWorkspace;
  readonly actions: Record<string, ActionAvailability>;
}

/** Human verdict recorded on one succeeded node (audit fact, never a node status rewrite). */
export interface NodeAcceptanceView {
  readonly nodeId: string;
  readonly state: NodeManualAcceptanceStateValue;
  readonly verdictAt?: IsoDateTime;
  readonly note?: string;
  readonly requestKey?: RequestKey;
}

/**
 * `NodeDetail` plus the persisted manual-acceptance fact. `acceptance` is
 * present only for `succeeded` nodes; `pending` means "completed, waiting for
 * the human verdict". Accepting/rejecting never rewrites the execution result.
 */
export type NodeDetailResponse = NodeDetail & { readonly acceptance?: NodeAcceptanceView };

export interface NodeResponse {
  readonly node: NodeDetailResponse;
}

export interface NodeAcceptRequest extends CommandRequest {
  readonly confirmAccept: true;
  readonly note?: string;
}

export interface NodeRejectRequest extends CommandRequest {
  readonly confirmReject: true;
  /** Why the node is sent back; required so the verdict is actionable. */
  readonly note: string;
}

export interface NodeOutputQuery {
  readonly attemptId?: string;
  readonly afterSeq?: number;
  readonly limit?: number;
}

/* ------------------------------------------------------------------ */
/* Delivery                                                            */
/* ------------------------------------------------------------------ */

export interface DeliverySelectRequest extends CommandRequest {
  readonly goal: 'local_commit' | 'push_branch' | 'create_merge_request' | 'apply_to_original';
  readonly fileIds: readonly string[];
  readonly changesRevision: string;
  readonly expectedDeliveryRevision?: string;
}

export interface DeliveryCommitRequest extends CommandRequest {
  readonly fileIds: readonly string[];
  readonly message: string;
  readonly expectedChangesRevision: string;
  readonly expectedBranchHead: string;
  readonly confirmCommit: true;
}

export interface DeliveryPushRequest extends CommandRequest {
  readonly expectedLocalSha: string;
  readonly remoteBranchName: string;
  readonly expectRemote: 'absent';
  readonly confirmPush: true;
}

export interface DeliveryMergeRequestRequest extends CommandRequest {
  readonly sourceRef: string;
  readonly pushedSha: string;
  readonly targetBranch: string;
  readonly expectedTargetTip: string;
  readonly title: string;
  readonly description: string;
  readonly confirmMergeRequest: true;
}

export interface DeliveryMergeRequest extends CommandRequest {
  readonly targetBranch: string;
  readonly expectedTargetSha: string;
  readonly sourceSha: string;
  readonly message: string;
  readonly strategy: 'no_ff' | 'ff_only';
  readonly confirmMerge: true;
}

export interface DeliveryApplyRequest extends CommandRequest {
  readonly previewRef: string;
  readonly previewRevision: string;
  readonly resolutions: readonly { readonly fileId: string; readonly resolution: 'keep_original' | 'take_task' | 'manual_then_recheck' | 'exclude' }[];
  readonly confirmApply: true;
}

export interface DeliveryResponse {
  readonly delivery: TaskDelivery;
  readonly changes?: TaskChanges;
  readonly actions: Record<string, ActionAvailability>;
}

/* ------------------------------------------------------------------ */
/* Node attempts                                                       */
/* ------------------------------------------------------------------ */

export interface AttemptListResponse {
  readonly taskId: string;
  readonly nodeId: string;
  readonly attempts: readonly {
    readonly attemptId: string;
    readonly ordinal: number;
    readonly status: string;
    readonly isCurrent: boolean;
    readonly startedAt?: IsoDateTime;
    readonly endedAt?: IsoDateTime;
    readonly reasonSummary?: string;
  }[];
}

/* ------------------------------------------------------------------ */
/* Git                                                                 */
/* ------------------------------------------------------------------ */

export interface DirectoryListingResponse {
  readonly path: string;
  readonly name: string;
  readonly parent?: string;
  readonly home: string;
  readonly entries: readonly { readonly name: string; readonly path: string; readonly isGit: boolean }[];
  readonly truncated: boolean;
}

export interface GitOverviewResponse {
  readonly connection: GitConnectionStatus;
  readonly repos: readonly GitRepo[];
  readonly capability: ActionAvailability;
}

export interface GitRepoResponse {
  readonly repo: GitRepo;
  readonly projectId: string;
}

export interface GitCommitsResponse {
  readonly commits: readonly GitCommitSummary[];
  readonly nextCursor?: string;
  readonly resolvedTipSha?: string;
  readonly shallowBoundaryReached?: boolean;
}

export interface GitCommitResponse {
  readonly commit: GitCommit;
}

export interface GitCommitFilesResponse {
  readonly files: readonly FileChange[];
  readonly truncated: boolean;
  readonly reviewBadges: readonly { readonly fileId: string; readonly findingCount: number }[];
}

export interface GitDiffResponse {
  readonly diff: DiffPage;
}

export interface GitBranchesResponse {
  readonly branches: readonly GitBranch[];
}

export interface GitMergeRequestsResponse {
  readonly mergeRequests: readonly GitMergeRequest[];
  readonly nextCursor?: string;
}

export interface GitFetchRequest extends CommandRequest {
  readonly projectId: string;
  readonly remote?: string;
}

/**
 * `POST /api/git/repos/:projectId/fetch` now answers with the standard command
 * envelope; `resource.fetchedAt` is the real timestamp reported by Git.
 */
export interface GitFetchResponse extends CommandResponse<{ readonly fetchedAt: string; readonly remote: string }> {}

export interface ReviewStartRequest extends CommandRequest {
  readonly projectId: string;
  readonly sha: string;
  readonly compareId: string;
  readonly dimensions: readonly string[];
  readonly context: 'diff_only' | 'diff_and_related';
  readonly professionId: string;
  readonly professionRevision: string;
}

export interface ReviewFindingSummary {
  readonly severity: SeverityValue;
  readonly dimension: DimensionValue;
  readonly title: string;
  readonly path?: string;
  readonly line?: number;
}

export interface ReviewCompareResponse {
  readonly base: { readonly reviewRunId: string; readonly commitSha: string };
  readonly target: { readonly reviewRunId: string; readonly commitSha: string };
  readonly resolved: readonly ReviewFindingSummary[];
  readonly introduced: readonly ReviewFindingSummary[];
  readonly persisting: readonly ReviewFindingSummary[];
}

export interface ReviewResponse {
  readonly review: ReviewRun;
}

export interface ReviewFindingUpdateRequest extends CommandRequest {
  readonly projectId: string;
  readonly findingId: string;
  readonly status: 'accepted' | 'dismissed' | 'false_positive' | 'open';
  readonly reason?: string;
  readonly expectedStatusRevision?: string;
}

export interface FixStartRequest extends CommandRequest {
  readonly projectId: string;
  readonly reviewRunId: string;
  readonly findingIds: readonly string[];
  readonly baseBranch: string;
  readonly expectedBaseTip: string;
  readonly professionId: string;
  readonly professionRevision: string;
}

export interface FixResponse {
  readonly fix: FixRun;
}

export interface FixFileRevertRequest extends CommandRequest {
  readonly projectId: string;
  readonly fixRunId: string;
  readonly fileId: string;
  readonly expectedFixRevision: string;
}

export interface FixCommitRequest extends CommandRequest {
  readonly projectId: string;
  readonly fixRunId: string;
  readonly message: string;
  readonly fileIds: readonly string[];
  readonly expectedFixRevision: string;
  readonly confirmVerifyFailed?: boolean;
}

export interface FixPushRequest extends CommandRequest {
  readonly projectId: string;
  readonly fixRunId: string;
  readonly expectedLocalSha: string;
}

export interface FixMergeRequest extends CommandRequest {
  readonly projectId: string;
  readonly fixRunId: string;
  readonly expectedBaseTip: string;
  readonly message?: string;
  readonly strategy?: 'no_ff' | 'ff_only';
  readonly confirmMerge: true;
}

export interface FixMergeRequestRequest extends CommandRequest {
  readonly projectId: string;
  readonly fixRunId: string;
  readonly targetBranch: string;
  readonly title: string;
  readonly description: string;
}

export interface FixDiscardRequest extends CommandRequest {
  readonly projectId: string;
  readonly fixRunId: string;
  readonly confirmDiscard: true;
}

/* ------------------------------------------------------------------ */
/* Operations                                                          */
/* ------------------------------------------------------------------ */

export interface OperationsByKeyResponse {
  readonly operation: OperationRecord;
  readonly stillUnknown: boolean;
}

/* ------------------------------------------------------------------ */
/* Settings / integration                                              */
/* ------------------------------------------------------------------ */

export interface SettingsResponse {
  readonly settings: PublicSettings;
  readonly issues: readonly SettingsIssue[];
  readonly catalog: CatalogSnapshot;
}

export interface UpdateSettingsRequest {
  readonly requestKey: RequestKey;
  readonly patch: Partial<AppSettings>;
  readonly confirmAcrossProjects?: boolean;
}

export interface IntegrationStatusResponse {
  readonly integration: IntegrationStatus;
}

export interface GitLabConnectionRequest {
  readonly requestKey: RequestKey;
  readonly provider: 'github' | 'gitlab';
  readonly baseUrl: string;
  readonly apiBaseUrl?: string;
  readonly token: string;
}

export interface DatabaseConnectionUpsertRequest {
  readonly requestKey: RequestKey;
  readonly connection: {
    readonly id?: string;
    readonly name: string;
    readonly type: AppSettings['database']['connections'][number]['type'];
    readonly host: string;
    readonly port: number;
    readonly database: string;
    readonly user: string;
    readonly password?: string;
    readonly ssl?: boolean;
    readonly readOnly?: boolean;
  };
}

export interface DatabaseConnectionsResponse {
  readonly connections: readonly DatabaseConnection[];
}

export interface DatabaseProbeResponse {
  readonly probe: DatabaseProbeResult;
}

export interface DatabaseQueryRequest {
  readonly sql: string;
  readonly limit?: number;
  readonly confirmReadOnly: true;
}

export interface DatabaseQueryResponseEnvelope {
  readonly result: DatabaseQueryResult;
}

/* ------------------------------------------------------------------ */
/* OpenCode                                                            */
/* ------------------------------------------------------------------ */

export interface OpenCodeStatusResponse {
  readonly status: {
    readonly state: string;
    readonly managed: boolean;
    readonly enabled: boolean;
    readonly version?: string;
    readonly binaryPath: string;
    readonly host?: string;
    readonly port?: number;
    readonly pid?: number;
    readonly model: string;
    readonly agent: string;
    readonly mcp: { readonly name: string; readonly connected: boolean; readonly tools: number };
    readonly startedAt?: IsoDateTime;
    readonly lastError?: string;
    readonly sessions?: number;
    readonly totalSessions?: number;
    readonly maxSessions?: number;
  };
}

export interface OpenCodeRestartRequest extends CommandRequest {
  readonly confirmRestart: true;
}

/** Manager-level runtime status captured when a restart command settles. */
export interface OpenCodeRuntimeStatus {
  readonly state: string;
  readonly version?: string;
  readonly host?: string;
  readonly port?: number;
  readonly pid?: number;
  readonly startedAt?: IsoDateTime;
  readonly lastError?: string;
}

export type OpenCodeRestartResponse = CommandResponse<{ readonly status: OpenCodeRuntimeStatus }>;

/**
 * Managed MCP tools injected per toolset prefix.
 *
 * The registry itself lives in `packages/mcp/src/tools/index.ts` (a separate
 * stdio process); this table mirrors it so the HTTP layer can report the count
 * for the toolsets that are actually enabled. The contract test
 * `tests/integration/routes-contract.test.ts` asserts these counts against
 * `MANAGED_TOOL_NAMES`, so adding/removing a tool fails tests instead of
 * silently skewing the runtime page.
 */
export const MCP_TOOL_COUNTS_BY_TOOLSET = {
  workflow: 4,
  git: 4,
  database: 1,
  workspace: 4,
} as const;

export type McpToolsetId = keyof typeof MCP_TOOL_COUNTS_BY_TOOLSET;

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

export interface EventsStreamQuery {
  readonly lastEventId?: number;
}

export type WireEvent = AppEventEnvelope;

/* ------------------------------------------------------------------ */
/* Route table (shared by server and web client)                       */
/* ------------------------------------------------------------------ */

export const ROUTES = {
  health: '/api/health',
  fsDirectories: (path?: string) => path === undefined ? '/api/fs/directories' : `/api/fs/directories?path=${encodeURIComponent(path)}`,
  bootstrap: '/api/bootstrap',
  events: '/api/events',
  operationsByKey: (requestKey: string) => `/api/operations/${encodeURIComponent(requestKey)}`,
  interactions: '/api/interactions',
  interaction: (id: string) => `/api/interactions/${encodeURIComponent(id)}`,
  interactionResolve: (id: string) => `/api/interactions/${encodeURIComponent(id)}/resolve`,
  projects: '/api/projects',
  project: (id: string) => `/api/projects/${encodeURIComponent(id)}`,
  tasks: '/api/tasks',
  task: (id: string) => `/api/tasks/${encodeURIComponent(id)}`,
  taskDetail: (id: string) => `/api/tasks/${encodeURIComponent(id)}/detail`,
  pptWorks: '/api/ppt/works',
  pptWork: (id: string) => `/api/ppt/works/${encodeURIComponent(id)}`,
  pptWorkPptx: (id: string) => `/api/ppt/works/${encodeURIComponent(id)}/pptx`,
  pptWorkGenerateSlides: (id: string) => `/api/ppt/works/${encodeURIComponent(id)}/generate-slides`,
  pptWorkExport: (id: string) => `/api/ppt/works/${encodeURIComponent(id)}/export`,
  pptWorkAttachments: (id: string) => `/api/ppt/works/${encodeURIComponent(id)}/attachments`,
  pptWorkAttachment: (id: string, name: string) => `/api/ppt/works/${encodeURIComponent(id)}/attachments/${encodeURIComponent(name)}`,
  pptWorkUpdate: (id: string) => `/api/ppt/works/${encodeURIComponent(id)}`,
  pptWorkGenerate: (id: string) => `/api/ppt/works/${encodeURIComponent(id)}/generate`,
  taskAcceptance: (id: string) => `/api/tasks/${encodeURIComponent(id)}/acceptance`,
  taskPlanFreeze: (id: string) => `/api/tasks/${encodeURIComponent(id)}/plan/freeze`,
  taskPlanFreezes: (id: string) => `/api/tasks/${encodeURIComponent(id)}/plan/freezes`,
  taskAudit: (id: string) => `/api/tasks/${encodeURIComponent(id)}/audit`,
  taskSnapshotReview: (id: string) => `/api/tasks/${encodeURIComponent(id)}/snapshot-review`,
  taskRunContent: (id: string) => `/api/tasks/${encodeURIComponent(id)}/run-content`,
  taskPlanFromTemplate: (id: string) => `/api/tasks/${encodeURIComponent(id)}/plan/from-template`,
  taskRecovery: (id: string) => `/api/tasks/${encodeURIComponent(id)}/recovery`,
  taskRecoveries: (id: string) => `/api/tasks/${encodeURIComponent(id)}/recoveries`,
  requirement: (id: string) => `/api/tasks/${encodeURIComponent(id)}/requirement`,
  planning: (id: string) => `/api/tasks/${encodeURIComponent(id)}/planning`,
  planningPreview: (id: string) => `/api/tasks/${encodeURIComponent(id)}/planning/preview`,
  planningProposal: (id: string) => `/api/tasks/${encodeURIComponent(id)}/planning/proposal`,
  planningRefinePreview: (id: string) => `/api/tasks/${encodeURIComponent(id)}/planning/refine-preview`,
  planningStart: (id: string) => `/api/tasks/${encodeURIComponent(id)}/planning/start`,
  planningStop: (id: string) => `/api/tasks/${encodeURIComponent(id)}/planning/stop`,
  planningReconcile: (id: string) => `/api/tasks/${encodeURIComponent(id)}/planning/reconcile`,
  planningApply: (id: string) => `/api/tasks/${encodeURIComponent(id)}/planning/apply`,
  planningReject: (id: string) => `/api/tasks/${encodeURIComponent(id)}/planning/reject`,
  planningAnswers: (id: string) => `/api/tasks/${encodeURIComponent(id)}/planning/answers`,
  planningRecord: (id: string) => `/api/tasks/${encodeURIComponent(id)}/planning/record`,
  plan: (id: string) => `/api/tasks/${encodeURIComponent(id)}/plan`,
  planSkeleton: (id: string) => `/api/tasks/${encodeURIComponent(id)}/plan/skeleton`,
  planConfirm: (id: string) => `/api/tasks/${encodeURIComponent(id)}/plan/confirm`,
  planEditBegin: (id: string) => `/api/tasks/${encodeURIComponent(id)}/plan/edit/begin`,
  planEditSave: (id: string) => `/api/tasks/${encodeURIComponent(id)}/plan/edit/save`,
  planEditFinish: (id: string) => `/api/tasks/${encodeURIComponent(id)}/plan/edit/finish`,
  planEditAbandon: (id: string) => `/api/tasks/${encodeURIComponent(id)}/plan/edit/abandon`,
  planNode: (id: string, nodeId: string) => `/api/tasks/${encodeURIComponent(id)}/plan/nodes/${encodeURIComponent(nodeId)}`,
  planRevision: (id: string, revisionId: string) => `/api/tasks/${encodeURIComponent(id)}/plan/revisions/${encodeURIComponent(revisionId)}`,
  workspace: (id: string) => `/api/tasks/${encodeURIComponent(id)}/workspace`,
  workspacePrepare: (id: string) => `/api/tasks/${encodeURIComponent(id)}/workspace/prepare`,
  workspaceCleanupPreview: (id: string) => `/api/tasks/${encodeURIComponent(id)}/workspace/cleanup/preview`,
  workspaceCleanupConfirm: (id: string) => `/api/tasks/${encodeURIComponent(id)}/workspace/cleanup/confirm`,
  changes: (id: string) => `/api/tasks/${encodeURIComponent(id)}/changes`,
  changesDiff: (id: string, fileId: string) => `/api/tasks/${encodeURIComponent(id)}/changes/files/${encodeURIComponent(fileId)}/diff`,
  execution: (id: string) => `/api/tasks/${encodeURIComponent(id)}/execution`,
  executionStart: (id: string) => `/api/tasks/${encodeURIComponent(id)}/execution/start`,
  executionPause: (id: string) => `/api/tasks/${encodeURIComponent(id)}/execution/pause`,
  executionResume: (id: string) => `/api/tasks/${encodeURIComponent(id)}/execution/resume`,
  executionRetry: (id: string) => `/api/tasks/${encodeURIComponent(id)}/execution/retry`,
  executionSkipNode: (id: string, nodeId: string) => `/api/tasks/${encodeURIComponent(id)}/execution/nodes/${encodeURIComponent(nodeId)}/skip`,
  executionAdvance: (id: string) => `/api/tasks/${encodeURIComponent(id)}/execution/advance`,
  executionAutoAdvance: (id: string) => `/api/tasks/${encodeURIComponent(id)}/execution/auto-advance`,
  executionCancel: (id: string) => `/api/tasks/${encodeURIComponent(id)}/execution/cancel`,
  node: (id: string, nodeId: string) => `/api/tasks/${encodeURIComponent(id)}/nodes/${encodeURIComponent(nodeId)}`,
  nodeAttempts: (id: string, nodeId: string) => `/api/tasks/${encodeURIComponent(id)}/nodes/${encodeURIComponent(nodeId)}/attempts`,
  nodeOutput: (id: string, nodeId: string) => `/api/tasks/${encodeURIComponent(id)}/nodes/${encodeURIComponent(nodeId)}/output`,
  nodeAccept: (id: string, nodeId: string) => `/api/tasks/${encodeURIComponent(id)}/nodes/${encodeURIComponent(nodeId)}/accept`,
  nodeReject: (id: string, nodeId: string) => `/api/tasks/${encodeURIComponent(id)}/nodes/${encodeURIComponent(nodeId)}/reject`,
  delivery: (id: string) => `/api/tasks/${encodeURIComponent(id)}/delivery`,
  deliverySelect: (id: string) => `/api/tasks/${encodeURIComponent(id)}/delivery/select`,
  deliveryCommit: (id: string) => `/api/tasks/${encodeURIComponent(id)}/delivery/commit`,
  deliveryPush: (id: string) => `/api/tasks/${encodeURIComponent(id)}/delivery/push`,
  deliveryMergeRequest: (id: string) => `/api/tasks/${encodeURIComponent(id)}/delivery/merge-request`,
  deliveryMerge: (id: string) => `/api/tasks/${encodeURIComponent(id)}/delivery/merge`,
  deliveryApplyPreview: (id: string) => `/api/tasks/${encodeURIComponent(id)}/delivery/apply/preview`,
  deliveryApply: (id: string) => `/api/tasks/${encodeURIComponent(id)}/delivery/apply`,
  gitOverview: '/api/git/repos',
  gitRepo: (projectId: string) => `/api/git/repos/${encodeURIComponent(projectId)}`,
  gitCommits: (projectId: string) => `/api/git/repos/${encodeURIComponent(projectId)}/commits`,
  gitCommit: (projectId: string, sha: string) => `/api/git/repos/${encodeURIComponent(projectId)}/commits/${encodeURIComponent(sha)}`,
  gitCommitFiles: (projectId: string, sha: string) => `/api/git/repos/${encodeURIComponent(projectId)}/commits/${encodeURIComponent(sha)}/files`,
  gitDiff: (projectId: string) => `/api/git/repos/${encodeURIComponent(projectId)}/diff`,
  gitBranches: (projectId: string) => `/api/git/repos/${encodeURIComponent(projectId)}/branches`,
  gitFetch: (projectId: string) => `/api/git/repos/${encodeURIComponent(projectId)}/fetch`,
  gitMergeRequests: (projectId: string) => `/api/git/repos/${encodeURIComponent(projectId)}/merge-requests`,
  gitMergeRequest: (projectId: string, iid: number) => `/api/git/repos/${encodeURIComponent(projectId)}/merge-requests/${iid}`,
  reviews: (projectId: string) => `/api/git/repos/${encodeURIComponent(projectId)}/reviews`,
  reviewCompare: (projectId: string, baseId: string, targetId: string) => `/api/git/repos/${encodeURIComponent(projectId)}/reviews/${encodeURIComponent(baseId)}/compare/${encodeURIComponent(targetId)}`,
  commitReviews: (projectId: string, sha: string) => `/api/git/repos/${encodeURIComponent(projectId)}/commits/${encodeURIComponent(sha)}/reviews`,
  review: (projectId: string, reviewRunId: string) => `/api/git/repos/${encodeURIComponent(projectId)}/reviews/${encodeURIComponent(reviewRunId)}`,
  reviewStart: (projectId: string) => `/api/git/repos/${encodeURIComponent(projectId)}/reviews/start`,
  reviewStop: (projectId: string, reviewRunId: string) => `/api/git/repos/${encodeURIComponent(projectId)}/reviews/${encodeURIComponent(reviewRunId)}/stop`,
  reviewFinding: (projectId: string, findingId: string) => `/api/git/repos/${encodeURIComponent(projectId)}/findings/${encodeURIComponent(findingId)}`,
  fixes: (projectId: string) => `/api/git/repos/${encodeURIComponent(projectId)}/fixes`,
  fix: (projectId: string, fixRunId: string) => `/api/git/repos/${encodeURIComponent(projectId)}/fixes/${encodeURIComponent(fixRunId)}`,
  fixStart: (projectId: string) => `/api/git/repos/${encodeURIComponent(projectId)}/fixes/start`,
  fixDiff: (projectId: string, fixRunId: string) => `/api/git/repos/${encodeURIComponent(projectId)}/fixes/${encodeURIComponent(fixRunId)}/diff`,
  fixStop: (projectId: string, fixRunId: string) => `/api/git/repos/${encodeURIComponent(projectId)}/fixes/${encodeURIComponent(fixRunId)}/stop`,
  fixCommit: (projectId: string, fixRunId: string) => `/api/git/repos/${encodeURIComponent(projectId)}/fixes/${encodeURIComponent(fixRunId)}/commit`,
  fixPush: (projectId: string, fixRunId: string) => `/api/git/repos/${encodeURIComponent(projectId)}/fixes/${encodeURIComponent(fixRunId)}/push`,
  fixMerge: (projectId: string, fixRunId: string) => `/api/git/repos/${encodeURIComponent(projectId)}/fixes/${encodeURIComponent(fixRunId)}/merge`,
  fixMergeRequest: (projectId: string, fixRunId: string) => `/api/git/repos/${encodeURIComponent(projectId)}/fixes/${encodeURIComponent(fixRunId)}/merge-request`,
  fixDiscard: (projectId: string, fixRunId: string) => `/api/git/repos/${encodeURIComponent(projectId)}/fixes/${encodeURIComponent(fixRunId)}/discard`,
  fixFileRevert: (projectId: string, fixRunId: string, fileId: string) => `/api/git/repos/${encodeURIComponent(projectId)}/fixes/${encodeURIComponent(fixRunId)}/files/${encodeURIComponent(fileId)}/revert`,
  catalogRoles: '/api/catalog/roles',
  projectRecheck: (id: string) => `/api/projects/${encodeURIComponent(id)}/recheck`,
  projectCharter: (id: string) => `/api/projects/${encodeURIComponent(id)}/charter`,
  projectCharterGenerate: (id: string) => `/api/projects/${encodeURIComponent(id)}/charter/generate`,
  projectCharterConfirm: (id: string) => `/api/projects/${encodeURIComponent(id)}/charter/confirm`,
  templateDetail: (id: string) => `/api/templates/${encodeURIComponent(id)}`,
  templateTasks: (id: string) => `/api/templates/${encodeURIComponent(id)}/tasks`,
  workflows: '/api/workflows',
  workflow: (id: string) => `/api/workflows/${encodeURIComponent(id)}`,
  workflowCopy: (id: string) => `/api/workflows/${encodeURIComponent(id)}/copy`,
  workflowValidate: '/api/workflows/validate',
  workflowInstantiate: (id: string) => `/api/workflows/${encodeURIComponent(id)}/instantiate`,
  catalogRoleSave: '/api/catalog/roles',
  catalogRolePublish: (id: string) => `/api/catalog/roles/${encodeURIComponent(id)}/publish`,
  catalogRoleValidate: (id: string) => `/api/catalog/roles/${encodeURIComponent(id)}/validate`,
  catalogTemplateImport: '/api/catalog/templates/import',
  catalogTemplateUpdate: (id: string) => `/api/catalog/templates/${encodeURIComponent(id)}`,
  catalogTemplateArchive: (id: string) => `/api/catalog/templates/${encodeURIComponent(id)}`,
  catalogRoleRestore: (id: string, revision: string) => `/api/catalog/roles/${encodeURIComponent(id)}/restore/${encodeURIComponent(revision)}`,
  catalogRoleHistory: (id: string) => `/api/catalog/roles/${encodeURIComponent(id)}/history`,
  catalogRoleArchive: (id: string) => `/api/catalog/roles/${encodeURIComponent(id)}/archive`,
  settings: '/api/settings',
  settingsGit: '/api/settings/git',
  gitlabConnection: '/api/settings/gitlab',
  gitlabConnectionTest: '/api/settings/gitlab/test',
  databaseConnections: '/api/settings/databases',
  databaseConnection: (id: string) => `/api/settings/databases/${encodeURIComponent(id)}`,
  databaseProbe: (id: string) => `/api/settings/databases/${encodeURIComponent(id)}/probe`,
  databaseQuery: (id: string) => `/api/settings/databases/${encodeURIComponent(id)}/query`,
  opencodeStatus: '/api/opencode/status',
  opencodeRestart: '/api/opencode/restart',
  opencodeDetect: '/api/opencode/detect',
  opencodeLogs: '/api/opencode/logs',
  insights: '/api/insights',
  insightsTaskUsage: '/api/insights/task-usage',
  insightsTaskQuality: '/api/insights/task-quality',
  insightsTaskAcceptance: '/api/insights/task-acceptance',
  skills: '/api/skills',
  skillSource: (id: string) => `/api/skills/${encodeURIComponent(id)}/source`,
  knowledgeSources: '/api/knowledge/sources',
  knowledgeSearch: '/api/knowledge/search',
  knowledgeSourceContent: '/api/knowledge/source',
  knowledgeAsk: '/api/knowledge/ask',
  knowledgeHistory: '/api/knowledge/history',
  knowledgeProgress: (key: string) => `/api/knowledge/runs/${encodeURIComponent(key)}`,
  knowledgeStop: (key: string) => `/api/knowledge/runs/${encodeURIComponent(key)}/stop`,
  knowledgeResult: (requestKey: string) => `/api/knowledge/results/${encodeURIComponent(requestKey)}`,
} as const;

export type RouteKey = keyof typeof ROUTES;

