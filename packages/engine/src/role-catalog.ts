import {
  AppError,
  DEFAULT_CATALOG,
  ErrorCode,
  createId,
  nowIso,
  type CommandResponse,
  type RoleArchiveRequest,
  type RoleCatalogEntry,
  type RoleCatalogResponse,
  type RoleDefinition,
  type RolePublishRequest,
  type RoleSaveRequest,
} from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';
import type { CommandService } from './operations.ts';

const SETTINGS_KEY = 'catalog.roles.state';
// DEFAULT_CATALOG itself is mutated in place when a published catalog is applied,
// so keep the built-in roles for reset/archive computations.
const BUILT_IN_ROLES: readonly RoleDefinition[] = [...DEFAULT_CATALOG.roles];
const ID_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

interface StoredRoleDraft {
  readonly name: string;
  readonly purpose: string;
  readonly responsibilities: readonly string[];
  readonly updatedAt: string;
}

interface StoredRoleRecord {
  readonly id: string;
  readonly baseId?: string;
  readonly name: string;
  readonly purpose: string;
  readonly responsibilities: readonly string[];
  readonly revision: string;
  readonly status: 'draft' | 'published';
  readonly draft?: StoredRoleDraft;
  readonly publishedAt?: string;
  readonly updatedAt: string;
}

interface StoredState {
  readonly records: readonly StoredRoleRecord[];
}

export interface RoleCatalogServiceOptions {
  readonly store: Store;
  readonly commands: CommandService;
  readonly applyRoles: (roles: readonly RoleDefinition[]) => void;
}

/**
 * Editable layer above the built-in catalog: built-in roles can be overridden,
 * custom roles can be created, each change is a draft until published. Drafts
 * are server-persisted and affect no model session; publishing swaps the
 * effective catalog in place so already-constructed services see it.
 */
export class RoleCatalogService {
  readonly #store: Store;
  readonly #commands: CommandService;
  readonly #applyRoles: (roles: readonly RoleDefinition[]) => void;

  constructor(options: RoleCatalogServiceOptions) {
    this.#store = options.store;
    this.#commands = options.commands;
    this.#applyRoles = options.applyRoles;
  }

  applyEffective(): readonly RoleDefinition[] {
    const roles = this.#effectiveRoles();
    this.#applyRoles(roles);
    return roles;
  }

  list(): RoleCatalogResponse {
    const records = this.#records();
    const byId = new Map(records.map((record) => [record.id, record]));
    const builtins = new Map(BUILT_IN_ROLES.map((role) => [role.id, role]));
    const roles: RoleCatalogEntry[] = [];
    for (const role of this.#effectiveRoles()) {
      const record = byId.get(role.id);
      const isBuiltin = builtins.has(role.id);
      if (record === undefined) {
        roles.push({ ...role, status: 'published', hasDraft: false });
      } else {
        roles.push({
          ...role,
          status: record.status,
          ...(record.baseId === undefined ? {} : { baseId: record.baseId }),
          hasDraft: record.draft !== undefined,
          updatedAt: record.updatedAt,
        });
      }
      if (record?.draft !== undefined && (isBuiltin || record.status === 'published')) {
        const last = roles[roles.length - 1];
        if (last !== undefined) roles[roles.length - 1] = { ...last, hasDraft: true };
      }
    }
    // Custom roles that only exist as drafts are not part of the effective
    // catalog yet, but the editor must still be able to see and publish them.
    for (const record of records) {
      if (record.status !== 'draft' || record.draft === undefined || roles.some((role) => role.id === record.id)) continue;
      roles.push({
        id: record.id,
        name: record.draft.name,
        purpose: record.draft.purpose,
        responsibilities: record.draft.responsibilities,
        revision: record.revision,
        promptRevision: record.revision,
        status: 'draft',
        ...(record.baseId === undefined ? {} : { baseId: record.baseId }),
        hasDraft: true,
        updatedAt: record.updatedAt,
      });
    }
    return { roles, actions: {} };
  }

