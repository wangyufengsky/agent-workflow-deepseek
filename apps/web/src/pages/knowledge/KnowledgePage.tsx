import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { KnowledgeSearchResponse, KnowledgeSourceContentResponse, KnowledgeSourcesResponse } from '@agent-workflow/shared';
import { useBootstrap } from '../../api/hooks.ts';
import { apiGet } from '../../api/client.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { Icon } from '../../components/Icon.tsx';
import { PendingBackendNotice, ServiceNotice } from '../../components/ServiceNotice.tsx';
import { Modal } from '../../components/Modal.tsx';

const ASK_BLOCKED_REASON = '知识库问答接口尚未接通：服务端没有检索 / 对话 / 引用读取接口，问题不会发送，也没有模拟回答。';

const PLANNED_ENTRYPOINTS = [
  { method: 'POST', path: '/api/knowledge/conversations', purpose: '创建对话并固定项目与来源选择' },
  { method: 'POST', path: '/api/knowledge/conversations/:id/messages', purpose: '发送问题；回答与引用由服务端记录' },
] as const;

export function KnowledgePage() {
  const bootstrap = useBootstrap();
  const [question, setQuestion] = useState('');
  const projects = bootstrap.data?.projects ?? [];
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [submittedTerm, setSubmittedTerm] = useState('');
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const projectId = selectedProjectId !== '' ? selectedProjectId : (projects[0]?.id ?? '');
  const contentQuery = useQuery({
    queryKey: ['knowledge', 'content', projectId, sourcePath],
    queryFn: async () => (await apiGet<KnowledgeSourceContentResponse>(`/api/knowledge/source?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(sourcePath ?? '')}`)).data,
    enabled: projectId !== '' && sourcePath !== null,
    retry: false,
  });
  const searchQuery = useQuery({
    queryKey: ['knowledge', 'search', projectId, submittedTerm],
    queryFn: async () => (await apiGet<KnowledgeSearchResponse>(`/api/knowledge/search?projectId=${encodeURIComponent(projectId)}&q=${encodeURIComponent(submittedTerm)}`)).data,
    enabled: projectId !== '' && submittedTerm.trim().length >= 2,
    retry: false,
  });
  const sourcesQuery = useQuery({
    queryKey: ['knowledge', 'sources', projectId],
    queryFn: async () => (await apiGet<KnowledgeSourcesResponse>(`/api/knowledge/sources?projectId=${encodeURIComponent(projectId)}`)).data,
    enabled: projectId !== '',
    retry: false,
  });

  return (
    <div className="page">
      <PageHeader
        title="知识库"
        lede="从代码、文档和数据库中查找依据，每个结论都能回到原文。资料来源已可读取；问答与引用接口尚未接通。"
        actions={
          <Badge tone="wait" icon="eye">
            资料来源已接通
          </Badge>
        }
      />

      {bootstrap.isError ? (
        <div style={{ marginBottom: 16 }}>
          <ServiceNotice
            error={bootstrap.error}
            onRetry={() => {
              void bootstrap.refetch();
            }}
          />
        </div>
      ) : null}

      <section className="card" style={{ padding: 28 }}>
        <div className="row" style={{ gap: 12 }}>
          <span className="tile lg" aria-hidden="true" style={{ fontSize: 16, fontWeight: 600 }}>
            研
          </span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="row wrap" style={{ gap: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 500 }}>知识研究员</span>
              <Badge tone="idle" icon="lock">
                只读
              </Badge>
              {bootstrap.data === undefined ? null : <Badge outline>{String(bootstrap.data.projects.length)} 个项目可归属</Badge>}
            </div>
            <div className="hint" style={{ marginTop: 3 }}>
              只读当前项目已授权的资料；回答必须结合原文核对。
            </div>
          </div>
        </div>

        <h2 style={{ fontSize: 24, fontWeight: 500, marginTop: 28 }}>关于这个项目，你想了解什么？</h2>
        <p className="lede" style={{ marginTop: 8 }}>
          从代码、文档和数据库中查找依据，每个结论都能回到原文。
        </p>

        <div style={{ marginTop: 20 }}>
          <label className="sr" htmlFor="kb-question">
            向项目提问
          </label>
          <textarea
            id="kb-question"
            className="textarea"
            rows={3}
            value={question}
            onChange={(event) => {
              setQuestion(event.target.value);
            }}
            placeholder="描述你的问题，或粘贴需要理解的内容…（当前输入不会发送）"
            aria-describedby="kb-disabled-note"
          />
          <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
            <Button variant="secondary" size="sm" icon="book" disabled disabledReason="资料来源在下方「资料来源」卡片中读取；问答与引用仍未接通。">
              资料来源
            </Button>
            <span className="chip" title="问答模型由服务端在创建对话时固定">
              <Icon name="sparkle" size="sm" />
              模型由服务端决定
            </span>
            <span className="spacer" />
            <span className="hint num">{String(question.length)} 字</span>
            <Button variant="primary" size="sm" icon="arrowUp" disabled disabledReason={ASK_BLOCKED_REASON}>
              发送
            </Button>
          </div>
          <p className="hint" id="kb-disabled-note" style={{ marginTop: 8 }}>
            发送按钮已禁用：问答、检索与引用读取接口都尚未接通；输入内容只保留在当前页面，不会写入任何记录。
          </p>
        </div>

        <div className="section">
          <div className="eyebrow" style={{ marginBottom: 10 }}>
            可以这样问（选择后仅填入输入框）
          </div>
          <div className="col" style={{ gap: 8 }}>
            {[
              '这个项目如何处理任务执行、资料读取和错误恢复？',
              '任务从创建到交付要经过哪些阶段？',
              '哪些操作需要单独的读取许可？',
            ].map((text) => (
              <button
                key={text}
                type="button"
                className="list-row"
                style={{ border: '1px solid var(--line)', borderRadius: 12 }}
                onClick={() => {
                  setQuestion(text);
                }}
              >
                <Icon name="arrowRight" size="sm" />
                <span className="grow" style={{ textAlign: 'left', fontSize: 13.5 }}>
                  {text}
                </span>
                <Badge tone="idle">填入</Badge>
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="grid-2" style={{ marginTop: 16, alignItems: 'start' }}>
        <section className="card pad">
          <div className="row" style={{ gap: 8 }}>
            <Icon name="book" size="sm" />
            <span className="section-title">资料来源</span>
            <Badge tone="ok" icon="check">只读清单</Badge>
          </div>
          <p className="hint" style={{ marginTop: 8, lineHeight: 1.7 }}>
            服务端只读扫描项目目录中的文档（md/mdx/txt/rst/json/yaml），不返回文件正文；问答与引用仍未接通。
          </p>
          <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
            <select className="select" style={{ width: 'auto', height: 30 }} value={projectId} onChange={(event) => { setSelectedProjectId(event.target.value); }} aria-label="选择项目">
              {projects.length === 0 ? <option value="">没有项目</option> : projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            <Button variant="secondary" size="sm" icon="refresh" disabled={projectId === '' || sourcesQuery.isFetching} onClick={() => { void sourcesQuery.refetch(); }}>
              {sourcesQuery.isFetching ? '读取中…' : '读取来源'}
            </Button>
          </div>
          {sourcesQuery.isError ? <p className="hint" style={{ marginTop: 8, color: 'var(--danger)' }}>读取失败：{String((sourcesQuery.error as Error).message)}</p> : null}
          {sourcesQuery.data === undefined ? null : sourcesQuery.data.sources.length === 0 ? (
            <p className="hint" style={{ marginTop: 10 }}>项目目录里没有找到支持的文档来源。</p>
          ) : (
            <div className="list" style={{ marginTop: 10, maxHeight: 280, overflow: 'auto' }}>
              {sourcesQuery.data.sources.map((source) => (
                <button key={source.path} type="button" className="list-row" onClick={() => { setSourcePath(source.path); }}>
                  <span className="tile"><Icon name="doc" size="sm" /></span>
                  <span className="grow mono" style={{ fontSize: 12.5, wordBreak: 'break-all', textAlign: 'left' }}>{source.path}</span>
                  <span className="hint">{Math.max(1, Math.round(source.bytes / 1024))} KB</span>
                  <Icon name="chevRight" size="sm" />
                </button>
              ))}
            </div>
          )}
          <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
            <input
              className="input"
              style={{ flex: 1, minWidth: 180 }}
              placeholder="在文档来源中搜索（至少 2 字）"
              value={searchTerm}
              onChange={(event) => { setSearchTerm(event.target.value); }}
              onKeyDown={(event) => { if (event.key === 'Enter') setSubmittedTerm(searchTerm.trim()); }}
              aria-label="搜索知识来源"
            />
            <Button variant="secondary" size="sm" icon="search" disabled={projectId === '' || searchTerm.trim().length < 2} onClick={() => { setSubmittedTerm(searchTerm.trim()); }}>
              搜索
            </Button>
          </div>
          {searchQuery.isError ? <p className="hint" style={{ marginTop: 8, color: 'var(--danger)' }}>搜索失败：{String((searchQuery.error as Error).message)}</p> : null}
          {searchQuery.data === undefined ? null : searchQuery.data.matches.length === 0 ? (
            <p className="hint" style={{ marginTop: 8 }}>没有匹配的文档行。</p>
          ) : (
            <div className="list" style={{ marginTop: 8, maxHeight: 260, overflow: 'auto' }}>
              {searchQuery.data.matches.map((match) => (
                <div key={`${match.path}:${match.line}`} className="list-row" style={{ cursor: 'default', alignItems: 'flex-start' }}>
                  <span className="tile"><Icon name="search" size="sm" /></span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="mono" style={{ fontSize: 12.5, wordBreak: 'break-all' }}>{match.path}:{match.line}</div>
                    <div className="hint" style={{ marginTop: 3 }}>{match.text}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="hint" style={{ marginTop: 8 }}>搜索只读本地文档文本，返回文件与行号；它不是模型问答，也不会生成引用结论。</p>
        </section>

        <section className="card pad">
          <div className="row" style={{ gap: 8 }}>
            <Icon name="terminal" size="sm" />
            <span className="section-title">研究过程与引用</span>
            <Badge tone="idle" icon="lock">
              只读
            </Badge>
          </div>
          <p className="hint" style={{ marginTop: 8, lineHeight: 1.7 }}>
            检索步骤、工具记录与引用原文都由服务端在回答时冻结；页面不会在客户端拼接或模拟这些证据。历史对话同理，需要服务端提供会话读取接口。
          </p>
        </section>
      </div>

      <div className="section">
        <div className="section-head">
          <span className="section-title">建议的服务端能力</span>
          <span className="hint">用于后续接通，不代表已实现</span>
        </div>
        <div className="card">
          <div className="list" style={{ padding: 6 }}>
            {PLANNED_ENTRYPOINTS.map((entry) => (
              <div key={entry.path} className="list-row" style={{ cursor: 'default' }}>
                <Badge outline>{entry.method}</Badge>
                <span className="mono grow" style={{ fontSize: 12.5, overflowWrap: 'anywhere' }}>
                  {entry.path}
                </span>
                <span className="hint" style={{ textAlign: 'right', maxWidth: 320 }}>
                  {entry.purpose}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <Modal
        open={sourcePath !== null}
        title={sourcePath === null ? '来源正文' : sourcePath}
        onClose={() => { setSourcePath(null); }}
        footer={<Button variant="ghost" onClick={() => { setSourcePath(null); }}>关闭</Button>}
      >
        {contentQuery.isLoading ? <p className="hint">正在读取来源…</p> : null}
        {contentQuery.isError ? <p className="hint" style={{ color: 'var(--danger)' }}>读取失败：{String((contentQuery.error as Error).message)}</p> : null}
        {contentQuery.data === undefined ? null : (
          <div className="stack-loose">
            <p className="hint">只读正文，{contentQuery.data.bytes} 字节；内容不会被发送给模型，也不会自动生成引用结论。</p>
            <pre className="code" style={{ maxHeight: '55vh', overflow: 'auto', whiteSpace: 'pre-wrap' }}>{contentQuery.data.content}</pre>
          </div>
        )}
      </Modal>

      <PendingBackendNotice message="资料来源清单与正文读取已接通（只读）；模型问答、检索结论、引用与历史会话仍未接通，本页不展示示例回答或引用编号。" />
    </div>
  );
}
