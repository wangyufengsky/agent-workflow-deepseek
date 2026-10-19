import type { BootstrapResponse } from '@agent-workflow/shared';
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
        </div>
        <p className="hint" style={{ marginTop: 14 }}>
          启动配置文件由服务端持有；本页不会读取凭据、令牌或密码。
        </p>
      </div>

      <OpenCodeCard integration={data.integration} />
    </>
  );
}
