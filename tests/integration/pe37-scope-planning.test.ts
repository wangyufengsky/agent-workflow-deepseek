import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_CATALOG,
  PLANNING_CANDIDATE_SCOPE_KEY,
  PLANNING_GROUP_REFINED_KEY,
  PLANNING_ROUND_SCOPE_KEY,
  findMethod,
  type PlanGraph,
  type PlanNode,
  type PlanningCandidatePayload,
  type PlanningRound,
} from '@agent-workflow/shared';
import { Store } from '@agent-workflow/storage';
import { Engine, type EnginePorts, type OpenCodePort, type OpenCodeRunRequest, type OpenCodeRunResult } from '../../packages/engine/src/index.ts';

/**
 * W3-6 PE37 engine: per-group incremental refinement. Each "继续规划选区" is a
 * new round with its own dispatch budget, only the scoped group may change,
 * cross-group wiring is preserved, apply bumps the draft revision, and confirm
 * is blocked until every group is refined. Old whole-plan planning is unchanged.
 */

function createRepo(): string {
  return mkdtempSync(join(tmpdir(), 'aw-pe37-repo-'));
}

/** Fake managed OpenCode: returns a canned candidate as the assistant text. */
class FakeOpenCode implements OpenCodePort {
  readonly requests: OpenCodeRunRequest[] = [];
  candidate: unknown;
  hold: Promise<void> | undefined;
  #count = 0;

  status(): ReturnType<OpenCodePort['status']> {
    return { state: 'ready' } as ReturnType<OpenCodePort['status']>;
  }

  async ensureReady(): Promise<void> {
    return;
  }

  async runSession(request: OpenCodeRunRequest): Promise<OpenCodeRunResult> {
    this.requests.push(request);
    if (this.hold !== undefined) await this.hold;
    this.#count += 1;
    return {
      sessionId: `sess_fake_${String(this.#count)}`,
      outcome: { idle: true, timedOut: false, assistantText: JSON.stringify(this.candidate), messages: [] },
    };
  }

  async abortSession(): Promise<void> {
    return;
  }

  async findSessions(): Promise<readonly never[]> {
    return [];
  }
}

interface Fixture {
  readonly store: Store;
  readonly engine: Engine;
  readonly opencode: FakeOpenCode;
  readonly taskId: string;
  readonly planId: string;
  readonly close: () => void;
}

function node(id: string, title: string, groupId: string, acceptance: readonly string[] = []): PlanNode {
  return {
    id,
    key: id,
    title,
    kind: 'implementation',
    groupId,
    summary: `${title}（测试步骤）`,
    inputs: [],
    outputs: [],
    acceptance,
    resources: { read: [], write: [] },
  };
}

