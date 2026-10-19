import { validQualityReviewContract } from '@agent-workflow/shared';
import { createHash } from 'node:crypto';
import {
  AppError,
  DEFAULT_CATALOG,
  DEFAULT_SETTINGS,
  type MethodUsage,
  type MethodPlanningSummary,
  type AppSettings,
  type RoleDefinition,
  type Task,
  ErrorCode,
  createId,
  methodCycle,
  nowIso,
  type MethodStepDefinition,
  type NodeKindValue,
  type TaskMethodSupportValue,
  type WorkflowMethod,
  type RolePackageBinding,
} from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';

/**
 * W3-8a · Workflow (method) catalog backend core.
 *
 * The built-in catalog (`DEFAULT_CATALOG.methods`) is read-only. User-defined
 * methods are persisted as JSON in the local settings store under
 * `catalog.methods.custom` so this service stays usable before the HTTP layer is
 * wired (next wave: Engine + routes + contracts + receipts). Every mutation
 * carries a `requestKey` and is idempotent at the service level (same key +
 * same body replays the stored result; a different body is rejected), mirroring
 * the repository-wide write contract.
 *
 * Versioning: each custom method has an integer `version` starting at 1. Save /
 * archive bump it, and the effective `WorkflowMethod.revision` becomes `r<version>`.
 * A save that quotes a stale `expectedVersion` is rejected with CONFLICT and the
 * current version — the editor shows "已被更新为版本 N" and offers "导出我的修改".
 *
 * Steps preserve authored content and explicit predecessor edges. Omitted
 * predecessors retain ordered legacy behavior; [] creates an independent root.
 */

const CUSTOM_KEY = 'catalog.methods.custom';
const REQUEST_KEY = 'catalog.method.requests';
const REQUEST_LIMIT = 200;
const CUSTOM_ID_PREFIX = 'method.custom.';
const ID_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const STEP_KEY_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;
const MAX_NAME = 120;
const MAX_DESCRIPTION = 2_000;
const MAX_STEPS = 50;
const MAX_GROUPS = 20;
const MAX_GROUP_LABEL = 60;
const MAX_TITLE = 120;
const NODE_KINDS: readonly NodeKindValue[] = ['requirement', 'design', 'implementation', 'test', 'verify', 'delivery', 'system'];
const SUPPORT_VALUES: readonly TaskMethodSupportValue[] = ['ai_planning', 'skeleton_only'];

/** A method step plus the forward-compatible editor fields. */
export type MethodStepView = MethodStepDefinition & {
  /** Role that owns this step ("谁来做"); must exist when present. */
  readonly roleId?: string;
  /** Explicit predecessors used by validation and graph compilation. */
  readonly requires?: readonly string[];
};

export interface MethodDraftInput {
  readonly name: string;
  readonly description?: string;
  readonly support?: TaskMethodSupportValue;
  readonly requiredSteps: readonly MethodStepView[];
  readonly refinableGroups?: readonly string[];
  readonly planningStrategy?: { readonly id: string; readonly version: string; readonly roleId: string };
}

export interface MethodCatalogEntry {
  readonly usage?: MethodUsage;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly source: 'builtin' | 'custom';
  readonly support: TaskMethodSupportValue;
  readonly version: number;
  readonly revision: string;
  readonly stepCount: number;
  readonly archived: boolean;
  readonly updatedAt?: string;
  readonly copiedFrom?: { readonly id: string; readonly version: number };
}

export interface MethodCatalogDetail extends MethodCatalogEntry {
  readonly planningSummary?: MethodPlanningSummary;
  readonly requiredSteps: readonly MethodStepView[];
  readonly refinableGroups: readonly string[];
  readonly planningStrategy?: { readonly id: string; readonly version: string; readonly roleId: string };
}

export interface MethodValidationProblem {
  readonly code: string;
  readonly message: string;
  readonly field?: 'name' | 'description' | 'support' | 'requiredSteps' | 'refinableGroups' | 'planningStrategy';
  readonly stepKey?: string;
}

export interface MethodValidationCheck {
  readonly id: string;
  readonly label: string;
  readonly state: 'passed' | 'failed';
}

export interface MethodValidationResult {
  readonly ok: boolean;
  readonly problems: readonly MethodValidationProblem[];
  readonly checks: readonly MethodValidationCheck[];
}

export interface MethodMutationResult {
  readonly requestKey: string;
  readonly replayed: boolean;
  readonly method: MethodCatalogDetail;
}

export interface MethodListQuery {
  readonly includeArchived?: boolean;
  readonly source?: 'builtin' | 'custom' | 'all';
  readonly q?: string;
}

export interface MethodInstantiation {
  readonly method: WorkflowMethod;
  readonly source: 'builtin' | 'custom';
  readonly customVersion?: number;
  /** Deep copy: mutating it can never change the catalog. */
  readonly frozen: boolean;
}

export interface MethodCatalogServiceOptions {
  readonly store: Store;
  /** Effective role ids for "职业存在" validation; defaults to the live catalog. */
  readonly roleIds?: () => readonly string[];
  readonly roles?: () => readonly RoleDefinition[];
  readonly planningSettings?: () => AppSettings['planning'];
}

