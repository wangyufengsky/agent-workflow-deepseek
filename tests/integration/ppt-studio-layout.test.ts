import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequestKey } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/index.ts';
import { registerHooks } from 'node:module';
// Node's component rendering fixture ignores stylesheet loading; CUA separately checks actual CSS.
registerHooks({ load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: 'export {};', shortCircuit: true } : next(url, context); } });
const { PptStudio, studioPageCommand, studioPageWork } = await import('../../apps/web/src/pages/ppt/PptStudio.tsx');
test('formal studio shows one current page, actual page rail and three side tabs from real persisted content', async () => {
    const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-ppt-layout-')), disableOpenCode: true, disableListen: true });
    try {
        const id = app.engine.ppt.create({ requestKey: createRequestKey(), title: '真实封面', topic: '真实主题', confirmCreate: true }).resource![0]!.id;
        const work = app.engine.ppt.update(id, { requestKey: createRequestKey(), confirmUpdate: true, outline: ['第一页', '第二页'], slides: [{ title: '第一页', bullets: ['正文'], notes: '人工备注', titleStyle: { fontSize: 36, color: 'accent', align: 'left' }, tag: '人工标签' }, { title: '第二页', bullets: ['保留'] }] }).resource!;
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        client.setQueryData(['ppt', id, 'check', work.revision], app.engine.ppt.check(id));
        client.setQueryData(['ppt', 'assistant', id], { messages: [], proposals: [] });
        const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(PptStudio, { work, blocked: false, onCommand: () => { throw Error('render must never write'); } })));
        assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
        assert.match(html, /aria-label="页面"/);
        assert.match(html, /aria-label="当前页面"/);
        assert.match(html, /第 1 页 真实封面/);
        assert.match(html, /第 3 页 第二页/);
        assert.match(html, /role="tab"[^>]*aria-selected="true"[^>]*>PPT 助手/);
        assert.match(html, />对象属性<\/button>/);
        assert.match(html, />检查<\/button>/);
        assert.match(html, /aria-label="演讲备注"/);
        const draft = { revision: work.revision!, page: { ...work.slides[0]!, title: '人工修改标题', notes: '修改后备注' } };
        const preview = studioPageWork(work, 1, draft.page);
        assert.equal(preview.title, work.title);
        assert.deepEqual(preview.slides[1], work.slides[1]);
        assert.equal(preview.slides[0]?.tag, '人工标签');
        const command = studioPageCommand(work, 1, draft);
        assert.equal(command.kind, 'update');
        if (command.kind !== 'update')
            throw Error('wrong command');
        const saved = app.engine.ppt.update(id, command.body).resource!;
        assert.equal(saved.outline[0], '人工修改标题');
        assert.deepEqual(saved.slides[0]?.titleStyle, work.slides[0]?.titleStyle);
        assert.deepEqual(saved.slides[1], work.slides[1]);
        assert.equal(saved.slides[0]?.notes, '修改后备注');
        const stale = studioPageCommand(saved, 1, { ...draft, page: { ...draft.page, title: '过期输入必须保留' } });
        assert.equal(stale.kind, 'update');
        if (stale.kind !== 'update')
            throw Error('wrong command');
        const conflict = await app.app.inject({ method: 'PATCH', url: `/api/ppt/works/${id}`, payload: stale.body });
        assert.equal(conflict.statusCode, 409);
        assert.equal(app.store.pptWorks.get(id)?.slides[0]?.title, '人工修改标题');
        assert.equal(stale.body.pageEdit?.page.title, '过期输入必须保留');
        const cover = studioPageCommand(saved, 0, { revision: saved.revision!, page: { title: '封面修改', bullets: ['新副标题'], notes: '封面讲稿' } });
        if (cover.kind !== 'update')
            throw Error('wrong command');
        const changed = app.engine.ppt.update(id, cover.body).resource!;
        assert.equal(changed.title, '封面修改');
        assert.equal(changed.topic, '新副标题');
        assert.deepEqual(changed.slides, saved.slides);
        const outlineResponse=app.engine.ppt.create({requestKey:createRequestKey(),title:'仅大纲演示',topic:'保留尚未生成的页面',confirmCreate:true});
        const outlineId=String(outlineResponse.receipt.outcome?.workId);
        const outlineWork=app.engine.ppt.update(outlineId,{requestKey:createRequestKey(),confirmUpdate:true,outline:['待制作一','待制作二']}).resource!;
        const outlineCommand=studioPageCommand(outlineWork,1,{revision:outlineWork.revision!,page:{title:'已编辑的第一页',bullets:['手动正文']}});
        if(outlineCommand.kind!=='update')throw Error('wrong command');
        const materialized=app.engine.ppt.update(outlineId,outlineCommand.body).resource!;
        assert.equal(materialized.slides.length,2);assert.equal(materialized.slides[0]?.title,'已编辑的第一页');assert.equal(materialized.slides[1]?.title,'待制作二');
        client.clear();
    }
    finally {
        await app.close();
    }
});
