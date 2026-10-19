import type { OpenCodeClient, OpenCodeHttpError } from './client.ts';
import type { OpenCodeMessage, OpenCodePart, PromptInput } from './types.ts';

export type PermissionDecision = 'once' | 'always' | 'reject';

export interface SessionSink {
  onTextDelta?(delta: string, info: { messageId: string; partId: string }): void;
  onTextEnded?(text: string, info: { messageId: string; partId: string }): void;
  onReasoningDelta?(delta: string): void;
  onTool?(part: OpenCodePart, status: 'called' | 'success' | 'failed' | 'progress'): void;
  onPermission?(permission: PermissionRequest): PermissionDecision | Promise<PermissionDecision>;
  onError?(message: string): void;
  onIdle?(): void;
}

export interface PermissionRequest {
  readonly id: string;
  readonly sessionID: string;
  readonly permission: string;
  readonly patterns: readonly string[];
  readonly metadata?: Record<string, unknown>;
}

export interface RunPromptOptions {
  readonly timeoutMs: number;
  readonly abortOnEvent?: (event: { type: string; properties: Record<string, unknown> }) => boolean;
  readonly abortGraceMs?: number;
}

export interface PromptOutcome {
  readonly idle: boolean;
  readonly timedOut: boolean;
  readonly error?: string;
  readonly assistantText: string;
  readonly messages: readonly OpenCodeMessage[];
}

/**
 * Runs one prompt on an OpenCode session while translating its SSE stream into
 * product events. It never infers success from text: completion is reported by
 * OpenCode's own message/idle events, and any error is returned explicitly.
 */
export class SessionRunner {
  readonly #client: OpenCodeClient;
  readonly #sessionId: string;
  readonly #sink: SessionSink;
  #abort: AbortController | undefined;
  #running = false;

  constructor(client: OpenCodeClient, sessionId: string, sink: SessionSink = {}) {
    this.#client = client;
    this.#sessionId = sessionId;
    this.#sink = sink;
  }

  get running(): boolean {
    return this.#running;
  }

