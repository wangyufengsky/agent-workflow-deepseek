import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OpenCodeMessage } from '@agent-workflow/opencode';
import { Engine, type EnginePorts, type OpenCodePort, type OpenCodeRunRequest, type OpenCodeRunResult } from '../../packages/engine/src/index.ts';
import { Store } from '@agent-workflow/storage';

class FakeOpenCode implements OpenCodePort {
  readonly requests: OpenCodeRunRequest[] = [];
  messages: readonly OpenCodeMessage[] = [];
  assistantText = '';
  timedOut = false;

  status(): ReturnType<OpenCodePort['status']> {
    return { state: 'ready' } as ReturnType<OpenCodePort['status']>;
  }

  async ensureReady(): Promise<void> {
    return;
  }

  async runSession(request: OpenCodeRunRequest): Promise<OpenCodeRunResult> {
    this.requests.push(request);
    return {
      sessionId: 'sess_knowledge_fake',
      outcome: { idle: true, timedOut: this.timedOut, assistantText: this.assistantText, messages: this.messages },
    };
  }

  async abortSession(): Promise<void> {
    return;
  }

  async findSessions(): Promise<readonly never[]> {
    return [];
  }
}

function setup(): { store: Store; engine: Engine; opencode: FakeOpenCode; projectId: string; close: () => void } {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-knowledge-steps-'));
  const rootPath = mkdtempSync(join(tmpdir(), 'aw-knowledge-repo-'));
  writeFileSync(join(rootPath, 'README.md'), '# Demo\n\n这是项目说明。\n', 'utf8');
  const store = new Store({ dataDir });
  const opencode = new FakeOpenCode();
  const ports = { git: {} as EnginePorts['git'], opencode } satisfies EnginePorts;
  const engine = new Engine({ store, ports, integration: { opencodeReady: () => true, gitlabConfigured: () => false } });
  const project = store.projects.create({ name: 'Knowledge', rootPath, gitState: 'not_git' });
  return { store, engine, opencode, projectId: project.id, close: () => store.close() };
}

