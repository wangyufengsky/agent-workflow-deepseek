import type { ModelProfile, PlanGraph, RoleDefinition } from '@agent-workflow/shared';
import { AppError, ErrorCode } from '@agent-workflow/shared';

/** Persist a copy, so publishing or archiving a role cannot change confirmed work. */
export function freezeGraphRoles(graph: PlanGraph, roles: readonly RoleDefinition[]): PlanGraph {
  return { ...graph, nodes: graph.nodes.map((node) => {
    if (node.roleSnapshot !== undefined && node.roleSnapshot.id === node.roleId) return node;
    const roleId = node.roleId ?? (node.kind === 'test' ? 'role.tester' : node.kind === 'verify' ? 'role.reviewer' : 'role.developer');
    const role = roles.find((item) => item.id === roleId);
    if (role === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, `步骤 ${node.title} 没有可用的已发布职业`);
    return { ...node, roleId, roleSnapshot: structuredClone(role) };
  }) };
}

export function roleModel(role: RoleDefinition | undefined, models: readonly ModelProfile[]): ModelProfile {
  const requested = role?.model;
  const modelRole = role?.id === 'role.reviewer' ? 'reviewer' : role?.id === 'role.planner' ? 'planner' : role?.id === 'role.repairer' ? 'repairer' : 'coder';
  const model = requested === undefined
    ? models.find((item) => item.enabled && item.roles.includes(modelRole)) ?? models.find((item) => item.enabled)
    : models.find((item) => item.enabled && (item.id === requested || `${item.provider}/${item.model}` === requested));
  if (model === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, `职业模型不可用：${requested ?? '未配置启用的模型'}`);
  return model;
}

export function roleCapability(role: RoleDefinition | undefined, id: string): boolean {
  return role?.capabilityGroups?.flatMap((group) => group.items).find((item) => item.id === id)?.enabled === true;
}

/** Exact files or directory descendants; never glob matching across a path boundary. */
export function roleFileAllowed(role: RoleDefinition, path: string, kind: 'read' | 'write'): boolean {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) return false;
  return role.resourcePermissions?.files.some((file) => {
    const prefix = file.path.replace(/\/$/, '');
    return file.workspace === undefined && file.kind === kind && (prefix === '.' || normalized === prefix || normalized.startsWith(`${prefix}/`));
  }) === true;
}

export function roleCommandAllowed(role: RoleDefinition, argv: readonly string[]): boolean {
  return role.resourcePermissions?.commands.some((command) => command.workspace === undefined && command.argv.length === argv.length && command.argv.every((token, index) => token === argv[index])) === true;
}
