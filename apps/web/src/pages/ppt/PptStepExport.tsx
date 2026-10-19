import { useEffect, useState } from 'react';
import { ROUTES, type PptWork, type PptWorkExportResponse } from '@agent-workflow/shared';
import { apiGet, errorMessage } from '../../api/client.ts';
import { formatCount } from '../../app/format.ts';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Modal } from '../../components/Modal.tsx';
import {
  formatFileSize,
  type PptCommand,
  type PptCommandKind,
  type PptCommandSignal,
} from './ppt-shared.tsx';


type PptxState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'running' }
  | { readonly phase: 'done'; readonly filename: string; readonly size: number }
  | { readonly phase: 'failed'; readonly message: string };

type MarkdownState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'running' }
  | { readonly phase: 'done'; readonly data: PptWorkExportResponse }
  | { readonly phase: 'failed'; readonly message: string };

export interface PptStepExportProps {
  readonly work: PptWork;
  readonly busyKind: PptCommandKind | null;
  readonly blocked: boolean;
  readonly blockedReason?: string;
  readonly lastResult: PptCommandSignal | null;
  readonly onCommand: (command: PptCommand) => void;
}

function safeFilename(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 60);
  return cleaned === '' ? '演示' : cleaned;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
}

function errorTextFromBody(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    const message = parsed.error?.message;
    return typeof message === 'string' && message !== '' ? message : undefined;
  } catch {
    return undefined;
  }
}

