import { useEffect, useState } from 'react';
import { pptPages, ROUTES, type PptWork, type PptWorkExportResponse } from '@agent-workflow/shared';
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
  | { readonly phase: 'done'; readonly filename: string; readonly size: number; readonly saved?: boolean; readonly sha256?: string }
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
  const [format,setFormat] = useState<'pptx'|'pdf'>('pptx');
  const [includeNotes,setIncludeNotes] = useState(work.plan?.delivery.includeNotes !== false);
  const [cancelled,setCancelled] = useState(false);
  const exportBlocked=busyKind!==null||work.status==='generating'||work.mutationBlock!==undefined||work.actions?.export?.allowed===false;
  const exportReason=work.actions?.export?.reason??blockedReason;
  const [pptx, setPptx] = useState<PptxState>({ phase: 'idle' });
  const [markdown, setMarkdown] = useState<MarkdownState>({ phase: 'idle' });
  const [markdownOpen, setMarkdownOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const markdownData = markdown.phase === 'done' ? markdown.data : undefined;
  const anyBusy = busyKind !== null;
  const deleteFailure = lastResult?.kind === 'delete' && lastResult.outcome !== 'succeeded' ? lastResult.message : undefined;
  const unfinished=(work.generation?.pages??work.productionPages)?.filter(page=>page.status!=='completed').length??0;
  const canExportPptx = unfinished===0 && (work.outline.length > 0 || work.slides.length > 0);

  useEffect(() => {
    setPptx({phase:'idle'});setMarkdown({phase:'idle'});setMarkdownOpen(false);setCancelled(false);
  }, [work.id,work.revision]);

  useEffect(() => {
    if (lastResult !== null && lastResult.kind === 'delete') setDeleteOpen(false);
  }, [lastResult]);

  const exportPptx = async (): Promise<void> => {
    setPptx({ phase: 'running' });
    try {
      setCancelled(false);
      if(window.workflowDesktop?.exportPpt){const result=await window.workflowDesktop.exportPpt({workId:work.id,revision:work.revision??1,format,includeNotes});if(result.status==='saved')setPptx({phase:'done',filename:result.filename,size:result.size,saved:true,sha256:result.sha256});else if(result.status==='cancelled'){setPptx({phase:'idle'});setCancelled(true);}else setPptx({phase:'failed',message:result.status==='failed'?result.message:'当前宿主不支持保存演示'});return;}
      if(format==='pdf'){setPptx({phase:'failed',message:'PDF需要桌面打印宿主，请在桌面窗口导出'});return;}
      const response = await fetch(`${ROUTES.pptWorkPptx(work.id)}?revision=${work.revision??1}&includeNotes=${includeNotes}`, {
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
      const filename = `${safeFilename(work.plan?.delivery.filename || work.title)}.pptx`;
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
    <div className="col" style={{ gap: 18 }}>{unfinished>0?<div className="banner warn" role="status"><Icon name="alert"/>{exportReason}</div>:null}
      <div className="banner info">
        <Icon name="info" />
        <div className="grow">
          <b>导出由服务即时生成，且不会回写作品状态</b>
          <br />
          PPTX、PDF 与 Markdown 使用当前大纲、逐页内容与对象样式；服务没有“已导出”状态或版本记录，因此阶段条不会把「导出」标成已完成。
          PDF由受控桌面打印宿主生成，保存后核对文件哈希；浏览器下载只表示已发起下载。Markdown可先预览再下载。
        </div>
      </div>

      <div className="ppt-export-grid">
        <section className="ppt-export-card">
          <div className="row" style={{ gap: 8 }}>
            <span className="tile">
              <Icon name="slides" />
            </span>
            <div className="grow">
              <h4 style={{ fontSize: 13.5, fontWeight: 500 }}>演示文件</h4>
              <div className="hint">按当前大纲/逐页要点与版式主题生成；图片附件会尝试作为页面配图。</div>
            </div>
          </div>
          <div role="radiogroup" aria-label="导出格式" className="col" style={{gap:8,marginTop:12}}>{([['pptx','PowerPoint (.pptx)','可继续编辑'],['pdf','PDF','适合分享和打印']] as const).map(([value,label,hint])=><label className="list-row" key={value}><input type="radio" name="ppt-export-format" checked={format===value} disabled={pptx.phase==='running'} onChange={()=>{setFormat(value);setPptx({phase:'idle'});setCancelled(false);}}/><span>{label}<span className="hint"> · {hint}</span></span></label>)}</div>
          <label className="row" style={{gap:8,marginTop:14}}><input type="checkbox" checked={includeNotes} disabled={pptx.phase==='running'} onChange={event=>{setIncludeNotes(event.target.checked);setPptx({phase:'idle'});setCancelled(false);}}/>包含演讲备注</label>
          <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
            <Button
              variant="primary"
              icon="download"
              disabled={exportBlocked || pptx.phase === 'running' || !canExportPptx || format==='pdf'&&!window.workflowDesktop?.exportPpt}
              disabledReason={
                (exportBlocked ? exportReason : undefined) ?? (format==='pdf'&&!window.workflowDesktop?.exportPpt?'PDF需要桌面打印宿主':undefined) ??
                (pptx.phase === 'running'
                  ? '演示文件正在生成并保存，请等待当前操作结束。'
                  : !canExportPptx
                    ? exportReason??'先完成页面制作再导出。'
                    : undefined)
              }
              onClick={() => {
                void exportPptx();
              }}
            >
              {pptx.phase === 'running' ? '正在生成并保存…' : `导出 ${format.toUpperCase()}`}
            </Button>
            <span className="hint num">
              导出基于修订 {work.revision??1} · {pptPages(work).length} 个演示页面（含当前封面）{format==='pdf'&&includeNotes?` · 另附 ${pptPages(work).filter(page=>page.notes).length} 个备注页`:''}
            </span>
          </div>
          {pptx.phase === 'done' ? (
            <div className="banner ok" style={{ marginTop: 10 }}>
              <Icon name="check" />
              <div className="grow">
                {pptx.saved?'已保存并核对文件':'已发起浏览器下载'} {pptx.filename} · {formatFileSize(pptx.size)}。{pptx.sha256?<div className="hint mono" style={{overflowWrap:'anywhere'}}>SHA-256 {pptx.sha256}</div>:null}
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
          {cancelled?<p className="hint" role="status"><Icon name="minus" size="sm"/>已取消保存，没有保存文件。</p>:null}
          {pptx.phase === 'failed' ? (
            <div className="banner danger" role="alert" style={{ marginTop: 10 }}>
              <Icon name="alert" />
              <div className="grow">导出失败：{pptx.message}</div>
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
              <div className="hint">返回当前标题、主题、大纲与正文；逐页制作未完成时需先完成或明确手动保存，内容由服务生成。</div>
            </div>
          </div>
          <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
            <Button
              variant="secondary"
              icon="file"
              disabled={exportBlocked || markdown.phase === 'running'}
              disabledReason={exportReason ?? (markdown.phase === 'running' ? 'Markdown 正在导出，等响应返回再点。' : undefined)}
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
