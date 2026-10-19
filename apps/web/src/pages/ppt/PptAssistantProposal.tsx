import type { PptAssistantProposal as Proposal } from '@agent-workflow/shared';
import { Icon } from '../../components/Icon.tsx';
export function PptAssistantProposal({ proposal, currentRevision, blocked, onDecide }: {
    readonly proposal: Proposal;
    readonly currentRevision: number;
    readonly blocked: boolean;
    readonly onDecide: (decision: 'apply' | 'discard') => void;
}) {
    const stale = proposal.baseRevision !== currentRevision;
    return <article className="card pad" aria-label="助手修改建议">
  <b>{proposal.summary}</b><p className="hint">基于修订 {proposal.baseRevision} · {proposal.scope === 'page' ? proposal.pageIndex === -1 ? '仅封面' : `仅第 ${(proposal.pageIndex ?? 0) + 2} 页` : proposal.scope === 'brief' ? '需求讨论' : '整份演示'}。不会自动覆盖人工内容。</p>
  {proposal.patch.pages?.map(page => <section key={page.index}><h4>{page.index === -1 ? '封面' : `第 ${page.index + 2} 页`}</h4><p className="hint"><Icon name="minus" size="sm"/>删除 / 替换前</p><div style={{ textDecoration: 'line-through', whiteSpace: 'pre-wrap' }}>{page.before.title}<br />{page.before.bullets.join('\n')}{page.before.notes ? `\n备注：${page.before.notes}` : ''}</div><p><Icon name="plus" size="sm"/>替换后</p><div style={{ whiteSpace: 'pre-wrap' }}>{page.after.title}<br />{page.after.bullets.join('\n')}{page.after.notes ? `\n备注：${page.after.notes}` : ''}</div></section>)}
  {(['brief', 'outline', 'plan'] as const).map(field => proposal.patch[field] === undefined ? null : <details key={field}><summary>{field === 'brief' ? '需求简报' : field === 'outline' ? '大纲' : '制作方案'} · 查看完整前后差异</summary><div className="hint">原内容</div><pre className="ppt-md">{JSON.stringify(proposal.before[field] ?? null, null, 2)}</pre><div>建议内容</div><pre className="ppt-md">{JSON.stringify(proposal.patch[field], null, 2)}</pre></details>)}
  {proposal.status === 'pending' ? <><p className="hint">只应用列出的字段；未列出的页面、字号、颜色、对齐与图片会保留。</p>{stale ? <div className="banner warn"><Icon name="alert"/>当前已有修订 {currentRevision}。候选保留，请核对手动修改后重新向助手提议，不覆盖新内容。</div> : null}<div className="row"><button className="btn ghost sm" disabled={blocked} onClick={() => onDecide('discard')}>不用了</button><button className="btn primary sm" disabled={blocked || stale} title={stale ? '作品已有新修订，请重新讨论' : blocked ? '原请求未结束' : ''} onClick={() => onDecide('apply')}>应用</button></div></> : <p className="hint"><Icon name={proposal.status === 'applied' ? 'check' : 'minus'} size="sm"/>{proposal.status === 'applied' ? '已应用，原修订保留' : '未采用，候选留在历史'}</p>}
 </article>;
}
