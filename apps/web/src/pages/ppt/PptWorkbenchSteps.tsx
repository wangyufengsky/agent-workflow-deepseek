import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { THEME_IDS, THEMES, createRequestKey, type PptWork, type ThemeIdValue } from '@agent-workflow/shared';
import { formatAbsoluteTime, formatCount, formatRelativeTime } from '../../app/format.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import {
  formatFileSize,
  pptPageCount,
  pptPageSummary,
  pptStatusMeta,
  themeLabel,
  type PptCommand,
  type PptCommandKind,
  type PptCommandSignal,
} from './ppt-shared.tsx';

const MAX_ATTACHMENTS = 10;
const MAX_OUTLINE_ITEMS = 40;

export interface PptStepCommonProps {
  readonly work: PptWork;
  readonly busyKind: PptCommandKind | null;
  readonly blocked: boolean;
  readonly blockedReason?: string;
  readonly onCommand: (command: PptCommand) => void;
}

export interface PptStepDiscussionProps extends PptStepCommonProps {
  readonly projectName?: string;
  readonly onNext: () => void;
}

/** ① 讨论需求：真实标题/主题/大纲编辑（PATCH），不伪造设计稿的需求简报五项。 */
export function PptStepDiscussion({ work, busyKind, blocked, blockedReason, projectName, onCommand, onNext }: PptStepDiscussionProps) {
  const [title, setTitle] = useState(work.title);
  const [topic, setTopic] = useState(work.topic);
  const [outlineText, setOutlineText] = useState(work.outline.join('\n'));
  const [error, setError] = useState<string | undefined>(undefined);

  const submit = (): void => {
    const trimmedTitle = title.trim();
    if (trimmedTitle === '') {
      setError('标题不能为空（服务要求 1–120 字）。');
      return;
    }
    if (trimmedTitle.length > 120) {
      setError('标题最长 120 字。');
      return;
    }
    const trimmedTopic = topic.trim();
    if (trimmedTopic.length > 2_000) {
      setError('主题最长 2000 字。');
      return;
    }
    const outline = outlineText
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (outline.length > MAX_OUTLINE_ITEMS) {
      setError(`大纲最多 ${String(MAX_OUTLINE_ITEMS)} 条，请先精简。`);
      return;
    }
    onCommand({
      kind: 'update',
      workId: work.id,
      body: { requestKey: createRequestKey(), title: trimmedTitle, topic: trimmedTopic, outline, confirmUpdate: true },
    });
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="banner info">
        <Icon name="info" />
        <div className="grow">
          <b>需求简报按真实字段降级</b>
          <br />
          设计稿的「给谁看 / 想达到 / 篇幅 / 风格 / 依据资料」五项需要会话返回结构化字段，服务只保存标题、主题、大纲与版式主题。
          这里直接编辑真实字段并 PATCH 到服务，不显示伪造的简报完成度或助手问题。
        </div>
      </div>

      <div className="ppt-facts">
        <div className="ppt-fact">
          <span className="ppt-fact-k">项目</span>
          <span className="ppt-fact-v">{projectName ?? '未归属项目'}</span>
        </div>
        <div className="ppt-fact">
          <span className="ppt-fact-k">创建于</span>
          <span className="ppt-fact-v">{formatAbsoluteTime(work.createdAt)}</span>
        </div>
        <div className="ppt-fact">
          <span className="ppt-fact-k">最近更新</span>
          <span className="ppt-fact-v">{formatAbsoluteTime(work.updatedAt)}（{formatRelativeTime(work.updatedAt)}）</span>
        </div>
        <div className="ppt-fact">
          <span className="ppt-fact-k">当前阶段</span>
          <span className="ppt-fact-v">{pptPageSummary(work)}</span>
        </div>
      </div>

      <div className="field" style={{ margin: 0 }}>
        <label className="label" htmlFor={`ppt-wb-title-${work.id}`}>
          标题<span className="req">*</span>
        </label>
        <input
          id={`ppt-wb-title-${work.id}`}
          className="input"
          value={title}
          disabled={busyKind === 'update' || blocked}
          onChange={(event) => {
            setTitle(event.target.value);
            setError(undefined);
          }}
        />
        <span className="hint num">{String(title.length)} / 120 字</span>
      </div>

      <div className="field" style={{ margin: 0 }}>
        <label className="label" htmlFor={`ppt-wb-topic-${work.id}`}>
          主题（给谁看、想达到什么、篇幅）
        </label>
        <textarea
          id={`ppt-wb-topic-${work.id}`}
          className="textarea"
          value={topic}
          disabled={busyKind === 'update' || blocked}
          placeholder="例如：给新同事讲项目架构与任务流程，约 6 页，20 分钟。"
          onChange={(event) => {
            setTopic(event.target.value);
            setError(undefined);
          }}
        />
        <span className="hint num">{String(topic.length)} / 2000 字</span>
      </div>

      <div className="field" style={{ margin: 0 }}>
        <label className="label" htmlFor={`ppt-wb-outline-${work.id}`}>
          大纲（每行一页标题）
        </label>
        <textarea
          id={`ppt-wb-outline-${work.id}`}
          className="textarea"
          style={{ minHeight: 150 }}
          value={outlineText}
          disabled={busyKind === 'update' || blocked}
          placeholder={'例如：\n整体架构\n任务的一生\n错误恢复'}
          onChange={(event) => {
            setOutlineText(event.target.value);
            setError(undefined);
          }}
        />
        <span className="hint">
          空行会被忽略；服务最多保存 {String(MAX_OUTLINE_ITEMS)} 条、单条截断到 200 字。保存不会调用模型，也不会重建已有逐页内容。
        </span>
      </div>

      {error === undefined ? null : (
        <div className="error-text">
          <Icon name="alert" size="sm" />
          {error}
        </div>
      )}

      <div className="row wrap" style={{ gap: 8 }}>
        <Button
          variant="primary"
          icon="check"
          disabled={blocked || busyKind === 'update'}
          disabledReason={blockedReason ?? (busyKind === 'update' ? '保存请求已发出，正在等待服务回执。' : undefined)}
          onClick={submit}
        >
          {busyKind === 'update' ? '正在保存…' : '保存修改'}
        </Button>
        <Button variant="secondary" iconAfter="arrowRight" disabled={blocked} disabledReason={blockedReason} onClick={onNext}>
          下一步：设计方案
        </Button>
        <span className="hint">保存与生成都会返回真实回执；回执显示在页面顶部。</span>
      </div>
    </div>
  );
}

