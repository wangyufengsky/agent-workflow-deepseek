/** Every persisted or wire-visible enum lives here. No TypeScript `enum` (erasable syntax only). */

export const ThemeId = {
  DEEPSEEK: 'deepseek',
  WARM: 'warm',
  SP_DB: 'spdb',
  GITHUB_WHITE: 'github-white',
} as const;
export type ThemeIdValue = (typeof ThemeId)[keyof typeof ThemeId];
export const THEME_ORDER = [ThemeId.DEEPSEEK, ThemeId.WARM, ThemeId.SP_DB, ThemeId.GITHUB_WHITE] as const;

export interface ThemeMeta {
  readonly id: ThemeIdValue;
  readonly label: string;
  readonly description: string;
  readonly colorScheme: 'dark' | 'light';
}

export const THEMES: Record<ThemeIdValue, ThemeMeta> = {
  deepseek: { id: 'deepseek', label: 'DeepSeek', description: '深色默认主题', colorScheme: 'dark' },
  warm: { id: 'warm', label: 'Warm', description: '暖色 Claude 风', colorScheme: 'light' },
  spdb: { id: 'spdb', label: 'SPDB', description: '浦发银行风', colorScheme: 'light' },
  'github-white': { id: 'github-white', label: 'GitHub White', description: 'GitHub 浅色', colorScheme: 'light' },
};

export const DisplayMode = { PRESENT: 'present', REVIEW: 'review' } as const;
export type DisplayModeValue = (typeof DisplayMode)[keyof typeof DisplayMode];

export const ActorKind = { USER: 'user', SYSTEM: 'system', AGENT: 'agent' } as const;
export type ActorKindValue = (typeof ActorKind)[keyof typeof ActorKind];

/**
 * The five-stage task capsule is the single overall task stage:
 * 需求草稿 · 规划 · 确认计划 · 准备工作区 · 开始执行.
 * Terminal projections (delivered / cancelled) are derived, not new capsule segments.
 */
export const TaskStage = {
  DRAFT: 'draft',
  PLANNING: 'planning',
  CONFIRMING: 'confirming',
  PREPARING: 'preparing',
  EXECUTING: 'executing',
} as const;
export type TaskStageValue = (typeof TaskStage)[keyof typeof TaskStage];
export const TASK_STAGE_ORDER = [TaskStage.DRAFT, TaskStage.PLANNING, TaskStage.CONFIRMING, TaskStage.PREPARING, TaskStage.EXECUTING] as const;

export const TaskLifecycle = {
  ACTIVE: 'active',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;
export type TaskLifecycleValue = (typeof TaskLifecycle)[keyof typeof TaskLifecycle];

/** Cross-cutting attention status shown on the current capsule segment. */
export const TaskAttention = {
  NONE: 'none',
  WAITING_USER: 'waiting_user',
  BLOCKED: 'blocked',
  FAILED: 'failed',
  UNKNOWN: 'unknown',
} as const;
export type TaskAttentionValue = (typeof TaskAttention)[keyof typeof TaskAttention];

export const TaskMethodSupport = {
  AI_PLANNING: 'ai_planning',
  SKELETON_ONLY: 'skeleton_only',
} as const;
export type TaskMethodSupportValue = (typeof TaskMethodSupport)[keyof typeof TaskMethodSupport];

export const PlanningRunStatus = {
  QUEUED: 'queued',
  RUNNING: 'running',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  FAILED: 'failed',
  UNKNOWN: 'unknown',
  COMPLETED: 'completed',
} as const;
export type PlanningRunStatusValue = (typeof PlanningRunStatus)[keyof typeof PlanningRunStatus];

/** Stage track inside the planning segment: 准备输入 → 生成候选 → 检查计划 →〔修订候选〕→ 等待审阅. */
export const PlanningStage = {
  PREPARING_INPUT: 'preparing_input',
  GENERATING: 'generating',
  VALIDATING: 'validating',
  REVISING: 'revising',
  AWAITING_REVIEW: 'awaiting_review',
  NEEDS_ANSWER: 'needs_answer',
  DONE: 'done',
  STOPPED: 'stopped',
  FAILED: 'failed',
  UNKNOWN: 'unknown',
} as const;
export type PlanningStageValue = (typeof PlanningStage)[keyof typeof PlanningStage];
export const PLANNING_STAGE_ORDER = [
  PlanningStage.PREPARING_INPUT,
  PlanningStage.GENERATING,
  PlanningStage.VALIDATING,
  PlanningStage.REVISING,
  PlanningStage.AWAITING_REVIEW,
] as const;

export const PlanningApplyStatus = {
  NOT_APPLIED: 'not_applied',
  APPLIED: 'applied',
  REJECTED: 'rejected',
} as const;
export type PlanningApplyStatusValue = (typeof PlanningApplyStatus)[keyof typeof PlanningApplyStatus];

export const PlanRevisionStatus = {
  DRAFT: 'draft',
  UNCONFIRMED: 'unconfirmed',
  CONFIRMED: 'confirmed',
  SUPERSEDED: 'superseded',
} as const;
export type PlanRevisionStatusValue = (typeof PlanRevisionStatus)[keyof typeof PlanRevisionStatus];

export const PlanLayer = {
  CURRENT: 'current',
  PARTIAL: 'partial',
  CANDIDATE: 'candidate',
  COMPARE: 'compare',
} as const;
export type PlanLayerValue = (typeof PlanLayer)[keyof typeof PlanLayer];

export const NodeKind = {
  REQUIREMENT: 'requirement',
  DESIGN: 'design',
  IMPLEMENTATION: 'implementation',
  TEST: 'test',
  VERIFY: 'verify',
  DELIVERY: 'delivery',
  SYSTEM: 'system',
} as const;
export type NodeKindValue = (typeof NodeKind)[keyof typeof NodeKind];

export const NodeStatus = {
  PENDING: 'pending',
  READY: 'ready',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  CANCELLED: 'cancelled',
  UNKNOWN: 'unknown',
} as const;
export type NodeStatusValue = (typeof NodeStatus)[keyof typeof NodeStatus];
export const NODE_TERMINAL_STATUSES: readonly NodeStatusValue[] = [NodeStatus.SUCCEEDED, NodeStatus.FAILED, NodeStatus.SKIPPED, NodeStatus.CANCELLED];

/**
 * Human acceptance of one succeeded node. It is an audit verdict, not a node
 * status: recording it must never rewrite the execution result.
 */
export const NodeManualAcceptanceState = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
} as const;
export type NodeManualAcceptanceStateValue = (typeof NodeManualAcceptanceState)[keyof typeof NodeManualAcceptanceState];

