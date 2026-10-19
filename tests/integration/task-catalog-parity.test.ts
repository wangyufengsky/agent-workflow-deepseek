import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { createApplication } from '../../packages/server/src/index.ts';
import { createRequestKey, type TemplateArchiveCorpus, type TaskTemplate, type TemplateTaskScope } from '@agent-workflow/shared';
import { templateScopePrompt } from '../../packages/engine/src/template-scope.ts';
import { createSessionScope } from '../../packages/server/src/session-scope.ts';
function repo() { const root = mkdtempSync(join(tmpdir(), 'aw-taskcat-repo-')); const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); git('init', '-q', '-b', 'main'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test'); mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src', 'only.ts'), 'export const frozen = 1;\n'); writeFileSync(join(root, 'outside.ts'), 'outside scope'); git('add', '.'); git('commit', '-qm', 'baseline'); return { root, sha: git('rev-parse', 'HEAD') }; }
async function project(app: Awaited<ReturnType<typeof createApplication>>, root: string) { return (await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: createRequestKey(), name: 'Parity', rootPath: root } })).json().data.resource.project.id as string; }
test('archive guards live tasks, preserves closed task content and idempotent original receipt, survives reopen', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'aw-taskcat-'));
    const repository = repo();
    let app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
    try {
        const projectId = await project(app, repository.root);
        const picked = await app.app.inject({ method: 'GET', url: `/api/projects/${projectId}/source-path?path=${encodeURIComponent(join(repository.root, 'src'))}` });
        assert.equal(picked.statusCode, 200, picked.body);
        assert.equal(picked.json().data.path, 'src');
        const escapedPick = await app.app.inject({ method: 'GET', url: `/api/projects/${projectId}/source-path?path=${encodeURIComponent(tmpdir())}` });
        assert.equal(escapedPick.statusCode, 403);
        const created = await app.app.inject({ method: 'POST', url: '/api/tasks', payload: { requestKey: createRequestKey(), projectId, title: 'Preserved', requirementText: 'Requirement body', methodId: 'method.requirement-development' } });
        const id = created.json().data.resource.task.id as string;
        const denied = await app.app.inject({ method: 'POST', url: `/api/tasks/${id}/archive`, payload: { requestKey: createRequestKey(), archived: true, confirmArchive: true } });
        assert.equal(denied.statusCode, 409);
        app.store.tasks.update(id, { lifecycle: 'cancelled' });
        const before = app.store.tasks.get(id)!;
        const key = createRequestKey();
        const payload = { requestKey: key, archived: true, confirmArchive: true };
        const archived = await app.app.inject({ method: 'POST', url: `/api/tasks/${id}/archive`, payload });
        assert.equal(archived.statusCode, 200, archived.body);
        const at = archived.json().data.resource.archivedAt;
        const replay = await app.app.inject({ method: 'POST', url: `/api/tasks/${id}/archive`, payload });
        assert.equal(replay.json().data.resource.archivedAt, at);
        assert.deepEqual(app.store.tasks.get(id), before);
        assert.equal((await app.app.inject({ method: 'GET', url: '/api/tasks' })).json().data.items.length, 0);
        assert.equal((await app.app.inject({ method: 'GET', url: '/api/tasks?archived=true' })).json().data.items[0].id, id);
        const createKey = created.json().data.receipt.requestKey as string;
        app.engine.commands.fail(createKey, new Error('isolated lost settlement fixture'), true);
        const interruptedKey = createRequestKey();
        app.engine.commands.begin({ requestKey: interruptedKey, operation: 'template.task.create', body: { isolatedInterruptedPreflight: true }, target: { projectId } });
        await app.close();
        app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
        const recovered = (await app.app.inject({ method: 'GET', url: `/api/operations/${createKey}` })).json().data.operation;
        assert.equal(recovered.status, 'succeeded');
        assert.equal(recovered.outcome.taskId, id);
        const interrupted = (await app.app.inject({ method: 'GET', url: `/api/operations/${interruptedKey}` })).json().data.operation;
        assert.equal(interrupted.status, 'failed');
        assert.equal(app.store.tasks.list().length, 1, 'reconcile never creates another task');
        assert.equal((await app.app.inject({ method: 'GET', url: '/api/tasks?archived=true' })).json().data.items[0].archivedAt, at);
        const restore = await app.app.inject({ method: 'POST', url: `/api/tasks/${id}/archive`, payload: { requestKey: createRequestKey(), archived: false, confirmArchive: true } });
        assert.equal(restore.statusCode, 200);
        assert.equal((await app.app.inject({ method: 'GET', url: '/api/tasks' })).json().data.items[0].id, id);
    }
    finally {
        await app.close();
    }
});
test('template creation freezes selected source/documents/branch, rejects escapes and repeated dispatch, actual source tools read frozen scope', async () => {
    const repository = repo();
    const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-taskscope-')), disableOpenCode: true, disableListen: true });
    try {
        const projectId = await project(app, repository.root);
        const zip = new JSZip();
        zip.file('word/document.xml', '<w:document><w:p><w:t>DOCX requirement</w:t></w:p></w:document>');
        const docx = await zip.generateAsync({ type: 'base64' });
        const dated = await app.app.inject({ method: 'POST', url: '/api/tasks', payload: { requestKey: createRequestKey(), projectId, title: 'Git evidence', requirementText: 'Review contributions', methodId: 'method.requirement-development', template: { templateId: 'template.weekly-contribution', parameters: {}, scope: { branch: 'main', outputDirectory: 'docs/reports', dateRange: { preset: 'custom', from: '2000-01-01', to: '2100-01-01' } } } } });
        assert.equal(dated.statusCode, 201, dated.body);
        const datedScope = dated.json().data.resource.task.fixedTemplate.scope as TemplateTaskScope;
        assert.equal(datedScope.commits?.length, 1);
        assert.equal(datedScope.outputDirectory, 'docs/reports');
        assert.match(templateScopePrompt(datedScope), /docs\/reports/);
        assert.equal(datedScope.commits[0]!.commit.author.name, 'Test');
        assert.equal(datedScope.commits[0]!.commit.stats.files, 2);
        assert.ok(datedScope.commits[0]!.changes.some((change) => change.diff.hunks.some((hunk) => hunk.lines.some((line) => line.kind === 'add' && line.text.includes('frozen = 1')))));
        const datedReview = await app.app.inject({ method: 'POST', url: '/api/tasks', payload: { requestKey: createRequestKey(), projectId, title: 'Dated snapshot', requirementText: 'Review frozen date scope', methodId: 'method.requirement-development', template: { templateId: 'template.snapshot-code-review', parameters: { mode: 'full', depth: 'full' }, scope: { branch: 'main', dateRange: { preset: 'custom', from: '2000-01-01', to: '2000-01-02' } } } } });
        assert.equal(datedReview.statusCode, 201, datedReview.body);
        assert.equal(datedReview.json().data.resource.task.fixedTemplate.snapshot.mode, 'incremental');
        assert.ok(datedReview.json().data.resource.task.fixedTemplate.snapshot.units.every((unit: {
            excludedReason?: string;
        }) => unit.excludedReason), 'no commits in date range never exposes all source as a full review');
        const requestKey = createRequestKey();
        const payload = { requestKey, projectId, title: 'Frozen inputs', requirementText: 'Check scoped source', methodId: 'method.requirement-development', template: { templateId: 'template.requirement-review', parameters: {}, scope: { branch: 'main', sourcePaths: ['src'], documents: [{ name: 'scope.md', base64: Buffer.from('Markdown requirement').toString('base64') }, { name: 'scope.docx', base64: docx }] } } };
        const [created, replay] = await Promise.all([app.app.inject({ method: 'POST', url: '/api/tasks', payload }), app.app.inject({ method: 'POST', url: '/api/tasks', payload })]);
        assert.equal(created.statusCode, 201, created.body);
        assert.equal(replay.statusCode, 201, replay.body);
        assert.equal(app.store.tasks.list().length, 3);
        const task = created.json().data.resource.task;
        const scope = task.fixedTemplate.scope as TemplateTaskScope;
        assert.equal(scope.targetSha, repository.sha);
        assert.equal(scope.sourceFiles?.length, 1);
        assert.equal(scope.documents.length, 2);
        assert.match(scope.documents[1]!.text, /DOCX requirement/);
        assert.match(templateScopePrompt(scope), /Markdown requirement/);
        const invalid = await app.app.inject({ method: 'POST', url: '/api/tasks', payload: { ...payload, requestKey: createRequestKey(), template: { ...payload.template, scope: { ...payload.template.scope, sourcePaths: ['../outside'] } } } });
        assert.equal(invalid.statusCode, 400);
        assert.equal(app.store.tasks.list().length, 3);
        const plan = (await app.app.inject({ method: 'POST', url: `/api/tasks/${task.id}/plan/from-template`, payload: { requestKey: createRequestKey(), confirmUseTemplate: true } })).json().data.resource.plan;
        const confirm = await app.app.inject({ method: 'POST', url: `/api/tasks/${task.id}/plan/confirm`, payload: { requestKey: createRequestKey(), planRevisionId: plan.id, confirmPlan: true } });
        assert.equal(confirm.statusCode, 200, confirm.body);
        const current = app.store.tasks.get(task.id)!;
        const execution = app.store.executions.get(current.executionId!)!;
        const frozenPlan = app.store.plans.get(plan.id)!;
        const node = frozenPlan.graph.nodes[0]!;
        const attempt = app.store.executions.createAttempt({ executionId: execution.id, nodeId: node.id, ordinal: 1 });
        app.store.executions.updateNode(execution.id, node.id, { status: 'running', currentAttemptId: attempt.id });
        const session = createSessionScope({ kind: 'execution', metadata: { taskId: task.id, executionId: execution.id, nodeId: node.id, attemptId: attempt.id }, cwd: repository.root, prompt: '', permission: 'read_only', model: app.engine.settings.models[0]!, rolePolicy: node.roleSnapshot!, sink: {}, timeoutMs: 60000 });
        const headers = { authorization: `Bearer ${app.internalToken}`, 'x-agent-workflow-scope': session.token };
        writeFileSync(join(repository.root, 'src', 'only.ts'), 'mutated');
        const read = await app.app.inject({ method: 'GET', url: `/internal/mcp/workspace/file?taskId=${task.id}&path=src/only.ts`, headers });
        assert.equal(read.statusCode, 200, read.body);
        assert.match(read.json().data.lines.join('\n'), /frozen = 1/);
        assert.equal(read.json().data.targetSha, repository.sha);
        const outside = await app.app.inject({ method: 'GET', url: `/internal/mcp/workspace/file?taskId=${task.id}&path=outside.ts`, headers });
        assert.equal(outside.statusCode, 403);
        const list = await app.app.inject({ method: 'GET', url: `/internal/mcp/workspace/files?taskId=${task.id}`, headers });
        assert.deepEqual(list.json().data.entries.map((item: {
            path: string;
        }) => item.path), ['src/only.ts']);
        session.revoke();
    }
    finally {
        await app.close();
    }
});
test('historical contracts retain versions across catalogue updates; archive contains real legacy records and safe exports', async () => {
    const repository = repo();
    const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-taskarchive-')), disableOpenCode: true, disableListen: true });
    try {
        assert.equal((await app.app.inject({ method: 'GET', url: '/api/templates/archive' })).json().data.templates.length, 0);
        const template: TaskTemplate = { id: 'template.custom.history-test', name: 'History test', version: 1, lockedAfterCreate: true, parameters: [], steps: [{ key: 'one', title: 'Original step', kind: 'implementation', group: 'fixed' }] };
        const imported = await app.app.inject({ method: 'POST', url: '/api/catalog/templates/import', payload: { requestKey: createRequestKey(), template, confirmImport: true } });
        assert.equal(imported.statusCode, 200, imported.body);
        const projectId = await project(app, repository.root);
        const created = await app.app.inject({ method: 'POST', url: '/api/tasks', payload: { requestKey: createRequestKey(), projectId, title: 'Frozen template', requirementText: 'R1', methodId: 'method.requirement-development', template: { templateId: template.id, parameters: {} } } });
        const taskId = created.json().data.resource.task.id;
        const updated = await app.app.inject({ method: 'PATCH', url: `/api/catalog/templates/${template.id}`, payload: { requestKey: createRequestKey(), template: { ...template, version: 2, steps: [...template.steps, { key: 'two', title: 'New step', kind: 'test', group: 'fixed' }] }, confirmUpdate: true } });
        assert.equal(updated.statusCode, 200, updated.body);
        const plan = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/plan/from-template`, payload: { requestKey: createRequestKey(), confirmUseTemplate: true } });
        assert.equal(plan.json().data.resource.plan.graph.nodes.length, 1, 'old task uses captured v1 contract');
        app.store.settings.putJson('catalog.automation-archive.v1', { rules: [{ id: 'rule-old', name: 'Old rule', trigger: 'cron', config: { cron: '0 2 * * *', webhookKey: 'must-not-export' }, health: { checkedAt: '2026-01-01', status: 'failed', error: 'old failure' } }], runs: [{ id: 'run-old', ruleId: 'rule-old', taskId, status: 'completed', triggeredAt: '2026-01-01', evidence: { headSha: repository.sha, token: 'hidden' } }] });
        const corpus = (await app.app.inject({ method: 'GET', url: '/api/templates/archive' })).json().data as TemplateArchiveCorpus;
        assert.equal(corpus.templates[0]?.versions.length, 2);
        assert.equal(corpus.rules.length, 1);
        assert.doesNotMatch(JSON.stringify(corpus), /must-not-export|hidden/);
        const exported = (await app.app.inject({ method: 'GET', url: '/api/templates/archive/export' })).json().data;
        assert.equal(exported.runs, undefined);
        assert.equal(exported.rules[0].health, undefined);
        assert.equal(exported.format, 'v1');
        const verified = await app.app.inject({ method: 'GET', url: '/api/templates/archive/runs/run-old/verify' });
        assert.equal(verified.json().data.found, true);
        assert.equal(app.store.executions.byTask(taskId), undefined, 'verify never starts a task');
    }
    finally {
        await app.close();
    }
});
function textPdf(): Buffer {
    const stream = 'BT /F1 12 Tf 30 150 Td (PDF requirement evidence) Tj ET';
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    for (const [i, object] of objects.entries()) {
        offsets.push(Buffer.byteLength(pdf));
        pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
    }
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => String(offset).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(pdf);
}
test('PDF requirements are extracted on capable hosts; unavailable parser has a failed original receipt and never creates a task', async () => {
    const repository = repo();
    const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-taskpdf-')), disableOpenCode: true, disableListen: true });
    try {
        const projectId = await project(app, repository.root);
        const key = createRequestKey();
        const response = await app.app.inject({ method: 'POST', url: '/api/tasks', payload: { requestKey: key, projectId, title: 'PDF input', requirementText: 'Read PDF', methodId: 'method.requirement-development', template: { templateId: 'template.requirement-review', parameters: {}, scope: { branch: 'main', sourcePaths: ['src'], documents: [{ name: 'requirement.pdf', base64: textPdf().toString('base64') }] } } } });
        let parserAvailable = true;
        try {
            execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
        }
        catch {
            parserAvailable = false;
        }
        if (parserAvailable) {
            assert.equal(response.statusCode, 201, response.body);
            assert.match(response.json().data.resource.task.fixedTemplate.scope.documents[0].text, /PDF requirement evidence/);
        }
        else {
            assert.equal(response.statusCode, 503, response.body);
            assert.equal(app.store.tasks.list().length, 0);
            assert.equal(app.engine.commands.get(key)?.status, 'failed');
        }
    }
    finally {
        await app.close();
    }
});
