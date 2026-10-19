import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createRequestKey, type AppSettings, type BootstrapResponse } from '@agent-workflow/shared';
import { errorMessage, isApiClientError, isServiceUnavailable, request } from '../../api/client.ts';
import { queryKeys } from '../../api/hooks.ts';
import { SettingsRow, type SettingsEffect } from './shared.tsx';

type DraftValue = string | number | boolean;

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
  readonly setField: (field: DraftField) => void;
  readonly discard: () => void;
  readonly save: () => void;
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
        cursor[key] = field.value;
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
  const [fields, setFields] = useState<Record<string, DraftField>>({});
  const [saveMessage, setSaveMessage] = useState<SaveMessage | undefined>(undefined);

  const setField = (field: DraftField) => {
    setSaveMessage(undefined);
    setFields((current) => {
      const next = { ...current };
      if (field.issue === undefined && field.value === field.baseline) {
        delete next[field.path];
      } else {
        next[field.path] = field;
      }
      return next;
    });
  };

  const discard = () => {
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
      const response = await request<{ settings: AppSettings }>('/api/settings', {
        method: 'PATCH',
        body: { requestKey: createRequestKey(), patch: buildPatch(dirty) },
      });
      return response.data.settings;
    },
    onSuccess: (settings) => {
      setFields({});
      setSaveMessage({ tone: 'ok', message: '设置已保存。执行限制用于新任务/新执行；断连轮询与会话阈值立即生效。' });
      if (settings !== undefined) {
        queryClient.setQueryData<BootstrapResponse | undefined>(queryKeys.bootstrap, (current) => (
          current === undefined ? current : { ...current, settings }
        ));
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
    },
    onError: (error) => {
      if (isApiClientError(error) && error.kind === 'timeout') {
        setSaveMessage({ tone: 'unknown', message: '保存结果未明：请求超时。请刷新设置核对是否已写入，不要直接重复提交。' });
        return;
      }
      setSaveMessage({
        tone: 'danger',
        message: isServiceUnavailable(error) ? '服务未连接，设置未保存。' : errorMessage(error),
      });
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
      setField,
      discard,
      save: () => {
        if (dirtyFields.length === 0 || saveMutation.isPending) return;
        saveMutation.mutate();
      },
    };
  }, [fields, saveMessage, saveMutation, saveMutation.isPending]);

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
}

export function DraftNumberRow({
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
    <SettingsRow label={label} hint={hint} effect={effect} dirty={field !== undefined}>
      <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
        <input
          className="input"
          type="number"
          min={min}
          max={max}
          step={step}
          value={displayValue}
          aria-label={label}
          aria-invalid={issue === undefined ? undefined : true}
          style={{ width: 140 }}
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
        <span className="hint">范围 {min}–{max} {unit}</span>
        {issue === undefined ? null : <span className="hint" style={{ color: 'var(--danger)' }}>{issue}</span>}
      </div>
    </SettingsRow>
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