export const ExecutionStatus = {
  IDLE: 'idle',
  READY: 'ready',
  RUNNING: 'running',
  PAUSING: 'pausing',
  PAUSED: 'paused',
  WAITING_CONFIRMATION: 'waiting_confirmation',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  COMPLETED: 'completed',
  FAILED: 'failed',
  UNKNOWN: 'unknown',
} as const;
export type ExecutionStatusValue = (typeof ExecutionStatus)[keyof typeof ExecutionStatus];

export const WorkspaceKind = {
  GIT_WORKTREE: 'git_worktree',
  DIRECTORY_COPY: 'directory_copy',
} as const;
export type WorkspaceKindValue = (typeof WorkspaceKind)[keyof typeof WorkspaceKind];

export const WorkspaceState = {
  NOT_STARTED: 'not_started',
  PREPARING: 'preparing',
  READY: 'ready',
  PARTIAL: 'partial',
  BLOCKED: 'blocked',
  UNKNOWN: 'unknown',
  CLEANING: 'cleaning',
  CLEANED: 'cleaned',
} as const;
export type WorkspaceStateValue = (typeof WorkspaceState)[keyof typeof WorkspaceState];

export const WorkspaceStep = {
  RESOLVE_BASELINE: 'resolve_baseline',
  CREATE_BRANCH: 'create_branch',
  CREATE_WORKTREE: 'create_worktree',
  VERIFY_WORKTREE: 'verify_worktree',
  BIND_TASK: 'bind_task',
} as const;
export type WorkspaceStepValue = (typeof WorkspaceStep)[keyof typeof WorkspaceStep];

export const DeliveryGoal = {
  LOCAL_COMMIT: 'local_commit',
  PUSH_BRANCH: 'push_branch',
  CREATE_MERGE_REQUEST: 'create_merge_request',
  APPLY_TO_ORIGINAL: 'apply_to_original',
} as const;
export type DeliveryGoalValue = (typeof DeliveryGoal)[keyof typeof DeliveryGoal];

export const DeliveryProjection = {
  AWAITING_SELECTION: 'awaiting_selection',
  AWAITING_CONFIRMATION: 'awaiting_confirmation',
  IN_PROGRESS: 'in_progress',
  BLOCKED: 'blocked',
  UNKNOWN_RECEIPT: 'unknown_receipt',
  DELIVERED: 'delivered',
} as const;
export type DeliveryProjectionValue = (typeof DeliveryProjection)[keyof typeof DeliveryProjection];

export const DeliveryStep = {
  COMMIT: 'commit',
  PUSH: 'push',
  MERGE_REQUEST: 'mergeRequest',
  APPLY: 'apply',
  MERGE: 'merge',
} as const;
export type DeliveryStepValue = (typeof DeliveryStep)[keyof typeof DeliveryStep];

export const StepState = {
  NOT_STARTED: 'not_started',
  IN_PROGRESS: 'in_progress',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  UNKNOWN: 'unknown',
  BLOCKED: 'blocked',
} as const;
export type StepStateValue = (typeof StepState)[keyof typeof StepState];

