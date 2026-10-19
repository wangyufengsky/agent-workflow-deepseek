import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../../packages/server/src/index.ts';

function requestKey(prefix: string): string {
  return `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;
}

test('PPT work drafts can be created, listed and deleted', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-ppt-')), disableOpenCode: true, disableListen: true });
  try {
    const empty = await app.app.inject({ method: 'GET', url: '/api/ppt/works' });
    assert.equal(empty.statusCode, 200, empty.body);
    assert.equal(empty.json().data.works.length, 0);
    const created = await app.app.inject({
      method: 'POST',
      url: '/api/ppt/works',
      payload: { requestKey: requestKey('ppt'), title: '季度汇报', topic: '本季度交付与风险', theme: 'warm', confirmCreate: true },
    });
    assert.equal(created.statusCode, 200, created.body);
    const works = created.json().data.resource as { id: string; status: string; title: string; theme: string }[];
    assert.equal(works.length, 1);
    assert.equal(works[0]!.status, 'draft');
    assert.equal(works[0]!.theme, 'warm');
    const badTheme = await app.app.inject({ method: 'POST', url: '/api/ppt/works', payload: { requestKey: requestKey('badtheme'), title: 'T', topic: 'x', theme: 'neon', confirmCreate: true } });
    assert.equal(badTheme.statusCode, 400, badTheme.body);
    const id = works[0]!.id;
    const updated = await app.app.inject({
      method: 'PATCH',
      url: `/api/ppt/works/${id}`,
      payload: { requestKey: requestKey('pptupd'), title: '季度汇报（改）', outline: ['开场', '交付', '风险'], confirmUpdate: true },
    });
    assert.equal(updated.statusCode, 200, updated.body);
    assert.equal(updated.json().data.resource.title, '季度汇报（改）');
    assert.deepEqual(updated.json().data.resource.outline, ['开场', '交付', '风险']);
    const badUpdate = await app.app.inject({ method: 'PATCH', url: `/api/ppt/works/${id}`, payload: { requestKey: requestKey('pptbad'), title: '', confirmUpdate: true } });
    assert.equal(badUpdate.statusCode, 400, badUpdate.body);

    const exported = await app.app.inject({ method: 'GET', url: `/api/ppt/works/${id}/export` });
    assert.equal(exported.statusCode, 200, exported.body);
    assert.match(exported.json().data.filename as string, /季度汇报（改）\.md/);
    assert.match(exported.json().data.content as string, /## 1\. 开场/);
    assert.equal((await app.app.inject({ method: 'GET', url: '/api/ppt/works/ppt_unknown/export' })).statusCode, 404);

    const attached = await app.app.inject({ method: 'POST', url: `/api/ppt/works/${id}/attachments`, payload: { requestKey: requestKey('att'), name: 'notes.md', content: '# 资料\n关键结论', confirmAttach: true } });
    assert.equal(attached.statusCode, 200, attached.body);
    assert.equal((attached.json().data.resource.attachments as unknown[]).length, 1);
    const duplicateAttachment = await app.app.inject({ method: 'POST', url: `/api/ppt/works/${id}/attachments`, payload: { requestKey: requestKey('att2'), name: 'notes.md', content: 'x', confirmAttach: true } });
    assert.equal(duplicateAttachment.statusCode, 409, duplicateAttachment.body);
    const detached = await app.app.inject({ method: 'DELETE', url: `/api/ppt/works/${id}/attachments/${encodeURIComponent('notes.md')}` });
    assert.equal(detached.statusCode, 200, detached.body);
    assert.equal((detached.json().data.resource.attachments as unknown[]).length, 0);

    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const imageAttached = await app.app.inject({ method: 'POST', url: `/api/ppt/works/${id}/attachments`, payload: { requestKey: requestKey('img'), name: 'dot.png', content: image, kind: 'image', confirmAttach: true } });
    assert.equal(imageAttached.statusCode, 200, imageAttached.body);
    assert.equal((imageAttached.json().data.resource.attachments as { kind: string }[])[0]!.kind, 'image');
    const badImage = await app.app.inject({ method: 'POST', url: `/api/ppt/works/${id}/attachments`, payload: { requestKey: requestKey('img2'), name: 'bad.png', content: 'not-a-data-url', kind: 'image', confirmAttach: true } });
    assert.equal(badImage.statusCode, 400, badImage.body);

    const pptx = await app.app.inject({ method: 'GET', url: `/api/ppt/works/${id}/pptx` });
    assert.equal(pptx.statusCode, 200, pptx.body);
    assert.match(String(pptx.headers['content-type']), /presentationml/);
    assert.ok(pptx.rawPayload.length > 1_000);
    assert.equal(pptx.rawPayload.subarray(0, 2).toString('utf8'), 'PK');
    assert.equal((await app.app.inject({ method: 'GET', url: '/api/ppt/works/ppt_unknown/pptx' })).statusCode, 404);

    const generate = await app.app.inject({ method: 'POST', url: `/api/ppt/works/${id}/generate`, payload: { requestKey: requestKey('gen'), confirmGenerate: true } });
    assert.equal(generate.statusCode, 503, generate.body);
    const generateSlides = await app.app.inject({ method: 'POST', url: `/api/ppt/works/${id}/generate-slides`, payload: { requestKey: requestKey('slides'), confirmGenerate: true } });
    assert.equal(generateSlides.statusCode, 503, generateSlides.body);
    assert.equal(generate.json().error.code, 'OPENCODE_NOT_READY');

    const deleted = await app.app.inject({ method: 'DELETE', url: `/api/ppt/works/${id}` });
    assert.equal(deleted.statusCode, 200, deleted.body);
    assert.equal(deleted.json().data.resource.length, 0);
    const missing = await app.app.inject({ method: 'DELETE', url: `/api/ppt/works/${id}` });
    assert.equal(missing.statusCode, 404, missing.body);
  } finally {
    await app.close();
  }
});
