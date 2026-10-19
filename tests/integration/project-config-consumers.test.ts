import type { OpenCodeMessage } from '@agent-workflow/opencode';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { Store } from '@agent-workflow/storage';
import { Engine, type EnginePorts, type OpenCodePort, type OpenCodeRunRequest, type OpenCodeRunResult } from '../../packages/engine/src/index.ts';
import { projectDocumentInstructions } from '../../packages/engine/src/project-documents.ts';
import { CharterService } from '../../packages/engine/src/project-task.ts';
import { RemoteService } from '../../packages/server/src/remote.ts';
class ControlledModel implements OpenCodePort {
  requests: OpenCodeRunRequest[] = [];
  complete?: (result: OpenCodeRunResult) => void;
  aborted = 0;
  abortFails = false;
  sessionState: 'idle' | 'running' | 'unknown' = 'running';
  messages: readonly OpenCodeMessage[] = [];
  async sessionMessages() { return this.messages; }
  async inspectSession() { return this.sessionState; }
  status(): ReturnType<OpenCodePort['status']> { return { state: 'ready' } as ReturnType<OpenCodePort['status']>; }
  async ensureReady() {}
  async findSessions() { return []; }
  async abortSession() { this.aborted++; if (this.abortFails) throw new Error('abort transport lost'); }
  async runSession(input: OpenCodeRunRequest): Promise<OpenCodeRunResult> {
    this.requests.push(input); input.onSessionId?.('charter-session');
    return new Promise((resolve) => { this.complete = resolve; });
  }
  finish(text: string) { this.complete?.({ sessionId: 'charter-session', outcome: { idle: true, timedOut: false, assistantText: text, messages: [] } }); }
}
const key = (name: string) => `req_project_${name}_123456789`;
function fixture() {
  const store = new Store({ dataDir: mkdtempSync(join(tmpdir(), 'aw-config-data-')) });
  const root = mkdtempSync(join(tmpdir(), 'aw-config-root-'));
  const model = new ControlledModel();
  const engine = new Engine({ store, ports: { git: {} as EnginePorts['git'], opencode: model }, integration: { opencodeReady: () => true, gitlabConfigured: () => false } });
  const project = store.projects.create({ name: 'Config', rootPath: root, gitState: 'not_git' });
  return { store, root, model, engine, project };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function dispatched(model: ControlledModel) {
  const deadline = Date.now() + 3000;
  while (model.requests.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(model.requests.length, 1, 'original generation must dispatch');
}
test('charter generation dispatches once read-only and saves a model draft without writing AGENTS.md', async () => {
  const { store, root, model, engine, project } = fixture();
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node --test actual-spec/*.test.mjs' } }));
    const input = { requestKey: key('generate'), confirmGenerate: true as const };
    const started = await engine.charters.generate(project.id, input);
    assert.equal(started.receipt.status, 'accepted');
    await engine.charters.generate(project.id, input);
    await dispatched(model);
    assert.equal(model.requests.length, 1);
    assert.equal(model.requests[0]?.permission, 'read_only');
    assert.equal(model.requests[0]?.toolPolicy, 'none');
    assert.match(model.requests[0]!.prompt, /actual-spec/);
    assert.ok(store.settings.getJson(`charter.context.${input.requestKey}`));
    await assert.rejects(engine.charters.generate(project.id, { ...input, requestKey: key('other') }));
    await assert.rejects(engine.charters.update(project.id, { requestKey: key('racingedit'), content: '# override' }));
    model.finish('# 实际项目公约\n\n- 运行 npm test。'); await tick();
    const view = await engine.charters.view(project.id);
    assert.equal(view.status, 'draft'); assert.equal(view.draft?.source, 'model');
    assert.equal(existsSync(join(root, 'AGENTS.md')), false);
    await engine.charters.confirm(project.id, { requestKey: key('confirm'), confirmWrite: true, expectedVersion: view.draft?.version });
    assert.equal(existsSync(join(root, 'AGENTS.md')), true);
  } finally { store.close(); }
});
test('charter stop acknowledgement does not unlock generation until original promise settles', async () => {
  const { store, model, engine, project } = fixture();
  try {
    await engine.charters.update(project.id, { requestKey: key('seed'), content: '# 保留的手工草稿' });
    await engine.charters.generate(project.id, { requestKey: key('stopped'), confirmGenerate: true }); await dispatched(model);
    const stop = await engine.charters.stop(project.id, { requestKey: key('stop'), confirmStop: true });
    assert.equal(stop.receipt.status, 'accepted');
    assert.equal(model.aborted, 1);
    assert.equal((await engine.charters.view(project.id)).status, 'generating');
    model.finish('# 迟到结果'); await tick();
    assert.equal((await engine.charters.view(project.id)).draft?.content, '# 保留的手工草稿');
    assert.equal(engine.commands.get(key('stopped'))?.outcome?.stopped, true);
  } finally { store.close(); }
});
test('document output policy uses configured directories and distinguishes empty paths from read permissions', () => {
  assert.match(projectDocumentInstructions({ docPaths: ['docs/design', 'changes'] }), /docs\/design、changes/);
  assert.match(projectDocumentInstructions({ docPaths: [] }), /不生成项目设计文档或变更说明/);
  assert.match(projectDocumentInstructions({ docPaths: ['docs'] }), /不授予额外读取或写入权限/);
});
test('project GitLab endpoint/path override is consumed and disabled project makes no remote request', async () => {
  const { store, project } = fixture(); let calls = 0; let lastUrl = '';
  const server = createServer((request, response) => { calls++; lastUrl = request.url ?? ''; assert.equal(request.headers['private-token'], 'test-token'); response.setHeader('content-type', 'application/json'); response.end('[]'); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (typeof address !== 'object' || address === null) throw new Error('no port');
    store.secrets.put('git:gitlab', 'test-token');
    const override = { inheritGlobal: false, enabled: true, baseUrl: `http://127.0.0.1:${address.port}`, projectPath: 'group/actual' };
    store.projects.update(project.id, { settings: { ...project.settings, gitlab: override } });
    const remote = new RemoteService(store);
    await remote.listMergeRequests(project.id);
    assert.equal(calls, 1); assert.match(lastUrl, /\/api\/v4\/projects\/group%2Factual\/merge_requests/);
    store.projects.update(project.id, { settings: { ...project.settings, gitlab: { ...override, enabled: false } } });
    await remote.listMergeRequests(project.id); assert.equal(calls, 1);
  } finally { server.close(); store.close(); }
});

test('restart exposes persisted generation as unknown and blocks a new model dispatch', async () => {
  const { store, model, engine, project } = fixture();
  try {
    store.settings.putJson(`project.charter.${project.id}`, { status: 'generating', versions: [], generation: { requestKey: key('old-process'), startedAt: new Date().toISOString() }, updatedAt: new Date().toISOString() });
    const restarted = new CharterService(store, engine.commands, model, engine.context);
    const view = await restarted.view(project.id);
    assert.equal(view.status, 'unknown'); assert.equal(view.generation?.requestKey, key('old-process'));
    assert.equal(view.capabilities.generate.allowed, false);
    await assert.rejects(restarted.generate(project.id, { requestKey: key('after-restart'), confirmGenerate: true }));
    assert.equal(model.requests.length, 0);
  } finally { store.close(); }
});

test('abort failure is an unknown stop receipt and cannot reopen generation', async () => {
  const { store, model, engine, project } = fixture();
  try {
    await engine.charters.generate(project.id, { requestKey: key('abort-generation'), confirmGenerate: true }); await dispatched(model);
    model.abortFails = true;
    const stopped = await engine.charters.stop(project.id, { requestKey: key('abort-failed'), confirmStop: true });
    assert.equal(stopped.receipt.status, 'unknown');
    assert.equal((await engine.charters.view(project.id)).status, 'generating');
    await assert.rejects(engine.charters.generate(project.id, { requestKey: key('abort-new'), confirmGenerate: true }));
    assert.equal(model.requests.length, 1);
    model.finish('# 迟到正文'); await tick();
    assert.equal((await engine.charters.view(project.id)).draft, undefined);
  } finally { store.close(); }
});

test('charter timeout after abort failure remains unknown, restart reconciliation needs explicit idle', async () => {
  const { store, model, engine, project } = fixture();
  try {
    await engine.charters.update(project.id, { requestKey: key('timeout-seed'), content: '# 保留草稿' });
    await engine.charters.generate(project.id, { requestKey: key('timeout-generate'), confirmGenerate: true }); await dispatched(model);
    model.abortFails = true;
    await engine.charters.stop(project.id, { requestKey: key('timeout-stop'), confirmStop: true });
    model.complete?.({ sessionId: 'charter-session', outcome: { idle: false, timedOut: true, assistantText: '', messages: [] } }); await tick();
    assert.equal(engine.commands.get(key('timeout-generate'))?.status, 'unknown');
    assert.equal(engine.commands.get(key('timeout-stop'))?.status, 'unknown');
    const restarted = new CharterService(store, engine.commands, model, engine.context);
    await restarted.reconcileOperation(key('timeout-stop'));
    assert.equal(engine.commands.get(key('timeout-stop'))?.status, 'unknown');
    assert.equal(model.aborted, 1);
    model.sessionState = 'idle';
    await restarted.reconcileOperation(key('timeout-stop'));
    assert.equal(engine.commands.get(key('timeout-stop'))?.status, 'succeeded');
    assert.equal(engine.commands.get(key('timeout-generate'))?.status, 'succeeded');
    assert.equal((await restarted.view(project.id)).draft?.content, '# 保留草稿');
    assert.equal(model.aborted, 1);
  } finally { store.close(); }
});


test('charter original-key completion recovery requires idle and completed original session text, ignores late old output', async () => {
  const { store, model, engine, project } = fixture();
  try {
    const requestKey = key('recover-complete');
    await engine.charters.generate(project.id, { requestKey, confirmGenerate: true }); await dispatched(model);
    const restarted = new CharterService(store, engine.commands, model, engine.context);
    const message: OpenCodeMessage = { info: { id: 'msg-charter', sessionID: 'charter-session', role: 'assistant', time: { created: Date.now(), completed: Date.now() } }, parts: [{ id: 'text-charter', type: 'text', text: '# 恢复的原会话公约' }] };
    model.messages = [message];
    await restarted.reconcileOperation(requestKey);
    assert.equal(engine.commands.get(requestKey)?.status, 'accepted', 'running cannot be settled from completed message alone');
    model.sessionState = 'idle';
    model.messages = [{ ...message, info: { ...message.info, time: { created: Date.now() } } }];
    await restarted.reconcileOperation(requestKey);
    assert.equal(engine.commands.get(requestKey)?.status, 'accepted', 'incomplete message cannot be promoted');
    model.messages = [message];
    await restarted.reconcileOperation(requestKey);
    assert.equal(engine.commands.get(requestKey)?.status, 'succeeded');
    assert.equal((await restarted.view(project.id)).draft?.content, '# 恢复的原会话公约');
    assert.equal(model.requests.length, 1); assert.equal(model.aborted, 0);
    await restarted.update(project.id, { requestKey: key('after-recovery'), content: '# 用户后续编辑' });
    model.finish('# 迟到的旧正文'); await tick();
    await restarted.reconcileOperation(requestKey);
    assert.equal((await restarted.view(project.id)).draft?.content, '# 用户后续编辑');
  } finally { store.close(); }
});
