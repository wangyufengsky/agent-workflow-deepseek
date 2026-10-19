import {
  PLAN_REVISION_STATUS_LABEL,
  type ActionAvailability,
  type HumanDecision,
  type NodeDiffKind,
  type PlanNode,
  type PlanRevision,
  type PlanningRound,
  type TaskDetailResponse,
} from '@agent-workflow/shared';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { DIFF_LABEL, DIFF_TONE } from '../../flow/types.ts';
import { ActionReasonLine } from '../../flow/workflow-ui.tsx';
import { CoverageTable, NodeSummary, PanelEmpty, RevisionMeta, RoundMeta, Section } from './requirement-ui.tsx';

const DIFF_ORDER: readonly NodeDiffKind[] = ['added', 'modified', 'replaced_by_refinement', 'unchanged'];

export interface PlanReviewPanelProps {
  readonly detail: TaskDetailResponse;
  readonly plan?: PlanRevision;
  readonly candidateRevision?: PlanRevision;
  readonly round?: PlanningRound;
  readonly selectedNodeId?: string;
  readonly accepted: Readonly<Record<string, boolean>>;
  readonly onToggleAccepted: (decisionId: string) => void;
  readonly onLocateNode: (nodeId: string) => void;
  readonly onApply: () => void;
  readonly onReject: () => void;
  readonly onConfirm: () => void;
  readonly onOpenWorkspace: () => void;
  readonly onOpenRecords: () => void;
  readonly actions: Record<string, ActionAvailability>;
  readonly busy: boolean;
  readonly historical: boolean;
  readonly candidateUnsettled: boolean;
  readonly staleInput: boolean;
}

function findNode(revision: PlanRevision | undefined, nodeId: string | undefined): PlanNode | undefined {
  if (revision === undefined || nodeId === undefined) return undefined;
  return revision.graph.nodes.find((node) => node.id === nodeId);
}

function decisionAccepted(decision: HumanDecision, accepted: Readonly<Record<string, boolean>>): boolean {
  return decision.accepted || accepted[decision.id] === true;
}

