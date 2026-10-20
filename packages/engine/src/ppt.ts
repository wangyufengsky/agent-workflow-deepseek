import { PptAssistantService } from './ppt-assistant.ts';
import { pptDocument } from './ppt-document.ts';
import { validatePlan, validateSlideExtras } from './ppt-plan.ts';
import { PptGenerationCoordinator } from './ppt-generation.ts';
import { checkPpt, pptPalette, pptPages, pptPageLayout, pptLineColor, renderPptPage } from './ppt-renderer.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError, ErrorCode, nowIso, type CommandResponse, type PptWork, type PptWorkCreateRequest, type PptWorkGenerateRequest,
  type PptWorkUpdateRequest,
  type PptWorkStopRequest, type PptProductionPlan,
  type PptWorkManageRequest, type PptBrief, type PptVisualDirectionValue,
  type PptWorkGenerateContentRequest,
  type PptAttachmentRequest,
  type PptSlide, type PptPageGeneration, type PptWorksResponse } from '@agent-workflow/shared';
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
  readonly #generation: PptGenerationCoordinator;
  readonly #assistantGeneration:PptGenerationCoordinator;
  readonly assistant: PptAssistantService;

  constructor(store: Store, commands: CommandService, context: EngineContext, opencode: OpenCodePort) {
    this.#store = store;
    this.#commands = commands;
    this.#context = context;
    this.#opencode = opencode;
    this.#generation = new PptGenerationCoordinator(store, commands, opencode);
    this.#assistantGeneration=new PptGenerationCoordinator(store,commands,opencode,{prefix:'ppt.assistant.generation.',affectsWork:false});
    for(const work of store.pptWorks.list()){const prior=this.#generation.state(work.id);if(prior && commands.get(prior.requestKey)?.operation==='ppt.assistant.ask'){store.settings.putJson(`ppt.assistant.generation.${work.id}`,prior);store.settings.removeJson(`ppt.generation.${work.id}`);}}
    this.assistant = new PptAssistantService({store,commands,context,opencode,generation:this.#assistantGeneration,guard:(id,revision,key,discussion)=>this.#assistantGuard(id,revision,key,discussion),update:(id,input)=>this.update(id,input),documents:(work)=>[...(work.projectId?this.#documents(work.projectId):[]),...work.attachments.filter(item=>item.kind==='text').map(item=>`附件 ${item.name}（最多4000字符）：${item.content.slice(0,4000)}`)]});
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
    for (const record of this.#store.operations.listPending()) { if(record.operation==='ppt.assistant.ask'&&record.target.ref){this.#assistantGeneration.fail(record.target.ref,true);this.#commands.fail(record.requestKey,new AppError(ErrorCode.RECEIPT_UNKNOWN,'服务重启，原助手调用结果待核对，不自动重发'),true);} }
    const message = '进程重启，PPT 生成中断；已保存页面保留，未完成页面需核对原请求。';
    const failure = new AppError(ErrorCode.INTERNAL_ERROR, message);
    for (const work of this.#store.pptWorks.list()) {
      if (work.status !== 'generating') continue;
      if(this.#generation.recoverUnsent(work.id)){workIds.push(work.id);continue;}
      this.#generation.fail(work.id,true);
      this.#store.pptWorks.update({ ...work, status: 'failed',productionPages:this.#generation.state(work.id)?.pages ??work.productionPages });
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
      const pending = this.#store.operations.listPending().find((record) => record.target.ref === work.id && (record.operation === 'ppt.work.generate' || record.operation === 'ppt.work.slides' || record.operation === 'ppt.assistant.ask'));
      const missing=this.#missingBrief(work);
      const reason=missing.length ? `先补全并保存需求简报：${missing.join('、')}` : undefined;
      const exportReason=work.status==='generating'?'作品仍在制作，先等原调用停稳':pending?'原调用仍待核对，先核对原请求':this.#productionReason(work)??(!work.outline.length&&!work.slides.length?'作品还没有页面':undefined);
      const actions={ export:exportReason?{allowed:false,reason:exportReason}:{allowed:true},generate: reason ? {allowed:false,reason} : {allowed:true}, generateSlides: reason ? {allowed:false,reason} : work.plan && !work.plan.confirmed ? {allowed:false,reason:'先保存并确认制作方案'} : {allowed:true}, design: reason ? {allowed:false,reason} : {allowed:true} };
      const generation = this.#generation.state(work.id);
      const assistant=this.#assistantGeneration.state(work.id);
      const assistantView=assistant&&!['completed','failed'].includes(assistant.status)?{assistantGeneration:{requestKey:assistant.requestKey,stopRequestKey:assistant.stopRequestKey,status:assistant.status,startedAt:assistant.startedAt}}:{};
      const projected = generation && (!['completed','failed'].includes(generation.status) || generation.pages) ? { ...work, generation: { requestKey: generation.requestKey, stopRequestKey: generation.stopRequestKey, status: generation.status, startedAt: generation.startedAt, pages:generation.pages } } : work;
      return pending === undefined ? {...projected,...assistantView,actions} : { ...projected,...assistantView,actions, mutationBlock: { requestKey: pending.requestKey, reason: '原生成尚未核对结束；只能按原请求号核对，不能重新派发' } };
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

  document(id: string, revision: number, includeNotes?: boolean) { const work=this.#requireWork(id); this.#assertSettled(work);this.#assertProductionComplete(work); if(revision!==(work.revision??1))throw new AppError(ErrorCode.STALE_TARGET,'作品修订已变化，请重新打开导出'); if(!work.slides.length&&!work.outline.length)throw new AppError(ErrorCode.VALIDATION_FAILED,'作品没有页面'); return pptDocument(work,includeNotes); }
  exportFilename(id: string) { const work=this.#requireWork(id); return `${(work.plan?.delivery.filename || work.title).replace(/[\\/:*?"<>|]/g,'_').trim().slice(0,60) || '演示'}.pptx`; }
  async exportPptx(id: string, includeNotes?: boolean): Promise<Buffer> {
    const work = this.#store.pptWorks.get(id);
    if (work === undefined) throw new AppError(ErrorCode.NOT_FOUND, 'PPT 草稿不存在');
    this.#assertSettled(work);this.#assertProductionComplete(work);
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
      for (const line of [...layout.title, ...layout.body, ...layout.tag]) target.addText(line.text, { x: line.x, y: line.y, w: line.width, h: line.height, align: line.align, fontFace: work.plan?.visual.fontFace ?? 'Arial', fontSize: line.size, color: pptLineColor(line.color,palette), transparency: line.color === 'muted' ? 35 : 0, margin: 0, breakLine: false });
      target.addText(String(index + 1), { x: 12.5, y: 7, w: 0.5, h: 0.3, fontFace: work.plan?.visual.fontFace ?? 'Arial', fontSize: 12, color: palette.text });
      if (page.imageName) {
        const image = work.attachments.find((item) => item.kind === 'image' && item.name === page.imageName);
        if (image) (target as unknown as { addImage: (options: Record<string, unknown>) => void }).addImage({ data: image.content, x: 7, y: 1.6, w: 5.5, h: 4.8 });
      }
      if (page.notes && (includeNotes ?? work.plan?.delivery.includeNotes ?? true)) (target as unknown as { addNotes: (text: string) => void }).addNotes(page.notes);
    }
    return pptx.write({ outputType: 'nodebuffer' });
  }

  exportMarkdown(id: string): { filename: string; content: string } {
    const work = this.#store.pptWorks.get(id);
    if (work === undefined) throw new AppError(ErrorCode.NOT_FOUND, 'PPT 草稿不存在');
    this.#assertSettled(work);this.#assertProductionComplete(work);
    const safe = (work.plan?.delivery.filename || work.title).replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || '演示';
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
    if(input.pageEdit!==undefined)return this.#editPage(work,input);
    this.#assertEditable(work, input.expectedRevision);
    const plan = input.plan === undefined ? work.plan : validatePlan(input.plan);
    if (work.plan?.confirmed && plan?.confirmed && (
      JSON.stringify(work.plan.directions) !== JSON.stringify(plan.directions) || work.plan.duration !== plan.duration || work.plan.pageCount !== plan.pageCount || work.plan.requirements !== plan.requirements ||
      (input.brief !== undefined && JSON.stringify(input.brief) !== JSON.stringify(work.brief)) || (input.direction !== undefined && input.direction !== work.direction)
    )) throw new AppError(ErrorCode.CONFLICT, '制作目标与整体方向已确认；请先重新打开方案');
    const brief = input.brief === undefined ? work.brief : validateBrief(input.brief);
    const direction = input.direction === undefined ? work.direction : validateDirection(input.direction);
    const cover = input.cover === undefined ? work.cover : validateSlides([input.cover])[0];
    /* P07-23: 显式“加一页”语义。只追加一个页面（保留已有页面内容与逐页状态），
     * 不再要求前端提交整份 slides。 */
    const appendPage = input.appendPage === undefined ? undefined : validateSlides([input.appendPage])[0];
    if (appendPage !== undefined && (input.slides !== undefined || input.outline !== undefined || input.pageEdit !== undefined)) throw new AppError(ErrorCode.VALIDATION_FAILED, '追加页面不能与整份页面内容/大纲/逐页编辑同时提交');
    const appendedSlides = appendPage === undefined ? undefined : [...storedBodyPages(work), appendPage];
    const slides = input.slides === undefined ? (appendedSlides ?? work.slides) : validateSlides(input.slides);
    const title = input.title === undefined ? work.title : input.title.trim();
    if (title === '' || title.length > 120) throw new AppError(ErrorCode.VALIDATION_FAILED, 'PPT 标题长度需要在 1–120 之间');
    const topic = input.topic === undefined ? work.topic : input.topic.trim();
    if (topic.length > 2_000) throw new AppError(ErrorCode.VALIDATION_FAILED, 'PPT 主题过长');
    if (input.outline !== undefined && (!Array.isArray(input.outline) || input.outline.length > 100 || input.outline.some((item) => typeof item !== 'string' || !item.trim() || item.length > 200))) throw new AppError(ErrorCode.VALIDATION_FAILED, '大纲需要1–100页以内的有效标题，每项最多200字');
    const outline = input.outline !== undefined
      ? input.outline.filter((item) => typeof item === 'string' && item.trim() !== '').map((item) => item.trim().slice(0, 200)).slice(0, 100)
      : appendPage === undefined ? work.outline : [...work.outline, appendPage.title].slice(0, 100);
    const theme = input.theme === undefined ? work.theme : validateTheme(input.theme);
    const { replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'ppt.work.update',
      body: { workId: id, title, topic, outline, theme, brief, direction, slides, plan, cover, expectedRevision: input.expectedRevision },
      target: { ref: id },
    });
    if (replayed) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '同一请求号已受理，请按回执核对');
    /* P07-23: a whole `slides`/`outline` PATCH must never fabricate "all pages completed".
     * Merge the existing production state page by page: unchanged pages keep their
     * status/source/message (including stopped/failed/unknown), moved pages keep it at
     * their new index, content that the user actually edited becomes a manual completion,
     * and pages that did not exist before stay `pending`. */
    const productionPages = input.slides === undefined && input.outline === undefined && appendPage === undefined
      ? work.productionPages
      : mergeProductionPages(work.productionPages, work, { ...(input.slides === undefined && appendPage === undefined ? {} : { slides }), outline });
    const updated = this.#store.pptWorks.update({ ...work, title, topic, outline, theme, brief, direction, slides, plan, cover, productionPages });
    /* Do not clear the persisted generation record here: it is the only evidence for
     * "made X/Y pages" and for the stop/failure reason of unfinished pages. A new
     * generation overwrites it when it begins. */
    this.#commands.settle(input.requestKey, { workId: id, slides: outline.length });
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: updated };
  }

  #editPage(work:PptWork,input:PptWorkUpdateRequest):CommandResponse<PptWork> {
    const edit=input.pageEdit!;
    if(!Number.isInteger(edit.index)||edit.index< -1||edit.index>=work.outline.length || Object.keys(input).some(key=>!['pageEdit','requestKey','confirmUpdate','expectedRevision'].includes(key)))throw new AppError(ErrorCode.VALIDATION_FAILED,'逐页编辑只能修改所选页面');
    if(input.expectedRevision===undefined)throw new AppError(ErrorCode.VALIDATION_FAILED,'逐页编辑需要明确当前修订');
    const run=this.#generation.state(work.id);
    if(work.status==='generating') {
      if(!run?.pages || run.status!=='running' || (edit.index>=0 && run.pages.find(page=>page.index===edit.index)?.status!=='completed') || this.#commands.get(run.requestKey)?.status!=='accepted')throw new AppError(ErrorCode.OPERATION_IN_PROGRESS,'这一页尚未制作完成，或原生成结果仍待核对');
      this.#assertSettled(work,run.requestKey,true);
      if(work.archived)throw new AppError(ErrorCode.CONFLICT,'作品已归档');
      if(input.expectedRevision!==(work.revision??1))throw new AppError(ErrorCode.STALE_TARGET,'作品已有新修订，本地修改保留，请重新读取并比对');
    } else this.#assertEditable(work,input.expectedRevision);
    const page=validateSlides([edit.page])[0]!;
    if(edit.index===-1 && (page.title.length>120 || page.bullets.join('\n').length>2000))throw new AppError(ErrorCode.VALIDATION_FAILED,'封面标题或主题过长');
    const {replayed}=this.#commands.begin({requestKey:input.requestKey,operation:'ppt.work.update',body:{workId:work.id,pageEdit:edit,expectedRevision:input.expectedRevision},target:{ref:work.id}});
    if(replayed)throw new AppError(ErrorCode.OPERATION_IN_PROGRESS,'请核对原页面保存请求');
    let saved:PptWork;
    try { this.#store.transaction(()=>{
      const slides=work.outline.map((title,index)=>index===edit.index?page:work.slides[index]??{title,bullets:[]});
      const productionPages=(this.#generation.state(work.id)?.pages??work.productionPages)?.map(page=>page.index===edit.index?{...page,title:edit.page.title,status:'completed' as const,source:'manual' as const,completedRevision:(work.revision??1)+1}:page);
      saved=this.#store.pptWorks.update(edit.index===-1?{...work,title:page.title,topic:page.bullets.join('\n'),cover:page,productionPages}:{...work,slides,productionPages,outline:work.outline.map((title,index)=>index===edit.index?page.title:title)});
      if(edit.index>=0)this.#generation.pageEdited(work.id,edit.index,page.title,saved.revision??1);
      this.#commands.settle(input.requestKey,{workId:work.id,pageIndex:edit.index});
    });
    } catch(error) { this.#commands.fail(input.requestKey,error instanceof Error?error:new Error('页面保存失败'));throw error; }
    return {receipt:this.#commands.toReceipt(this.#commands.get(input.requestKey)!),resource:saved!};
  }

  async generateSlides(id: string, input: PptWorkGenerateContentRequest): Promise<CommandResponse<PptWork>> {
    if (input?.confirmGenerate !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '生成逐页内容需要显式确认');
    const work = this.#store.pptWorks.get(id);
    if (work === undefined) throw new AppError(ErrorCode.NOT_FOUND, 'PPT 草稿不存在');
    this.#assertEditable(work, input.expectedRevision);
    if (work.plan && !work.plan.confirmed) throw new AppError(ErrorCode.VALIDATION_FAILED, '先保存并确认制作方案');
    if (work.outline.length === 0) throw new AppError(ErrorCode.VALIDATION_FAILED, '先生成或编辑大纲');
    if (this.#context.opencodeReady() !== true) throw new AppError(ErrorCode.OPENCODE_NOT_READY, '受管 OpenCode 未就绪，无法生成逐页内容');
    const model = this.#context.settings().models.find((item) => item.enabled && item.roles.includes('planner')) ?? this.#context.settings().models.find((item) => item.enabled);
    if (model === undefined) throw new AppError(ErrorCode.MODEL_NOT_CONFIGURED, '没有启用的模型可用于 PPT 内容');
    this.#assertBrief(work);
    const { replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'ppt.work.slides',
      body: { workId: id, outline: work.outline },
      target: { ref: id },
    });
    if (replayed) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '同一请求号已受理，请按回执核对');
    const baseline=work.outline.map((title,index)=>work.slides[index] ?? {title,bullets:[]});
    let began=false,dispatched=false;
    let usage={input:0,output:0,reasoning:0,cache:0,total:0};
    try {
      this.#generation.begin(id,input.requestKey,work.outline);began=true;
      this.#store.pptWorks.update({...work,status:'generating',slides:baseline,productionPages:work.outline.map((title,index)=>({index,title,status:'pending'}))});
      const documents = [...(work.projectId === undefined ? [] : this.#documents(work.projectId)), ...work.attachments.filter((attachment) => attachment.kind === 'text').map((attachment) => `--- 附件：${attachment.name}\n${attachment.content.slice(0, 4_000)}`)];
      for(let index=0;index<work.outline.length;index++) {
        if(!this.#generation.startPage(id,input.requestKey,index))return {receipt:this.#commands.toReceipt(this.#commands.get(input.requestKey)!),resource:this.#requireWork(id)};
        dispatched=true;
        const result = await this.#opencode.runSession({
          kind: 'review',
          metadata: { ...(work.projectId === undefined ? {} : { projectId: work.projectId }), pptWorkId: id, purpose: 'ppt.slides',pageIndex:String(index) },
          cwd: this.#store.projects.get(work.projectId ?? '')?.rootPath ?? this.#store.dataDir,
          prompt: `制作方案：${JSON.stringify(work.plan ?? {})}\n需求简报：${JSON.stringify(work.brief ?? {})}\n视觉方向：${work.direction ?? '未选择'}\n演示标题：${work.title}\n主题：${work.topic}\n全篇大纲：\n${work.outline.map((title,i)=>`${i+1}. ${title}`).join('\n')}\n本次只制作正文第 ${index+1} 页：${work.outline[index]}\n这一页现有方案（人工样式与备注会保留）：${JSON.stringify(baseline[index])}\n项目资料：\n${documents.join('\n\n') || '（无）'}`,
          system: '你是演示内容助手。仅制作指定的一页，不输出其他页面。只输出 JSON：{"slides":[{"title":"指定页标题","bullets":["要点1","要点2"]}]}。本次 slides 必须恰好一页，2–6 条具体要点。不要 Markdown。',
          model,
          permission: 'read_only',
          onSessionId: this.#generation.bind(id, input.requestKey),
          sink: { onIdle: () => this.#generation.onIdle(id, input.requestKey) },
          timeoutMs: 120_000,
        });
        if (this.#generation.ignoreLate(id,input.requestKey)) return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.#requireWork(id) };
        if (this.#generation.afterResult(id, result.outcome)) return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.#requireWork(id) };
        if (!result.outcome.idle || result.outcome.timedOut) throw new AppError(ErrorCode.MODEL_BUDGET_EXCEEDED, `正文第 ${index+1} 页生成超时`);
        if (result.outcome.error !== undefined && result.outcome.error !== '') throw new AppError(ErrorCode.OPENCODE_PROVIDER_FAILED, `正文第 ${index+1} 页生成失败：${result.outcome.error}`);
        const parsed=extractSlides(result.outcome.assistantText ?? '');
        if(parsed.length!==1 || !parsed[0]?.bullets.length)throw new AppError(ErrorCode.VALIDATION_FAILED,`正文第 ${index+1} 页没有恰好一页可用内容`);
        const tokens=usageFromMessages(result.outcome.messages);
        usage={input:usage.input+tokens.input,output:usage.output+tokens.output,reasoning:usage.reasoning+tokens.reasoning,cache:usage.cache+tokens.cache,total:usage.total+tokens.total};
        this.#store.transaction(()=>{
          const current=this.#requireWork(id);
          const slides=current.slides.map((page,i)=>i===index?{...page,title:work.outline[index]!,bullets:parsed[0]!.bullets,...(page.notes===undefined&&parsed[0]!.notes?{notes:parsed[0]!.notes}:{})}:page);
          const saved=this.#store.pptWorks.update({...current,status:'generating',slides,usage,productionPages:current.productionPages?.map(page=>page.index===index?{...page,status:'completed',source:'model',completedRevision:(current.revision??1)+1}:page)});
          this.#generation.pageCompleted(id,input.requestKey,index,saved.revision??1);
        });
      }
      const updated=this.#store.pptWorks.update({...this.#requireWork(id),status:'ready',usage});
      this.#generation.complete(id);
      this.#commands.settle(input.requestKey,{workId:id,slides:work.outline.length});
      return {receipt:this.#commands.toReceipt(this.#commands.get(input.requestKey)!),resource:updated};
    } catch(error) {
      if(began && (this.#generation.ignoreLate(id,input.requestKey)||this.#generation.stopped(id)))return {receipt:this.#commands.toReceipt(this.#commands.get(input.requestKey)!),resource:this.#requireWork(id)};
      const unknown=dispatched && !(error instanceof AppError && (error.code===ErrorCode.VALIDATION_FAILED||error.code===ErrorCode.OPENCODE_PROVIDER_FAILED));
      if(began)this.#generation.fail(id,unknown);
      this.#store.pptWorks.update({...this.#requireWork(id),status:unknown?'generating':'failed',productionPages:this.#generation.state(id)?.pages});
      this.#commands.fail(input.requestKey,error instanceof Error?error:new Error('逐页内容生成失败'),unknown);
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
    this.#assertBrief(work);
    const { replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'ppt.work.generate',
      body: { workId: id },
      target: { ref: id },
    });
    if (replayed) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '同一请求号已受理，请按回执核对');
    this.#generation.begin(id, input.requestKey);
    this.#store.pptWorks.update({ ...work, status: 'generating' });
    try {
      const context = [...(work.projectId === undefined ? [] : this.#documents(work.projectId)), ...work.attachments.filter((attachment) => attachment.kind === 'text').map((attachment) => `--- 附件：${attachment.name}\n${attachment.content.slice(0, 4_000)}`)];
      const result = await this.#opencode.runSession({
        kind: 'review',
        metadata: { ...(work.projectId === undefined ? {} : { projectId: work.projectId }), pptWorkId: id, purpose: 'ppt.outline' },
        cwd: this.#store.projects.get(work.projectId ?? '')?.rootPath ?? this.#store.dataDir,
        prompt: `制作方案：${JSON.stringify(work.plan ?? {})}\n需求简报：${JSON.stringify(work.brief ?? {})}\n视觉方向：${work.direction ?? '未选择'}\n演示标题：${work.title}\n演示主题：${work.topic}\n\n项目资料（只读）：\n${context.join('\n\n') || '（没有项目资料，只根据标题/主题生成）'}`,
        system: `你是演示结构设计助手。只输出 JSON：{"outline":["第1页标题","第2页标题", ...]}，${work.plan?.pageCount ?? '6–12'} 页，不要 Markdown、不要解释。`,
        model,
        permission: 'read_only',
        onSessionId: this.#generation.bind(id, input.requestKey),
        sink: { onIdle: () => this.#generation.onIdle(id, input.requestKey) },
        timeoutMs: 90_000,
      });
      if (this.#generation.ignoreLate(id,input.requestKey)) return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.#requireWork(id) };
      if (this.#generation.afterResult(id, result.outcome)) return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.#requireWork(id) };
      if (!result.outcome.idle || result.outcome.timedOut) throw new AppError(ErrorCode.MODEL_BUDGET_EXCEEDED, 'PPT 大纲生成超时');
      if (result.outcome.error !== undefined && result.outcome.error !== '') throw new AppError(ErrorCode.OPENCODE_PROVIDER_FAILED, `大纲生成失败：${result.outcome.error}`);
      const parsed = extractOutline(result.outcome.assistantText ?? '');
      if (parsed.length === 0) throw new AppError(ErrorCode.VALIDATION_FAILED, '模型输出没有可用大纲');
      const updated = this.#store.pptWorks.update({ ...work, status: 'ready', outline: parsed, usage: usageFromMessages(result.outcome.messages) });
      this.#generation.complete(id);
      this.#commands.settle(input.requestKey, { workId: id, slides: parsed.length });
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: updated };
    } catch (error) {
      if (this.#generation.ignoreLate(id,input.requestKey) || this.#generation.stopped(id)) return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.#requireWork(id) };
      const unknown = !(error instanceof AppError && (error.code === ErrorCode.VALIDATION_FAILED || error.code === ErrorCode.OPENCODE_PROVIDER_FAILED));
      this.#generation.fail(id, unknown);
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

  stop(id: string, input: PptWorkStopRequest) { this.#requireWork(id); const main=this.#generation.state(id),assistant=this.#assistantGeneration.state(id);if(input.generationRequestKey){if(main?.requestKey===input.generationRequestKey)return this.#generation.stop(id,input);if(assistant?.requestKey===input.generationRequestKey)return this.#assistantGeneration.stop(id,input);throw new AppError(ErrorCode.STALE_TARGET,'原生成身份已变化，请核对原请求');}if(assistant&&!['completed','failed','stopped'].includes(assistant.status)){if(main&&!['completed','failed','stopped'].includes(main.status))throw new AppError(ErrorCode.VALIDATION_FAILED,'请选择页面制作或助手讨论的原请求号');return this.#assistantGeneration.stop(id,input);}return this.#generation.stop(id,input); }
  async reconcileOperation(key: string) { this.assistant.reconcile(key);await this.#assistantGeneration.reconcile(key);return this.#generation.reconcile(key); }
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
        updated = this.#store.pptWorks.update({ ...work,productionPages:this.#generation.state(id)?.pages??work.productionPages, id: copy.id, createdAt: copy.createdAt, archived: false, versions: [], status: work.slides.length > 0 ? 'ready' : 'draft' });
      } else if (action === 'archive') {
        if (typeof input.archived !== 'boolean') throw new AppError(ErrorCode.VALIDATION_FAILED, '需要明确归档或恢复');
        updated = this.#store.pptWorks.update({ ...work, archived: input.archived });
      } else {
        this.#assertEditable(work);
        const version = work.versions?.find((item) => item.revision === input.revision);
        if (version === undefined) throw new AppError(ErrorCode.NOT_FOUND, '内容版本未保留');
        this.#generation.clear(id);
        updated = this.#store.pptWorks.update({ ...work, ...version, brief: version.brief, direction: version.direction, plan: version.plan, cover: version.cover,productionPages:version.productionPages, id: work.id, versions: work.versions, archived: work.archived });
      }
      this.#commands.settle(input.requestKey, { workId: updated.id, revision: updated.revision });
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: updated };
    } catch (error) { this.#commands.fail(input.requestKey, error instanceof Error ? error : new Error('作品操作失败')); throw error; }
  }
  #productionReason(work:PptWork):string|undefined {
    /* productionPages is the per-page production truth; the generation record is only a
     * fallback for works persisted before that field existed. */
    const unfinished=(work.productionPages ?? this.#generation.state(work.id)?.pages)?.filter(page=>page.status!=='completed');
    return unfinished?.length?`还有 ${unfinished.length} 页未完成制作；请完成或手动编辑保存这些页面后再导出`:undefined;
  }
  #assertProductionComplete(work:PptWork) {const reason=this.#productionReason(work);if(reason)throw new AppError(ErrorCode.VALIDATION_FAILED,reason);}
  #assistantGuard(id:string,revision:number,key?:string,discussion=false):PptWork {
    const work=this.#requireWork(id);const run=this.#generation.state(id);
    if(discussion && work.status==='generating' && run?.pages && run.status==='running' && this.#commands.get(run.requestKey)?.status==='accepted') {
      if(work.archived)throw new AppError(ErrorCode.CONFLICT,'作品已归档');
      if(revision!==(work.revision??1))throw new AppError(ErrorCode.STALE_TARGET,'作品已有新修订，请按当前页面重新发起讨论');
      const pending=this.#store.operations.listPending().find(item=>item.target.ref===id && item.requestKey!==key && item.requestKey!==run.requestKey && ['ppt.work.generate','ppt.work.slides','ppt.assistant.ask'].includes(item.operation));
      if(pending)throw new AppError(ErrorCode.RECEIPT_UNKNOWN,`原请求待核对：${pending.requestKey}`);
      return work;
    }
    this.#assertEditable(work,revision,key);return work;
  }
  #requireWork(id: string): PptWork { const work = this.#store.pptWorks.get(id); if (!work) throw new AppError(ErrorCode.NOT_FOUND, '作品不存在'); return work; }
  #missingBrief(work: PptWork) { return ([['audience','给谁看'],['objective','想达到'],['length','篇幅'],['style','风格'],['sources','依据资料']] as const).filter(([field])=>!work.brief?.[field]?.trim()).map(([,label])=>label); }
  #assertBrief(work: PptWork) { const fields=this.#missingBrief(work); if(fields.length)throw new AppError(ErrorCode.VALIDATION_FAILED, `先补全并保存需求简报：${fields.join('、')}`,{details:{fields}}); }
  #assertSettled(work: PptWork, ignoreKey?: string, allowActiveGeneration=false) {
    if (!allowActiveGeneration && work.status === 'generating') throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '作品仍在生成，原进程尚未核对结束');
    const unknown = this.#store.operations.listPending().find((record) => record.target.ref === work.id && record.requestKey !== ignoreKey && !(allowActiveGeneration && record.operation==='ppt.assistant.ask' && record.status==='accepted') && (record.operation === 'ppt.work.generate' || record.operation === 'ppt.work.slides' || record.operation === 'ppt.assistant.ask'));
    if (unknown) throw new AppError(ErrorCode.RECEIPT_UNKNOWN, `原生成结果待核对：${unknown.requestKey}`, { httpStatus: 409, details: { requestKey: unknown.requestKey } });
  }
  #assertEditable(work: PptWork, revision?: number, ignoreKey?:string) {
    this.#assertSettled(work,ignoreKey);
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
    this.#store.settings.removeJson(`ppt.assistant.${id}`);
    this.#commands.settle(requestKey, { workId: id, deletedAt: nowIso() });
    return { receipt: this.#commands.toReceipt(this.#commands.get(requestKey)!), resource: this.list().works };
  }
}


/* ------------------------------------------------------------------ */
/* P07-23 · per-page production merge for whole-list plan PATCHes      */
/* ------------------------------------------------------------------ */

/** A page that carries no authored content (only a default title) is not complete. */
function isEmptySlide(slide: PptSlide): boolean {
  return slide.bullets.length === 0 && slide.notes === undefined && slide.imageName === undefined &&
    slide.chapter === undefined && slide.keyMessage === undefined && slide.sourceNames === undefined &&
    slide.layout === undefined && slide.titleStyle === undefined && slide.bodyStyle === undefined &&
    slide.tag === undefined && slide.tagStyle === undefined;
}

/** Body pages as the UI sees them: stored slides padded by the outline (never cover). */
function storedBodyPages(work: PptWork): readonly PptSlide[] {
  if (work.slides.length >= work.outline.length) return work.slides;
  return work.outline.map((title, index) => work.slides[index] ?? { title, bullets: [] as string[] });
}

/** Comparable identity of one page's content (style/notes/footer included by value). */
function slideContentKey(slide: PptSlide): string {
  return JSON.stringify({
    title: slide.title,
    bullets: slide.bullets,
    notes: slide.notes ?? null,
    imageName: slide.imageName ?? null,
    chapter: slide.chapter ?? null,
    keyMessage: slide.keyMessage ?? null,
    sourceNames: slide.sourceNames ?? null,
    layout: slide.layout ?? null,
    titleStyle: slide.titleStyle ?? null,
    bodyStyle: slide.bodyStyle ?? null,
    tag: slide.tag ?? null,
    tagStyle: slide.tagStyle ?? null,
  });
}

/**
 * Merge a whole-list `slides`/`outline` PATCH into the persisted per-page production
 * state without fabricating completions (P07-23).
 *
 * - pages whose content did not change keep their status/source/message (stopped,
 *   failed, unknown, pending, completed);
 * - pages moved by reorder keep their state at the new index;
 * - a page whose content the user actually edited is a legitimate manual completion;
 * - pages that did not exist before stay `pending`, never `completed`.
 */
function mergeProductionPages(prior: readonly PptPageGeneration[] | undefined, work: PptWork,
  input: { readonly slides?: readonly PptSlide[]; readonly outline: readonly string[] }): readonly PptPageGeneration[] | undefined {
  if (prior === undefined) return undefined;
  const byIndex = new Map(prior.map((page) => [page.index, page] as const));
  const manual = (index: number, title: string): PptPageGeneration => ({ index, title, status: 'completed', source: 'manual', completedRevision: (work.revision ?? 1) + 1 });
  if (input.slides !== undefined) {
    const slides = input.slides;
    const oldSlides = storedBodyPages(work);
    const used = new Set<number>();
    const matched = new Map<number, number>();
    for (let index = 0; index < slides.length; index += 1) {
      const old = oldSlides[index];
      if (old !== undefined && slideContentKey(old) === slideContentKey(slides[index]!)) { matched.set(index, index); used.add(index); }
    }
    for (let index = 0; index < slides.length; index += 1) {
      if (matched.has(index)) continue;
      for (let oldIndex = 0; oldIndex < oldSlides.length; oldIndex += 1) {
        if (used.has(oldIndex) || oldSlides[oldIndex] === undefined) continue;
        if (slideContentKey(oldSlides[oldIndex]!) === slideContentKey(slides[index]!)) { matched.set(index, oldIndex); used.add(oldIndex); break; }
      }
    }
    return slides.map((slide, index) => {
      const movedTo = matched.get(index);
      const previous = movedTo === undefined ? undefined : byIndex.get(movedTo);
      if (previous !== undefined) return { ...previous, index, title: slide.title };
      /* 全空的“新页面”不能算人工完成：删除一页后再加一页时索引会与旧页重合，
       * 只有真正带内容的编辑才记为 manual 完成。 */
      if (index < oldSlides.length && !isEmptySlide(slide)) return manual(index, slide.title);
      return { index, title: slide.title, status: 'pending' as const };
    });
  }
  /* Outline-only edit (page title list): preserve production state by title identity. */
  const used = new Set<number>();
  const matched = new Map<number, number>();
  for (let index = 0; index < input.outline.length; index += 1) {
    const same = byIndex.get(index);
    if (same !== undefined && same.title === input.outline[index]) { matched.set(index, index); used.add(index); }
  }
  for (let index = 0; index < input.outline.length; index += 1) {
    if (matched.has(index)) continue;
    const previous = prior.find((page) => !used.has(page.index) && page.title === input.outline[index]);
    if (previous !== undefined) { matched.set(index, previous.index); used.add(previous.index); }
  }
  return input.outline.map((title, index) => {
    const matchedIndex = matched.get(index);
    const previous = matchedIndex === undefined ? undefined : byIndex.get(matchedIndex);
    return previous === undefined ? { index, title, status: 'pending' as const } : { ...previous, index, title };
  });
}

function extractOutline(text: string): readonly string[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { outline?: unknown };
    if (!Array.isArray(parsed.outline)) return [];
    return parsed.outline.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim().slice(0, 200)).slice(0, 100);
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
      .slice(0, 100);
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
  if (!Array.isArray(value) || value.length > 100 || value.some((page) => typeof page.title !== 'string' || page.title.length > 200 || !Array.isArray(page.bullets) || page.bullets.length > 8 || page.bullets.some((bullet: unknown) => typeof bullet !== 'string' || bullet.length > 300) || (page.notes !== undefined && (typeof page.notes !== 'string' || page.notes.length > 4000)))) throw new AppError(ErrorCode.VALIDATION_FAILED, '页面内容、要点或备注超出限制');
  for (const page of value) validateSlideExtras(page);
  return value.map((page) => ({ ...page, title: page.title, bullets: [...page.bullets], ...(page.notes === undefined ? {} : { notes: page.notes }), ...(typeof page.imageName === 'string' ? { imageName: page.imageName } : {}) }));
}
