import {
  AppError,
  DEFAULT_CATALOG,
  ErrorCode,
  RoleCapabilityCatalog,
  RoleCapabilityGroup,
  RoleCapabilityGroupMeta,
  RoleResourceFileKind,
  RoleResponsibilitySlot,
  RoleResourceToolKind,
  createId,
  nowIso,
  type CommandResponse,
  type RoleArchiveRequest,
  type RoleCapabilityGroupValue,
  type RoleCapabilityGroupView,
  type RoleCapabilityGroupInput,
  type RoleCatalogEntry,
  type RoleCatalogResponse,
  type RoleDefinition,
  type RoleDefinitionResolved,
  type RoleImageBinding,
  type RoleImageHistoryEntry,
  type RoleImageInput,
  type RolePublishCheck,
  type RolePublishRequest,
  type RoleResourcePermissions,
  type RoleResourcePermissionsInput,
  type RoleRevisionSnapshot,
  type RoleSaveRequest,
  type RoleValidateResponse,
} from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';
import type { CommandService } from './operations.ts';

const SETTINGS_KEY = 'catalog.roles.state';
const HISTORY_KEY_PREFIX = 'catalog.role.history.';
const HISTORY_LIMIT = 20;
// DEFAULT_CATALOG itself is mutated in place when a published catalog is applied,
// so keep the built-in roles for reset/archive computations.
const BUILT_IN_ROLES: readonly RoleDefinition[] = [...DEFAULT_CATALOG.roles];
const ID_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const MODEL_PATTERN = /^[A-Za-z0-9._:/-]{1,120}$/;
const TOOL_NAME_PATTERN = /^[A-Za-z0-9._:/-]{1,120}$/;
const MAX_TEXT = 20_000;

/** Extended fields shared by published records, drafts and history snapshots. */
interface StoredRoleFields {
  readonly allowedSlots?: readonly string[];
  readonly instructions?: string;
  readonly model?: string;
  readonly maxRuntimeMinutes?: number;
  readonly capabilityGroups?: readonly RoleCapabilityGroupView[];
  readonly resourcePermissions?: RoleResourcePermissions;
  readonly image?: RoleImageBinding;
}

interface StoredRoleDraft extends StoredRoleFields {
  readonly name: string;
  readonly purpose: string;
  readonly responsibilities: readonly string[];
  readonly updatedAt: string;
}

