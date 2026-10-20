import { Children, isValidElement, useMemo, useState, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '../../components/Button.tsx';
import { hasUnclosedFence, linkifyCitations, type NodeCitation } from './node-citations.ts';

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

/**
 * Design `md-code`: language header, copy, and collapse for long blocks. The
 * record feed and the artifact reader share this renderer.
 */
function CodeBlock({ children }: { readonly children?: ReactNode }) {
  const child = Children.toArray(children)[0];
  const className = isValidElement<{ className?: string }>(child) ? (child.props.className ?? '') : '';
  const lang = /language-([\w-]+)/.exec(className)?.[1] ?? '代码';
  const raw = textOf(child);
  const lines = raw.split('\n');
  const long = lines.length > 14;
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className={`node-md-code${long && !open ? ' collapsed' : ''}`}>
      <div className="node-md-code-h">
        <span className="lang">{lang}</span>
        <span className="grow" />
        <Button
          size="sm"
          variant="ghost"
          icon="copy"
          onClick={() => {
            void navigator.clipboard.writeText(raw).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
        >
          {copied ? '已复制' : '复制'}
        </Button>
      </div>
      <pre>{children}</pre>
      {long ? (
        <div className="node-md-code-more">
          <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>
            {open ? '收起' : `展开全部 ${String(lines.length)} 行`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export interface NodeMarkdownProps {
  readonly text: string;
  /** Streaming: last text block of a live attempt (design caret). */
  readonly live?: boolean;
  /** Structured citations; `[n]` only becomes a link when an entry matches. */
  readonly citations?: readonly NodeCitation[];
  readonly onCitation?: (citation: NodeCitation) => void;
  readonly className?: string;
}

/**
 * Streaming-safe Markdown for model text (design NODE-02): GFM tables/lists,
 * code blocks with a still-open marker, `break-word` long links and an optional
 * caret at the end while the attempt is live. Missing Markdown is never faked:
 * an unclosed fence is called out instead of being silently closed.
 */
export function NodeMarkdown({ text, live = false, citations, onCitation, className }: NodeMarkdownProps) {
  const source = citations === undefined || citations.length === 0 ? text : linkifyCitations(text, citations);
  const unclosed = hasUnclosedFence(text);
  const components = useMemo<Components>(
    () => ({
      pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
      a: ({ href, children }) => {
        const match = href === undefined ? null : /^#node-cite-(\d+)$/.exec(href);
        const citation = match === null ? undefined : citations?.find((entry) => entry.index === Number(match[1]));
        if (citation === undefined || onCitation === undefined) {
          return (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          );
        }
        return (
          <button type="button" className="node-cite" aria-label={`打开引用 ${String(citation.index)}：${citation.label}`} title={citation.label} onClick={() => onCitation(citation)}>
            {citation.index}
          </button>
        );
      },
      img: ({ alt }) => <span className="node-md-img">[图片：{alt ?? '未命名'}]</span>,
    }),
    [citations, onCitation],
  );
  return (
    <div className={['node-md', live ? 'node-md-live' : '', className ?? ''].filter(Boolean).join(' ')}>
      <Markdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {source}
      </Markdown>
      {unclosed ? (
        <div className="node-md-code-f">
          <span aria-hidden="true">⚠</span>
          {live ? '代码块未结束 · 正在生成' : '代码块未结束 · 没有收到结束标记'}
        </div>
      ) : null}
    </div>
  );
}
