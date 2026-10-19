#!/usr/bin/env node
/**
 * Model smoke test against the configured OpenCode Go provider.
 * Requires an authenticated OpenCode 1.19.0 installation. This spends a small
 * amount of model usage; the user explicitly authorized opencode-go testing.
 */
import { createApplication } from '../packages/server/src/index.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = process.env.AGENT_WORKFLOW_DATA_DIR ?? mkdtempSync(join(tmpdir(), 'aw-model-'));
console.log(`[model-smoke] data dir: ${dataDir}`);
const app = await createApplication({ dataDir, port: 0, host: '127.0.0.1' });
try {
  if (app.adapter === undefined) throw new Error('OpenCode adapter disabled');
  console.log('[model-smoke] starting managed OpenCode…');
  await app.adapter.ensureReady();
  console.log('[model-smoke] status:', JSON.stringify(app.adapter.status()));
  const diagnostics = await app.adapter.diagnostics();
  console.log('[model-smoke] mcp status:', JSON.stringify(diagnostics.mcp));
  const result = await app.adapter.runSession({
    kind: 'planning',
    metadata: { probe: 'model-smoke' },
    cwd: app.paths.repoRoot,
    prompt: 'Reply with exactly the two characters OK and nothing else. Do not call any tools.',
    model: app.engine.settings.models.find((model) => model.roles.includes('planner')) ?? app.engine.settings.models[0],
    permission: 'read_only',
    sink: {
      onTextDelta: (delta) => process.stdout.write(delta),
    },
    timeoutMs: 120000,
  });
  console.log('\n[model-smoke] outcome:', JSON.stringify({ idle: result.outcome.idle, timedOut: result.outcome.timedOut, error: result.outcome.error, text: result.outcome.assistantText }));
  if (result.outcome.error !== undefined) process.exitCode = 1;
  if (result.outcome.assistantText.trim() === '') {
    console.error('[model-smoke] FAIL: empty assistant text');
    process.exitCode = 1;
  } else {
    console.log('[model-smoke] PASS: received model text');
  }
} catch (error) {
  console.error('[model-smoke] FAIL:', error);
  process.exitCode = 1;
} finally {
  await app.close();
}
