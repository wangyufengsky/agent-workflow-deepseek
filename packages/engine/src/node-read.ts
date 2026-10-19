import { AppError, ErrorCode, type Attempt, type OutputFragment } from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';

/** Readability is evaluated on every read, never on a cached artifact reference. */
export function readableAttempt(attempt: Attempt): Attempt {
  return attempt.readability.result === 'forbidden' ? { ...attempt, result: undefined } : attempt;
}
export function readableOutput(attempt: Attempt, fragments: readonly OutputFragment[]): readonly OutputFragment[] {
  if (attempt.readability.output === 'forbidden') return [];
  return fragments.map((fragment) => {
    const ref = fragment.toolCallRef;
    // Storage may carry a nested evidence payload in the reference. A reference
    // is identity/status only; do not let that second copy bypass readability.
    const toolCallRef = ref === undefined ? undefined : { callId: ref.callId, status: ref.status, source: ref.source };
    return attempt.readability.tools === 'forbidden' && (fragment.category === 'tool_activity' || fragment.toolEvidence !== undefined || ref !== undefined)
      ? { ...fragment, text: undefined, toolEvidence: undefined, toolCallRef }
      : { ...fragment, toolCallRef };
  });
}
export function boundAttempt(store: Store, taskId: string, attemptId: string, nodeId?: string): Attempt {
  const task = store.tasks.get(taskId);
  const attempt = store.executions.getAttempt(attemptId);
  const execution = attempt === undefined ? undefined : store.executions.get(attempt.executionId);
  if (!task || !attempt || !execution || execution.taskId !== taskId || (nodeId !== undefined && attempt.nodeId !== nodeId) || !execution.nodes.some((node) => node.nodeId === attempt.nodeId)) throw new AppError(ErrorCode.NOT_FOUND, '该任务节点没有对应的执行尝试');
  return attempt;
}
