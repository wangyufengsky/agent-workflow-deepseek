import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createId, createRequestKey, type PlanGraph } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/application.ts';

// Actual configured model and actual OpenCode native question event/reply; no synthetic sink events.
test('live: native question waits in the Inbox and resumes the exact execution session after answer', { skip: process.env.AGENT_WORKFLOW_LIVE !== '1', timeout: 600_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'aw-native-question-repo-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-native-question-data-'));
  writeFileSync(join(root, 'README.md'), '# Native question acceptance\n');
  for (const args of [['init', '-q', '-b', 'main'], ['config', 'user.name', 'Live Evidence'], ['config', 'user.email', 'live@example.invalid'], ['add', '.'], ['commit', '-qm', 'fixture']]) execFileSync('git', args, { cwd: root });
  const app = await createApplication({ dataDir, port: 0, host: '127.0.0.1' });
  const post = async (url: string, body: object) => {
    const response = await app.app.inject({ method: 'POST', url, payload: { requestKey: createRequestKey(), ...body } });
    assert.ok(response.statusCode < 300, response.body); return response.json().data;
  };
  try {
    await app.adapter!.ensureReady();
    const project = (await post('/api/projects', { name: '原生问题真实模型验收', rootPath: root })).resource.project;
    const task = (await post('/api/tasks', { projectId: project.id, title: '确认报告格式', requirementText: '必须先调用原生 question 工具，询问报告格式。选项必须为 Markdown 和 HTML，允许多选和其他文本。等待用户回答；得到回答后，使用 workflow.result.submit 提交结构化结果，summary 明确复述所选格式。只问一次，不写文件，不运行命令。', methodId: 'method.requirement-development' })).resource.task;
    const nodeId = createId('pn');
    const graph: PlanGraph = { nodes: [{ id: nodeId, key: 'native.question', title: '询问并复述报告格式', summary: task.requirement.text, kind: 'implementation', groupId: 'g1', inputs: [], outputs: [], acceptance: [], resources: { read: [], write: [] }, roleId: 'role.developer', position: { x: 80, y: 80 } }], edges: [], groups: [{ id: 'g1', label: '原生交互', kind: 'implementation', refined: true, collapsible: true, collapsedByDefault: false }] };
    const plan = app.store.plans.create({ taskId: task.id, source: 'skeleton', status: 'unconfirmed', graph });
    app.store.tasks.update(task.id, { currentPlanRevisionId: plan.id, stage: 'confirming' });
    await post(`/api/tasks/${task.id}/plan/confirm`, { planRevisionId: plan.id, expectedRevisionNumber: plan.revisionNumber, confirmPlan: true });
    await post(`/api/tasks/${task.id}/workspace/prepare`, { expectedPlanRevisionNumber: plan.revisionNumber, expectedBaseRef: 'main', confirmPrepare: true });
    await post(`/api/tasks/${task.id}/execution/start`, { confirm: true });
    console.log('[native-live] identity', JSON.stringify({ url: app.url, dataDir, taskId: task.id, nodeId }));
    const deadline = Date.now() + 480_000; let questionId: string | undefined; let answered = false;
    while (Date.now() < deadline) {
      const items = app.engine.runtimeInteractions.list().filter((item) => item.binding.taskId === task.id && item.kind === 'question');
      const question = items[0];
      if (question && !questionId) {
        questionId = question.id;
        console.log('[native-live] question', JSON.stringify(app.engine.runtimeInteractions.view(question)));
        assert.equal(question.binding.nodeId, nodeId);
        assert.equal(app.engine.inbox.list().some((item) => item.id === question.id && item.kind === 'runtime_question'), true);
      }
      if (question?.state === 'open' && !answered && process.env.AGENT_WORKFLOW_GUI_REVIEW !== '1') {
        const q = app.engine.runtimeInteractions.view(question).questions[0]!;
        const option = q.options?.find((option) => option.label === 'Markdown'); assert.ok(option);
        const result = await post(`/api/runtime-interactions/${question.id}/resolve`, { confirmResolve: true, action: 'answer', answers: [{ questionId: q.id, values: [option.id] }] });
        assert.equal(result.receipt.status, 'succeeded'); answered = true;
      }
      const execution = app.store.executions.get(app.store.tasks.get(task.id)!.executionId!)!;
      if (['completed', 'failed', 'stopped', 'unknown'].includes(execution.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    assert.ok(questionId, 'real native question event must be observed');
    const question = app.engine.runtimeInteractions.get(questionId);
    assert.equal(question.state, 'resolved');
    const execution = app.store.executions.get(app.store.tasks.get(task.id)!.executionId!)!;
    assert.equal(execution.status, 'completed');
    const attempt = app.store.executions.getAttempt(execution.nodes[0]!.currentAttemptId!)!;
    assert.match(attempt.result!.summary, /Markdown/);
    assert.equal(app.store.settings.getJson<{ sessionId: string }>(`execution.session.${attempt.id}`)?.sessionId, question.binding.sessionId);
    console.log('[native-live] completed', JSON.stringify({ taskId: task.id, interactionId: questionId, attemptId: attempt.id, summary: attempt.result!.summary }));
  } finally { await app.close(); }
});
