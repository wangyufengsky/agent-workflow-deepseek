import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createApplication } from '../../packages/server/src/index.ts';
import { exportPpt, type PptExportHost } from '../../apps/desktop/src/ppt-export.ts';
import { createRequestKey, type PptAssistantView, type PptWork } from '@agent-workflow/shared';
import type { OpenCodeRunRequest, OpenCodeRunResult } from '../../packages/engine/src/ports.ts';
async function fixture() { const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-pptassistant-')), disableOpenCode: true, disableListen: true }); Object.defineProperty(app.engine.context, 'opencodeReady', { value: () => true }); let work = app.engine.ppt.create({ requestKey: createRequestKey(), title: '演示 <unsafe>', topic: '主题', confirmCreate: true }).resource![0]!; work = app.engine.ppt.update(work.id, { requestKey: createRequestKey(), confirmUpdate: true, theme: 'warm', outline: ['人工标题', '另一页'], slides: [{ title: '人工标题', bullets: ['原句'], notes: '人工备注', titleStyle: { fontSize: 40, color: 'accent', align: 'center' }, tag: '人工标签' }, { title: '另一页', bullets: ['不改'], notes: '保留' }] }).resource!; return { app, work }; }
function respond(app: Awaited<ReturnType<typeof createApplication>>, value: unknown, inputs: OpenCodeRunRequest[] = []) { app.engine.ports.opencode.runSession = async (input) => { inputs.push(input); input.onSessionId?.('assistant-controlled-session'); return { sessionId: 'assistant-controlled-session', outcome: { idle: true, timedOut: false, assistantText: JSON.stringify(value), messages: [] } } as OpenCodeRunResult; }; }
test('assistant produces reviewable scoped proposal, applies through actual command receipt, retains manual styles and unrelated pages', async () => {
    const { app, work } = await fixture();
    try {
        const inputs: OpenCodeRunRequest[] = [];
        respond(app, { reply: '建议精简这一页，应用前内容不会改变。', proposal: { summary: '仅精简第一页', pages: [{ index: 0, title: '精简标题', bullets: ['新句'], notes: '新的演讲备注' }] } }, inputs);
        const before = app.store.pptWorks.get(work.id)!;
        const ask = await app.app.inject({ method: 'POST', url: `/api/ppt/works/${work.id}/assistant`, payload: { requestKey: createRequestKey(), expectedRevision: work.revision, message: '精简第一页', scope: 'page', pageIndex: 0, confirmSend: true } });
        assert.equal(ask.statusCode, 200, ask.body);
        assert.equal(ask.json().data.receipt.status, 'succeeded');
        assert.deepEqual(app.store.pptWorks.get(work.id), before, 'reply itself changes no work content or revision');
        assert.equal(inputs[0]?.permission, 'read_only');
        assert.equal(inputs[0]?.toolPolicy, 'none');
        const view = ask.json().data.resource as PptAssistantView;
        const proposal = view.proposals[0]!;
        assert.deepEqual(proposal.patch.pages?.[0]?.before.bullets, ['原句']);
        const key = createRequestKey();
        const applied = await app.app.inject({ method: 'POST', url: `/api/ppt/works/${work.id}/assistant/decide`, payload: { requestKey: key, proposalId: proposal.id, decision: 'apply', confirm: true } });
        assert.equal(applied.statusCode, 200, applied.body);
        const changed = app.store.pptWorks.get(work.id)!;
        assert.equal(changed.slides[0]?.title, '精简标题');
        assert.equal(changed.outline[0], '精简标题');
        assert.deepEqual(changed.slides[0]?.titleStyle, before.slides[0]?.titleStyle);
        assert.equal(changed.slides[0]?.tag, '人工标签');
        assert.deepEqual(changed.slides[1], before.slides[1]);
        assert.equal(changed.versions?.[0]?.revision, before.revision);
        assert.equal((await app.app.inject({ method: 'GET', url: `/api/operations/${key}` })).json().data.operation.outcome.applied, true);
        const replay = await app.app.inject({ method: 'POST', url: `/api/ppt/works/${work.id}/assistant/decide`, payload: { requestKey: key, proposalId: proposal.id, decision: 'apply', confirm: true } });
        assert.equal(replay.json().data.receipt.status, 'succeeded');
        assert.equal(app.store.pptWorks.get(work.id)?.revision, changed.revision);
    }
    finally {
        await app.close();
    }
});
test('assistant refuses out-of-scope pages; stale proposals retain review evidence and never overwrite newer manual input', async () => {
    const { app, work } = await fixture();
    try {
        respond(app, { reply: '越界建议', proposal: { summary: '不应接受', pages: [{ index: 1, title: '越界', bullets: ['bad'] }] } });
        const bad = await app.app.inject({ method: 'POST', url: `/api/ppt/works/${work.id}/assistant`, payload: { requestKey: createRequestKey(), expectedRevision: work.revision, message: '仅改第一页', scope: 'page', pageIndex: 0, confirmSend: true } });
        assert.equal(bad.statusCode, 400, bad.body);
        assert.equal(app.store.pptWorks.get(work.id)?.slides[1]?.title, '另一页');
        respond(app, { reply: '候选', proposal: { summary: '替换', pages: [{ index: 0, title: '候选', bullets: ['candidate'] }] } });
        const asked = await app.engine.ppt.assistant.ask(work.id, { requestKey: createRequestKey(), expectedRevision: work.revision!, message: '改第一页', scope: 'page', pageIndex: 0, confirmSend: true });
        const proposal = asked.resource!.proposals[0]!;
        const manual = app.engine.ppt.update(work.id, { requestKey: createRequestKey(), confirmUpdate: true, expectedRevision: work.revision, topic: '稍后的人工输入' }).resource!;
        const conflict = await app.app.inject({ method: 'POST', url: `/api/ppt/works/${work.id}/assistant/decide`, payload: { requestKey: createRequestKey(), proposalId: proposal.id, decision: 'apply', confirm: true } });
        assert.equal(conflict.statusCode, 409, conflict.body);
        assert.equal(app.store.pptWorks.get(work.id)?.topic, manual.topic);
        assert.equal(app.engine.ppt.assistant.view(work.id).proposals[0]?.status, 'pending');
        app.engine.ppt.assistant.decide(work.id, { requestKey: createRequestKey(), proposalId: proposal.id, decision: 'discard', confirm: true });
        assert.equal(app.engine.ppt.assistant.view(work.id).proposals[0]?.status, 'discarded');
    }
    finally {
        await app.close();
    }
});
test('assistant timeout locks original key and by-key preserves unknown without idle proof', async () => {
    const { app, work } = await fixture();
    try {
        let prompts = 0;
        app.engine.ports.opencode.runSession = async (input) => { prompts++; input.onSessionId?.('unknown-assistant'); return { sessionId: 'unknown-assistant', outcome: { idle: false, timedOut: true, assistantText: '', messages: [] } } as OpenCodeRunResult; };
        app.engine.ports.opencode.inspectSession = async () => 'running';
        const key = createRequestKey();
        const request = { requestKey: key, expectedRevision: work.revision!, message: '讨论', scope: 'brief' as const, confirmSend: true as const };
        await assert.rejects(() => app.engine.ppt.assistant.ask(work.id, request));
        assert.equal(app.engine.commands.get(key)?.status, 'unknown');
        await assert.rejects(() => app.engine.ppt.assistant.ask(work.id, { ...request, requestKey: createRequestKey() }));
        assert.equal(prompts, 1);
        const blocked = app.engine.ppt.list().works.find(item => item.id === work.id)!;
        assert.equal(blocked.mutationBlock?.requestKey, key);
        const check = await app.app.inject({ method: 'GET', url: `/api/operations/${key}` });
        assert.equal(check.json().data.operation.status, 'unknown');
        assert.equal(app.store.pptWorks.get(work.id)?.slides[0]?.title, '人工标题');
    }
    finally {
        await app.close();
    }
});
test('export document and native PPTX share current real content/styles, native exporter validates revision/hash/cancellation and actual saved ZIP', async () => {
    const { app, work } = await fixture();
    try {
        const url = `/api/ppt/works/${work.id}`;
        const doc = (await app.app.inject({ method: 'GET', url: `${url}/document?revision=${work.revision}` })).json().data;
        assert.match(doc.html, /演示 &lt;unsafe&gt;/);
        assert.match(doc.html, /人工备注/);
        assert.equal(doc.pages, 5);
        const slidesOnly = (await app.app.inject({ method: 'GET', url: `${url}/document?revision=${work.revision}&includeNotes=false` })).json().data;
        assert.equal(slidesOnly.pages, 3);
        assert.doesNotMatch(slidesOnly.html, /人工备注/);
        assert.match(doc.html, /font-size="53\.32"/);
        assert.equal(createHash('sha256').update(doc.html).digest('hex'), doc.sha256);
        assert.equal((await app.app.inject({ method: 'GET', url: `${url}/document?revision=1` })).statusCode, 409);
        const path = join(tmpdir(), `ppt-native-${createRequestKey()}.pptx`);
        let writes = 0;
        const host: PptExportHost = { baseUrl: 'http://local.test', fetch: (async (input) => { const target = new URL(String(input)); const result = await app.app.inject({ method: 'GET', url: target.pathname + target.search }); return new Response(new Uint8Array(result.rawPayload), { status: result.statusCode, headers: result.headers as HeadersInit }); }) as typeof fetch, choosePath: async () => path, printPdf: async () => { throw Error('this case tests actual PPTX export, not mocked PDF success'); }, write: async (path, bytes) => { writes++; writeFileSync(path, bytes); }, read: async (path) => readFileSync(path) };
        const saved = await exportPpt({ workId: work.id, revision: work.revision!, format: 'pptx' }, host);
        assert.equal(saved.status, 'saved');
        if (saved.status === 'saved')
            assert.equal(saved.filename, path.split('/').at(-1));
        assert.equal(writes, 1);
        assert.match(execFileSync('unzip', ['-p', path, 'ppt/slides/slide2.xml'], { encoding: 'utf8' }), /人工标题/);
        if (saved.status === 'saved')
            assert.equal(saved.sha256, createHash('sha256').update(readFileSync(path)).digest('hex'));
        const cancelled = await exportPpt({ workId: work.id, revision: work.revision!, format: 'pdf' }, { ...host, choosePath: async () => undefined });
        assert.equal(cancelled.status, 'cancelled');
        assert.equal(writes, 1);
        const failed = await exportPpt({ workId: work.id, revision: work.revision!, format: 'pdf' }, host);
        assert.equal(failed.status, 'failed');
        assert.equal(writes, 1);
        const corrupt = await exportPpt({ workId: work.id, revision: work.revision!, format: 'pdf' }, { ...host, fetch: (async () => new Response(JSON.stringify({ data: { ...doc, sha256: '0'.repeat(64) } }))) as typeof fetch });
        assert.equal(corrupt.status, 'failed');
        assert.equal(writes, 1);
    }
    finally {
        await app.close();
    }
});
test('whole-deck assistant candidate reviews brief and outline before applying only listed fields', async () => {
    const { app, work } = await fixture();
    try {
        respond(app, { reply: '请审阅整份建议', proposal: { summary: '调整简报和章节', brief: { audience: '研发团队', objective: '验收', length: '两页', style: '清晰', sources: '附件' }, outline: ['新章节一', '新章节二'], pages: [{ index: 1, title: '新章节二', bullets: ['整份建议第二页'] }] } });
        const response = await app.engine.ppt.assistant.ask(work.id, { requestKey: createRequestKey(), expectedRevision: work.revision!, message: '整份调整', scope: 'all', confirmSend: true });
        const proposal = response.resource!.proposals[0]!;
        assert.equal(proposal.scope, 'all');
        assert.deepEqual(proposal.before.outline, work.outline);
        assert.deepEqual(app.store.pptWorks.get(work.id)?.outline, work.outline);
        app.engine.ppt.assistant.decide(work.id, { requestKey: createRequestKey(), proposalId: proposal.id, decision: 'apply', confirm: true });
        const changed = app.store.pptWorks.get(work.id)!;
        assert.equal(changed.brief?.audience, '研发团队');
        assert.deepEqual(changed.outline, ['新章节一', '新章节二']);
        assert.deepEqual(changed.slides[0], work.slides[0]);
        assert.equal(changed.slides[1]?.notes, '保留');
    }
    finally {
        await app.close();
    }
});
test('restart reconciles a durably saved assistant reply marker without redispatch and clears stale generation state', async () => {
    const { app, work } = await fixture();
    const dataDir = app.store.dataDir;
    const requestKey = createRequestKey();
    app.engine.commands.begin({ requestKey, operation: 'ppt.assistant.ask', body: { test: 'crash after durable reply, before receipt settlement' }, target: { ref: work.id } });
    app.store.settings.putJson(`ppt.assistant.${work.id}`, { messages: [{ id: 'persisted-message', role: 'assistant', text: '已持久保留的讨论答复', createdAt: new Date().toISOString() }], proposals: [] });
    app.store.settings.putJson(`ppt.assistant.result.${requestKey}`, { workId: work.id, changed: false });
    app.store.settings.putJson(`ppt.generation.${work.id}`, { workId: work.id, requestKey, startedAt: new Date().toISOString(), status: 'running', sessionId: 'crashed-session' });
    await app.close();
    const restarted = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
    try {
        restarted.engine.ports.opencode.runSession = async () => { throw Error('recovery must not dispatch a model'); };
        assert.equal(restarted.engine.commands.get(requestKey)?.status, 'unknown');
        const checked = await restarted.app.inject({ method: 'GET', url: `/api/operations/${requestKey}` });
        assert.equal(checked.json().data.operation.status, 'succeeded');
        assert.equal(checked.json().data.operation.outcome.recoveredPersistedReply, true);
        const current = restarted.engine.ppt.list().works.find(item => item.id === work.id)!;
        assert.equal(current.generation, undefined);
        assert.equal(current.mutationBlock, undefined);
        assert.deepEqual(current.slides, work.slides);
        assert.equal(restarted.engine.ppt.assistant.view(work.id).messages[0]?.text, '已持久保留的讨论答复');
    }
    finally {
        await restarted.close();
    }
});
