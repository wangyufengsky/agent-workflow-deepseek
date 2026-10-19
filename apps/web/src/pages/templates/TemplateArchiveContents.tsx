import { Link } from 'react-router-dom';
import type { TemplateArchiveCorpus } from '@agent-workflow/shared';
import { Icon } from '../../components/Icon.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
export interface ArchiveVerification {
    readonly checkedAt: string;
    readonly found: boolean;
    readonly taskId?: string;
    readonly title?: string;
    readonly stage?: string;
    readonly lifecycle?: string;
    readonly reason?: string;
}
type Data = TemplateArchiveCorpus;
export function ArchiveOverview({ data }: {
    readonly data: Data;
}) { return (<><div className="grid-3">{[[data.templates.length, '历史模板'], [data.rules.length, '旧规则'], [data.runs.length, '运行记录']].map(([count, label]) => <div className="card pad" key={label}><b className="num">{count}</b><p>{label}</p></div>)}</div><p className="hint">服务器时间 {data.serverTime}</p>{!data.templates.length && !data.rules.length && !data.runs.length ? <EmptyState icon="archive" title="档案里没有记录" description="这个工作区没有留下旧模板合同、自动化规则或运行记录。当前模板任务不受影响。"/> : null}</>); }
export function ArchiveTemplates({ data, download }: {
    readonly data: Data;
    readonly download: (value: unknown, name: string) => void;
}) { return (data.templates.length ? data.templates.map((template) => <article className="card pad" key={template.id}><h3>{template.name} <span className="badge outline">{template.archived ? '已归档' : '历史有效'}</span></h3>{template.versions.map((version) => <details key={version.version}><summary>版本 {version.version} · 不可变 · {version.frozenAt}</summary><p className="mono" style={{ overflowWrap: 'anywhere' }}>SHA-256 {version.sha256}</p><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(version.contract, null, 2)}</pre></details>)}<p className="hint">历史版本只读，不能用于启动。导出最新原合同，而非当前展开版本。</p><button className="btn secondary sm" onClick={() => download(template.versions.at(-1)?.contract, `${template.id}-latest.json`)}>导出最新原合同</button></article>) : <EmptyState icon="template" title="没有历史模板" description="这个工作区没有保存过冻结合同。"/>); }
export function ArchiveRules({ data, onRun }: {
    readonly data: Data;
    readonly onRun: (id: string) => void;
}) { return (data.rules.length ? data.rules.map((rule) => <article key={rule.id} className="card pad"><h3>{rule.name}</h3><p className="hint">{rule.trigger} · 项目 {rule.projectId ?? '未绑定'} · 模板 {rule.templateRef ?? '未绑定'} · 修订 {rule.revision ?? '未知'}</p><p><Icon name={rule.health?.status === 'failed' ? 'alert' : 'clock'}/>{rule.health ? `${rule.health.status} · ${rule.health.checkedAt}` : '未检查，没有留下检测记录'}</p>{rule.health?.error ? <p role="alert">{rule.health.error}</p> : null}<details><summary>触发配置 · 只读</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(rule.config, null, 2)}</pre></details>{data.runs.filter((run) => run.ruleId === rule.id).map((run) => <button className="btn ghost sm" key={run.id} onClick={() => { onRun(run.id); }}>{run.id} · {run.status}</button>)}</article>) : <EmptyState icon="shield" title="没有旧规则" description="没有留下自动化规则或检测记录。"/>); }
export function ArchiveRuns({ data, runId, onRun, verified, verify }: {
    readonly data: Data;
    readonly runId?: string;
    readonly onRun: (id: string) => void;
    readonly verified?: ArchiveVerification;
    readonly verify: () => Promise<void>;
}) { const selectedRun = data.runs.find((run) => run.id === runId); return (<>{data.runs.length ? data.runs.map((run) => <button key={run.id} className="list-row" onClick={() => { onRun(run.id); }}><span className="mono">{run.id}</span><span className="badge outline"><Icon name="clock" size="sm"/>{run.status}</span><span className="hint">{run.triggeredAt} · 任务 {run.taskId ?? '未绑定'}</span></button>) : <EmptyState icon="clock" title="没有运行记录" description="旧规则没有留下运行记录。"/>}{selectedRun ? <article className="card pad" aria-label="历史运行详情"><h3>{selectedRun.id}</h3><dl className="kv"><dt>草稿</dt><dd>{selectedRun.draftId ?? '未绑定'}</dd><dt>开始</dt><dd>{selectedRun.startedAt ?? '未开始'}</dd><dt>结束</dt><dd>{selectedRun.endedAt ?? '未结束'}</dd></dl>{selectedRun.error ? <p role="alert">{selectedRun.error}</p> : null}<pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(selectedRun.evidence, null, 2)}</pre><button className="btn secondary sm" onClick={() => { void verify(); }}>核对原任务</button>{verified ? <p>{verified.checkedAt} · {verified.found ? <Link to={`/tasks/${verified.taskId}`}>{verified.title} · {verified.stage} · {verified.lifecycle}</Link> : verified.reason}</p> : null}</article> : null}</>); }
export function ArchiveExport({ exportArchive }: {
    readonly exportArchive: () => Promise<void>;
}) { return (<><div className="banner warn"><Icon name="alert"/><span>这不是完整备份。旧格式 v1 包含历史模板版本和部分旧规则配置，不含运行记录、检测信息或 Webhook 密钥。</span></div><p className="hint">导出只下载文件，不会导入、启动或修改任何内容。</p><button className="btn primary" onClick={() => { void exportArchive(); }}>导出旧格式 v1</button></>); }
