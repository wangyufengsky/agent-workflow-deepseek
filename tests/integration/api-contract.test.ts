import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import {
  AppError,
  DEFAULT_SETTINGS,
  createId,
  nowIso,
  type DeliveryCommitRequest,
  type DeliveryMergeRequest,
  type DeliveryMergeRequestRequest,
  type DeliveryPushRequest,
} from '@agent-workflow/shared';
import { CommandService, DeliveryService, Engine, type EngineContext, type GitPort, type OpenCodePort, type WorkspaceService } from '@agent-workflow/engine';
import { Store } from '@agent-workflow/storage';
import { createApplication } from '../../packages/server/src/index.ts';
import { registerErrorHandler, registerRoutes } from '../../packages/server/src/http.ts';
import { resolveRuntime, type RuntimePaths } from '../../packages/server/src/runtime.ts';
import type { DatabaseService } from '@agent-workflow/database';
import type { OpenCodeAdapter } from '../../packages/server/src/adapters/opencode.ts';

function requestKey(prefix: string): string {
  return `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;
}

function createRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'aw-api-repo-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# demo\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  return root;
}

function seedNodeGraph(): { readonly nodes: readonly Record<string, unknown>[]; readonly edges: readonly never[]; readonly groups: readonly Record<string, unknown>[] } {
  return {
    nodes: [
      {
        id: 'node_a',
        key: 'a',
        title: '节点 A',
        kind: 'implementation',
        groupId: 'group_1',
        summary: '',
        inputs: [],
        outputs: [],
        acceptance: [],
        resources: { read: [], write: [] },
      },
    ],
    edges: [],
    groups: [{ id: 'group_1', label: '实现', kind: 'implementation', refined: false, collapsible: false, collapsedByDefault: false }],
  };
}

test('W0-1: git fetch answers a CommandResponse receipt and rejects a missing requestKey', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-fetch-'));
  const repoRoot = createRepo();
  const remoteRoot = mkdtempSync(join(tmpdir(), 'aw-fetch-remote-'));
  execFileSync('git', ['init', '-q', '--bare'], { cwd: remoteRoot });
  execFileSync('git', ['remote', 'add', 'origin', remoteRoot], { cwd: repoRoot });
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const project = await app.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { requestKey: requestKey('prj'), name: 'Fetch Demo', rootPath: repoRoot },
    });
    assert.equal(project.statusCode, 201, project.body);
    const projectId = project.json().data.resource.project.id as string;

    const key = requestKey('fetch');
    const payload = { requestKey: key, projectId, remote: 'origin' };
    const fetched = await app.app.inject({ method: 'POST', url: `/api/git/repos/${projectId}/fetch`, payload });
    assert.equal(fetched.statusCode, 200, fetched.body);
    const body = fetched.json().data as {
      receipt: { requestKey: string; status: string; operation: string };
      resource: { fetchedAt: string; remote: string };
    };
    assert.equal(body.receipt.requestKey, key);
    assert.equal(body.receipt.status, 'succeeded');
    assert.equal(body.receipt.operation, 'git.fetch');
    assert.equal(typeof body.resource.fetchedAt, 'string');
    assert.ok(body.resource.fetchedAt.length > 0);

    const operation = await app.app.inject({ method: 'GET', url: `/api/operations/${key}` });
    assert.equal(operation.statusCode, 200, operation.body);
    assert.equal(operation.json().data.operation.status, 'succeeded');
    assert.equal(operation.json().data.operation.operation, 'git.fetch');

    // Same key + same body replays the stored receipt instead of re-running.
    const replay = await app.app.inject({ method: 'POST', url: `/api/git/repos/${projectId}/fetch`, payload });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().data.receipt.requestKey, key);
    assert.equal(replay.json().data.receipt.status, 'succeeded');

    const missingKey = await app.app.inject({ method: 'POST', url: `/api/git/repos/${projectId}/fetch`, payload: { projectId } });
    assert.equal(missingKey.statusCode, 400, missingKey.body);
    assert.equal(missingKey.json().error.code, 'VALIDATION_FAILED');

    const wrongProject = await app.app.inject({
      method: 'POST',
      url: `/api/git/repos/${projectId}/fetch`,
      payload: { requestKey: requestKey('fetch2'), projectId: 'project_other' },
    });
    assert.equal(wrongProject.statusCode, 400, wrongProject.body);
  } finally {
    await app.close();
  }
});

test('W0-2: unknown GET /api routes answer JSON 404 instead of the SPA index.html', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-spa-')), disableOpenCode: true, disableListen: true });
  try {
    for (const url of ['/api/not-a-real-route', '/api/tasks/task_x/execution/advance', '/api/tasks/task_x/plan/edit/abandon', '/api/git/repos/project_x/merge-requests/1']) {
      const response = await app.app.inject({ method: 'GET', url });
      assert.equal(response.statusCode, 404, `${url} -> ${response.statusCode} ${response.body.slice(0, 120)}`);
      assert.match(response.headers['content-type'] ?? '', /application\/json/);
      const body = response.json() as { error?: { code: string; requestId: string } };
      assert.equal(body.error?.code, 'NOT_FOUND');
      assert.equal(typeof body.error?.requestId, 'string');
    }
    const post404 = await app.app.inject({ method: 'POST', url: '/api/not-a-real-route' });
    assert.equal(post404.statusCode, 404, post404.body);
    assert.equal(post404.json().error.code, 'NOT_FOUND');

    // Non-API paths keep the SPA fallback (or the dev root hint when dist is absent).
    const root = await app.app.inject({ method: 'GET', url: '/' });
    assert.equal(root.statusCode, 200, root.body);
    const hasWebDist = existsSync(join(app.paths.repoRoot, 'apps', 'web', 'dist', 'index.html'));
    if (hasWebDist) {
      assert.match(root.headers['content-type'] ?? '', /text\/html/);
      const deepLink = await app.app.inject({ method: 'GET', url: '/tasks/task_deeplink_smoke' });
      assert.equal(deepLink.statusCode, 200, deepLink.body);
      assert.match(deepLink.headers['content-type'] ?? '', /text\/html/);
      assert.ok(deepLink.body.includes('<div id="root"'), 'SPA fallback must serve the web shell');
    }
  } finally {
    await app.close();
  }
});

test('W0-5: node output terminal follows the settled attempt instead of a constant false', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-output-'));
  const projectRoot = mkdtempSync(join(tmpdir(), 'aw-output-project-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: projectRoot });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: projectRoot });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: projectRoot });
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const project = await app.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { requestKey: requestKey('prj'), name: 'Output Demo', rootPath: projectRoot },
    });
    assert.equal(project.statusCode, 201, project.body);
    const projectId = project.json().data.resource.project.id as string;
    const task = await app.app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { requestKey: requestKey('task'), projectId, title: '输出终态', requirementText: 'R1 验证终态', methodId: 'method.requirement-development' },
    });
    assert.equal(task.statusCode, 201, task.body);
    const taskId = task.json().data.resource.task.id as string;

    const graph = seedNodeGraph();
    const execution = app.store.executions.create({ taskId, planRevisionId: 'plan_output', graph: graph as never, autoAdvance: false });
    const settledAttempt = app.store.executions.createAttempt({ executionId: execution.id, nodeId: 'node_a', ordinal: 0 });
    app.store.executions.appendOutput({
      attemptId: settledAttempt.id,
      seq: 1,
      fragment: { fragmentId: 'frag_1', seq: 1, category: 'model_text', text: '实现完成' },
    });
    app.store.executions.finishAttempt(settledAttempt.id, 'succeeded');
    app.store.executions.updateNode(execution.id, 'node_a', { status: 'succeeded', currentAttemptId: settledAttempt.id, attemptCount: 1 });

    const settled = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/nodes/node_a/output` });
    assert.equal(settled.statusCode, 200, settled.body);
    const settledBody = settled.json().data as { terminal: boolean; fragments: readonly { text?: string }[]; attemptId?: string };
    assert.equal(settledBody.terminal, true);
    assert.equal(settledBody.attemptId, settledAttempt.id);
    assert.equal(settledBody.fragments[0]?.text, '实现完成');

    // A still-running attempt keeps the stream open.
    const runningAttempt = app.store.executions.createAttempt({ executionId: execution.id, nodeId: 'node_a', ordinal: 1 });
    app.store.executions.updateNode(execution.id, 'node_a', { status: 'running', currentAttemptId: runningAttempt.id, attemptCount: 2 });
    const running = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/nodes/node_a/output` });
    assert.equal(running.statusCode, 200, running.body);
    assert.equal((running.json().data as { terminal: boolean }).terminal, false);

    // Unknown task identities cannot be used as aliases for another attempt.
    const unknownTask = await app.app.inject({ method: 'GET', url: '/api/tasks/task_missing/nodes/node_a/output' });
    assert.equal(unknownTask.statusCode, 404, unknownTask.body);
  } finally {
    await app.close();
  }
});

/* ------------------------------------------------------------------ */
/* Fake managed OpenCode harness                                       */
/* ------------------------------------------------------------------ */

interface FakeHarness {
  readonly app: ReturnType<typeof Fastify>;
  readonly store: Store;
  readonly engine: Engine;
  stopCalls(): number;
  setDiagnosticsConnected(connected: boolean): void;
  setDatabaseStates(states: readonly 'connected'[]): void;
  close(): Promise<void>;
}

async function createFakeHarness(): Promise<FakeHarness> {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-fake-'));
  const store = new Store({ dataDir });
  const runtime: RuntimePaths = { ...resolveRuntime(), dataDir, dbPath: join(dataDir, 'agent-workflow.sqlite'), jsonlDir: join(dataDir, 'journal'), worktreesRoot: join(dataDir, 'worktrees') };
  let stopCount = 0;
  let diagnosticsConnected = true;
  let databaseStates: readonly 'connected'[] = [];
  const status = { state: 'ready' as const, version: '1.19.0', host: '127.0.0.1', port: 4096, pid: 4242, startedAt: nowIso() };
  const adapter = {
    beginMaintenance: () => () => undefined,
    verifyMaintenanceIdle: async () => undefined,
    status: () => status,
    stop: async () => {
      stopCount += 1;
    },
    ensureReady: async () => undefined,
    diagnostics: async () => (diagnosticsConnected
      ? { mcp: { 'agent-workflow': { status: 'connected' } }, sessions: 0, totalSessions: 0 }
      : { mcp: { 'agent-workflow': { status: 'failed' } }, sessions: 0, totalSessions: 0 }),
  } as unknown as OpenCodeAdapter;
  const gitPort = new Proxy({}, { get: () => () => Promise.reject(new Error('git port is not expected in this harness')) }) as unknown as GitPort;
  const opencodePort = {
    status: () => status,
    ensureReady: async () => undefined,
    runSession: async () => {
      throw new Error('unused');
    },
    abortSession: async () => undefined,
    findSessions: async () => [],
  } as unknown as OpenCodePort;
  const engine = new Engine({ store, ports: { git: gitPort, opencode: opencodePort } });
  const databaseService = {
    list: () => databaseStates.map((state, index) => ({ id: `db_${index}`, state })),
  } as unknown as DatabaseService;
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  registerRoutes(app, {
    engine,
    store,
    opencodeRef: { current: adapter },
    databaseService,
    paths: runtime,
    internalToken: 'test-internal-token',
    appVersion: '0.1.0',
    startedAt: nowIso(),
  });
  await app.ready();
  return {
    app,
    store,
    engine,
    stopCalls: () => stopCount,
    setDiagnosticsConnected: (connected) => {
      diagnosticsConnected = connected;
    },
    setDatabaseStates: (states) => {
      databaseStates = states;
    },
    async close() {
      await app.close();
      store.close();
    },
  };
}

test('W0-1/W0-5: restart returns a receipt, replays idempotently, and mcp.tools follows the enabled toolsets', async () => {
  const harness = await createFakeHarness();
  try {
    const missingKey = await harness.app.inject({ method: 'POST', url: '/api/opencode/restart', payload: { confirmRestart: true } });
    assert.equal(missingKey.statusCode, 400, missingKey.body);
    assert.equal(missingKey.json().error.code, 'VALIDATION_FAILED');

    const noConfirm = await harness.app.inject({ method: 'POST', url: '/api/opencode/restart', payload: { requestKey: requestKey('restart') } });
    assert.equal(noConfirm.statusCode, 400, noConfirm.body);

    const key = requestKey('restart');
    const payload = { requestKey: key, confirmRestart: true };
    const restarted = await harness.app.inject({ method: 'POST', url: '/api/opencode/restart', payload });
    assert.equal(restarted.statusCode, 200, restarted.body);
    const data = restarted.json().data as {
      receipt: { requestKey: string; status: string; operation: string };
      resource: { status: { state: string } };
    };
    assert.equal(data.receipt.requestKey, key);
    assert.equal(data.receipt.status, 'succeeded');
    assert.equal(data.receipt.operation, 'opencode.restart');
    assert.equal(data.resource.status.state, 'ready');
    assert.equal(harness.stopCalls(), 1);

    const replay = await harness.app.inject({ method: 'POST', url: '/api/opencode/restart', payload });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().data.receipt.requestKey, key);
    assert.equal(harness.stopCalls(), 1, 'a settled replay must not restart the process again');

    const statusResponse = await harness.app.inject({ method: 'GET', url: '/api/opencode/status' });
    assert.equal(statusResponse.statusCode, 200, statusResponse.body);
    assert.equal(statusResponse.json().data.status.mcp.connected, true);
    assert.equal(statusResponse.json().data.status.mcp.tools, 13);

    const smaller = await harness.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { requestKey: requestKey('toolsets'), patch: { opencode: { toolsets: ['workflow', 'git'] } } },
    });
    assert.equal(smaller.statusCode, 200, smaller.body);
    const smallerStatus = await harness.app.inject({ method: 'GET', url: '/api/opencode/status' });
    assert.equal(smallerStatus.json().data.status.mcp.tools, 8);

    harness.setDiagnosticsConnected(false);
    const disconnected = await harness.app.inject({ method: 'GET', url: '/api/opencode/status' });
    assert.equal(disconnected.json().data.status.mcp.connected, false);
    assert.equal(disconnected.json().data.status.mcp.tools, 0);

    const bootstrapBefore = await harness.app.inject({ method: 'GET', url: '/api/bootstrap' });
    assert.equal(bootstrapBefore.statusCode, 200, bootstrapBefore.body);
    assert.equal(bootstrapBefore.json().data.integration.database.connected, 0);
    harness.setDatabaseStates(['connected']);
    const bootstrapAfter = await harness.app.inject({ method: 'GET', url: '/api/bootstrap' });
    assert.equal(bootstrapAfter.json().data.integration.database.connected, 1);
  } finally {
    await harness.close();
  }
});

test('W1-9: settings, database connections and gitlab writes carry receipts; missing requestKey is 400', async () => {
  const token = 'ghp_settings_contract_token';
  const seen: { auth?: string } = {};
  const stub: Server = createServer((request, response) => {
    seen.auth = request.headers.authorization;
    if (request.method === 'GET' && request.url === '/user') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ login: 'contract-user' }));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ message: 'not found' }));
  });
  await new Promise<void>((resolveListen) => stub.listen(0, '127.0.0.1', () => resolveListen()));
  const address = stub.address();
  assert.ok(address !== null && typeof address === 'object');
  const stubUrl = `http://127.0.0.1:${address.port}`;
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-settings-receipt-')), disableOpenCode: true, disableListen: true });
  try {
    const missingSettingsKey = await app.app.inject({ method: 'PATCH', url: '/api/settings', payload: { patch: { monitoring: { pollIntervalMs: 2100 } } } });
    assert.equal(missingSettingsKey.statusCode, 400, missingSettingsKey.body);
    assert.equal(missingSettingsKey.json().error.code, 'VALIDATION_FAILED');

    const settingsKey = requestKey('settings');
    const settings = await app.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { requestKey: settingsKey, patch: { monitoring: { pollIntervalMs: 2100 } } },
    });
    assert.equal(settings.statusCode, 200, settings.body);
    const settingsData = settings.json().data as {
      receipt: { requestKey: string; status: string; operation: string };
      settings: { monitoring: { pollIntervalMs: number } };
      issues: readonly unknown[];
    };
    assert.equal(settingsData.receipt.requestKey, settingsKey);
    assert.equal(settingsData.receipt.status, 'succeeded');
    assert.equal(settingsData.receipt.operation, 'settings.update');
    assert.equal(settingsData.settings.monitoring.pollIntervalMs, 2100);

    const missingDatabaseKey = await app.app.inject({ method: 'POST', url: '/api/settings/databases', payload: { connection: { name: 'NoKey', type: 'mysql', host: '127.0.0.1', port: 3307, database: 'nokey', user: 'u' } } });
    assert.equal(missingDatabaseKey.statusCode, 400, missingDatabaseKey.body);

    const databaseKey = requestKey('database');
    const created = await app.app.inject({
      method: 'POST',
      url: '/api/settings/databases',
      payload: {
        requestKey: databaseKey,
        connection: { name: 'Receipt DB', type: 'mysql', host: '127.0.0.1', port: 3307, database: 'receipt_db', user: 'receipt', password: 'secret', readOnly: true },
      },
    });
    assert.equal(created.statusCode, 200, created.body);
    const createdData = created.json().data as {
      receipt: { requestKey: string; status: string };
      connection: { id: string; name: string; state: string };
    };
    assert.equal(createdData.receipt.requestKey, databaseKey);
    assert.equal(createdData.receipt.status, 'succeeded');
    assert.equal(createdData.connection.name, 'Receipt DB');
    assert.equal(createdData.connection.state, 'not_configured');
    assert.ok(!created.body.includes('"secret"'), 'password must not be echoed');

    const deletedKey = requestKey('database-delete');
    const removed = await app.app.inject({ method: 'DELETE', url: `/api/settings/databases/${encodeURIComponent(createdData.connection.id)}`, payload: { requestKey: deletedKey } });
    assert.equal(removed.statusCode, 200, removed.body);
    const removedData = removed.json().data as { receipt: { requestKey: string; status: string }; connections: readonly unknown[] };
    assert.equal(removedData.receipt.requestKey, deletedKey);
    assert.equal(removedData.receipt.status, 'succeeded');
    assert.equal(removedData.connections.length, 0);

    // Legacy clients call DELETE without a body; the server still records a receipt with a server key.
    const legacyKey = requestKey('database-legacy');
    const legacyCreated = await app.app.inject({
      method: 'POST',
      url: '/api/settings/databases',
      payload: {
        requestKey: legacyKey,
        connection: { name: 'Legacy DB', type: 'mysql', host: '127.0.0.1', port: 3308, database: 'legacy_db', user: 'legacy', readOnly: true },
      },
    });
    assert.equal(legacyCreated.statusCode, 200, legacyCreated.body);
    const legacyId = legacyCreated.json().data.connection.id as string;
    const legacyRemoved = await app.app.inject({ method: 'DELETE', url: `/api/settings/databases/${encodeURIComponent(legacyId)}` });
    assert.equal(legacyRemoved.statusCode, 200, legacyRemoved.body);
    const legacyData = legacyRemoved.json().data as { receipt: { requestKey: string; status: string } };
    assert.equal(legacyData.receipt.status, 'succeeded');
    assert.ok(legacyData.receipt.requestKey.startsWith('req_'));

    const missingGitlabKey = await app.app.inject({
      method: 'POST',
      url: '/api/settings/gitlab',
      payload: { provider: 'github', baseUrl: stubUrl, apiBaseUrl: stubUrl, token },
    });
    assert.equal(missingGitlabKey.statusCode, 400, missingGitlabKey.body);

    const gitlabKey = requestKey('gitlab');
    const gitlab = await app.app.inject({
      method: 'POST',
      url: '/api/settings/gitlab',
      payload: { requestKey: gitlabKey, provider: 'github', baseUrl: stubUrl, apiBaseUrl: stubUrl, token },
    });
    assert.equal(gitlab.statusCode, 200, gitlab.body);
    const gitlabData = gitlab.json().data as { receipt: { requestKey: string; status: string; operation: string }; connection: { state: string } };
    assert.equal(gitlabData.receipt.requestKey, gitlabKey);
    assert.equal(gitlabData.receipt.status, 'succeeded');
    assert.equal(gitlabData.receipt.operation, 'secret.save');
    assert.equal(gitlabData.connection.state, 'connected');
    assert.equal(seen.auth, `Bearer ${token}`);
    assert.ok(!gitlab.body.includes(token), 'token must never be echoed');

    const testConnection = await app.app.inject({ method: 'POST', url: '/api/settings/gitlab/test', payload: { provider: 'github' } });
    assert.equal(testConnection.statusCode, 200, testConnection.body);
    const testData = testConnection.json().data as { connection: { state: string }; mutating: boolean };
    assert.equal(testData.mutating, false);
    assert.equal(testData.connection.state, 'connected');

    const operations = await app.app.inject({ method: 'GET', url: `/api/operations/${settingsKey}` });
    assert.equal(operations.statusCode, 200, operations.body);
    assert.equal(operations.json().data.operation.status, 'succeeded');
  } finally {
    await app.close();
    await new Promise<void>((resolveClose) => stub.close(() => resolveClose()));
  }
});

