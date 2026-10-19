import { createHash } from 'node:crypto';
import type { Store } from '@agent-workflow/storage';
import { AppError, ErrorCode, DEFAULT_SETTINGS, type Attempt, type ExecutionView, type PlanRevision, type RequirementInput, type Task, type TemplateRunContent, type TemplateRunInputContent, type TemplateRunInput, type TemplateRunFile } from '@agent-workflow/shared';
import { readableAttempt } from './node-read.ts';
import { snapshotEvidenceState } from './snapshot-review.ts';
import { requirementLinks } from './requirement-source.ts';
import { taskArchiveAction } from './task-archive-policy.ts';
import { executionSettingsKey } from './execution-policy.ts';
function sourceInputs(task: Task) {
  const scope = task.fixedTemplate?.scope;
  return [
    ...(scope?.documents ?? []).map((document, index) => ({ id: `document:${index}`, name: document.name, kind: 'document' as const, version: document.sha256, bytes: document.bytes, content: document.text })),
    ...(scope?.sourceFiles ?? []).map((file) => ({ id: `source:${file.path}`, name: file.path, kind: 'source' as const, version: file.blobSha, bytes: Buffer.byteLength(file.text), content: file.text })),
    ...(scope?.commits ?? []).map((item) => { const content = JSON.stringify(item, null, 2); return { id: `history:${item.commit.sha}`, name: `${item.commit.sha.slice(0, 8)} ${item.commit.subject}`, kind: 'history' as const, version: item.commit.sha, bytes: Buffer.byteLength(content), content }; }),
  ].map((item) => ({ ...item, contentSha256: createHash('sha256').update(item.content).digest('hex') }));
}
export function templateRunInput(store: Store, taskId: string, inputId: string, expectedVersion: string, expectedSha256: string): TemplateRunInputContent {
  const task = store.tasks.get(taskId); if (task === undefined) throw new AppError(ErrorCode.NOT_FOUND, '任务不存在');
  const input = sourceInputs(task).find((item) => item.id === inputId);
  if (input === undefined) throw new AppError(ErrorCode.NOT_RETAINED, '这次运行没有保留该输入正文，请重新读取冻结清单');
  if (input.version !== expectedVersion || input.contentSha256 !== expectedSha256) throw new AppError(ErrorCode.STALE_TARGET, '冻结输入身份或内容校验值不一致，请重新读取运行快照');
  return { taskId, inputId, version: input.version, contentSha256: input.contentSha256, content: input.content.slice(0, 128000), truncated: input.content.length > 128000 };
}
export function templateRunContent(store: Store, task: Task, plan: PlanRevision | undefined, execution: ExecutionView | undefined): TemplateRunContent | undefined {
  const binding = task.fixedTemplate; if (binding === undefined) return undefined;
  const contract = binding.contract; const scope = binding.scope; const snapshot = binding.snapshot;
  const kind = binding.templateId === 'template.unit-test-development' ? 'unit_test' : snapshot !== undefined || contract?.inputs?.source ? 'source' : 'document';
  const limitations: string[] = [];
  if (contract === undefined) limitations.push('历史任务没有冻结完整模板合同，分类仅保留模板身份；未回填当前模板内容。');
  if (scope === undefined) limitations.push('此历史运行没有保留输入范围与正文快照，不能用当前项目文件替代。');
  const inputs: TemplateRunInput[] = sourceInputs(task).map(({ content: _content, ...input }) => ({ ...input, available: true }));
  const states = new Map(execution?.nodes.map((node) => [node.nodeId, node]) ?? []);
  const attempts = execution === undefined ? [] : store.executions.listAttempts(execution.id).map(readableAttempt);
  if (attempts.some((attempt) => attempt.readability.result === 'forbidden')) limitations.push('部分执行结果的读取权限已撤销，相关产物、测试结论与文件证据已隐藏。');
  const current = (id: string): Attempt | undefined => { const state = states.get(id); return state?.currentAttemptId === undefined ? undefined : attempts.find((attempt) => attempt.id === state.currentAttemptId); };
  const accepted = (id: string) => store.settings.getJson<{ state: string }>(`execution.node.acceptance.${execution?.id}.${id}`)?.state === 'accepted';
  const artifacts = attempts.flatMap((attempt) => (attempt.result?.artifacts ?? []).map((artifact) => ({ artifact, nodeId: attempt.nodeId, nodeTitle: attempt.definition?.node.title ?? plan?.graph.nodes.find((node) => node.id === attempt.nodeId)?.title ?? '历史步骤', ordinal: attempt.ordinal, attemptStatus: attempt.status })));
  const evidence = snapshotEvidenceState(store, task.id, true);
  const ordinaryFiles: TemplateRunFile[] = (scope?.sourceFiles ?? []).map((file) => {
    const currentAttempts = [...states.values()].flatMap((state) => { const value = current(state.nodeId); return value?.result ? [value] : []; });
    const writer = currentAttempts.flatMap((item) => (item.result?.fileEvidence ?? []).filter((entry) => entry.stage === 'write' && entry.path === file.path && entry.blobSha === file.blobSha).map((entry) => ({ attempt: item, entry }))).at(-1);
    const review = writer ? currentAttempts.flatMap((item) => (item.result?.fileEvidence ?? []).filter((entry) => entry.stage === 'review' && entry.path === file.path && entry.writerAttemptId === writer.attempt.id && entry.blobSha === file.blobSha).map((entry) => ({ attempt: item, entry }))).at(-1) : undefined;
    const covered = review?.entry.verdict === 'confirmed' && review.attempt.status === 'succeeded';
    return { path: file.path, version: file.blobSha, state: covered ? 'covered' : writer ? 'analyzed' : 'pending', reason: covered ? '冻结源码对应的写作产物与独立复核已核对' : review?.entry.rationale ?? (writer ? '写作证据已保存，等待独立复核' : '尚无逐文件写作与独立复核证据，不能按节点成功推算覆盖'), inputId: `source:${file.path}`, findings: [], ...(writer ? { writing: { attemptId: writer.attempt.id, summary: writer.entry.summary, artifacts: writer.entry.artifacts } } : {}), ...(review?.entry.verdict ? { review: { attemptId: review.attempt.id, verdict: review.entry.verdict, rationale: review.entry.rationale ?? '' } } : {}) };
  });
  const files: TemplateRunFile[] = snapshot === undefined ? ordinaryFiles : snapshot.units.map((unit) => {
    const analyzed = evidence.analyzed.get(unit.id); const verified = evidence.verified.get(unit.id);
    const covered = verified !== undefined || (snapshot.depth === 'lightweight' && analyzed !== undefined && analyzed.findings.length === 0);
    return { path: unit.path, version: unit.blobSha, state: unit.excludedReason !== undefined ? 'excluded' : covered ? 'covered' : analyzed !== undefined ? 'analyzed' : 'pending', reason: unit.excludedReason ?? (covered ? '已提交且核对对应blob版本的分析/独立复核证据' : analyzed?.summary ?? '等待该冻结源码单元的证据'), ...(inputs.some((input) => input.id === `source:${unit.path}`) ? { inputId: `source:${unit.path}` } : {}), findings: (verified ?? analyzed)?.findings ?? [] };
  });
  const source = plan === undefined ? undefined : store.settings.getJson<RequirementInput>(`plan.requirement.${plan.id}`);
  if (source === undefined) limitations.push('未保留计划的精确需求快照，逐项结论不读取当前需求替代。');
  const requirements = (source?.entries ?? []).map((entry) => {
    const nodes = plan?.graph.nodes.filter((node) => requirementLinks(store, task, plan!, node).some((link) => link.entryId === entry.id)) ?? [];
    const checked = nodes.filter((node) => states.get(node.id)?.status === 'succeeded' && accepted(node.id)).length;
    const done = nodes.length > 0 && nodes.every((node) => states.get(node.id)?.status === 'succeeded');
    return { id: entry.id, text: entry.text, conclusion: checked > 0 && checked === nodes.length ? 'accepted' as const : checked > 0 ? 'partial' as const : done ? 'unknown' as const : 'pending' as const,
      reason: checked === nodes.length && checked > 0 ? '关联节点的人工验收已确认' : done ? '节点已执行，但没有足够逐项验收证据；不把计划覆盖当成满足' : '等待关联节点执行与逐项验收',
      links: nodes.flatMap((node) => requirementLinks(store, task, plan!, node).filter((link) => link.entryId === entry.id).map((link) => ({ nodeId: node.id, link }))) };
  });
  const pendingOperations = store.operations.listPending().filter((operation) => operation.target.taskId === task.id && ['execution.retry', 'execution.cancel', 'task.archive'].includes(operation.operation)).map((operation) => ({ requestKey: operation.requestKey, operation: operation.operation, status: operation.status }));
  const active = execution?.nodes.some((node) => ['running', 'unknown'].includes(node.status)) || pendingOperations.length > 0 || execution?.status === 'pausing' || execution?.status === 'unknown';
  const retryPolicy = { ...DEFAULT_SETTINGS.execution, ...store.settings.getSettings()?.execution, ...(execution === undefined ? {} : store.settings.getJson<Partial<typeof DEFAULT_SETTINGS.execution>>(executionSettingsKey(execution.id))) };
  const budgetReason = execution === undefined ? '执行尚未创建' : !['failed', 'paused', 'stopped'].includes(execution.status) ? '执行尚未停稳，不能重试' : attempts.length >= retryPolicy.maxTaskAttempts ? '任务总尝试次数已用完；请创建恢复任务' : (store.settings.getJson<number>(`execution.session-errors.${execution.id}`) ?? 0) >= retryPolicy.sessionErrorThreshold ? '会话异常次数已达阈值；请检查运行环境后创建恢复任务' : retryPolicy.timeoutEnabled && execution.startedAt !== undefined && Date.now() >= Date.parse(execution.startedAt) + retryPolicy.taskTimeoutMinutes * 60000 ? '任务业务总时限已用完；请创建恢复任务' : undefined;
  const batchGroups = snapshot === undefined ? (plan?.graph.groups ?? []).map((group) => ({ id: group.id, title: group.label, nodes: plan!.graph.nodes.filter((node) => node.groupId === group.id), files: files.filter((file) => plan!.graph.nodes.some((node) => node.groupId === group.id && node.sourceEvidence?.filePaths.includes(file.path) && node.sourceEvidence.stage !== 'prepare')) })) : (plan?.graph.nodes.filter((node) => node.snapshotStage === 'analysis') ?? []).map((node, index) => ({ id: node.id, title: `批次 ${index + 1}`, nodes: plan!.graph.nodes.filter((item) => item.id === node.id || (item.snapshotStage === 'verification' && JSON.stringify(item.snapshotUnitIds) === JSON.stringify(node.snapshotUnitIds))), files: files.filter((file) => snapshot.units.some((unit) => unit.path === file.path && node.snapshotUnitIds?.includes(unit.id))) }));
  const batches = batchGroups.filter((group) => group.nodes.length > 0).map((group) => {
    const nodeIds = group.nodes.map((node) => node.id); const failedNodeIds = nodeIds.filter((id) => states.get(id)?.status === 'failed');
    const status = nodeIds.some((id) => states.get(id)?.status === 'unknown') ? 'unknown' : nodeIds.some((id) => states.get(id)?.status === 'running') ? 'running' : failedNodeIds.length > 0 ? 'failed' : nodeIds.every((id) => ['succeeded', 'skipped'].includes(states.get(id)?.status ?? 'pending')) ? 'succeeded' : 'pending';
    const verified = contract?.sourceEvidenceVersion === 1 && snapshot === undefined ? group.files.length > 0 && group.files.every((file) => file.state === 'covered') && group.nodes.every((node) => ['succeeded', 'skipped'].includes(states.get(node.id)?.status ?? 'pending')) && (kind !== 'unit_test' || group.nodes.some((node) => current(node.id)?.result?.testRun?.state === 'passed')) : snapshot !== undefined ? group.files.length > 0 && group.files.every((file) => file.state === 'covered' || file.state === 'excluded') && group.nodes.every((node) => ['succeeded', 'skipped'].includes(states.get(node.id)?.status ?? 'pending')) : group.nodes.every((node) => states.get(node.id)?.status === 'skipped' || (states.get(node.id)?.status === 'succeeded' && (node.snapshotStage === 'verification' || current(node.id)?.result?.verification?.state === 'passed' || accepted(node.id))));
    const testRun = [...group.nodes].reverse().map((node) => current(node.id)?.result?.testRun).find((item) => item !== undefined);
    const result = [...group.nodes].reverse().map((node) => current(node.id)?.result?.verification).find((item) => item !== undefined);
    return { ...(testRun ? { testRun } : {}), id: group.id, title: group.title, nodeIds, failedNodeIds, files: group.files, status, verified, attempts: attempts.filter((attempt) => nodeIds.includes(attempt.nodeId)).length,
      reason: nodeIds.map((id) => current(id)?.readability.result === 'forbidden' ? '该步骤结果读取权限已撤销' : states.get(id)?.error?.message).find(Boolean), artifacts: artifacts.filter((item) => nodeIds.includes(item.nodeId)), ...(result === undefined ? {} : { testResult: result }),
      retry: active ? { allowed: false, reason: '仍有活动、未知或正在停止的会话，请先核对原操作' } : failedNodeIds.length === 0 ? { allowed: false, reason: '本批次没有失败步骤' } : budgetReason !== undefined ? { allowed: false, reason: budgetReason } : failedNodeIds.some((id) => (states.get(id)?.attemptCount ?? 0) >= retryPolicy.maxAttempts) ? { allowed: false, reason: '本批次步骤尝试次数已用完（含首次执行）；请创建恢复任务' } : { allowed: true } };
  });
  return { archiveAction: taskArchiveAction(store, task), scopedRetrySupported: true, kind, templateName: contract?.name ?? '固定模板（历史合同未保留）', templateVersion: binding.templateVersion, projectName: store.projects.get(task.projectId)?.name ?? '项目不可用', frozenAt: scope?.frozenAt ?? snapshot?.frozenAt, targetSha: scope?.targetSha ?? snapshot?.targetSha, outputDirectory: scope?.outputDirectory, scopeLabel: scope?.sourcePaths.join('、') || (scope?.documents.length ? `${scope.documents.length}份冻结资料` : snapshot ? '冻结代码快照' : '范围未保留'), limitations, inputs, requirements, batches, artifacts, files, pendingOperations };
}