interface StoredCustomMethod {
  readonly history?: readonly MethodCatalogDetail[];
  readonly method: WorkflowMethod;
  readonly version: number;
  readonly archived: boolean;
  readonly copiedFrom?: { readonly id: string; readonly version: number };
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface StoredRequest {
  readonly bodyHash: string;
  readonly result: MethodMutationResult;
}

/** Built-ins are snapshotted once; the live catalog may be mutated by role services. */
const BUILT_IN_METHODS: readonly WorkflowMethod[] = [...DEFAULT_CATALOG.methods];

export class MethodCatalogService {
  readonly #store: Store;
  readonly #roleIds: () => readonly string[];
  readonly #roles: () => readonly RoleDefinition[];
  readonly #planningSettings: () => AppSettings['planning'];

  constructor(options: MethodCatalogServiceOptions) {
    this.#store = options.store;
    this.#roles = options.roles ?? (() => DEFAULT_CATALOG.roles);
    this.#planningSettings = options.planningSettings ?? (() => DEFAULT_SETTINGS.planning);
    this.#roleIds = options.roleIds ?? (() => DEFAULT_CATALOG.roles.map((role) => role.id));
  }

  /* ---------------------------------------------------------------- */
  /* Read / merged view                                               */
  /* ---------------------------------------------------------------- */

