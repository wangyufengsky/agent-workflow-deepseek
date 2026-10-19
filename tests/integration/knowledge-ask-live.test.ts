import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../../packages/server/src/index.ts';

const LIVE = process.env.AGENT_WORKFLOW_LIVE === '1';

function requestKey(prefix: string): string {
  return `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;
}

test('live: knowledge Q&A answers from project docs with validated citations', { skip: !LIVE, timeout: 240_000 }, async () => {
  const repo = mkdtempSync(join(tmpdir(), 'aw-kbask-repo-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), '# Demo\n\n本项目的交付流程是：提交 -> 推送 -> 创建合并请求。\n清理工作区前必须先停止执行。\n', 'utf8');
  writeFileSync(join(repo, 'docs.md'), '# 规则\n\n所有写操作都需要 requestKey。\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-kbask-')), port: 0, host: '127.0.0.1' });
  try {
    assert.ok(app.adapter);
    await app.adapter.ensureReady();
    const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: requestKey('prj'), name: 'KB Ask', rootPath: repo } });
    const projectId = project.json().data.resource.project.id as string;
    const response = await app.app.inject({
      method: 'POST',
      url: '/api/knowledge/ask',
      payload: { requestKey: requestKey('ask'), projectId, question: '本项目的交付流程是什么？清理工作区前要先做什么？' },
    });
    assert.equal(response.statusCode, 200, response.body);
    const data = response.json().data.resource as { answer: string; citations: { path: string; line: number }[]; model: string };
    console.log('[knowledge-live]', JSON.stringify({ model: data.model, answer: data.answer.slice(0, 120), citations: data.citations }));
    assert.ok(data.answer.trim().length > 0);
    assert.ok(data.citations.length > 0);
    for (const citation of data.citations) {
      assert.ok(['README.md', 'docs.md'].includes(citation.path));
      assert.ok(citation.line >= 1);
    }
    assert.ok(data.answer.includes('清理') || data.answer.includes('停止'));
  } finally {
    await app.close();
  }
});
