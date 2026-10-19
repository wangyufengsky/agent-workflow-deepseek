import { useState } from 'react';
import type { PptWork, ProjectSummary } from '@agent-workflow/shared';
import { formatRelativeTime } from '../../app/format.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { EmptyState, Skeleton } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { SegmentedControl, type SegmentOption } from '../../components/SegmentedControl.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import {
  derivePptProgress,
  pptStatusMeta,
  themeLabel,
  type PptProgress,
  type PptStageFilter,
} from './ppt-shared.tsx';

type WorksViewMode = 'grid' | 'list';

export interface PptWorksViewProps {
  readonly works: readonly PptWork[];
  readonly projects: readonly ProjectSummary[];
  readonly loading: boolean;
  readonly error: unknown;
  readonly fetching: boolean;
  readonly selectedId: string | null;
  readonly onOpen: (work: PptWork) => void;
  readonly onNew: () => void;
  readonly onRetry: () => void;
}

function projectNameFor(work: PptWork, projects: readonly ProjectSummary[]): string | undefined {
  return work.projectId === undefined ? undefined : projects.find((project) => project.id === work.projectId)?.name;
}

function StageBar({ progress }: { readonly progress: PptProgress }) {
  return (
    <span className="ppt-stagebar" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => {
        const state = index < progress.completed ? 'done' : index === progress.completed ? 'current' : 'todo';
        return <i key={index} data-state={state} data-step={index === 3 ? 'export' : 'make'} />;
      })}
    </span>
  );
}

function WorkCover({ work, progress, small }: { readonly work: PptWork; readonly progress: PptProgress; readonly small?: boolean }) {
  const firstSlide = work.slides[0];
  const title = firstSlide?.title ?? work.title;
  const lines = firstSlide === undefined ? work.outline.slice(1, 4) : firstSlide.bullets.slice(0, 3);
  return (
    <span className={['ppt-cover', small === true ? 'ppt-cover-sm' : ''].filter(Boolean).join(' ')} aria-hidden="true">
      <span className="ppt-cover-tag">{progress.hasOutline ? '示意封面 · 无缩略图接口' : '无缩略图'}</span>
      {progress.hasOutline ? (
        <>
          <b className="ppt-cover-title">{title}</b>
          {lines.map((line, index) => (
            <i key={`${String(index)}-${line}`} className="ppt-cover-line" style={{ width: ['76%', '58%', '42%'][index] ?? '50%' }} />
          ))}
        </>
      ) : (
        <span className="ppt-cover-empty">尚未生成大纲</span>
      )}
    </span>
  );
}

function DisabledWorkActions() {
  return (
    <div className="ppt-work-actions">
      <Button
        variant="ghost"
        size="sm"
        icon="copy"
        disabled
        disabledReason="服务未提供复制作品接口；复制需要新建演示后手动填写标题与主题。"
      >
        复制
      </Button>
      <Button variant="ghost" size="sm" icon="archive" disabled disabledReason="服务未提供归档接口；PPT 作品没有归档状态。">
        归档
      </Button>
    </div>
  );
}

