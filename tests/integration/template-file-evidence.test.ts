import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DEFAULT_CATALOG, type PlanGraph, type PlanNode, type RoleDefinition, type ControlledTestRun, type AttemptResult } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/index.ts';
import { createSessionScope } from '../../packages/server/src/session-scope.ts';
import { parseJUnit, retainControlledTestRun, reportFingerprint } from '../../packages/server/src/controlled-tests.ts';
import { captureArtifacts, readArtifactBytes } from '../../packages/engine/src/artifacts.ts';
import { prepareSourceSubmission, sourceReadKey, artifactReadKey } from '../../packages/engine/src/template-file-evidence.ts';
import { methodToGraph } from '../../packages/engine/src/graph.ts';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const testText = "import {test} from 'node:test';import assert from 'node:assert/strict';test('passes',()=>assert.equal(1,1));test('skips',{skip:true},()=>{});test('fails',()=>assert.equal(1,2));\n";
async function fixture(passing = false, configured = false) {
  const root = mkdtempSync(join(tmpdir(), 'aw-file-proof-root-')); mkdirSync(join(root, 'src')); mkdirSync(join(root, 'test')); writeFileSync(join(root, 'src/a.ts'), 'export const a = 1;'); writeFileSync(join(root, 'test/proof.test.mjs'), passing ? testText.replace("test('fails',()=>assert.equal(1,2))", "test('passes-again',()=>assert.equal(1,1))") : testText);
  if (configured) mkdirSync(join(root, 'reports'));
  const argv = [process.execPath, '--test', '--test-reporter=junit', ...(configured ? ['--test-reporter-destination=reports/result.xml'] : []), 'test/proof.test.mjs'];
  const command = argv.join(' ');
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-file-proof-data-')), disableOpenCode: true, disableListen: true });
  const baseRole = app.engine.catalog.roles.find((role) => role.id === 'role.tester')!;
  const role: RoleDefinition = { ...baseRole, capabilityGroups: baseRole.capabilityGroups!.map((group) => ({ ...group, items: group.items.map((item) => ({ ...item, enabled: true })) })), resourcePermissions: { ...baseRole.resourcePermissions!, files: [{ kind: 'read', path: '.' }, { kind: 'write', path: '.' }], commands: [{ kind: 'argv', argv }], tools: [{ kind: 'mcp', name: 'workspace.exec' }, { kind: 'mcp', name: 'workspace.file.read' }, { kind: 'mcp', name: 'workspace.file.write' }] } };
  const project = app.store.projects.create({ name: 'Offline protocol fixture', rootPath: root, gitState: 'git', settings: { testCommand: command } });
  const template = DEFAULT_CATALOG.templates.find((item) => item.id === 'template.unit-test-development')!;
  const task = app.store.tasks.create({ projectId: project.id, title: 'Evidence fixture', requirementText: 'Scoped source evidence', methodId: 'method.unit-test-development', methodRevision: 'template-v8', fixedTemplate: { templateId: template.id, templateVersion: template.version, contract: template, locked: true, parameters: {}, scope: { sourcePaths: ['src'], sourceFiles: [{ path: 'src/a.ts', blobSha: 'a'.repeat(40), text: 'export const a = 1;' }], documents: [], frozenAt: new Date().toISOString() } } });
  const skeleton = methodToGraph({ ...DEFAULT_CATALOG.methods[0]!, requiredSteps: template.steps });
  const graph: PlanGraph = { ...skeleton, nodes: skeleton.nodes.map((node, index): PlanNode => ({ ...node, roleSnapshot: role, roleId: role.id, sourceEvidence: { version: 1, stage: template.steps[index]!.sourceStage!, testCommand: command, ...(configured ? { reportPatterns: ['reports/*.xml'] } : {}), filePaths: ['src/a.ts'] } })) };
  const plan = app.store.plans.create({ taskId: task.id, source: 'template', graph, status: 'confirmed' });
  const workspace = app.store.workspaces.create({ taskId: task.id, kind: 'directory_copy', displayRoot: root, branch: 'fixture' });
  app.store.workspaces.update(workspace.id, { state: 'ready' });
  const execution = app.store.executions.create({ taskId: task.id, planRevisionId: plan.id, graph, autoAdvance: false }); app.store.tasks.update(task.id, { currentPlanRevisionId: plan.id, workspaceId: workspace.id, executionId: execution.id });
  const sessionFor = (node: PlanNode, ordinal = 1) => {
    const attempt = app.store.executions.createAttempt({ executionId: execution.id, nodeId: node.id, ordinal, definition: { planRevisionId: plan.id, node } });
    app.store.executions.updateNode(execution.id, node.id, { status: 'running', currentAttemptId: attempt.id, attemptCount: ordinal });
    app.store.settings.putJson(`execution.session.${attempt.id}`, { sessionId: `offline-protocol-session-${attempt.id}` });
    const session = createSessionScope({ kind: 'execution', metadata: { taskId: task.id, executionId: execution.id, nodeId: node.id, attemptId: attempt.id }, cwd: root, prompt: 'Offline tool transport fixture; not a model response', permission: 'workspace_write', model: app.engine.settings.models[0]!, rolePolicy: role, sink: {}, timeoutMs: 60000 });
    return { attempt, session, headers: { authorization: `Bearer ${app.internalToken}`, 'x-agent-workflow-scope': session.token } };
  };
  const read = async (session: ReturnType<typeof sessionFor>, path: string) => app.app.inject({ method: 'GET', url: `/internal/mcp/workspace/file?taskId=${task.id}&path=${encodeURIComponent(path)}`, headers: session.headers });
  return { app, root, command, project, task: app.store.tasks.get(task.id)!, graph, plan, execution, sessionFor, read, close: () => app.close() };
}