interface StoredRoleRecord extends StoredRoleFields {
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

type StoredHistoryEntry = StoredRoleFields & {
  readonly revision: string;
  readonly name: string;
  readonly purpose: string;
  readonly responsibilities: readonly string[];
  readonly publishedAt: string;
};

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
 *
 * The four design tabs (职责与指令 / 能力范围 / 资源权限 / 形象) are stored as
 * optional JSON fields; `resolveRole` applies defaults so old settings records
 * and legacy history snapshots keep working without a migration.
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
    for (const resolved of this.#effectiveRoles()) {
      const record = byId.get(resolved.id);
      const isBuiltin = builtins.has(resolved.id);
      roles.push(this.#entry(resolved, record, isBuiltin));
    }
    // Custom roles that only exist as drafts are not part of the effective
    // catalog yet, but the editor must still be able to see and publish them.
    for (const record of records) {
      if (record.status !== 'draft' || record.draft === undefined || roles.some((role) => role.id === record.id)) continue;
      roles.push(this.#draftOnlyEntry(record));
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
    const fallback = this.#draftFallback(id);
    const extended = normalizeExtendedFields(input, fallback);
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'catalog.role.save',
      body: {
        roleId: id,
        name,
        purpose,
        responsibilities,
        baseId,
        instructions: extended.instructions,
        model: extended.model,
        maxRuntimeMinutes: extended.maxRuntimeMinutes,
        capabilityGroups: extended.capabilityGroups,
        resourcePermissions: extended.resourcePermissions,
        image: extended.image,
      },
      target: { ref: id },
    });
    if (replayed && record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record), resource: this.list() };
    try {
      const records = [...this.#records()];
      const existing = records.findIndex((entry) => entry.id === id);
      const previous = existing >= 0 ? records[existing] : undefined;
      const builtin = BUILT_IN_ROLES.find((role) => role.id === id);
      const now = nowIso();
      const draft: StoredRoleDraft = { name, purpose, responsibilities, ...extended, updatedAt: now };
      const next: StoredRoleRecord = previous === undefined
        ? {
            id,
            ...(baseId === undefined ? {} : { baseId }),
            name: builtin?.name ?? name,
            purpose: builtin?.purpose ?? purpose,
            responsibilities: builtin?.responsibilities ?? responsibilities,
            ...(builtin === undefined ? {} : extendedFromResolved(resolveRole(builtin))),
            revision: builtin?.revision ?? 'r0',
            status: builtin === undefined ? 'draft' : 'published',
            draft,
            updatedAt: now,
          }
        : { ...previous, ...(baseId === undefined ? {} : { baseId }), draft, updatedAt: now };
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

  /** Non-mutating publish checklist (also used by publish itself). */
  validate(roleId: string): RoleValidateResponse {
    const id = normalizeId(roleId);
    const record = this.#records().find((entry) => entry.id === id);
    const builtin = BUILT_IN_ROLES.find((role) => role.id === id);
    if (record === undefined && builtin === undefined) throw new AppError(ErrorCode.NOT_FOUND, '职业不存在', { details: { roleId: id } });
    const publishedRevision = record?.status === 'published' ? record.revision : this.#history(id)[0]?.revision;
    if (record?.draft === undefined) {
      const checks = this.#publishChecks(id, record, builtin);
      return {
        roleId: id,
        hasDraft: false,
        draftRevision: bumpRevision(record?.revision ?? builtin?.revision ?? 'r0'),
        ...(publishedRevision === undefined ? {} : { publishedRevision }),
        canPublish: false,
        checks,
        reason: '没有待发布的草稿',
      };
    }
    const checks = this.#publishChecks(id, record, builtin);
    return {
      roleId: id,
      hasDraft: true,
      draftRevision: bumpRevision(record.revision),
      ...(publishedRevision === undefined ? {} : { publishedRevision }),
      canPublish: checks.every((check) => check.state !== 'error'),
      checks,
    };
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
      const builtin = BUILT_IN_ROLES.find((role) => role.id === id);
      const checks = this.#publishChecks(id, current, builtin);
      const blocked = checks.filter((check) => check.state === 'error');
      if (blocked.length > 0) {
        const error = new AppError(ErrorCode.VALIDATION_FAILED, '发布前检查未通过', { details: { checks, canPublish: false } });
        this.#commands.fail(input.requestKey, error);
        throw error;
      }
      const revision = bumpRevision(current.revision);
      const draftResolved = resolveRole(draftDefinition(current, current.draft, revision));
      // The published record is the draft, not an overlay of the previous
      // revision: cleared fields (e.g. image:null) must stay cleared.
      const published: StoredRoleRecord = {
        id: current.id,
        ...(current.baseId === undefined ? {} : { baseId: current.baseId }),
        name: current.draft.name,
        purpose: current.draft.purpose,
        responsibilities: current.draft.responsibilities,
        ...extendedFromResolved(draftResolved),
        revision,
        status: 'published',
        publishedAt: nowIso(),
        updatedAt: nowIso(),
      };
      records[index] = published;
      this.#saveRecords(records);
      const historyEntry: StoredHistoryEntry = {
        revision,
        name: published.name,
        purpose: published.purpose,
        responsibilities: published.responsibilities,
        publishedAt: published.publishedAt ?? nowIso(),
        ...extendedFromResolved(draftResolved),
      };
      this.#store.settings.putJson(HISTORY_KEY_PREFIX + id, [
        historyEntry,
        ...this.#history(id).filter((item) => item.revision !== revision),
      ].slice(0, HISTORY_LIMIT));
      this.applyEffective();
      this.#commands.settle(input.requestKey, { roleId: id, revision });
      this.#publish('role.published', id);
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.list() };
    } catch (error) {
      const settled = this.#commands.get(input.requestKey);
      if (settled?.status === 'accepted') this.#commands.fail(input.requestKey, error instanceof Error ? error : new Error('发布职业失败'));
      throw error;
    }
  }

  history(roleId: string): { roleId: string; history: readonly RoleRevisionSnapshot[] } {
    const id = normalizeId(roleId);
    if (!BUILT_IN_ROLES.some((role) => role.id === id) && !this.#records().some((record) => record.id === id)) {
      throw new AppError(ErrorCode.NOT_FOUND, '职业不存在', { details: { roleId: id } });
    }
    return { roleId: id, history: this.#history(id) };
  }

  restore(roleId: string, revision: string, input: { requestKey: string; confirmRestore: true }): CommandResponse<RoleCatalogResponse> {
    if (input?.confirmRestore !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '恢复历史版本需要显式确认');
    const id = normalizeId(roleId);
    const history = this.#history(id);
    const snapshot = history.find((item) => item.revision === revision);
    if (snapshot === undefined) throw new AppError(ErrorCode.NOT_FOUND, '历史版本不存在');
    const builtin = BUILT_IN_ROLES.find((role) => role.id === id);
    const records = [...this.#records()];
    const index = records.findIndex((record) => record.id === id);
    if (builtin === undefined && index < 0) throw new AppError(ErrorCode.NOT_FOUND, '职业不存在', { details: { roleId: id } });
    const { replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'catalog.role.restore',
      body: { roleId: id, revision },
      target: { ref: id },
    });
    if (replayed) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '同一请求号已受理，请按回执核对');
    const now = nowIso();
    // Legacy snapshots have no extended fields; they restore as defaults.
    const draft: StoredRoleDraft = {
      name: snapshot.name,
      purpose: snapshot.purpose,
      responsibilities: snapshot.responsibilities,
      ...(snapshot.instructions === undefined ? {} : { instructions: snapshot.instructions }),
      ...(snapshot.model === undefined ? {} : { model: snapshot.model }),
      ...(snapshot.maxRuntimeMinutes === undefined ? {} : { maxRuntimeMinutes: snapshot.maxRuntimeMinutes }),
      ...(snapshot.capabilityGroups === undefined ? {} : { capabilityGroups: snapshot.capabilityGroups }),
      ...(snapshot.resourcePermissions === undefined ? {} : { resourcePermissions: snapshot.resourcePermissions }),
      ...(snapshot.allowedSlots === undefined ? {} : { allowedSlots: snapshot.allowedSlots }),
      ...(snapshot.image === undefined ? {} : { image: snapshot.image }),
      updatedAt: now,
    };
    if (index >= 0) {
      records[index] = { ...records[index]!, draft, updatedAt: now };
    } else {
      const resolvedBuiltin = resolveRole(builtin!);
      records.push({
        id,
        ...(builtin === undefined ? {} : { baseId: id }),
        name: resolvedBuiltin.name,
        purpose: resolvedBuiltin.purpose,
        responsibilities: resolvedBuiltin.responsibilities,
        ...extendedFromResolved(resolvedBuiltin),
        revision: resolvedBuiltin.revision,
        status: 'published',
        draft,
        updatedAt: now,
      });
    }
    this.#saveRecords(records);
    this.applyEffective();
    this.#commands.settle(input.requestKey, { roleId: id, revision, restoredAsDraft: true });
    this.#publish('role.draft.saved', id);
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.list() };
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

  #entry(resolved: RoleDefinitionResolved, record: StoredRoleRecord | undefined, isBuiltin: boolean): RoleCatalogEntry {
    const hasDraft = record?.draft !== undefined;
    const draft = hasDraft ? resolveRole(draftDefinition(record!, record!.draft!, bumpRevision(record!.revision))) : undefined;
    const checks = hasDraft ? this.#publishChecks(resolved.id, record, isBuiltin ? BUILT_IN_ROLES.find((role) => role.id === resolved.id) : undefined) : undefined;
    return {
      ...resolved,
      status: record?.status ?? 'published',
      ...(record?.baseId === undefined ? {} : { baseId: record.baseId }),
      hasDraft,
      ...(record === undefined ? {} : { updatedAt: record.updatedAt }),
      ...(draft === undefined ? {} : { draft }),
      imageHistory: this.#imageHistory(resolved.id),
      ...(checks === undefined ? {} : { publishChecks: checks }),
    };
  }

  #draftOnlyEntry(record: StoredRoleRecord): RoleCatalogEntry {
    const resolved = resolveRole(draftDefinition(record, record.draft!, bumpRevision(record.revision)));
    return {
      ...resolved,
      status: 'draft',
      ...(record.baseId === undefined ? {} : { baseId: record.baseId }),
      hasDraft: true,
      updatedAt: record.updatedAt,
      draft: resolved,
      imageHistory: this.#imageHistory(record.id),
      publishChecks: this.#publishChecks(record.id, record, BUILT_IN_ROLES.find((role) => role.id === record.id)),
    };
  }

  #effectiveRoles(): readonly RoleDefinitionResolved[] {
    const records = this.#records();
    const overrides = new Map(records.filter((record) => record.status === 'published').map((record) => [record.id, record]));
    const roles: RoleDefinitionResolved[] = [];
    for (const role of BUILT_IN_ROLES) {
      const override = overrides.get(role.id);
      roles.push(override === undefined ? resolveRole(role) : resolveRole(toDefinition(override)));
    }
    for (const record of records) {
      if (record.status === 'published' && !BUILT_IN_ROLES.some((role) => role.id === record.id)) {
        roles.push(resolveRole(toDefinition(record)));
      }
    }
    return roles;
  }

  #draftFallback(roleId: string): RoleDefinitionResolved {
    const record = this.#records().find((entry) => entry.id === roleId);
    if (record?.draft !== undefined) return resolveRole(draftDefinition(record, record.draft, bumpRevision(record.revision)));
    if (record !== undefined) return resolveRole(toDefinition(record));
    const builtin = BUILT_IN_ROLES.find((role) => role.id === roleId);
    if (builtin !== undefined) return resolveRole(builtin);
    return resolveRole({ id: roleId, name: '新职业', purpose: '', responsibilities: [], revision: 'r0', promptRevision: 'r0' });
  }

  #publishChecks(roleId: string, record: StoredRoleRecord | undefined, builtin: RoleDefinition | undefined): readonly RolePublishCheck[] {
    const previous = record !== undefined && record.status === 'published'
      ? resolveRole(toDefinition(record))
      : builtin === undefined
        ? undefined
        : resolveRole(builtin);
    const next = record?.draft !== undefined
      ? resolveRole(draftDefinition(record, record.draft, bumpRevision(record.revision)))
      : record !== undefined
        ? resolveRole(toDefinition(record))
        : previous;
    if (next === undefined) {
      return [{ id: 'responsibilities', label: '职责与指令', state: 'error', detail: '没有可检查的职业草稿' }];
    }
    const responsibilityChanges = diffResponsibilities(previous, next);
    const capabilityChanges = diffCapabilities(previous, next);
    const resourceChanges = diffResources(previous, next);
    const imageChanges = diffImage(previous, next);
    const enabledCapabilities = next.capabilityGroups.flatMap((group) => group.items).filter((item) => item.enabled);
    const checks: RolePublishCheck[] = [
      {
        id: 'responsibilities',
        label: '职责与指令完整',
        state: next.instructions.trim() === '' ? 'error' : 'ok',
        detail: `${String(next.responsibilities.length)} 条职责；指令 ${String(next.instructions.length)} 字`,
        ...(responsibilityChanges.length === 0 ? {} : { changes: responsibilityChanges }),
      },
      {
        id: 'capabilities',
        label: `能力范围 ${String(enabledCapabilities.length)} 项`,
        state: enabledCapabilities.length === 0 ? 'error' : 'ok',
        detail: enabledCapabilities.length === 0 ? '至少启用一项能力' : enabledCapabilities.map((item) => item.label).join('、'),
        ...(capabilityChanges.length === 0 ? {} : { changes: capabilityChanges }),
      },
      {
        id: 'resources',
        label: `资源权限 ${String(resourceCount(next.resourcePermissions))} 项`,
        state: 'ok',
        detail: `工具 ${String(next.resourcePermissions.tools.length)} · 文件 ${String(next.resourcePermissions.files.length)} · 命令 ${String(next.resourcePermissions.commands.length)} · 资源 ${String(next.resourcePermissions.resources.length)}`,
        ...(resourceChanges.length === 0 ? {} : { changes: resourceChanges }),
      },
      {
        id: 'image',
        label: next.image === undefined ? '形象沿用当前绑定' : '形象已绑定',
        state: next.image === undefined ? 'warn' : 'ok',
        detail: next.image === undefined ? '没有为这个修订记录形象，历史任务会显示占位' : `${next.image.label ?? next.image.id}（${next.image.kind}）`,
        ...(imageChanges.length === 0 ? {} : { changes: imageChanges }),
      },
    ];
    return checks;
  }

  #imageHistory(roleId: string): readonly RoleImageHistoryEntry[] {
    return this.#history(roleId).map((entry) => ({
      revision: entry.revision,
      publishedAt: entry.publishedAt,
      ...(entry.image === undefined ? {} : { image: entry.image }),
    }));
  }

  #history(roleId: string): readonly StoredHistoryEntry[] {
    const history = this.#store.settings.getJson<readonly StoredHistoryEntry[]>(HISTORY_KEY_PREFIX + roleId);
    if (!Array.isArray(history)) return [];
    return history.filter((item) => item !== null && typeof item === 'object' && typeof item.revision === 'string');
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

