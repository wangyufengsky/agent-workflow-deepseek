import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../../packages/server/src/index.ts';

/**
 * Verifies the loopback provider compatibility gateway: deepseek-v4.1-flash
 * rejects tool_choice in thinking mode, so the gateway strips it while MCP tools
 * are present. Off by default; run with AGENT_WORKFLOW_LIVE=1.
 */
const live = process.env.AGENT_WORKFLOW_LIVE === '1';

function requestKey(prefix: string): string {
  return `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;
}

function createRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'aw-gw-repo-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# gateway demo\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  return root;
}

test('live: flash model via provider gateway can use MCP and submit a plan', { skip: !live, timeout: 300000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-gw-data-'));
  const app = await createApplication({
    dataDir,
    port: 0,
    host: '127.0.0.1',
    settings: {
      models: [
        {
          id: 'planner-flash-gateway',
          label: '规划 · opencode-go/deepseek-v4.1-flash (gateway)',
          provider: 'opencode-go',
          model: 'deepseek-v4.1-flash',
          roles: ['planner', 'coder'],
          enabled: true,
        },
      ],
    },
  });
  try {
    assert.ok(app.adapter);
    await app.adapter.ensureReady();
    const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: requestKey('prj'), name: 'Gateway', rootPath: createRepo() } });
    const projectId = project.json().data.resource.project.id;
    const task = await app.app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        requestKey: requestKey('task'),
        projectId,
        title: 'README 增加快速开始',
        requirementText: 'R1 在 README 增加快速开始一节。\n验收：README 有该小节。',
        methodId: 'method.defect-fix',
      },
    });
    const taskId = task.json().data.resource.task.id;
    const preview = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/planning/preview`, payload: {} });
    assert.equal(preview.statusCode, 200, preview.body);
    assert.deepEqual(preview.json().data.preview.blockers, []);
    const start = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/planning/start`,
      payload: { requestKey: requestKey('start'), previewId: preview.json().data.preview.previewId, confirmModelDispatch: true, sourceInputRevision: preview.json().data.preview.sourceInputRevision },
    });
    assert.equal(start.statusCode, 200, start.body);
    let round: any;
    const deadline = Date.now() + 240000;
    while (Date.now() < deadline) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 2500));
      const detail = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/detail` });
      round = detail.json().data.planning.rounds[0];
      if (round !== undefined && ['completed', 'failed', 'stopped', 'unknown'].includes(round.status)) break;
    }
    console.log('[gateway-live] round:', JSON.stringify({ status: round?.status, stage: round?.stage, candidate: round?.candidate?.summary?.slice(0, 100) }));
    const status = await app.app.inject({ method: 'GET', url: '/api/opencode/status' });
    const gateway = status.json().data.status.gateway;
    console.log('[gateway-live] gateway:', JSON.stringify(gateway));
    assert.ok(round?.candidate !== undefined, `candidate expected: ${JSON.stringify(round?.failure)}`);
    assert.equal(round.status, 'completed');
    assert.ok(gateway.requests > 0, 'gateway should have forwarded provider requests');
    assert.ok(gateway.normalized > 0, 'gateway should have stripped tool_choice for flash');
  } finally {
    await app.close();
  }
});
