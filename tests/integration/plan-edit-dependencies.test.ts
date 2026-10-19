import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createId } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/index.ts';

function requestKey(prefix: string): string {
  return `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;
}

function createRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'aw-planedit-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# plan edit\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  return root;
}

test('plan edit save applies prerequisite edges and rejects cycles', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-planedit-data-')), disableOpenCode: true, disableListen: true });
  try {
    const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: requestKey('prj'), name: 'PlanEdit', rootPath: createRepo() } });
    const projectId = project.json().data.resource.project.id as string;
    const task = await app.app.inject({ method: 'POST', url: '/api/tasks', payload: { requestKey: requestKey('task'), projectId, title: 'Plan Edit', requirementText: 'R1', methodId: 'method.requirement-development' } });
    const taskId = task.json().data.resource.task.id as string;
    const skeleton = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/plan/skeleton`, payload: { requestKey: requestKey('skel'), confirmUseSkeleton: true } });
    const plan = skeleton.json().data.resource.plan as { id: string; revisionNumber: number; graph: { nodes: { id: string }[]; edges: { from: string; to: string }[] } };
    assert.ok(plan.graph.nodes.length >= 3);
    const execution = app.store.executions.create({ taskId, planRevisionId: plan.id, graph: plan.graph as never, autoAdvance: false });
    app.store.executions.update(execution.id, {
      status: 'waiting_confirmation',
      editSession: { id: createId('es'), state: 'editing', requestKey: requestKey('es'), autoAdvanceBeforeEdit: true, lockedNodeIds: [], localChanges: [] },
    });
    app.store.tasks.update(taskId, { currentPlanRevisionId: plan.id, executionId: execution.id });

    const [first, second] = plan.graph.nodes;
    const save = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan/edit/save`,
      payload: {
        requestKey: requestKey('save'),
        editSessionId: execution.editSession?.id ?? '',
        changes: [{ nodeId: second!.id, prerequisites: [first!.id], acceptance: ['依赖已调整'] }],
        expectedPlanRevisionNumber: plan.revisionNumber,
      },
    });
    assert.equal(save.statusCode, 200, save.body);
    const nextPlan = save.json().data.resource.plan as { graph: { edges: { from: string; to: string }[] } };
    assert.ok(nextPlan.graph.edges.some((edge) => edge.from === first!.id && edge.to === second!.id));

    const cycle = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan/edit/save`,
      payload: {
        requestKey: requestKey('cycle'),
        editSessionId: execution.editSession?.id ?? '',
        changes: [
          { nodeId: first!.id, prerequisites: [second!.id] },
          { nodeId: second!.id, prerequisites: [first!.id] },
        ],
        expectedPlanRevisionNumber: plan.revisionNumber,
      },
    });
    assert.equal(cycle.statusCode, 400, cycle.body);
    assert.equal(cycle.json().error.code, 'VALIDATION_FAILED');
  } finally {
    await app.close();
  }
});
