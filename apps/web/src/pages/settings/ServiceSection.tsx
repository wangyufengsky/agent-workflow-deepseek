import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createRequestKey, type BootstrapResponse } from '@agent-workflow/shared';
import { request } from '../../api/client.ts';
import { Button } from '../../components/Button.tsx';
import { formatAbsoluteTime, formatSince } from '../../app/format.ts';
import { Badge } from '../../components/Badge.tsx';
import { OpenCodeCard } from './OpenCodeCard.tsx';
import { SettingsHeading, SettingsRow } from './shared.tsx';

export function ServiceSection({ data }: { readonly data: BootstrapResponse }) {
  const settings = data.settings;
  return (
    <>
      <div className="sect">
        <SettingsHeading title="服务" lede="本机服务、数据位置与受管运行时；这里展示当前生效值（只读）。" readOnly />
        <div className="card card-sec">
          <SettingsRow label="应用">
            <span className="row wrap" style={{ gap: 8 }}>
              <span>{data.app.name}</span>
              <Badge tone="neutral" outline>
                v{data.app.version}
              </Badge>
            </span>
          </SettingsRow>
          <SettingsRow label="运行时">
            <span className="row wrap" style={{ gap: 8 }}>
              <span className="mono">Node {data.app.nodeVersion}</span>
              <span className="hint">{data.app.platform}</span>
            </span>
          </SettingsRow>
          <SettingsRow label="启动时间">
            <span className="row wrap" style={{ gap: 8 }}>
              <span>{formatAbsoluteTime(data.app.startedAt)}</span>
              <span className="hint">已运行 {formatSince(data.app.startedAt)}</span>
            </span>
          </SettingsRow>
          <SettingsRow label="服务地址" hint="服务端监听地址；Web 通过 Vite 代理访问 /api">
            <span className="mono-wrap">
              {settings.server.host}:{String(settings.server.port)}
            </span>
          </SettingsRow>
          <SettingsRow label="数据目录" hint="可用 AGENT_WORKFLOW_DATA_DIR 覆盖">
            <span className="mono-wrap">{data.data.dataDir}</span>
          </SettingsRow>
          <SettingsRow label="SQLite 数据库">
            <span className="mono-wrap">{data.data.dbPath}</span>
          </SettingsRow>
          <SettingsRow label="事件日志（JSONL）">
            <span className="mono-wrap">{data.data.jsonlPath}</span>
          </SettingsRow>
          <SettingsRow label="受管 OpenCode" hint="版本固定，由程序启动与停止">
            <span className="row wrap" style={{ gap: 8 }}>
              <span className="mono">{settings.opencode.expectedVersion}</span>
              <Badge tone={settings.opencode.enabled ? 'ok' : 'idle'} icon={settings.opencode.enabled ? 'check' : 'stop'}>
                {settings.opencode.enabled ? '已启用' : '已禁用'}
              </Badge>
              <span className="hint">
                {settings.opencode.autoStart ? '由程序托管' : '连接已有服务'} · 权限模式 {settings.opencode.permissionMode}
              </span>
            </span>
          </SettingsRow>
          <SettingsRow label="模型档案">
            <span>{String(settings.models.length)} 个配置 · MCP 服务 {settings.opencode.mcpServerName}</span>
          </SettingsRow>
          <PollIntervalRow value={settings.monitoring.pollIntervalMs} />
          <SessionThresholdRow value={settings.monitoring.sessionAlertThreshold} />
        </div>
        <p className="hint" style={{ marginTop: 14 }}>
          启动配置文件由服务端持有；本页不会读取凭据、令牌或密码。
        </p>
      </div>

      <OpenCodeCard integration={data.integration} />
    </>
  );
}


function PollIntervalRow({ value }: { readonly value: number }) {
  const [draft, setDraft] = useState(String(value));
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => {
      const parsed = Number(draft);
      if (!Number.isInteger(parsed) || parsed < 500 || parsed > 30_000) throw new Error('轮询间隔需要在 500–30000ms 之间');
      return request<unknown>('/api/settings', {
        method: 'PATCH',
        body: { requestKey: createRequestKey(), patch: { monitoring: { pollIntervalMs: parsed } } },
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
    },
  });
  return (
    <SettingsRow label="断连轮询间隔" hint="SSE 不可用时任务页轮询间隔（500–30000ms）">
      <span className="row wrap" style={{ gap: 8 }}>
        <input className="input" type="number" min={500} max={30000} step={100} style={{ width: 120 }} value={draft} onChange={(event) => { setDraft(event.target.value); }} aria-label="断连轮询间隔" />
        <span className="hint">ms</span>
        <Button variant="secondary" size="sm" icon="check" disabled={mutation.isPending || draft === String(value)} onClick={() => { mutation.mutate(); }}>
          {mutation.isPending ? '保存中…' : '保存'}
        </Button>
        {mutation.isError ? <span className="hint" style={{ color: 'var(--danger)' }}>{mutation.error instanceof Error ? mutation.error.message : '保存失败'}</span> : null}
      </span>
    </SettingsRow>
  );
}


function SessionThresholdRow({ value }: { readonly value: number }) {
  const [draft, setDraft] = useState(String(value));
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => {
      const parsed = Number(draft);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) throw new Error('会话告警阈值需要在 1–100 之间');
      return request<unknown>('/api/settings', {
        method: 'PATCH',
        body: { requestKey: createRequestKey(), patch: { monitoring: { sessionAlertThreshold: parsed } } },
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
    },
  });
  return (
    <SettingsRow label="会话告警阈值" hint="活跃 OpenCode 会话达到此数量时在运行状态中告警（1–100）">
      <span className="row wrap" style={{ gap: 8 }}>
        <input className="input" type="number" min={1} max={100} step={1} style={{ width: 100 }} value={draft} onChange={(event) => { setDraft(event.target.value); }} aria-label="会话告警阈值" />
        <span className="hint">个会话</span>
        <Button variant="secondary" size="sm" icon="check" disabled={mutation.isPending || draft === String(value)} onClick={() => { mutation.mutate(); }}>
          {mutation.isPending ? '保存中…' : '保存'}
        </Button>
        {mutation.isError ? <span className="hint" style={{ color: 'var(--danger)' }}>{mutation.error instanceof Error ? mutation.error.message : '保存失败'}</span> : null}
      </span>
    </SettingsRow>
  );
}
