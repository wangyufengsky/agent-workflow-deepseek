import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { AppError, ErrorCode, createId, type ControlledTestRun, type ControlledTestCase } from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';
import { captureArtifacts, captureServiceArtifact, readArtifactBytes } from '../../engine/src/artifacts.ts';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const invalid = (message: string): never => { throw new AppError(ErrorCode.VALIDATION_FAILED, message); };
export interface TestReportRequest { readonly format: 'junit'; readonly path?: string }
export function controlledReportPath(root: string, path: string): string {
  if (!path || isAbsolute(path) || path.includes('\\') || path.split('/').some((part) => ['..', '.git', '.env'].includes(part))) invalid('测试报告必须是工作区内相对路径');
  const base = realpathSync(root); const absolute = resolve(base, path); const rel = relative(base, absolute);
  if (!rel || rel.startsWith(`..${sep}`) || isAbsolute(rel)) invalid('测试报告越出工作区');
  let current = base; for (const part of rel.split(sep)) { current = join(current, part); try { if (lstatSync(current).isSymbolicLink()) invalid('测试报告路径不能经过符号链接'); } catch (error) { if (error instanceof AppError) throw error; } }
  return absolute;
}
export function reportFingerprint(root: string, report?: TestReportRequest): string | undefined {
  if (report?.path === undefined) return undefined;
  const file = controlledReportPath(root, report.path);
  try { const stat = statSync(file); return `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`; } catch { return undefined; }
}
/** JUnit is parsed from actual child-process output; suite counters are never trusted. */
export function parseJUnit(xml: string, root: string, candidatePaths: readonly string[] = []): readonly ControlledTestCase[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) invalid('JUnit报告不允许DTD或实体声明');
  if (Buffer.byteLength(xml) > 512 * 1024) invalid('JUnit报告超过512KiB');
  const failures: string[] = [];
  const document = new DOMParser({ errorHandler: { warning: (message) => failures.push(message), error: (message) => failures.push(message), fatalError: (message) => failures.push(message) } }).parseFromString(xml, 'application/xml');
  if (failures.length || !['testsuites', 'testsuite'].includes(document.documentElement?.tagName ?? '')) invalid('无法完整解析JUnit测试报告');
  const cases = Array.from(document.getElementsByTagName('testcase'));
  if (cases.length === 0 || cases.length > 2000) invalid('JUnit报告须包含1至2000个真实testcase');
  return cases.map((item) => {
    if (item.getElementsByTagName('testcase').length) invalid('JUnit testcase嵌套不受支持，不能推算计数');
    const failure = item.getElementsByTagName('failure')[0] ?? item.getElementsByTagName('error')[0];
    const status = failure || item.hasAttribute('failure') ? 'failed' as const : item.getElementsByTagName('skipped').length ? 'skipped' as const : 'passed' as const;
    const className = item.getAttribute('classname') || '';
    const candidates = candidatePaths.filter((path) => { const normalized = className.split('$')[0]!.replaceAll('\\', '/'); const dotted = path.replace(/\.[^.]+$/, '').replaceAll('/', '.'); return normalized === path || normalized === dotted || normalized.startsWith(`${dotted}.`) || ['java', 'kt'].some((ext) => path.endsWith(`${normalized.replaceAll('.', '/')}.${ext}`)); });
    const reported = item.getAttribute('file'); const raw = reported || (candidates.length === 1 ? candidates[0] : undefined); let file: string | undefined;
    if (raw) {
      const base = realpathSync(root); const absolute = isAbsolute(raw) ? raw : resolve(base, raw);
      let rel = relative(base, absolute);
      if ((rel.startsWith(`..${sep}`) || isAbsolute(rel)) && isAbsolute(raw)) { const aliasRelative = relative(resolve(root), absolute); if (aliasRelative && !aliasRelative.startsWith(`..${sep}`) && !isAbsolute(aliasRelative)) rel = aliasRelative; }
      if (!rel || rel.startsWith(`..${sep}`) || isAbsolute(rel)) invalid('测试用例引用了工作区外文件');
      file = rel.split(sep).join('/'); controlledReportPath(root, file);
    }
    const line = Number(item.getAttribute('line'));
    return { className, ...(file ? { fileMapping: reported ? 'reported' as const : 'classname' as const } : { fileReason: '报告未提供文件路径，类名也无法唯一绑定到当前已提交测试产物' }), name: `${item.getAttribute('classname') ? `${item.getAttribute('classname')}.` : ''}${item.getAttribute('name') || '(未命名测试)'}`, status, ...(file ? { file } : {}), ...(Number.isSafeInteger(line) && line > 0 ? { line } : {}), ...(failure ? { message: (failure.getAttribute('message') || failure.textContent || '测试失败').slice(0, 8000) } : {}) };
  });
}
export function retainControlledTestRun(input: { readonly store: Store; readonly taskId: string; readonly executionId: string; readonly nodeId: string; readonly attemptId: string; readonly root: string; readonly startedAt: string; readonly argv?: readonly string[]; readonly before?: string; readonly candidatePaths?: readonly string[]; readonly report?: TestReportRequest; readonly result: { readonly command: string; readonly exitCode: number; readonly stdout: string; readonly stderr: string; readonly timedOut: boolean }; readonly allowed: (path: string) => boolean }): ControlledTestRun {
  const { store, result } = input;
  let cases: readonly ControlledTestCase[] = []; let report: ControlledTestRun['report']; let reason: string | undefined;
  try {
    if (result.timedOut) invalid('测试命令超时，不能把部分输出当完整报告');
    let xml = result.stdout;
    if (input.report?.path) {
      if (!input.allowed(input.report.path)) invalid('职业未授权读取测试报告');
      const fingerprint = reportFingerprint(input.root, input.report);
      if (!fingerprint || fingerprint === input.before) invalid('报告未由本次命令新建或更新，拒绝旧测试报告');
      const absolute = controlledReportPath(input.root, input.report.path); const stat = statSync(absolute);
      if (!stat.isFile() || stat.size > 512 * 1024 || stat.mtimeMs < Date.parse(input.startedAt) - 1) invalid('测试报告身份或更新时间不属于本次命令');
      report = captureArtifacts(store.dataDir, input.root, input.attemptId, [{ path: input.report.path }], input.allowed)[0]!;
      xml = readArtifactBytes(store.dataDir, report).toString('utf8');
      if (fingerprint !== reportFingerprint(input.root, input.report)) invalid('测试报告正在变化，不能保留');
    } else if (Buffer.byteLength(xml) >= 64 * 1024) invalid('命令输出达到上限，不能把节选解析为完整测试报告');
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) invalid('JUnit报告不允许DTD或实体声明');
    const start = xml.indexOf('<?xml') >= 0 ? xml.indexOf('<?xml') : xml.indexOf('<testsuite');
    if (start < 0) invalid('命令未提供受支持的JUnit报告；请配置JUnit输出或报告文件');
    cases = parseJUnit(xml.slice(start), input.root, input.candidatePaths);
    const paths = [...new Set(cases.flatMap((item) => item.file ? [item.file] : []))];
    if (paths.length > 24) invalid('测试报告关联文件超过24个，请拆分批次');
    const artifacts = paths.map((path) => captureArtifacts(store.dataDir, input.root, input.attemptId, [{ path }], input.allowed)[0]!);
    cases = cases.map((item) => ({ ...item, ...(item.file ? { artifact: artifacts.find((artifact) => artifact.path === item.file) } : {}) }));
    report ??= captureServiceArtifact(store.dataDir, input.attemptId, 'controlled-test-report.xml', Buffer.from(xml.slice(start)), 'text/xml');
  } catch (error) { reason = error instanceof Error ? error.message : '测试报告读取失败'; cases = []; }
  const failed = cases.filter((item) => item.status === 'failed').length; const passed = cases.filter((item) => item.status === 'passed').length; const skipped = cases.filter((item) => item.status === 'skipped').length;
  if (!reason && result.exitCode !== 0 && failed === 0) reason = '命令非零退出但报告未记录失败用例，结果无法核实';
  const task = store.tasks.get(input.taskId); const workspace = task?.workspaceId ? store.workspaces.get(task.workspaceId) : undefined;
  if (!reason && passed + failed === 0 && skipped > 0) reason = '所有测试均跳过，未形成实际执行通过证据';
  const record: ControlledTestRun = { workspaceId: workspace?.id, workspaceRevision: workspace?.revision, id: createId('trun'), taskId: input.taskId, executionId: input.executionId, nodeId: input.nodeId, attemptId: input.attemptId, argv: input.argv ?? [result.command], command: result.command, commandSha256: hash(JSON.stringify(input.argv ?? [result.command])), startedAt: input.startedAt, endedAt: new Date().toISOString(), exitCode: result.exitCode, timedOut: result.timedOut, format: 'junit', state: reason ? 'unknown' : failed || result.exitCode !== 0 ? 'failed' : 'passed', ...(reason ? { reason } : {}), ...(cases.length ? { passed, failed, skipped } : {}), cases, ...(report ? { report } : {}) };
  store.settings.putJson(`execution.test-run.${record.id}`, record); store.settings.putJson(`execution.test-run.latest.${record.attemptId}`, record.id); return record;
}
