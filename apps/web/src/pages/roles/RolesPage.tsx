import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RoleCatalogEntry, RoleDefinition } from '@agent-workflow/shared';
import { errorMessage, isServiceUnavailable } from '../../api/client.ts';
import { archiveRole, fetchRoleCatalog, publishRole, saveRoleDraft } from '../../api/catalog-editor.ts';
import { Modal } from '../../components/Modal.tsx';
import { useBootstrap } from '../../api/hooks.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { EmptyState, Skeleton } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';


function RoleAvatar({ role }: { readonly role: RoleDefinition }) {
  const initial = role.name.trim().slice(0, 1);
  return (
    <span className="tile" aria-hidden="true" style={{ fontSize: 14, fontWeight: 600 }}>
      {initial.length === 0 ? '?' : initial}
    </span>
  );
}

interface RoleDetailProps {
  readonly role: RoleDefinition & Pick<RoleCatalogEntry, 'status' | 'hasDraft' | 'baseId'>;
  readonly methods: readonly { readonly id: string; readonly name: string; readonly revision: string }[];
  readonly busy: boolean;
  readonly onEdit: () => void;
  readonly onPublish: () => void;
  readonly onArchive: () => void;
}

function RoleDetail({ role, methods, busy, onEdit, onPublish, onArchive }: RoleDetailProps) {
  return (
    <section className="card solid" aria-label="职业详情" style={{ padding: 20 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <RoleAvatar role={role} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row wrap" style={{ gap: 6 }}>
            <h2 style={{ fontSize: 18, fontWeight: 500 }}>{role.name}</h2>
            <Badge tone={role.hasDraft ? 'warn' : 'ok'} icon={role.hasDraft ? 'edit' : 'check'}>
              {role.hasDraft ? '草稿待发布' : `目录修订 ${role.revision}`}
            </Badge>
            {role.baseId === undefined && role.status === 'draft' ? <Badge tone="warn">未发布</Badge> : null}
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
        <Button variant="secondary" icon="edit" disabled={busy} onClick={onEdit}>
          编辑职业
        </Button>
        <Button variant="primary" icon="upload" disabled={!role.hasDraft || busy} disabledReason={!role.hasDraft ? '没有待发布的草稿。' : undefined} onClick={onPublish}>
          {busy ? '处理中…' : '发布草稿'}
        </Button>
        <Button variant="ghost" icon="trash" disabled={busy} onClick={onArchive}>
          {role.baseId === undefined && role.status === 'draft' ? '删除草稿' : '还原/归档'}
        </Button>
      </div>
      <p className="hint" style={{ marginTop: 8 }}>
        发布后新修订立即生效；已冻结的任务仍使用创建时的职业修订。发布不会改动提示词正文以外的运行配置。
      </p>
    </section>
  );
}

export function RolesPage() {
  const bootstrap = useBootstrap();
  const queryClient = useQueryClient();
  const catalogQuery = useQuery({ queryKey: ['catalog', 'roles'], queryFn: fetchRoleCatalog, retry: false });
  const roles = (catalogQuery.data?.roles ?? bootstrap.data?.catalog.roles ?? []) as (RoleDefinition & Pick<RoleCatalogEntry, 'status' | 'hasDraft' | 'baseId'>)[];
  const methods = bootstrap.data?.catalog.methods ?? [];
  const [keyword, setKeyword] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ roleId?: string; name: string; purpose: string; responsibilities: string } | null>(null);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['catalog', 'roles'] }),
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
    ]);
  };
  const saveMutation = useMutation({
    mutationFn: async (input: { roleId?: string; name: string; purpose: string; responsibilities: string }) =>
      saveRoleDraft({
        ...(input.roleId === undefined ? {} : { roleId: input.roleId }),
        name: input.name,
        purpose: input.purpose,
        responsibilities: input.responsibilities.split(/\n+/).map((line) => line.trim()).filter((line) => line.length > 0),
      }),
    onSuccess: async (next) => {
      setFailure(undefined);
      setEditor(null);
      queryClient.setQueryData(['catalog', 'roles'], next);
      await invalidate();
    },
    onError: (error) => setFailure(isServiceUnavailable(error) ? '服务未连接，草稿未保存。' : errorMessage(error)),
  });
  const publishMutation = useMutation({
    mutationFn: (roleId: string) => publishRole(roleId),
    onSuccess: async (next) => {
      setFailure(undefined);
      queryClient.setQueryData(['catalog', 'roles'], next);
      await invalidate();
    },
    onError: (error) => setFailure(isServiceUnavailable(error) ? '服务未连接，未发布。' : errorMessage(error)),
  });
  const archiveMutation = useMutation({
    mutationFn: (roleId: string) => archiveRole(roleId),
    onSuccess: async (next) => {
      setFailure(undefined);
      queryClient.setQueryData(['catalog', 'roles'], next);
      await invalidate();
    },
    onError: (error) => setFailure(isServiceUnavailable(error) ? '服务未连接，未归档。' : errorMessage(error)),
  });
  const busy = publishMutation.isPending || archiveMutation.isPending || saveMutation.isPending;
  const openEditor = (role?: RoleDefinition) => {
    setFailure(undefined);
    setEditor(
      role === undefined
        ? { name: '', purpose: '', responsibilities: '' }
        : { roleId: role.id, name: role.name, purpose: role.purpose, responsibilities: role.responsibilities.join('\n') },
    );
  };

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
          <div className="row" style={{ padding: '8px 12px' }}>
            <Button variant="secondary" size="sm" icon="plus" onClick={() => { openEditor(); }}>新建职业</Button>
          </div>
          <p className="hint" style={{ padding: '10px 12px 8px', lineHeight: 1.6 }}>
            草稿保存在服务端，发布后立即生效；内置职业可定制，自定义职业可归档。
          </p>
        </aside>
        {selected === undefined ? null : (
          <RoleDetail
            role={selected}
            methods={planningMethods}
            busy={busy}
            onEdit={() => { openEditor(selected); }}
            onPublish={() => { publishMutation.mutate(selected.id); }}
            onArchive={() => { archiveMutation.mutate(selected.id); }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="角色管理"
        lede="职业定义职责与提示词修订；流程把它指定为规划或执行职责。草稿保存、发布与归档由服务端执行。"
        actions={
          <Button variant="secondary" size="sm" icon="edit" onClick={() => { openEditor(); }}>
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
      {failure === undefined ? null : <p className="hint" style={{ marginTop: 12, color: 'var(--danger)' }}>{failure}</p>}
      <Modal
        open={editor !== null}
        title={editor?.roleId === undefined ? '新建职业' : '编辑职业草稿'}
        onClose={() => { setEditor(null); }}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setEditor(null); }}>取消</Button>
            <span className="spacer" />
            <Button
              variant="primary"
              icon="check"
              disabled={saveMutation.isPending || (editor?.name.trim().length ?? 0) === 0 || (editor?.purpose.trim().length ?? 0) === 0}
              onClick={() => { if (editor !== null) saveMutation.mutate(editor); }}
            >
              {saveMutation.isPending ? '保存中…' : '保存草稿'}
            </Button>
          </>
        }
      >
        {editor === null ? null : (
          <div className="stack-loose">
            <label className="form-label">
              名称
              <input className="input" value={editor.name} maxLength={60} onChange={(event) => { setEditor({ ...editor, name: event.target.value }); }} />
            </label>
            <label className="form-label">
              职业定位
              <textarea className="textarea" value={editor.purpose} maxLength={1000} onChange={(event) => { setEditor({ ...editor, purpose: event.target.value }); }} />
            </label>
            <label className="form-label">
              职责（每行一条，1–12 条）
              <textarea className="textarea" value={editor.responsibilities} onChange={(event) => { setEditor({ ...editor, responsibilities: event.target.value }); }} />
            </label>
            <p className="hint">保存只产生草稿；发布后才会进入新会话的职业目录。已冻结任务不受影响。</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
