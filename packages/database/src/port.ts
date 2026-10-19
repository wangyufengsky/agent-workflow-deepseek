import type { DatabaseConnectionConfig } from '@agent-workflow/shared';
import type { DatabaseService } from './service.ts';

/**
 * Structural adapter for the engine's `DatabasePort`. Keeping this here lets
 * `packages/server` wire `DatabaseService` without importing mysql2 or knowing
 * how driver errors are mapped; the shape matches `packages/engine/src/ports.ts`.
 */
export interface DatabasePortProbeResult {
  readonly state: string;
  readonly serverVersion?: string;
  readonly latencyMs?: number;
  readonly message?: string;
}

export interface DatabasePort {
  probe(connectionId: string): Promise<DatabasePortProbeResult>;
  query(connectionId: string, sql: string, limit?: number, config?: DatabaseConnectionConfig): Promise<unknown>;
}

export interface DatabasePortOptions {
  /** Default per-query timeout; falls back to the service settings. */
  readonly timeoutMs?: number;
}

export function createDatabasePort(service: DatabaseService, options: DatabasePortOptions = {}): DatabasePort {
  return {
    async probe(connectionId) {
      // Never throws for database failures: the UI needs state + message instead.
      const result = await service.tryProbe(connectionId);
      return {
        state: result.state,
        ...(result.serverVersion === undefined ? {} : { serverVersion: result.serverVersion }),
        ...(result.latencyMs === undefined ? {} : { latencyMs: result.latencyMs }),
        ...(result.message === undefined ? {} : { message: result.message }),
        capabilities: result.capabilities,
      };
    },
    query(connectionId, sql, limit, config) {
      return service.queryReadOnly(connectionId, sql, {
        ...(config === undefined ? {} : { config }),
        ...(limit === undefined ? {} : { limit }),
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      });
    },
  };
}