test('controlled real Node child process yields passed/failed/skipped and immutable failed-test file/report identities', async () => {
  const f = await fixture();
  try {
    const node = f.graph.nodes.find((item) => item.sourceEvidence?.stage === 'test')!; const running = f.sessionFor(node);
    f.app.store.projects.update(f.project.id, { settings: { testCommand: `${process.execPath} --version` } });
    const response = await f.app.app.inject({ method: 'POST', url: '/internal/mcp/workspace/exec', headers: running.headers, payload: { taskId: f.task.id, command: f.command, testReport: { format: 'junit' } } });
    assert.equal(response.statusCode, 200, response.body); const run = response.json().data.testRun as ControlledTestRun;
    assert.equal(run.state, 'failed'); assert.equal(run.exitCode, 1); assert.deepEqual([run.passed, run.failed, run.skipped], [1, 1, 1]);
    assert.equal(run.attemptId, running.attempt.id); assert.equal(run.commandSha256, hash(JSON.stringify([process.execPath, '--test', '--test-reporter=junit', 'test/proof.test.mjs']))); assert.equal(run.cases.find((item) => item.status === 'failed')?.file, 'test/proof.test.mjs');
    assert.equal(run.cases[0]?.artifact?.sha256, hash(testText)); assert.ok(run.report?.sha256);
    assert.match(readArtifactBytes(f.app.store.dataDir, run.report!).toString(), /testcase name="fails"/);
    const changed = await f.app.app.inject({ method: 'POST', url: '/internal/mcp/workspace/exec', headers: running.headers, payload: { taskId: f.task.id, command: `${f.command} --test-only`, testReport: { format: 'junit' } } });
    assert.equal(changed.json().error.code, 'FORBIDDEN', 'published occupation argv remains an independent guard');
    running.session.revoke();
  } finally { await f.close(); }
});

