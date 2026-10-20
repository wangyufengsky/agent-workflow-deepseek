import { useMemo, useState, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import './readable-text.css';

function JsonTree({ value, label = '根节点', depth = 0, forced }: { readonly value: unknown; readonly label?: string; readonly depth?: number; readonly forced?: boolean }) {
  if (value === null || typeof value !== 'object') return <div className="reader-json-leaf">{label === '根节点' ? null : <><span className="reader-json-key">{label}</span>: </>}<code className={`reader-json-${typeof value === 'string' ? 'str' : typeof value === 'number' ? 'num' : 'lit'}`}>{JSON.stringify(value)}</code></div>;
  const entries = Object.entries(value);
  const open = forced ?? depth < 1;
  return <details open={open} className="reader-json-tree"><summary>{label} · {Array.isArray(value) ? '数组' : '对象'} ({entries.length})</summary>{depth < 12 ? entries.map(([key, item]) => <JsonTree key={key} label={key} value={item} depth={depth + 1} forced={forced} />) : <pre>{JSON.stringify(value, null, 2)}</pre>}</details>;
}
function highlighted(line: string, search: string): ReactNode {
  if (!search) return line;
  const result: ReactNode[] = [];
  const lower = line.toLocaleLowerCase();
  const needle = search.toLocaleLowerCase();
  let offset = 0;
  for (let count = 0; count < 500; count++) {
    const found = lower.indexOf(needle, offset);
    if (found < 0) break;
    result.push(line.slice(offset, found), <mark key={found}>{line.slice(found, found + search.length)}</mark>);
    offset = found + search.length;
  }
  result.push(line.slice(offset));
  return result;
}

export interface ReadableTextProps {
  readonly text: string;
  readonly mediaType?: string;
  readonly markdownText?: string;
  /** Design `vw-h` header: format chip / size / range chips owned by the caller. */
  readonly header?: ReactNode;
  /** Design `vw-foot`: loaded line range / remaining hint. */
  readonly footer?: ReactNode;
  /** `true` while the caller can still load more lines (design「继续读取」body). */
  readonly partial?: boolean;
}

/**
 * Shared viewer for tool/artifact content: JSON tree (typed colours, expand all),
 * code/text with line numbers + wrap + in-loaded-content search, Markdown reader.
 * Metadata the service does not expose (format, exit code, total lines) is not
 * invented here — callers pass only what the read model actually returned.
 */
export function ReadableText({ text, mediaType, markdownText = text, header, footer, partial = false }: ReadableTextProps) {
  const [search, setSearch] = useState('');
  const [raw, setRaw] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [copyState, setCopyState] = useState('');
  const [jsonMode, setJsonMode] = useState<'default' | 'open' | 'closed'>('default');
  const parsed = useMemo(() => {
    try {
      return { valid: true, value: JSON.parse(text) as unknown };
    } catch {
      return { valid: false, value: undefined };
    }
  }, [text]);
  const markdown = mediaType === 'text/markdown';
  const lines = text.split('\n');
  const hits = search ? lines.filter((line) => line.toLocaleLowerCase().includes(search.toLocaleLowerCase())).length : 0;
  const formatLabel = parsed.valid ? 'JSON' : markdown ? 'Markdown' : '文本';
  return (
    <div className="readable-text">
      {header === undefined ? null : <div className="reader-meta">{header}</div>}
      <div className="row wrap reader-controls">
        <label className="reader-search">
          <Icon name="search" />
          <input className="input" aria-label="在已加载内容中查找" placeholder="在已加载内容中查找" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <Button size="sm" onClick={() => setWrap(!wrap)}>{wrap ? '关闭自动换行' : '自动换行'}</Button>
        {parsed.valid || markdown ? <Button size="sm" onClick={() => setRaw(!raw)}>{raw ? '格式化阅读' : '原文'}</Button> : null}
        {!raw && !search && parsed.valid ? (
          <>
            <Button size="sm" onClick={() => setJsonMode('open')}>全部展开</Button>
            <Button size="sm" onClick={() => setJsonMode('closed')}>收起</Button>
          </>
        ) : null}
        <Button size="sm" onClick={() => { void navigator.clipboard.writeText(text).then(() => setCopyState('已复制'), () => setCopyState('复制失败，请手动选择内容')); }}>复制</Button>
      </div>
      {copyState ? <p role="status">{copyState}</p> : null}
      {search ? <p role="status">已加载内容中有{hits}行匹配。搜索期间显示原文。</p> : null}
      {text === '' ? <p className="node-empty-result"><Icon name="minus" size="sm" /> 工具返回空结果<span className="hint">匹配为空是正常结果，不是错误。</span></p> : !raw && !search && parsed.valid ? (
        <JsonTree key={jsonMode} value={parsed.value} forced={jsonMode === 'default' ? undefined : jsonMode === 'open'} />
      ) : !raw && !search && markdown && !partial ? (
        <article className="reader-markdown">
          <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{ img: ({ alt }) => <span>[图片：{alt ?? '未命名'}]</span>, a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>
            {markdownText}
          </Markdown>
        </article>
      ) : (
        <pre className={`reader-code ${wrap ? 'wrap' : ''}`} tabIndex={0} aria-label={`${formatLabel}内容`}>
          {lines.map((line, index) => (
            <div key={index}>
              <span className="reader-line-number" aria-hidden="true">{index + 1}</span>
              <code>
                {highlighted(line, search)}
                {'\n'}
              </code>
            </div>
          ))}
        </pre>
      )}
      {footer === undefined ? null : <div className="reader-foot">{footer}</div>}
    </div>
  );
}
