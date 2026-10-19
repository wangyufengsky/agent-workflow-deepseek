import { InternalMcpApi } from './api.ts';
import { InternalApiClient } from './client.ts';
import { WorkspaceExec } from './exec.ts';
import { readMcpRuntimeConfig, type McpRuntimeConfig } from './env.ts';
import { ToolRegistry } from './registry.ts';
import { WorkspaceService } from './workspace.ts';
import { createAllTools } from './tools/index.ts';

export interface McpRuntime {
  readonly config: McpRuntimeConfig;
  readonly client: InternalApiClient;
  readonly api: InternalMcpApi;
  readonly registry: ToolRegistry;
  readonly workspace?: WorkspaceService;
  readonly exec?: WorkspaceExec;
}

/**
 * Wire runtime dependencies from the environment. Workspace tools always go
 * through the internal API first; the local `WorkspaceService`/`WorkspaceExec`
 * pair only exists as a fallback when `AGENT_WORKFLOW_WORKTREE` is set.
 */
export function buildMcpRuntime(env: NodeJS.ProcessEnv = process.env): McpRuntime {
  const config = readMcpRuntimeConfig(env);
  const client = new InternalApiClient({
    baseUrl: config.internalUrl,
    token: config.token,
    timeoutMs: config.requestTimeoutMs,
  });
  const api = new InternalMcpApi(client);

  let workspace: WorkspaceService | undefined;
  let exec: WorkspaceExec | undefined;
  if (config.worktreeRoot.length > 0) {
    workspace = new WorkspaceService({
      root: config.worktreeRoot,
      allowWrite: config.allowWrite,
      maxFileBytes: config.maxFileBytes,
      maxListEntries: config.maxListEntries,
    });
    exec = new WorkspaceExec({
      cwd: config.worktreeRoot,
      allowedCommands: config.allowedCommands,
      timeoutMs: config.execTimeoutMs,
      maxOutputBytes: config.maxOutputBytes,
    });
  }

  const registry = new ToolRegistry();
  registry.registerAll(createAllTools({ api, workspace, exec }));
  return { config, client, api, registry, ...(workspace === undefined ? {} : { workspace }), ...(exec === undefined ? {} : { exec }) };
}
