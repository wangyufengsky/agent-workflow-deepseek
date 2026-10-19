import { AppError, ErrorCode, nowIso, type CommandResponse, type TaskTemplate } from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';
import type { CommandService } from './operations.ts';

const KEY = 'catalog.templates.custom';

/** Custom fixed templates imported by the user; built-in templates stay immutable. */
export class TemplateCatalogService {
  readonly #store: Store;
  readonly #commands: CommandService;
  readonly #apply: (templates: readonly TaskTemplate[]) => void;
  #base: readonly TaskTemplate[] = [];

  constructor(store: Store, commands: CommandService, apply: (templates: readonly TaskTemplate[]) => void) {
    this.#store = store;
    this.#commands = commands;
    this.#apply = apply;
  }

  list(): readonly TaskTemplate[] {
    return this.#store.settings.getJson<TaskTemplate[]>(KEY) ?? [];
  }

  applyEffective(base: readonly TaskTemplate[]): readonly TaskTemplate[] {
    this.#base = base;
    const templates = [...base, ...this.list()];
    this.#apply(templates);
    return templates;
  }

  import(input: { requestKey: string; template: TaskTemplate; confirmImport: true }): CommandResponse<readonly TaskTemplate[]> {
    if (input?.confirmImport !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '导入模板需要显式确认');
    const template = validate(input.template);
    if (this.list().some((item) => item.id === template.id)) throw new AppError(ErrorCode.CONFLICT, '同 id 的自定义模板已存在', { details: { templateId: template.id } });
    const { replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'catalog.template.import',
      body: { templateId: template.id },
      target: { ref: template.id },
    });
    if (replayed) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '同一请求号已受理，请按回执核对');
    const next = [...this.list(), template];
    this.#store.settings.putJson(KEY, next);
    this.applyEffective(this.#base);
    this.#commands.settle(input.requestKey, { templateId: template.id, version: template.version });
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: next };
  }

  archive(id: string): readonly TaskTemplate[] {
    const next = this.list().filter((item) => item.id !== id);
    this.#store.settings.putJson(KEY, next);
    this.applyEffective(this.#base);
    return next;
  }
}

function validate(raw: TaskTemplate): TaskTemplate {
  if (raw === null || typeof raw !== 'object') throw new AppError(ErrorCode.VALIDATION_FAILED, '模板 JSON 不合法');
  if (typeof raw.id !== 'string' || !/^template\.custom\.[A-Za-z0-9._-]{1,60}$/.test(raw.id)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, '自定义模板 id 必须以 template.custom. 开头');
  }
  if (typeof raw.name !== 'string' || raw.name.trim() === '' || raw.name.length > 120) throw new AppError(ErrorCode.VALIDATION_FAILED, '模板名称不合法');
  if (!Number.isInteger(raw.version) || raw.version < 1) throw new AppError(ErrorCode.VALIDATION_FAILED, '模板版本必须是正整数');
  if (!Array.isArray(raw.steps) || raw.steps.length < 1 || raw.steps.length > 30) throw new AppError(ErrorCode.VALIDATION_FAILED, '模板步骤需要 1–30 个');
  if (!Array.isArray(raw.parameters)) throw new AppError(ErrorCode.VALIDATION_FAILED, '模板参数必须是数组');
  return {
    id: raw.id,
    name: raw.name.trim(),
    version: raw.version,
    lockedAfterCreate: true,
    steps: raw.steps.map((step, index) => {
      if (step === null || typeof step !== 'object') throw new AppError(ErrorCode.VALIDATION_FAILED, `步骤 ${index + 1} 不合法`);
      if (typeof step.key !== 'string' || step.key.trim() === '') throw new AppError(ErrorCode.VALIDATION_FAILED, `步骤 ${index + 1} 缺少 key`);
      if (typeof step.title !== 'string' || step.title.trim() === '') throw new AppError(ErrorCode.VALIDATION_FAILED, `步骤 ${index + 1} 缺少标题`);
      if (step.kind !== 'implementation' && step.kind !== 'test' && step.kind !== 'delivery') throw new AppError(ErrorCode.VALIDATION_FAILED, `步骤 ${index + 1} kind 不合法`);
      return { key: step.key.trim(), title: step.title.trim(), kind: step.kind, group: typeof step.group === 'string' && step.group.trim() !== '' ? step.group.trim() : '固定步骤' };
    }),
    parameters: raw.parameters.map((parameter, index) => {
      if (parameter === null || typeof parameter !== 'object' || typeof parameter.key !== 'string' || parameter.key.trim() === '' || typeof parameter.label !== 'string') {
        throw new AppError(ErrorCode.VALIDATION_FAILED, `参数 ${index + 1} 不合法`);
      }
      return { key: parameter.key.trim(), label: parameter.label.trim(), required: parameter.required === true };
    }),
  };
}