function requestKey(prefix: string): string {
  return `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;
}

const ANSWER = JSON.stringify({ answer: '这是一个演示项目。', citations: [{ path: 'README.md', line: 1, snippet: '# Demo' }] });

function assistantMessage(options: { readonly withTime: boolean; readonly withTool: boolean }): OpenCodeMessage {
  const created = Date.now() - 500;
  const completed = created + 300;
  return {
    info: {
      id: 'msg_assistant_1',
      sessionID: 'sess_knowledge_fake',
      role: 'assistant',
      ...(options.withTime ? { time: { created, completed } } : {}),
    },
    parts: [
      ...(options.withTool
        ? [{
            id: 'part_tool_1',
            type: 'tool',
            tool: 'read',
            callID: 'call_read_1',
            state: {
              status: 'completed',
              title: '读取 README.md',
              output: '# Demo',
              time: { start: created + 10, end: created + 120 },
            },
          }]
        : []),
      { id: 'part_text_1', type: 'text', text: ANSWER },
    ],
  };
}

test('W3-4b knowledge: real tool parts and message timing become steps/toolActivity (also in history)', async () => {
  const fixture = setup();
  try {
    const { engine, opencode, projectId } = fixture;
    opencode.assistantText = ANSWER;
    opencode.messages = [assistantMessage({ withTime: true, withTool: true })];
    const result = await engine.knowledge.ask({ requestKey: requestKey('knowledge-tool'), projectId, question: '这个项目是什么？' });
    assert.equal(result.receipt.status, 'succeeded');
    const response = result.resource!;
    const steps = response.steps ?? [];
    const kinds = steps.map((step) => step.kind);
    assert.ok(kinds.includes('retrieve'), JSON.stringify(kinds));
    assert.ok(kinds.includes('model'), JSON.stringify(kinds));
    assert.ok(kinds.includes('tool'), JSON.stringify(kinds));
    assert.ok(kinds.includes('validate'), JSON.stringify(kinds));
    const retrieve = steps.find((step) => step.kind === 'retrieve')!;
    assert.match(retrieve.label, /读取 1 份文档/);
    assert.match(String(retrieve.detail), /README\.md/);
    assert.ok(retrieve.startedAt.length > 0);
    const model = steps.find((step) => step.kind === 'model')!;
    assert.equal(model.label, '模型回答');
    assert.equal(model.status, 'succeeded');
    assert.ok(model.startedAt < model.endedAt!);
    assert.ok((model.durationMs ?? -1) >= 0);
    const tool = steps.find((step) => step.kind === 'tool')!;
    assert.equal(tool.label, 'read');
    assert.equal(tool.status, 'succeeded');
    assert.equal(tool.id, 'call_read_1');
    assert.match(String(tool.detail), /README\.md/);
    const validate = steps.find((step) => step.kind === 'validate')!;
    assert.match(String(validate.detail), /接受 1 条引用/);
    assert.equal(response.toolActivity?.length, 1);
    assert.deepEqual(
      { name: response.toolActivity?.[0]?.name, status: response.toolActivity?.[0]?.status, summary: response.toolActivity?.[0]?.summary, callId: response.toolActivity?.[0]?.callId },
      { name: 'read', status: 'succeeded', summary: '读取 README.md', callId: 'call_read_1' },
    );
    assert.ok(response.toolActivity?.[0]?.startedAt !== undefined && response.toolActivity?.[0]?.endedAt !== undefined);

    const history = engine.knowledge.history(projectId).entries;
    assert.equal(history.length, 1);
    assert.equal(history[0]?.steps?.length, steps.length);
    assert.equal(history[0]?.toolActivity?.length, 1);
  } finally {
    fixture.close();
  }
});

test('W3-4b knowledge: no real tool parts means no toolActivity and no fabricated tool step', async () => {
  const fixture = setup();
  try {
    const { engine, opencode, projectId } = fixture;
    opencode.assistantText = ANSWER;
    opencode.messages = [assistantMessage({ withTime: true, withTool: false })];
    const result = await engine.knowledge.ask({ requestKey: requestKey('knowledge-notool'), projectId, question: '这个项目是什么？' });
    const response = result.resource!;
    assert.equal(response.toolActivity, undefined, 'toolActivity is omitted instead of returning an invented/fixed list');
    const kinds = (response.steps ?? []).map((step) => step.kind);
    assert.deepEqual([...kinds].sort(), ['model', 'retrieve', 'validate']);
  } finally {
    fixture.close();
  }
});

test('W3-4b knowledge: missing runtime timings are omitted (no steps invented) and failures stay failed', async () => {
  const fixture = setup();
  try {
    const { engine, opencode, projectId } = fixture;
    opencode.assistantText = ANSWER;
    opencode.messages = [assistantMessage({ withTime: false, withTool: false })];
    const withoutTime = await engine.knowledge.ask({ requestKey: requestKey('knowledge-notime'), projectId, question: '这个项目是什么？' });
    const kinds = (withoutTime.resource?.steps ?? []).map((step) => step.kind);
    assert.deepEqual([...kinds].sort(), ['retrieve', 'validate'], 'no assistant time means no model step');

    opencode.assistantText = '这不是 JSON';
    opencode.messages = [assistantMessage({ withTime: true, withTool: false })];
    const badKey = requestKey('knowledge-bad');
    await assert.rejects(
      () => engine.knowledge.ask({ requestKey: badKey, projectId, question: '这个项目是什么？' }),
      (error: unknown) => (error as { code?: string }).code === 'VALIDATION_FAILED',
    );
    assert.equal(fixture.store.operations.get(badKey)?.status, 'failed');
    assert.equal(engine.knowledge.history(projectId).entries.length, 1, 'failed answer is not persisted');
  } finally {
    fixture.close();
  }
});