/* ------------------------------------------------------------------ */
/* Defaults / normalization / diffing                                  */
/* ------------------------------------------------------------------ */

function defaultInstructions(role: RoleDefinition): string {
  return `${role.purpose}\n\n职责：\n${role.responsibilities.map((item) => `- ${item}`).join('\n')}`;
}

function defaultCapabilityGroups(): readonly RoleCapabilityGroupView[] {
  return RoleCapabilityGroupMeta.map((group) => ({
    id: group.id,
    label: group.label,
    items: RoleCapabilityCatalog
      .filter((item) => item.group === group.id)
      .map((item) => ({ id: item.id, label: item.label, enabled: item.defaultEnabled })),
  }));
}

function emptyResourcePermissions(): RoleResourcePermissions {
  return { tools: [], files: [], commands: [], resources: [] };
}

/** Apply defaults to a stored/built-in role (old records simply lack the fields). */
function resolveRole(role: RoleDefinition): RoleDefinitionResolved {
  const builtinDefaults = BUILT_IN_ROLES.some((item) => item.id === role.id && item.revision === role.revision && JSON.stringify(item.responsibilities) === JSON.stringify(role.responsibilities));
  const instructions = typeof role.instructions === 'string' && role.instructions.trim() !== '' ? role.instructions.trim() : defaultInstructions(role);
  const groups = resolveCapabilityGroups(role.capabilityGroups).map((group) => ({ ...group, items: group.items.map((item) => item.id === 'document_write' && role.capabilityGroups === undefined && builtinDefaults ? { ...item, enabled: role.id === 'role.developer' || role.id === 'role.tester' } : item) }));
  const resources = role.resourcePermissions === undefined && builtinDefaults
    ? { tools: ['workspace.file.read', 'workspace.file.list', ...(role.id === 'role.developer' || role.id === 'role.tester' ? ['workspace.file.write', 'workspace.exec'] : [])].map((name) => ({ kind: 'mcp' as const, name })), files: [{ kind: 'read' as const, path: '.' }, ...(role.id === 'role.developer' || role.id === 'role.tester' ? [{ kind: 'write' as const, path: '.' }] : [])], commands: [], resources: [] }
    : resolveResourcePermissions(role.resourcePermissions);
  const image = isRoleImageBinding(role.image) ? role.image : undefined;
  const maxRuntimeMinutes = typeof role.maxRuntimeMinutes === 'number' && Number.isInteger(role.maxRuntimeMinutes) && role.maxRuntimeMinutes >= 1 && role.maxRuntimeMinutes <= 1_440
    ? role.maxRuntimeMinutes
    : undefined;
  const model = typeof role.model === 'string' && MODEL_PATTERN.test(role.model) ? role.model : undefined;
  return {
    allowedSlots: role.allowedSlots ?? Object.values(RoleResponsibilitySlot),
    id: role.id,
    name: role.name,
    purpose: role.purpose,
    revision: role.revision,
    promptRevision: role.promptRevision,
    responsibilities: role.responsibilities,
    instructions,
    ...(model === undefined ? {} : { model }),
    ...(maxRuntimeMinutes === undefined ? {} : { maxRuntimeMinutes }),
    capabilityGroups: groups,
    resourcePermissions: resources,
    ...(image === undefined ? {} : { image }),
  };
}

