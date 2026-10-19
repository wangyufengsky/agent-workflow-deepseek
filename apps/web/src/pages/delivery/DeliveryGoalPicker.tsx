import type { DeliveryGoalValue } from '@agent-workflow/shared';
import { Badge } from '../../components/Badge.tsx';
import { Icon, type IconName } from '../../components/Icon.tsx';
import { DELIVERY_GOAL_LABEL } from '@agent-workflow/shared';

interface GoalMeta {
  readonly value: DeliveryGoalValue;
  readonly icon: IconName;
  readonly title: string;
  readonly desc: string;
  readonly deps: string;
}

const GOAL_META: readonly GoalMeta[] = [
  {
    value: 'local_commit',
    icon: 'git',
    title: '仅本地提交',
    desc: '把所选文件提交到任务分支；提交后任务是否交付由服务结算，界面不自行判定。',
    deps: '依赖：① 提交',
  },
  {
    value: 'push_branch',
    icon: 'upload',
    title: '提交并推送',
    desc: '提交后推送到远端新分支；推送是独立的第二次确认，永不强推。',
    deps: '依赖：① 提交 → ② 推送',
  },
  {
    value: 'create_merge_request',
    icon: 'gitRepo',
    title: '提交、推送并创建合并请求',
    desc: '创建 MR 成功即完成所选交付，不等待合并；MR 未合并是 GitLab 的独立事实。',
    deps: '依赖：① 提交 → ② 推送 → ③ 创建 MR',
  },
  {
    value: 'apply_to_original',
    icon: 'folder',
    title: '应用到原目录',
    desc: '仅非 Git 项目：把独立副本里的改动按逐项三方检查应用到原目录。',
    deps: '依赖：只读预览 → 逐项确认 → 应用',
  },
];

export interface DeliveryGoalPickerProps {
  readonly projectGit: boolean;
  readonly value: DeliveryGoalValue | null;
  readonly onChange: (goal: DeliveryGoalValue) => void;
  readonly disabled: boolean;
  readonly disabledReason: string | null;
}

/** 交付目标选择：只记录目标，不自动执行任何步骤。 */
export function DeliveryGoalPicker({ projectGit, value, onChange, disabled, disabledReason }: DeliveryGoalPickerProps) {
  return (
    <section className="delivery-section" aria-label="交付目标">
      <div className="delivery-section-head">
        <h3>完成目标</h3>
        <Badge tone="neutral">选择只记录目标</Badge>
      </div>
      <div className="delivery-goals">
        {GOAL_META.map((meta) => {
          const blockedReason = projectGit
            ? meta.value === 'apply_to_original'
              ? 'Git 项目应通过提交 / 推送 / 合并请求交付；应用到原目录只用于非 Git 项目。'
              : null
            : meta.value === 'apply_to_original'
              ? null
              : '非 Git 项目不支持本地提交、推送或合并请求；请使用「应用到原目录」。';
          const blocked = blockedReason !== null;
          const selected = value === meta.value;
          return (
            <button
              key={meta.value}
              type="button"
              className={['goal-card', blocked ? 'disabled' : ''].filter(Boolean).join(' ')}
              aria-pressed={selected}
              disabled={disabled || blocked}
              title={blocked ? blockedReason : disabled ? (disabledReason ?? undefined) : undefined}
              onClick={() => {
                if (blocked || disabled) return;
                onChange(meta.value);
              }}
            >
              <span className="icon"><Icon name={meta.icon} /></span>
              <span className="body">
                <span className="title">
                  {meta.title}
                  <span className="chip">{DELIVERY_GOAL_LABEL[meta.value]}</span>
                  {selected ? <Badge tone="accent" icon="check">已选择</Badge> : null}
                </span>
                <span className="desc">{meta.desc}</span>
                <span className="deps">{meta.deps}</span>
                {blocked ? <span className="desc" style={{ color: 'var(--warn)' }}>{blockedReason}</span> : null}
              </span>
            </button>
          );
        })}
      </div>
      {disabled && disabledReason !== null ? (
        <span className="action-reason" style={{ marginTop: 6 }}>
          <Icon name="lock" size="sm" />
          {disabledReason}
        </span>
      ) : null}
    </section>
  );
}
