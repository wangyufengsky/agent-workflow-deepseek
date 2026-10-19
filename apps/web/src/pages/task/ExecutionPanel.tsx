import {
  EXECUTION_STATUS_LABEL,
  NODE_STATUS_LABEL,
  PLAN_REVISION_STATUS_LABEL,
  WORKSPACE_STATE_LABEL,
  type ActionAvailability,
  type ExecutionView,
  type PlanRevision,
  type TaskDetailResponse,
  type TaskWorkspace,
} from '@agent-workflow/shared';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ActionReasonLine, FactsBar, FactPill, ServiceActionButton } from '../../flow/workflow-ui.tsx';
import { PanelEmpty, Section } from '../requirement/requirement-ui.tsx';
import {
  AUTO_ADVANCE_STATUSES,
  advanceTargets,
  hasActiveEditSession,
  manualAdvanceReason,
  successorReason,
  type AdvanceTargets,
} from './advance.ts';

const STATUS_TONE = {
  idle: 'idle',
  ready: 'wait',
  running: 'run',
  pausing: 'wait',
  paused: 'idle',
  waiting_confirmation: 'wait',
  stopping: 'wait',
  stopped: 'idle',
  completed: 'done',
  failed: 'fail',
  unknown: 'unknown',
} as const;

export interface ExecutionPanelProps {
  readonly detail: TaskDetailResponse;
  readonly plan?: PlanRevision;
  readonly execution?: ExecutionView;
  readonly workspace?: TaskWorkspace;
  readonly actions: Record<string, ActionAvailability>;
  readonly busy: boolean;
  readonly onStart: () => void;
  readonly onPause: () => void;
  readonly onResume: () => void;
  readonly onCancel: () => void;
  readonly onToggleAutoAdvance: (autoAdvance: boolean) => void;
  readonly onAdvanceAll: () => void;
  readonly onAdvanceSuccessors: (nodeId: string) => void;
  readonly onOpenNode: (nodeId: string) => void;
  readonly onOpenEdit: () => void;
  readonly onOpenRequirement: () => void;
}

