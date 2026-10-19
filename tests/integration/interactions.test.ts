import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, type InteractionDetail, type InteractionListResponse, type PlanningQuestion, type PlanningRound } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/index.ts';

type App = Awaited<ReturnType<typeof createApplication>>;

function requestKey(prefix: string): string {
  return `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;
}

function createRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'aw-inbox-repo-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# inbox\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  return root;
}

async function createTask(app: App, title: string): Promise<string> {
  const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: requestKey('prj'), name: 'Inbox Project', rootPath: createRepo() } });
  assert.equal(project.statusCode, 201, project.body);
  const projectId = project.json().data.resource.project.id as string;
  const task = await app.app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: { requestKey: requestKey('task'), projectId, title, requirementText: `R1 ${title}`, methodId: 'method.requirement-development' },
  });
  assert.equal(task.statusCode, 201, task.body);
  return task.json().data.resource.task.id as string;
}

const VALIDATION: PlanningRound['candidate'] extends undefined ? never : NonNullable<PlanningRound['candidate']>['validation'] = {
  structural: { state: 'passed', problems: [] },
  humanReview: { required: 1, accepted: 0, items: [] },
  basis: { state: 'complete', detail: '全部输入可读' },
  readiness: { state: 'ready', detail: '可确认' },
  checks: [],
  requirementCoverage: [],
};

function createRound(app: App, taskId: string, patch: { readonly stage: PlanningRound['stage']; readonly status?: PlanningRound['status']; readonly questions?: readonly PlanningQuestion[]; readonly candidate?: PlanningRound['candidate']; readonly reconcile?: PlanningRound['reconcile'] }): PlanningRound {
  const round = app.store.planning.create({
    taskId,
    ordinal: 1,
    inputRevision: 1,
    method: { id: 'method.requirement-development', revision: 'v1', name: '需求开发' },
    strategy: { id: 'planning.requirement-development', version: 'v1' },
    model: DEFAULT_SETTINGS.models[0]!,
    usage: {
      dispatches: { used: 1, maximum: 3 },
      revisions: { used: 0, maximum: 1 },
      budget: { known: 0, reserved: 0, unknown: 0, currency: 'CNY', limit: 10 },
    },
  });
  const updated = app.store.planning.update(round.id, {
    stage: patch.stage,
    status: patch.status ?? 'completed',
    ...(patch.questions === undefined ? {} : { questions: patch.questions }),
    ...(patch.candidate === undefined ? {} : { candidate: patch.candidate }),
    ...(patch.reconcile === undefined ? {} : { reconcile: patch.reconcile }),
    lastActivity: '测试夹具',
  });
  assert.ok(updated !== undefined);
  app.store.tasks.update(taskId, { currentPlanningRoundId: round.id });
  return updated;
}

function question(id: string, text: string, required: boolean): PlanningQuestion {
  return { id, question: text, affectedNodeIds: ['node_need'], required };
}

interface Seeded {
  readonly app: App;
  readonly questionTaskId: string;
  readonly questionInteractionId: string;
  readonly reviewInteractionId: string;
  readonly unknownInteractionId: string;
}

async function seed(): Promise<Seeded> {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-inbox-')), disableOpenCode: true, disableListen: true });

  const questionTaskId = await createTask(app, '需要答复的任务');
  const questionRound = createRound(app, questionTaskId, {
    stage: 'needs_answer',
    questions: [question('q1', '退款审批是否支持批量？', true), question('q2', '导出字段是否需要包含备注？', false)],
  });

  const reviewTaskId = await createTask(app, '候选待审阅的任务');
  createRound(app, reviewTaskId, {
    stage: 'awaiting_review',
    candidate: {
      planRevisionId: 'plan_candidate_1',
      summary: '候选计划：分页查询 + 导出',
      diff: [],
      validation: VALIDATION,
    },
  });

  const unknownTaskId = await createTask(app, '结果待核对的任务');
  createRound(app, unknownTaskId, {
    stage: 'generating',
    status: 'unknown',
    reconcile: { state: 'still_unknown' },
  });

  return {
    app,
    questionTaskId,
    questionInteractionId: `int_planning_${questionRound.id}`,
    reviewInteractionId: itemsByKind(await listInteractions(app), 'planning_review')[0]!.id,
    unknownInteractionId: itemsByKind(await listInteractions(app), 'planning_reconcile')[0]!.id,
  };
}

async function listInteractions(app: App): Promise<InteractionListResponse> {
  const response = await app.app.inject({ method: 'GET', url: '/api/interactions' });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().data as InteractionListResponse;
}

function itemsByKind(list: InteractionListResponse, kind: 'planning_question' | 'planning_review' | 'planning_reconcile') {
  return list.items.filter((item) => item.kind === kind);
}

async function detailOf(app: App, id: string): Promise<InteractionDetail> {
  const response = await app.app.inject({ method: 'GET', url: `/api/interactions/${encodeURIComponent(id)}` });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().data as InteractionDetail;
}

test('W3-2: interactions list derives real planning items and honestly reports missing permission/policy sources', async () => {
  const { app, questionTaskId, reviewInteractionId, unknownInteractionId } = await seed();
  try {
    const list = await listInteractions(app);
    assert.equal(list.capabilities.planningQuestions, true);
    assert.equal(list.capabilities.planningReview, true);
    assert.equal(list.capabilities.permissions, false);
    assert.equal(list.capabilities.policy, false);
    assert.match(String(list.capabilities.reason), /没有权限\/策略请求来源/);
    assert.equal(list.counts.open, 2);
    assert.equal(list.counts.unknown, 1);

    const questions = itemsByKind(list, 'planning_question');
    assert.equal(questions.length, 1);
    const item = questions[0]!;
    assert.equal(item.state, 'open');
    assert.equal(item.taskId, questionTaskId);
    assert.equal(item.stepName, '规划轮次 1');
    assert.equal(item.returnTo, `/requirement/${questionTaskId}`);
    assert.match(item.summary, /1 个必答问题/);
    assert.equal(typeof item.createdAt, 'string');

    const review = itemsByKind(list, 'planning_review')[0]!;
    assert.equal(review.state, 'open');
    assert.match(review.summary, /候选计划/);
    assert.equal(reviewInteractionId, review.id);

    const unknown = itemsByKind(list, 'planning_reconcile')[0]!;
    assert.equal(unknown.state, 'unknown');
    assert.equal(unknownInteractionId, unknown.id);
  } finally {
    await app.close();
  }
});

test('W3-2: interaction detail exposes real questions (free text) and read-only reasons for review/unknown items', async () => {
  const { app, questionInteractionId, reviewInteractionId, unknownInteractionId } = await seed();
  try {
    const questionDetail = await detailOf(app, questionInteractionId);
    assert.equal(questionDetail.kind, 'planning_question');
    assert.equal(questionDetail.source.type, 'planning_round');
    assert.deepEqual(questionDetail.source.nodeIds, ['node_need']);
    assert.equal(questionDetail.questions.length, 2);
    assert.deepEqual(questionDetail.questions.map((entry) => [entry.id, entry.required, entry.answered, entry.inputMode]), [
      ['q1', true, false, 'free_text'],
      ['q2', false, false, 'free_text'],
    ]);
    assert.equal(questionDetail.resolve.allowed, true);
    assert.equal(questionDetail.resolve.confirmField, 'confirmResolve');
    assert.equal(questionDetail.degradation.options, false);
    assert.equal(questionDetail.degradation.multiSelect, false);
    assert.match(questionDetail.degradation.reason, /单答案文本/);
    assert.match(questionDetail.degradation.reason, /拒绝回答/);
    assert.equal(questionDetail.candidate, undefined);
    assert.equal(typeof questionDetail.requirementRevision, 'number');

    const reviewDetail = await detailOf(app, reviewInteractionId);
    assert.equal(reviewDetail.kind, 'planning_review');
    assert.equal(reviewDetail.source.type, 'planning_candidate');
    assert.equal(reviewDetail.source.planRevisionId, 'plan_candidate_1');
    assert.deepEqual(reviewDetail.questions, []);
    assert.equal(reviewDetail.candidate?.summary, '候选计划：分页查询 + 导出');
    assert.equal(reviewDetail.candidate?.validationState, 'passed');
    assert.equal(reviewDetail.resolve.allowed, false);
    assert.equal(reviewDetail.resolve.reasonCode, 'INTERACTION_READ_ONLY');
    assert.match(String(reviewDetail.resolve.reason), /需求画布/);

    const unknownDetail = await detailOf(app, unknownInteractionId);
    assert.equal(unknownDetail.kind, 'planning_reconcile');
    assert.equal(unknownDetail.state, 'unknown');
    assert.equal(unknownDetail.resolve.allowed, false);
    assert.match(String(unknownDetail.unknown?.message), /原请求号核对/);

    for (const id of ['int_planning_missing', 'not-an-interaction', 'int_review_missing']) {
      const response = await app.app.inject({ method: 'GET', url: `/api/interactions/${encodeURIComponent(id)}` });
      assert.equal(response.statusCode, 404, `${id}: ${response.body}`);
      assert.equal(response.json().error.code, 'NOT_FOUND');
    }
  } finally {
    await app.close();
  }
});

test('W3-2: resolve saves real requirement revisions, is idempotent and validates answers strictly', async () => {
  const { app, questionTaskId, questionInteractionId, reviewInteractionId, unknownInteractionId } = await seed();
  try {
    const url = `/api/interactions/${encodeURIComponent(questionInteractionId)}/resolve`;
    const missingKey = await app.app.inject({ method: 'POST', url, payload: { answers: [{ questionId: 'q1', other: '支持' }], confirmResolve: true } });
    assert.equal(missingKey.statusCode, 400, missingKey.body);
    assert.equal(missingKey.json().error.code, 'VALIDATION_FAILED');
    const missingConfirm = await app.app.inject({ method: 'POST', url, payload: { requestKey: requestKey('resolve'), answers: [{ questionId: 'q1', other: '支持' }] } });
    assert.equal(missingConfirm.statusCode, 400, missingConfirm.body);
    const unknownQuestion = await app.app.inject({ method: 'POST', url, payload: { requestKey: requestKey('resolve'), answers: [{ questionId: 'q_missing', other: '支持' }], confirmResolve: true } });
    assert.equal(unknownQuestion.statusCode, 400, unknownQuestion.body);
    assert.equal(unknownQuestion.json().error.code, 'VALIDATION_FAILED');
    const emptyAnswer = await app.app.inject({ method: 'POST', url, payload: { requestKey: requestKey('resolve'), answers: [{ questionId: 'q1', values: ['  '] }], confirmResolve: true } });
    assert.equal(emptyAnswer.statusCode, 400, emptyAnswer.body);
    assert.match(String(emptyAnswer.json().error.message), /不能为空/);
    const requiredMissing = await app.app.inject({ method: 'POST', url, payload: { requestKey: requestKey('resolve'), answers: [{ questionId: 'q2', other: '需要' }], confirmResolve: true } });
    assert.equal(requiredMissing.statusCode, 400, requiredMissing.body);
    assert.deepEqual(requiredMissing.json().error.details.unansweredQuestionIds, ['q1']);
    const duplicate = await app.app.inject({
      method: 'POST',
      url,
      payload: { requestKey: requestKey('resolve'), answers: [{ questionId: 'q1', other: 'A' }, { questionId: 'q1', other: 'B' }], confirmResolve: true },
    });
    assert.equal(duplicate.statusCode, 400, duplicate.body);

    const key = requestKey('resolve');
    const payload = { requestKey: key, answers: [{ questionId: 'q1', values: ['支持批量', '按审批流'], other: '超过 100 条需主管复核' }], confirmResolve: true };
    const resolved = await app.app.inject({ method: 'POST', url, payload });
    assert.equal(resolved.statusCode, 200, resolved.body);
    const data = resolved.json().data as {
      receipt: { requestKey: string; status: string; operation: string; outcome?: { requirementRevision?: number } };
      resource: { interaction: InteractionDetail; planning: { rounds: readonly PlanningRound[] }; requirementRevision: number };
    };
    assert.equal(data.receipt.requestKey, key);
    assert.equal(data.receipt.status, 'succeeded');
    assert.equal(data.receipt.operation, 'requirement.answer.save');
    assert.equal(data.resource.interaction.state, 'resolved');
    assert.equal(data.resource.interaction.questions.find((entry) => entry.id === 'q1')?.answered, true);
    assert.equal(data.resource.interaction.questions.find((entry) => entry.id === 'q1')?.answer, '支持批量；按审批流；超过 100 条需主管复核');
    assert.equal(data.resource.interaction.questions.find((entry) => entry.id === 'q2')?.answered, false);
    assert.equal(typeof data.resource.interaction.resolvedAt, 'string');
    assert.equal(typeof data.resource.requirementRevision, 'number');

    // The requirement canvas reads exactly the same stored answers.
    const canvas = await app.app.inject({ method: 'GET', url: `/api/tasks/${questionTaskId}/planning` });
    assert.equal(canvas.statusCode, 200, canvas.body);
    const storedQuestion = (canvas.json().data.planning.rounds as readonly PlanningRound[])[0]!.questions.find((entry) => entry.id === 'q1')!;
    assert.equal(storedQuestion.answer, '支持批量；按审批流；超过 100 条需主管复核');
    assert.equal(storedQuestion.answeredBy, 'user');
    assert.equal(typeof storedQuestion.answeredAt, 'string');
    const taskAfter = app.store.tasks.get(questionTaskId)!;
    assert.equal(taskAfter.requirement.revision, data.resource.requirementRevision);
    assert.ok(taskAfter.requirement.supplements.some((supplement) => supplement.text.includes('支持批量；按审批流；超过 100 条需主管复核')));

    // The list no longer shows this item (it is resolved) but detail keeps the fact.
    const listAfter = await listInteractions(app);
    assert.equal(itemsByKind(listAfter, 'planning_question').length, 0);
    assert.equal((await detailOf(app, questionInteractionId)).state, 'resolved');

    // Same key/body replays the stored receipt; different body conflicts.
    const replay = await app.app.inject({ method: 'POST', url, payload });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().data.receipt.requestKey, key);
    const conflict = await app.app.inject({ method: 'POST', url, payload: { ...payload, answers: [{ questionId: 'q1', other: '不同答复' }] } });
    assert.equal(conflict.statusCode, 409, conflict.body);
    assert.equal(conflict.json().error.code, 'REQUEST_KEY_REUSED');
    const freshKey = await app.app.inject({ method: 'POST', url, payload: { requestKey: requestKey('resolve-again'), answers: [{ questionId: 'q1', other: '再答一次' }], confirmResolve: true } });
    assert.equal(freshKey.statusCode, 409, freshKey.body);
    assert.equal(freshKey.json().error.code, 'OPERATION_IN_PROGRESS');

    // Review / unknown interactions are read-only and cannot be resolved here.
    const reviewResolve = await app.app.inject({ method: 'POST', url: `/api/interactions/${encodeURIComponent(reviewInteractionId)}/resolve`, payload: { requestKey: requestKey('review'), answers: [{ questionId: 'q1', other: 'x' }], confirmResolve: true } });
    assert.equal(reviewResolve.statusCode, 409, reviewResolve.body);
    assert.match(String(reviewResolve.json().error.message), /需求画布/);
    const unknownResolve = await app.app.inject({ method: 'POST', url: `/api/interactions/${encodeURIComponent(unknownInteractionId)}/resolve`, payload: { requestKey: requestKey('unknown'), answers: [{ questionId: 'q1', other: 'x' }], confirmResolve: true } });
    assert.equal(unknownResolve.statusCode, 409, unknownResolve.body);
    assert.match(String(unknownResolve.json().error.message), /原请求号/);
    const missing = await app.app.inject({ method: 'POST', url: '/api/interactions/int_planning_missing/resolve', payload: { requestKey: requestKey('missing'), answers: [{ questionId: 'q1', other: 'x' }], confirmResolve: true } });
    assert.equal(missing.statusCode, 404, missing.body);
  } finally {
    await app.close();
  }
});


test('choice questions preserve model options, validate exact selections and replay original answers without another requirement revision', async () => {
  const { app, questionTaskId, questionInteractionId } = await seed();
  try {
    const round = app.store.planning.get(app.store.tasks.get(questionTaskId)!.currentPlanningRoundId!)!;
    const options = [{ id: 'a', label: '按创建时间', description: '保留创建时间口径', recommended: true }, { id: 'b', label: '按更新时间' }];
    app.store.planning.update(round.id, { questions: [{ ...question('q1', '日期口径', true), options, multiple: false, allowOther: false }] });
    app.engine.planning.appendQuestion({ taskId: questionTaskId, roundId: round.id, question: '导出字段', required: true, options: [{ id: 'id', label: '订单编号', recommended: true }, { id: 'note', label: '备注', recommended: true }], multiple: true, allowOther: true });
    const detail = await detailOf(app, questionInteractionId);
    assert.deepEqual(detail.questions[0]!.options, options);
    assert.deepEqual(detail.questions.map((question) => question.inputMode), ['single_select', 'multi_select']);
    assert.equal(detail.degradation.recommendedValue, true);
    assert.equal(detail.questions[0]!.answer, undefined, 'a recommendation is never an implicit answer');
    const otherId = detail.questions[1]!.id;
    const url = `/api/interactions/${encodeURIComponent(questionInteractionId)}/resolve`;
    const revision = app.store.tasks.get(questionTaskId)!.requirement.revision;
    for (const invalid of [{ values: ['a', 'b'] }, { values: ['missing'] }, { values: ['a', 'a'] }, { values: [], other: '禁止自由改选项' }]) {
      const response = await app.app.inject({ method: 'POST', url, payload: { requestKey: requestKey('invalidchoice'), confirmResolve: true, answers: [{ questionId: 'q1', ...invalid }, { questionId: otherId, values: ['id'] }] } });
      assert.equal(response.statusCode, 400, response.body); assert.equal(app.store.tasks.get(questionTaskId)!.requirement.revision, revision);
    }
    const key = requestKey('choice');
    const payload = { requestKey: key, confirmResolve: true, answers: [{ questionId: 'q1', values: ['b'] }, { questionId: otherId, values: ['note', 'id'], other: '含审批状态' }] };
    const saved = await app.app.inject({ method: 'POST', url, payload }); assert.equal(saved.statusCode, 200, saved.body);
    const answers = app.store.planning.get(round.id)!.questions;
    assert.equal(answers[0]!.answer, '按更新时间'); assert.deepEqual(answers[0]!.values, ['b']);
    assert.deepEqual(answers[1]!.values, ['id', 'note']); assert.equal(answers[1]!.answer, '订单编号；备注；其他：含审批状态');
    assert.equal(app.store.tasks.get(questionTaskId)!.requirement.revision, revision + 1);
    for (const status of ['succeeded', 'accepted', 'unknown']) {
      app.store.db.prepare('UPDATE operations SET status = ? WHERE request_key = ?').run(status, key);
      const replay = await app.app.inject({ method: 'POST', url, payload });
      assert.equal(replay.statusCode, 200, replay.body); assert.equal(replay.json().data.receipt.status, status);
      assert.equal(app.store.tasks.get(questionTaskId)!.requirement.revision, revision + 1);
    }
    assert.throws(() => app.engine.planning.appendQuestion({ taskId: questionTaskId, roundId: round.id, question: '重复选项', required: true, options: [options[0]!, options[0]!] }), /选项格式/);
  } finally { await app.close(); }
});