function WorkCard({
  work,
  projectName,
  selected,
  onOpen,
}: {
  readonly work: PptWork;
  readonly projectName?: string;
  readonly selected: boolean;
  readonly onOpen: () => void;
}) {
  const progress = derivePptProgress(work);
  const status = pptStatusMeta(work.status);
  return (
    <article className="ppt-work-card" data-selected={selected}>
      <button type="button" className="ppt-work-main" onClick={onOpen} aria-label={`打开工作台：${work.title}`}>
        <WorkCover work={work} progress={progress} />
        <span className="ppt-work-body">
          <span className="row" style={{ gap: 8 }}>
            <span className="grow ellipsis ppt-work-title" title={work.title}>
              {work.title}
            </span>
            <Badge tone={status.tone} icon={status.icon}>
              {status.label}
            </Badge>
          </span>
          <span className="hint ellipsis" title={work.topic}>
            {work.topic}
          </span>
          <StageBar progress={progress} />
          <span className="row wrap ppt-meta">
            <span>{progress.stageLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{progress.pageText}</span>
            <span aria-hidden="true">·</span>
            <span>{projectName ?? '未归属项目'}</span>
            <span aria-hidden="true">·</span>
            <span>{themeLabel(work.theme)}</span>
          </span>
          <span className="row wrap" style={{ gap: 8, marginTop: 2 }}>
            <span className="hint grow ppt-next">{progress.nextHint}</span>
            <span className="hint num">更新于 {formatRelativeTime(work.updatedAt)}</span>
          </span>
        </span>
      </button>
      <DisabledWorkActions />
    </article>
  );
}

function WorkListRow({
  work,
  projectName,
  selected,
  onOpen,
}: {
  readonly work: PptWork;
  readonly projectName?: string;
  readonly selected: boolean;
  readonly onOpen: () => void;
}) {
  const progress = derivePptProgress(work);
  const status = pptStatusMeta(work.status);
  return (
    <article className="ppt-work-listitem" data-selected={selected}>
      <button type="button" className="ppt-work-rowmain" onClick={onOpen} aria-label={`打开工作台：${work.title}`}>
        <WorkCover work={work} progress={progress} small />
        <span className="grow ppt-work-body" style={{ minWidth: 0 }}>
          <span className="row" style={{ gap: 8 }}>
            <span className="ellipsis" style={{ fontSize: 13.5, fontWeight: 500 }} title={work.title}>
              {work.title}
            </span>
            <Badge tone={status.tone} icon={status.icon}>
              {status.label}
            </Badge>
          </span>
          <span className="hint ellipsis" title={work.topic}>
            {work.topic}
          </span>
          <span className="row wrap ppt-meta">
            <span>{progress.stageLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{progress.pageText}</span>
            <span aria-hidden="true">·</span>
            <span>{projectName ?? '未归属项目'}</span>
            <span aria-hidden="true">·</span>
            <span>更新于 {formatRelativeTime(work.updatedAt)}</span>
          </span>
          <span className="hint ppt-next">{progress.nextHint}</span>
        </span>
        <Icon name="chevRight" size="sm" />
      </button>
      <DisabledWorkActions />
    </article>
  );
}

export function PptWorksView({ works, projects, loading, error, fetching, selectedId, onOpen, onNew, onRetry }: PptWorksViewProps) {
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [stageFilter, setStageFilter] = useState<PptStageFilter>('all');
  const [view, setView] = useState<WorksViewMode>('grid');

  const projectOptions = (() => {
    const seen = new Map<string, string>();
    for (const work of works) {
      if (work.projectId !== undefined && !seen.has(work.projectId)) {
        seen.set(work.projectId, projectNameFor(work, projects) ?? '项目不可用');
      }
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  })();

  const term = search.trim().toLowerCase();
  const base = works.filter((work) => {
    if (projectFilter !== '' && work.projectId !== projectFilter) return false;
    if (term === '') return true;
    return work.title.toLowerCase().includes(term) || work.topic.toLowerCase().includes(term);
  });
  const stageCounts = {
    all: base.length,
    discuss: base.filter((work) => derivePptProgress(work).current === 'discuss').length,
    design: base.filter((work) => derivePptProgress(work).current === 'design').length,
    check: base.filter((work) => derivePptProgress(work).current === 'check').length,
  };
  const filtered = stageFilter === 'all' ? base : base.filter((work) => derivePptProgress(work).current === stageFilter);

  const stageOptions: readonly SegmentOption<PptStageFilter>[] = [
    { value: 'all', label: '全部', count: stageCounts.all },
    { value: 'discuss', label: '讨论需求', count: stageCounts.discuss },
    { value: 'design', label: '设计方案', count: stageCounts.design },
    { value: 'check', label: '制作检查', count: stageCounts.check },
  ];
  const viewOptions: readonly SegmentOption<WorksViewMode>[] = [
    { value: 'grid', label: '网格' },
    { value: 'list', label: '列表' },
  ];

  return (
    <div className="ppt-works">
      <div className="ppt-works-toolbar">
        <div className="input-wrap ppt-search">
          <Icon name="search" size="sm" />
          <input
            className="input ctl"
            aria-label="搜索作品"
            placeholder="搜索标题或主题"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </div>
        <select
          className="select ctl ppt-project-filter"
          aria-label="项目筛选"
          value={projectFilter}
          onChange={(event) => {
            setProjectFilter(event.target.value);
          }}
        >
          <option value="">全部项目</option>
          {projectOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <SegmentedControl ariaLabel="制作阶段" options={stageOptions} value={stageFilter} onChange={setStageFilter} />
        <span className="spacer" />
        <span className="hint num">{String(filtered.length)} 份</span>
        <SegmentedControl ariaLabel="视图" options={viewOptions} value={view} onChange={setView} />
        <Button
          variant="secondary"
          size="sm"
          icon="refresh"
          disabled={fetching}
          disabledReason={fetching ? '正在刷新作品列表…' : undefined}
          onClick={onRetry}
        >
          {fetching ? '刷新中…' : '刷新'}
        </Button>
      </div>

      <p className="hint ppt-works-note">
        缩略图：服务没有提供作品缩略图接口，卡片显示由真实大纲/首屏要点生成的<b>示意封面</b>，不会伪装成渲染图；尚无大纲的作品明确标「无缩略图」。
        复制、归档没有服务端接口，按钮禁用并写明原因；作品也没有归档状态，因此不提供「显示已归档」开关。
        阶段条只由真实数据推导：大纲=设计方案、逐页=制作产出；<b>导出不会被持久化为“已完成”</b>。
      </p>

      {error !== undefined && works.length === 0 ? (
        <ServiceNotice error={error} onRetry={onRetry} />
      ) : loading ? (
        <div className="ppt-work-grid" aria-busy="true">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <div className="ppt-work-card ppt-work-skel" key={index}>
              <span className="ppt-cover ppt-cover-skel">
                <Skeleton width="100%" height="100%" radius={12} />
              </span>
              <div className="col" style={{ gap: 8, padding: 12 }}>
                <Skeleton height={14} width="62%" />
                <Skeleton height={11} width="82%" />
                <Skeleton height={11} width="40%" />
              </div>
            </div>
          ))}
        </div>
      ) : works.length === 0 ? (
        <section className="card pad">
          <EmptyState
            icon="slides"
            title="还没有演示"
            description="把想法写成主题并保存为草稿；创建后会出现在作品库，并可以直接进入工作台。"
            action={
              <Button variant="primary" size="sm" icon="plus" onClick={onNew}>
                新建演示
              </Button>
            }
          />
        </section>
      ) : filtered.length === 0 ? (
        <section className="card pad">
          <EmptyState
            icon="search"
            title="没有符合条件的作品"
            description="换个关键词、项目或阶段；筛选只影响展示，不会改动作品。"
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSearch('');
                  setProjectFilter('');
                  setStageFilter('all');
                }}
              >
                清除筛选
              </Button>
            }
          />
        </section>
      ) : view === 'grid' ? (
        <div className="ppt-work-grid">
          {filtered.map((work) => (
            <WorkCard
              key={work.id}
              work={work}
              projectName={projectNameFor(work, projects)}
              selected={work.id === selectedId}
              onOpen={() => {
                onOpen(work);
              }}
            />
          ))}
        </div>
      ) : (
        <div className="ppt-work-list">
          {filtered.map((work) => (
            <WorkListRow
              key={work.id}
              work={work}
              projectName={projectNameFor(work, projects)}
              selected={work.id === selectedId}
              onOpen={() => {
                onOpen(work);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
