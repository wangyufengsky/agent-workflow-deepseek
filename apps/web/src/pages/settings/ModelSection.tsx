import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createRequestKey,
  type BootstrapResponse,
  type ModelProfile,
} from '@agent-workflow/shared';
import { errorMessage, isServiceUnavailable, request } from '../../api/client.ts';
import { useOpenCodeStatus, useRestartOpenCode } from '../../api/hooks.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button, LinkButton } from '../../components/Button.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Modal } from '../../components/Modal.tsx';
import { SettingsHeading } from './shared.tsx';
import { ModelCatalogPicker } from './ModelCatalogPicker.tsx';
import { useSettingsDraft } from './draft.tsx';

const ROLE_META = [
  { id: 'planner', label: '规划' },
  { id: 'coder', label: '开发' },
  { id: 'reviewer', label: '审查' },
  { id: 'repairer', label: '修复' },
] as const;

type RoleId = (typeof ROLE_META)[number]['id'];

function newProfile(): ModelProfile {
  return {
    id: `custom-${Date.now().toString(36)}`,
    label: '自定义模型',
    provider: 'opencode-go',
    model: 'deepseek-v4.1-flash',
    roles: ['coder'],
    enabled: true,
  };
}

export function ModelSection({ data }: { readonly data: BootstrapResponse }) {
  const settings = data.settings;
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<ModelProfile | null>(null);
  const [editorError, setEditorError] = useState<string | undefined>(undefined);
  const draft = useSettingsDraft();
  const [pathDraft, setPathDraft] = useState(settings.opencode.binaryPath);
  const [runtimeDraft, setRuntimeDraft] = useState({
    enabled: settings.opencode.enabled,
    autoStart: settings.opencode.autoStart,
    agent: settings.opencode.agent,
  });
  const statusQuery = useOpenCodeStatus();
  const restart = useRestartOpenCode();

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
      queryClient.invalidateQueries({ queryKey: ['settings'] }),
      queryClient.invalidateQueries({ queryKey: ['opencode', 'status'] }),
    ]);
  };

  const saveModels = useMutation({
    mutationFn: async (models: readonly ModelProfile[]) => {
      await request('/api/settings', { method: 'PATCH', body: { requestKey: createRequestKey(), patch: { models } } });
    },
    onSuccess: invalidate,
  });

  const saveRuntime = useMutation({
    mutationFn: async () => {
      if (runtimeDraft.agent.trim() === '') throw new Error('Agent 名称不能为空');
      await request('/api/settings', {
        method: 'PATCH',
        body: { requestKey: createRequestKey(), patch: { opencode: { enabled: runtimeDraft.enabled, autoStart: runtimeDraft.autoStart, agent: runtimeDraft.agent.trim() } } },
      });
    },
    onSuccess: invalidate,
  });

  const savePath = useMutation({
    mutationFn: async () => {
      await request('/api/settings', {
        method: 'PATCH',
        body: { requestKey: createRequestKey(), patch: { opencode: { binaryPath: pathDraft.trim() } } },
      });
    },
    onSuccess: invalidate,
  });

  const profiles = settings.models;
  const enabledProfiles = profiles.filter((profile) => profile.enabled);

  const selectedForRole = (role: RoleId): string => enabledProfiles.find((profile) => profile.roles.includes(role))?.id ?? '';

  const assignRole = (role: RoleId, profileId: string) => {
    const models = profiles.map((profile) => {
      const roles = profile.roles.filter((item) => item !== role);
      if (profile.id === profileId) roles.push(role);
      return {
        ...profile,
        enabled: profile.id === profileId ? true : profile.enabled,
        roles,
      };
    });
    saveModels.mutate(models);
  };

  const persistEditor = () => {
    if (editor === null) return;
    setEditorError(undefined);
    if (editor.label.trim() === '' || editor.provider.trim() === '' || editor.model.trim() === '') {
      setEditorError('名称、provider、model 都不能为空');
      return;
    }
    const normalized = {
      ...editor,
      label: editor.label.trim(),
      provider: editor.provider.trim(),
      model: editor.model.trim(),
      roles: [...new Set(editor.roles)],
    };
    const models = profiles.some((profile) => profile.id === normalized.id)
      ? profiles.map((profile) => (profile.id === normalized.id ? normalized : profile))
      : [...profiles, normalized];
    saveModels.mutate(models, {
      onSuccess: async () => {
        await invalidate();
        setEditor(null);
      },
      onError: (error) => { setEditorError(errorMessage(error)); },
    });
  };

  return (
    <div className="sect">
      <SettingsHeading title="模型服务" lede="选择每个职责使用的模型、启停模型档案，并配置受管 OpenCode 可执行文件。" />

      <div className="card card-sec" aria-label="OpenCode 配置">
        <div className="frow">
          <div className="l">
            OpenCode 可执行文件
            <span className="hint">版本要求 {settings.opencode.expectedVersion}；保存后需重启生效</span>
          </div>
          <div className="v">
            <div className="row wrap" style={{ gap: 8 }}>
              <input className="input mono" style={{ width: 320 }} value={pathDraft} onChange={(event) => { setPathDraft(event.target.value); }} aria-label="OpenCode 可执行文件" />
              <Button variant="secondary" size="sm" icon="check" disabled={draft.readOnly || savePath.isPending || pathDraft.trim() === '' || pathDraft.trim() === settings.opencode.binaryPath} disabledReason={draft.readOnly ? '正在核对上一次保存，普通设置只读。' : undefined} onClick={() => { savePath.mutate(); }}>
                {savePath.isPending ? '保存中…' : '保存路径'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon="refresh"
                disabled={restart.isPending || statusQuery.isError || !settings.opencode.enabled}
                disabledReason={!settings.opencode.enabled ? '先启用受管 OpenCode 并重启 Agent Workflow 服务' : statusQuery.isError ? '读取不到 OpenCode 状态，不能重启' : undefined}
                onClick={() => { restart.mutate(); }}
              >
                {restart.isPending ? '重启中…' : '重启 OpenCode'}
              </Button>
              <Badge tone={statusQuery.data?.state === 'ready' ? 'ok' : statusQuery.data?.state === 'failed' ? 'danger' : 'wait'}>
                {statusQuery.data?.state ?? '读取状态中'}
              </Badge>
            </div>
            {savePath.isError ? <p className="hint" style={{ marginTop: 6, color: 'var(--danger)' }}>{errorMessage(savePath.error)}</p> : null}
            {restart.isError ? <p className="hint" style={{ marginTop: 6, color: 'var(--danger)' }}>{errorMessage(restart.error)}</p> : null}
            <p className="hint" style={{ marginTop: 6 }}>
              也可在「服务」分区自动检测、选择已安装版本、查看日志与完整运行状态。
              <LinkButton to="/settings?section=service" variant="ghost" size="sm" iconAfter="arrowRight">打开服务分区</LinkButton>
            </p>
          </div>
        </div>

        <div className="frow">
          <div className="l">
            运行时开关
            <span className="hint">保存后需重启 Agent Workflow 服务生效（不是只重启 OpenCode）</span>
          </div>
          <div className="v">
            <div className="row wrap" style={{ gap: 16, marginBottom: 8 }}>
              <label className="row" style={{ gap: 6, whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={runtimeDraft.enabled} onChange={(event) => { setRuntimeDraft({ ...runtimeDraft, enabled: event.target.checked }); }} />
                启用受管 OpenCode
              </label>
              <label className="row" style={{ gap: 6, whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={runtimeDraft.autoStart} onChange={(event) => { setRuntimeDraft({ ...runtimeDraft, autoStart: event.target.checked }); }} />
                自动启动
              </label>
            </div>
            <p className="hint">工具权限由职业、项目工具策略与当前任务授权共同确定；运行中请求在待处理中心答复。</p>
            <div className="row wrap" style={{ gap: 12 }}>
              <label className="row" style={{ gap: 6, whiteSpace: 'nowrap' }}>
                Agent
                <input className="input" style={{ width: 120 }} value={runtimeDraft.agent} onChange={(event) => { setRuntimeDraft({ ...runtimeDraft, agent: event.target.value }); }} />
              </label>
              <Button variant="secondary" size="sm" icon="check" disabled={draft.readOnly || saveRuntime.isPending} disabledReason={draft.readOnly ? '正在核对上一次保存，普通设置只读。' : undefined} onClick={() => { saveRuntime.mutate(); }}>
                {saveRuntime.isPending ? '保存中…' : '保存运行时配置'}
              </Button>
            </div>
            {saveRuntime.isError ? <p className="hint" style={{ marginTop: 6, color: 'var(--danger)' }}>{errorMessage(saveRuntime.error)}</p> : null}
            {!settings.opencode.enabled ? <p className="hint" style={{ marginTop: 6, color: 'var(--danger)' }}>当前保存的设置为「未启用受管 OpenCode」；需要打开并保存，然后重启 Agent Workflow 服务。</p> : null}
          </div>
        </div>
      </div>

      <div className="card card-sec" aria-label="职责模型选择">
        <ModelCatalogPicker preferred={profiles.find((profile) => profile.enabled && profile.roles.includes('planner')) ?? enabledProfiles[0]} ready={statusQuery.data?.state === 'ready'} saving={saveModels.isPending} onSelect={(model) => {
          const existing = profiles.find((profile) => profile.provider === model.provider && profile.model === model.model);
          const selected: ModelProfile = { ...(existing ?? newProfile()), provider: model.provider, model: model.model, label: model.label, enabled: true, roles: ROLE_META.map((role) => role.id) };
          saveModels.mutate([...profiles.filter((profile) => profile.id !== selected.id).map((profile) => ({ ...profile, roles: [] })), selected]);
        }} />
        <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
          <span className="section-title grow">职责模型</span>
          <span className="hint">每个职责选择一个已启用模型；保存后用于新会话，OpenCode 默认模型在重启后生效。</span>
        </div>
        {ROLE_META.map((role) => (
          <div key={role.id} className="frow">
            <div className="l">{role.label}模型</div>
            <div className="v">
              <select
                className="select"
                style={{ width: '100%', maxWidth: 460 }}
                value={selectedForRole(role.id)}
                aria-label={`${role.label}模型`}
                onChange={(event) => { assignRole(role.id, event.target.value); }}
                disabled={saveModels.isPending}
              >
                <option value="">未选择（回退到任意启用模型）</option>
                {enabledProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id} title={`${profile.provider}/${profile.model}`}>{profile.label}</option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </div>

      <div className="row wrap" style={{ gap: 8, margin: '16px 0 8px' }}>
        <span className="section-title grow">模型档案</span>
        <Button variant="secondary" size="sm" icon="plus" disabled={saveModels.isPending} onClick={() => { setEditorError(undefined); setEditor(newProfile()); }}>添加模型</Button>
      </div>

      <div className="card card-sec">
        {profiles.length === 0 ? (
          <EmptyState compact icon="sparkle" title="还没有模型档案" description="服务端 catalog 未提供模型配置。" />
        ) : (
          profiles.map((profile) => (
            <div key={profile.id} className="model-row">
              <span className="tile"><Icon name="sparkle" /></span>
              <div className="grow">
                <div className="name">{profile.label}</div>
                <div className="meta">{profile.provider} / {profile.model} · 角色 {profile.roles.length === 0 ? '未分配' : profile.roles.join(' / ')}</div>
              </div>
              <Badge tone={profile.enabled ? 'ok' : 'idle'} icon={profile.enabled ? 'check' : 'stop'}>{profile.enabled ? '已启用' : '已停用'}</Badge>
              <Button variant="ghost" size="sm" icon="edit" disabled={saveModels.isPending} onClick={() => { setEditorError(undefined); setEditor(profile); }}>编辑</Button>
              <Button
                variant="secondary"
                size="sm"
                icon={profile.enabled ? 'stop' : 'play'}
                disabled={saveModels.isPending || (profile.enabled && enabledProfiles.length <= 1)}
                disabledReason={profile.enabled && enabledProfiles.length <= 1 ? '至少保留一个启用模型' : undefined}
                onClick={() => { saveModels.mutate(profiles.map((item) => item.id === profile.id ? { ...item, enabled: !item.enabled } : item)); }}
              >
                {profile.enabled ? '停用' : '启用'}
              </Button>
            </div>
          ))
        )}
      </div>

      {saveModels.isError ? <p className="hint" style={{ marginTop: 10, color: 'var(--danger)' }}>{isServiceUnavailable(saveModels.error) ? '服务未连接，设置未保存。' : errorMessage(saveModels.error)}</p> : null}

      <Modal
        open={editor !== null}
        title={editor !== null && profiles.some((profile) => profile.id === editor.id) ? '编辑模型档案' : '添加模型档案'}
        onClose={() => { setEditor(null); }}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setEditor(null); }}>取消</Button>
            <span className="spacer" />
            <Button variant="primary" icon="check" disabled={draft.readOnly || saveModels.isPending} disabledReason={draft.readOnly ? '正在核对上一次保存，普通设置只读。' : undefined} onClick={persistEditor}>{saveModels.isPending ? '保存中…' : '保存模型'}</Button>
          </>
        }
      >
        {editor === null ? null : (
          <div className="stack-loose">
            <label className="form-label">名称<input className="input" value={editor.label} onChange={(event) => { setEditor({ ...editor, label: event.target.value }); }} /></label>
            <div className="grid-2" style={{ gap: 12 }}>
              <label className="form-label">Provider<input className="input mono" value={editor.provider} onChange={(event) => { setEditor({ ...editor, provider: event.target.value }); }} /></label>
              <label className="form-label">Model<input className="input mono" value={editor.model} onChange={(event) => { setEditor({ ...editor, model: event.target.value }); }} /></label>
            </div>
            <div className="form-label">
              职责角色
              <div className="row wrap" style={{ gap: 12, marginTop: 6 }}>
                {ROLE_META.map((role) => (
                  <label key={role.id} className="row" style={{ gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={editor.roles.includes(role.id)}
                      onChange={(event) => {
                        const roles = event.target.checked ? [...editor.roles, role.id] : editor.roles.filter((item) => item !== role.id);
                        setEditor({ ...editor, roles });
                      }}
                    />
                    {role.label}
                  </label>
                ))}
              </div>
            </div>
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={editor.enabled} onChange={(event) => { setEditor({ ...editor, enabled: event.target.checked }); }} />
              启用（作为职责模型候选）
            </label>
            {editorError === undefined ? null : <p className="hint" style={{ color: 'var(--danger)' }}>{editorError}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
