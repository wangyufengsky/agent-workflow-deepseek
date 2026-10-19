import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../../packages/server/src/index.ts';

function requestKey(prefix: string): string {
  return `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;
}

function createRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'aw-skip-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# skip\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  return root;
}

test('skipping a node cancels it and all downstream nodes without touching unrelated branches', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-skip-data-'));
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: requestKey('prj'), name: 'Skip', rootPath: createRepo() } });
    const projectId = project.json().data.resource.project.id as string;
    const task = await app.app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { requestKey: requestKey('task'), projectId, title: 'Skip task', requirementText: 'R1', methodId: 'method.requirement-development' },
    });
    const taskId = task.json().data.resource.task.id as string;
    const skeleton = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/plan/skeleton`, payload: { requestKey: requestKey('skel'), confirmUseSkeleton: true } });
    const plan = skeleton.json().data.resource.plan as { id: string; graph: { nodes: { id: string }[]; edges: { from: string; to: string }[] } };
    const execution = app.store.executions.create({ taskId, planRevisionId: plan.id, graph: plan.graph as never, autoAdvance: false });
    app.store.tasks.update(taskId, { executionId: execution.id });
    app.store.executions.update(execution.id, { status: 'failed' });

    const root = plan.graph.nodes.find((node) => plan.graph.edges.some((edge) => edge.from === node.id) && plan.graph.edges.some((edge) => edge.to === node.id));
    assert.ok(root !== undefined, 'skeleton has a node with outgoing edges');
    const reachable = new Set<string>([root.id]);
    const queue = [root.id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of plan.graph.edges) {
        if (edge.from !== current || reachable.has(edge.to)) continue;
        reachable.add(edge.to);
        queue.push(edge.to);
      }
    }

    const skip = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/execution/nodes/${root.id}/skip`,
      payload: { requestKey: requestKey('skip'), nodeId: root.id, confirmSkip: true },
    });
    assert.equal(skip.statusCode, 200, skip.body);
    assert.equal(skip.json().data.receipt.status, 'succeeded');
    const after = app.store.executions.get(execution.id)!;
    for (const node of after.nodes) {
      if (reachable.has(node.nodeId)) assert.equal(node.status, 'cancelled', node.nodeId);
    }
    assert.ok(after.nodes.some((node) => !reachable.has(node.nodeId) && node.status !== 'cancelled'));
    assert.equal(app.store.operations.get(skip.json().data.receipt.requestKey)?.operation, 'execution.skipNode');
  } finally {
    await app.close();
  }
});
