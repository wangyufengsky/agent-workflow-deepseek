import type { QualityReviewContract, QualityReviewReport } from '@agent-workflow/shared';
import { Icon } from '../../components/Icon.tsx';
const verdictLabel = { passed: '通过', failed: '未通过', unknown: '未知' } as const;
export function QualityReviewResult({ report, configured }: { readonly report?: QualityReviewReport; readonly configured?: QualityReviewContract }) {
  if (!report) return configured ? <p className="hint">已配置独立{configured.kind === 'requirement' ? '需求' : '风险'}评审，但本尝试没有完整独立报告；结论未知，通用验证不替代。</p> : null;
  return <section className="box pad" aria-label="独立AI评审报告">
    <div className="row" style={{ gap: 8 }}><Icon name={report.verdict === 'passed' ? 'check' : 'info'} /><strong>独立{report.kind === 'requirement' ? '需求' : '风险'} AI 评审</strong><span>{verdictLabel[report.verdict]}</span></div>
    <p>{report.summary}</p><p className="hint">AI评审结论，非程序证明；人工认定不改写此报告。来源尝试 {report.source.attemptId} · 会话 {report.source.sessionId}</p>
    {report.findings.map(finding => <div className="box pad" key={finding.criterion}>
      <strong>{report.contract.criteria[finding.criterion]}</strong><p>{finding.verdict === 'passed' ? '✓' : finding.verdict === 'failed' ? '×' : '?'} {verdictLabel[finding.verdict]} · {finding.rationale}</p>
      {finding.evidence.map((evidence, index) => <blockquote key={index}><span className="mono">{evidence.path} · {evidence.sha256.slice(0,12)}</span><p>{evidence.quote}</p></blockquote>)}
    </div>)}
  </section>;
}
