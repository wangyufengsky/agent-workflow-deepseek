import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ROUTES,
  type RoleCatalogEntry,
  type RoleHistoryResponse,
  type RoleRevisionSnapshot,
} from '@agent-workflow/shared';
import { apiGet, errorMessage } from '../../api/client.ts';
import { fetchRoleCatalog } from '../../api/catalog-editor.ts';
import { useBootstrap } from '../../api/hooks.ts';
import { formatAbsoluteTime } from '../../app/format.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button, LinkButton } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { EmptyState, Skeleton } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import './roles-legacy.css';
import { RolePackageImport } from './RolePackageImport.tsx';

function RoleAvatar({ role, size }: { readonly role: { readonly name: string }; readonly size?: 'lg' }) {
  const initial = role.name.trim().slice(0, 1);
  return (
    <span className={['tile', size === 'lg' ? 'lg' : ''].filter(Boolean).join(' ')} aria-hidden="true" style={{ fontSize: 14, fontWeight: 600 }}>
      {initial === '' ? '?' : initial}
    </span>
  );
}

function responsibilityRows(base: RoleRevisionSnapshot, latest: RoleRevisionSnapshot) {
  const baseSet = new Set(base.responsibilities);
  const latestSet = new Set(latest.responsibilities);
  const all = [...base.responsibilities, ...latest.responsibilities.filter((item) => !baseSet.has(item))];
  return all.map((text) => ({ text, inBase: baseSet.has(text), inLatest: latestSet.has(text) }));
}

