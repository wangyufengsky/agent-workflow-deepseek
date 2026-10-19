import { useMemo, useState, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import './readable-text.css';

function JsonTree({ value, label = '根节点', depth = 0 }: { readonly value: unknown; readonly label?: string; readonly depth?: number }) {
  if (value === null || typeof value !== 'object') return <div className="reader-json-leaf"><span>{label}: </span><code>{JSON.stringify(value)}</code></div>;
  const entries = Object.entries(value);
  return <details open={depth < 1} className="reader-json-tree"><summary>{label} · {Array.isArray(value) ? '数组' : '对象'} ({entries.length})</summary>{depth < 12 ? entries.map(([key, item]) => <JsonTree key={key} label={key} value={item} depth={depth + 1} />) : <pre>{JSON.stringify(value, null, 2)}</pre>}</details>;
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

export function ReadableText({ text, mediaType }: { readonly text: string; readonly mediaType?: string }) {
  const [search, setSearch] = useState('');
  const [raw, setRaw] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [copyState, setCopyState] = useState('');
  const parsed = useMemo(() => { try { return { valid: true, value: JSON.parse(text) as unknown }; } catch { return { valid: false, value: undefined }; } }, [text]);
  const markdown = mediaType === 'text/markdown';
  const lines = text.split('\n');
  const hits = search ? lines.filter((line) => line.toLocaleLowerCase().includes(search.toLocaleLowerCase())).length : 0;
  return <div className="readable-text">
    <div className="row wrap reader-controls">
      <label className="reader-search"><Icon name="search" /><input className="input" aria-label="在已加载内容中查找" placeholder="在已加载内容中查找" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <Button size="sm" onClick={() => setWrap(!wrap)}>{wrap ? '关闭自动换行' : '自动换行'}</Button>
      {(parsed.valid || markdown) ? <Button size="sm" onClick={() => setRaw(!raw)}>{raw ? '格式化阅读' : '原文'}</Button> : null}
      <Button size="sm" onClick={() => { void navigator.clipboard.writeText(text).then(() => setCopyState('已复制'), () => setCopyState('复制失败，请手动选择内容')); }}>复制</Button>
    </div>
    {copyState ? <p role="status">{copyState}</p> : null}
    {search ? <p role="status">已加载内容中有{hits}行匹配。搜索期间显示原文。</p> : null}
    {text === '' ? <p className="hint">（空内容）</p> : !raw && !search && parsed.valid ? <JsonTree value={parsed.value} /> : !raw && !search && markdown ? <article className="reader-markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{ img: ({ alt }) => <span>[图片：{alt ?? '未命名'}]</span>, a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{text}</Markdown></article> : <pre className={`reader-code ${wrap ? 'wrap' : ''}`}>{lines.map((line, index) => <div key={index}><span className="reader-line-number" aria-hidden="true">{index + 1}</span><code>{highlighted(line, search)}{'\n'}</code></div>)}</pre>}
  </div>;
}