export const ReceiptStatus = {
  ACCEPTED: 'accepted',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  UNKNOWN: 'unknown',
} as const;
export type ReceiptStatusValue = (typeof ReceiptStatus)[keyof typeof ReceiptStatus];

export const ChangeStatus = {
  ADDED: 'A',
  MODIFIED: 'M',
  DELETED: 'D',
  RENAMED: 'R',
  COPIED: 'C',
  TYPE_CHANGED: 'T',
} as const;
export type ChangeStatusValue = (typeof ChangeStatus)[keyof typeof ChangeStatus];

export const ChangeCheck = {
  APPLICABLE: 'applicable',
  CONFLICT: 'conflict',
  UNSUPPORTED: 'unsupported',
} as const;
export type ChangeCheckValue = (typeof ChangeCheck)[keyof typeof ChangeCheck];

export const ConflictType = {
  BOTH_MODIFIED: 'both_modified',
  ADD_ADD: 'add_add',
  DELETE_VS_MODIFIED: 'delete_vs_modified',
  MODIFIED_VS_DELETED: 'modified_vs_deleted',
  TYPE_CONFLICT: 'type_conflict',
  UNSUPPORTED_BINARY_OR_LINK: 'unsupported_binary_or_link',
} as const;
export type ConflictTypeValue = (typeof ConflictType)[keyof typeof ConflictType];

export const ConflictResolution = {
  KEEP_ORIGINAL: 'keep_original',
  TAKE_TASK: 'take_task',
  MANUAL_THEN_RECHECK: 'manual_then_recheck',
  EXCLUDE: 'exclude',
} as const;
export type ConflictResolutionValue = (typeof ConflictResolution)[keyof typeof ConflictResolution];

export const GitProvider = { GITHUB: 'github', GITLAB: 'gitlab' } as const;
export type GitProviderValue = (typeof GitProvider)[keyof typeof GitProvider];

export const GitConnectionState = {
  CONNECTED: 'connected',
  NOT_CONFIGURED: 'not_configured',
  AUTH_FAILED: 'auth_failed',
  UNREACHABLE: 'unreachable',
} as const;
export type GitConnectionStateValue = (typeof GitConnectionState)[keyof typeof GitConnectionState];

export const RepoGitState = {
  GIT: 'git',
  NOT_GIT: 'not_git',
  PATH_UNAVAILABLE: 'path_unavailable',
  CAPABILITY_UNAVAILABLE: 'capability_unavailable',
} as const;
export type RepoGitStateValue = (typeof RepoGitState)[keyof typeof RepoGitState];

export const GitHeadKind = { BRANCH: 'branch', DETACHED: 'detached', UNBORN: 'unborn' } as const;

export const ReviewRunState = {
  QUEUED: 'queued',
  RUNNING: 'running',
  STOPPING: 'stopping',
  COMPLETED: 'completed',
  FAILED: 'failed',
  STOPPED: 'stopped',
  UNKNOWN: 'unknown',
} as const;
export type ReviewRunStateValue = (typeof ReviewRunState)[keyof typeof ReviewRunState];

export const Severity = {
  BLOCKER: 'blocker',
  CRITICAL: 'critical',
  MAJOR: 'major',
  SUGGESTION: 'suggestion',
} as const;
export type SeverityValue = (typeof Severity)[keyof typeof Severity];
export const SEVERITY_ORDER = [Severity.BLOCKER, Severity.CRITICAL, Severity.MAJOR, Severity.SUGGESTION] as const;

export const Dimension = {
  CORRECTNESS: 'correctness',
  SECURITY: 'security',
  PERFORMANCE: 'performance',
  QUALITY: 'quality',
  STYLE: 'style',
  TESTS: 'tests',
} as const;
export type DimensionValue = (typeof Dimension)[keyof typeof Dimension];
export const DIMENSION_ORDER = [
  Dimension.CORRECTNESS,
  Dimension.SECURITY,
  Dimension.PERFORMANCE,
  Dimension.QUALITY,
  Dimension.STYLE,
  Dimension.TESTS,
] as const;

export const FindingStatus = {
  OPEN: 'open',
  ACCEPTED: 'accepted',
  DISMISSED: 'dismissed',
  FALSE_POSITIVE: 'false_positive',
} as const;
export type FindingStatusValue = (typeof FindingStatus)[keyof typeof FindingStatus];

export const PptWorkStatus = {
  DRAFT: 'draft',
  GENERATING: 'generating',
  READY: 'ready',
  FAILED: 'failed',
} as const;
export type PptWorkStatusValue = (typeof PptWorkStatus)[keyof typeof PptWorkStatus];

