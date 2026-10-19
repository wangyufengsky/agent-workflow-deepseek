import type { BootstrapResponse } from '@agent-workflow/shared';
import { formatAbsoluteTime, formatSince } from '../../app/format.ts';
import { Badge } from '../../components/Badge.tsx';
import { OpenCodeCard } from './OpenCodeCard.tsx';
import { DraftNumberRow, useSettingsDraft } from './draft.tsx';
import { SettingsHeading, SettingsRow } from './shared.tsx';

export function ServiceSection({ data }: { readonly data: BootstrapResponse }) {
  const settings = data.settings;
  const draft = useSettingsDraft();
  const rootsBaseline = settings.server.allowedProjectRoots.join('\n');
  const rootsValue = String(draft.fields['server.allowedProjectRoots']?.value ?? rootsBaseline);
  return (
    <>
      <div className="sect">
        <SettingsHeading title="服务" lede="本机服务、数据位置与受管运行时；带编辑控件的字段与「模型与执行」共用底部保存条。" />
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
                {settings.opencode.autoStart ? '随服务自动启动' : '手动启动受管进程'} · 工具权限按职业与项目策略限制
              </span>
            </span>
          </SettingsRow>
          <SettingsRow label="模型档案">
            <span>{String(settings.models.length)} 个配置 · MCP 服务 {settings.opencode.mcpServerName}</span>
          </SettingsRow>
          <SettingsRow label="允许的项目根目录" hint="每行一个绝对目录，最多16条；留空允许登记任意目录。只约束新登记，已有项目继续保留。按真实路径核对，符号链接不能绕过目录边界。" effect="live" dirty={draft.fields['server.allowedProjectRoots'] !== undefined}>
            <textarea className="textarea mono" aria-label="允许的项目根目录" value={rootsValue} disabled={draft.saving} onChange={(event) => draft.setField({ path: 'server.allowedProjectRoots', label: '允许的项目根目录', section: 'service', value: event.target.value, baseline: rootsBaseline, effect: 'live' })} />
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
  return (
    <DraftNumberRow
      path="monitoring.pollIntervalMs"
      label="断连轮询间隔"
      hint="SSE 不可用时任务页轮询间隔；保存后立即用于后续断连重读。"
      section="service"
      baseline={value}
      min={500}
      max={30000}
      step={100}
      unit="ms"
      effect="live"
    />
  );
}


function SessionThresholdRow({ value }: { readonly value: number }) {
  return (
    <DraftNumberRow
      path="monitoring.sessionAlertThreshold"
      label="会话告警阈值"
      hint="活跃 OpenCode 会话达到此数量时在运行状态中告警；保存后立即生效。"
      section="service"
      baseline={value}
      min={1}
      max={100}
      unit="个会话"
      effect="live"
    />
  );
}