test('JUnit rejects DTD/escapes/symlinks, ignores claimed suite totals, and stale or unsupported reports remain unknown', async () => {
  const f = await fixture();
  try {
    assert.throws(() => parseJUnit('<!DOCTYPE testsuite [<!ENTITY x SYSTEM "file:///etc/passwd">]><testsuite><testcase name="x"/></testsuite>', f.root), /DTD/);
    assert.throws(() => parseJUnit('<testsuite><testcase name="x" file="../outside.ts"/></testsuite>', f.root), /工作区外/);
    symlinkSync(join(f.root, 'test/proof.test.mjs'), join(f.root, 'test/link.mjs'));
    assert.throws(() => parseJUnit('<testsuite><testcase name="x" file="test/link.mjs"/></testsuite>', f.root), /符号链接/);
    assert.equal(parseJUnit('<testsuite><testcase name="m" classname="example.ProofTest"/></testsuite>', f.root, ['src/test/java/example/ProofTest.java'])[0]?.file, 'src/test/java/example/ProofTest.java');
    assert.equal(parseJUnit('<testsuite tests="9999" failures="0"><testcase name="real"><failure message="actual"/></testcase></testsuite>', f.root)[0]?.status, 'failed');
    const path = 'test/report.xml'; writeFileSync(join(f.root, path), '<testsuite><testcase name="old"/></testsuite>'); const before = reportFingerprint(f.root, { format: 'junit', path });
    const input = { store: f.app.store, taskId: f.task.id, executionId: f.execution.id, nodeId: 'fixture', attemptId: 'fixture', root: f.root, startedAt: new Date().toISOString(), allowed: () => true };
    const stale = retainControlledTestRun({ ...input, before, report: { format: 'junit', path }, result: { command: 'controlled fixture', exitCode: 0, stdout: '', stderr: '', timedOut: false } });
    assert.equal(stale.state, 'unknown'); assert.equal(stale.passed, undefined); assert.match(stale.reason!, /旧测试报告/);
    const unsupported = retainControlledTestRun({ ...input, result: { command: 'controlled fixture', exitCode: 0, stdout: 'PASS 900 tests (unstructured)', stderr: '', timedOut: false } }); assert.equal(unsupported.state, 'unknown'); assert.equal(unsupported.passed, undefined);
  } finally { await f.close(); }
});

