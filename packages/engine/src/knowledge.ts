import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AppError,
  ErrorCode,
  createId,
  nowIso,
  type CommandResponse,
  type KnowledgeAskRequest,
  type KnowledgeAskResponse,
  type KnowledgeHistoryEntry,
  type KnowledgeHistoryResponse,
  type ModelProfile,
} from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';
import type { EngineContext } from './actions.ts';
import type { CommandService } from './operations.ts';
import type { OpenCodePort } from './ports.ts';
import { listKnowledgeSources } from '../../server/src/knowledge.ts';

const MAX_DOCS = 12;
const MAX_DOC_CHARS = 6_000;

export interface KnowledgeServiceOptions {
  readonly store: Store;
  readonly commands: CommandService;
  readonly context: EngineContext;
  readonly opencode: OpenCodePort;
}

/** Single-shot, read-only document Q&A; no conversation history is persisted. */
export class KnowledgeService {
  readonly #store: Store;
  readonly #commands: CommandService;
  readonly #context: EngineContext;
  readonly #opencode: OpenCodePort;

  constructor(options: KnowledgeServiceOptions) {
    this.#store = options.store;
    this.#commands = options.commands;
    this.#context = options.context;
    this.#opencode = options.opencode;
  }

  async ask(input: KnowledgeAskRequest): Promise<CommandResponse<KnowledgeAskResponse>> {
    if (input === null || typeof input !== 'object') throw new AppError(ErrorCode.VALIDATION_FAILED, '知识库请求体不合法');
    const question = typeof input.question === 'string' ? input.question.trim() : '';
    if (question.length < 2 || question.length > 2_000) throw new AppError(ErrorCode.VALIDATION_FAILED, '问题长度需要在 2–2000 字之间');
    const project = this.#store.projects.get(input.projectId);
    if (project === undefined) throw new AppError(ErrorCode.NOT_FOUND, '项目不存在');
    const model = this.#model();
    if (this.#context.opencodeReady() !== true) throw new AppError(ErrorCode.OPENCODE_NOT_READY, '受管 OpenCode 未就绪，无法问答');
    const sources = listKnowledgeSources(project.rootPath).slice(0, MAX_DOCS);
    if (sources.length === 0) throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, '项目里没有可读的文档来源');
    const documents = sources.map((source) => {
      let content = '';
      try {
        content = readFileSync(join(project.rootPath, source.path), 'utf8').slice(0, MAX_DOC_CHARS);
      } catch {
        content = '';
      }
      return { path: source.path, content };
    }).filter((document) => document.content !== '');
    if (documents.length === 0) throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, '文档来源不可读');
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'knowledge.ask',
      body: { projectId: input.projectId, question },
      target: { projectId: input.projectId },
    });
    if (replayed && record.status !== 'accepted') throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '同一请求号已经受理，请按回执核对');
    try {
      const result = await this.#opencode.runSession({
        kind: 'review',
        metadata: { projectId: input.projectId, purpose: 'knowledge.ask' },
        cwd: project.rootPath,
        prompt: buildPrompt(question, documents),
        system: SYSTEM_PROMPT,
        model,
        permission: 'read_only',
        sink: {},
        timeoutMs: 120_000,
      });
      if (result.outcome.timedOut) throw new AppError(ErrorCode.MODEL_BUDGET_EXCEEDED, '知识问答超时，请缩小问题范围后重试');
      if (result.outcome.error !== undefined && result.outcome.error !== '') {
        throw new AppError(ErrorCode.OPENCODE_PROVIDER_FAILED, `知识问答失败：${result.outcome.error}`);
      }
      const parsed = extractJson(result.outcome.assistantText ?? '');
      if (parsed === undefined || typeof parsed.answer !== 'string') {
        throw new AppError(ErrorCode.VALIDATION_FAILED, '模型输出不是约定的 JSON（缺少 answer），未生成问答结果');
      }
      const citations = validateCitations(parsed.citations, documents);
      const response: KnowledgeAskResponse = {
        projectId: input.projectId,
        question,
        answer: parsed.answer.trim().slice(0, 8_000),
        citations,
        model: `${model.provider}/${model.model}`,
        generatedAt: nowIso(),
      };
      const entry: KnowledgeHistoryEntry = { id: createId('knowledge'), ...response };
      const key = historyKey(input.projectId);
      const history = this.#store.settings.getJson<KnowledgeHistoryEntry[]>(key) ?? [];
      this.#store.settings.putJson(key, [entry, ...history].slice(0, 30));
      this.#commands.settle(input.requestKey, { citations: citations.length, historyId: entry.id });
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: response };
    } catch (error) {
      this.#commands.fail(input.requestKey, error instanceof Error ? error : new Error('知识问答失败'));
      throw error;
    }
  }

  history(projectId: string): KnowledgeHistoryResponse {
    if (this.#store.projects.get(projectId) === undefined) throw new AppError(ErrorCode.NOT_FOUND, '项目不存在');
    return { entries: this.#store.settings.getJson<KnowledgeHistoryEntry[]>(historyKey(projectId)) ?? [] };
  }

  #model(): ModelProfile {
    const models = this.#context.settings().models;
    const model = models.find((item) => item.enabled && item.roles.includes('reviewer')) ?? models.find((item) => item.enabled);
    if (model === undefined) throw new AppError(ErrorCode.MODEL_NOT_CONFIGURED, '没有启用的模型可用于知识问答');
    return model;
  }
}

const SYSTEM_PROMPT = `你是项目知识库的研究员。只依据用户提供的文档回答问题，不要编造文档之外的事实。
只输出一个 JSON 对象，不要 Markdown：
{"answer":"回答（可多句）","citations":[{"path":"文档相对路径","line":行号,"snippet":"该行原文"}]}
line 必须来自文档真实行号；answer 中引用的每个关键结论都要有 citation。文档不足时明确说“文档中没有足够依据”。`;

function buildPrompt(question: string, documents: readonly { path: string; content: string }[]): string {
  const blocks = documents.map((document, index) => `--- 文档 ${index + 1}：${document.path}\n${document.content}`).join('\n\n');
  return `问题：${question}\n\n可用文档（只读，路径用于引用）：\n${blocks}`;
}

function extractJson(text: string): { answer?: unknown; citations?: unknown } | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    return { answer: parsed.answer, citations: parsed.citations };
  } catch {
    return undefined;
  }
}

function validateCitations(raw: unknown, documents: readonly { path: string; content: string }[]): KnowledgeAskResponse['citations'] {
  if (!Array.isArray(raw)) return [];
  const byPath = new Map(documents.map((document) => [document.path, document.content.split(/\r?\n/).length]));
  const citations: KnowledgeAskResponse['citations'][number][] = [];
  for (const entry of raw.slice(0, 12)) {
    if (entry === null || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const path = typeof record.path === 'string' ? record.path : '';
    const line = typeof record.line === 'number' && Number.isInteger(record.line) ? record.line : 0;
    const total = byPath.get(path);
    if (total === undefined || line < 1 || line > total) continue;
    const snippet = typeof record.snippet === 'string' ? record.snippet.trim().slice(0, 300) : '';
    citations.push({ path, line, ...(snippet === '' ? {} : { snippet }) });
  }
  return citations;
}


function historyKey(projectId: string): string {
  return `knowledge.history.${projectId}`;
}
