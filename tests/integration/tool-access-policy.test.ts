import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequestKey, DEFAULT_MODEL_PROFILES, type DatabaseConnectionConfig, type ToolPolicyResponse } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/index.ts';
import { createSessionScope } from '../../packages/server/src/session-scope.ts';
import { sessionPolicy } from '../../packages/server/src/tool-policy.ts';

test('tool policies persist source/global/project inheritance and reject revoked or newly expanded live calls', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aw-tool-policy-')); writeFileSync(join(root, 'readme.txt'), 'read');
  const dataDir = join(root, 'data');
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  let projectId = '';
  try {
    const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: createRequestKey(), name: 'Policy', rootPath: root } });
    projectId = project.json().data.resource.project.id;
    app.store.settings.putJson('fix.worktree.fix_policy', { path: root });
    const update = async (payload: Record<string, unknown>) => app.app.inject({ method: 'PATCH', url: '/api/tools/policy', payload: { requestKey: createRequestKey(), ...payload } });
    assert.equal((await update({ toolName: 'workspace.file.read', enabled: false })).statusCode, 200);
    const view = (await app.app.inject({ method: 'GET', url: `/api/tools/policy?projectId=${projectId}` })).json().data as ToolPolicyResponse;
    assert.equal(view.sources.flatMap((source) => source.tools).find((tool) => tool.name === 'workspace.file.read')?.enabled, false);
    assert.equal((await update({ projectId, toolName: 'workspace.file.read', enabled: true })).statusCode, 200);
    const frozen = createSessionScope(sessionPolicy(app.store, app.engine, { kind: 'fix', metadata: { projectId, fixRunId: 'fix_policy' }, cwd: root, prompt: '', permission: 'workspace_write', model: DEFAULT_MODEL_PROFILES[0]!, sink: {}, timeoutMs: 60000 }));
    const read = () => app.app.inject({ method: 'GET', url: '/internal/mcp/workspace/file?taskId=fix_policy&path=readme.txt', headers: { authorization: `Bearer ${app.internalToken}`, 'x-agent-workflow-scope': frozen.token } });
    assert.equal((await read()).statusCode, 200);
    await update({ projectId, toolName: 'workspace.file.read', enabled: false });
    assert.equal((await read()).statusCode, 403, 'revocation affects the next call');
    const restricted = createSessionScope(sessionPolicy(app.store, app.engine, { kind: 'fix', metadata: { projectId, fixRunId: 'fix_policy' }, cwd: root, prompt: '', permission: 'workspace_write', model: DEFAULT_MODEL_PROFILES[0]!, sink: {}, timeoutMs: 60000 }));
    await update({ projectId, toolName: 'workspace.file.read', enabled: true });
    const expanded = await app.app.inject({ method: 'GET', url: '/internal/mcp/workspace/file?taskId=fix_policy&path=readme.txt', headers: { authorization: `Bearer ${app.internalToken}`, 'x-agent-workflow-scope': restricted.token } });
    assert.equal(expanded.statusCode, 403, 'expansion cannot grant tools to an already restricted session');
    assert.equal((await update({ sourceId: 'workflow', enabled: false })).statusCode, 403, 'protocol is service owned');
    assert.equal((await update({ sourceId: 'workspace', enabled: false })).statusCode, 200);
    frozen.revoke(); restricted.revoke();
  } finally { await app.close(); }
  const restarted = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const view = (await restarted.app.inject({ method: 'GET', url: '/api/tools/policy' })).json().data as ToolPolicyResponse;
    assert.equal(view.sources.find((source) => source.id === 'workspace')?.tools.every((tool) => tool.globalEnabled === false), true);
  } finally { await restarted.close(); }
});

test('database authorization saves with receipts, retains secrets on blank password and offers only real drivers', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aw-db-policy-'));
  const app = await createApplication({ dataDir: join(root, 'data'), disableOpenCode: true, disableListen: true });
  try {
    const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: createRequestKey(), name: 'Database scope', rootPath: root } });
    const projectId = project.json().data.resource.project.id as string;
    const connection = { name: 'Scoped', type: 'mysql', host: '127.0.0.1', port: 3306, database: 'report', user: 'readonly', password: 'temporary-test-only', projectIds: [projectId], schemas: ['report'], tables: ['report.orders'], enabled: true };
    const key = createRequestKey();
    const response = await app.app.inject({ method: 'POST', url: '/api/settings/databases', payload: { requestKey: key, connection } });
    assert.equal(response.statusCode, 200, response.body);
    const id = response.json().data.connection.id as string;
    const originalRef = app.engine.settings.database.connections.find((item) => item.id === id)?.passwordRef;
    assert.ok(originalRef);
    const replay = await app.app.inject({ method: 'POST', url: '/api/settings/databases', payload: { requestKey: key, connection } });
    assert.equal(replay.json().data.connection.id, id);
    const updated = await app.app.inject({ method: 'POST', url: '/api/settings/databases', payload: { requestKey: createRequestKey(), connection: { ...connection, id, password: '', tables: [] } } });
    assert.equal(updated.statusCode, 200, updated.body);
    assert.equal(app.engine.settings.database.connections.find((item) => item.id === id)?.passwordRef, originalRef);
    const saved = (await app.app.inject({ method: 'GET', url: '/api/settings/databases' })).json().data;
    assert.deepEqual(saved.connections[0].projectIds, [projectId]);
    assert.deepEqual(saved.connections[0].schemas, ['report']);
    assert.equal(JSON.stringify(saved).includes('temporary-test-only'), false);
    assert.equal(saved.types.some((type: { driver: string }) => type.driver === 'planned'), false);
    const snapshot = sessionPolicy(app.store, app.engine, { kind: 'review', metadata: { projectId }, cwd: root, prompt: '', permission: 'read_only', model: DEFAULT_MODEL_PROFILES[0]!, sink: {}, timeoutMs: 1000 });
    assert.equal(snapshot.databaseAccess?.[0]?.connectionConfig?.passwordRef, originalRef);
    const unbound = sessionPolicy(app.store, app.engine, { ...snapshot, metadata: {} });
    assert.deepEqual(unbound.databaseAccess, []);
  } finally { await app.close(); }
});

