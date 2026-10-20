import { useEffect, useState } from 'react';
import {
  PLAN_REVISION_STATUS_LABEL,
  PlanningGroupState,
  type ActionAvailability,
  type HumanDecision,
  type NodeDiffKind,
  type PlanNode,
  type PlanRevision,
  type PlanningProposal,
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
  readonly proposal?: PlanningProposal;
  readonly proposalPending?: boolean;
  readonly proposalError?: boolean;
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
  readonly roles: readonly { readonly id: string; readonly name: string }[];
  /** P11-02: non-undefined while an UNKNOWN receipt locks the original operation. */
  readonly lockedReason?: string;
  readonly fixedTemplate?: { readonly name: string; readonly version: number; readonly parameters: Readonly<Record<string, string>> };
  readonly onSelectNode: (nodeId: string) => void;
  /** P11-01: save one hand-edited step into a new unconfirmed plan revision. */
  readonly onSaveNodeEdit: (change: {
    readonly nodeId: string;
    readonly title?: string;
    readonly summary?: string;
    readonly acceptance?: readonly string[];
    readonly roleId?: string | null;
    readonly prerequisites?: readonly string[];
  }) => void;
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
  const candidateGroup = props.proposal?.groups.find((group) => group.state === PlanningGroupState.CANDIDATE);
  const unresolvedScopes = props.proposal?.unresolvedScopes ?? [];
  const proposalConfirmReason = unresolvedScopes.length > 0
    ? `还有 ${String(unresolvedScopes.length)} 个组未细化：${unresolvedScopes.map((scope) => scope.title).join('、')}；全部细化后才能确认计划。`
    : props.proposalPending === true
      ? '正在读取分组总览；确认前必须确认所有组已细化。'
      : props.proposalError === true
        ? '分组总览读取失败，无法确认是否还有未细化组；请先重试读取。'
        : undefined;
  const candidateGroupNodeIds = new Set((candidateRevision?.graph.nodes ?? []).filter((node) => candidateGroup === undefined || node.groupId === candidateGroup.groupRef).map((node) => node.id));
  const meaningfulDiff = diff.filter((item) => item.kind !== 'unchanged');
  const candidateGroupDiff = meaningfulDiff.filter((item) => candidateGroupNodeIds.has(item.nodeId));
  const candidateOutsideDiff = meaningfulDiff.length - candidateGroupDiff.length;
  const candidateCrossGroupEdges = candidateRevision === undefined
    ? 0
    : candidateRevision.graph.edges.filter((edge) => {
        const from = candidateRevision.graph.nodes.find((node) => node.id === edge.from)?.groupId;
        const to = candidateRevision.graph.nodes.find((node) => node.id === edge.to)?.groupId;
        return from !== undefined && to !== undefined && from !== to;
      }).length;

  const applyAction = actions.applyCandidate;
  const rejectAction = actions.rejectCandidate;
  const confirmAction = actions.confirmPlan;
  const editAction = actions.editPlan;

  const applyReason = (() => {
    if (props.lockedReason !== undefined) return props.lockedReason;
    if (applyAction?.allowed !== true) return applyAction?.reason;
    if (props.candidateUnsettled) return '正在核对本轮结束（原调用尚未停稳 / 未结账）；可以先只读审阅，暂不能应用';
    if (props.staleInput) return '候选基于旧的需求输入与旧计划，已过期；不能覆盖当前草稿；按当前输入预览新一轮';
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
            <b>{candidateGroup === undefined ? `候选第 ${String(round?.ordinal ?? '?')} 轮` : `分组“${candidateGroup.title}”候选 · 第 ${String(round?.ordinal ?? '?')} 轮`} · 未应用（只读）</b>
            <br />
            {candidateGroup === undefined
              ? '候选只在候选层显示；当前草稿没有改变。应用只写入未确认草稿，不会执行。'
              : `本组差异 ${String(candidateGroupDiff.length)} 项 · 组外差异 ${String(candidateOutsideDiff)} 项 · 跨组依赖 ${String(candidateCrossGroupEdges)} 条（按总览保留） · 应用后本组 ${String(candidateGroupNodeIds.size)} 个节点。应用只替换本组占位，其他组不变；不会执行。`}
            {candidateOutsideDiff > 0 ? <div className="banner warn" style={{ marginTop: 8 }}><Icon name="alert" /><span>服务返回的差异包含组外改动；应用会按 SCOPE_VIOLATION 被拒绝，不能把组外改动当作本组候选。</span></div> : null}
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

      {props.fixedTemplate === undefined ? null : (
        <Section title="固定模板" aside={<Badge tone="wait" icon="lock">修改步骤不可用</Badge>}>
          <dl className="kv-list">
            <dt>模板</dt>
            <dd>{props.fixedTemplate.name} · 版本 {props.fixedTemplate.version}</dd>
            <dt>入口参数</dt>
            <dd>
              {Object.keys(props.fixedTemplate.parameters).length === 0
                ? '无'
                : Object.entries(props.fixedTemplate.parameters).map(([key, value]) => `${key}=${value}`).join('、')}
            </dd>
            <dt>固定步骤</dt>
            <dd>{revision.graph.nodes.map((node) => node.title).join('、')}</dd>
            <dt>能做</dt>
            <dd>确认计划 → 准备独立工作区 → 单独开始执行（按模板配置，不执行前不产生执行事实）</dd>
            <dt>不能做</dt>
            <dd>手改/插入/移出步骤、AI 细化计划：{props.actions.editPlan?.reason ?? '该任务使用固定模板，创建后不能修改步骤；要改要求，请新建模板任务。'}</dd>
          </dl>
        </Section>
      )}

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

      <Section title="需人工判断" aside={decisions.length === 0 ? <Badge tone="idle">无需人工判断</Badge> : <Badge tone={allAccepted ? 'ok' : 'wait'}>{missingAccepted === 0 ? '已全部核对' : `还有 ${missingAccepted} 项`}</Badge>}>
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

      <Section title="计划步骤" aside={<span className="hint">{revision.graph.nodes.length} 步 · 点步骤可选中编辑</span>}>
        <div className="box">
          {revision.graph.nodes.length === 0 ? (
            <p className="hint">服务返回的计划没有节点；这里不补造步骤。</p>
          ) : (
            revision.graph.nodes.map((node) => {
              const group = revision.graph.groups.find((item) => item.id === node.groupId);
              const role = props.roles.find((item) => item.id === node.roleId);
              return (
                <div key={node.id} className={selectedNodeId === node.id ? 'rowx ws-row-selected' : 'rowx'}>
                  <span className={`ic ${node.roleId === undefined ? 'warn' : 'ok'}`}>
                    <Icon name={node.roleId === undefined ? 'help' : 'users'} size="sm" />
                  </span>
                  <div className="grow">
                    <div className="t">{node.title}</div>
                    <div className="s">
                      <span className="mono">{node.key}</span> · {group?.label ?? '未分组'} · 职业 {role?.name ?? (node.roleId ?? '未指定')}
                    </div>
                    <div className="s">
                      产出 {node.outputs.length === 0 ? '未声明' : node.outputs.map((output) => output.name).join('、')}
                      {' · '}验收 {node.acceptance.length} 条
                    </div>
                  </div>
                  {node.roleId === undefined ? <Badge tone="wait">未指定职业</Badge> : null}
                  <Button size="sm" variant={selectedNodeId === node.id ? 'secondary' : 'ghost'} icon="target" onClick={() => props.onSelectNode(node.id)}>
                    {selectedNodeId === node.id ? '已选中' : '选中'}
                  </Button>
                </div>
              );
            })
          )}
        </div>
        {editAction?.allowed === true ? (
          <p className="hint" style={{ marginTop: 6 }}>手改会形成新的未确认计划修订并重新检查；不调用模型，也不执行。未绑定职业的步骤可在下方指定职业。</p>
        ) : null}
      </Section>

      {selectedNode === undefined ? (
        <Section title="选中步骤" aside={<span className="hint">未选中</span>}>
          <p className="hint">点上方步骤行选中后可查看详情并手改；手改会形成新差异并重新检查。</p>
        </Section>
      ) : (
        <Section title="选中步骤" aside={<span className="hint">{selectedGroup?.label ?? '未分组'}</span>}>
          <NodeSummary node={selectedNode} groupLabel={selectedGroup?.label} />
          {editAction?.allowed !== true ? (
            <p className="hint" style={{ marginTop: 8 }}>
              {props.lockedReason ?? editAction?.reason ?? '当前不能手改计划'}
            </p>
          ) : (
            <NodeEditForm
              key={`${selectedNode.id}:${revision.revisionNumber}`}
              node={selectedNode}
              nodes={revision.graph.nodes}
              roles={props.roles}
              busy={props.busy}
              lockedReason={props.lockedReason}
              onSave={props.onSaveNodeEdit}
            />
          )}
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
                <Button
                  variant="primary"
                  icon="check"
                  disabled={props.busy || confirmAction?.allowed !== true || proposalConfirmReason !== undefined}
                  disabledReason={proposalConfirmReason ?? confirmAction?.reason}
                  onClick={props.onConfirm}
                >
                  确认计划
                </Button>
              </div>
              <ActionReasonLine action={proposalConfirmReason === undefined ? confirmAction : { allowed: false, reason: proposalConfirmReason }} block />
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

/** P11-01: per-step hand edit (职业/做什么/产出说明/验收/前置). */
function NodeEditForm({
  node,
  nodes,
  roles,
  busy,
  lockedReason,
  onSave,
}: {
  readonly node: PlanNode;
  readonly nodes: readonly PlanNode[];
  readonly roles: readonly { readonly id: string; readonly name: string }[];
  readonly busy: boolean;
  readonly lockedReason?: string;
  readonly onSave: (change: {
    readonly nodeId: string;
    readonly title?: string;
    readonly summary?: string;
    readonly acceptance?: readonly string[];
    readonly roleId?: string | null;
    readonly prerequisites?: readonly string[];
  }) => void;
}) {
  const incoming = nodes.length === 0 ? [] : [];
  void incoming;
  const [title, setTitle] = useState(node.title);
  const [summary, setSummary] = useState(node.summary);
  const [acceptance, setAcceptance] = useState(node.acceptance.join('\n'));
  const [roleId, setRoleId] = useState(node.roleId ?? '');
  const [prerequisiteIds, setPrerequisiteIds] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    setTitle(node.title);
    setSummary(node.summary);
    setAcceptance(node.acceptance.join('\n'));
    setRoleId(node.roleId ?? '');
    setPrerequisiteIds([]);
    setInitialized(true);
  }, [node.id]);
  if (!initialized) return null;
  const parsedAcceptance = acceptance.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  const disabledReason = lockedReason ?? (busy ? '正在提交，等待服务回执…' : undefined);
  const candidateNodes = nodes.filter((item) => item.id !== node.id);
  return (
    <div className="box pad" style={{ marginTop: 10 }}>
      <div className="sec-t">手改这一步（形成新的未确认计划修订）</div>
      <label className="label" htmlFor={`edit-title-${node.id}`}>做什么 · 步骤名称</label>
      <input id={`edit-title-${node.id}`} className="input" value={title} onChange={(event) => { setTitle(event.target.value); }} />
      <label className="label" htmlFor={`edit-summary-${node.id}`}>产出说明</label>
      <textarea id={`edit-summary-${node.id}`} className="textarea" value={summary} onChange={(event) => { setSummary(event.target.value); }} />
      <label className="label" htmlFor={`edit-acceptance-${node.id}`}>验收条款（每行一条）</label>
      <textarea id={`edit-acceptance-${node.id}`} className="textarea" value={acceptance} onChange={(event) => { setAcceptance(event.target.value); }} />
      <label className="label" htmlFor={`edit-role-${node.id}`}>职业（“谁来做”）</label>
      <select
        id={`edit-role-${node.id}`}
        className="input"
        value={roleId}
        onChange={(event) => { setRoleId(event.target.value); }}
      >
        <option value="">未指定（该步骤未绑定职业）</option>
        {roles.map((role) => (
          <option key={role.id} value={role.id}>{role.name}（{role.id}）</option>
        ))}
      </select>
      <label className="label" htmlFor={`edit-prereq-${node.id}`}>前置步骤（可选；会替换这一步的现有前置）</label>
      <select
        id={`edit-prereq-${node.id}`}
        className="input"
        multiple
        value={prerequisiteIds}
        onChange={(event) => {
          setPrerequisiteIds([...event.target.selectedOptions].map((option) => option.value));
        }}
        style={{ minHeight: 84 }}
      >
        {candidateNodes.map((item) => (
          <option key={item.id} value={item.id}>{item.title}</option>
        ))}
      </select>
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <Button
          size="sm"
          variant="primary"
          icon="edit"
          disabled={disabledReason !== undefined}
          disabledReason={disabledReason}
          onClick={() => {
            onSave({
              nodeId: node.id,
              title: title.trim(),
              summary: summary.trim(),
              acceptance: parsedAcceptance,
              roleId: roleId === '' ? null : roleId,
              ...(prerequisiteIds.length === 0 ? {} : { prerequisites: prerequisiteIds }),
            });
          }}
        >
          保存为新计划修订
        </Button>
        <span className="hint">保存只写入未确认草稿并重新检查；不会执行，也不会调用模型。</span>
      </div>
    </div>
  );
}
