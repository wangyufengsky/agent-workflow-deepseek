import type { TaskSummary } from '@agent-workflow/shared';
import { deriveTaskStatus } from '../app/taskStatus.ts';
import { Badge } from './Badge.tsx';

/** Status pill derived from real task fields (stage / attention / planning / delivery). */
export function TaskStatusBadge({ task, className }: { readonly task: TaskSummary; readonly className?: string }) {
  const view = deriveTaskStatus(task);
  return (
    <Badge tone={view.tone} icon={view.icon} className={className}>
      {view.label}
    </Badge>
  );
}
