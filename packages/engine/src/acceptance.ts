import { AppError, ErrorCode, nowIso, type CommandResponse, type TaskAcceptance, type TaskAcceptanceRequest } from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';
import type { CommandService } from './operations.ts';

export class AcceptanceService {
  readonly #store: Store;
  readonly #commands: CommandService;

  constructor(store: Store, commands: CommandService) {
    this.#store = store;
    this.#commands = commands;
  }

  get(taskId: string): { acceptance?: TaskAcceptance } {
    if (this.#store.tasks.get(taskId) === undefined) throw new AppError(ErrorCode.NOT_FOUND, '任务不存在');
    return { acceptance: this.#store.acceptances.get(taskId) };
  }

  decide(taskId: string, input: TaskAcceptanceRequest): CommandResponse<{ acceptance?: TaskAcceptance }> {
    if (input?.confirmDecide !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '验收结论需要显式确认');
    if (input.verdict !== 'accepted' && input.verdict !== 'rejected') throw new AppError(ErrorCode.VALIDATION_FAILED, '验收结论不合法');
    const task = this.#store.tasks.get(taskId);
    if (task === undefined) throw new AppError(ErrorCode.NOT_FOUND, '任务不存在');
    const note = typeof input.note === 'string' ? input.note.trim().slice(0, 2_000) : '';
    const { replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'task.accept',
      body: { taskId, verdict: input.verdict, note },
      target: { taskId },
    });
    if (replayed) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '同一请求号已受理，请按回执核对');
    const acceptance: TaskAcceptance = {
      taskId,
      verdict: input.verdict,
      ...(note === '' ? {} : { note }),
      decidedAt: nowIso(),
    };
    this.#store.acceptances.put(acceptance);
    this.#commands.settle(input.requestKey, { taskId, verdict: input.verdict });
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: { acceptance } };
  }
}
