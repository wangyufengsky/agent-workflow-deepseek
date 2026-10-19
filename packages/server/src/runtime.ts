import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface RuntimePaths {
  readonly repoRoot: string;
  readonly dataDir: string;
  readonly dbPath: string;
  readonly jsonlDir: string;
  readonly worktreesRoot: string;
  readonly mcpEntry?: string;
  readonly tsxLoader?: string;
  readonly nodeBinary: string;
}

export function resolveRuntime(env: NodeJS.ProcessEnv = process.env): RuntimePaths {
  const repoRoot = resolve(env.AGENT_WORKFLOW_ROOT ?? process.cwd());
  const dataDir = resolve(env.AGENT_WORKFLOW_DATA_DIR ?? join(repoRoot, '.data'));
  const builtMcp = join(repoRoot, '.build', 'mcp', 'server.mjs');
  const sourceMcp = join(repoRoot, 'packages', 'mcp', 'src', 'entry.ts');
  const tsxLoader = join(repoRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs');
  return {
    repoRoot,
    dataDir,
    dbPath: join(dataDir, 'agent-workflow.sqlite'),
    jsonlDir: join(dataDir, 'journal'),
    worktreesRoot: join(dataDir, 'worktrees'),
    mcpEntry: existsSync(builtMcp) ? builtMcp : existsSync(sourceMcp) ? sourceMcp : undefined,
    tsxLoader: existsSync(tsxLoader) ? tsxLoader : undefined,
    nodeBinary: env.AGENT_WORKFLOW_NODE_BINARY ?? process.execPath,
  };
}

export function mcpCommand(paths: RuntimePaths): { command: string[]; entryKind: 'built' | 'tsx' | 'missing' } {
  if (paths.mcpEntry === undefined) return { command: [], entryKind: 'missing' };
  const isBuilt = paths.mcpEntry.endsWith('.mjs');
  if (isBuilt) return { command: [paths.nodeBinary, paths.mcpEntry], entryKind: 'built' };
  if (paths.tsxLoader !== undefined) {
    return { command: [paths.nodeBinary, '--import', `file://${paths.tsxLoader}`, paths.mcpEntry], entryKind: 'tsx' };
  }
  return { command: [paths.nodeBinary, paths.mcpEntry], entryKind: 'tsx' };
}
