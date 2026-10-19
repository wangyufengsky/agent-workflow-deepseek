import { AppError, ErrorCode, type DatabaseConnectionStateValue, DatabaseConnectionState, type ErrorCodeValue } from '@agent-workflow/shared';

export type MySqlErrorPhase = 'probe' | 'query';

export interface MySqlErrorContext {
  readonly connectionId?: string;
  readonly phase: MySqlErrorPhase;
  /** Known secret values; occurrences are redacted from every message. */
  readonly secretValues?: readonly string[];
  readonly timeoutMs?: number;
}

interface MySqlErrorLike {
  readonly code?: unknown;
  readonly errno?: unknown;
  readonly sqlState?: unknown;
  readonly sqlMessage?: unknown;
  readonly message?: unknown;
}

const AUTH_ERROR_CODES = new Set([
  'ER_ACCESS_DENIED_ERROR',
  'ER_ACCESS_DENIED_NO_PASSWORD_ERROR',
  'ER_HOST_NOT_PRIVILEGED',
  'ER_NOT_SUPPORTED_AUTH_MODE',
  'ER_SECURE_TRANSPORT_REQUIRED',
  'ER_AUTHENTICATION_PLUGIN_ERROR',
]);

const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNRESET',
  'ECONNABORTED',
  'EPIPE',
  'ENOTCONN',
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_SEQUENCE_TIMEOUT',
  'ER_CONNECTION_TIMEOUT',
  'ER_CONNECTION_KILLED',
]);

const SYNTAX_ERROR_CODES = new Set([
  'ER_PARSE_ERROR',
  'ER_SYNTAX_ERROR',
  'ER_EMPTY_QUERY',
  'ER_NO_SUCH_TABLE',
  'ER_BAD_FIELD_ERROR',
  'ER_BAD_DB_ERROR',
  'ER_NO_DB_ERROR',
  'ER_WRONG_VALUE_COUNT_ON_ROW',
  'ER_OPERAND_COLUMNS',
  'ER_NON_UNIQ_ERROR',
  'ER_WHERE_RESERVED',
  'ER_ILLEGAL_VALUE_FOR_TYPE',
  'ER_INVALID_JSON_TEXT',
]);

const QUERY_TIMEOUT_ERROR_CODES = new Set(['ER_QUERY_INTERRUPTED', 'ER_QUERY_TIMEOUT', 'ER_STATEMENT_TIMEOUT', 'ER_QUERY_TIMEOUT_IN_TRANSACTION']);
const LOCK_ERROR_CODES = new Set(['ER_LOCK_WAIT_TIMEOUT', 'ER_LOCK_DEADLOCK']);
const PERMISSION_ERROR_CODES = new Set([
  'ER_TABLEACCESS_DENIED_ERROR',
  'ER_COLUMNACCESS_DENIED_ERROR',
  'ER_SPECIFIC_ACCESS_DENIED_ERROR',
  'ER_PROCACCESS_DENIED_ERROR',
  'ER_OPTION_PREVENTS_STATEMENT',
  'ER_ACCESS_DENIED_FOR_TABLE',
]);

/**
 * Map any driver failure to a stable `ErrorCode`. Passwords are never included:
 * raw driver messages are redacted and truncated before they become `details`.
 */
