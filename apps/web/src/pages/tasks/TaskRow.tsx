import { Link } from 'react-router-dom';
import type { TaskSummary } from '@agent-workflow/shared';
import { Badge } from '../../components/Badge.tsx';
import { Icon } from '../../components/Icon.tsx';
import { StageCapsule } from '../../components/StageCapsule.tsx';
import { TaskStatusBadge } from '../../components/StageBadge.tsx';
import { formatRelativeTime } from '../../app/format.ts';
import { taskHref, taskNeedText, taskProgressText } from '../../app/taskStatus.ts';

/** One task list row (design: tasks.html .trow). Entire row links to the canvas. */
export function TaskRow({ task }: { readonly task: TaskSummary }) {
  return (
    <Link className="task-row" to={taskHref(task)} aria-label={`打开任务：${task.title}`}>
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
          <span className="muted">·</span>
          <span>{taskProgressText(task)}</span>
        </div>
      </div>
      <div className="c-need">
        <div className="task-need">{taskNeedText(task)}</div>
      </div>
      <div className="c-stage">
        <StageCapsule current={task.stage} lifecycle={task.lifecycle} attention={task.attention} compact />
      </div>
      <div className="task-status">
        <TaskStatusBadge task={task} />
        <span className="task-time">{formatRelativeTime(task.updatedAt)}</span>
      </div>
      <span className="task-chev" aria-hidden="true">
        <Icon name="chevRight" size="sm" />
      </span>
    </Link>
  );
}
