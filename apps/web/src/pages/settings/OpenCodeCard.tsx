import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createRequestKey } from '@agent-workflow/shared';
import { OpencodeServiceStatus, type IntegrationStatus, type OpencodeServiceStatusValue } from '@agent-workflow/shared';
import { apiGet, errorMessage, isServiceUnavailable, request } from '../../api/client.ts';
import { useBootstrap, useOpenCodeDetect, useOpenCodeStatus, useRestartOpenCode } from '../../api/hooks.ts';
import { formatAbsoluteTime, formatSince } from '../../app/format.ts';
import { Badge, type BadgeTone } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';

const STATE_LABEL: Record<OpencodeServiceStatusValue, string> = {
  stopped: '已停止',
  starting: '启动中',
  ready: '已就绪',
  degraded: '部分可用',
  failed: '失败',
};

const STATE_TONE: Record<OpencodeServiceStatusValue, BadgeTone> = {
  stopped: 'idle',
  starting: 'wait',
  ready: 'ok',
  degraded: 'wait',
  failed: 'danger',
};

function isOpenCodeState(value: string): value is OpencodeServiceStatusValue {
  return (Object.values(OpencodeServiceStatus) as readonly string[]).includes(value);
}

function InfoRow({ label, children, hint }: { readonly label: string; readonly children: ReactNode; readonly hint?: string }) {
  return (
    <div className="frow">
      <div className="l">
        {label}
        {hint === undefined ? null : <span className="hint">{hint}</span>}
      </div>
      <div className="v">{children}</div>
    </div>
  );
}

/**
 * OpenCode runtime status + restart. The restart command is only enabled when
 * /api/opencode/status answers; otherwise it is disabled with the reason shown.
 */
