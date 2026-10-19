import type { ArtifactRef, NodeDetail, OutputFragment } from '@agent-workflow/shared';
import { Badge } from '../../components/Badge.tsx';
import { Icon } from '../../components/Icon.tsx';

export type RequirementLink = NodeDetail['requirementLinks'][number];

/** Sub-view opened from the session feed / attempt artifacts / requirement links. */
export type NodeReaderState =
  | { readonly kind: 'tool'; readonly attemptId: string; readonly fragment: OutputFragment; readonly attemptLabel: string }
  | { readonly kind: 'artifact'; readonly artifact: ArtifactRef; readonly attemptLabel: string }
  | { readonly kind: 'citation'; readonly link: RequirementLink };

export { ToolDetailView } from './ToolDetailView.tsx';

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

      <div className="notice">
        降级说明：服务未提供代码行号、来源版本、文件路径与完整原文接口；这里只展示需求条目中已经返回的节选，不补写引用上下文。
      </div>
    </div>
  );
}
