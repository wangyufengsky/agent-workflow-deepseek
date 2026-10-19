import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DEFAULT_CATALOG, type CodeReviewSnapshot, type PlanGraph, type TaskTemplate } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/index.ts';
import { methodToGraph } from '../../packages/engine/src/graph.ts';
import { captureArtifacts } from '../../packages/engine/src/artifacts.ts';
import { snapshotEvidenceState, snapshotPlanGraph } from '../../packages/engine/src/snapshot-review.ts';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

test('template run reader projects document reports/requirements and reads frozen input by identity without current disk fallback', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-run-doc-')), disableOpenCode: true, disableListen: true });
  try {
    const root = mkdtempSync(join(tmpdir(), 'aw-run-frozen-')); writeFileSync(join(root, 'spec.md'), 'CURRENT_DISK_MUST_NOT_BE_USED');
    const project = app.store.projects.create({ name: '冻结报告项目', rootPath: root, gitState: 'not_git' });
    const method = DEFAULT_CATALOG.methods[0]!; const graph = methodToGraph(method);
    const contract: TaskTemplate = { ...DEFAULT_CATALOG.templates[0]!, id: 'template.document-test', name: '文档核对', inputs: { documents: true, source: false } };
    const text = '# 冻结资料\n原始正文';
    const task = app.store.tasks.create({ projectId: project.id, title: '文档运行', requirementText: '需求必须具有依据', methodId: method.id, methodRevision: method.revision, fixedTemplate: { templateId: contract.id, templateVersion: contract.version, locked: true, parameters: {}, contract, scope: { sourcePaths: [], documents: [{ name: 'spec.md', text, bytes: Buffer.byteLength(text), sha256: hash(text) }], frozenAt: '2026-10-20T00:00:00Z' } } });
    const plan = app.store.plans.create({ taskId: task.id, source: 'template', graph, status: 'confirmed' }); app.store.tasks.update(task.id, { currentPlanRevisionId: plan.id });
    app.store.settings.putJson(`plan.requirement.${plan.id}`, task.requirement);
    const response = await app.app.inject({ method: 'GET', url: `/api/tasks/${task.id}/run-content` }); assert.equal(response.statusCode, 200, response.body);
    const model = response.json().data.specialized; assert.equal(model.kind, 'document'); assert.equal(model.inputs.length, 1); assert.equal(model.inputs[0].content, undefined); assert.equal(model.requirements[0].conclusion, 'pending'); assert.equal(model.artifacts.length, 0);
    const input = await app.app.inject({ method: 'GET', url: `/api/tasks/${task.id}/run-content?inputId=document%3A0&version=${hash(text)}&sha256=${hash(text)}` }); assert.equal(input.statusCode, 200, input.body); assert.equal(input.json().data.content, text); assert.equal(input.json().data.contentSha256, hash(text)); assert.equal(input.json().data.version, model.inputs[0].version);
    assert.equal((await app.app.inject({ method: 'GET', url: `/api/tasks/${task.id}/run-content?inputId=document%3A0&version=wrong&sha256=${hash(text)}` })).json().error.code, 'STALE_TARGET');
    assert.equal((await app.app.inject({ method: 'GET', url: `/api/tasks/${task.id}/run-content?inputId=source%3A..%2Foutside` })).json().error.code, 'NOT_RETAINED');
  } finally { await app.close(); }
});

