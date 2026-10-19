import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequestKey, type CodeReviewSnapshot, type PlanRevision } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/index.ts';
import { createSessionScope } from '../../packages/server/src/session-scope.ts';
import { snapshotExpectedUnitIds, snapshotEvidenceState, validateSnapshotUnitEvidence } from '../../packages/engine/src/snapshot-review.ts';

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'aw-source-snapshot-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com');
  mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src', 'one.ts'), 'export const one = 1;\n'); writeFileSync(join(root, 'README.md'), '# excluded documentation\n'); writeFileSync(join(root, 'src', 'deleted.ts'), 'export const removed = true;\n');
  git('add', '.'); git('commit', '-qm', 'baseline'); const baseline = git('rev-parse', 'HEAD');
  rmSync(join(root, 'src', 'deleted.ts')); writeFileSync(join(root, 'src', 'one.ts'), 'export const one = 2;\n'); writeFileSync(join(root, 'src', 'two.ts'), 'export const two = 2;\n');
  git('add', '.'); git('commit', '-qm', 'target'); const target = git('rev-parse', 'HEAD');
  return { root, baseline, target, git };
}

test('real Git snapshot freezes source versions and file units; cancelled reports remain readable and downloadable without execution', async () => {
  const repo = repository(); const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-snapshot-data-')), disableOpenCode: true, disableListen: true });
  try {
    const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: createRequestKey(), name: 'Snapshot', rootPath: repo.root } });
    const projectId = project.json().data.resource.project.id;
    const created = await app.app.inject({ method: 'POST', url: '/api/tasks', payload: { requestKey: createRequestKey(), projectId, title: 'Frozen source', requirementText: 'Review source snapshot', methodId: 'method.requirement-development', template: { templateId: 'template.snapshot-code-review', parameters: { mode: 'incremental', depth: 'lightweight', baselineRef: repo.baseline, targetRef: 'HEAD', scopePaths: 'src' } } } });
    assert.equal(created.statusCode, 201, created.body);
    const taskId = created.json().data.resource.task.id as string; const snapshot = created.json().data.resource.templateProgress.snapshot as CodeReviewSnapshot;
    assert.equal(snapshot.targetSha, repo.target); assert.equal(snapshot.baselineSha, repo.baseline); assert.equal(snapshot.units.length, 4);
    assert.equal(snapshot.units.filter((unit) => unit.excludedReason === undefined).length, 3);
    const deleted = snapshot.units.find((unit) => unit.deletedAtTarget)!; assert.equal(deleted.path, 'src/deleted.ts'); assert.match(await app.engine.ports.git.snapshotFile!(repo.root, deleted.blobSha), /removed = true/);
    writeFileSync(join(repo.root, 'src', 'one.ts'), 'export const one = 99;\n'); repo.git('add', '.'); repo.git('commit', '-qm', 'after task creation');
    const detail = (await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/detail` })).json().data;
    assert.equal(detail.templateProgress.snapshot.targetSha, repo.target);
    const skeleton = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/plan/from-template`, payload: { requestKey: createRequestKey(), confirmUseTemplate: true } });
    assert.equal(skeleton.statusCode, 200, skeleton.body);
    const plan = skeleton.json().data.resource.plan as PlanRevision;
    assert.equal(plan.graph.nodes.filter((node) => node.snapshotStage === 'analysis').length, 1);
    assert.equal(plan.graph.nodes.find((node) => node.snapshotStage === 'analysis')?.snapshotUnitIds?.length, 3);
    const before = JSON.stringify(app.store.tasks.get(taskId));
    const unread = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/snapshot-review` });
    assert.equal(unread.json().data.scope.mode, 'incremental'); assert.equal(unread.json().data.scope.depth, 'lightweight'); assert.equal(unread.json().data.partialReport.download.available, false);
    const premature = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/snapshot-review/report/not-read/download` }); assert.equal(premature.statusCode, 409);
    const report = (await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/snapshot-review/report` })).json().data;
    assert.equal(report.analyzedUnits, 0); assert.equal(report.pendingUnits, 3); assert.equal(report.excludedUnits, 1); assert.match(report.contentMarkdown, /未分析/);
    assert.equal(JSON.stringify(app.store.tasks.get(taskId)), before, 'reading changes no task or execution state');
    app.store.tasks.update(taskId, { lifecycle: 'cancelled' });
    const cancelled = (await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/snapshot-review/report` })).json().data;
    const download = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/snapshot-review/report/${cancelled.reportId}/download` });
    assert.equal(download.statusCode, 200); assert.match(download.json().data.markdown, new RegExp(repo.target)); assert.match(download.json().data.filename, /\.md$/);
    const directory = unread.json().data.scope.outputDirectory as string;
    writeFileSync(join(directory, `${cancelled.reportId}.md`), 'tampered report');
    const corrupted = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/snapshot-review/report/${cancelled.reportId}/download` }); assert.equal(corrupted.statusCode, 409, 'download never silently serves a changed report file');
    const readAgain = (await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/snapshot-review/report` })).json().data;
    assert.equal(readAgain.available, true); assert.match(readAgain.contentMarkdown, new RegExp(repo.target));
  } finally { await app.close(); }
});

test('source reads use frozen Git blobs and evidence requires exact assigned files plus independent candidate verdicts', async () => {
  const repo = repository(); const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-snapshot-proof-')), disableOpenCode: true, disableListen: true });
  try {
    const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: createRequestKey(), name: 'Proof', rootPath: repo.root } });
    const projectId = project.json().data.resource.project.id;
    const created = await app.app.inject({ method: 'POST', url: '/api/tasks', payload: { requestKey: createRequestKey(), projectId, title: 'Proof', requirementText: 'Review source', methodId: 'method.requirement-development', template: { templateId: 'template.snapshot-code-review', parameters: { mode: 'full', depth: 'lightweight', scopePaths: 'src' } } } });
    const taskId = created.json().data.resource.task.id as string; const snapshot = created.json().data.resource.templateProgress.snapshot as CodeReviewSnapshot;
    const skeleton = (await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/plan/from-template`, payload: { requestKey: createRequestKey(), confirmUseTemplate: true } })).json().data.resource.plan as PlanRevision;
    const confirmed = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/plan/confirm`, payload: { requestKey: createRequestKey(), planRevisionId: skeleton.id, confirmPlan: true } });
    assert.equal(confirmed.statusCode, 200, confirmed.body);
    const task = app.store.tasks.get(taskId)!; const execution = app.store.executions.get(task.executionId!)!; const plan = app.store.plans.get(skeleton.id)!; const node = plan.graph.nodes.find((node) => node.snapshotStage === 'analysis')!;
    const attempt = app.store.executions.createAttempt({ executionId: execution.id, nodeId: node.id, ordinal: 1 }); app.store.executions.updateNode(execution.id, node.id, { status: 'running', currentAttemptId: attempt.id });
    const role = node.roleSnapshot!; const scope = createSessionScope({ kind: 'execution', metadata: { taskId, executionId: execution.id, nodeId: node.id, attemptId: attempt.id }, cwd: repo.root, prompt: '', permission: 'read_only', model: app.engine.settings.models[0]!, rolePolicy: role, sink: {}, timeoutMs: 60000 });
    const unit = snapshot.units.find((unit) => unit.path === 'src/one.ts')!;
    writeFileSync(join(repo.root, unit.path), 'mutated working tree must not be read\n');
    const read = await app.app.inject({ method: 'GET', url: `/internal/mcp/workspace/file?taskId=${taskId}&path=${unit.path}`, headers: { authorization: `Bearer ${app.internalToken}`, 'x-agent-workflow-scope': scope.token } });
    assert.equal(read.statusCode, 200, read.body); assert.match(read.json().data.lines.join('\n'), /one = 2/); assert.equal(read.json().data.blobSha, unit.blobSha);
    assert.equal(app.store.settings.getJson<{ blobSha: string }>(`snapshot.read.${attempt.id}.${unit.id}`)?.blobSha, unit.blobSha);
    const all = snapshot.units.filter((unit) => node.snapshotUnitIds?.includes(unit.id)).map((unit) => ({ unitId: unit.id, blobSha: unit.blobSha, summary: '[domain test fixture] source evidence', findings: [] }));
    assert.doesNotThrow(() => validateSnapshotUnitEvidence(snapshot, node, { snapshotUnits: all }));
    assert.throws(() => app.engine.executions.submitResult({ taskId, nodeId: node.id, attemptId: attempt.id, summary: 'not all sources read', payload: { snapshotUnits: all } }), /完整读取/, 'a claim for unread source units is rejected before any result can settle');
    assert.throws(() => validateSnapshotUnitEvidence(snapshot, node, { snapshotUnits: [{ ...all[0], blobSha: 'wrong' }] }));
    const verify = plan.graph.nodes.find((node) => node.snapshotStage === 'verification')!;
    assert.deepEqual(snapshotExpectedUnitIds(snapshot, verify, snapshotEvidenceState(app.store, taskId)), []);
    // Explicit domain fixtures, not model acceptance: completed file evidence must aggregate by file units.
    app.store.executions.finishAttempt(attempt.id, 'succeeded', { resultRevision: 'fixture-analysis', summary: '[domain fixture] analysis', payload: { snapshotUnits: all }, artifacts: [], verification: { state: 'passed', summary: '[domain fixture]' }, errors: [], warnings: [] });
    app.store.executions.updateNode(execution.id, node.id, { status: 'succeeded' });
    const afterAnalysis = app.engine.extras.readSnapshotReport(taskId);
    assert.equal(afterAnalysis.analyzedUnits, 2);
    assert.equal(afterAnalysis.pendingUnits, 0);
    assert.equal(afterAnalysis.excludedUnits, 1);
    assert.match(afterAnalysis.contentMarkdown ?? '', /domain test fixture/);
    assert.equal(snapshotExpectedUnitIds(snapshot, verify, snapshotEvidenceState(app.store, taskId)).length, 0, 'clean lightweight units do not create an independent model dispatch');
    scope.revoke();
  } finally { await app.close(); }
});


// Explicit offline dispatch fault: no synthetic successful model output or source evidence.
test('offline dispatch failure preserves an honest readable snapshot report with pending source units', async () => {
  const repo = repository(); const dataDir = mkdtempSync(join(tmpdir(), 'aw-snapshot-failure-'));
  const app = await createApplication({ dataDir, host: '127.0.0.1', port: 0 });
  let web: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    assert.ok(app.adapter); let dispatches = 0;
    app.adapter.status = () => ({ state: 'ready' }) as never;
    app.adapter.ensureReady = async () => {};
    app.adapter.runSession = async () => { dispatches++; throw new Error('Explicit offline dispatch fault before session creation'); };
    const post = async (url: string, payload: object) => { const response = await app.app.inject({ method: 'POST', url, payload: { requestKey: createRequestKey(), ...payload } }); assert.ok(response.statusCode < 300, response.body); return response.json().data.resource; };
    const project = (await post('/api/projects', { name: '离线失败控制流夹具', rootPath: repo.root })).project;
    const task = (await post('/api/tasks', { projectId: project.id, title: '快照执行失败后读取（离线端口夹具）', requirementText: 'Test only: explicit offline dispatch failure, not a model result.', methodId: 'method.requirement-development', template: { templateId: 'template.snapshot-code-review', parameters: { mode: 'full', depth: 'full', scopePaths: 'src' } } })).task;
    const plan = (await post(`/api/tasks/${task.id}/plan/from-template`, { confirmUseTemplate: true })).plan;
    await post(`/api/tasks/${task.id}/plan/confirm`, { planRevisionId: plan.id, confirmPlan: true });
    await post(`/api/tasks/${task.id}/workspace/prepare`, { expectedPlanRevisionNumber: plan.revisionNumber, expectedBaseRef: 'main', confirmPrepare: true });
    await post(`/api/tasks/${task.id}/execution/start`, { confirm: true });
    for (let index = 0; index < 100; index++) { const execution = app.store.executions.get(app.store.tasks.get(task.id)!.executionId!)!; if (execution.nodes.some(node => node.status === 'failed')) break; await new Promise(resolve => setTimeout(resolve, 10)); }
    const execution = app.store.executions.get(app.store.tasks.get(task.id)!.executionId!)!; assert.ok(execution.nodes.some(node => node.status === 'failed')); assert.equal(dispatches, 1);
    const before = JSON.stringify(execution);
    const report = (await app.app.inject({ method: 'GET', url: `/api/tasks/${task.id}/snapshot-review/report` })).json().data;
    assert.equal(report.analyzedUnits, 0); assert.equal(report.pendingUnits, 2); assert.match(report.contentMarkdown, /未分析/);
    const download = await app.app.inject({ method: 'GET', url: `/api/tasks/${task.id}/snapshot-review/report/${report.reportId}/download` }); assert.equal(download.statusCode, 200); assert.equal(download.json().data.markdown, report.contentMarkdown); assert.equal(JSON.stringify(app.store.executions.get(execution.id)), before); assert.equal(dispatches, 1);
    if (process.env.AGENT_WORKFLOW_SNAPSHOT_FAILURE_GUI === '1') {
      web = await createServer({ configFile: resolve('apps/web/vite.config.ts'), root: resolve('apps/web'), server: { host: '127.0.0.1', port: 5302, strictPort: true, proxy: { '/api': { target: app.url } } } }); await web.listen(); console.log('[snapshot-offline-failure] GUI', JSON.stringify({ taskId: task.id, dataDir, url: `http://127.0.0.1:5302/tasks/${task.id}` }));
      const deadline = Date.now() + 180_000; while (!existsSync(join(dataDir, 'gui-reviewed')) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 500)); assert.ok(existsSync(join(dataDir, 'gui-reviewed')));
    }
  } finally { await web?.close(); await app.close(); }
});
