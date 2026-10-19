import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureArtifacts, readArtifactBytes } from '../../packages/engine/src/artifacts.ts';
import { createApplication } from '../../packages/server/src/index.ts';
import { ROUTES, type PlanGraph } from '@agent-workflow/shared';

// Real filesystem and HTTP, deliberately offline; does not assert real-model acceptance.
test('artifact capture freezes bytes and refuses traversal, symlinks, permission and oversize inputs', () => {
  const root = mkdtempSync(join(tmpdir(), 'aw-artifacts-'));
  const workspace = join(root, 'workspace');
  mkdirSync(workspace);
  try {
    writeFileSync(join(workspace, 'result.md'), '原始结果');
    const [ref] = captureArtifacts(root, workspace, 'attempt-1', [{ path: 'result.md' }], () => true);
    writeFileSync(join(workspace, 'result.md'), '修改后');
    assert.equal(readArtifactBytes(root, ref!).toString(), '原始结果');
    assert.throws(() => captureArtifacts(root, workspace, 'attempt-1', [{ path: '../secret' }], () => true));
    assert.throws(() => captureArtifacts(root, workspace, 'attempt-1', [{ path: 'result.md' }], () => false));
    symlinkSync(join(workspace, 'result.md'), join(workspace, 'link.md'));
    assert.throws(() => captureArtifacts(root, workspace, 'attempt-1', [{ path: 'link.md' }], () => true));
    symlinkSync(workspace, join(workspace, 'linked-dir'));
    assert.throws(() => captureArtifacts(root, workspace, 'attempt-1', [{ path: 'linked-dir/result.md' }], () => true));
    writeFileSync(join(workspace, 'large'), Buffer.alloc(8 * 1024 * 1024 + 1));
    assert.throws(() => captureArtifacts(root, workspace, 'attempt-1', [{ path: 'large' }], () => true));
    writeFileSync(join(root, 'artifacts', `${ref!.id}.blob`), 'changed');
    assert.throws(() => readArtifactBytes(root, ref!), /校验失败/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('artifact HTTP binds task, attempt and version; serves immutable preview and original download bytes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aw-artifacts-http-'));
  const app = await createApplication({ dataDir: root, disableOpenCode: true, disableListen: true });
  try {
    const project = app.store.projects.create({ name: 'artifact', rootPath: root, gitState: 'not_git' });
    const createTask = () => app.store.tasks.create({ projectId: project.id, title: 'artifact', requirementText: 'verify', methodId: 'method.requirement-development', methodRevision: 'r12' });
    const task = createTask();
    const other = createTask();
    const graph: PlanGraph = { nodes: [{ id: 'n1', key: 'n1', title: 'report', kind: 'implementation', groupId: 'g', summary: '', inputs: [], outputs: [], acceptance: [], resources: { read: [], write: [] } }], edges: [], groups: [{ id: 'g', label: 'g', kind: 'implementation', refined: true, collapsible: false, collapsedByDefault: false }] };
    const plan = app.store.plans.create({ taskId: task.id, source: 'manual', graph, status: 'confirmed' });
    const execution = app.store.executions.create({ taskId: task.id, planRevisionId: plan.id, graph, autoAdvance: false });
    const attempt = app.store.executions.createAttempt({ executionId: execution.id, nodeId: 'n1', ordinal: 1 });
    writeFileSync(join(root, '报告.md'), '# 结果\n已验证');
    const [ref] = captureArtifacts(root, root, attempt.id, [{ path: '报告.md' }], () => true);
    app.store.executions.finishAttempt(attempt.id, 'succeeded', { resultRevision: 'r1', summary: 'report', artifacts: [ref!], errors: [], warnings: [] });
    const suffix = `?revision=${ref!.revision}&sha256=${ref!.sha256}`;
    const url = ROUTES.taskArtifact(task.id, attempt.id, ref!.id) + suffix;
    const preview = await app.app.inject({ method: 'GET', url });
    assert.equal(preview.statusCode, 200, preview.body);
    assert.equal(preview.json().data.preview, '# 结果\n已验证');
    const download = await app.app.inject({ method: 'GET', url: `${url}&download=1` });
    assert.equal(download.statusCode, 200);
    assert.equal(download.body, '# 结果\n已验证');
    assert.match(String(download.headers['content-disposition']), /^attachment;/);
    assert.equal((await app.app.inject({ method: 'GET', url: ROUTES.taskArtifact(other.id, attempt.id, ref!.id) + suffix })).statusCode, 404);
    assert.equal((await app.app.inject({ method: 'GET', url: ROUTES.taskArtifact(task.id, attempt.id, ref!.id) + '?revision=old&sha256=old' })).json().error.code, 'STALE_TARGET');
    writeFileSync(join(root, 'artifacts', `${ref!.id}.blob`), 'corrupt');
    const corrupt = await app.app.inject({ method: 'GET', url });
    assert.notEqual(corrupt.statusCode, 200);
    assert.equal(corrupt.json().error.code, 'READ_FAILED');
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
});
