import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store.ts';

test('store persists projects, tasks, plans, rounds, workspaces, operations and secrets', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-store-'));
  const store = new Store({ dataDir });
  try {
    const project = store.projects.create({ name: 'P', rootPath: '/tmp/p', gitState: 'git', defaultBranch: 'main' });
    assert.equal(store.projects.list().length, 1);
    assert.equal(store.projects.get(project.id)?.name, 'P');

    const task = store.tasks.create({ projectId: project.id, title: 'T', requirementText: 'R1 需求', methodId: 'method.requirement-development', methodRevision: 'r12' });
    assert.equal(task.requirement.entries.length, 1);
    assert.equal(task.requirement.entries[0]?.id, 'R1');

    const plan = store.plans.create({ taskId: task.id, source: 'skeleton', graph: { nodes: [], edges: [], groups: [] }, status: 'unconfirmed' });
    assert.equal(plan.revisionNumber, 1);
    assert.equal(store.plans.latest(task.id)?.id, plan.id);
    store.plans.setStatus(plan.id, 'confirmed', { supersedeSiblingsForTaskId: task.id });
    assert.equal(store.plans.latestConfirmed(task.id)?.status, 'confirmed');

    const round = store.planning.create({
      taskId: task.id,
      ordinal: 1,
      inputRevision: 1,
      method: { id: 'm', revision: 'r1', name: '方法' },
      strategy: { id: 's', version: 'v1' },
      model: { id: 'model', label: 'M', provider: 'opencode-go', model: 'deepseek-v4-pro', roles: ['planner'], enabled: true },
      usage: { dispatches: { used: 0, maximum: 2 }, revisions: { used: 0, maximum: 1 }, budget: { known: 0, reserved: 0, unknown: 0, currency: 'USD' } },
    });
    const seq1 = store.planning.appendRecord(round.id, { fragmentId: 'f1', category: 'model_text', text: 'hello' });
    const seq2 = store.planning.appendRecord(round.id, { fragmentId: 'f2', category: 'tool_activity', text: 'tool' });
    assert.deepEqual([seq1, seq2], [1, 2]);
    assert.equal(store.planning.get(round.id)?.recordSeq.last, 2);
    store.planning.update(round.id, { status: 'completed', stage: 'awaiting_review' });
    assert.equal(store.planning.latest(task.id)?.status, 'completed');

    const workspace = store.workspaces.create({ taskId: task.id, kind: 'git_worktree', displayRoot: '/tmp/wt', branch: 'task/x', baseSha: 'a'.repeat(40) });
    store.workspaces.update(workspace.id, { state: 'ready' });
    assert.equal(store.workspaces.byTask(task.id)?.state, 'ready');

    const operation = store.operations.accept({ requestKey: 'req_abcdefghijklmnopqrst', operation: 'task.create', bodyHash: 'h1', contractVersion: '1', target: { taskId: task.id } });
    assert.equal(operation.status, 'accepted');
    store.operations.settle('req_abcdefghijklmnopqrst', 'succeeded', { outcome: { ok: true } });
    assert.equal(store.operations.get('req_abcdefghijklmnopqrst')?.status, 'succeeded');

    store.secrets.put('ref1', 'super-secret');
    assert.equal(store.secrets.get('ref1'), 'super-secret');
    assert.equal(store.secrets.has('missing'), false);

    store.events.publish('task.changed', { taskId: task.id, projectId: project.id, stage: 'planning', revision: 1 });
    const replay = store.events.replay(0);
    assert.equal(replay.length, 1);
    assert.equal(replay[0]?.type, 'task.changed');
    const journal = store.journal.read({ stream: 'events', fromSeq: 1 });
    assert.equal(journal.length, 1);
    assert.equal((journal[0]?.payload as { taskId: string }).taskId, task.id);
  } finally {
    store.close();
  }
});

test('store reopens existing data and migrations are idempotent', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-store-'));
  const first = new Store({ dataDir });
  first.projects.create({ name: 'Persisted', rootPath: '/tmp/x', gitState: 'not_git' });
  first.close();
  const second = new Store({ dataDir });
  try {
    assert.equal(second.projects.list().length, 1);
    assert.equal(second.projects.list()[0]?.name, 'Persisted');
  } finally {
    second.close();
  }
});
