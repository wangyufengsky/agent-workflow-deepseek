import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../../packages/server/src/index.ts';
import { Store } from '@agent-workflow/storage';
import { DEFAULT_SETTINGS, type PlanGraph } from '@agent-workflow/shared';
import { Engine, RuntimeInteractionService, CommandService, type OpenCodePort, type OpenCodeRunRequest } from '../../packages/engine/src/index.ts';
import type { PermissionRequest, QuestionRequest } from '@agent-workflow/opencode';

// Durable real SQLite + offline runtime port. No model/remote-write acceptance.
function fixture(existingStore?: Store) {
  const store = existingStore ?? new Store({ dataDir: mkdtempSync(join(tmpdir(), 'aw-runtime-inbox-')) });
  const project = store.projects.create({ name: 'Inbox', rootPath: tmpdir(), gitState: 'not_git' });
  const task = store.tasks.create({ projectId: project.id, title: 'Runtime task', requirementText: 'offline', methodId: 'method.requirement-development', methodRevision: 'r1' });
  const graph: PlanGraph = { nodes: [{ id: 'node_q', key: 'q', title: 'Original step', kind: 'implementation', groupId: 'g', summary: '', inputs: [], outputs: [], acceptance: [], resources: { read: [], write: [] } }], edges: [], groups: [] };
  const plan = store.plans.create({ taskId: task.id, graph, status: 'confirmed', source: 'skeleton' });
  const execution = store.executions.create({ taskId: task.id, planRevisionId: plan.id, graph, autoAdvance: true });
  const attempt = store.executions.createAttempt({ executionId: execution.id, nodeId: 'node_q', ordinal: 1, definition: { planRevisionId: plan.id, node: graph.nodes[0]! } });
  store.executions.update(execution.id, { status: 'running' });
  store.executions.updateNode(execution.id, 'node_q', { status: 'running', currentAttemptId: attempt.id });
  store.tasks.update(task.id, { executionId: execution.id });
  let allowed = true; let fail = false; let pauseRead: (() => Promise<void>) | undefined;
  let requests: readonly Record<string, unknown>[] = [];
  const writes: unknown[] = []; let reads = 0;
  const port: OpenCodePort = { status: () => ({ state: 'ready' }) as never, ensureReady: async () => {}, abortSession: async () => {}, findSessions: async () => [], runSession: async () => { throw new Error('not used'); },
    runtimePermissionAllowed: () => allowed,
    runtimeRequests: async () => { reads++; await pauseRead?.(); return requests; },
    replyRuntimePermission: async (...args) => { writes.push(args); if (fail) throw new Error('offline response lost'); },
    replyRuntimeQuestion: async (...args) => { writes.push(args); if (fail) throw new Error('offline response lost'); },
  };
  const commands = new CommandService(store); const service = new RuntimeInteractionService(store, commands, port);
  const request: OpenCodeRunRequest = { kind: 'execution', metadata: { taskId: task.id, executionId: execution.id, nodeId: 'node_q', attemptId: attempt.id }, cwd: tmpdir(), prompt: '', permission: 'read_only', model: DEFAULT_SETTINGS.models[0]!, timeoutMs: 1000, sink: {} };
  const wrapped = service.wrap(request); wrapped.onSessionId?.('ses_ours');
  const permission = (id = 'per_a', patterns = ['/safe']) => ({ id, sessionID: 'ses_ours', protocol: 'v2', permission: 'read', patterns }) satisfies PermissionRequest;
  const ask = async (id = 'per_a', patterns = ['/safe']) => { const value = permission(id, patterns); requests = [{ id, sessionID: value.sessionID, action: value.permission, resources: value.patterns }]; assert.equal(await wrapped.sink.onPermission?.(value), 'defer'); return service.list().find((item) => item.requestId === id)!; };
  const question = async (multiple = false, custom = true) => {
    const value: QuestionRequest = { id: 'que_a', sessionID: 'ses_ours', protocol: 'v2', questions: [{ question: 'Choose output', header: 'Output', options: [{ label: 'Markdown', description: 'plain' }, { label: 'HTML', description: 'page' }], multiple, custom }] };
    requests = [value as unknown as Record<string, unknown>]; await wrapped.sink.onQuestion?.(value); return service.list()[0]!;
  };
  return { store, request, project, task, execution, attempt, port, commands, service, wrapped, ask, question, writes, permission, setAllowed: (value: boolean) => { allowed = value; }, setFail: (value: boolean) => { fail = value; }, setRequests: (value: typeof requests) => { requests = value; }, pauseRead: (value: () => Promise<void>) => { pauseRead = value; }, reads: () => reads };
}
const command = (requestKey: string, action: 'once' | 'session' | 'reject' | 'ack' = 'once') => ({ requestKey, action, confirmResolve: true as const });

