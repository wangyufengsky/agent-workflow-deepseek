import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeCodeReviewSnapshot, snapshotExpectedUnitIds, validateSnapshotUnitEvidence } from './snapshot-review.ts';
import { methodToGraph } from './graph.ts';
import { DEFAULT_CATALOG } from '@agent-workflow/shared';
const snapshot = freezeCodeReviewSnapshot({ targetSha: 'a'.repeat(40), files: [{ path: 'src/a.ts', blobSha: 'b'.repeat(40), sizeBytes: 10, mode: '100644' }, { path: 'src/b.ts', blobSha: 'c'.repeat(40), sizeBytes: 10, mode: '100644' }] }, { mode: 'full', depth: 'lightweight' });
const first = snapshot.units[0]!; const second = snapshot.units[1]!;
const finding = { id: 'candidate-one', title: '[test fixture] candidate', detail: 'Fixture evidence for schema validation', line: 1, severity: 'medium' as const };
const analysis = { unitId: first.id, blobSha: first.blobSha, summary: 'Fixture only', findings: [finding] };
const clean = { unitId: second.id, blobSha: second.blobSha, summary: 'Fixture only', findings: [] };
const base = methodToGraph(DEFAULT_CATALOG.methods[0]!).nodes[0]!;
test('lightweight independent verification assigns only actual candidate units and preserves all candidate identities', () => {
  const node = { ...base, snapshotStage: 'verification' as const, snapshotUnitIds: [first.id, second.id] };
  const evidence = { analyzed: new Map([[first.id, analysis], [second.id, clean]]), verified: new Map() };
  assert.deepEqual(snapshotExpectedUnitIds(snapshot, node, evidence), [first.id]);
  const reviewed = { ...analysis, findings: [{ ...finding, verdict: 'confirmed' as const, rationale: 'Fixture independent check evidence' }] };
  assert.doesNotThrow(() => validateSnapshotUnitEvidence(snapshot, node, { snapshotUnits: [reviewed] }, [first.id], evidence.analyzed));
  assert.throws(() => validateSnapshotUnitEvidence(snapshot, node, { snapshotUnits: [{ ...reviewed, findings: [] }] }, [first.id], evidence.analyzed));
  assert.throws(() => validateSnapshotUnitEvidence(snapshot, node, { snapshotUnits: [{ ...reviewed, findings: [{ ...reviewed.findings[0], id: 'another-problem' }] }] }, [first.id], evidence.analyzed));
});
test('exclusions and incremental unchanged files retain exact reasons and never become analyzed unit claims', () => {
  const frozen = freezeCodeReviewSnapshot({ targetSha: 'a'.repeat(40), baselineSha: 'd'.repeat(40), changedPaths: ['src/a.ts'], files: [{ path: 'src/a.ts', blobSha: 'b'.repeat(40), sizeBytes: 10, mode: '100644' }, { path: 'src/unchanged.ts', blobSha: 'c'.repeat(40), sizeBytes: 10, mode: '100644' }] }, { mode: 'incremental', depth: 'full' });
  assert.equal(frozen.units[1]?.excludedReason, '基线至目标未发生变更');
  assert.throws(() => freezeCodeReviewSnapshot({ targetSha: 'a'.repeat(40), files: [] }, { mode: 'incremental' }));
});
