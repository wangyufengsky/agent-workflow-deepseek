import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_SETTINGS,
  createRequestKey,
  nowIso,
  type AppSettings,
  type PptPageGeneration,
  type PptSlide,
} from '@agent-workflow/shared';
import { Store } from '@agent-workflow/storage';
import { CommandService } from './operations.ts';
import { PptService } from './ppt.ts';
import type { EngineContext } from './actions.ts';
import type { OpenCodePort } from './ports.ts';

/**
 * P07-23 回归：保存制作方案 / 加一页的整份 PATCH 曾把 productionPages 全部改写成
 * completed + 清空生成记录，从而伪造“全部完成”并放开导出。以下测试锁定修复后的
 * 逐页 diff 语义与导出门槛。
 */

const opencode = {
  status: () => ({ state: 'stopped' }),
  ensureReady: async () => undefined,
  runSession: async () => {
    throw new Error('本测试不调用模型');
  },
  abortSession: async () => undefined,
  findSessions: async () => [],
} as unknown as OpenCodePort;

interface Harness {
  readonly store: Store;
  readonly service: PptService;
}

function harness(): Harness {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-ppt-test-'));
  const store = new Store({ dataDir });
  const commands = new CommandService(store);
  const settings: AppSettings = DEFAULT_SETTINGS;
  const context: EngineContext = {
    store,
    settings: () => settings,
    projects: () => [],
    opencodeReady: () => false,
    gitlabConfigured: () => false,
    planningBudgetConfigured: () => false,
  };
  return { store, service: new PptService(store, commands, context, opencode) };
}

const TITLES = ['整体架构', '任务的一生', '错误恢复'] as const;
const SLIDES: readonly PptSlide[] = [
  { title: '整体架构', bullets: ['界面只呈现，不决定'] },
  { title: '任务的一生', bullets: ['确认之前不占用执行资源'] },
  { title: '错误恢复', bullets: ['先确认发生了什么'] },
];
const STOPPED: readonly PptPageGeneration[] = [
  { index: 0, title: '整体架构', status: 'completed', source: 'model', completedRevision: 2 },
  { index: 1, title: '任务的一生', status: 'stopped', message: '本次生成已停止，原有内容保留' },
  { index: 2, title: '错误恢复', status: 'stopped', message: '本次生成已停止，原有内容保留' },
];

/** A work stopped mid-generation: page 0 completed, pages 1–2 stopped. */
function stoppedWork(h: Harness): { readonly id: string; readonly revision: number } {
  const created = h.service.create({ requestKey: createRequestKey(), title: '项目入门', topic: '讲清架构、任务与错误恢复', confirmCreate: true });
  const id = created.resource![0]!.id;
  let work = h.store.pptWorks.get(id)!;
  work = h.store.pptWorks.update({
    ...work,
    status: 'ready',
    outline: [...TITLES],
    slides: [...SLIDES],
    productionPages: [...STOPPED],
  });
  const generationKey = createRequestKey();
  h.store.settings.putJson(`ppt.generation.${id}`, {
    workId: id,
    requestKey: generationKey,
    startedAt: nowIso(),
    status: 'stopped',
    pages: [...STOPPED],
  });
  return { id, revision: work.revision ?? 1 };
}

function productionStatuses(h: Harness, id: string): readonly string[] | undefined {
  return h.store.pptWorks.get(id)?.productionPages?.map((page) => page.status);
}

function exportAllowed(h: Harness, id: string): boolean {
  return h.service.list().works.find((work) => work.id === id)?.actions?.export?.allowed === true;
}

function generationRecord(h: Harness, id: string): { readonly status?: string; readonly requestKey?: string } | undefined {
  return h.store.settings.getJson<{ status: string; requestKey: string }>(`ppt.generation.${id}`);
}