  /** Merged view: built-ins first, then custom methods (archived hidden by default). */
  list(query: MethodListQuery = {}): readonly MethodCatalogEntry[] {
    const includeArchived = query.includeArchived === true;
    const source = query.source ?? 'all';
    const needle = query.q?.trim().toLowerCase() ?? '';
    const entries: MethodCatalogEntry[] = [];
    if (source !== 'custom') entries.push(...BUILT_IN_METHODS.map(builtinEntry));
    if (source !== 'builtin') entries.push(...this.#customRecords().map((record) => customEntry(record)));
    const tasks = this.#store.tasks.list();
    return entries
      .filter((entry) => includeArchived || !entry.archived)
      .filter((entry) => needle === '' || entry.name.toLowerCase().includes(needle) || entry.description.toLowerCase().includes(needle) || entry.id.toLowerCase().includes(needle))
      .map((entry) => this.#withUsage(entry, tasks));
  }

  get(id: string): MethodCatalogDetail {
    if (typeof id !== 'string' || id === '') throw new AppError(ErrorCode.VALIDATION_FAILED, '流程 id 不能为空');
    const builtin = BUILT_IN_METHODS.find((method) => method.id === id);
    if (builtin !== undefined) return this.#readDetail({ ...builtinDetail(builtin), requiredSteps: this.#bound(builtin).requiredSteps });
    const record = this.#customRecord(id);
    if (record === undefined) throw new AppError(ErrorCode.NOT_FOUND, '流程不存在', { details: { methodId: id } });
    return this.#readDetail({ ...customDetail(record), requiredSteps: this.#bound(record.method).requiredSteps });
  }

  /** Historical snapshots are immutable and read only. Legacy versions absent from disk are not invented. */
  versions(id: string): readonly MethodCatalogDetail[] {
    const current = this.get(id);
    const history = this.#customRecord(id)?.history ?? [];
    return [...history.map((item) => this.#readDetail(structuredClone(item))), current].sort((a, b) => a.version - b.version);
  }

  #withUsage<T extends MethodCatalogEntry>(entry: T, allTasks: readonly Task[] = this.#store.tasks.list()): T {
    const tasks = allTasks.filter((task) => task.methodId === entry.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    return { ...entry, usage: {
      taskCount: tasks.length,
      currentRevisionTaskCount: tasks.filter((task) => task.methodRevision === entry.revision).length,
      recentTasks: tasks.slice(0, 3).map((task) => ({
        taskId: task.id, title: task.title,
        projectName: this.#store.projects.get(task.projectId)?.name ?? '项目已不可用',
        methodRevision: task.methodRevision, stage: task.stage, lifecycle: task.lifecycle,
        createdAt: task.createdAt,
        ...(task.executionId === undefined ? {} : { executionId: task.executionId }),
      })),
    } };
  }

  #readDetail(detail: MethodCatalogDetail): MethodCatalogDetail {
    const entry = this.#withUsage(detail);
    if (detail.support !== 'ai_planning') return entry;
    const settings = this.#planningSettings();
    const limits = { maxDrafts: settings.maxDrafts, maxRevisions: settings.maxRevisions,
      transportRetries: settings.transportRetries, maxNodes: settings.maxNodes,
      maxEdges: settings.maxEdges, maxGroups: settings.maxGroups, maxDepth: settings.maxDepth };
    const role = this.#roles().find((item) => item.id === detail.planningStrategy?.roleId);
    const roleSummary = role === undefined ? undefined : { id: role.id, name: role.name, revision: role.revision };
    // This digest describes the current catalog policy, not a task's frozen planning snapshot.
    const policyHash = createHash('sha256').update(JSON.stringify({ methodId: detail.id,
      revision: detail.revision, strategy: detail.planningStrategy, requiredSteps: detail.requiredSteps,
      refinableGroups: detail.refinableGroups, role: roleSummary, limits })).digest('hex');
    return { ...entry, planningSummary: { policyHash, limits, ...(roleSummary === undefined ? {} : { role: roleSummary }) } };
  }

  /** Merged resolution: custom ids win over a built-in with the same id (none today). */
  resolve(id: string): WorkflowMethod | undefined {
    const record = this.#customRecord(id);
    if (record !== undefined) return this.#bound(record.method);
    const builtin = BUILT_IN_METHODS.find((method) => method.id === id);
    return builtin === undefined ? undefined : this.#bound(builtin);
  }

  /**
   * Instantiate a method for a new task. The returned definition is a deep copy
   * of the version currently in the catalog; editing the catalog afterwards must
   * never change an already-started task. Archived methods cannot be used.
   */
  instantiate(id: string): MethodInstantiation {
    const builtin = BUILT_IN_METHODS.find((method) => method.id === id);
    if (builtin !== undefined) return { method: this.#bound(builtin), source: 'builtin', frozen: true };
    const record = this.#customRecord(id);
    if (record === undefined) throw new AppError(ErrorCode.NOT_FOUND, '流程不存在', { details: { methodId: id } });
    if (record.archived) {
      throw new AppError(ErrorCode.CONFLICT, '该流程已归档，不能用于新任务', { details: { methodId: id, version: record.version } });
    }
    return { method: this.#bound(record.method), source: 'custom', customVersion: record.version, frozen: true };
  }

  #bound(method: WorkflowMethod): WorkflowMethod {
    const bindings = this.#store.settings.getJson<readonly RolePackageBinding[]>('catalog.role.bindings') ?? [];
    const copy = cloneMethod(method);
    return {...copy,requiredSteps:copy.requiredSteps.map((step)=>{
      const binding = bindings.find((item)=>item.methodId===method.id && item.stepKey===step.key);
      return binding ? {...step,roleId:binding.roleId} : step;
    })};
  }

  /* ---------------------------------------------------------------- */
  /* Validation                                                       */
  /* ---------------------------------------------------------------- */

  /**
   * Deterministic editor validation ("检查"). `id` lets save-mode validation keep
   * the delivery/system steps of the definition being edited.
   */
  validate(input: { readonly draft: MethodDraftInput; readonly id?: string }): MethodValidationResult {
    const problems: MethodValidationProblem[] = [];
    const push = (code: string, message: string, extra: { field?: MethodValidationProblem['field']; stepKey?: string } = {}): void => {
      problems.push({ code, message, ...(extra.field === undefined ? {} : { field: extra.field }), ...(extra.stepKey === undefined ? {} : { stepKey: extra.stepKey }) });
    };
    const draft = input.draft;
    if (draft === null || typeof draft !== 'object') {
      push('DRAFT_INVALID', '流程定义不合法', { field: 'name' });
      return finish(problems);
    }

    const name = typeof draft.name === 'string' ? draft.name.trim() : '';
    if (name === '' || name.length > MAX_NAME) push('NAME_INVALID', `流程名称需要 1–${String(MAX_NAME)} 个字符`, { field: 'name' });
    const description = draft.description ?? '';
    if (typeof description !== 'string' || description.length > MAX_DESCRIPTION) push('DESCRIPTION_TOO_LONG', `说明不能超过 ${String(MAX_DESCRIPTION)} 字符`, { field: 'description' });
    const support = draft.support ?? 'ai_planning';
    if (!SUPPORT_VALUES.includes(support)) push('SUPPORT_INVALID', '规划支持方式不合法', { field: 'support' });

    const steps = Array.isArray(draft.requiredSteps) ? draft.requiredSteps : [];
    if (steps.length === 0) push('STEPS_EMPTY', '流程至少需要一个步骤（含交付步骤）', { field: 'requiredSteps' });
    if (steps.length > MAX_STEPS) push('STEPS_TOO_MANY', `步骤最多 ${String(MAX_STEPS)} 个`, { field: 'requiredSteps' });
    const keys = new Set<string>();
    for (const step of steps) {
      const key = typeof step.key === 'string' ? step.key : '';
      if (!STEP_KEY_PATTERN.test(key)) {
        push('STEP_KEY_INVALID', `步骤键「${key}」不合法（小写字母开头，可含 ._-）`, { field: 'requiredSteps', stepKey: key });
      } else if (keys.has(key)) {
        push('STEP_KEY_DUPLICATE', `步骤键「${key}」重复`, { field: 'requiredSteps', stepKey: key });
      }
      keys.add(key);
      if (typeof step.title !== 'string' || step.title.trim() === '' || step.title.length > MAX_TITLE) {
        push('STEP_TITLE_INVALID', `步骤「${key || '?'}」缺少名称或名称过长`, { field: 'requiredSteps', stepKey: key });
      }
      if (step.qualityReview !== undefined && !validQualityReviewContract(step.qualityReview, step.kind)) push('STEP_REVIEW_INVALID', '独立评审仅支持verify步骤且必须指定非空评审条款', { field: 'requiredSteps', stepKey: key });
      if (typeof step.group !== 'string' || step.group.trim() === '' || step.group.length > MAX_GROUP_LABEL) {
        push('STEP_GROUP_INVALID', `步骤「${key || '?'}」分组不合法`, { field: 'requiredSteps', stepKey: key });
      }
      if (step.requires !== undefined && (!Array.isArray(step.requires) || step.requires.length > MAX_STEPS || step.requires.some((key: unknown) => typeof key !== 'string'))) {
        push('STEP_DEPENDENCY_INVALID', `步骤「${key}」依赖必须为步骤键数组`, { field: 'requiredSteps', stepKey: key });
      }
      if ((step.summary !== undefined && (typeof step.summary !== 'string' || step.summary.length > 10000))
        || (step.acceptance !== undefined && (!Array.isArray(step.acceptance) || step.acceptance.length > 50 || step.acceptance.some((x: unknown) => typeof x !== 'string' || x.length > 2000)))
        || (step.inputs !== undefined && (!Array.isArray(step.inputs) || step.inputs.length > 50 || step.inputs.some((x: NonNullable<MethodStepDefinition['inputs']>[number]) => !x || typeof x.name !== 'string' || x.name.length > 2000 || !['requirement', 'upstream', 'artifact', 'manual'].includes(x.source))))
        || (step.outputs !== undefined && (!Array.isArray(step.outputs) || step.outputs.length > 50 || step.outputs.some((x: NonNullable<MethodStepDefinition['outputs']>[number]) => !x || typeof x.name !== 'string' || x.name.length > 2000 || !['artifact', 'evidence', 'summary'].includes(x.kind))))
        || (step.position !== undefined && (!Number.isFinite(step.position.x) || !Number.isFinite(step.position.y) || Math.abs(step.position.x) > 100000 || Math.abs(step.position.y) > 100000))) {
        push('STEP_CONTENT_INVALID', `步骤「${key}」内容或位置不合法`, { field: 'requiredSteps', stepKey: key });
      }
      if (!NODE_KINDS.includes(step.kind)) {
        push('STEP_KIND_INVALID', `步骤「${key || '?'}」类型不合法`, { field: 'requiredSteps', stepKey: key });
      }
    }

    // 交付/验收 system nodes: a definition must keep at least one of them, and a
    // save must keep every delivery step key that already existed.
    const hasDeliveryOrVerify = steps.some((step) => step.kind === 'delivery' || step.kind === 'verify');
    if (!hasDeliveryOrVerify) push('DELIVERY_ACCEPTANCE_MISSING', '必须保留至少一个交付或验收步骤', { field: 'requiredSteps' });
    const base = input.id === undefined ? undefined : this.#baseDefinition(input.id);
    if (base !== undefined) {
      for (const step of base.requiredSteps.filter((item) => item.kind === 'delivery')) {
        if (!keys.has(step.key)) push('DELIVERY_STEP_REMOVED', `不能删除交付步骤「${step.title}」（${step.key}）`, { field: 'requiredSteps', stepKey: step.key });
      }
    }

    // 职业存在: planning owner + optional per-step owner.
    const roleIds = new Set(this.#roleIds());
    if (draft.planningStrategy !== undefined) {
      const strategy = draft.planningStrategy;
      if (typeof strategy.id !== 'string' || strategy.id.trim() === '' || typeof strategy.version !== 'string' || strategy.version.trim() === '') {
        push('PLANNING_STRATEGY_INVALID', '规划策略缺少 id/版本', { field: 'planningStrategy' });
      }
      if (typeof strategy.roleId !== 'string' || !roleIds.has(strategy.roleId)) {
        push('PLANNING_ROLE_UNKNOWN', `规划职责职业「${String(strategy.roleId)}」不存在`, { field: 'planningStrategy' });
      }
    }
    for (const step of steps) {
      if (step.roleId === undefined) continue;
      if (typeof step.roleId !== 'string' || !roleIds.has(step.roleId)) {
        push('STEP_ROLE_UNKNOWN', `步骤「${step.key}」的职业「${String(step.roleId)}」不存在`, { field: 'requiredSteps', stepKey: step.key });
      }
    }

    // 可细化分组必须来自步骤分组。
    const groups = new Set(steps.map((step) => step.group));
    if (groups.size > MAX_GROUPS) push('GROUPS_TOO_MANY', `分组最多 ${String(MAX_GROUPS)} 个`, { field: 'requiredSteps' });
    const refinable = Array.isArray(draft.refinableGroups) ? draft.refinableGroups : [];
    for (const group of refinable) {
      if (!groups.has(group)) push('REFINABLE_GROUP_UNKNOWN', `可细化分组「${String(group)}」不在步骤分组中`, { field: 'refinableGroups' });
    }

    // 环路校验: forward-compatible `requires` dependency edges.
    for (const step of steps) {
      for (const dependency of Array.isArray(step.requires) ? step.requires : []) {
        if (!keys.has(dependency)) push('STEP_DEPENDENCY_UNKNOWN', `步骤「${step.key}」依赖不存在的步骤「${dependency}」`, { field: 'requiredSteps', stepKey: step.key });
      }
    }
    const cycle = problems.some((item) => item.code === 'STEP_DEPENDENCY_INVALID') ? undefined : methodCycle(steps);
    if (cycle !== undefined) push('METHOD_CYCLE', `步骤依赖存在环路：${cycle.join(' → ')}`, { field: 'requiredSteps' });

    return finish(problems);
  }

  /* ---------------------------------------------------------------- */
  /* Mutations (requestKey idempotent)                                 */
  /* ---------------------------------------------------------------- */

  create(input: { readonly requestKey: string; readonly draft: MethodDraftInput; readonly confirmCreate?: boolean }): MethodMutationResult {
    this.#requireConfirm(input.confirmCreate, '创建流程');
    const body = { draft: input.draft };
    const replay = this.#replay(input.requestKey, body);
    if (replay !== undefined) return replay;
    const validation = this.validate({ draft: input.draft });
    if (!validation.ok) throw new AppError(ErrorCode.VALIDATION_FAILED, '流程定义未通过检查', { details: { problems: validation.problems } });
    const at = nowIso();
    const method = this.#canonicalMethod(input.draft, `${CUSTOM_ID_PREFIX}${slug(input.draft.name)}-${randomSuffix()}`, 1);
    const records = [...this.#customRecords(), { method, version: 1, archived: false, createdAt: at, updatedAt: at }];
    this.#store.settings.putJson(CUSTOM_KEY, records);
    const result: MethodMutationResult = { requestKey: input.requestKey, replayed: false, method: customDetail(records.at(-1)!) };
    this.#remember(input.requestKey, body, result);
    return result;
  }

  save(id: string, input: { readonly requestKey: string; readonly method: MethodDraftInput; readonly expectedVersion: number; readonly confirmSave?: boolean }): MethodMutationResult {
    this.#requireConfirm(input.confirmSave, '保存流程');
    const body = { id, method: input.method, expectedVersion: input.expectedVersion };
    const replay = this.#replay(input.requestKey, body);
    if (replay !== undefined) return replay;
    const record = this.#requireCustom(id, '内置流程只读：请先复制后修改');
    if (record.archived) throw new AppError(ErrorCode.CONFLICT, '流程已归档，不能继续编辑', { details: { methodId: id } });
    if (!Number.isInteger(input.expectedVersion)) throw new AppError(ErrorCode.VALIDATION_FAILED, 'expectedVersion 必须是整数');
    if (input.expectedVersion !== record.version) {
      throw new AppError(ErrorCode.CONFLICT, `流程已被更新为版本 ${String(record.version)}，请重新读取后再保存`, {
        details: { currentVersion: record.version, expectedVersion: input.expectedVersion, methodId: id },
      });
    }
    const validation = this.validate({ draft: input.method, id });
    if (!validation.ok) throw new AppError(ErrorCode.VALIDATION_FAILED, '流程定义未通过检查', { details: { problems: validation.problems } });
    const version = record.version + 1;
    const method = this.#canonicalMethod(input.method, id, version);
    const updated: StoredCustomMethod = { ...record, history: [...(record.history ?? []), customDetail(record)], method, version, updatedAt: nowIso(), ...(record.copiedFrom === undefined ? {} : { copiedFrom: record.copiedFrom }) };
    const records = this.#customRecords().map((item) => (item.method.id === id ? updated : item));
    this.#store.settings.putJson(CUSTOM_KEY, records);
    const result: MethodMutationResult = { requestKey: input.requestKey, replayed: false, method: customDetail(updated) };
    this.#remember(input.requestKey, body, result);
    return result;
  }

  copy(id: string, input: { readonly requestKey: string; readonly name?: string; readonly confirmCopy?: boolean }): MethodMutationResult {
    this.#requireConfirm(input.confirmCopy, '复制流程');
    const body = { id, name: input.name ?? null };
    const replay = this.#replay(input.requestKey, body);
    if (replay !== undefined) return replay;
    const source = this.get(id);
    if (source.archived) throw new AppError(ErrorCode.CONFLICT, '已归档的流程不能复制', { details: { methodId: id } });
    const defaultName = `${source.name} 副本`;
    const name = (input.name ?? defaultName).trim();
    if (name === '' || name.length > MAX_NAME) throw new AppError(ErrorCode.VALIDATION_FAILED, `副本名称需要 1–${String(MAX_NAME)} 个字符`);
    const at = nowIso();
    const draft: MethodDraftInput = {
      name,
      description: source.description,
      support: source.support,
      requiredSteps: source.requiredSteps,
      refinableGroups: source.refinableGroups,
      ...(source.planningStrategy === undefined ? {} : { planningStrategy: source.planningStrategy }),
    };
    const validation = this.validate({ draft });
    if (!validation.ok) throw new AppError(ErrorCode.VALIDATION_FAILED, '源流程未通过检查，无法复制', { details: { problems: validation.problems } });
    const version = 1;
    const method = this.#canonicalMethod(draft, `${CUSTOM_ID_PREFIX}${slug(name)}-${randomSuffix()}`, version);
    const record: StoredCustomMethod = {
      method,
      version,
      archived: false,
      copiedFrom: { id, version: source.version },
      createdAt: at,
      updatedAt: at,
    };
    this.#store.settings.putJson(CUSTOM_KEY, [...this.#customRecords(), record]);
    const result: MethodMutationResult = { requestKey: input.requestKey, replayed: false, method: customDetail(record) };
    this.#remember(input.requestKey, body, result);
    return result;
  }

  archive(id: string, input: { readonly requestKey: string; readonly confirmArchive?: boolean }): MethodMutationResult {
    this.#requireConfirm(input.confirmArchive, '归档流程');
    const body = { id };
    const replay = this.#replay(input.requestKey, body);
    if (replay !== undefined) return replay;
    const record = this.#requireCustom(id, '内置流程不能归档');
    if (record.archived) throw new AppError(ErrorCode.CONFLICT, '流程已归档', { details: { methodId: id } });
    const version = record.version + 1;
    const updated: StoredCustomMethod = {
      ...record,
      history: [...(record.history ?? []), customDetail(record)],
      version,
      archived: true,
      updatedAt: nowIso(),
      method: { ...record.method, revision: revisionFor(version) },
    };
    const records = this.#customRecords().map((item) => (item.method.id === id ? updated : item));
    this.#store.settings.putJson(CUSTOM_KEY, records);
    const result: MethodMutationResult = { requestKey: input.requestKey, replayed: false, method: customDetail(updated) };
    this.#remember(input.requestKey, body, result);
    return result;
  }

  /* ---------------------------------------------------------------- */
  /* Persistence helpers                                              */
  /* ---------------------------------------------------------------- */

  #customRecords(): readonly StoredCustomMethod[] {
    const raw = this.#store.settings.getJson<unknown>(CUSTOM_KEY);
    return normalizeStoredCollection(raw);
  }

  #customRecord(id: string): StoredCustomMethod | undefined {
    return this.#customRecords().find((record) => record.method.id === id);
  }

  #requireCustom(id: string, builtinMessage: string): StoredCustomMethod {
    if (BUILT_IN_METHODS.some((method) => method.id === id)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, builtinMessage, { details: { methodId: id, builtIn: true } });
    }
    const record = this.#customRecord(id);
    if (record === undefined) throw new AppError(ErrorCode.NOT_FOUND, '自定义流程不存在', { details: { methodId: id } });
    return record;
  }

  /** Base definition for save-mode validation (built-in or custom). */
  #baseDefinition(id: string): WorkflowMethod | undefined {
    const builtin = BUILT_IN_METHODS.find((method) => method.id === id);
    if (builtin !== undefined) return builtin;
    return this.#customRecord(id)?.method;
  }

  /** Canonical persisted form: trimmed fields + revision derived from version. */
  #canonicalMethod(draft: MethodDraftInput, id: string, version: number): WorkflowMethod {
    const steps: MethodStepView[] = draft.requiredSteps.map((step) => ({
      key: step.key.trim(),
      title: step.title.trim(),
      kind: step.kind,
      group: step.group.trim(),
      ...(step.optional === true ? { optional: true } : {}),
      ...(step.roleId === undefined ? {} : { roleId: step.roleId }),
      ...(step.qualityReview === undefined ? {} : { qualityReview: structuredClone(step.qualityReview) }),
      ...(step.summary === undefined ? {} : { summary: step.summary }),
      ...(step.inputs === undefined ? {} : { inputs: structuredClone(step.inputs) }),
      ...(step.outputs === undefined ? {} : { outputs: structuredClone(step.outputs) }),
      ...(step.acceptance === undefined ? {} : { acceptance: [...step.acceptance] }),
      ...(step.position === undefined ? {} : { position: { ...step.position } }),
      ...(step.requires === undefined ? {} : { requires: [...new Set(step.requires)] }),
    }));
    return {
      id,
      name: draft.name.trim(),
      revision: revisionFor(version),
      support: draft.support ?? 'ai_planning',
      requiredSteps: steps,
      refinableGroups: [...new Set(draft.refinableGroups ?? [])],
      ...(draft.planningStrategy === undefined ? {} : { planningStrategy: { ...draft.planningStrategy } }),
      description: (draft.description ?? '').trim(),
    };
  }

