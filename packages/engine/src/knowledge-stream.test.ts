import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partialKnowledgeAnswer } from './knowledge-stream.ts';
test('only completed JSON string escapes enter the streamed answer', () => {
  assert.equal(partialKnowledgeAnswer('some preamble'), '');
  assert.equal(partialKnowledgeAnswer('{"answer":"one'), 'one');
  assert.equal(partialKnowledgeAnswer('{"answer":"one' + String.raw`\u4e`), 'one');
  assert.equal(partialKnowledgeAnswer('{"answer":"one' + String.raw`\u4e2d`), 'one中');
  assert.equal(partialKnowledgeAnswer('{"answer":"one","citations":['), 'one');
  assert.equal(partialKnowledgeAnswer('{"answer":"one' + String.raw`\nnext`), 'one\nnext');
});