function resolveCapabilityGroups(input: readonly RoleCapabilityGroupView[] | undefined): readonly RoleCapabilityGroupView[] {
  const defaults = defaultCapabilityGroups();
  if (input === undefined) return defaults;
  const byId = new Map<string, RoleCapabilityGroupView>();
  for (const group of input) {
    if (group === null || typeof group !== 'object' || !RoleCapabilityGroupMeta.some((meta) => meta.id === group.id) || !Array.isArray(group.items)) continue;
    byId.set(group.id, group);
  }
  return RoleCapabilityGroupMeta.map((meta) => {
    const stored = byId.get(meta.id);
    const storedItems = new Map((stored?.items ?? []).filter((item) => item !== null && typeof item === 'object').map((item) => [item.id, item.enabled === true]));
    return {
      id: meta.id,
      label: meta.label,
      items: RoleCapabilityCatalog
        .filter((item) => item.group === meta.id)
        .map((item) => ({ id: item.id, label: item.label, enabled: storedItems.get(item.id) ?? item.defaultEnabled })),
    };
  });
}

function resolveResourcePermissions(input: RoleResourcePermissions | undefined): RoleResourcePermissions {
  if (input === undefined) return emptyResourcePermissions();
  const toolInput: readonly RoleResourcePermissionsInput['tools'][number][] = isArrayValue(input.tools) ? input.tools : [];
  const tools = toolInput
    .filter((tool) => tool !== null && typeof tool === 'object' && isToolKind(tool.kind) && typeof tool.name === 'string' && TOOL_NAME_PATTERN.test(tool.name))
    .map((tool) => ({ kind: tool.kind, name: tool.name, ...(typeof tool.source === 'string' && tool.source !== '' ? { source: tool.source } : {}) }));
  const fileInput: readonly RoleResourcePermissionsInput['files'][number][] = isArrayValue(input.files) ? input.files : [];
  const files = fileInput
    .filter((file) => file !== null && typeof file === 'object' && isFileKind(file.kind) && isValidRelativePath(file.path))
    .map((file) => ({ kind: file.kind, path: file.path, ...(typeof file.workspace === 'string' && file.workspace !== '' ? { workspace: file.workspace } : {}) }));
  const commandInput: readonly RoleResourcePermissionsInput['commands'][number][] = isArrayValue(input.commands) ? input.commands : [];
  const commands = commandInput
    .filter((command) => command !== null && typeof command === 'object' && isArrayValue(command.argv) && command.argv.length >= 1 && command.argv.every((token) => typeof token === 'string'))
    .map((command) => ({ kind: 'argv' as const, argv: [...command.argv], ...(typeof command.workspace === 'string' && command.workspace !== '' ? { workspace: command.workspace } : {}) }));
  const resourceInput: readonly RoleResourcePermissionsInput['resources'][number][] = isArrayValue(input.resources) ? input.resources : [];
  const resources: RoleResourcePermissions['resources'][number][] = [];
  for (const resource of resourceInput) {
    if (resource === null || typeof resource !== 'object' || typeof resource.id !== 'string') continue;
    const item = findCapability(resource.id);
    if (item !== undefined) resources.push({ kind: 'cap', id: item.id, label: item.label });
  }
  return { tools, files, commands, resources };
}

