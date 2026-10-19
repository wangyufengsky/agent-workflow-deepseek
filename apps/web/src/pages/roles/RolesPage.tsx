import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ROUTES,
  createRequestKey,
  type CommandResponse,
  type OperationReceipt,
  type RoleCapabilityGroupView,
  type RoleCatalogEntry,
  type RoleCatalogResponse,
  type RoleImageBinding,
  type RolePublishCheck,
  type RoleRevisionSnapshot,
  type RoleSaveRequest,
  type RoleValidateResponse,
  type RoleHistoryResponse,
  type RoleResourceCapability,
  type RoleResourceCommand,
  type RoleResourceFile,
  type RoleResourcePermissions,
  type RoleResourceTool,
} from '@agent-workflow/shared';
import { apiGet, apiPost, errorMessage, isServiceUnavailable } from '../../api/client.ts';
import { fetchRoleCatalog } from '../../api/catalog-editor.ts';
import { useBootstrap } from '../../api/hooks.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button, LinkButton } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { EmptyState, Skeleton } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { IconButton } from '../../components/IconButton.tsx';
import { Modal } from '../../components/Modal.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { ReceiptNotice } from '../../flow/workflow-ui.tsx';
import './roles.css';

type RoleTab = 'overview' | 'caps' | 'perms' | 'look';
type AddKind = 'tools' | 'files' | 'resources';

interface RoleForm {
  readonly name: string;
  readonly purpose: string;
  readonly responsibilities: readonly string[];
  readonly instructions: string;
  readonly model: string;
  readonly maxRuntimeMinutes?: number;
  readonly capabilityGroups: readonly RoleCapabilityGroupView[];
  readonly resourcePermissions: RoleResourcePermissions;
  readonly image?: RoleImageBinding | null;
}

interface CommandEditor {
  readonly index: number | null;
  readonly argv: readonly string[];
  readonly workspace: string;
}

interface ReceiptState {
  readonly kind: 'save' | 'publish' | 'restore' | 'new' | 'archive';
  readonly receipt: OperationReceipt;
}

interface SwitchPrompt {
  readonly targetId: string;
  readonly kind: 'dirty' | 'command';
}

interface PublishReview {
  readonly validation: RoleValidateResponse;
  readonly diff: readonly string[];
  readonly historyNote?: string;
  readonly previous?: RoleRevisionSnapshot;
}

function avatarText(image: RoleImageBinding | undefined, name: string): string {
  if (image !== undefined) return image.value.trim().length === 0 ? '?' : image.value;
  const initial = name.trim().slice(0, 1);
  return initial.length === 0 ? '?' : initial;
}

function RoleAvatar({ image, name, large }: { readonly image?: RoleImageBinding; readonly name: string; readonly large?: boolean }) {
  return (
    <span className={`role-avatar${image === undefined ? ' placeholder' : ''}${large === true ? ' lg' : ''}`} aria-hidden="true">
      {avatarText(image, name)}
    </span>
  );
}

function normalizePermissions(permissions: RoleResourcePermissions | undefined): RoleResourcePermissions {
  return {
    tools: [...(permissions?.tools ?? [])],
    files: [...(permissions?.files ?? [])],
    commands: [...(permissions?.commands ?? [])],
    resources: [...(permissions?.resources ?? [])],
  };
}

function formFromEntry(entry: RoleCatalogEntry): RoleForm {
  const source = entry.draft ?? entry;
  return {
    name: source.name,
    purpose: source.purpose,
    responsibilities: [...source.responsibilities],
    instructions: source.instructions ?? '',
    model: source.model ?? '',
    ...(source.maxRuntimeMinutes === undefined ? {} : { maxRuntimeMinutes: source.maxRuntimeMinutes }),
    capabilityGroups: (source.capabilityGroups ?? []).map((group) => ({
      ...group,
      items: group.items.map((item) => ({ ...item })),
    })),
    resourcePermissions: normalizePermissions(source.resourcePermissions),
    ...(source.image === undefined ? {} : { image: { ...source.image } }),
  };
}

function fingerprint(form: RoleForm): string {
  return JSON.stringify({
    name: form.name,
    purpose: form.purpose,
    responsibilities: form.responsibilities,
    instructions: form.instructions,
    model: form.model,
    maxRuntimeMinutes: form.maxRuntimeMinutes,
    capabilityGroups: form.capabilityGroups,
    resourcePermissions: form.resourcePermissions,
    image: form.image ?? null,
  });
}

function buildSaveBody(form: RoleForm, roleId: string | undefined): RoleSaveRequest {
  const model = form.model.trim();
  const capabilities = form.capabilityGroups.map((group) => ({
    id: group.id,
    items: group.items.map((item) => ({ id: item.id, enabled: item.enabled })),
  }));
  const permissions = {
    tools: form.resourcePermissions.tools.map((tool) => ({
      kind: tool.kind,
      name: tool.name,
      ...(tool.source === undefined ? {} : { source: tool.source }),
    })),
    files: form.resourcePermissions.files.map((file) => ({
      kind: file.kind,
      path: file.path,
      ...(file.workspace === undefined ? {} : { workspace: file.workspace }),
    })),
    commands: form.resourcePermissions.commands.map((command) => ({
      argv: [...command.argv],
      ...(command.workspace === undefined ? {} : { workspace: command.workspace }),
    })),
    resources: form.resourcePermissions.resources.map((resource) => ({ id: resource.id })),
  };
  return {
    requestKey: createRequestKey(),
    ...(roleId === undefined ? {} : { roleId }),
    name: form.name.trim(),
    purpose: form.purpose.trim(),
    responsibilities: form.responsibilities.map((line) => line.trim()).filter((line) => line.length > 0),
    instructions: form.instructions,
    ...(model.length === 0 ? {} : { model }),
    ...(form.maxRuntimeMinutes === undefined ? {} : { maxRuntimeMinutes: form.maxRuntimeMinutes }),
    capabilityGroups: capabilities,
    resourcePermissions: permissions,
    ...(form.image === undefined ? {} : { image: form.image }),
    confirmSave: true,
  };
}


function snapshotFromEntry(entry: RoleCatalogEntry): RoleRevisionSnapshot {
  return {
    revision: entry.revision,
    name: entry.name,
    purpose: entry.purpose,
    responsibilities: [...entry.responsibilities],
    publishedAt: entry.updatedAt ?? '1970-01-01T00:00:00.000Z',
    ...(entry.instructions === undefined ? {} : { instructions: entry.instructions }),
    ...(entry.model === undefined ? {} : { model: entry.model }),
    ...(entry.maxRuntimeMinutes === undefined ? {} : { maxRuntimeMinutes: entry.maxRuntimeMinutes }),
    ...(entry.capabilityGroups === undefined ? {} : { capabilityGroups: entry.capabilityGroups }),
    ...(entry.resourcePermissions === undefined ? {} : { resourcePermissions: entry.resourcePermissions }),
    ...(entry.image === undefined ? {} : { image: entry.image }),
  };
}

function countEnabled(groups: readonly RoleCapabilityGroupView[]): number {
  return groups.reduce((total, group) => total + group.items.filter((item) => item.enabled).length, 0);
}

function changesFor(label: string, before: string, after: string): string[] {
  return before === after ? [] : [`${label}：${before === '' ? '（空）' : before} → ${after === '' ? '（空）' : after}`];
}

