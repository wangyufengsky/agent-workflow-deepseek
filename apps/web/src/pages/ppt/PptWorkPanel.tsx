import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  ROUTES,
  THEME_IDS,
  THEMES,
  createRequestKey,
  type PptWork,
  type PptWorkExportResponse,
  type ThemeIdValue,
} from '@agent-workflow/shared';
import { apiGet, errorMessage } from '../../api/client.ts';
import { formatCount, formatRelativeTime } from '../../app/format.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Modal } from '../../components/Modal.tsx';
import {
  formatFileSize,
  pptPageSummary,
  pptStatusMeta,
  themeLabel,
  type PptCommand,
  type PptCommandKind,
  type PptCommandSignal,
} from './ppt-shared.tsx';

const MAX_ATTACHMENTS = 10;
const MAX_OUTLINE_ITEMS = 40;

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

export interface PptWorkPanelProps {
  readonly work: PptWork;
  readonly projectName?: string;
  readonly busyKind: PptCommandKind | null;
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

/** 选中作品后的完整操作区：生成、编辑、附件、导出、删除。 */
export function PptWorkPanel({ work, projectName, busyKind, lastResult, onCommand }: PptWorkPanelProps) {
  const status = pptStatusMeta(work.status);
  const anyBusy = busyKind !== null;
  const generating = work.status === 'generating';
  const commandBlockedReason = anyBusy
    ? '另一条 PPT 命令正在等待服务回执；为避免重复提交，先等它结束。'
    : generating
      ? '服务把这份作品标记为「生成中」；等模型调用结束后再操作。'
      : undefined;
  const commandBlocked = anyBusy || generating;

  const [attachName, setAttachName] = useState('');
  const [attachKind, setAttachKind] = useState<'text' | 'image'>('text');
  const [attachText, setAttachText] = useState('');
  const [attachImage, setAttachImage] = useState<{ readonly name: string; readonly dataUrl: string } | null>(null);
  const [attachError, setAttachError] = useState<string | undefined>(undefined);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editError, setEditError] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState<{
    readonly title: string;
    readonly topic: string;
    readonly outlineText: string;
    readonly theme: ThemeIdValue;
  }>({ title: work.title, topic: work.topic, outlineText: work.outline.join('\n'), theme: work.theme });

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pptx, setPptx] = useState<PptxState>({ phase: 'idle' });
  const [markdown, setMarkdown] = useState<MarkdownState>({ phase: 'idle' });
  const [markdownOpen, setMarkdownOpen] = useState(false);
  const markdownData = markdown.phase === 'done' ? markdown.data : undefined;

  const lastFailure = lastResult !== null && lastResult.outcome !== 'succeeded' ? lastResult.message : undefined;
  const attachFailure = lastResult?.kind === 'attach' ? lastFailure : undefined;
  const updateFailure = lastResult?.kind === 'update' ? lastFailure : undefined;
  const deleteFailure = lastResult?.kind === 'delete' ? lastFailure : undefined;

  // 命令结束后的表单收尾：成功时清空附件输入/关闭编辑框，删除无论结果都关闭确认框，
  // 失败与未知则把服务说明留在对应表单里。
  useEffect(() => {
    if (lastResult === null) return;
    if (lastResult.kind === 'attach' && lastResult.outcome === 'succeeded') {
      setAttachName('');
      setAttachText('');
      setAttachImage(null);
      setAttachError(undefined);
    } else if (lastResult.kind === 'update' && lastResult.outcome === 'succeeded') {
      setEditOpen(false);
      setEditError(undefined);
    } else if (lastResult.kind === 'delete') {
      setDeleteOpen(false);
    }
  }, [lastResult]);

  const submitAttachment = (): void => {
    if (work.attachments.length >= MAX_ATTACHMENTS) {
      setAttachError(`最多 ${String(MAX_ATTACHMENTS)} 个附件；先移除一个再添加。`);
      return;
    }
    const name = attachName.trim() === '' ? (attachKind === 'image' ? (attachImage?.name ?? '') : '') : attachName.trim();
    if (name === '') {
      setAttachError(attachKind === 'image' ? '选择图片文件，或填写附件名。' : '填写附件名。');
      return;
    }
    const content = attachKind === 'text' ? attachText : (attachImage?.dataUrl ?? '');
    if (content.trim() === '') {
      setAttachError(attachKind === 'text' ? '文本内容不能为空。' : '先选择一张图片。');
      return;
    }
    onCommand({
      kind: 'attach',
      workId: work.id,
      body: { requestKey: createRequestKey(), name, content, kind: attachKind, confirmAttach: true },
    });
  };

  const onPickImage = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file === undefined) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setAttachError('图片附件只支持 PNG / JPEG / WebP。');
      return;
    }
    if (file.size > 2_000_000) {
      setAttachError('图片文件超过约 2 MB；服务按 data URL 校验，上限 3 MB。');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        setAttachError('读取图片文件失败。');
        return;
      }
      setAttachImage({ name: file.name, dataUrl: reader.result });
      setAttachName((prev) => (prev.trim() === '' ? file.name : prev));
      setAttachError(undefined);
    };
    reader.onerror = () => {
      setAttachError('读取图片文件失败。');
    };
    reader.readAsDataURL(file);
  };

  const submitEdit = (): void => {
    const title = draft.title.trim();
    if (title === '') {
      setEditError('标题不能为空（服务要求 1–120 字）。');
      return;
    }
    if (title.length > 120) {
      setEditError('标题最长 120 字。');
      return;
    }
    const topic = draft.topic.trim();
    if (topic.length > 2_000) {
      setEditError('主题最长 2000 字。');
      return;
    }
    const outline = draft.outlineText
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (outline.length > MAX_OUTLINE_ITEMS) {
      setEditError(`大纲最多 ${String(MAX_OUTLINE_ITEMS)} 条，请先精简。`);
      return;
    }
    onCommand({
      kind: 'update',
      workId: work.id,
      body: { requestKey: createRequestKey(), title, topic, outline, theme: draft.theme, confirmUpdate: true },
    });
  };

  const exportPptx = async (): Promise<void> => {
    setPptx({ phase: 'running' });
    try {
      const response = await fetch(`${ROUTES.pptWork(work.id)}/pptx`, {
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

  const openEdit = (): void => {
    setDraft({ title: work.title, topic: work.topic, outlineText: work.outline.join('\n'), theme: work.theme });
    setEditError(undefined);
    setEditOpen(true);
  };

  return (
    <>
      <section className="card" aria-label="作品详情">
        <div className="card-head">
          <span className="tile">
            <Icon name="slides" />
          </span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="row" style={{ gap: 8 }}>
              <h3 className="ellipsis" style={{ fontSize: 15, fontWeight: 500 }} title={work.title}>
                {work.title}
              </h3>
              <Badge tone={status.tone} icon={status.icon}>
                {status.label}
              </Badge>
            </div>
            <div className="hint ellipsis" title={work.topic}>
              {work.topic}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon="edit"
            disabled={commandBlocked}
            disabledReason={commandBlockedReason}
            onClick={openEdit}
          >
            编辑
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon="trash"
            disabled={anyBusy}
            disabledReason={anyBusy ? commandBlockedReason : undefined}
            onClick={() => {
              setDeleteOpen(true);
            }}
          >
            删除
          </Button>
        </div>

        <div className="card-body col" style={{ gap: 18 }}>
          <div className="ppt-meta">
            <span>主题：{themeLabel(work.theme)}</span>
            <span>{pptPageSummary(work)}</span>
            <span>
              附件 {String(work.attachments.length)}/{String(MAX_ATTACHMENTS)}
            </span>
            <span>更新于 {formatRelativeTime(work.updatedAt)}</span>
            {projectName === undefined ? <span>未归属项目</span> : <span>项目：{projectName}</span>}
            {work.usage === undefined ? null : <span>模型 tokens：{formatCount(work.usage.total)}</span>}
          </div>

          <div className="col" style={{ gap: 8 }}>
            <div className="ppt-actions">
              <Button
                variant="primary"
                icon="wand"
                disabled={commandBlocked}
                disabledReason={commandBlockedReason}
                onClick={() => {
                  onCommand({ kind: 'generate', workId: work.id, body: { requestKey: createRequestKey(), confirmGenerate: true } });
                }}
              >
                {busyKind === 'generate' ? '正在生成大纲…可能较慢' : '生成大纲'}
              </Button>
              <Button
                variant="secondary"
                icon="layers"
                disabled={commandBlocked || work.outline.length === 0}
                disabledReason={
                  commandBlockedReason ??
                  (work.outline.length === 0 ? '先生成或编辑大纲；服务要求至少 1 条大纲才能生成逐页内容。' : undefined)
                }
                onClick={() => {
                  onCommand({ kind: 'generateSlides', workId: work.id, body: { requestKey: createRequestKey(), confirmGenerate: true } });
                }}
              >
                {busyKind === 'generateSlides' ? '正在生成逐页…可能较慢' : '生成逐页内容'}
              </Button>
              <Button
                variant="secondary"
                icon="download"
                disabled={commandBlocked || pptx.phase === 'running' || (work.outline.length === 0 && work.slides.length === 0)}
                disabledReason={
                  commandBlockedReason ??
                  (pptx.phase === 'running'
                    ? 'PPTX 正在生成，等下载结束再点。'
                    : work.outline.length === 0 && work.slides.length === 0
                      ? '先生成或编辑大纲；服务在没有大纲时会拒绝导出 PPTX。'
                      : undefined)
                }
                onClick={() => {
                  void exportPptx();
                }}
              >
                {pptx.phase === 'running' ? '正在生成 PPTX…' : '导出 PPTX'}
              </Button>
              <Button
                variant="secondary"
                icon="file"
                disabled={commandBlocked || markdown.phase === 'running'}
                disabledReason={
                  commandBlockedReason ?? (markdown.phase === 'running' ? 'Markdown 正在导出，等响应返回再点。' : undefined)
                }
                onClick={() => {
                  void exportMarkdown();
                }}
              >
                {markdown.phase === 'running' ? '正在导出 Markdown…' : '导出 Markdown'}
              </Button>
            </div>
            <p className="hint">
              生成大纲与逐页内容会调用受管 OpenCode 模型，通常需要 30–120 秒，<b>可能较慢</b>
              ；服务返回回执前请不要重复点击。PPTX 由服务按当前大纲/逐页内容生成，Markdown 导出内容可在弹窗中查看与下载。
            </p>
          </div>

          {generating ? (
            <div className="banner info">
              <Icon name="clock" />
              <div className="grow">
                <b>生成中</b>
                <br />
                服务正在为该作品调用模型。页面每 5 秒刷新一次作品列表；收到 succeeded / failed / unknown 回执后这里会显示真实结果。
              </div>
            </div>
          ) : null}

          {pptx.phase === 'done' ? (
            <div className="banner ok">
              <Icon name="check" />
              <div className="grow">
                <b>已下载 PPTX</b>
                <br />
                {pptx.filename} · {formatFileSize(pptx.size)}。文件由服务按当前大纲/逐页内容生成，浏览器已开始下载。
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
            <div className="banner danger" role="alert">
              <Icon name="alert" />
              <div className="grow">
                <b>PPTX 导出失败</b>
                <br />
                {pptx.message}
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
          {markdown.phase === 'done' ? (
            <div className="banner ok">
              <Icon name="check" />
              <div className="grow">
                <b>已导出 Markdown</b>
                <br />
                {markdown.data.filename} · {formatCount(markdown.data.content.length)} 字。内容来自服务端导出接口，可在弹窗中预览与下载。
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
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setMarkdown({ phase: 'idle' });
                  }}
                >
                  收起
                </Button>
              </div>
            </div>
          ) : null}
          {markdown.phase === 'failed' ? (
            <div className="banner danger" role="alert">
              <Icon name="alert" />
              <div className="grow">
                <b>Markdown 导出失败</b>
                <br />
                {markdown.message}
              </div>
              <div className="actions">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setMarkdown({ phase: 'idle' });
                  }}
                >
                  收起
                </Button>
              </div>
            </div>
          ) : null}

          <div>
            <div className="row" style={{ gap: 8, marginBottom: 8 }}>
              <h4 style={{ fontSize: 13.5, fontWeight: 500 }}>大纲</h4>
              <span className="hint num">{String(work.outline.length)} 条</span>
              <span className="grow" />
              <Button variant="ghost" size="sm" icon="edit" disabled={commandBlocked} disabledReason={commandBlockedReason} onClick={openEdit}>
                编辑大纲
              </Button>
            </div>
            {work.outline.length === 0 ? (
              <p className="hint">还没有大纲。可以「生成大纲」让模型给出结构，或「编辑大纲」自己写每页标题。</p>
            ) : (
              <ol className="ppt-outline">
                {work.outline.map((title, index) => (
                  <li key={`${String(index)}-${title}`}>
                    <span className="ppt-num">{String(index + 1).padStart(2, '0')}</span>
                    <span className="grow">{title}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div>
            <div className="row" style={{ gap: 8, marginBottom: 8 }}>
              <h4 style={{ fontSize: 13.5, fontWeight: 500 }}>逐页内容</h4>
              <span className="hint num">{String(work.slides.length)} 页</span>
            </div>
            {work.slides.length === 0 ? (
              <p className="hint">还没有逐页要点。先生成大纲，再「生成逐页内容」；PPTX 会使用逐页要点。</p>
            ) : (
              <div className="ppt-slides">
                {work.slides.map((slide, index) => (
                  <div className="ppt-slide" key={`${String(index)}-${slide.title}`}>
                    <div className="row" style={{ gap: 8 }}>
                      <span className="ppt-num">第 {String(index + 1)} 页</span>
                      <b className="grow" style={{ fontSize: 13.5, fontWeight: 500 }}>
                        {slide.title}
                      </b>
                    </div>
                    {slide.bullets.length === 0 ? (
                      <div className="hint" style={{ marginTop: 4 }}>
                        模型没有返回要点
                      </div>
                    ) : (
                      <ul>
                        {slide.bullets.map((bullet, bulletIndex) => (
                          <li key={`${String(bulletIndex)}-${bullet}`}>{bullet}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="row" style={{ gap: 8, marginBottom: 8 }}>
              <h4 style={{ fontSize: 13.5, fontWeight: 500 }}>附件</h4>
              <span className="hint num">
                {String(work.attachments.length)}/{String(MAX_ATTACHMENTS)}
              </span>
            </div>
            {work.attachments.length === 0 ? (
              <p className="hint">还没有附件。文本附件会作为生成大纲/逐页内容时的资料；图片附件会用于 PPTX 页面配图。</p>
            ) : (
              <div className="list">
                {work.attachments.map((attachment) => (
                  <div className="list-row" key={attachment.name}>
                    {attachment.kind === 'image' ? (
                      <img className="ppt-attach-thumb" src={attachment.content} alt={attachment.name} />
                    ) : (
                      <span className="tile">
                        <Icon name="file" />
                      </span>
                    )}
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <span className="ellipsis" style={{ fontSize: 13.5 }}>
                          {attachment.name}
                        </span>
                        <Badge tone="neutral">{attachment.kind === 'image' ? '图片' : '文本'}</Badge>
                      </div>
                      <div className="hint ellipsis">
                        {attachment.kind === 'text' ? `${String(attachment.size)} 字符` : formatFileSize(attachment.size)} · 添加于{' '}
                        {formatRelativeTime(attachment.addedAt)}
                        {attachment.kind === 'text' ? ` · ${attachment.content.slice(0, 60)}` : ''}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="trash"
                      disabled={anyBusy}
                      disabledReason={anyBusy ? commandBlockedReason : undefined}
                      onClick={() => {
                        onCommand({ kind: 'detach', workId: work.id, name: attachment.name });
                      }}
                    >
                      {busyKind === 'detach' ? '移除中…' : '移除'}
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <form
              className="ppt-attach-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (anyBusy) return;
                submitAttachment();
              }}
            >
              <div className="row" style={{ gap: 8 }}>
                <h5 className="grow" style={{ fontSize: 13, fontWeight: 500 }}>
                  添加附件
                </h5>
                <span className="hint">文本上限 200 KB，图片 data URL 上限 3 MB，同名附件会被服务拒绝</span>
              </div>
              <div className="ppt-field-row">
                <div className="field">
                  <label className="label" htmlFor={`ppt-attach-name-${work.id}`}>
                    附件名
                  </label>
                  <input
                    id={`ppt-attach-name-${work.id}`}
                    className="input"
                    value={attachName}
                    placeholder="例如 notes.md"
                    disabled={anyBusy}
                    onChange={(event) => {
                      setAttachName(event.target.value);
                      setAttachError(undefined);
                    }}
                  />
                </div>
                <div className="field" style={{ flex: '0 0 150px' }}>
                  <label className="label" htmlFor={`ppt-attach-kind-${work.id}`}>
                    类型
                  </label>
                  <select
                    id={`ppt-attach-kind-${work.id}`}
                    className="select"
                    value={attachKind}
                    disabled={anyBusy}
                    onChange={(event) => {
                      setAttachKind(event.target.value === 'image' ? 'image' : 'text');
                      setAttachError(undefined);
                    }}
                  >
                    <option value="text">文本</option>
                    <option value="image">图片</option>
                  </select>
                </div>
              </div>

              {attachKind === 'text' ? (
                <div className="field" style={{ margin: 0 }}>
                  <label className="label" htmlFor={`ppt-attach-content-${work.id}`}>
                    文本内容
                  </label>
                  <textarea
                    id={`ppt-attach-content-${work.id}`}
                    className="textarea"
                    value={attachText}
                    placeholder="粘贴资料、要点或会议记录；生成时最多取前 4000 字送入模型。"
                    disabled={anyBusy}
                    onChange={(event) => {
                      setAttachText(event.target.value);
                      setAttachError(undefined);
                    }}
                  />
                  <span className="hint num">{String(attachText.length)} 字</span>
                </div>
              ) : (
                <div className="col" style={{ gap: 8 }}>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    style={{ display: 'none' }}
                    onChange={onPickImage}
                  />
                  <div className="row wrap" style={{ gap: 8 }}>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="upload"
                      disabled={anyBusy}
                      disabledReason={anyBusy ? commandBlockedReason : undefined}
                      onClick={() => {
                        imageInputRef.current?.click();
                      }}
                    >
                      {attachImage === null ? '选择图片' : '重新选择'}
                    </Button>
                    {attachImage === null ? (
                      <span className="hint">支持 PNG / JPEG / WebP，约 2 MB 以内（服务按 data URL 校验，上限 3 MB）。</span>
                    ) : (
                      <>
                        <img className="ppt-attach-thumb" src={attachImage.dataUrl} alt={attachImage.name} />
                        <span className="hint ellipsis">
                          {attachImage.name} · data URL {formatCount(attachImage.dataUrl.length)} 字符
                        </span>
                      </>
                    )}
                  </div>
                </div>
              )}

              {attachError === undefined && attachFailure === undefined ? null : (
                <div className="error-text">
                  <Icon name="alert" size="sm" />
                  {attachError ?? attachFailure}
                </div>
              )}

              <div className="row">
                <span className="grow" />
                <Button type="submit" variant="primary" size="sm" icon="plus" disabled={anyBusy} disabledReason={commandBlockedReason}>
                  {busyKind === 'attach' ? '正在添加…' : '添加附件'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </section>

      <Modal
        open={editOpen}
        title="编辑作品"
        onClose={() => {
          if (busyKind === 'update') return;
          setEditOpen(false);
          setEditError(undefined);
        }}
        footer={
          <>
            <Button
              variant="ghost"
              disabled={busyKind === 'update'}
              disabledReason={busyKind === 'update' ? '保存请求已发出，正在等待服务回执。' : undefined}
              onClick={() => {
                setEditOpen(false);
                setEditError(undefined);
              }}
            >
              取消
            </Button>
            <Button
              variant="primary"
              icon="check"
              disabled={anyBusy || draft.title.trim() === ''}
              disabledReason={
                anyBusy ? commandBlockedReason : draft.title.trim() === '' ? '标题不能为空（服务要求 1–120 字）。' : undefined
              }
              onClick={submitEdit}
            >
              {busyKind === 'update' ? '正在保存…' : '保存修改'}
            </Button>
          </>
        }
      >
        <div className="col" style={{ gap: 14 }}>
          <div className="field" style={{ margin: 0 }}>
            <label className="label" htmlFor={`ppt-edit-title-${work.id}`}>
              标题<span className="req">*</span>
            </label>
            <input
              id={`ppt-edit-title-${work.id}`}
              className="input"
              value={draft.title}
              disabled={busyKind === 'update'}
              onChange={(event) => {
                setDraft((prev) => ({ ...prev, title: event.target.value }));
                setEditError(undefined);
              }}
            />
            <span className="hint num">{String(draft.title.length)} / 120 字</span>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="label" htmlFor={`ppt-edit-topic-${work.id}`}>
              主题
            </label>
            <textarea
              id={`ppt-edit-topic-${work.id}`}
              className="textarea"
              value={draft.topic}
              disabled={busyKind === 'update'}
              onChange={(event) => {
                setDraft((prev) => ({ ...prev, topic: event.target.value }));
                setEditError(undefined);
              }}
            />
            <span className="hint num">{String(draft.topic.length)} / 2000 字</span>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="label" htmlFor={`ppt-edit-outline-${work.id}`}>
              大纲（每行一页标题）
            </label>
            <textarea
              id={`ppt-edit-outline-${work.id}`}
              className="textarea"
              style={{ minHeight: 150 }}
              value={draft.outlineText}
              placeholder={'例如：\n开场：为什么讲这个\n整体架构\n任务的一生'}
              disabled={busyKind === 'update'}
              onChange={(event) => {
                setDraft((prev) => ({ ...prev, outlineText: event.target.value }));
                setEditError(undefined);
              }}
            />
            <span className="hint">
              空行会被忽略；服务最多保存 {String(MAX_OUTLINE_ITEMS)} 条大纲，单条截断到 200 字。保存不会调用模型，也不会重建已有逐页内容。
            </span>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="label" htmlFor={`ppt-edit-theme-${work.id}`}>
              版式主题（导出 PPTX 时生效）
            </label>
            <select
              id={`ppt-edit-theme-${work.id}`}
              className="select"
              value={draft.theme}
              disabled={busyKind === 'update'}
              onChange={(event) => {
                setDraft((prev) => ({ ...prev, theme: event.target.value as ThemeIdValue }));
                setEditError(undefined);
              }}
            >
              {THEME_IDS.map((id) => (
                <option key={id} value={id}>
                  {THEMES[id].label}（{id}）
                </option>
              ))}
            </select>
          </div>
          {editError === undefined && updateFailure === undefined ? null : (
            <div className="error-text">
              <Icon name="alert" size="sm" />
              {editError ?? updateFailure}
            </div>
          )}
        </div>
      </Modal>

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
          确定删除《{work.title}》吗？删除会从服务里移除该作品的大纲、逐页内容与附件，服务不保留副本，也无法恢复。
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
    </>
  );
}