  #requireConfirm(value: boolean | undefined, action: string): void {
    if (value !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, `${action}需要显式确认`);
  }

  #replay(requestKey: string, body: unknown): MethodMutationResult | undefined {
    if (typeof requestKey !== 'string' || !requestKey.startsWith('req_')) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'requestKey 不合法');
    }
    const requests = this.#store.settings.getJson<Record<string, StoredRequest>>(REQUEST_KEY) ?? {};
    const stored = requests[requestKey];
    if (stored === undefined) return undefined;
    if (stored.bodyHash !== hashBody(body)) {
      throw new AppError(ErrorCode.REQUEST_KEY_REUSED, '同一请求号对应了不同的请求内容，请使用新的请求号', { details: { requestKey } });
    }
    return { ...stored.result, replayed: true };
  }

  #remember(requestKey: string, body: unknown, result: MethodMutationResult): void {
    const requests = this.#store.settings.getJson<Record<string, StoredRequest>>(REQUEST_KEY) ?? {};
    requests[requestKey] = { bodyHash: hashBody(body), result: { ...result, replayed: false } };
    const keys = Object.keys(requests);
    if (keys.length > REQUEST_LIMIT) {
      for (const key of keys.slice(0, keys.length - REQUEST_LIMIT)) delete requests[key];
    }
    this.#store.settings.putJson(REQUEST_KEY, requests);
  }
}

