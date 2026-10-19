import { useEffect, useState } from 'react';
import {
  PLANNING_STAGE_LABEL,
  PlanningStage,
  type PlanRevision,
  type PlanningRound,
} from '@agent-workflow/shared';
import { Badge } from '../../components/Badge.tsx';
import { Icon } from '../../components/Icon.tsx';
import { formatAbsoluteTime, formatDateTime } from '../../app/format.ts';
import { formatElapsed, roundIsActive } from './requirement-utils.ts';

interface Phase {
  readonly id: string;
  readonly label: string;
  readonly state: 'done' | 'cur' | 'todo' | 'stop' | 'unk';
  readonly optional: boolean;
}

const PHASE_KEYS = ['preparing_input', 'generating', 'validating', 'revising', 'awaiting_review'] as const;

function stageIndex(stage: PlanningRound['stage']): number {
  const map: Record<string, number> = {
    preparing_input: 0,
    generating: 1,
    validating: 2,
    revising: 3,
    awaiting_review: 4,
    needs_answer: 3,
    done: 5,
    stopped: -1,
    failed: -1,
    unknown: -1,
  };
  return map[stage] ?? -1;
}

function buildPhases(round: PlanningRound): Phase[] {
  const currentIndex = stageIndex(round.stage);
  const revisingHappened =
    round.stageRuns.some((run) => run.stage === 'revising') || round.usage.revisions.used > 0 || round.stage === 'revising';
  const terminalProblem = round.stage === 'stopped' || round.stage === 'failed' || round.stage === 'unknown';
  const lastReached = round.stageRuns.reduce((max, run) => {
    const index = PHASE_KEYS.indexOf(run.stage as (typeof PHASE_KEYS)[number]);
    return Math.max(max, index);
  }, -1);
  const effective = terminalProblem ? Math.max(lastReached, 0) : currentIndex;

  const phases: Phase[] = [];
  for (const [index, key] of PHASE_KEYS.entries()) {
    if (key === 'revising' && !revisingHappened) continue;
    let state: Phase['state'];
    if (terminalProblem && index === effective) state = round.stage === 'unknown' ? 'unk' : 'stop';
    else if (index < effective) state = 'done';
    else if (index === effective) state = 'cur';
    else state = 'todo';
    phases.push({
      id: key,
      label:
        key === 'preparing_input'
          ? PLANNING_STAGE_LABEL[PlanningStage.PREPARING_INPUT]
          : key === 'generating'
            ? PLANNING_STAGE_LABEL[PlanningStage.GENERATING]
            : key === 'validating'
              ? PLANNING_STAGE_LABEL[PlanningStage.VALIDATING]
              : key === 'revising'
                ? PLANNING_STAGE_LABEL[PlanningStage.REVISING]
                : PLANNING_STAGE_LABEL[PlanningStage.AWAITING_REVIEW],
      state,
      optional: key === 'revising',
    });
  }
  return phases;
}

const STATUS_TONE = {
  queued: 'idle',
  running: 'run',
  stopping: 'wait',
  stopped: 'idle',
  failed: 'fail',
  unknown: 'unknown',
  completed: 'done',
} as const;

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) {
      setNow(Date.now());
      return;
    }
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [active]);
  return now;
}

export interface PlanningStripProps {
  readonly round: PlanningRound;
  readonly plan?: PlanRevision;
  readonly recordLast: number | undefined;
  readonly candidateNodeCount: number | undefined;
  readonly onOpenRecords: () => void;
}

/**
 * The "规划" stage expansion. It only uses service facts: phases actually reached,
 * service start time, recorded activity and usage (unknown usage is never shown as 0).
 */