test('source file proof requires full frozen reads, real output capture, independent current review and rejects stale writer identities', async () => {
  const f = await fixture();
  try {
    const writeNode = f.graph.nodes.find((node) => node.sourceEvidence?.stage === 'write')!; const writer = f.sessionFor(writeNode);
    const payload = { fileEvidence: [{ path: 'src/a.ts', blobSha: 'a'.repeat(40), summary: 'Offline writer protocol evidence', artifactPaths: ['test/proof.test.mjs'] }] };
    assert.equal(prepareSourceSubmission(f.app.store, f.task, writeNode, writer.attempt, { verification: { state: 'failed', passed: 999, summary: 'Cannot read frozen file' } }).materialize([]).verification?.passed, undefined);
    assert.throws(() => prepareSourceSubmission(f.app.store, f.task, writeNode, writer.attempt, { payload, artifacts: [{ path: 'test/proof.test.mjs' }] }), /完整读取/);
    const source = await f.read(writer, 'src/a.ts'); assert.equal(source.statusCode, 200, source.body); assert.equal(f.app.store.settings.getJson<{ blobSha: string }>(sourceReadKey(writer.attempt.id, 'src/a.ts'))?.blobSha, 'a'.repeat(40));
    const artifacts = captureArtifacts(f.app.store.dataDir, f.root, writer.attempt.id, [{ path: 'test/proof.test.mjs' }], () => true);
    const written = prepareSourceSubmission(f.app.store, f.task, writeNode, writer.attempt, { payload, artifacts: [{ path: 'test/proof.test.mjs' }] }).materialize(artifacts);
    const result: AttemptResult = { resultRevision: 'offline-writer-proof', summary: 'Offline protocol fixture, no model call', artifacts, fileEvidence: written.fileEvidence, errors: [], warnings: [] };
    f.app.store.executions.finishAttempt(writer.attempt.id, 'succeeded', result); f.app.store.executions.updateNode(f.execution.id, writeNode.id, { status: 'succeeded' });
    // Detailed-design review exercises independent read/version proof; unit-test review additionally requires a real passed command.
    const reviewTask = { ...f.task, fixedTemplate: { ...f.task.fixedTemplate!, templateId: 'template.detailed-design' } };
    const reviewNode = f.graph.nodes.find((node) => node.sourceEvidence?.stage === 'review')!; const reviewer = f.sessionFor(reviewNode);
    assert.equal((await f.read(reviewer, 'src/a.ts')).statusCode, 200);
    const reviewPayload = { fileEvidence: [{ path: 'src/a.ts', blobSha: 'a'.repeat(40), summary: 'Independent fixture review', writerAttemptId: writer.attempt.id, verdict: 'confirmed', rationale: 'Compared captured output with frozen source' }] };
    assert.throws(() => prepareSourceSubmission(f.app.store, reviewTask, reviewNode, reviewer.attempt, { payload: reviewPayload }), /完整读取对应写作产物/);
    writeFileSync(join(f.root, 'test/proof.test.mjs'), 'LATER DISK CONTENT'); const read = await f.read(reviewer, 'test/proof.test.mjs'); assert.equal(read.statusCode, 200, read.body); assert.equal(read.json().data.lines.join('\n'), testText);
    const reviewed = prepareSourceSubmission(f.app.store, reviewTask, reviewNode, reviewer.attempt, { payload: reviewPayload }).materialize([]); assert.equal(reviewed.fileEvidence?.[0]?.verdict, 'confirmed');
    f.app.store.settings.putJson(`execution.session.${reviewer.attempt.id}`, { sessionId: f.app.store.settings.getJson<{ sessionId: string }>(`execution.session.${writer.attempt.id}`)!.sessionId });
    assert.throws(() => prepareSourceSubmission(f.app.store, reviewTask, reviewNode, reviewer.attempt, { payload: reviewPayload }), /不同于写作/);
    f.sessionFor(writeNode, 2); assert.throws(() => prepareSourceSubmission(f.app.store, reviewTask, reviewNode, reviewer.attempt, { payload: reviewPayload }), /旧尝试/);
    writer.session.revoke(); reviewer.session.revoke();
  } finally { await f.close(); }
});

