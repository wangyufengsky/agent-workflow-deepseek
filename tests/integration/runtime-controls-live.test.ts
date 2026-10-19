import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, createRequestKey } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/application.ts';

test('live: autoStart=false remains stopped until GUI start, then actual restart has its own settled receipt and process', { skip: process.env.AGENT_WORKFLOW_LIVE !== '1', timeout: 600_000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-runtime-controls-'));
  const app = await createApplication({ dataDir, port: 0, host: '127.0.0.1', settings: { opencode: { ...DEFAULT_SETTINGS.opencode, autoStart: false } } });
  try {
    assert.ok(app.adapter);
    assert.equal(app.adapter.status().state, 'stopped');
    assert.equal(app.adapter.status().pid, undefined);
    assert.equal(app.store.operations.listRecentFor(['opencode.start', 'opencode.restart']).length, 0);
    console.log('[runtime-live] identity', JSON.stringify({ url: app.url, dataDir, state: app.adapter.status().state }));
    const post = async (action: 'start' | 'restart') => {
      const response = await app.app.inject({ method: 'POST', url: `/api/opencode/${action}`, payload: { requestKey: createRequestKey(), [action === 'start' ? 'confirmStart' : 'confirmRestart']: true } });
      assert.equal(response.statusCode, 200, response.body);
    };
    if (process.env.AGENT_WORKFLOW_GUI_REVIEW !== '1') await post('start');
    const deadline = Date.now() + 480_000; let originalPid: number | undefined;
    while (Date.now() < deadline) {
      const operations = app.store.operations.listRecentFor(['opencode.start', 'opencode.restart']);
      const start = operations.find((operation) => operation.operation === 'opencode.start');
      const restart = operations.find((operation) => operation.operation === 'opencode.restart');
      if (start?.status === 'succeeded' && originalPid === undefined) {
        originalPid = app.adapter.status().pid; assert.ok(originalPid);
        console.log('[runtime-live] started', JSON.stringify({ requestKey: start.requestKey, pid: originalPid }));
        if (process.env.AGENT_WORKFLOW_GUI_REVIEW !== '1') await post('restart');
      }
      if (restart?.status === 'succeeded') {
        assert.equal(app.adapter.status().state, 'ready'); assert.ok(app.adapter.status().pid);
        assert.notEqual(app.adapter.status().pid, originalPid);
        assert.equal(operations.length, 2);
        console.log('[runtime-live] restarted', JSON.stringify({ requestKey: restart.requestKey, pid: app.adapter.status().pid, state: app.adapter.status().state }));
        // Leave time for the GUI to capture the terminal receipt, not just the process state.
        if (process.env.AGENT_WORKFLOW_GUI_REVIEW === '1') await new Promise((resolve) => setTimeout(resolve, 15_000));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.fail('actual start and restart must complete');
  } finally { await app.close(); }
});
