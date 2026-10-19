import { AppError, ErrorCode, type ErrorCodeValue } from '@agent-workflow/shared';

/**
 * Minimal HTTP client for the internal loopback API. Every response is expected
 * to use the `{data}` / `{error:{code,message,details}}` envelope; transport
 * failures become `MCP_NOT_AVAILABLE` so the model can distinguish "service is
 * down" from a rejected tool call.
 */
export interface InternalClientOptions {
  readonly baseUrl: string;
  readonly token?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  readonly query?: Record<string, unknown>;
  readonly body?: unknown;
  readonly timeoutMs?: number;
}

export const DEFAULT_INTERNAL_TIMEOUT_MS = 30_000;

const NETWORK_ERROR_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'ETIMEDOUT']);

export class InternalApiClient {
  readonly baseUrl: string;
  readonly #token: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: InternalClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.#token = options.token ?? '';
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_INTERNAL_TIMEOUT_MS;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
  }

  get<T>(path: string, query: Record<string, unknown> = {}): Promise<T> {
    return this.request<T>('GET', path, { query });
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, { body });
  }

  async request<T>(method: 'GET' | 'POST', path: string, options: RequestOptions = {}): Promise<T> {
    if (this.baseUrl.length === 0) {
      throw new AppError(ErrorCode.MCP_NOT_AVAILABLE, '内部服务地址未配置（AGENT_WORKFLOW_INTERNAL_URL）', {
        details: { reason: 'not_configured', path },
      });
    }
    const url = `${this.baseUrl}${ensureLeadingSlash(path)}${buildQueryString(options.query)}`;
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? this.#timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method,
        signal: controller.signal,
        headers: this.#headers(options.body !== undefined),
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch (error) {
      throw transportError(error, { method, path, timeoutMs });
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let body: unknown;
    try {
      body = parseJsonBody(text, { path, status: response.status });
    } catch (error) {
      // Error responses may be plain text; prefer the HTTP status mapping then.
      if (response.ok) throw error;
      body = undefined;
    }
    const envelopeError = readErrorEnvelope(body);
    if (envelopeError !== undefined) {
      throw toAppErrorFromEnvelope(envelopeError, { path, status: response.status });
    }
    if (!response.ok) {
      throw new AppError(statusToCode(response.status), `内部服务返回 ${response.status}`, {
        details: { path, status: response.status },
      });
    }
    if (isRecord(body) && 'data' in body) return body.data as T;
    throw new AppError(ErrorCode.INTERNAL_ERROR, '内部服务响应缺少 data 信封', {
      details: { path, status: response.status },
    });
  }

  #headers(hasBody: boolean): Record<string, string> {
    return {
      accept: 'application/json',
      'x-agent-workflow-client': 'mcp',
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      ...(this.#token.length > 0 ? { authorization: `Bearer ${this.#token}` } : {}),
    };
  }
}

export function buildQueryString(query: Record<string, unknown> | undefined): string {
  if (query === undefined) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) continue;
        params.append(key, String(item));
      }
      continue;
    }
    params.append(key, String(value));
  }
  const encoded = params.toString();
  return encoded.length === 0 ? '' : `?${encoded}`;
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed.length === 0) return '';
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'AGENT_WORKFLOW_INTERNAL_URL 必须是 http(s) 地址', {
      details: { field: 'AGENT_WORKFLOW_INTERNAL_URL' },
    });
  }
  return trimmed;
}

function ensureLeadingSlash(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function parseJsonBody(text: string, context: { path: string; status: number }): unknown {
  if (text.trim().length === 0) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError(ErrorCode.INTERNAL_ERROR, '内部服务响应不是合法 JSON', {
      details: { path: context.path, status: context.status },
    });
  }
}

interface EnvelopeError {
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

function readErrorEnvelope(body: unknown): EnvelopeError | undefined {
  if (!isRecord(body)) return undefined;
  const error = body.error;
  if (!isRecord(error)) return undefined;
  const code = typeof error.code === 'string' ? error.code : ErrorCode.INTERNAL_ERROR;
  const message = typeof error.message === 'string' && error.message.length > 0 ? error.message : '内部服务返回错误';
  const details = isRecord(error.details) ? error.details : undefined;
  return details === undefined ? { code, message } : { code, message, details };
}

const ERROR_CODE_VALUES: ReadonlySet<string> = new Set(Object.values(ErrorCode));

function toAppErrorFromEnvelope(error: EnvelopeError, context: { path: string; status: number }): AppError {
  // The service may return extended workspace codes (e.g. PATH_ESCAPE,
  // COMMAND_NOT_ALLOWED) that are not yet part of the shared ErrorCode union.
  // Preserve them for the model instead of flattening to INTERNAL_ERROR.
  const code: ErrorCodeValue = ERROR_CODE_VALUES.has(error.code)
    ? (error.code as ErrorCodeValue)
    : /^[A-Z][A-Z0-9_]{2,63}$/.test(error.code)
      ? (error.code as ErrorCodeValue)
      : ErrorCode.INTERNAL_ERROR;
  return new AppError(code, error.message, {
    details: { ...(error.details ?? {}), path: context.path, status: context.status },
  });
}

function statusToCode(status: number): ErrorCodeValue {
  switch (status) {
    case 400:
      return ErrorCode.VALIDATION_FAILED;
    case 401:
      return ErrorCode.UNAUTHORIZED;
    case 403:
      return ErrorCode.FORBIDDEN;
    case 404:
      return ErrorCode.NOT_FOUND;
    case 409:
      return ErrorCode.CONFLICT;
    case 429:
      return ErrorCode.BUDGET_EXCEEDED;
    case 503:
      return ErrorCode.CAPABILITY_UNAVAILABLE;
    default:
      return status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.VALIDATION_FAILED;
  }
}

function transportError(error: unknown, context: { method: string; path: string; timeoutMs: number }): AppError {
  if (isAbortError(error)) {
    return new AppError(ErrorCode.MCP_NOT_AVAILABLE, `内部服务请求超时（${context.timeoutMs}ms）`, {
      details: { reason: 'timeout', method: context.method, path: context.path },
    });
  }
  const code = errorCodeOf(error);
  return new AppError(ErrorCode.MCP_NOT_AVAILABLE, '内部服务不可达', {
    details: {
      reason: code !== undefined && NETWORK_ERROR_CODES.has(code) ? 'network' : 'transport',
      method: context.method,
      path: context.path,
      ...(code === undefined ? {} : { networkCode: code }),
    },
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || (error as Error & { code?: string }).code === 'ABORT_ERR');
}

function errorCodeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === 'string') return direct;
  const cause = (error as { cause?: { code?: unknown } }).cause;
  if (isRecord(cause) && typeof cause.code === 'string') return cause.code;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