export function OpenCodeCard({ integration }: { readonly integration?: IntegrationStatus }) {
  const queryClient = useQueryClient();
  const bootstrap = useBootstrap();
  const statusQuery = useOpenCodeStatus();
  const [scanEnabled, setScanEnabled] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [manualPath, setManualPath] = useState('');
  const logsQuery = useQuery({
    queryKey: ['opencode', 'logs'],
    queryFn: async () => (await apiGet<{ path: string; lines: readonly string[]; truncated: boolean }>('/api/opencode/logs?lines=120')).data,
    enabled: showLogs,
    retry: false,
  });
  const detectQuery = useOpenCodeDetect(scanEnabled);
  const currentBinary = bootstrap.data?.settings.opencode.binaryPath ?? detectQuery.data?.current ?? '';
  const alertThreshold = bootstrap.data?.settings.monitoring.sessionAlertThreshold ?? 8;
  const sessions = statusQuery.data?.sessions ?? 0;
  const sessionAlert = sessions >= alertThreshold;
  const useBinary = useMutation({
    mutationFn: async (binaryPath: string) => {
      await request('/api/settings', {
        method: 'PATCH',
        body: { requestKey: createRequestKey(), patch: { opencode: { binaryPath } } },
      });
      return binaryPath;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
        queryClient.invalidateQueries({ queryKey: ['settings'] }),
      ]);
    },
  });
  const restart = useRestartOpenCode();
  const status = statusQuery.data;
  const disconnected = statusQuery.isError && isServiceUnavailable(statusQuery.error);
  const managed = status?.managed !== false;
  const restartBlockedReason = disconnected
    ? '服务未连接：无法读取 OpenCode 状态，也不能提交重启请求。'
    : statusQuery.isError
      ? 'OpenCode 状态读取失败，先修复状态接口再重启。'
      : !managed
        ? '受管 OpenCode 未随当前服务启动（设置被禁用或进程以 AGENT_WORKFLOW_DISABLE_OPENCODE=1 启动）。先在「模型与执行」启用并重启 Agent Workflow 服务。'
        : '正在读取 OpenCode 状态…';

  return (
    <div className="sect">
      <h2>OpenCode 运行状态</h2>
      <p className="lede">通过本机受管运行时调用模型。重启会结束当前会话，正在执行的任务会暂停。</p>

      {statusQuery.isLoading ? (
        <div className="card card-sec" style={{ padding: '18px 22px' }}>
          <span className="row hint" style={{ height: 32 }}>
            <span className="spin" />
            正在读取 OpenCode 状态…
          </span>
        </div>
      ) : null}

      {statusQuery.isError ? (
        <div style={{ marginTop: 16 }}>
          <ServiceNotice
            error={statusQuery.error}
            onRetry={() => {
              void statusQuery.refetch();
            }}
          />
          <p className="hint" style={{ marginTop: 10 }}>
            POST /api/opencode/restart 在状态不可读时不会发送。
          </p>
        </div>
      ) : null}

      {status !== undefined && !managed ? (
        <div className="banner danger" style={{ marginTop: 16 }}>
          <Icon name="alert" />
          <div className="grow">
            <b>受管 OpenCode 未启用</b>
            <br />
            当前服务启动时没有加载 OpenCode（<span className="mono">opencode.enabled={String(status.enabled)}</span>
            ，或启动环境设置了 <span className="mono">AGENT_WORKFLOW_DISABLE_OPENCODE=1</span>）。
            请到「模型与执行」打开「启用受管 OpenCode」并保存，然后重启 Agent Workflow 服务（不是只重启 OpenCode）。
            <br />
            因此这里显示“已停止 / MCP 未连接 0 工具”是预期状态，并不代表本地后端没连上。
          </div>
        </div>
      ) : null}

      {status === undefined ? null : (
        <div className="card card-sec">
          <InfoRow label="状态">
            <div className="row wrap" style={{ gap: 8 }}>
              {isOpenCodeState(status.state) ? (
                <Badge tone={STATE_TONE[status.state]} icon={status.state === 'ready' ? 'check' : status.state === 'failed' ? 'alert' : 'clock'}>
                  {STATE_LABEL[status.state]}
                </Badge>
              ) : (
                <Badge tone="unknown" icon="help">
                  未知状态：{status.state}
                </Badge>
              )}
              {status.version === undefined ? null : <span className="hint">版本 {status.version}</span>}
              {integration === undefined ? null : (
                <span className="hint">bootstrap 集成状态：{integration.opencode.status}</span>
              )}
            </div>
          </InfoRow>
          <InfoRow label="可执行文件">
            <span className="mono-wrap">{status.binaryPath}</span>
          </InfoRow>
          <InfoRow label="服务地址" hint="由受管进程启动时分配">
            <span className="mono-wrap">
              {status.host ?? '—'}
              {status.port === undefined ? '' : `:${String(status.port)}`}
            </span>
          </InfoRow>
          <InfoRow label="进程">
            <span className="row" style={{ gap: 8 }}>
              <span className="mono">{status.pid === undefined ? '—' : `PID ${String(status.pid)}`}</span>
              <span className="hint">启动于 {formatAbsoluteTime(status.startedAt)}（{formatSince(status.startedAt)}）</span>
            </span>
          </InfoRow>
          <InfoRow label="默认模型 / Agent">
            <span className="mono-wrap">
              {status.model} · agent {status.agent}
            </span>
          </InfoRow>
          <InfoRow label="MCP">
            <span className="row wrap" style={{ gap: 8 }}>
              <span className="mono">{status.mcp.name}</span>
              <Badge tone={status.mcp.connected ? 'ok' : 'unknown'} icon={status.mcp.connected ? 'check' : 'help'}>
                {status.mcp.connected ? '已连接' : '未连接'}
              </Badge>
              <span className="hint">{String(status.mcp.tools)} 个工具</span>
            </span>
          </InfoRow>
          <InfoRow label="并发会话">
            <span className="row wrap" style={{ gap: 8 }}>
              <span className="mono">{String(status.sessions ?? 0)} / {String(status.maxSessions ?? '—')}</span>
              {sessionAlert ? (
                <Badge tone={(status.sessions ?? 0) >= (status.maxSessions ?? Number.POSITIVE_INFINITY) ? 'danger' : 'warn'} icon="alert">
                  {(status.sessions ?? 0) >= (status.maxSessions ?? Number.POSITIVE_INFINITY) ? '已达上限，新会话会被拒绝' : `已达告警阈值 ${String(alertThreshold)}`}
                </Badge>
              ) : <span className="hint">运行中的受管会话计；达到上限时服务返回 OPENCODE_SESSION_LIMIT；告警阈值见「服务」</span>}
            </span>
          </InfoRow>
          {status.lastError === undefined ? null : (
            <InfoRow label="最近错误">
              <span className="error-text">
                <Icon name="alert" size="sm" />
                <span>{status.lastError}</span>
              </span>
            </InfoRow>
          )}
          <div className="frow">
            <div className="l">
              重启 OpenCode
              <span className="hint">只重启受管进程，不修改设置。</span>
            </div>
            <div className="v">
              <Button
                variant="secondary"
                size="sm"
                icon="refresh"
                title="重启 OpenCode 受管进程（会结束当前会话）"
                disabled={statusQuery.isError || restart.isPending || !managed}
                disabledReason={restartBlockedReason}
                onClick={() => restart.mutate()}
              >
                {restart.isPending ? '正在提交重启…' : '重启 OpenCode'}
              </Button>
              {restart.isSuccess ? (
                <div className="banner ok" style={{ marginTop: 10 }}>
                  <Icon name="check" />
                  <span>
                    已提交重启请求 · 回执 {restart.data.receipt.status}
                    {restart.data.receipt.status === 'unknown' ? '（结果未明，按原请求核对后再操作）' : ''}
                  </span>
                </div>
              ) : null}
              {restart.isError ? (
                <div className="banner danger" style={{ marginTop: 10 }}>
                  <Icon name="alert" />
                  <span>{errorMessage(restart.error)}</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

        <div style={{ marginTop: 20 }}>
          <div className="row wrap" style={{ gap: 8 }}>
            <div className="grow">
              <div className="section-title">最近日志</div>
              <p className="hint" style={{ marginTop: 4 }}>读取受管 OpenCode 日志尾部并脱敏（令牌/PAT/密码形态）；最多 120 行。</p>
            </div>
            <Button variant="secondary" size="sm" icon="doc" onClick={() => { setShowLogs((value) => !value); }}>
              {showLogs ? '收起日志' : '查看最近日志'}
            </Button>
            {showLogs ? <Button variant="ghost" size="sm" icon="refresh" onClick={() => { void logsQuery.refetch(); }}>刷新</Button> : null}
          </div>
          {showLogs ? (
            logsQuery.isLoading ? <p className="hint" style={{ marginTop: 8 }}>正在读取…</p>
              : logsQuery.isError ? <ServiceNotice className="inline-banner" error={logsQuery.error} />
                : logsQuery.data === undefined ? null
                  : logsQuery.data.lines.length === 0 ? <p className="hint" style={{ marginTop: 8 }}>日志文件还不存在或为空。</p>
                    : (
                      <pre className="code" style={{ marginTop: 8, maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                        {logsQuery.data.lines.join('\n')}
                      </pre>
                    )
          ) : null}
        </div>
        <div style={{ marginTop: 20 }}>
          <div className="row wrap" style={{ gap: 8 }}>
            <div className="grow">
              <div className="section-title">自动检测本机 OpenCode</div>
              <p className="hint" style={{ marginTop: 4 }}>
                只扫描 PATH 与 ~/.opencode/versions，并执行候选的 <span className="mono">--version</span>；不会改动设置，选择后才保存。
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              icon="search"
              disabled={detectQuery.isFetching}
              onClick={() => { setScanEnabled(true); void detectQuery.refetch(); }}
            >
              {detectQuery.isFetching ? '扫描中…' : '扫描本机版本'}
            </Button>
          </div>
          <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
            <input
              className="input mono"
              style={{ flex: 1, minWidth: 220 }}
              placeholder="手动填写可执行文件绝对路径"
              value={manualPath}
              onChange={(event) => { setManualPath(event.target.value); }}
              aria-label="OpenCode 可执行路径"
            />
            <Button
              variant="secondary"
              size="sm"
              icon="check"
              disabled={manualPath.trim() === '' || useBinary.isPending}
              onClick={() => { useBinary.mutate(manualPath.trim()); }}
            >
              保存路径
            </Button>
          </div>
          {detectQuery.isError ? <ServiceNotice className="inline-banner" error={detectQuery.error} /> : null}
          {detectQuery.data === undefined ? null : detectQuery.data.candidates.length === 0 ? (
            <p className="hint" style={{ marginTop: 10 }}>没有发现可用的 OpenCode 可执行文件；可手动填写路径。</p>
          ) : (
            <div className="list" style={{ marginTop: 10 }}>
              {detectQuery.data.candidates.map((candidate) => (
                <div key={candidate.path} className="list-row">
                  <span className="tile"><Icon name="terminal" /></span>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="mono" style={{ display: 'block', fontSize: 12.5 }}>{candidate.path}</span>
                    <span className="hint" style={{ display: 'block', marginTop: 2 }}>
                      {candidate.version === undefined ? '版本未识别' : `版本 ${candidate.version}`} · {candidate.source === 'versions-dir' ? '版本目录' : candidate.source === 'current' ? '当前配置' : 'PATH'}
                    </span>
                  </span>
                  {candidate.path === currentBinary ? (
                    <Badge tone="ok" icon="check">当前使用</Badge>
                  ) : (
                    <Button variant="secondary" size="sm" icon="check" disabled={useBinary.isPending} onClick={() => { useBinary.mutate(candidate.path); }}>
                      使用此版本
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
          {useBinary.isSuccess ? (
            <div className="banner ok" style={{ marginTop: 10 }}>
              <Icon name="check" />
              <span>已保存可执行路径；重启受管 OpenCode 后生效。</span>
            </div>
          ) : null}
          {useBinary.isError ? <ServiceNotice className="inline-banner" error={useBinary.error} /> : null}
        </div>
    </div>
  );
}