export const FixRunState = {
  PREPARING: 'preparing',
  EDITING: 'editing',
  VERIFYING: 'verifying',
  READY: 'ready',
  NO_CHANGES: 'no_changes',
  FAILED: 'failed',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  DISCARDED: 'discarded',
  UNKNOWN: 'unknown',
} as const;
export type FixRunStateValue = (typeof FixRunState)[keyof typeof FixRunState];

export const FixOutcome = {
  FIXED: 'fixed',
  PARTIAL: 'partial',
  NOT_FIXED: 'not_fixed',
} as const;
export type FixOutcomeValue = (typeof FixOutcome)[keyof typeof FixOutcome];

export const ExtractionState = {
  EXACT: 'exact',
  MOVED: 'moved',
  NOT_FOUND: 'not_found',
} as const;

export const VerificationState = {
  PASSED: 'passed',
  FAILED: 'failed',
  NOT_CONFIGURED: 'not_configured',
  ERROR: 'error',
} as const;
export type VerificationStateValue = (typeof VerificationState)[keyof typeof VerificationState];

export const DatabaseType = {
  MYSQL: 'mysql',
  MARIADB: 'mariadb',
  POSTGRESQL: 'postgresql',
  ORACLE: 'oracle',
  DM: 'dm',
  DB2: 'db2',
  GOLDENDB: 'goldendb',
} as const;
export type DatabaseTypeValue = (typeof DatabaseType)[keyof typeof DatabaseType];

export const DatabaseConnectionState = {
  NOT_CONFIGURED: 'not_configured',
  CONNECTED: 'connected',
  AUTH_FAILED: 'auth_failed',
  UNREACHABLE: 'unreachable',
  UNSUPPORTED: 'unsupported',
} as const;
export type DatabaseConnectionStateValue = (typeof DatabaseConnectionState)[keyof typeof DatabaseConnectionState];

export const OpencodeServiceStatus = {
  STOPPED: 'stopped',
  STARTING: 'starting',
  READY: 'ready',
  DEGRADED: 'degraded',
  FAILED: 'failed',
} as const;
export type OpencodeServiceStatusValue = (typeof OpencodeServiceStatus)[keyof typeof OpencodeServiceStatus];

export const ModelProvider = {
  OPENCODE_GO: 'opencode-go',
  OPENCODE: 'opencode',
  DEEPSEEK: 'deepseek',
  CUSTOM: 'custom',
} as const;
export type ModelProviderValue = (typeof ModelProvider)[keyof typeof ModelProvider];

export const ModelRole = { PLANNER: 'planner', CODER: 'coder', REVIEWER: 'reviewer', REPAIRER: 'repairer' } as const;
export type ModelRoleValue = (typeof ModelRole)[keyof typeof ModelRole];

export const AgentKind = {
  REQUIREMENT_ANALYST: 'requirement_analyst',
  DEVELOPER: 'developer',
  TESTER: 'tester',
  REVIEWER: 'reviewer',
} as const;

export const InboxKind = {
  PLANNING_ANSWER: 'planning_answer',
  PLANNING_REVIEW: 'planning_review',
  PLANNING_RECONCILE: 'planning_reconcile',
  DELIVERY_CONFIRM: 'delivery_confirm',
  EXECUTION_FAILED: 'execution_failed',
} as const;
export type InboxKindValue = (typeof InboxKind)[keyof typeof InboxKind];

/**
 * Role capability catalog (design roles.html "能力范围"): four groups, each a
 * fixed set of switchable items. The server owns ids/labels/defaults so the
 * client never invents capability names; only `enabled` is editable.
 */
export const RoleCapabilityGroup = {
  KNOWLEDGE: 'knowledge',
  DATA: 'data',
  TASKS: 'tasks',
  TOOLS: 'tools',
} as const;
export type RoleCapabilityGroupValue = (typeof RoleCapabilityGroup)[keyof typeof RoleCapabilityGroup];

export const RoleCapabilityGroupMeta: readonly { readonly id: RoleCapabilityGroupValue; readonly label: string }[] = [
  { id: RoleCapabilityGroup.KNOWLEDGE, label: '知识与资料' },
  { id: RoleCapabilityGroup.DATA, label: '数据' },
  { id: RoleCapabilityGroup.TASKS, label: '任务' },
  { id: RoleCapabilityGroup.TOOLS, label: '工具' },
];

