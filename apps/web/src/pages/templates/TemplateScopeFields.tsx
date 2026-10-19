import { useQuery } from '@tanstack/react-query';
import { ROUTES, type CreateTaskRequest, type GitBranchesResponse, type TaskTemplate, type ProjectSummary } from '@agent-workflow/shared';
import { apiGet, errorMessage } from '../../api/client.ts';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { useState } from 'react';
import { DirectoryPicker } from '../../components/DirectoryPicker.tsx';
import { Icon } from '../../components/Icon.tsx';
export type ScopeInput = NonNullable<NonNullable<CreateTaskRequest['template']>['scope']>;
export function TemplateScopeFields({ project, template, value, onChange, disabled }: {
    readonly project?: ProjectSummary;
    readonly template: TaskTemplate;
    readonly value: ScopeInput;
    readonly onChange: (value: ScopeInput) => void;
    readonly disabled: boolean;
}) {
    const [error, setError] = useState('');
    const [pickerOpen, setPickerOpen] = useState(false);
    const selectSource = (selected: string) => {
        if (!project)
            return;
        void apiGet<{
            path: string;
        }>(ROUTES.projectSourcePath(project.id, selected)).then((response) => { onChange({ ...value, sourcePaths: [response.data.path] }); setError(''); }).catch((error) => setError(errorMessage(error)));
    };
    const pickSource = () => {
        if (!window.workflowDesktop) {
            setPickerOpen(true);
            return;
        }
        void window.workflowDesktop.pickDirectory().then((path) => {
            if (path)
                selectSource(path);
        }).catch(() => setPickerOpen(true));
    };
    const setRange = (preset: 'week' | 'month' | 'custom' | 'full') => {
        const to = new Date();
        const from = new Date(to);
        if (preset === 'week')
            from.setDate(to.getDate() - 6);
        else if (preset === 'month')
            from.setDate(1);
        const day = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        onChange({ ...value, dateRange: { preset, ...(preset === 'full' ? {} : { from: day(from), to: day(to) }) } });
    };
    const upload = async (files: FileList | null) => {
        try {
            const docs = [...(value.documents ?? [])];
            for (const file of Array.from(files ?? [])) {
                if (!/\.(md|docx|pdf)$/i.test(file.name) || file.size > 180000 || docs.length >= 4)
                    throw new Error('支持最多4份 md/docx/pdf，每份不超过180KB');
                const bytes = new Uint8Array(await file.arrayBuffer());
                let binary = '';
                for (const byte of bytes)
                    binary += String.fromCharCode(byte);
                docs.push({ name: file.name, base64: btoa(binary) });
            }
            onChange({ ...value, documents: docs });
            setError('');
        }
        catch (error) {
            setError(errorMessage(error));
        }
    };
    return <section aria-label="模板输入范围" className="col" style={{ gap: 16 }}>

    {template.inputs?.dates ? <div><h3>时间范围</h3><div className="seg" role="group" aria-label="时间范围">{([['week', '最近 7 天'], ['month', '本月'], ['custom', '自定义'], ...(template.inputs.fullHistory ? [['full', '全部历史']] : [])] as const).map(([key, label]) => <button type="button" key={key} disabled={disabled} aria-pressed={value.dateRange?.preset === key} onClick={() => setRange(key as 'week' | 'month' | 'custom' | 'full')}>{label}</button>)}</div>{value.dateRange?.preset !== 'full' && value.dateRange ? <div className="grid-2"><label>开始日期<input className="input" type="date" disabled={disabled} value={value.dateRange.from ?? ''} onChange={(event) => onChange({ ...value, dateRange: { ...value.dateRange!, from: event.target.value } })}/></label><label>结束日期<input className="input" type="date" disabled={disabled} value={value.dateRange.to ?? ''} onChange={(event) => onChange({ ...value, dateRange: { ...value.dateRange!, to: event.target.value } })}/></label></div> : null}<p className="hint">按本机时区的提交时间筛选，包含结束日期当天；创建时固定对应提交证据。</p></div> : null}
    {template.inputs?.source ? <div className="field"><label htmlFor="template-source-scope">源码范围</label><div className="row"><input id="template-source-scope" className="input mono" placeholder="src/main（多个路径用逗号分隔）" disabled={disabled} value={(value.sourcePaths ?? []).join(',')} onChange={(event) => onChange({ ...value, sourcePaths: event.target.value.split(',').map((p) => p.trim()).filter(Boolean) })}/><button className="btn secondary" type="button" disabled={disabled || !project} title={disabled ? '原请求未结束，不能修改范围' : !project ? '请先选择项目' : undefined} onClick={pickSource}><Icon name="folder"/>选择</button></div><span className="hint">相对项目目录。源码分析工具只读取这些路径的冻结版本；这不是新增文件系统权限。</span><DirectoryPicker title="选择源码目录" selectionVerb="将作为源码范围" open={pickerOpen} initialPath={project?.rootPath} onClose={() => setPickerOpen(false)} onSelect={selectSource}/></div> : null}
    {template.inputs?.documents ? <div><h3>需求文档</h3>{value.documents?.map((doc, index) => <div className="list-row" key={index}><span className="grow"><Icon name="clock" size="sm"/>{doc.name} · 待服务校验</span><button className="btn ghost sm" type="button" disabled={disabled} onClick={() => onChange({ ...value, documents: value.documents?.filter((_, i) => i !== index) })}>移除</button></div>)}<div className="card pad" style={{ borderStyle: 'dashed', textAlign: 'center' }} onDragOver={(event) => { event.preventDefault(); }} onDrop={(event) => {
                event.preventDefault();
                if (!disabled)
                    void upload(event.dataTransfer.files);
            }}><Icon name="upload"/><p>拖入文档，或 <label className="btn ghost sm" htmlFor="template-scope-documents" role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} onKeyDown={(event) => {
                if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    document.getElementById('template-scope-documents')?.click();
                }
            }}>选择文件</label></p><input id="template-scope-documents" style={{ display: 'none' }} type="file" multiple accept=".md,.docx,.pdf" disabled={disabled} onChange={(event) => { void upload(event.target.files); event.target.value = ''; }}/></div><p className="hint">支持 .md .docx .pdf，按顺序保留。扫描PDF需先提供可提取正文；创建前服务验证内容并固定哈希。</p></div> : null}
    {template.inputs?.output ? <details><summary>输出位置（可选）</summary><label className="field">工作区内相对目录<input className="input mono" disabled={disabled} placeholder={project?.settings.docPaths?.[0] ?? '使用项目文档产出设置'} value={value.outputDirectory ?? ''} onChange={(event) => onChange({ ...value, outputDirectory: event.target.value || undefined })}/><span className="hint">留空使用项目文档目录；填写后仅用于本任务产出，不授予额外文件权限。</span></label></details> : null}
    {error ? <p className="banner danger" role="alert"><Icon name="alert"/>{error}</p> : null}
  </section>;
}
export function TemplateBranchField({ projectId, value, onChange, disabled }: {
    readonly projectId: string;
    readonly value: ScopeInput;
    readonly onChange: (scope: ScopeInput) => void;
    readonly disabled: boolean;
}) {
    const branches = useQuery({ queryKey: ['template-branches', projectId], queryFn: async () => (await apiGet<GitBranchesResponse>(ROUTES.gitBranches(projectId))).data.branches, enabled: !!projectId, retry: false });
    return <div>
    <label className="field">分支<select className="select mono" disabled={disabled || branches.isLoading || branches.isError} value={value.branch ?? ''} onChange={(event) => onChange({ ...value, branch: event.target.value })}><option value="">选择分支</option>{branches.data?.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}</option>)}</select></label>
    {branches.isError ? <ServiceNotice error={branches.error} onRetry={() => { void branches.refetch(); }}/> : null}
    </div>;
}
