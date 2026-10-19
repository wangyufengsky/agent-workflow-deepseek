import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { InboxKind, type InboxItem, type InboxKindValue } from '@agent-workflow/shared';
import { useBootstrap } from '../../api/hooks.ts';
import { formatRelativeTime } from '../../app/format.ts';
import { Badge, type BadgeTone } from '../../components/Badge.tsx';
import { LinkButton } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { EmptyState, Skeleton } from '../../components/EmptyState.tsx';
import { Icon, type IconName } from '../../components/Icon.tsx';
import { SegmentedControl, type SegmentOption } from '../../components/SegmentedControl.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';

type InboxFilter = 'all' | 'planning' | 'delivery' | 'failure';

interface KindMeta {
  readonly label: string;
  readonly icon: IconName;
  readonly tone: BadgeTone;
  readonly group: Exclude<InboxFilter, 'all'>;
  readonly actionLabel: string;
}

const KIND_META: Record<InboxKindValue, KindMeta> = {
  [InboxKind.PLANNING_ANSWER]: { label: '规划答复', icon: 'help', tone: 'wait', group: 'planning', actionLabel: '需求画布' },
  [InboxKind.PLANNING_REVIEW]: { label: '候选审阅', icon: 'eye', tone: 'wait', group: 'planning', actionLabel: '需求画布' },
  [InboxKind.PLANNING_RECONCILE]: { label: '停止核对', icon: 'refresh', tone: 'unknown', group: 'planning', actionLabel: '需求画布' },
  [InboxKind.DELIVERY_CONFIRM]: { label: '交付确认', icon: 'upload', tone: 'wait', group: 'delivery', actionLabel: '任务画布' },
  [InboxKind.EXECUTION_FAILED]: { label: '执行失败', icon: 'alert', tone: 'stall', group: 'failure', actionLabel: '任务画布' },
};

const FILTER_LABEL: Record<InboxFilter, string> = {
  all: '全部',
  planning: '规划',
  delivery: '交付',
  failure: '失败',
};

function targetHref(item: InboxItem): string {
  const base =
    item.kind === InboxKind.DELIVERY_CONFIRM || item.kind === InboxKind.EXECUTION_FAILED
      ? `/tasks/${encodeURIComponent(item.taskId)}`
      : `/requirement/${encodeURIComponent(item.taskId)}`;
  return `${base}?returnTo=${encodeURIComponent('/inbox')}`;
}

function ItemRow({ item, selected, onSelect }: { readonly item: InboxItem; readonly selected: boolean; readonly onSelect: () => void }) {
  const meta = KIND_META[item.kind];
  return (
    <button type="button" className="list-row" aria-selected={selected} onClick={onSelect} style={{ alignItems: 'flex-start' }}>
      <span className="tile" style={{ color: meta.tone === 'wait' ? 'var(--wait)' : meta.tone === 'stall' ? 'var(--stall)' : 'var(--unknown)' }}>
        <Icon name={meta.icon} />
      </span>
      <span className="grow" style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 500, lineHeight: 1.45 }}>{item.title}</span>
        <span className="hint" style={{ display: 'block', marginTop: 3 }}>
          {item.taskTitle} · {item.projectName}
        </span>
        <span className="hint" style={{ display: 'block', marginTop: 2 }}>
          {formatRelativeTime(item.createdAt)}
        </span>
      </span>
      <Badge tone={meta.tone} icon={meta.icon}>
        {meta.label}
      </Badge>
    </button>
  );
}

function Detail({ item }: { readonly item: InboxItem }) {
  const meta = KIND_META[item.kind];
  const href = targetHref(item);
  const canvasName = href.startsWith('/requirement') ? '需求画布' : '任务画布';
  return (
    <section className="card solid fade" aria-label="待处理事项详情" style={{ padding: 20, position: 'sticky', top: 24 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <Badge tone={meta.tone} icon={meta.icon}>
          {meta.label}
        </Badge>
        <span className="hint">创建 {formatRelativeTime(item.createdAt)}</span>
      </div>
      <h2 style={{ fontSize: 19, fontWeight: 500, marginTop: 12 }}>{item.title}</h2>
      <p className="sub" style={{ fontSize: 13.5, lineHeight: 1.65, marginTop: 10 }}>
        {item.detail.trim().length === 0 ? '服务没有为该事项提供补充说明。' : item.detail}
      </p>

      <div className="ctx" style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'center', padding: '12px 14px', borderRadius: 12, background: 'var(--fill-2)', border: '1px solid var(--line)', flexWrap: 'wrap' }}>
        <Icon name="list" size="sm" />
        <span style={{ fontSize: 13 }}>
          来自 <b style={{ fontWeight: 500 }}>{item.taskTitle}</b> · {item.projectName}
        </span>
        <span className="spacer" />
        <span className="hint mono">{item.taskId}</span>
      </div>

      <dl className="kv" style={{ gridTemplateColumns: '92px minmax(0,1fr)', fontSize: 12.5, marginTop: 16 }}>
        <dt>类型</dt>
        <dd>{meta.label}</dd>
        <dt>项目</dt>
        <dd>{item.projectName}</dd>
        <dt>任务</dt>
        <dd className="mono-wrap">{item.taskId}</dd>
        <dt>画布</dt>
        <dd className="mono-wrap">{canvasName}</dd>
      </dl>

      <div className="banner info" style={{ marginTop: 18 }}>
        <Icon name="info" />
        <div className="grow">
          答复、审阅、交付确认与失败恢复都在对应画布里完成；本页只做汇总和跳转，避免重复提交。
        </div>
      </div>

      <div className="row wrap" style={{ gap: 8, marginTop: 18 }}>
        <LinkButton to={href} variant="primary" iconAfter="arrowRight">
          打开{canvasName}
        </LinkButton>
        <Link className="btn ghost sm" to="/requirements">
          <Icon name="file" size="sm" />
          返回需求目录
        </Link>
      </div>
      <p className="hint" style={{ marginTop: 8 }}>
        跳转会带上 returnTo=/inbox，以便画布返回待处理中心。
      </p>
    </section>
  );
}

