import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'vite';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_CATALOG, type ControlledTestRun, type AttemptResult } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/index.ts';
import { methodToGraph } from '../../packages/engine/src/graph.ts';
import { retainControlledTestRun } from '../../packages/server/src/controlled-tests.ts';

async function fixture(testStep = true) {
  const root = mkdtempSync(join(tmpdir(), 'aw-quality-source-')); const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-quality-data-')), host: '127.0.0.1', port: 0, disableOpenCode: true, disableListen: process.env.AGENT_WORKFLOW_QUALITY_GUI !== '1' });
  const project = app.store.projects.create({ name: 'Quality evidence fixture', rootPath: root, gitState: 'not_git' });
  const task = app.store.tasks.create({ projectId: project.id, title: 'Independent evidence', requirementText: 'Actual bounded source', methodId: 'method.requirement-development', methodRevision: 'r12' });
  const graph = methodToGraph({ ...DEFAULT_CATALOG.methods[0]!, requiredSteps: [{ key: 'test.only', title: 'Program evidence', kind: testStep ? 'test' : 'implementation', group: 'one', optional: false }] });
  const node = graph.nodes[0]!; const plan = app.store.plans.create({ taskId: task.id, source: 'manual', status: 'confirmed', graph }); const execution = app.store.executions.create({ taskId: task.id, planRevisionId: plan.id, graph, autoAdvance: false }); app.store.tasks.update(task.id, { executionId: execution.id, currentPlanRevisionId: plan.id, lifecycle: 'completed' });
  const attempt = app.store.executions.createAttempt({ executionId: execution.id, nodeId: node.id, ordinal: 1, definition: { planRevisionId: plan.id, node } }); app.store.executions.updateNode(execution.id, node.id, { currentAttemptId: attempt.id, status: 'running', attemptCount: 1 });
  const result = (run?: ControlledTestRun): AttemptResult => ({ resultRevision: 'res_quality_fixture', summary: 'Fixture execution state; test counters only come from actual Node child.', verification: { state: 'passed', passed: 900 }, ...(run ? { testRun: run } : {}), errors: [], warnings: [], artifacts: [] });
  const complete = (run?: ControlledTestRun) => { app.store.executions.finishAttempt(attempt.id, run?.state === 'failed' ? 'failed' : 'succeeded', result(run)); app.store.executions.updateNode(execution.id, node.id, { status: run?.state === 'failed' ? 'failed' : 'succeeded' }); app.store.executions.update(execution.id, { status: run?.state === 'failed' ? 'failed' : 'completed', progress: { done: run?.state === 'failed' ? 0 : 1, failed: run?.state === 'failed' ? 1 : 0, running: 0, total: 1 } }); };
  const runTests = (fail = false, supported = true) => {
    writeFileSync(join(root, 'proof.test.mjs'), `import {test} from 'node:test';import assert from 'node:assert/strict';test('real assertion',()=>assert.equal(1,${fail ? 2 : 1}));test('explicit skip',{skip:true},()=>{});`);
    const argv = [process.execPath, '--test', ...(supported ? ['--test-reporter=junit'] : []), 'proof.test.mjs']; const startedAt = new Date().toISOString(); const child = spawnSync(argv[0]!, argv.slice(1), { cwd: root, encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined } }); assert.equal(child.error, undefined);
    return retainControlledTestRun({ store: app.store, taskId: task.id, executionId: execution.id, nodeId: node.id, attemptId: attempt.id, root, startedAt, argv, allowed: () => true, result: { command: argv.join(' '), stdout: child.stdout, stderr: child.stderr, exitCode: child.status!, timedOut: false } });
  };
  const evidence = () => app.engine.insights.taskUsage().find(item => item.taskId === task.id)!.qualityEvidence!;
  const review = () => app.store.reviews.create({ projectId: project.id, executionId: execution.id, subject: { commitSha: 'a'.repeat(40), compareBase: { compareId: 'parent:0', kind: 'parent', label: 'parent', baseSha: 'b'.repeat(40) } }, dimensions: ['security', 'correctness'], context: 'diff_only', profession: { professionId: 'role.reviewer', revision: 'r1', displayName: 'Code reviewer' }, state: 'completed', findings: [] });
  return { app, task, execution, node, plan, attempt, result, complete, runTests, evidence, review };
}