/* ------------------------------------------------------------------ */
/* Normalization / mapping                                             */
/* ------------------------------------------------------------------ */

function finish(problems: readonly MethodValidationProblem[]): MethodValidationResult {
  const failed = (code: string): 'passed' | 'failed' => (problems.some((problem) => problem.code === code) ? 'failed' : 'passed');
  const checks: MethodValidationCheck[] = [
    { id: 'M1', label: '名称与说明有效', state: failed('NAME_INVALID') === 'failed' || failed('DESCRIPTION_TOO_LONG') === 'failed' ? 'failed' : 'passed' },
    { id: 'M2', label: '步骤非空且数量在限额内', state: problems.some((problem) => problem.code === 'STEPS_EMPTY' || problem.code === 'STEPS_TOO_MANY') ? 'failed' : 'passed' },
    { id: 'M3', label: '步骤键唯一且格式合法', state: problems.some((problem) => problem.code === 'STEP_KEY_INVALID' || problem.code === 'STEP_KEY_DUPLICATE') ? 'failed' : 'passed' },
    { id: 'M4', label: '步骤字段完整', state: problems.some((problem) => problem.code.startsWith('STEP_TITLE') || problem.code.startsWith('STEP_GROUP') || problem.code === 'STEP_KIND_INVALID') ? 'failed' : 'passed' },
    { id: 'M5', label: '交付/验收节点保留', state: problems.some((problem) => problem.code === 'DELIVERY_ACCEPTANCE_MISSING' || problem.code === 'DELIVERY_STEP_REMOVED') ? 'failed' : 'passed' },
    { id: 'M6', label: '职业存在', state: problems.some((problem) => problem.code === 'PLANNING_ROLE_UNKNOWN' || problem.code === 'STEP_ROLE_UNKNOWN') ? 'failed' : 'passed' },
    { id: 'M7', label: '无循环依赖', state: problems.some((problem) => problem.code === 'METHOD_CYCLE' || problem.code === 'STEP_DEPENDENCY_UNKNOWN') ? 'failed' : 'passed' },
    { id: 'M8', label: '可细化分组有效', state: problems.some((problem) => problem.code === 'REFINABLE_GROUP_UNKNOWN' || problem.code === 'GROUPS_TOO_MANY') ? 'failed' : 'passed' },
  ];
  return { ok: problems.length === 0, problems: [...problems], checks };
}


