import { createParser, type EventSourceMessage } from 'eventsource-parser';
import type {
  OpenCodeConfigInput,
  OpenCodeEvent,
  OpenCodeMessage,
  OpenCodeModelRef,
  OpenCodeSession,
  PromptInput,
} from './types.ts';

export class OpenCodeHttpError extends Error {
  readonly status: number;
  readonly body: string;
  readonly path: string;

  constructor(path: string, status: number, body: string) {
    super(`OpenCode ${status} ${path}: ${redact(body).slice(0, 300)}`);
    this.name = 'OpenCodeHttpError';
    this.status = status;
    this.body = redact(body);
    this.path = path;
  }
}

function redact(text: string): string {
  return text
    .replace(/(st_[A-Za-z0-9-]{8,})/g, '[key]')
    .replace(/(sk-[A-Za-z0-9-]{8,})/g, '[key]')
    .replace(/("apiKey"\s*:\s*")[^"]+(")/g, '$1[redacted]$2')
    .replace(/(Authorization[^:]*:\s*)[^\s",]+/gi, '$1[redacted]');
}

/**
 * Direct HTTP client for the managed local OpenCode server. All credentials stay
 * inside the service; response bodies that may contain provider keys are not
 * exposed to callers other than the methods they explicitly ask for.
 */
export class OpenCodeClient {
  readonly baseUrl: string;
  readonly #password: string;
  readonly #timeoutMs: number;

  constructor(baseUrl: string, password: string, timeoutMs = 30000) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.#password = password;
    this.#timeoutMs = timeoutMs;
  }

  #headers(extra: Record<string, string> = {}): Record<string, string> {
    const auth = Buffer.from(`opencode:${this.#password}`).toString('base64');
    return { authorization: `Basic ${auth}`, ...extra };
  }

  async request<T>(path: string, init: RequestInit = {}, timeoutMs = this.#timeoutMs): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: this.#headers({
          ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(init.headers as Record<string, string> | undefined),
        }),
      });
      const text = await response.text();
      if (!response.ok) throw new OpenCodeHttpError(path, response.status, text);
      if (text.length === 0) return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as unknown as T;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  health(): Promise<{ healthy: boolean; version: string }> {
    return this.request('/global/health');
  }

  config(): Promise<Record<string, unknown>> {
    return this.request('/config');
  }

  mcpStatus(): Promise<Record<string, { status: string }>> {
    return this.request('/mcp');
  }

  createSession(input: { title?: string; metadata?: Record<string, unknown>; model?: { id: string; providerID: string }; agent?: string; permission?: unknown } = {}): Promise<OpenCodeSession> {
    return this.request('/session', { method: 'POST', body: JSON.stringify(input) });
  }

  getSession(sessionId: string): Promise<OpenCodeSession> {
    return this.request(`/session/${encodeURIComponent(sessionId)}`);
  }

  listSessions(): Promise<readonly OpenCodeSession[]> {
    return this.request('/session');
  }

  updateSession(sessionId: string, patch: Record<string, unknown>): Promise<OpenCodeSession> {
    return this.request(`/session/${encodeURIComponent(sessionId)}`, { method: 'PATCH', body: JSON.stringify(patch) });
  }

  async promptAsync(sessionId: string, input: PromptInput): Promise<void> {
    const body: Record<string, unknown> = {
      model: input.model,
      parts: [{ type: 'text', text: input.text }],
      agent: input.agent,
    };
    if (input.system !== undefined) body.system = input.system;
    if (input.tools !== undefined) body.tools = input.tools;
    if (input.messageId !== undefined) body.messageID = input.messageId;
    if (input.jsonSchema !== undefined) body.format = { type: 'json_schema', schema: input.jsonSchema, retryCount: 1 };
    await this.request(`/session/${encodeURIComponent(sessionId)}/prompt_async`, { method: 'POST', body: JSON.stringify(body) }, 60000);
  }

  async prompt(sessionId: string, input: PromptInput): Promise<OpenCodeMessage> {
    const body: Record<string, unknown> = {
      model: input.model,
      parts: [{ type: 'text', text: input.text }],
      agent: input.agent,
    };
    if (input.system !== undefined) body.system = input.system;
    if (input.tools !== undefined) body.tools = input.tools;
    if (input.jsonSchema !== undefined) body.format = { type: 'json_schema', schema: input.jsonSchema, retryCount: 1 };
    return this.request(`/session/${encodeURIComponent(sessionId)}/message`, { method: 'POST', body: JSON.stringify(body) }, 600000);
  }

  messages(sessionId: string, limit?: number): Promise<readonly OpenCodeMessage[]> {
    return this.request(`/session/${encodeURIComponent(sessionId)}/message${limit === undefined ? '' : `?limit=${limit}`}`);
  }

  abort(sessionId: string): Promise<boolean> {
    return this.request(`/session/${encodeURIComponent(sessionId)}/abort`, { method: 'POST', body: '{}' }, 15000);
  }

  async replyPermission(requestId: string, reply: 'once' | 'always' | 'reject', message?: string): Promise<boolean> {
    const body: Record<string, unknown> = { reply };
    if (message !== undefined) body.message = message;
    return this.request(`/permission/${encodeURIComponent(requestId)}/reply`, { method: 'POST', body: JSON.stringify(body) });
  }

  listPermissions(): Promise<readonly Record<string, unknown>[]> {
    return this.request('/permission');
  }

  setModel(sessionId: string, model: OpenCodeModelRef): Promise<unknown> {
    return this.request(`/session/${encodeURIComponent(sessionId)}/model`, { method: 'POST', body: JSON.stringify(model) });
  }

  /** Server-sent event stream. Yields decoded events until the signal aborts. */
  async *events(signal: AbortSignal): AsyncGenerator<OpenCodeEvent> {
    const response = await fetch(`${this.baseUrl}/event`, {
      headers: this.#headers({ accept: 'text/event-stream' }),
      signal,
    });
    if (!response.ok || response.body === null) throw new OpenCodeHttpError('/event', response.status, await response.text());
    const queue: OpenCodeEvent[] = [];
    let notify: (() => void) | undefined;
    let closed = false;
    let failure: unknown;
    const parser = createParser({
      onEvent: (event: EventSourceMessage) => {
        try {
          const parsed = JSON.parse(event.data) as { type?: string; properties?: Record<string, unknown> };
          if (typeof parsed.type === 'string') queue.push({ type: parsed.type, properties: parsed.properties ?? {} });
        } catch {
          // Ignore malformed frames; the stream is advisory.
        }
        notify?.();
      },
    });
    const pump = (async () => {
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          parser.feed(decoder.decode(value, { stream: true }));
        }
      } catch (error) {
        if (!signal.aborted) failure = error;
      } finally {
        closed = true;
        notify?.();
      }
    })();
    try {
      while (!closed || queue.length > 0) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            notify = () => {
              notify = undefined;
              resolve();
            };
          });
          continue;
        }
        yield queue.shift()!;
      }
      if (failure !== undefined) throw failure;
    } finally {
      await pump.catch(() => undefined);
    }
  }
}

export function buildConfig(input: OpenCodeConfigInput): Record<string, unknown> {
  const config: Record<string, unknown> = {
    $schema: 'https://opencode.ai/config.json',
    autoupdate: false,
    model: `${input.model.providerID}/${input.model.modelID}`,
    small_model: `${input.model.providerID}/${input.model.modelID}`,
    ...(input.mcp === undefined ? {} : { mcp: input.mcp }),
    ...(input.permission === undefined ? {} : { permission: input.permission }),
    ...(input.agent === undefined ? {} : { agent: input.agent }),
    ...(input.instructions === undefined ? {} : { instructions: input.instructions }),
    ...(input.extra ?? {}),
  };
  return config;
}