function isArrayValue(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function findCapability(id: string): { readonly id: string; readonly label: string; readonly group: RoleCapabilityGroupValue } | undefined {
  const item = RoleCapabilityCatalog.find((entry) => entry.id === id);
  return item === undefined ? undefined : { id: item.id, label: item.label, group: item.group };
}

function isToolKind(value: unknown): value is RoleResourcePermissions['tools'][number]['kind'] {
  return value === RoleResourceToolKind.NATIVE || value === RoleResourceToolKind.ASSIST || value === RoleResourceToolKind.MCP;
}

function isFileKind(value: unknown): value is RoleResourcePermissions['files'][number]['kind'] {
  return value === RoleResourceFileKind.READ || value === RoleResourceFileKind.WRITE;
}

function isRoleImageBinding(value: unknown): value is RoleImageBinding {
  if (value === null || typeof value !== 'object') return false;
  const image = value as RoleImageBinding;
  return typeof image.id === 'string' && ID_PATTERN.test(image.id)
    && (image.kind === 'initials' || image.kind === 'emoji')
    && typeof image.value === 'string' && image.value.trim() !== '' && image.value.trim().length <= 8;
}

function isValidRelativePath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const path = value.trim();
  return path.length >= 1 && path.length <= 500
    && !path.startsWith('/')
    && !path.includes('\\')
    && !/(^|\/)\.\.(\/|$)/.test(path)
    && !/[\u0000-\u001f\u007f]/.test(path);
}

function normalizeExtendedFields(input: RoleSaveRequest, fallback: RoleDefinitionResolved): StoredRoleFields {
  const instructions = input.instructions === undefined
    ? fallback.instructions.slice(0, MAX_TEXT)
    : normalizeOptionalText(input.instructions, '指令', MAX_TEXT);
  const model = input.model === undefined ? fallback.model : normalizeModel(input.model);
  const maxRuntimeMinutes = input.maxRuntimeMinutes === undefined ? fallback.maxRuntimeMinutes : normalizeMaxRuntime(input.maxRuntimeMinutes);
  const capabilityGroups = input.capabilityGroups === undefined
    ? fallback.capabilityGroups
    : normalizeCapabilityGroupInput(input.capabilityGroups, fallback.capabilityGroups);
  const resourcePermissions = input.resourcePermissions === undefined
    ? fallback.resourcePermissions
    : normalizeResourcePermissionsInput(input.resourcePermissions, fallback.resourcePermissions);
  const image = input.image === undefined ? fallback.image : input.image === null ? undefined : normalizeImage(input.image);
  return {
    allowedSlots: fallback.allowedSlots,
    ...(instructions === undefined || instructions.trim() === '' ? {} : { instructions }),
    ...(model === undefined ? {} : { model }),
    ...(maxRuntimeMinutes === undefined ? {} : { maxRuntimeMinutes }),
    capabilityGroups,
    resourcePermissions,
    ...(image === undefined ? {} : { image }),
  };
}

