import { useState, type ReactNode } from 'react';
import {
  KNOWLEDGE_RUN_STATUS_LABEL,
  type KnowledgeCitation,
  type KnowledgeRunStatusValue,
  type KnowledgeStep,
  type KnowledgeToolActivity,
} from '@agent-workflow/shared';
import { Badge, type BadgeTone } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Icon, type IconName } from '../../components/Icon.tsx';
import { formatAbsoluteTime } from '../../app/format.ts';
import { ResearchTimeline } from './ResearchTimeline.tsx';
import './knowledge-conversation.css';

/** One source card as it can be shown; `readAt` is only present when observed. */
export interface SourceCardView {
  readonly path: string;
  readonly kind: 'code' | 'document' | 'database' | 'web';
  readonly state?: 'read' | 'truncated';
  readonly readAt?: string;
}

const STATUS_VIEW: Readonly<Record<KnowledgeRunStatusValue, { readonly tone: BadgeTone; readonly icon: IconName }>> = {
  researching: { tone: 'run', icon: 'search' },
  answering: { tone: 'run', icon: 'sparkle' },
  needs_answer: { tone: 'wait', icon: 'help' },
  stopping: { tone: 'wait', icon: 'pause' },
  stopped: { tone: 'idle', icon: 'stop' },
  completed: { tone: 'ok', icon: 'check' },
  failed: { tone: 'fail', icon: 'x' },
  unknown: { tone: 'unknown', icon: 'help' },
};

const SOURCE_KIND: Readonly<Record<SourceCardView['kind'], { readonly label: string; readonly icon: IconName }>> = {
  code: { label: '代码', icon: 'terminal' },
  document: { label: '文档', icon: 'doc' },
  database: { label: '数据库', icon: 'db' },
  web: { label: '网络摘要', icon: 'link' },
};

const CITATION_MARKER = /(\[\d{1,2}\])/;
function formatDuration(ms: number): string {
  if (ms < 1_000) return `${String(Math.max(0, Math.round(ms)))} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`;
  return `${String(Math.floor(ms / 60_000))} 分 ${String(Math.round((ms % 60_000) / 1_000))} 秒`;
}

/** Real duration between the first and last observed step (never estimated from a mock). */
export function researchDurationMs(steps: readonly KnowledgeStep[] | undefined, fallbackStart?: string, fallbackEnd?: string): number | undefined {
  if (steps !== undefined && steps.length > 0) {
    const starts = steps.map((step) => Date.parse(step.startedAt)).filter((value) => Number.isFinite(value));
    const ends = steps.map((step) => (step.endedAt === undefined ? Date.now() : Date.parse(step.endedAt))).filter((value) => Number.isFinite(value));
    if (starts.length > 0 && ends.length > 0) {
      const started = Math.min(...starts);
      const ended = Math.max(...ends);
      if (ended >= started) return ended - started;
    }
  }
  if (fallbackStart !== undefined) {
    const started = Date.parse(fallbackStart);
    const ended = fallbackEnd === undefined ? Date.now() : Date.parse(fallbackEnd);
    if (Number.isFinite(started) && Number.isFinite(ended) && ended >= started) return ended - started;
  }
  return undefined;
}

function currentStepLabel(steps: readonly KnowledgeStep[] | undefined): string | undefined {
  if (steps === undefined || steps.length === 0) return undefined;
  const running = [...steps].reverse().find((step) => step.status === 'running');
  return (running ?? steps[steps.length - 1])?.label;
}

function AnswerText({
  answer,
  citations,
  onOpenCitation,
}: {
  readonly answer: string;
  readonly citations: readonly KnowledgeCitation[];
  readonly onOpenCitation: (index: number) => void;
}) {
  const parts = answer.split(CITATION_MARKER);
  return (
    <div className="kb-answer">
      {parts.map((part, index) => {
        const match = /^\[(\d{1,2})\]$/.exec(part);
        if (match === null) return <span key={index}>{part}</span>;
        const marker = Number(match[1]);
        const citation = citations[marker - 1];
        // Markers the service did not validate into a citation are not rendered
        // as anchors (they would point nowhere); the engine strips them from new
        // answers, so this only covers legacy/unknown pieces.
        if (citation === undefined) return null;
        return (
          <button
            key={index}
            type="button"
            className="kb-cite-sup"
            aria-label={`查看引用 ${String(marker)}`}
            title={`${citation.path}:${String(citation.line)}`}
            onClick={() => {
              onOpenCitation(marker - 1);
            }}
          >
            {String(marker)}
          </button>
        );
      })}
    </div>
  );
}