export function mapMySqlError(error: unknown, context: MySqlErrorContext): AppError {
  if (error instanceof AppError) return error;

  const like: MySqlErrorLike = typeof error === 'object' && error !== null ? (error as MySqlErrorLike) : {};
  const code = typeof like.code === 'string' ? like.code : undefined;
  const errno = typeof like.errno === 'number' ? like.errno : undefined;
  const sqlState = typeof like.sqlState === 'string' ? like.sqlState : undefined;
  const rawMessage = typeof like.sqlMessage === 'string' ? like.sqlMessage : typeof like.message === 'string' ? like.message : '未知数据库错误';
  const message = redactSecrets(rawMessage, context.secretValues).slice(0, 500);
  const details: Record<string, unknown> = {
    ...(context.connectionId === undefined ? {} : { connectionId: context.connectionId }),
    ...(code === undefined ? {} : { mysqlCode: code }),
    ...(errno === undefined ? {} : { mysqlErrno: errno }),
    ...(sqlState === undefined ? {} : { sqlState }),
    ...(context.phase === 'query' ? { phase: 'query' } : { phase: 'probe' }),
  };

  if (code !== undefined && AUTH_ERROR_CODES.has(code)) {
    return new AppError(ErrorCode.DATABASE_AUTH_FAILED, `数据库认证失败：${message}`, { details });
  }
  if (code !== undefined && NETWORK_ERROR_CODES.has(code)) {
    return new AppError(ErrorCode.NETWORK_UNREACHABLE, `数据库不可达：${message}`, { details });
  }
  if (code === 'ER_DBACCESS_DENIED_ERROR') {
    // At connect time this is an authorization failure; on an existing
    // connection it means the query touched a schema the account cannot read.
    return context.phase === 'probe'
      ? new AppError(ErrorCode.DATABASE_AUTH_FAILED, `数据库认证失败：${message}`, { details })
      : new AppError(ErrorCode.DATABASE_QUERY_BLOCKED, `数据库查询被拒绝：${message}`, {
          details: { ...details, reason: 'permission_denied' },
        });
  }
  if (code !== undefined && (code === 'ER_CON_COUNT_ERROR' || code === 'ER_TOO_MANY_USER_CONNECTIONS')) {
    return new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, '数据库连接数已满', { details: { ...details, reason: 'too_many_connections' } });
  }
  if (code !== undefined && QUERY_TIMEOUT_ERROR_CODES.has(code)) {
    return new AppError(ErrorCode.DATABASE_QUERY_BLOCKED, '数据库查询超时，已终止', {
      details: { ...details, reason: 'query_timeout', ...(context.timeoutMs === undefined ? {} : { timeoutMs: context.timeoutMs }) },
    });
  }
  if (code !== undefined && LOCK_ERROR_CODES.has(code)) {
    return new AppError(ErrorCode.DATABASE_QUERY_BLOCKED, '数据库锁等待失败，请降慢查询范围后重试', {
      details: { ...details, reason: 'lock_conflict' },
    });
  }
  if (code !== undefined && PERMISSION_ERROR_CODES.has(code)) {
    return new AppError(ErrorCode.DATABASE_QUERY_BLOCKED, `数据库查询被拒绝：${message}`, {
      details: { ...details, reason: 'permission_denied' },
    });
  }
  if (code !== undefined && SYNTAX_ERROR_CODES.has(code)) {
    return new AppError(ErrorCode.VALIDATION_FAILED, `SQL 无法执行：${message}`, {
      details: { ...details, reason: 'invalid_sql' },
    });
  }
  if (code !== undefined && /TIMEOUT|ETIMEDOUT/i.test(code)) {
    return new AppError(ErrorCode.NETWORK_UNREACHABLE, '数据库连接超时', {
      details: { ...details, reason: 'timeout', ...(context.timeoutMs === undefined ? {} : { timeoutMs: context.timeoutMs }) },
    });
  }
  return new AppError(ErrorCode.INTERNAL_ERROR, '数据库执行失败', {
    details: { ...details, reason: 'driver_error', mysqlMessage: message },
  });
}

/** Map a stable error code to the connection state shown in the UI. */
export function stateFromErrorCode(code: ErrorCodeValue): DatabaseConnectionStateValue {
  switch (code) {
    case ErrorCode.DATABASE_AUTH_FAILED:
      return DatabaseConnectionState.AUTH_FAILED;
    case ErrorCode.NETWORK_UNREACHABLE:
    case ErrorCode.CAPABILITY_UNAVAILABLE:
      return DatabaseConnectionState.UNREACHABLE;
    case ErrorCode.DATABASE_NOT_CONFIGURED:
      return DatabaseConnectionState.NOT_CONFIGURED;
    default:
      return DatabaseConnectionState.UNREACHABLE;
  }
}

/**
 * Remove password material from driver/HTTP messages. Both known secret values
 * (when length >= 4) and common key/value shapes are replaced.
 */
export function redactSecrets(text: string, secretValues: readonly string[] = []): string {
  let output = text;
  for (const secret of secretValues) {
    if (typeof secret !== 'string' || secret.length < 4) continue;
    output = output.split(secret).join('[redacted]');
  }
  return output
    .replace(/(mysql|mariadb):\/\/[^@\s/]+@/gi, '$1://[redacted]@')
    .replace(/((?:password|passwd|pwd)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]')
    .replace(/("(?:password|passwd|pwd)"\s*:\s*")[^"]+(")/gi, '$1[redacted]$2');
}

/** Detect a timeout-ish driver error so callers can attach extra context. */
export function looksLikeTimeout(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as MySqlErrorLike).code;
  const message = (error as MySqlErrorLike).message;
  if (typeof code === 'string' && /TIMEOUT/i.test(code)) return true;
  return typeof message === 'string' && /timed? ?out|timeout/i.test(message);
}