function compareDrafts(current: RoleForm, previous: RoleRevisionSnapshot): { readonly diff: readonly string[]; readonly note?: string } {
  const diff: string[] = [];
  const notes: string[] = [];
  diff.push(...changesFor('名称', previous.name, current.name));
  diff.push(...changesFor('purpose', previous.purpose, current.purpose));
  diff.push(...changesFor('职责条目', previous.responsibilities.join('；'), current.responsibilities.map((line) => line.trim()).filter((line) => line.length > 0).join('；')));
  if (previous.instructions === undefined) {
    notes.push('上一修订快照未记录 instructions（旧快照兼容），本项不做差异判断。');
  } else {
    if (previous.instructions !== current.instructions) {
      diff.push(`指令：已修改（${String(previous.instructions.length)} 字 → ${String(current.instructions.length)} 字）`);
    }
  }
  const previousModel = previous.model ?? '';
  diff.push(...changesFor('模型', previousModel === '' ? '跟随默认' : previousModel, current.model.trim() === '' ? '跟随默认' : current.model.trim()));
  const previousRuntime = previous.maxRuntimeMinutes === undefined ? '跟随默认' : `${String(previous.maxRuntimeMinutes)} 分钟`;
  const currentRuntime = current.maxRuntimeMinutes === undefined ? '跟随默认' : `${String(current.maxRuntimeMinutes)} 分钟`;
  diff.push(...changesFor('单步最长运行', previousRuntime, currentRuntime));
  if (previous.capabilityGroups === undefined) {
    notes.push('上一修订快照未记录能力范围（旧快照兼容），本项不做差异判断。');
  } else {
    const before = new Map<string, boolean>();
    for (const group of previous.capabilityGroups) for (const item of group.items) before.set(item.id, item.enabled);
    const after = new Map<string, boolean>();
    for (const group of current.capabilityGroups) for (const item of group.items) after.set(item.id, item.enabled);
    const enabled = [...after.entries()].filter(([, value]) => value).map(([id]) => id);
    const removed = [...before.entries()].filter(([id, value]) => value && after.get(id) !== true).map(([id]) => id);
    const added = enabled.filter((id) => before.get(id) !== true);
    if (added.length > 0) diff.push(`能力范围：+${added.join('、')}`);
    if (removed.length > 0) diff.push(`能力范围：-${removed.join('、')}`);
  }
  if (previous.resourcePermissions === undefined) {
    notes.push('上一修订快照未记录资源权限（旧快照兼容），本项不做差异判断。');
  } else {
    const before = previous.resourcePermissions;
    const after = current.resourcePermissions;
    const summary = (permissions: RoleResourcePermissions): string =>
      `工具 ${String(permissions.tools.length)} · 文件 ${String(permissions.files.length)} · 命令 ${String(permissions.commands.length)} · 资源 ${String(permissions.resources.length)}`;
    diff.push(...changesFor('资源权限数量', summary(before), summary(after)));
    const toolNames = (tools: readonly RoleResourceTool[]): string => tools.map((tool) => `${tool.kind}:${tool.name}${tool.source === undefined ? '' : `@${tool.source}`}`).sort().join('、');
    diff.push(...changesFor('工具', toolNames(before.tools) || '（空）', toolNames(after.tools) || '（空）'));
    const fileNames = (files: readonly RoleResourceFile[]): string => files.map((file) => `${file.kind}:${file.path}${file.workspace === undefined ? '' : `@${file.workspace}`}`).sort().join('、');
    diff.push(...changesFor('文件', fileNames(before.files) || '（空）', fileNames(after.files) || '（空）'));
    const commandNames = (commands: readonly RoleResourceCommand[]): string => commands.map((command) => `${command.workspace ?? ''}:${JSON.stringify(command.argv)}`).sort().join('；');
    diff.push(...changesFor('命令', commandNames(before.commands) || '（空）', commandNames(after.commands) || '（空）'));
    const resourceNames = (resources: readonly RoleResourceCapability[]): string => resources.map((resource) => `${resource.id}:${resource.label}`).sort().join('、');
    diff.push(...changesFor('资源能力', resourceNames(before.resources) || '（空）', resourceNames(after.resources) || '（空）'));
  }
  if (previous.image === undefined) {
    notes.push('上一修订快照未记录形象（旧快照兼容）；历史任务按占位显示。');
  } else {
    const before = previous.image === undefined ? '（空）' : `${previous.image.kind}:${previous.image.value}`;
    const after = current.image == null ? '（空）' : `${current.image.kind}:${current.image.value}`;
    diff.push(...changesFor('形象', before, after));
  }
  return {
    diff,
    ...(notes.length === 0 ? {} : { note: notes.join(' ') }),
  };
}

function helpTone(state: RolePublishCheck['state']): 'ok' | 'warn' | 'danger' {
  if (state === 'error') return 'danger';
  if (state === 'warn') return 'warn';
  return 'ok';
}

function helpIcon(state: RolePublishCheck['state']): 'check' | 'alert' | 'x' {
  if (state === 'error') return 'x';
  if (state === 'warn') return 'alert';
  return 'check';
}

function isLockingReceipt(receipt: OperationReceipt | undefined): boolean {
  return receipt !== undefined && (receipt.status === 'unknown' || receipt.status === 'accepted');
}