  save(input: RoleSaveRequest): CommandResponse<RoleCatalogResponse> {
    if (input === null || typeof input !== 'object') throw new AppError(ErrorCode.VALIDATION_FAILED, '职业草稿请求体不合法');
    if (input.confirmSave !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '保存职业草稿需要显式确认');
    const name = normalizeText(input.name, '职业名称', 1, 60);
    const purpose = normalizeText(input.purpose, '职业定位', 1, 1_000);
    if (!Array.isArray(input.responsibilities) || input.responsibilities.length < 1 || input.responsibilities.length > 12) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '职责需要 1–12 条');
    }
    const responsibilities = input.responsibilities.map((item, index) => normalizeText(item, `职责 ${index + 1}`, 1, 200));
    const roleId = input.roleId === undefined ? undefined : normalizeId(input.roleId);
    if (roleId !== undefined && !this.#records().some((record) => record.id === roleId) && !BUILT_IN_ROLES.some((role) => role.id === roleId)) {
      throw new AppError(ErrorCode.NOT_FOUND, '职业不存在', { details: { roleId } });
    }
    const baseId = input.baseId === undefined ? roleId : normalizeId(input.baseId);
    const id = roleId ?? createId('role_custom');
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'catalog.role.save',
      body: { roleId: id, name, purpose, responsibilities, baseId },
      target: { ref: id },
    });
    if (replayed && record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record), resource: this.list() };
    try {
      const records = [...this.#records()];
      const existing = records.findIndex((entry) => entry.id === id);
      const previous = existing >= 0 ? records[existing] : undefined;
      const builtin = BUILT_IN_ROLES.find((role) => role.id === id);
      const now = nowIso();
      const next: StoredRoleRecord = previous === undefined
        ? {
            id,
            ...(baseId === undefined ? {} : { baseId }),
            name: builtin?.name ?? name,
            purpose: builtin?.purpose ?? purpose,
            responsibilities: builtin?.responsibilities ?? responsibilities,
            revision: builtin?.revision ?? 'r0',
            status: builtin === undefined ? 'draft' : 'published',
            draft: { name, purpose, responsibilities, updatedAt: now },
            updatedAt: now,
          }
        : {
            ...previous,
            ...(baseId === undefined ? {} : { baseId }),
            draft: { name, purpose, responsibilities, updatedAt: now },
            updatedAt: now,
          };
      if (existing >= 0) records[existing] = next;
      else records.push(next);
      this.#saveRecords(records);
      this.#commands.settle(input.requestKey, { roleId: id, draft: true });
      this.#publish('role.draft.saved', id);
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.list() };
    } catch (error) {
      this.#commands.fail(input.requestKey, error instanceof Error ? error : new Error('保存职业草稿失败'));
      throw error;
    }
  }

  publish(roleId: string, input: RolePublishRequest): CommandResponse<RoleCatalogResponse> {
    if (input?.confirmPublish !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '发布职业需要显式确认');
    const id = normalizeId(roleId);
    const records = [...this.#records()];
    const index = records.findIndex((record) => record.id === id);
    if (index < 0) throw new AppError(ErrorCode.NOT_FOUND, '没有可发布的职业草稿', { details: { roleId: id } });
    const current = records[index]!;
    if (current.draft === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '这个职业没有待发布的草稿');
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'catalog.role.publish',
      body: { roleId: id },
      target: { ref: id },
    });
    if (replayed && record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record), resource: this.list() };
    try {
      const revision = bumpRevision(current.revision);
      const published: StoredRoleRecord = {
        ...current,
        name: current.draft.name,
        purpose: current.draft.purpose,
        responsibilities: current.draft.responsibilities,
        revision,
        status: 'published',
        draft: undefined,
        publishedAt: nowIso(),
        updatedAt: nowIso(),
      };
      records[index] = published;
      this.#saveRecords(records);
      this.applyEffective();
      this.#commands.settle(input.requestKey, { roleId: id, revision });
      this.#publish('role.published', id);
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.list() };
    } catch (error) {
      this.#commands.fail(input.requestKey, error instanceof Error ? error : new Error('发布职业失败'));
      throw error;
    }
  }

  archive(roleId: string, input: RoleArchiveRequest): CommandResponse<RoleCatalogResponse> {
    if (input?.confirmArchive !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '归档职业需要显式确认');
    const id = normalizeId(roleId);
    if (!BUILT_IN_ROLES.some((role) => role.id === id) && !this.#records().some((record) => record.id === id)) {
      throw new AppError(ErrorCode.NOT_FOUND, '职业不存在', { details: { roleId: id } });
    }
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'catalog.role.archive',
      body: { roleId: id },
      target: { ref: id },
    });
    if (replayed && record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record), resource: this.list() };
    try {
      this.#saveRecords(this.#records().filter((entry) => entry.id !== id));
      this.applyEffective();
      this.#commands.settle(input.requestKey, { roleId: id, archived: true });
      this.#publish('role.archived', id);
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.list() };
    } catch (error) {
      this.#commands.fail(input.requestKey, error instanceof Error ? error : new Error('归档职业失败'));
      throw error;
    }
  }

  #effectiveRoles(): readonly RoleDefinition[] {
    const records = this.#records();
    const overrides = new Map(records.filter((record) => record.status === 'published').map((record) => [record.id, record]));
    const roles: RoleDefinition[] = [];
    for (const role of BUILT_IN_ROLES) {
      const override = overrides.get(role.id);
      roles.push(override === undefined ? role : toDefinition(override));
    }
    for (const record of records) {
      if (record.status === 'published' && !BUILT_IN_ROLES.some((role) => role.id === record.id)) {
        roles.push(toDefinition(record));
      }
    }
    return roles;
  }

  #records(): readonly StoredRoleRecord[] {
    const state = this.#store.settings.getJson<StoredState>(SETTINGS_KEY);
    if (state === undefined || !Array.isArray(state.records)) return [];
    return state.records.filter((record) => record !== null && typeof record === 'object' && typeof record.id === 'string');
  }

  #saveRecords(records: readonly StoredRoleRecord[]): void {
    this.#store.settings.putJson(SETTINGS_KEY, { records } satisfies StoredState);
  }

  #publish(kind: string, roleId: string): void {
    this.#store.events.publish('catalog.changed', { kind, roleId, revision: Date.now() });
  }
}

function toDefinition(record: StoredRoleRecord): RoleDefinition {
  return {
    id: record.id,
    name: record.name,
    purpose: record.purpose,
    responsibilities: record.responsibilities,
    revision: record.revision,
    promptRevision: record.revision,
  };
}

function bumpRevision(revision: string): string {
  const match = /^r(\d+)$/.exec(revision);
  return `r${String(Number.parseInt(match?.[1] ?? '0', 10) + 1)}`;
}

function normalizeText(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string') throw new AppError(ErrorCode.VALIDATION_FAILED, `${field}必须是字符串`);
  const text = value.trim();
  if (text.length < min || text.length > max) throw new AppError(ErrorCode.VALIDATION_FAILED, `${field}长度需要在 ${min}–${max} 之间`);
  return text;
}

function normalizeId(value: unknown): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new AppError(ErrorCode.VALIDATION_FAILED, '职业 id 不合法');
  return value;
}
