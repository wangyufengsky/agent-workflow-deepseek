import { AppError, ErrorCode, nowIso, type CommandResponse, type PptWork, type PptWorkCreateRequest, type PptWorksResponse } from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';
import type { CommandService } from './operations.ts';

export class PptService {
  readonly #store: Store;
  readonly #commands: CommandService;

  constructor(store: Store, commands: CommandService) {
    this.#store = store;
    this.#commands = commands;
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
