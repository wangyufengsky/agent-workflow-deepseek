import type { ReactNode } from 'react';
import type { ActionAvailability, DeliveryGoalValue, DeliveryStepValue, TaskDelivery } from '@agent-workflow/shared';
import { DELIVERY_GOAL_LABEL } from '@agent-workflow/shared';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import {
  DELIVERY_STEP_STATE_LABEL,
  deliveryStepStateTone,
  formatAbsolute,
} from '../git/git-shared.tsx';

function stepOf(delivery: TaskDelivery, step: DeliveryStepValue) {
  return delivery.steps.find((item) => item.step === step);
}

/**
 * 写操作失败的设计出路（DEL-15/18）：按服务错误码给出唯一可行下一步，
 * 不提供“再试一次”式盲重发；UNKNOWN 另有「核对原操作」。
 */
const FAILURE_HINT: Record<string, string> = {
  HOOK_REJECTED: '提交被 hook 拒绝：修改提交信息后可发起新的提交确认；不提供跳过 hook。',
  GITLAB_AUTH_FAILED: '认证失败或账户用途不足：到 设置 → Git 账号 检查连接；提交保留在本地。',
  PUSH_REJECTED_NON_FF: '远端已有同名分支或非快进：换一个新的远端分支名重新确认；不会强推。',
  STALE_TARGET: '版本或目标已变化：重新读取后重新确认，不静默采用新版本。',
  RECEIPT_UNKNOWN: '结果未知：只核对原操作，不自动重发。',
  WORKSPACE_NOT_READY: '工作区未就绪：先完成独立工作区准备。',
};

function failureHint(code: string | undefined): string | undefined {
  return code === undefined ? undefined : FAILURE_HINT[code];
}

function serverAction(actions: Record<string, ActionAvailability>, ...keys: readonly string[]): ActionAvailability | undefined {
  for (const key of keys) {
    const action = actions[key];
    if (action !== undefined) return action;
  }
  return undefined;
}

interface StepCardProps {
  readonly ordinal: string;
  readonly title: string;
  readonly desc: string;
  readonly state: TaskDelivery['steps'][number] | undefined;
  readonly current: boolean;
  readonly fallbackReason: string | null;
  readonly action: ActionAvailability | undefined;
  readonly busy: boolean;
  readonly pendingLabel: string;
  readonly buttonLabel: string;
  readonly buttonIcon: 'check' | 'upload' | 'gitRepo' | 'folder';
  readonly onAction: () => void;
  readonly onVerify: (requestKey: string) => void;
  readonly extraActions?: ReactNode;
}