test('quality uses actual controlled Node/JUnit counters; absent risk is not an invented mandatory gate or a pass', async () => {
  const f = await fixture(); try {
    assert.equal(f.evidence().checks[0]!.state, 'not_reviewed'); const run = f.runTests(); f.complete(run);
    const evidence = f.evidence(); assert.equal(evidence.summary, 'passed'); const program = evidence.checks[0]!; assert.equal(program.state, 'passed'); assert.equal(program.passed, 1); assert.equal(program.failed, 0); assert.equal(program.skipped, 1); assert.equal(program.sources[0]?.id, run.id);
    assert.equal(evidence.checks.find(item => item.kind === 'risk')?.state, 'not_configured'); assert.equal(evidence.checks.find(item => item.kind === 'human')?.state, 'not_reviewed');
    const response = await f.app.app.inject({ method: 'GET', url: '/api/insights/task-usage' }); assert.equal(response.statusCode, 200); assert.equal(response.json().data.usage.find((item: { taskId: string }) => item.taskId === f.task.id).qualityEvidence.checks.length, 4);
    if (process.env.AGENT_WORKFLOW_QUALITY_GUI === '1') { const web = await createServer({ configFile: resolve('apps/web/vite.config.ts'), root: resolve('apps/web'), server: { host: '127.0.0.1', port: 5303, strictPort: true, proxy: { '/api': { target: f.app.url } } } }); await web.listen(); try { console.log('[quality-offline-gui]', JSON.stringify({ url: 'http://127.0.0.1:5303/insights', dataDir: f.app.store.dataDir })); const deadline = Date.now() + 180_000; while (!existsSync(join(f.app.store.dataDir, 'gui-reviewed')) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 500)); assert.ok(existsSync(join(f.app.store.dataDir, 'gui-reviewed'))); } finally { await web.close(); } }
  } finally { await f.app.close(); }
});

test('claimed verification, superseded test identities and revoked results cannot establish program acceptance', async () => {
  const f = await fixture(); try {
    f.complete(); assert.equal(f.evidence().checks[0]!.state, 'unknown'); const run = f.runTests(); f.complete(run); assert.equal(f.evidence().checks[0]!.passed, 1);
    f.app.store.settings.putJson(`execution.test-run.latest.${f.attempt.id}`, 'a-newer-run'); assert.equal(f.evidence().checks[0]!.state, 'unknown'); assert.equal(f.evidence().checks[0]!.passed, undefined);
    f.app.store.settings.putJson(`execution.test-run.latest.${f.attempt.id}`, run.id); f.app.store.db.prepare('UPDATE attempts SET readability_json=? WHERE id=?').run(JSON.stringify({ output: 'ok', tools: 'ok', result: 'forbidden' }), f.attempt.id); const masked = f.evidence().checks[0]!; assert.equal(masked.state, 'unknown'); assert.equal(masked.sources.length, 0); assert.equal(masked.passed, undefined);
  } finally { await f.app.close(); }
});

test('human acceptance does not overwrite a real failed test or misclassify code security as an independent risk review', async () => {
  const f = await fixture(); try {
    f.complete(f.runTests(true)); f.review(); f.app.store.acceptances.put({ taskId: f.task.id, verdict: 'accepted', decidedAt: new Date().toISOString() });
    const evidence = f.evidence(); assert.equal(evidence.summary, 'issues'); assert.equal(evidence.checks[0]!.state, 'failed'); assert.equal(evidence.checks[3]!.state, 'passed'); assert.equal(evidence.checks[2]!.state, 'not_configured'); assert.equal(evidence.codeReview.state, 'passed');
    for (const source of [...evidence.checks[3]!.sources, ...evidence.codeReview.sources]) { const read = await f.app.app.inject({ method: 'GET', url: source.href }); assert.equal(read.statusCode, 200, read.body); if (source.kind === 'human') assert.equal(read.json().data.acceptance.verdict, 'accepted'); else assert.equal(read.json().data.review.reviewRunId, source.id); }
  } finally { await f.app.close(); }
});

test('not-required program scope differs from absent review configuration; corrupt latest review stays unknown', async () => {
  const f = await fixture(false); try {
    f.complete(); assert.equal(f.evidence().checks[0]!.state, 'not_required'); assert.equal(f.evidence().checks[1]!.state, 'not_configured');
    const review = f.review(); assert.equal(f.evidence().summary, 'passed'); f.app.store.db.prepare('UPDATE reviews SET findings_json=? WHERE id=?').run('invalid JSON', review.reviewRunId); assert.equal(f.evidence().codeReview.state, 'unknown'); assert.notEqual(f.evidence().summary, 'passed');
  } finally { await f.app.close(); }
});

