import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../../packages/server/src/index.ts';

type App = Awaited<ReturnType<typeof createApplication>>;

function requestKey(prefix: string): string {
  return `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;
}

async function setup(): Promise<{ app: App; projectId: string; rootPath: string }> {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-charter-data-'));
  const rootPath = mkdtempSync(join(tmpdir(), 'aw-charter-repo-'));
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  const created = await app.app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { requestKey: requestKey('prj'), name: 'Charter', rootPath },
  });
  assert.equal(created.statusCode, 201, created.body);
  return { app, projectId: created.json().data.resource.project.id as string, rootPath };
}

async function getCharter(app: App, projectId: string): Promise<Record<string, unknown>> {
  const response = await app.app.inject({ method: 'GET', url: `/api/projects/${projectId}/charter` });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().data.charter as Record<string, unknown>;
}

async function updateCharter(app: App, projectId: string, payload: Record<string, unknown>) {
  return app.app.inject({ method: 'PATCH', url: `/api/projects/${projectId}/charter`, payload: { requestKey: requestKey('charter-update'), ...payload } });
}

test('W3-1b charter: read, edit, confirm-write AGENTS.md, receipts and idempotent replay', async () => {
  const { app, projectId, rootPath } = await setup();
  try {
    const initial = await getCharter(app, projectId);
    assert.equal(initial.status, 'none');
    assert.deepEqual(initial.versions, []);
    assert.equal(initial.needsReconcile, false);
    const initialCurrent = initial.current as { path: string; exists: boolean };
    assert.equal(initialCurrent.path, 'AGENTS.md');
    assert.equal(initialCurrent.exists, false);
    const initialCaps = initial.capabilities as { generate: { allowed: boolean; reasonCode: string }; confirmWrite: { allowed: boolean; reasonCode: string } };
    assert.equal(initialCaps.generate.allowed, false);
    assert.equal(initialCaps.generate.reasonCode, 'CHARTER_GENERATION_UNAVAILABLE');
    assert.equal(initialCaps.confirmWrite.allowed, false);
    assert.equal(initialCaps.confirmWrite.reasonCode, 'NO_CHARTER_DRAFT');

    const firstContent = '# 项目公约\n\n- 先读 AGENTS.md 与 docs/原始说明.md。\n- 改动必须附验证方式。\n';
    const saved = await updateCharter(app, projectId, { content: firstContent });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().data.receipt.status, 'succeeded');
    const draft1 = saved.json().data.resource.charter as Record<string, unknown>;
    assert.equal(draft1.status, 'draft');
    assert.equal((draft1.draft as { version: number }).version, 1);
    assert.equal((draft1.draft as { content: string }).content, firstContent);
    assert.equal((draft1.draft as { source: string }).source, 'manual');
    assert.equal((draft1.capabilities as { confirmWrite: { allowed: boolean } }).confirmWrite.allowed, true);

    const secondContent = '# 项目公约 v2\n\n- 使用 pnpm。\n';
    const savedSecond = await updateCharter(app, projectId, { content: secondContent, expectedVersion: 1 });
    assert.equal(savedSecond.statusCode, 200, savedSecond.body);
    assert.equal((savedSecond.json().data.resource.charter.draft as { version: number }).version, 2);
    assert.deepEqual((savedSecond.json().data.resource.charter.versions as { version: number; status: string }[]).map((item) => [item.version, item.status]), [[2, 'draft'], [1, 'draft']]);

    const stale = await updateCharter(app, projectId, { content: '旧版本覆盖', expectedVersion: 1 });
    assert.equal(stale.statusCode, 409, stale.body);
    assert.equal(stale.json().error.code, 'STALE_TARGET');
    assert.equal(stale.json().error.details.actual, 2);

    const empty = await updateCharter(app, projectId, { content: '   ' });
    assert.equal(empty.statusCode, 400, empty.body);
    const tooLong = await updateCharter(app, projectId, { content: 'x'.repeat(64_001) });
    assert.equal(tooLong.statusCode, 400, tooLong.body);

    // Model generation is honestly unavailable (501 + failed receipt).
    const generateKey = requestKey('charter-generate');
    const generate = await app.app.inject({ method: 'POST', url: `/api/projects/${projectId}/charter/generate`, payload: { requestKey: generateKey, confirmGenerate: true } });
    assert.equal(generate.statusCode, 501, generate.body);
    assert.equal(generate.json().error.code, 'CHARTER_GENERATION_UNAVAILABLE');
    assert.equal(generate.json().error.details.capability, 'generate');
    const generateOperation = await app.app.inject({ method: 'GET', url: `/api/operations/${generateKey}` });
    assert.equal(generateOperation.json().data.operation.status, 'failed');

    // A read-only project root makes the write fail without losing the draft.
    chmodSync(rootPath, 0o500);
    const forbiddenKey = requestKey('charter-forbidden');
    const forbidden = await app.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/charter/confirm`,
      payload: { requestKey: forbiddenKey, confirmWrite: true, expectedVersion: 2 },
    });
    assert.equal(forbidden.statusCode, 403, forbidden.body);
    assert.equal(forbidden.json().error.code, 'FORBIDDEN');
    chmodSync(rootPath, 0o700);
    assert.equal(existsSync(join(rootPath, 'AGENTS.md')), false);
    const afterFailure = await getCharter(app, projectId);
    assert.equal(afterFailure.status, 'draft');
    assert.equal((afterFailure.draft as { version: number }).version, 2);
    const failedOperation = await app.app.inject({ method: 'GET', url: `/api/operations/${forbiddenKey}` });
    assert.equal(failedOperation.json().data.operation.status, 'failed');

    const wrongVersion = await app.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/charter/confirm`,
      payload: { requestKey: requestKey('charter-stale-confirm'), confirmWrite: true, expectedVersion: 1 },
    });
    assert.equal(wrongVersion.statusCode, 409, wrongVersion.body);
    assert.equal(existsSync(join(rootPath, 'AGENTS.md')), false);

    const confirmKey = requestKey('charter-confirm');
    const confirm = await app.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/charter/confirm`,
      payload: { requestKey: confirmKey, confirmWrite: true, expectedVersion: 2 },
    });
    assert.equal(confirm.statusCode, 200, confirm.body);
    assert.equal(confirm.json().data.receipt.status, 'succeeded');
    const writtenCharter = confirm.json().data.resource.charter as Record<string, unknown>;
    assert.equal(writtenCharter.status, 'written');
    assert.equal(writtenCharter.draft, undefined);
    assert.equal((writtenCharter.written as { version: number; path: string }).version, 2);
    assert.equal((writtenCharter.written as { path: string }).path, 'AGENTS.md');
    assert.equal(((writtenCharter.current) as { exists: boolean }).exists, true);
    assert.equal(readFileSync(join(rootPath, 'AGENTS.md'), 'utf8'), secondContent);
    assert.equal((writtenCharter.capabilities as { confirmWrite: { allowed: boolean } }).confirmWrite.allowed, false);

    // Same requestKey replays the receipt and does not rewrite the file.
    const replay = await app.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/charter/confirm`,
      payload: { requestKey: confirmKey, confirmWrite: true, expectedVersion: 2 },
    });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().data.receipt.status, 'succeeded');
    assert.equal(readFileSync(join(rootPath, 'AGENTS.md'), 'utf8'), secondContent);

    // A new edit after writing becomes version 3 while current shows the written file.
    const third = await updateCharter(app, projectId, { content: '第三版草稿', expectedVersion: 2 });
    assert.equal(third.statusCode, 200, third.body);
    const thirdCharter = third.json().data.resource.charter as Record<string, unknown>;
    assert.equal((thirdCharter.draft as { version: number }).version, 3);
    assert.equal(thirdCharter.status, 'draft');
    assert.equal((thirdCharter.current as { content: string }).content, secondContent);
  } finally {
    await app.close();
  }
});

test('W3-1b charter: interrupted write reads as unknown and requires manual reconcile', async () => {
  const { app, projectId } = await setup();
  try {
    await updateCharter(app, projectId, { content: '写入前的草稿' });
    const now = new Date().toISOString();
    app.store.settings.putJson(`project.charter.${projectId}`, {
      status: 'writing',
      draft: { version: 1, content: '写入前的草稿', source: 'manual', savedAt: now },
      versions: [{ version: 1, status: 'draft', source: 'manual', savedAt: now }],
      updatedAt: now,
    });
    const view = await getCharter(app, projectId);
    assert.equal(view.status, 'unknown');
    assert.equal(view.needsReconcile, true);
    const caps = view.capabilities as { confirmWrite: { allowed: boolean; reasonCode: string } };
    assert.equal(caps.confirmWrite.allowed, false);
    assert.equal(caps.confirmWrite.reasonCode, 'CHARTER_STATE_UNKNOWN');
    const confirm = await app.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/charter/confirm`,
      payload: { requestKey: requestKey('charter-unknown'), confirmWrite: true },
    });
    assert.equal(confirm.statusCode, 409, confirm.body);
    assert.equal(confirm.json().error.code, 'CHARTER_STATE_UNKNOWN');
    // Editing resets to a fresh draft (no automatic retry of the old intent).
    const recovered = await updateCharter(app, projectId, { content: '重新编辑后的草稿' });
    assert.equal(recovered.statusCode, 200, recovered.body);
    const recoveredCharter = recovered.json().data.resource.charter as { status: string; needsReconcile: boolean };
    assert.equal(recoveredCharter.status, 'draft');
    assert.equal(recoveredCharter.needsReconcile, false);
  } finally {
    await app.close();
  }
});

