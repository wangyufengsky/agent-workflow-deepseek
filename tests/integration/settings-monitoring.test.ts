import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppError, ErrorCode } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/index.ts';

function requestKey(prefix: string): string {
  return `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;
}

test('monitoring poll interval is persisted, validated and merged into bootstrap settings', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-settings-'));
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    assert.equal(new AppError(ErrorCode.OPENCODE_SESSION_LIMIT, 'limit').httpStatus, 429);
    const bootstrap = await app.app.inject({ method: 'GET', url: '/api/bootstrap' });
    assert.equal(bootstrap.statusCode, 200, bootstrap.body);
    assert.equal(bootstrap.json().data.app.listenAddress, undefined, 'a non-listening service must not report the configured port as a live socket');
    assert.equal(bootstrap.json().data.settings.monitoring.pollIntervalMs, 1500);
    assert.equal(bootstrap.json().data.settings.monitoring.sessionAlertThreshold, 8);

    const update = await app.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { requestKey: requestKey('set'), patch: { monitoring: { pollIntervalMs: 2500 } } },
    });
    assert.equal(update.statusCode, 200, update.body);
    const after = await app.app.inject({ method: 'GET', url: '/api/bootstrap' });
    assert.equal(after.json().data.settings.monitoring.pollIntervalMs, 2500);

    const models = update.json().data.settings.models as { id: string; enabled: boolean }[];
    const target = models.find((model) => model.enabled);
    assert.ok(target !== undefined);
    const toggle = await app.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { requestKey: requestKey('model'), patch: { models: models.map((model) => (model.id === target.id ? { ...model, enabled: false } : model)) } },
    });
    assert.equal(toggle.statusCode, 200, toggle.body);
    const modelsAfter = (await app.app.inject({ method: 'GET', url: '/api/bootstrap' })).json().data.settings.models as { id: string; enabled: boolean }[];
    assert.equal(modelsAfter.find((model) => model.id === target.id)?.enabled, false);

    const withCustom = await app.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: {
        requestKey: requestKey('model-add'),
        patch: {
          models: [
            ...modelsAfter,
            { id: 'custom-test', label: '自定义测试模型', provider: 'opencode-go', model: 'deepseek-v4.1-flash', roles: ['coder'], enabled: true },
          ],
        },
      },
    });
    assert.equal(withCustom.statusCode, 200, withCustom.body);
    const customModels = (await app.app.inject({ method: 'GET', url: '/api/bootstrap' })).json().data.settings.models as { id: string; roles: string[] }[];
    assert.ok(customModels.some((model) => model.id === 'custom-test'));

    const allDisabled = await app.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { requestKey: requestKey('model-all-off'), patch: { models: customModels.map((model) => ({ ...model, enabled: false })) } },
    });
    assert.equal(allDisabled.statusCode, 400, allDisabled.body);
    assert.equal(allDisabled.json().error.code, 'VALIDATION_FAILED');

    const badRole = await app.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { requestKey: requestKey('model-bad-role'), patch: { models: customModels.map((model) => (model.id === 'custom-test' ? { ...model, roles: ['unknown'] } : model)) } },
    });
    assert.equal(badRole.statusCode, 400, badRole.body);

    const toolset = await app.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { requestKey: requestKey('tools'), patch: { opencode: { toolsets: ['git', 'workspace'] } } },
    });
    assert.equal(toolset.statusCode, 200, toolset.body);
    const toolsetAfter = (await app.app.inject({ method: 'GET', url: '/api/bootstrap' })).json().data.settings.opencode.toolsets as string[];
    assert.deepEqual(toolsetAfter, ['git', 'workspace']);
    const emptyToolsets = await app.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { requestKey: requestKey('toolsbad'), patch: { opencode: { toolsets: [] } } },
    });
    assert.equal(emptyToolsets.statusCode, 400, emptyToolsets.body);

    const threshold = await app.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { requestKey: requestKey('threshold'), patch: { monitoring: { sessionAlertThreshold: 3 } } },
    });
    assert.equal(threshold.statusCode, 200, threshold.body);
    assert.equal((await app.app.inject({ method: 'GET', url: '/api/bootstrap' })).json().data.settings.monitoring.sessionAlertThreshold, 3);
    const badThreshold = await app.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { requestKey: requestKey('thresholdbad'), patch: { monitoring: { sessionAlertThreshold: 0 } } },
    });
    assert.equal(badThreshold.statusCode, 400, badThreshold.body);

    const invalid = await app.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { requestKey: requestKey('bad'), patch: { monitoring: { pollIntervalMs: 100 } } },
    });
    assert.equal(invalid.statusCode, 400, invalid.body);
    assert.equal(invalid.json().error.code, 'VALIDATION_FAILED');
  } finally {
    await app.close();
  }
});

test('bootstrap reports the actual assigned listening port independently from persisted server settings', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-listen-address-'));
  const application = await createApplication({ dataDir, disableOpenCode: true, host: '127.0.0.1', port: 0 });
  try {
    const response = await fetch(`${application.url}/api/bootstrap`);
    assert.equal(response.status, 200);
    const body = await response.json() as { data: { app: { listenAddress?: string }; settings: { server: { port: number } } } };
    const socket = application.app.server.address();
    assert.ok(socket && typeof socket === 'object');
    assert.ok(socket.port > 0);
    assert.equal(body.data.app.listenAddress, `127.0.0.1:${socket.port}`);
    assert.equal(body.data.settings.server.port, application.engine.settings.server.port, 'reading live metadata must not rewrite stored configuration');
  } finally { await application.close(); }
});