test('W1-9: template archive carries a receipt and enforces confirmArchive', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-template-archive-')), disableOpenCode: true, disableListen: true });
  try {
    const template = {
      id: 'template.custom.api-contract',
      name: '契约测试模板',
      version: 1,
      lockedAfterCreate: true,
      steps: [{ key: 's1', title: '步骤一', kind: 'implementation', group: '固定步骤' }],
      parameters: [],
    };
    const imported = await app.app.inject({
      method: 'POST',
      url: '/api/catalog/templates/import',
      payload: { requestKey: requestKey('template-import'), template, confirmImport: true },
    });
    assert.equal(imported.statusCode, 200, imported.body);

    const missingKey = await app.app.inject({ method: 'DELETE', url: '/api/catalog/templates/template.custom.api-contract' });
    assert.equal(missingKey.statusCode, 400, missingKey.body);
    assert.equal(missingKey.json().error.code, 'VALIDATION_FAILED');

    const noConfirm = await app.app.inject({
      method: 'DELETE',
      url: '/api/catalog/templates/template.custom.api-contract',
      payload: { requestKey: requestKey('template-archive-noconfirm') },
    });
    assert.equal(noConfirm.statusCode, 400, noConfirm.body);

    const key = requestKey('template-archive');
    const archived = await app.app.inject({
      method: 'DELETE',
      url: '/api/catalog/templates/template.custom.api-contract',
      payload: { requestKey: key, confirmArchive: true },
    });
    assert.equal(archived.statusCode, 200, archived.body);
    const archivedData = archived.json().data as {
      receipt: { requestKey: string; status: string; operation: string };
      templates: readonly unknown[];
      resource: { templates: readonly unknown[] };
    };
    assert.equal(archivedData.receipt.requestKey, key);
    assert.equal(archivedData.receipt.status, 'succeeded');
    assert.equal(archivedData.receipt.operation, 'catalog.template.archive');
    assert.equal(archivedData.templates.length, 0);
    assert.equal(archivedData.resource.templates.length, 0);

    const archiveAgain = await app.app.inject({
      method: 'DELETE',
      url: '/api/catalog/templates/template.custom.api-contract',
      payload: { requestKey: requestKey('template-archive-missing'), confirmArchive: true },
    });
    assert.equal(archiveAgain.statusCode, 404, archiveAgain.body);
    assert.equal(archiveAgain.json().error.code, 'NOT_FOUND');
  } finally {
    await app.close();
  }
});

