import { useState } from 'react';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { NodeMarkdown } from './NodeMarkdown.tsx';
import { toolSourceLabel } from './node-labels.ts';
import { clockTime, type NodeFeedItem, type ToolCardModel } from './node-facts.ts';
import type { NodeCitation } from './node-citations.ts';

export interface NodeRecordFeedProps {
  readonly items: readonly NodeFeedItem[];
  /** Data channel broke: every loaded item is marked stale until a re-read lands. */
  readonly stale: boolean;
  readonly staleAt?: string;
  readonly backfilledIds: ReadonlySet<string>;
  readonly onOpenTool: (card: ToolCardModel) => void;
  readonly onOpenCitation: (citation: NodeCitation) => void;
}

function RecordTime({ at, unknownLabel = '时间未记录' }: { readonly at?: string; readonly unknownLabel?: string }) {
  return at === undefined ? <div className="node-tt unk">{unknownLabel}</div> : <div className="node-tt">{clockTime(at)}</div>;
}

function ToolCard({ card, onOpen }: { readonly card: ToolCardModel; readonly onOpen: () => void }) {
  return (
    <button type="button" className="node-tc" aria-label={`查看工具调用 ${card.name} #${card.callId} 的详情`} onClick={onOpen}>
      <div className="node-tc-h">
        <span className="nm">{card.name}</span>
        <span className="src-tag">{toolSourceLabel(card.source)}</span>
        {card.callId.length === 0 ? null : <span className="id mono">#{card.callId}</span>}
        <span className="grow" />
        <Badge tone={card.visual.tone} icon={card.visual.icon}>
          {card.visual.label}
        </Badge>
      </div>
      <div className="node-tc-l">
        <span className="k">参数</span>
        <span className={card.argsSummary === undefined ? 'v muted' : 'v'}>{card.argsSummary ?? '服务未记录调用参数'}</span>
      </div>
      <div className="node-tc-l">
        <span className="k">结果</span>
        <span className={card.resultMuted ? 'v muted' : 'v'}>{card.resultLine}</span>
      </div>
      {card.late === undefined ? null : (
        <div className="node-tc-note">
          <Icon name="clock" size="sm" />
          结果于 {card.late.at === undefined ? '时间未知' : clockTime(card.late.at)} 返回（晚于后续正文）
        </div>
      )}
      {card.note === undefined ? null : (
        <div className={card.note.unknown ? 'node-tc-note unk' : 'node-tc-note'}>
          <Icon name="help" size="sm" />
          {card.note.text}
        </div>
      )}
    </button>
  );
}

function CopyBlockButton({ text, label }: { readonly text: string; readonly label: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  return (
    <Button
      size="sm"
      variant="ghost"
      icon="copy"
      title={state === 'fail' ? '复制失败，请手动选择内容' : label}
      aria-label={label}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(
          () => setState('ok'),
          () => setState('fail'),
        );
      }}
    >
      {state === 'ok' ? '已复制' : state === 'fail' ? '复制失败' : '复制'}
    </Button>
  );
}

function ReasoningBlock({ text, recordId }: { readonly text: string; readonly recordId: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 90 || text.split('\n').length > 3;
  return (
    <div className={`node-rsn${long && !open ? ' clamp' : ''}`}>
      <div className="node-blk-h">
        <span className="node-blk-l">公开推理摘要 · 由模型服务提供</span>
        <span className="grow" />
        <CopyBlockButton text={text} label="复制这段公开推理摘要" />
      </div>
      <div className="node-rs-text" id={`${recordId}-rsn`}>
        {text}
      </div>
      {long ? (
        <button type="button" className="node-rs-more" aria-expanded={open} aria-controls={`${recordId}-rsn`} onClick={() => setOpen(!open)}>
          <Icon name={open ? 'chevDown' : 'chevRight'} size="sm" />
          {open ? '收起' : '展开全部'}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Execution feed (design §15): time gutter, model/reasoning blocks, one card per
 * tool call (late results update in place), service rows, dashed gap separators.
 * A missing record is shown as a gap — the UI never fills it with invented prose.
 */
export function NodeRecordFeed({ items, stale, staleAt, backfilledIds, onOpenTool, onOpenCitation }: NodeRecordFeedProps) {
  return (
    <>
      {items.map((item) => {
        const backfilled = backfilledIds.has(item.id);
        if (item.kind === 'gap') {
          return (
            <div className="node-gap" key={item.id} role="separator" aria-label={`序号 #${String(item.from)} 到 #${String(item.to)} 的记录无法补读`}>
              <span>
                <Icon name="alert" size="sm" />
                #{String(item.from)}–#{String(item.to)} 的记录无法补读（服务未保留）
              </span>
            </div>
          );
        }
        if (item.kind === 'cut') {
          return (
            <div className="node-cut" key={item.id}>
              <Icon name="alert" size="sm" />
              正文在此中断 · 未完整
            </div>
          );
        }
        if (item.kind === 'hidden') {
          return (
            <div className="node-hidden" key={item.id}>
              <Icon name="lock" size="sm" />
              {String(item.count)} 条工具记录无权读取，已隐藏
            </div>
          );
        }
        const at = item.recordedAt;
        return (
          <div className={['node-ti', stale ? 'stale' : '', backfilled ? 'bf' : ''].filter(Boolean).join(' ')} key={item.id} data-id={item.id}>
            <RecordTime at={at} unknownLabel={item.kind === 'tool' ? '时间未知' : '时间未记录'} />
            <div className="node-tm">
              {stale ? (
                <span className="stale-tag" title={staleAt === undefined ? '连接断开前读到的值' : `连接断开前读到的值 · 截至 ${clockTime(staleAt)}`}>
                  过时
                </span>
              ) : null}
              {backfilled ? <span className="bf-tag">补读</span> : null}
              {item.kind === 'model' ? (
                <div className="node-blk">
                  <div className="node-blk-h">
                    <span className="node-blk-l">模型正文</span>
                    <span className="grow" />
                    <CopyBlockButton text={item.text} label="复制这段模型正文" />
                  </div>
                  <NodeMarkdown text={item.text} live={item.live} citations={item.citations} onCitation={onOpenCitation} />
                </div>
              ) : item.kind === 'reasoning' ? (
                <ReasoningBlock text={item.text} recordId={item.id} />
              ) : item.kind === 'tool' ? (
                <ToolCard card={item.card} onOpen={() => onOpenTool(item.card)} />
              ) : (
                <div className="node-sv">
                  <Icon name="check" size="sm" />
                  <span>{item.text}</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
