import {
  PlanningGroupState,
  type ActionAvailability,
  type PlanningGroupProposal,
  type PlanningProposal,
} from '@agent-workflow/shared';
import { Badge, type BadgeTone } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { EmptyState, SkeletonText } from '../../components/EmptyState.tsx';
import { Icon, type IconName } from '../../components/Icon.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import type { Pe37ScopeIssue } from './pe37.ts';
import './pe37.css';

const STATE_META: Record<PlanningGroupProposal['state'], { readonly label: string; readonly tone: BadgeTone; readonly icon: IconName }> = {
  [PlanningGroupState.REFINED]: { label: '已细化', tone: 'ok', icon: 'check' },
  [PlanningGroupState.UNREFINED]: { label: '未细化', tone: 'unknown', icon: 'help' },
  [PlanningGroupState.PLANNING]: { label: '规划中', tone: 'run', icon: 'play' },
  [PlanningGroupState.CANDIDATE]: { label: '候选待审阅', tone: 'wait', icon: 'eye' },
};

export interface Pe37OverviewProps {
  readonly proposal?: PlanningProposal;
  readonly loading: boolean;
  readonly error: unknown;
  readonly historical: boolean;
  readonly busy: boolean;
  readonly continueAction?: ActionAvailability;
  readonly stopAction?: ActionAvailability;
  readonly onRetry: () => void;
  readonly onContinue: (groupRef: string, title: string) => void;
  readonly onReviewCandidate: () => void;
  readonly onStop: () => void;
}

/**
 * PE37 overview: the four service-derived group states, coverage/leaf counts,
 * unresolved scopes and the only per-group action. Placeholder nodes on the
 * canvas are display-only; this panel never invents a refined group.
 */