test('explicit requirement review consumes only current source-bound independent evidence, never generic verification', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-requirement-quality-')), disableOpenCode: true, disableListen: true });
  try {
    const project = app.store.projects.create({ name: 'Explicit requirement evidence fixture', rootPath: tmpdir(), gitState: 'not_git' }); const template = DEFAULT_CATALOG.templates.find(item => item.id === 'template.requirement-review')!;
    const task = app.store.tasks.create({ projectId: project.id, title: 'Requirement source fixture', requirementText: 'Frozen requirement comparison', methodId: 'method.requirement-development', methodRevision: 'fixture', fixedTemplate: { templateId: template.id, templateVersion: template.version, contract: template, locked: true, parameters: {}, scope: { sourcePaths: ['a.ts'], sourceFiles: [{ path: 'a.ts', blobSha: 'a'.repeat(40), text: 'export const a = 1;' }], documents: [{ name: 'requirement.md', text: 'Must export a = 1.', sha256: 'b'.repeat(64), bytes: 18 }], frozenAt: new Date().toISOString() } } });
    const base = methodToGraph({ ...DEFAULT_CATALOG.methods[0]!, requiredSteps: template.steps }); const graph = { ...base, nodes: base.nodes.map((node, index) => ({ ...node, sourceEvidence: { version: 1 as const, stage: template.steps[index]!.sourceStage!, filePaths: ['a.ts'] } })) };
    const plan = app.store.plans.create({ taskId: task.id, source: 'template', status: 'confirmed', graph }); const execution = app.store.executions.create({ taskId: task.id, planRevisionId: plan.id, graph, autoAdvance: false }); app.store.tasks.update(task.id, { executionId: execution.id, currentPlanRevisionId: plan.id, lifecycle: 'completed' });
    const writerNode = graph.nodes.find(node => node.sourceEvidence.stage === 'write')!; const reviewerNode = graph.nodes.find(node => node.sourceEvidence.stage === 'review')!;
    const writer = app.store.executions.createAttempt({ executionId: execution.id, nodeId: writerNode.id, ordinal: 1, definition: { planRevisionId: plan.id, node: writerNode } }); const reviewer = app.store.executions.createAttempt({ executionId: execution.id, nodeId: reviewerNode.id, ordinal: 1, definition: { planRevisionId: plan.id, node: reviewerNode } });
    const writeEvidence = { path: 'a.ts', blobSha: 'a'.repeat(40), summary: '[offline binding fixture] explicit requirement comparison', stage: 'write' as const, attemptId: writer.id, artifacts: [] };
    const result = (fileEvidence: AttemptResult['fileEvidence']): AttemptResult => ({ resultRevision: 'res_requirement_fixture', summary: '[offline fixture] identity validation only, not a model result', fileEvidence, verification: { state: 'passed' }, artifacts: [], errors: [], warnings: [] });
    app.store.executions.finishAttempt(writer.id, 'succeeded', result([writeEvidence])); app.store.executions.updateNode(execution.id, writerNode.id, { status: 'succeeded', currentAttemptId: writer.id });
    app.store.executions.finishAttempt(reviewer.id, 'succeeded', result([{ ...writeEvidence, stage: 'review', attemptId: reviewer.id, writerAttemptId: writer.id, verdict: 'confirmed', rationale: '[offline fixture] explicit independent review binding' }])); app.store.executions.updateNode(execution.id, reviewerNode.id, { status: 'succeeded', currentAttemptId: reviewer.id });
    app.store.settings.putJson(`execution.session.${writer.id}`, { sessionId: 'fixture-writer' }); app.store.settings.putJson(`execution.session.${reviewer.id}`, { sessionId: 'fixture-reviewer' }); app.store.settings.putJson(`execution.source-read.${reviewer.id}.a.ts`, { blobSha: 'a'.repeat(40) });
    const requirement = () => app.engine.insights.taskUsage().find(item => item.taskId === task.id)!.qualityEvidence!.checks.find(item => item.kind === 'requirement')!;
    assert.equal(requirement().state, 'unknown'); assert.match(requirement().reason, /评审过程已完成/); assert.equal(requirement().sources[0]?.id, reviewer.id);
    app.store.settings.putJson(`execution.session.${reviewer.id}`, { sessionId: 'fixture-writer' }); assert.equal(requirement().state, 'unknown'); assert.match(requirement().reason, /不足以证明/);
    app.store.settings.putJson(`execution.session.${reviewer.id}`, { sessionId: 'fixture-reviewer' }); const retry = app.store.executions.createAttempt({ executionId: execution.id, nodeId: writerNode.id, ordinal: 2, definition: { planRevisionId: plan.id, node: writerNode } }); app.store.executions.updateNode(execution.id, writerNode.id, { currentAttemptId: retry.id, status: 'running' }); assert.equal(requirement().state, 'unknown');
  } finally { await app.close(); }
});


test('unsupported real test output remains unknown and never fabricates zero passed/failed counters', async () => {
 const f = await fixture(); try { f.complete(f.runTests(false, false)); const program = f.evidence().checks[0]!; assert.equal(program.state, 'unknown'); assert.equal(program.passed, undefined); assert.equal(program.failed, undefined); assert.equal(program.skipped, undefined); assert.notEqual(f.evidence().summary, 'passed'); } finally { await f.app.close(); }
});
