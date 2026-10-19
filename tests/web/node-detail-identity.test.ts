import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchNodeDetail } from '../../apps/web/src/api/workflow.ts';
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
test('node detail client rejects late task/node/attempt responses rather than displaying a different history', async () => {
  let url = '';
  let data: unknown = { taskId: 'task-a', nodeId: 'node-a', selectedAttempt: { id: 'old-attempt' } };
  globalThis.fetch = async (input) => { url = String(input); return new Response(JSON.stringify({ data, meta: {} }), { status: 200 }); };
  assert.equal((await fetchNodeDetail('task-a', 'node-a', 'old-attempt')).selectedAttempt?.id, 'old-attempt');
  assert.match(url, /attemptId=old-attempt/);
  for (const response of [
    { taskId: 'task-b', nodeId: 'node-a', selectedAttempt: { id: 'old-attempt' } },
    { taskId: 'task-a', nodeId: 'node-b', selectedAttempt: { id: 'old-attempt' } },
    { taskId: 'task-a', nodeId: 'node-a', selectedAttempt: { id: 'current-attempt' } },
    { taskId: 'task-a', nodeId: 'node-a' },
  ]) {
    data = response;
    await assert.rejects(fetchNodeDetail('task-a', 'node-a', 'old-attempt'), /身份不一致/);
  }
});
