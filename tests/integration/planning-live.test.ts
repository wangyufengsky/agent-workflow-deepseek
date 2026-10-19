import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../../packages/server/src/index.ts';

/**
 * Live end-to-end planning against the configured OpenCode Go provider.
 * Off by default; run with AGENT_WORKFLOW_LIVE=1. This spends a small amount of
 * model usage (the user explicitly authorized opencode-go testing).
 */
const live = process.env.AGENT_WORKFLOW_LIVE === '1';

function requestKey(prefix: string): string {
  return `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;
}

function createRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'aw-live-repo-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# demo service\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  return root;
}

test('live: planning via managed OpenCode + MCP submit → apply → confirm → workspace', { skip: !live, timeout: 300000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-live-data-'));
  const app = await createApplication({ dataDir, port: 0, host: '127.0.0.1' });
  try {
    assert.ok(app.adapter, 'OpenCode adapter must be enabled');
    await app.adapter.ensureReady();
    const repo = createRepo();
    const projectRes = await app.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { requestKey: requestKey('prj'), name: '订单服务', rootPath: repo },
    });
    assert.equal(projectRes.statusCode, 201, projectRes.body);
    const projectId = projectRes.json().data.resource.project.id;
    const taskRes = await app.app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        requestKey: requestKey('task'),
        projectId,
        title: '退款单按状态与日期筛选并导出',
        requirementText: 'R1 退款单列表支持按状态与日期筛选。\nR2 支持把筛选结果导出为 CSV。\nC1 只能读取退款单数据，不允许修改订单。\n验收：筛选条件、分页与导出结果一致。',
        methodId: 'method.requirement-development',
      },
    });
    assert.equal(taskRes.statusCode, 201, taskRes.body);
    const taskId = taskRes.json().data.resource.task.id;

    const previewRes = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/planning/preview`, payload: {} });
    assert.equal(previewRes.statusCode, 200, previewRes.body);
    const preview = previewRes.json().data.preview;
    assert.equal(preview.blockers.length, 0, JSON.stringify(preview.blockers));

    const startRes = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/planning/start`,
      payload: { requestKey: requestKey('start'), previewId: preview.previewId, confirmModelDispatch: true, sourceInputRevision: preview.sourceInputRevision },
    });
    assert.equal(startRes.statusCode, 200, startRes.body);

    let round: any;
    const deadline = Date.now() + 240000;
    while (Date.now() < deadline) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 2000));
      const detail = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/detail` });
      round = detail.json().data.planning.rounds[0];
      if (round !== undefined && ['completed', 'failed', 'stopped', 'unknown'].includes(round.status)) break;
    }
    console.log('[live] round:', JSON.stringify({ status: round?.status, stage: round?.stage, candidate: round?.candidate?.summary?.slice(0, 120), problems: round?.candidate?.validation?.structural?.problems?.length }));
    assert.ok(round !== undefined, 'round exists');
    assert.ok(round.candidate !== undefined, `candidate expected, round=${JSON.stringify({ status: round.status, stage: round.stage, failure: round.failure })}`);
    assert.equal(round.status, 'completed', JSON.stringify(round.failure));
    assert.equal(round.candidate.validation.structural.state, 'passed', JSON.stringify(round.candidate.validation.structural.problems));

    const detail = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/detail` });
    const decisions = detail.json().data.planning.rounds[0].candidate.validation.humanReview.items as { id: string }[];
    const applyRes = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/planning/apply`,
      payload: {
        requestKey: requestKey('apply'),
        roundId: round.id,
        candidatePlanRevisionId: round.candidate.planRevisionId,
        acceptedDecisionIds: decisions.map((decision) => decision.id),
        confirmApply: true,
      },
    });
    assert.equal(applyRes.statusCode, 200, applyRes.body);
    const afterApply = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/detail` });
    assert.equal(afterApply.json().data.task.stage, 'confirming');

    const planId = afterApply.json().data.plan.id;
    const confirmRes = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan/confirm`,
      payload: { requestKey: requestKey('confirm'), planRevisionId: planId, expectedRevisionNumber: afterApply.json().data.plan.revisionNumber, confirmPlan: true },
    });
    assert.equal(confirmRes.statusCode, 200, confirmRes.body);
    const afterConfirm = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/detail` });
    assert.equal(afterConfirm.json().data.task.stage, 'preparing');

    const prepare = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/workspace/prepare`,
      payload: { requestKey: requestKey('prep'), expectedPlanRevisionNumber: afterConfirm.json().data.plan.revisionNumber, expectedBaseRef: 'main', confirmPrepare: true },
    });
    assert.equal(prepare.statusCode, 200, prepare.body);
    assert.equal(prepare.json().data.resource.workspace.state, 'ready');
    console.log('[live] planning e2e PASS');
  } finally {
    await app.close();
  }
});
