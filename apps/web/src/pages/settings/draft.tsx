import { pendingForScope, subscribePending, type PendingCommand } from '../../api/pending-commands.ts';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ROUTES, createRequestKey, type AppSettings, type BootstrapResponse, type OperationReceipt } from '@agent-workflow/shared';
import { apiGet, errorMessage, isServiceUnavailable, request } from '../../api/client.ts';
import { queryKeys } from '../../api/hooks.ts';
import { fetchOperationByKey } from '../../api/workflow.ts';
import { SettingsRow, type SettingsEffect } from './shared.tsx';

const draftStorageKey = 'agent-workflow.settings-draft.v1';
function restoredFields(): Record<string, DraftField> {
  try { return JSON.parse(sessionStorage.getItem(draftStorageKey) ?? '{}') as Record<string, DraftField>; } catch { return {}; }
}
type DraftValue = string | number | boolean | readonly string[];

/** A persisted PATCH /api/settings that has no confirmed receipt yet. */
export interface SettingsPendingSave {
  readonly requestKey: string;
  readonly path: string;
}

export interface DraftField {
  readonly path: string;
  readonly label: string;
  readonly section: string;
  readonly value: DraftValue;
  readonly baseline: DraftValue;
  readonly effect: SettingsEffect;
  readonly issue?: string;
}

interface SaveMessage {
  readonly tone: 'ok' | 'danger' | 'unknown';
  readonly message: string;
}

interface SettingsDraftValue {
  readonly fields: Readonly<Record<string, DraftField>>;
  readonly dirtyCount: number;
  readonly restartCount: number;
  readonly issueCount: number;
  readonly dirtySections: ReadonlySet<string>;
  readonly saving: boolean;
  readonly saveMessage: SaveMessage | undefined;
  /** Set while the last save is unconfirmed: ordinary settings stay read-only. */
  readonly pending: SettingsPendingSave | undefined;
  readonly readOnly: boolean;
  readonly reconciling: boolean;
  readonly setField: (field: DraftField) => void;
  readonly discard: () => void;
  readonly save: () => void;
  /** Re-read the original request by key and compare it with the service settings. */
  readonly reconcile: () => void;
}