export const RoleCapabilityCatalog = [
  { id: 'project_knowledge', group: 'knowledge', label: '项目知识', defaultEnabled: true },
  { id: 'knowledge_conversation', group: 'knowledge', label: '知识对话', defaultEnabled: true },
  { id: 'public_knowledge_search', group: 'knowledge', label: '公共知识检索', defaultEnabled: true },
  { id: 'document_read', group: 'knowledge', label: '文档读取', defaultEnabled: true },
  { id: 'document_write', group: 'knowledge', label: '文档写入', defaultEnabled: false },
  { id: 'database_schema', group: 'data', label: '数据库结构', defaultEnabled: true },
  { id: 'database_read', group: 'data', label: '数据库读取', defaultEnabled: true },
  { id: 'task_evidence', group: 'tasks', label: '任务证据', defaultEnabled: true },
  { id: 'gitlab_read', group: 'tasks', label: 'GitLab 读取', defaultEnabled: false },
  { id: 'native_tools', group: 'tools', label: '原生工具', defaultEnabled: true },
  { id: 'external_mcp', group: 'tools', label: '外部 MCP', defaultEnabled: true },
] as const satisfies readonly { readonly id: string; readonly group: RoleCapabilityGroupValue; readonly label: string; readonly defaultEnabled: boolean }[];
export type RoleCapabilityIdValue = (typeof RoleCapabilityCatalog)[number]['id'];

/** Resource permission kinds (design "资源权限" rows NATIVE/ASSIST/MCP/READ/WRITE/ARGV/CAP). */
export const RoleResourceToolKind = { NATIVE: 'native', ASSIST: 'assist', MCP: 'mcp' } as const;
export type RoleResourceToolKindValue = (typeof RoleResourceToolKind)[keyof typeof RoleResourceToolKind];
export const RoleResourceFileKind = { READ: 'read', WRITE: 'write' } as const;
export type RoleResourceFileKindValue = (typeof RoleResourceFileKind)[keyof typeof RoleResourceFileKind];

/**
 * Inbox interactions the server can actually serve. Permissions/policy are not
 * listed because the managed-OpenCode + internal-MCP architecture has no source
 * for them; `capabilities` reports that absence instead of inventing items.
 */
export const InteractionKind = {
  PLANNING_QUESTION: 'planning_question',
  PLANNING_REVIEW: 'planning_review',
  PLANNING_RECONCILE: 'planning_reconcile',
} as const;
export type InteractionKindValue = (typeof InteractionKind)[keyof typeof InteractionKind];

export const InteractionState = {
  OPEN: 'open',
  RESOLVED: 'resolved',
  UNKNOWN: 'unknown',
} as const;
export type InteractionStateValue = (typeof InteractionState)[keyof typeof InteractionState];

export const PlanGroupKind = {
  REQUIREMENT: 'requirement',
  DESIGN: 'design',
  IMPLEMENTATION: 'implementation',
  TEST: 'test',
  DELIVERY: 'delivery',
} as const;

/** Event names pushed over SSE. Payloads only carry identity + revisions. */
export const EventType = {
  READY: 'ready',
  TASK_CHANGED: 'task.changed',
  PLAN_CHANGED: 'plan.changed',
  PLANNING_CHANGED: 'planning.changed',
  PLANNING_OUTPUT_APPENDED: 'planning.output.appended',
  EXECUTION_CHANGED: 'execution.changed',
  NODE_OUTPUT_APPENDED: 'node.output.appended',
  WORKSPACE_CHANGED: 'task.workspace.updated',
  CHANGES_CHANGED: 'task.changes.updated',
  DELIVERY_CHANGED: 'task.delivery.updated',
  OPERATION_SETTLED: 'operation.settled',
  GIT_REPO_CHANGED: 'git.repo.changed',
  REVIEW_CHANGED: 'review.changed',
  FIX_CHANGED: 'fix.changed',
  CATALOG_CHANGED: 'catalog.changed',
  OPENCODE_STATUS_CHANGED: 'opencode.status.changed',
} as const;
export type EventTypeValue = (typeof EventType)[keyof typeof EventType];

