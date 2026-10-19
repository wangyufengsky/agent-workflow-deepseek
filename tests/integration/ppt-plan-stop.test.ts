import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '@agent-workflow/storage';
import { Engine, type EnginePorts, type OpenCodePort, type OpenCodeRunRequest, type OpenCodeRunResult } from '../../packages/engine/src/index.ts';
import { defaultPptPlan } from '../../apps/web/src/pages/ppt/ppt-plan-defaults.ts';
import { renderPptPage, checkPpt, type PptWork } from '@agent-workflow/shared';
class ControlledPort implements OpenCodePort {
    inputs: OpenCodeRunRequest[] = [];
    prompts = 0;
    abortFails = false;
    inspection: 'idle' | 'running' | 'unknown' = 'running';
    creationDelay = false;
    releaseCreation?: () => void;
    finish?: (value: OpenCodeRunResult) => void;
    status(): ReturnType<OpenCodePort['status']> { return { state: 'ready' } as ReturnType<OpenCodePort['status']>; }
    async ensureReady() { }
    async findSessions() { return []; }
    async inspectSession() { return this.inspection; }
    async abortSession() { if (this.abortFails)
        throw new Error('abort transport lost'); }
    async runSession(input: OpenCodeRunRequest): Promise<OpenCodeRunResult> { this.inputs.push(input); if (this.creationDelay)
        await new Promise<void>(resolve => { this.releaseCreation = resolve; }); input.onSessionId?.('original-session'); this.prompts++; return new Promise(resolve => { this.finish = resolve; }); }
    complete(timedOut = false) { this.finish?.({ sessionId: 'original-session', outcome: { idle: true, timedOut, assistantText: JSON.stringify({ outline: ['迟到生成结果'] }), messages: [] } }); }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const key = (name: string) => `req_ppt_stop_${name}_${Math.random().toString(36).slice(2, 12)}`;
function fixture() { const store = new Store({ dataDir: mkdtempSync(join(tmpdir(), 'aw-pptstop-')) }); const port = new ControlledPort(); const engine = new Engine({ store, ports: { git: {} as EnginePorts['git'], opencode: port }, integration: { opencodeReady: () => true, gitlabConfigured: () => false } }); const work = engine.ppt.create({ requestKey: key('create'), title: '演示', topic: '目标', confirmCreate: true }).resource![0]!; engine.ppt.update(work.id, { requestKey: key('seed'), confirmUpdate: true, outline: ['原大纲'], brief: { audience: '团队', objective: '理解方案', length: '2页', style: '克制', sources: '项目资料' } }); return { store, port, engine, work }; }
test('PPT abort acknowledgement stays accepted until the original run is positively idle', async () => { const { store, port, engine, work } = fixture(); try {
    const generationKey = key('generate');
    const pending = engine.ppt.generate(work.id, { requestKey: generationKey, confirmGenerate: true });
    await tick();
    const stopKey = key('stop');
    const response = await engine.ppt.stop(work.id, { requestKey: stopKey, confirmStop: true });
    assert.equal(response.receipt.status, 'accepted');
    assert.equal(engine.commands.get(generationKey)?.status, 'accepted');
    assert.equal(store.pptWorks.get(work.id)?.status, 'generating');
    port.complete();
    const final = await pending;
    assert.equal(final.receipt.outcome?.stopped, true);
    assert.equal(engine.commands.get(stopKey)?.status, 'succeeded');
    assert.deepEqual(store.pptWorks.get(work.id)?.outline, ['原大纲']);
}
finally {
    store.close();
} });
test('PPT timeout plus failed abort never claims stopped; explicit original-session idle reconciliation can settle', async () => { const { store, port, engine, work } = fixture(); try {
    port.abortFails = true;
    const generationKey = key('uncertain');
    const pending = engine.ppt.generate(work.id, { requestKey: generationKey, confirmGenerate: true });
    await tick();
    const stopKey = key('failedstop');
    const stopped = await engine.ppt.stop(work.id, { requestKey: stopKey, confirmStop: true });
    assert.equal(stopped.receipt.status, 'unknown');
    port.complete(true);
    await assert.rejects(pending);
    assert.equal(engine.commands.get(generationKey)?.status, 'unknown');
    assert.equal(engine.commands.get(stopKey)?.status, 'unknown');
    assert.deepEqual(store.pptWorks.get(work.id)?.outline, ['原大纲']);
    port.inspection = 'idle';
    await engine.ppt.reconcileOperation(stopKey);
    assert.equal(engine.commands.get(stopKey)?.status, 'succeeded');
    assert.equal(engine.commands.get(generationKey)?.outcome?.stopped, true);
}
finally {
    store.close();
} });
test('stop before session creation returns prevents prompt dispatch rather than fire-and-forget abort', async () => { const { store, port, engine, work } = fixture(); try {
    port.creationDelay = true;
    const generationKey = key('before');
    const pending = engine.ppt.generate(work.id, { requestKey: generationKey, confirmGenerate: true });
    await tick();
    const stopped = await engine.ppt.stop(work.id, { requestKey: key('beforestop'), confirmStop: true });
    assert.equal(stopped.receipt.status, 'accepted');
    port.releaseCreation?.();
    const response = await pending;
    assert.equal(port.prompts, 0);
    assert.equal(response.receipt.outcome?.stopped, true);
}
finally {
    store.close();
} });
test('seven-module plan validates accent, freezes confirmed direction, and object edits change current-content rendering', async () => { const { store, engine, work } = fixture(); try {
    const current = store.pptWorks.get(work.id)!;
    const plan = defaultPptPlan(current);
    assert.throws(() => engine.ppt.update(work.id, { requestKey: key('badaccent'), confirmUpdate: true, plan: { ...plan, visual: { ...plan.visual, accent: '#abcd' } } }));
    const confirmed = engine.ppt.update(work.id, { requestKey: key('plan'), confirmUpdate: true, expectedRevision: current.revision, plan: { ...plan, confirmed: true, delivery: { ...plan.delivery, filename: '定制交付', includeNotes: false } }, direction: 'editorial', slides: [{ title: '标题对象', bullets: ['正文对象'], notes: '讲稿', tag: '标签', titleStyle: { fontSize: 40, color: 'accent', align: 'center' }, bodyStyle: { fontSize: 18, color: 'primary', align: 'right' }, tagStyle: { fontSize: 12, color: 'muted', align: 'left' }, layout: 'columns' }] }).resource!;
    assert.equal(confirmed.plan?.confirmed, true);
    assert.throws(() => engine.ppt.update(work.id, { requestKey: key('frozen'), confirmUpdate: true, direction: 'contrast' }));
    const svg = renderPptPage(confirmed, 1);
    assert.match(svg, /text-anchor="middle"/);
    assert.match(svg, /53.32/);
    assert.match(svg, /标签/);
    assert.ok(checkPpt(confirmed).unchecked.length > 0);
    const reopened = engine.ppt.update(work.id, { requestKey: key('reopen'), confirmUpdate: true, expectedRevision: confirmed.revision, plan: { ...confirmed.plan!, confirmed: false } }).resource!;
    assert.equal(reopened.plan?.confirmed, false);
    await assert.rejects(engine.ppt.generateSlides(work.id, { requestKey: key('unconfirmed'), confirmGenerate: true }));
}
finally {
    store.close();
} });
test('late old result cannot overwrite a new generation after positive idle stop proof', async () => {
    const { store, port, engine, work } = fixture();
    try {
        const firstKey = key('old');
        const first = engine.ppt.generate(work.id, { requestKey: firstKey, confirmGenerate: true });
        await tick();
        const oldFinish = port.finish!;
        port.inspection = 'idle';
        await engine.ppt.stop(work.id, { requestKey: key('idle-stop'), confirmStop: true });
        const secondKey = key('new');
        const second = engine.ppt.generate(work.id, { requestKey: secondKey, confirmGenerate: true });
        await tick();
        oldFinish({ sessionId: 'original-session', outcome: { idle: true, timedOut: false, assistantText: JSON.stringify({ outline: ['不应覆盖的新代外结果'] }), messages: [] } });
        await first;
        assert.equal(store.pptWorks.get(work.id)?.status, 'generating');
        assert.deepEqual(store.pptWorks.get(work.id)?.outline, ['原大纲']);
        port.complete();
        await second;
        assert.deepEqual(store.pptWorks.get(work.id)?.outline, ['迟到生成结果']);
    }
    finally {
        store.close();
    }
});
test('idle event from an old generation never settles a newer stop request', async () => {
    const { store, port, engine, work } = fixture();
    try {
        const old = engine.ppt.generate(work.id, { requestKey: key('idle-old'), confirmGenerate: true });
        await tick();
        const oldInput = port.inputs[0]!;
        const oldFinish = port.finish!;
        port.inspection = 'idle';
        await engine.ppt.stop(work.id, { requestKey: key('stop-old'), confirmStop: true });
        port.inspection = 'running';
        const newKey = key('idle-new');
        const next = engine.ppt.generate(work.id, { requestKey: newKey, confirmGenerate: true });
        await tick();
        const newStop = key('stop-new');
        await engine.ppt.stop(work.id, { requestKey: newStop, confirmStop: true });
        oldInput.sink.onIdle?.();
        assert.equal(engine.commands.get(newStop)?.status, 'accepted');
        assert.equal(store.pptWorks.get(work.id)?.status, 'generating');
        oldFinish({ sessionId: 'original-session', outcome: { idle: true, timedOut: false, assistantText: '{}', messages: [] } });
        await old;
        port.complete();
        await next;
        assert.equal(engine.commands.get(newStop)?.status, 'succeeded');
    }
    finally {
        store.close();
    }
});