/** “计划” tab: diff summary, human decisions, coverage, node details and the five separated actions. */
export function PlanReviewPanel(props: PlanReviewPanelProps) {
  const { detail, plan, candidateRevision, round, selectedNodeId, accepted, historical, actions } = props;
  const reviewingCandidate = round?.candidate !== undefined && candidateRevision !== undefined;
  const revision = reviewingCandidate ? candidateRevision : plan;
  const validation = revision?.validation;
  const diff = round?.candidate?.diff ?? revision?.diff ?? [];
  const decisions = validation?.humanReview.items ?? [];
  const allAccepted = decisions.every((decision) => decisionAccepted(decision, accepted));
  const missingAccepted = decisions.filter((decision) => !decisionAccepted(decision, accepted)).length;
  const selectedNode = findNode(revision, selectedNodeId);
  const selectedGroup = revision?.graph.groups.find((group) => group.id === selectedNode?.groupId);

  const applyAction = actions.applyCandidate;
  const rejectAction = actions.rejectCandidate;
  const confirmAction = actions.confirmPlan;

  const applyReason = (() => {
    if (applyAction?.allowed !== true) return applyAction?.reason;
    if (props.candidateUnsettled) return '正在核对本轮结束（原调用尚未停稳 / 未结账）；可以先只读审阅，暂不能应用';
    if (props.staleInput) return '候选基于旧的需求输入与旧计划，已过期；不能覆盖当前草稿';
    if (missingAccepted > 0) return `还有 ${String(missingAccepted)} 项需人工判断未核对；逐项勾选后才能应用`;
    return undefined;
  })();
  const canApply = applyAction?.allowed === true && applyReason === undefined;

  const diffCounts = DIFF_ORDER.map((kind) => ({ kind, count: diff.filter((item) => item.kind === kind).length })).filter((item) => item.count > 0);

  if (revision === undefined) {
    return (
      <EmptyState
        icon="flow"
        title="还没有计划"
        description="生成计划会先打开规划预览并确认，候选需要你审阅、应用、确认；应用与确认都不会执行。"
        action={
          plan === undefined ? (
            <Button size="sm" variant="secondary" icon="refresh" onClick={props.onOpenRecords}>
              查看规划记录
            </Button>
          ) : null
        }
      />
    );
  }

  return (
    <div>
      {reviewingCandidate ? (
        <div className="banner info" style={{ marginBottom: 12 }}>
          <Icon name="eye" />
          <div className="grow">
            <b>候选第 {round?.ordinal} 轮 · 未应用（只读）</b>
            <br />
            候选只在候选层显示；当前草稿没有改变。应用只写入未确认草稿，不会执行；应用后仍需确认计划。
          </div>
        </div>
      ) : null}

      {plan !== undefined && plan.status === 'confirmed' ? (
        <div className="banner ok" style={{ marginBottom: 12 }}>
          <Icon name="check" />
          <div className="grow">
            <b>计划修订 {plan.revisionNumber} 已确认。</b>确认没有调用模型，也没有开始执行。下一步在「工作区」准备独立工作区，成功后再单独开始执行。
          </div>
          <div className="actions">
            <Button size="sm" variant="secondary" icon="folder" onClick={props.onOpenWorkspace}>
              去工作区
            </Button>
          </div>
        </div>
      ) : null}

      <Section title={reviewingCandidate ? '候选计划' : '当前计划'} aside={<Badge tone={revision.status === 'confirmed' ? 'done' : revision.status === 'draft' ? 'unknown' : 'wait'}>{PLAN_REVISION_STATUS_LABEL[revision.status]}</Badge>}>
        <RevisionMeta plan={revision} />
        {round === undefined ? null : (
          <div style={{ marginTop: 12 }}>
            <RoundMeta round={round} />
          </div>
        )}
      </Section>

      <Section title="差异摘要" aside={<span className="hint">{diff.length} 项</span>}>
        {diff.length === 0 ? (
          <p className="hint">服务未返回差异。没有差异不代表计划与输入一致，只代表服务没有提供对照。</p>
        ) : (
          <>
            <div className="diff-summary">
              {diffCounts.map((item) => (
                <Badge key={item.kind} tone={DIFF_TONE[item.kind]} icon={item.kind === 'added' ? 'plus' : item.kind === 'modified' ? 'edit' : 'refresh'}>
                  {DIFF_LABEL[item.kind]} {item.count}
                </Badge>
              ))}
            </div>
            <div className="box" style={{ marginTop: 10 }}>
              {diff.map((item) => {
                const nodeExists = revision.graph.nodes.some((node) => node.id === item.nodeId);
                return (
                  <div key={`${item.nodeKey}-${item.kind}`} className="rowx">
                    <span className={`ic ${item.kind === 'added' ? 'ok' : item.kind === 'modified' ? 'idle' : item.kind === 'unchanged' ? 'idle' : 'warn'}`}>
                      <Icon name={item.kind === 'added' ? 'plus' : item.kind === 'modified' ? 'edit' : 'refresh'} size="sm" />
                    </span>
                    <div className="grow">
                      <div className="t">
                        {item.title} <Badge tone={DIFF_TONE[item.kind]}>{DIFF_LABEL[item.kind]}</Badge>
                      </div>
                      <div className="s">
                        <span className="mono">{item.nodeKey}</span> · {item.summary}
                      </div>
                    </div>
                    {nodeExists ? (
                      <Button size="sm" variant="ghost" icon="target" onClick={() => props.onLocateNode(item.nodeId)}>
                        定位
                      </Button>
                    ) : (
                      <span className="hint">当前图无此步骤</span>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Section>

      <Section title="需人工判断" aside={<Badge tone={allAccepted ? 'ok' : 'wait'}>{missingAccepted === 0 ? '已全部核对' : `还有 ${missingAccepted} 项`}</Badge>}>
        {decisions.length === 0 ? (
          <p className="hint">服务没有要求人工判断项；这表示检查没有产出需要你确认的条目，不代表模型结论一定正确。</p>
        ) : (
          <div className="box">
            {decisions.map((decision) => {
              const checked = decisionAccepted(decision, accepted);
              return (
                <label key={decision.id} className="ackl">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={historical || decision.accepted}
                    onChange={() => {
                      props.onToggleAccepted(decision.id);
                    }}
                  />
                  <span className="grow">
                    <span className="t">{decision.title}</span>
                    <span className="s" style={{ display: 'block' }}>
                      {decision.detail}
                    </span>
                    {decision.nodeId === undefined ? null : (
                      <button type="button" className="linkish" onClick={() => props.onLocateNode(decision.nodeId!)}>
                        定位到步骤
                      </button>
                    )}
                    {decision.accepted ? (
                      <span className="s" style={{ display: 'block', color: 'var(--ok)' }}>
                        服务已记录：{decision.acceptedBy ?? 'user'}
                        {decision.acceptedAt === undefined ? '' : ` · ${decision.acceptedAt}`}
                      </span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </div>
        )}
        {historical ? null : (
          <p className="hint" style={{ marginTop: 6 }}>
            需逐项勾选“已核对”后才能应用；应用会记录承认人与版本，不会执行。
          </p>
        )}
      </Section>

      <Section title="需求覆盖" aside={<span className="hint">服务返回的覆盖表</span>}>
        <CoverageTable coverage={validation?.requirementCoverage ?? []} execution={detail.execution} />
      </Section>

      {selectedNode === undefined ? null : (
        <Section title="选中步骤" aside={<span className="hint">{selectedGroup?.label ?? '未分组'}</span>}>
          <NodeSummary node={selectedNode} groupLabel={selectedGroup?.label} />
        </Section>
      )}

      {historical ? (
        <div className="banner info">
          <Icon name="lock" />
          <div className="grow">历史轮次只读：没有应用、确认或执行动作。</div>
        </div>
      ) : (
        <div className="plan-actions">
          <div className="plan-actions-hint">
            <Icon name="info" size="sm" />
            生成候选 → 应用到草稿 → 确认计划 → 准备工作区 → 开始执行：五步分开，每步各有一次确认。
          </div>
          {reviewingCandidate ? (
            <>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <Button variant="ghost" icon="x" disabled={props.busy || rejectAction?.allowed !== true} disabledReason={rejectAction?.reason} onClick={props.onReject}>
                  不采用
                </Button>
                <span className="grow" />
                <Button variant="primary" icon="check" disabled={props.busy || !canApply} disabledReason={applyReason} onClick={props.onApply}>
                  应用到草稿
                </Button>
              </div>
              <ActionReasonLine action={canApply ? undefined : { allowed: false, reason: applyReason }} fallback={applyAction?.reason} block />
              <span className="hint">应用只写入未确认草稿，不会执行。</span>
            </>
          ) : plan !== undefined && plan.status === 'confirmed' ? (
            <div className="row" style={{ gap: 8 }}>
              <Button variant="primary" icon="folder" onClick={props.onOpenWorkspace}>
                准备工作区
              </Button>
              <span className="hint">准备成功前没有“开始执行”。</span>
            </div>
          ) : plan !== undefined ? (
            <>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <Button variant="ghost" icon="refresh" onClick={props.onOpenRecords}>
                  查看规划记录
                </Button>
                <span className="grow" />
                <Button variant="primary" icon="check" disabled={props.busy || confirmAction?.allowed !== true} disabledReason={confirmAction?.reason} onClick={props.onConfirm}>
                  确认计划
                </Button>
              </div>
              <ActionReasonLine action={confirmAction} block />
              <span className="hint">确认不调用模型，也不会立即执行；确认后仍需准备工作区。</span>
            </>
          ) : (
            <PanelEmpty compact icon="flow" title="当前没有可确认的计划" description="先生成候选并应用到草稿，或使用方法骨架。" />
          )}
        </div>
      )}
    </div>
  );
}
