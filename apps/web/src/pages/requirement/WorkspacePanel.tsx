import {
  WORKSPACE_STATE_LABEL,
  type ActionAvailability,
  type PlanRevision,
  type TaskDetailResponse,
  type TaskWorkspace,
} from '@agent-workflow/shared';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ActionReasonLine, ServiceActionButton } from '../../flow/workflow-ui.tsx';
import { formatDateTime } from '../../app/format.ts';
import { PanelEmpty, RevisionMeta, Section } from './requirement-ui.tsx';

const STEP_ORDER = ['resolve_baseline', 'create_branch', 'create_worktree', 'verify_worktree', 'bind_task'] as const;

const WORKSPACE_STEP_LABEL: Record<(typeof STEP_ORDER)[number], string> = {
  resolve_baseline: '解析基线',
  create_branch: '创建任务分支',
  create_worktree: '创建独立工作区',
  verify_worktree: '校验工作区',
  bind_task: '绑定任务',
};

function stepClass(state: TaskWorkspace['steps'][number]['state'] | undefined): string {
  if (state === 'completed') return 'done';
  if (state === 'running') return 'on';
  if (state === 'failed') return 'bad';
  return '';
}

export interface WorkspacePanelProps {
  readonly detail?: TaskDetailResponse;
  readonly plan?: PlanRevision;
  readonly workspace?: TaskWorkspace;
  readonly actions: Record<string, ActionAvailability>;
  readonly busy: boolean;
  readonly onPrepare: () => void;
  readonly onStartExecution: () => void;
  readonly onOpenTask: () => void;
}

/**
 * “工作区” tab: plan confirmation → prepare isolated workspace → start execution,
 * with the two steps kept separate and every disabled action carrying a reason.
 */
