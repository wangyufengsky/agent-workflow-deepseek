import { Link } from 'react-router-dom';
import type { QualityEvidenceState, TaskQualityEvidence, TaskQualityCheck } from '@agent-workflow/shared';
import { Badge } from '../../components/Badge.tsx';
const names = { program: '程序验收', requirement: '需求评审', risk: '风险评审', human: '人工认定', code_review: '通用代码审查' } as const;
const states: Record<QualityEvidenceState, string> = { not_configured: '未配置', not_required: '未要求', not_reviewed: '未评审', in_progress: '进行中', passed: '通过', failed: '失败', unknown: '未知' };
function Check({ check }: { readonly check: TaskQualityCheck }) {
  return <div style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
    <div className="row wrap" style={{ gap: 8 }}><b className="grow">{names[check.kind]}</b><Badge icon={check.state === 'passed' ? 'check' : check.state === 'failed' ? 'x' : check.state === 'in_progress' ? 'clock' : 'help'} tone={check.state === 'passed' ? 'ok' : check.state === 'failed' ? 'danger' : check.state === 'unknown' ? 'unknown' : 'idle'}>{check.state === 'not_reviewed' && check.kind === 'human' ? '未认定' : check.state === 'not_reviewed' && check.kind === 'program' ? '尚未运行' : states[check.state]}</Badge></div>
    {check.passed === undefined ? null : <p className="hint num">已记录：通过 {check.passed} · 失败 {check.failed ?? 0} · 跳过 {check.skipped ?? 0}</p>}
    <p className="hint" style={{ marginTop: 4 }}>{check.reason}</p>
    {check.sources.map(source => <div key={`${source.kind}:${source.id}`} className="hint" style={{ marginTop: 4 }}>{source.href.startsWith('/api/') ? <a href={source.href} target="_blank" rel="noreferrer">{source.label}</a> : <Link to={source.href}>{source.label}</Link>} <span className="mono" style={{ overflowWrap: 'anywhere' }}>{source.id}</span></div>)}
  </div>;
}
export function QualityEvidence({ evidence }: { readonly evidence?: TaskQualityEvidence }) {
  if (!evidence) return <p className="hint">尚未读取质量分项；不根据任务完成或节点成功推断验收。</p>;
  return <section aria-label="质量分项依据">{evidence.checks.map(check => <Check key={check.kind} check={check} />)}{evidence.codeReview.state === 'not_configured' ? null : <Check check={evidence.codeReview} />}<p className="hint" style={{ marginTop: 8 }}>只核对当前执行的已配置来源；未配置独立评审不会自动新增步骤或授权。人工认定单独保存，不改写程序或 AI 原结论。</p></section>;
}