function overviewGraph(): PlanGraph {
  return {
    nodes: [
      node('g1.a1', '积分账户', 'group.g1'),
      node('g1.a2', '积分流水', 'group.g1'),
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

function scopedCandidate(groupRef: string, groupTitle: string, prefix: string, count: number): PlanningCandidatePayload {
  return {
    summary: `细化分组 ${groupTitle}`,
    groups: [{ id: groupRef, label: groupTitle, kind: 'implementation', refined: true }],
    nodes: Array.from({ length: count }, (_, index) => ({
      key: `${prefix}.${String(index + 1)}`,
      title: `${groupTitle}步骤 ${String(index + 1)}`,
      kind: 'implementation',
      groupId: groupRef,
      summary: `${groupTitle}细化步骤`,
    })),
    edges: Array.from({ length: Math.max(0, count - 1) }, (_, index) => ({
      fromKey: `${prefix}.${String(index + 1)}`,
      toKey: `${prefix}.${String(index + 2)}`,
      kind: 'order' as const,
    })),
  };
}

function createFixture(options: { readonly seedOverview: boolean }): Fixture {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-pe37-data-'));
  const store = new Store({ dataDir });
  const opencode = new FakeOpenCode();
  const ports = { git: {} as EnginePorts['git'], opencode } satisfies EnginePorts;
  const engine = new Engine({ store, ports, integration: { opencodeReady: () => true, gitlabConfigured: () => false } });
  const project = store.projects.create({ name: 'PE37', rootPath: createRepo(), gitState: 'not_git' });
  const task = store.tasks.create({
    projectId: project.id,
    title: '会员积分体系重构',
    requirementText: 'R1 积分账户\nR2 消耗规则\nR3 数据迁移',
    methodId: 'method.requirement-development',
    methodRevision: 'r12',
  });
  let planId = '';
  if (options.seedOverview) {
    const plan = store.plans.create({ taskId: task.id, source: 'applied', graph: overviewGraph(), status: 'unconfirmed' });
    store.tasks.update(task.id, { currentPlanRevisionId: plan.id, stage: 'planning' });
    planId = plan.id;
  }
  return {
    store,
    engine,
    opencode,
    taskId: task.id,
    planId,
    close: () => store.close(),
  };
}

async function waitForRound(store: Store, taskId: string, predicate: (round: PlanningRound) => boolean): Promise<PlanningRound> {
  const started = Date.now();
  for (;;) {
    const round = store.planning.latest(taskId);
    if (round !== undefined && predicate(round)) return round;
    if (Date.now() - started > 5_000) throw new Error(`planning round timeout; last=${round?.status ?? 'missing'}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function planNodesById(plan: { graph: PlanGraph }): Map<string, PlanNode> {
  return new Map(plan.graph.nodes.map((item) => [item.id, item]));
}

test('PE37: scoped preview/start/apply doubles as the confirm gate, and whole-plan planning stays intact', async () => {
  const fixture = createFixture({ seedOverview: true });
  try {
    const { engine, store, opencode, taskId, planId } = fixture;
    const proposal = engine.planning.proposal(taskId);
    assert.equal(proposal.planRevisionId, planId);
    assert.equal(proposal.groups.length, 3);
    assert.equal(proposal.groups.find((group) => group.groupRef === 'group.g1')?.state, 'refined');
    assert.equal(proposal.groups.find((group) => group.groupRef === 'group.g1')?.leafCount, 2);
    assert.equal(proposal.groups.find((group) => group.groupRef === 'group.g2')?.state, 'unrefined');
    assert.deepEqual(proposal.unresolvedScopes.map((scope) => scope.groupRef), ['group.g2', 'group.g3']);

    // Scope preview is read-only and never calls the model.
    const preview = engine.planning.refinePreview(taskId, 'group.g2');
    assert.equal(preview.round, 1);
    assert.equal(preview.groupRef, 'group.g2');
    assert.equal(preview.scope.basePlanRevisionId, planId);
    assert.equal(preview.scope.placeholderNodeIds.length, 1);
    assert.equal(opencode.requests.length, 0);
    assert.equal(preview.budget.dispatches > 0, true);

    // Start the scoped round (new round, only this group).
    opencode.candidate = scopedCandidate('group.g2', '消耗与抵扣', 'g2.n', 2);
    const startKey = `req_pe37_start_${Math.random().toString(36).slice(2, 10)}`;
    const start = engine.planning.start(taskId, {
      requestKey: startKey,
      previewId: preview.previewRef,
      sourceInputRevision: store.tasks.get(taskId)!.requirement.revision,
      confirmModelDispatch: true,
      scope: { groupRef: 'group.g2' },
    });
    // planning.start settles only after the round reaches a candidate/failure.
    assert.ok(['accepted', 'succeeded'].includes(start.receipt.status), JSON.stringify(start.receipt));
    const scopedRound = await waitForRound(store, taskId, (round) => round.status === 'completed' && round.candidate !== undefined);
    assert.equal(store.operations.get(startKey)?.status, 'succeeded', 'start receipt settles with the scoped candidate');
    assert.equal(scopedRound.ordinal, 1);
    const roundScope = store.settings.getJson<{ groupRef: string }>(`${PLANNING_ROUND_SCOPE_KEY}${scopedRound.id}`);
    assert.equal(roundScope?.groupRef, 'group.g2');
    assert.equal(opencode.requests.length, 1);
    assert.match(opencode.requests[0]!.prompt, /本轮范围（PE37 分组细化）/);
    assert.match(opencode.requests[0]!.prompt, /消耗与抵扣/);

    const candidatePlanId = scopedRound.candidate!.planRevisionId;
    const candidateScope = store.settings.getJson<{ groupRef: string }>(`${PLANNING_CANDIDATE_SCOPE_KEY}${candidatePlanId}`);
    assert.equal(candidateScope?.groupRef, 'group.g2');
    const refinedMap = store.settings.getJson<Record<string, number>>(`${PLANNING_GROUP_REFINED_KEY}${candidatePlanId}`);
    assert.equal(refinedMap?.['group.g2'], 1);

    // Merged candidate: only g2 changed; other groups keep their node ids; the
    // overview cross-group wiring is rewired onto the new group entry/exit.
    const candidatePlan = store.plans.get(candidatePlanId)!;
    assert.equal(candidatePlan.revisionNumber, 2, 'scoped candidate is the next draft revision');
    const basePlan = store.plans.get(planId)!;
    const candidateNodes = planNodesById(candidatePlan);
    const baseNodes = planNodesById(basePlan);
    for (const key of ['g1.a1', 'g1.a2', 'placeholder.group.g3']) {
      const baseNode = [...baseNodes.values()].find((item) => item.key === key)!;
      const mergedNode = [...candidateNodes.values()].find((item) => item.key === key)!;
      assert.equal(mergedNode.id, baseNode.id, `other groups keep node ids (${key})`);
    }
    for (const key of ['g1.a1', 'g1.a2', 'placeholder.group.g3']) {
      assert.ok([...candidateNodes.values()].some((item) => item.key === key), `${key} must still exist`);
    }
    const g1a2 = [...candidateNodes.values()].find((item) => item.key === 'g1.a2')!;
    const g2n1 = [...candidateNodes.values()].find((item) => item.key === 'g2.n.1')!;
    const g2n2 = [...candidateNodes.values()].find((item) => item.key === 'g2.n.2')!;
    const g3Placeholder = [...candidateNodes.values()].find((item) => item.key === 'placeholder.group.g3')!;
    assert.ok(candidatePlan.graph.edges.some((edge) => edge.from === g1a2.id && edge.to === g2n1.id), 'incoming cross-group edge rewired to g2 entry');
    assert.ok(candidatePlan.graph.edges.some((edge) => edge.from === g2n2.id && edge.to === g3Placeholder.id), 'outgoing cross-group edge rewired from g2 exit');
    assert.equal(candidatePlan.graph.groups.find((group) => group.id === 'group.g2')?.refined, true);

    // Apply one group: writes an unconfirmed draft revision (+1) without executing.
    const apply = engine.planning.apply(taskId, {
      requestKey: `req_pe37_apply_${Math.random().toString(36).slice(2, 10)}`,
      roundId: scopedRound.id,
      candidatePlanRevisionId: candidatePlanId,
      acceptedDecisionIds: [],
      confirmApply: true,
    });
    assert.equal(apply.receipt.status, 'succeeded');
    assert.equal(apply.receipt.outcome?.['groupRef'], 'group.g2');
    const afterFirstApply = store.tasks.get(taskId)!;
    assert.equal(afterFirstApply.currentPlanRevisionId, candidatePlanId);
    assert.equal(afterFirstApply.stage, 'planning', 'more groups are unrefined, so the task stays in planning');
    const afterApplyPlan = store.plans.get(candidatePlanId)!;
    assert.equal(afterApplyPlan.status, 'unconfirmed');
    const proposalAfterFirst = engine.planning.proposal(taskId);
    assert.equal(proposalAfterFirst.groups.find((group) => group.groupRef === 'group.g2')?.state, 'refined');
    assert.equal(proposalAfterFirst.groups.find((group) => group.groupRef === 'group.g2')?.refinedInRound, 1);
    assert.deepEqual(proposalAfterFirst.unresolvedScopes.map((scope) => scope.groupRef), ['group.g3']);

    // Confirm is blocked while a group is unrefined.
    assert.throws(
      () => engine.plans.confirm(taskId, {
        requestKey: `req_pe37_confirm_${Math.random().toString(36).slice(2, 10)}`,
        planRevisionId: candidatePlanId,
        expectedRevisionNumber: afterApplyPlan.revisionNumber,
        confirmPlan: true,
      }),
      (error: unknown) => {
        const candidate = error as { code?: string; details?: { code?: string; groups?: string[]; unresolvedScopes?: string[] } };
        assert.equal(candidate.code, 'PLAN_REVISION_CONFLICT');
        assert.equal(candidate.details?.code, 'SCOPE_UNREFINED');
        assert.deepEqual(candidate.details?.unresolvedScopes, ['group.g3']);
        assert.deepEqual(candidate.details?.groups, ['数据迁移']);
        return true;
      },
    );

    // Refine the last group, apply, then confirm + prepare.
    const secondPreview = engine.planning.refinePreview(taskId, 'group.g3');
    assert.equal(secondPreview.round, 2, 'each scoped refine is a new round');
    opencode.candidate = scopedCandidate('group.g3', '数据迁移', 'g3.n', 1);
    engine.planning.start(taskId, {
      requestKey: `req_pe37_start2_${Math.random().toString(36).slice(2, 10)}`,
      previewId: secondPreview.previewRef,
      sourceInputRevision: store.tasks.get(taskId)!.requirement.revision,
      confirmModelDispatch: true,
      scope: { groupRef: 'group.g3' },
    });
    const secondRound = await waitForRound(store, taskId, (round) => round.ordinal === 2 && round.status === 'completed' && round.candidate !== undefined);
    const secondApply = engine.planning.apply(taskId, {
      requestKey: `req_pe37_apply2_${Math.random().toString(36).slice(2, 10)}`,
      roundId: secondRound.id,
      candidatePlanRevisionId: secondRound.candidate!.planRevisionId,
      acceptedDecisionIds: [],
      confirmApply: true,
    });
    assert.equal(secondApply.receipt.status, 'succeeded');
    const afterAll = store.tasks.get(taskId)!;
    assert.equal(afterAll.stage, 'confirming', 'all groups refined → confirmable');
    assert.deepEqual(engine.planning.proposal(taskId).unresolvedScopes, []);
    const finalPlan = store.plans.get(afterAll.currentPlanRevisionId!)!;
    assert.equal(finalPlan.revisionNumber, 3, 'each scoped apply adds one draft revision');
    assert.equal(finalPlan.graph.nodes.some((item) => item.key.startsWith('placeholder.')), false);
    assert.equal(finalPlan.graph.nodes.filter((item) => item.groupId === 'group.g1').length, 2);
    assert.equal(finalPlan.graph.nodes.filter((item) => item.groupId === 'group.g2').length, 2);
    assert.equal(finalPlan.graph.nodes.filter((item) => item.groupId === 'group.g3').length, 1);
    const confirm = engine.plans.confirm(taskId, {
      requestKey: `req_pe37_confirm2_${Math.random().toString(36).slice(2, 10)}`,
      planRevisionId: finalPlan.id,
      expectedRevisionNumber: finalPlan.revisionNumber,
      confirmPlan: true,
    });
    assert.equal(confirm.receipt.status, 'succeeded');
    assert.equal(store.tasks.get(taskId)?.stage, 'preparing');
  } finally {
    fixture.close();
  }
});

test('PE37: out-of-scope candidates return a structured SCOPE_VIOLATION and never become a plan revision', async () => {
  const fixture = createFixture({ seedOverview: true });
  try {
    const { engine, store, opencode, taskId } = fixture;
    const preview = engine.planning.refinePreview(taskId, 'group.g2');
    let release: (() => void) | undefined;
    opencode.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    opencode.candidate = scopedCandidate('group.g2', '消耗与抵扣', 'g2.n', 1);
    engine.planning.start(taskId, {
      requestKey: `req_pe37_scope_${Math.random().toString(36).slice(2, 10)}`,
      previewId: preview.previewRef,
      sourceInputRevision: store.tasks.get(taskId)!.requirement.revision,
      confirmModelDispatch: true,
      scope: { groupRef: 'group.g2' },
    });
    const running = await waitForRound(store, taskId, (round) => round.status === 'running');
    const plansBefore = store.plans.list(taskId).length;
    assert.equal(engine.planning.proposal(taskId).groups.find((group) => group.groupRef === 'group.g2')?.state, 'planning', 'in-flight scoped round reports planning');

    const outOfScope: PlanningCandidatePayload = {
      summary: '越界候选',
      groups: [
        { id: 'group.g2', label: '消耗与抵扣', kind: 'implementation', refined: true },
        { id: 'group.g3', label: '数据迁移', kind: 'implementation', refined: true },
      ],
      nodes: [
        { key: 'g2.n1', title: '组内步骤', kind: 'implementation', groupId: 'group.g2', summary: '' },
        { key: 'g3.sneaky', title: '组外步骤', kind: 'implementation', groupId: 'group.g3', summary: '' },
      ],
      edges: [{ fromKey: 'g3.sneaky', toKey: 'g2.n1', kind: 'order' }],
    };
    const result = engine.planning.submitCandidate({ taskId, roundId: running.id, candidate: outOfScope });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((problem) => (problem as { code?: string }).code === 'SCOPE_VIOLATION'), JSON.stringify(result.problems));
    assert.equal(store.plans.list(taskId).length, plansBefore, 'violating candidate must not create a plan revision');
    assert.equal(store.planning.get(running.id)?.candidate, undefined);
    release?.();
    await waitForRound(store, taskId, (round) => round.status === 'failed' || round.status === 'completed');
    // The valid candidate from the fake session still completes the round; the
    // proposal then shows the group as a candidate awaiting apply.
    const latest = store.planning.latest(taskId)!;
    assert.equal(latest.status, 'completed');
    assert.equal(engine.planning.proposal(taskId).groups.find((group) => group.groupRef === 'group.g2')?.state, 'candidate');
    // Refined groups cannot be previewed again; a stale scope base is rejected.
    assert.throws(() => engine.planning.refinePreview(taskId, 'group.g1'), (error: unknown) => (error as { code?: string }).code === 'VALIDATION_FAILED');
  } finally {
    fixture.close();
  }
});

test('PE37: whole-plan planning (no scope) still applies and confirms unchanged', async () => {
  const fixture = createFixture({ seedOverview: false });
  try {
    const { engine, store, opencode, taskId } = fixture;
    const method = findMethod(DEFAULT_CATALOG, 'method.requirement-development')!;
    const groupIds = new Map<string, string>();
    method.requiredSteps.forEach((step, index) => {
      if (!groupIds.has(step.group)) groupIds.set(step.group, `group.${String(index)}`);
    });
    const fullCandidate: PlanningCandidatePayload = {
      summary: '整份需求计划',
      groups: [...groupIds.entries()].map(([label, id]) => ({ id, label, kind: 'implementation' as const, refined: true })),
      nodes: method.requiredSteps.map((step) => ({
        key: step.key,
        title: step.title,
        kind: step.kind,
        groupId: groupIds.get(step.group)!,
        summary: step.title,
      })),
      edges: method.requiredSteps.slice(1).map((step, index) => ({ fromKey: method.requiredSteps[index]!.key, toKey: step.key, kind: 'order' as const })),
    };
    const preview = engine.planning.preview(taskId);
    assert.equal(preview.blockers.length, 0, JSON.stringify(preview.blockers));
    opencode.candidate = fullCandidate;
    engine.planning.start(taskId, {
      requestKey: `req_pe37_full_${Math.random().toString(36).slice(2, 10)}`,
      previewId: preview.previewId,
      sourceInputRevision: store.tasks.get(taskId)!.requirement.revision,
      confirmModelDispatch: true,
    });
    const round = await waitForRound(store, taskId, (item) => item.status === 'completed' && item.candidate !== undefined);
    engine.planning.apply(taskId, {
      requestKey: `req_pe37_full_apply_${Math.random().toString(36).slice(2, 10)}`,
      roundId: round.id,
      candidatePlanRevisionId: round.candidate!.planRevisionId,
      acceptedDecisionIds: [],
      confirmApply: true,
    });
    const applied = store.tasks.get(taskId)!;
    assert.equal(applied.stage, 'confirming');
    const plan = store.plans.get(applied.currentPlanRevisionId!)!;
    assert.equal(engine.planning.proposal(taskId).unresolvedScopes.length, 0);
    const confirm = engine.plans.confirm(taskId, {
      requestKey: `req_pe37_full_confirm_${Math.random().toString(36).slice(2, 10)}`,
      planRevisionId: plan.id,
      expectedRevisionNumber: plan.revisionNumber,
      confirmPlan: true,
    });
    assert.equal(confirm.receipt.status, 'succeeded');
    assert.equal(store.tasks.get(taskId)?.stage, 'preparing');
  } finally {
    fixture.close();
  }
});
