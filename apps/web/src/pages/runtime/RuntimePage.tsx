import { RuntimeControls } from './RuntimeControls.tsx';
import './runtime.css';
import { useEffect, useState, type ReactNode } from 'react';
import { OpencodeServiceStatus, type OpencodeServiceStatusValue } from '@agent-workflow/shared';
import { isServiceUnavailable } from '../../api/client.ts';
import { useBootstrap, useOpenCodeStatus } from '../../api/hooks.ts';
import { formatAbsoluteTime, formatSince } from '../../app/format.ts';
import { Badge, type BadgeTone } from '../../components/Badge.tsx';
import { Button, LinkButton } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
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

const STATE_ICON: Record<OpencodeServiceStatusValue, 'check' | 'clock' | 'alert' | 'stop'> = {
  stopped: 'stop',
  starting: 'clock',
  ready: 'check',
  degraded: 'alert',
  failed: 'alert',
};

/** 设计词表：已连接 / 离线 / 启动中 / 状态待核实（服务原始枚举作为 hint 保留）。 */
function designStateLabel(state: OpencodeServiceStatusValue | null, raw: string): string {
  if (state === 'ready') return '已连接';
  if (state === 'starting') return '启动中';
  if (state === 'stopped' || state === 'failed') return '离线';
  if (state === 'degraded') return '部分可用 · 状态待核实';
  return `状态待核实：${raw}`;
}

