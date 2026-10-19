import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequestKey } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/index.ts';

/**
 * W2-11: a PPT work left `generating` by a previous process must not stay
 * "生成中" forever. Startup recovery marks it failed, records the interruption in
 * the audit entry and settles accepted generation receipts to unknown.
 */

test('startup recovery fails PPT works left generating and settles their receipts', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-ppt-recovery-data-'));
  const first = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  let outlineWorkId = '';
  let slidesWorkId = '';
  let outlineKey = '';
  let slidesKey = '';
  try {
    const created = await first.app.inject({
      method: 'POST',
      url: '/api/ppt/works',
      payload: { requestKey: createRequestKey(), title: '季度汇报', topic: '交付与风险', confirmCreate: true },
    });
    assert.equal(created.statusCode, 200, created.body);
    const works = created.json().data.resource as { id: string }[];
    assert.equal(works.length, 1);
    outlineWorkId = works[0]!.id;

    const slidesCreated = await first.app.inject({
      method: 'POST',
      url: '/api/ppt/works',
      payload: { requestKey: createRequestKey(), title: '年度汇报', topic: '全年复盘', confirmCreate: true },
    });
    slidesWorkId = (slidesCreated.json().data.resource as { id: string }[]).find((work) => work.id !== outlineWorkId)!.id;

    const outlineWork = first.store.pptWorks.get(outlineWorkId)!;
    first.store.pptWorks.update({ ...outlineWork, status: 'generating', outline: ['开场', '交付', '风险'] });
    const slidesWork = first.store.pptWorks.get(slidesWorkId)!;
    first.store.pptWorks.update({ ...slidesWork, status: 'generating', outline: ['开场', '复盘'], slides: [{ title: '开场', bullets: ['旧内容'] }] });

    outlineKey = createRequestKey();
    first.store.operations.accept({
      requestKey: outlineKey,
      operation: 'ppt.work.generate',
      bodyHash: 'ppt-outline-interrupted',
      contractVersion: '1',
      target: { ref: outlineWorkId },
    });
    slidesKey = createRequestKey();
    first.store.operations.accept({
      requestKey: slidesKey,
      operation: 'ppt.work.slides',
      bodyHash: 'ppt-slides-interrupted',
      contractVersion: '1',
      target: { ref: slidesWorkId },
    });
  } finally {
    await first.close();
  }

  const second = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const outlineWork = second.store.pptWorks.get(outlineWorkId);
    assert.equal(outlineWork?.status, 'failed', 'generating never survives a restart');
    assert.deepEqual(outlineWork?.outline, ['开场', '交付', '风险'], 'already generated outline is preserved for retry');
    const slidesWork = second.store.pptWorks.get(slidesWorkId);
    assert.equal(slidesWork?.status, 'failed');

    const audit = second.store.settings.getJson<{ kind?: string; message?: string; previousStatus?: string }>(`ppt.recovery.${outlineWorkId}`);
    assert.equal(audit?.kind, 'startup_recovery');
    assert.equal(audit?.previousStatus, 'generating');
    assert.match(audit?.message ?? '', /进程重启/);

    const outlineReceipt = second.store.operations.get(outlineKey);
    assert.equal(outlineReceipt?.status, 'unknown');
    assert.match(outlineReceipt?.error?.message ?? '', /进程重启/);
    const slidesReceipt = second.store.operations.get(slidesKey);
    assert.equal(slidesReceipt?.status, 'unknown');

    // The API projection and the retry entry point agree with the recovered state.
    const listed = await second.app.inject({ method: 'GET', url: '/api/ppt/works' });
    const statuses = (listed.json().data.works as { id: string; status: string }[]).map((work) => `${work.id}:${work.status}`);
    assert.ok(statuses.includes(`${outlineWorkId}:failed`), statuses.join(','));
    const regenerate = await second.app.inject({
      method: 'POST',
      url: `/api/ppt/works/${outlineWorkId}/generate`,
      payload: { requestKey: createRequestKey(), confirmGenerate: true },
    });
    assert.equal(regenerate.statusCode, 503, regenerate.body);
    assert.equal(regenerate.json().error.code, 'OPENCODE_NOT_READY');

    // Idempotent: a second recovery pass finds no generating work.
    const again = second.engine.recoverOnStartup();
    assert.equal(again.pptWorks, 0);
    assert.equal(second.store.pptWorks.get(outlineWorkId)?.status, 'failed');
  } finally {
    await second.close();
  }

  // A third start is a no-op and must not throw.
  const third = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    assert.equal(third.store.pptWorks.get(outlineWorkId)?.status, 'failed');
    assert.equal(third.store.operations.get(outlineKey)?.status, 'unknown');
  } finally {
    await third.close();
  }
});

test('PPT recovery is a quiet no-op when no generation was in flight', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-ppt-recovery-clean-')), disableOpenCode: true, disableListen: true });
  try {
    const created = await app.app.inject({
      method: 'POST',
      url: '/api/ppt/works',
      payload: { requestKey: createRequestKey(), title: '草稿', topic: '未生成', confirmCreate: true },
    });
    assert.equal(created.statusCode, 200, created.body);
    const summary = app.engine.recoverOnStartup();
    assert.equal(summary.pptWorks, 0);
    assert.equal((created.json().data.resource as { status: string }[])[0]!.status, 'draft');
  } finally {
    await app.close();
  }
});
