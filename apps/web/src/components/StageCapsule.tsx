import { TASK_STAGE_LABEL, TASK_STAGE_ORDER, type TaskAttentionValue, type TaskLifecycleValue, type TaskStageValue } from '@agent-workflow/shared';
import { Icon } from './Icon.tsx';

export type StageCapsuleState = 'done' | 'current' | 'attention' | 'upcoming';

export interface StageCapsuleProps {
  /** Current overall stage; omitted shows every segment as upcoming. */
  readonly current?: TaskStageValue;
  readonly lifecycle?: TaskLifecycleValue;
  readonly attention?: TaskAttentionValue;
  /** Optional explicit states (used by previews). Must match the five-stage order. */
  readonly states?: readonly StageCapsuleState[];
  readonly compact?: boolean;
  readonly className?: string;
}

function resolveState(
  index: number,
  currentIndex: number,
  completed: boolean,
  attention: TaskAttentionValue | undefined,
): StageCapsuleState {
  if (completed) return 'done';
  if (currentIndex < 0) return 'upcoming';
  if (index < currentIndex) return 'done';
  if (index > currentIndex) return 'upcoming';
  return attention !== undefined && attention !== 'none' ? 'attention' : 'current';
}

/**
 * The five-stage overall task capsule:
 * 需求草稿 · 规划 · 确认计划 · 准备工作区 · 开始执行.
 * Terminal projections (delivered / cancelled) are not new segments.
 */
export function StageCapsule({ current, lifecycle, attention, states, compact, className }: StageCapsuleProps) {
  const currentIndex = current === undefined ? -1 : TASK_STAGE_ORDER.indexOf(current);
  const completed = lifecycle === 'completed';
  const classes = ['stage-capsule', compact === true ? 'compact' : '', className ?? ''].filter(Boolean).join(' ');

  return (
    <ol className={classes} aria-label="任务阶段">
      {TASK_STAGE_ORDER.map((stage, index) => {
        const state = states?.[index] ?? resolveState(index, currentIndex, completed, attention);
        const isCurrent = state === 'current' || state === 'attention';
        return (
          <li key={stage} className="stage-seg" data-state={state} aria-current={isCurrent ? 'step' : undefined}>
            <span className="stage-mark" aria-hidden="true">
              {state === 'done' ? <Icon name="check" size="sm" /> : <span className="stage-index">{String(index + 1)}</span>}
            </span>
            <span className="stage-label">{TASK_STAGE_LABEL[stage]}</span>
          </li>
        );
      })}
    </ol>
  );
}
