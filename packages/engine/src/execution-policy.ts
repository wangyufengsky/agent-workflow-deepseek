import type { ExecutionSettings, PlanNode, RoleDefinition } from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';

export const executionSettingsKey = (executionId: string): string => `execution.settings.${executionId}`;

/** Old executions freeze their first observed policy; new plans freeze at confirmation. */
export function executionPolicy(store: Store, executionId: string, current: ExecutionSettings): ExecutionSettings {
  const saved = store.settings.getJson<ExecutionSettings>(executionSettingsKey(executionId));
  if (saved !== undefined) return saved;
  const snapshot = structuredClone(current);
  store.settings.putJson(executionSettingsKey(executionId), snapshot);
  return snapshot;
}

/** All writers own the entire task workspace. Only enforced, shell-free readers share it. */
export function canShareWorkspace(node: PlanNode): boolean {
  const role = (node as PlanNode & { readonly roleSnapshot?: RoleDefinition }).roleSnapshot;
  const permissions = role?.resourcePermissions;
  if (permissions === undefined || node.resources.write.length !== 0) return false;
  if (permissions.files.some((file) => file.kind === 'write') || permissions.commands.length !== 0) return false;
  const readTools = new Set(['workspace.file.read', 'workspace.file.list', 'knowledge.search', 'database.query', 'workflow.task.read', 'workflow.result.submit']);
  return permissions.tools.every((tool) => readTools.has(tool.name));
}