export function InboxPage() {
  const bootstrap = useBootstrap();
  const inbox = bootstrap.data?.inbox ?? [];
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const result: Record<InboxFilter, number> = { all: inbox.length, planning: 0, delivery: 0, failure: 0 };
    for (const item of inbox) result[KIND_META[item.kind].group] += 1;
    return result;
  }, [inbox]);

  const filtered = useMemo(() => {
    if (filter === 'all') return inbox;
    return inbox.filter((item) => KIND_META[item.kind].group === filter);
  }, [filter, inbox]);

  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0];

  const grouped = useMemo(() => {
    const order: readonly InboxKindValue[] = [InboxKind.PLANNING_ANSWER, InboxKind.PLANNING_REVIEW, InboxKind.PLANNING_RECONCILE, InboxKind.DELIVERY_CONFIRM, InboxKind.EXECUTION_FAILED];
    return order
      .map((kind) => ({ kind, label: KIND_META[kind].label, items: filtered.filter((item) => item.kind === kind) }))
      .filter((group) => group.items.length > 0);
  }, [filtered]);

  const filterOptions: readonly SegmentOption<InboxFilter>[] = [
    { value: 'all', label: FILTER_LABEL.all, count: counts.all },
    { value: 'planning', label: FILTER_LABEL.planning, count: counts.planning },
    { value: 'delivery', label: FILTER_LABEL.delivery, count: counts.delivery },
    { value: 'failure', label: FILTER_LABEL.failure, count: counts.failure },
  ];

  let body: ReactNode;
  if (bootstrap.isLoading) {
    body = (
      <div className="card" style={{ padding: 16 }}>
        {[0, 1, 2].map((index) => (
          <div key={index} className="row" style={{ padding: '12px 0', gap: 12 }}>
            <Skeleton width={36} height={36} radius={10} />
            <div className="col grow" style={{ gap: 6 }}>
              <Skeleton width="48%" height={13} />
              <Skeleton width="30%" height={11} />
            </div>
            <Skeleton width={76} height={22} radius={99} />
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
  } else if (inbox.length === 0) {
    body = (
      <div className="card">
        <EmptyState
          icon="check"
          title="都处理完了"
          description="任务需要你回答问题、审阅候选、确认交付或处理执行失败时，会出现在这里。"
          action={
            <LinkButton to="/tasks" variant="secondary" size="sm" icon="list">
              查看任务列表
            </LinkButton>
          }
        />
      </div>
    );
  } else if (filtered.length === 0) {
    body = <EmptyState icon="search" title="这一类暂时没有事项" description="切回「全部」，或等待任务进入需要你处理的状态。" />;
  } else {
    body = (
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 440px)', gap: 16, alignItems: 'start' }}>
        <section className="card" aria-label="待处理事项">
          <div style={{ padding: 6 }}>
            {grouped.map((group) => (
              <div key={group.kind}>
                <div className="row" style={{ padding: '10px 12px 4px', gap: 8 }}>
                  <span className="eyebrow grow">
                    {group.label} · {String(group.items.length)}
                  </span>
                </div>
                {group.items.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    selected={selected?.id === item.id}
                    onSelect={() => {
                      setSelectedId(item.id);
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="row" style={{ padding: '10px 14px 12px', boxShadow: 'inset 0 1px 0 var(--line)' }}>
            <span className="hint grow">共 {String(filtered.length)} 项 · 最近更新在前</span>
            <Link className="btn ghost sm" to="/tasks">
              任务列表
            </Link>
          </div>
        </section>
        {selected === undefined ? null : <Detail item={selected} />}
      </div>
    );
  }

  return (
    <div className="page wide">
      <PageHeader
        title="待处理中心"
        lede="执行中的任务需要你回答问题、审阅候选、确认交付或处理后，会停下来在这里等你。列表来自 /api/bootstrap 的 inbox，真实条目按类型分组。"
        actions={
          <button
            type="button"
            className="icon-btn"
            aria-label="刷新待处理事项"
            title="刷新待处理事项"
            onClick={() => {
              void bootstrap.refetch();
            }}
          >
            <Icon name="refresh" />
          </button>
        }
      />

      <div className="toolbar">
        <SegmentedControl ariaLabel="事项类型" options={filterOptions} value={filter} onChange={setFilter} />
        <span className="spacer" />
        <span className="hint">与任务列表「需要处理」同一口径 · 规划事项在需求画布处理</span>
      </div>

      {body}
    </div>
  );
}