export function Pe37Overview(props: Pe37OverviewProps) {
  const { proposal, loading, error, historical, busy } = props;

  if (loading && proposal === undefined) {
    return (
      <section className="panel-section pe37-overview" aria-label="PE37 分组总览">
        <div className="sec-h"><h3 className="grow">分组规划总览</h3><Badge tone="idle">读取中</Badge></div>
        <SkeletonText lines={5} />
      </section>
    );
  }

  if (error !== null && error !== undefined && proposal === undefined) {
    return (
      <section className="panel-section pe37-overview" aria-label="PE37 分组总览">
        <div className="sec-h"><h3 className="grow">分组规划总览</h3><Badge tone="unknown" icon="help">读取失败</Badge></div>
        <ServiceNotice error={error} title="PE37 分组总览读取失败" onRetry={props.onRetry} />
        <p className="hint" style={{ marginTop: 6 }}>总览读取失败不代表计划失败；没有总览时本页不伪造分组状态，也不会把未细化组当作已执行。</p>
      </section>
    );
  }

  if (proposal === undefined || proposal.groups.length === 0) {
    return (
      <section className="panel-section pe37-overview" aria-label="PE37 分组总览">
        <div className="sec-h"><h3 className="grow">分组规划总览</h3><Badge tone="idle">服务未返回分组</Badge></div>
        <EmptyState
          compact
          icon="layers"
          title="服务没有返回分组总览"
          description="当前计划可能还没有分组，或本任务不是 PE37 大需求路径；本页不会补造分组。"
        />
      </section>
    );
  }

  const refined = proposal.groups.filter((group) => group.state === PlanningGroupState.REFINED);
  const unresolved = proposal.unresolvedScopes;
  const candidateGroups = proposal.groups.filter((group) => group.state === PlanningGroupState.CANDIDATE);
  const planningGroups = proposal.groups.filter((group) => group.state === PlanningGroupState.PLANNING);
  const coverageCount = new Set(proposal.groups.flatMap((group) => group.coverage)).size;
  const allRefined = unresolved.length === 0;
  const continueReason = historical
    ? '历史轮次只读，不能继续规划选区。'
    : props.continueAction?.allowed !== true
      ? props.continueAction?.reason ?? '服务未提供继续规划选区能力。'
      : undefined;
  const stopReason = historical
    ? '历史轮次只读，不能停止规划。'
    : props.stopAction?.allowed !== true
      ? props.stopAction?.reason ?? '服务未提供停止本轮规划能力。'
      : undefined;

  return (
    <section className="panel-section pe37-overview" aria-label="PE37 分组总览">
      <div className="sec-h pe37-head">
        <h3 className="grow">分组规划总览</h3>
        <Badge tone={allRefined ? 'ok' : 'unknown'} icon={allRefined ? 'check' : 'layers'}>
          {allRefined ? '全部已细化' : `${String(unresolved.length)} 组未细化`}
        </Badge>
        {proposal.revisionNumber === undefined ? null : <Badge outline>计划修订 #{String(proposal.revisionNumber)}</Badge>}
      </div>

      {error === null || error === undefined ? null : (
        <div className="banner warn" style={{ marginTop: 8 }}>
          <Icon name="alert" />
          <div className="grow">分组总览刷新失败；下面显示上一次成功读取的状态，不会把未细化组当作已细化。可点“重试读取”后再操作。</div>
          <div className="actions"><Button variant="secondary" size="sm" icon="refresh" onClick={props.onRetry}>重试读取</Button></div>
        </div>
      )}

      <div className="pe37-stats">
        <span><b>{String(refined.length)}</b> / {String(proposal.groups.length)} 组已细化</span>
        <span><b>{String(coverageCount)}</b> 条需求覆盖</span>
        <span><b>{String(proposal.limits.currentNodes)}</b> / {String(proposal.limits.maxNodes)} 个叶子步骤</span>
        <span><b>{String(proposal.limits.currentGroups)}</b> / {String(proposal.limits.maxGroups)} 个分组</span>
      </div>

      <div className="pe37-groups" role="list" aria-label="分组状态">
        {proposal.groups.map((group) => {
          const meta = STATE_META[group.state];
          const isCandidate = group.state === PlanningGroupState.CANDIDATE;
          const isPlanning = group.state === PlanningGroupState.PLANNING;
          return (
            <div key={group.groupRef} className={`pe37-group state-${group.state}`} role="listitem">
              <span className={`pe37-group-icon state-${group.state}`} aria-hidden="true">
                <Icon name={meta.icon} size="sm" />
              </span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="pe37-group-title">
                  <span>{group.title}</span>
                  <Badge tone={meta.tone} icon={meta.icon}>{meta.label}</Badge>
                  {group.refinedInRound === undefined ? null : <Badge outline>第 {String(group.refinedInRound)} 轮</Badge>}
                </div>
                <div className="pe37-group-meta">
                  {group.coverage.length === 0 ? '服务未返回需求覆盖' : `覆盖 ${group.coverage.join('、')}`}
                  <span className="sep">·</span>
                  {String(group.leafCount)} 个叶子步骤
                  {group.placeholderNodeIds.length === 0 ? null : (
                    <>
                      <span className="sep">·</span>
                      {String(group.placeholderNodeIds.length)} 个占位
                    </>
                  )}
                </div>
              </div>
              {group.state === PlanningGroupState.UNREFINED ? (
                <Button
                  variant="secondary"
                  size="sm"
                  icon="sparkle"
                  disabled={busy || continueReason !== undefined}
                  disabledReason={continueReason}
                  onClick={() => { props.onContinue(group.groupRef, group.title); }}
                >
                  继续规划选区
                </Button>
              ) : null}
              {isPlanning ? (
                <Button
                  variant="danger"
                  size="sm"
                  icon="stop"
                  disabled={busy || stopReason !== undefined}
                  disabledReason={stopReason}
                  onClick={props.onStop}
                >
                  停止本轮
                </Button>
              ) : null}
              {isCandidate ? (
                <Button variant="secondary" size="sm" icon="eye" disabled={busy} onClick={props.onReviewCandidate}>
                  审阅候选
                </Button>
              ) : null}
              {group.state === PlanningGroupState.REFINED ? (
                <span className="pe37-done"><Icon name="check" size="sm" />已细化，等待全部组</span>
              ) : null}
            </div>
          );
        })}
      </div>

      {planningGroups.length > 0 ? (
        <div className="banner info">
          <Icon name="play" />
          <div className="grow">
            <b>分组“{planningGroups.map((group) => group.title).join('、')}”正在细化。</b>
            只细化本组；其他分组与当前草稿不变。可以离开页面；停止只停这一轮。
          </div>
        </div>
      ) : null}
      {candidateGroups.length > 0 ? (
        <div className="banner warn">
          <Icon name="eye" />
          <div className="grow">
            <b>分组“{candidateGroups.map((group) => group.title).join('、')}”的候选等待审阅。</b>
            候选只影响该组；当前草稿未改变。应用后其他组不变，仍需全部组细化后才能确认计划。
          </div>
        </div>
      ) : null}
      {allRefined ? (
        <div className="banner ok">
          <Icon name="check" />
          <div className="grow">
            <b>全部 {String(proposal.groups.length)} 个分组已细化。</b>
            现在可以确认整份计划；确认后仍先准备工作区，再开始执行。已细化组也没有先执行。
          </div>
        </div>
      ) : (
        <div className="banner warn">
          <Icon name="alert" />
          <div className="grow">
            <b>还有 {String(unresolved.length)} 个组未细化，不能确认计划。</b>
            {unresolved.map((scope) => `“${scope.title}”`).join('、')} 尚未细化；每个组继续规划都是新的一轮，应用候选后仍需全部组细化。
          </div>
        </div>
      )}

      <div className="pe37-limits">
        <span><b>上限</b> 节点 ≤ {String(proposal.limits.maxNodes)} · 分组 ≤ {String(proposal.limits.maxGroups)} · 深度 ≤ {String(proposal.limits.maxDepth)}</span>
        <span><b>预计叶子</b> {String(proposal.limits.projectedLeafCount)} 个</span>
      </div>
      <p className="hint pe37-foot">
        <Icon name="info" size="sm" /> 虚线卡片是未细化分组的占位，不是执行节点，也不是调度屏障；已细化组不会先执行。确认计划前服务会再次按 unresolvedScopes 校验。
      </p>
    </section>
  );
}

/** Structure shown by confirm/apply failures without inventing an error code. */
export function Pe37ScopeNotice({ issue, labels }: { readonly issue: Pe37ScopeIssue; readonly labels?: Readonly<Record<string, string>> }) {
  return (
    <div className="banner warn" role="alert">
      <Icon name="alert" />
      <div className="grow">
        {issue.code === 'SCOPE_UNREFINED' ? (
          <>
            <b>还有分组未细化，不能确认计划。</b>
            {issue.groups.length === 0 ? '服务未返回具体分组名。' : `缺：${issue.groups.map((group) => labels?.[group] ?? group).join('、')}。`}
            <br />
            已细化的组不会先执行；请对每个未细化组“继续规划选区”，全部细化后再确认。
          </>
        ) : (
          <>
            <b>候选越界（SCOPE_VIOLATION）。</b>
            {issue.problems.length === 0 ? '服务未返回具体问题。' : issue.problems.join('；')}
          </>
        )}
      </div>
    </div>
  );
}