export function WorkspacePanel({ detail, plan, workspace, actions, busy, onPrepare, onStartExecution, onOpenTask }: WorkspacePanelProps) {
  const startAction = actions.startExecution;
  const prepareAction = actions.prepareWorkspace;
  const workspaceReady = workspace?.state === 'ready';
  const confirmed = plan?.status === 'confirmed';
  const steps = STEP_ORDER.map((step) => ({
    step,
    label: WORKSPACE_STEP_LABEL[step],
    state: workspace?.steps.find((item) => item.step === step)?.state,
    detail: workspace?.steps.find((item) => item.step === step)?.detail,
  }));

  return (
    <div>
      {detail?.task.fixedTemplate === undefined ? null : (
        <div className="banner info" style={{ marginBottom: 12 }}>
          <Icon name="lock" />
          <div className="grow">固定模板任务：步骤不能修改；仍可确认计划、准备独立工作区并按原配置开始执行。</div>
        </div>
      )}

      <Section title="计划与确认" aside={plan === undefined ? <Badge tone="idle">没有计划</Badge> : <Badge tone={confirmed ? 'done' : 'wait'}>{confirmed ? '已确认' : '未确认'}</Badge>}>
        {plan === undefined ? (
          <PanelEmpty compact icon="flow" title="还没有计划" description="确认计划后才能准备工作区。" />
        ) : (
          <RevisionMeta plan={plan} />
        )}
        {plan !== undefined && !confirmed ? (
          <div className="banner warn" style={{ marginTop: 10 }}>
            <Icon name="alert" />
            <div className="grow">
              <b>计划尚未确认，不能准备工作区。</b>
              <br />
              回到「计划」页签确认计划；确认不调用模型，也不会立即执行。
            </div>
          </div>
        ) : null}
      </Section>

      <Section title="独立工作区" aside={<Badge tone={workspace === undefined ? 'idle' : workspace.state === 'ready' ? 'done' : workspace.state === 'preparing' ? 'run' : workspace.state === 'blocked' ? 'fail' : 'wait'}>{workspace === undefined ? '未创建' : WORKSPACE_STATE_LABEL[workspace.state]}</Badge>}>
        {workspace === undefined ? (
          <div className="banner info" style={{ marginBottom: 12 }}>
            <Icon name="folder" />
            <div className="grow">
              <b>准备独立工作区（两步的第一步）</b>
              <br />
              服务会解析基线、创建任务分支与 worktree、校验并绑定任务；这一步不会开始执行。
            </div>
          </div>
        ) : (
          <>
            <dl className="kv-list">
              <dt>类型</dt>
              <dd>{workspace.kind === 'git_worktree' ? 'Git worktree（任务独立分支）' : '目录副本（非 Git）'}</dd>
              <dt>位置</dt>
              <dd className="mono">{workspace.displayRoot ?? '—'}</dd>
              <dt>原目录</dt>
              <dd className="mono">{workspace.originalRootDisplay ?? '—'}</dd>
              <dt>分支</dt>
              <dd className="mono">{workspace.branch ?? '—'}</dd>
              <dt>基线</dt>
              <dd className="mono">
                {workspace.baseRef ?? '—'}
                {workspace.baseSha === undefined ? '' : ` @ ${workspace.baseSha.slice(0, 10)}`}
              </dd>
              <dt>并行写策略</dt>
              <dd>{workspace.parallelWritePolicy === 'serial' ? '同任务文件写入逐个领取（串行）' : '子隔离后合并（后续分期）'}</dd>
              <dt>保留策略</dt>
              <dd>{workspace.retention}</dd>
              <dt>最近检查</dt>
              <dd>{formatDateTime(workspace.lastCheckedAt)}</dd>
              {workspace.activeWrites.length === 0 ? null : (
                <>
                  <dt>执行中写入</dt>
                  <dd>{workspace.activeWrites.length} 个步骤</dd>
                </>
              )}
            </dl>

            <div className="ws-track" aria-label="工作区准备阶段">
              {steps.map((item) => (
                <div key={item.step} className={`ws-step ${stepClass(item.state)}`}>
                  <span className="top">
                    <span className="no">{item.state === 'completed' ? <Icon name="check" size="sm" /> : item.state === 'running' ? <span className="spin" /> : <Icon name="clock" size="sm" />}</span>
                    <span className="bar" />
                  </span>
                  <span className="lb">{item.label}</span>
                  <span className="dt">{item.detail ?? (item.state === 'not_started' ? '未开始' : item.state ?? '未知')}</span>
                </div>
              ))}
            </div>

            {workspace.state === 'partial' || workspace.state === 'unknown' || workspace.state === 'blocked' ? (
              <div className="banner unknown" style={{ marginTop: 12 }}>
                <Icon name="help" />
                <div className="grow">
                  <b>工作区状态：{WORKSPACE_STATE_LABEL[workspace.state]}</b>
                  <br />
                  这不等于执行失败；按服务状态核对后再决定是否重试准备。不自动重发命令。
                </div>
              </div>
            ) : null}
          </>
        )}

        <div className="ws-actions">
          <ServiceActionButton
            size="sm"
            variant={workspaceReady ? 'secondary' : 'primary'}
            action={prepareAction}
            busy={busy && !workspaceReady}
            fallbackReason="服务未提供准备动作"
            onRun={onPrepare}
          >
            {workspaceReady ? '重新准备' : '准备独立工作区'}
          </ServiceActionButton>
          <ActionReasonLine action={prepareAction} />
        </div>
      </Section>

      <Section
        title="开始执行"
        aside={
          workspaceReady ? (
            <Badge tone="ok" icon="check">
              工作区已准备
            </Badge>
          ) : (
            <Badge tone="wait" icon="lock">
              准备成功前不可用
            </Badge>
          )
        }
      >
        <p className="hint" style={{ marginBottom: 10 }}>
          第二步：准备成功后才会出现“开始执行”。开始执行会唤起受管 OpenCode 运行步骤；开始后可在任务画布暂停、继续或取消。
        </p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <ServiceActionButton
            variant="primary"
            icon="play"
            action={startAction}
            busy={busy && workspaceReady}
            fallbackReason="服务未提供开始执行动作"
            onRun={onStartExecution}
          >
            开始执行
          </ServiceActionButton>
          {workspaceReady ? (
            <Button variant="ghost" size="sm" icon="panel" onClick={onOpenTask}>
              打开任务画布
            </Button>
          ) : null}
        </div>
        <div style={{ marginTop: 6 }}>
          <ActionReasonLine action={startAction} block />
        </div>
      </Section>
    </div>
  );
}