test('W3-1b project settings: docPaths and project-level GitLab override are validated and read back', async () => {
  const { app, projectId } = await setup();
  try {
    const patchKey = requestKey('prj-settings');
    const patched = await app.app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}`,
      payload: {
        requestKey: patchKey,
        settings: {
          docPaths: ['README.md', 'docs/原始说明.md'],
          gitlab: { inheritGlobal: false, baseUrl: 'https://gitlab.example.com', projectPath: 'group/repo' },
        },
      },
    });
    assert.equal(patched.statusCode, 200, patched.body);
    assert.equal(patched.json().data.receipt.status, 'succeeded');
    const detail = await app.app.inject({ method: 'GET', url: `/api/projects/${projectId}` });
    assert.deepEqual(detail.json().data.project.settings.docPaths, ['README.md', 'docs/原始说明.md']);
    assert.deepEqual(detail.json().data.project.settings.gitlab, { inheritGlobal: false, baseUrl: 'https://gitlab.example.com', projectPath: 'group/repo' });

    const inherited = await app.app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}`,
      payload: { requestKey: requestKey('prj-settings-inherit'), settings: { gitlab: { inheritGlobal: true } } },
    });
    assert.equal(inherited.statusCode, 200, inherited.body);
    assert.deepEqual(inherited.json().data.resource.project.settings.gitlab, { inheritGlobal: true });

    const invalidCases: readonly Record<string, unknown>[] = [
      { docPaths: ['/etc/passwd'] },
      { docPaths: ['../secret.md'] },
      { docPaths: ['README.md', 'README.md'] },
      { docPaths: Array.from({ length: 21 }, (_, index) => `doc-${String(index)}.md`) },
      { gitlab: { inheritGlobal: false } },
      { gitlab: { inheritGlobal: false, baseUrl: 'ftp://gitlab.example.com', projectPath: 'group/repo' } },
      { gitlab: { inheritGlobal: false, baseUrl: 'https://gitlab.example.com', projectPath: 'not a path' } },
      { gitlab: { inheritGlobal: 'yes' } },
    ];
    for (const settings of invalidCases) {
      const response = await app.app.inject({ method: 'PATCH', url: `/api/projects/${projectId}`, payload: { requestKey: requestKey('prj-bad'), settings } });
      assert.equal(response.statusCode, 400, `${JSON.stringify(settings)}: ${response.body}`);
      assert.equal(response.json().error.code, 'VALIDATION_FAILED');
    }
    // Nothing invalid was persisted.
    const unchanged = await app.app.inject({ method: 'GET', url: `/api/projects/${projectId}` });
    assert.deepEqual(unchanged.json().data.project.settings.docPaths, ['README.md', 'docs/原始说明.md']);
    assert.deepEqual(unchanged.json().data.project.settings.gitlab, { inheritGlobal: true });
    assert.equal((await app.app.inject({ method: 'GET', url: '/api/projects/prj_missing/charter' })).statusCode, 404);
  } finally {
    await app.close();
  }
});
