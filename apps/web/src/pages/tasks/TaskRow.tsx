import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TaskSummary } from '@agent-workflow/shared';
import { Badge } from '../../components/Badge.tsx';
import { Icon } from '../../components/Icon.tsx';
import { IconButton } from '../../components/IconButton.tsx';
import { StageCapsule } from '../../components/StageCapsule.tsx';
import { TaskStatusBadge } from '../../components/StageBadge.tsx';
import { formatRelativeTime } from '../../app/format.ts';
import { taskGroup, taskHref, taskNeedText } from '../../app/taskStatus.ts';
import './tasks.css';

/** One task list row (design: tasks.html .trow). Whole row opens the task/requirement canvas. */
export function TaskRow({ task }: { readonly task: TaskSummary }) {
  const navigate = useNavigate();
  const href = taskHref(task);
  const opensRequirement = href.startsWith('/requirement/');
  const need = taskNeedText(task);
  const progress = task.progress;
  const progressPercent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const progressParts = progress.total > 0
    ? [
        `第 ${String(progress.done)}/${String(progress.total)} 步`,
        ...(progress.running > 0 ? [`${String(progress.running)} 执行中`] : []),
        ...(progress.failed > 0 ? [`${String(progress.failed)} 失败`] : []),
        '聚合进度',
      ]
    : ['尚无计划步骤'];
  const archiveAvailable = taskGroup(task) === 'closed';

  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target) === true) return;
      setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

  const copyTaskLink = async () => {
    const url = `${window.location.origin}${href}`;
    try {
      await navigator.clipboard.writeText(url);
      setNotice('已复制任务链接');
    } catch {
      setNotice('复制失败，请手动复制地址栏中的链接');
    }
  };

  return (
    <div
      className="task-row"
      role="link"
      tabIndex={0}
      aria-label={`打开任务：${task.title}`}
      onClick={() => {
        setMenuOpen(false);
        navigate(href);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setMenuOpen(false);
          navigate(href);
        }
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="task-name">{task.title}</span>
          {task.methodName.length === 0 ? null : (
            <Badge outline className="task-method">
              {task.methodName}
            </Badge>
          )}
        </div>
        <div className="task-sub">
          <Icon name="folder" size="sm" />
          <span>{task.projectName}</span>
        </div>
      </div>

      <div className="c-need">
        <div className="task-need">{need === '—' ? <span className="hint">—</span> : need}</div>
      </div>

      <div className="c-stage task-progress" aria-label={`阶段与聚合进度：${progressParts.join('，')}`}>
        <StageCapsule current={task.stage} lifecycle={task.lifecycle} attention={task.attention} compact />
        <div className="task-progress-bar" aria-hidden="true">
          <span style={{ width: `${String(progressPercent)}%` }} />
        </div>
        <span className="task-progress-caption">{progressParts.join(' · ')}</span>
      </div>

      <div className="task-status">
        <TaskStatusBadge task={task} />
        <span className="task-time">{formatRelativeTime(task.updatedAt)}</span>
      </div>

      <div
        className="task-more"
        ref={menuRef}
        onClick={(event) => {
          event.stopPropagation();
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
        }}
      >
        <IconButton
          icon="more"
          label={`更多：${task.title}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => {
            setNotice(undefined);
            setMenuOpen((current) => !current);
          }}
        />
        {!menuOpen ? null : (
          <div className="menu task-menu" role="menu" aria-label={`任务操作：${task.title}`}>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                navigate(href);
              }}
            >
              <Icon name={opensRequirement ? 'file' : 'play'} size="sm" />
              {opensRequirement ? '打开需求画布' : '打开执行画布'}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void copyTaskLink();
              }}
            >
              <Icon name="copy" size="sm" />
              复制任务链接
            </button>
            {notice === undefined ? null : <div className="task-menu-note" role="status">{notice}</div>}
            {archiveAvailable ? (
              <>
                <hr />
                <button type="button" role="menuitem" disabled title="任务归档接口未接通；当前不能归档。">
                  <Icon name="archive" size="sm" />
                  归档（接口未接通）
                </button>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
