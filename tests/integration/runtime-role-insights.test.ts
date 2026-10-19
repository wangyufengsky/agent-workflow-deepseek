import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { AppError, ErrorCode, createRequestKey } from '@agent-workflow/shared';
import { createApplication, OpenCodeAdapter } from '../../packages/server/src/index.ts';
import { methodToGraph } from '../../packages/engine/src/graph.ts';
import { registerRuntimeOperationRoutes } from '../../packages/server/src/runtime-operations.ts';

test('published role preview uses exact revision and slot, never draft; usage/images are real catalogs', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-insights-')), disableListen: true, disableOpenCode: true });
  try {
    const id = 'role.developer';
    const read = await app.app.inject({ method: 'GET', url: `/api/catalog/roles/${id}/insights` });
    assert.equal(read.statusCode, 200, read.body);
    const basis = read.json().data;
    assert.ok(basis.usage.workflows.some((workflow: { steps: string[] }) => workflow.steps.length > 0));
    assert.ok(basis.usage.templates.length > 0);
    assert.deepEqual(basis.published.allowedSlots, ['execution', 'execution_read_only']);
    const beforeOperations = app.store.operations.listRecent().length;
    const preview = async (revision: string, slot: string) => app.app.inject({ method: 'GET', url: `/api/catalog/roles/${id}/permission-preview?revision=${revision}&slot=${slot}` });
    const full = await preview(basis.published.revision, 'execution');
    assert.equal(full.statusCode, 200, full.body);
    assert.ok(full.json().data.tools.some((tool: { name: string }) => tool.name === 'workspace.file.write'));
    const readonly = await preview(basis.published.revision, 'execution_read_only');
    assert.equal(readonly.statusCode, 200, readonly.body);
    assert.ok(!readonly.json().data.tools.some((tool: { name: string }) => ['workspace.exec', 'workspace.file.write'].includes(tool.name)));
    assert.equal((await preview('r999999', 'execution')).json().error.code, 'STALE_TARGET');
    assert.equal((await preview(basis.published.revision, 'not-a-slot')).json().error.code, 'FORBIDDEN');
    assert.equal(app.store.operations.listRecent().length, beforeOperations, 'reads cannot create operations');
    const images = (await app.app.inject({ method: 'GET', url: '/api/catalog/role-images' })).json().data.images;
    assert.ok(images.length > 0);
    const save = await app.app.inject({ method: 'POST', url: '/api/catalog/roles', payload: { requestKey: createRequestKey(), roleId: id, name: '开发者草稿', purpose: '草稿不上线', responsibilities: ['核对行为'], resourcePermissions: { tools: [], files: [], commands: [], resources: [] }, image: images[0], confirmSave: true } });
    assert.equal(save.statusCode, 200, save.body);
    assert.deepEqual((await preview(basis.published.revision, 'execution')).json().data.tools, full.json().data.tools);
    const publish = await app.app.inject({ method: 'POST', url: `/api/catalog/roles/${id}/publish`, payload: { requestKey: createRequestKey(), confirmPublish: true } });
    assert.equal(publish.statusCode, 200, publish.body);
    assert.equal((await preview(basis.published.revision, 'execution')).json().error.code, 'STALE_TARGET');
    const history = (await app.app.inject({ method: 'GET', url: `/api/catalog/roles/${id}/history` })).json().data.history;
    assert.equal(history[0].image.id, images[0].id);
    assert.deepEqual(history[0].allowedSlots, basis.published.allowedSlots);
  } finally { await app.close(); }
});

