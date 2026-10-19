import type {
  KnowledgeStep,
  KnowledgeStepKind,
  KnowledgeStepStatus,
  KnowledgeToolActivity,
  KnowledgeToolStatus,
} from '@agent-workflow/shared';
import { Badge, type BadgeTone } from '../../components/Badge.tsx';
import { Icon, type IconName } from '../../components/Icon.tsx';
import { formatAbsoluteTime } from '../../app/format.ts';
import './research-timeline.css';

const STEP_KIND: Record<KnowledgeStepKind, { readonly label: string; readonly icon: IconName }> = {
  retrieve: { label: '检索资料', icon: 'search' },
  model: { label: '模型回答', icon: 'sparkle' },
  tool: { label: '工具调用', icon: 'tool' },
  validate: { label: '引用校验', icon: 'check' },
};

const STEP_STATUS: Record<KnowledgeStepStatus, { readonly label: string; readonly tone: BadgeTone; readonly icon: IconName }> = {
  pending: { label: '等待', tone: 'idle', icon: 'clock' },
  running: { label: '进行中', tone: 'run', icon: 'play' },
  succeeded: { label: '完成', tone: 'ok', icon: 'check' },
  failed: { label: '失败', tone: 'fail', icon: 'x' },
  unknown: { label: '结果未明', tone: 'unknown', icon: 'help' },
};

const TOOL_STATUS: Record<KnowledgeToolStatus, { readonly label: string; readonly tone: BadgeTone }> = {
  pending: { label: '等待', tone: 'idle' },
  running: { label: '进行中', tone: 'run' },
  succeeded: { label: '完成', tone: 'ok' },
  failed: { label: '失败', tone: 'fail' },
  unknown: { label: '结果未明', tone: 'unknown' },
};

function durationOf(step: KnowledgeStep): number | undefined {
  if (step.durationMs !== undefined && Number.isFinite(step.durationMs) && step.durationMs >= 0) return step.durationMs;
  if (step.startedAt.length === 0 || step.endedAt === undefined || step.endedAt.length === 0) return undefined;
  const started = new Date(step.startedAt).getTime();
  const ended = new Date(step.endedAt).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) return undefined;
  return ended - started;
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${String(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} 分 ${String(Math.round((ms % 60_000) / 1_000))} 秒`;
}

function formatToolDuration(tool: KnowledgeToolActivity): string | undefined {
  if (tool.startedAt === undefined || tool.endedAt === undefined) return undefined;
  const started = new Date(tool.startedAt).getTime();
  const ended = new Date(tool.endedAt).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) return undefined;
  return formatDuration(ended - started);
}

/**
 * Real, service-observed research timeline (W3-4b). No fixed four steps and no
 * fake animation: absent fields are called out, and the data is shown only after
 * the answer completed (the current ask is not streaming).
 */
export function ResearchTimeline({
  steps,
  toolActivity,
  compact = false,
}: {
  readonly steps?: readonly KnowledgeStep[];
  readonly toolActivity?: readonly KnowledgeToolActivity[];
  readonly compact?: boolean;
}) {
  const hasSteps = steps !== undefined && steps.length > 0;
  const hasTools = toolActivity !== undefined && toolActivity.length > 0;
  const stepList = steps ?? [];
  const tools = toolActivity ?? [];

  if (!hasSteps && !hasTools) {
    return (
      <div className="kb-research-note">
        <Icon name="help" size="sm" />
        <span>
          本轮还没有工具调用记录。
        </span>
      </div>
    );
  }

  return (
    <div className={`kb-research-timeline${compact ? ' compact' : ''}`}>
      <div className="kb-rt-head">
        <span className="section-title grow">研究过程</span>
        <Badge tone="idle" icon="clock">完成后时间线</Badge>
        {hasSteps ? <Badge outline>{String(stepList.length)} 个步骤</Badge> : null}
      </div>
      <p className="hint kb-rt-note">
        数据来自服务端完成的本次执行（retrieve/model/tool/validate），本轮非流式；不显示实时进度或虚构阶段。
      </p>

      {hasSteps ? (
        <ol className="kb-rt-list" aria-label="研究步骤时间线">
          {stepList.map((step, index) => {
            const kind = STEP_KIND[step.kind] ?? { label: '其他步骤', icon: 'info' as IconName };
            const status = STEP_STATUS[step.status] ?? STEP_STATUS.unknown;
            const duration = durationOf(step);
            return (
              <li key={step.id} className={`kb-rt-step state-${step.status}`}>
                <div className="kb-rt-rail" aria-hidden="true">
                  <span className={`kb-rt-dot state-${step.status}`}><Icon name={status.icon} size="sm" /></span>
                  {index < stepList.length - 1 ? <span className="kb-rt-line" /> : null}
                </div>
                <div className="kb-rt-body">
                  <div className="kb-rt-title">
                    <span className="kb-rt-kind"><Icon name={kind.icon} size="sm" />{kind.label}</span>
                    <span className="grow">{step.label}</span>
                    <Badge tone={status.tone} icon={status.icon}>{status.label}</Badge>
                  </div>
                  <div className="kb-rt-meta">
                    <span>开始 {formatAbsoluteTime(step.startedAt)}</span>
                    {step.endedAt === undefined ? null : <><span className="sep">·</span><span>结束 {formatAbsoluteTime(step.endedAt)}</span></>}
                    {duration === undefined ? null : <><span className="sep">·</span><span>耗时 {formatDuration(duration)}</span></>}
                  </div>
                  {step.detail === undefined || step.detail.length === 0 ? null : <div className="kb-rt-detail">{step.detail}</div>}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="kb-research-note">
          <Icon name="help" size="sm" />
          <span>本轮记录了以下工具调用。</span>
        </div>
      )}

      <div className="kb-rt-head kb-tools-head">
        <span className="section-title grow">工具轨迹</span>
        {hasTools ? <Badge outline>{String(tools.length)} 次调用</Badge> : null}
      </div>
      {hasTools ? (
        <div className="kb-tool-list">
          {tools.map((tool, index) => {
            const status = TOOL_STATUS[tool.status] ?? TOOL_STATUS.unknown;
            const duration = formatToolDuration(tool);
            return (
              <div key={`${tool.callId ?? tool.name}:${String(index)}`} className={`kb-tool-row state-${tool.status}`}>
                <span className={`kb-tool-dot state-${tool.status}`} aria-hidden="true" />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="kb-rt-title">
                    <span className="mono">{tool.name}</span>
                    <span className="grow" />
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </div>
                  {tool.summary === undefined || tool.summary.length === 0 ? null : <div className="kb-rt-detail">{tool.summary}</div>}
                  <div className="kb-rt-meta">
                    {tool.startedAt === undefined ? <span>开始时间服务未返回</span> : <span>开始 {formatAbsoluteTime(tool.startedAt)}</span>}
                    {tool.endedAt === undefined ? null : <><span className="sep">·</span><span>结束 {formatAbsoluteTime(tool.endedAt)}</span></>}
                    {duration === undefined ? null : <><span className="sep">·</span><span>耗时 {duration}</span></>}
                    {tool.callId === undefined ? null : <><span className="sep">·</span><span className="mono">call {tool.callId}</span></>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="kb-research-note">
          <Icon name="help" size="sm" />
          <span>本轮没有工具调用记录。</span>
        </div>
      )}
    </div>
  );
}
