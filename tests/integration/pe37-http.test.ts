import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PlanGraph, PlanNode, PlanValidation, PlanningUsage } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/index.ts';

type App = Awaited<ReturnType<typeof createApplication>>;

function requestKey(prefix: string): string {
  return `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;
}

function node(id: string, title: string, groupId: string): PlanNode {
  return {
    id,
    key: id,
    title,
    kind: 'implementation',
    groupId,
    summary: `${title}（测试步骤）`,
    inputs: [],
    outputs: [],
    acceptance: [],
    resources: { read: [], write: [] },
  };
}

function overviewGraph(): PlanGraph {
  return {
    nodes: [
      node('g1.a1', '账户', 'group.g1'),
      node('g1.a2', '流水', 'group.g1'),
      { ...node('placeholder.group.g2', '未细化：消耗与抵扣', 'group.g2'), kind: 'system', summary: '未细化组占位，不能执行' },
      { ...node('placeholder.group.g3', '未细化：数据迁移', 'group.g3'), kind: 'system', summary: '未细化组占位，不能执行' },
    ],
    edges: [
      { id: 'e1', from: 'g1.a1', to: 'g1.a2', kind: 'order' },
      { id: 'e2', from: 'g1.a2', to: 'placeholder.group.g2', kind: 'order' },
      { id: 'e3', from: 'placeholder.group.g2', to: 'placeholder.group.g3', kind: 'order' },
    ],
    groups: [
      { id: 'group.g1', label: '积分账户与流水', kind: 'implementation', refined: true, collapsible: true, collapsedByDefault: false },
      { id: 'group.g2', label: '消耗与抵扣', kind: 'implementation', refined: false, collapsible: true, collapsedByDefault: false },
      { id: 'group.g3', label: '数据迁移', kind: 'implementation', refined: false, collapsible: true, collapsedByDefault: false },
    ],
  };
}

function seedOverview(app: App): { taskId: string; planId: string } {
  const project = app.store.projects.create({ name: 'PE37 HTTP', rootPath: mkdtempSync(join(tmpdir(), 'aw-pe37-http-repo-')), gitState: 'not_git' });
  const task = app.store.tasks.create({
    projectId: project.id,
    title: '会员积分体系重构',
    requirementText: 'R1 积分账户\nR2 消耗规则\nR3 数据迁移',
    methodId: 'method.requirement-development',
    methodRevision: 'r12',
  });
  const plan = app.store.plans.create({ taskId: task.id, source: 'applied', graph: overviewGraph(), status: 'unconfirmed' });
  app.store.tasks.update(task.id, { currentPlanRevisionId: plan.id, stage: 'planning' });
  return { taskId: task.id, planId: plan.id };
}

test('PE37 HTTP: proposal, refine-preview, scoped start validation and SCOPE_UNREFINED confirm gate', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-pe37-http-')), disableOpenCode: true, disableListen: true });
  try {
    const { taskId, planId } = seedOverview(app);

    const proposal = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/planning/proposal` });
    assert.equal(proposal.statusCode, 200, proposal.body);
    const proposalData = proposal.json().data.proposal as {
      planRevisionId: string;
      groups: { groupRef: string; state: string; leafCount: number; placeholderNodeIds: string[] }[];
      unresolvedScopes: { groupRef: string; title: string }[];
      limits: { maxNodes: number };
    };
    assert.equal(proposalData.planRevisionId, planId);
    assert.equal(proposalData.groups.length, 3);
    assert.equal(proposalData.groups.find((group) => group.groupRef === 'group.g1')?.state, 'refined');
    assert.equal(proposalData.groups.find((group) => group.groupRef === 'group.g2')?.state, 'unrefined');
    assert.deepEqual(proposalData.unresolvedScopes.map((scope) => scope.groupRef), ['group.g2', 'group.g3']);

    const detail = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/detail` });
    assert.equal(detail.statusCode, 200, detail.body);
    const continuePlanning = detail.json().data.planning.actions.continuePlanning as { allowed: boolean; reason?: string };
    assert.equal(continuePlanning.allowed, true);
    assert.match(String(continuePlanning.reason), /2 个组未细化/);

    const preview = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/planning/refine-preview`, payload: { groupRef: 'group.g2' } });
    assert.equal(preview.statusCode, 200, preview.body);
    const previewData = preview.json().data as {
      taskId: string;
      preview: {
        previewRef: string;
        groupRef: string;
        groupTitle: string;
        round: number;
        scope: { groupRef: string; basePlanRevisionId: string; placeholderNodeIds: string[] };
        limits: { maxNodes: number };
        budget: { dispatches: number };
        expiresAt: string;
        blockers: unknown[];
      };
    };
    assert.equal(previewData.taskId, taskId);
    assert.equal(previewData.preview.groupRef, 'group.g2');
    assert.equal(previewData.preview.groupTitle, '消耗与抵扣');
    assert.equal(previewData.preview.scope.basePlanRevisionId, planId);
    assert.equal(previewData.preview.scope.placeholderNodeIds.length, 1);
    assert.ok(previewData.preview.previewRef.length > 0);
    // OpenCode is disabled in this test app; the preview must say so (never pretend ready).
    assert.ok(Array.isArray(previewData.preview.blockers));
    assert.ok(previewData.preview.blockers.every((blocker) => (blocker as { code: string }).code === 'OPENCODE_NOT_READY'), JSON.stringify(previewData.preview.blockers));

    const missingGroupRef = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/planning/refine-preview`, payload: {} });
    assert.equal(missingGroupRef.statusCode, 400, missingGroupRef.body);
    assert.equal(missingGroupRef.json().error.code, 'VALIDATION_FAILED');
    const refinedPreview = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/planning/refine-preview`, payload: { groupRef: 'group.g1' } });
    assert.equal(refinedPreview.statusCode, 400, refinedPreview.body);

    // Scope is required for a refine-preview start, and must match the preview.
    const noScope = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/planning/start`,
      payload: { requestKey: requestKey('pe37-noscope'), previewId: previewData.preview.previewRef, sourceInputRevision: app.store.tasks.get(taskId)!.requirement.revision, confirmModelDispatch: true },
    });
    assert.equal(noScope.statusCode, 400, noScope.body);
    assert.equal(noScope.json().error.code, 'VALIDATION_FAILED');
    assert.equal(noScope.json().error.details.groupRef, 'group.g2');
    const mismatch = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/planning/start`,
      payload: {
        requestKey: requestKey('pe37-mismatch'),
        previewId: previewData.preview.previewRef,
        sourceInputRevision: app.store.tasks.get(taskId)!.requirement.revision,
        confirmModelDispatch: true,
        scope: { groupRef: 'group.g3' },
      },
    });
    assert.equal(mismatch.statusCode, 409, mismatch.body);
    assert.equal(mismatch.json().error.code, 'STALE_TARGET');
    assert.equal(mismatch.json().error.details.previewGroupRef, 'group.g2');

    // Early confirm: 409 + structured SCOPE_UNREFINED details.
    const confirmKey = requestKey('pe37-confirm');
    const confirm = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan/confirm`,
      payload: { requestKey: confirmKey, planRevisionId: planId, expectedRevisionNumber: 1, confirmPlan: true },
    });
    assert.equal(confirm.statusCode, 409, confirm.body);
    assert.equal(confirm.json().error.code, 'PLAN_REVISION_CONFLICT');
    assert.equal(confirm.json().error.details.code, 'SCOPE_UNREFINED');
    assert.deepEqual(confirm.json().error.details.unresolvedScopes, ['group.g2', 'group.g3']);
    assert.deepEqual(confirm.json().error.details.groups, ['消耗与抵扣', '数据迁移']);

    // The action flips to PLAN_ALREADY_CONFIRMED once the plan is confirmed.
    app.store.plans.setStatus(planId, 'confirmed');
    const afterConfirm = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/detail` });
    assert.equal(afterConfirm.json().data.planning.actions.continuePlanning.reasonCode, 'PLAN_ALREADY_CONFIRMED');
  } finally {
    await app.close();
  }
});

