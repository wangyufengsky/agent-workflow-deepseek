import type { FastifyInstance } from 'fastify';
import { AppError, ErrorCode, type ToolPolicyResponse, type ToolPolicyUpdate } from '@agent-workflow/shared';
import type { Engine, OpenCodeRunRequest } from '@agent-workflow/engine';
import type { Store } from '@agent-workflow/storage';
import { envelope } from './http.ts';

const SOURCES = { workflow: '工作流控制', git: 'Git 只读', database: '数据库只读', workspace: '工作区' } as const;
export const POLICY_TOOL_NAMES = ['workflow.context.get', 'workflow.plan.submit', 'workflow.question.ask', 'workflow.result.submit', 'git.repo.status', 'git.log', 'git.diff.files', 'git.commit.show', 'database.query', 'workspace.file.read', 'workspace.file.list', 'workspace.file.write', 'workspace.exec'] as const;
interface PolicyState { revision: number; global: Record<string, boolean>; projects: Record<string, Record<string, boolean>> }
const KEY = 'tools.access.policy';
function state(store: Store): PolicyState { return store.settings.getJson<PolicyState>(KEY) ?? { revision: 0, global: {}, projects: {} }; }
export function toolPolicyView(store: Store, engine: Engine, projectId?: string): ToolPolicyResponse {
  if (projectId !== undefined && store.projects.get(projectId) === undefined) throw new AppError(ErrorCode.NOT_FOUND, '项目不存在');
  const policy = state(store);
  return { projectId, revision: policy.revision, sources: Object.entries(SOURCES).map(([sourceId, label]) => ({ id: sourceId, label, complete: true, tools: POLICY_TOOL_NAMES.filter((name) => name.split('.')[0] === sourceId).map((name) => {
    const protocol = sourceId === 'workflow';
    const loaded = engine.settings.opencode.toolsets.includes(sourceId);
    const globalEnabled = policy.global[name] ?? true;
    const projectOverride = projectId === undefined ? null : policy.projects[projectId]?.[name] ?? null;
    return { name, sourceId, globalEnabled, projectOverride, projectOverrides: projectId === undefined ? Object.entries(policy.projects).filter(([, overrides]) => overrides[name] !== undefined).map(([id, overrides]) => ({ projectId: id, enabled: overrides[name]! })) : [], enabled: loaded && (protocol || (projectOverride ?? globalEnabled)), editable: !protocol, ...(protocol ? { reason: '工作流控制协议必须保持可用，由服务管理' } : !loaded ? { reason: '全局工具集未注入，启用工具集并重启运行环境后可供新会话使用' } : {}) };
  }) })) };
}
export function sessionPolicy(store: Store, engine: Engine, request: OpenCodeRunRequest): OpenCodeRunRequest {
  const task = request.metadata.taskId === undefined ? undefined : store.tasks.get(request.metadata.taskId);
  const projectId = request.metadata.projectId ?? task?.projectId;
  const allowedTools = toolPolicyView(store, engine, projectId).sources.flatMap((source) => source.tools.filter((tool) => tool.enabled).map((tool) => tool.name));
  const databaseAccess = engine.settings.database.connections.filter((connection) => connection.enabled !== false && projectId !== undefined && connection.projectIds?.includes(projectId)).map((connection) => ({ connectionId: connection.id, connectionConfig: structuredClone(connection), projectIds: connection.projectIds ?? [], schemas: connection.schemas ?? [], tables: connection.tables ?? [], defaultSchema: connection.type === 'postgresql' ? 'public' : connection.database }));
  return { ...request, allowedTools, databaseAccess };
}
export function registerToolPolicyRoutes(app: FastifyInstance, store: Store, engine: Engine, externalStatus?: () => Promise<Record<string, { status: string }>>): void {
  app.get('/api/tools/policy', async (request) => {
    const view = toolPolicyView(store, engine, (request.query as { projectId?: string }).projectId);
    const discovered: Record<string, { status: string }> = await externalStatus?.().catch(() => ({})) ?? {};
    const external = Object.entries(discovered).filter(([id]) => id !== engine.settings.opencode.mcpServerName).map(([id, value]) => ({ id: `external:${id}`, label: id, kind: 'external' as const, state: value.status, complete: false, reason: '运行环境未返回此来源的完整工具清单；为避免误改，暂不能修改来源策略', tools: [] }));
    return envelope({ ...view, sources: [...view.sources, ...external] }, request.id);
  });
  app.patch('/api/tools/policy', async (request) => {
    const body = request.body as ToolPolicyUpdate;
    const view = toolPolicyView(store, engine, body.projectId);
    if (body.enabled !== null && typeof body.enabled !== 'boolean') throw new AppError(ErrorCode.VALIDATION_FAILED, 'enabled 必须是布尔值或继承');
    if (body.projectId === undefined && body.enabled === null) throw new AppError(ErrorCode.VALIDATION_FAILED, '全局设置不能继承');
    if ((body.toolName === undefined) === (body.sourceId === undefined)) throw new AppError(ErrorCode.VALIDATION_FAILED, '选择一个工具或来源');
    const selected = view.sources.flatMap((source) => source.tools).filter((tool) => body.toolName === undefined ? tool.sourceId === body.sourceId : tool.name === body.toolName);
    if (selected.length === 0 || selected.some((tool) => !tool.editable)) throw new AppError(ErrorCode.FORBIDDEN, selected.find((tool) => !tool.editable)?.reason ?? '工具来源不存在');
    const { record, replayed } = engine.commands.begin({ requestKey: body.requestKey, operation: 'settings.update', body: { toolPolicy: body }, target: {} });
    if (!replayed) {
      const next = state(store);
      const target = body.projectId === undefined ? next.global : next.projects[body.projectId] ?? (next.projects[body.projectId] = {});
      for (const tool of selected) { if (body.enabled === null) delete target[tool.name]; else target[tool.name] = body.enabled; }
      next.revision += 1;
      store.settings.putJson(KEY, next);
      engine.commands.settle(body.requestKey, { revision: next.revision });
    }
    return envelope({ receipt: engine.commands.toReceipt(engine.commands.get(body.requestKey) ?? record), resource: toolPolicyView(store, engine, body.projectId) }, request.id);
  });
}
