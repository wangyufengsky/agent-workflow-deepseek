import type { ReactNode } from 'react';
import { OpencodeServiceStatus, type OpencodeServiceStatusValue } from '@agent-workflow/shared';
import { isServiceUnavailable } from '../../api/client.ts';
import { useBootstrap, useOpenCodeStatus, useRestartOpenCode } from '../../api/hooks.ts';
import { formatAbsoluteTime, formatSince } from '../../app/format.ts';
import { Badge, type BadgeTone } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { PendingBackendNotice, ServiceNotice } from '../../components/ServiceNotice.tsx';

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

const STATE_ICON: Record<OpencodeServiceStatusValue, 'check' | 'clock' | 'alert' | 'stop'> = {
  stopped: 'stop',
  starting: 'clock',
  ready: 'check',
  degraded: 'alert',
  failed: 'alert',
};

function isOpenCodeState(value: string): value is OpencodeServiceStatusValue {
  return (Object.values(OpencodeServiceStatus) as readonly string[]).includes(value);
}

function Fact({
  icon,
  title,
  children,
}: {
  readonly icon: 'server' | 'shield' | 'link' | 'folder';
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="card pad">
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <Icon name={icon} size="sm" />
        <span className="section-title">{title}</span>
      </div>
      {children}
    </section>
  );
}

function MonoValue({ value }: { readonly value: string | undefined }) {
  return value === undefined || value.length === 0 ? <span className="muted">未知</span> : <span className="mono-wrap">{value}</span>;
}