/** ② 设计方案：版式主题（真实 PATCH）+ 大纲/逐页生成与展示；不伪造三个视觉方向。 */
export function PptStepDesign({ work, busyKind, blocked, blockedReason, onCommand }: PptStepCommonProps) {
  const [theme, setTheme] = useState<ThemeIdValue>(work.theme);
  const themeChanged = theme !== work.theme;

  const saveTheme = (): void => {
    onCommand({ kind: 'update', workId: work.id, body: { requestKey: createRequestKey(), theme, confirmUpdate: true } });
  };

  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="banner info">
        <Icon name="info" />
        <div className="grow">
          <b>视觉方向按真实能力降级</b>
          <br />
          设计稿的「三个视觉方向缩略图」需要提案字段；服务只保存版式主题（DeepSeek / Warm / SPDB / GitHub White），
          导出 PPTX 时使用对应背景、文字与强调色。这里只提供主题选择与保存，不展示不存在的方向选项。
        </div>
      </div>

      <div className="ppt-field-row">
        <div className="field" style={{ flex: '0 0 260px' }}>
          <label className="label" htmlFor={`ppt-wb-theme-${work.id}`}>
            版式主题
          </label>
          <select
            id={`ppt-wb-theme-${work.id}`}
            className="select"
            value={theme}
            disabled={blocked || busyKind === 'update'}
            onChange={(event) => {
              setTheme(event.target.value as ThemeIdValue);
            }}
          >
            {THEME_IDS.map((id) => (
              <option key={id} value={id}>
                {THEMES[id].label}（{id}）
              </option>
            ))}
          </select>
          <span className="hint">当前服务值：{themeLabel(work.theme)}</span>
        </div>
        <div className="field" style={{ flex: '1 1 220px', margin: 0 }}>
          <span className="label">保存主题</span>
          <div className="row wrap" style={{ gap: 8 }}>
            <Button
              variant="secondary"
              icon="check"
              disabled={blocked || busyKind === 'update' || !themeChanged}
              disabledReason={
                blockedReason ??
                (busyKind === 'update'
                  ? '主题保存请求已发出，正在等待服务回执。'
                  : !themeChanged
                    ? '主题与当前保存值一致，不需要保存。'
                    : undefined)
              }
              onClick={saveTheme}
            >
              {busyKind === 'update' ? '正在保存…' : '保存主题'}
            </Button>
            <span className="hint">主题保存也走 PATCH 与回执。</span>
          </div>
        </div>
      </div>

      <div>
        <div className="row" style={{ gap: 8, marginBottom: 8 }}>
          <h4 style={{ fontSize: 13.5, fontWeight: 500 }}>大纲</h4>
          <span className="hint num">{String(work.outline.length)} 条</span>
          <span className="grow" />
          <Button
            variant="primary"
            icon="wand"
            disabled={blocked}
            disabledReason={blockedReason}
            onClick={() => {
              onCommand({ kind: 'generate', workId: work.id, body: { requestKey: createRequestKey(), confirmGenerate: true } });
            }}
          >
            {busyKind === 'generate' ? '正在生成大纲…可能较慢' : '生成大纲'}
          </Button>
        </div>
        {work.outline.length === 0 ? (
          <p className="hint">还没有大纲。可以生成大纲，或回到「讨论需求」手动写每页标题。</p>
        ) : (
          <ol className="ppt-outline">
            {work.outline.map((line, index) => (
              <li key={`${String(index)}-${line}`}>
                <span className="ppt-num">{String(index + 1).padStart(2, '0')}</span>
                <span className="grow">{line}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div>
        <div className="row" style={{ gap: 8, marginBottom: 8 }}>
          <h4 style={{ fontSize: 13.5, fontWeight: 500 }}>逐页内容</h4>
          <span className="hint num">{String(work.slides.length)} 页</span>
          <span className="grow" />
          <Button
            variant="secondary"
            icon="layers"
            disabled={blocked || work.outline.length === 0}
            disabledReason={
              blockedReason ??
              (work.outline.length === 0 ? '先生成或编辑大纲；服务要求至少 1 条大纲才能生成逐页内容。' : undefined)
            }
            onClick={() => {
              onCommand({
                kind: 'generateSlides',
                workId: work.id,
                body: { requestKey: createRequestKey(), confirmGenerate: true },
              });
            }}
          >
            {busyKind === 'generateSlides' ? '正在生成逐页…可能较慢' : '生成逐页内容'}
          </Button>
        </div>
        {work.slides.length === 0 ? (
          <p className="hint">还没有逐页要点。生成大纲后可以按大纲生成逐页内容；导出 PPTX 会使用逐页要点。</p>
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

      <p className="hint">
        生成大纲与逐页内容会调用受管 OpenCode 模型，通常需要 30–120 秒，<b>可能较慢</b>
        ；服务返回回执前请不要重复点击，回执状态显示在页面顶部。
      </p>
    </div>
  );
}

/** ③ 制作检查：真实计数与附件管理；明确说明没有逐页视觉检查接口。 */
export interface PptStepCheckProps extends PptStepCommonProps {
  readonly lastResult: PptCommandSignal | null;
  readonly onGoDesign: () => void;
}

export function PptStepCheck({ work, busyKind, blocked, blockedReason, lastResult, onCommand, onGoDesign }: PptStepCheckProps) {
  const anyBusy = busyKind !== null;
  const status = pptStatusMeta(work.status);
  const counts = pptPageCount(work);
  const [attachName, setAttachName] = useState('');
  const [attachKind, setAttachKind] = useState<'text' | 'image'>('text');
  const [attachText, setAttachText] = useState('');
  const [attachImage, setAttachImage] = useState<{ readonly name: string; readonly dataUrl: string } | null>(null);
  const [attachError, setAttachError] = useState<string | undefined>(undefined);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const attachFailure = lastResult?.kind === 'attach' && lastResult.outcome !== 'succeeded' ? lastResult.message : undefined;

  useEffect(() => {
    if (lastResult === null || lastResult.kind !== 'attach' || lastResult.outcome !== 'succeeded') return;
    setAttachName('');
    setAttachText('');
    setAttachImage(null);
    setAttachError(undefined);
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

  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="banner warn">
        <Icon name="alert" />
        <div className="grow">
          <b>逐页视觉检查未接入</b>
          <br />
          服务没有提供逐页视觉检查接口（文字溢出、排版一致性、演讲备注、问题页标记都没有数据），因此本步只汇总服务真实计数与附件，
          <b>不显示检查结论或“问题页”标记</b>，也不会用示例问题补齐。
        </div>
      </div>

      <div className="row wrap" style={{ gap: 8 }}>
        <Button variant="secondary" size="sm" icon="arrowLeft" onClick={onGoDesign} disabled={blocked} disabledReason={blockedReason}>
          回到设计方案
        </Button>
        <span className="hint">需要重新生成内容时回到上一步；生成会走同一套回执。</span>
      </div>

      <div className="ppt-facts">
        <div className="ppt-fact">
          <span className="ppt-fact-k">逐页内容</span>
          <span className="ppt-fact-v">{String(counts.slides)} 页</span>
        </div>
        <div className="ppt-fact">
          <span className="ppt-fact-k">大纲</span>
          <span className="ppt-fact-v">{String(counts.outline)} 条</span>
        </div>
        <div className="ppt-fact">
          <span className="ppt-fact-k">附件</span>
          <span className="ppt-fact-v">
            {String(work.attachments.length)}/{String(MAX_ATTACHMENTS)}
          </span>
        </div>
        <div className="ppt-fact">
          <span className="ppt-fact-k">版式主题</span>
          <span className="ppt-fact-v">{themeLabel(work.theme)}</span>
        </div>
        <div className="ppt-fact">
          <span className="ppt-fact-k">作品状态</span>
          <span className="ppt-fact-v">
            <Badge tone={status.tone} icon={status.icon}>
              {status.label}
            </Badge>
          </span>
        </div>
        <div className="ppt-fact">
          <span className="ppt-fact-k">最近更新</span>
          <span className="ppt-fact-v">{formatAbsoluteTime(work.updatedAt)}</span>
        </div>
        <div className="ppt-fact">
          <span className="ppt-fact-k">模型 tokens</span>
          <span className="ppt-fact-v">{work.usage === undefined ? '服务未记录（尚未生成）' : formatCount(work.usage.total)}</span>
        </div>
        <div className="ppt-fact">
          <span className="ppt-fact-k">演讲备注 / 检查问题</span>
          <span className="ppt-fact-v">服务未提供</span>
        </div>
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
                  disabledReason={anyBusy ? blockedReason : undefined}
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
                  disabledReason={anyBusy ? blockedReason : undefined}
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
            <Button type="submit" variant="primary" size="sm" icon="plus" disabled={anyBusy} disabledReason={blockedReason}>
              {busyKind === 'attach' ? '正在添加…' : '添加附件'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