function readByPath(settings: AppSettings, path: string): unknown {
  let cursor: unknown = settings;
  for (const key of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

function sameDraftValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Draft value as it is sent to the service (line lists become arrays). */
function appliedValue(field: DraftField): unknown {
  if (field.path === 'server.allowedProjectRoots' || field.path === 'git.network.allowedHttpHosts') {
    const lines = typeof field.value === 'string' ? field.value.split('\n').map((line) => line.trim()).filter(Boolean) : [];
    return field.path === 'git.network.allowedHttpHosts' ? lines.map((host) => host.toLowerCase()) : lines;
  }
  return field.value;
}

/** How many dirty fields the service already matches (used after a re-read). */
function appliedCount(fields: readonly DraftField[], settings: AppSettings): number {
  return fields.filter((field) => sameDraftValue(readByPath(settings, field.path), appliedValue(field))).length;
}

const SettingsDraftContext = createContext<SettingsDraftValue | undefined>(undefined);

function buildPatch(fields: readonly DraftField[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const field of fields) {
    const parts = field.path.split('.');
    let cursor = patch;
    for (let index = 0; index < parts.length; index += 1) {
      const key = parts[index];
      if (key === undefined) continue;
      if (index === parts.length - 1) {
        const lines = typeof field.value === 'string' ? field.value.split('\n').map(line => line.trim()).filter(Boolean) : undefined;
        cursor[key] = field.path === 'git.network.allowedHttpHosts' && lines ? lines.map(host => host.toLowerCase()) : field.path === 'server.allowedProjectRoots' && lines ? lines : field.value;
      } else {
        const existing = cursor[key];
        if (typeof existing !== 'object' || existing === null) cursor[key] = {};
        cursor = cursor[key] as Record<string, unknown>;
      }
    }
  }
  return patch;
}

export function SettingsDraftProvider({ children }: { readonly children: ReactNode }) {
  const queryClient = useQueryClient();
  const [fields, setFields] = useState<Record<string, DraftField>>(restoredFields);
  const [saveMessage, setSaveMessage] = useState<SaveMessage | undefined>(undefined);
  const [pending, setPending] = useState<PendingCommand | undefined>(() => pendingForScope('/api/settings'));

  useEffect(() => subscribePending(() => { setPending(pendingForScope('/api/settings')); }), []);

  useEffect(() => {
    // These draft rows contain execution/monitoring limits, never credential inputs.
    const safeFields = Object.fromEntries(Object.entries(fields).filter(([path]) => path.startsWith('execution.') || path.startsWith('monitoring.') || path.startsWith('git.network.') || path.startsWith('git.gitlab.') || path === 'server.allowedProjectRoots'));
    try { sessionStorage.setItem(draftStorageKey, JSON.stringify(safeFields)); } catch { /* current draft remains in memory */ }
  }, [fields]);
  const setField = (field: DraftField) => {
    setSaveMessage(undefined);
    setFields((current) => {
      const next = { ...current };
      if (field.issue === undefined && JSON.stringify(field.value) === JSON.stringify(field.baseline)) {
        delete next[field.path];
      } else {
        next[field.path] = field;
      }
      return next;
    });
  };

  const discard = () => {
    if (pendingForScope('/api/settings') !== undefined) return;
    setFields({});
    setSaveMessage(undefined);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const dirty = Object.values(fields);
      if (dirty.length === 0) return undefined;
      if (dirty.some((field) => field.issue !== undefined)) {
        throw new Error('存在需要修正的设置，修正前不能保存');
      }
      const response = await request<{ settings: AppSettings; receipt: OperationReceipt }>('/api/settings', {
        method: 'PATCH',
        body: { requestKey: createRequestKey(), patch: buildPatch(dirty) },
      });
      if (response.data.receipt.status !== 'succeeded') throw new Error(response.data.receipt.status === 'failed' ? '设置保存失败，修改仍保留。' : '设置保存尚未确认，请按原请求核对。');
      return response.data.settings;
    },
    onSuccess: (settings) => {
      setFields({});
      setSaveMessage({ tone: 'ok', message: '设置已保存，各字段按标注的生效方式应用。' });
      if (settings !== undefined) {
        queryClient.setQueryData<BootstrapResponse | undefined>(queryKeys.bootstrap, (current) => (
          current === undefined ? current : { ...current, settings }
        ));
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
    },
    onError: (error) => {
      if (pendingForScope('/api/settings') !== undefined) {
        const dirtyCount = Object.values(fields).length;
        setSaveMessage({
          tone: 'unknown',
          message: `没有收到保存结果：正在重新读取设置，核对 ${String(dirtyCount)} 处修改是否已经生效。确认前普通设置保持只读；Git 账号仍可单独查看。`,
        });
        return;
      }
      setSaveMessage({
        tone: 'danger',
        message: isServiceUnavailable(error) ? '服务未连接，保存未获确认。' : errorMessage(error),
      });
    },
  });

  /**
   * P22-04「重新读取」: query the original request key (never re-send), re-read
   * the settings and compare every dirty field with the service value.
   */
  const reconcileMutation = useMutation({
    mutationFn: async () => {
      const current = pendingForScope('/api/settings');
      if (current === undefined) return undefined;
      const result = await fetchOperationByKey(current.requestKey);
      const bootstrap = (await apiGet<BootstrapResponse>(ROUTES.bootstrap)).data;
      queryClient.setQueryData<BootstrapResponse>(queryKeys.bootstrap, bootstrap);
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
      const dirty = Object.values(fields);
      return { operation: result.operation, applied: appliedCount(dirty, bootstrap.settings), total: dirty.length };
    },
    onSuccess: (result) => {
      if (result === undefined) {
        setSaveMessage({ tone: 'ok', message: '没有待核对的保存请求，页面已重新读取设置。' });
        return;
      }
      if (result.operation.status === 'succeeded' || (result.total > 0 && result.applied === result.total)) {
        setFields({});
        setSaveMessage({ tone: 'ok', message: `核对结果：上次保存已生效（${String(result.applied)}/${String(result.total)} 处修改已在服务端确认），页面已重新读取设置。` });
        return;
      }
      if (result.operation.status === 'failed') {
        setSaveMessage({ tone: 'danger', message: `核对结果：上次保存已失败，服务没有应用修改；${String(result.total)} 处修改仍保留，可再次保存。` });
        return;
      }
      setSaveMessage({
        tone: 'unknown',
        message: `核对结果：仍有 ${String(Math.max(result.total - result.applied, 0))} 处修改未确认生效（共 ${String(result.total)} 处）；保持只读，可稍后再次“重新读取核对”。`,
      });
    },
    onError: (error) => {
      setSaveMessage({ tone: 'danger', message: `重新读取失败：${errorMessage(error)}；没有重新提交保存。` });
    },
  });

  const value = useMemo<SettingsDraftValue>(() => {
    const dirtyFields = Object.values(fields);
    const dirtySections = new Set(dirtyFields.map((field) => field.section));
    return {
      fields,
      dirtyCount: dirtyFields.length,
      restartCount: dirtyFields.filter((field) => field.effect === 'restart').length,
      issueCount: dirtyFields.filter((field) => field.issue !== undefined).length,
      dirtySections,
      saving: saveMutation.isPending,
      saveMessage,
      pending: pending === undefined ? undefined : { requestKey: pending.requestKey, path: pending.path },
      readOnly: pending !== undefined,
      reconciling: reconcileMutation.isPending,
      setField,
      discard,
      save: () => {
        if (dirtyFields.length === 0 || saveMutation.isPending || pendingForScope('/api/settings') !== undefined) return;
        saveMutation.mutate();
      },
      reconcile: () => {
        if (reconcileMutation.isPending) return;
        reconcileMutation.mutate();
      },
    };
  }, [fields, saveMessage, pending, reconcileMutation.isPending, saveMutation, saveMutation.isPending]);

  return <SettingsDraftContext.Provider value={value}>{children}</SettingsDraftContext.Provider>;
}

export function useSettingsDraft(): SettingsDraftValue {
  const value = useContext(SettingsDraftContext);
  if (value === undefined) throw new Error('useSettingsDraft 必须在 SettingsDraftProvider 内使用');
  return value;
}

export interface DraftNumberRowProps {
  readonly path: string;
  readonly label: string;
  readonly hint?: string;
  readonly section: string;
  readonly baseline: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly unit: string;
  readonly effect?: SettingsEffect;
  /** Stored value = displayed value × factor (e.g. seconds → milliseconds). */
  readonly factor?: number;
  readonly issueMessage?: string;
  readonly compact?: boolean;
}

export function DraftNumberRow(props: DraftNumberRowProps) {
  const draft = useSettingsDraft();
  return <SettingsRow label={props.label} hint={props.hint} effect={props.effect ?? 'live'} dirty={draft.fields[props.path] !== undefined}><DraftNumberControl {...props} /></SettingsRow>;
}

export function DraftNumberControl({
  path,
  label,
  hint,
  section,
  baseline,
  min,
  max,
  step = 1,
  unit,
  effect = 'live',
  factor = 1,
  issueMessage,
  compact = false,
}: DraftNumberRowProps) {
  const draft = useSettingsDraft();
  const field = draft.fields[path];
  const baselineDisplay = baseline / factor;
  const displayValue = field === undefined
    ? String(baselineDisplay)
    : typeof field.value === 'number'
      ? String(field.value / factor)
      : typeof field.value === 'string'
        ? field.value
        : String(baselineDisplay);
  const issue = field?.issue;

  return (
      <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
        <input
          className="input"
          type="number"
          min={min}
          max={max}
          step={step}
          value={displayValue}
          aria-label={label}
          disabled={draft.readOnly}
          aria-invalid={issue === undefined ? undefined : true}
          style={{ width: compact ? 112 : 140 }}
          title={`范围 ${min}–${max} ${unit}`}
          onChange={(event) => {
            const raw = event.target.value;
            const parsed = Number(raw);
            const valid = raw.trim() !== '' && Number.isInteger(parsed) && parsed >= min && parsed <= max;
            draft.setField({
              path,
              label,
              section,
              value: valid ? parsed * factor : raw,
              baseline,
              effect,
              ...(valid ? {} : { issue: issueMessage ?? `${label}需要在 ${min}–${max} ${unit}之间` }),
            });
          }}
        />
        <span className="hint">{unit}</span>
        {compact ? null : <span className="hint">范围 {min}–{max} {unit}</span>}
        {issue === undefined ? null : <span className="hint" style={{ color: 'var(--danger)' }}>{issue}</span>}
      </div>
  );
}

export interface DraftBooleanRowProps {
  readonly path: string;
  readonly label: string;
  readonly hint?: string;
  readonly section: string;
  readonly baseline: boolean;
  readonly effect?: SettingsEffect;
}

export function DraftBooleanRow({ path, label, hint, section, baseline, effect = 'live' }: DraftBooleanRowProps) {
  const draft = useSettingsDraft();
  const field = draft.fields[path];
  const value = field === undefined
    ? baseline
    : typeof field.value === 'boolean'
      ? field.value
      : baseline;

  return (
    <SettingsRow label={label} hint={hint} effect={effect} dirty={field !== undefined}>
      <label className="row" style={{ gap: 8, whiteSpace: 'nowrap' }}>
        <input
          type="checkbox"
          checked={value}
          disabled={draft.readOnly}
          onChange={(event) => {
            draft.setField({
              path,
              label,
              section,
              value: event.target.checked,
              baseline,
              effect,
            });
          }}
        />
        {value ? '开启' : '关闭'}
      </label>
    </SettingsRow>
  );
}
