import { createHash } from 'node:crypto';
import { AppError, ErrorCode, SnapshotReviewMode, SnapshotReviewDepth, nowIso, type CodeReviewSnapshot, type GitSnapshotInventory, type PlanGraph, type PlanNode, type SnapshotUnitEvidence, type TaskTemplate } from '@agent-workflow/shared';

function prefixMatches(path: string, prefix: string): boolean { return prefix === '.' || path === prefix || path.startsWith(`${prefix}/`); }
function paths(value: string | undefined): string[] {
  const result = (value ?? '').split(',').map((path) => path.trim().replace(/\/$/, '')).filter(Boolean);
  if (result.some((path) => path.startsWith('/') || path.includes('\\') || path.split('/').includes('..'))) throw new AppError(ErrorCode.VALIDATION_FAILED, '快照范围必须是相对路径');
  return result;
}
export function freezeCodeReviewSnapshot(inventory: GitSnapshotInventory, parameters: Record<string, string>): CodeReviewSnapshot {
  const mode = parameters.mode ?? 'full'; const depth = parameters.depth ?? 'full';
  if (!Object.values(SnapshotReviewMode).some((value) => value === mode) || !Object.values(SnapshotReviewDepth).some((value) => value === depth)) throw new AppError(ErrorCode.VALIDATION_FAILED, '快照审查方式或深度无效');
  if (mode === 'incremental' && inventory.baselineSha === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '增量审查必须固定源码基线');
  const scopes = paths(parameters.scopePaths); const excluded = paths(parameters.excludedPaths);
  const changed = new Set(inventory.changedPaths ?? []);
  return { mode: mode as CodeReviewSnapshot['mode'], depth: depth as CodeReviewSnapshot['depth'], targetSha: inventory.targetSha, ...(mode === 'incremental' ? { baselineSha: inventory.baselineSha } : {}), frozenAt: nowIso(), batchSize: 8,
    units: inventory.files.map((file) => ({ id: createHash('sha256').update(`${file.path}\0${file.blobSha}`).digest('hex').slice(0, 24), path: file.path, blobSha: file.blobSha, sizeBytes: file.sizeBytes, ...(file.deletedAtTarget ? { deletedAtTarget: true } : {}),
      ...(scopes.length > 0 && !scopes.some((scope) => prefixMatches(file.path, scope)) ? { excludedReason: '不在所选代码范围内' }
        : excluded.some((scope) => prefixMatches(file.path, scope)) ? { excludedReason: '用户明确排除的路径' }
        : mode === 'incremental' && !changed.has(file.path) ? { excludedReason: '基线至目标未发生变更' }
        : file.mode === '120000' ? { excludedReason: '符号链接不作为源码分析单元' }
        : file.sizeBytes > 256 * 1024 ? { excludedReason: '文件超过256KB分析上限' }
        : /\.(?:png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|mp[34]|sqlite|db|lock)$/i.test(file.path) ? { excludedReason: '二进制或锁定依赖文件' } : {}), })) };
}

export function snapshotPlanGraph(base: PlanGraph, snapshot: CodeReviewSnapshot, template: TaskTemplate): PlanGraph {
  const active = snapshot.units.filter((unit) => unit.excludedReason === undefined);
  const groups = [{ id: 'snapshot.analysis', label: '分析', kind: '分析', refined: true, collapsible: true, collapsedByDefault: false }, { id: 'snapshot.verification', label: '独立复核', kind: '复核', refined: true, collapsible: true, collapsedByDefault: false }, { id: 'snapshot.report', label: '报告', kind: '报告', refined: true, collapsible: true, collapsedByDefault: false }];
  const prototype = base.nodes[0];
  if (prototype === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '快照模板没有步骤');
  const nodes: PlanNode[] = []; const edges: PlanGraph['edges'][number][] = [];
  const batches = Math.ceil(active.length / snapshot.batchSize);
  for (let index = 0; index < batches; index++) {
    const ids = active.slice(index * snapshot.batchSize, (index + 1) * snapshot.batchSize).map((unit) => unit.id);
    const analyzeId = `snapshot.analyze.${index}`; const verifyId = `snapshot.verify.${index}`;
    for (const [id, stage, label, column] of [[analyzeId, 'analysis', '分析', 0], [verifyId, 'verification', '独立复核', 1]] as const) nodes.push({ ...prototype, id, key: id, title: `${label}批次 ${index + 1}`, summary: `${snapshot.depth === 'lightweight' && stage === 'verification' ? '仅独立复核上游发现候选问题的单元；无候选时不调用模型' : '逐项处理冻结源码单元'}；目标 ${snapshot.targetSha}`, groupId: `snapshot.${stage}`, roleId: template.steps[stage === 'analysis' ? 0 : 1]?.roleId ?? 'role.reviewer', roleSnapshot: undefined, snapshotStage: stage, snapshotUnitIds: ids, acceptance: [], resources: { read: ids.map((unitId) => ({ id: unitId, kind: 'file', label: snapshot.units.find((unit) => unit.id === unitId)!.path, basis: 'declared' })), write: [] }, position: { x: 80 + column * 320, y: 80 + index * 140 }, templateRevision: `${template.id}@${template.version}` });
    edges.push({ id: `snapshot.edge.${index}`, from: analyzeId, to: verifyId, kind: 'data' });
  }
  const report: PlanNode = { ...prototype, id: 'snapshot.report', key: 'snapshot.report', title: '汇总并校验快照报告', kind: 'delivery', summary: '只汇总已提交且通过来源版本校验的单元证据；不把未完成范围宣称已审查', groupId: 'snapshot.report', roleId: 'role.reviewer', roleSnapshot: undefined, snapshotStage: 'report', snapshotUnitIds: [], acceptance: [], resources: { read: [], write: [] }, position: { x: 720, y: 80 } };
  nodes.push(report);
  for (const node of nodes.filter((item) => item.snapshotStage === 'verification')) edges.push({ id: `snapshot.report.${node.id}`, from: node.id, to: report.id, kind: 'data' });
  return { nodes, edges, groups };
}