test('permission identity is durable, original-key replay never repeats and changed bodies are rejected', async () => {
  const f = fixture(); try {
    const item = await f.ask(); assert.equal(item.binding.attemptId, f.attempt.id); assert.equal(item.stepName, 'Original step');
    const response = await f.service.resolve(item.id, command('req_permission'));
    assert.equal(response.receipt.status, 'succeeded'); assert.equal(f.writes.length, 1); assert.deepEqual(f.writes[0], ['ses_ours', 'per_a', 'once', 'v2']);
    f.setAllowed(false); f.setRequests([]);
    assert.equal((await f.service.resolve(item.id, command('req_permission'))).receipt.status, 'succeeded'); assert.equal(f.writes.length, 1);
    await assert.rejects(f.service.resolve(item.id, command('req_permission', 'reject')), /同一请求号/);
    await assert.rejects(f.service.resolve(item.id, command('req_other')), /原请求已处理/);
  } finally { f.store.close(); }
});

test('UNKNOWN replay and restart reconcile only read; late exact confirmation can settle', async () => {
  const f = fixture(); try {
    const item = await f.ask(); f.setFail(true);
    assert.equal((await f.service.resolve(item.id, command('req_unknown'))).receipt.status, 'unknown');
    f.setFail(false); f.setRequests([]);
    assert.equal((await f.service.resolve(item.id, command('req_unknown'))).receipt.status, 'unknown');
    const restarted = new RuntimeInteractionService(f.store, f.commands, f.port); restarted.recoverOnStartup();
    await restarted.reconcileOperation('req_unknown'); assert.equal(f.writes.length, 1); assert.equal(f.commands.get('req_unknown')?.status, 'unknown');
    restarted.confirm({ kind: 'permission', sessionID: 'foreign', requestID: 'per_a', reply: 'once' }); assert.equal(f.commands.get('req_unknown')?.status, 'unknown');
    restarted.confirm({ kind: 'permission', sessionID: 'ses_ours', requestID: 'per_a', reply: 'reject' }); assert.equal(f.commands.get('req_unknown')?.status, 'unknown');
    restarted.confirm({ kind: 'permission', sessionID: 'ses_ours', requestID: 'per_a', reply: 'once' }); assert.equal(f.commands.get('req_unknown')?.status, 'succeeded');
  } finally { f.store.close(); }
});

test('hard denial is sent immediately and only acknowledgment is available; a late reject cannot reopen acknowledged item', async () => {
  const f = fixture(); try {
    f.setAllowed(false); const item = await f.ask(); assert.equal(item.hard, true); assert.deepEqual(f.writes[0], ['ses_ours','per_a','reject','v2']);
    await assert.rejects(f.service.resolve(item.id, command('req_elevate')), /硬性策略/);
    assert.equal((await f.service.resolve(item.id, command('req_ack', 'ack'))).receipt.status, 'succeeded');
    f.service.confirm({ kind: 'permission', sessionID: 'ses_ours', requestID: 'per_a', reply: 'reject' });
    assert.equal(f.service.get(item.id).state, 'resolved'); assert.equal(f.writes.length, 1);
  } finally { f.store.close(); }
});

