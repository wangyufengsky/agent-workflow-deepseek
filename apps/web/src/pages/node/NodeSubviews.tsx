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

function formattedBytes(sizeBytes: number | undefined): string {
  if (sizeBytes === undefined) return '服务未提供大小';
  if (sizeBytes < 1024) return `${String(sizeBytes)} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isPreviewableMediaType(mediaType: string): boolean {
  const type = mediaType.toLowerCase();
  return type.startsWith('text/') || type.includes('json') || type.includes('xml') || type.includes('yaml');
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
  const text = fragment.text ?? '';
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
        {' '}· 开始 / 结束 / 时长未提供
      </p>

      <div className="row wrap" style={{ gap: 8 }}>
        <Button size="sm" variant="ghost" icon="doc" onClick={() => { setWrap(!wrap); }}>
          {wrap ? '关闭自动换行' : '自动换行'}
        </Button>
        {json ? <Badge outline>JSON · 仅前端格式化</Badge> : null}
        {code ? <Badge outline>代码 / 命令输出 · 无行号定位</Badge> : null}
      </div>

      {text.trim() === '' ? (
        <p className="hint">工具返回空结果；服务没有记录正文。</p>
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

      <DegradeNotice>
        服务当前只返回工具调用引用（callId / 状态 / 来源）与已记录正文；完整参数、无权限 / 缺能力标记、服务端脱敏标记、截断元数据与增量读取接口均未提供。这里展示的都是已加载内容，不伪造 JSON 结构树、脱敏值或“继续读取服务端”。
      </DegradeNotice>
    </div>
  );
}

/** N15: artifact metadata reader. The service exposes metadata only; no body/download endpoint. */
export function ArtifactDetailView({ artifact, attemptLabel }: { readonly artifact: ArtifactRef; readonly attemptLabel: string }) {
  const previewable = isPreviewableMediaType(artifact.mediaType);
  return (
    <div className="node-subview">
      <div className="row wrap" style={{ gap: 8 }}>
        <span className="tile">
          <Icon name="file" />
        </span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 500 }}>{artifact.name}</div>
          <div className="hint mono">{artifact.id} · 修订 {artifact.revision}</div>
        </div>
        <Badge outline>{artifact.mediaType}</Badge>
      </div>

      <dl className="kv-list">
        <dt>媒体类型</dt>
        <dd className="mono">{artifact.mediaType}</dd>
        <dt>大小</dt>
        <dd>{formattedBytes(artifact.sizeBytes)}</dd>
        <dt>SHA-256</dt>
        <dd className="mono-wrap" style={{ wordBreak: 'break-all' }}>{artifact.sha256}</dd>
        <dt>来源尝试</dt>
        <dd>{artifact.sourceAttemptId ?? '服务未提供'} · {attemptLabel}</dd>
      </dl>

      {previewable ? (
        <div className="banner info" role="status">
          <Icon name="info" />
          <div className="grow">
            这种格式（{artifact.mediaType}）本可阅读，但服务未提供产物正文读取接口；本页只显示真实元数据，不伪造内容。
          </div>
        </div>
      ) : (
        <div className="banner info" role="status">
          <Icon name="info" />
          <div className="grow">
            这种格式（{artifact.mediaType} · {formattedBytes(artifact.sizeBytes)}）不能在这里预览；服务也未提供下载接口。
          </div>
        </div>
      )}

      <div className="row wrap" style={{ gap: 8 }}>
        <Button
          variant="secondary"
          size="sm"
          icon="download"
          disabled
          disabledReason="服务未提供产物正文读取与下载接口"
        >
          下载产物
        </Button>
        <span className="hint">不可用：NodeDetail 只返回产物元数据（id / 修订 / sha256 / 类型 / 大小 / 来源尝试）。</span>
      </div>

      <DegradeNotice>
        降级说明：服务未提供产物正文读取、下载、版本失效与权限接口；这里不生成预览、不伪造下载，也不把元数据当成已读正文。
      </DegradeNotice>
    </div>
  );
}

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