  async run(input: PromptInput, options: RunPromptOptions): Promise<PromptOutcome> {
    if (this.#running) throw new Error('session runner already running');
    this.#running = true;
    const abort = new AbortController();
    this.#abort = abort;
    let idle = false;
    let timedOut = false;
    let error: string | undefined;
    let idleResolve: (() => void) | undefined;
    const idlePromise = new Promise<void>((resolve) => {
      idleResolve = resolve;
    });
    let sawEventToAbort = false;
    let graceTimer: NodeJS.Timeout | undefined;

    const consume = (async () => {
      try {
        for await (const event of this.#client.events(abort.signal)) {
          const properties = event.properties;
          const sessionId = typeof properties.sessionID === 'string' ? properties.sessionID : typeof properties.sessionId === 'string' ? properties.sessionId : undefined;
          if (sessionId !== undefined && sessionId !== this.#sessionId) continue;
          if (event.type === 'session.next.text.delta') {
            const delta = typeof properties.delta === 'string' ? properties.delta : '';
            const messageId = String(properties.assistantMessageID ?? '');
            const partId = String(properties.textID ?? '');
            if (delta) this.#sink.onTextDelta?.(delta, { messageId, partId });
          } else if (event.type === 'session.next.reasoning.delta') {
            const delta = typeof properties.delta === 'string' ? properties.delta : '';
            if (delta) this.#sink.onReasoningDelta?.(delta);
          } else if (event.type === 'session.next.text.ended') {
            const text = typeof properties.text === 'string' ? properties.text : '';
            this.#sink.onTextEnded?.(text, {
              messageId: String(properties.assistantMessageID ?? properties.messageID ?? ''),
              partId: String(properties.textID ?? properties.partID ?? ''),
            });
          } else if (event.type === 'session.next.tool.called') {
            this.#sink.onTool?.(toPart(properties), 'called');
          } else if (event.type === 'session.next.tool.success') {
            this.#sink.onTool?.(toPart(properties), 'success');
          } else if (event.type === 'session.next.tool.failed') {
            this.#sink.onTool?.(toPart(properties), 'failed');
          } else if (event.type === 'session.next.tool.progress') {
            this.#sink.onTool?.(toPart(properties), 'progress');
          } else if (event.type === 'permission.asked' || event.type === 'permission.v2.asked') {
            const request = toPermission(properties, this.#sessionId, event.type === 'permission.v2.asked');
            const decision = request === undefined ? 'reject' : ((await this.#sink.onPermission?.(request)) ?? 'reject');
            try {
              await this.#client.replyPermission(request!.id, decision);
            } catch {
              // A missing permission request is not fatal for the session.
            }
          } else if (event.type === 'session.error') {
            const info = properties.error as { message?: string; name?: string } | undefined;
            error = info?.message ?? info?.name ?? 'OpenCode 会话错误';
            this.#sink.onError?.(error);
          } else if (event.type === 'session.idle') {
            idle = true;
            this.#sink.onIdle?.();
            idleResolve?.();
            break;
          }
          if (!sawEventToAbort && options.abortOnEvent?.(event) === true) {
            sawEventToAbort = true;
            graceTimer = setTimeout(() => abort.abort(), options.abortGraceMs ?? 1500);
          }
        }
      } catch (caught) {
        if (!abort.signal.aborted) {
          error = caught instanceof Error ? caught.message : '事件流中断';
          this.#sink.onError?.(error);
        }
      } finally {
        idleResolve?.();
      }
    })();

    try {
      await this.#client.promptAsync(this.#sessionId, input);
      const timeout = new Promise<void>((resolve) => {
        setTimeout(() => {
          timedOut = true;
          resolve();
        }, options.timeoutMs);
      });
      await Promise.race([idlePromise, timeout]);
      if (timedOut && !idle) {
        await this.#client.abort(this.#sessionId).catch(() => undefined);
        abort.abort();
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : '发送提示失败';
    } finally {
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      const timer = setTimeout(() => abort.abort(), 5000);
      try {
        await Promise.race([consume, new Promise((resolve) => setTimeout(resolve, 5000))]);
      } finally {
        clearTimeout(timer);
        abort.abort();
        this.#abort = undefined;
        this.#running = false;
      }
    }

    const messages = await this.#client.messages(this.#sessionId).catch(() => []);
    const assistantText = collectAssistantText(messages);
    return { idle, timedOut, error, assistantText, messages };
  }

  async abort(): Promise<void> {
    this.#abort?.abort();
    await this.#client.abort(this.#sessionId).catch(() => undefined);
  }
}

function toPermission(properties: Record<string, unknown>, sessionId: string, v2: boolean): PermissionRequest | undefined {
  const id = typeof properties.id === 'string' ? properties.id : typeof properties.permissionID === 'string' ? properties.permissionID : undefined;
  if (id === undefined) return undefined;
  const patterns = Array.isArray(properties.patterns) ? properties.patterns.filter((value): value is string => typeof value === 'string') : [];
  return {
    id,
    sessionID: typeof properties.sessionID === 'string' ? properties.sessionID : sessionId,
    permission: typeof properties.permission === 'string' ? properties.permission : v2 ? 'unknown' : 'unknown',
    patterns,
    metadata: typeof properties.metadata === 'object' && properties.metadata !== null ? (properties.metadata as Record<string, unknown>) : undefined,
  };
}

function toPart(properties: Record<string, unknown>): OpenCodePart {
  const part = properties.part;
  if (typeof part === 'object' && part !== null) return part as OpenCodePart;
  return {
    type: 'tool',
    tool: typeof properties.tool === 'string' ? properties.tool : typeof properties.name === 'string' ? properties.name : undefined,
    callID: typeof properties.callID === 'string' ? properties.callID : typeof properties.callId === 'string' ? properties.callId : undefined,
    state: {
      status: typeof properties.status === 'string' ? properties.status : undefined,
      input: typeof properties.input === 'object' && properties.input !== null ? (properties.input as Record<string, unknown>) : undefined,
      output: typeof properties.output === 'string' ? properties.output : undefined,
      error: typeof properties.error === 'string' ? properties.error : undefined,
    },
  };
}

export function collectAssistantText(messages: readonly OpenCodeMessage[]): string {
  return messages
    .filter((message) => message.info.role === 'assistant')
    .flatMap((message) => message.parts.filter((part) => part.type === 'text').map((part) => part.text ?? ''))
    .join('');
}

export function lastAssistantMessage(messages: readonly OpenCodeMessage[]): OpenCodeMessage | undefined {
  return [...messages].reverse().find((message) => message.info.role === 'assistant');
}

export type { OpenCodeHttpError };
