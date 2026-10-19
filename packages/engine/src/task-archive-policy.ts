import type { Store } from '@agent-workflow/storage';
import type { Task, ActionAvailability } from '@agent-workflow/shared';
export function taskArchiveAction(store: Store, task: Task): ActionAvailability {
    const round = store.planning.latest(task.id);
    const execution = store.executions.byTask(task.id);
    if (task.lifecycle === 'active') return { allowed: false, reason: '只有已结束或已终止的任务可以归档', reasonCode: 'TASK_ACTIVE' };
    if (round && ['queued', 'running', 'stopping', 'unknown'].includes(round.status)) return { allowed: false, reason: '规划尚未停稳或结果待核对', reasonCode: 'PLANNING_ACTIVE' };
    if (execution && (['running', 'stopping', 'unknown'].includes(execution.status) || execution.nodes.some((node) => node.status === 'running'))) return { allowed: false, reason: '仍有执行步骤运行，不能归档', reasonCode: 'EXECUTION_ACTIVE' };
    return { allowed: true };
}
