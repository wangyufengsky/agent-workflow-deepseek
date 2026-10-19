/** Runtime configuration for the MCP stdio process, read from the environment. */
export interface McpRuntimeConfig {
  /** Internal loopback base URL, e.g. `http://127.0.0.1:5177`. Empty means not configured. */
  readonly internalUrl: string;
  /** Bearer token for `/internal/mcp/*`; never written to logs. */
  readonly token: string;
  /** Sandbox root for workspace file/exec tools (`AGENT_WORKFLOW_WORKTREE`). */
  readonly worktreeRoot: string;
  readonly allowWrite: boolean;
  /** Command prefixes parsed from `AGENT_WORKFLOW_ALLOWED_COMMANDS`. */
  readonly allowedCommands: readonly string[];
  readonly requestTimeoutMs: number;
  readonly execTimeoutMs: number;
  readonly maxFileBytes: number;
  readonly maxListEntries: number;
  readonly maxOutputBytes: number;
  /** Enabled toolset prefixes (workflow / git / database / workspace). */
  readonly toolsets: readonly string[];
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_EXEC_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_FILE_BYTES = 512 * 1024;
export const DEFAULT_MAX_LIST_ENTRIES = 200;
export const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;

/** `1` / `true` enable writes; anything else keeps the workspace read-only. */
export function parseFlag(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const value = raw.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

/**
 * Command allowlist supports a JSON array (`["git status","npm test"]`) or a
 * comma-separated list. Entries are command prefixes (token-wise), and an empty
 * list disables `workspace.exec` entirely.
 */
export function parseAllowedCommands(raw: string | undefined): readonly string[] {
  if (raw === undefined) return [];
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];
  const entries: string[] = [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item !== 'string') continue;
          const value = item.trim();
          if (value.length > 0) entries.push(value);
        }
        return dedupe(entries);
      }
    } catch {
      // Fall through to comma-separated parsing for convenience.
    }
  }
  for (const item of trimmed.split(',')) {
    const value = item.trim();
    if (value.length > 0) entries.push(value);
  }
  return dedupe(entries);
}

export function readMcpRuntimeConfig(env: NodeJS.ProcessEnv = process.env): McpRuntimeConfig {
  return {
    internalUrl: (env.AGENT_WORKFLOW_INTERNAL_URL ?? '').trim().replace(/\/+$/, ''),
    token: env.AGENT_WORKFLOW_MCP_TOKEN ?? '',
    worktreeRoot: (env.AGENT_WORKFLOW_WORKTREE ?? '').trim(),
    allowWrite: parseFlag(env.AGENT_WORKFLOW_ALLOW_WRITE),
    allowedCommands: parseAllowedCommands(env.AGENT_WORKFLOW_ALLOWED_COMMANDS),
    requestTimeoutMs: positiveInteger(env.AGENT_WORKFLOW_MCP_REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS),
    execTimeoutMs: positiveInteger(env.AGENT_WORKFLOW_MCP_EXEC_TIMEOUT_MS, DEFAULT_EXEC_TIMEOUT_MS),
    maxFileBytes: positiveInteger(env.AGENT_WORKFLOW_MCP_MAX_FILE_BYTES, DEFAULT_MAX_FILE_BYTES),
    maxListEntries: positiveInteger(env.AGENT_WORKFLOW_MCP_MAX_LIST_ENTRIES, DEFAULT_MAX_LIST_ENTRIES),
    maxOutputBytes: positiveInteger(env.AGENT_WORKFLOW_MCP_MAX_OUTPUT_BYTES, DEFAULT_MAX_OUTPUT_BYTES),
    toolsets: parseToolsets(env.AGENT_WORKFLOW_TOOLSETS),
  };
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 1) return fallback;
  return value;
}

function dedupe(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}


const KNOWN_TOOLSETS = ['workflow', 'git', 'database', 'workspace'] as const;

function parseToolsets(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw.trim() === '') return KNOWN_TOOLSETS;
  const values = raw.split(',').map((item) => item.trim()).filter((item) => (KNOWN_TOOLSETS as readonly string[]).includes(item));
  return values.length === 0 ? KNOWN_TOOLSETS : [...new Set(values)];
}