function normalizeCapabilityGroupInput(input: readonly RoleCapabilityGroupInput[], fallback: readonly RoleCapabilityGroupView[]): readonly RoleCapabilityGroupView[] {
  if (!Array.isArray(input) || input.length > RoleCapabilityGroupMeta.length) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, '能力范围分组不合法');
  }
  const fallbackItems = new Map<string, boolean>();
  for (const group of fallback) for (const item of group.items) fallbackItems.set(item.id, item.enabled);
  const provided = new Map<string, boolean>();
  const seenGroups = new Set<string>();
  for (const group of input) {
    if (group === null || typeof group !== 'object' || !RoleCapabilityGroupMeta.some((meta) => meta.id === group.id)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '未知的能力分组', { details: { group: (group as { id?: unknown } | null)?.id } });
    }
    if (seenGroups.has(group.id)) throw new AppError(ErrorCode.VALIDATION_FAILED, '能力分组重复', { details: { group: group.id } });
    seenGroups.add(group.id);
    if (!Array.isArray(group.items)) throw new AppError(ErrorCode.VALIDATION_FAILED, '能力分组条目必须是数组', { details: { group: group.id } });
    for (const item of group.items) {
      if (item === null || typeof item !== 'object' || typeof item.id !== 'string') {
        throw new AppError(ErrorCode.VALIDATION_FAILED, '能力条目不合法', { details: { group: group.id } });
      }
      const catalogItem = findCapability(item.id);
      if (catalogItem === undefined || catalogItem.group !== group.id) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, '未知的能力条目或分组不匹配', { details: { group: group.id, item: item.id } });
      }
      if (provided.has(item.id)) throw new AppError(ErrorCode.VALIDATION_FAILED, '能力条目重复', { details: { item: item.id } });
      if (typeof item.enabled !== 'boolean') throw new AppError(ErrorCode.VALIDATION_FAILED, '能力开关必须是布尔值', { details: { item: item.id } });
      provided.set(item.id, item.enabled);
    }
  }
  return RoleCapabilityGroupMeta.map((meta) => ({
    id: meta.id,
    label: meta.label,
    items: RoleCapabilityCatalog
      .filter((item) => item.group === meta.id)
      .map((item) => ({ id: item.id, label: item.label, enabled: provided.get(item.id) ?? fallbackItems.get(item.id) ?? item.defaultEnabled })),
  }));
}

function normalizeResourcePermissionsInput(input: RoleResourcePermissionsInput, fallback: RoleResourcePermissions): RoleResourcePermissions {
  if (input === null || typeof input !== 'object') throw new AppError(ErrorCode.VALIDATION_FAILED, '资源权限必须是对象');
  const tools = input.tools === undefined ? fallback.tools : normalizeTools(input.tools);
  const files = input.files === undefined ? fallback.files : normalizeFiles(input.files);
  const commands = input.commands === undefined ? fallback.commands : normalizeCommands(input.commands);
  const resources = input.resources === undefined ? fallback.resources : normalizeResourceCapabilities(input.resources);
  return { tools, files, commands, resources };
}

function normalizeTools(input: RoleResourcePermissionsInput['tools']): RoleResourcePermissions['tools'] {
  if (!isArrayValue(input) || input.length > 64) throw new AppError(ErrorCode.VALIDATION_FAILED, '工具权限最多 64 项');
  const seen = new Set<string>();
  return input.map((tool, index) => {
    if (tool === null || typeof tool !== 'object' || !isToolKind(tool.kind) || typeof tool.name !== 'string' || !TOOL_NAME_PATTERN.test(tool.name.trim())) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `工具权限 ${index + 1} 不合法`);
    }
    const name = tool.name.trim();
    const key = `${tool.kind}:${name}`;
    if (seen.has(key)) throw new AppError(ErrorCode.VALIDATION_FAILED, '工具权限重复', { details: { name } });
    seen.add(key);
    const source = tool.source === undefined ? undefined : normalizeOptionalText(tool.source, `工具 ${name} 来源`, 200);
    return { kind: tool.kind, name, ...(source === undefined ? {} : { source }) };
  });
}

function normalizeFiles(input: RoleResourcePermissionsInput['files']): RoleResourcePermissions['files'] {
  if (!isArrayValue(input) || input.length > 64) throw new AppError(ErrorCode.VALIDATION_FAILED, '文件权限最多 64 项');
  const seen = new Set<string>();
  return input.map((file, index) => {
    if (file === null || typeof file !== 'object' || !isFileKind(file.kind) || !isValidRelativePath(file.path)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `文件权限 ${index + 1} 不合法（路径必须是工作区相对路径，不能以 / 开头或包含 ..）`);
    }
    const path = file.path.trim();
    const key = `${file.kind}:${path}`;
    if (seen.has(key)) throw new AppError(ErrorCode.VALIDATION_FAILED, '文件权限重复', { details: { path } });
    seen.add(key);
    const workspace = file.workspace === undefined ? undefined : normalizeOptionalText(file.workspace, `文件 ${path} 工作区`, 120);
    return { kind: file.kind, path, ...(workspace === undefined ? {} : { workspace }) };
  });
}

