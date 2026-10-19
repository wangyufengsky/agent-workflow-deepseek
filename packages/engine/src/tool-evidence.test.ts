import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolEvidence } from './tool-evidence.ts';

test('tool evidence redacts nested credentials before persistence and keeps actual timing/output', () => {
  const evidence = toolEvidence({ type: 'tool', tool: 'workflow_db_query', state: { input: { sql: 'select 1', config: { password: 'do-not-store', Authorization: 'Bearer private' } }, output: 'result=1 token=never-store https://user:pass@example.test', time: { start: 1000, end: 1750 } } });
  assert.equal(evidence.durationMs, 750);
  assert.equal(evidence.redacted, true);
  assert.doesNotMatch(JSON.stringify(evidence), /do-not-store|never-store|user:pass|Bearer private/);
  assert.match(evidence.input!, /select 1/);
  assert.match(evidence.output!, /result=1/);
});

test('tool evidence distinguishes absent fields, empty result, truncation and missing timestamps', () => {
  const empty = toolEvidence({ type: 'tool', state: { output: '' } });
  assert.equal(empty.output, '');
  assert.equal(empty.input, undefined);
  assert.equal(empty.durationMs, undefined);
  const bounded = toolEvidence({ type: 'tool', state: { error: 'x'.repeat(300000), time: { start: NaN, end: Infinity } } });
  assert.equal(bounded.truncated, true);
  assert.equal(bounded.error!.length, 256 * 1024);
  assert.equal(bounded.startedAt, undefined);
  assert.equal(bounded.endedAt, undefined);
});
