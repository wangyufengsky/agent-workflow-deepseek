import { AppError, ErrorCode, type ArtifactRef, type Attempt, type AttemptResult, type ControlledTestRun, type PlanNode, type SourceFileEvidence, type Task } from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';
import { captureServiceArtifact, readArtifactBytes } from './artifacts.ts';
function invalid(message: string): never { throw new AppError(ErrorCode.VALIDATION_FAILED, message); }
export const sourceReadKey = (attemptId: string, path: string) => `execution.source-read.${attemptId}.${path}`;
export const artifactReadKey = (attemptId: string, ref: ArtifactRef) => `execution.artifact-read.${attemptId}.${ref.sourceAttemptId}.${ref.id}.${ref.sha256}`;
/** Accumulate only the exact immutable artifact ranges actually returned to this attempt. */
export function recordArtifactRead(store: Store, attemptId: string, ref: ArtifactRef, total: number, offset: number, count: number): void {
  const key = artifactReadKey(attemptId, ref);
  const ranges = store.settings.getJson<readonly (readonly [number, number])[]>(`${key}.ranges`) ?? [];
  const sorted = [...ranges, [offset, Math.min(total, offset + count)] as const].filter(([from, to]) => to > from).sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [from, to] of sorted) { const last = merged.at(-1); if (last && from <= last[1]) last[1] = Math.max(last[1], to); else merged.push([from, to]); }
  // A fragmented reader may retry, but cannot manufacture completion by exhausting storage.
  if (merged.length <= 256) store.settings.putJson(`${key}.ranges`, merged);
  if (merged.length === 1 && merged[0]![0] === 0 && merged[0]![1] === total) store.settings.putJson(key, true);
}
/** Only current, successful ancestor attempts contribute source/output evidence. */
export function sourceAncestors(store: Store, task: Task, attempt: Attempt): readonly Attempt[] {
  const execution = store.executions.get(attempt.executionId); const plan = execution ? store.plans.get(execution.planRevisionId) : undefined;
  if (!execution || !plan || execution.taskId !== task.id) return [];
  const ancestors = new Set<string>(); const visit = (id: string) => { for (const edge of plan.graph.edges.filter((item) => item.to === id)) if (!ancestors.has(edge.from)) { ancestors.add(edge.from); visit(edge.from); } }; visit(attempt.nodeId);
  return execution.nodes.filter((node) => ancestors.has(node.nodeId) && node.status === 'succeeded' && node.currentAttemptId).flatMap((node) => { const value = store.executions.getAttempt(node.currentAttemptId!); return value?.status === 'succeeded' && value.readability.result !== 'forbidden' ? [value] : []; });
}
export function sourceArtifact(store: Store, task: Task, attempt: Attempt, path: string, artifactId?: string): ArtifactRef | undefined {
  return sourceAncestors(store, task, attempt).flatMap((item) => item.result?.artifacts ?? []).find((ref) => ref.path === path && (artifactId === undefined || ref.id === artifactId));
}
export function sourceEvidencePrompt(store: Store, task: Task, node: PlanNode, attemptId: string): string {
  if (task.fixedTemplate?.contract?.sourceEvidenceVersion !== 1 || !node.sourceEvidence || node.sourceEvidence.stage === 'prepare') return '';
  const attempt = store.executions.getAttempt(attemptId)!;
  const upstream = sourceAncestors(store, task, attempt).map((item) => ({ attemptId: item.id, files: item.result?.fileEvidence, testRun: item.result?.testRun ? { id: item.result.testRun.id, state: item.result.testRun.state, passed: item.result.testRun.passed, failed: item.result.testRun.failed, skipped: item.result.testRun.skipped, report: item.result.testRun.report } : undefined }));
  return `\n# 逐文件证据合同 v1\n冻结JUnit来源 ${JSON.stringify(node.sourceEvidence.reportPatterns ?? [])}；工具未指定testReport时读取本次新鲜匹配报告。冻结测试命令 ${node.sourceEvidence.testCommand ?? '未配置'}。阶段 ${node.sourceEvidence.stage}，冻结文件分配 ${JSON.stringify(node.sourceEvidence.filePaths)}。必须先完整读取每个冻结blob；不得以节点成功或自报计数代替覆盖。\n上游当前证据 ${JSON.stringify(upstream)}\npayload.fileEvidence每个分配文件恰好一条：{path,blobSha,summary,artifactPaths:[实际提交产物相对路径],writerAttemptId?,verdict:'confirmed'|'rejected',rationale?,testRunId?}。write阶段须提交实际产物artifacts:[{path}]；review阶段必须逐个完整读取上游产物（workspace.file.read传path和artifactId读取不可变产物；truncated时分页读完）并绑定writerAttemptId，不得使用本会话作为写作和独立复核；拒绝项写明原因。test阶段使用workspace.exec运行已配置的完整测试命令，传testReport:{format:'junit',path?:'本次命令生成的报告相对路径'}，省略path时解析stdout；payload.testRunId引用工具返回的服务id。通过/失败/跳过与用例文件均由服务解析真实报告，不能手写数值。若报告格式不支持，保留unknown并说明配置原因。\n`;
}
export function prepareSourceSubmission(store: Store, task: Task, node: PlanNode | undefined, attempt: Attempt, input: { readonly payload?: Record<string, unknown>; readonly artifacts?: readonly { readonly path: string }[]; readonly verification?: AttemptResult['verification'] }): { materialize(artifacts: readonly ArtifactRef[]): { readonly fileEvidence?: readonly SourceFileEvidence[]; readonly testRun?: ControlledTestRun; readonly verification?: AttemptResult['verification']; readonly serviceArtifacts?: readonly ArtifactRef[] } } {
  const binding = task.fixedTemplate;
  if (binding?.contract?.sourceEvidenceVersion !== 1 || !node?.sourceEvidence || node.sourceEvidence.stage === 'prepare') return { materialize: () => ({}) };
  if (input.verification?.state === 'failed' && input.payload?.fileEvidence === undefined) return { materialize: () => ({ fileEvidence: [], verification: { state: 'failed', summary: input.verification?.summary ?? '逐文件证据未完成；没有计入覆盖' } }) };
  const stage = node.sourceEvidence.stage; const files = binding.scope?.sourceFiles;
  if (!files?.length) invalid('逐文件合同没有冻结源码正文，请重新创建带范围的任务');
  const rows = input.payload?.fileEvidence;
  if (!Array.isArray(rows) || rows.length !== node.sourceEvidence.filePaths.length) invalid('逐文件证据必须覆盖当前步骤分配的每个文件，不能遗漏或扩大');
  const ancestors = sourceAncestors(store, task, attempt); const seen = new Set<string>();
  let testRun: ControlledTestRun | undefined;
  if (stage === 'test') {
    const runId = input.payload?.testRunId;
    testRun = typeof runId === 'string' ? store.settings.getJson<ControlledTestRun>(`execution.test-run.${runId}`) : undefined;
    if (!testRun || testRun.taskId !== task.id || testRun.executionId !== attempt.executionId || testRun.nodeId !== attempt.nodeId || testRun.attemptId !== attempt.id) invalid('测试结果必须引用当前尝试由受控命令签发的testRunId');
    const workspace = task.workspaceId ? store.workspaces.get(task.workspaceId) : undefined;
    if (testRun.workspaceId !== workspace?.id || testRun.workspaceRevision !== workspace?.revision) invalid('测试工作区身份或修订已变化，不能提交旧工作区报告');
    if (testRun && store.settings.getJson<string>(`execution.test-run.latest.${attempt.id}`) !== testRun.id) invalid('此尝试已有更新的测试运行，不能选择旧报告冒充最近结果');
    if (testRun.report) readArtifactBytes(store.dataDir, testRun.report);
    for (const report of testRun.reports ?? []) readArtifactBytes(store.dataDir, report);
  }
  const prepared = rows.map((row): { evidence: SourceFileEvidence; paths: readonly string[] } => {
    if (row === null || typeof row !== 'object') invalid('逐文件证据格式错误');
    const value = row as Record<string, unknown>; const path = value.path;
    if (typeof path !== 'string' || !node.sourceEvidence!.filePaths.includes(path) || seen.has(path)) invalid('逐文件证据存在越界、重复或无效文件'); seen.add(path);
    const file = files.find((item) => item.path === path)!;
    if (!file || value.blobSha !== file.blobSha) invalid('逐文件证据blob与冻结范围不一致');
    const read = store.settings.getJson<{ blobSha: string }>(sourceReadKey(attempt.id, path));
    if (read?.blobSha !== file.blobSha) invalid('本尝试尚未完整读取该冻结源码文件');
    if (typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > 8000) invalid('逐文件摘要必须为1至8000字符');
    const paths = value.artifactPaths === undefined ? [] : value.artifactPaths;
    if (!Array.isArray(paths) || paths.some((item) => typeof item !== 'string') || new Set(paths).size !== paths.length) invalid('逐文件artifactPaths必须是唯一相对路径数组');
    if (stage === 'write') {
      if (binding.contract?.group === 'dev' && paths.length === 0) invalid('写作阶段必须关联实际生成文件，不能只自报完成');
      if (paths.some((path) => !input.artifacts?.some((item) => item.path === path))) invalid('写作证据引用的产物未在本次提交中声明');
      return { paths, evidence: { path, blobSha: file.blobSha, summary: value.summary, stage, attemptId: attempt.id, artifacts: [] } };
    }
    const writers = ancestors.flatMap((item) => (item.result?.fileEvidence ?? []).filter((evidence) => evidence.stage === 'write' && evidence.path === path).map((evidence) => ({ attempt: item, evidence })));
    const writer = writers.find((item) => item.attempt.id === value.writerAttemptId);
    if (!writer) invalid('复核/测试必须绑定当前成功上游写作尝试，旧尝试不能证明当前文件');
    const evidence: SourceFileEvidence = { path, blobSha: file.blobSha, summary: value.summary, stage, attemptId: attempt.id, artifacts: writer.evidence.artifacts, writerAttemptId: writer.attempt.id };
    for (const ref of evidence.artifacts) readArtifactBytes(store.dataDir, ref);
    if (stage === 'review') {
      const currentSession = store.settings.getJson<{ sessionId: string }>(`execution.session.${attempt.id}`)?.sessionId;
      const writerSession = store.settings.getJson<{ sessionId: string }>(`execution.session.${writer.attempt.id}`)?.sessionId;
      if (!currentSession || !writerSession || currentSession === writerSession) invalid('独立复核需要不同于写作的真实会话身份');
      if (value.verdict !== 'confirmed' && value.verdict !== 'rejected' || typeof value.rationale !== 'string' || !value.rationale.trim()) invalid('独立复核必须给出confirmed/rejected与理由');
      if (evidence.artifacts.some((ref) => !store.settings.getJson<boolean>(artifactReadKey(attempt.id, ref)))) invalid('复核尚未完整读取对应写作产物');
      if (binding.templateId === 'template.unit-test-development') {
        const test = ancestors.map((item) => item.result?.testRun).find((run) => run?.id === value.testRunId);
        if (!test || test.state !== 'passed' || !ancestors.some((item) => item.result?.fileEvidence?.some((entry) => entry.stage === 'test' && entry.path === path && entry.writerAttemptId === writer.attempt.id && entry.testRunId === test.id))) invalid('单测复核须绑定当前写作版本的实际通过测试报告');
      }
      return { paths: [], evidence: { ...evidence, verdict: value.verdict, rationale: value.rationale, ...(typeof value.testRunId === 'string' ? { testRunId: value.testRunId } : {}) } };
    }
    if (testRun?.state !== 'unknown' && !evidence.artifacts.some((ref) => testRun?.cases.some((item) => item.file === ref.path && item.artifact?.sha256 === ref.sha256))) invalid('该源码没有关联到实际测试报告中的同版本测试文件');
    return { paths: [], evidence: { ...evidence, testRunId: testRun!.id } };
  });
  return { materialize: (artifacts) => {
    const fileEvidence = prepared.map(({ evidence, paths }) => ({ ...evidence, artifacts: stage === 'write' ? paths.map((path) => artifacts.find((ref) => ref.path === path) ?? invalid('产物捕获身份缺失')) : evidence.artifacts }));
    const rejected = fileEvidence.some((item) => item.verdict === 'rejected');
    const reviewReport = stage === 'review' ? captureServiceArtifact(store.dataDir, attempt.id, 'source-file-review.md', Buffer.from(`# 逐文件复核报告\n\n由服务根据已验证的当前写作/独立会话复核证据汇总；不以节点成功推算覆盖。\n\n${fileEvidence.map((entry) => `## ${entry.path}\n\n冻结blob：${entry.blobSha}\n\n写作尝试：${entry.writerAttemptId}\n\n结论：${entry.verdict === 'confirmed' ? '复核通过' : '复核拒绝'}\n\n${entry.summary}\n\n${entry.rationale}\n`).join('\n')}`), 'text/markdown') : undefined;
    return { fileEvidence, ...(testRun ? { testRun, serviceArtifacts: [...(testRun.report ? [testRun.report] : []), ...(testRun.reports ?? []), ...new Map(testRun.cases.flatMap((item) => item.artifact ? [[item.artifact.id, item.artifact] as const] : [])).values()], verification: { state: testRun.state === 'passed' ? 'passed' : 'failed', passed: testRun.passed, failed: testRun.failed, summary: testRun.reason ?? `真实命令退出${testRun.exitCode}；通过${testRun.passed}，失败${testRun.failed}，跳过${testRun.skipped}` } } : stage === 'review' ? { serviceArtifacts: reviewReport ? [reviewReport] : [], verification: { state: rejected ? 'failed' : 'passed', summary: rejected ? '逐文件独立复核存在拒绝项' : '逐文件写作版本与独立复核已核对' } } : {}) };
  } };
}
