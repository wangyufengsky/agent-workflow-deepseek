import { PptDirections, PptPageChecks } from './PptProductionPanels.tsx';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { THEME_IDS, THEMES, createRequestKey, type PptBrief, type PptSlide, type PptWork, type PptWorkUpdateRequest, type ThemeIdValue } from '@agent-workflow/shared';
import { formatAbsoluteTime, formatCount, formatRelativeTime } from '../../app/format.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { defaultPptPlan } from './ppt-plan-defaults.ts';
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
const MAX_OUTLINE_ITEMS = 100;

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

const EMPTY_BRIEF: PptBrief = { audience: '', objective: '', length: '', style: '', sources: '' };
const BRIEF_FIELDS = [['audience', '给谁看'], ['objective', '想达到'], ['length', '篇幅'], ['style', '风格'], ['sources', '依据资料']] as const;

/** 正文页（不含封面）：优先服务已保存 slides；未生成时用大纲补齐标题。 */
export function pptBodyPages(work: PptWork): readonly PptSlide[] {
  if (work.slides.length >= work.outline.length) return work.slides;
  return work.outline.map((title, index) => work.slides[index] ?? { title, bullets: [] });
}

export interface PptStepDiscussionProps extends PptStepCommonProps {
  readonly projectName?: string;
  readonly onNext: () => void;
  /** 生成制作方案：有已保存简报时触发大纲生成（真实模型调用，走回执）。 */
  readonly onGeneratePlan: () => void;
}

/**
 * ① 讨论需求（P07-01）：设计 ppt-studio.html:174-176 的五项简报逐项补全 ——
 * 未补项“等待讨论”、刚补项高亮、底部“还差 N 项 / 信息已经足够”+「生成制作方案」。
 */
export function PptStepDiscussion({ work, busyKind, blocked, blockedReason, onCommand, onNext, onGeneratePlan }: PptStepDiscussionProps) {
  const [brief, setBrief] = useState<PptBrief>(work.brief ?? EMPTY_BRIEF);
  const [baselineRevision, setBaselineRevision] = useState(work.revision ?? 1);
  const [freshField, setFreshField] = useState<string | null>(null);
  const priorBrief = useRef(work.brief ?? EMPTY_BRIEF);
  useEffect(() => {
    const next = work.brief ?? EMPTY_BRIEF;
    if (JSON.stringify(brief) === JSON.stringify(priorBrief.current) || JSON.stringify(brief) === JSON.stringify(next)) {
      setBrief(next);
      setBaselineRevision(work.revision ?? 1);
    }
    priorBrief.current = next;
  }, [work.revision]);
  const dirty = JSON.stringify(brief) !== JSON.stringify(work.brief ?? EMPTY_BRIEF);
  const filled = BRIEF_FIELDS.filter(([field]) => brief[field].trim() !== '').length;
  const missing = BRIEF_FIELDS.length - filled;
  const complete = missing === 0;
  const saving = busyKind === 'update';
  const save = (): void => {
    if (blocked || saving) return;
    onCommand({ kind: 'update', workId: work.id, body: { requestKey: createRequestKey(), confirmUpdate: true, expectedRevision: baselineRevision, brief } });
  };
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <span style={{ fontSize: 13.5 }}>需求简报</span>
        <span className="hint">讨论中逐项补全 · 你也可以直接改</span>
        <span className="grow" />
        <span className="hint num">{filled}/{BRIEF_FIELDS.length} 项</span>
      </div>
      <div className="ppt-brief">
        {BRIEF_FIELDS.map(([field, label]) => {
          const done = brief[field].trim() !== '';
          return (
            <div className={`ppt-bf ${done ? '' : 'pending'} ${freshField === field && done ? 'fresh' : ''}`} key={field}>
              <span className="k">{label}</span>
              <span className="v">
                <textarea
                  className="textarea"
                  aria-label={label}
                  rows={field === 'objective' || field === 'sources' ? 2 : 1}
                  value={brief[field]}
                  placeholder="等待讨论"
                  maxLength={2000}
                  disabled={blocked || saving}
                  onChange={(event) => {
                    const value = event.target.value;
                    setFreshField(value.trim() !== '' && brief[field].trim() === '' ? field : null);
                    setBrief({ ...brief, [field]: value });
                  }}
                />
              </span>
            </div>
          );
        })}
      </div>
      <div className="ppt-foot-cta">
        <span className="grow">
          <div style={{ fontSize: 13.5 }}>{complete ? '信息已经足够' : `还差 ${String(missing)} 项`}</div>
          <div className="hint">
            {complete ? '可以让助手出制作方案' : '回答右侧助手的问题即可；也可以直接补在这里'}
            {dirty && complete ? ' · 先保存简报' : ''}
          </div>
        </span>
        {dirty || saving ? (
          <Button
            variant="secondary"
            disabled={blocked || saving}
            disabledReason={blockedReason}
            onClick={save}
          >
            {saving ? '正在保存…' : '保存需求简报'}
          </Button>
        ) : null}
        <Button
          variant="primary"
          iconAfter="arrowRight"
          disabled={blocked || !complete || saving}
          disabledReason={
            blockedReason ??
            (saving
              ? '保存请求已发出，正在等待服务回执。'
              : !complete
                ? `还差 ${String(missing)} 项需求简报，补齐后才能生成制作方案。`
                : undefined)
          }
          onClick={() => {
            if (dirty) save();
            else onGeneratePlan();
            onNext();
          }}
        >
          生成制作方案
        </Button>
      </div>
      <p className="hint">生成制作方案会调用受管模型生成大纲（可能较慢，回执显示在页面顶部）；也可进入设计方案后手动编写大纲。</p>
    </div>
  );
}

