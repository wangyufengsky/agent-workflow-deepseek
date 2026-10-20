import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Attempt, NodeAcceptanceView, OutputFragment } from '@agent-workflow/shared';
import {
  buildFeedItems,
  buildGaps,
  buildServiceEvents,
  buildToolCards,
  deriveCombo,
  deriveFacts,
  gapText,
  type NodeFactsContext,
} from './node-facts.ts';
import { attemptVisual, resultVisual, toolVisual } from './node-labels.ts';

const fragment = (seq: number, text: string, overrides: Partial<OutputFragment> = {}): OutputFragment => ({
  fragmentId: `f${String(seq)}`,
  seq,
  category: 'model_text',
  text,
  ...overrides,
});

const attempt = (overrides: Partial<Attempt> = {}): Attempt => ({
  id: 'a1',
  executionId: 'e1',
  nodeId: 'n1',
  ordinal: 3,
  status: 'running',
  readability: { output: 'ok', tools: 'ok', result: 'ok' },
  ...overrides,
});

const acceptance = (state: NodeAcceptanceView['state']): NodeAcceptanceView => ({ nodeId: 'n1', state });

const context = (overrides: Partial<NodeFactsContext> = {}): NodeFactsContext => ({
  loading: false,
  historical: false,
  connection: 'connected',
  reconnectPhase: 'idle',
  attempt: attempt({ status: 'running' }),
  toolsReadable: true,
  outputReadable: true,
  resultReadable: true,
  hasModelText: true,
  hasAnyFragment: true,
  terminal: false,
  toolCards: [],
  ...overrides,
});

test('attempt state never claims completion before the human verdict', () => {
  assert.equal(attemptVisual({ status: 'succeeded' }, acceptance('pending')).label, '执行已结束');
  assert.equal(attemptVisual({ status: 'succeeded' }, acceptance('accepted')).label, '已完成');
  assert.equal(attemptVisual({ status: 'succeeded' }, acceptance('rejected')).label, '验收未通过');
  assert.equal(attemptVisual({ status: 'running' }, undefined, 'stopping').label, '取消中');
  assert.equal(attemptVisual({ status: 'unknown' }).label, '状态未核对');
  assert.equal(attemptVisual({ status: 'cancelled' }).label, '已取消');
});

test('result fact maps submission / verification / acceptance without inventing a pass', () => {
  assert.equal(resultVisual(attempt({ result: { resultRevision: 'r3', summary: 'ok', artifacts: [], errors: [], warnings: [] } })).label, '已提交待验收（结果修订 r3）');
  assert.equal(resultVisual(attempt({ result: { resultRevision: 'r3', summary: 'ok', artifacts: [], errors: [], warnings: [], verification: { state: 'failed' } } })).label, '未通过（结果修订 r3）');
  assert.equal(resultVisual(attempt({ result: { resultRevision: 'r3', summary: 'ok', artifacts: [], errors: [], warnings: [] } }), acceptance('accepted')).label, '验收通过（结果修订 r3）');
  assert.equal(resultVisual(attempt({ status: 'failed' })).label, '未提交（执行失败）');
});

test('a tool that was still running when the attempt ended is shown as result unknown', () => {
  assert.equal(toolVisual('running', false).label, '运行中');
  assert.equal(toolVisual('running', true).label, '结果未知');
  assert.equal(toolVisual('completed', true).label, '成功');
});

test('five facts follow the design branches and mark unknown instead of guessing', () => {
  const facts = deriveFacts(context({ attempt: attempt({ status: 'succeeded' }), acceptance: acceptance('pending'), terminal: true }));
  const byKey = new Map(facts.map((fact) => [fact.key, fact]));
  assert.equal(byKey.get('attempt')?.value, '执行已结束');
  assert.equal(byKey.get('result')?.value, '待人工验收');
  assert.equal(byKey.get('model')?.value, '传输结束');
  assert.equal(byKey.get('tools')?.value, '无');

  const failed = deriveFacts(context({ attempt: attempt({ status: 'failed' }) }));
  assert.equal(new Map(failed.map((fact) => [fact.key, fact])).get('model')?.value, '传输中断');

  const stop = deriveFacts(context({ attempt: attempt({ status: 'cancelled' }), hasModelText: false }));
  assert.equal(new Map(stop.map((fact) => [fact.key, fact])).get('model')?.value, '尚无正文');

  const disconnected = deriveFacts(context({ connection: 'disconnected' }));
  const disconnectedByKey = new Map(disconnected.map((fact) => [fact.key, fact]));
  assert.equal(disconnectedByKey.get('connection')?.value, '已断开');
  // design: the stale tag marks record-derived facts, not the connection fact itself
  assert.equal(disconnectedByKey.get('connection')?.stale, false);
  assert.equal(disconnectedByKey.get('model')?.stale, true);

  const revoked = deriveFacts(context({ toolsReadable: false, outputReadable: false }));
  const revokedByKey = new Map(revoked.map((fact) => [fact.key, fact]));
  assert.equal(revokedByKey.get('model')?.value, '无权读取');
  assert.equal(revokedByKey.get('tools')?.value, '无权读取');
});