test('database MCP intersects frozen project/schema/table grants with immediate revocations before port dispatch', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'aw-db-mcp-scope-'));
  const app = await createApplication({ dataDir: join(root, 'data'), disableOpenCode: true, disableListen: true });
  try {
    const projectResponse = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: createRequestKey(), name: 'Scoped query', rootPath: root } });
    const projectId = projectResponse.json().data.resource.project.id as string;
    const connection = { id: 'db_scoped', name: 'Scoped database', type: 'mysql', host: 'original-host', port: 3306, database: 'report', user: 'readonly', password: 'only-test-secret', projectIds: [projectId], schemas: ['report'], tables: ['report.orders'], enabled: true };
    const save = async (patch: Record<string, unknown>) => app.app.inject({ method: 'POST', url: '/api/settings/databases', payload: { requestKey: createRequestKey(), connection: { ...connection, password: '', ...patch } } });
    await save({ password: connection.password });
    const taskResponse = await app.app.inject({ method: 'POST', url: '/api/tasks', payload: { requestKey: createRequestKey(), projectId, title: 'Scoped database read', requirementText: 'Read report orders', methodId: 'method.requirement-development' } });
    const taskId = taskResponse.json().data.resource.task.id as string;
    const role = { ...app.engine.catalog.roles.find((item) => item.id === 'role.reviewer')!, resourcePermissions: { tools: [{ kind: 'mcp' as const, name: 'database.query' }], files: [], commands: [], resources: [{ kind: 'cap' as const, id: 'database_read', label: '数据库读取' }] } };
    const graph = { nodes: [{ id: 'database_node', key: 'read', title: 'read', kind: 'implementation' as const, groupId: 'group', summary: '', inputs: [], outputs: [], acceptance: [], resources: { read: [{ id: connection.id, kind: 'database' as const, label: 'report', basis: 'declared' as const }], write: [] }, roleId: role.id, roleSnapshot: role }], edges: [], groups: [] };
    const plan = app.store.plans.create({ taskId, source: 'skeleton', graph, status: 'confirmed' });
    const execution = app.store.executions.create({ taskId, planRevisionId: plan.id, graph, autoAdvance: false });
    const attempt = app.store.executions.createAttempt({ executionId: execution.id, nodeId: 'database_node', ordinal: 1 });
    app.store.executions.updateNode(execution.id, 'database_node', { status: 'running', currentAttemptId: attempt.id });
    app.store.tasks.update(taskId, { executionId: execution.id, currentPlanRevisionId: plan.id });
    const scope = createSessionScope(sessionPolicy(app.store, app.engine, { kind: 'execution', metadata: { taskId, executionId: execution.id, nodeId: 'database_node', attemptId: attempt.id }, rolePolicy: role, cwd: root, prompt: '', permission: 'workspace_write', model: DEFAULT_MODEL_PROFILES[0]!, sink: {}, timeoutMs: 60000 }));
    const port = context.mock.method(app.engine.ports.database!, 'query', async (_id: string, _sql: string, _limit?: number, config?: DatabaseConnectionConfig) => ({ host: config?.host, rows: [] }));
    const query = (sql: string) => app.app.inject({ method: 'POST', url: '/internal/mcp/database/query', headers: { authorization: `Bearer ${app.internalToken}`, 'x-agent-workflow-scope': scope.token }, payload: { taskId, connectionId: connection.id, sql } });
    assert.equal((await query('SELECT * FROM report.orders')).statusCode, 200);
    assert.equal(port.mock.calls.length, 1);
    assert.equal((await query('SELECT * FROM secret.orders')).statusCode, 403);
    assert.equal(port.mock.calls.length, 1, 'cross schema SQL never reaches driver');
    await save({ host: 'new-host', tables: [] });
    assert.equal((await query('SELECT * FROM report.customers')).statusCode, 403, 'expanded tables do not extend the old session');
    const originalHost = await query('SELECT * FROM report.orders');
    assert.equal(originalHost.json().data.host, 'original-host', 'active session keeps original connection definition');
    await save({ host: 'new-host', projectIds: [] });
    assert.equal((await query('SELECT * FROM report.orders')).statusCode, 403, 'project revocation applies to the next call');
    scope.revoke();
  } finally { await app.close(); }
});
