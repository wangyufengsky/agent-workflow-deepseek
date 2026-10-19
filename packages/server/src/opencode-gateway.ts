import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, ErrorCode, nowIso } from '@agent-workflow/shared';

export interface ProviderGatewayOptions {
  readonly secret: string;
  readonly upstreamBaseUrl: string;
  readonly stripToolChoiceForModels: readonly string[];
  readonly requestTimeoutMs: number;
  readonly logPath: string;
}

export interface ProviderGatewayStats {
  readonly enabled: true;
  readonly requests: number;
  readonly normalized: number;
  readonly lastRequestAt?: string;
  readonly lastError?: string;
}

const FORWARD_HEADERS = [
  'authorization',
  'x-opencode-org-id',
  'x-opencode-client',
  'x-opencode-project',
  'x-opencode-request',
  'x-opencode-session',
  'x-opencode-session-id',
  'user-agent',
  'accept',
  'content-type',
];

/**
 * Loopback OpenAI-compatible compatibility gateway.
 *
 * Why it exists: OpenCode 1.19 always sends `tool_choice` when MCP tools are
 * present. The OpenCode Go flash model runs in thinking mode and its upstream
 * rejects any tool_choice (even "auto") with "Thinking mode does not support
 * this tool_choice". Removing that one field keeps thinking + MCP tools working;
 * this has been verified against the real provider endpoint.
 *
 * The gateway forwards auth headers untouched, never persists prompts or tokens,
 * only records metadata for diagnostics, and only listens behind the app's
 * loopback HTTP server under a per-start secret path.
 */
export function registerProviderGateway(app: FastifyInstance, options: ProviderGatewayOptions): { stats: () => ProviderGatewayStats } {
  const counters = { requests: 0, normalized: 0, lastRequestAt: undefined as string | undefined, lastError: undefined as string | undefined };
  mkdirSync(dirname(options.logPath), { recursive: true });

  const log = (entry: Record<string, unknown>) => {
    try {
      appendFileSync(options.logPath, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch {
      // Diagnostics logging must never fail the request.
    }
  };

  app.all('/api/opencode/gateway/:secret/v1/*', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { secret?: string; '*'?: string };
    if (params.secret !== options.secret) {
      throw new AppError(ErrorCode.NOT_FOUND, '未知网关路径');
    }
    const wildcard = params['*'] ?? '';
    if (wildcard.includes('..')) throw new AppError(ErrorCode.VALIDATION_FAILED, '网关路径不合法');
    const queryIndex = request.url.indexOf('?');
    const query = queryIndex >= 0 ? request.url.slice(queryIndex) : '';
    const upstreamUrl = `${options.upstreamBaseUrl.replace(/\/$/, '')}/${wildcard}${query}`;

    const original = (request.body ?? {}) as Record<string, unknown>;
    const model = typeof original.model === 'string' ? original.model : '';
    const toolCount = Array.isArray(original.tools) ? original.tools.length : 0;
    const shouldStrip = toolCount > 0 && options.stripToolChoiceForModels.includes(model) && Object.hasOwn(original, 'tool_choice');
    const payload: Record<string, unknown> = shouldStrip ? { ...original } : original;
    if (shouldStrip) delete payload.tool_choice;

    counters.requests += 1;
    counters.normalized += shouldStrip ? 1 : 0;
    counters.lastRequestAt = nowIso();

    const headers: Record<string, string> = {};
    for (const name of FORWARD_HEADERS) {
      const value = request.headers[name];
      if (typeof value === 'string' && value !== '') headers[name] = value;
    }
    headers['accept-encoding'] = 'identity';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.requestTimeoutMs);
    const startedAt = Date.now();
    let status = 0;
    try {
      const upstream = await fetch(upstreamUrl, {
        method: request.method,
        headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : JSON.stringify(payload),
        signal: controller.signal,
      });
      status = upstream.status;
      log({ at: nowIso(), model, toolCount, normalized: shouldStrip ? ['tool_choice'] : [], status, durationMs: Date.now() - startedAt });
      reply.hijack();
      reply.raw.on('close', () => {
        if (!reply.raw.writableEnded) controller.abort();
      });
      reply.raw.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-agent-workflow-gateway': '1',
      });
      if (upstream.body !== null) {
        const reader = upstream.body.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!reply.raw.write(Buffer.from(value))) {
            await new Promise<void>((resolve) => reply.raw.once('drain', () => resolve()));
          }
        }
      }
      reply.raw.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : '网关转发失败';
      counters.lastError = message;
      log({ at: nowIso(), model, toolCount, normalized: shouldStrip ? ['tool_choice'] : [], status, error: message, durationMs: Date.now() - startedAt });
      if (!reply.raw.headersSent) {
        reply.status(status === 0 ? 502 : status).send({
          error: { message: `provider gateway: ${message}`, type: 'gateway_error' },
        });
      } else {
        reply.raw.end();
      }
    } finally {
      clearTimeout(timer);
    }
  });

  return {
    stats: () => ({
      enabled: true,
      requests: counters.requests,
      normalized: counters.normalized,
      lastRequestAt: counters.lastRequestAt,
      lastError: counters.lastError,
    }),
  };
}
