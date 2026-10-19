import { useState } from 'react';
import { useBootstrap } from '../../api/hooks.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { Icon } from '../../components/Icon.tsx';
import { PendingBackendNotice, ServiceNotice } from '../../components/ServiceNotice.tsx';

const ASK_BLOCKED_REASON = '知识库问答接口尚未接通：服务端没有检索 / 对话 / 引用读取接口，问题不会发送，也没有模拟回答。';
const SOURCE_BLOCKED_REASON = '资料来源接口尚未接通：服务端没有返回可授权的代码、文档与数据库来源。';

const PLANNED_ENTRYPOINTS = [
  { method: 'GET', path: '/api/knowledge/sources', purpose: '返回项目下已授权的资料来源与可读状态' },
  { method: 'POST', path: '/api/knowledge/conversations', purpose: '创建对话并固定项目与来源选择' },
  { method: 'POST', path: '/api/knowledge/conversations/:id/messages', purpose: '发送问题；回答与引用由服务端记录' },
] as const;

export function KnowledgePage() {
  const bootstrap = useBootstrap();
  const [question, setQuestion] = useState('');

  return (
    <div className="page">
      <PageHeader
        title="知识库"
        lede="从代码、文档和数据库中查找依据，每个结论都能回到原文。当前只支持界面浏览；问答与来源接口尚未接通。"
        actions={
          <Badge tone="unknown" icon="help">
            尚未接通
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
            <Button variant="secondary" size="sm" icon="book" disabled disabledReason={SOURCE_BLOCKED_REASON}>
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
            <Badge tone="unknown" icon="help">
              未接通
            </Badge>
          </div>
          <p className="hint" style={{ marginTop: 8, lineHeight: 1.7 }}>
            服务端还没有返回可授权的来源清单，因此这里不列出示例代码库、文档或数据库。接入后，来源选择应保存为本轮问答的输入，并在读取时重新核对许可。
          </p>
          <Button variant="secondary" size="sm" icon="refresh" disabled disabledReason={SOURCE_BLOCKED_REASON} style={{ marginTop: 12 }}>
            读取来源
          </Button>
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

      <PendingBackendNotice message="知识库对话、检索、引用与历史会话都尚未接通。本页不展示示例回答、引用编号或工具调用记录；接入契约与接口后再启用输入。" />
    </div>
  );
}
