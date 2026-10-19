import { ROUTES, type OperationReceipt, type OperationsByKeyResponse } from '@agent-workflow/shared';
import { apiGet } from '../../api/client.ts';
export function assertProjectAccountReceipt(receipt: OperationReceipt, projectId: string, requestKey: string): void {
  if (receipt?.requestKey !== requestKey || receipt.target?.projectId !== projectId || !['project.git-account.save', 'project.git-account.test'].includes(receipt.operation)) throw new Error('项目账号回执身份不一致；只核对当前项目原请求号');
}
/** Reject late reads before the component can display or invalidate another project. */
export async function readProjectAccountOperation(projectId: string, requestKey: string, current: () => boolean): Promise<OperationReceipt> {
  const operation = (await apiGet<OperationsByKeyResponse>(ROUTES.operationsByKey(requestKey))).data.operation;
  if (!current()) throw new Error('项目账号读取已过期，未采用迟到回执');
  assertProjectAccountReceipt(operation, projectId, requestKey);
  return operation;
}
