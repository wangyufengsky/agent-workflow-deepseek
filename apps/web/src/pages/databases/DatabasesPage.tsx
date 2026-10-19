import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DATABASE_TYPE_META,
  DatabaseConnectionState,
  ROUTES,
  createRequestKey,
  parseJdbcDatabaseUrl,
  type DatabaseConnection,
  type DatabaseConnectionStateValue,
  type DatabaseConnectionUpsertRequest,
  type DatabaseConnectionsResponse,
  type DatabaseProbeResponse,
  type DatabaseProbeResult,
  type DatabaseQueryRequest,
  type DatabaseQueryResponseEnvelope,
  type DatabaseQueryResult,
  type DatabaseTypeValue,
} from '@agent-workflow/shared';
import { ApiClientError, apiGet, apiPost, errorMessage, isServiceUnavailable, request } from '../../api/client.ts';
import { useSettings } from '../../api/hooks.ts';
import { formatRelativeTime } from '../../app/format.ts';
import { Badge, type BadgeTone } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { Drawer } from '../../components/Drawer.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Icon, type IconName } from '../../components/Icon.tsx';
import { SegmentedControl, type SegmentOption } from '../../components/SegmentedControl.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';

const DATABASE_LIST_KEY = ['settings', 'databases'] as const;
const DATABASE_TYPES = Object.keys(DATABASE_TYPE_META) as DatabaseTypeValue[];

type TypeFilter = 'all' | DatabaseTypeValue;

interface StateMeta {
  readonly label: string;
  readonly tone: BadgeTone;
  readonly icon: IconName;
}

const STATE_META: Record<DatabaseConnectionStateValue, StateMeta> = {
  [DatabaseConnectionState.NOT_CONFIGURED]: { label: '未检查', tone: 'idle', icon: 'clock' },
  [DatabaseConnectionState.CONNECTED]: { label: '已连接', tone: 'ok', icon: 'check' },
  [DatabaseConnectionState.AUTH_FAILED]: { label: '认证失败', tone: 'danger', icon: 'alert' },
  [DatabaseConnectionState.UNREACHABLE]: { label: '连接不可达', tone: 'fail', icon: 'alert' },
  [DatabaseConnectionState.UNSUPPORTED]: { label: '类型不支持', tone: 'unknown', icon: 'help' },
};

interface ConnectionFormState {
  readonly id?: string;
  readonly name: string;
  readonly type: DatabaseTypeValue;
  readonly host: string;
  readonly port: string;
  readonly database: string;
  readonly user: string;
  readonly password: string;
  readonly ssl: boolean;
  readonly readOnly: boolean;
}

interface ProbeFeedback {
  readonly probe?: DatabaseProbeResult;
  readonly error?: string;
}

interface QueryState {
  readonly connection: DatabaseConnection;
  readonly sql: string;
  readonly limit: string;
  readonly result?: DatabaseQueryResult;
  readonly error?: string;
}

function defaultPort(type: DatabaseTypeValue): string {
  return String(DATABASE_TYPE_META[type].defaultPort);
}

function emptyForm(): ConnectionFormState {
  return {
    name: '',
    type: 'mysql',
    host: '',
    port: defaultPort('mysql'),
    database: '',
    user: '',
    password: '',
    ssl: false,
    readOnly: true,
  };
}

function formFrom(connection: DatabaseConnection): ConnectionFormState {
  return {
    id: connection.id,
    name: connection.name,
    type: connection.type,
    host: connection.host,
    port: String(connection.port),
    database: connection.database,
    user: connection.user,
    password: '',
    ssl: false,
    readOnly: connection.readOnly,
  };
}

function apiErrorDetail(error: unknown): string {
  if (error instanceof ApiClientError) return `${error.code ?? 'HTTP_ERROR'} · ${error.message}`;
  return errorMessage(error);
}

function validateForm(form: ConnectionFormState): string[] {
  const issues: string[] = [];
  if (form.name.trim().length === 0) issues.push('连接名称');
  if (form.host.trim().length === 0) issues.push('主机');
  const port = Number(form.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) issues.push('端口（1–65535）');
  if (form.database.trim().length === 0) issues.push('数据库');
  if (form.user.trim().length === 0) issues.push('用户名');
  if (form.password.length === 0) {
    issues.push(form.id === undefined ? '密码' : '密码（更新需重新填写）');
  }
  return issues;
}

