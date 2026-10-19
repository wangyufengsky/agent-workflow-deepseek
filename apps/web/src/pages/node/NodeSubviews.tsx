import { useMemo, useState } from 'react';
import type { ArtifactRef, NodeDetail, OutputFragment } from '@agent-workflow/shared';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { formatAbsoluteTime } from '../../app/format.ts';

export type RequirementLink = NodeDetail['requirementLinks'][number];

/** Sub-view opened from the session feed / attempt artifacts / requirement links. */
export type NodeReaderState =
  | { readonly kind: 'tool'; readonly fragment: OutputFragment; readonly attemptLabel: string }
  | { readonly kind: 'artifact'; readonly artifact: ArtifactRef; readonly attemptLabel: string }
  | { readonly kind: 'citation'; readonly link: RequirementLink };

const CODE_PATTERN = /(^|\n)\s*(import|export|const|let|var|function|class|def|fn|func|package|#include|SELECT|CREATE|ALTER)\b|=>|;\s*$|^\s*<\w+/m;

function isJsonText(text: string): boolean {
  const trimmed = text.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text) as unknown, null, 2);
  } catch {
    return text;
  }
}

function DegradeNotice({ children }: { readonly children: string }) {
  return (
    <div className="notice">
      <Icon name="info" size="sm" />
      <span>{children}</span>
    </div>
  );
}

const TOOL_STATUS_TONE = (status: string): 'run' | 'done' | 'fail' | 'idle' => {
  if (status === 'completed') return 'done';
  if (status === 'failed') return 'fail';
  if (status === 'running' || status === 'queued' || status === 'pending') return 'run';
  return 'idle';
};

/** N13/N14: tool detail from the already-recorded activity fragment (no extra request). */
export function ToolDetailView({ fragment, attemptLabel }: { readonly fragment: OutputFragment; readonly attemptLabel: string }) {
  const evidence = fragment.toolEvidence;
  const text = evidence?.output ?? evidence?.error ?? (evidence === undefined ? fragment.text ?? '' : '');
  const toolRef = fragment.toolCallRef;
  const status = toolRef?.status ?? '状态未知';
  const failed = status === 'failed';
  const [wrap, setWrap] = useState(true);
  const [lineLimit, setLineLimit] = useState(200);
  const json = useMemo(() => isJsonText(text), [text]);
  const code = useMemo(() => !json && CODE_PATTERN.test(text), [json, text]);
  const pretty = json ? prettyJson(text) : text;
  const lines = pretty.split('\n');
  const visible = lines.slice(0, lineLimit);

  return (
    <div className="node-subview">
      <div className="row wrap" style={{ gap: 8 }}>
        <Badge tone={TOOL_STATUS_TONE(status)} icon={status === 'failed' ? 'x' : status === 'completed' ? 'check' : 'tool'}>
          {status}
        </Badge>
        <span className="mono hint">{toolRef?.callId ?? '服务未提供调用 ID'}</span>
        <Badge outline>{toolRef?.source === 'managed_mcp' ? '受管 MCP' : toolRef?.source === 'opencode' ? 'OpenCode' : '来源未知'}</Badge>
        <span className="hint">{attemptLabel}</span>
      </div>
      <p className="hint">
        记录 #{String(fragment.seq)}
        {fragment.recordedAt === undefined ? ' · 时间未知（服务未提供）' : ` · 记录于 ${formatAbsoluteTime(fragment.recordedAt)}`}
        {' '}· {evidence?.startedAt === undefined ? '开始时间未记录' : `开始于 ${formatAbsoluteTime(evidence.startedAt)}`}
        {' '}· {evidence?.durationMs === undefined ? '时长未记录' : `${evidence.durationMs} ms`}
      </p>

      {evidence ? <><h3>{evidence.name}</h3>{evidence.input === undefined ? <p className="hint">调用参数未记录。</p> : <details open><summary>调用参数</summary><pre className="node-reader-pre wrap">{prettyJson(evidence.input)}</pre></details>}{evidence.redacted ? <p><Icon name="shield" />敏感字段已隐藏。</p> : null}{evidence.truncated ? <p><Icon name="info" />内容超出保存上限，当前记录已截断。</p> : null}</> : null}
      <div className="row wrap" style={{ gap: 8 }}>
        <Button size="sm" variant="ghost" icon="doc" onClick={() => { setWrap(!wrap); }}>
          {wrap ? '关闭自动换行' : '自动换行'}
        </Button>
        {json ? <Badge outline>JSON · 仅前端格式化</Badge> : null}
        {code ? <Badge outline>代码 / 命令输出 · 无行号定位</Badge> : null}
      </div>

      {text.trim() === '' ? (
        <p className="hint">{evidence?.output === '' ? '工具返回空结果。' : '这条工具记录尚未包含输出正文。'}</p>
      ) : (
        <>
          <pre className={`node-reader-pre${wrap ? ' wrap' : ''}`}>{visible.join('\n')}</pre>
          {lines.length > lineLimit ? (
            <Button size="sm" variant="secondary" icon="chevDown" onClick={() => { setLineLimit(lineLimit + 200); }}>
              继续读取已加载内容（还有 {String(lines.length - lineLimit)} 行）
            </Button>
          ) : null}
        </>
      )}

      {failed ? (
        <div className="banner danger" role="alert">
          <Icon name="alert" />
          <div className="grow">这次工具调用失败；已收到的输出保留，本页不会重试或执行命令。</div>
        </div>
      ) : null}

      {evidence === undefined ? <DegradeNotice>这条历史记录没有保存调用参数、输出和时间明细。</DegradeNotice> : null}
    </div>
  );
}

export { ArtifactDetailView } from './ArtifactDetailView.tsx';

/** N16: requirement-source excerpt with the character range the service actually returns. */
export function CitationSourceView({ link }: { readonly link: RequirementLink }) {
  const text = link.text ?? '';
  const hasRange =
    link.start !== undefined &&
    link.end !== undefined &&
    link.start >= 0 &&
    link.end <= text.length &&
    link.start < link.end;
  const before = hasRange ? text.slice(0, link.start) : '';
  const hit = hasRange ? text.slice(link.start, link.end) : '';
  const after = hasRange ? text.slice(link.end) : text;

  return (
    <div className="node-subview">
      <div className="row wrap" style={{ gap: 8 }}>
        <Badge outline icon="link">引用原文</Badge>
        <span className="mono hint">{link.entryId}</span>
        <span className="hint">{link.label}</span>
      </div>

      {text.trim() === '' ? (
        <p className="hint">服务没有返回这段需求的原文；无法展示引用内容。</p>
      ) : (
        <div className="node-reader-para">
          {hasRange ? (
            <>
              {before}
              <mark className="node-cite-hit">{hit}</mark>
              {after}
            </>
          ) : (
            text
          )}
        </div>
      )}

      {hasRange ? (
        <p className="hint">
          引用定位：字符 {String(link.start)}–{String(link.end)}（共 {String(text.length)} 字符）。服务提供的是需求条目字符区间，不是代码行号或文件版本。
        </p>
      ) : (
        <p className="hint">服务只提供需求条目节选 / 摘要，未提供精确字符区间、代码行定位或来源版本。</p>
      )}

      <DegradeNotice>
        降级说明：服务未提供代码行号、来源版本、文件路径与完整原文接口；这里只展示需求条目中已经返回的节选，不补写引用上下文。
      </DegradeNotice>
    </div>
  );
}