function normalizeStoredCollection(raw: unknown): readonly StoredCustomMethod[] {
  const entries = Array.isArray(raw)
    ? raw
    : raw !== null && typeof raw === 'object' && Array.isArray((raw as { methods?: unknown }).methods)
      ? (raw as { methods: unknown[] }).methods
      : [];
  const records: StoredCustomMethod[] = [];
  for (const entry of entries) {
    const record = normalizeStoredRecord(entry);
    if (record !== undefined) records.push(record);
  }
  return records;
}

/**
 * Legacy/raw compatibility: settings may hold plain `WorkflowMethod` JSON from an
 * earlier build (no wrapper, no version/archived/timestamps) or a wrapped
 * `{methods: [...]}` collection. Unknown/broken entries are skipped instead of
 * breaking the whole catalog.
 */
function normalizeStoredRecord(raw: unknown): StoredCustomMethod | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const candidate = raw as Record<string, unknown>;
  const methodRaw = candidate['method'] !== null && typeof candidate['method'] === 'object' ? candidate['method'] as Record<string, unknown> : candidate;
  const id = typeof methodRaw['id'] === 'string' ? methodRaw['id'] : '';
  if (!id.startsWith(CUSTOM_ID_PREFIX) || !ID_PATTERN.test(id)) return undefined;
  const name = typeof methodRaw['name'] === 'string' && methodRaw['name'].trim() !== '' ? methodRaw['name'].trim() : id;
  const revision = typeof methodRaw['revision'] === 'string' ? methodRaw['revision'] : 'r1';
  const version = Number.isInteger(candidate['version'])
    ? Number(candidate['version'])
    : Number.isInteger(methodRaw['version'])
      ? Number(methodRaw['version'])
      : versionFromRevision(revision);
  const stepsRaw = Array.isArray(methodRaw['requiredSteps']) ? methodRaw['requiredSteps'] : [];
  const requiredSteps: MethodStepView[] = stepsRaw
    .filter((step): step is Record<string, unknown> => step !== null && typeof step === 'object')
    .map((step) => ({
      key: typeof step['key'] === 'string' ? step['key'] : '',
      title: typeof step['title'] === 'string' ? step['title'] : '',
      kind: (typeof step['kind'] === 'string' && NODE_KINDS.includes(step['kind'] as NodeKindValue) ? step['kind'] : 'implementation') as NodeKindValue,
      group: typeof step['group'] === 'string' ? step['group'] : '实现',
      ...(step['optional'] === true ? { optional: true } : {}),
      ...(typeof step['roleId'] === 'string' ? { roleId: step['roleId'] } : {}),
      ...(step['qualityReview'] === undefined ? {} : { qualityReview: step['qualityReview'] as MethodStepDefinition['qualityReview'] }),
      ...(typeof step['summary'] === 'string' ? { summary: step['summary'] } : {}),
      ...(Array.isArray(step['inputs']) ? { inputs: step['inputs'] as MethodStepDefinition['inputs'] } : {}),
      ...(Array.isArray(step['outputs']) ? { outputs: step['outputs'] as MethodStepDefinition['outputs'] } : {}),
      ...(Array.isArray(step['acceptance']) ? { acceptance: step['acceptance'].filter((x): x is string => typeof x === 'string') } : {}),
      ...(typeof step['position'] === 'object' && step['position'] !== null ? { position: step['position'] as { x: number; y: number } } : {}),
      ...(Array.isArray(step['requires']) ? { requires: step['requires'].filter((value): value is string => typeof value === 'string') } : {}),
    }))
    .filter((step) => step.key !== '');
  const method: WorkflowMethod = {
    id,
    name,
    revision: revisionFor(version),
    support: methodRaw['support'] === 'skeleton_only' ? 'skeleton_only' : 'ai_planning',
    requiredSteps,
    refinableGroups: Array.isArray(methodRaw['refinableGroups']) ? methodRaw['refinableGroups'].filter((value): value is string => typeof value === 'string') : [],
    ...(normalizeStrategy(methodRaw['planningStrategy']) === undefined ? {} : { planningStrategy: normalizeStrategy(methodRaw['planningStrategy'])! }),
    description: typeof methodRaw['description'] === 'string' ? methodRaw['description'] : '',
  };
  const createdAt = typeof candidate['createdAt'] === 'string' ? candidate['createdAt'] : typeof methodRaw['createdAt'] === 'string' ? methodRaw['createdAt'] : nowIso();
  const updatedAt = typeof candidate['updatedAt'] === 'string' ? candidate['updatedAt'] : typeof methodRaw['updatedAt'] === 'string' ? methodRaw['updatedAt'] : createdAt;
  const copiedFromRaw = candidate['copiedFrom'];
  const copiedFrom = copiedFromRaw !== null && typeof copiedFromRaw === 'object'
    && typeof (copiedFromRaw as { id?: unknown }).id === 'string'
    && Number.isInteger((copiedFromRaw as { version?: unknown }).version)
    ? { id: String((copiedFromRaw as { id: string }).id), version: Number((copiedFromRaw as { version: number }).version) }
    : undefined;
  return {
    method,
    version,
    archived: candidate['archived'] === true,
    history: Array.isArray(candidate['history']) ? candidate['history'].filter((item): item is MethodCatalogDetail => item !== null && typeof item === 'object' && typeof item.id === 'string' && Number.isInteger(item.version) && Array.isArray(item.requiredSteps)).map((item) => structuredClone(item)) : [],
    ...(copiedFrom === undefined ? {} : { copiedFrom }),
    createdAt,
    updatedAt,
  };
}

