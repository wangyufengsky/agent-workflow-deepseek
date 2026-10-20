import { PLAN_REVISION_STATUS_LABEL, type ActionAvailability, type PlanNode, type PlanRevision, type PlanningRound } from '@agent-workflow/shared';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { PanelEmpty, CheckRow, CoverageTable, Section } from './requirement-ui.tsx';

const BASIS_LABEL = { complete: '完整', partial: '部分', missing: '缺失', stale: '过期' } as const;
const READINESS_LABEL = { ready: '就绪', needs_preparation: '需准备', blocked: '阻塞', unknown: '未知' } as const;

export interface ChecksPanelProps {
  /** Candidate revision (checked) when reviewing; otherwise the current plan. */
  readonly revision?: PlanRevision;
  readonly round?: PlanningRound;
  readonly onLocateNode: (nodeId: string) => void;
  readonly onOpenPlan: () => void;
  /** PE28: adopt “改为先后执行” by adding an order edge (new diff + re-check). */
  readonly serializeAction?: ActionAvailability;
  readonly onSerialize?: (fromNodeId: string, toNodeId: string) => void;
  readonly busy?: boolean;
  readonly lockedReason?: string;
}

/** PE28: two steps writing the same resource are a real write conflict the plan must resolve. */
function writeCollisions(plan: PlanRevision | undefined): readonly { readonly resource: string; readonly nodes: readonly PlanNode[] }[] {
  if (plan === undefined) return [];
  const owners = new Map<string, PlanNode[]>();
  for (const node of plan.graph.nodes) {
    for (const resource of node.resources.write) {
      const key = `${resource.kind}:${resource.label}`;
      owners.set(key, [...(owners.get(key) ?? []), node]);
    }
  }
  return [...owners.entries()]
    .filter(([, nodes]) => nodes.length > 1)
    .map(([resource, nodes]) => ({ resource, nodes }));
}

const SEVERITY_TONE = { hard: 'fail', warning: 'warn', info: 'idle' } as const;

