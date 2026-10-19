import { DEFAULT_SETTINGS, ExecutionRetryClass, type ExecutionRetryClassValue } from '@agent-workflow/shared';
import type { ExecutionSettings, PlanNode, RoleDefinition } from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';

export const executionSettingsKey = (executionId: string): string => `execution.settings.${executionId}`;

/** Old executions freeze their first observed policy; new plans freeze at confirmation. */
export function executionPolicy(store: Store, executionId: string, current: ExecutionSettings): ExecutionSettings {
  const saved = store.settings.getJson<Partial<ExecutionSettings>>(executionSettingsKey(executionId));
  if (saved !== undefined) return { ...DEFAULT_SETTINGS.execution, ...saved, retryDelays: { ...DEFAULT_SETTINGS.execution.retryDelays, ...saved.retryDelays } };
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


export function retryClass(error?: { readonly code: string; readonly message: string }): ExecutionRetryClassValue {
  if (error === undefined) return ExecutionRetryClass.OTHER;
  if (/429|rate.?limit|too many requests|限流/i.test(error.message)) return ExecutionRetryClass.MODEL_RATE_LIMIT;
  if (error.code === 'VALIDATION_FAILED') return ExecutionRetryClass.VERIFICATION_FAILURE;
  if (error.code === 'OPENCODE_NOT_READY' || /session|会话|ECONN|connection/i.test(error.message)) return ExecutionRetryClass.SESSION_ERROR;
  return ExecutionRetryClass.OTHER;
}

export function retryDelayMs(policy: ExecutionSettings, error: { readonly code: string; readonly message: string } | undefined, attempts: number): number {
  const kind = retryClass(error);
  const delay = kind === ExecutionRetryClass.MODEL_RATE_LIMIT ? policy.retryDelays.modelRateLimit : kind === ExecutionRetryClass.SESSION_ERROR ? policy.retryDelays.sessionError : kind === ExecutionRetryClass.VERIFICATION_FAILURE ? policy.retryDelays.verificationFailure : undefined;
  return delay === undefined ? 0 : Math.min(delay.maxMs, delay.initialMs * 2 ** Math.max(0, attempts - 1));
}

/** 0 explicitly means no business deadline; an independently published role limit still applies. */
export function executionTimeoutMs(policy: ExecutionSettings, node: PlanNode, taskStartedAt: string | undefined, designStartedAt: string | undefined, now = Date.now()): number {
  const role = (node as PlanNode & { readonly roleSnapshot?: RoleDefinition }).roleSnapshot;
  const limits: number[] = [];
  if (role?.maxRuntimeMinutes !== undefined) limits.push(role.maxRuntimeMinutes * 60000);
  if (policy.timeoutEnabled) {
    limits.push(policy.nodeTimeoutMinutes * 60000);
    if (taskStartedAt !== undefined) limits.push(Date.parse(taskStartedAt) + policy.taskTimeoutMinutes * 60000 - now);
    if (node.kind === 'design' && designStartedAt !== undefined) limits.push(Date.parse(designStartedAt) + policy.designTimeoutMinutes * 60000 - now);
  }
  return limits.length === 0 ? 0 : Math.max(1, Math.min(...limits));
}