function StepCard({
  ordinal,
  title,
  desc,
  state,
  current,
  fallbackReason,
  action,
  busy,
  pendingLabel,
  buttonLabel,
  buttonIcon,
  onAction,
  onVerify,
  extraActions,
}: StepCardProps) {
  const stateValue = state?.state ?? 'not_started';
  const succeeded = stateValue === 'succeeded';
  const blockedReason = action !== undefined && !action.allowed
    ? action.reason ?? action.reasonCode ?? fallbackReason
    : fallbackReason;
  const disabled = blockedReason !== null || busy;
  const tone = deliveryStepStateTone(stateValue);
  const className = [
    'delivery-step',
    current ? 'current' : '',
    succeeded ? 'done' : '',
    stateValue === 'failed' ? 'failed' : '',
    stateValue === 'unknown' ? 'unknown' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={className}>
      <div className="delivery-step-head">
        <Badge tone={tone} icon={succeeded ? 'check' : stateValue === 'unknown' ? 'help' : stateValue === 'failed' ? 'alert' : 'clock'}>
          {ordinal} {title} · {DELIVERY_STEP_STATE_LABEL[stateValue] ?? stateValue}
        </Badge>
        <span className="grow" />
        {state?.settledAt === undefined ? null : <span className="muted-note">{formatAbsolute(state.settledAt)}</span>}
      </div>
      <div className="delivery-step-desc">{desc}</div>
      {state === undefined ? null : (
        <div className="delivery-step-result">
          {state.commitSha === undefined ? null : <span>提交 {state.commitSha}</span>}
          {state.remoteRef === undefined ? null : <span>远端 {state.remoteRef}</span>}
          {state.pushedSha === undefined ? null : <span>已推送 {state.pushedSha}</span>}
          {state.mrIid === undefined ? null : <span>MR !{String(state.mrIid)}</span>}
          {state.requestKey === undefined ? null : <span>原请求 {state.requestKey}</span>}
        </div>
      )}
      {state?.error === undefined ? null : (
        <div className="delivery-step-error">
          {state.error.message}
          {state.error.code.length === 0 ? '' : ` · ${state.error.code}`}
          {state.error.output === undefined ? null : <code className="out">{state.error.output}</code>}
          {failureHint(state.error.code) === undefined ? null : (
            <span className="delivery-hint">{failureHint(state.error.code)}</span>
          )}
        </div>
      )}
      <div className="delivery-step-actions">
        <Button
          variant={succeeded ? 'ghost' : 'secondary'}
          size="sm"
          icon={buttonIcon}
          disabled={disabled || succeeded}
          disabledReason={busy ? '请求已发出，正在等待回执；不要重复提交。' : succeeded ? '这一步已经成功。' : blockedReason ?? undefined}
          onClick={onAction}
        >
          {busy ? pendingLabel : succeeded ? '已完成' : buttonLabel}
        </Button>
        {state?.mrWebUrl === undefined ? null : (
          <a className="btn ghost sm" href={state.mrWebUrl} target="_blank" rel="noreferrer noopener">
            <Icon name="external" size="sm" />
            在 GitLab 打开
          </a>
        )}
        {stateValue === 'unknown' && state?.requestKey !== undefined ? (
          <Button variant="secondary" size="sm" icon="search" onClick={() => { onVerify(state.requestKey ?? ''); }}>
            核对原操作
          </Button>
        ) : null}
        {extraActions}
      </div>
      {disabled && !succeeded && blockedReason !== null ? (
        <span className="action-reason"><Icon name="lock" size="sm" />{blockedReason}</span>
      ) : null}
      {stateValue === 'unknown' ? (
        <span className="delivery-hint">保持原记录，只核对原操作；不会自动重发这一步。</span>
      ) : null}
    </div>
  );
}

export interface DeliveryStepListProps {
  readonly delivery: TaskDelivery;
  readonly goal: DeliveryGoalValue | null;
  readonly projectGit: boolean;
  readonly hasUnknown: boolean;
  readonly actions: Record<string, ActionAvailability>;
  readonly pendingAction: string | null;
  readonly eligibilityReason: string | null;
  readonly onCommit: () => void;
  readonly onPush: () => void;
  readonly onCreateMr: () => void;
  readonly onVerify: (requestKey: string) => void;
  /** MR 创建回执未知时「核对原操作」走远端事实核对，而不是只看本地台账。 */
  readonly onVerifyMr: (requestKey: string) => void;
  /** 推送回执未知时「核对原推送」按远端分支事实核对（DEL-17），不重发推送。 */
  readonly onVerifyPush: (requestKey: string) => void;
}

/**
 * 交付步骤：提交 / 推送 / 创建合并请求各自独立确认，不自动连锁。
 * 设计明令不做产品内合并：这里没有「合并到目标分支」步骤，合并只在 GitLab 中进行。
 */