/** Every mutating command. Kept in shared so MCP, server and UI agree. */
export const OperationKind = {
  PROJECT_CREATE: 'project.create',
  PROJECT_UPDATE: 'project.update',
  PROJECT_RECHECK: 'project.recheck',
  PROJECT_CHARTER_GENERATE: 'project.charter.generate',
  PROJECT_CHARTER_UPDATE: 'project.charter.update',
  PROJECT_CHARTER_CONFIRM: 'project.charter.confirm',
  TASK_CREATE: 'task.create',
  TASK_UPDATE_DRAFT: 'task.updateDraft',
  TASK_ARCHIVE: 'task.archive',
  REQUIREMENT_ANSWER_SAVE: 'requirement.answer.save',
  PLANNING_PREVIEW: 'planning.preview',
  PLANNING_START: 'planning.start',
  PLANNING_STOP: 'planning.stop',
  PLANNING_RECONCILE: 'planning.reconcile',
  PLANNING_APPLY: 'planning.apply',
  PLANNING_REJECT: 'planning.reject',
  PLAN_SKELETON_USE: 'plan.skeleton.use',
  PLAN_TEMPLATE_USE: 'plan.template.use',
  TASK_ACCEPT: 'task.accept',
  PLAN_EDIT_BEGIN: 'plan.edit.begin',
  PLAN_EDIT_SAVE: 'plan.edit.save',
  PLAN_EDIT_FINISH: 'plan.edit.finish',
  PLAN_EDIT_ABANDON: 'plan.edit.abandon',
  PLAN_CONFIRM: 'plan.confirm',
  PLAN_RECONFIRM: 'plan.reconfirm',
  WORKSPACE_PREPARE: 'task.workspace.prepare',
  WORKSPACE_CLEANUP_PREVIEW: 'task.workspace.cleanup.preview',
  WORKSPACE_CLEANUP_CONFIRM: 'task.workspace.cleanup.confirm',
  EXECUTION_START: 'execution.start',
  EXECUTION_PAUSE: 'execution.pause',
  EXECUTION_RESUME: 'execution.resume',
  EXECUTION_ADVANCE: 'execution.advance',
  EXECUTION_AUTO_ADVANCE: 'execution.autoAdvance',
  EXECUTION_CANCEL: 'execution.cancel',
  EXECUTION_RETRY: 'execution.retry',
  NODE_ACCEPT: 'node.accept',
  NODE_REJECT: 'node.reject',
  EXECUTION_SKIP_NODE: 'execution.skipNode',
  DELIVERY_SELECT: 'task.delivery.select',
  DELIVERY_COMMIT: 'task.delivery.commit',
  DELIVERY_PUSH: 'task.delivery.push',
  DELIVERY_MR_CREATE: 'task.delivery.mergeRequest.create',
  DELIVERY_MERGE: 'task.delivery.merge',
  DELIVERY_APPLY: 'task.delivery.apply',
  GIT_FETCH: 'git.fetch',
  REVIEW_START: 'review.start',
  REVIEW_STOP: 'review.stop',
  REVIEW_FINDING_UPDATE: 'review.finding.update',
  FIX_START: 'fix.start',
  FIX_STOP: 'fix.stop',
  FIX_FILE_REVERT: 'fix.file.revert',
  FIX_COMMIT: 'fix.commit',
  FIX_PUSH: 'fix.push',
  FIX_MR_CREATE: 'fix.mergeRequest.create',
  FIX_MERGE: 'fix.merge',
  FIX_DISCARD: 'fix.discard',
  DATABASE_TEST: 'database.test',
  DATABASE_QUERY: 'database.query',
  SETTINGS_UPDATE: 'settings.update',
  SECRET_SAVE: 'secret.save',
  OPENCODE_RESTART: 'opencode.restart',
  OPERATION_RECONCILE: 'operations.by-key',
  TEMPLATE_TASK_CREATE: 'template.task.create',
  TASK_RECOVERY_CREATE: 'task.recovery.create',
  CATALOG_ROLE_SAVE: 'catalog.role.save',
  CATALOG_ROLE_PUBLISH: 'catalog.role.publish',
  CATALOG_ROLE_ARCHIVE: 'catalog.role.archive',
  CATALOG_ROLE_RESTORE: 'catalog.role.restore',
  CATALOG_TEMPLATE_IMPORT: 'catalog.template.import',
  CATALOG_TEMPLATE_ARCHIVE: 'catalog.template.archive',
  CATALOG_TEMPLATE_UPDATE: 'catalog.template.update',
  KNOWLEDGE_ASK: 'knowledge.ask',
  PPT_WORK_CREATE: 'ppt.work.create',
  PPT_WORK_DELETE: 'ppt.work.delete',
  PPT_WORK_GENERATE: 'ppt.work.generate',
  PPT_WORK_UPDATE: 'ppt.work.update',
  PPT_WORK_SLIDES: 'ppt.work.slides',
  PPT_ATTACHMENT_ADD: 'ppt.attachment.add',
  PPT_ATTACHMENT_REMOVE: 'ppt.attachment.remove',
} as const;
export type OperationKindValue = (typeof OperationKind)[keyof typeof OperationKind];

export interface OperationDefinition {
  readonly kind: OperationKindValue;
  readonly scope: 'project' | 'task' | 'git' | 'global';
  readonly mutating: boolean;
  readonly requiresRequestKey: boolean;
  readonly description: string;
}