test('runtime command routes preserve accepted replay, settle ledger and reject unsafe sessions', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-runtime-ledger-')), disableListen: true, disableOpenCode: true });
  const server = Fastify();
  server.setErrorHandler((error, _request, reply) => { const typed = error as AppError; reply.code(typed.httpStatus ?? 500).send({ code: typed.code, message: typed.message }); });
  let state: 'stopped' | 'ready' = 'stopped'; let stops = 0; let starts = 0; let active = 0; let locked = false; let remoteUnknown = false;
  // Deterministic process-manager seam: this test performs no model call.
  const manager = { verifyMaintenanceIdle: async () => { if (remoteUnknown) throw new AppError(ErrorCode.OPENCODE_NOT_READY, '远程会话未知'); }, status: () => ({ state }), beginMaintenance: () => { assert.equal(locked, false); locked = true; return () => { locked = false; }; }, diagnostics: async () => ({ mcp: {}, sessions: active, totalSessions: active }), stop: async () => { stops += 1; state = 'stopped'; }, ensureReady: async () => { starts += 1; state = 'ready'; } };
  registerRuntimeOperationRoutes(server, app.store, app.engine, { current: manager });
  try {
    const post = (action: string, key = createRequestKey()) => server.inject({ method: 'POST', url: `/api/opencode/${action}`, payload: { requestKey: key, [action === 'start' ? 'confirmStart' : 'confirmRestart']: true } });
    const key = createRequestKey();
    const start = await post('start', key); assert.equal(start.statusCode, 200, start.body); assert.equal(start.json().data.receipt.status, 'succeeded');
    await post('start', key); assert.equal(starts, 1); assert.equal(stops, 0);
    active = 1; const rejected = await post('restart'); assert.equal(rejected.statusCode, 400, rejected.body); assert.equal(stops, 0); assert.equal(locked, false);
    active = 0; remoteUnknown = true; const remoteRejected = await post('restart'); assert.notEqual(remoteRejected.statusCode, 200); assert.equal(stops, 0, 'remote unknown cannot stop runtime'); remoteUnknown = false;
    const restart = await post('restart'); assert.equal(restart.statusCode, 200, restart.body); assert.equal(starts, 2); assert.equal(stops, 1);
    const acceptedKey = createRequestKey(); app.engine.commands.begin({ requestKey: acceptedKey, operation: 'opencode.restart', body: { action: 'restart', confirmed: true }, target: {} });
    const replay = await post('restart', acceptedKey); assert.equal(replay.json().data.receipt.status, 'accepted'); assert.equal(starts, 2); assert.equal(stops, 1);
    const project = app.store.projects.create({ name: '运行时阻断项目', rootPath: tmpdir(), gitState: 'not_git' });
    const method = app.engine.catalog.methods[0]!;
    const task = app.store.tasks.create({ projectId: project.id, title: '旧执行未知节点', requirementText: '核对运行时状态', methodId: method.id, methodRevision: method.revision });
    const graph = methodToGraph(method);
    const plan = app.store.plans.create({ taskId: task.id, source: 'template', graph, status: 'confirmed' });
    const execution = app.store.executions.create({ taskId: task.id, planRevisionId: plan.id, graph, autoAdvance: false });
    app.store.executions.update(execution.id, { status: 'paused' });
    app.store.executions.updateNode(execution.id, graph.nodes[0]!.id, { status: 'unknown' });
    const unsafe = await post('restart'); assert.equal(unsafe.statusCode, 400, unsafe.body); assert.equal(stops, 1, 'paused execution with unknown node must block even if task.executionId is absent');
    app.store.executions.updateNode(execution.id, graph.nodes[0]!.id, { status: 'ready' });
    const history = (await server.inject({ method: 'GET', url: '/api/opencode/operations' })).json().data.operations;
    assert.equal(history.length, 6); assert.ok(history.some((operation: { status: string }) => operation.status === 'failed'));
    assert.equal((await server.inject({ method: 'POST', url: '/api/opencode/start', payload: {} })).statusCode, 400);
    for (const operation of ['project.charter.generate', 'ppt.work.generate', 'ppt.work.slides'] as const) {
      const pendingKey = createRequestKey();
      app.engine.commands.begin({ requestKey: pendingKey, operation, body: {}, target: {} });
      app.engine.commands.fail(pendingKey, new Error('服务重启后结果未知'), true);
      const blocked = await post('restart');
      assert.equal(blocked.statusCode, 400, blocked.body);
      assert.equal(stops, 1, `${operation} unknown survives process-memory loss and blocks restart`);
      app.engine.commands.settle(pendingKey, { reconciled: true });
    }
  } finally { await server.close(); await app.close(); }
});

test('adapter maintenance blocks sessions before startup and releases cleanly', async () => {
  const adapter = new OpenCodeAdapter({ dataDir: mkdtempSync(join(tmpdir(), 'aw-maintenance-')), repoRoot: tmpdir(), configPath: join(tmpdir(), 'aw-unwritten-config.json'), logPath: join(tmpdir(), 'aw-unwritten-log'), binaryPath: '/not-executed', expectedVersion: '1.19.0', host: '127.0.0.1', port: 0, startupTimeoutMs: 100, shutdownTimeoutMs: 100, maxSessions: 1, mcpServerName: 'test', mcpCommand: [], mcpEnvironment: {}, defaultAgent: 'build', model: { id: 'test', label: '测试配置', provider: 'none', model: 'none', enabled: true, roles: ['coder'] } });
  const release = adapter.beginMaintenance();
  assert.throws(() => adapter.beginMaintenance(), /活动会话或维护/);
  await assert.rejects(adapter.runSession({} as Parameters<OpenCodeAdapter['runSession']>[0]), /正在维护/);
  release(); const releaseAgain = adapter.beginMaintenance(); release();
  assert.throws(() => adapter.beginMaintenance(), /活动会话或维护/, 'old release must not unlock a newer maintenance window');
  releaseAgain();
  let unblock: (() => void) | undefined;
  adapter.ensureReady = async () => { await new Promise<void>((resolve) => { unblock = resolve; }); throw new Error('startup seam failed'); };
  const pending = adapter.runSession({} as Parameters<OpenCodeAdapter['runSession']>[0]);
  assert.throws(() => adapter.beginMaintenance(), /活动会话或维护/, 'startup-waiting request is already active');
  unblock!(); await assert.rejects(pending, /startup seam failed/);
  adapter.beginMaintenance()();
});