test('session allowance only repeats once for the same exact session pattern and is rechecked against revocation', async () => {
  const f = fixture(); try {
    const first = await f.ask(); await f.service.resolve(first.id, command('req_session', 'session'));
    const next = await f.ask('per_b'); assert.equal(f.service.get(next.id).state, 'resolved'); assert.equal(f.writes.length, 2);
    const different = await f.ask('per_c', ['/other']); assert.equal(different.state, 'open'); assert.equal(f.writes.length, 2);
    f.setAllowed(false); const revoked = await f.ask('per_d'); assert.equal(revoked.hard, true); assert.deepEqual(f.writes[2], ['ses_ours','per_d','reject','v2']);
  } finally { f.store.close(); }
});

test('native question answers use frozen option IDs, ordered labels, multiple/custom rules and runtime rejection', async () => {
  const f = fixture(); try {
    const item = await f.question();
    await assert.rejects(f.service.resolve(item.id, { ...command('req_bad', 'once'), action: 'answer', answers: [{ questionId: 'q0', values: ['o0','o1'] }] }), /单选/);
    await assert.rejects(f.service.resolve(item.id, { ...command('req_bad'), action: 'answer', answers: [{ questionId: 'q0', values: ['forged'] }] }), /不属于/);
    const body = { ...command('req_answer'), action: 'answer' as const, answers: [{ questionId: 'q0', values: ['o1'] }] };
    assert.equal((await f.service.resolve(item.id, body)).receipt.status, 'succeeded'); assert.deepEqual(f.writes[0], ['ses_ours','que_a',[['HTML']],'v2']);
    assert.equal((await f.service.resolve(item.id, body)).receipt.status, 'succeeded'); assert.equal(f.writes.length, 1);
  } finally { f.store.close(); }
  const g = fixture(); try { const item = await g.question(); await g.service.resolve(item.id, command('req_reject', 'reject')); assert.deepEqual(g.writes[0], ['ses_ours','que_a',undefined,'v2']); } finally { g.store.close(); }
});

test('request mutation and stop during the read check prevent dispatch', async () => {
  const f = fixture(); try {
    const item = await f.ask(); f.setRequests([{ id: item.requestId, sessionID: 'ses_ours', action: 'read', resources: ['/changed'] }]);
    await assert.rejects(f.service.resolve(item.id, command('req_changed')), /内容变化/); assert.equal(f.writes.length, 0);
    await f.ask(); f.setRequests([{ id: item.requestId, sessionID: 'ses_ours', action: 'read', resources: ['/safe'] }]);
    f.pauseRead(async () => { f.store.executions.update(f.execution.id, { status: 'stopping' }); });
    await assert.rejects(f.service.resolve(item.id, command('req_stopped')), /会话已结束/); assert.equal(f.writes.length, 0);
  } finally { f.store.close(); }
});


test('real HTTP exposes persisted native requests, idempotent independent receipts and by-key read-only UNKNOWN reconciliation', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-runtime-http-')), disableOpenCode: true, disableListen: true });
  const f = fixture(app.store);
  Object.assign(app.engine, { runtimeInteractions: f.service });
  try {
    const item = await f.ask();
    const list = await app.app.inject({ method: 'GET', url: '/api/runtime-interactions' }); assert.equal(list.statusCode, 200); assert.equal(list.json().data.items[0].binding.attemptId, f.attempt.id);
    const invalid = await app.app.inject({ method: 'POST', url: `/api/runtime-interactions/${item.id}/resolve`, payload: { requestKey: 'req_http_invalid', action: 'once' } }); assert.equal(invalid.statusCode, 400);
    f.setFail(true);
    const payload = command('req_http_unknown');
    const first = await app.app.inject({ method: 'POST', url: `/api/runtime-interactions/${item.id}/resolve`, payload }); assert.equal(first.statusCode, 200, first.body); assert.equal(first.json().data.receipt.status, 'unknown');
    f.setFail(false); f.setRequests([]);
    const replay = await app.app.inject({ method: 'POST', url: `/api/runtime-interactions/${item.id}/resolve`, payload }); assert.equal(replay.json().data.receipt.status, 'unknown');
    const check = await app.app.inject({ method: 'GET', url: '/api/operations/req_http_unknown' }); assert.equal(check.statusCode, 200, check.body); assert.equal(check.json().data.operation.status, 'unknown'); assert.equal(f.writes.length, 1);
  } finally { await app.close(); }
});

