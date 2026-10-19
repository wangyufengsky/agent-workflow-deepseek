import { AppError, ErrorCode, nowIso, type CommandResponse, type PptPageGeneration, type PptWorkStopRequest } from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';
import type { CommandService } from './operations.ts';
import type { OpenCodePort } from './ports.ts';
interface Generation {
    readonly pages?: readonly PptPageGeneration[];
    readonly workId: string;
    readonly requestKey: string;
    readonly startedAt: string;
    readonly status: import('@agent-workflow/shared').PptGenerationStatusValue;
    readonly sessionId?: string;
    readonly stopRequestKey?: string;
}
/** Persisted identity and positive-stop evidence, separate from content generation. */
export class PptGenerationCoordinator {
    readonly #prefix: string;
    readonly #affectsWork: boolean;
    readonly #active = new Set<string>();
    readonly store: Store;
    readonly commands: CommandService;
    readonly opencode: OpenCodePort;
    constructor(store: Store, commands: CommandService, opencode: OpenCodePort, options:{prefix?:string;affectsWork?:boolean}={}) { this.#prefix=options.prefix??'ppt.generation.';this.#affectsWork=options.affectsWork!==false;this.store = store; this.commands = commands; this.opencode = opencode; }
    #key(workId:string){return this.#prefix+workId;}
    state(workId: string): Generation | undefined { return this.store.settings.getJson<Generation>(this.#key(workId)); }
    begin(workId: string, requestKey: string, titles?: readonly string[]) { this.#active.add(requestKey); this.save({ workId, requestKey, startedAt: nowIso(), status: 'running', ...(titles ? {pages:titles.map((title,index)=>({index,title,status:'pending' as const}))} : {}) }); }
    startPage(workId:string,key:string,index:number) {
      const run=this.state(workId);
      if(!run || run.requestKey!==key)throw new AppError(ErrorCode.STALE_TARGET,'原逐页生成身份已变化');
      if(run.stopRequestKey && !run.sessionId){this.finishStopped(run);return false;}
      if(run.status!=='running')return false;
      this.save({...run,sessionId:undefined,pages:run.pages?.map(page=>page.index===index?{...page,status:'generating',message:undefined}:page)});
      return true;
    }
    pageCompleted(workId:string,key:string,index:number,revision:number) {
      const run=this.state(workId);
      if(!run || run.requestKey!==key || run.status!=='running' || run.stopRequestKey)throw new AppError(ErrorCode.STALE_TARGET,'原逐页生成已不再允许保存');
      this.save({...run,sessionId:undefined,pages:run.pages?.map(page=>page.index===index?{...page,status:'completed',source:'model',completedRevision:revision}:page)});
    }
    pageEdited(workId:string,index:number,title:string,revision:number) {
      const run=this.state(workId);if(!run?.pages)return;
      this.save({...run,pages:run.pages.map(page=>page.index===index?{...page,title,status:'completed',source:'manual',message:'人工修改已保存',completedRevision:revision}:page)});
    }
    clear(workId:string) { const run=this.state(workId);if(run)this.#active.delete(run.requestKey);this.store.settings.removeJson(this.#key(workId)); }
    /** Durable no-session identity proves the next page prompt was never dispatched. */
    recoverUnsent(workId:string):boolean {
      const run=this.state(workId);if(!run?.pages?.length || run.sessionId || this.#active.has(run.requestKey))return false;
      const work=this.store.pptWorks.get(workId);if(!work)return false;
      if(run.pages.every(page=>page.status==='completed')) {
        this.store.pptWorks.update({...work,status:'ready'});this.complete(workId);
        this.commands.settle(run.requestKey,{workId,recoveredPersistedOutput:true,slides:run.pages.length});return true;
      }
      if(run.stopRequestKey){this.finishStopped(run);return true;}
      this.store.pptWorks.update({...work,status:'failed'});
      this.save({...run,status:'failed',pages:run.pages.map(page=>page.status==='completed'?page:{...page,status:'stopped',message:'服务在这一页提示派发前重启，已有页面保留'})});
      this.commands.fail(run.requestKey,new AppError(ErrorCode.OPENCODE_PROVIDER_FAILED,'逐页生成在下一页提示派发前中断，已有页面保留；可以明确开始新一次制作'));return true;
    }
    bind(workId: string, requestKey: string): (sessionId: string) => void {
        return (sessionId) => {
            const run = this.state(workId);
            if (!run || run.requestKey !== requestKey)
                throw new AppError(ErrorCode.STALE_TARGET, '原PPT生成身份已变化');
            if (run.stopRequestKey) {
                this.finishStopped(run); // The adapter invokes this hook before submitting the prompt.
                throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, 'PPT生成在提示派发前已停止');
            }
            this.save({ ...run, sessionId });
        };
    }
    onIdle(workId: string, requestKey: string) { const run = this.state(workId); if (run?.requestKey === requestKey && run.stopRequestKey)
        this.finishStopped(run); }
    ignoreLate(workId: string, key: string) { const run = this.state(workId); return run?.requestKey !== key || run.status === 'failed'; }
    stopped(workId: string) { return this.state(workId)?.status === 'stopped'; }
    afterResult(workId: string, outcome: {
        idle: boolean;
        timedOut: boolean;
    }): boolean {
        const run = this.state(workId);
        if (run?.status === 'stopped')
            return true;
        if (run?.stopRequestKey && outcome.idle && !outcome.timedOut) {
            this.finishStopped(run);
            return true;
        }
        return false;
    }
    complete(workId: string) { const run = this.state(workId); if (run)
        this.#active.delete(run.requestKey); if (run && !run.stopRequestKey)
        this.save({ ...run, status: 'completed' }); }
    fail(workId: string, unknown: boolean) { const run = this.state(workId); if (run)
        this.#active.delete(run.requestKey); if (run && run.status !== 'stopped') {
        this.save({ ...run, status: unknown ? 'unknown' : 'failed',pages:run.pages?.map(page=>page.status==='generating'?{...page,status:unknown?'unknown':'failed',message:unknown?'原页面生成结果待核对':'这一页生成失败'}:page.status==='pending'&&!unknown?{...page,status:'stopped',message:'本次生成已结束，未制作这一页'}:page) });
        if (run.stopRequestKey)
            this.commands.fail(run.stopRequestKey, new AppError(ErrorCode.RECEIPT_UNKNOWN, '停止尚未得到原会话终态证据'), true);
    } }
    async stop(workId: string, input: PptWorkStopRequest): Promise<CommandResponse> {
        if (input.confirmStop !== true)
            throw new AppError(ErrorCode.VALIDATION_FAILED, '停止需要明确确认');
        const run = this.state(workId);
        if (!run)
            throw new AppError(ErrorCode.NOT_FOUND, '没有可核对的原生成记录');
        const { record, replayed } = this.commands.begin({ requestKey: input.requestKey, operation: 'ppt.work.stop', body: { workId, generationKey: run.requestKey }, target: { ref: workId } });
        if (replayed)
            return { receipt: this.commands.toReceipt(record) };
        if (['completed', 'failed', 'stopped'].includes(run.status))
            this.commands.settle(input.requestKey, { alreadyTerminal: true, generationKey: run.requestKey });
        else if (run.stopRequestKey)
            this.commands.fail(input.requestKey, new AppError(ErrorCode.OPERATION_IN_PROGRESS, `请核对原停止请求 ${run.stopRequestKey}`));
        else {
            const stopping = { ...run, status: 'stopping' as const, stopRequestKey: input.requestKey };
            this.save(stopping);
            if (run.sessionId) {
                let timer: ReturnType<typeof setTimeout> | undefined;
                try {
                    await Promise.race([this.opencode.abortSession(run.sessionId), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('停止确认超时')), 5000); timer.unref(); })]);
                    await this.reconcile(input.requestKey);
                }
                catch (error) {
                    if (!this.stopped(workId)) {
                        this.save({ ...stopping, status: 'unknown' });
                        this.commands.fail(input.requestKey, error instanceof Error ? error : new Error('停止未知'), true);
                    }
                }
                finally {
                    if (timer)
                        clearTimeout(timer);
                }
            }
        }
        return { receipt: this.commands.toReceipt(this.commands.get(input.requestKey)!) };
    }
    async reconcile(key: string) {
        const record = this.commands.get(key);
        if (!record || !['ppt.work.stop', 'ppt.work.generate', 'ppt.work.slides', 'ppt.assistant.ask'].includes(record.operation) || !['accepted', 'unknown'].includes(record.status) || !record.target.ref)
            return;
        const run = this.state(record.target.ref);
        if (!run || ![run.requestKey, run.stopRequestKey].includes(key))
            return;
        if (run.status === 'completed') {
            this.commands.settle(run.requestKey, { workId: run.workId, recoveredPersistedOutput: true });
            return;
        }
        if (run.status === 'stopped') {
            this.finishStopped(run);
            return;
        }
        if (!run.sessionId) {this.recoverUnsent(run.workId);return;}
        try {
            if (await this.opencode.inspectSession?.(run.sessionId) !== 'idle')
                return;
            const current = this.state(run.workId);
            if (!current || current.requestKey !== run.requestKey || current.status === 'completed' || current.status === 'failed')
                return;
            if (current.stopRequestKey)
                this.finishStopped(current);
            else if (!this.#active.has(run.requestKey)) {
                // Positive terminal evidence without readable output is a known lost result,
                // never fabricated success; retain previous content and permit explicit new work.
                const work = this.store.pptWorks.get(run.workId);
                if (work && this.#affectsWork)
                    this.store.pptWorks.update({ ...work, status: 'failed' });
                this.save({ ...run, status: 'failed',pages:run.pages?.map(page=>page.status==='completed'?page:{...page,status:'failed',message:'原会话已空闲，但这一页没有保留生成产物'}) });
                this.commands.fail(run.requestKey, new AppError(ErrorCode.OPENCODE_PROVIDER_FAILED, '原调用已结束，但生成产物未保留；已有内容保留，可显式开始新一次生成'));
            }
        }
        catch { /* Unknown remains locked. */ }
    }
    private save(run: Generation) { this.store.settings.putJson(this.#key(run.workId), run); }
    private finishStopped(run: Generation) {
        const current = this.state(run.workId);
        if (!current || current.requestKey !== run.requestKey || ['completed', 'failed'].includes(current.status))
            return;
        const work = this.store.pptWorks.get(run.workId);
        const stoppedPages=current.pages?.map(page=>page.status==='completed'?page:{...page,status:'stopped' as const,message:'本次生成已停止，原有内容保留'});
        if (work && this.#affectsWork && current.status !== 'stopped')
            this.store.pptWorks.update({ ...work, productionPages:stoppedPages??work.productionPages,status: work.slides.length || work.outline.length ? 'ready' : 'draft' });
        this.#active.delete(current.requestKey);
        this.save({ ...current, status: 'stopped',pages:stoppedPages });
        if (this.commands.get(run.requestKey)?.status !== 'succeeded')
            this.commands.settle(run.requestKey, { stopped: true, retainedContent: true });
        if (current.stopRequestKey && this.commands.get(current.stopRequestKey)?.status !== 'succeeded')
            this.commands.settle(current.stopRequestKey, { stopped: true, generationKey: run.requestKey });
    }
}
