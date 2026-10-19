import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequestKey } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/application.ts';

/** Opt in: real configured OpenCode model, real worktree, generated tests and JUnit command. */
test('live: unit template writes tests, runs them and independently reviews exact source evidence', { skip: process.env.AGENT_WORKFLOW_LIVE !== '1', timeout: 900_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'aw-file-live-repo-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-file-live-data-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/add.mjs'), 'export function add(a, b) { return a + b; }\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'isolated-source-evidence', private: true, type: 'module', scripts: { test: 'node --test --test-reporter=junit test/add.test.mjs' } }));
  for (const argv of [['init', '-q', '-b', 'main'], ['config', 'user.name', 'Evidence Test'], ['config', 'user.email', 'evidence@example.invalid'], ['add', '.'], ['commit', '-qm', 'fixture']]) execFileSync('git', argv, { cwd: root });
  const app = await createApplication({ dataDir, port: 0, host: '127.0.0.1' });
  const post = async (url: string, body: object) => {
    const response = await app.app.inject({ method: 'POST', url, payload: { requestKey: createRequestKey(), ...body } });
    assert.ok(response.statusCode < 300, `${url}: ${response.body}`);
    const result = response.json().data;
    assert.notEqual(result.receipt?.status, 'failed', response.body);
    return result.resource;
  };
  try {
    assert.ok(app.adapter); await app.adapter.ensureReady();
    // Publish the exact local test argv in this isolated data directory before freezing the plan.
    const tester = app.engine.catalog.roles.find((role) => role.id === 'role.tester')!;
    await post('/api/catalog/roles', { roleId: tester.id, name: tester.name, purpose: tester.purpose, responsibilities: tester.responsibilities,
      instructions: tester.instructions, model: tester.model, capabilityGroups: tester.capabilityGroups,
      resourcePermissions: { ...tester.resourcePermissions, commands: [{ argv: ['npm', 'test'] }] }, confirmSave: true });
    await post(`/api/catalog/roles/${tester.id}/publish`, { confirmPublish: true });
    const project = (await post('/api/projects', { name: '真实逐文件单测验收', rootPath: root })).project;
    app.store.projects.update(project.id, { settings: { testCommand: 'npm test' } });
    const task = (await post('/api/tasks', { projectId: project.id, title: '为 add 编写并独立复核单元测试',
      requirementText: '只针对 src/add.mjs 的 add(a,b) 编写 test/add.test.mjs，使用 node:test 和 node:assert/strict，三个测试分别验证正数、负数和零。package.json 已配置 npm test 输出 JUnit。不要修改源文件和 package.json。每步使用受控MCP提交结果；编写步骤提交真实测试文件，测试步骤执行完整命令 npm test 并引用 testRunId，最后由独立会话复核源码和同版本测试产物，绑定实际通过报告。',
      methodId: 'method.unit-test-development', template: { templateId: 'template.unit-test-development', parameters: { targetPath: 'src/add.mjs', testPath: 'test/add.test.mjs', framework: 'node:test' }, scope: { branch: 'main', sourcePaths: ['src/add.mjs'] } } })).task;
    console.log('[file-live] identity', JSON.stringify({ dataDir, taskId: task.id, root, url: app.url }));
    const plan = (await post(`/api/tasks/${task.id}/plan/from-template`, { confirmUseTemplate: true })).plan;
    await post(`/api/tasks/${task.id}/plan/confirm`, { planRevisionId: plan.id, expectedRevisionNumber: plan.revisionNumber, confirmPlan: true });
    await post(`/api/tasks/${task.id}/workspace/prepare`, { expectedPlanRevisionNumber: plan.revisionNumber, expectedBaseRef: 'main', confirmPrepare: true });
    await post(`/api/tasks/${task.id}/execution/start`, { confirm: true });
    const deadline = Date.now() + 780_000; let last = '';
    while (Date.now() < deadline) {
      const latest = app.store.tasks.get(task.id)!; const execution = app.store.executions.get(latest.executionId!);
      const state = JSON.stringify({ status: execution?.status, nodes: execution?.nodes.map((node) => ({ id: node.nodeId, status: node.status })) });
      if (state !== last) { console.log('[file-live]', state); last = state; }
      if (execution && ['completed', 'failed', 'stopped', 'unknown'].includes(execution.status)) break;
      // Exercise the real, explicit node verdict API only after inspecting each real result.
      // This isolated test acts as the human reviewer; no production verdict is synthesized.
      if (execution?.status === 'paused') {
        for (const state of execution.nodes.filter((node) => node.status === 'succeeded')) {
          const detail = (await app.app.inject({ method: 'GET', url: `/api/tasks/${task.id}/nodes/${state.nodeId}` })).json().data;
          if (detail.acceptance?.state !== 'pending') continue;
          const result = detail.currentAttempt?.result;
          assert.ok(result?.summary?.length > 0, 'real result is required before fixture verdict');
          const stage = detail.node.sourceEvidence?.stage;
          if (stage === 'write' || stage === 'review') assert.equal(result.fileEvidence?.length, 1);
          if (stage === 'test') { assert.equal(result.testRun?.state, 'passed'); assert.equal(result.testRun?.passed, 3); }
          if (stage === 'review') assert.equal(result.fileEvidence[0].verdict, 'confirmed');
          await post(`/api/tasks/${task.id}/nodes/${state.nodeId}/accept`, { confirmAccept: true, note: '隔离 live 测试已核对该步骤真实结果与对应证据；只验收本步骤。' });
        }
        if (execution.nodes.some((node) => node.status === 'failed')) break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    const latest = app.store.tasks.get(task.id)!; const execution = app.store.executions.get(latest.executionId!)!;
    const attempts = app.store.executions.listAttempts(execution.id);
    console.log('[file-live] evidence', JSON.stringify(attempts.map((attempt) => ({ id: attempt.id, status: attempt.status, files: attempt.result?.fileEvidence, testRun: attempt.result?.testRun && { id: attempt.result.testRun.id, state: attempt.result.testRun.state, reason: attempt.result.testRun.reason, passed: attempt.result.testRun.passed, failed: attempt.result.testRun.failed, skipped: attempt.result.testRun.skipped } }))));
    assert.equal(execution.status, 'completed');
    const run = attempts.map((attempt) => attempt.result?.testRun).find((run) => run !== undefined)!;
    assert.equal(run.state, 'passed'); assert.equal(run.passed, 3); assert.equal(run.failed, 0);
    const writing = attempts.find((attempt) => attempt.result?.fileEvidence?.some((file) => file.stage === 'write'))!;
    const review = attempts.find((attempt) => attempt.result?.fileEvidence?.some((file) => file.stage === 'review'))!;
    assert.ok(writing && review);
    assert.equal(review.result!.fileEvidence![0]!.writerAttemptId, writing.id);
    assert.equal(review.result!.fileEvidence![0]!.verdict, 'confirmed');
    assert.equal(review.result!.fileEvidence![0]!.testRunId, run.id);
    assert.notEqual(app.store.settings.getJson<{ sessionId: string }>(`execution.session.${writing.id}`)?.sessionId, app.store.settings.getJson<{ sessionId: string }>(`execution.session.${review.id}`)?.sessionId);
  } finally { await app.close(); }
});