async function fetchConnections(): Promise<readonly DatabaseConnection[]> {
  const response = await apiGet<DatabaseConnectionsResponse>(ROUTES.databaseConnections);
  return response.data.connections;
}

function formatCell(value: unknown): string {
  if (value === null) return 'NULL';
  if (value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function ProbeFeedbackView({ feedback }: { readonly feedback: ProbeFeedback }) {
  if (feedback.error !== undefined) {
    return (
      <div className="banner danger" role="alert" style={{ marginTop: 10, fontSize: 12.5 }}>
        <Icon name="alert" size="sm" />
        <div className="grow">探针失败：{feedback.error}</div>
      </div>
    );
  }
  const probe = feedback.probe;
  if (probe === undefined) return null;
  const meta = STATE_META[probe.state];
  return (
    <div className="banner" role="status" style={{ marginTop: 10, fontSize: 12.5 }}>
      <Icon name={meta.icon} size="sm" />
      <div className="grow">
        <div className="row wrap" style={{ gap: 6 }}>
          <Badge tone={meta.tone} icon={meta.icon}>
            {meta.label}
          </Badge>
          <span className="hint">
            {probe.state === DatabaseConnectionState.CONNECTED ? '连接成功' : '未连接'} · {formatRelativeTime(probe.checkedAt)}
          </span>
          {probe.serverVersion === undefined ? null : <span className="hint mono">{probe.serverVersion}</span>}
          {probe.latencyMs === undefined ? null : <span className="hint num">{String(probe.latencyMs)} ms</span>}
        </div>
        {probe.message === undefined ? null : (
          <div className="hint" style={{ marginTop: 4 }}>
            {probe.message}
          </div>
        )}
        <div className="hint" style={{ marginTop: 4 }}>
          能力：查询 {probe.capabilities.query ? '可用' : '不可用'} · EXPLAIN {probe.capabilities.explain ? '可用' : '不可用'} · 表结构{' '}
          {probe.capabilities.schemaRead ? '可读' : '不可读'}
        </div>
      </div>
    </div>
  );
}

export function DatabasesPage() {
  const queryClient = useQueryClient();
  const settingsQuery = useSettings();
  const listQuery = useQuery({
    queryKey: DATABASE_LIST_KEY,
    queryFn: fetchConnections,
    retry: (failureCount, error) => !isServiceUnavailable(error) && failureCount < 2,
    staleTime: 10_000,
  });
  const connections = listQuery.data ?? [];
  const limits = settingsQuery.data?.settings.database;

  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [keyword, setKeyword] = useState('');
  const [form, setForm] = useState<ConnectionFormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [probeFeedback, setProbeFeedback] = useState<Record<string, ProbeFeedback>>({});
  const [queryState, setQueryState] = useState<QueryState | null>(null);

  const saveMutation = useMutation({
    mutationFn: async (input: ConnectionFormState) => {
      const connection: DatabaseConnectionUpsertRequest['connection'] = {
        ...(input.id === undefined ? {} : { id: input.id }),
        name: input.name.trim(),
        type: input.type,
        host: input.host.trim(),
        port: Number(input.port),
        database: input.database.trim(),
        user: input.user.trim(),
        password: input.password,
        ssl: input.ssl,
        readOnly: input.readOnly,
      };
      const body: DatabaseConnectionUpsertRequest = { requestKey: createRequestKey(), connection };
      const response = await apiPost<{ readonly connection: DatabaseConnection }>(ROUTES.databaseConnections, body);
      return response.data.connection;
    },
    onSuccess: async (connection) => {
      const created = form?.id === undefined;
      await queryClient.invalidateQueries({ queryKey: DATABASE_LIST_KEY });
      setNotice(
        `${created ? '已添加连接' : '已更新连接'}：${connection.name}。密码只保存在服务端凭据中，不会回显；未检查前状态为「未检查」。`,
      );
      setForm(null);
      setFormError(null);
    },
    onError: (error) => {
      setFormError(apiErrorDetail(error));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (connectionId: string) => {
      await request(`/api/settings/databases/${encodeURIComponent(connectionId)}`, { method: 'DELETE' });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['databases'] }),
        queryClient.invalidateQueries({ queryKey: ['settings'] }),
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
      ]);
    },
  });
  const probeMutation = useMutation({
    mutationFn: async (connectionId: string) => {
      const response = await apiPost<DatabaseProbeResponse>(ROUTES.databaseProbe(connectionId), {});
      return response.data.probe;
    },
    onSuccess: async (probe) => {
      setProbeFeedback((current) => ({ ...current, [probe.connectionId]: { probe } }));
      await queryClient.invalidateQueries({ queryKey: DATABASE_LIST_KEY });
    },
    onError: (error, connectionId) => {
      setProbeFeedback((current) => ({ ...current, [connectionId]: { error: apiErrorDetail(error) } }));
    },
  });

  const queryMutation = useMutation({
    mutationFn: async (input: { readonly connectionId: string; readonly sql: string; readonly limit: number }) => {
      const body: DatabaseQueryRequest = { sql: input.sql, limit: input.limit, confirmReadOnly: true };
      const response = await apiPost<DatabaseQueryResponseEnvelope>(ROUTES.databaseQuery(input.connectionId), body);
      return response.data.result;
    },
    onSuccess: (result) => {
      setQueryState((current) => (current === null ? current : { ...current, result, error: undefined }));
      void queryClient.invalidateQueries({ queryKey: DATABASE_LIST_KEY });
    },
    onError: (error) => {
      setQueryState((current) => (current === null ? current : { ...current, error: apiErrorDetail(error), result: undefined }));
    },
  });

  const types = useMemo(() => {
    const seen = new Map<DatabaseTypeValue, number>();
    for (const connection of connections) seen.set(connection.type, (seen.get(connection.type) ?? 0) + 1);
    return [...seen.entries()];
  }, [connections]);

  const typeOptions: readonly SegmentOption<TypeFilter>[] = [
    { value: 'all', label: '全部类型', count: connections.length },
    ...types.map(([type, count]) => ({ value: type, label: DATABASE_TYPE_META[type].label, count })),
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

  const openCreate = () => {
    setForm(emptyForm());
    setFormError(null);
    saveMutation.reset();
  };

  const openEdit = (connection: DatabaseConnection) => {
    setForm(formFrom(connection));
    setFormError(null);
    saveMutation.reset();
  };

  const openQuery = (connection: DatabaseConnection) => {
    setQueryState({ connection, sql: '', limit: String(limits?.rowLimit ?? 200) });
    queryMutation.reset();
  };

  const updateForm = (patch: Partial<ConnectionFormState>) => {
    // Accept a pasted Spring datasource URL in either the host or database
    // field and split it into the discrete fields the service expects.
    const jdbcCandidate = (typeof patch.host === 'string' && patch.host.includes('://'))
      ? patch.host
      : (typeof patch.database === 'string' && patch.database.includes('://'))
        ? patch.database
        : undefined;
    const parsed = jdbcCandidate === undefined ? undefined : parseJdbcDatabaseUrl(jdbcCandidate);
    const nextPatch: Partial<ConnectionFormState> = parsed === undefined
      ? patch
      : { ...patch, type: parsed.type, host: parsed.host, port: String(parsed.port), database: parsed.database };
    setForm((current) => (current === null ? current : { ...current, ...nextPatch }));
  };

  const formIssues = form === null ? [] : validateForm(form);
  const canSave = form !== null && formIssues.length === 0 && !saveMutation.isPending;

  let listBody: ReactNode;
  if (listQuery.isLoading) {
    listBody = <p className="hint">正在读取数据库连接…</p>;
  } else if (listQuery.isError) {
    listBody = (
      <>
        <ServiceNotice
          error={listQuery.error}
          onRetry={() => {
            void listQuery.refetch();
          }}
        />
        <p className="hint" style={{ marginTop: 10 }}>
          GET /api/settings/databases 未返回连接列表；服务未连接或数据库模块未接通时，不展示示例连接。
        </p>
      </>
    );
  } else if (connections.length === 0) {
    listBody = (
      <div className="card">
        <EmptyState
          icon="db"
          title="还没有数据库连接"
          description="添加只读连接后，任务和知识库可以按授权范围读取表结构与数据。支持 MySQL / MariaDB / GoldenDB（mysql2）与 PostgreSQL（pg）；Oracle、达梦、DB2 的驱动仍在计划中，探针会返回不支持原因。"
          action={
            <Button variant="primary" icon="plus" onClick={openCreate}>
              添加连接
            </Button>
          }
        />
      </div>
    );
  } else if (filtered.length === 0) {
    listBody = <EmptyState icon="search" title="没有匹配的连接" description="换个关键词，或清除类型筛选。" />;
  } else {
    listBody = (
      <div className="grid-2">
        {filtered.map((connection) => {
          const meta = DATABASE_TYPE_META[connection.type];
          const state = STATE_META[connection.state];
          const feedback = probeFeedback[connection.id];
          const probing = probeMutation.isPending && probeMutation.variables === connection.id;
          return (
            <article key={connection.id} className="card pad" aria-label={connection.name} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
                <span className="tile lg">
                  <Icon name="db" />
                </span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{connection.name}</div>
                  <div className="hint mono" style={{ marginTop: 3, overflowWrap: 'anywhere' }}>
                    {connection.user}@{connection.host}:{String(connection.port)}/{connection.database}
                  </div>
                </div>
                <Badge tone={state.tone} icon={state.icon}>
                  {state.label}
                </Badge>
              </div>

              <div className="row wrap" style={{ gap: 6 }}>
                <Badge outline>{meta.label}</Badge>
                {connection.readOnly ? (
                  <Badge tone="ok" icon="lock">
                    只读
                  </Badge>
                ) : (
                  <Badge tone="wait" icon="alert">
                    配置为可写 · 查询仍强制只读
                  </Badge>
                )}
                {connection.state === DatabaseConnectionState.CONNECTED ? null : (
                  <span className="hint">
                    {connection.lastCheckedAt === undefined ? '尚未检查' : `上次检查 ${formatRelativeTime(connection.lastCheckedAt)}`}
                  </span>
                )}
              </div>

              {connection.message === undefined ? null : (
                <div className="hint" style={{ color: 'var(--ink-2)', lineHeight: 1.55 }}>
                  {connection.message}
                </div>
              )}

              {feedback === undefined ? null : <ProbeFeedbackView feedback={feedback} />}

              <div className="row wrap" style={{ gap: 8, marginTop: 'auto', paddingTop: 8, boxShadow: 'inset 0 1px 0 var(--line)' }}>
                <Button
                  variant="secondary"
                  size="sm"
                  icon="link"
                  disabled={probing}
                  disabledReason="探针进行中"
                  onClick={() => {
                    probeMutation.mutate(connection.id);
                  }}
                >
                  {probing ? '测试中…' : '测试连接'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon="terminal"
                  onClick={() => {
                    openQuery(connection);
                  }}
                >
                  只读查询
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon="edit"
                  onClick={() => {
                    openEdit(connection);
                  }}
                >
                  编辑
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon="trash"
                  disabled={deleteMutation.isPending}
                  onClick={() => {
                    if (window.confirm(`删除数据库连接「${connection.name}」？只删除本地配置，不会改动数据库。`)) deleteMutation.mutate(connection.id);
                  }}
                >
                  删除
                </Button>
                <span className="spacer" />
                <span className="hint mono">{connection.id}</span>
              </div>
            </article>
          );
        })}
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="数据库"
        lede="管理只读数据库连接，决定哪些项目的任务可以读取、读取哪些库。连接列表、探针与只读查询来自 /api/settings/databases。"
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon="refresh"
              onClick={() => {
                void listQuery.refetch();
              }}
            >
              刷新
            </Button>
            <Button variant="primary" size="sm" icon="plus" onClick={openCreate}>
              添加连接
            </Button>
          </>
        }
      />

      {notice === null ? null : (
        <div className="banner ok" role="status" style={{ marginBottom: 14 }}>
          <Icon name="check" />
          <div className="grow">{notice}</div>
          <div className="actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setNotice(null);
              }}
            >
              知道了
            </Button>
          </div>
        </div>
      )}

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
        <span className="hint">共 {String(connections.length)} 个连接 · 查询只读</span>
      </div>

      {listBody}

      {limits === undefined ? null : (
        <div className="section">
          <div className="section-head">
            <span className="section-title">查询限制</span>
            <span className="hint">应用在所有只读查询上</span>
          </div>
          <div className="grid-3">
            <div className="card pad">
              <div className="eyebrow">查询超时</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginTop: 4 }}>{String(Math.round(limits.queryTimeoutMs / 1000))} 秒</div>
            </div>
            <div className="card pad">
              <div className="eyebrow">默认返回行数上限</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginTop: 4 }}>{String(limits.rowLimit)} 行</div>
            </div>
            <div className="card pad">
              <div className="eyebrow">语句长度上限</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginTop: 4 }}>{String(limits.statementLimit)} 字符</div>
            </div>
          </div>
        </div>
      )}

      <Drawer
        open={form !== null}
        title={form?.id === undefined ? '添加只读连接' : '编辑数据库连接'}
        size="lg"
        onClose={() => {
          if (saveMutation.isPending) return;
          setForm(null);
          setFormError(null);
        }}
        footer={
          <>
            <span className="hint grow">
              {form === null
                ? ''
                : formIssues.length > 0
                  ? `还缺：${formIssues.join('、')}`
                  : '保存后需要「测试连接」确认可用；保存只影响新建会话。'}
            </span>
            <Button
              variant="ghost"
              onClick={() => {
                setForm(null);
                setFormError(null);
              }}
              disabled={saveMutation.isPending}
            >
              取消
            </Button>
            <Button
              variant="primary"
              icon="check"
              disabled={!canSave}
              disabledReason={formIssues.length > 0 ? `还缺：${formIssues.join('、')}` : '保存中'}
              onClick={() => {
                if (form !== null) saveMutation.mutate(form);
              }}
            >
              {saveMutation.isPending ? '保存中…' : '保存连接'}
            </Button>
          </>
        }
      >
        {form === null ? null : (
          <div className="col" style={{ gap: 16 }}>
            {saveMutation.isError ? (
              <div className="banner danger" role="alert">
                <Icon name="alert" />
                <div className="grow">
                  <b>保存失败</b>
                  <br />
                  {formError ?? apiErrorDetail(saveMutation.error)}
                  <br />
                  如果在超时后保存，结果可能已写入；请先关闭并刷新列表核对，不会自动重发。
                </div>
              </div>
            ) : null}

            <div className="field" style={{ margin: 0 }}>
              <label className="label" htmlFor="db-jdbc">
                JDBC URL（可选，粘贴后自动拆分）
              </label>
              <input
                id="db-jdbc"
                className="input mono"
                placeholder="jdbc:mysql://127.0.0.1:3306/opencode_workflow_test?connectionTimeZone=UTC"
                onChange={(event) => {
                  const parsed = parseJdbcDatabaseUrl(event.target.value);
                  if (parsed !== undefined) {
                    setForm((current) => current === null ? current : { ...current, type: parsed.type, host: parsed.host, port: String(parsed.port), database: parsed.database });
                  }
                }}
              />
              <p className="hint">也可直接把 URL 粘贴到「主机」或「数据库」输入框，查询参数会被忽略。</p>
            </div>

            <div className="field" style={{ margin: 0 }}>
              <label className="label" htmlFor="db-name">
                连接名称 <span className="req">*</span>
              </label>
              <input
                id="db-name"
                className="input"
                value={form.name}
                placeholder="例如：订单分析库"
                onChange={(event) => {
                  updateForm({ name: event.target.value });
                }}
              />
            </div>

            <div className="field" style={{ margin: 0 }}>
              <label className="label" htmlFor="db-type">
                数据库类型 <span className="req">*</span>
              </label>
              <select
                id="db-type"
                className="select"
                value={form.type}
                onChange={(event) => {
                  const type = event.target.value as DatabaseTypeValue;
                  updateForm({ type, port: defaultPort(type) });
                }}
              >
                {DATABASE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {DATABASE_TYPE_META[type].label}
                    {DATABASE_TYPE_META[type].driver === 'planned' ? '（驱动计划中）' : ''}
                  </option>
                ))}
              </select>
              <span className="hint">
                {DATABASE_TYPE_META[form.type].urlExample}
                {DATABASE_TYPE_META[form.type].driver === 'planned' ? ' · 当前无内置驱动，探针会返回不支持原因。' : ''}
              </span>
            </div>

            <div className="grid-2" style={{ gap: 12 }}>
              <div className="field" style={{ margin: 0 }}>
                <label className="label" htmlFor="db-host">
                  主机 <span className="req">*</span>
                </label>
                <input
                  id="db-host"
                  className="input mono"
                  value={form.host}
                  placeholder="127.0.0.1"
                  onChange={(event) => {
                    updateForm({ host: event.target.value });
                  }}
                />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label className="label" htmlFor="db-port">
                  端口 <span className="req">*</span>
                </label>
                <input
                  id="db-port"
                  className="input mono"
                  inputMode="numeric"
                  value={form.port}
                  onChange={(event) => {
                    updateForm({ port: event.target.value.replace(/[^0-9]/g, '') });
                  }}
                />
              </div>
            </div>

            <div className="field" style={{ margin: 0 }}>
              <label className="label" htmlFor="db-database">
                数据库 / Schema <span className="req">*</span>
              </label>
              <input
                id="db-database"
                className="input mono"
                value={form.database}
                onChange={(event) => {
                  updateForm({ database: event.target.value });
                }}
              />
            </div>

            <div className="grid-2" style={{ gap: 12 }}>
              <div className="field" style={{ margin: 0 }}>
                <label className="label" htmlFor="db-user">
                  用户名 <span className="req">*</span>
                </label>
                <input
                  id="db-user"
                  className="input"
                  value={form.user}
                  autoComplete="off"
                  onChange={(event) => {
                    updateForm({ user: event.target.value });
                  }}
                />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label className="label" htmlFor="db-password">
                  密码 <span className="req">*</span>
                </label>
                <input
                  id="db-password"
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  placeholder={form.id === undefined ? '只保存在服务端凭据中' : '更新需重新填写'}
                  onChange={(event) => {
                    updateForm({ password: event.target.value });
                  }}
                />
              </div>
            </div>
            <p className="hint">密码不会回显。服务端更新连接时不保留旧密码，因此编辑连接必须重新填写密码。</p>

            <label className="check">
              <input
                type="checkbox"
                checked={form.ssl}
                onChange={(event) => {
                  updateForm({ ssl: event.target.checked });
                }}
              />
              <span>
                <span style={{ fontSize: 13.5 }}>使用 SSL</span>
                <span className="hint" style={{ display: 'block' }}>
                  由 mysql2 驱动建立 TLS 连接。连接列表不回显 SSL 标记，编辑保存时按当前勾选写入。
                </span>
              </span>
            </label>

            <label className="check">
              <input
                type="checkbox"
                checked={form.readOnly}
                onChange={(event) => {
                  updateForm({ readOnly: event.target.checked });
                }}
              />
              <span>
                <span style={{ fontSize: 13.5 }}>标记为只读连接</span>
                <span className="hint" style={{ display: 'block' }}>
                  只读查询始终由服务端守卫强制；该标记用于配置与提示。
                </span>
              </span>
            </label>

            <div className="banner info">
              <Icon name="info" />
              <div className="grow">保存写操作使用 requestKey；服务端目前不对重复 requestKey 去重，因此超时后请先刷新列表核对，不会自动重发。</div>
            </div>
          </div>
        )}
      </Drawer>

      <Drawer
        open={queryState !== null}
        title={queryState === null ? '只读查询' : `只读查询 · ${queryState.connection.name}`}
        size="xl"
        onClose={() => {
          if (queryMutation.isPending) return;
          setQueryState(null);
          queryMutation.reset();
        }}
        footer={
          <>
            <span className="hint grow">
              {queryState === null
                ? ''
                : queryState.connection.readOnly
                  ? '服务端只读守卫已启用'
                  : '连接标记为可写；查询仍由只读守卫强制'}
            </span>
            <Button
              variant="ghost"
              onClick={() => {
                setQueryState(null);
                queryMutation.reset();
              }}
              disabled={queryMutation.isPending}
            >
              关闭
            </Button>
            <Button
              variant="primary"
              icon="play"
              disabled={queryState === null || queryState.sql.trim().length === 0 || queryMutation.isPending}
              disabledReason={queryState === null || queryState.sql.trim().length === 0 ? '请填写只读 SQL' : '查询中'}
              onClick={() => {
                if (queryState === null) return;
                const limit = Number(queryState.limit);
                queryMutation.mutate({
                  connectionId: queryState.connection.id,
                  sql: queryState.sql,
                  limit: Number.isInteger(limit) && limit > 0 ? limit : 200,
                });
              }}
            >
              {queryMutation.isPending ? '执行中…' : '执行只读查询'}
            </Button>
          </>
        }
      >
        {queryState === null ? null : (
          <div className="col" style={{ gap: 14 }}>
            <div className="field" style={{ margin: 0 }}>
              <label className="label" htmlFor="db-sql">
                只读 SQL <span className="req">*</span>
              </label>
              <textarea
                id="db-sql"
                className="textarea mono"
                style={{ minHeight: 150 }}
                value={queryState.sql}
                placeholder="SELECT id, status FROM orders LIMIT 20"
                onChange={(event) => {
                  setQueryState({ ...queryState, sql: event.target.value, error: undefined });
                }}
              />
              <span className="hint">只接受单条 SELECT / SHOW / DESC / EXPLAIN / WITH；写语句、多语句与注释会被服务端拒绝。</span>
            </div>

            <div className="row wrap" style={{ gap: 10 }}>
              <label className="label" htmlFor="db-limit">
                返回行数上限
              </label>
              <input
                id="db-limit"
                className="input"
                style={{ width: 120 }}
                inputMode="numeric"
                value={queryState.limit}
                onChange={(event) => {
                  setQueryState({ ...queryState, limit: event.target.value.replace(/[^0-9]/g, '') });
                }}
              />
              <span className="hint">服务端还会应用自动 LIMIT 与查询超时。</span>
            </div>

            {queryState.error === undefined ? null : (
              <div className="banner danger" role="alert">
                <Icon name="alert" />
                <div className="grow">
                  <b>查询失败</b>
                  <br />
                  {queryState.error}
                </div>
              </div>
            )}

            {queryState.result === undefined ? (
              <p className="hint">执行后这里显示真实查询结果；没有结果时不展示示例数据。</p>
            ) : (
              <section className="card" aria-label="查询结果">
                <div className="card-head" style={{ padding: '12px 16px' }}>
                  <span className="section-title">结果</span>
                  <Badge outline>{queryState.result.rowCount} 行</Badge>
                  <Badge outline>{queryState.result.durationMs} ms</Badge>
                  {queryState.result.truncated ? (
                    <Badge tone="fail" icon="alert">
                      已截断
                    </Badge>
                  ) : null}
                  <span className="spacer" />
                  <span className="hint mono">{queryState.result.connectionId}</span>
                </div>
                <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: 'var(--muted)', boxShadow: 'inset 0 -1px 0 var(--line)' }}>
                        {queryState.result.columns.map((column) => (
                          <th key={column.name} style={{ padding: '8px 12px', fontWeight: 400, whiteSpace: 'nowrap' }}>
                            {column.name}
                            {column.type === undefined ? null : <span className="hint mono"> · {column.type}</span>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {queryState.result.rows.length === 0 ? (
                        <tr>
                          <td colSpan={queryState.result.columns.length} style={{ padding: 16 }}>
                            <span className="hint">查询成功，返回 0 行。</span>
                          </td>
                        </tr>
                      ) : (
                        queryState.result.rows.map((row, rowIndex) => (
                          <tr key={rowIndex} style={{ boxShadow: 'inset 0 -1px 0 var(--line)' }}>
                            {row.map((cell, cellIndex) => (
                              <td
                                key={cellIndex}
                                className="mono"
                                style={{ padding: '7px 12px', whiteSpace: 'nowrap', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis' }}
                                title={formatCell(cell)}
                              >
                                {formatCell(cell)}
                              </td>
                            ))}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
