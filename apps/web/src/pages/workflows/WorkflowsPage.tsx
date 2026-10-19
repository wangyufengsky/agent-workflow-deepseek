import { useMemo, useState, type ReactNode } from 'react';
import { TaskMethodSupport, type WorkflowMethod } from '@agent-workflow/shared';
import { useBootstrap } from '../../api/hooks.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button, LinkButton } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { EmptyState, Skeleton } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { SegmentedControl, type SegmentOption } from '../../components/SegmentedControl.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';

const EDIT_BLOCKED_REASON = '流程编辑接口尚未接通：服务端目前只提供目录读取（bootstrap.catalog.methods），不提供流程写入。';

type SupportFilter = 'all' | 'ai' | 'skeleton';

function supportBadge(method: WorkflowMethod) {
  return method.support === TaskMethodSupport.AI_PLANNING ? (
    <Badge tone="accent" icon="sparkle">
      AI 规划
    </Badge>
  ) : (
    <Badge tone="idle" icon="layers">
      仅方法骨架
    </Badge>
  );
}

function StepList({ method }: { readonly method: WorkflowMethod }) {
  return (
    <ol className="list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {method.requiredSteps.map((step, index) => (
        <li key={step.key} className="list-row" style={{ cursor: 'default' }}>
          <span className="badge neutral num" aria-hidden="true">
            {String(index + 1)}
          </span>
          <span className="grow" style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 13.5 }}>{step.title}</span>
            <span className="hint mono">{step.key}</span>
          </span>
          <Badge outline>{step.group}</Badge>
          {step.optional === true ? <Badge tone="idle">可选</Badge> : null}
        </li>
      ))}
    </ol>
  );
}

