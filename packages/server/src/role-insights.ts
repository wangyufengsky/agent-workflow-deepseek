import type { FastifyInstance } from 'fastify';
import { AppError, ErrorCode, RoleResponsibilitySlot, nowIso, type RoleImageBinding, type RolePermissionPreview, type RoleUsageView } from '@agent-workflow/shared';
import { roleCapability, type Engine } from '@agent-workflow/engine';
import type { Store } from '@agent-workflow/storage';
import { envelope } from './http.ts';
import { toolPolicyView } from './tool-policy.ts';

const IMAGES: readonly RoleImageBinding[] = [
  { id: 'image.analyst', kind: 'emoji', value: '🔍', label: '分析师' },
  { id: 'image.builder', kind: 'emoji', value: '🛠️', label: '构建者' },
  { id: 'image.reviewer', kind: 'emoji', value: '🧭', label: '评审员' },
  { id: 'image.tester', kind: 'emoji', value: '🧪', label: '测试员' },
];
const SLOTS = [{ id: RoleResponsibilitySlot.EXECUTION, label: '执行步骤 · 工作区受控写入' }, { id: RoleResponsibilitySlot.READ_ONLY, label: '执行步骤 · 只读' }];
const DESCRIPTIONS: Record<string, string> = { 'workflow.context.get': '读取当前任务上下文', 'workflow.result.submit': '提交当前步骤结果', 'workspace.file.read': '读取工作区文件', 'workspace.file.list': '列出工作区文件', 'workspace.file.write': '写入工作区文件', 'workspace.exec': '执行获准命令', 'database.query': '查询获准数据库' };
export function roleUsage(store: Store, engine: Engine, roleId: string): RoleUsageView {
  const roleFor = (step: { roleId?: string; kind: string }) => step.roleId ?? (step.kind === 'test' ? 'role.tester' : step.kind === 'verify' ? 'role.reviewer' : 'role.developer');
  return { roleId,
    workflows: engine.catalog.methods.map((method) => ({ id: method.id, name: method.name, planning: method.planningStrategy?.roleId === roleId, steps: method.requiredSteps.filter((step) => roleFor(step) === roleId).map((step) => step.title) })).filter((method) => method.planning || method.steps.length > 0),
    templates: engine.catalog.templates.map((template) => ({ id: template.id, name: template.name, steps: template.steps.filter((step) => roleFor(step) === roleId).map((step) => step.title) })).filter((template) => template.steps.length > 0),
    frozenNodes: store.tasks.list().reduce((count, task) => count + (store.plans.latestConfirmed(task.id)?.graph.nodes.filter((node) => node.roleSnapshot?.id === roleId).length ?? 0), 0),
  };
}
export function rolePreview(store: Store, engine: Engine, id: string, revision: string, slot: string): RolePermissionPreview {
  const role = engine.roleCatalog.list().roles.find((item) => item.id === id);
  if (role === undefined || role.status !== 'published') throw new AppError(ErrorCode.NOT_FOUND, '没有可核对的已发布职业');
  if (role.revision !== revision) throw new AppError(ErrorCode.STALE_TARGET, '发布修订已改变，请重新核对精确发布版本');
  if (!role.allowedSlots?.includes(slot)) throw new AppError(ErrorCode.FORBIDDEN, '该发布修订未允许此职责位置');
  const registered = SLOTS.some((item) => item.id === slot);
  const tools = toolPolicyView(store, engine).sources.flatMap((source) => source.tools).filter((tool) => {
    if (!registered || !tool.enabled) return false;
    if (tool.name === 'workflow.context.get' || tool.name === 'workflow.result.submit') return true;
    if (!roleCapability(role, 'external_mcp') || !role.resourcePermissions?.tools.some((item) => item.kind === 'mcp' && item.name === tool.name)) return false;
    if (slot === RoleResponsibilitySlot.READ_ONLY && ['workspace.file.write', 'workspace.exec'].includes(tool.name)) return false;
    return true;
  }).map((tool) => ({ name: tool.name, description: DESCRIPTIONS[tool.name] ?? '受控只读工具' }));
  return { roleId: id, revision, slot, readAt: nowIso(), tools,
    limitations: ['仅依据精确发布修订、职责位置和全局已注入工具策略计算上限；项目许可可能进一步收紧。', '预估不等于实际授权。实际调用仍须通过会话身份、实时工具发现、工作区与来源许可。'],
    diagnostics: [...(registered ? [] : ['该发布版本的职责位置（目录未登记），未推断有效工具。']), '实例文件路径、命令参数与数据库项目/schema/table许可没有在本预估中计算；原配置保持不变。', '外部 MCP 服务未返回完整工具和身份清单，未计入本预估。'],
  };
}
export function registerRoleInsightRoutes(app: FastifyInstance, store: Store, engine: Engine): void {
  app.get('/api/catalog/role-images', async (request) => envelope({ images: IMAGES }, request.id));
  app.get<{ Params: { id: string } }>('/api/catalog/roles/:id/insights', async (request) => {
    const role = engine.roleCatalog.list().roles.find((item) => item.id === request.params.id);
    if (role === undefined) throw new AppError(ErrorCode.NOT_FOUND, '职业不存在');
    return envelope({ usage: roleUsage(store, engine, role.id), published: role.status === 'published' ? { revision: role.revision, allowedSlots: role.allowedSlots ?? [] } : null, slots: SLOTS }, request.id);
  });
  app.get<{ Params: { id: string }; Querystring: { revision?: string; slot?: string } }>('/api/catalog/roles/:id/permission-preview', async (request) => envelope(rolePreview(store, engine, request.params.id, request.query.revision ?? '', request.query.slot ?? ''), request.id));
}