function ownershipLabel(status: { readonly managed?: boolean; readonly pid?: number } | undefined): string {
  if (status === undefined) return '未找到可用进程';
  return status.managed === false ? '外部进程 · 由你自行启动' : 'Loopper 受管进程';
}

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
  const [copyMessage, setCopyMessage] = useState('');
  const bootstrap = useBootstrap();
  const statusQuery = useOpenCodeStatus();
  const status = statusQuery.data;
  const data = bootstrap.data;
  const disconnected = statusQuery.isError && isServiceUnavailable(statusQuery.error);
  const state = status !== undefined && isOpenCodeState(status.state) ? status.state : null;
  const external = status?.managed === false;
  // 设计 read-error：读取失败时保留上一次结果，但必须明确标注“可能已过时”。
  const stale = statusQuery.isError && status !== undefined;
  const lastReadAt = statusQuery.dataUpdatedAt === 0 ? undefined : new Date(statusQuery.dataUpdatedAt).toISOString();
  const [unknownLock, setUnknownLock] = useState(false);

  useEffect(() => {
    if (!unknownLock) return;
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => { window.removeEventListener('beforeunload', handler); };
  }, [unknownLock]);

  const restartBlockedReason = disconnected
    ? '服务未连接：无法读取 OpenCode 状态，也不能提交重启请求。'
    : statusQuery.isError
      ? 'OpenCode 状态读取失败，先修复状态接口再重启。'
      : statusQuery.isLoading || status === undefined
        ? '正在读取 OpenCode 状态…'
        : external
          ? '当前 OpenCode 不是本程序受管进程（未启用或由外部启动），不能在这里重启。'
          : state === 'starting'
            ? 'OpenCode 正在启动，不能重复提交重启。'
            : state === null
              ? `OpenCode 返回了无法识别的状态「${status.state}」；为避免误操作，重启已停用。`
              : undefined;

  let body: ReactNode;
  if (bootstrap.isLoading && statusQuery.isLoading) {
    body = <p className="hint">正在读取运行环境…</p>;
  } else {
    body = (
      <>
        {stale ? (
          <div className="banner danger" role="alert" style={{ marginBottom: 14 }}>
            <Icon name="alert" />
            <div className="grow">
              <b>读取当前状态失败，下面是上一次读取到的结果，可能已经过时</b>
              <br />
              {lastReadAt === undefined ? '' : `读取于 ${formatAbsoluteTime(lastReadAt)}。`}
              当前进程可能已经变化（例如已离线或已重启），不能把这张卡当作实时状态。
            </div>
            <div className="actions">
              <Button variant="secondary" size="sm" icon="refresh" onClick={() => { void statusQuery.refetch(); }}>
                重新读取
              </Button>
            </div>
          </div>
        ) : null}

        <section className={['card', 'pad', stale ? 'stale' : ''].filter(Boolean).join(' ')} style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
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
              {status === undefined ? (
                <Badge tone="idle" icon="clock">
                  读取中
                </Badge>
              ) : state === null ? (
                <Badge tone="unknown" icon="help">
                  状态未知：{status.state}
                </Badge>
              ) : (
                <Badge tone={stale ? 'unknown' : STATE_TONE[state]} icon={STATE_ICON[state]}>
                  {designStateLabel(state, status.state)}
                </Badge>
              )}
              {status === undefined ? null : external ? (
                <Badge outline icon="lock">
                  外部进程 · 未受管
                </Badge>
              ) : (
                <Badge outline icon="shield">
                  受管进程
                </Badge>
              )}
            </div>
            <div className="hint" style={{ marginTop: 6, lineHeight: 1.6 }}>
              {status === undefined
                ? '正在读取 OpenCode 进程状态与受管归属…'
                : external
                  ? '当前 OpenCode 不是本程序受管进程（未启用或由外部启动）；本页只读取状态，不管理其进程，也不提供重启。'
                  : '受管 OpenCode 通过本地 HTTP 接口执行任务与知识库对话。重启前必须先停止并核对活动会话；服务会拒绝不安全的重启。'}
            </div>
            <div className="hint" style={{ marginTop: 4 }}>
              上次检查 {lastReadAt === undefined ? '未知' : formatAbsoluteTime(lastReadAt)}
              {' · '}进程归属 {ownershipLabel(status)}
              {stale ? <span className="stale-tag">上次结果 · 可能已过时</span> : null}
            </div>
          </div>

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

        {bootstrap.isError ? (
          <div style={{ marginTop: 14 }}>
            <ServiceNotice
              error={bootstrap.error}
              onRetry={() => {
                void bootstrap.refetch();
              }}
            />
          </div>
        ) : null}

        {external ? (
          <div className="banner info" role="status" style={{ marginTop: 14 }}>
            <Icon name="info" />
            <div className="grow">
              <b>外部进程 · 未受管</b>
              <br />
              当前 OpenCode 不是本程序受管进程（未启用或由外部启动）。本页只读取状态，不执行重启；需要在启动它的地方操作。
            </div>
          </div>
        ) : null}

        {state === 'failed' || state === 'stopped' ? (
          <div className="banner danger" role="alert" style={{ marginTop: 14 }}>
            <Icon name="alert" />
            <div className="grow">
              <b>OpenCode 没有运行{state === 'failed' ? '（启动失败）' : '（离线）'}</b>
              <br />
              任务和知识库暂时不能运行。请检查 CLI 路径与模型设置后再启动。
              {status?.lastError === undefined ? null : (
                <span className="mono-wrap" style={{ display: 'block', marginTop: 4 }}>
                  启动失败原因：{status.lastError}
                </span>
              )}
            </div>
            <div className="actions">
              <LinkButton variant="secondary" size="sm" icon="settings" to="/settings?section=opencode">
                检查 CLI 路径与模型设置
              </LinkButton>
            </div>
          </div>
        ) : state === 'starting' ? (
          <div className="banner info" role="status" style={{ marginTop: 14 }}>
            <Icon name="clock" />
            <div className="grow">
              <b>OpenCode 正在启动，等待连接就绪</b>
              <br />
              已启动进程 PID {status?.pid === undefined ? '未知' : String(status.pid)}；启动完成后状态会自动刷新。
            </div>
          </div>
        ) : state === null && status !== undefined ? (
          <div className="banner unknown" role="alert" style={{ marginTop: 14 }}>
            <Icon name="help" />
            <div className="grow">
              <b>服务返回了无法识别的状态「{status.state}」</b>
              <br />
              为避免误操作，启动 / 重启已停用。请重新读取；仍无法识别时请查看服务端日志。
            </div>
            <div className="actions">
              <Button variant="secondary" size="sm" icon="refresh" onClick={() => { void statusQuery.refetch(); }}>
                重新读取
              </Button>
            </div>
          </div>
        ) : null}

        {unknownLock ? (
          <div className="banner unknown" role="alert" style={{ marginTop: 14 }}>
            <Icon name="help" />
            <div className="grow">
              <b>没有收到运行时操作的结果，操作已锁定</b>
              <br />
              进程可能已经启动/重启，也可能没有；当前状态正常也不能证明操作完成。在按原请求号核对之前，不会重发，也不能再次启动或重启。离开本页时浏览器会提醒。
            </div>
          </div>
        ) : null}

        {state !== 'failed' && state !== 'stopped' && status?.lastError !== undefined ? (
          <div className="banner warn" role="alert" style={{ marginTop: 14 }}>
            <Icon name="alert" />
            <div className="grow">
              <b>最近一次运行错误</b>
              <br />
              <span className="mono-wrap">{status.lastError}</span>
            </div>
          </div>
        ) : null}

        <div className={['grid-3', stale ? 'stale' : ''].filter(Boolean).join(' ')} style={{ marginTop: 16 }}>
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
                <MonoValue value={status?.host === undefined ? undefined : `${status.host}${status.port === undefined ? '' : `:${String(status.port)}`}`} />{status?.host ? <Button size="sm" variant="ghost" icon="copy" onClick={() => { void navigator.clipboard.writeText(`${status.host}:${status.port ?? ''}`).then(() => setCopyMessage('监听地址已复制')).catch(() => setCopyMessage('复制失败，请手动复制显示的地址')); }}>复制</Button> : null}
              </dd>
              <dt>管理方式</dt>
              <dd>{ownershipLabel(status)}</dd>
              <dt>PID</dt>
              <dd className="mono">{status?.pid === undefined ? '—' : String(status.pid)}</dd>
              <dt>进程代次</dt><dd className="mono">{status?.generation ?? '未知'}</dd>
              <dt>启动于</dt>
              <dd>{formatAbsoluteTime(status?.startedAt)}</dd>
              <dt>默认模型</dt>
              <dd className="mono-wrap">{status?.model ?? '未知'} <LinkButton to="/settings?section=model" size="sm" variant="ghost">更改</LinkButton></dd>
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
              启动与重启记录见下方真实操作回执。
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

        <RuntimeControls
          state={state}
          blockedReason={restartBlockedReason}
          snapshot={{
            state: status?.state,
            pid: status?.pid,
            host: status?.host,
            port: status?.port,
            managed: status?.managed,
          }}
          onUnknownChange={setUnknownLock}
          onRefresh={() => { void statusQuery.refetch(); void bootstrap.refetch(); }}
        />
      </>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="运行环境"
        lede="agent-workflow 通过本机的 OpenCode 执行任务与对话。这里查看连接是否正常，并在需要时重启受管进程。"
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
      {copyMessage ? <p role="status" className="hint">{copyMessage}</p> : null}
      {body}
    </div>
  );
}
