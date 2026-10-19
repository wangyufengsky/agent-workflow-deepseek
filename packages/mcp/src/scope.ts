import { AsyncLocalStorage } from 'node:async_hooks';

/** One MCP transport serves concurrent sessions; never store call authority globally. */
const scope = new AsyncLocalStorage<string | undefined>();
export function withScopeToken<T>(token: string | undefined, fn: () => T): T { return scope.run(token, fn); }
export function currentScopeToken(): string | undefined { return scope.getStore(); }
