import type { InternalMcpApi } from '../api.ts';
import type { WorkspaceExec } from '../exec.ts';
import type { ToolDefinition } from '../registry.ts';
import type { WorkspaceService } from '../workspace.ts';
import { createDatabaseTools } from './database.ts';
import { createGitTools } from './git.ts';
import { createWorkflowTools } from './workflow.ts';
import { createWorkspaceTools } from './workspace.ts';

export interface AllToolDeps {
  readonly api: InternalMcpApi;
  readonly workspace?: WorkspaceService | undefined;
  readonly exec?: WorkspaceExec | undefined;
}

/**
 * The complete managed toolset exposed to OpenCode. Tool names are stable and
 * grouped by toolset prefix (workflow / git / database / workspace).
 */
export function createAllTools(deps: AllToolDeps): readonly ToolDefinition[] {
  const workspace = createWorkspaceTools({ api: deps.api, workspace: deps.workspace, exec: deps.exec });
  return [...createWorkflowTools({ api: deps.api }), ...createGitTools({ api: deps.api }), ...createDatabaseTools({ api: deps.api }), ...workspace];
}

export const MANAGED_TOOL_NAMES = [
  'workflow.context.get',
  'workflow.plan.submit',
  'workflow.question.ask',
  'workflow.result.submit',
  'git.repo.status',
  'git.log',
  'git.diff.files',
  'git.commit.show',
  'database.query',
  'workspace.file.read',
  'workspace.file.list',
  'workspace.file.write',
  'workspace.exec',
] as const;

export { createDatabaseTools, createGitTools, createWorkflowTools, createWorkspaceTools };
