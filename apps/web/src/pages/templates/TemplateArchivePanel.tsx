import { ArchiveOverview, ArchiveTemplates, ArchiveRules, ArchiveRuns, ArchiveExport, type ArchiveVerification } from './TemplateArchiveContents.tsx';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ROUTES, type TemplateArchiveCorpus } from '@agent-workflow/shared';
import { apiGet, errorMessage } from '../../api/client.ts';
import { Drawer } from '../../components/Drawer.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { Skeleton } from '../../components/EmptyState.tsx';
const tabs = ['归档概览', '历史模板', '旧规则与检测记录', '运行记录', '导出说明'] as const;
function download(value: unknown, name: string) { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url); }
export function TemplateArchivePanel() {
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState<number>(0);
    const [runId, setRun] = useState<string>();
    const [message, setMessage] = useState('');
    const [verified, setVerified] = useState<ArchiveVerification>();
    const query = useQuery({ queryKey: ['template-archive'], queryFn: async () => (await apiGet<TemplateArchiveCorpus>(ROUTES.templateArchive)).data, enabled: open, retry: false });
    const data = query.data;
    const selectRun = (id: string) => { setRun(id); setTab(3); setVerified(undefined); setMessage(''); };
    const exportArchive = async () => { try {
        const result = await apiGet(ROUTES.templateArchiveExport);
        download(result.data, 'automation-archive-v1.json');
        setMessage('档案已下载');
    }
    catch (error) {
        setMessage(errorMessage(error));
    } };
    const verify = async () => { if (!runId)
        return; setMessage('正在核对原任务…'); try {
        setVerified((await apiGet<NonNullable<typeof verified>>(ROUTES.templateArchiveRun(runId))).data);
        setMessage('核对完成，仅查询原任务，没有重新运行');
    }
    catch (error) {
        setMessage(errorMessage(error));
    } };
    return <><button className="btn ghost" onClick={() => setOpen(true)}><Icon name="archive"/>历史自动化档案</button><Drawer open={open} title="历史模板与自动化档案" size="xl" onClose={() => setOpen(false)}>
    <div className="banner"><Icon name="lock"/><span>只读档案。原自动化写入接口已退役，不会启动、审批、导入或生成密钥。</span></div>
    <div className="tabs" role="tablist" aria-label="历史归档分类">{tabs.map((label, index) => <button id={`archive-tab-${index}`} type="button" className="tab" role="tab" key={label} aria-selected={tab === index} tabIndex={tab === index ? 0 : -1} aria-controls="archive-content" onClick={() => setTab(index)} onKeyDown={(event) => { let next: number | undefined; if (event.key === 'ArrowRight')
        next = (index + 1) % tabs.length; if (event.key === 'ArrowLeft')
        next = (index + tabs.length - 1) % tabs.length; if (event.key === 'Home')
        next = 0; if (event.key === 'End')
        next = tabs.length - 1; if (next !== undefined) {
        event.preventDefault();
        document.getElementById(`archive-tab-${next}`)?.focus();
    } }}>{label}</button>)}</div>
    <section id="archive-content" role="tabpanel" aria-labelledby={`archive-tab-${tab}`}>
      {query.isLoading ? <Skeleton height={180}/> : query.isError ? <ServiceNotice error={query.error} onRetry={() => { void query.refetch(); }}/> : data ? <>
        {tab === 0 ? <ArchiveOverview data={data}/> : null}
        {tab === 1 ? <ArchiveTemplates data={data} download={download}/> : null}
        {tab === 2 ? <ArchiveRules data={data} onRun={selectRun}/> : null}
        {tab === 3 ? <ArchiveRuns data={data} runId={runId} onRun={selectRun} verified={verified} verify={verify}/> : null}
        {tab === 4 ? <ArchiveExport exportArchive={exportArchive}/> : null}
      </> : null}
    </section>{message ? <p role="status" className="hint">{message}</p> : null}
  </Drawer></>;
}
