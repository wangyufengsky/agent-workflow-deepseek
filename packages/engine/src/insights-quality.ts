import type { Attempt, ControlledTestRun, InsightsQuality, PlanNode, Task, TaskQualityCheck, TaskQualityEvidence, QualityEvidenceSource } from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';
import { readArtifactBytes } from './artifacts.ts';
import { sourceReadKey, artifactReadKey } from './template-file-evidence.ts';

/** Four independent evidence projections; absence is never an implied pass. */
export function taskQualityEvidence(store: Store, task: Task): TaskQualityEvidence {
  const execution = task.executionId ? store.executions.get(task.executionId) : undefined;
  const plan = execution ? store.plans.get(execution.planRevisionId) : undefined;
  const current = (node: PlanNode): Attempt | undefined => { const id = execution?.nodes.find(state => state.nodeId === node.id)?.currentAttemptId; const attempt = id ? store.executions.getAttempt(id) : undefined; return attempt?.executionId === execution?.id && attempt?.nodeId === node.id ? attempt : undefined; };
  const source = (attempt: Attempt, kind: QualityEvidenceSource['kind'] = 'attempt', id = attempt.id): QualityEvidenceSource => ({ kind, id, label: kind === 'test_run' ? '测试来源节点' : '评审来源节点', href: `/tasks/${encodeURIComponent(task.id)}?node=${encodeURIComponent(attempt.nodeId)}` });
  const check = (kind: TaskQualityCheck['kind'], state: TaskQualityCheck['state'], required: boolean, reason: string, sources: readonly QualityEvidenceSource[] = []): TaskQualityCheck => ({ kind, state, required, reason, sources });
  const tests = plan?.graph.nodes.filter(node => node.kind === 'test' || node.sourceEvidence?.stage === 'test') ?? [];
  let program = check('program', plan ? 'not_required' : 'not_configured', false, plan ? '当前冻结计划没有程序测试步骤；不把节点成功当测试通过' : '尚无冻结执行计划，程序验收范围未配置');
  if (tests.length) {
    const runs: ControlledTestRun[] = []; const sources: QualityEvidenceSource[] = []; let missing = false; let unknown = false;
    for (const node of tests) {
      const attempt = current(node);
      if (!attempt) { missing = true; continue; }
      if (attempt.readability.result === 'forbidden') { unknown = true; continue; }
      const run = attempt.result?.testRun;
      if (!run) { if (['running','pending','ready'].includes(attempt.status)) missing = true; else unknown = true; continue; }
      const signed = store.settings.getJson<ControlledTestRun>(`execution.test-run.${run.id}`);
      try {
        if (!signed || signed.taskId !== task.id || signed.executionId !== execution?.id || signed.nodeId !== node.id || signed.attemptId !== attempt.id || JSON.stringify(signed) !== JSON.stringify(run) || store.settings.getJson<string>(`execution.test-run.latest.${attempt.id}`) !== run.id) throw Error('unbound');
        if (!['succeeded','failed'].includes(attempt.status) || attempt.status === 'failed' && signed.state !== 'failed' || (attempt.result?.fileEvidence ?? []).some(file => file.writerAttemptId !== undefined && !execution?.nodes.some(state => state.currentAttemptId === file.writerAttemptId && state.status === 'succeeded'))) throw Error('stale writer or unsettled attempt');
        if (signed.report) readArtifactBytes(store.dataDir, signed.report);
        for (const report of signed.reports ?? []) readArtifactBytes(store.dataDir, report);
        runs.push(signed); sources.push(source(attempt, 'test_run', signed.id));
      } catch { unknown = true; }
    }
    const failed = runs.some(run => run.state === 'failed'); const state = failed ? 'failed' : unknown || runs.some(run => run.state === 'unknown') ? 'unknown' : missing ? 'not_reviewed' : runs.length === tests.length ? 'passed' : 'unknown';
    const measuredRuns = runs.filter(run => typeof run.passed === 'number' && typeof run.failed === 'number' && typeof run.skipped === 'number');
    program = { ...check('program', state, true, state === 'passed' ? '当前各测试步骤均绑定服务签发的受控命令与报告' : state === 'failed' ? '当前受控测试报告有失败；人工意见不改写测试结果' : state === 'not_reviewed' ? '冻结计划要求程序验收，仍有测试步骤未运行' : '当前尝试缺少可核对的受控测试报告，或报告身份/权限已失效', sources), ...(measuredRuns.length ? { passed: measuredRuns.reduce((sum, run) => sum + (run.passed ?? 0), 0), failed: measuredRuns.reduce((sum, run) => sum + (run.failed ?? 0), 0), skipped: measuredRuns.reduce((sum, run) => sum + (run.skipped ?? 0), 0) } : {}) };
  }
  let requirement = check('requirement', 'not_configured', false, '此任务未配置独立需求评审来源；通用代码审查不冒充需求评审');
  if (task.fixedTemplate?.templateId === 'template.requirement-review') {
    const nodes = plan?.graph.nodes.filter(node => node.sourceEvidence?.stage === 'review') ?? []; const sources: QualityEvidenceSource[] = [];
    let missing = nodes.length === 0; let unknown = task.fixedTemplate.contract?.sourceEvidenceVersion !== 1 || !task.fixedTemplate.scope?.documents.length; let failed = false;
    for (const node of nodes) {
      const attempt = current(node); if (!attempt) { missing = true; continue; }
      if (attempt.readability.result === 'forbidden' || attempt.status !== 'succeeded') { unknown = true; continue; }
      const evidence = attempt.result?.fileEvidence;
      if (!evidence || evidence.length !== node.sourceEvidence!.filePaths.length || new Set(evidence.map(file => file.path)).size !== evidence.length || evidence.some(file => !node.sourceEvidence!.filePaths.includes(file.path)) || evidence.some(file => file.stage !== 'review' || file.attemptId !== attempt.id || !file.writerAttemptId || !file.rationale || !['confirmed','rejected'].includes(file.verdict ?? ''))) { if (attempt.result) unknown = true; else missing = true; continue; }
      for (const file of evidence) {
        const frozen = task.fixedTemplate.scope?.sourceFiles?.find(item => item.path === file.path);
        const writer = store.executions.getAttempt(file.writerAttemptId!);
        if (file.blobSha !== frozen?.blobSha || !writer || writer.executionId !== execution?.id || writer.status !== 'succeeded' || execution?.nodes.find(state => state.nodeId === writer.nodeId)?.currentAttemptId !== writer.id || writer.readability.result === 'forbidden') unknown = true;
        const session = store.settings.getJson<{ sessionId: string }>(`execution.session.${attempt.id}`)?.sessionId;
        const writerSession = store.settings.getJson<{ sessionId: string }>(`execution.session.${writer?.id}`)?.sessionId;
        if (!session || !writerSession || session === writerSession || store.settings.getJson<{ blobSha: string }>(sourceReadKey(attempt.id, file.path))?.blobSha !== file.blobSha || !writer?.result?.fileEvidence?.some(item => item.stage === 'write' && item.path === file.path && item.blobSha === file.blobSha)) unknown = true;
        try { for (const artifact of file.artifacts) { if (!store.settings.getJson<boolean>(artifactReadKey(attempt.id, artifact))) throw Error('unread artifact'); readArtifactBytes(store.dataDir, artifact); } } catch { unknown = true; }
      }
      failed ||= evidence.some(file => file.verdict === 'rejected'); sources.push(source(attempt));
    }
    // fileEvidence confirms the review artifact, not that every business requirement passed.
    const state = missing && !unknown && !failed ? 'not_reviewed' : 'unknown';
    requirement = check('requirement', state, true, state === 'not_reviewed' ? '已配置需求代码评审，当前范围尚未完成独立复核' : failed ? '需求评审产物复核存在拒绝项，不能据此确认业务需求结论' : unknown ? '需求资料、文件版本、当前尝试或读取权限不足以证明需求评审结论' : `逐文件评审过程已完成，依据${task.fixedTemplate.scope?.documents.length ?? 0}份冻结资料；现有合同未结构化需求通过/失败，不能把产物复核成立当需求全部满足`, sources);
  }
  const risk = check('risk', 'not_configured', false, '此任务未配置独立风险评审来源；security等通用审查维度不等于独立风险评审');
  const humanRecord = store.acceptances.get(task.id);
  const human = check('human', humanRecord ? humanRecord.verdict === 'accepted' ? 'passed' : 'failed' : 'not_reviewed', false, humanRecord ? `人工${humanRecord.verdict === 'accepted' ? '认定通过' : '认定未通过'}；单独记录，不改写程序与AI评审原结论` : '尚未人工认定；人工认定不替代程序或AI证据', humanRecord ? [{ kind: 'human', id: task.id, label: '原人工意见', href: `/api/tasks/${encodeURIComponent(task.id)}/acceptance` }] : []);
  const reviewRow = execution ? store.db.prepare('SELECT id, findings_json FROM reviews WHERE execution_id=? ORDER BY rowid DESC LIMIT 1').get(execution.id) as { id: string; findings_json: string } | undefined : undefined;
  const review = reviewRow ? store.reviews.get(reviewRow.id) : undefined;
  let findingsReadable = false; try { const value: unknown = JSON.parse(reviewRow?.findings_json ?? 'null'); findingsReadable = Array.isArray(value) && value.every(item => item !== null && typeof item === 'object' && typeof item.status === 'string'); } catch { /* Invalid legacy evidence stays unknown. */ }
  const codeReview = !review ? check('code_review', 'not_configured', false, '当前执行没有独立代码审查记录') : check('code_review', review.state === 'completed' ? !findingsReadable || review.dimensions.length === 0 ? 'unknown' : review.findings.some(finding => finding.status === 'open') ? 'failed' : 'passed' : ['queued','running','stopping'].includes(review.state) ? 'in_progress' : 'unknown', true, review.state === 'completed' && !findingsReadable ? '原代码审查问题清单无法读取，不能据此判定通过' : review.state === 'completed' ? `当前执行的通用代码审查：${review.dimensions.join('、')}；不替代独立需求/风险评审` : '当前代码审查尚无明确完整结论', [{ kind: 'code_review', id: review.reviewRunId, label: '原代码审查', href: `/api/git/repos/${encodeURIComponent(task.projectId)}/reviews/${encodeURIComponent(review.reviewRunId)}` }]);
  const checks = [program, requirement, risk, human]; const applicable = [...checks.filter(item => item.required), ...(codeReview.required ? [codeReview] : [])];
  const summary: InsightsQuality = [...applicable, human].some(item => item.state === 'failed') ? 'issues' : applicable.length > 0 && applicable.every(item => item.state === 'passed') && task.lifecycle === 'completed' ? 'passed' : humanRecord?.verdict === 'accepted' || applicable.some(item => item.state !== 'not_reviewed') ? 'pending_review' : 'pending_acceptance';
  return { checks, codeReview, summary };
}
