import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import { createRequestKey, type CodeReviewSnapshot, type SnapshotUnitEvidence } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/application.ts';

/** Opt in: real frozen Git blobs and actual configured models, never synthetic result submissions. */
test('live: snapshot full and lightweight independently review their real frozen scopes and preserve readable stage reports', { skip: process.env.AGENT_WORKFLOW_LIVE !== '1', timeout: 1_200_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'aw-snapshot-live-repo-')); const dataDir = mkdtempSync(join(tmpdir(), 'aw-snapshot-live-data-'));
  const git = (...argv: string[]) => execFileSync('git', argv, { cwd: root, encoding: 'utf8' }).trim();
  mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src/constant.ts'), 'export const ZERO = 0;\n'); writeFileSync(join(root, 'src/name.ts'), 'export function name(value: string | null): string { return value ?? "anonymous"; }\n'); writeFileSync(join(root, 'README.md'), '# Public snapshot fixture\nNo private project content.\n');
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Snapshot Evidence'); git('config', 'user.email', 'snapshot@example.invalid'); git('add', '.'); git('commit', '-qm', 'public baseline'); const baseline = git('rev-parse', 'HEAD');
  writeFileSync(join(root, 'src/constant.ts'), '// A stable numeric constant.\nexport const ZERO = 0;\n'); writeFileSync(join(root, 'src/name.ts'), 'export function name(value: string | null): string {\n  return value!.trim();\n}\n'); git('add', '.'); git('commit', '-qm', 'target with nullable dereference'); const target = git('rev-parse', 'HEAD');
  const app = await createApplication({ dataDir, port: 0, host: '127.0.0.1' }); let web: Awaited<ReturnType<typeof createServer>> | undefined;
  const post = async (url: string, body: object) => { const response = await app.app.inject({ method: 'POST', url, payload: { requestKey: createRequestKey(), ...body } }); assert.ok(response.statusCode < 300, `${url}: ${response.body}`); const value = response.json().data; assert.notEqual(value.receipt?.status, 'failed', response.body); return value.resource; };
  try {
    assert.ok(app.adapter); await app.adapter.ensureReady();
    const gui = process.env.AGENT_WORKFLOW_GUI_REVIEW === '1';
    if (gui) { web = await createServer({ configFile: resolve('apps/web/vite.config.ts'), root: resolve('apps/web'), plugins: [{ name: 'snapshot-gui-report-latency', configureServer(server) { server.middlewares.use((request, _response, next) => { if (request.method === 'GET' && /\/snapshot-review\/report$/.test(request.url?.split('?')[0] ?? '')) setTimeout(next, 3000); else next(); }); } }], server: { host: '127.0.0.1', port: 5298, strictPort: true, proxy: { '/api': { target: app.url } } } }); await web.listen(); }
    const project = (await post('/api/projects', { name: '真实快照评审 · 临时公开源码', rootPath: root })).project;
    const identities: Array<{ taskId: string; depth: string }> = [];
    for (const depth of ['full', 'lightweight'] as const) {
      const created = await post('/api/tasks', { projectId: project.id, title: `真实快照评审 ${depth}`, requirementText: '只读审查被冻结的两个TypeScript源码单元，仅报告确切正确性缺陷，不报告风格或命名偏好。逐个完整读取冻结blob；分析阶段使用实际源码判断，独立复核阶段保留每个上游候选的id/title/detail/line/severity，只补充verdict和rationale。使用受控MCP提交全部分配单元的snapshotUnits，不修改文件。', methodId: 'method.requirement-development', template: { templateId: 'template.snapshot-code-review', parameters: { mode: depth === 'full' ? 'full' : 'incremental', depth, baselineRef: baseline, targetRef: target, scopePaths: 'src' } } });
      const taskId = created.task.id as string; const snapshot = created.templateProgress.snapshot as CodeReviewSnapshot; assert.equal(snapshot.targetSha, target); assert.equal(snapshot.units.filter(unit => !unit.excludedReason).length, 2); assert.equal(snapshot.units.find(unit => unit.path === 'README.md')?.excludedReason, '不在所选代码范围内'); identities.push({ taskId, depth });
      console.log('[snapshot-live] identity', JSON.stringify({ taskId, depth, projectId: project.id, url: gui ? `http://127.0.0.1:5298/tasks/${taskId}` : app.url, dataDir }));
      const plan = (await post(`/api/tasks/${taskId}/plan/from-template`, { confirmUseTemplate: true })).plan;
      await post(`/api/tasks/${taskId}/plan/confirm`, { planRevisionId: plan.id, expectedRevisionNumber: plan.revisionNumber, confirmPlan: true });
      await post(`/api/tasks/${taskId}/workspace/prepare`, { expectedPlanRevisionNumber: plan.revisionNumber, expectedBaseRef: 'main', confirmPrepare: true });
      const before = (await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/snapshot-review/report` })).json().data; assert.equal(before.pendingUnits, 2); assert.equal(before.analyzedUnits, 0); assert.match(before.contentMarkdown, /未分析/);
      await post(`/api/tasks/${taskId}/execution/start`, { confirm: true });
      let stageSeen = false; let last = ''; const deadline = Date.now() + 420_000;
      while (Date.now() < deadline) {
        const execution = app.store.executions.get(app.store.tasks.get(taskId)!.executionId!)!; const status = JSON.stringify({ status: execution.status, nodes: execution.nodes.map(node => ({ nodeId: node.nodeId, status: node.status })) }); if (last !== status) { console.log('[snapshot-live] state', depth, status); last = status; }
        const stage = (await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/snapshot-review/report` })).json().data;
        if (!stageSeen && stage.analyzedUnits > 0 && stage.unverifiedUnits > 0) { stageSeen = true; assert.equal(stage.pendingUnits, 0); assert.match(stage.contentMarkdown, /已分析但未独立复核/); console.log('[snapshot-live] partial', JSON.stringify({ taskId, analyzed: stage.analyzedUnits, unverified: stage.unverifiedUnits, pending: stage.pendingUnits })); }
        if (['completed', 'failed', 'stopped', 'unknown'].includes(execution.status)) { assert.equal(execution.status, 'completed', JSON.stringify(app.store.executions.listAttempts(execution.id).map(attempt => ({ status: attempt.status, errors: attempt.result?.errors, summary: attempt.result?.summary })))); break; }
        await new Promise(resolve => setTimeout(resolve, 800));
      }
      const execution = app.store.executions.get(app.store.tasks.get(taskId)!.executionId!)!; assert.equal(execution.status, 'completed');
      assert.ok(stageSeen, 'must observe actual analyzed-but-not-yet-verified stage evidence');
      const attempts = app.store.executions.listAttempts(execution.id); const analysis = attempts.find(attempt => attempt.definition?.node.snapshotStage === 'analysis')!; const verification = attempts.find(attempt => attempt.definition?.node.snapshotStage === 'verification')!;
      assert.equal(analysis.status, 'succeeded'); assert.ok((analysis.usage?.total ?? 0) > 0); assert.ok((verification.usage?.total ?? 0) > 0); const analyzed = analysis.result!.payload!.snapshotUnits as SnapshotUnitEvidence[]; assert.equal(analyzed.length, 2); const expected = depth === 'full' ? analyzed : analyzed.filter(unit => unit.findings.length > 0); assert.ok(expected.length > 0, 'real nullable dereference should produce a candidate');
      const verified = verification.result!.payload!.snapshotUnits as SnapshotUnitEvidence[]; assert.deepEqual(verified.map(unit => unit.unitId).sort(), expected.map(unit => unit.unitId).sort());
      if (depth === 'lightweight') assert.ok(expected.length < analyzed.length, 'lightweight must exclude the actual clean unit from independent dispatch');
      const analysisSession = app.store.settings.getJson<{ sessionId: string }>(`execution.session.${analysis.id}`)?.sessionId; const verificationSession = app.store.settings.getJson<{ sessionId: string }>(`execution.session.${verification.id}`)?.sessionId; assert.ok(analysisSession && verificationSession); assert.notEqual(analysisSession, verificationSession);
      for (const attempt of [analysis, verification]) for (const unit of attempt.result!.payload!.snapshotUnits as SnapshotUnitEvidence[]) assert.equal(app.store.settings.getJson<{ blobSha: string }>(`snapshot.read.${attempt.id}.${unit.unitId}`)?.blobSha, snapshot.units.find(value => value.id === unit.unitId)!.blobSha);
      const report = (await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/snapshot-review/report` })).json().data; assert.equal(report.analyzedUnits, 2); assert.equal(report.pendingUnits, 0); assert.equal(report.unverifiedUnits, 0); assert.match(report.contentMarkdown, /独立复核依据/);
      const download = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/snapshot-review/report/${report.reportId}/download` }); assert.equal(download.statusCode, 200); assert.equal(download.json().data.markdown, report.contentMarkdown);
      assert.equal(git('rev-parse', 'HEAD'), target); assert.equal(git('status', '--porcelain'), '');
      console.log('[snapshot-live] complete', JSON.stringify({ taskId, depth, analyzed: analyzed.length, verified: verified.length, stageSeen, reportId: report.reportId, analysisSession, verificationSession, analysisTokens: analysis.usage?.total, verificationTokens: verification.usage?.total }));
    }
    if (gui) { console.log('[snapshot-live] gui_review', JSON.stringify({ dataDir, identities })); const deadline = Date.now() + 300_000; while (!existsSync(join(dataDir, 'gui-reviewed')) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 1000)); assert.ok(existsSync(join(dataDir, 'gui-reviewed')), 'GUI review must explicitly finish'); }
  } finally { await web?.close(); await app.close(); }
});
