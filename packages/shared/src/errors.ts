import type { IsoDateTime } from './ids.ts';

/**
 * Canonical error codes. Backend and frontend both import this; messages are
 * human-readable and safe to show, details are already redacted by the service.
 */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  FORBIDDEN: 'FORBIDDEN',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  CAPABILITY_UNAVAILABLE: 'CAPABILITY_UNAVAILABLE',
  /** Charter generation needs model dispatch that is not wired yet. */
  CHARTER_GENERATION_UNAVAILABLE: 'CHARTER_GENERATION_UNAVAILABLE',
  /** A previous charter write was interrupted; state must be reconciled manually. */
  CHARTER_STATE_UNKNOWN: 'CHARTER_STATE_UNKNOWN',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  UNKNOWN: 'UNKNOWN',
  STALE_TARGET: 'STALE_TARGET',
  OPERATION_IN_PROGRESS: 'OPERATION_IN_PROGRESS',
  RECEIPT_UNKNOWN: 'RECEIPT_UNKNOWN',
  REQUEST_KEY_REUSED: 'REQUEST_KEY_REUSED',
  CURSOR_EXPIRED: 'CURSOR_EXPIRED',
  NOT_RETAINED: 'NOT_RETAINED',
  TRUNCATED: 'TRUNCATED',
  VERSION_SUPERSEDED: 'VERSION_SUPERSEDED',
  UNSUPPORTED_FORMAT: 'UNSUPPORTED_FORMAT',
  READ_FAILED: 'READ_FAILED',
  REVOKED: 'REVOKED',
  TASK_STAGE_CONFLICT: 'TASK_STAGE_CONFLICT',
  PLAN_REVISION_CONFLICT: 'PLAN_REVISION_CONFLICT',
  PLANNING_UNAVAILABLE: 'PLANNING_UNAVAILABLE',
  PLANNING_BUSY: 'PLANNING_BUSY',
  CANDIDATE_PENDING: 'CANDIDATE_PENDING',
  ANSWER_REQUIRED: 'ANSWER_REQUIRED',
  HUMAN_REVIEW_REQUIRED: 'HUMAN_REVIEW_REQUIRED',
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
  BUDGET_NOT_CONFIGURED: 'BUDGET_NOT_CONFIGURED',
  WORKSPACE_NOT_READY: 'WORKSPACE_NOT_READY',
  WORKSPACE_PREPARE_FAILED: 'WORKSPACE_PREPARE_FAILED',
  WORKSPACE_NAME_CONFLICT: 'WORKSPACE_NAME_CONFLICT',
  WORKSPACE_PARTIAL: 'WORKSPACE_PARTIAL',
  FIXED_TEMPLATE_LOCKED: 'FIXED_TEMPLATE_LOCKED',
  NODE_LOCKED: 'NODE_LOCKED',
  NODE_NOT_EXECUTABLE: 'NODE_NOT_EXECUTABLE',
  DELIVERY_BLOCKED: 'DELIVERY_BLOCKED',
  DELIVERY_ALREADY_SETTLED: 'DELIVERY_ALREADY_SETTLED',
  GIT_CAPABILITY_UNAVAILABLE: 'GIT_CAPABILITY_UNAVAILABLE',
  REPO_PATH_UNAVAILABLE: 'REPO_PATH_UNAVAILABLE',
  NOT_A_GIT_REPO: 'NOT_A_GIT_REPO',
  REVISION_NOT_FOUND: 'REVISION_NOT_FOUND',
  SHALLOW_HISTORY: 'SHALLOW_HISTORY',
  DIFF_TOO_LARGE: 'DIFF_TOO_LARGE',
  BINARY_FILE: 'BINARY_FILE',
  HOOK_REJECTED: 'HOOK_REJECTED',
  FIX_NO_CHANGES: 'FIX_NO_CHANGES',
  PUSH_REJECTED_NON_FF: 'PUSH_REJECTED_NON_FF',
  REMOTE_BRANCH_EXISTS: 'REMOTE_BRANCH_EXISTS',
  PROTECTED_BRANCH: 'PROTECTED_BRANCH',
  MERGE_CONFLICT: 'MERGE_CONFLICT',
  NETWORK_UNREACHABLE: 'NETWORK_UNREACHABLE',
  GITLAB_NOT_CONFIGURED: 'GITLAB_NOT_CONFIGURED',
  GITLAB_AUTH_FAILED: 'GITLAB_AUTH_FAILED',
  MR_ALREADY_EXISTS: 'MR_ALREADY_EXISTS',
  DATABASE_NOT_CONFIGURED: 'DATABASE_NOT_CONFIGURED',
  DATABASE_AUTH_FAILED: 'DATABASE_AUTH_FAILED',
  DATABASE_QUERY_BLOCKED: 'DATABASE_QUERY_BLOCKED',
  PATH_ESCAPE: 'PATH_ESCAPE',
  COMMAND_NOT_ALLOWED: 'COMMAND_NOT_ALLOWED',
  MCP_TOOL_FAILED: 'MCP_TOOL_FAILED',
  MCP_NOT_AVAILABLE: 'MCP_NOT_AVAILABLE',
  OPENCODE_NOT_READY: 'OPENCODE_NOT_READY',
  OPENCODE_PROVIDER_FAILED: 'OPENCODE_PROVIDER_FAILED',
  OPENCODE_SESSION_LIMIT: 'OPENCODE_SESSION_LIMIT',
  MODEL_NOT_CONFIGURED: 'MODEL_NOT_CONFIGURED',
  MODEL_BUDGET_EXCEEDED: 'MODEL_BUDGET_EXCEEDED',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ErrorDetail {
  readonly code: ErrorCodeValue;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export class AppError extends Error {
  readonly code: ErrorCodeValue;
  readonly details: Record<string, unknown> | undefined;
  readonly httpStatus: number;

  constructor(code: ErrorCodeValue, message: string, options: { details?: Record<string, unknown>; httpStatus?: number } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = options.details;
    this.httpStatus = options.httpStatus ?? defaultStatus(code);
  }

  toJSON(): ErrorDetail {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }
}

export function defaultStatus(code: ErrorCodeValue): number {
  switch (code) {
    case ErrorCode.VALIDATION_FAILED:
    case ErrorCode.PATH_ESCAPE:
    case ErrorCode.COMMAND_NOT_ALLOWED:
    case ErrorCode.DATABASE_QUERY_BLOCKED:
      return 400;
    case ErrorCode.UNAUTHORIZED:
      return 401;
    case ErrorCode.FORBIDDEN:
    case ErrorCode.REVOKED:
      return 403;
    case ErrorCode.NOT_FOUND:
    case ErrorCode.REVISION_NOT_FOUND:
      return 404;
    case ErrorCode.CONFLICT:
    case ErrorCode.STALE_TARGET:
    case ErrorCode.OPERATION_IN_PROGRESS:
    case ErrorCode.REQUEST_KEY_REUSED:
    case ErrorCode.TASK_STAGE_CONFLICT:
    case ErrorCode.PLAN_REVISION_CONFLICT:
    case ErrorCode.PLANNING_BUSY:
    case ErrorCode.WORKSPACE_NAME_CONFLICT:
    case ErrorCode.REMOTE_BRANCH_EXISTS:
    case ErrorCode.MR_ALREADY_EXISTS:
    case ErrorCode.DELIVERY_ALREADY_SETTLED:
    case ErrorCode.HOOK_REJECTED:
    case ErrorCode.CANDIDATE_PENDING:
    case ErrorCode.ANSWER_REQUIRED:
    case ErrorCode.HUMAN_REVIEW_REQUIRED:
    case ErrorCode.FIXED_TEMPLATE_LOCKED:
    case ErrorCode.NODE_LOCKED:
    case ErrorCode.NODE_NOT_EXECUTABLE:
    case ErrorCode.DELIVERY_BLOCKED:
    case ErrorCode.WORKSPACE_NAME_CONFLICT:
    case ErrorCode.WORKSPACE_PARTIAL:
    case ErrorCode.PLANNING_BUSY:
    case ErrorCode.CHARTER_STATE_UNKNOWN:
      return 409;
    case ErrorCode.NOT_CONFIGURED:
    case ErrorCode.PLANNING_UNAVAILABLE:
    case ErrorCode.MODEL_NOT_CONFIGURED:
    case ErrorCode.GITLAB_NOT_CONFIGURED:
    case ErrorCode.DATABASE_NOT_CONFIGURED:
    case ErrorCode.CAPABILITY_UNAVAILABLE:
    case ErrorCode.MCP_NOT_AVAILABLE:
    case ErrorCode.OPENCODE_NOT_READY:
    case ErrorCode.WORKSPACE_NOT_READY:
    case ErrorCode.WORKSPACE_PREPARE_FAILED:
      return 503;
    case ErrorCode.OPENCODE_SESSION_LIMIT:
      return 429;
    case ErrorCode.BUDGET_EXCEEDED:
    case ErrorCode.MODEL_BUDGET_EXCEEDED:
      return 429;
    case ErrorCode.CHARTER_GENERATION_UNAVAILABLE:
      return 501;
    default:
      return 500;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** A stable, redacted wire error. Never exposes stack traces, SQL or tokens. */
export interface ApiErrorBody {
  readonly error: ErrorDetail & { requestId: string; at: IsoDateTime; retryable: boolean };
}