export const OPERATIONS: Record<OperationKindValue, OperationDefinition> = {
  'project.create': op('project.create', 'global', true, '登记项目'),
  'project.update': op('project.update', 'project', true, '更新项目设置'),
  'project.recheck': op('project.recheck', 'project', true, '重新检测项目路径与 Git 状态'),
  'project.charter.generate': op('project.charter.generate', 'project', true, '生成项目公约草稿（模型生成未接线）'),
  'project.charter.update': op('project.charter.update', 'project', true, '保存项目公约草稿'),
  'project.charter.confirm': op('project.charter.confirm', 'project', true, '确认写入项目公约'),
  'task.create': op('task.create', 'project', true, '形成需求草稿'),
  'task.updateDraft': op('task.updateDraft', 'task', true, '保存需求草稿'),
  'task.archive': op('task.archive', 'task', true, '归档任务'),
  'requirement.answer.save': op('requirement.answer.save', 'task', true, '保存业务问题答复'),
  'planning.preview': op('planning.preview', 'task', false, '规划预览（只读，不调用模型）'),
  'planning.start': op('planning.start', 'task', true, '开始规划（调用模型）'),
  'planning.stop': op('planning.stop', 'task', true, '停止规划'),
  'planning.reconcile': op('planning.reconcile', 'task', false, '核对原规划轮次'),
  'planning.apply': op('planning.apply', 'task', true, '应用候选到草稿'),
  'planning.reject': op('planning.reject', 'task', true, '不采用候选'),
  'plan.skeleton.use': op('plan.skeleton.use', 'task', true, '使用方法骨架'),
  'plan.template.use': op('plan.template.use', 'task', true, '按固定模板生成计划'),
  'task.accept': op('task.accept', 'task', true, '记录人工验收结论'),
  'plan.edit.begin': op('plan.edit.begin', 'task', true, '开始调整待执行计划'),
  'plan.edit.save': op('plan.edit.save', 'task', true, '保存待执行计划调整'),
  'plan.edit.finish': op('plan.edit.finish', 'task', true, '结束调整并继续执行'),
  'plan.edit.abandon': op('plan.edit.abandon', 'task', true, '放弃待执行计划调整'),
  'plan.confirm': op('plan.confirm', 'task', true, '确认计划'),
  'plan.reconfirm': op('plan.reconfirm', 'task', true, '重新确认计划'),
  'task.workspace.prepare': op('task.workspace.prepare', 'task', true, '准备独立工作区'),
  'task.workspace.cleanup.preview': op('task.workspace.cleanup.preview', 'task', false, '清理预览'),
  'task.workspace.cleanup.confirm': op('task.workspace.cleanup.confirm', 'task', true, '清理工作区'),
  'execution.start': op('execution.start', 'task', true, '开始执行'),
  'execution.pause': op('execution.pause', 'task', true, '暂停执行'),
  'execution.resume': op('execution.resume', 'task', true, '继续执行'),
  'execution.advance': op('execution.advance', 'task', true, '推进执行'),
  'execution.autoAdvance': op('execution.autoAdvance', 'task', true, '切换自动节点推进'),
  'execution.cancel': op('execution.cancel', 'task', true, '取消执行'),
  'execution.retry': op('execution.retry', 'task', true, '按原配置重试'),
  'node.accept': op('node.accept', 'task', true, '验收通过'),
  'node.reject': op('node.reject', 'task', true, '验收不通过'),
  'execution.skipNode': op('execution.skipNode', 'task', true, '跳过节点及下游'),
  'task.delivery.select': op('task.delivery.select', 'task', true, '选择交付目标与范围'),
  'task.delivery.commit': op('task.delivery.commit', 'task', true, '提交任务变更'),
  'task.delivery.push': op('task.delivery.push', 'task', true, '推送任务分支'),
  'task.delivery.mergeRequest.create': op('task.delivery.mergeRequest.create', 'task', true, '创建合并请求'),
  'task.delivery.merge': op('task.delivery.merge', 'task', true, '合并任务分支'),
  'task.delivery.apply': op('task.delivery.apply', 'task', true, '应用到原目录'),
  'task.recovery.create': op('task.recovery.create', 'task', true, '创建恢复草稿'),
  'catalog.role.save': op('catalog.role.save', 'global', true, '保存职业草稿'),
  'catalog.role.publish': op('catalog.role.publish', 'global', true, '发布职业'),
  'catalog.role.archive': op('catalog.role.archive', 'global', true, '归档职业'),
  'catalog.role.restore': op('catalog.role.restore', 'global', true, '从历史快照恢复职业草稿'),
  'catalog.template.import': op('catalog.template.import', 'global', true, '导入固定模板'),
  'catalog.template.archive': op('catalog.template.archive', 'global', true, '归档自定义模板'),
  'catalog.template.update': op('catalog.template.update', 'global', true, '更新自定义模板'),
  'knowledge.ask': op('knowledge.ask', 'project', true, '知识库问答（单次只读）'),
  'ppt.work.create': op('ppt.work.create', 'project', true, '创建 PPT 草稿'),
  'ppt.work.delete': op('ppt.work.delete', 'project', true, '删除 PPT 草稿'),
  'ppt.work.generate': op('ppt.work.generate', 'project', true, '生成 PPT 大纲（只读模型）'),
  'ppt.work.update': op('ppt.work.update', 'project', true, '编辑 PPT 草稿/大纲'),
  'ppt.work.slides': op('ppt.work.slides', 'project', true, '生成 PPT 逐页内容（只读模型）'),
  'ppt.attachment.add': op('ppt.attachment.add', 'project', true, '添加 PPT 文本附件'),
  'ppt.attachment.remove': op('ppt.attachment.remove', 'project', true, '移除 PPT 文本附件'),
  'git.fetch': op('git.fetch', 'git', true, '获取远端更新'),
  'review.start': op('review.start', 'git', true, '开始 AI 审查'),
  'review.stop': op('review.stop', 'git', true, '停止 AI 审查'),
  'review.finding.update': op('review.finding.update', 'git', true, '更新审查问题状态'),
  'fix.start': op('fix.start', 'git', true, '开始 AI 修复'),
  'fix.stop': op('fix.stop', 'git', true, '停止 AI 修复'),
  'fix.file.revert': op('fix.file.revert', 'git', true, '撤销修复文件'),
  'fix.commit': op('fix.commit', 'git', true, '提交修复'),
  'fix.push': op('fix.push', 'git', true, '推送修复分支'),
  'fix.mergeRequest.create': op('fix.mergeRequest.create', 'git', true, '创建修复合并请求'),
  'fix.merge': op('fix.merge', 'git', true, '合并修复分支'),
  'fix.discard': op('fix.discard', 'git', true, '放弃修复'),
  'database.test': op('database.test', 'project', false, '测试数据库连接'),
  'database.query': op('database.query', 'project', false, '执行只读查询'),
  'settings.update': op('settings.update', 'global', true, '保存设置'),
  'secret.save': op('secret.save', 'global', true, '保存凭据引用'),
  'opencode.restart': op('opencode.restart', 'global', true, '重启 OpenCode 服务'),
  'operations.by-key': op('operations.by-key', 'global', false, '按原请求号核对回执'),
  'template.task.create': op('template.task.create', 'project', true, '创建固定模板任务'),
};

