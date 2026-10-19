import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import { createRequestKey } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/index.ts';

// Actual configured opencode-go model, native question and citations. No synthetic model events.
test('live: knowledge history opens a real native question and follows up in the same conversation', { skip: process.env.AGENT_WORKFLOW_LIVE !== '1', timeout: 600_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'aw-knowledge-conversation-docs-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-knowledge-conversation-live-'));
  const docs = { 'README.md': '# Public demo rules\n交付流程依次是：提交、推送、创建合并请求。\n清理工作区前必须先停止执行并确认停稳。\n报告格式应由用户选择，可多选。\n', 'RULES.md': '# Request identity\n所有写操作必须携带 requestKey。\nUNKNOWN 只核对原请求号，不能自动重发。\n' };
  for (const [path, content] of Object.entries(docs)) writeFileSync(join(root, path), content);
  const app = await createApplication({ dataDir, port: 0, host: '127.0.0.1' });
  let web: Awaited<ReturnType<typeof createServer>> | undefined;
  let first: Promise<{ statusCode: number; body: string }> | undefined;
  try {
    await app.adapter?.ensureReady(); assert.ok(app.adapter);
    const projectResponse = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: createRequestKey(), name: '真实知识历史验收 · 临时公开规则', rootPath: root } });
    assert.equal(projectResponse.statusCode, 201, projectResponse.body); const projectId = projectResponse.json().data.resource.project.id as string;
    const gui = process.env.AGENT_WORKFLOW_GUI_REVIEW === '1';
    if (gui) { web = await createServer({ configFile: resolve('apps/web/vite.config.ts'), root: resolve('apps/web'), server: { host: '127.0.0.1', port: 5299, strictPort: true, proxy: { '/api': { target: app.url } } } }); await web.listen(); }
    const firstKey = createRequestKey();
    first = app.app.inject({ method: 'POST', url: '/api/knowledge/ask', payload: { requestKey: firstKey, projectId, sourcePaths: ['README.md','RULES.md'], question: '先调用原生 question 工具向我询问“报告需要哪些格式？”，给出 Markdown 和 HTML 两个可多选选项并允许其他回答。必须等待我的答复，只问一次；收到答复后，依据本轮文档说明交付流程与清理前提，复述我选择的格式，最终输出要求的JSON和真实引用。' } });
    void first.catch(() => {});
    const deadline = Date.now() + 480_000; let interactionId: string | undefined; let conversationId: string | undefined; let firstDone = false; let autoFollow = false;
    while (Date.now() < deadline) {
      const history = app.engine.knowledge.history(projectId); const conversation = history.conversations?.[0];
      if (conversation && conversationId === undefined) { conversationId = conversation.id; console.log('[knowledge-history-live] identity', JSON.stringify({ url: gui ? 'http://127.0.0.1:5299/knowledge/history' : app.url, projectId, conversationId, requestKey: firstKey })); }
      const interaction = app.engine.runtimeInteractions.list().find((item) => item.binding.knowledgeRequestKey === firstKey && item.kind === 'question');
      if (interaction && !interactionId) { interactionId = interaction.id; assert.equal(conversation?.state, 'needs_answer'); assert.equal(interaction.binding.taskId, undefined); console.log('[knowledge-history-live] needs_answer', JSON.stringify({ interactionId, sessionId: interaction.binding.sessionId, conversationId, questions: app.engine.runtimeInteractions.view(interaction).questions })); }
      if (!gui && interaction?.state === 'open') {
        const question = app.engine.runtimeInteractions.view(interaction).questions[0]!; const values = question.options?.filter((option) => /Markdown|HTML/.test(option.label)).map((option) => option.id) ?? [];
        assert.equal(values.length, 2); const answer = await app.app.inject({ method: 'POST', url: `/api/runtime-interactions/${interaction.id}/resolve`, payload: { requestKey: createRequestKey(), confirmResolve: true, action: 'answer', answers: [{ questionId: question.id, values, other: 'PDF' }] } }); assert.equal(answer.statusCode, 200, answer.body); assert.equal(answer.json().data.receipt.status, 'succeeded');
      }
      if (app.engine.commands.get(firstKey)?.status === 'succeeded' && !firstDone) {
        firstDone = true; const response: { statusCode: number; body: string } = await first!; assert.equal(response.statusCode, 200, response.body); assert.ok(interactionId, 'must observe an actual native question');
        const result = app.engine.knowledge.result(firstKey, projectId); assert.ok((result.usage?.total ?? 0) > 0); assert.ok(result.citations.length > 0); assert.match(result.answer, /Markdown|HTML/);
        const progress = app.engine.knowledge.progress(firstKey, projectId); assert.equal(progress.sessionId, app.engine.runtimeInteractions.get(interactionId).binding.sessionId); assert.equal(progress.status, 'completed');
        for (const citation of result.citations) { const source = docs[citation.path as keyof typeof docs]; assert.ok(source); assert.ok(citation.line >= 1 && citation.line <= source.split('\n').length); }
        console.log('[knowledge-history-live] first_complete', JSON.stringify({ conversationId, sessionId: progress.sessionId, model: result.model, usage: result.usage?.total, answer: result.answer, citations: result.citations }));
      }
      if (!gui && firstDone && !autoFollow) { autoFollow = true; const follow = await app.app.inject({ method: 'POST', url: '/api/knowledge/ask', payload: { requestKey: createRequestKey(), projectId, conversationId, sourcePaths: ['README.md','RULES.md'], question: '继续追问：刚才的这些写操作需要携带什么标识？UNKNOWN应该如何处理？请给出文档引用。' } }); assert.equal(follow.statusCode, 200, follow.body); }
      if (firstDone && conversation?.messageCount === 2 && conversation.state === 'completed') {
        const entries = history.entries.filter((entry) => entry.conversationId === conversationId); assert.equal(entries.length, 2); const follow = entries.find((entry) => entry.requestKey !== firstKey)!; assert.ok((follow.usage?.total ?? 0) > 0); assert.ok(follow.citations.length > 0); assert.match(follow.answer, /requestKey|请求号/); assert.equal(follow.model, app.engine.knowledge.result(firstKey, projectId).model);
        console.log('[knowledge-history-live] followup_complete', JSON.stringify({ conversationId, messageCount: conversation.messageCount, model: follow.model, usage: follow.usage?.total, answer: follow.answer, citations: follow.citations })); if (gui) await new Promise((resolve) => setTimeout(resolve, 30_000)); return;
      }
      if (['failed','unknown'].includes(app.engine.commands.get(firstKey)?.status ?? '')) throw new Error(`First ask ${app.engine.commands.get(firstKey)?.status}: ${app.engine.commands.get(firstKey)?.error?.message}`);
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    assert.fail('real knowledge question + follow-up did not finish within the deadline');
  } finally { await web?.close(); await app.close(); }
});