export interface PptStepDesignProps extends PptStepCommonProps {
  readonly onBackToDiscuss: () => void;
}

/**
 * ② 设计方案（P07-02）：设计 ppt-studio.html:177-183 ——
 * “制作方案 / 确认后才开始逐页制作 · 之后仍可调整”、可增删排序的大纲 + 视觉方向，
 * 底部确认条「回到讨论 / 确认并开始制作（页数 · 时长说明）」。
 * P07-12：方向选择改为本地草稿，随确认条/保存一次提交，不再点选即写服务。
 */
export function PptStepDesign({ work, busyKind, blocked, blockedReason, onCommand, onBackToDiscuss }: PptStepDesignProps) {
  const initialPages = pptBodyPages(work);
  const [title, setTitle] = useState(work.title);
  const [topic, setTopic] = useState(work.topic);
  const [pages, setPages] = useState<readonly PptSlide[]>(initialPages);
  const [direction, setDirection] = useState(work.direction ?? 'restrained');
  const [theme, setTheme] = useState<ThemeIdValue>(work.theme);
  /** 待“确认并开始制作”：保存回执带来新修订后再发起逐页制作。 */
  const [pendingStart, setPendingStart] = useState<number | null>(null);
  const priorDraft = useRef({ title: work.title, topic: work.topic, pages: initialPages, direction: work.direction ?? 'restrained', theme: work.theme });
  useEffect(() => {
    const next = { title: work.title, topic: work.topic, pages: pptBodyPages(work), direction: work.direction ?? 'restrained', theme: work.theme };
    const current = { title, topic, pages, direction, theme };
    if (JSON.stringify(current) === JSON.stringify(priorDraft.current) || JSON.stringify(current) === JSON.stringify(next)) {
      setTitle(next.title);
      setTopic(next.topic);
      setPages(next.pages);
      setDirection(next.direction);
      setTheme(next.theme);
    }
    priorDraft.current = next;
  }, [work.revision]);
  useEffect(() => {
    if (pendingStart === null) return;
    const revision = work.revision ?? 1;
    if (revision <= pendingStart || work.plan?.confirmed !== true) return;
    setPendingStart(null);
    onCommand({
      kind: 'generateSlides',
      workId: work.id,
      body: { requestKey: createRequestKey(), confirmGenerate: true, expectedRevision: revision },
    });
  }, [pendingStart, work.revision, work.plan?.confirmed]);
  useEffect(() => {
    if (pendingStart === null) return;
    const timer = window.setTimeout(() => setPendingStart(null), 20_000);
    return () => window.clearTimeout(timer);
  }, [pendingStart]);

  const dirty =
    title !== work.title ||
    topic !== work.topic ||
    JSON.stringify(pages) !== JSON.stringify(initialPages) ||
    direction !== (work.direction ?? 'restrained') ||
    theme !== work.theme;
  const slidesChanged = JSON.stringify(pages) !== JSON.stringify(work.slides);
  const saving = busyKind === 'update' || busyKind === 'generate';
  const saveBody = (confirmed: boolean): PptWorkUpdateRequest => {
    const plain = defaultPptPlan(work);
    const plan = confirmed ? { ...(work.plan ?? plain), confirmed: true } : undefined;
    return {
      requestKey: createRequestKey(),
      confirmUpdate: true,
      expectedRevision: work.revision ?? 1,
      title: title.trim() === '' ? work.title : title.trim(),
      topic,
      outline: pages.map((page) => page.title),
      direction,
      theme,
      ...(plan === undefined ? {} : { plan }),
      ...(slidesChanged ? { slides: pages } : {}),
    };
  };
  const saveDraft = (): void => {
    if (blocked || saving || !dirty) return;
    onCommand({ kind: 'update', workId: work.id, body: saveBody(false) });
  };
  const confirmAndStart = (): void => {
    if (blocked || saving) return;
    setPendingStart(work.revision ?? 1);
    onCommand({ kind: 'update', workId: work.id, body: saveBody(true) });
  };
  const move = (index: number, step: number): void => {
    const destination = index + step;
    if (destination < 0 || destination >= pages.length) return;
    const next = [...pages];
    [next[index], next[destination]] = [next[destination]!, next[index]!];
    setPages(next);
  };
  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <span style={{ fontSize: 13.5 }}>制作方案</span>
        <span className="hint">确认后才开始逐页制作 · 之后仍可调整</span>
        <span className="grow" />
        {work.plan?.confirmed === true ? <Badge tone="done" icon="check">方案已确认</Badge> : null}
      </div>

      <div className="ppt-field-row">
        <div className="field" style={{ flex: '1 1 220px' }}>
          <label className="label" htmlFor={`ppt-wb-title-${work.id}`}>标题</label>
          <input id={`ppt-wb-title-${work.id}`} className="input" value={title} maxLength={120} disabled={blocked || saving} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <div className="field" style={{ flex: '1 1 220px' }}>
          <label className="label" htmlFor={`ppt-wb-topic-${work.id}`}>主题</label>
          <input id={`ppt-wb-topic-${work.id}`} className="input" value={topic} maxLength={2000} disabled={blocked || saving} onChange={(event) => setTopic(event.target.value)} />
        </div>
        <div className="field" style={{ flex: '0 0 200px', margin: 0 }}>
          <label className="label" htmlFor={`ppt-wb-theme-${work.id}`}>版式主题</label>
          <select id={`ppt-wb-theme-${work.id}`} className="select" value={theme} disabled={blocked || saving} onChange={(event) => setTheme(event.target.value as ThemeIdValue)}>
            {THEME_IDS.map((id) => <option key={id} value={id}>{THEMES[id].label}</option>)}
          </select>
        </div>
      </div>

      <div>
        <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
          <h4 style={{ fontSize: 13.5, fontWeight: 500 }}>大纲</h4>
          <span className="hint num">{pages.length} 页</span>
          <span className="grow" />
          <Button
            variant="secondary"
            size="sm"
            icon="wand"
            disabled={blocked || saving || work.actions?.generate.allowed === false}
            disabledReason={blockedReason ?? work.actions?.generate.reason ?? (saving ? '保存请求进行中…' : undefined)}
            onClick={() => {
              onCommand({ kind: 'generate', workId: work.id, body: { expectedRevision: work.revision ?? 1, requestKey: createRequestKey(), confirmGenerate: true } });
            }}
          >
            {busyKind === 'generate' ? '正在生成大纲…可能较慢' : '生成大纲'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon="plus"
            disabled={blocked || saving || pages.length >= 100}
            disabledReason={blockedReason ?? '最多 100 页；到上限后先删除页面。'}
            onClick={() => setPages([...pages, { title: '新页面', bullets: [] }])}
          >
            加一页
          </Button>
        </div>
        {pages.length === 0 ? (
          <p className="hint">还没有大纲。可以生成大纲，或点「加一页」手动写每页标题；确认后才开始逐页制作。</p>
        ) : (
          <div className="ppt-outline-edit">
            {pages.map((page, index) => (
              <div className="ppt-outline-row" key={index}>
                <span className="n">{String(index + 1).padStart(2, '0')}</span>
                <input
                  className="input"
                  value={page.title}
                  aria-label={`第 ${index + 1} 页标题`}
                  maxLength={200}
                  disabled={blocked || saving}
                  onChange={(event) => {
                    const value = event.target.value;
                    setPages(pages.map((item, at) => (at === index ? { ...item, title: value } : item)));
                  }}
                />
                <span className="acts">
                  <Button variant="ghost" size="sm" disabled={blocked || saving || index === 0} disabledReason={index === 0 ? '已经是第一页。' : undefined} onClick={() => move(index, -1)}>上移</Button>
                  <Button variant="ghost" size="sm" disabled={blocked || saving || index === pages.length - 1} disabledReason={index === pages.length - 1 ? '已经是最后一页。' : undefined} onClick={() => move(index, 1)}>下移</Button>
                  <Button variant="ghost" size="sm" disabled={blocked || saving} disabledReason={blockedReason} onClick={() => setPages(pages.filter((_, at) => at !== index))}>删除</Button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <PptDirections work={work} value={direction} onChange={setDirection} blocked={blocked || saving} />

      <div className="ppt-foot-cta">
        <span className="grow">
          <div style={{ fontSize: 13.5 }}>确认方案</div>
          <div className="hint">将制作 {pages.length} 页 · 逐页制作会调用模型，实际耗时以模型为准 · 制作中可以继续和助手讨论</div>
        </span>
        <Button variant="secondary" disabled={blocked || saving} disabledReason={blockedReason} onClick={onBackToDiscuss}>回到讨论</Button>
        {dirty ? (
          <Button variant="ghost" disabled={blocked || saving} disabledReason={blockedReason} onClick={saveDraft}>{saving ? '正在保存…' : '仅保存修改'}</Button>
        ) : null}
        <Button
          variant="primary"
          disabled={blocked || saving || pages.length === 0 || work.actions?.generateSlides.allowed === false}
          disabledReason={
            blockedReason ??
            (pages.length === 0
              ? '至少需要一页大纲才能开始逐页制作。'
              : work.actions?.generateSlides.reason)
          }
          onClick={confirmAndStart}
        >
          确认并开始制作
        </Button>
      </div>
    </div>
  );
}

/** ③ 制作检查：真实计数与附件管理；当前修订逐页检查。 */
export interface PptStepCheckProps extends PptStepCommonProps {
  readonly attachmentsOnly?: boolean;
  readonly lastResult: PptCommandSignal | null;
  readonly onGoDesign: () => void;
}

export function PptStepCheck({ attachmentsOnly=false, work, busyKind, blocked, blockedReason, lastResult, onCommand, onGoDesign }: PptStepCheckProps) {
  const anyBusy = busyKind !== null;
  const status = pptStatusMeta(work.status, work);
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
      body: { expectedRevision: work.revision ?? 1, requestKey: createRequestKey(), name, content, kind: attachKind, confirmAttach: true },
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
      {!attachmentsOnly ? <><PptPageChecks {...{ work, blocked, onCommand }} />

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

      </> : null}
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
                  disabled={blocked}
                  disabledReason={blockedReason}
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
            if (blocked) return;
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
                disabled={blocked}
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
                disabled={blocked}
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
                disabled={blocked}
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
                  disabled={blocked}
                  disabledReason={blockedReason}
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
            <Button type="submit" variant="primary" size="sm" icon="plus" disabled={blocked} disabledReason={blockedReason}>
              {busyKind === 'attach' ? '正在添加…' : '添加附件'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