/** “检查” tab: four independent layers + V1–V8 + problem list + requirement coverage. */
export function ChecksPanel({ revision, round, onLocateNode, onOpenPlan, serializeAction, onSerialize, busy, lockedReason }: ChecksPanelProps) {
  const validation = revision?.validation;
  const collisions = writeCollisions(revision);

  if (validation === undefined) {
    return (
      <div>
        <div className="banner info" style={{ marginBottom: 12 }}>
          <Icon name="info" />
          <div className="grow">
            <b>服务未返回检查结果</b>
            <br />
            这部分计划没有 AI 检查依据（例如方法骨架）；不做假勾选，也不把“没有检查”显示为通过。
          </div>
        </div>
        <PanelEmpty icon="shield" title="没有可显示的检查层" description="规划候选提交后，服务会返回结构检查、需人工判断、依据与执行准备四块结果。" action={<Button size="sm" icon="file" onClick={onOpenPlan}>查看计划</Button>} />
      </div>
    );
  }

  const { structural, humanReview, basis, readiness, checks, requirementCoverage } = validation;
  const stateIcon = (state: string) => (state === 'passed' || state === 'ready' || state === 'complete' ? 'check' : state === 'failed' || state === 'blocked' || state === 'stale' ? 'x' : 'help');

  return (
    <div>
      <Section
        title="检查层"
        aside={
          revision === undefined ? (
            <Badge outline>未标记修订</Badge>
          ) : (
            <Badge outline>
              计划修订 #{revision.revisionNumber} · {PLAN_REVISION_STATUS_LABEL[revision.status]}
            </Badge>
          )
        }
      >
        <div className="layers4">
          <div className={`c ${structural.state === 'passed' ? 'pass' : structural.state === 'failed' ? 'fail' : structural.state === 'running' ? 'review' : 'partial'}`}>
            <div className="k">结构检查</div>
            <div className="v">
              <Icon name={stateIcon(structural.state)} size="sm" />
              {structural.state === 'passed' ? '通过' : structural.state === 'failed' ? '未通过' : structural.state === 'running' ? '检查中' : '未开始'}
            </div>
            <div className="hint">{structural.problems.length} 个问题</div>
          </div>
          <div className={`c ${humanReview.required > 0 ? (humanReview.accepted >= humanReview.required ? 'pass' : 'review') : 'pass'}`}>
            <div className="k">需人工判断</div>
            <div className="v">
              <Icon name="help" size="sm" />
              {humanReview.accepted} / {humanReview.required} 项已核对
            </div>
            <div className="hint">{humanReview.required === 0 ? '服务未要求人工判断' : '逐项勾选后才能应用'}</div>
          </div>
          <div className={`c ${basis.state === 'complete' ? 'pass' : basis.state === 'stale' ? 'fail' : 'partial'}`}>
            <div className="k">依据</div>
            <div className="v">
              <Icon name={basis.state === 'stale' ? 'alert' : 'info'} size="sm" />
              {BASIS_LABEL[basis.state]}
            </div>
            <div className="hint">{basis.detail}</div>
          </div>
          <div className={`c ${readiness.state === 'ready' ? 'pass' : readiness.state === 'blocked' ? 'fail' : readiness.state === 'unknown' ? 'partial' : 'review'}`}>
            <div className="k">执行准备</div>
            <div className="v">
              <Icon name={stateIcon(readiness.state)} size="sm" />
              {READINESS_LABEL[readiness.state]}
            </div>
            <div className="hint">{readiness.detail}</div>
          </div>
        </div>
      </Section>

      <Section title="程序检查 V1–V8" aside={<span className="hint">每层独立，不压成一个总勾</span>}>
        {checks.length === 0 ? (
          <p className="hint">服务未返回 V1–V8 明细。</p>
        ) : (
          <div className="box">
            {checks.map((check) => (
              <CheckRow key={check.id} id={check.id} label={check.label} state={check.state} detail={check.detail} />
            ))}
          </div>
        )}
      </Section>

      <Section title="问题定位" aside={<span className="hint">{structural.problems.length} 条</span>}>
        {structural.problems.length === 0 ? (
          <p className="hint">服务未报告问题。没有报告不代表模型结论正确，只代表这些确定性规则没有命中。</p>
        ) : (
          <div className="box">
            {structural.problems.map((problem) => (
              <div key={problem.id} className="rowx">
                <span className={`ic ${problem.severity === 'hard' ? 'no' : problem.severity === 'warning' ? 'warn' : 'idle'}`}>
                  <Icon name={problem.severity === 'hard' ? 'x' : 'alert'} size="sm" />
                </span>
                <div className="grow">
                  <div className="t">
                    {problem.title} <Badge tone={SEVERITY_TONE[problem.severity]}>{problem.severity === 'hard' ? '必须处理' : problem.severity === 'warning' ? '警告' : '提示'}</Badge>
                  </div>
                  <div className="s">
                    <span className="mono">{problem.code}</span> · {problem.detail}
                  </div>
                </div>
                {problem.nodeId === undefined ? (
                  <span className="hint">无法定位到步骤</span>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="target"
                    onClick={() => {
                      onLocateNode(problem.nodeId!);
                    }}
                  >
                    定位
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="并行写冲突（PE28）" aside={<span className="hint">资源冲突不能忽略</span>}>
        {collisions.length === 0 ? (
          <p className="hint">服务返回的计划里没有多个步骤写同一资源。</p>
        ) : (
          <div className="box">
            {collisions.map((collision) => (
              <div key={collision.resource} className="rowx">
                <span className="ic warn">
                  <Icon name="alert" size="sm" />
                </span>
                <div className="grow">
                  <div className="t">{collision.resource}</div>
                  <div className="s">
                    {collision.nodes.map((node) => node.title).join(' 与 ')} 写同一资源；MVP 只提供“改为先后执行（形成新差异）”，不提供子隔离。
                  </div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="refresh"
                    disabled={busy === true || serializeAction?.allowed !== true}
                    disabledReason={lockedReason ?? (serializeAction?.allowed === true ? undefined : serializeAction?.reason)}
                    onClick={() => {
                      const from = collision.nodes[0];
                      const to = collision.nodes[1];
                      if (from === undefined || to === undefined) return;
                      onSerialize?.(from.id, to.id);
                    }}
                  >
                    改为先后执行
                  </Button>
                  <Button size="sm" variant="ghost" icon="lock" disabled disabledReason="申请子隔离与汇合：未安装 · 后续分期（设计明确不开放）">
                    申请子隔离与汇合
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="需求覆盖" aside={round === undefined ? undefined : <span className="hint">第 {round.ordinal} 轮候选</span>}>
        <CoverageTable coverage={requirementCoverage} />
      </Section>
    </div>
  );
}