test('W1-9: delivery confirm flags are validated at runtime', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-delivery-confirm-'));
  const store = new Store({ dataDir });
  try {
    const commands = new CommandService(store);
    const context: EngineContext = {
      store,
      settings: () => DEFAULT_SETTINGS,
      projects: () => [],
      opencodeReady: () => false,
      gitlabConfigured: () => false,
      planningBudgetConfigured: () => false,
    };
    const service = new DeliveryService(store, commands, context, {} as unknown as GitPort, {} as unknown as WorkspaceService);
    const isValidationFailure = (error: unknown): boolean => error instanceof AppError && error.code === 'VALIDATION_FAILED';

    await assert.rejects(
      () => service.commit('task_missing', { requestKey: createId('req'), fileIds: [], message: 'm', expectedChangesRevision: 'r', expectedBranchHead: 'sha' } as unknown as DeliveryCommitRequest),
      isValidationFailure,
    );
    await assert.rejects(
      () => service.push('task_missing', { requestKey: createId('req'), expectedLocalSha: 'sha', remoteBranchName: 'task/x', expectRemote: 'absent' } as unknown as DeliveryPushRequest),
      isValidationFailure,
    );
    await assert.rejects(
      () => service.createMergeRequest('task_missing', { requestKey: createId('req'), sourceRef: 'task/x', pushedSha: 'sha', targetBranch: 'main', expectedTargetTip: 'tip', title: 't', description: 'd' } as unknown as DeliveryMergeRequestRequest),
      isValidationFailure,
    );
    await assert.rejects(
      () => service.merge('task_missing', { requestKey: createId('req'), targetBranch: 'main', expectedTargetSha: 'tip', sourceSha: 'sha', message: 'm', strategy: 'no_ff' } as unknown as DeliveryMergeRequest),
      isValidationFailure,
    );

    // The HTTP layer rejects a body without requestKey before the handler runs.
    const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-delivery-route-')), disableOpenCode: true, disableListen: true });
    try {
      const missingKey = await app.app.inject({ method: 'POST', url: '/api/tasks/task_missing/delivery/commit', payload: {} });
      assert.equal(missingKey.statusCode, 400, missingKey.body);
      assert.equal(missingKey.json().error.code, 'VALIDATION_FAILED');
    } finally {
      await app.close();
    }
  } finally {
    store.close();
  }
});
