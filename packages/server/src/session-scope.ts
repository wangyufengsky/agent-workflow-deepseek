import { randomBytes } from 'node:crypto';
import { AppError, ErrorCode } from '@agent-workflow/shared';
import type { OpenCodeRunRequest } from '@agent-workflow/engine';

export interface SessionScope {
  readonly request: OpenCodeRunRequest;
  readonly expiresAt: number;
}
const activeScopes = new Map<string, SessionScope>();

export function createSessionScope(request: OpenCodeRunRequest): { token: string; revoke(): void } {
  const token = randomBytes(32).toString('base64url');
  activeScopes.set(token, { request: { ...request, metadata: { ...request.metadata }, ...(request.rolePolicy === undefined ? {} : { rolePolicy: structuredClone(request.rolePolicy) }) }, expiresAt: Date.now() + request.timeoutMs + 30_000 });
  return { token, revoke: () => { activeScopes.delete(token); } };
}

export function requireSessionScope(token: unknown): SessionScope {
  const scope = typeof token === 'string' ? activeScopes.get(token) : undefined;
  if (scope === undefined || scope.expiresAt <= Date.now()) {
    if (typeof token === 'string') activeScopes.delete(token);
    throw new AppError(ErrorCode.FORBIDDEN, '会话授权不存在、已结束或已过期');
  }
  return scope;
}
