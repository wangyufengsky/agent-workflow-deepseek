import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError, ErrorCode, nowIso, type CommandResponse, type PptWork, type PptWorkCreateRequest, type PptWorkGenerateRequest,
  type PptWorkUpdateRequest,
  type PptWorkGenerateContentRequest,
  type PptAttachmentRequest,
  type PptSlide, type PptWorksResponse } from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';
import type { CommandService } from './operations.ts';
import type { EngineContext } from './actions.ts';
import type { OpenCodePort } from './ports.ts';
import { listKnowledgeSources } from '../../server/src/knowledge.ts';
import { usageFromMessages } from './token-usage.ts';

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
    const theme = validateTheme(input.theme);
    const work = this.#store.pptWorks.create({ ...(input.projectId === undefined ? {} : { projectId: input.projectId }), title, topic, theme });
    this.#commands.settle(input.requestKey, { workId: work.id });
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.list().works };
  }

  async exportPptx(id: string): Promise<Buffer> {
    const work = this.#store.pptWorks.get(id);
    if (work === undefined) throw new AppError(ErrorCode.NOT_FOUND, 'PPT 草稿不存在');
    const slides = work.slides.length > 0
      ? work.slides
      : work.outline.map((title) => ({ title, bullets: [] as string[] }));
    if (slides.length === 0) throw new AppError(ErrorCode.VALIDATION_FAILED, '先生成或编辑大纲');
    const module = await import('pptxgenjs');
    const PptxGen = (module.default ?? module) as unknown as new () => {
      layout: string;
      addSlide: () => { addText: (text: unknown, options?: Record<string, unknown>) => void };
      write: (options: { outputType: string }) => Promise<Buffer>;
    };
    const palette = PALETTES[work.theme] ?? DEFAULT_PALETTE;
    const pptx = new PptxGen();
    pptx.layout = 'LAYOUT_WIDE';
    const titleSlide = pptx.addSlide();
    (titleSlide as unknown as { background?: unknown }).background = { color: palette.bg };
    titleSlide.addText(work.title, { x: 0.6, y: 2.2, w: 12, h: 1.2, fontSize: 32, bold: true, color: palette.text });
    titleSlide.addText(work.topic, { x: 0.6, y: 3.4, w: 12, h: 1, fontSize: 16, color: palette.text });
    for (const slide of slides) {
      const page = pptx.addSlide();
      (page as unknown as { background?: unknown }).background = { color: palette.bg };
      page.addText(slide.title, { x: 0.5, y: 0.35, w: 12.3, h: 0.8, fontSize: 24, bold: true, color: palette.accent });
      if (slide.bullets.length > 0) {
        page.addText(slide.bullets.map((bullet) => ({ text: bullet, options: { bullet: true } })), { x: 0.7, y: 1.4, w: 11.8, h: 5.2, fontSize: 16, color: palette.text });
      }
    }
    return pptx.write({ outputType: 'nodebuffer' });
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

  attach(id: string, input: PptAttachmentRequest): CommandResponse<PptWork> {
    if (input?.confirmAttach !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '添加附件需要显式确认');
    const work = this.#store.pptWorks.get(id);
    if (work === undefined) throw new AppError(ErrorCode.NOT_FOUND, 'PPT 草稿不存在');
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (name === '' || name.length > 120) throw new AppError(ErrorCode.VALIDATION_FAILED, '附件名长度需要在 1–120 之间');
    if (typeof input.content !== 'string' || input.content.trim() === '') throw new AppError(ErrorCode.VALIDATION_FAILED, '附件内容为空');
    if (input.content.length > 200_000) throw new AppError(ErrorCode.VALIDATION_FAILED, '附件内容超过 200KB；当前仅支持文本/Markdown');
    if (work.attachments.length >= 10) throw new AppError(ErrorCode.VALIDATION_FAILED, '最多 10 个附件');
    if (work.attachments.some((attachment) => attachment.name === name)) throw new AppError(ErrorCode.CONFLICT, '同名附件已存在', { details: { name } });
    const { replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'ppt.attachment.add',
      body: { workId: id, name, size: input.content.length },
      target: { ref: id },
    });
    if (replayed) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '同一请求号已受理，请按回执核对');
    const attachment = { name, size: input.content.length, content: input.content, addedAt: nowIso() };
    const updated = this.#store.pptWorks.update({ ...work, attachments: [...work.attachments, attachment] });
    this.#commands.settle(input.requestKey, { workId: id, name });
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: updated };
  }

  detach(id: string, name: string): CommandResponse<PptWork> {
    const work = this.#store.pptWorks.get(id);
    if (work === undefined) throw new AppError(ErrorCode.NOT_FOUND, 'PPT 草稿不存在');
    if (!work.attachments.some((attachment) => attachment.name === name)) throw new AppError(ErrorCode.NOT_FOUND, '附件不存在');
    const requestKey = `req_ppt_detach_${id}_${String(Date.now())}`.slice(0, 60);
    const { replayed } = this.#commands.begin({ requestKey, operation: 'ppt.attachment.remove', body: { workId: id, name }, target: { ref: id } });
    if (replayed) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '同一请求号已受理，请按回执核对');
    const updated = this.#store.pptWorks.update({ ...work, attachments: work.attachments.filter((attachment) => attachment.name !== name) });
    this.#commands.settle(requestKey, { workId: id, name });
    return { receipt: this.#commands.toReceipt(this.#commands.get(requestKey)!), resource: updated };
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
    const theme = input.theme === undefined ? work.theme : validateTheme(input.theme);
    const { replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'ppt.work.update',
      body: { workId: id, title, topic, outline, theme },
      target: { ref: id },
    });
    if (replayed) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '同一请求号已受理，请按回执核对');
    const updated = this.#store.pptWorks.update({ ...work, title, topic, outline, theme });
    this.#commands.settle(input.requestKey, { workId: id, slides: outline.length });
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: updated };
  }

  async generateSlides(id: string, input: PptWorkGenerateContentRequest): Promise<CommandResponse<PptWork>> {
    if (input?.confirmGenerate !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '生成逐页内容需要显式确认');
    const work = this.#store.pptWorks.get(id);
    if (work === undefined) throw new AppError(ErrorCode.NOT_FOUND, 'PPT 草稿不存在');
    if (work.outline.length === 0) throw new AppError(ErrorCode.VALIDATION_FAILED, '先生成或编辑大纲');
    if (this.#context.opencodeReady() !== true) throw new AppError(ErrorCode.OPENCODE_NOT_READY, '受管 OpenCode 未就绪，无法生成逐页内容');
    const model = this.#context.settings().models.find((item) => item.enabled && item.roles.includes('planner')) ?? this.#context.settings().models.find((item) => item.enabled);
    if (model === undefined) throw new AppError(ErrorCode.MODEL_NOT_CONFIGURED, '没有启用的模型可用于 PPT 内容');
    const { replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'ppt.work.slides',
      body: { workId: id, outline: work.outline },
      target: { ref: id },
    });
    if (replayed) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '同一请求号已受理，请按回执核对');
    this.#store.pptWorks.update({ ...work, status: 'generating' });
    try {
      const documents = [...(work.projectId === undefined ? [] : this.#documents(work.projectId)), ...work.attachments.map((attachment) => `--- 附件：${attachment.name}\n${attachment.content.slice(0, 4_000)}`)];
      const result = await this.#opencode.runSession({
        kind: 'review',
        metadata: { ...(work.projectId === undefined ? {} : { projectId: work.projectId }), pptWorkId: id, purpose: 'ppt.slides' },
        cwd: this.#store.projects.get(work.projectId ?? '')?.rootPath ?? this.#store.dataDir,
        prompt: `演示标题：${work.title}\n主题：${work.topic}\n大纲：\n${work.outline.map((slide, index) => `${String(index + 1)}. ${slide}`).join('\n')}\n\n项目资料：\n${documents.join('\n\n') || '（无）'}`,
        system: '你是演示内容助手。只输出 JSON：{"slides":[{"title":"页标题","bullets":["要点1","要点2"]}]}，与给定大纲一一对应，每页 2–6 条要点，不要 Markdown。',
        model,
        permission: 'read_only',
        sink: {},
        timeoutMs: 120_000,
      });
      if (result.outcome.timedOut) throw new AppError(ErrorCode.MODEL_BUDGET_EXCEEDED, '逐页内容生成超时');
      if (result.outcome.error !== undefined && result.outcome.error !== '') throw new AppError(ErrorCode.OPENCODE_PROVIDER_FAILED, `逐页生成失败：${result.outcome.error}`);
      const slides = extractSlides(result.outcome.assistantText ?? '');
      if (slides.length === 0) throw new AppError(ErrorCode.VALIDATION_FAILED, '模型输出没有可用逐页内容');
      const updated = this.#store.pptWorks.update({ ...work, status: 'ready', slides, usage: usageFromMessages(result.outcome.messages) });
      this.#commands.settle(input.requestKey, { workId: id, slides: slides.length });
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: updated };
    } catch (error) {
      this.#store.pptWorks.update({ ...work, status: 'failed' });
      this.#commands.fail(input.requestKey, error instanceof Error ? error : new Error('逐页内容生成失败'));
      throw error;
    }
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
      const context = [...(work.projectId === undefined ? [] : this.#documents(work.projectId)), ...work.attachments.map((attachment) => `--- 附件：${attachment.name}\n${attachment.content.slice(0, 4_000)}`)];
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
      const updated = this.#store.pptWorks.update({ ...work, status: 'ready', outline: parsed, usage: usageFromMessages(result.outcome.messages) });
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


function extractSlides(text: string): readonly PptSlide[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { slides?: unknown };
    if (!Array.isArray(parsed.slides)) return [];
    return parsed.slides
      .filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object' && typeof (item as { title?: unknown }).title === 'string')
      .map((item) => ({
        title: String(item.title).slice(0, 200),
        bullets: Array.isArray(item.bullets) ? item.bullets.filter((bullet): bullet is string => typeof bullet === 'string' && bullet.trim() !== '').map((bullet) => bullet.trim().slice(0, 300)).slice(0, 8) : [],
      }))
      .filter((slide) => slide.title !== '')
      .slice(0, 24);
  } catch {
    return [];
  }
}


const DEFAULT_PALETTE = { bg: '0B1220', text: 'E5E7EB', accent: '7C9CFF' } as const;
const PALETTES: Record<string, { readonly bg: string; readonly text: string; readonly accent: string }> = {
  deepseek: DEFAULT_PALETTE,
  warm: { bg: 'FFF8F0', text: '3B2F2F', accent: 'B45309' },
  spdb: { bg: 'FFFFFF', text: '1F2A44', accent: '0B5FA5' },
  'github-white': { bg: 'FFFFFF', text: '1F2328', accent: '0969DA' },
};

function validateTheme(theme: unknown): import('@agent-workflow/shared').ThemeIdValue {
  if (theme === undefined) return 'deepseek';
  if (theme === 'deepseek' || theme === 'warm' || theme === 'spdb' || theme === 'github-white') return theme;
  throw new AppError(ErrorCode.VALIDATION_FAILED, 'PPT 主题不合法');
}
