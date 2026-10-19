import { ErrorCode, isAppError, type ErrorCodeValue } from '@agent-workflow/shared';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/** Structured error the model receives from every failed tool call. */
export interface ToolErrorPayload {
  readonly code: ErrorCodeValue;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

const MAX_MESSAGE_LENGTH = 1000;

/**
 * Convert any thrown value into the stable MCP error envelope. Stack traces and
 * unknown library messages are never forwarded; `AppError` details are already
 * redacted by the service layer.
 */
export function toToolErrorPayload(error: unknown): ToolErrorPayload {
  if (isAppError(error)) {
    return {
      code: error.code,
      message: truncate(error.message),
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }
  if (error instanceof Error) {
    return { code: ErrorCode.INTERNAL_ERROR, message: '工具执行失败', details: { errorName: error.name } };
  }
  return { code: ErrorCode.INTERNAL_ERROR, message: '工具执行失败', details: { errorType: typeof error } };
}

export function serializeToolPayload(payload: unknown, fallback: unknown = null): string {
  try {
    const text = JSON.stringify(payload === undefined ? fallback : payload);
    return text === undefined ? JSON.stringify(fallback) : text;
  } catch {
    return JSON.stringify({ code: ErrorCode.INTERNAL_ERROR, message: '结果无法序列化为 JSON' });
  }
}

/** MCP success result: one JSON text block with the service payload. */
export function toolSuccessResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: serializeToolPayload(value) }] };
}

/** MCP failure result: `isError: true` and a JSON `{code,message,details}` block. */
export function toolErrorResult(error: unknown): CallToolResult {
  const payload = toToolErrorPayload(error);
  return {
    isError: true,
    content: [{ type: 'text', text: serializeToolPayload(payload) }],
  };
}

function truncate(message: string): string {
  return message.length <= MAX_MESSAGE_LENGTH ? message : `${message.slice(0, MAX_MESSAGE_LENGTH)}…`;
}
