import type { IsoDateTime, RequestKey, TaskId } from '../ids.ts';
import type { ErrorCodeValue } from '../errors.ts';
import type { AppEventEnvelope } from '../domain/events.ts';
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
  ModelProfile,
  NodeDetail,
  OperationReceipt,
  OperationRecord,
  PlanNode,
  PlanRevision,
  PlanningPreview,
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
  };
  readonly archived?: boolean;
  readonly expected?: { readonly updatedAt?: string };
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
  readonly citations: readonly KnowledgeCitation[];
  readonly model: string;
  readonly generatedAt: IsoDateTime;
}

export interface KnowledgeHistoryEntry extends KnowledgeAskResponse {
  readonly id: string;
}

export interface KnowledgeHistoryResponse {
  readonly entries: readonly KnowledgeHistoryEntry[];
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
    readonly currency: string;
  };
  readonly executions: { readonly total: number; readonly running: number; readonly failed: number; readonly attempts: number };
  readonly reviews: { readonly total: number; readonly completed: number; readonly failed: number; readonly openFindings: number };
  readonly fixes: { readonly total: number; readonly ready: number; readonly discarded: number };
  readonly deliveries: { readonly delivered: number; readonly blocked: number; readonly inProgress: number };
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

export interface RoleSaveRequest extends CommandRequest {
  readonly roleId?: string;
  readonly baseId?: string;
  readonly name: string;
  readonly purpose: string;
  readonly responsibilities: readonly string[];
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

export interface ExecutionResponse {
  readonly execution: ExecutionView;
  readonly workspace?: TaskWorkspace;
  readonly actions: Record<string, ActionAvailability>;
}

export interface NodeResponse {
  readonly node: NodeDetail;
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

export interface ReviewStartRequest extends CommandRequest {
  readonly projectId: string;
  readonly sha: string;
  readonly compareId: string;
  readonly dimensions: readonly string[];
  readonly context: 'diff_only' | 'diff_and_related';
  readonly professionId: string;
  readonly professionRevision: string;
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
    readonly maxSessions?: number;
  };
}

export interface OpenCodeRestartRequest extends CommandRequest {
  readonly confirmRestart: true;
}

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
  bootstrap: '/api/bootstrap',
  events: '/api/events',
  operationsByKey: (requestKey: string) => `/api/operations/${encodeURIComponent(requestKey)}`,
  projects: '/api/projects',
  project: (id: string) => `/api/projects/${encodeURIComponent(id)}`,
  tasks: '/api/tasks',
  task: (id: string) => `/api/tasks/${encodeURIComponent(id)}`,
  taskDetail: (id: string) => `/api/tasks/${encodeURIComponent(id)}/detail`,
  taskPlanFromTemplate: (id: string) => `/api/tasks/${encodeURIComponent(id)}/plan/from-template`,
  taskRecovery: (id: string) => `/api/tasks/${encodeURIComponent(id)}/recovery`,
  taskRecoveries: (id: string) => `/api/tasks/${encodeURIComponent(id)}/recoveries`,
  requirement: (id: string) => `/api/tasks/${encodeURIComponent(id)}/requirement`,
  planning: (id: string) => `/api/tasks/${encodeURIComponent(id)}/planning`,
  planningPreview: (id: string) => `/api/tasks/${encodeURIComponent(id)}/planning/preview`,
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
  executionCancel: (id: string) => `/api/tasks/${encodeURIComponent(id)}/execution/cancel`,
  node: (id: string, nodeId: string) => `/api/tasks/${encodeURIComponent(id)}/nodes/${encodeURIComponent(nodeId)}`,
  nodeAttempts: (id: string, nodeId: string) => `/api/tasks/${encodeURIComponent(id)}/nodes/${encodeURIComponent(nodeId)}/attempts`,
  nodeOutput: (id: string, nodeId: string) => `/api/tasks/${encodeURIComponent(id)}/nodes/${encodeURIComponent(nodeId)}/output`,
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
  review: (projectId: string, reviewRunId: string) => `/api/git/repos/${encodeURIComponent(projectId)}/reviews/${encodeURIComponent(reviewRunId)}`,
  reviewStart: (projectId: string) => `/api/git/repos/${encodeURIComponent(projectId)}/reviews/start`,
  reviewStop: (projectId: string, reviewRunId: string) => `/api/git/repos/${encodeURIComponent(projectId)}/reviews/${encodeURIComponent(reviewRunId)}/stop`,
  reviewFinding: (projectId: string, findingId: string) => `/api/git/repos/${encodeURIComponent(projectId)}/findings/${encodeURIComponent(findingId)}`,
  fixes: (projectId: string) => `/api/git/repos/${encodeURIComponent(projectId)}/fixes`,
  fix: (projectId: string, fixRunId: string) => `/api/git/repos/${encodeURIComponent(projectId)}/fixes/${encodeURIComponent(fixRunId)}`,
  fixStart: (projectId: string) => `/api/git/repos/${encodeURIComponent(projectId)}/fixes/start`,
  catalogRoles: '/api/catalog/roles',
  projectRecheck: (id: string) => `/api/projects/${encodeURIComponent(id)}/recheck`,
  templateDetail: (id: string) => `/api/templates/${encodeURIComponent(id)}`,
  templateTasks: (id: string) => `/api/templates/${encodeURIComponent(id)}/tasks`,
  catalogRoleSave: '/api/catalog/roles',
  catalogRolePublish: (id: string) => `/api/catalog/roles/${encodeURIComponent(id)}/publish`,
  catalogRoleArchive: (id: string) => `/api/catalog/roles/${encodeURIComponent(id)}/archive`,
  fixMerge: (projectId: string, fixRunId: string) => `/api/git/repos/${encodeURIComponent(projectId)}/fixes/${encodeURIComponent(fixRunId)}/merge`,
  settings: '/api/settings',
  gitlabConnection: '/api/settings/gitlab',
  gitlabConnectionTest: '/api/settings/gitlab/test',
  databaseConnections: '/api/settings/databases',
  databaseProbe: (id: string) => `/api/settings/databases/${encodeURIComponent(id)}/probe`,
  databaseQuery: (id: string) => `/api/settings/databases/${encodeURIComponent(id)}/query`,
  opencodeStatus: '/api/opencode/status',
  opencodeRestart: '/api/opencode/restart',
  opencodeDetect: '/api/opencode/detect',
  opencodeLogs: '/api/opencode/logs',
  insights: '/api/insights',
  skills: '/api/skills',
  knowledgeSources: '/api/knowledge/sources',
  knowledgeSearch: '/api/knowledge/search',
  knowledgeSourceContent: '/api/knowledge/source',
  knowledgeAsk: '/api/knowledge/ask',
  knowledgeHistory: '/api/knowledge/history',
} as const;

export type RouteKey = keyof typeof ROUTES;

