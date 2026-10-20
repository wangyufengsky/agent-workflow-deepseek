import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROUTES, createRequestKey, taskStepBarState, taskStepCaption, type CommandResponse, type TaskSummary } from '@agent-workflow/shared';
import { apiPost } from '../../api/client.ts';
import { useWorkflowCommand } from '../../api/workflow.ts';
import { Drawer } from '../../components/Drawer.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { Badge } from '../../components/Badge.tsx';
import { Icon } from '../../components/Icon.tsx';
import { IconButton } from '../../components/IconButton.tsx';
import { TaskStatusBadge } from '../../components/StageBadge.tsx';
import { formatRelativeTime } from '../../app/format.ts';
import { taskHref, taskNeedText } from '../../app/taskStatus.ts';
import './tasks.css';

/** One task list row (design: tasks.html .trow). Whole row opens the task/requirement canvas. */
export function TaskRow({ task }: { readonly task: TaskSummary }) {
  const navigate = useNavigate();
  const href = taskHref(task);
  const opensRequirement = href.startsWith('/requirement/');
  const need = taskNeedText(task);
  const stepStates = task.stepStates ?? [];
  const stepBars = stepStates.map((step) => taskStepBarState(step));
  const stepCaption = taskStepCaption(stepStates);
  const stepSummary = stepStates.length === 0
    ? '尚无计划步骤'
    : stepStates.map((step) => `${step.title}：${step.pendingAcceptance === true ? '待人工验收' : step.status}`).join('，');
  const archiveAvailable = task.archiveAction?.allowed === true;
  const command = useWorkflowCommand(task.id);
  const [confirmArchive, setConfirmArchive] = useState(false);

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

      <div className="c-steps task-steps" aria-label={`步骤：${stepSummary}`}>
        {stepBars.length === 0 ? null : (
          <div className="step-bars" aria-hidden="true">
            {stepBars.map((state, index) => (
              <i key={index} className={state === 'unk' ? 'unk' : state} />
            ))}
          </div>
        )}
        <span className="step-caption">{stepCaption}</span>
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
                <button type="button" role="menuitem" disabled={command.state.busy} onClick={() => { setMenuOpen(false); setConfirmArchive(true); }}>
                  <Icon name="archive" size="sm" />
                  {task.archivedAt ? '恢复到已结束' : '归档'}
                </button>
              </>
            ) : null}
          </div>
        )}
      </div>
      <span onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
        <Drawer open={confirmArchive} title={task.archivedAt ? '恢复任务？' : '归档任务？'} onClose={() => setConfirmArchive(false)} footer={<button className="btn primary" disabled={command.state.busy} onClick={() => { void command.run(async () => (await apiPost<CommandResponse<TaskSummary>>(ROUTES.taskArchive(task.id), { requestKey: createRequestKey(), archived: !task.archivedAt, confirmArchive: true })).data).then((result) => { if (result?.receipt.status === 'succeeded') setConfirmArchive(false); }); }}>{command.state.busy ? '结果待核对' : '确认'}</button>}>
          <p>{task.title}</p><p className="hint">归档仅改变列表可见范围，原计划、执行、交付与工作区均保留，不会重新执行任务。</p>
          {command.state.error ? <ServiceNotice error={command.state.error} /> : null}
        </Drawer>
      </span>
    </div>
  );
}