/** A claimed file must exactly match a frozen source blob and the dispatched unit set. */
export function validateSnapshotUnitEvidence(snapshot: CodeReviewSnapshot, node: PlanNode, payload: Record<string, unknown> | undefined, expectedIds = node.snapshotUnitIds ?? [], upstream?: ReadonlyMap<string, SnapshotUnitEvidence>): readonly SnapshotUnitEvidence[] {
  const input = payload?.snapshotUnits;
  if (!Array.isArray(input)) throw new AppError(ErrorCode.VALIDATION_FAILED, '快照结果必须提交 payload.snapshotUnits 文件证据');
  const seen = new Set<string>();
  for (const raw of input) {
    if (raw === null || typeof raw !== 'object') throw new AppError(ErrorCode.VALIDATION_FAILED, '分析单元证据格式无效');
    const item = raw as Record<string, unknown>;
    const unit = snapshot.units.find((unit) => unit.id === item.unitId);
    if (unit === undefined || !expectedIds.includes(unit.id) || unit.excludedReason !== undefined || item.blobSha !== unit.blobSha || seen.has(unit.id)) throw new AppError(ErrorCode.VALIDATION_FAILED, '分析单元不属于此步骤、源码版本不符或重复提交');
    if (typeof item.summary !== 'string' || item.summary.trim() === '' || !Array.isArray(item.findings)) throw new AppError(ErrorCode.VALIDATION_FAILED, '每个单元必须有摘要与问题清单');
    const findings = item.findings;
    const findingIds = new Set<string>();
    for (const finding of item.findings) {
      if (finding === null || typeof finding !== 'object') throw new AppError(ErrorCode.VALIDATION_FAILED, '候选问题格式无效');
      if (findingIds.has(finding.id)) throw new AppError(ErrorCode.VALIDATION_FAILED, '问题id不能重复');
      findingIds.add(finding.id);
      if (finding === null || typeof finding !== 'object' || typeof finding.id !== 'string' || typeof finding.title !== 'string' || typeof finding.detail !== 'string' || !Number.isInteger(finding.line) || finding.line < 1 || !['high', 'medium', 'low'].includes(finding.severity)) throw new AppError(ErrorCode.VALIDATION_FAILED, '候选问题必须有id、说明、源码行与严重度');
      if (node.snapshotStage === 'verification' && (!['confirmed', 'rejected'].includes(finding.verdict) || typeof finding.rationale !== 'string' || finding.rationale.trim() === '')) throw new AppError(ErrorCode.VALIDATION_FAILED, '独立复核必须给出确认/排除结论与依据');
    }
    if (node.snapshotStage === 'verification') {
      const candidates = upstream?.get(unit.id)?.findings ?? [];
      if (findings.length !== candidates.length || candidates.some((candidate) => !findings.some((finding: Record<string, unknown>) => finding.id === candidate.id && finding.line === candidate.line && finding.title === candidate.title && finding.detail === candidate.detail && finding.severity === candidate.severity))) throw new AppError(ErrorCode.VALIDATION_FAILED, '独立复核必须逐项保留原候选的问题身份与来源，只补充结论和依据');
    }
    seen.add(unit.id);
  }
  if (seen.size !== expectedIds.length) throw new AppError(ErrorCode.VALIDATION_FAILED, '必须明确提交此步骤全部分析单元；未处理单元不能声称完成');
  return input as readonly SnapshotUnitEvidence[];
}