export interface KnowledgeConversationEntryProps {
  readonly question: string;
  readonly status: KnowledgeRunStatusValue;
  readonly model?: string;
  readonly generatedAt?: string;
  readonly answer: string;
  readonly streaming: boolean;
  readonly citations: readonly KnowledgeCitation[];
  readonly steps?: readonly KnowledgeStep[];
  readonly toolActivity?: readonly KnowledgeToolActivity[];
  readonly sourceCards: readonly SourceCardView[];
  readonly activeCitationIndex: number | null;
  readonly onOpenCitation: (index: number) => void;
  readonly onResearcher: () => void;
  readonly researcherOpen: boolean;
  readonly onStop?: () => void;
  readonly stopDisabledReason?: string;
  readonly stopBusy?: boolean;
  readonly onCopy: () => void;
  readonly copied: boolean;
  readonly onRegenerate?: () => void;
  readonly regenerateDisabledReason?: string;
  readonly onContinue?: () => void;
  readonly continueDisabledReason?: string;
  readonly children?: ReactNode;
}

/**
 * Single Q&A conversation entry in the design's order: question bubble →
 * researcher/status row → collapsible research process (live while running,
 * one-line summary when done) → hit source cards → streaming/completed answer →
 * footer actions. Every field shown here comes from real service data; absent
 * data is labelled instead of invented.
 */
