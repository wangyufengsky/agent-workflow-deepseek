import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequestKey, type PlanGraph } from '@agent-workflow/shared';
import { methodToGraph } from '../../packages/engine/src/graph.ts';
import { freezeGraphRoles } from '../../packages/engine/src/role-runtime.ts';
import { rolePermission } from '../../packages/server/src/adapters/opencode.ts';
import { createApplication } from '../../packages/server/src/index.ts';

test('HTTP MCP uses the running node frozen occupation to enforce read, write, argv and database ceilings', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aw-role-permissions-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'ok.txt'), 'allowed');
  writeFileSync(join(root, 'secret.txt'), 'outside grant');
  const app = await createApplication({ dataDir: join(root, 'data'), disableOpenCode: true, disableListen: true });
  try {
    const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: createRequestKey(), name: 'Roles', rootPath: root } });
    const projectId = project.json().data.resource.project.id as string;
    const response = await app.app.inject({ method: 'POST', url: '/api/tasks', payload: { requestKey: createRequestKey(), projectId, title: 'Read', requirementText: 'Read only', methodId: 'method.requirement-development' } });
    const taskId = response.json().data.resource.task.id as string;
    const role = { ...app.engine.catalog.roles.find((item) => item.id === 'role.reviewer')!, resourcePermissions: { tools: [{ kind: 'mcp' as const, name: 'workspace.file.read' }], files: [{ kind: 'read' as const, path: 'src' }], commands: [], resources: [] } };
    const graphBase = methodToGraph(app.engine.catalog.methods[0]!);
    const graph: PlanGraph = freezeGraphRoles({ ...graphBase, nodes: [{ ...graphBase.nodes[0]!, roleId: role.id }] }, [role]);
    const plan = app.store.plans.create({ taskId, source: 'skeleton', graph, status: 'confirmed' });
    const execution = app.store.executions.create({ taskId, planRevisionId: plan.id, graph, autoAdvance: false });
    app.store.tasks.update(taskId, { executionId: execution.id, currentPlanRevisionId: plan.id });
    app.store.executions.updateNode(execution.id, graph.nodes[0]!.id, { status: 'running' });
    const headers = { authorization: `Bearer ${app.internalToken}` };
    const read = await app.app.inject({ method: 'GET', url: `/internal/mcp/workspace/file?taskId=${taskId}&path=src/ok.txt`, headers });
    assert.equal(read.statusCode, 200, read.body);
    const denied = await app.app.inject({ method: 'GET', url: `/internal/mcp/workspace/file?taskId=${taskId}&path=secret.txt`, headers });
    assert.equal(denied.statusCode, 403, denied.body);
    const write = await app.app.inject({ method: 'POST', url: '/internal/mcp/workspace/file-write', headers, payload: { taskId, path: 'src/ok.txt', content: 'forbidden' } });
    assert.equal(write.statusCode, 403, write.body);
    const command = await app.app.inject({ method: 'POST', url: '/internal/mcp/workspace/exec', headers, payload: { taskId, command: 'npm test' } });
    assert.equal(command.statusCode, 403, command.body);
    const database = await app.app.inject({ method: 'POST', url: '/internal/mcp/database/query', headers, payload: { taskId, connectionId: 'private-db', sql: 'select 1' } });
    assert.equal(database.statusCode, 403, database.body);
    const policy = rolePermission(role, 'workflow') as { permission: string; action: string }[];
    assert.equal(policy[0]?.action, 'deny');
    assert.equal(policy.some((item) => item.permission === 'bash' && item.action === 'allow'), false);
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
});
