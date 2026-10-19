import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../../packages/server/src/index.ts';

function requestKey(prefix: string): string {
  return `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;
}

function createRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'aw-kb-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# knowledge\n', 'utf8');
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'design.md'), '# design\n', 'utf8');
  writeFileSync(join(root, 'app.ts'), 'export const x = 1;\n', 'utf8');
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  writeFileSync(join(root, 'node_modules', 'ignored.md'), '# ignored\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  return root;
}

test('knowledge sources lists project docs read-only and skips ignored directories', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-kb-data-')), disableOpenCode: true, disableListen: true });
  try {
    const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: requestKey('prj'), name: 'KB', rootPath: createRepo() } });
    const projectId = project.json().data.resource.project.id as string;
    const response = await app.app.inject({ method: 'GET', url: `/api/knowledge/sources?projectId=${projectId}` });
    assert.equal(response.statusCode, 200, response.body);
    const sources = response.json().data.sources as { path: string; bytes: number }[];
    const paths = sources.map((source) => source.path);
    assert.ok(paths.includes('README.md'));
    assert.ok(paths.includes('docs/design.md'));
    assert.ok(!paths.some((path) => path.startsWith('node_modules/')));
    assert.ok(paths.includes('app.ts'));
    assert.equal(response.json().data.sources.find((source: { path: string }) => source.path === 'app.ts').kind, 'code');
    assert.ok(sources.every((source) => source.bytes > 0));
    const search = await app.app.inject({ method: 'GET', url: `/api/knowledge/search?projectId=${projectId}&q=design` });
    assert.equal(search.statusCode, 200, search.body);
    const matches = search.json().data.matches as { path: string; line: number; text: string }[];
    assert.equal(matches.length, 1);
    assert.equal(matches[0]!.path, 'docs/design.md');
    assert.equal(matches[0]!.line, 1);
    const short = await app.app.inject({ method: 'GET', url: `/api/knowledge/search?projectId=${projectId}&q=x` });
    assert.equal(short.statusCode, 400, short.body);

    const content = await app.app.inject({ method: 'GET', url: `/api/knowledge/source?projectId=${projectId}&path=README.md` });
    assert.equal(content.statusCode, 200, content.body);
    assert.match(content.json().data.content as string, /# knowledge/);
    const escape = await app.app.inject({ method: 'GET', url: `/api/knowledge/source?projectId=${projectId}&path=../etc/passwd` });
    assert.equal(escape.statusCode, 400, escape.body);
    assert.equal(escape.json().error.code, 'PATH_ESCAPE');

    const ask = await app.app.inject({ method: 'POST', url: '/api/knowledge/ask', payload: { requestKey: requestKey('ask'), projectId, question: '这个项目如何做知识库？' } });
    assert.equal(ask.statusCode, 503, ask.body);
    assert.equal(ask.json().error.code, 'OPENCODE_NOT_READY');

    app.store.settings.putJson(`knowledge.history.${projectId}`, [{
      id: 'knowledge_test_1',
      projectId,
      question: '测试问题',
      answer: '测试回答',
      citations: [],
      model: 'test/model',
      generatedAt: new Date().toISOString(),
      conversationId: 'conversation_test_1',
    }]);
    const history = await app.app.inject({ method: 'GET', url: `/api/knowledge/history?projectId=${projectId}` });
    assert.equal(history.statusCode, 200, history.body);
    assert.equal(history.json().data.entries.length, 1);
    assert.equal(history.json().data.entries[0].answer, '测试回答');
    const missingHistory = await app.app.inject({ method: 'GET', url: '/api/knowledge/history?projectId=prj_unknown' });
    assert.equal(missingHistory.statusCode, 404, missingHistory.body);

    const missing = await app.app.inject({ method: 'GET', url: '/api/knowledge/sources' });
    assert.equal(missing.statusCode, 400, missing.body);
  } finally {
    await app.close();
  }
});
