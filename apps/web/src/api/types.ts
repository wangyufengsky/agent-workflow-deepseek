/* Shared wire contracts. The web app reuses @agent-workflow/shared verbatim so
 * the UI can never drift from the server DTOs. */

export type {
  ApiEnvelope,
  ApiErrorResponse,
  AppSettings,
  BootstrapResponse,
  CommandResponse,
  InboxItem,
  IntegrationStatus,
  ListTasksQuery,
  OpenCodeStatusResponse,
  Page,
  ProjectSummary,
  PublicSettings,
  RequirementResponse,
  ResponseMeta,
  SettingsResponse,
  Task,
  TaskAttentionValue,
  TaskDetailResponse,
  TaskLifecycleValue,
  TaskStageValue,
  TaskSummary,
  ThemeIdValue,
  ThemeMeta,
} from '@agent-workflow/shared';