function SnapshotDiff({ base, latest }: { readonly base: RoleRevisionSnapshot; readonly latest: RoleRevisionSnapshot }) {
  const nameChanged = base.name !== latest.name;
  const purposeChanged = base.purpose !== latest.purpose;
  const rows = responsibilityRows(base, latest);
  return (
    <div className="rl-compare-wrap">
      <table className="rl-compare">
        <thead>
          <tr>
            <th scope="col">内容</th>
            <th scope="col">所选修订 {base.revision}</th>
            <th scope="col">最新发布 {latest.revision}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">名称</th>
            <td className={nameChanged ? 'rl-old' : ''}>{base.name}</td>
            <td className={nameChanged ? 'rl-new' : ''}>{latest.name}</td>
          </tr>
          <tr>
            <th scope="row">职业定位</th>
            <td className={purposeChanged ? 'rl-old' : ''}>{base.purpose}</td>
            <td className={purposeChanged ? 'rl-new' : ''}>{latest.purpose}</td>
          </tr>
          {(['instructions','allowedSlots','model','maxRuntimeMinutes','capabilityGroups','resourcePermissions','image'] as const).map((field)=><tr key={field}><th>{({instructions:'Prompt 模板',allowedSlots:'允许位置',model:'模型',maxRuntimeMinutes:'最长运行时间',capabilityGroups:'能力',resourcePermissions:'资源权限',image:'形象'})[field]}</th><td className={JSON.stringify(base[field])!==JSON.stringify(latest[field])?'rl-old':''}><pre>{JSON.stringify(base[field]??'未配置',null,2)}</pre></td><td className={JSON.stringify(base[field])!==JSON.stringify(latest[field])?'rl-new':''}><pre>{JSON.stringify(latest[field]??'未配置',null,2)}</pre></td></tr>)}
          {rows.length === 0 ? (
            <tr>
              <th scope="row">职责</th>
              <td colSpan={2} className="hint">
                两份快照都没有职责条目。
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const added = !row.inBase;
              const removed = !row.inLatest;
              return (
                <tr key={row.text}>
                  <th scope="row" className="rl-responsibility">
                    {row.text}
                  </th>
                  <td className={added ? 'rl-new' : ''}>{row.inBase ? '有' : '—'}</td>
                  <td className={removed ? 'rl-old' : added ? 'rl-new' : ''}>{row.inLatest ? '有' : '已移除'}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      <p className="hint" style={{ marginTop: 8 }}>
        差异由前端比较两份发布快照的字段得到；旧值标红描边、新值标绿描边，文字同时给出「有 / 已移除 / 新增」，不只依赖颜色。
      </p>
    </div>
  );
}

function RoleHistory({
  role,
  usage,
}: {
  readonly role: RoleCatalogEntry;
  readonly usage: readonly string[];
}) {
  const historyQuery = useQuery({
    queryKey: ['catalog', 'role-history', role.id],
    queryFn: async () => (await apiGet<RoleHistoryResponse>(ROUTES.catalogRoleHistory(role.id))).data,
    retry: false,
  });
  const history = historyQuery.data?.history ?? [];
  const [snapshotRevision, setSnapshotRevision] = useState<string | null>(null);
  const [compareRevision, setCompareRevision] = useState<string | null>(null);

  const [tab,setTab]=useState<'overview'|'perms'|'prompt'|'history'>('overview');
  const latest = history[0];
  const snapshot = history.find((item) => item.revision === snapshotRevision) ?? latest;
  const compareOptions = history.slice(1);
  const compare = compareOptions.find((item) => item.revision === compareRevision) ?? compareOptions[0];

  return (
    <div className="col" style={{ gap: 16 }}>
      <div role="tablist" aria-label="历史角色详情">{([['overview','描述'],['perms','权限与 MCP'],['prompt','Prompt 模板'],['history','版本历史']] as const).map(([id,label])=><Button key={id} variant={tab===id?'primary':'ghost'} onClick={()=>setTab(id)} role="tab" aria-selected={tab===id}>{label}</Button>)}</div>
      <div className="rl-groups" hidden={tab==='history'}>
        <section className="card rl-group-card" aria-label="职责" hidden={tab!=='overview'}>
          <div className="row" style={{ gap: 8 }}>
            <Icon name="users" size="sm" />
            <h4 style={{ fontSize: 13.5, fontWeight: 500 }}>职责</h4>
            <Badge tone="ok" icon="check">
              服务提供
            </Badge>
          </div>
          <p className="rl-text" style={{ marginTop: 8 }}>
            {role.purpose}
          </p>
          {role.responsibilities.length === 0 ? (
            <p className="hint" style={{ marginTop: 8 }}>
              目录里这个角色没有职责条目。
            </p>
          ) : (
            <ul className="rl-list" style={{ marginTop: 8 }}>
              {role.responsibilities.map((item) => (
                <li key={item}>
                  <Icon name="check" size="sm" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="rl-facts">
            <span>
              目录修订：<span className="mono">{role.revision}</span>
            </span>
            <span>
              提示词修订：<span className="mono">{role.promptRevision}</span>
            </span>
            <span>{role.hasDraft ? '有未发布草稿（本页只读）' : '无未发布草稿'}</span>
          </div>
        </section>

        <section className="card rl-group-card" hidden={tab!=='overview'}><h4>能力</h4>{(role.capabilityGroups ?? []).map((group)=><div key={group.id}><b>{group.label}</b><p>{group.items.filter((item)=>item.enabled).map((item)=>item.label).join('、')||'未启用'}</p></div>)}</section>
        <section className="card rl-group-card" hidden={tab!=='perms'}><h4>资源权限</h4><pre className="rl-text">{JSON.stringify(role.resourcePermissions ?? {},null,2)}</pre></section>
        <section className="card rl-group-card" hidden={tab!=='prompt'}><h4>形象</h4><p>{role.image ? `${role.image.value} · ${role.image.label??role.image.kind}` : '未配置形象，显示首字母'}</p><h4>Prompt 模板</h4><pre className="rl-text">{role.instructions || '未配置附加指令'}</pre><p>允许位置：{role.allowedSlots?.join('、') || '按服务默认'}</p></section>
      </div>

      <section className="card pad" aria-label="所属流程" hidden={tab!=='overview'}>
        <div className="row" style={{ gap: 8 }}>
          <Icon name="flow" size="sm" />
          <h4 style={{ fontSize: 13.5, fontWeight: 500 }}>所属流程与位置</h4>
          <Badge tone="neutral">{String(usage.length)} 个流程使用</Badge>
        </div>
        {usage.length === 0 ? (
          <p className="hint" style={{ marginTop: 8 }}>
            当前流程没有绑定这个角色。
          </p>
        ) : (
          <div className="col" style={{ gap: 6, marginTop: 8 }}>
            {usage.map((method) => (
              <div key={method} className="row" style={{ gap: 8 }}>
                <Icon name="branch" size="sm" />
                <span style={{ fontSize: 13.5 }}>{method}</span>

              </div>
            ))}
          </div>
        )}
        <p className="hint" style={{ marginTop: 8 }}>
          按实际规划职责及各阶段 roleId 统计；已冻结任务沿用创建时的流程与角色快照。
        </p>
      </section>

      <section className="card pad" aria-label="发布修订历史" hidden={tab!=='history'}>
        <div className="row wrap" style={{ gap: 8 }}>
          <Icon name="clock" size="sm" />
          <h4 style={{ fontSize: 13.5, fontWeight: 500 }}>发布修订历史</h4>
          <Badge tone="neutral">{String(history.length)} 个快照</Badge>
          <span className="spacer" />
          <Button
            variant="ghost"
            size="sm"
            icon="refresh"
            disabled={historyQuery.isFetching}
            disabledReason={historyQuery.isFetching ? '正在刷新发布修订历史…' : undefined}
            onClick={() => {
              void historyQuery.refetch();
            }}
          >
            {historyQuery.isFetching ? '读取中…' : '刷新'}
          </Button>
        </div>

        {historyQuery.isError ? (
          <div style={{ marginTop: 10 }}>
            <ServiceNotice error={historyQuery.error} onRetry={() => { void historyQuery.refetch(); }} title="读取发布修订历史失败" compact />
          </div>
        ) : historyQuery.isLoading ? (
          <div className="col" style={{ gap: 8, marginTop: 10 }}>
            <Skeleton height={14} width="48%" />
            <Skeleton height={14} width="36%" />
          </div>
        ) : history.length === 0 ? (
          <div className="banner info" style={{ marginTop: 10 }}>
            <Icon name="info" />
            <div className="grow">
              该角色还没有发布快照（服务只在发布时写入历史，且最多保留 20 个）。本页不伪造旧配置包；当前目录值见上方「职责」与右侧目录信息。
            </div>
          </div>
        ) : (
          <>
            <div className="rl-history">
              {history.map((entry, index) => (
                <button
                  key={entry.revision}
                  type="button"
                  className="rl-rev"
                  aria-current={snapshot?.revision === entry.revision ? 'true' : undefined}
                  onClick={() => {
                    setSnapshotRevision(entry.revision);
                  }}
                >
                  <span className="rl-rev-mark mono">{entry.revision}</span>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="rl-rev-name">{entry.name}</span>
                    <span className="hint rl-rev-meta">{formatAbsoluteTime(entry.publishedAt)}</span>
                  </span>
                  {index === 0 ? <Badge tone="accent">最新发布</Badge> : <Badge tone="neutral">历史</Badge>}
                </button>
              ))}
            </div>

            {snapshot === undefined ? null : (
              <div className="rl-snapshot">
                <div className="row wrap" style={{ gap: 8 }}>
                  <Badge tone="accent" icon="archive">
                    修订 {snapshot.revision}
                  </Badge>
                  <span className="hint">发布「{snapshot.name}」于 {formatAbsoluteTime(snapshot.publishedAt)}</span>
                </div>
                <p className="hint" style={{ marginTop: 8 }}>
                  只读静态配置快照：不是历史会话快照，也不是可导入的旧配置包。
                </p>
                <div className="rl-facts">
                  <span>名称：{snapshot.name}</span>
                  <span>定位：{snapshot.purpose}</span>
                </div>
                {snapshot.responsibilities.length === 0 ? (
                  <p className="hint">该快照没有职责条目。</p>
                ) : (
                  <ul className="rl-list">
                    {snapshot.responsibilities.map((item) => (
                      <li key={item}>
                        <Icon name="chevRight" size="sm" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {history.length < 2 ? (
              <p className="hint" style={{ marginTop: 12 }}>
                服务只有 1 个发布快照，无法做两份快照的字段比较；本页不拿目录当前值冒充历史快照。
              </p>
            ) : compare === undefined ? null : (
              <div style={{ marginTop: 12 }}>
                <div className="row wrap" style={{ gap: 8 }}>
                  <h5 style={{ fontSize: 13, fontWeight: 500 }}>版本比较</h5>
                  <select
                    className="select rl-compare-select"
                    aria-label="选择对比修订"
                    value={compare.revision}
                    onChange={(event) => {
                      setCompareRevision(event.target.value);
                    }}
                  >
                    {compareOptions.map((entry) => (
                      <option key={entry.revision} value={entry.revision}>
                        {entry.revision} · {formatAbsoluteTime(entry.publishedAt)}
                      </option>
                    ))}
                  </select>
                  <span className="hint">与最新发布修订 {latest?.revision ?? '—'} 对比（字段 diff 由前端完成）</span>
                </div>
                {latest === undefined ? null : <SnapshotDiff base={compare} latest={latest} />}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

export function RolesLegacyPage() {
  const bootstrap = useBootstrap();
  const catalogQuery = useQuery({ queryKey: ['catalog', 'roles'], queryFn: fetchRoleCatalog, retry: false });
  const [keyword, setKeyword] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const roles: readonly RoleCatalogEntry[] = useMemo(() => {
    if (catalogQuery.data !== undefined) return catalogQuery.data.roles;
    return (bootstrap.data?.catalog.roles ?? []).map((role) => ({
      ...role,
      status: 'published' as const,
      hasDraft: false,
    }));
  }, [catalogQuery.data, bootstrap.data]);

  const methods = bootstrap.data?.catalog.methods ?? [];
  const usageByRole = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const method of methods) {
      const roleId = method.planningStrategy?.roleId;
      if (roleId !== undefined) { const list=map.get(roleId)??[];list.push(`${method.name} · 规划职责`);map.set(roleId,list); }
      for(const step of method.requiredSteps) { if(!step.roleId)continue;const list=map.get(step.roleId)??[];list.push(`${method.name} · ${step.title}`);map.set(step.roleId,list); }
    }
    return map;
  }, [methods]);

  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    if (needle === '') return roles;
    return roles.filter((role) => [role.name, role.purpose, role.id, ...role.responsibilities].join(' ').toLowerCase().includes(needle));
  }, [keyword, roles]);

  const inUse = filtered.filter((role) => (usageByRole.get(role.id)?.length ?? 0) > 0);
  const unused = filtered.filter((role) => (usageByRole.get(role.id)?.length ?? 0) === 0);
  const selected = filtered.find((role) => role.id === selectedId);

  const loading = catalogQuery.isLoading && bootstrap.isLoading;
  const error = catalogQuery.isError ? catalogQuery.error : undefined;

  return (
    <div className="page rl-page">
      <PageHeader
        eyebrow="角色管理"
        title="历史角色配置"
        lede="旧版角色配置包的职责、权限与版本。导入后先校验并核对字段与激活差异，发布只影响之后新建的会话。"
        actions={
          <div className="row wrap" style={{ gap: 8 }}>
            <LinkButton variant="secondary" size="sm" icon="arrowLeft" to="/roles">
              去角色管理
            </LinkButton>
            <RolePackageImport />
          </div>
        }
      />

      {error !== undefined ? (
        <div style={{ marginTop: 16 }}>
          <ServiceNotice
            error={error}
            onRetry={() => {
              void catalogQuery.refetch();
            }}
            title="角色目录读取失败"
          />
        </div>
      ) : loading ? (
        <div className="card pad" style={{ marginTop: 16 }}>
          <div className="col" style={{ gap: 12 }}>
            <Skeleton height={16} width="36%" />
            <Skeleton height={12} width="58%" />
            <Skeleton height={120} width="100%" radius={12} />
          </div>
        </div>
      ) : roles.length === 0 ? (
        <div style={{ marginTop: 16 }}>
          <EmptyState
            icon="users"
            title="目录里还没有角色"
            description="服务已连接，但角色目录为空。本页不展示示例角色；请先在服务配置里登记角色。"
            action={
              <LinkButton variant="secondary" size="sm" icon="arrowLeft" to="/roles">
                去角色管理
              </LinkButton>
            }
          />
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ marginTop: 16 }}>
          <EmptyState
            icon="search"
            title="没有匹配的角色"
            description="换个关键词；搜索只过滤目录，不会改动任何配置。"
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setKeyword('');
                }}
              >
                清除搜索
              </Button>
            }
          />
        </div>
      ) : (
        <div className="rl-layout">
          <aside className="card rl-catalog" aria-label="历史角色目录">
            <div className="input-wrap rl-search">
              <Icon name="search" size="sm" />
              <input
                className="input ctl"
                placeholder="搜索角色名称或用途"
                aria-label="搜索角色"
                value={keyword}
                onChange={(event) => {
                  setKeyword(event.target.value);
                }}
              />
            </div>
            {[
              { key: 'used', title: '流程使用的角色', items: inUse },
              { key: 'special', title: '专项角色', items: unused },
            ].map((group) =>
              group.items.length === 0 ? null : (
                <div key={group.key} className="rl-group">
                  <div className="rl-group-head">
                    <span>{group.title}</span>
                    <span className="num">{String(group.items.length)}</span>
                  </div>
                  {group.items.map((role) => {
                    const usage = usageByRole.get(role.id) ?? [];
                    return (
                      <button
                        key={role.id}
                        type="button"
                        className="rl-role"
                        aria-current={selected?.id === role.id ? 'true' : undefined}
                        onClick={() => {
                          setSelectedId(role.id);
                        }}
                      >
                        <RoleAvatar role={role} />
                        <span className="grow" style={{ minWidth: 0 }}>
                          <span className="rl-role-name">{role.name}</span>
                          <span className="hint ellipsis rl-role-purpose">{role.purpose}</span>
                          <span className="hint rl-role-meta">
                            修订 {role.revision} ·{' '}
                            {usage.length > 0 ? `${String(usage.length)} 个流程在使用` : '暂无流程使用'}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ),
            )}
            <p className="hint" style={{ padding: '10px 12px', lineHeight: 1.6 }}>
              按当前流程的规划职责与阶段角色绑定统计。
            </p>
          </aside>

          {selected === undefined ? <section className="card pad"><EmptyState icon="users" title="选择一个角色" description="查看职责、权限、Prompt 和已发布版本；更新配置前先导入并核对差异。"/></section> : (
            <section className="card rl-detail" aria-label="历史角色详情">
              <div className="card-head">
                <RoleAvatar role={selected} size="lg" />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row wrap" style={{ gap: 6 }}>
                    <h2 style={{ fontSize: 18, fontWeight: 500 }}>{selected.name}</h2>
                    <Badge tone={selected.status === 'draft' ? 'warn' : 'ok'} icon={selected.status === 'draft' ? 'edit' : 'check'}>
                      {selected.status === 'draft' ? '草稿' : '已发布'}
                    </Badge>
                    {selected.hasDraft ? <Badge tone="warn">有未发布草稿</Badge> : null}
                  </div>
                  <div className="hint mono" style={{ marginTop: 4, wordBreak: 'break-all' }}>
                    {selected.id} · 目录修订 {selected.revision}
                  </div>
                </div>
              </div>
              <div className="card-body" key={selected.id}>
                <RoleHistory role={selected} usage={usageByRole.get(selected.id) ?? []} />
              </div>
            </section>
          )}
        </div>
      )}

      {bootstrap.isError ? (
        <p className="hint" style={{ marginTop: 12 }}>
          流程目录读取失败（{errorMessage(bootstrap.error)}），因此「所属流程」只显示空；角色目录与历史仍来自服务。
        </p>
      ) : null}
    </div>
  );
}
