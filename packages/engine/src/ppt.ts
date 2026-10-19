import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError, ErrorCode, nowIso, type CommandResponse, type PptWork, type PptWorkCreateRequest, type PptWorkGenerateRequest,
  type PptWorkUpdateRequest, type PptWorksResponse } from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';
import type { CommandService } from './operations.ts';
import type { EngineContext } from './actions.ts';
import type { OpenCodePort } from './ports.ts';
import { listKnowledgeSources } from '../../server/src/knowledge.ts';

export class PptService {
  readonly #store: Store;
  readonly #commands: CommandService;
  readonly #context: EngineContext;
  readonly #opencode: OpenCodePort;

  constructor(store: Store, commands: CommandService, context: EngineContext, opencode: OpenCodePort) {
    this.#store = store;
    this.#commands = commands;
    this.#context = context;
    this.#opencode = opencode;
  }

  list(): PptWorksResponse {
    return { works: this.#store.pptWorks.list() };
  }

  create(input: PptWorkCreateRequest): CommandResponse<readonly PptWork[]> {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const topic = typeof input.topic === 'string' ? input.topic.trim() : '';
    if (input?.confirmCreate !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '创建 PPT 草稿需要显式确认');
    if (title === '' || title.length > 120) throw new AppError(ErrorCode.VALIDATION_FAILED, 'PPT 标题长度需要在 1–120 之间');
    if (topic.length > 2_000) throw new AppError(ErrorCode.VALIDATION_FAILED, 'PPT 主题过长');
    if (input.projectId !== undefined && this.#store.projects.get(input.projectId) === undefined) throw new AppError(ErrorCode.NOT_FOUND, '项目不存在');
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'ppt.work.create',
      body: { projectId: input.projectId, title, topic },
      target: {},
    });
    if (replayed && record.status !== 'accepted') throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '同一请求号已受理，请按回执核对');
    const work = this.#store.pptWorks.create({ ...(input.projectId === undefined ? {} : { projectId: input.projectId }), title, topic });
    this.#commands.settle(input.requestKey, { workId: work.id });
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.list().works };
  }

  exportMarkdown(id: string): { filename: string; content: string } {
    const work = this.#store.pptWorks.get(id);
    if (work === undefined) throw new AppError(ErrorCode.NOT_FOUND, 'PPT 草稿不存在');
    const safe = work.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || '演示';
    const outline = work.outline.length === 0 ? '（尚未生成大纲）' : work.outline.map((slide, index) => `## ${String(index + 1)}. ${slide}`).join('\n\n');
    return {
      filename: `${safe}.md`,
      content: `# ${work.title}\n\n> ${work.topic}\n\n${outline}\n\n---\n\n由 agent-workflow 导出的 PPT 大纲（未生成逐页视觉）。\n`,
    };
  }

  update(id: string, input: PptWorkUpdateRequest): CommandResponse<PptWork> {
    if (input?.confirmUpdate !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '编辑 PPT 需要显式确认');
    const work = this.#store.pptWorks.get(id);
    if (work === undefined) throw new AppError(ErrorCode.NOT_FOUND, 'PPT 草稿不存在');
    const title = input.title === undefined ? work.title : input.title.trim();
    if (title === '' || title.length > 120) throw new AppError(ErrorCode.VALIDATION_FAILED, 'PPT 标题长度需要在 1–120 之间');
    const topic = input.topic === undefined ? work.topic : input.topic.trim();
    if (topic.length > 2_000) throw new AppError(ErrorCode.VALIDATION_FAILED, 'PPT 主题过长');
    const outline = input.outline === undefined ? work.outline : input.outline.filter((item) => typeof item === 'string' && item.trim() !== '').map((item) => item.trim().slice(0, 200)).slice(0, 40);
    const { replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'ppt.work.update',
      body: { workId: id, title, topic, outline },
      target: { ref: id },
    });
    if (replayed) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '同一请求号已受理，请按回执核对');
    const updated = this.#store.pptWorks.update({ ...work, title, topic, outline });
    this.#commands.settle(input.requestKey, { workId: id, slides: outline.length });
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: updated };
  }

  async generate(id: string, input: PptWorkGenerateRequest): Promise<CommandResponse<PptWork>> {
    if (input?.confirmGenerate !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '生成 PPT 大纲需要显式确认');
    const work = this.#store.pptWorks.get(id);
    if (work === undefined) throw new AppError(ErrorCode.NOT_FOUND, 'PPT 草稿不存在');
    if (this.#context.opencodeReady() !== true) throw new AppError(ErrorCode.OPENCODE_NOT_READY, '受管 OpenCode 未就绪，无法生成大纲');
    const model = this.#context.settings().models.find((item) => item.enabled && item.roles.includes('planner')) ?? this.#context.settings().models.find((item) => item.enabled);
    if (model === undefined) throw new AppError(ErrorCode.MODEL_NOT_CONFIGURED, '没有启用的模型可用于 PPT 大纲');
    const { replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'ppt.work.generate',
      body: { workId: id },
      target: { ref: id },
    });
    if (replayed) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '同一请求号已受理，请按回执核对');
    this.#store.pptWorks.update({ ...work, status: 'generating' });
    try {
      const context = work.projectId === undefined ? [] : this.#documents(work.projectId);
      const result = await this.#opencode.runSession({
        kind: 'review',
        metadata: { ...(work.projectId === undefined ? {} : { projectId: work.projectId }), pptWorkId: id, purpose: 'ppt.outline' },
        cwd: this.#store.projects.get(work.projectId ?? '')?.rootPath ?? this.#store.dataDir,
        prompt: `演示标题：${work.title}\n演示主题：${work.topic}\n\n项目资料（只读）：\n${context.join('\n\n') || '（没有项目资料，只根据标题/主题生成）'}`,
        system: '你是演示结构设计助手。只输出 JSON：{"outline":["第1页标题","第2页标题", ...]}，6–12 页，不要 Markdown、不要解释。',
        model,
        permission: 'read_only',
        sink: {},
        timeoutMs: 90_000,
      });
      if (result.outcome.timedOut) throw new AppError(ErrorCode.MODEL_BUDGET_EXCEEDED, 'PPT 大纲生成超时');
      if (result.outcome.error !== undefined && result.outcome.error !== '') throw new AppError(ErrorCode.OPENCODE_PROVIDER_FAILED, `大纲生成失败：${result.outcome.error}`);
      const parsed = extractOutline(result.outcome.assistantText ?? '');
      if (parsed.length === 0) throw new AppError(ErrorCode.VALIDATION_FAILED, '模型输出没有可用大纲');
      const updated = this.#store.pptWorks.update({ ...work, status: 'ready', outline: parsed });
      this.#commands.settle(input.requestKey, { workId: id, slides: parsed.length });
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: updated };
    } catch (error) {
      this.#store.pptWorks.update({ ...work, status: 'failed' });
      this.#commands.fail(input.requestKey, error instanceof Error ? error : new Error('大纲生成失败'));
      throw error;
    }
  }

  #documents(projectId: string): readonly string[] {
    const project = this.#store.projects.get(projectId);
    if (project === undefined) return [];
    return listKnowledgeSources(project.rootPath).slice(0, 8).map((source) => {
      try {
        return `--- ${source.path}\n${readFileSync(join(project.rootPath, source.path), 'utf8').slice(0, 4_000)}`;
      } catch {
        return '';
      }
    }).filter((text) => text !== '');
  }

  delete(id: string): CommandResponse<readonly PptWork[]> {
    const work = this.#store.pptWorks.get(id);
    if (work === undefined) throw new AppError(ErrorCode.NOT_FOUND, 'PPT 草稿不存在');
    const requestKey = `req_ppt_delete_${id}_${String(Date.now())}`.slice(0, 60);
    const { record, replayed } = this.#commands.begin({
      requestKey,
      operation: 'ppt.work.delete',
      body: { workId: id },
      target: { ref: id },
    });
    if (replayed && record.status !== 'accepted') throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '删除请求正在处理');
    this.#store.pptWorks.delete(id);
    this.#commands.settle(requestKey, { workId: id, deletedAt: nowIso() });
    return { receipt: this.#commands.toReceipt(this.#commands.get(requestKey)!), resource: this.list().works };
  }
}


function extractOutline(text: string): readonly string[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { outline?: unknown };
    if (!Array.isArray(parsed.outline)) return [];
    return parsed.outline.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim().slice(0, 200)).slice(0, 20);
  } catch {
    return [];
  }
}
