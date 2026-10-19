import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createApplication } from '../../packages/server/src/index.ts';
import type { PptWork, PptCheckReport } from '@agent-workflow/shared';
const key = (name: string) => `req_pptprod_${name}_${Math.random().toString(36).slice(2, 12)}`;
test('PPT brief/directions/slides persist; checks and thumbnail reflect actual revision; copies/archive/versions use receipts', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'aw-pptprod-'));
    const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
    try {
        const created = await app.app.inject({ method: 'POST', url: '/api/ppt/works', payload: { requestKey: key('create'), title: '真实标题 <script>', topic: '演讲目标', confirmCreate: true } });
        const first = created.json().data.resource[0] as PptWork;
        const brief = { audience: '产品团队', objective: '确认下一阶段', length: '6页 / 10分钟', style: '克制', sources: '架构说明与季度资料' };
        const edited = await app.app.inject({ method: 'PATCH', url: `/api/ppt/works/${first.id}`, payload: { requestKey: key('edit'), expectedRevision: first.revision, confirmUpdate: true, brief, direction: 'editorial', outline: ['方案', '风险'], slides: [{ title: '方案', bullets: ['实际方案内容'], notes: '先解释目标' }, { title: '风险', bullets: Array(8).fill('这是一段用于检查页面文字越界的长文本。'.repeat(30)) }] } });
        // Individual bullets enforce a useful bound rather than silently truncating user input.
        assert.equal(edited.statusCode, 400);
        const saved = await app.app.inject({ method: 'PATCH', url: `/api/ppt/works/${first.id}`, payload: { requestKey: key('save'), expectedRevision: first.revision, confirmUpdate: true, brief, direction: 'editorial', outline: ['方案', '风险'], slides: [{ title: '方案', bullets: ['实际方案内容'], notes: '先解释目标' }, { title: '风险', bullets: Array(8).fill('这是一段用于检查页面文字越界的长文本。'.repeat(7)) }] } });
        assert.equal(saved.statusCode, 200, saved.body);
        const work = saved.json().data.resource as PptWork;
        assert.deepEqual(work.brief, brief);
        assert.equal(work.direction, 'editorial');
        assert.equal(work.revision, 2);
        const stale = await app.app.inject({ method: 'PATCH', url: `/api/ppt/works/${work.id}`, payload: { requestKey: key('stale'), expectedRevision: 1, title: '不应覆盖', confirmUpdate: true } });
        assert.equal(stale.statusCode, 409);
        assert.equal(app.store.pptWorks.get(work.id)?.title, first.title);
        const thumb = await app.app.inject({ method: 'GET', url: `/api/ppt/works/${work.id}/thumbnail?page=1` });
        assert.equal(thumb.statusCode, 200);
        assert.match(thumb.body, /实际方案内容/);
        assert.match(thumb.body, /#FFF8F0/);
        const cover = await app.app.inject({ method: 'GET', url: `/api/ppt/works/${work.id}/thumbnail` });
        assert.match(cover.body, /&lt;script&gt;/);
        assert.doesNotMatch(cover.body, /<script>/);
        assert.equal((await app.app.inject({ method: 'GET', url: `/api/ppt/works/${work.id}/thumbnail?page=99` })).statusCode, 404);
        const check = await app.app.inject({ method: 'GET', url: `/api/ppt/works/${work.id}/check` });
        const report = check.json().data as PptCheckReport;
        assert.equal(report.revision, 2);
        assert.equal(report.pages[1]?.issues.length, 0);
        assert.ok(report.pages[2]?.issues.some((issue) => issue.code === 'TEXT_OVERFLOW'));
        assert.ok(report.pages[2]?.issues.some((issue) => issue.code === 'MISSING_NOTES'));
        const pptx = await app.app.inject({ method: 'GET', url: `/api/ppt/works/${work.id}/pptx` });
        assert.equal(pptx.statusCode, 200, pptx.body);
        const artifact = join(dataDir, 'verified.pptx');
        writeFileSync(artifact, pptx.rawPayload);
        const nativePage = execFileSync('unzip', ['-p', artifact, 'ppt/slides/slide2.xml'], { encoding: 'utf8' });
        assert.match(nativePage, /实际方案内容/);
        assert.match(nativePage, /FFF8F0/);
        const notes = execFileSync('unzip', ['-p', artifact, 'ppt/notesSlides/notesSlide2.xml'], { encoding: 'utf8' });
        assert.match(notes, /先解释目标/);
        const copyKey = key('copy');
        const copied = await app.app.inject({ method: 'POST', url: `/api/ppt/works/${work.id}/copy`, payload: { requestKey: copyKey, expectedRevision: 2, confirm: true } });
        assert.equal(copied.statusCode, 200, copied.body);
        const copy = copied.json().data.resource as PptWork;
        assert.notEqual(copy.id, work.id);
        assert.deepEqual(copy.slides, work.slides);
        assert.deepEqual(copy.brief, brief);
        assert.equal((await app.app.inject({ method: 'GET', url: `/api/operations/${copyKey}` })).json().data.operation.status, 'succeeded');
        const archived = await app.app.inject({ method: 'POST', url: `/api/ppt/works/${work.id}/archive`, payload: { requestKey: key('archive'), expectedRevision: 2, archived: true, confirm: true } });
        assert.equal(archived.json().data.resource.archived, true);
        assert.equal((await app.app.inject({ method: 'PATCH', url: `/api/ppt/works/${work.id}`, payload: { requestKey: key('blocked'), title: '不应写入归档作品', confirmUpdate: true } })).statusCode, 400);
        const unarchived = await app.app.inject({ method: 'POST', url: `/api/ppt/works/${work.id}/archive`, payload: { requestKey: key('unarchive'), expectedRevision: 3, archived: false, confirm: true } });
        const current = unarchived.json().data.resource as PptWork;
        const restored = await app.app.inject({ method: 'POST', url: `/api/ppt/works/${work.id}/restore`, payload: { requestKey: key('restore'), expectedRevision: current.revision, revision: 1, confirm: true } });
        assert.equal(restored.statusCode, 200, restored.body);
        assert.equal(restored.json().data.resource.revision, 5);
        assert.equal(restored.json().data.resource.slides.length, 0);
        assert.ok(app.store.pptWorks.get(work.id)?.versions?.some((version) => version.revision === 2));
    }
    finally {
        await app.close();
    }
    const reopened = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
    try {
        const works = reopened.store.pptWorks.list();
        assert.equal(works.length, 2);
        assert.ok(works.some((work) => work.brief?.audience === '产品团队'));
    }
    finally {
        await reopened.close();
    }
});