test('combo sentence states transfer-ended is not completion and never fakes a verdict', () => {
  const base = {
    ...context({}),
    attemptReadable: true,
    attemptOrdinal: 3,
    gaps: [],
    backfilledCount: 0,
    dedupedCount: 0,
  };
  assert.match(deriveCombo({ ...base, terminal: true, attempt: attempt({ status: 'succeeded' }) }), /结果尚未提交——这不代表这一步已完成/);
  assert.match(deriveCombo({ ...base, acceptance: acceptance('pending'), attempt: attempt({ status: 'succeeded' }) }), /需要你人工验收/);
  assert.match(deriveCombo({ ...base, connection: 'disconnected', lastReadAt: '2026-10-20T10:44:05.000Z' }), /数据连接已断开（截至/);
  assert.match(deriveCombo({ ...base, attemptReadable: false }), /你已无权查看/);
});

test('tool cards keep the first call position, flag late results and never show a guess', () => {
  const fragments: OutputFragment[] = [
    fragment(1, '正文一'),
    fragment(2, '', { category: 'tool_activity', text: 'bash · running', toolCallRef: { callId: 'c1', status: 'running', source: 'opencode' }, toolEvidence: { name: 'bash', input: 'npm test', startedAt: '2026-10-20T02:44:00.000Z', redacted: false, truncated: false } }),
    fragment(3, '正文二'),
    fragment(4, '', { category: 'tool_activity', text: 'bash · completed', recordedAt: '2026-10-20T02:44:31.000Z', toolCallRef: { callId: 'c1', status: 'completed', source: 'opencode' }, toolEvidence: { name: 'bash', output: 'ok', startedAt: '2026-10-20T02:44:00.000Z', endedAt: '2026-10-20T02:44:31.000Z', durationMs: 31_000, redacted: false, truncated: false } }),
  ];
  const cards = buildToolCards(fragments, attempt({ status: 'succeeded', endedAt: '2026-10-20T02:47:20.000Z' }));
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.seq, 2);
  assert.equal(cards[0]?.visual.label, '成功');
  assert.equal(cards[0]?.late?.at, '2026-10-20T02:44:31.000Z');
  assert.equal(cards[0]?.argsSummary, 'npm test');

  const hung = buildToolCards([fragment(1, '', { category: 'tool_activity', toolCallRef: { callId: 'c9', status: 'running', source: 'opencode' } })], attempt({ status: 'failed' }));
  assert.equal(hung[0]?.visual.label, '结果未知');
  assert.match(hung[0]?.note?.text ?? '', /服务没有记录它的结果/);
});

test('sequence gaps are surfaced as ranges', () => {
  const gaps = buildGaps([fragment(2, 'a'), fragment(3, 'b'), fragment(6, 'c')]);
  assert.deepEqual(gaps, [{ from: 1, to: 1 }, { from: 4, to: 5 }]);
  assert.equal(gapText(gaps), '#1、#4–#5');
});

test('feed inserts gap separators, hides forbidden tools explicitly and cuts failed text', () => {
  const all = [fragment(1, '第一段'), fragment(2, '', { category: 'tool_activity', toolCallRef: { callId: 'c1', status: 'completed', source: 'opencode' } }), fragment(5, '第二段')];
  const visible = [all[0]!, all[2]!];
  const items = buildFeedItems({
    allFragments: all,
    visibleFragments: visible,
    toolCards: [],
    attempt: attempt({ status: 'failed' }),
    historical: false,
    live: false,
    toolsReadable: false,
  });
  const kinds = items.map((item) => item.kind);
  assert.deepEqual(kinds, ['hidden', 'model', 'gap', 'model', 'cut']);
  assert.equal(items[0]?.kind, 'hidden');
  assert.equal(items[1]?.kind, 'model');
  assert.equal(items[2]?.kind === 'gap' ? items[2].from : undefined, 3);
  assert.equal(items[3]?.kind, 'model');

  const missing = buildFeedItems({
    allFragments: [fragment(1, 'a'), fragment(4, 'b')],
    visibleFragments: [fragment(1, 'a'), fragment(4, 'b')],
    toolCards: [],
    attempt: attempt({ status: 'succeeded' }),
    historical: false,
    live: false,
    toolsReadable: true,
  });
  const gap = missing.find((item) => item.kind === 'gap');
  assert.deepEqual(gap, { kind: 'gap', id: 'gap-2', from: 2, to: 3 });
});

test('snapshot service rows only claim facts the read model supports', () => {
  const rows = buildServiceEvents({
    attempt: attempt({ status: 'succeeded', startedAt: '2026-10-20T02:42:01.000Z', endedAt: '2026-10-20T02:47:20.000Z', result: { resultRevision: 'r3', summary: 'ok', artifacts: [], errors: [], warnings: [] } }),
    acceptance: acceptance('pending'),
    nodeStatus: 'succeeded',
    connection: 'connected',
    reconnectPhase: 'idle',
    backfilledCount: 0,
    dedupedCount: 0,
    gapCount: 0,
  });
  const text = rows.map((row) => row.text).join(' | ');
  assert.match(text, /尝试 #3 开始/);
  assert.match(text, /结果已提交 · 进入人工验收 · 结果修订 r3/);
  assert.doesNotMatch(text, /验收通过/);

  const stopping = buildServiceEvents({ attempt: attempt({ status: 'running' }), executionStatus: 'stopping', connection: 'connected', reconnectPhase: 'idle', backfilledCount: 0, dedupedCount: 0, gapCount: 0 });
  assert.match(stopping.map((row) => row.text).join(' | '), /等待执行器确认/);

  const unknown = buildServiceEvents({ attempt: attempt({ status: 'unknown' }), nodeStatus: 'unknown', connection: 'connected', reconnectPhase: 'idle', backfilledCount: 0, dedupedCount: 0, gapCount: 0 });
  assert.match(unknown.map((row) => row.text).join(' | '), /服务未返回执行器确认/);
});