export function PlanningStrip({ round, plan, recordLast, candidateNodeCount, onOpenRecords }: PlanningStripProps) {
  const active = roundIsActive(round);
  const now = useNow(active);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const phases = buildPhases(round);
  const tone = STATUS_TONE[round.status] ?? 'idle';
  const dotCount = plan?.graph.nodes.length ?? candidateNodeCount;

  return (
    <div className={`planning-strip tone-${tone}`} aria-label="规划状态条">
      <span className="ps-round">
        <Badge tone={tone} icon={active ? 'play' : round.status === 'failed' ? 'x' : round.status === 'unknown' ? 'help' : 'check'}>
          {round.status === 'running' ? '规划中' : PLANNING_STAGE_LABEL[round.stage]}
        </Badge>
        <b>第 {round.ordinal} 轮</b>
        <span className="muted">· {round.method.name}</span>
      </span>

      <span className="ps-sep" aria-hidden="true" />

      <div className="ps-track" aria-label="规划阶段轨道">
        {phases.map((phase, index) => (
          <span key={phase.id} className="ps-phase-wrap">
            <span className={`ps-phase ${phase.state}${phase.optional ? ' optional' : ''}`}>
              <i aria-hidden="true">
                {phase.state === 'done' ? <Icon name="check" size="sm" /> : phase.state === 'stop' ? <Icon name="stop" size="sm" /> : phase.state === 'unk' ? <Icon name="help" size="sm" /> : index + 1}
              </i>
              <span className="ps-label">{phase.label}</span>
            </span>
            {index < phases.length - 1 ? (
              <span className="ps-arrow" aria-hidden="true">
                <Icon name="chevRight" size="sm" />
              </span>
            ) : null}
          </span>
        ))}
        {round.stage === 'needs_answer' ? <Badge tone="wait" icon="help">需要你答复</Badge> : null}
        {round.stage === 'awaiting_review' && round.candidate !== undefined ? <Badge tone="wait" icon="eye">候选待审阅</Badge> : null}
      </div>

      <span className="ps-sep" aria-hidden="true" />
      <span className="ps-kv" title="服务记录的开始时刻">
        <span className="k">开始</span>
        {round.startedAt === undefined ? '—' : formatAbsoluteTime(round.startedAt).slice(11, 19)}
      </span>
      <span className="ps-kv" title="服务时间计算，刷新不重新计时">
        <span className="k">已用</span>
        {formatElapsed(round.startedAt, round.endedAt, now)}
        {active ? '（仍在进行）' : '（本轮已结束）'}
      </span>
      <span className="ps-last" title={round.lastActivity ?? '服务未返回最近活动'}>
        <span className="k">最近活动</span>
        {round.lastActivity === undefined || round.lastActivity.length === 0 ? '—' : round.lastActivity}
      </span>

      <span className="ps-kv ps-opt">
        <span className="k">记录</span>
        {recordLast === undefined ? '—' : `#${String(recordLast)}`}
      </span>
      <span className="ps-kv ps-opt">
        <span className="k">草稿</span>
        {dotCount === undefined ? '—' : `${String(dotCount)} 步`}
      </span>

      <div className="ps-budget-wrap">
        <button
          type="button"
          className="ps-budget"
          aria-expanded={budgetOpen}
          onClick={() => {
            setBudgetOpen((previous) => !previous);
          }}
        >
          <Icon name="chart" size="sm" />
          用量 · 派发 {round.usage.dispatches.used}/{round.usage.dispatches.maximum}
        </button>
        {budgetOpen ? (
          <div className="ps-budget-pop" role="dialog" aria-label="本轮用量明细">
            <dl className="kv-list">
              <dt>模型派发</dt>
              <dd>
                {round.usage.dispatches.used} / {round.usage.dispatches.maximum}
              </dd>
              <dt>修订</dt>
              <dd>
                {round.usage.revisions.used} / {round.usage.revisions.maximum}
              </dd>
              <dt>已知用量</dt>
              <dd>
                {round.usage.budget.known} {round.usage.budget.currency}
              </dd>
              <dt>已预留</dt>
              <dd>
                {round.usage.budget.reserved} {round.usage.budget.currency}
              </dd>
              <dt>未明用量</dt>
              <dd>{round.usage.budget.unknown > 0 ? `${round.usage.budget.unknown} ${round.usage.budget.currency}` : '—（服务未报未明）'}</dd>
              <dt>预算上限</dt>
              <dd>{round.usage.budget.limit === undefined ? '未设置' : `${round.usage.budget.limit} ${round.usage.budget.currency}`}</dd>
              <dt>截止时刻</dt>
              <dd>{round.usage.deadlineAt === undefined ? '—' : formatDateTime(round.usage.deadlineAt)}</dd>
              <dt>模型来源</dt>
              <dd>{round.usage.modelDisplayName ?? round.model.label}</dd>
            </dl>
            <p>未明用量不会显示为 0；没有剩余时间与百分比，只有服务的截止时刻。</p>
            <button type="button" className="btn ghost sm" style={{ marginTop: 8 }} onClick={onOpenRecords}>
              打开规划记录
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}