export function RuntimePage() {
  const bootstrap = useBootstrap();
  const statusQuery = useOpenCodeStatus();
  const restart = useRestartOpenCode();
  const status = statusQuery.data;
  const data = bootstrap.data;
  const disconnected = statusQuery.isError && isServiceUnavailable(statusQuery.error);
  const state = status !== undefined && isOpenCodeState(status.state) ? status.state : null;

  const restartBlockedReason = disconnected
    ? '服务未连接：无法读取 OpenCode 状态，也不能提交重启请求。'
    : statusQuery.isError
      ? 'OpenCode 状态读取失败，先修复状态接口再重启。'
      : state === 'starting'
        ? 'OpenCode 正在启动，不能重复提交重启。'
        : state === null
          ? 'OpenCode 返回了无法识别的状态；为避免误操作，重启已停用。'
          : '正在读取 OpenCode 状态…';

  let body: ReactNode;
  if (bootstrap.isLoading && statusQuery.isLoading) {
    body = <p className="hint">正在读取运行环境…</p>;
  } else {
    body = (
      <>
        <section className="card pad" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <span
            className="tile lg"
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: state === 'ready' ? 'var(--ok-fill)' : state === 'failed' || state === 'degraded' ? 'var(--warn-fill)' : 'var(--fill-3)',
              color: state === 'ready' ? 'var(--ok)' : state === 'failed' || state === 'degraded' ? 'var(--warn)' : 'var(--muted)',
            }}
          >
            <Icon name="server" size="lg" />
          </span>
          <div className="grow" style={{ minWidth: 220 }}>
            <div className="row wrap" style={{ gap: 8 }}>
              <h2 style={{ fontSize: 19, fontWeight: 500 }}>OpenCode{status?.version === undefined ? '' : ` ${status.version}`}</h2>
              {state === null ? (
                <Badge tone="unknown" icon="help">
                  状态未知{status === undefined ? '' : `：${status.state}`}
                </Badge>
              ) : (
                <Badge tone={STATE_TONE[state]} icon={STATE_ICON[state]}>
                  {STATE_LABEL[state]}
                </Badge>
              )}
              <Badge outline icon="shield">
                受管进程
              </Badge>
            </div>
            <div className="hint" style={{ marginTop: 6, lineHeight: 1.6 }}>
              受管 OpenCode 通过本地 HTTP 接口执行任务与知识库对话。重启会结束当前会话，正在执行的任务会暂停。
            </div>
          </div>
          <Button
            variant="secondary"
            icon="refresh"
            disabled={statusQuery.isError || state === 'starting' || restart.isPending}
            disabledReason={restartBlockedReason}
            onClick={() => restart.mutate()}
          >
            {restart.isPending ? '正在提交重启…' : '重启 OpenCode'}
          </Button>
        </section>

        {statusQuery.isError ? (
          <div style={{ marginTop: 14 }}>
            <ServiceNotice
              error={statusQuery.error}
              onRetry={() => {
                void statusQuery.refetch();
              }}
            />
          </div>
        ) : null}

        {status?.lastError === undefined ? null : (
          <div className="banner warn" role="alert" style={{ marginTop: 14 }}>
            <Icon name="alert" />
            <div className="grow">
              <b>最近一次运行错误</b>
              <br />
              <span className="mono-wrap">{status.lastError}</span>
            </div>
          </div>
        )}

        {restart.isSuccess ? (
          <div className="banner ok" role="status" style={{ marginTop: 14 }}>
            <Icon name="check" />
            <div className="grow">
              <b>已提交重启请求</b>
              <br />
              重启结果以 /api/opencode/status 重新读取的状态为准；本页不把提交当成成功。
            </div>
          </div>
        ) : null}

        {restart.isError ? (
          <div style={{ marginTop: 14 }}>
            <ServiceNotice error={restart.error} />
          </div>
        ) : null}

        <div className="grid-3" style={{ marginTop: 16 }}>
          <Fact icon="server" title="应用">
            <dl className="kv" style={{ gridTemplateColumns: '92px minmax(0,1fr)', fontSize: 12.5 }}>
              <dt>名称 / 版本</dt>
              <dd>
                {data?.app.name ?? '—'} {data?.app.version ?? ''}
              </dd>
              <dt>Node</dt>
              <dd className="mono-wrap">{data?.app.nodeVersion ?? '—'}</dd>
              <dt>平台</dt>
              <dd className="mono-wrap">{data?.app.platform ?? '—'}</dd>
              <dt>已运行</dt>
              <dd>{formatSince(data?.app.startedAt)}</dd>
              <dt>启动时间</dt>
              <dd>{formatAbsoluteTime(data?.app.startedAt)}</dd>
            </dl>
          </Fact>

          <Fact icon="shield" title="OpenCode 进程">
            <dl className="kv" style={{ gridTemplateColumns: '92px minmax(0,1fr)', fontSize: 12.5 }}>
              <dt>可执行文件</dt>
              <dd>
                <MonoValue value={status?.binaryPath ?? data?.settings.opencode.binaryPath} />
              </dd>
              <dt>监听地址</dt>
              <dd>
                <MonoValue value={status?.host === undefined ? undefined : `${status.host}${status.port === undefined ? '' : `:${String(status.port)}`}`} />
              </dd>
              <dt>PID</dt>
              <dd className="mono">{status?.pid === undefined ? '—' : String(status.pid)}</dd>
              <dt>启动于</dt>
              <dd>{formatAbsoluteTime(status?.startedAt)}</dd>
              <dt>默认模型</dt>
              <dd className="mono-wrap">{status?.model ?? '—'}</dd>
              <dt>Agent</dt>
              <dd className="mono">{status?.agent ?? data?.settings.opencode.agent ?? '—'}</dd>
              <dt>期望版本</dt>
              <dd className="mono">{data?.settings.opencode.expectedVersion ?? '—'}</dd>
            </dl>
          </Fact>

          <Fact icon="link" title="内部 MCP">
            <div className="row wrap" style={{ gap: 8 }}>
              <Badge tone={status?.mcp.connected === true ? 'ok' : 'unknown'} icon={status?.mcp.connected === true ? 'check' : 'help'}>
                {status?.mcp.connected === true ? '已连接' : statusQuery.isLoading ? '读取中' : '未连接'}
              </Badge>
              <span className="mono-wrap">{status?.mcp.name ?? data?.settings.opencode.mcpServerName ?? '—'}</span>
            </div>
            <p className="hint" style={{ marginTop: 8, lineHeight: 1.6 }}>
              服务上报工具数：{status === undefined ? '—' : String(status.mcp.tools)}。连接状态只代表受管进程内的 MCP 通道，工具清单见「工具与 Skill」。
            </p>
            <p className="hint" style={{ marginTop: 6 }}>
              重启历史与操作回执需要服务端的运行记录接口；本页不展示示例历史。
            </p>
          </Fact>
        </div>

        <section className="card" style={{ marginTop: 16 }}>
          <div className="card-head">
            <Icon name="folder" />
            <div className="grow">
              <div className="section-title">运行数据</div>
              <div className="hint">本地数据目录与事件日志路径，由 /api/bootstrap 返回。</div>
            </div>
            <Badge outline icon="lock">
              只读
            </Badge>
          </div>
          <div className="card-body">
            <dl className="kv">
              <dt>数据目录</dt>
              <dd className="mono-wrap">{data?.data.dataDir ?? '—'}</dd>
              <dt>SQLite</dt>
              <dd className="mono-wrap">{data?.data.dbPath ?? '—'}</dd>
              <dt>JSONL</dt>
              <dd className="mono-wrap">{data?.data.jsonlPath ?? '—'}</dd>
            </dl>
          </div>
        </section>

        <div className="section">
          <div className="section-head">
            <span className="section-title">最近一次操作</span>
            <span className="hint">启动 / 重启历史尚未接通</span>
          </div>
          <div className="card">
            <EmptyState
              compact
              icon="clock"
              title="没有可读取的操作记录"
              description="服务端尚未提供运行时操作历史接口；本页只显示当前状态，不补写历史条目。"
            />
          </div>
        </div>

        <PendingBackendNotice
          className="inline-banner"
          message="启动 OpenCode 尚未接入界面：服务端当前只提供状态读取与受管重启。确认对话框、进程代次与启动失败原因需要新增接口后再接通。"
        />
      </>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="运行环境"
        lede="opencode-workflow 通过本机的受管 OpenCode 执行任务与对话。这里查看连接是否正常，并在需要时重启。"
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon="refresh"
            onClick={() => {
              void statusQuery.refetch();
              void bootstrap.refetch();
            }}
          >
            读取当前状态
          </Button>
        }
      />
      {body}
    </div>
  );
}