function normalizeCommands(input: RoleResourcePermissionsInput['commands']): RoleResourcePermissions['commands'] {
  if (!isArrayValue(input) || input.length > 32) throw new AppError(ErrorCode.VALIDATION_FAILED, '命令权限最多 32 项');
  const seen = new Set<string>();
  return input.map((command, index) => {
    if (command === null || typeof command !== 'object' || !isArrayValue(command.argv) || command.argv.length < 1 || command.argv.length > 32) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `命令权限 ${index + 1} 不合法：argv 需要 1–32 个参数`);
    }
    const argv = command.argv.map((token, tokenIndex) => {
      if (typeof token !== 'string' || token.length > 500 || /[\u0000-\u001f\u007f]/.test(token)) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, `命令权限 ${index + 1} 参数 ${tokenIndex + 1} 不合法`);
      }
      return token;
    });
    if (argv[0]?.trim() === '') throw new AppError(ErrorCode.VALIDATION_FAILED, `命令权限 ${index + 1} 缺少命令名`);
    if (argv.join(' ').length > 4_096) throw new AppError(ErrorCode.VALIDATION_FAILED, `命令权限 ${index + 1} 过长`);
    const workspace = command.workspace === undefined ? undefined : normalizeOptionalText(command.workspace, `命令 ${argv[0]} 工作区`, 120);
    const key = JSON.stringify([argv, workspace ?? null]);
    if (seen.has(key)) throw new AppError(ErrorCode.VALIDATION_FAILED, '命令权限重复', { details: { argv } });
    seen.add(key);
    return { kind: 'argv' as const, argv, ...(workspace === undefined ? {} : { workspace }) };
  });
}

function normalizeResourceCapabilities(input: RoleResourcePermissionsInput['resources']): RoleResourcePermissions['resources'] {
  if (!isArrayValue(input) || input.length > 32) throw new AppError(ErrorCode.VALIDATION_FAILED, '资源能力最多 32 项');
  const seen = new Set<string>();
  return input.map((resource, index) => {
    if (resource === null || typeof resource !== 'object' || typeof resource.id !== 'string') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `资源能力 ${index + 1} 不合法`);
    }
    const item = findCapability(resource.id);
    if (item === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '未知的资源能力', { details: { id: resource.id } });
    if (seen.has(item.id)) throw new AppError(ErrorCode.VALIDATION_FAILED, '资源能力重复', { details: { id: item.id } });
    seen.add(item.id);
    return { kind: 'cap' as const, id: item.id, label: item.label };
  });
}

function normalizeImage(input: RoleImageInput): RoleImageBinding {
  if (input === null || typeof input !== 'object' || typeof input.id !== 'string' || !ID_PATTERN.test(input.id)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, '形象 id 不合法');
  }
  if (input.kind !== 'initials' && input.kind !== 'emoji') throw new AppError(ErrorCode.VALIDATION_FAILED, '形象类型必须是 initials 或 emoji');
  const value = normalizeText(input.value, '形象内容', 1, 8);
  const label = input.label === undefined ? undefined : normalizeOptionalText(input.label, '形象名称', 40);
  return { id: input.id, kind: input.kind, value, ...(label === undefined ? {} : { label }) };
}

function normalizeModel(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !MODEL_PATTERN.test(value.trim())) throw new AppError(ErrorCode.VALIDATION_FAILED, '模型格式不合法（示例：opencode-go/deepseek-v4.1-flash）');
  return value.trim();
}

function normalizeMaxRuntime(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 1_440) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, '单步最长运行必须是 1–1440 的整数分钟');
  }
  return value;
}

function extendedFromResolved(resolved: RoleDefinitionResolved): StoredRoleFields {
  return {
    allowedSlots: resolved.allowedSlots,
    instructions: resolved.instructions,
    ...(resolved.model === undefined ? {} : { model: resolved.model }),
    ...(resolved.maxRuntimeMinutes === undefined ? {} : { maxRuntimeMinutes: resolved.maxRuntimeMinutes }),
    capabilityGroups: resolved.capabilityGroups,
    resourcePermissions: resolved.resourcePermissions,
    ...(resolved.image === undefined ? {} : { image: resolved.image }),
  };
}

function resourceCount(permissions: RoleResourcePermissions): number {
  return permissions.tools.length + permissions.files.length + permissions.commands.length + permissions.resources.length;
}

function diffResponsibilities(previous: RoleDefinitionResolved | undefined, next: RoleDefinitionResolved): string[] {
  if (previous === undefined) return ['+ 新建职业草稿'];
  const changes: string[] = [];
  if (previous.name !== next.name) changes.push(`~ 名称：${previous.name} → ${next.name}`);
  if (previous.purpose !== next.purpose) changes.push('~ 定位：已修改');
  if (previous.responsibilities.join('\n') !== next.responsibilities.join('\n')) changes.push(`~ 职责：${String(next.responsibilities.length)} 条（原 ${String(previous.responsibilities.length)} 条）`);
  if (previous.instructions !== next.instructions) changes.push('~ 指令：已修改');
  if (previous.model !== next.model) changes.push(`~ 模型：${next.model ?? '跟随项目默认'}`);
  if (previous.maxRuntimeMinutes !== next.maxRuntimeMinutes) changes.push(`~ 单步最长运行：${next.maxRuntimeMinutes === undefined ? '跟随设置' : `${String(next.maxRuntimeMinutes)} 分钟`}`);
  return changes;
}

