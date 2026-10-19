import type { OperationReceipt } from '@agent-workflow/shared';
export class ArchiveReceiptMismatch extends Error {}
export interface TemplateArchiveResult { readonly templateId: string; readonly requestKey: string; readonly receiptStatus: 'succeeded'; readonly auditId: string }
/** Directory absence is not evidence that this request archived this template. */
export function archiveReceipt(receipt: OperationReceipt | undefined, templateId: string, requestKey: string): TemplateArchiveResult | undefined {
  if (!receipt || receipt.requestKey !== requestKey || receipt.operation !== 'catalog.template.archive' || receipt.target?.ref !== templateId || typeof receipt.auditId !== 'string' || !receipt.auditId) throw new ArchiveReceiptMismatch('归档回执与原请求或模板不匹配；保留原请求号，不能按目录消失判定成功。');
  return receipt.status === 'succeeded' ? { templateId, requestKey, receiptStatus: 'succeeded', auditId: receipt.auditId } : undefined;
}