function op(kind: OperationKindValue, scope: OperationDefinition['scope'], mutating: boolean, description: string): OperationDefinition {
  return { kind, scope, mutating, requiresRequestKey: mutating, description };
}

export function isOperationKind(value: string): value is OperationKindValue {
  return Object.hasOwn(OPERATIONS, value);
}

export const WorkspaceParallelPolicy = {
  SERIAL: 'serial',
  SUB_ISOLATION_MERGE: 'sub_isolation_merge',
} as const;

export const ApplyItemResult = {
  APPLIED: 'applied',
  BLOCKED: 'blocked',
  UNKNOWN: 'unknown',
  NOT_EXECUTED: 'not_executed',
} as const;

export const Rationale = {
  METHOD_NOT_CONFIGURED: 'METHOD_NOT_CONFIGURED',
  BUDGET_MISSING: 'BUDGET_MISSING',
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
  CANDIDATE_PENDING: 'CANDIDATE_PENDING',
  HUMAN_DECISIONS_PENDING: 'HUMAN_DECISIONS_PENDING',
  HARD_PROBLEMS: 'HARD_PROBLEMS',
  ROUND_NOT_SETTLED: 'ROUND_NOT_SETTLED',
  ROUND_UNKNOWN: 'ROUND_UNKNOWN',
  STALE_INPUT: 'STALE_INPUT',
  FIXED_TEMPLATE: 'FIXED_TEMPLATE',
  OPERATION_IN_PROGRESS: 'OPERATION_IN_PROGRESS',
  GROUPS_INCOMPLETE: 'GROUPS_INCOMPLETE',
  WORKSPACE_NOT_READY: 'WORKSPACE_NOT_READY',
  PLAN_NOT_CONFIRMED: 'PLAN_NOT_CONFIRMED',
  ACTIVE_WRITES: 'ACTIVE_WRITES',
  NO_CHANGES: 'NO_CHANGES',
  GITLAB_NOT_CONFIGURED: 'GITLAB_NOT_CONFIGURED',
  MODEL_NOT_CONFIGURED: 'MODEL_NOT_CONFIGURED',
  OPENCODE_NOT_READY: 'OPENCODE_NOT_READY',
  RECEIPT_PENDING: 'RECEIPT_PENDING',
  ANSWER_REQUIRED: 'ANSWER_REQUIRED',
  RECONFIRM_PENDING: 'RECONFIRM_PENDING',
  DELIVERY_BLOCKED: 'DELIVERY_BLOCKED',
  CONNECTIVITY: 'CONNECTIVITY',
  NODE_EXECUTION_MISSING: 'NODE_EXECUTION_MISSING',
  NODE_NOT_SUCCEEDED: 'NODE_NOT_SUCCEEDED',
  NODE_ACCEPTED: 'NODE_ACCEPTED',
  NODE_REJECTED: 'NODE_REJECTED',
} as const;
export type RationaleValue = (typeof Rationale)[keyof typeof Rationale];
