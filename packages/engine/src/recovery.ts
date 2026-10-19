import {
  AppError,
  ErrorCode,
  RECOVERY_MODES,
  isOperationKind,
  nowIso,
  type CommandResponse,
  type RecoveryCreateRequest,
  type RecoveryCreateResponse,
  type RecoveryHistoryResponse,
  type RecoveryModeValue,
  type RecoveryRecord,
  type Task,
} from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';
import type { CommandService } from './operations.ts';

const RECOVERY_KEY_PREFIX = 'task.recovery.';
const MAX_NOTE = 2_000;

export interface RecoveryServiceOptions {
  readonly store: Store;
  readonly commands: CommandService;
}

/**
 * Creates a derived draft from a stopped/failed task. Recovery never mutates the
 * parent task, its execution evidence or its delivery records; the lineage is
 * stored next to the derived task and exposed as a read-only history.
 */
export class RecoveryService {
  readonly #store: Store;
  readonly #commands: CommandService;

  constructor(options: RecoveryServiceOptions) {
    this.#store = options.store;
    this.#commands = options.commands;
  }

  create(parentTaskId: string, input: RecoveryCreateRequest): CommandResponse<RecoveryCreateResponse> {
    if (input === null || typeof input !== 'object') throw new AppError(ErrorCode.VALIDATION_FAILED, '恢复请求体不合法');
    if (typeof input.requestKey !== 'string' || input.requestKey.length < 8) throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 requestKey');
    if (input.confirmCreate !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '需要显式确认创建恢复草稿');
    if (!RECOVERY_MODES.includes(input.mode)) throw new AppError(ErrorCode.VALIDATION_FAILED, '恢复方式不合法');
    const note = typeof input.note === 'string' ? input.note.trim().slice(0, MAX_NOTE) : '';
    const parent = this.#requireTask(parentTaskId);
    this.#assertRecoverable(parent);

    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'task.recovery.create',
      body: { parentTaskId, mode: input.mode, note },
      target: { taskId: parentTaskId },
    });
    if (replayed) {
      if (record.status === 'accepted') {
        throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '同一请求号的恢复草稿正在创建；请按 requestKey 核对回执');
      }
      const derivedTaskId = typeof record.outcome?.taskId === 'string' ? record.outcome.taskId : undefined;
      const derived = derivedTaskId === undefined ? undefined : this.#store.tasks.get(derivedTaskId);
      if (derived === undefined) {
        throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '恢复回执存在但派生任务不可读；请按 requestKey 核对');
      }
      return { receipt: this.#commands.toReceipt(record), resource: { task: derived, recovery: this.#record(derived.id)! } };
    }

    try {
      const created = this.#store.tasks.create({
        projectId: parent.projectId,
        title: derivedTitle(parent.title, input.mode),
        requirementText: parent.requirement.text,
        methodId: parent.methodId,
        methodRevision: parent.methodRevision,
        ...(parent.fixedTemplate === undefined ? {} : { fixedTemplate: parent.fixedTemplate }),
      });
      const recovery: RecoveryRecord = {
        taskId: created.id,
        parentTaskId,
        mode: input.mode,
        title: created.title,
        stage: created.stage,
        lifecycle: created.lifecycle,
        createdAt: nowIso(),
      };
      this.#store.settings.putJson(`${RECOVERY_KEY_PREFIX}${created.id}`, {
        ...recovery,
        requestKey: input.requestKey,
        note,
        parentRequirementRevision: parent.requirement.revision,
      });
      this.#store.tasks.update(created.id, { attention: 'none' });
      this.#store.events.publish('task.changed', { taskId: created.id, projectId: created.projectId, stage: created.stage, revision: 1 });
      this.#commands.settle(input.requestKey, { taskId: created.id, parentTaskId, mode: input.mode });
      return {
        receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!),
        resource: { task: this.#store.tasks.get(created.id) ?? created, recovery },
      };
    } catch (error) {
      this.#commands.fail(input.requestKey, error instanceof Error ? error : new Error('创建恢复草稿失败'));
      throw error;
    }
  }

  list(parentTaskId: string): RecoveryHistoryResponse {
    this.#requireTask(parentTaskId);
    const recoveries: RecoveryRecord[] = [];
    for (const task of this.#store.tasks.list()) {
      const record = this.#record(task.id);
      if (record !== undefined && record.parentTaskId === parentTaskId) {
        recoveries.push({ ...record, stage: task.stage, lifecycle: task.lifecycle, title: task.title });
      }
    }
    recoveries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return { recoveries };
  }

  #record(derivedTaskId: string): RecoveryRecord | undefined {
    const stored = this.#store.settings.getJson<RecoveryRecord & { requestKey?: string }>(`${RECOVERY_KEY_PREFIX}${derivedTaskId}`);
    if (stored === undefined) return undefined;
    return {
      taskId: stored.taskId,
      parentTaskId: stored.parentTaskId,
      mode: stored.mode,
      title: stored.title,
      stage: stored.stage,
      lifecycle: stored.lifecycle,
      createdAt: stored.createdAt,
    };
  }

  #assertRecoverable(task: Task): void {
    const round = task.currentPlanningRoundId === undefined ? this.#store.planning.latest(task.id) : this.#store.planning.get(task.currentPlanningRoundId);
    if (round !== undefined && ['queued', 'running', 'stopping'].includes(round.status)) {
      throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '原任务仍在规划中，请先停止规划再恢复', { details: { status: round.status } });
    }
    const execution = task.executionId === undefined ? this.#store.executions.byTask(task.id) : this.#store.executions.get(task.executionId);
    if (execution !== undefined && ['running', 'pausing', 'stopping'].includes(execution.status)) {
      throw new AppError(ErrorCode.HUMAN_REVIEW_REQUIRED, '原任务仍在执行中，请先暂停/取消执行再恢复', { details: { status: execution.status } });
    }
    const workspace = task.workspaceId === undefined ? this.#store.workspaces.byTask(task.id) : this.#store.workspaces.get(task.workspaceId);
    if (workspace !== undefined && ['preparing', 'cleaning'].includes(workspace.state)) {
      throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '原任务工作区正在准备/清理，请等待结束再恢复', { details: { state: workspace.state } });
    }
    if (task.lifecycle === 'active' && task.attention === 'none') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '原任务没有需要恢复的失败或阻断上下文', { details: { stage: task.stage } });
    }
  }

  #requireTask(taskId: string): Task {
    const task = this.#store.tasks.get(taskId);
    if (task === undefined) throw new AppError(ErrorCode.NOT_FOUND, '原任务不存在', { details: { taskId } });
    return task;
  }
}

function derivedTitle(parentTitle: string, mode: RecoveryModeValue): string {
  const suffix = mode === 'from_failed_stage' ? '从失败阶段恢复' : mode === 'all_stages' ? '全阶段恢复' : '只读验证恢复';
  const title = `${parentTitle}（${suffix}）`;
  return title.length <= 120 ? title : `${title.slice(0, 117)}…`;
}

export function isRecoveryMode(value: unknown): value is RecoveryModeValue {
  return typeof value === 'string' && (RECOVERY_MODES as readonly string[]).includes(value);
}

/** Guard so a future operation registration cannot silently drop recovery. */
export function assertRecoveryOperationRegistered(): void {
  if (!isOperationKind('task.recovery.create')) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, 'task.recovery.create 未注册到操作表');
  }
}