function MethodDetail({ method, roleName, taskTypes }: {
  readonly method: WorkflowMethod;
  readonly roleName: string | null;
  readonly taskTypes: readonly { readonly id: string; readonly name: string }[];
}) {
  const strategy = method.planningStrategy;
  return (
    <aside className="card solid" aria-label="流程详情" style={{ padding: 20, position: 'sticky', top: 24 }}>
      <div className="row wrap" style={{ gap: 6 }}>
        <Badge outline icon="flow">
          目录流程
        </Badge>
        <Badge outline>
          版本 {method.revision}
        </Badge>
        {supportBadge(method)}
      </div>
      <h2 style={{ fontSize: 18, fontWeight: 500, marginTop: 10 }}>{method.name}</h2>
      <p className="sub" style={{ fontSize: 13.5, lineHeight: 1.65, marginTop: 6 }}>
        {method.description}
      </p>

      <div className="section" style={{ marginTop: 20 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>
          必经步骤 · {method.requiredSteps.length} 个
        </div>
        <StepList method={method} />
        <p className="hint" style={{ marginTop: 8 }}>
          必经步骤由流程版本固定；确认计划、开始执行都在具体任务里操作，本页只读。
        </p>
      </div>

      <div className="section">
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          {method.support === TaskMethodSupport.AI_PLANNING ? 'AI 规划 · 只读' : '规划能力'}
        </div>
        {strategy === undefined ? (
          <p className="hint">
            该流程未配置 AI 规划策略，只能使用方法骨架并手动调整步骤；页面不提供替代的模拟规划。
          </p>
        ) : (
          <div className="card pad" style={{ background: 'var(--fill-2)', padding: 14 }}>
            <dl className="kv" style={{ gridTemplateColumns: '88px minmax(0,1fr)', fontSize: 12.5 }}>
              <dt>规划策略</dt>
              <dd>
                <span className="mono">{strategy.id}</span> · {strategy.version}
              </dd>
              <dt>规划职责</dt>
              <dd>
                {roleName ?? strategy.roleId}
                {roleName === null ? <span className="hint">（角色目录未找到）</span> : null}
              </dd>
              <dt>可细化分组</dt>
              <dd>{method.refinableGroups.length === 0 ? '无可细化分组' : method.refinableGroups.join('、')}</dd>
              <dt>不可弱化</dt>
              <dd>全部必经步骤，以及交付 / 验收步骤。</dd>
            </dl>
          </div>
        )}
      </div>

      <div className="section">
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          可用的任务类型 · {taskTypes.length} 个
        </div>
        {taskTypes.length === 0 ? (
          <p className="hint">目录里还没有任务类型引用这个流程。</p>
        ) : (
          <div className="row wrap" style={{ gap: 6 }}>
            {taskTypes.map((type) => (
              <span key={type.id} className="chip">
                <Icon name="template" size="sm" />
                {type.name}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="row wrap" style={{ gap: 8, marginTop: 20 }}>
        <LinkButton to={`/start?methodId=${encodeURIComponent(method.id)}`} variant="primary" icon="play">
          用这个流程开始任务
        </LinkButton>
        <Button variant="secondary" icon="edit" disabled disabledReason={EDIT_BLOCKED_REASON}>
          编辑流程
        </Button>
      </div>
      <p className="hint" style={{ marginTop: 8 }}>
        开始任务向导已接通：点「用这个流程开始任务」→ 填写需求并创建任务，随后进入 AI 规划/确认/执行。本页只读流程定义；编辑/导入流程定义尚未开放。
      </p>
    </aside>
  );
}

export function WorkflowsPage() {
  const bootstrap = useBootstrap();
  const methods = bootstrap.data?.catalog.methods ?? [];
  const roles = bootstrap.data?.catalog.roles ?? [];
  const taskTypes = bootstrap.data?.catalog.taskTypes ?? [];
  const [keyword, setKeyword] = useState('');
  const [support, setSupport] = useState<SupportFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const result = { all: methods.length, ai: 0, skeleton: 0 };
    for (const method of methods) {
      if (method.support === TaskMethodSupport.AI_PLANNING) result.ai += 1;
      else result.skeleton += 1;
    }
    return result;
  }, [methods]);

  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    return methods.filter((method) => {
      if (support === 'ai' && method.support !== TaskMethodSupport.AI_PLANNING) return false;
      if (support === 'skeleton' && method.support !== TaskMethodSupport.SKELETON_ONLY) return false;
      if (needle.length === 0) return true;
      const haystack = [method.name, method.description, method.id, ...method.requiredSteps.map((step) => step.title)].join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  }, [keyword, methods, support]);

  const selected = filtered.find((method) => method.id === selectedId) ?? filtered[0];
  const roleNameById = useMemo(() => new Map(roles.map((role) => [role.id, role.name])), [roles]);

  const filterOptions: readonly SegmentOption<SupportFilter>[] = [
    { value: 'all', label: '全部', count: counts.all },
    { value: 'ai', label: '支持 AI 规划', count: counts.ai },
    { value: 'skeleton', label: '仅骨架', count: counts.skeleton },
  ];

  let body: ReactNode;
  if (bootstrap.isLoading) {
    body = (
      <div className="card" style={{ padding: 16 }}>
        {[0, 1, 2].map((index) => (
          <div key={index} className="row" style={{ padding: '12px 0', gap: 12 }}>
            <Skeleton width={36} height={36} radius={10} />
            <div className="col grow" style={{ gap: 6 }}>
              <Skeleton width="38%" height={13} />
              <Skeleton width="64%" height={11} />
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
  } else if (methods.length === 0) {
    body = <EmptyState icon="flow" title="目录里还没有流程方法" description="服务已连接，但 catalog.methods 为空。流程方法由共享契约定义，不在此页新增。" />;
  } else if (filtered.length === 0) {
    body = <EmptyState icon="search" title="没有匹配的流程" description="换个关键词，或切换到「全部」。" />;
  } else {
    body = (
      <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 1fr) 420px', alignItems: 'start' }}>
        <section className="card" aria-label="流程目录">
          <div className="list" style={{ padding: 6 }}>
            {filtered.map((method) => (
              <button
                key={method.id}
                type="button"
                className="list-row"
                aria-selected={selected?.id === method.id}
                onClick={() => {
                  setSelectedId(method.id);
                }}
              >
                <span className="tile">
                  <Icon name="flow" />
                </span>
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="row wrap" style={{ gap: 8 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 500 }}>{method.name}</span>
                    {supportBadge(method)}
                  </span>
                  <span className="hint" style={{ display: 'block', marginTop: 3, lineHeight: 1.5 }}>
                    {method.description}
                  </span>
                </span>
                <span className="col" style={{ alignItems: 'flex-end', gap: 4 }}>
                  <span className="hint mono">{method.revision}</span>
                  <span className="hint num">{method.requiredSteps.length} 步</span>
                </span>
                <Icon name="chevRight" size="sm" />
              </button>
            ))}
          </div>
          <div className="row" style={{ padding: '10px 14px 12px', boxShadow: 'inset 0 1px 0 var(--line)' }}>
            <span className="hint grow">共 {String(filtered.length)} 个流程方法 · 目录只读</span>
            <span className="hint">按目录顺序</span>
          </div>
        </section>
        {selected === undefined ? null : (
          <MethodDetail
            method={selected}
            roleName={selected.planningStrategy === undefined ? null : (roleNameById.get(selected.planningStrategy.roleId) ?? null)}
            taskTypes={taskTypes.filter((type) => type.methodId === selected.id)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="流程"
        lede="把常用的做事步骤沉淀成流程；开始任务时直接套用。流程方法来自共享契约的目录快照，本页只读。"
        actions={
          <Button variant="secondary" size="sm" icon="edit" disabled disabledReason={EDIT_BLOCKED_REASON}>
            新建流程
          </Button>
        }
      />

      <div className="toolbar">
        <div className="input-wrap">
          <Icon name="search" />
          <input
            className="input ctl"
            placeholder="搜索名称、说明或步骤"
            aria-label="搜索流程"
            value={keyword}
            onChange={(event) => {
              setKeyword(event.target.value);
            }}
          />
        </div>
        <SegmentedControl ariaLabel="规划支持" options={filterOptions} value={support} onChange={setSupport} />
        <span className="spacer" />
        <span className="hint">修订号标识流程版本；任务创建时冻结。</span>
      </div>

      {body}
    </div>
  );
}
