import { useMemo, useState, type ReactNode } from 'react';
import type { RoleDefinition } from '@agent-workflow/shared';
import { useBootstrap } from '../../api/hooks.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { EmptyState, Skeleton } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';

const EDIT_BLOCKED_REASON = '角色编辑接口尚未接通：服务端只提供 catalog.roles 目录读取，没有草稿 / 发布 / 权限写入接口。';

function RoleAvatar({ role }: { readonly role: RoleDefinition }) {
  const initial = role.name.trim().slice(0, 1);
  return (
    <span className="tile" aria-hidden="true" style={{ fontSize: 14, fontWeight: 600 }}>
      {initial.length === 0 ? '?' : initial}
    </span>
  );
}

function RoleDetail({ role, methods }: { readonly role: RoleDefinition; readonly methods: readonly { readonly id: string; readonly name: string; readonly revision: string }[] }) {
  return (
    <section className="card solid" aria-label="职业详情" style={{ padding: 20 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <RoleAvatar role={role} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row wrap" style={{ gap: 6 }}>
            <h2 style={{ fontSize: 18, fontWeight: 500 }}>{role.name}</h2>
            <Badge tone="ok" icon="check">
              目录修订 {role.revision}
            </Badge>
            <Badge outline icon="lock">
              只读
            </Badge>
          </div>
          <div className="hint mono" style={{ marginTop: 4 }}>
            {role.id}
          </div>
        </div>
      </div>

      <p className="sub" style={{ fontSize: 13.5, lineHeight: 1.65, marginTop: 14 }}>
        {role.purpose}
      </p>

      <div className="section" style={{ marginTop: 20 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          职责范围
        </div>
        <ul className="list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {role.responsibilities.map((item) => (
            <li key={item} className="row" style={{ padding: '6px 0', gap: 8, alignItems: 'flex-start' }}>
              <Icon name="check" size="sm" />
              <span style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="section">
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          版本
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="chip">
            职业修订 <span className="mono">{role.revision}</span>
          </span>
          <span className="chip">
            提示词修订 <span className="mono">{role.promptRevision}</span>
          </span>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          任务创建时会冻结当时的职业与提示词修订；目录发布新修订不会改变已冻结的任务。
        </p>
      </div>

      <div className="section">
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          作为规划职责被使用 · {methods.length} 个流程
        </div>
        {methods.length === 0 ? (
          <p className="hint">当前目录中没有流程把该角色指定为规划职责。</p>
        ) : (
          <div className="col" style={{ gap: 6 }}>
            {methods.map((method) => (
              <div key={method.id} className="row" style={{ gap: 8 }}>
                <Icon name="flow" size="sm" />
                <span style={{ fontSize: 13.5 }}>{method.name}</span>
                <span className="hint mono">{method.revision}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="row wrap" style={{ gap: 8, marginTop: 20 }}>
        <Button variant="secondary" icon="edit" disabled disabledReason={EDIT_BLOCKED_REASON}>
          编辑职业
        </Button>
        <Button variant="ghost" icon="upload" disabled disabledReason={EDIT_BLOCKED_REASON}>
          检查并发布
        </Button>
      </div>
      <p className="hint" style={{ marginTop: 8 }}>
        角色目录来自 /api/bootstrap 的 catalog.roles；当前为只读展示，不显示示例草稿或发布记录。
      </p>
    </section>
  );
}

export function RolesPage() {
  const bootstrap = useBootstrap();
  const roles = bootstrap.data?.catalog.roles ?? [];
  const methods = bootstrap.data?.catalog.methods ?? [];
  const [keyword, setKeyword] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    if (needle.length === 0) return roles;
    return roles.filter((role) => [role.name, role.purpose, role.id, ...role.responsibilities].join(' ').toLowerCase().includes(needle));
  }, [keyword, roles]);

  const selected = filtered.find((role) => role.id === selectedId) ?? filtered[0];

  const planningMethods = useMemo(() => {
    if (selected === undefined) return [];
    return methods
      .filter((method) => method.planningStrategy?.roleId === selected.id)
      .map((method) => ({ id: method.id, name: method.name, revision: method.revision }));
  }, [methods, selected]);

  let body: ReactNode;
  if (bootstrap.isLoading) {
    body = (
      <div className="card" style={{ padding: 16 }}>
        {[0, 1, 2].map((index) => (
          <div key={index} className="row" style={{ padding: '12px 0', gap: 12 }}>
            <Skeleton width={36} height={36} radius={10} />
            <div className="col grow" style={{ gap: 6 }}>
              <Skeleton width="34%" height={13} />
              <Skeleton width="58%" height={11} />
            </div>
          </div>
        ))}
      </div>
    );
  } else if (bootstrap.isError) {
    body = (
      <ServiceNotice
        error={bootstrap.error}
        onRetry={() => {
          void bootstrap.refetch();
        }}
      />
    );
  } else if (roles.length === 0) {
    body = <EmptyState icon="users" title="目录里还没有角色" description="服务已连接，但 catalog.roles 为空；角色由共享契约配置，本页不新增。" />;
  } else if (filtered.length === 0) {
    body = <EmptyState icon="search" title="没有匹配的角色" description="换个关键词，或清空搜索。" />;
  } else {
    body = (
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 340px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <aside className="card" aria-label="职业目录" style={{ padding: 6 }}>
          {filtered.map((role) => (
            <button
              key={role.id}
              type="button"
              className="list-row"
              aria-selected={selected?.id === role.id}
              onClick={() => {
                setSelectedId(role.id);
              }}
            >
              <RoleAvatar role={role} />
              <span className="grow" style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5 }}>{role.name}</span>
                <span className="hint" style={{ display: 'block', marginTop: 2 }}>
                  修订 {role.revision} · 提示词 {role.promptRevision}
                </span>
              </span>
              <Icon name="chevRight" size="sm" />
            </button>
          ))}
          <p className="hint" style={{ padding: '10px 12px 8px', lineHeight: 1.6 }}>
            角色目录是只读配置。编辑、发布与权限设置需要服务端新增接口后再接通。
          </p>
        </aside>
        {selected === undefined ? null : <RoleDetail role={selected} methods={planningMethods} />}
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="角色管理"
        lede="职业定义职责与提示词修订；流程把它指定为规划或执行职责。当前目录只读，编辑接口尚未接通。"
        actions={
          <Button variant="secondary" size="sm" icon="edit" disabled disabledReason={EDIT_BLOCKED_REASON}>
            新建职业
          </Button>
        }
      />
      <div className="toolbar">
        <div className="input-wrap">
          <Icon name="search" />
          <input
            className="input ctl"
            placeholder="搜索职业名称、职责或标识"
            aria-label="搜索职业"
            value={keyword}
            onChange={(event) => {
              setKeyword(event.target.value);
            }}
          />
        </div>
        <span className="spacer" />
        <span className="hint">共 {String(roles.length)} 个职业 · 来自共享契约目录</span>
      </div>
      {body}
    </div>
  );
}