test('same-key concurrent reads return accepted/succeeded replay and dispatch only one runtime write', async () => {
  const f = fixture(); try {
    const item = await f.ask(); let release!: () => void; const barrier = new Promise<void>((resolve) => { release = resolve; }); let reads = 0;
    f.pauseRead(async () => { if (++reads === 2) release(); await barrier; });
    const replies = await Promise.all([f.service.resolve(item.id, command('req_concurrent')), f.service.resolve(item.id, command('req_concurrent'))]);
    assert.equal(f.writes.length, 1); assert.ok(replies.every((reply) => ['accepted','succeeded'].includes(reply.receipt.status)));
  } finally { f.store.close(); }
});

test('question multiple/custom values remain ordered and single-select plus custom is rejected', async () => {
  const f = fixture(); try {
    const item = await f.question(true); await f.service.resolve(item.id, { ...command('req_multi'), action: 'answer', answers: [{ questionId: 'q0', values: ['o1','o0'], other: 'PDF' }] });
    assert.deepEqual(f.writes[0], ['ses_ours','que_a',[['HTML','Markdown','PDF']],'v2']);
  } finally { f.store.close(); }
  const g = fixture(); try { const item = await g.question(false); await assert.rejects(g.service.resolve(item.id, { ...command('req_single'), action: 'answer', answers: [{ questionId: 'q0', values: ['o0'], other: 'PDF' }] }), /有效答复/); } finally { g.store.close(); }
  const h = fixture(); try { const item = await h.question(false, false); await assert.rejects(h.service.resolve(item.id, { ...command('req_custom'), action: 'answer', answers: [{ questionId: 'q0', other: 'PDF' }] }), /不属于/); } finally { h.store.close(); }
});

test('current read revocation masks native question bodies and disables cached authorization', async () => {
  const f = fixture(); try {
    const item = await f.question();
    f.store.db.prepare("UPDATE attempts SET readability_json = ? WHERE id = ?").run(JSON.stringify({ output: 'forbidden', tools: 'forbidden', result: 'forbidden' }), f.attempt.id);
    const view = f.service.view(f.service.get(item.id)); assert.deepEqual(view.questions, []); assert.equal(view.resolveAllowed, false);
    await assert.rejects(f.service.resolve(item.id, command('req_read_revoked', 'reject')), /权限已撤回/); assert.equal(f.writes.length, 0);
  } finally { f.store.close(); }
});


test('engine bridge updates real task attention and sidebar from native questions, then clears both on reply', async () => {
  const f = fixture();
  try {
    const engine = new Engine({ store: f.store, ports: { git: {} as never, opencode: f.port } });
    const wrapped = engine.runtimeInteractions.wrap(f.request); wrapped.onSessionId?.('ses_ours');
    const question: QuestionRequest = { id: 'que_engine', sessionID: 'ses_ours', protocol: 'v2', questions: [{ question: 'Need output?', header: 'Output', options: [{ label: 'Yes', description: 'create' }], custom: false }] };
    f.setRequests([question as unknown as Record<string, unknown>]); await wrapped.sink.onQuestion?.(question);
    assert.equal(engine.tasks.get(f.task.id).attention, 'waiting_user');
    const item = engine.runtimeInteractions.list()[0]!; assert.equal(engine.inbox.list().find((entry) => entry.id === item.id)?.kind, 'runtime_question');
    await engine.runtimeInteractions.resolve(item.id, { ...command('req_engine'), action: 'answer', answers: [{ questionId: 'q0', values: ['o0'] }] });
    assert.equal(engine.tasks.get(f.task.id).attention, 'none'); assert.equal(engine.inbox.list().some((entry) => entry.id === item.id), false);
  } finally { f.store.close(); }
});