function diffCapabilities(previous: RoleDefinitionResolved | undefined, next: RoleDefinitionResolved): string[] {
  const flatten = (role: RoleDefinitionResolved | undefined): Map<string, { label: string; enabled: boolean }> => {
    const map = new Map<string, { label: string; enabled: boolean }>();
    for (const group of role?.capabilityGroups ?? []) for (const item of group.items) map.set(item.id, { label: item.label, enabled: item.enabled });
    return map;
  };
  const before = flatten(previous);
  const after = flatten(next);
  const changes: string[] = [];
  for (const [id, item] of after) {
    const old = before.get(id);
    if (item.enabled && old?.enabled !== true) changes.push(`+ 能力：${item.label}`);
    if (!item.enabled && old?.enabled === true) changes.push(`- 能力：${item.label}`);
  }
  return changes;
}

function diffResources(previous: RoleDefinitionResolved | undefined, next: RoleDefinitionResolved): string[] {
  const before = previous?.resourcePermissions ?? emptyResourcePermissions();
  const after = next.resourcePermissions;
  const changes: string[] = [];
  const toolKeys = (permissions: RoleResourcePermissions) => new Set(permissions.tools.map((tool) => `${tool.kind}:${tool.name}`));
  const fileKeys = (permissions: RoleResourcePermissions) => new Set(permissions.files.map((file) => `${file.kind}:${file.path}`));
  const commandKeys = (permissions: RoleResourcePermissions) => new Set(permissions.commands.map((command) => JSON.stringify(command.argv)));
  const resourceKeys = (permissions: RoleResourcePermissions) => new Set(permissions.resources.map((resource) => resource.id));
  const diffKeys = (oldKeys: Set<string>, newKeys: Set<string>, label: (key: string) => string): string[] => {
    const lines: string[] = [];
    for (const key of newKeys) if (!oldKeys.has(key)) lines.push(`+ ${label(key)}`);
    for (const key of oldKeys) if (!newKeys.has(key)) lines.push(`- ${label(key)}`);
    return lines;
  };
  changes.push(...diffKeys(toolKeys(before), toolKeys(after), (key) => `工具：${key.split(':').slice(1).join(':')}`));
  changes.push(...diffKeys(fileKeys(before), fileKeys(after), (key) => {
    const [kind, ...rest] = key.split(':');
    return `文件：${(kind ?? '').toUpperCase()} ${rest.join(':')}`;
  }));
  changes.push(...diffKeys(commandKeys(before), commandKeys(after), (key) => `命令：${(JSON.parse(key) as string[]).join(' ')}`));
  changes.push(...diffKeys(resourceKeys(before), resourceKeys(after), (key) => `资源：${key}`));
  return changes;
}

function diffImage(previous: RoleDefinitionResolved | undefined, next: RoleDefinitionResolved): string[] {
  if (previous?.image?.id === next.image?.id) return [];
  if (next.image === undefined) return ['- 形象：取消绑定'];
  return [`+ 形象：${next.image.label ?? next.image.id}`];
}

function toDefinition(record: StoredRoleRecord): RoleDefinition {
  return {
    id: record.id,
    name: record.name,
    purpose: record.purpose,
    responsibilities: record.responsibilities,
    revision: record.revision,
    promptRevision: record.revision,
    ...(record.allowedSlots === undefined ? {} : { allowedSlots: record.allowedSlots }),
    ...(record.instructions === undefined ? {} : { instructions: record.instructions }),
    ...(record.model === undefined ? {} : { model: record.model }),
    ...(record.maxRuntimeMinutes === undefined ? {} : { maxRuntimeMinutes: record.maxRuntimeMinutes }),
    ...(record.capabilityGroups === undefined ? {} : { capabilityGroups: record.capabilityGroups }),
    ...(record.resourcePermissions === undefined ? {} : { resourcePermissions: record.resourcePermissions }),
    ...(record.image === undefined ? {} : { image: record.image }),
  };
}

/**
 * A draft is a complete replacement, not an overlay: fields the user cleared
 * (e.g. image:null) must fall back to model defaults, never to the published
 * value. Only the identity/revision come from the record.
 */
function draftDefinition(record: StoredRoleRecord, draft: StoredRoleDraft, revision: string): RoleDefinition {
  return {
    id: record.id,
    name: draft.name,
    purpose: draft.purpose,
    responsibilities: draft.responsibilities,
    revision,
    promptRevision: revision,
    ...(draft.allowedSlots === undefined ? {} : { allowedSlots: draft.allowedSlots }),
    ...(draft.instructions === undefined ? {} : { instructions: draft.instructions }),
    ...(draft.model === undefined ? {} : { model: draft.model }),
    ...(draft.maxRuntimeMinutes === undefined ? {} : { maxRuntimeMinutes: draft.maxRuntimeMinutes }),
    ...(draft.capabilityGroups === undefined ? {} : { capabilityGroups: draft.capabilityGroups }),
    ...(draft.resourcePermissions === undefined ? {} : { resourcePermissions: draft.resourcePermissions }),
    ...(draft.image === undefined ? {} : { image: draft.image }),
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

function normalizeOptionalText(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new AppError(ErrorCode.VALIDATION_FAILED, `${field}必须是字符串`);
  const text = value.trim();
  if (text.length > max) throw new AppError(ErrorCode.VALIDATION_FAILED, `${field}长度不能超过 ${max}`);
  return text === '' ? undefined : text;
}

function normalizeId(value: unknown): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new AppError(ErrorCode.VALIDATION_FAILED, '职业 id 不合法');
  return value;
}
