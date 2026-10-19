import { AppError, ErrorCode, QualityReviewVerdict, validQualityReviewContract, type Attempt, type PlanNode, type QualityReviewReport } from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';
import { roleFileAllowed } from './role-runtime.ts';
export const qualityReadKey = (attemptId: string, path: string): string => `quality.read.${attemptId}.${encodeURIComponent(path)}`;
export interface QualityRead { readonly sessionId: string; readonly path: string; readonly sha256: string; readonly text: string }
/** Only the service can attach identity; model-provided source is never trusted. */
export function materializeQualityReview(store: Store, taskId: string, planRevisionId: string, node: PlanNode | undefined, attempt: Attempt, payload: Record<string, unknown> | undefined): QualityReviewReport | undefined {
  if (!node?.qualityReview) {
    if (payload?.reviewReport !== undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '当前冻结步骤未配置独立需求/风险评审');
    return undefined;
  }
  if (!validQualityReviewContract(node.qualityReview, node.kind)) throw new AppError(ErrorCode.VALIDATION_FAILED, '冻结评审合同无效');
  // A declared review cannot be completed by a generic passed; legacy missing reports project unknown.
  if (payload?.reviewReport === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '当前冻结步骤要求独立评审报告，通用verification不能替代');
  const raw = payload.reviewReport as Partial<QualityReviewReport>;
  const bad = (message: string): never => { throw new AppError(ErrorCode.VALIDATION_FAILED, message); };
  if (!raw || typeof raw !== 'object' || raw.kind !== node.qualityReview.kind || typeof raw.summary !== 'string' || !raw.summary.trim() || raw.summary.length > 10000 || !(Object.values(QualityReviewVerdict) as readonly string[]).includes(raw.verdict ?? '') || !Array.isArray(raw.findings) || raw.findings.length !== node.qualityReview.criteria.length) return bad('独立评审报告类型/结论/逐条覆盖不完整');
  const sessionId = store.settings.getJson<{ sessionId: string }>(`execution.session.${attempt.id}`)?.sessionId;
  if (!sessionId) return bad('独立评审缺少当前尝试的真实运行会话');
  const seen = new Set<number>();
  for (const finding of raw.findings) {
    if (!finding || !Number.isSafeInteger(finding.criterion) || finding.criterion < 0 || finding.criterion >= node.qualityReview.criteria.length || seen.has(finding.criterion) || !(Object.values(QualityReviewVerdict) as readonly string[]).includes(finding.verdict) || typeof finding.rationale !== 'string' || !finding.rationale.trim() || finding.rationale.length > 10000 || !Array.isArray(finding.evidence) || finding.evidence.length > 30 || finding.verdict !== 'unknown' && !finding.evidence.length) return bad('每项评审需唯一条款序号、结论、依据；无证据只能未知');
    seen.add(finding.criterion);
    for (const evidence of finding.evidence) {
      if (!evidence || typeof evidence.path !== 'string' || typeof evidence.sha256 !== 'string' || typeof evidence.quote !== 'string' || !evidence.quote.trim() || evidence.quote.length > 4000 || !node.roleSnapshot || !roleFileAllowed(node.roleSnapshot, evidence.path, 'read')) return bad('评审文件依据超出冻结职业范围或引用无效');
      const read = store.settings.getJson<QualityRead>(qualityReadKey(attempt.id, evidence.path));
      if (!read || read.path !== evidence.path || read.sessionId !== sessionId || read.sha256 !== evidence.sha256 || !read.text.includes(evidence.quote)) return bad('评审引用必须匹配本尝试同会话通过受控读取实际获得的文件版本与原文');
    }
  }
  const verdict = raw.findings.some(item => item.verdict === 'failed') ? 'failed' : raw.findings.some(item => item.verdict === 'unknown') ? 'unknown' : 'passed';
  if (raw.verdict !== verdict) return bad('总评审结论与逐条结论不一致');
  return { kind: node.qualityReview.kind, verdict, summary: raw.summary, findings: structuredClone(raw.findings), contract: structuredClone(node.qualityReview), source: { taskId, executionId: attempt.executionId, planRevisionId: attempt.definition?.planRevisionId ?? planRevisionId, nodeId: node.id, attemptId: attempt.id, sessionId } };
}
export function qualityReviewPrompt(node: PlanNode): string {
  if (!node.qualityReview) return '';
  return `\n# 独立${node.qualityReview.kind === 'requirement' ? '需求' : '风险'}AI评审（显式冻结配置）\n条款（0起序号）：${JSON.stringify(node.qualityReview.criteria)}\n逐项通过 workspace.file.read 读取当前授权文件；引用返回的sha及实际原文。不得把泛verification当独立结论。结果payload.reviewReport必须为{kind:"${node.qualityReview.kind}",verdict:"passed|failed|unknown",summary:"总评依据",findings:[{criterion:0,verdict:"passed|failed|unknown",rationale:"分析与限制",evidence:[{path:"相对文件",sha256:"读取返回sha",quote:"读取的原文"}]}]}。每条款恰好一次；无法读取/缺证据则unknown、evidence=[]，不能猜通过。总评failed优先，其次unknown，否则passed；这是AI评审结论，不是客观程序证明。不要写source/contract，由服务绑定身份。\n`;
}