/** 执行面板：开始 / 暂停 / 继续 / 取消、自动推进开关、手动推进、进度、可执行步骤与节点列表。 */
export function ExecutionPanel(props: ExecutionPanelProps) {
  const { plan, execution, workspace, actions, busy } = props;
  const status = execution?.status;

  if (plan === undefined) {
    return (
      <div>
        <PanelEmpty
          icon="flow"
          title="还没有可执行的计划"
          description="确认计划并准备工作区后，任务画布才会出现可执行步骤。"
          action={
            <Button size="sm" variant="secondary" icon="file" onClick={props.onOpenRequirement}>
              回到需求画布
            </Button>
          }
        />
      </div>
    );
  }

  const autoAdvance = execution?.autoAdvance === true;
  const autoToggleStatusAllowed = execution !== undefined && AUTO_ADVANCE_STATUSES.includes(execution.status);
  const autoToggleReason = busy
    ? '正在提交操作，等待服务回执…'
    : execution === undefined
      ? '开始执行后才能切换自动节点推进。'
      : hasActiveEditSession(execution)
        ? '正在调整待执行计划：结束或放弃调整后才能切换自动节点推进。'
        : !autoToggleStatusAllowed
          ? `当前执行状态（${EXECUTION_STATUS_LABEL[execution.status]}）不能切换自动节点推进；只在运行中、暂停、等待重新确认、失败或待核对时可切换。`
          : undefined;
  const autoToggleAction: ActionAvailability = autoToggleReason === undefined ? { allowed: true } : { allowed: false, reason: autoToggleReason };
  const overallTargets: AdvanceTargets = plan !== undefined && execution !== undefined ? advanceTargets(plan, execution) : { candidates: [], waiting: [] };
  const advanceAllReason = execution !== undefined && execution.autoAdvance === false
    ? manualAdvanceReason(execution, overallTargets, plan, busy)
    : '开启自动推进时由服务自动领取下一步；关闭后才出现手动推进。';
  const advanceAllAction: ActionAvailability = advanceAllReason === undefined ? { allowed: true } : { allowed: false, reason: advanceAllReason };

  return (
    <div>
      <div className="exec-facts">
        <FactsBar>
          <FactPill label="执行状态" value={execution === undefined ? '尚未创建' : EXECUTION_STATUS_LABEL[execution.status]} tone={status === undefined ? 'neutral' : STATUS_TONE[status]} />
          <FactPill label="计划" value={`修订 ${String(plan.revisionNumber)} · ${PLAN_REVISION_STATUS_LABEL[plan.status]}`} />
          <FactPill label="工作区" value={workspace === undefined ? '未创建' : WORKSPACE_STATE_LABEL[workspace.state]} tone={workspace?.state === 'ready' ? 'ok' : 'neutral'} />
          <FactPill label="自动推进" value={execution === undefined ? '—' : execution.autoAdvance ? '开启' : '关闭'} />
        </FactsBar>
      </div>

      {execution?.notice === undefined ? null : (
        <div
          className={`banner ${
            execution.notice.kind === 'race' || execution.notice.kind === 'plan_changed'
              ? 'unknown'
              : execution.notice.kind === 'failed'
                ? 'danger'
                : execution.notice.kind === 'unknown'
                  ? 'unknown'
                  : 'info'
          }`}
          style={{ marginTop: 10 }}
          role="status"
        >
          <Icon name={execution.notice.kind === 'plan_changed' ? 'refresh' : execution.notice.kind === 'race' ? 'alert' : 'info'} />
          <div className="grow">
            <b>{execution.notice.kind === 'plan_changed' ? '计划已变更' : execution.notice.kind === 'race' ? '领取竞态' : '执行情况'}</b> · {execution.notice.message}
          </div>
        </div>
      )}

      <div className="exec-actions">
        <ServiceActionButton size="sm" variant="primary" icon="play" action={actions.startExecution} busy={busy} fallbackReason="准备成功前不能开始执行" onRun={props.onStart}>
          开始执行
        </ServiceActionButton>
        <ServiceActionButton size="sm" variant="secondary" icon="pause" action={actions.pauseExecution} busy={busy} onRun={props.onPause}>
          暂停
        </ServiceActionButton>
        <ServiceActionButton size="sm" variant="secondary" icon="play" action={actions.resumeExecution} busy={busy} onRun={props.onResume}>
          继续
        </ServiceActionButton>
        <ServiceActionButton size="sm" variant="danger" icon="stop" action={actions.cancelExecution} busy={busy} onRun={props.onCancel}>
          取消执行
        </ServiceActionButton>
      </div>
      <div className="exec-reason">
        <ActionReasonLine action={actions.startExecution} fallback="开始执行会唤起受管 OpenCode 运行步骤" />
      </div>

      <Section title="自动推进" aside={<Badge tone={autoAdvance ? 'run' : 'idle'}>{execution === undefined ? '—' : autoAdvance ? '开启' : '关闭'}</Badge>}>
        <div className="auto-row">
          <button
            type="button"
            className="switch"
            role="switch"
            aria-checked={autoAdvance}
            aria-label="自动节点推进"
            disabled={!autoToggleStatusAllowed || busy}
            title={autoToggleAction.reason ?? (autoAdvance ? '点击关闭：只影响后续领取' : '点击开启：验收通过后自动领取下一步')}
            onClick={() => props.onToggleAutoAdvance(!autoAdvance)}
          />
          <div className="grow">
            <div className="t">{autoAdvance ? '完成一步后自动领取下一步' : '步骤完成后等待你手动推进'}</div>
            <div className="hint">
              {autoAdvance
                ? '开启时，步骤验收通过后自动领取满足条件的下一步。关闭只影响后续领取，执行中的步骤会继续跑完。'
                : '关闭只影响后续领取：执行中的步骤会继续跑完，之后由你整体推进或推进某一步的直接后继。'}
            </div>
          </div>
          {execution === undefined ? null : <span className="hint">{autoAdvance ? '自动领取' : '手动推进'}</span>}
        </div>
        {autoToggleReason === undefined ? null : (
          <div style={{ marginTop: 6 }}>
            <ActionReasonLine action={autoToggleAction} block />
          </div>
        )}
        {execution === undefined || !['paused', 'failed', 'unknown', 'waiting_confirmation'].includes(execution.status) ? null : (
          <p className="hint" style={{ marginTop: 6 }}>
            切换只写入服务设置，不会自动继续已暂停、失败或待核对的执行；继续 / 重试仍需单独操作。
          </p>
        )}
        {execution === undefined || execution.autoAdvance ? null : (
          <div style={{ marginTop: 12, paddingTop: 12, boxShadow: 'inset 0 1px 0 var(--line)' }}>
            <div className="row wrap" style={{ gap: 8 }}>
              <Button
                variant="primary"
                size="sm"
                icon="play"
                disabled={advanceAllAction.allowed !== true}
                disabledReason={advanceAllAction.reason}
                onClick={props.onAdvanceAll}
              >
                {busy ? '处理中…' : overallTargets.candidates.length > 0 ? `整体推进 · 将启动 ${String(overallTargets.candidates.length)} 步` : '整体推进'}
              </Button>
              <span className="hint grow">只在自动推进关闭时出现；同次只放行当前满足条件的步骤，不级联。</span>
            </div>
            <div style={{ marginTop: 6 }}>
              <ActionReasonLine action={advanceAllAction} block />
            </div>
          </div>
        )}
      </Section>

      <Section title="可执行步骤" aside={<span className="hint">{execution?.frontier.length ?? 0} 个</span>}>
        {execution === undefined || execution.frontier.length === 0 ? (
          <p className="hint">{execution === undefined ? '执行尚未创建。' : '当前没有可领取的步骤（可能全部完成、阻塞或等待确认）。'}</p>
        ) : (
          <div className="frontier-list">
            {execution.frontier.map((nodeId) => {
              const node = plan.graph.nodes.find((item) => item.id === nodeId);
              return (
                <button key={nodeId} type="button" className="frontier-chip" onClick={() => props.onOpenNode(nodeId)}>
                  <Icon name="play" size="sm" />
                  {node?.title ?? nodeId.slice(0, 12)}
                </button>
              );
            })}
          </div>
        )}
      </Section>

      <Section
        title="节点状态"
        aside={
          <div className="row" style={{ gap: 6 }}>
            {execution === undefined ? null : (
              <>
                <Badge tone="done">{execution.progress.done} 完成</Badge>
                <Badge tone="run">{execution.progress.running} 执行中</Badge>
                <Badge tone="fail">{execution.progress.failed} 失败</Badge>
              </>
            )}
          </div>
        }
      >
        {execution === undefined ? (
          <p className="hint">执行尚未创建；准备独立工作区并开始执行后，这里显示真实节点状态。</p>
        ) : (
          <div className="box">
            {plan.graph.nodes.map((node) => {
              const state = execution.nodes.find((item) => item.nodeId === node.id);
              const manualAdvanceVisible = execution.autoAdvance === false && state?.status === 'succeeded';
              const successors = manualAdvanceVisible ? advanceTargets(plan, execution, node.id) : undefined;
              const successorBlockReason = successors === undefined ? undefined : successorReason(plan, execution, successors, busy);
              return (
                <div key={node.id} className="node-line">
                  <button type="button" className="rowx node-row" onClick={() => props.onOpenNode(node.id)}>
                    <span className={`ic ${state?.status === 'succeeded' ? 'ok' : state?.status === 'failed' ? 'no' : state?.status === 'running' ? 'run' : 'idle'}`}>
                      <Icon name={state?.status === 'succeeded' ? 'check' : state?.status === 'failed' ? 'x' : state?.status === 'running' ? 'play' : 'clock'} size="sm" />
                    </span>
                    <span className="grow">
                      <span className="t">{node.title}</span>
                      <span className="s">
                        {state === undefined ? '未执行' : `${NODE_STATUS_LABEL[state.status]} · 尝试 ${String(state.attemptCount)} 次`}
                        {state?.error === undefined ? '' : ` · ${state.error.code}`}
                      </span>
                    </span>
                    <Icon name="chevRight" size="sm" />
                  </button>
                  {successors === undefined ? null : (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="play"
                      aria-label={`推进「${node.title}」的直接后继`}
                      title="推进此步骤的直接后继"
                      disabled={successorBlockReason !== undefined}
                      disabledReason={successorBlockReason}
                      onClick={() => props.onAdvanceSuccessors(node.id)}
                    >
                      {successors.candidates.length > 0 ? `推进直接后继 · ${String(successors.candidates.length)}` : '推进直接后继'}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="执行中调整" aside={<span className="hint">暂停 → 编辑 → 保存 → 重新确认 → 继续</span>}>
        {execution?.editSession === undefined ? (
          <>
            <p className="hint" style={{ marginBottom: 8 }}>
              调整会先暂停新增领取；只改未领取步骤，已完成 / 运行中 / 已领取步骤连同入边锁定。
            </p>
            <ServiceActionButton size="sm" variant="secondary" icon="edit" action={actions.adjustExecutionPlan} busy={busy} fallbackReason="当前执行状态不能调整计划" onRun={props.onOpenEdit}>
              调整待执行计划
            </ServiceActionButton>
            <div style={{ marginTop: 6 }}>
              <ActionReasonLine action={actions.adjustExecutionPlan} block />
            </div>
          </>
        ) : (
          <div className="banner info">
            <Icon name="edit" />
            <div className="grow">
              <b>
                调整进行中 · {execution.editSession.state === 'editing' ? '正在编辑' : execution.editSession.state === 'saved' ? '已保存，等待重新确认' : execution.editSession.state === 'conflict' ? '遇到领取竞态' : '已结束'}
              </b>
              <br />
              锁定 {execution.editSession.lockedNodeIds.length} 个步骤；查看与继续在右侧调整面板。
            </div>
            <div className="actions">
              <Button size="sm" variant="secondary" icon="edit" onClick={props.onOpenEdit}>
                打开调整面板
              </Button>
            </div>
          </div>
        )}
      </Section>

      <Section title="工作区" aside={<Badge outline>{workspace?.kind === 'git_worktree' ? 'Git worktree' : '目录副本'}</Badge>}>
        {workspace === undefined ? (
          <p className="hint">工作区尚未创建；回到需求画布「工作区」准备工作区。</p>
        ) : (
          <dl className="kv-list">
            <dt>状态</dt>
            <dd>{WORKSPACE_STATE_LABEL[workspace.state]}</dd>
            <dt>分支</dt>
            <dd className="mono">{workspace.branch ?? '—'}</dd>
            <dt>位置</dt>
            <dd className="mono">{workspace.displayRoot ?? '—'}</dd>
            <dt>写入策略</dt>
            <dd>{workspace.parallelWritePolicy === 'serial' ? '同任务文件写入逐个领取' : '子隔离后合并'}</dd>
          </dl>
        )}
      </Section>

      <div className="exec-links">
        <Button size="sm" variant="ghost" icon="file" onClick={props.onOpenRequirement}>
          打开需求画布
        </Button>
        <span className="hint">{props.detail.project.name} · {props.detail.task.id}</span>
      </div>
    </div>
  );
}