test('source/unit-test scopes do not turn successful generic nodes into file coverage or invented test counts', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-run-source-')), disableOpenCode: true, disableListen: true });
  try {
    const project = app.store.projects.create({ name: '源码项目', rootPath: tmpdir(), gitState: 'not_git' }); const method = DEFAULT_CATALOG.methods[0]!; const graph = methodToGraph(method);
    const contract = { ...DEFAULT_CATALOG.templates[0]!, id: 'template.unit-test-development', inputs: { source: true } };
    const task = app.store.tasks.create({ projectId: project.id, title: '单测运行', requirementText: '核对测试', methodId: method.id, methodRevision: method.revision, fixedTemplate: { templateId: contract.id, templateVersion: contract.version, locked: true, parameters: {}, contract, scope: { sourcePaths: ['src'], sourceFiles: [{ path: 'src/a.ts', text: 'old source', blobSha: 'a'.repeat(40) }], documents: [], frozenAt: '2026-10-20T00:00:00Z' } } });
    const plan = app.store.plans.create({ taskId: task.id, source: 'template', graph, status: 'confirmed' }); const execution = app.store.executions.create({ taskId: task.id, planRevisionId: plan.id, graph, autoAdvance: false }); app.store.tasks.update(task.id, { currentPlanRevisionId: plan.id, executionId: execution.id });
    for (const node of graph.nodes) app.store.executions.updateNode(execution.id, node.id, { status: 'succeeded' });
    const model = app.engine.extras.runContent(task.id).specialized!;
    assert.equal(model.kind, 'unit_test'); assert.equal(model.files[0]?.state, 'pending'); assert.ok(model.batches.every((batch) => batch.testResult === undefined)); assert.equal(model.files.length, 1);
    app.store.executions.update(execution.id, { status: 'failed' });
    app.store.executions.updateNode(execution.id, graph.nodes[0]!.id, { status: 'failed', attemptCount: 1 });
    app.store.settings.putJson(`execution.settings.${execution.id}`, { maxAttempts: 1 });
    const exhausted = app.engine.extras.runContent(task.id).specialized!.batches.find((batch) => batch.failedNodeIds.includes(graph.nodes[0]!.id))!;
    assert.equal(exhausted.retry.allowed, false); assert.match(exhausted.retry.reason!, /步骤尝试次数/);
    app.store.executions.updateNode(execution.id, graph.nodes[0]!.id, { attemptCount: 0 });
    assert.equal(app.engine.extras.runContent(task.id).specialized!.batches.find((batch) => batch.failedNodeIds.includes(graph.nodes[0]!.id))!.retry.allowed, true);
    app.store.executions.updateNode(execution.id, graph.nodes[0]!.id, { status: 'unknown' });
    assert.ok(app.engine.extras.runContent(task.id).specialized!.batches.every((batch) => !batch.retry.allowed));
  } finally { await app.close(); }
});