test('PE37 HTTP: an out-of-scope candidate surfaces SCOPE_VIOLATION problems on apply', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-pe37-scope-')), disableOpenCode: true, disableListen: true });
  try {
    const { taskId } = seedOverview(app);
    const candidatePlan = app.store.plans.create({ taskId, source: 'applied', graph: overviewGraph(), status: 'draft' });
    const validation: PlanValidation = {
      structural: {
        state: 'failed',
        problems: [
          { id: 'p1', code: 'SCOPE_VIOLATION', severity: 'hard', title: '候选包含范围外分组', detail: '本轮只允许细化分组 group.g2，候选包含 group.g3（数据迁移）' },
        ],
      },
      humanReview: { required: 0, accepted: 0, items: [] },
      basis: { state: 'complete', detail: '测试种子' },
      readiness: { state: 'ready', detail: '测试种子' },
      checks: [],
      requirementCoverage: [],
    };
    const usage: PlanningUsage = {
      dispatches: { used: 1, maximum: 2 },
      revisions: { used: 0, maximum: 1 },
      budget: { known: 0, reserved: 0, unknown: 0, currency: 'USD' },
    };
    const round = app.store.planning.create({
      taskId,
      ordinal: 1,
      inputRevision: app.store.tasks.get(taskId)!.requirement.revision,
      method: { id: 'method.requirement-development', revision: 'r12', name: '需求开发' },
      strategy: { id: 'planning.requirement-development', version: 'v1' },
      model: { id: 'model.test', label: 'Test', provider: 'test', model: 'test', roles: ['planner'], enabled: true },
      usage,
    });
    app.store.planning.update(round.id, {
      status: 'completed',
      stage: 'awaiting_review',
      candidate: { planRevisionId: candidatePlan.id, summary: '越界候选', diff: [], validation },
    });
    const apply = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/planning/apply`,
      payload: { requestKey: requestKey('pe37-scope-apply'), roundId: round.id, candidatePlanRevisionId: candidatePlan.id, acceptedDecisionIds: [], confirmApply: true },
    });
    assert.equal(apply.statusCode, 400, apply.body);
    assert.equal(apply.json().error.code, 'VALIDATION_FAILED');
    const problems = apply.json().error.details.problems as { code: string }[];
    assert.ok(problems.some((problem) => problem.code === 'SCOPE_VIOLATION'), JSON.stringify(problems));
  } finally {
    await app.close();
  }
});