export function PptStepExport({ work, busyKind, blocked, blockedReason, lastResult, onCommand }: PptStepExportProps) {
  const [pptx, setPptx] = useState<PptxState>({ phase: 'idle' });
  const [markdown, setMarkdown] = useState<MarkdownState>({ phase: 'idle' });
  const [markdownOpen, setMarkdownOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const markdownData = markdown.phase === 'done' ? markdown.data : undefined;
  const anyBusy = busyKind !== null;
  const deleteFailure = lastResult?.kind === 'delete' && lastResult.outcome !== 'succeeded' ? lastResult.message : undefined;
  const canExportPptx = work.outline.length > 0 || work.slides.length > 0;

  useEffect(() => {
    if (lastResult !== null && lastResult.kind === 'delete') setDeleteOpen(false);
  }, [lastResult]);

  const exportPptx = async (): Promise<void> => {
    setPptx({ phase: 'running' });
    try {
      const response = await fetch(ROUTES.pptWorkPptx(work.id), {
        method: 'GET',
        headers: { Accept: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
        credentials: 'same-origin',
      });
      if (!response.ok) {
        const message = errorTextFromBody(await response.text()) ?? `服务返回 HTTP ${String(response.status)}，没有生成 PPTX。`;
        setPptx({ phase: 'failed', message });
        return;
      }
      const blob = await response.blob();
      const filename = `${safeFilename(work.title)}.pptx`;
      downloadBlob(blob, filename);
      setPptx({ phase: 'done', filename, size: blob.size });
    } catch {
      setPptx({ phase: 'failed', message: 'PPTX 请求没有完成：本地服务未连接或响应中断。' });
    }
  };

  const exportMarkdown = async (): Promise<void> => {
    setMarkdown({ phase: 'running' });
    try {
      const response = await apiGet<PptWorkExportResponse>(ROUTES.pptWorkExport(work.id));
      setMarkdown({ phase: 'done', data: response.data });
      setMarkdownOpen(true);
    } catch (error) {
      setMarkdown({ phase: 'failed', message: errorMessage(error) });
    }
  };

  const downloadMarkdown = (): void => {
    if (markdownData === undefined) return;
    downloadBlob(new Blob([markdownData.content], { type: 'text/markdown;charset=utf-8' }), markdownData.filename);
  };

  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="banner info">
        <Icon name="info" />
        <div className="grow">
          <b>导出由服务即时生成，且不会回写作品状态</b>
          <br />
          PPTX 与 Markdown 都由服务按当前大纲/逐页内容生成；服务没有“已导出”状态或版本记录，因此阶段条不会把「导出」标成已完成。
          Markdown 导出返回文件名与正文，可在弹窗中预览后下载。
        </div>
      </div>

      <div className="ppt-export-grid">
        <section className="ppt-export-card">
          <div className="row" style={{ gap: 8 }}>
            <span className="tile">
              <Icon name="slides" />
            </span>
            <div className="grow">
              <h4 style={{ fontSize: 13.5, fontWeight: 500 }}>PowerPoint（.pptx）</h4>
              <div className="hint">按当前大纲/逐页要点与版式主题生成；图片附件会尝试作为页面配图。</div>
            </div>
          </div>
          <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
            <Button
              variant="primary"
              icon="download"
              disabled={blocked || pptx.phase === 'running' || !canExportPptx}
              disabledReason={
                blockedReason ??
                (pptx.phase === 'running'
                  ? 'PPTX 正在生成，等下载结束再点。'
                  : !canExportPptx
                    ? '先生成或编辑大纲；服务在没有大纲时会拒绝导出 PPTX。'
                    : undefined)
              }
              onClick={() => {
                void exportPptx();
              }}
            >
              {pptx.phase === 'running' ? '正在生成 PPTX…' : '导出 PPTX'}
            </Button>
            <span className="hint num">
              {work.slides.length > 0
                ? `将导出 ${String(work.slides.length)} 页逐页内容`
                : `将按 ${String(work.outline.length)} 条大纲导出（无逐页要点）`}
            </span>
          </div>
          {pptx.phase === 'done' ? (
            <div className="banner ok" style={{ marginTop: 10 }}>
              <Icon name="check" />
              <div className="grow">
                已下载 {pptx.filename} · {formatFileSize(pptx.size)}。
              </div>
              <div className="actions">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPptx({ phase: 'idle' });
                  }}
                >
                  收起
                </Button>
              </div>
            </div>
          ) : null}
          {pptx.phase === 'failed' ? (
            <div className="banner danger" role="alert" style={{ marginTop: 10 }}>
              <Icon name="alert" />
              <div className="grow">PPTX 导出失败：{pptx.message}</div>
            </div>
          ) : null}
        </section>

        <section className="ppt-export-card">
          <div className="row" style={{ gap: 8 }}>
            <span className="tile">
              <Icon name="file" />
            </span>
            <div className="grow">
              <h4 style={{ fontSize: 13.5, fontWeight: 500 }}>Markdown（.md）</h4>
              <div className="hint">返回标题、主题与大纲；即使没有大纲也能导出，内容由服务生成。</div>
            </div>
          </div>
          <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
            <Button
              variant="secondary"
              icon="file"
              disabled={blocked || markdown.phase === 'running'}
              disabledReason={blockedReason ?? (markdown.phase === 'running' ? 'Markdown 正在导出，等响应返回再点。' : undefined)}
              onClick={() => {
                void exportMarkdown();
              }}
            >
              {markdown.phase === 'running' ? '正在导出 Markdown…' : '导出 Markdown'}
            </Button>
            <span className="hint">导出内容来自服务，不在前端拼接。</span>
          </div>
          {markdown.phase === 'done' ? (
            <div className="banner ok" style={{ marginTop: 10 }}>
              <Icon name="check" />
              <div className="grow">
                已导出 {markdown.data.filename} · {formatCount(markdown.data.content.length)} 字。
              </div>
              <div className="actions">
                <Button
                  variant="secondary"
                  size="sm"
                  icon="eye"
                  onClick={() => {
                    setMarkdownOpen(true);
                  }}
                >
                  预览
                </Button>
              </div>
            </div>
          ) : null}
          {markdown.phase === 'failed' ? (
            <div className="banner danger" role="alert" style={{ marginTop: 10 }}>
              <Icon name="alert" />
              <div className="grow">Markdown 导出失败：{markdown.message}</div>
            </div>
          ) : null}
        </section>
      </div>

      <div className="ppt-danger-zone">
        <div className="grow">
          <div className="row" style={{ gap: 8 }}>
            <Icon name="trash" size="sm" />
            <b style={{ fontSize: 13.5 }}>删除作品</b>
          </div>
          <div className="hint" style={{ marginTop: 4 }}>
            删除会从服务移除该作品的大纲、逐页内容与附件，服务不保留副本，也无法恢复；导出文件仍留在你的下载目录。
          </div>
        </div>
        <Button
          variant="danger"
          size="sm"
          icon="trash"
          disabled={anyBusy}
          disabledReason={anyBusy ? blockedReason : undefined}
          onClick={() => {
            setDeleteOpen(true);
          }}
        >
          删除作品
        </Button>
      </div>

      <Modal
        open={deleteOpen}
        title="删除作品"
        onClose={() => {
          if (busyKind === 'delete') return;
          setDeleteOpen(false);
        }}
        footer={
          <>
            <Button
              variant="ghost"
              disabled={busyKind === 'delete'}
              disabledReason={busyKind === 'delete' ? '删除请求已发出，正在等待服务回执。' : undefined}
              onClick={() => {
                setDeleteOpen(false);
              }}
            >
              取消
            </Button>
            <Button
              variant="danger"
              icon="trash"
              disabled={busyKind === 'delete'}
              disabledReason={busyKind === 'delete' ? '删除请求已发出，正在等待服务回执。' : undefined}
              onClick={() => {
                onCommand({ kind: 'delete', workId: work.id });
              }}
            >
              {busyKind === 'delete' ? '正在删除…' : '确认删除'}
            </Button>
          </>
        }
      >
        <p style={{ lineHeight: 1.7 }}>
          确定删除《{work.title}》吗？删除会移除该作品的大纲、逐页内容与附件，服务不保留副本，也无法恢复。
        </p>
        {deleteFailure === undefined ? null : (
          <div className="error-text">
            <Icon name="alert" size="sm" />
            {deleteFailure}
          </div>
        )}
        <p className="hint mono" style={{ wordBreak: 'break-all' }}>
          {work.id}
        </p>
      </Modal>

      <Modal
        open={markdownOpen && markdownData !== undefined}
        title={markdownData === undefined ? 'Markdown 导出' : `Markdown 导出 · ${markdownData.filename}`}
        onClose={() => {
          setMarkdownOpen(false);
        }}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setMarkdownOpen(false);
              }}
            >
              关闭
            </Button>
            <Button
              variant="secondary"
              icon="download"
              disabled={markdownData === undefined}
              disabledReason={markdownData === undefined ? '还没有导出内容。' : undefined}
              onClick={downloadMarkdown}
            >
              下载 .md
            </Button>
          </>
        }
      >
        {markdownData === undefined ? null : <pre className="ppt-md">{markdownData.content}</pre>}
      </Modal>
    </div>
  );
}