export interface SnapshotEvidenceState {
  readonly analyzed: ReadonlyMap<string, SnapshotUnitEvidence>;
  readonly verified: ReadonlyMap<string, SnapshotUnitEvidence>;
}
export function snapshotEvidenceState(store: import('@agent-workflow/storage').Store, taskId: string): SnapshotEvidenceState {
  const task = store.tasks.get(taskId); const execution = task?.executionId === undefined ? undefined : store.executions.get(task.executionId);
  const plan = execution === undefined ? undefined : store.plans.get(execution.planRevisionId);
  const analyzed = new Map<string, SnapshotUnitEvidence>(); const verified = new Map<string, SnapshotUnitEvidence>();
  if (execution === undefined || plan === undefined) return { analyzed, verified };
  for (const node of plan.graph.nodes) {
    if (node.snapshotStage !== 'analysis' && node.snapshotStage !== 'verification') continue;
    const state = execution.nodes.find((item) => item.nodeId === node.id);
    if (state?.status !== 'succeeded') continue;
    const attempt = state.currentAttemptId === undefined ? undefined : store.executions.getAttempt(state.currentAttemptId);
    if (attempt?.status !== 'succeeded') continue;
    const units = attempt?.result?.payload?.snapshotUnits;
    if (!Array.isArray(units)) continue;
    for (const unit of units as SnapshotUnitEvidence[]) (node.snapshotStage === 'analysis' ? analyzed : verified).set(unit.unitId, unit);
  }
  return { analyzed, verified };
}
export function snapshotExpectedUnitIds(snapshot: CodeReviewSnapshot, node: PlanNode, evidence: SnapshotEvidenceState): string[] {
  const ids = [...(node.snapshotUnitIds ?? [])];
  return node.snapshotStage === 'verification' && snapshot.depth === 'lightweight' ? ids.filter((id) => (evidence.analyzed.get(id)?.findings.length ?? 0) > 0) : ids;
}
export function snapshotReport(store: import('@agent-workflow/storage').Store, taskId: string) {
  const task = store.tasks.get(taskId); const snapshot = task?.fixedTemplate?.snapshot;
  if (snapshot === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '此任务没有快照代码评审来源');
  const evidence = snapshotEvidenceState(store, taskId);
  const excluded = snapshot.units.filter((unit) => unit.excludedReason !== undefined);
  const active = snapshot.units.filter((unit) => unit.excludedReason === undefined);
  const analyzed = active.filter((unit) => evidence.analyzed.has(unit.id));
  const pending = active.filter((unit) => !evidence.analyzed.has(unit.id));
  const confirmed = [...evidence.verified.entries()].flatMap(([id, value]) => value.findings.filter((finding) => finding.verdict === 'confirmed').map((finding) => ({ unit: snapshot.units.find((unit) => unit.id === id)!, finding })));
  const unverified = analyzed.filter((unit) => (snapshot.depth === 'full' || (evidence.analyzed.get(unit.id)?.findings.length ?? 0) > 0) && !evidence.verified.has(unit.id));
  const readAt = nowIso();
  const text = [`# 快照代码评审阶段报告`, ``, `目标：${snapshot.targetSha}`, ...(snapshot.baselineSha === undefined ? [] : [`基线：${snapshot.baselineSha}`]), `方式：${snapshot.mode}；深度：${snapshot.depth}；源码固定于 ${snapshot.frozenAt}`, `读取于 ${readAt}。这是阶段证据，未完成范围不代表无问题；读取不会启动或改变执行。`, ``, `## 已分析范围（${analyzed.length} 个文件单元）`, ...analyzed.map((unit) => `- \`${unit.path}\` @ ${unit.blobSha}：${evidence.analyzed.get(unit.id)!.summary}`), ...(analyzed.length === 0 ? ['尚无已提交的源码分析证据。'] : []), ``, `## 已确认问题（${confirmed.length}）`, ...confirmed.map(({ unit, finding }) => `- [${finding.severity}] ${finding.title} — \`${unit.path}:${finding.line}\`\n  ${finding.detail}\n  独立复核依据：${finding.rationale}`), ...(confirmed.length === 0 ? ['尚无经过独立复核确认的问题；这不代表未完成范围没有问题。'] : []), ``, `## 未完成范围（未分析 ${pending.length}；待独立复核 ${unverified.length}）`, ...pending.map((unit) => `- 未分析：\`${unit.path}\` @ ${unit.blobSha}`), ...unverified.map((unit) => `- 已分析但未独立复核：\`${unit.path}\``), ``, `## 排除（${excluded.length}）`, ...excluded.map((unit) => `- \`${unit.path}\`：${unit.excludedReason}`)].join('\n');
  return { available: true, reportId: createHash('sha256').update(text).digest('hex'), readAt, analyzedUnits: analyzed.length, pendingUnits: pending.length, excludedUnits: excluded.length, contentMarkdown: text, download: { available: true, reason: '已读取当前阶段报告，可下载本次读取版本' }, reason: '', note: '读取和下载都不会启动或改变执行。', unverifiedUnits: unverified.length };
}
