import { DELIVERY_PROJECTION_LABEL, PLANNING_STATUS_LABEL, PLANNING_STAGE_LABEL, TASK_ATTENTION_LABEL, TASK_LIFECYCLE_LABEL, TASK_STAGE_LABEL } from './labels.ts';
import type {TaskListGroupValue} from './enums.ts';
import type {TaskStepState, TaskSummary} from './models.ts';
export function taskListGroup(task:TaskSummary):TaskListGroupValue {
  if(task.lifecycle!=='active'||task.deliveryProjection==='delivered')return 'closed';
  if(task.attention!=='none'||(['awaiting_selection','awaiting_confirmation','blocked','unknown_receipt'].includes(task.deliveryProjection??'')||['stopped','failed','unknown'].includes(task.planning?.status??'')))return 'attention';
  // P12-02: an executed step waiting for the human verdict is a wait state, not "进行中".
  if((task.execution?.pendingAcceptance??0)>0)return 'attention';
  return 'active';
}
export function taskSearchText(task:TaskSummary):string {
 return [task.title,task.projectName,task.methodName,TASK_ATTENTION_LABEL[task.attention],TASK_LIFECYCLE_LABEL[task.lifecycle],TASK_STAGE_LABEL[task.stage],task.deliveryProjection?DELIVERY_PROJECTION_LABEL[task.deliveryProjection]:'',task.planning?PLANNING_STATUS_LABEL[task.planning.status]:'',task.planning?PLANNING_STAGE_LABEL[task.planning.stage]:'',task.planning?.lastActivity,(task.stepStates??[]).map((step)=>`${step.title} ${step.errorMessage??''}`).join(' ')].filter(Boolean).join(' ').toLowerCase();
}

/** Design `tasks.html .bars` classes for one step status (P12-01). Never invents a stall state. */
export type TaskStepBarState = 'done' | 'run' | 'fail' | 'wait' | 'unk' | 'idle';

export function taskStepBarState(step: TaskStepState): TaskStepBarState {
  if (step.pendingAcceptance === true || step.rejectedAcceptance === true) return 'wait';
  switch (step.status) {
    case 'succeeded':
      return 'done';
    case 'running':
      return 'run';
    case 'failed':
      return 'fail';
    case 'unknown':
      return 'unk';
    default:
      return 'idle';
  }
}

/**
 * P12-01: "第 N / M 步" caption derived from real node states.
 * `current` is the 1-based index of the first running/failed/waiting step,
 * or the number of finished steps when nothing is active.
 */
export function taskStepCaption(stepStates: readonly TaskStepState[] | undefined): string {
  if (stepStates === undefined || stepStates.length === 0) return '尚无计划步骤';
  const total = stepStates.length;
  const indexOf = (predicate: (step: TaskStepState) => boolean): number => stepStates.findIndex(predicate);
  const running = indexOf((step) => step.status === 'running');
  const failed = indexOf((step) => step.status === 'failed' || step.status === 'unknown');
  const waiting = indexOf((step) => step.pendingAcceptance === true || step.rejectedAcceptance === true);
  const active = running >= 0 ? running : failed >= 0 ? failed : waiting >= 0 ? waiting : -1;
  if (active >= 0) return `第 ${String(active + 1)} / ${String(total)} 步`;
  const done = stepStates.filter((step) => step.status === 'succeeded' || step.status === 'skipped').length;
  return done === total ? `${String(total)} 步全部完成` : `第 ${String(done)} / ${String(total)} 步`;
}