export function KnowledgeConversationEntry(props: KnowledgeConversationEntryProps) {
  const { status, steps, toolActivity, streaming } = props;
  const [expandedOverride, setExpandedOverride] = useState<boolean | undefined>(undefined);
  const expanded = expandedOverride ?? streaming;
  const statusView = STATUS_VIEW[status];
  const duration = researchDurationMs(steps);
  const sourceCount = props.sourceCards.length;
  const stepLabel = currentStepLabel(steps);
  const hasResearchData = (steps !== undefined && steps.length > 0) || (toolActivity !== undefined && toolActivity.length > 0);
  const hasCitationMarkers = CITATION_MARKER.test(props.answer);

  const summary = streaming
    ? stepLabel === undefined
      ? '正在研究…'
      : `${stepLabel}…`
    : hasResearchData
      ? `研究过程 · ${String(sourceCount)} 份来源${duration === undefined ? '' : ` · 用时 ${formatDuration(duration)}`}`
      : '该记录未保留研究步骤';
  const summaryMeta = streaming && duration !== undefined ? formatDuration(duration) : undefined;

  return (
    <section className="kb-conv" aria-label="问答对话">
      <div className="kb-bubble">{props.question}</div>

      <div className="kb-who">
        <button
          type="button"
          className="tile kb-who-avatar"
          aria-label="查看知识研究员当前工作"
          aria-haspopup="dialog"
          aria-expanded={props.researcherOpen}
          title="查看知识研究员当前工作"
          onClick={props.onResearcher}
        >
          研
        </button>
        <span className="kb-who-name">知识研究员</span>
        <Badge tone={statusView.tone} icon={statusView.icon}>
          {KNOWLEDGE_RUN_STATUS_LABEL[status]}
        </Badge>
        {props.model === undefined || props.model.length === 0 ? null : <span className="hint mono">{props.model}</span>}
        {props.generatedAt === undefined ? null : <span className="hint">{formatAbsoluteTime(props.generatedAt)}</span>}
        {streaming && props.onStop !== undefined ? (
          <span className="kb-who-actions">
            <Button
              variant="secondary"
              size="sm"
              icon="stop"
              disabled={props.stopBusy === true || props.stopDisabledReason !== undefined}
              disabledReason={props.stopDisabledReason}
              onClick={props.onStop}
            >
              {props.stopBusy === true ? '停止中…' : '停止生成'}
            </Button>
          </span>
        ) : null}
      </div>

      <div className="kb-research">
        <button
          type="button"
          className="kb-research-toggle"
          aria-expanded={expanded}
          onClick={() => {
            setExpandedOverride(!expanded);
          }}
        >
          <Icon name={streaming ? 'clock' : hasResearchData ? 'check' : 'help'} size="sm" />
          <span className={streaming ? 'kb-research-live' : undefined}>{summary}</span>
          <span className="grow" />
          {summaryMeta === undefined ? null : <span className="hint num">{summaryMeta}</span>}
          <Icon name={expanded ? 'chevDown' : 'chevRight'} size="sm" />
        </button>
        {expanded ? (
          <div className="kb-research-body">
            {hasResearchData ? (
              <ResearchTimeline steps={steps} toolActivity={toolActivity} compact />
            ) : (
              <p className="hint">
                {streaming ? '服务端尚未返回研究步骤；页面不会伪造阶段性进度。' : '该记录没有研究步骤或工具轨迹（旧回答可能未记录）。'}
              </p>
            )}
          </div>
        ) : null}
      </div>

      {props.sourceCards.length === 0 ? null : (
        <div className="kb-hits" aria-label="本轮读取的来源">
          {props.sourceCards.map((card, index) => {
            const kind = SOURCE_KIND[card.kind];
            return (
              <div className="kb-hit" key={`${card.path}:${String(index)}`}>
                <span className="kb-hit-n">{String(index + 1)}</span>
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="kb-hit-title">
                    <Icon name={kind.icon} size="sm" />
                    <span className="mono"> {card.path}</span>
                  </span>
                  <span className="hint">
                    {kind.label} · {card.state === 'truncated' ? '使用节选' : '已读取'}
                    {card.readAt === undefined ? '' : ` · ${formatAbsoluteTime(card.readAt)}`}
                  </span>
                </span>
              </div>
            );
          })}
          <p className="hint">按服务端真实读取顺序显示；服务未提供相关度评分，页面不做排序或打分。</p>
        </div>
      )}

      {props.answer.length === 0 ? (
        streaming ? (
          <p className="hint kb-answer-pending">正在依据所选资料组织回答…</p>
        ) : null
      ) : streaming ? (
        <p className="kb-answer kb-answer-streaming">
          {props.answer}
          <span className="kb-caret" aria-hidden="true" />
        </p>
      ) : (
        <AnswerText answer={props.answer} citations={props.citations} onOpenCitation={props.onOpenCitation} />
      )}

      {props.citations.length === 0 ? null : hasCitationMarkers ? null : (
        <p className="hint">服务未提供句子级引用位置（旧回答或模型未标注编号）；下方引用按来源列出，不能定位到具体句子。</p>
      )}

      {status === 'stopped' ? (
        <div className="banner" role="status">
          <Icon name="stop" size="sm" />
          <div className="grow">已停止生成。已写出的内容保留，引用只对已完成的句子生效。</div>
          {props.onContinue === undefined ? null : (
            <Button
              variant="secondary"
              size="sm"
              disabled={props.continueDisabledReason !== undefined}
              disabledReason={props.continueDisabledReason}
              onClick={props.onContinue}
            >
              继续生成
            </Button>
          )}
        </div>
      ) : null}

      {streaming ? null : (
        <div className="kb-conv-foot">
          <Button variant="ghost" size="sm" icon="copy" onClick={props.onCopy}>
            {props.copied ? '已复制' : '复制'}
          </Button>
          {props.onRegenerate === undefined ? null : (
            <Button
              variant="ghost"
              size="sm"
              icon="refresh"
              disabled={props.regenerateDisabledReason !== undefined}
              disabledReason={props.regenerateDisabledReason}
              onClick={props.onRegenerate}
            >
              重新生成
            </Button>
          )}
          <Button variant="ghost" size="sm" icon="users" aria-expanded={props.researcherOpen} aria-haspopup="dialog" onClick={props.onResearcher}>
            研究员检查
          </Button>
          <span className="grow" />
          <span className="hint">
            {String(props.citations.length)} 处引用 · {String(sourceCount)} 份原文
          </span>
        </div>
      )}

      {props.children}
    </section>
  );
}