export function DeliveryStepList({
  delivery,
  goal,
  projectGit,
  hasUnknown,
  actions,
  pendingAction,
  eligibilityReason,
  onCommit,
  onPush,
  onCreateMr,
  onVerify,
  onVerifyMr,
  onVerifyPush,
}: DeliveryStepListProps) {
  const commitStep = stepOf(delivery, 'commit');
  const pushStep = stepOf(delivery, 'push');
  const mrStep = stepOf(delivery, 'mergeRequest');
  const applyStep = stepOf(delivery, 'apply');

  if (!projectGit) {
    return (
      <section className="delivery-section" aria-label="交付步骤">
        <div className="delivery-section-head">
          <h3>交付步骤</h3>
          <Badge tone="neutral">{goal === null ? '未选择目标' : DELIVERY_GOAL_LABEL[goal]}</Badge>
        </div>
        <StepCard
          ordinal="应用"
          title="应用到原目录"
          desc="非 Git 项目没有提交 / 推送 / MR。应用由「应用到原目录」预览确认后逐项写入；写入前自动备份，不是文件系统事务。"
          state={applyStep}
          current={false}
          fallbackReason="请在「应用到原目录」预览中逐项确认；写入动作由该预览驱动。"
          action={serverAction(actions, 'apply', 'delivery.apply')}
          busy={false}
          pendingLabel="应用中…"
          buttonLabel="确认应用"
          buttonIcon="folder"
          onAction={() => undefined}
          onVerify={onVerify}
        />
      </section>
    );
  }

  if (goal === null) {
    return (
      <section className="delivery-section">
        <div className="delivery-section-head"><h3>交付步骤</h3></div>
        <p className="delivery-hint">先选择完成目标；选择只记录目标，不会自动提交或推送。</p>
      </section>
    );
  }

  const commitAllowedReason = eligibilityReason ?? (hasUnknown ? '有回执未知的操作，先核对原操作。' : null);
  const pushAllowedReason = commitStep?.state !== 'succeeded' ? '提交成功后才能推送。' : commitAllowedReason;
  const mrAllowedReason = pushStep?.state !== 'succeeded' ? '推送成功后才能创建合并请求。' : commitAllowedReason;

  return (
    <section className="delivery-section" aria-label="交付步骤">
      <div className="delivery-section-head">
        <h3>交付步骤</h3>
        <Badge tone="neutral">{DELIVERY_GOAL_LABEL[goal]}</Badge>
        <span className="spacer" />
        <span className="muted-note">每步独立确认 · 不会自动连锁 · 合并只在 GitLab 中进行</span>
      </div>
      <div className="delivery-steps">
        <StepCard
          ordinal="①"
          title="提交"
          desc={goal === 'local_commit' ? '作者取自设置 → Git 账号；仅提交确认文件。提交成功即完成本地交付目标。' : '作者取自设置 → Git 账号；仅提交确认文件。提交成功后仍需独立确认后续步骤。'}
          state={commitStep}
          current={commitStep === undefined || commitStep.state === 'not_started'}
          fallbackReason={goal === 'local_commit' || goal === 'push_branch' || goal === 'create_merge_request' ? commitAllowedReason : '当前目标不需要提交。'}
          action={serverAction(actions, 'commit', 'delivery.commit')}
          busy={pendingAction === 'commit'}
          pendingLabel="提交中…"
          buttonLabel="预览并确认提交"
          buttonIcon="check"
          onAction={onCommit}
          onVerify={onVerify}
        />

        {goal === 'push_branch' || goal === 'create_merge_request' ? (
          <StepCard
            ordinal="②"
            title="推送"
            desc="推到远端新分支，永不强推；远端同名即停止。推送需要使用服务端 GitLab 连接。"
            state={pushStep}
            current={commitStep?.state === 'succeeded' && (pushStep === undefined || pushStep.state === 'not_started')}
            fallbackReason={pushAllowedReason}
            action={serverAction(actions, 'push', 'delivery.push')}
            busy={pendingAction === 'push'}
            pendingLabel="推送中…"
            buttonLabel="确认推送"
            buttonIcon="upload"
            onAction={onPush}
            onVerify={onVerifyPush}
          />
        ) : null}

        {goal === 'create_merge_request' ? (
          <StepCard
            ordinal="③"
            title="创建合并请求"
            desc="源为实际已推送的 ref / SHA；创建成功即完成所选交付，不等待合并。已有同源 → 目标的打开 MR 时显示原链接，不会重复创建；合并请在 GitLab 中完成（产品内不提供合并按钮）。"
            state={mrStep}
            current={pushStep?.state === 'succeeded' && (mrStep === undefined || mrStep.state === 'not_started')}
            fallbackReason={mrAllowedReason}
            action={serverAction(actions, 'createMr', 'mergeRequest', 'delivery.mergeRequest')}
            busy={pendingAction === 'mr'}
            pendingLabel="创建中…"
            buttonLabel="预览并创建合并请求"
            buttonIcon="gitRepo"
            onAction={onCreateMr}
            onVerify={onVerifyMr}
          />
        ) : null}
      </div>
    </section>
  );
}