function normalizeStrategy(raw: unknown): WorkflowMethod['planningStrategy'] | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  if (typeof value['id'] !== 'string' || typeof value['version'] !== 'string' || typeof value['roleId'] !== 'string') return undefined;
  return { id: value['id'], version: value['version'], roleId: value['roleId'] };
}

function builtinEntry(method: WorkflowMethod): MethodCatalogEntry {
  const version = versionFromRevision(method.revision);
  return {
    id: method.id,
    name: method.name,
    description: method.description,
    source: 'builtin',
    support: method.support,
    version,
    revision: revisionFor(version),
    stepCount: method.requiredSteps.length,
    archived: false,
  };
}

function builtinDetail(method: WorkflowMethod): MethodCatalogDetail {
  return {
    ...builtinEntry(method),
    requiredSteps: cloneSteps(method.requiredSteps),
    refinableGroups: [...method.refinableGroups],
    ...(method.planningStrategy === undefined ? {} : { planningStrategy: { ...method.planningStrategy } }),
  };
}

function customEntry(record: StoredCustomMethod): MethodCatalogEntry {
  return {
    id: record.method.id,
    name: record.method.name,
    description: record.method.description,
    source: 'custom',
    support: record.method.support,
    version: record.version,
    revision: revisionFor(record.version),
    stepCount: record.method.requiredSteps.length,
    archived: record.archived,
    updatedAt: record.updatedAt,
    ...(record.copiedFrom === undefined ? {} : { copiedFrom: record.copiedFrom }),
  };
}

