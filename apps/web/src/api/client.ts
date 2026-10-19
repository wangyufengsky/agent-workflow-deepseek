import { commandScope, pendingCommands, pendingForScope, rememberCommand, settleCommand } from './pending-commands.ts';
import {
  ROUTES,
  EventType,
  type ApiEnvelope,
  type ApiErrorResponse,
  type AppEventEnvelope,
  type ErrorCodeValue,
} from '@agent-workflow/shared';

/** Why a request failed. `unavailable`/`timeout` mean "the local service did not answer". */
export type ApiFailureKind = 'unavailable' | 'timeout' | 'http' | 'protocol';

export class ApiClientError extends Error {
  readonly kind: ApiFailureKind;
  readonly status: number | null;
  readonly code: ErrorCodeValue | null;
  readonly requestId: string | null;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | null;

  constructor(input: {
    kind: ApiFailureKind;
    message: string;
    status?: number | null;
    code?: ErrorCodeValue | null;
    requestId?: string | null;
    retryable?: boolean;
    details?: Record<string, unknown> | null;
  }) {
    super(input.message);
    this.name = 'ApiClientError';
    this.kind = input.kind;
    this.status = input.status ?? null;
    this.code = input.code ?? null;
    this.requestId = input.requestId ?? null;
    this.retryable = input.retryable ?? false;
    this.details = input.details ?? null;
  }
}

/** True when the UI must say「服务未连接」instead of showing data. */
export function isServiceUnavailable(error: unknown): boolean {
  if (!(error instanceof ApiClientError)) return false;
  if (error.kind === 'unavailable' || error.kind === 'timeout') return true;
  return error.kind === 'http' && (error.status ?? 0) >= 500;
}

export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return '未知错误';
}

export interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly timeoutMs?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 12_000;

function parseErrorPayload(payload: unknown): ApiErrorResponse['error'] | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const candidate = (payload as { error?: unknown }).error;
  if (typeof candidate !== 'object' || candidate === null) return null;
  const record = candidate as Record<string, unknown>;
  if (typeof record.message !== 'string') return null;
  return candidate as ApiErrorResponse['error'];
}

function isEnvelope(value: unknown): value is ApiEnvelope<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    'meta' in value &&
    typeof (value as { meta?: unknown }).meta === 'object' &&
    (value as { meta?: unknown }).meta !== null
  );
}

/**
 * Single fetch wrapper for the application service.
 * - unwraps `{ data, meta }` envelopes,
 * - turns `{ error }` responses into ApiClientError,
 * - classifies connection failures/timeouts as `unavailable`/`timeout` so the UI
 *   can show the explicit「服务未连接」state instead of fabricating data.
 */
async function performRequest<T>(path: string, options: RequestOptions = {}): Promise<ApiEnvelope<T>> {
  const readOnly = options.method === undefined || options.method === 'GET';
  const controller = new AbortController();
  let timedOut = false;
  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onExternalAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onExternalAbort);

  let response: Response;
  let rawText: string;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      credentials: 'same-origin',
    });
    rawText = await response.text();
  } catch (error) {
    if (timedOut) {
      throw new ApiClientError({
        kind: 'timeout',
        message: readOnly ? '本地服务响应超时，可重新读取。' : '本地服务响应超时，操作结果尚未确认。请按原请求核对结果，不要重新提交。',
        retryable: readOnly,
      });
    }
    if (options.signal?.aborted) throw error;
    throw new ApiClientError({
      kind: 'unavailable',
      message: readOnly ? '无法连接本地服务，请确认服务已启动后重新读取。' : '连接已中断，操作结果尚未确认。服务恢复后请按原请求核对结果，不要重新提交。',
      retryable: readOnly,
    });
  } finally {
    globalThis.clearTimeout(timer);
    options.signal?.removeEventListener('abort', onExternalAbort);
  }

  let payload: unknown = null;
  if (rawText.length > 0) {
    try {
      payload = JSON.parse(rawText) as unknown;
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const parsed = parseErrorPayload(payload);
    if (parsed !== null) {
      throw new ApiClientError({
        kind: 'http',
        status: response.status,
        message: parsed.message,
        code: parsed.code,
        requestId: parsed.requestId,
        retryable: parsed.retryable,
        details: parsed.details ?? null,
      });
    }
    throw new ApiClientError({
      kind: response.status >= 500 ? 'unavailable' : 'http',
      status: response.status,
      message:
        response.status >= 500
          ? '本地服务暂时不可用，请确认服务已启动后重试。'
          : `请求失败（HTTP ${String(response.status)}）。`,
      retryable: response.status >= 500,
    });
  }

  if (!isEnvelope(payload)) {
    throw new ApiClientError({
      kind: 'protocol',
      status: response.status,
      message: '服务返回的数据格式无法识别，请确认前后端版本一致。',
    });
  }
  return payload as ApiEnvelope<T>;
}

