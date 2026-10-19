import { checkPpt, pptPalette, pptPages, pptPageLayout, renderPptPage } from './ppt-renderer.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError, ErrorCode, nowIso, type CommandResponse, type PptWork, type PptWorkCreateRequest, type PptWorkGenerateRequest,
  type PptWorkUpdateRequest,
  type PptWorkManageRequest, type PptBrief, type PptVisualDirectionValue,
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

  /**
   * Startup recovery for PPT works a previous process left `generating`.
   *
   * A generation call cannot survive a restart, so the work is marked `failed`
   * (the legal terminal state of the four-value PPT status, and the state the UI
   * already offers "regenerate" from). `PptWork` has no notice/error field in the
   * shared contract, so the interruption is recorded in the `ppt.recovery.<id>`
   * audit entry and in the settled operation receipt (`GET /api/operations/:key`).
   * Accepted `ppt.work.generate` / `ppt.work.slides` receipts for that work are
   * settled to unknown; nothing is redispatched and no model is called.
   */
  recoverOnStartup(): { readonly recovered: number; readonly workIds: readonly string[] } {
    const workIds: string[] = [];
    const message = '进程重启，PPT 生成中断，结果未保存；可重新生成大纲或逐页内容。';
    const failure = new AppError(ErrorCode.INTERNAL_ERROR, message);
    for (const work of this.#store.pptWorks.list()) {
      if (work.status !== 'generating') continue;
      this.#store.pptWorks.update({ ...work, status: 'failed' });
      this.#store.settings.putJson(`ppt.recovery.${work.id}`, {
        kind: 'startup_recovery',
        message,
        at: nowIso(),
        previousStatus: 'generating',
        outlineSlides: work.outline.length,
        slides: work.slides.length,
      });
      for (const pending of this.#store.operations.listPending()) {
        if (pending.operation !== 'ppt.work.generate' && pending.operation !== 'ppt.work.slides') continue;
        if (pending.target.ref !== work.id) continue;
        const record = this.#commands.get(pending.requestKey);
        if (record === undefined || record.status !== 'accepted') continue;
        this.#commands.fail(pending.requestKey, failure, true);
      }
      workIds.push(work.id);
    }
    return { recovered: workIds.length, workIds };
  }

  list(): PptWorksResponse {
    return { works: this.#store.pptWorks.list().map((work) => {
      const pending = this.#store.operations.listPending().find((record) => record.target.ref === work.id && (record.operation === 'ppt.work.generate' || record.operation === 'ppt.work.slides'));
      return pending === undefined ? work : { ...work, mutationBlock: { requestKey: pending.requestKey, reason: '原生成尚未核对结束；只能按原请求号核对，不能重新派发' } };
    }) };
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
    const palette = pptPalette(work);
    const pptx = new PptxGen(); pptx.layout = 'LAYOUT_WIDE';
    for (const [index, page] of pptPages(work).entries()) {
      const target = pptx.addSlide();
      (target as unknown as { background?: unknown }).background = { color: palette.bg };
      const layout = pptPageLayout(page, index === 0);
      for (const line of layout.title) target.addText(line.text, { x: line.x, y: line.y, w: 12, h: line.height, fontFace: 'Arial', fontSize: line.size, color: palette.accent, margin: 0, breakLine: false });
      for (const line of layout.body) target.addText(line.text, { x: line.x, y: line.y, w: 12, h: line.height, fontFace: 'Arial', fontSize: line.size, color: palette.text, margin: 0, breakLine: false });
      target.addText(String(index + 1), { x: 12.5, y: 7, w: 0.5, h: 0.3, fontFace: 'Arial', fontSize: 12, color: palette.text });
      if (page.imageName) {
        const image = work.attachments.find((item) => item.kind === 'image' && item.name === page.imageName);
        if (image) (target as unknown as { addImage: (options: Record<string, unknown>) => void }).addImage({ data: image.content, x: 7, y: 1.6, w: 5.5, h: 4.8 });
      }
      if (page.notes) (target as unknown as { addNotes: (text: string) => void }).addNotes(page.notes);
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
      content: `# ${work.title}\n\n> ${work.topic}\n\n${work.slides.length > 0 ? work.slides.map((page, index) => `## ${index + 1}. ${page.title}\n\n${page.bullets.map((bullet) => `- ${bullet}`).join('\n')}\n\n${page.notes ? `演讲备注：${page.notes}` : ''}`).join('\n\n') : outline}\n\n---\n\n当前内容修订 r${work.revision ?? 1}\n`,
    };
  }

  attach(id: string, input: PptAttachmentRequest): CommandResponse<PptWork> {
    if (input?.confirmAttach !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '添加附件需要显式确认');
    const work = this.#store.pptWorks.get(id);
    if (work === undefined) throw new AppError(ErrorCode.NOT_FOUND, 'PPT 草稿不存在');
    this.#assertEditable(work, input.expectedRevision);
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (name === '' || name.length > 120) throw new AppError(ErrorCode.VALIDATION_FAILED, '附件名长度需要在 1–120 之间');
    if (typeof input.content !== 'string' || input.content.trim() === '') throw new AppError(ErrorCode.VALIDATION_FAILED, '附件内容为空');
    const kind = input.kind === 'image' ? 'image' : 'text';
    if (kind === 'image' && !/^data:image\/(png|jpeg|jpg|webp);base64,/.test(input.content)) throw new AppError(ErrorCode.VALIDATION_FAILED, '图片附件必须是 base64 data URL（png/jpeg/webp）');
    if (kind === 'text' && input.content.length > 200_000) throw new AppError(ErrorCode.VALIDATION_FAILED, '文本附件超过 200KB；请改用图片或拆分');
    if (kind === 'image' && input.content.length > 3_000_000) throw new AppError(ErrorCode.VALIDATION_FAILED, '图片附件超过 3MB data URL');
    if (work.attachments.length >= 10) throw new AppError(ErrorCode.VALIDATION_FAILED, '最多 10 个附件');
    if (work.attachments.some((attachment) => attachment.name === name)) throw new AppError(ErrorCode.CONFLICT, '同名附件已存在', { details: { name } });
    const { replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'ppt.attachment.add',
      body: { workId: id, name, content: input.content },
      target: { ref: id },
    });
    if (replayed) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '同一请求号已受理，请按回执核对');
    const attachment = { name, size: input.content.length, content: input.content, kind, addedAt: nowIso() } as const;
    const updated = this.#store.pptWorks.update({ ...work, attachments: [...work.attachments, attachment] });
    this.#commands.settle(input.requestKey, { workId: id, name });
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: updated };
  }

  detach(id: string, name: string, requestKey: string): CommandResponse<PptWork> {
    if (!requestKey) throw new AppError(ErrorCode.VALIDATION_FAILED, '移除附件需要客户端请求号');
    const work = this.#store.pptWorks.get(id);
    if (work === undefined) throw new AppError(ErrorCode.NOT_FOUND, 'PPT 草稿不存在');
    this.#assertEditable(work);
    if (!work.attachments.some((attachment) => attachment.name === name)) throw new AppError(ErrorCode.NOT_FOUND, '附件不存在');

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
    this.#assertEditable(work, input.expectedRevision);
    const brief = input.brief === undefined ? work.brief : validateBrief(input.brief);
    const direction = input.direction === undefined ? work.direction : validateDirection(input.direction);
    const slides = input.slides === undefined ? work.slides : validateSlides(input.slides);
    const title = input.title === undefined ? work.title : input.title.trim();
    if (title === '' || title.length > 120) throw new AppError(ErrorCode.VALIDATION_FAILED, 'PPT 标题长度需要在 1–120 之间');
    const topic = input.topic === undefined ? work.topic : input.topic.trim();
    if (topic.length > 2_000) throw new AppError(ErrorCode.VALIDATION_FAILED, 'PPT 主题过长');
    const outline = input.outline === undefined ? work.outline : input.outline.filter((item) => typeof item === 'string' && item.trim() !== '').map((item) => item.trim().slice(0, 200)).slice(0, 40);
    const theme = input.theme === undefined ? work.theme : validateTheme(input.theme);
    const { replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'ppt.work.update',
      body: { workId: id, title, topic, outline, theme, brief, direction, slides, expectedRevision: input.expectedRevision },
      target: { ref: id },
    });
    if (replayed) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '同一请求号已受理，请按回执核对');
    const updated = this.#store.pptWorks.update({ ...work, title, topic, outline, theme, brief, direction, slides });
    this.#commands.settle(input.requestKey, { workId: id, slides: outline.length });
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: updated };
  }

  async generateSlides(id: string, input: PptWorkGenerateContentRequest): Promise<CommandResponse<PptWork>> {
    if (input?.confirmGenerate !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '生成逐页内容需要显式确认');
    const work = this.#store.pptWorks.get(id);
    if (work === undefined) throw new AppError(ErrorCode.NOT_FOUND, 'PPT 草稿不存在');
    this.#assertEditable(work, input.expectedRevision);
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
      const documents = [...(work.projectId === undefined ? [] : this.#documents(work.projectId)), ...work.attachments.filter((attachment) => attachment.kind === 'text').map((attachment) => `--- 附件：${attachment.name}\n${attachment.content.slice(0, 4_000)}`)];
      const result = await this.#opencode.runSession({
        kind: 'review',
        metadata: { ...(work.projectId === undefined ? {} : { projectId: work.projectId }), pptWorkId: id, purpose: 'ppt.slides' },
        cwd: this.#store.projects.get(work.projectId ?? '')?.rootPath ?? this.#store.dataDir,
        prompt: `需求简报：${JSON.stringify(work.brief ?? {})}\n视觉方向：${work.direction ?? '未选择'}\n演示标题：${work.title}\n主题：${work.topic}\n大纲：\n${work.outline.map((slide, index) => `${String(index + 1)}. ${slide}`).join('\n')}\n\n项目资料：\n${documents.join('\n\n') || '（无）'}`,
        system: '你是演示内容助手。只输出 JSON：{"slides":[{"title":"页标题","bullets":["要点1","要点2"]}]}，与给定大纲一一对应，每页 2–6 条要点，不要 Markdown。',
        model,
        permission: 'read_only',
        sink: {},
        timeoutMs: 120_000,
      });
      if (!result.outcome.idle || result.outcome.timedOut) throw new AppError(ErrorCode.MODEL_BUDGET_EXCEEDED, '逐页内容生成超时');
      if (result.outcome.error !== undefined && result.outcome.error !== '') throw new AppError(ErrorCode.OPENCODE_PROVIDER_FAILED, `逐页生成失败：${result.outcome.error}`);
      const slides = extractSlides(result.outcome.assistantText ?? '');
      if (slides.length === 0) throw new AppError(ErrorCode.VALIDATION_FAILED, '模型输出没有可用逐页内容');
      const updated = this.#store.pptWorks.update({ ...work, status: 'ready', slides, usage: usageFromMessages(result.outcome.messages) });
      this.#commands.settle(input.requestKey, { workId: id, slides: slides.length });
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: updated };
    } catch (error) {
      const unknown = !(error instanceof AppError && (error.code === ErrorCode.VALIDATION_FAILED || error.code === ErrorCode.OPENCODE_PROVIDER_FAILED));
      this.#store.pptWorks.update({ ...work, status: unknown ? 'generating' : 'failed' });
      this.#commands.fail(input.requestKey, error instanceof Error ? error : new Error('逐页内容生成失败'), unknown);
      throw error;
    }
  }

  async generate(id: string, input: PptWorkGenerateRequest): Promise<CommandResponse<PptWork>> {
    if (input?.confirmGenerate !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '生成 PPT 大纲需要显式确认');
    const work = this.#store.pptWorks.get(id);
    if (work === undefined) throw new AppError(ErrorCode.NOT_FOUND, 'PPT 草稿不存在');
    this.#assertEditable(work, input.expectedRevision);
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
      const context = [...(work.projectId === undefined ? [] : this.#documents(work.projectId)), ...work.attachments.filter((attachment) => attachment.kind === 'text').map((attachment) => `--- 附件：${attachment.name}\n${attachment.content.slice(0, 4_000)}`)];
      const result = await this.#opencode.runSession({
        kind: 'review',
        metadata: { ...(work.projectId === undefined ? {} : { projectId: work.projectId }), pptWorkId: id, purpose: 'ppt.outline' },
        cwd: this.#store.projects.get(work.projectId ?? '')?.rootPath ?? this.#store.dataDir,
        prompt: `需求简报：${JSON.stringify(work.brief ?? {})}\n视觉方向：${work.direction ?? '未选择'}\n演示标题：${work.title}\n演示主题：${work.topic}\n\n项目资料（只读）：\n${context.join('\n\n') || '（没有项目资料，只根据标题/主题生成）'}`,
        system: '你是演示结构设计助手。只输出 JSON：{"outline":["第1页标题","第2页标题", ...]}，6–12 页，不要 Markdown、不要解释。',
        model,
        permission: 'read_only',
        sink: {},
        timeoutMs: 90_000,
      });
      if (!result.outcome.idle || result.outcome.timedOut) throw new AppError(ErrorCode.MODEL_BUDGET_EXCEEDED, 'PPT 大纲生成超时');
      if (result.outcome.error !== undefined && result.outcome.error !== '') throw new AppError(ErrorCode.OPENCODE_PROVIDER_FAILED, `大纲生成失败：${result.outcome.error}`);
      const parsed = extractOutline(result.outcome.assistantText ?? '');
      if (parsed.length === 0) throw new AppError(ErrorCode.VALIDATION_FAILED, '模型输出没有可用大纲');
      const updated = this.#store.pptWorks.update({ ...work, status: 'ready', outline: parsed, usage: usageFromMessages(result.outcome.messages) });
      this.#commands.settle(input.requestKey, { workId: id, slides: parsed.length });
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: updated };
    } catch (error) {
      const unknown = !(error instanceof AppError && (error.code === ErrorCode.VALIDATION_FAILED || error.code === ErrorCode.OPENCODE_PROVIDER_FAILED));
      this.#store.pptWorks.update({ ...work, status: unknown ? 'generating' : 'failed' });
      this.#commands.fail(input.requestKey, error instanceof Error ? error : new Error('大纲生成失败'), unknown);
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

  check(id: string) { return checkPpt(this.#requireWork(id)); }
  thumbnail(id: string, page = 0, direction?: unknown) { const saved = this.#requireWork(id); const work = direction === undefined ? saved : { ...saved, direction: validateDirection(direction) }; if (!Number.isInteger(page) || page < 0 || page >= pptPages(work).length) throw new AppError(ErrorCode.NOT_FOUND, '页面不存在'); return renderPptPage(work, page); }
  manage(id: string, action: 'copy' | 'archive' | 'restore', input: PptWorkManageRequest): CommandResponse<PptWork> {
    const work = this.#requireWork(id);
    if (input.confirm !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '作品操作需要确认');
    if ((work.revision ?? 1) !== input.expectedRevision) throw new AppError(ErrorCode.STALE_TARGET, '作品已有新版本；保留修改并重新读取');
    this.#assertSettled(work);
    const { record, replayed } = this.#commands.begin({ requestKey: input.requestKey, operation: action === 'copy' ? 'ppt.work.copy' : action === 'archive' ? 'ppt.work.archive' : 'ppt.work.restore', body: { id, action, ...input }, target: { ref: id } });
    if (replayed) return { receipt: this.#commands.toReceipt(record), resource: work };
    let updated: PptWork;
    try {
      if (action === 'copy') {
        const copy = this.#store.pptWorks.create({ title: `${work.title}（副本）`.slice(0, 120), topic: work.topic, theme: work.theme, ...(work.projectId === undefined ? {} : { projectId: work.projectId }) });
        updated = this.#store.pptWorks.update({ ...work, id: copy.id, createdAt: copy.createdAt, archived: false, versions: [], status: work.slides.length > 0 ? 'ready' : 'draft' });
      } else if (action === 'archive') {
        if (typeof input.archived !== 'boolean') throw new AppError(ErrorCode.VALIDATION_FAILED, '需要明确归档或恢复');
        updated = this.#store.pptWorks.update({ ...work, archived: input.archived });
      } else {
        this.#assertEditable(work);
        const version = work.versions?.find((item) => item.revision === input.revision);
        if (version === undefined) throw new AppError(ErrorCode.NOT_FOUND, '内容版本未保留');
        updated = this.#store.pptWorks.update({ ...work, ...version, brief: version.brief, direction: version.direction, id: work.id, versions: work.versions, archived: work.archived });
      }
      this.#commands.settle(input.requestKey, { workId: updated.id, revision: updated.revision });
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: updated };
    } catch (error) { this.#commands.fail(input.requestKey, error instanceof Error ? error : new Error('作品操作失败')); throw error; }
  }
  #requireWork(id: string): PptWork { const work = this.#store.pptWorks.get(id); if (!work) throw new AppError(ErrorCode.NOT_FOUND, '作品不存在'); return work; }
  #assertSettled(work: PptWork) {
    if (work.status === 'generating') throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '作品仍在生成，原进程尚未核对结束');
    const unknown = this.#store.operations.listPending().find((record) => record.target.ref === work.id && (record.operation === 'ppt.work.generate' || record.operation === 'ppt.work.slides'));
    if (unknown) throw new AppError(ErrorCode.RECEIPT_UNKNOWN, `原生成结果待核对：${unknown.requestKey}`, { httpStatus: 409, details: { requestKey: unknown.requestKey } });
  }
  #assertEditable(work: PptWork, revision?: number) {
    this.#assertSettled(work);
    if (work.archived) throw new AppError(ErrorCode.VALIDATION_FAILED, '作品已归档，恢复后才能修改');
    if (work.status === 'generating') throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '作品仍在生成');
    if (revision !== undefined && revision !== (work.revision ?? 1)) throw new AppError(ErrorCode.STALE_TARGET, '作品已有新版本，本地修改保留，请重新读取并比对');
  }

  delete(id: string, requestKey: string): CommandResponse<readonly PptWork[]> {
    if (!requestKey) throw new AppError(ErrorCode.VALIDATION_FAILED, '删除作品需要客户端请求号');
    const work = this.#store.pptWorks.get(id);
    if (work === undefined) throw new AppError(ErrorCode.NOT_FOUND, 'PPT 草稿不存在');
    this.#assertEditable(work);

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


function validateTheme(theme: unknown): import('@agent-workflow/shared').ThemeIdValue {
  if (theme === undefined) return 'deepseek';
  if (theme === 'deepseek' || theme === 'warm' || theme === 'spdb' || theme === 'github-white') return theme;
  throw new AppError(ErrorCode.VALIDATION_FAILED, 'PPT 主题不合法');
}

function validateBrief(value: PptBrief): PptBrief {
  if (!value || typeof value !== 'object') throw new AppError(ErrorCode.VALIDATION_FAILED, '需求简报必须是对象');
  const fields = ['audience', 'objective', 'length', 'style', 'sources'] as const;
  for (const field of fields) if (typeof value[field] !== 'string' || value[field].length > 2000) throw new AppError(ErrorCode.VALIDATION_FAILED, `简报${field}需要是2000字以内文本`);
  return { audience: value.audience.trim(), objective: value.objective.trim(), length: value.length.trim(), style: value.style.trim(), sources: value.sources.trim() };
}
function validateDirection(value: unknown): PptVisualDirectionValue { if (value === 'restrained' || value === 'editorial' || value === 'contrast') return value; throw new AppError(ErrorCode.VALIDATION_FAILED, '视觉方向不可用'); }
function validateSlides(value: readonly PptSlide[]): readonly PptSlide[] {
  if (!Array.isArray(value) || value.length > 40 || value.some((page) => typeof page.title !== 'string' || page.title.length > 200 || !Array.isArray(page.bullets) || page.bullets.length > 8 || page.bullets.some((bullet: unknown) => typeof bullet !== 'string' || bullet.length > 300) || (page.notes !== undefined && (typeof page.notes !== 'string' || page.notes.length > 4000)))) throw new AppError(ErrorCode.VALIDATION_FAILED, '页面内容、要点或备注超出限制');
  return value.map((page) => ({ title: page.title, bullets: [...page.bullets], ...(page.notes === undefined ? {} : { notes: page.notes }), ...(typeof page.imageName === 'string' ? { imageName: page.imageName } : {}) }));
}