test('snapshot source coverage counts submitted current unit evidence, not node successes, and legacy templates retain missing states', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-run-units-')), disableOpenCode: true, disableListen: true });
  try {
    const project = app.store.projects.create({ name: '单元证据', rootPath: tmpdir(), gitState: 'not_git' }); const method = DEFAULT_CATALOG.methods[0]!; const template = DEFAULT_CATALOG.templates.find((item) => item.kind === 'snapshot_review')!;
    const snapshot: CodeReviewSnapshot = { targetSha: 'a'.repeat(40), mode: 'full', depth: 'lightweight', frozenAt: '2026-10-20T00:00:00Z', batchSize: 1, units: [{ id: 'u1', path: 'a.ts', blobSha: 'b'.repeat(40), sizeBytes: 1 }, { id: 'u2', path: 'b.ts', blobSha: 'c'.repeat(40), sizeBytes: 1 }, { id: 'u3', path: 'generated.bin', blobSha: 'd'.repeat(40), sizeBytes: 1, excludedReason: '显式排除' }] };
    const graph: PlanGraph = snapshotPlanGraph(methodToGraph(method), snapshot, template);
    const task = app.store.tasks.create({ projectId: project.id, title: '快照运行', requirementText: '审阅快照', methodId: method.id, methodRevision: method.revision, fixedTemplate: { templateId: template.id, templateVersion: template.version, locked: true, parameters: {}, snapshot } });
    const plan = app.store.plans.create({ taskId: task.id, source: 'template', graph, status: 'confirmed' }); const execution = app.store.executions.create({ taskId: task.id, planRevisionId: plan.id, graph, autoAdvance: false }); app.store.tasks.update(task.id, { currentPlanRevisionId: plan.id, executionId: execution.id });
    const analyze = graph.nodes.find((node) => node.snapshotStage === 'analysis')!;
    const attempt = app.store.executions.createAttempt({ executionId: execution.id, nodeId: analyze.id, ordinal: 1 });
    writeFileSync(join(app.store.dataDir, 'report.md'), 'PRIVATE_ARTIFACT');
    const artifacts = captureArtifacts(app.store.dataDir, app.store.dataDir, attempt.id, [{ path: 'report.md' }], () => true);
    app.store.executions.appendOutput({ attemptId: attempt.id, seq: 1, fragment: { fragmentId: 'fragment', seq: 1, category: 'model_text', text: 'PRIVATE_OUTPUT' } });
    app.store.executions.finishAttempt(attempt.id, 'succeeded', { resultRevision: 'r1', summary: '离线单元证据fixture', artifacts, verification: { state: 'passed', summary: 'PRIVATE_TEST_SUMMARY' }, errors: [], warnings: [], payload: { snapshotUnits: [{ unitId: 'u1', blobSha: 'b'.repeat(40), summary: '已分析', findings: [] }] } }); app.store.executions.updateNode(execution.id, analyze.id, { status: 'succeeded', currentAttemptId: attempt.id });
    const model = app.engine.extras.runContent(task.id).specialized!;
    assert.deepEqual(model.files.map((file) => file.state), ['covered', 'pending', 'excluded']); assert.ok(model.limitations.some((reason) => reason.includes('没有保留输入范围'))); assert.equal(model.batches[0]?.verified, false, 'unfinished verification audit node cannot be marked complete');
    assert.equal(model.artifacts.length, 1);
    assert.equal(app.engine.extras.runContent(task.id).totals.fragments, 1);
    const report = app.engine.extras.readSnapshotReport(task.id);
    assert.equal(report.analyzedUnits, 1); assert.match(app.engine.extras.downloadSnapshotReport(task.id, report.reportId!).markdown, /已分析/);
    app.store.db.prepare('UPDATE attempts SET readability_json = ? WHERE id = ?').run(JSON.stringify({ output: 'forbidden', tools: 'forbidden', result: 'forbidden' }), attempt.id);
    const response = await app.app.inject({ method: 'GET', url: `/api/tasks/${task.id}/run-content` });
    assert.equal(response.statusCode, 200); assert.deepEqual(response.json().data.specialized.files.map((file: { state: string }) => file.state), ['pending', 'pending', 'excluded']);
    assert.ok(!response.body.includes('离线单元证据fixture'));
    assert.ok(!response.body.includes('PRIVATE_TEST_SUMMARY'));
    assert.equal(response.json().data.specialized.artifacts.length, 0);
    assert.equal(response.json().data.totals.fragments, 0);
    assert.equal(response.json().data.groups.flatMap((group: { nodes: unknown[] }) => group.nodes)[0].latestAttempt.artifactCount, 0);
    assert.equal(snapshotEvidenceState(app.store, task.id).analyzed.size, 1, 'public read revocation does not change engine execution evidence');
    assert.throws(() => app.engine.extras.downloadSnapshotReport(task.id, report.reportId!), /读取权限已撤销/);
    assert.equal(app.engine.extras.readSnapshotReport(task.id).analyzedUnits, 0);
    app.store.executions.updateNode(execution.id, analyze.id, { currentAttemptId: null, status: 'pending' });
    assert.equal(app.engine.extras.runContent(task.id).groups.flatMap((group) => group.nodes).find((node) => node.nodeId === analyze.id)?.latestAttempt, undefined, 'between attempts the reader must not promote a historical attempt to current');

  } finally { await app.close(); }
});