// Controlled port evidence only: this does not claim a provider/model live pass.
test('saved brief/direction reach the read-only model and timeout retains original operation lock', async () => {
  const { Engine } = await import('../../packages/engine/src/index.ts');
  const { Store } = await import('@agent-workflow/storage');
  type Port = import('../../packages/engine/src/ports.ts').OpenCodePort;
  type Input = import('../../packages/engine/src/ports.ts').OpenCodeRunRequest;
  const store = new Store({ dataDir: mkdtempSync(join(tmpdir(), 'aw-ppt-port-')) });
  const inputs: Input[] = []; let timedOut = false;
  const port: Port = {
    status: () => ({ state: 'ready' }) as ReturnType<Port['status']>, ensureReady: async () => {}, abortSession: async () => {}, findSessions: async () => [],
    runSession: async (input) => { inputs.push(input); return { sessionId: 'controlled-ppt', outcome: { idle: !timedOut, timedOut, assistantText: JSON.stringify({ outline: ['目标', '方案'] }), messages: [] } }; },
  };
  const engine = new Engine({ store, ports: { opencode: port, git: {} as import('../../packages/engine/src/ports.ts').GitPort }, integration: { opencodeReady: () => true, gitlabConfigured: () => false } });
  try {
    const created = engine.ppt.create({ requestKey: key('controlled'), title: '团队演示', topic: '目标', confirmCreate: true });
    const work = created.resource![0]!;
    engine.ppt.update(work.id, { requestKey: key('brief'), confirmUpdate: true, brief: { audience: '工程团队', objective: '确认架构', length: '2页', style: '对比', sources: '已授权资料' }, direction: 'contrast' });
    await engine.ppt.generate(work.id, { requestKey: key('outline'), confirmGenerate: true });
    assert.equal(inputs[0]?.permission, 'read_only'); assert.match(inputs[0]?.prompt ?? '', /工程团队/); assert.match(inputs[0]?.prompt ?? '', /contrast/);
    timedOut = true; const uncertainKey = key('timeout');
    await assert.rejects(engine.ppt.generate(work.id, { requestKey: uncertainKey, confirmGenerate: true }));
    assert.equal(engine.commands.get(uncertainKey)?.status, 'unknown');
    assert.equal(engine.ppt.list().works.find((item) => item.id === work.id)?.mutationBlock?.requestKey, uncertainKey);
    await assert.rejects(engine.ppt.generate(work.id, { requestKey: key('blockedagain'), confirmGenerate: true }));
    assert.equal(inputs.length, 2);
    assert.deepEqual(store.pptWorks.get(work.id)?.outline, ['目标', '方案']);
  } finally { store.close(); }
});
