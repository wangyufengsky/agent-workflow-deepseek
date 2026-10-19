import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolFeed } from './tool-feed.ts';
import type { OutputFragment } from '@agent-workflow/shared';

test('late updates stay at original call position and never merge distinct calls of the same tool', () => {
  const event = (seq: number, callId?: string, status = 'running'): OutputFragment => ({ seq, fragmentId: `f${seq}`, category: callId ? 'tool_activity' : 'model_text', text: `event${seq}`, ...(callId ? { toolCallRef: { callId, status, source: 'opencode' } } : {}) });
  const result = toolFeed([event(1, 'a'), event(2, 'b'), event(3), event(4, 'b', 'completed'), event(5, 'a', 'failed')]);
  assert.equal(result.length, 3);
  assert.equal(result[0]!.fragmentId, 'f1');
  assert.equal(result[0]!.toolCallRef!.status, 'failed');
  assert.equal(result[1]!.fragmentId, 'f2');
  assert.equal(result[1]!.toolCallRef!.status, 'completed');
  assert.equal(result[2]!.text, 'event3');
});