test('late exact question confirmation settles UNKNOWN without another write; unrelated answers do not', async () => {
  const f = fixture(); try {
    const item = await f.question(true); f.setFail(true);
    const reply = await f.service.resolve(item.id, { ...command('req_late_question'), action: 'answer', answers: [{ questionId: 'q0', values: ['o1'], other: 'PDF' }] });
    assert.equal(reply.receipt.status, 'unknown');
    f.service.confirm({ kind: 'question', sessionID: 'ses_ours', requestID: 'que_a', answers: [['Markdown']] }); assert.equal(f.commands.get('req_late_question')?.status, 'unknown');
    f.service.confirm({ kind: 'question', sessionID: 'ses_ours', requestID: 'que_a', answers: [['HTML','PDF']] }); assert.equal(f.commands.get('req_late_question')?.status, 'succeeded'); assert.equal(f.writes.length, 1);
  } finally { f.store.close(); }
});

test('superseded attempts cannot authorize stale requests and hard-reject UNKNOWN can only settle from exact evidence', async () => {
  const f = fixture(); try {
    const item = await f.ask(); const replacement = f.store.executions.createAttempt({ executionId: f.execution.id, nodeId: 'node_q', ordinal: 2 });
    f.store.executions.updateNode(f.execution.id, 'node_q', { currentAttemptId: replacement.id });
    assert.equal(f.service.view(item).resolveAllowed, false); await assert.rejects(f.service.resolve(item.id, command('req_old_attempt')), /不再活动/); assert.equal(f.writes.length, 0);
  } finally { f.store.close(); }
  const g = fixture(); try {
    g.setAllowed(false); g.setFail(true); const item = await g.ask(); const unknown = g.service.get(item.id); assert.equal(unknown.state, 'unknown'); assert.ok(unknown.requestKey);
    g.service.confirm({ kind: 'permission', sessionID: 'ses_ours', requestID: 'per_a', reply: 'reject' }); assert.equal(g.commands.get(unknown.requestKey!)?.status, 'succeeded'); assert.equal(g.service.get(item.id).state, 'open');
    g.setFail(false); await g.service.resolve(item.id, command('req_after_deny', 'ack')); assert.equal(g.writes.length, 1);
  } finally { g.store.close(); }
});

test('native text-only question is answerable without inventing choices', async () => {
  const f = fixture(); try {
    const question: QuestionRequest = { id: 'que_text', sessionID: 'ses_ours', protocol: 'v2', questions: [{ question: 'Explain?', header: 'Context', options: [], custom: true }] };
    f.setRequests([question as unknown as Record<string, unknown>]); await f.wrapped.sink.onQuestion?.(question); const item = f.service.list()[0]!;
    assert.equal(item.questions[0]!.options, undefined);
    await f.service.resolve(item.id, { ...command('req_free_text'), action: 'answer', answers: [{ questionId: 'q0', other: 'Some context' }] });
    assert.deepEqual(f.writes[0], ['ses_ours','que_text',[['Some context']],'v2']);
  } finally { f.store.close(); }
});

test('multiple-question confirmation matches question identity rather than client answer order', async () => {
  const f = fixture(); try {
    const question: QuestionRequest = { id: 'que_order', sessionID: 'ses_ours', protocol: 'v2', questions: [
      { question: 'First?', header: 'First', options: [{ label: 'A', description: 'a' }] },
      { question: 'Second?', header: 'Second', options: [{ label: 'B', description: 'b' }] },
    ] };
    f.setRequests([question as unknown as Record<string, unknown>]); await f.wrapped.sink.onQuestion?.(question); const item = f.service.list()[0]!; f.setFail(true);
    await f.service.resolve(item.id, { ...command('req_question_order'), action: 'answer', answers: [{ questionId: 'q1', values: ['o0'] }, { questionId: 'q0', values: ['o0'] }] });
    assert.equal(f.commands.get('req_question_order')?.status, 'unknown');
    f.store.db.prepare('UPDATE attempts SET readability_json = ? WHERE id = ?').run(JSON.stringify({ output: 'forbidden' }), f.attempt.id);
    const masked = f.service.view(f.service.get(item.id)); assert.equal(masked.resolution, undefined); assert.equal(masked.confirmation, undefined); assert.deepEqual(masked.questions, []);
    f.service.confirm({ kind: 'question', sessionID: 'ses_ours', requestID: 'que_order', answers: [['A'],['B']] });
    assert.equal(f.commands.get('req_question_order')?.status, 'succeeded'); assert.equal(f.writes.length, 1);
  } finally { f.store.close(); }
});
