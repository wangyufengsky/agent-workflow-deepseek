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
    assert.ok(!paths.includes('app.ts'));
    assert.ok(sources.every((source) => source.bytes > 0));
    const missing = await app.app.inject({ method: 'GET', url: '/api/knowledge/sources' });
    assert.equal(missing.statusCode, 400, missing.body);
  } finally {
    await app.close();
  }
});
