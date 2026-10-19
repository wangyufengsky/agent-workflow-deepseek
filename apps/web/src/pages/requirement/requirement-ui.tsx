import type { ReactNode } from 'react';
import {
  NODE_STATUS_LABEL,
  PLAN_REVISION_STATUS_LABEL,
  type ActionAvailability,
  type ExecutionView,
  type PlanNode,
  type PlanRevision,
  type PlanValidation,
  type PlanningRound,
} from '@agent-workflow/shared';
import { Badge } from '../../components/Badge.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Icon, type IconName } from '../../components/Icon.tsx';
import { formatDateTime } from '../../app/format.ts';
import { NODE_KIND_LABEL } from '../../flow/types.ts';
import { planStatusText, roundLabel } from './requirement-utils.ts';

export function PanelEmpty({ icon = 'info', title, description, action, compact = true }: { readonly icon?: IconName; readonly title: string; readonly description?: ReactNode; readonly action?: ReactNode; readonly compact?: boolean }) {
  return <EmptyState compact={compact} icon={icon} title={title} description={description} action={action} />;
}

export function Section({ title, aside, children, className }: { readonly title: ReactNode; readonly aside?: ReactNode; readonly children: ReactNode; readonly className?: string }) {
  return (
    <section className={['panel-section', className ?? ''].filter(Boolean).join(' ')}>
      <div className="sec-h">
        <h3 className="grow">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function RevisionMeta({ plan }: { readonly plan: PlanRevision }) {
  return (
    <dl className="kv-list">
      <dt>计划修订</dt>
      <dd>
        #{plan.revisionNumber} · {PLAN_REVISION_STATUS_LABEL[plan.status]}
      </dd>
      <dt>来源</dt>
      <dd>{plan.source}</dd>
      <dt>步骤 / 依赖</dt>
      <dd>
        {String(plan.graph.nodes.length)} 步 · {String(plan.graph.edges.length)} 条依赖 · {String(plan.graph.groups.length)} 组
      </dd>
      <dt>创建</dt>
      <dd>{formatDateTime(plan.createdAt)}</dd>
      {plan.confirmedAt === undefined ? null : (
        <>
          <dt>确认</dt>
          <dd>
            {formatDateTime(plan.confirmedAt)}
            {plan.confirmedBy === undefined ? '' : ` · ${plan.confirmedBy}`}
          </dd>
        </>
      )}
      {plan.baseRevisionId === undefined ? null : (
        <>
          <dt>基于修订</dt>
          <dd className="mono">{plan.baseRevisionId}</dd>
        </>
      )}
    </dl>
  );
}

export function RoundMeta({ round }: { readonly round: PlanningRound }) {
  return (
    <dl className="kv-list">
      <dt>轮次</dt>
      <dd>{roundLabel(round)}</dd>
      <dt>方法</dt>
      <dd>
        {round.method.name} · {round.method.revision}
      </dd>
      <dt>策略</dt>
      <dd>
        {round.strategy.id} · {round.strategy.version}
      </dd>
      <dt>模型</dt>
      <dd>{round.model.label}</dd>
      <dt>输入修订</dt>
      <dd>需求输入修订 {String(round.inputRevision)}</dd>
      <dt>开始</dt>
      <dd>{formatDateTime(round.startedAt)}</dd>
      {round.endedAt === undefined ? null : (
        <>
          <dt>结束</dt>
          <dd>{formatDateTime(round.endedAt)}</dd>
        </>
      )}
    </dl>
  );
}

export function CoverageTable({ coverage, execution }: { readonly coverage: PlanValidation['requirementCoverage']; readonly execution?: ExecutionView }) {
  if (coverage.length === 0) {
    return <PanelEmpty icon="target" title="服务未返回需求覆盖表" description="没有覆盖表时不推断覆盖关系；可重新读取或稍后再看。" />;
  }
  const statusByNode = new Map((execution?.nodes ?? []).map((node) => [node.nodeId, node.status]));
  return (
    <table className="cov">
      <thead>
        <tr>
          <th>需求 / 方法步骤</th>
          <th>覆盖</th>
          <th>步骤 · 执行结果</th>
        </tr>
      </thead>
      <tbody>
        {coverage.map((row) => (
          <tr key={row.requirementId}>
            <td>
              <span className="mono">{row.requirementId}</span>
              <br />
              {row.label}
            </td>
            <td>
              <Badge tone={row.covered ? 'ok' : 'unknown'} icon={row.covered ? 'check' : 'alert'}>
                {row.covered ? '已覆盖' : '未覆盖'}
              </Badge>
            </td>
            <td>
              {row.nodeIds.length === 0
                ? '—'
                : row.nodeIds.map((nodeId) => {
                    const status = statusByNode.get(nodeId);
                    return (
                      <div key={nodeId} className="mono" style={{ fontSize: 11.5 }}>
                        {nodeId.slice(0, 12)}… · {status === undefined ? '未执行' : NODE_STATUS_LABEL[status]}
                      </div>
                    );
                  })}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CheckRow({ id, label, state, detail }: { readonly id: string; readonly label: string; readonly state: 'passed' | 'failed' | 'running' | 'not_started'; readonly detail?: string }) {
  const map = {
    passed: { icon: 'check', label: '通过', tone: 'ok' },
    failed: { icon: 'x', label: '未通过', tone: 'fail' },
    running: { icon: 'play', label: '检查中', tone: 'run' },
    not_started: { icon: 'clock', label: '未开始', tone: 'idle' },
  } as const;
  const view = map[state];
  return (
    <div className="rowx">
      <span className={`ic ${state === 'passed' ? 'ok' : state === 'failed' ? 'no' : state === 'running' ? 'run' : 'idle'}`}>
        <Icon name={view.icon} size="sm" />
      </span>
      <div className="grow">
        <div className="t">
          <span className="mono muted">{id}</span> {label}
        </div>
        {detail === undefined ? null : <div className="s">{detail}</div>}
      </div>
      <Badge tone={view.tone}>{view.label}</Badge>
    </div>
  );
}

export function NodeSummary({ node, groupLabel }: { readonly node: PlanNode; readonly groupLabel?: string }) {
  return (
    <div className="box pad node-summary">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Badge outline>{NODE_KIND_LABEL[node.kind]}</Badge>
        <span className="mono muted" style={{ fontSize: 11.5 }}>
          {node.key}
        </span>
        <span className="grow" />
        {groupLabel === undefined ? null : <span className="hint">{groupLabel}</span>}
      </div>
      <div className="node-summary-title">{node.title}</div>
      <p className="hint">{node.summary}</p>
      {node.inputs.length === 0 ? null : (
        <>
          <div className="sec-t" style={{ marginTop: 10 }}>
            输入
          </div>
          <ul className="list-plain">
            {node.inputs.map((input, index) => (
              <li key={`${input.name}-${String(index)}`}>
                <span className="mono">{input.name}</span> · {input.source}
                {input.sourceNodeId === undefined ? '' : '（上游步骤）'}
              </li>
            ))}
          </ul>
        </>
      )}
      {node.outputs.length === 0 ? null : (
        <>
          <div className="sec-t" style={{ marginTop: 10 }}>
            输出槽位（执行后才有结果）
          </div>
          <ul className="list-plain">
            {node.outputs.map((output, index) => (
              <li key={`${output.name}-${String(index)}`}>
                <span className="mono">{output.name}</span> · {output.kind}
              </li>
            ))}
          </ul>
        </>
      )}
      {node.acceptance.length === 0 ? null : (
        <>
          <div className="sec-t" style={{ marginTop: 10 }}>
            验收条款
          </div>
          <ul className="list-plain">
            {node.acceptance.map((item, index) => (
              <li key={`${item}-${String(index)}`}>{item}</li>
            ))}
          </ul>
        </>
      )}
      {node.resources.read.length === 0 && node.resources.write.length === 0 ? (
        <p className="hint" style={{ marginTop: 10 }}>
          服务未声明读写资源。
        </p>
      ) : (
        <div className="res-pair">
          <div>
            <div className="sec-t">读取</div>
            <ul className="list-plain">
              {node.resources.read.length === 0 ? <li className="muted">无</li> : node.resources.read.map((resource) => <li key={`r-${resource.kind}-${resource.label}`}>{resource.label} · {resource.basis}</li>)}
            </ul>
          </div>
          <div>
            <div className="sec-t">写入</div>
            <ul className="list-plain">
              {node.resources.write.length === 0 ? <li className="muted">无</li> : node.resources.write.map((resource) => <li key={`w-${resource.kind}-${resource.label}`}>{resource.label} · {resource.basis}</li>)}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

export function PlanStateBadge({ plan }: { readonly plan?: PlanRevision }) {
  const tone = plan?.status === 'confirmed' ? 'done' : plan?.status === 'draft' ? 'unknown' : 'wait';
  return (
    <Badge tone={tone} icon={plan?.status === 'confirmed' ? 'check' : 'edit'}>
      {planStatusText(plan)}
    </Badge>
  );
}

export function ActionHint({ action, fallback }: { readonly action?: ActionAvailability; readonly fallback?: string }) {
  const text = action?.allowed === false ? (action.reason ?? fallback) : fallback;
  if (text === undefined) return null;
  return (
    <span className="action-reason">
      <Icon name="info" size="sm" />
      {text}
    </span>
  );
}
