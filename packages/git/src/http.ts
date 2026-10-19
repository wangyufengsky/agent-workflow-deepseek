import { AppError, ErrorCode, type ErrorCodeValue } from '@agent-workflow/shared';
import { GIT_LIMITS } from './config.ts';
import { redactSecrets, safeHost } from './redact.ts';

/**
 * Minimal JSON-over-HTTP client shared by the GitHub and GitLab adapters.
 *
 * Security invariants:
 * - the token only ever travels in a request header;
 * - the token is never included in an error message or error details;
 * - responses are size-limits-free but only a short, redacted excerpt is kept;
 * - timeouts abort and map to `NETWORK_UNREACHABLE`.
 */

export type FetchLike = typeof fetch;

/** A literal token, or a resolver (e.g. a SecretStore lookup) run per request. */
export type TokenSource = string | (() => string | Promise<string>);

export type RemoteAuthStyle = 'bearer' | 'private-token';

export interface RemoteHttpClientOptions {
  readonly providerLabel: string;
  readonly apiBaseUrl: string;
  readonly token: TokenSource;
  readonly authStyle: RemoteAuthStyle;
  readonly notConfiguredCode: ErrorCodeValue;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  readonly userAgent?: string;
}

export interface RemoteJsonRequest {
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Path beginning with `/`, appended to `apiBaseUrl`. */
  readonly path: string;
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly body?: unknown;
  /** Optional per-status override, evaluated before generic mapping. */
  readonly mapStatus?: (status: number, parsedBody: unknown, text: string) => AppError | undefined;
}

export class RemoteHttpClient {
  readonly providerLabel: string;
  readonly apiBaseUrl: string;
  readonly #options: RemoteHttpClientOptions;
  readonly #fetch: FetchLike;

  constructor(options: RemoteHttpClientOptions) {
    if (typeof options.token !== 'string' && typeof options.token !== 'function') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '远程访问令牌必须来自构造参数或令牌提供函数');
    }
    this.#options = options;
    this.providerLabel = options.providerLabel;
    this.apiBaseUrl = normalizeBaseUrl(options.apiBaseUrl);
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
  }

  get hostDisplayName(): string {
    return safeHost(this.apiBaseUrl);
  }

  async #resolveToken(): Promise<string> {
    const source = this.#options.token;
    let token: string;
    try {
      token = typeof source === 'function' ? await source() : source;
    } catch {
      throw new AppError(this.#options.notConfiguredCode, `${this.providerLabel} 访问令牌不可用`, { details: { reason: 'token_source_failed' } });
    }
    if (typeof token !== 'string' || token.trim().length === 0) {
      throw new AppError(this.#options.notConfiguredCode, `${this.providerLabel} 未配置访问令牌`);
    }
    return token.trim();
  }

  #buildUrl(request: RemoteJsonRequest): string {
    const url = new URL(`${this.apiBaseUrl.replace(/\/$/, '')}${request.path.startsWith('/') ? request.path : `/${request.path}`}`);
    if (request.query !== undefined) {
      for (const [key, value] of Object.entries(request.query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  async requestJson<T>(request: RemoteJsonRequest): Promise<T> {
    const token = await this.#resolveToken();
    const url = this.#buildUrl(request);
    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': this.#options.userAgent ?? 'agent-workflow-git-adapter',
    };
    if (this.#options.authStyle === 'bearer') headers.authorization = `Bearer ${token}`;
    else headers['private-token'] = token;
    let bodyText: string | undefined;
    if (request.body !== undefined) {
      headers['content-type'] = 'application/json';
      bodyText = JSON.stringify(request.body);
    }

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: request.method,
        headers,
        body: bodyText,
        signal: AbortSignal.timeout(this.#options.timeoutMs ?? GIT_LIMITS.defaultRemoteTimeoutMs),
        redirect: 'follow',
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new AppError(ErrorCode.NETWORK_UNREACHABLE, timedOut ? `${this.providerLabel} 请求超时` : `${this.providerLabel} 网络不可达`, {
        details: { host: this.hostDisplayName, reason: timedOut ? 'timeout' : 'network_error' },
      });
    }

    if (response.status === 204) {
      try {
        await response.body?.cancel();
      } catch {
        // Body already consumed; nothing else to do.
      }
      return undefined as T;
    }

    let text = '';
    try {
      text = await response.text();
    } catch {
      text = '';
    }
    const parsed = parseJson(text);

    if (!response.ok) {
      const override = request.mapStatus?.(response.status, parsed, text);
      if (override !== undefined) throw override;
      throw this.#mapHttpError(response.status, parsed, text);
    }

    if (parsed === undefined) {
      throw new AppError(ErrorCode.UNSUPPORTED_FORMAT, `${this.providerLabel} 返回了非 JSON 响应`, {
        details: { status: response.status, host: this.hostDisplayName },
      });
    }
    return parsed as T;
  }

  #mapHttpError(status: number, parsed: unknown, text: string): AppError {
    const detail = extractErrorMessage(parsed, text);
    const safeDetail = detail === undefined ? '' : `：${redactSecrets(detail).slice(0, 300)}`;
    const baseDetails = { status, host: this.hostDisplayName, provider: this.providerLabel };
    if (status === 401 || status === 403) {
      return new AppError(ErrorCode.GITLAB_AUTH_FAILED, `${this.providerLabel} 鉴权失败（HTTP ${status}）${safeDetail}`, { details: baseDetails });
    }
    if (status === 404) {
      return new AppError(ErrorCode.NOT_FOUND, `${this.providerLabel} 资源不存在（HTTP 404）${safeDetail}`, { details: baseDetails });
    }
    if (status === 409) {
      return new AppError(ErrorCode.CONFLICT, `${this.providerLabel} 冲突（HTTP 409）${safeDetail}`, { details: baseDetails });
    }
    if (status === 422) {
      return new AppError(ErrorCode.VALIDATION_FAILED, `${this.providerLabel} 请求参数被拒绝（HTTP 422）${safeDetail}`, { details: baseDetails });
    }
    if (status === 429) {
      return new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, `${this.providerLabel} 触发限流（HTTP 429）`, { details: baseDetails });
    }
    if (status >= 500) {
      return new AppError(ErrorCode.NETWORK_UNREACHABLE, `${this.providerLabel} 服务不可用（HTTP ${status}）${safeDetail}`, { details: baseDetails });
    }
    return new AppError(ErrorCode.INTERNAL_ERROR, `${this.providerLabel} 请求失败（HTTP ${status}）${safeDetail}`, { details: baseDetails });
  }
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(ErrorCode.NOT_CONFIGURED, '远程服务地址无效');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new AppError(ErrorCode.NOT_CONFIGURED, '远程服务地址必须是 http(s)');
  }
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function parseJson(text: string): unknown {
  if (text.trim().length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function extractErrorMessage(parsed: unknown, text: string): string | undefined {
  const object = asObject(parsed);
  for (const key of ['message', 'error_description', 'error', 'detail']) {
    const value = object[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  const errors = object.errors;
  if (Array.isArray(errors)) {
    for (const entry of errors) {
      const message = asObject(entry).message;
      if (typeof message === 'string' && message.trim().length > 0) return message.trim();
    }
  }
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 500) : undefined;
}

/** Coerce an unknown JSON field to a display string. */
export function remoteString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : fallback;
}

/** Coerce an unknown JSON field to a finite number. */
export function remoteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Coerce an unknown JSON field to a boolean. */
export function remoteBoolean(value: unknown): boolean {
  return value === true;
}

/** Read a nested object field. */
export function remoteObject(value: unknown): Record<string, unknown> {
  return asObject(value);
}
