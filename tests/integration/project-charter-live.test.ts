import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequestKey } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/application.ts';
import type { CharterSourceContext } from '../../packages/engine/src/project-charter-context.ts';

test('live: actual project facts produce a charter draft and a separate confirmation writes the identical content', { skip: process.env.AGENT_WORKFLOW_LIVE !== '1', timeout: 600_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'aw-charter-live-repo-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-charter-live-data-'));
  mkdirSync(join(root, 'spec'));
  writeFileSync(join(root, 'README.md'), '# Cedar Ledger\n项目是本地库存工具。开发约定：库存数量字段必须为非负整数。测试保存在 spec/。\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'cedar-ledger', type: 'module', scripts: { test: 'node --test spec/*.test.mjs' } }, null, 2));
  writeFileSync(join(root, 'spec/stock.test.mjs'), "import { test } from 'node:test';\ntest('stock', () => {});\n");
  for (const args of [['init', '-q', '-b', 'main'], ['config', 'user.name', 'Live Evidence'], ['config', 'user.email', 'live@example.invalid'], ['add', '.'], ['commit', '-qm', 'fixture']]) execFileSync('git', args, { cwd: root });
  const app = await createApplication({ dataDir, port: 0, host: '127.0.0.1' });
  const post = async (url: string, body: object) => {
    const response = await app.app.inject({ method: 'POST', url, payload: { requestKey: createRequestKey(), ...body } });
    assert.ok(response.statusCode < 300, response.body); return response.json().data;
  };
  try {
    await app.adapter!.ensureReady();
    const project = (await post('/api/projects', { name: '项目公约真实模型验收', rootPath: root })).resource.project;
    console.log('[charter-live] identity', JSON.stringify({ url: app.url, dataDir, root, projectId: project.id }));
    if (process.env.AGENT_WORKFLOW_GUI_REVIEW !== '1') await post(`/api/projects/${project.id}/charter/generate`, { confirmGenerate: true });
    const deadline = Date.now() + 480_000; let draftSeen = false; let observedContent: string | undefined; let sourceKey: string | undefined;
    while (Date.now() < deadline) {
      const view = await app.engine.charters.view(project.id);
      if (view.generation && !sourceKey) { sourceKey = view.generation.requestKey; console.log('[charter-live] generation', JSON.stringify(view.generation)); }
      if (view.status === 'draft' && !draftSeen) {
        assert.equal(existsSync(join(root, 'AGENTS.md')), false, 'generation must not write the file');
        assert.match(view.draft!.content, /Cedar|cedar/); assert.match(view.draft!.content, /spec/); assert.match(view.draft!.content, /非负|non.negative/i);
        observedContent = view.draft!.content; draftSeen = true; console.log('[charter-live] draft', JSON.stringify(view.draft));
        if (process.env.AGENT_WORKFLOW_GUI_REVIEW !== '1') await post(`/api/projects/${project.id}/charter/confirm`, { confirmWrite: true, expectedVersion: view.draft!.version });
      }
      if (view.status === 'written') {
        assert.ok(draftSeen); assert.ok(sourceKey);
        assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), observedContent);
        const context = app.store.settings.getJson<CharterSourceContext>(`charter.context.${sourceKey}`)!;
        assert.ok(context.files.some((file) => file.path === 'package.json' && file.content.includes('spec/*.test.mjs')));
        assert.equal(app.engine.commands.get(sourceKey)?.status, 'succeeded');
        console.log('[charter-live] written', JSON.stringify({ version: view.written!.version, requestKey: sourceKey, sources: context.files.map(({ path, sha256 }) => ({ path, sha256 })) }));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.fail('charter generation and separate write confirmation must complete');
  } finally { await app.close(); }
});