export function RolesPage() {
  const bootstrap = useBootstrap();
  const queryClient = useQueryClient();
  const catalogQuery = useQuery({ queryKey: ['catalog', 'roles'], queryFn: fetchRoleCatalog, retry: false });
  const bootstrapRoles = bootstrap.data?.catalog.roles ?? [];
  const roles: readonly RoleCatalogEntry[] = catalogQuery.data?.roles
    ?? bootstrapRoles.map((role) => ({
      ...role,
      status: 'published' as const,
      hasDraft: false,
      imageHistory: [],
    }));
  const methods = bootstrap.data?.catalog.methods ?? [];
  const modelProfiles = bootstrap.data?.catalog.modelProfiles ?? [];
  const [keyword, setKeyword] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tab, setTab] = useState<RoleTab>('overview');
  const [form, setForm] = useState<RoleForm | null>(null);
  const [baseline, setBaseline] = useState<RoleForm | null>(null);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [receiptState, setReceiptState] = useState<ReceiptState | undefined>(undefined);
  const [commandEditor, setCommandEditor] = useState<CommandEditor | null>(null);
  const [addDialog, setAddDialog] = useState<AddKind | null>(null);
  const [newRole, setNewRole] = useState<{ name: string; purpose: string; responsibilities: string } | null>(null);
  const [switchPrompt, setSwitchPrompt] = useState<SwitchPrompt | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<RoleHistoryResponse | null>(null);
  const [historyError, setHistoryError] = useState<string | undefined>(undefined);
  const [restoreTarget, setRestoreTarget] = useState<RoleRevisionSnapshot | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishReview, setPublishReview] = useState<PublishReview | null>(null);
  const [checking, setChecking] = useState(false);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['catalog', 'roles'] }),
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
    ]);
  };

  const applyCatalog = (next: RoleCatalogResponse | undefined) => {
    if (next !== undefined) queryClient.setQueryData(['catalog', 'roles'], next);
    void queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
  };

  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    if (needle.length === 0) return roles;
    return roles.filter((role) => [role.name, role.draft?.name ?? '', role.draft?.purpose ?? '', role.purpose, role.id, ...(role.draft?.responsibilities ?? role.responsibilities)].join(' ').toLowerCase().includes(needle));
  }, [keyword, roles]);

  const selected = roles.find((role) => role.id === selectedId) ?? roles[0];
  const selectedIndex = selected === undefined ? -1 : filtered.findIndex((role) => role.id === selected.id);

  useEffect(() => {
    if (selected === undefined) {
      setForm(null);
      setBaseline(null);
      setEditingId(null);
      return;
    }
    if (selected.id === editingId) return;
    const next = formFromEntry(selected);
    setForm(next);
    setBaseline(next);
    setEditingId(selected.id);
    setTab('overview');
    setCommandEditor(null);
    setHistoryOpen(false);
    setHistory(null);
    setPublishOpen(false);
    setPublishReview(null);
  }, [editingId, selected]);

  const planningMethods = useMemo(() => {
    if (selected === undefined) return [];
    return methods
      .filter((method) => method.planningStrategy?.roleId === selected.id)
      .map((method) => ({ id: method.id, name: method.name, revision: method.revision }));
  }, [methods, selected]);

  const dirty = form !== null && baseline !== null && fingerprint(form) !== fingerprint(baseline);
  const pendingCommand = commandEditor !== null;
  const locked = isLockingReceipt(receiptState?.receipt);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (selected === undefined || form === null) throw new Error('没有选中的职业');
      const response = await apiPost<CommandResponse<RoleCatalogResponse>>(ROUTES.catalogRoleSave, buildSaveBody(form, selected.id));
      return response.data;
    },
    onSuccess: (data) => {
      setFailure(undefined);
      setReceiptState({ kind: 'save', receipt: data.receipt });
      applyCatalog(data.resource);
      if (data.receipt.status === 'succeeded') {
        const nextEntry = data.resource?.roles.find((role) => role.id === editingId);
        if (nextEntry !== undefined) {
          const next = formFromEntry(nextEntry);
          setForm(next);
          setBaseline(next);
        }
      }
    },
    onError: (error) => {
      setFailure(isServiceUnavailable(error) ? '服务未连接，草稿未保存。' : errorMessage(error));
    },
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      if (selected === undefined) throw new Error('没有选中的职业');
      const response = await apiPost<CommandResponse<RoleCatalogResponse>>(ROUTES.catalogRolePublish(selected.id), {
        requestKey: createRequestKey(),
        confirmPublish: true,
      });
      return response.data;
    },
    onSuccess: (data) => {
      setFailure(undefined);
      setReceiptState({ kind: 'publish', receipt: data.receipt });
      applyCatalog(data.resource);
      setPublishOpen(false);
      setPublishReview(null);
      if (data.receipt.status === 'succeeded') {
        const nextEntry = data.resource?.roles.find((role) => role.id === editingId);
        if (nextEntry !== undefined) {
          const next = formFromEntry(nextEntry);
          setForm(next);
          setBaseline(next);
        }
      }
    },
    onError: (error) => {
      setFailure(isServiceUnavailable(error) ? '服务未连接，未发布。' : errorMessage(error));
    },
  });

  const newRoleMutation = useMutation({
    mutationFn: async (input: { name: string; purpose: string; responsibilities: string }) => {
      const body: RoleSaveRequest = {
        requestKey: createRequestKey(),
        name: input.name.trim(),
        purpose: input.purpose.trim(),
        responsibilities: input.responsibilities.split(/\n+/).map((line) => line.trim()).filter((line) => line.length > 0),
        confirmSave: true,
      };
      const response = await apiPost<CommandResponse<RoleCatalogResponse>>(ROUTES.catalogRoleSave, body);
      return response.data;
    },
    onSuccess: (data) => {
      setFailure(undefined);
      setReceiptState({ kind: 'new', receipt: data.receipt });
      applyCatalog(data.resource);
      const oldIds = new Set(roles.map((role) => role.id));
      if (data.receipt.status === 'succeeded') {
        const created = data.resource?.roles.find((role) => !oldIds.has(role.id));
        if (created !== undefined) setSelectedId(created.id);
        setNewRole(null);
      } else if (data.receipt.status !== 'failed') {
        setNewRole(null);
      } else {
        setFailure(data.receipt.error?.message ?? '创建失败，职业未创建。');
      }
    },
    onError: (error) => {
      setFailure(isServiceUnavailable(error) ? '服务未连接，职业未创建。' : errorMessage(error));
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (roleId: string) => {
      const response = await apiPost<CommandResponse<RoleCatalogResponse>>(ROUTES.catalogRoleArchive(roleId), {
        requestKey: createRequestKey(),
        confirmArchive: true,
      });
      return response.data;
    },
    onSuccess: async (data) => {
      setFailure(undefined);
      setReceiptState({ kind: 'archive', receipt: data.receipt });
      applyCatalog(data.resource);
      await invalidate();
    },
    onError: (error) => setFailure(isServiceUnavailable(error) ? '服务未连接，未归档。' : errorMessage(error)),
  });

  const restoreMutation = useMutation({
    mutationFn: async (target: { roleId: string; revision: string }) => {
      const response = await apiPost<CommandResponse<RoleCatalogResponse>>(ROUTES.catalogRoleRestore(target.roleId, target.revision), {
        requestKey: createRequestKey(),
        confirmRestore: true,
      });
      return response.data;
    },
    onSuccess: async (data) => {
      setFailure(undefined);
      setReceiptState({ kind: 'restore', receipt: data.receipt });
      applyCatalog(data.resource);
      if (data.receipt.status === 'succeeded') {
        const nextEntry = data.resource?.roles.find((role) => role.id === selected?.id);
        if (nextEntry !== undefined) {
          const next = formFromEntry(nextEntry);
          setForm(next);
          setBaseline(next);
          setSelectedId(nextEntry.id);
        }
      }
      setRestoreTarget(null);
      setHistoryOpen(false);
      await invalidate();
    },
    onError: (error) => setFailure(isServiceUnavailable(error) ? '服务未连接，未恢复。' : errorMessage(error)),
  });

  const createBusy = newRoleMutation.isPending || archiveMutation.isPending || restoreMutation.isPending;
  const actionBusy = saveMutation.isPending || publishMutation.isPending || checking || createBusy;
  const readOnly = locked || actionBusy;
  const commandBlockedReason = pendingCommand ? '还有一项命令参数修改没有应用；先应用或放弃后再继续。' : undefined;
  const invalidReason = form === undefined ? '没有选中的职业' : form === null || form.name.trim() === ''
    ? '名称不能为空。'
    : form.purpose.trim() === ''
      ? '职业定位（purpose）不能为空。'
      : form.responsibilities.filter((line) => line.trim().length > 0).length === 0
        ? '至少保留一条职责条目。'
        : form.responsibilities.filter((line) => line.trim().length > 0).length > 12
          ? '职责条目最多 12 条。'
          : form.responsibilities.some((line) => line.trim().length > 200)
            ? '每条职责最多 200 字。'
          : form.maxRuntimeMinutes !== undefined && (!Number.isInteger(form.maxRuntimeMinutes) || form.maxRuntimeMinutes < 1 || form.maxRuntimeMinutes > 1440)
            ? '单步最长运行必须是 1–1440 的整数分钟。'
            : undefined;
  const saveDisabledReason = locked
    ? '保存结果未明或已受理，内容已锁定；先按原请求号核对。'
    : actionBusy
      ? '正在处理上一个请求。'
      : commandBlockedReason
        ?? (dirty ? invalidReason : '没有未保存的修改。');
  const publishDisabledReason = locked
    ? '保存/发布结果未明，内容已锁定；先按原请求号核对。'
    : actionBusy
      ? '正在处理上一个请求。'
      : commandBlockedReason !== undefined
        ? commandBlockedReason
        : dirty
          ? '先保存草稿再发布。'
          : selected === undefined || !selected.hasDraft
            ? '没有待发布的草稿；先保存草稿。'
            : invalidReason;

  const updateForm = (next: RoleForm) => {
    setForm(next);
    setFailure(undefined);
  };

  const openNewRole = () => {
    if (readOnly) return;
    if (pendingCommand) {
      setFailure('还有一项命令参数修改没有应用；先应用或放弃后再新建职业。');
      setTab('perms');
      return;
    }
    if (dirty) {
      setFailure('当前职业有未保存修改；先保存或放弃后再新建职业。');
      return;
    }
    setFailure(undefined);
    setNewRole({ name: '', purpose: '', responsibilities: '' });
  };

  const requestSelect = (roleId: string) => {
    if (selected?.id === roleId || readOnly) return;
    if (pendingCommand) {
      setSwitchPrompt({ targetId: roleId, kind: 'command' });
      return;
    }
    if (dirty) {
      setSwitchPrompt({ targetId: roleId, kind: 'dirty' });
      return;
    }
    setReceiptState(undefined);
    setFailure(undefined);
    setSelectedId(roleId);
  };

  const discardAndSwitch = () => {
    if (switchPrompt === null) return;
    setCommandEditor(null);
    setSwitchPrompt(null);
    setReceiptState(undefined);
    setFailure(undefined);
    setSelectedId(switchPrompt.targetId);
  };

  const openCommandEditor = (index: number | null) => {
    const current = form?.resourcePermissions.commands ?? [];
    const existing = index === null ? undefined : current[index];
    setCommandEditor({
      index,
      argv: existing === undefined ? [''] : [...existing.argv],
      workspace: existing?.workspace ?? '',
    });
    setTab('perms');
  };

  const applyCommand = () => {
    if (form === null || commandEditor === null) return;
    const command: RoleResourceCommand = {
      kind: 'argv',
      argv: [...commandEditor.argv],
      ...(commandEditor.workspace.trim() === '' ? {} : { workspace: commandEditor.workspace.trim() }),
    };
    const commands = [...form.resourcePermissions.commands];
    if (commandEditor.index === null) commands.push(command);
    else commands[commandEditor.index] = command;
    updateForm({ ...form, resourcePermissions: { ...form.resourcePermissions, commands } });
    setCommandEditor(null);
  };

  const removeTool = (index: number) => {
    if (form === null) return;
    const tools = form.resourcePermissions.tools.filter((_, position) => position !== index);
    updateForm({ ...form, resourcePermissions: { ...form.resourcePermissions, tools } });
  };
  const removeFile = (index: number) => {
    if (form === null) return;
    const files = form.resourcePermissions.files.filter((_, position) => position !== index);
    updateForm({ ...form, resourcePermissions: { ...form.resourcePermissions, files } });
  };
  const removeCommand = (index: number) => {
    if (form === null) return;
    const commands = form.resourcePermissions.commands.filter((_, position) => position !== index);
    updateForm({ ...form, resourcePermissions: { ...form.resourcePermissions, commands } });
  };
  const removeResource = (index: number) => {
    if (form === null) return;
    const resources = form.resourcePermissions.resources.filter((_, position) => position !== index);
    updateForm({ ...form, resourcePermissions: { ...form.resourcePermissions, resources } });
  };

  const addTool = (tool: RoleResourceTool) => {
    if (form === null) return;
    updateForm({ ...form, resourcePermissions: { ...form.resourcePermissions, tools: [...form.resourcePermissions.tools, tool] } });
    setAddDialog(null);
  };
  const addFile = (file: RoleResourceFile) => {
    if (form === null) return;
    updateForm({ ...form, resourcePermissions: { ...form.resourcePermissions, files: [...form.resourcePermissions.files, file] } });
    setAddDialog(null);
  };
  const addResource = (resource: RoleResourceCapability) => {
    if (form === null) return;
    updateForm({ ...form, resourcePermissions: { ...form.resourcePermissions, resources: [...form.resourcePermissions.resources, resource] } });
    setAddDialog(null);
  };

  const openHistory = async () => {
    if (selected === undefined) return;
    setHistoryOpen(true);
    setHistory(null);
    setHistoryError(undefined);
    try {
      const response = await apiGet<RoleHistoryResponse>(ROUTES.catalogRoleHistory(selected.id));
      setHistory(response.data);
    } catch (error) {
      setHistoryError(errorMessage(error));
    }
  };

  const checkAndPublish = async () => {
    if (selected === undefined || form === null) return;
    if (pendingCommand) { setFailure('先应用或放弃命令参数修改，再检查发布。'); setTab('perms'); return; }
    if (dirty) { setFailure('先保存草稿，再检查发布。'); return; }
    if (!selected.hasDraft) { setFailure('没有待发布的草稿；先保存草稿。'); return; }
    setFailure(undefined);
    setReceiptState(undefined);
    setChecking(true);
    try {
      const validationResponse = await apiPost<RoleValidateResponse>(ROUTES.catalogRoleValidate(selected.id), {});
      let previous: RoleRevisionSnapshot | undefined;
      let historyNote: string | undefined;
      try {
        const historyResponse = await apiGet<RoleHistoryResponse>(ROUTES.catalogRoleHistory(selected.id));
        setHistory(historyResponse.data);
        previous = historyResponse.data.history[0];
      } catch {
        historyNote = '发布历史读取失败；尝试使用当前已发布内容作为上一修订比对。';
      }
      if (previous === undefined && selected.status === 'published') {
        previous = snapshotFromEntry(selected);
        historyNote = historyNote ?? '发布历史没有返回快照；使用当前已发布内容作为上一修订比对。';
      }
      if (previous === undefined) historyNote = historyNote ?? '这个职业还没有发布记录；本次是首次发布，没有上一修订可比。';
      const compared = previous === undefined ? { diff: [] as readonly string[], ...(historyNote === undefined ? {} : { note: historyNote }) } : compareDrafts(form, previous);
      setPublishReview({
        validation: validationResponse.data,
        diff: compared.diff,
        ...(compared.note === undefined ? {} : { historyNote: compared.note }),
        ...(previous === undefined ? {} : { previous }),
      });
      setPublishOpen(true);
    } catch (error) {
      setFailure(isServiceUnavailable(error) ? '服务未连接，无法检查发布。' : errorMessage(error));
    } finally {
      setChecking(false);
    }
  };

  const newRoleLines = newRole === null ? 0 : newRole.responsibilities.split(/\n+/).map((line) => line.trim()).filter((line) => line.length > 0).length;
  const newRoleInvalidReason = newRole === null
    ? '没有草稿内容。'
    : newRole.name.trim() === ''
      ? '名称不能为空。'
      : newRole.purpose.trim() === ''
        ? '职业定位不能为空。'
        : newRoleLines === 0
          ? '至少填写一条职责。'
          : newRoleLines > 12
            ? '职责条目最多 12 条。'
            : newRole.responsibilities.split(/\n+/).some((line) => line.trim().length > 200)
              ? '每条职责最多 200 字。'
            : undefined;
  const rolesCount = roles.length;
  const bootstrapLoading = bootstrap.isLoading || catalogQuery.isLoading;
  const showEmpty = !bootstrapLoading && roles.length === 0;
  const filteredEmpty = !bootstrapLoading && roles.length > 0 && filtered.length === 0;
  const displayName = selected === undefined ? '' : (form?.name ?? selected.draft?.name ?? selected.name);
  const displayImage = selected === undefined
    ? undefined
    : form !== null ? (form.image ?? undefined) : (selected.draft?.image ?? selected.image);
  const publishedLabel = selected === undefined
    ? ''
    : selected.status === 'published' ? `已发布修订 ${selected.revision}` : '未发布';
  const draftLabel = selected === undefined
    ? ''
    : dirty ? '有未保存修改' : selected.hasDraft ? '草稿待发布' : '没有草稿';

  const renderOverview = (): ReactNode => {
    if (selected === undefined || form === null) return null;
    return (
      <div className="role-overview">
        <div>
          <div className="role-grid-2">
            <div className="role-field">
              <label className="label" htmlFor="role-name">职业名称</label>
              <input
                id="role-name"
                className="input"
                value={form.name}
                maxLength={60}
                disabled={readOnly}
                onChange={(event) => { updateForm({ ...form, name: event.target.value }); }}
              />
            </div>
            <div className="role-field">
              <label className="label" htmlFor="role-id">标识</label>
              <input id="role-id" className="input mono" value={selected.id} readOnly />
              <span className="hint">保存后不可修改；新职业由服务生成。</span>
            </div>
          </div>
          <div className="role-field">
            <label className="label" htmlFor="role-purpose">职业定位（purpose）</label>
            <textarea
              id="role-purpose"
              className="textarea"
              rows={2}
              value={form.purpose}
              maxLength={1000}
              disabled={readOnly}
              onChange={(event) => { updateForm({ ...form, purpose: event.target.value }); }}
            />
          </div>
          <div className="role-field">
            <label className="label" htmlFor="role-responsibilities">职责条目</label>
            <textarea
              id="role-responsibilities"
              className="textarea"
              rows={4}
              value={form.responsibilities.join('\n')}
              disabled={readOnly}
              onChange={(event) => { updateForm({ ...form, responsibilities: event.target.value.split('\n') }); }}
            />
            <span className="hint">每行一条，1–12 条；用于流程目录中的职业职责摘要。</span>
          </div>
          <div className="role-field">
            <label className="label" htmlFor="role-instructions">职责与基本指令</label>
            <textarea
              id="role-instructions"
              className="textarea"
              rows={10}
              maxLength={20000}
              value={form.instructions}
              disabled={readOnly}
              onChange={(event) => { updateForm({ ...form, instructions: event.target.value }); }}
            />
            <span className="hint">所有使用这个职业的步骤都会带上这段指令；具体任务说明在流程画布里写。</span>
          </div>
          <div className="role-grid-2" style={{ marginTop: 16 }}>
            <div className="role-field" style={{ marginTop: 0 }}>
              <label className="label" htmlFor="role-model">模型</label>
              <select
                id="role-model"
                className="select"
                value={form.model}
                disabled={readOnly}
                onChange={(event) => { updateForm({ ...form, model: event.target.value }); }}
              >
                <option value="">沿用当前/默认</option>
                {modelProfiles.filter((profile) => profile.enabled).map((profile) => (
                  <option key={profile.id} value={profile.model}>{profile.label} · {profile.provider}</option>
                ))}
                {form.model !== '' && !modelProfiles.some((profile) => profile.model === form.model) ? (
                  <option value={form.model}>{form.model}</option>
                ) : null}
              </select>
              <span className="hint">服务字段未传时沿用上一草稿/已发布/默认；本页不提供显式清除模型覆盖。</span>
            </div>
            <div className="role-field" style={{ marginTop: 0 }}>
              <label className="label" htmlFor="role-runtime">单步最长运行（分钟）</label>
              <input
                id="role-runtime"
                className="input"
                type="number"
                min={1}
                max={1440}
                value={form.maxRuntimeMinutes ?? ''}
                placeholder="沿用当前/默认"
                disabled={readOnly}
                onChange={(event) => {
                  const value = event.target.value;
                  updateForm({ ...form, maxRuntimeMinutes: value === '' ? undefined : Number(value) });
                }}
              />
              <span className="hint">1–1440 分钟；留空时服务沿用上一草稿/已发布/默认，不能显式清除已有覆盖。服务端会再次校验。</span>
            </div>
          </div>
        </div>
        <aside className="role-aside">
          <section className="card pad">
            <div className="eyebrow" style={{ marginBottom: 8 }}>使用情况</div>
            {planningMethods.length === 0 ? (
              <p className="hint">当前目录中没有流程把它指定为规划职责。</p>
            ) : (
              <div className="col" style={{ gap: 6 }}>
                {planningMethods.map((method) => (
                  <div key={method.id} className="row" style={{ gap: 8 }}>
                    <Icon name="flow" size="sm" />
                    <span className="grow" style={{ fontSize: 13 }}>{method.name}</span>
                    <span className="hint mono">{method.revision}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="hint" style={{ marginTop: 8 }}>
              服务只返回流程的规划职责引用；步骤级使用统计没有 DTO，本页不补造。
            </p>
          </section>
          <section className="card pad">
            <div className="eyebrow" style={{ marginBottom: 8 }}>版本</div>
            <div className="col" style={{ gap: 8, fontSize: 13 }}>
              <span className="row between"><span>当前发布</span><span className={`badge ${selected.status === 'published' ? 'st-ok' : 'st-idle'}`}>{selected.status === 'published' ? selected.revision : '未发布'}</span></span>
              <span className="row between"><span>提示词修订</span><span className="hint mono">{selected.promptRevision}</span></span>
              <span className="row between"><span>草稿</span><span className={`badge ${dirty ? 'st-wait' : selected.hasDraft ? 'st-wait' : 'st-idle'}`}>{dirty ? '有未保存修改' : selected.hasDraft ? '待发布' : '没有草稿'}</span></span>
            </div>
            <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
              <Button variant="ghost" size="sm" icon="archive" disabled={readOnly} onClick={() => { void openHistory(); }}>
                发布历史
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon="trash"
                disabled={readOnly || dirty || pendingCommand}
                disabledReason={readOnly ? '结果未明或正在处理，暂不能归档。' : dirty ? '先保存或放弃当前修改。' : pendingCommand ? '先应用或放弃命令参数修改。' : undefined}
                onClick={() => { if (selected !== undefined) { setFailure(undefined); setReceiptState(undefined); archiveMutation.mutate(selected.id); } }}
              >
                {selected.baseId === undefined && selected.status === 'draft' ? '删除草稿' : '归档/还原'}
              </Button>
            </div>
            <p className="hint" style={{ marginTop: 8 }}>
              发布后新修订立即生效；已冻结任务继续使用创建时的职业修订。
            </p>
          </section>
        </aside>
      </div>
    );
  };

  const renderCaps = (): ReactNode => {
    if (form === null) return null;
    const enabled = countEnabled(form.capabilityGroups);
    return (
      <div>
        <div className="banner info">
          <Icon name="info" />
          <div className="grow">
            能力范围决定这个职业<b>可以参与</b>哪些事；具体能用哪些工具、文件和命令，在「资源权限」里逐项设定。修改其中一项不会自动改变另一项。
          </div>
        </div>
        <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
          <Badge tone="accent" icon="check">已启用 {String(enabled)} 项</Badge>
          <span className="hint">能力项目录由服务返回；勾选只修改当前草稿，保存后才会持久化。</span>
        </div>
        {form.capabilityGroups.length === 0 ? (
          <EmptyState icon="layers" title="服务没有返回能力目录" description="保存草稿后服务会返回默认能力分组；本页不会补造能力项。" />
        ) : (
          <div className="cap-grid">
            {form.capabilityGroups.map((group) => (
              <section key={group.id} className="card cap-card">
                <h4><Icon name={group.id === 'knowledge' ? 'book' : group.id === 'data' ? 'db' : group.id === 'tasks' ? 'list' : 'tool'} size="sm" />{group.label}</h4>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="cap-toggle"
                    aria-pressed={item.enabled}
                    disabled={readOnly}
                    title={readOnly ? '结果未明或正在处理，暂不能修改能力范围。' : undefined}
                    onClick={() => {
                      const capabilityGroups = form.capabilityGroups.map((current) => current.id !== group.id
                        ? current
                        : { ...current, items: current.items.map((entry) => entry.id === item.id ? { ...entry, enabled: !entry.enabled } : entry) });
                      updateForm({ ...form, capabilityGroups });
                    }}
                  >
                    {item.enabled ? <Icon name="check" size="sm" /> : null}
                    {item.label}
                  </button>
                ))}
                {group.items.length === 0 ? <p className="hint">服务没有返回此类能力项。</p> : null}
              </section>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderPerms = (): ReactNode => {
    if (form === null) return null;
    const permissions = form.resourcePermissions;
    const commandEditRow = (index: number | null) => {
      if (commandEditor === null || commandEditor.index !== index) return null;
      return (
        <div className="cmd-edit">
          <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
            <span className="label grow">编辑命令 · 每个参数单独一格，不按空格拆分</span>
            {commandEditor.workspace === '' ? null : <span className="hint mono">工作区：{commandEditor.workspace}</span>}
          </div>
          <div className="col" style={{ gap: 6 }}>
            {commandEditor.argv.map((argument, position) => (
              <div key={position} className="cmd-token">
                <span className="n">{String(position)}</span>
                <input
                  className="input mono grow"
                  value={argument}
                  disabled={readOnly}
                  placeholder="空参数（保留）"
                  aria-label={`命令参数 ${String(position)}`}
                  onChange={(event) => {
                    const argv = [...commandEditor.argv];
                    argv[position] = event.target.value;
                    setCommandEditor({ ...commandEditor, argv });
                  }}
                />
                <IconButton
                  icon="x"
                  label={`删除参数 ${String(position)}`}
                  disabled={readOnly}
                  onClick={() => {
                    const argv = commandEditor.argv.filter((_, positionToKeep) => positionToKeep !== position);
                    setCommandEditor({ ...commandEditor, argv });
                  }}
                />
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              icon="plus"
              disabled={readOnly || commandEditor.argv.length >= 32}
              disabledReason={commandEditor.argv.length >= 32 ? '命令参数最多 32 个。' : undefined}
              onClick={() => { setCommandEditor({ ...commandEditor, argv: [...commandEditor.argv, ''] }); }}
            >
              添加参数
            </Button>
          </div>
          <div className="role-field" style={{ marginTop: 10 }}>
            <label className="label" htmlFor="command-workspace">工作区（可选）</label>
            <input
              id="command-workspace"
              className="input mono"
              value={commandEditor.workspace}
              disabled={readOnly}
              placeholder="留空表示不限定；不是绝对路径"
              onChange={(event) => { setCommandEditor({ ...commandEditor, workspace: event.target.value }); }}
            />
          </div>
          <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
            <span className="hint grow">只修改职业草稿，不授予实际运行权限；应用后仍需保存草稿。</span>
            <Button variant="ghost" size="sm" onClick={() => { setCommandEditor(null); }}>放弃这项修改</Button>
            <Button
              variant="primary"
              size="sm"
              icon="check"
              disabled={commandEditor.argv.length === 0 || readOnly}
              disabledReason={commandEditor.argv.length === 0 ? '命令至少需要一个参数。' : undefined}
              onClick={applyCommand}
            >
              应用
            </Button>
          </div>
        </div>
      );
    };

    const section = (title: string, icon: 'tool' | 'file' | 'terminal' | 'layers', count: number, body: ReactNode, add?: ReactNode) => (
      <section className="card perm-section">
        <div className="perm-head">
          <Icon name={icon} size="sm" />
          <h4 className="grow">{title} <span className="hint num">{String(count)}</span></h4>
          {add}
        </div>
        {body}
      </section>
    );

    return (
      <div>
        <section className="card pad">
          <div className="row wrap" style={{ gap: 12 }}>
            <span className="section-title grow">这里设的是权限上限</span>
            <div className="perm-formula">
              <span className="me">职业上限</span>∩<span>项目</span>∩<span>运行环境</span>∩<span>冻结范围</span>= 实际可用
            </div>
          </div>
          <p className="hint" style={{ marginTop: 6 }}>
            运行时会取这几层的交集。在这里添加一项，不等于任务马上就能用它；命令参数逐项保留，空字符串是真实的空参数。
          </p>
        </section>

        {section('工具', 'tool', permissions.tools.length, permissions.tools.length === 0 ? <div className="perm-row"><span className="hint">没有声明工具；空清单不表示不受限制。</span></div> : (
          <>
            {permissions.tools.map((tool, index) => (
              <div className="perm-row" key={`${tool.kind}:${tool.name}:${String(index)}`}>
                <span className="perm-kind">{tool.kind.toUpperCase()}</span>
                <div style={{ minWidth: 0 }}>
                  <span className="mono" style={{ fontSize: 13 }}>{tool.name}</span>
                  {tool.source === undefined ? null : <span className="hint"> · 来自 {tool.source}</span>}
                </div>
                <div className="perm-actions">
                  <IconButton icon="trash" label={`移除工具 ${tool.name}`} disabled={readOnly} onClick={() => { removeTool(index); }} />
                </div>
              </div>
            ))}
          </>
        ), (
          <Button variant="ghost" size="sm" icon="plus" disabled={readOnly} onClick={() => { setAddDialog('tools'); }}>添加</Button>
        ))}

        {section('文件', 'file', permissions.files.length, permissions.files.length === 0 ? <div className="perm-row"><span className="hint">没有声明文件；空清单不表示不受限制。</span></div> : (
          <>
            {permissions.files.map((file, index) => (
              <div className="perm-row" key={`${file.kind}:${file.path}:${String(index)}`}>
                <span className="perm-kind">{file.kind.toUpperCase()}</span>
                <div style={{ minWidth: 0 }}>
                  <span className="mono" style={{ fontSize: 13 }}>{file.path}</span>
                  {file.workspace === undefined ? null : <span className="hint"> · {file.workspace}</span>}
                </div>
                <div className="perm-actions">
                  <IconButton icon="trash" label={`移除文件 ${file.path}`} disabled={readOnly} onClick={() => { removeFile(index); }} />
                </div>
              </div>
            ))}
          </>
        ), (
          <Button variant="ghost" size="sm" icon="plus" disabled={readOnly} onClick={() => { setAddDialog('files'); }}>添加</Button>
        ))}

        {section('命令', 'terminal', permissions.commands.length, (
          <>
            {permissions.commands.map((command, index) => (
              <Fragment key={`${command.argv.join('\u0000')}:${String(index)}`}>
                <div className="perm-row" style={commandEditor?.index === index ? { background: 'var(--accent-fill)' } : undefined}>
                  <span className="perm-kind">ARGV</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="perm-argv">
                      {command.argv.length === 0 ? <span className="perm-arg empty">空命令</span> : command.argv.map((argument, argumentIndex) => (
                        <span key={argumentIndex} className={`perm-arg${argument === '' ? ' empty' : ''}`}>
                          {argument === '' ? '空参数' : argument}
                        </span>
                      ))}
                    </div>
                    {command.workspace === undefined ? null : <div className="hint" style={{ marginTop: 4 }}>{command.workspace}</div>}
                    {commandEditor?.index === index ? <Badge tone="accent">编辑中</Badge> : null}
                  </div>
                  <div className="perm-actions">
                    <IconButton icon="edit" label="编辑命令参数" disabled={readOnly || commandEditor !== null} disabledReason={commandEditor !== null ? '先应用或放弃当前命令修改。' : undefined} onClick={() => { openCommandEditor(index); }} />
                    <IconButton icon="trash" label="移除命令" disabled={readOnly || commandEditor !== null} disabledReason={commandEditor !== null ? '先应用或放弃当前命令修改。' : undefined} onClick={() => { removeCommand(index); }} />
                  </div>
                </div>
                {commandEditRow(index)}
              </Fragment>
            ))}
            {commandEditor?.index === null ? commandEditRow(null) : null}
            {permissions.commands.length === 0 && commandEditor?.index !== null ? <div className="perm-row"><span className="hint">没有声明命令；空清单不表示不受限制。</span></div> : null}
          </>
        ), (
          <Button variant="ghost" size="sm" icon="plus" disabled={readOnly || commandEditor !== null} disabledReason={commandEditor !== null ? '先应用或放弃当前命令修改。' : undefined} onClick={() => { openCommandEditor(null); }}>添加</Button>
        ))}

        {section('资源能力', 'layers', permissions.resources.length, permissions.resources.length === 0 ? <div className="perm-row"><span className="hint">没有声明资源能力；空清单不表示不受限制。</span></div> : (
          <>
            {permissions.resources.map((resource, index) => (
              <div className="perm-row" key={`${resource.id}:${String(index)}`}>
                <span className="perm-kind">CAP</span>
                <div style={{ minWidth: 0 }}>
                  <span className="mono" style={{ fontSize: 13 }}>{resource.id}</span>
                  <span className="hint"> · {resource.label}</span>
                </div>
                <div className="perm-actions">
                  <IconButton icon="trash" label={`移除资源 ${resource.id}`} disabled={readOnly} onClick={() => { removeResource(index); }} />
                </div>
              </div>
            ))}
          </>
        ), (
          <Button
            variant="ghost"
            size="sm"
            icon="plus"
            disabled={readOnly || form.capabilityGroups.every((group) => group.items.length === 0)}
            disabledReason={form.capabilityGroups.every((group) => group.items.length === 0) ? '服务未返回可添加的资源能力项。' : undefined}
            onClick={() => { setAddDialog('resources'); }}
          >
            添加
          </Button>
        ))}
        <p className="hint" style={{ marginTop: 10 }}>
          资源权限保存的是上限声明；不会立即改变运行中的任务或工具发现结果。删除/添加后先保存草稿才会持久化。
        </p>
        <div className="banner info" style={{ marginTop: 12 }}>
          <Icon name="info" />
          <div className="grow">
            <b>已发布版本权限预估：服务未提供。</b>
            <br />
            当前契约没有已发布修订的 preview/slots DTO；本页只展示和编辑草稿上限，不伪造“实际可用”的预估结果。
          </div>
        </div>
      </div>
    );
  };

  const renderLook = (): ReactNode => {
    if (selected === undefined || form === null) return null;
    const historyEntries = selected.imageHistory ?? [];
    return (
      <div>
        <div className="banner info">
          <Icon name="info" />
          <div className="grow">
            形象只影响显示。已经冻结的任务显示它当时记录的形象；没有记录时显示占位，不用当前形象替代。
          </div>
        </div>
        <div className="look-grid">
          <section className="card look-card">
            <RoleAvatar image={form.image ?? undefined} name={form.name} large />
            <div style={{ fontSize: 13.5, fontWeight: 500 }}>当前绑定</div>
            <div className="hint">{form.image == null ? '未绑定 · 显示名称首字占位' : `${form.image.kind === 'emoji' ? '表情' : '首字母'} · ${form.image.label ?? form.image.value}`}</div>
            {form.image == null ? null : (
              <Button variant="ghost" size="sm" icon="trash" disabled={readOnly} onClick={() => { updateForm({ ...form, image: null }); }}>
                清除绑定
              </Button>
            )}
          </section>
          {historyEntries.length === 0 ? (
            <section className="card look-card">
              <RoleAvatar name="?" large />
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>没有历史形象记录</div>
              <div className="hint">服务未返回历史形象；冻结任务显示占位，不回填当前形象。</div>
            </section>
          ) : historyEntries.map((entry) => (
            <section key={`${entry.revision}:${entry.image?.id ?? 'placeholder'}`} className="card look-card">
              <RoleAvatar image={entry.image} name={entry.revision} large />
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>修订 {entry.revision}</div>
              <div className="hint">
                {entry.image === undefined ? '未记录 · 显示占位' : (entry.publishedAt === undefined ? '历史记录' : new Date(entry.publishedAt).toLocaleString('zh-CN'))}
              </div>
            </section>
          ))}
        </div>
        <p className="hint" style={{ marginTop: 12 }}>
          服务未提供可选形象目录或独立绑定接口；本页只展示当前绑定与历史记录，不伪造“设为当前形象”的候选。清除绑定需保存草稿后生效。
        </p>
      </div>
    );
  };

  const content = tab === 'overview' ? renderOverview() : tab === 'caps' ? renderCaps() : tab === 'perms' ? renderPerms() : renderLook();

  let pageBody: ReactNode;
  if (bootstrapLoading) {
    pageBody = (
      <div className="card" style={{ padding: 16 }}>
        {[0, 1, 2].map((index) => (
          <div key={index} className="row" style={{ padding: '12px 0', gap: 12 }}>
            <Skeleton width={36} height={36} radius={10} />
            <div className="col grow" style={{ gap: 6 }}>
              <Skeleton width="34%" height={13} />
              <Skeleton width="58%" height={11} />
            </div>
          </div>
        ))}
      </div>
    );
  } else if (bootstrap.isError && catalogQuery.data === undefined) {
    pageBody = <ServiceNotice error={bootstrap.error} onRetry={() => { void bootstrap.refetch(); }} />;
  } else if (catalogQuery.isError && roles.length === 0) {
    pageBody = <ServiceNotice error={catalogQuery.error} title="角色目录读取失败" onRetry={() => { void catalogQuery.refetch(); }} />;
  } else if (showEmpty) {
    pageBody = <EmptyState icon="users" title="目录里还没有角色" description="服务已连接，但 catalog.roles 为空；角色由共享契约配置，本页不新增内置角色。" />;
  } else if (filteredEmpty) {
    pageBody = <EmptyState icon="search" title="没有匹配的角色" description="换个关键词，或清空搜索。" />;
  } else if (selected === undefined || form === null) {
    pageBody = <Skeleton height={420} radius={16} />;
  } else {
    pageBody = (
      <div className="roles-split">
        <aside className="card roles-list" aria-label="职业目录">
          <div className="role-field" style={{ marginTop: 0 }}>
            <div className="input-wrap">
              <Icon name="search" size="sm" />
              <input
                className="input ctl"
                placeholder="搜索职业名称、职责或标识"
                aria-label="搜索职业"
                value={keyword}
                onChange={(event) => { setKeyword(event.target.value); }}
              />
            </div>
          </div>
          <div className="list" style={{ marginTop: 6 }}>
            {filtered.map((role) => {
              const roleImage = role.draft !== undefined ? role.draft.image : role.image;
              const roleName = role.draft?.name ?? role.name;
              const active = role.id === selected.id;
              return (
                <button
                  key={role.id}
                  type="button"
                  className="role-row"
                  aria-current={active}
                  disabled={readOnly}
                  title={readOnly ? '结果未明或正在处理，暂不能切换职业。' : undefined}
                  onClick={() => { requestSelect(role.id); }}
                >
                  <RoleAvatar image={roleImage} name={roleName} />
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="role-row-title">{roleName}</span>
                    <span className="role-row-meta">
                      {role.status === 'published' ? `已发布修订 ${role.revision}` : '未发布'}
                    </span>
                    <span className="role-row-meta">
                      {active && dirty ? '有未保存修改' : role.hasDraft ? '草稿待发布' : '与发布一致'}
                    </span>
                  </span>
                  {active ? <Icon name="chevRight" size="sm" /> : null}
                </button>
              );
            })}
          </div>
          <p className="hint" style={{ padding: '10px 10px 8px', lineHeight: 1.6 }}>
            草稿保存在服务端，发布后立即生效；已冻结任务使用创建时的修订。
          </p>
        </aside>

        <div className="col" style={{ gap: 12 }}>
          <section className="card solid">
            <div className="role-head">
              <RoleAvatar image={displayImage} name={displayName} large />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
                  <h2>{displayName}</h2>
                  {selected.status === 'published' ? <Badge tone="ok" icon="check">{publishedLabel}</Badge> : <Badge tone="idle">{publishedLabel}</Badge>}
                  {selected.hasDraft || dirty ? <Badge tone={dirty ? 'warn' : 'wait'} icon={dirty ? 'edit' : 'clock'}>{draftLabel}</Badge> : null}
                  {pendingCommand ? <Badge tone="warn" icon="alert">有未应用修改</Badge> : null}
                </div>
                <div className="hint" style={{ marginTop: 6 }}>
                  {form.purpose}
                </div>
                <div className="hint" style={{ marginTop: 4 }}>
                  {planningMethods.length === 0 ? '暂未被流程指定为规划职责。' : `被 ${String(planningMethods.length)} 个流程指定为规划职责。`}
                  {' '}步骤级使用统计服务未提供。
                </div>
              </div>
              <div className="role-head-actions">
                <Button
                  variant="secondary"
                  icon="check"
                  disabled={saveDisabledReason !== undefined}
                  disabledReason={saveDisabledReason}
                  onClick={() => { setFailure(undefined); setReceiptState(undefined); saveMutation.mutate(); }}
                >
                  {saveMutation.isPending ? '保存中…' : '保存草稿'}
                </Button>
                <Button
                  variant="primary"
                  icon="upload"
                  disabled={publishDisabledReason !== undefined}
                  disabledReason={publishDisabledReason}
                  onClick={() => { void checkAndPublish(); }}
                >
                  {checking ? '检查中…' : '检查并发布'}
                </Button>
              </div>
            </div>
          </section>

          {receiptState === undefined ? null : (
            <ReceiptNotice
              receipt={receiptState.receipt}
              successMessage={receiptState.kind === 'save' ? '草稿已保存。' : receiptState.kind === 'publish' ? '已发布，目录已刷新。' : receiptState.kind === 'restore' ? '已恢复为草稿。' : receiptState.kind === 'archive' ? '目录已更新。' : '职业已创建。'}
            />
          )}
          {failure === undefined ? null : (
            <div className="banner danger role-banner" role="alert">
              <Icon name="alert" />
              <div className="grow">{failure}</div>
            </div>
          )}
          {pendingCommand ? (
            <div className="banner warn role-banner">
              <Icon name="alert" />
              <div className="grow">
                <b>还有一项命令参数修改没有应用。</b>
                <br />
                应用或放弃这项修改后，才能保存、发布或切换职业。
              </div>
              <div className="actions">
                <Button variant="secondary" size="sm" onClick={() => { setTab('perms'); }}>回到这项修改</Button>
              </div>
            </div>
          ) : null}
          {locked ? (
            <div className="banner unknown role-banner" role="alert">
              <Icon name="help" />
              <div className="grow">
                <b>原操作未核对，编辑、发布和切换已锁定。</b>
                <br />
                只按原请求号核对；核对清楚前不会重新保存或发布。
              </div>
            </div>
          ) : null}

          <section className="card solid">
            <div className="tabs role-tabs" role="tablist" aria-label="角色详情页签">
              {[
                ['overview', '职责与指令'],
                ['caps', '能力范围'],
                ['perms', '资源权限'],
                ['look', '形象'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className="tab"
                  role="tab"
                  aria-selected={tab === value}
                  disabled={locked}
                  title={locked ? '原操作未核对，页签已锁定。' : undefined}
                  onClick={() => { setTab(value as RoleTab); }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="role-content">
              {content}
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="page wide">
      <PageHeader
        title="角色管理"
        lede="职业定义职责、指令、能力范围与资源权限上限；草稿保存、发布、历史与恢复都由服务端执行。未提供的字段会明确降级，不伪造。"
        actions={
          <div className="row wrap" style={{ gap: 8 }}>
            <LinkButton to="/roles/legacy" variant="ghost" size="sm" icon="archive">
              历史配置
            </LinkButton>
            <Button
              variant="secondary"
              size="sm"
              icon="plus"
              disabled={readOnly || pendingCommand !== null || dirty}
              disabledReason={locked ? '原操作未核对。' : actionBusy ? '正在处理上一个请求。' : pendingCommand ? '先应用或放弃命令参数修改。' : dirty ? '先保存或放弃当前修改。' : undefined}
              onClick={openNewRole}
            >
              新建职业
            </Button>
          </div>
        }
      />

      {catalogQuery.isError && roles.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <ServiceNotice error={catalogQuery.error} title="角色目录刷新失败，显示 bootstrap 快照" onRetry={() => { void catalogQuery.refetch(); }} />
        </div>
      ) : null}
      <div className="toolbar">
        <span className="hint">共 {String(rolesCount)} 个职业 · 目录与草稿均来自服务端</span>
        <span className="spacer" />
        <span className="hint">{selectedIndex < 0 ? '当前项不在筛选结果' : `第 ${String(selectedIndex + 1)} / ${String(filtered.length)} 个`}</span>
      </div>
      {pageBody}

      <Modal
        open={newRole !== null}
        title="新建职业"
        onClose={() => { setNewRole(null); }}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setNewRole(null); }}>取消</Button>
            <span className="spacer" />
            <Button
              variant="primary"
              icon="check"
              disabled={newRoleMutation.isPending || newRoleInvalidReason !== undefined || locked}
              disabledReason={newRoleMutation.isPending ? '正在创建…' : locked ? '原操作未核对。' : newRoleInvalidReason}
              onClick={() => { if (newRole !== null) { setFailure(undefined); setReceiptState(undefined); newRoleMutation.mutate(newRole); } }}
            >
              {newRoleMutation.isPending ? '创建中…' : '创建草稿'}
            </Button>
          </>
        }
      >
        {newRole === null ? null : (
          <div className="stack-loose">
            {failure === undefined ? null : <div className="banner danger"><Icon name="alert" /><div className="grow">{failure}</div></div>}
            <label className="form-label">名称
              <input className="input" value={newRole.name} maxLength={60} onChange={(event) => { setNewRole({ ...newRole, name: event.target.value }); }} />
            </label>
            <label className="form-label">职业定位
              <textarea className="textarea" value={newRole.purpose} maxLength={1000} onChange={(event) => { setNewRole({ ...newRole, purpose: event.target.value }); }} />
            </label>
            <label className="form-label">职责条目（每行一条，1–12 条）
              <textarea className="textarea" value={newRole.responsibilities} onChange={(event) => { setNewRole({ ...newRole, responsibilities: event.target.value }); }} />
            </label>
            <p className="hint">创建后服务会返回完整草稿与默认能力/权限字段，再在四个页签继续编辑。已冻结任务不受影响。</p>
          </div>
        )}
      </Modal>

      <Modal
        open={addDialog !== null}
        title={addDialog === 'tools' ? '添加工具权限' : addDialog === 'files' ? '添加文件权限' : '添加资源能力'}
        onClose={() => { setAddDialog(null); }}
        footer={<Button variant="ghost" onClick={() => { setAddDialog(null); }}>取消</Button>}
      >
        {addDialog === null || form === null ? null : addDialog === 'tools' ? (
          <AddToolForm onAdd={addTool} />
        ) : addDialog === 'files' ? (
          <AddFileForm onAdd={addFile} />
        ) : (
          <AddResourceForm form={form} onAdd={addResource} />
        )}
      </Modal>

      <Modal
        open={historyOpen}
        title="职业发布历史"
        className="role-history-dialog"
        onClose={() => { setHistoryOpen(false); }}
        footer={<Button variant="ghost" onClick={() => { setHistoryOpen(false); }}>关闭</Button>}
      >
        {historyError !== undefined ? <p className="hint" style={{ color: 'var(--danger)' }}>{historyError}</p> : history === null ? <p className="hint">正在读取发布历史…</p> : history.history.length === 0 ? <p className="hint">{selected?.status === 'published' ? `服务没有返回发布历史快照；当前已发布修订 ${selected.revision} 仍生效。历史可能从本服务之后的发布开始记录。` : '这个职业还没有发布记录；发布后才会产生修订快照。'}</p> : (
          <div className="col" style={{ gap: 12 }}>
            <p className="hint">每发布一次记录一个完整修订快照；最多保留 20 个，旧快照缺扩展字段时显示“未记录”。</p>
            {history.history.map((entry) => (
              <div key={entry.revision} className="card pad">
                <div className="row wrap" style={{ gap: 8 }}>
                  <Badge outline>{entry.revision}</Badge>
                  <span className="hint">{new Date(entry.publishedAt).toLocaleString('zh-CN')}</span>
                  <span className="spacer" />
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="refresh"
                    disabled={readOnly || dirty || pendingCommand}
                    disabledReason={readOnly ? '结果未明或正在处理。' : dirty ? '先保存或放弃当前修改。' : pendingCommand ? '先应用或放弃命令参数修改。' : undefined}
                    onClick={() => { setRestoreTarget(entry); }}
                  >
                    恢复为草稿
                  </Button>
                </div>
                <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
                  <Badge tone="idle">{entry.name}</Badge>
                  {entry.instructions === undefined ? <Badge tone="idle">指令未记录</Badge> : <Badge tone="ok">指令</Badge>}
                  {entry.capabilityGroups === undefined ? <Badge tone="idle">能力未记录</Badge> : <Badge tone="ok">能力 {String(countEnabled(entry.capabilityGroups))} 项</Badge>}
                  {entry.resourcePermissions === undefined ? <Badge tone="idle">资源权限未记录</Badge> : <Badge tone="ok">权限 {String(entry.resourcePermissions.tools.length + entry.resourcePermissions.files.length + entry.resourcePermissions.commands.length + entry.resourcePermissions.resources.length)} 项</Badge>}
                </div>
                <p className="hint" style={{ marginTop: 6 }}>{entry.purpose}</p>
                <div className="hint" style={{ marginTop: 4 }}>
                  {entry.responsibilities.map((item, index) => <div key={`${entry.revision}-${String(index)}`}>· {item}</div>)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal
        open={restoreTarget !== null}
        title="恢复为草稿？"
        onClose={() => { setRestoreTarget(null); }}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setRestoreTarget(null); }}>取消</Button>
            <span className="spacer" />
            <Button
              variant="primary"
              icon="refresh"
              disabled={restoreMutation.isPending || locked}
              disabledReason={restoreMutation.isPending ? '正在恢复…' : locked ? '原操作未核对。' : undefined}
              onClick={() => {
                if (restoreTarget !== null && selected !== undefined) {
                  setFailure(undefined);
                  setReceiptState(undefined);
                  restoreMutation.mutate({ roleId: selected.id, revision: restoreTarget.revision });
                }
              }}
            >
              {restoreMutation.isPending ? '恢复中…' : '恢复为草稿'}
            </Button>
          </>
        }
      >
        {failure === undefined ? null : <div className="banner danger" style={{ marginBottom: 10 }}><Icon name="alert" /><div className="grow">{failure}</div></div>}
        <p>将把修订 {restoreTarget?.revision ?? ''} 的完整快照恢复为当前草稿；已发布修订和已冻结任务不变。</p>
      </Modal>

      <Modal
        open={publishOpen && publishReview !== null}
        title="发布前检查"
        className="role-publish-dialog"
        onClose={() => { if (!publishMutation.isPending) setPublishOpen(false); }}
        footer={
          <>
            <Button variant="ghost" disabled={publishMutation.isPending} onClick={() => { setPublishOpen(false); }}>先不发布</Button>
            <span className="spacer" />
            <Button
              variant="primary"
              icon="upload"
              disabled={publishMutation.isPending || locked || publishReview?.validation.canPublish !== true}
              disabledReason={publishMutation.isPending ? '正在发布…' : locked ? '原操作未核对。' : publishReview?.validation.canPublish !== true ? '检查未通过，先修复错误项。' : undefined}
              onClick={() => { publishMutation.mutate(); }}
            >
              {publishMutation.isPending ? '发布中…' : `发布修订 ${publishReview?.validation.draftRevision ?? ''}`}
            </Button>
          </>
        }
      >
        {publishReview === null ? null : (
          <div className="col" style={{ gap: 14 }}>
            {failure === undefined ? null : <div className="banner danger"><Icon name="alert" /><div className="grow">{failure}</div></div>}
            <div className="row wrap" style={{ gap: 8 }}>
              <Badge tone="idle">草稿 {publishReview.validation.draftRevision}</Badge>
              {publishReview.validation.publishedRevision === undefined ? <Badge tone="idle">尚无发布修订</Badge> : <Badge tone="ok">上一发布 {publishReview.validation.publishedRevision}</Badge>}
              <Badge tone={publishReview.validation.canPublish ? 'ok' : 'danger'} icon={publishReview.validation.canPublish ? 'check' : 'x'}>
                {publishReview.validation.canPublish ? '检查通过' : '检查未通过'}
              </Badge>
            </div>
            {publishReview.validation.reason === undefined ? null : <p className="hint">{publishReview.validation.reason}</p>}
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>检查项</div>
              <div className="pub-checks">
                {publishReview.validation.checks.length === 0 ? <p className="hint">服务没有返回检查项。</p> : publishReview.validation.checks.map((check) => (
                  <div key={check.id} className="pub-check">
                    <Icon name={helpIcon(check.state)} size="sm" />
                    <div className="grow">
                      <div style={{ fontSize: 13.5 }}>{check.label}</div>
                      {check.detail === undefined ? null : <div className="hint">{check.detail}</div>}
                      {check.changes === undefined ? null : check.changes.map((change, index) => <div key={index} className="hint">· {change}</div>)}
                    </div>
                    <Badge tone={helpTone(check.state)}>{check.state === 'ok' ? '通过' : check.state === 'warn' ? '提醒' : '错误'}</Badge>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>与上一发布修订的差异</div>
              {publishReview.historyNote === undefined ? null : <p className="hint">{publishReview.historyNote}</p>}
              {publishReview.diff.length === 0 ? <p className="hint">没有检测到字段差异。</p> : (
                <div className="diff-list">
                  {publishReview.diff.map((line, index) => <div key={index} className="diff-item">{line}</div>)}
                </div>
              )}
            </div>
            <div className="banner info">
              <Icon name="info" />
              <div className="grow">发布后新创建/新领取的步骤可使用这个修订；已经冻结到旧修订的任务继续使用旧修订，不会改变。</div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={switchPrompt !== null}
        title={switchPrompt?.kind === 'command' ? '还有未应用的命令参数修改' : '放弃未保存的修改？'}
        onClose={() => { setSwitchPrompt(null); }}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setSwitchPrompt(null); }}>继续编辑</Button>
            <span className="spacer" />
            <Button variant="danger" onClick={discardAndSwitch}>放弃修改并切换</Button>
          </>
        }
      >
        <p>
          {switchPrompt?.kind === 'command'
            ? '当前有未应用的命令参数修改。放弃后切换职业，会同时丢弃尚未保存的字段修改；已发布修订保持原样。'
            : '当前职业有未保存的修改。切换后会丢弃这些本地修改；已发布修订保持原样。'}
        </p>
      </Modal>
    </div>
  );
}

function AddToolForm({ onAdd }: { readonly onAdd: (tool: RoleResourceTool) => void }) {
  const [kind, setKind] = useState<RoleResourceTool['kind']>('native');
  const [name, setName] = useState('');
  const [source, setSource] = useState('');
  return (
    <div className="stack-loose">
      <label className="form-label">类型
        <select className="select" value={kind} onChange={(event) => { setKind(event.target.value as RoleResourceTool['kind']); }}>
          <option value="native">NATIVE · 原生工具</option>
          <option value="assist">ASSIST · 辅助工具</option>
          <option value="mcp">MCP · 外部 MCP</option>
        </select>
      </label>
      <label className="form-label">工具名
        <input className="input mono" value={name} onChange={(event) => { setName(event.target.value); }} placeholder="read_file" />
      </label>
      <label className="form-label">来源（可选）
        <input className="input mono" value={source} onChange={(event) => { setSource(event.target.value); }} placeholder="服务端来源" />
      </label>
      <p className="hint">保存的是职业草稿上限声明，不会立即授予实际运行权限。</p>
      <div className="row">
        <span className="spacer" />
        <Button variant="primary" size="sm" icon="plus" disabled={name.trim() === ''} disabledReason="工具名不能为空。" onClick={() => { onAdd({ kind, name: name.trim(), ...(source.trim() === '' ? {} : { source: source.trim() }) }); }}>添加</Button>
      </div>
    </div>
  );
}

function AddFileForm({ onAdd }: { readonly onAdd: (file: RoleResourceFile) => void }) {
  const [kind, setKind] = useState<RoleResourceFile['kind']>('read');
  const [path, setPath] = useState('');
  const [workspace, setWorkspace] = useState('');
  return (
    <div className="stack-loose">
      <label className="form-label">类型
        <select className="select" value={kind} onChange={(event) => { setKind(event.target.value as RoleResourceFile['kind']); }}>
          <option value="read">READ · 读取</option>
          <option value="write">WRITE · 写入</option>
        </select>
      </label>
      <label className="form-label">相对路径
        <input className="input mono" value={path} onChange={(event) => { setPath(event.target.value); }} placeholder="docs/说明.md" />
      </label>
      <label className="form-label">工作区（可选）
        <input className="input mono" value={workspace} onChange={(event) => { setWorkspace(event.target.value); }} placeholder="留空表示不限定" />
      </label>
      <p className="hint">不能是绝对路径或包含 ..；服务端会校验。添加后仍需保存草稿。</p>
      <div className="row">
        <span className="spacer" />
        <Button variant="primary" size="sm" icon="plus" disabled={path.trim() === ''} disabledReason="路径不能为空。" onClick={() => { onAdd({ kind, path: path.trim(), ...(workspace.trim() === '' ? {} : { workspace: workspace.trim() }) }); }}>添加</Button>
      </div>
    </div>
  );
}

function AddResourceForm({ form, onAdd }: { readonly form: RoleForm; readonly onAdd: (resource: RoleResourceCapability) => void }) {
  const candidates = form.capabilityGroups.flatMap((group) => group.items)
    .filter((item) => !form.resourcePermissions.resources.some((resource) => resource.id === item.id));
  const [id, setId] = useState(candidates[0]?.id ?? '');
  const selected = candidates.find((item) => item.id === id);
  return (
    <div className="stack-loose">
      {candidates.length === 0 ? <p className="hint">服务返回的能力目录中没有可添加的资源项。</p> : (
        <label className="form-label">资源能力
          <select className="select" value={id} onChange={(event) => { setId(event.target.value); }}>
            {candidates.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.id}</option>)}
          </select>
        </label>
      )}
      <p className="hint">资源项来自服务返回的能力目录；添加的是草稿上限声明。</p>
      <div className="row">
        <span className="spacer" />
        <Button
          variant="primary"
          size="sm"
          icon="plus"
          disabled={selected === undefined}
          disabledReason={selected === undefined ? '没有可添加的资源能力。' : undefined}
          onClick={() => { if (selected !== undefined) onAdd({ kind: 'cap', id: selected.id, label: selected.label }); }}
        >
          添加
        </Button>
      </div>
    </div>
  );
}
