import { useMemo, useState, type ReactNode } from 'react';
import { DATABASE_TYPE_META, type DatabaseConnectionConfig } from '@agent-workflow/shared';
import { useSettings } from '../../api/hooks.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { SegmentedControl, type SegmentOption } from '../../components/SegmentedControl.tsx';
import { PendingBackendNotice, ServiceNotice } from '../../components/ServiceNotice.tsx';

const ADD_BLOCKED_REASON = '数据库连接写入接口尚未接通：服务端目前只返回 settings.database.connections，没有新增 / 编辑接口。';
const PROBE_BLOCKED_REASON = '连接探针接口尚未接通：服务端没有 /api/settings/databases/:id/probe，无法给出真实连接状态。';
const QUERY_BLOCKED_REASON = '只读查询接口尚未接通：服务端没有 /api/settings/databases/:id/query，页面不会执行或模拟 SQL。';

type TypeFilter = 'all' | string;

function ConnectionCard({ connection }: { readonly connection: DatabaseConnectionConfig }) {
  const meta = DATABASE_TYPE_META[connection.type];
  const address = `${connection.user}@${connection.host}:${String(connection.port)}/${connection.database}`;
  return (
    <article className="card pad hoverable" aria-label={connection.name} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
        <span className="tile lg">
          <Icon name="db" />
        </span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 500 }}>{connection.name}</div>
          <div className="hint mono" style={{ marginTop: 3, overflowWrap: 'anywhere' }}>
            {address}
          </div>
        </div>
        <Badge outline>{meta.label}</Badge>
      </div>

      <div className="row wrap" style={{ gap: 6 }}>
        {connection.readOnly ? (
          <Badge tone="ok" icon="lock">
            只读
          </Badge>
        ) : (
          <Badge tone="wait" icon="alert">
            配置为可写 · 查询仍由服务强制只读
          </Badge>
        )}
        {connection.ssl ? <Badge outline>SSL</Badge> : null}
        <Badge tone="idle" icon="clock">
          未检查 · 探针接口尚未接通
        </Badge>
        {connection.passwordRef === undefined ? (
          <Badge tone="unknown" icon="help">
            未配置密码引用
          </Badge>
        ) : (
          <Badge tone="idle" icon="lock">
            密码在服务端凭据中
          </Badge>
        )}
      </div>

      <div className="row wrap" style={{ gap: 8, marginTop: 'auto', paddingTop: 8, boxShadow: 'inset 0 1px 0 var(--line)' }}>
        <Button variant="secondary" size="sm" icon="link" disabled disabledReason={PROBE_BLOCKED_REASON}>
          测试连接
        </Button>
        <Button variant="ghost" size="sm" icon="terminal" disabled disabledReason={QUERY_BLOCKED_REASON}>
          只读查询
        </Button>
        <span className="spacer" />
        <span className="hint mono">{connection.id}</span>
      </div>
    </article>
  );
}

export function DatabasesPage() {
  const settingsQuery = useSettings();
  const settings = settingsQuery.data?.settings;
  const issues = settingsQuery.data?.issues ?? [];
  const connections = settings?.database.connections ?? [];
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [keyword, setKeyword] = useState('');

  const dbIssues = issues.filter((issue) => issue.path.startsWith('database.'));

  const types = useMemo(() => {
    const seen = new Map<string, number>();
    for (const connection of connections) seen.set(connection.type, (seen.get(connection.type) ?? 0) + 1);
    return [...seen.entries()];
  }, [connections]);

  const typeOptions: readonly SegmentOption<TypeFilter>[] = [
    { value: 'all', label: '全部类型', count: connections.length },
    ...types.map(([type, count]) => ({
      value: type,
      label: DATABASE_TYPE_META[type as keyof typeof DATABASE_TYPE_META]?.label ?? type,
      count,
    })),
  ];

  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    return connections.filter((connection) => {
      if (typeFilter !== 'all' && connection.type !== typeFilter) return false;
      if (needle.length === 0) return true;
      return [connection.name, connection.host, connection.database, connection.user, connection.id]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [connections, keyword, typeFilter]);

  let body: ReactNode;
  if (settingsQuery.isLoading) {
    body = <p className="hint">正在读取数据库连接…</p>;
  } else if (settingsQuery.isError) {
    body = (
      <ServiceNotice
        error={settingsQuery.error}
        onRetry={() => {
          void settingsQuery.refetch();
        }}
      />
    );
  } else if (connections.length === 0) {
    body = (
      <div className="card">
        <EmptyState
          icon="db"
          title="还没有数据库连接"
          description="添加只读连接后，任务和知识库可以按授权范围读取表结构与数据。当前优先支持 MySQL / MariaDB / GoldenDB（mysql2 驱动）；PostgreSQL、Oracle、达梦、DB2 的驱动仍在计划中。"
          action={
            <Button variant="primary" icon="plus" disabled disabledReason={ADD_BLOCKED_REASON}>
              添加连接
            </Button>
          }
        />
      </div>
    );
  } else if (filtered.length === 0) {
    body = <EmptyState icon="search" title="没有匹配的连接" description="换个关键词，或清除类型筛选。" />;
  } else {
    body = (
      <div className="grid-2">
        {filtered.map((connection) => (
          <ConnectionCard key={connection.id} connection={connection} />
        ))}
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="数据库"
        lede="管理只读数据库连接，决定哪些项目的任务可以读取、读取哪些库。连接列表来自 /api/settings；探针与查询接口尚未接通。"
        actions={
          <Button variant="secondary" size="sm" icon="plus" disabled disabledReason={ADD_BLOCKED_REASON}>
            添加连接
          </Button>
        }
      />

      {dbIssues.length > 0 ? (
        <div className="banner warn" role="alert" style={{ marginBottom: 14 }}>
          <Icon name="alert" />
          <div className="grow">
            <b>连接配置有 {String(dbIssues.length)} 个校验问题</b>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {dbIssues.map((issue) => (
                <li key={`${issue.path}-${issue.message}`}>
                  <span className="mono hint">{issue.path}</span> · {issue.message}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <div className="toolbar">
        <div className="input-wrap">
          <Icon name="search" />
          <input
            className="input ctl"
            placeholder="搜索名称、主机或库"
            aria-label="搜索数据库连接"
            value={keyword}
            onChange={(event) => {
              setKeyword(event.target.value);
            }}
          />
        </div>
        <SegmentedControl ariaLabel="数据库类型" options={typeOptions} value={typeFilter} onChange={setTypeFilter} />
        <span className="spacer" />
        <span className="hint">共 {String(connections.length)} 个连接</span>
      </div>

      {body}

      {settings === undefined ? null : (
        <div className="section">
          <div className="section-head">
            <span className="section-title">查询限制</span>
            <span className="hint">应用在所有只读查询上</span>
          </div>
          <div className="grid-3">
            <div className="card pad">
              <div className="eyebrow">查询超时</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginTop: 4 }}>
                {String(Math.round(settings.database.queryTimeoutMs / 1000))} 秒
              </div>
            </div>
            <div className="card pad">
              <div className="eyebrow">返回行数上限</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginTop: 4 }}>{String(settings.database.rowLimit)} 行</div>
            </div>
            <div className="card pad">
              <div className="eyebrow">语句长度上限</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginTop: 4 }}>{String(settings.database.statementLimit)} 字符</div>
            </div>
          </div>
        </div>
      )}

      <PendingBackendNotice
        className="inline-banner"
        message="连接状态、新增 / 编辑、测试连接与只读查询都依赖尚未接通的服务端接口；本页只展示 /api/settings 返回的真实配置，不展示模拟探针结果。"
      />
    </div>
  );
}