/** A missing response to a write is not proof that the write failed. */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiEnvelope<T>> {
  const scope = commandScope(path);
  const body = options.body as { requestKey?: unknown } | undefined;
  const key = typeof body?.requestKey === 'string' ? body.requestKey : undefined;
  const tracked = scope !== undefined && key !== undefined && options.method !== undefined && options.method !== 'GET';
  if (tracked) {
    const pending = pendingCommands().find((v) => v.scope === scope && (v.phase !== 'accepted' || v.path === path));
    if (pending !== undefined) throw new ApiClientError({ kind: 'protocol', message: `操作结果待核对，请核对原请求号 ${pending.requestKey}，不会重复提交。`, details: { requestKey: pending.requestKey } });
    rememberCommand({ scope, path, requestKey: key });
  }
  try {
    const response = await performRequest<T>(path, options);
    const data = response.data as { receipt?: { status?: string }; operation?: { requestKey: string; status: string } };
    if (tracked && data?.receipt?.status === 'accepted') rememberCommand({ scope, path, requestKey: key, phase: 'accepted' });
    if (tracked && (data?.receipt?.status === 'succeeded' || data?.receipt?.status === 'failed')) settleCommand(key);
    else if (tracked && data?.receipt?.status !== 'accepted' && data?.receipt?.status !== 'unknown') {
      throw new ApiClientError({ kind: 'protocol', message: '写操作响应缺少确定回执，保留原请求号。' });
    }
    if ((options.method === undefined || options.method === 'GET') && path.startsWith('/api/operations/')) {
      const operation = data?.operation;
      if (operation !== undefined && path === ROUTES.operationsByKey(operation.requestKey) && (operation.status === 'succeeded' || operation.status === 'failed')) settleCommand(operation.requestKey);
    }
    return response;
  } catch (error) {
    // Structured client rejection proves no operation was accepted. A server error,
    // unreadable success body, or transport failure may follow a committed write.
    if (tracked && error instanceof ApiClientError && error.kind === 'http' && error.status !== null && error.status < 500 && error.code !== null && !/UNKNOWN|IN_PROGRESS/.test(error.code)) settleCommand(key);
    if (tracked && pendingForScope(scope) !== undefined) throw new ApiClientError({ kind: 'protocol', message: `结果待核对：${errorMessage(error)} 原请求号 ${key}。`, details: { requestKey: key } });
    throw error;
  }
}

export function apiGet<T>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<ApiEnvelope<T>> {
  return request<T>(path, { ...options, method: 'GET' });
}

export function apiPost<T>(path: string, body: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<ApiEnvelope<T>> {
  return request<T>(path, { ...options, method: 'POST', body });
}

/* ------------------------------------------------------------------ */
/* SSE                                                                 */
/* ------------------------------------------------------------------ */

export interface EventStreamOptions {
  readonly onEvent?: (event: AppEventEnvelope) => void;
  readonly onError?: (error: Event) => void;
  readonly lastEventId?: number;
}

export interface EventStreamHandle {
  close(): void;
}

const EVENT_NAMES: readonly string[] = Object.values(EventType);

/**
 * Thin EventSource wrapper for /api/events. The caller owns reconnect policy:
 * a closed stream surfaces through `onError`; pages can refetch on demand.
 */
export function openEventStream(options: EventStreamOptions = {}): EventStreamHandle {
  const query = options.lastEventId === undefined ? '' : `?lastEventId=${String(options.lastEventId)}`;
  const source = new EventSource(`${ROUTES.events}${query}`);

  const handleData = (raw: MessageEvent<string>) => {
    if (options.onEvent === undefined) return;
    try {
      const parsed = JSON.parse(raw.data) as AppEventEnvelope;
      options.onEvent(parsed);
    } catch {
      // A malformed event must not take down the page; the next event or a
      // manual refresh will reconcile state.
    }
  };

  source.addEventListener('message', handleData as EventListener);
  for (const name of EVENT_NAMES) {
    source.addEventListener(name, handleData as EventListener);
  }
  if (options.onError !== undefined) {
    source.addEventListener('error', options.onError);
  }

  return {
    close() {
      source.close();
    },
  };
}
