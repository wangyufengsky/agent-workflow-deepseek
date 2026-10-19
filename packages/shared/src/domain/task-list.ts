import { DELIVERY_PROJECTION_LABEL, PLANNING_STATUS_LABEL, PLANNING_STAGE_LABEL, TASK_ATTENTION_LABEL, TASK_LIFECYCLE_LABEL, TASK_STAGE_LABEL } from './labels.ts';
import type {TaskListGroupValue} from './enums.ts';
import type {TaskSummary} from './models.ts';
export function taskListGroup(task:TaskSummary):TaskListGroupValue {
  if(task.lifecycle!=='active'||task.deliveryProjection==='delivered')return 'closed';
  if(task.attention!=='none'||['awaiting_selection','awaiting_confirmation','blocked','unknown_receipt'].includes(task.deliveryProjection??'')||['stopped','failed','unknown'].includes(task.planning?.status??''))return 'attention';
  return 'active';
}
export function taskSearchText(task:TaskSummary):string {
 return [task.title,task.projectName,task.methodName,TASK_ATTENTION_LABEL[task.attention],TASK_LIFECYCLE_LABEL[task.lifecycle],TASK_STAGE_LABEL[task.stage],task.deliveryProjection?DELIVERY_PROJECTION_LABEL[task.deliveryProjection]:'',task.planning?PLANNING_STATUS_LABEL[task.planning.status]:'',task.planning?PLANNING_STAGE_LABEL[task.planning.stage]:'',task.planning?.lastActivity].filter(Boolean).join(' ').toLowerCase();
}