test('P07-23 保存方案（plan-only PATCH）不清空未完成页状态、不清生成记录、导出仍被拦截', () => {
  const h = harness();
  const { id, revision } = stoppedWork(h);
  assert.equal(exportAllowed(h, id), false, '停止后的作品本来就不允许导出');
  const exportReasonBefore = h.service.list().works.find((work) => work.id === id)?.actions?.export?.reason;
  assert.match(exportReasonBefore ?? '', /2 页未完成制作/);

  h.service.update(id, { requestKey: createRequestKey(), confirmUpdate: true, expectedRevision: revision, title: '项目入门（修订标题）' });

  assert.deepEqual(productionStatuses(h, id), ['completed', 'stopped', 'stopped'], '保存方案不得把未完成页改写成 completed');
  const work = h.store.pptWorks.get(id)!;
  assert.equal(work.productionPages?.[1]?.message, '本次生成已停止，原有内容保留');
  assert.notEqual(work.revision, revision, '保存方案仍然产生新修订');
  assert.equal(generationRecord(h, id)?.status, 'stopped', '生成记录（本次制作 X/Y 与停止原因）必须保留');
  assert.equal(exportAllowed(h, id), false, '保存方案不得放开导出门槛');
  assert.match(h.service.list().works.find((item) => item.id === id)?.actions?.export?.reason ?? '', /2 页未完成制作/);
  assert.throws(() => h.service.exportMarkdown(id), /未完成制作/, '导出必须按服务端逐页事实拒绝');
});

test('P07-23 旧版前端整份 slides PATCH（内容未变）不会再伪造全部完成', () => {
  const h = harness();
  const { id, revision } = stoppedWork(h);
  /* 旧 PptPlanDrawer.save() 的请求形态：slides 整份提交，内容与服务一致。 */
  h.service.update(id, { requestKey: createRequestKey(), confirmUpdate: true, expectedRevision: revision, slides: [...SLIDES], outline: [...TITLES] });
  assert.deepEqual(productionStatuses(h, id), ['completed', 'stopped', 'stopped']);
  const pageOne = h.store.pptWorks.get(id)?.productionPages?.[1];
  assert.equal(pageOne?.status, 'stopped');
  assert.equal(pageOne?.source, undefined, '未修改的页面不应被标成 manual 完成');
  assert.equal(exportAllowed(h, id), false);
});

test('P07-23 加一页（appendPage）只追加 pending 页，已有逐页状态保留且导出仍被拦截', () => {
  const h = harness();
  const { id, revision } = stoppedWork(h);
  h.service.update(id, { requestKey: createRequestKey(), confirmUpdate: true, expectedRevision: revision, appendPage: { title: '上手建议', bullets: [] } });

  const work = h.store.pptWorks.get(id)!;
  assert.equal(work.slides.length, 4);
  assert.deepEqual(work.outline, ['整体架构', '任务的一生', '错误恢复', '上手建议']);
  assert.deepEqual(productionStatuses(h, id), ['completed', 'stopped', 'stopped', 'pending'], '新增页只能是 pending，不能是 completed');
  assert.equal(work.productionPages?.[3]?.source, undefined);
  assert.equal(generationRecord(h, id)?.status, 'stopped');
  assert.equal(exportAllowed(h, id), false, '加一页后仍有未完成页，导出必须继续被拦截');
});

test('P07-23 用户真正编辑某一页时只有该页记为人工完成，其余未完成页保留', () => {
  const h = harness();
  const { id, revision } = stoppedWork(h);
  const edited = [...SLIDES];
  edited[1] = { title: '任务的一生', bullets: ['人工补写的要点'] };
  h.service.update(id, { requestKey: createRequestKey(), confirmUpdate: true, expectedRevision: revision, slides: edited });

  const pages = h.store.pptWorks.get(id)!.productionPages;
  assert.deepEqual(pages?.map((page) => page.status), ['completed', 'completed', 'stopped']);
  assert.equal(pages?.[1]?.source, 'manual', '真正编辑的页面记为人工完成');
  assert.equal(pages?.[2]?.status, 'stopped', '未编辑的未完成页保持停止状态');
  assert.equal(exportAllowed(h, id), false, '仍有 1 页未完成，导出必须继续被拦截');
});

test('P07-23 删除后再加一页：空的新页面只能是 pending，不能借用旧页索引伪造完成', () => {
  const h = harness();
  const { id, revision } = stoppedWork(h);
  /* 删除“错误恢复”后再加一个空页面，新页会落在原第 3 页的索引上。 */
  h.service.update(id, { requestKey: createRequestKey(), confirmUpdate: true, expectedRevision: revision, slides: [SLIDES[0]!, SLIDES[1]!, { title: '新页面', bullets: [] }], outline: ['整体架构', '任务的一生', '新页面'] });
  const pages = h.store.pptWorks.get(id)!.productionPages;
  assert.deepEqual(pages?.map((page) => page.status), ['completed', 'stopped', 'pending']);
  assert.equal(pages?.[2]?.source, undefined, '空页面不是人工完成的页面');
  assert.equal(exportAllowed(h, id), false);
});