test('service test submission overrides model counters, binds generated-file hashes and forbids cross-attempt or superseded reports', async () => {
  const f = await fixture();
  try {
    const writeNode = f.graph.nodes.find((node) => node.sourceEvidence?.stage === 'write')!; const writer = f.sessionFor(writeNode);
    await f.read(writer, 'src/a.ts');
    const artifacts = captureArtifacts(f.app.store.dataDir, f.root, writer.attempt.id, [{ path: 'test/proof.test.mjs' }], () => true);
    const writeInput = { artifacts: [{ path: 'test/proof.test.mjs' }], payload: { fileEvidence: [{ path: 'src/a.ts', blobSha: 'a'.repeat(40), summary: 'Offline protocol writer', artifactPaths: ['test/proof.test.mjs'] }] } };
    const written = prepareSourceSubmission(f.app.store, f.task, writeNode, writer.attempt, writeInput).materialize(artifacts);
    f.app.store.executions.finishAttempt(writer.attempt.id, 'succeeded', { resultRevision: 'fixture-writer', summary: 'Offline protocol fixture', artifacts, fileEvidence: written.fileEvidence, errors: [], warnings: [] }); f.app.store.executions.updateNode(f.execution.id, writeNode.id, { status: 'succeeded' });
    const testNode = f.graph.nodes.find((node) => node.sourceEvidence?.stage === 'test')!; const runner = f.sessionFor(testNode); await f.read(runner, 'src/a.ts');
    const execute = async () => {
      const response = await f.app.app.inject({ method: 'POST', url: '/internal/mcp/workspace/exec', headers: runner.headers, payload: { taskId: f.task.id, command: f.command, testReport: { format: 'junit' } } }); assert.equal(response.statusCode, 200, response.body); return response.json().data.testRun as ControlledTestRun;
    };
    const run = await execute();
    const input = { payload: { testRunId: run.id, claimedPassed: 9999, fileEvidence: [{ path: 'src/a.ts', blobSha: 'a'.repeat(40), summary: 'Actual test file mapping', writerAttemptId: writer.attempt.id }] } };
    const first = prepareSourceSubmission(f.app.store, f.task, testNode, runner.attempt, input).materialize([]);
    assert.equal(first.verification?.passed, 1);
    const newer = await execute(); assert.notEqual(newer.id, run.id);
    assert.throws(() => prepareSourceSubmission(f.app.store, f.task, testNode, runner.attempt, input), /更新的测试运行/);
    const materialized = prepareSourceSubmission(f.app.store, f.task, testNode, runner.attempt, { payload: { ...input.payload, testRunId: newer.id } }).materialize([]);
    assert.deepEqual([materialized.verification?.passed, materialized.verification?.failed, materialized.testRun?.skipped], [1, 1, 1]); assert.equal(materialized.verification?.state, 'failed');
    f.app.store.executions.finishAttempt(runner.attempt.id, 'failed', { resultRevision: 'fixture-actual-tests', summary: 'Actual child-process evidence; no model output', artifacts: materialized.serviceArtifacts ?? [], fileEvidence: materialized.fileEvidence, testRun: materialized.testRun, verification: materialized.verification, errors: [], warnings: [] }); f.app.store.executions.updateNode(f.execution.id, testNode.id, { status: 'failed' });
    const content = f.app.engine.extras.runContent(f.task.id).specialized!; assert.equal(content.batches[0]?.testRun?.failed, 1); assert.equal(content.files[0]?.state, 'analyzed');
    const failedFile = newer.cases.find((item) => item.status === 'failed')!.artifact!;
    const body = await f.app.app.inject({ method: 'GET', url: `/api/tasks/${f.task.id}/attempts/${runner.attempt.id}/artifacts/${failedFile.id}?revision=${failedFile.revision}&sha256=${failedFile.sha256}` }); assert.equal(body.statusCode, 200, body.body); assert.match(body.json().data.preview, /test\('fails'/);
    const other = f.sessionFor(testNode, 2); await f.read(other, 'src/a.ts');
    assert.throws(() => prepareSourceSubmission(f.app.store, f.task, testNode, other.attempt, { payload: { ...input.payload, testRunId: newer.id } }), /当前尝试/);
    writer.session.revoke(); runner.session.revoke(); other.session.revoke();
  } finally { await f.close(); }
});

test('passed actual command plus independent reviewed current file produces coverage; revoked result removes that proof', async () => {
  const f = await fixture(true);
  try {
    const writeNode = f.graph.nodes.find((node) => node.sourceEvidence?.stage === 'write')!; const writer = f.sessionFor(writeNode); await f.read(writer, 'src/a.ts');
    const artifacts = captureArtifacts(f.app.store.dataDir, f.root, writer.attempt.id, [{ path: 'test/proof.test.mjs' }], () => true);
    const file = { path: 'src/a.ts', blobSha: 'a'.repeat(40), summary: 'Offline protocol evidence with an actual local command' };
    const write = prepareSourceSubmission(f.app.store, f.task, writeNode, writer.attempt, { payload: { fileEvidence: [{ ...file, artifactPaths: ['test/proof.test.mjs'] }] }, artifacts: [{ path: 'test/proof.test.mjs' }] }).materialize(artifacts);
    const finish = (attemptId: string, nodeId: string, value: ReturnType<typeof writeSubmission>) => { f.app.store.executions.finishAttempt(attemptId, 'succeeded', { ...value, resultRevision: `fixture-${attemptId}`, summary: 'Offline protocol fixture; not a model acceptance', artifacts: value.serviceArtifacts ?? (nodeId === writeNode.id ? artifacts : []), errors: [], warnings: [] }); f.app.store.executions.updateNode(f.execution.id, nodeId, { status: 'succeeded' }); };
    function writeSubmission() { return write; }
    finish(writer.attempt.id, writeNode.id, write);
    const testNode = f.graph.nodes.find((node) => node.sourceEvidence?.stage === 'test')!; const runner = f.sessionFor(testNode); await f.read(runner, 'src/a.ts');
    const response = await f.app.app.inject({ method: 'POST', url: '/internal/mcp/workspace/exec', headers: runner.headers, payload: { taskId: f.task.id, command: f.command, testReport: { format: 'junit' } } }); assert.equal(response.statusCode, 200, response.body); const run = response.json().data.testRun as ControlledTestRun; assert.equal(run.state, 'passed'); assert.deepEqual([run.passed, run.failed, run.skipped], [2, 0, 1]);
    const tested = prepareSourceSubmission(f.app.store, f.task, testNode, runner.attempt, { payload: { testRunId: run.id, fileEvidence: [{ ...file, writerAttemptId: writer.attempt.id }] } }).materialize([]); finish(runner.attempt.id, testNode.id, tested);
    const reviewNode = f.graph.nodes.find((node) => node.sourceEvidence?.stage === 'review')!; const reviewer = f.sessionFor(reviewNode); await f.read(reviewer, 'src/a.ts'); await f.read(reviewer, 'test/proof.test.mjs');
    const reviewed = prepareSourceSubmission(f.app.store, f.task, reviewNode, reviewer.attempt, { payload: { fileEvidence: [{ ...file, writerAttemptId: writer.attempt.id, testRunId: run.id, verdict: 'confirmed', rationale: 'Independent offline protocol reviewer compared actual file and actual test report' }] } }).materialize([]); finish(reviewer.attempt.id, reviewNode.id, reviewed);
    assert.match(readArtifactBytes(f.app.store.dataDir, reviewed.serviceArtifacts![0]!).toString(), /逐文件复核报告/);
    for (const node of f.graph.nodes.filter((item) => item.sourceEvidence?.stage === 'prepare')) f.app.store.executions.updateNode(f.execution.id, node.id, { status: 'succeeded' });
    const content = f.app.engine.extras.runContent(f.task.id).specialized!; assert.equal(content.files[0]?.state, 'covered'); assert.equal(content.batches[0]?.verified, true); assert.equal(content.files[0]?.writing?.artifacts[0]?.sha256, artifacts[0]!.sha256);
    f.app.store.db.prepare('UPDATE attempts SET readability_json = ? WHERE id = ?').run(JSON.stringify({ output: 'ok', tools: 'ok', result: 'forbidden' }), reviewer.attempt.id);
    const redacted = f.app.engine.extras.runContent(f.task.id).specialized!; assert.equal(redacted.files[0]?.state, 'analyzed'); assert.equal(redacted.files[0]?.review, undefined); assert.equal(redacted.batches[0]?.verified, false);
    writer.session.revoke(); runner.session.revoke(); reviewer.session.revoke();
  } finally { await f.close(); }
});

test('immutable artifact identity disambiguates overwritten source and only complete paginated reads count', async () => {
  const f = await fixture();
  try {
    const writer = f.sessionFor(f.graph.nodes.find((node) => node.sourceEvidence?.stage === 'write')!);
    writeFileSync(join(f.root, 'src/a.ts'), 'new output line 1\nnew output line 2\nnew output line 3');
    const artifacts = captureArtifacts(f.app.store.dataDir, f.root, writer.attempt.id, [{ path: 'src/a.ts' }], () => true);
    f.app.store.executions.finishAttempt(writer.attempt.id, 'succeeded', { resultRevision: 'collision-fixture', summary: 'Offline identity fixture', artifacts, errors: [], warnings: [] });
    f.app.store.executions.updateNode(f.execution.id, writer.attempt.nodeId, { status: 'succeeded' });
    const reviewer = f.sessionFor(f.graph.nodes.find((node) => node.sourceEvidence?.stage === 'review')!);
    assert.equal((await f.read(reviewer, 'src/a.ts')).json().data.lines.join('\n'), 'export const a = 1;');
    const ref = artifacts[0]!;
    const readPage = (offset: number, limit: number, artifactId = ref.id) => f.app.app.inject({ method: 'GET', url: `/internal/mcp/workspace/file?taskId=${f.task.id}&path=src%2Fa.ts&artifactId=${artifactId}&offset=${offset}&limit=${limit}`, headers: reviewer.headers });
    assert.equal((await readPage(0, 1)).json().data.lines[0], 'new output line 1');
    assert.equal(f.app.store.settings.getJson(artifactReadKey(reviewer.attempt.id, ref)), undefined);
    await readPage(2, 1);
    assert.equal(f.app.store.settings.getJson(artifactReadKey(reviewer.attempt.id, ref)), undefined);
    await readPage(1, 1);
    assert.equal(f.app.store.settings.getJson(artifactReadKey(reviewer.attempt.id, ref)), true);
    assert.equal((await readPage(0, 1, 'wrong-artifact')).statusCode, 403);
    assert.equal((await readPage(-1, 1)).statusCode, 400);
  } finally { await f.close(); }
});


test('granted workspace writes create missing parents and keep stale-content and symlink escape guards', async () => {
  const f = await fixture();
  const running = f.sessionFor(f.graph.nodes.find((node) => node.sourceEvidence?.stage === 'write')!);
  try {
    const write = (path: string, content: string, expectedSha?: string) => f.app.app.inject({ method: 'POST', url: '/internal/mcp/workspace/file-write', headers: running.headers, payload: { taskId: f.task.id, path, content, expectedSha } });
    const first = await write('generated/deep/add.test.mjs', 'real nested output');
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(readFileSync(join(f.root, 'generated/deep/add.test.mjs'), 'utf8'), 'real nested output');
    const stale = await write('generated/deep/add.test.mjs', 'must not overwrite', hash('old'));
    assert.equal(stale.statusCode, 409, stale.body);
    assert.equal(readFileSync(join(f.root, 'generated/deep/add.test.mjs'), 'utf8'), 'real nested output');
    assert.equal((await write('generated/deep/add.test.mjs', 'updated', first.json().data.sha)).statusCode, 200);
    assert.deepEqual(readdirSync(join(f.root, 'generated/deep')), ['add.test.mjs']);
    const outside = mkdtempSync(join(tmpdir(), 'aw-write-outside-'));
    symlinkSync(outside, join(f.root, 'escape'));
    const escaped = await write('escape/new/deep/test.mjs', 'must not escape');
    assert.equal(escaped.statusCode, 400, escaped.body);
    assert.equal(escaped.json().error.code, 'PATH_ESCAPE');
    assert.equal(existsSync(join(outside, 'new')), false);
  } finally { running.session.revoke(); await f.close(); }
});


test('workspace.exec consumes frozen configured JUnit sources from a real local command without granting extra read access', async () => {
  const f = await fixture(true, true);
  try {
    const node = f.graph.nodes.find((item) => item.sourceEvidence?.stage === 'test')!; const running = f.sessionFor(node);
    f.app.store.projects.update(f.project.id, { settings: { testCommand: 'changed', evidenceSources: [{ kind: 'junit', path: 'other/*.xml' }] } });
    const response = await f.app.app.inject({ method: 'POST', url: '/internal/mcp/workspace/exec', headers: running.headers, payload: { taskId: f.task.id, command: f.command } });
    assert.equal(response.statusCode, 200, response.body); const run = response.json().data.testRun as ControlledTestRun;
    assert.equal(run.state, 'passed'); assert.deepEqual([run.passed, run.failed, run.skipped], [2, 0, 1]);
    assert.equal(run.reports?.[0]?.path, 'reports/result.xml');
    const denied = await f.app.app.inject({ method: 'POST', url: '/internal/mcp/workspace/exec', headers: running.headers, payload: { taskId: f.task.id, command: f.command, testReport: { format: 'junit', path: 'other/result.xml' } } });
    assert.equal(denied.json().error.code, 'FORBIDDEN'); running.session.revoke();
  } finally { await f.close(); }
});