function customDetail(record: StoredCustomMethod): MethodCatalogDetail {
  return {
    ...customEntry(record),
    requiredSteps: cloneSteps(record.method.requiredSteps),
    refinableGroups: [...record.method.refinableGroups],
    ...(record.method.planningStrategy === undefined ? {} : { planningStrategy: { ...record.method.planningStrategy } }),
  };
}

function cloneSteps(steps: readonly MethodStepView[]): MethodStepView[] {
  // Canonical shape: `optional: true` only when set, extensions preserved.
  return steps.map((step) => ({
    key: step.key,
    title: step.title,
    kind: step.kind,
    group: step.group,
    ...(step.optional === true ? { optional: true } : {}),
    ...(step.roleId === undefined ? {} : { roleId: step.roleId }),
      ...(step.qualityReview === undefined ? {} : { qualityReview: structuredClone(step.qualityReview) }),
    ...(step.summary === undefined ? {} : { summary: step.summary }),
    ...(step.inputs === undefined ? {} : { inputs: structuredClone(step.inputs) }),
    ...(step.outputs === undefined ? {} : { outputs: structuredClone(step.outputs) }),
    ...(step.acceptance === undefined ? {} : { acceptance: [...step.acceptance] }),
    ...(step.position === undefined ? {} : { position: { ...step.position } }),
    ...(step.requires === undefined ? {} : { requires: [...step.requires] }),
  }));
}

function cloneMethod(method: WorkflowMethod): WorkflowMethod {
  return {
    ...method,
    requiredSteps: cloneSteps(method.requiredSteps as readonly MethodStepView[]),
    refinableGroups: [...method.refinableGroups],
    ...(method.planningStrategy === undefined ? {} : { planningStrategy: { ...method.planningStrategy } }),
  };
}

function revisionFor(version: number): string {
  return `r${String(Math.max(1, version))}`;
}

function versionFromRevision(revision: string): number {
  // Built-ins use r12 / template-v7 style revisions; take the trailing number.
  const match = /(\d+)\s*$/.exec(revision);
  return match === null ? 1 : Math.max(1, Number(match[1]));
}

function hashBody(body: unknown): string {
  return createHash('sha256').update(stableStringify(body)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(',')}}`;
}

function slug(name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
  return ascii === '' ? 'flow' : ascii;
}

function randomSuffix(): string {
  // createId is `<prefix>_<9-char base36 time><10 random chars>`; taking the
  // first 8 chars after the prefix made the suffix depend on the clock only and
  // two methods with the same slug could collide inside one time window. Use
  // the random tail instead.
  return createId('m').split('_').at(-1)?.slice(-8) ?? String(Date.now()).slice(-8);
}
