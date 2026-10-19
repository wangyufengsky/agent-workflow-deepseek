import './tools-policy.css';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ROUTES, createRequestKey, type ToolPolicyResponse, type ToolPolicyUpdate } from '@agent-workflow/shared';
import { apiGet, request, errorMessage, ApiClientError } from '../../api/client.ts';
import { useProjects } from '../../api/hooks.ts';
import { MANAGED_MCP_TOOLS } from '../../api/catalog.ts';
import { Modal } from '../../components/Modal.tsx';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';

export function ToolsPolicyView() {
  const projects = useProjects();
  const client = useQueryClient();
  const [projectId, setProjectId] = useState('');
  const [pending, setPending] = useState<ToolPolicyUpdate | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [message, setMessage] = useState('');
  const [selectedSource, setSelectedSource] = useState('workflow');
  const [sourceToDisable, setSourceToDisable] = useState<string | null>(null);
  const query = useQuery({ queryKey: ['tool-policy', projectId], queryFn: async () => (await apiGet<ToolPolicyResponse>(`${ROUTES.toolsPolicy}${projectId === '' ? '' : `?projectId=${encodeURIComponent(projectId)}`}`)).data, retry: false });
  const save = async (change: Omit<ToolPolicyUpdate, 'requestKey' | 'projectId'>) => {
    const body = { ...change, requestKey: createRequestKey(), ...(projectId === '' ? {} : { projectId }) };
    setPending(body); setUnknown(false); setMessage('正在保存工具策略…');
    try {
      await request(ROUTES.toolsPolicy, { method: 'PATCH', body });
      await client.invalidateQueries({ queryKey: ['tool-policy'] });
      setPending(null); setMessage('策略已保存；扩权供新会话使用，撤销立即拒绝后续调用。');
    } catch (error) {
      const uncertain = error instanceof ApiClientError && (error.kind === 'unavailable' || error.kind === 'timeout' || error.kind === 'protocol');
      setUnknown(uncertain); setMessage(uncertain ? '保存结果未知，已保留原请求号；请核对原操作。' : errorMessage(error));
      if (!uncertain) setPending(null);
    }
  };
  const reconcile = async () => {
    if (pending === null) return;
    try {
      const result = (await apiGet<{ operation: { status: string; error?: { message?: string } } }>(`/api/operations/${encodeURIComponent(pending.requestKey)}`)).data;
      if (result.operation.status === 'succeeded' || result.operation.status === 'failed') {
        setMessage(result.operation.status === 'succeeded' ? '已核对：保存成功。' : `已核对：保存失败。${result.operation.error?.message ?? ''}`);
        setPending(null); setUnknown(false); await query.refetch();
      } else setMessage('原操作仍在处理中或待核对；不会重新提交。');
    } catch (error) { setMessage(`尚未核对成功：${errorMessage(error)}`); }
  };
  if (query.isLoading) return <p className="hint">正在读取服务端工具清单与有效策略…</p>;
  if (query.isError) return <ServiceNotice error={query.error} onRetry={() => { void query.refetch(); }} />;
  return <div className="col" style={{ gap: 16 }}>
    <div className="row wrap" style={{ gap: 10 }}>
      <label className="label" htmlFor="tool-policy-project">配置范围</label>
      <select id="tool-policy-project" className="select ctl" value={projectId} disabled={pending !== null || sourceToDisable !== null} onChange={(event) => { setProjectId(event.target.value); setMessage(''); }}>
        <option value="">全局默认</option>{(projects.data ?? []).map((project) => <option key={project.id} value={project.id}>项目：{project.name}</option>)}
      </select>
      <span className="hint">项目设置优先于全局；职业授权与资源上限仍需同时满足。</span>
    </div>
    {projects.isError ? <ServiceNotice error={projects.error} compact onRetry={() => { void projects.refetch(); }} /> : null}
    {message === '' ? null : <div className={`banner ${unknown ? 'warn' : 'info'}`} role="status"><Icon name={unknown ? 'help' : 'info'} /><span className="grow">{message}{pending === null ? '' : ` 请求号：${pending.requestKey}`}</span>{unknown ? <Button size="sm" icon="refresh" onClick={() => { void reconcile(); }}>核对原请求</Button> : null}</div>}
    <div className="tool-policy-layout">
      <aside className="card pad" aria-label="工具来源"><div className="eyebrow" style={{ marginBottom: 10 }}>工具来源</div><div className="col" style={{ gap: 6 }}>{query.data?.sources.map((source) => <Button key={source.id} disabled={pending !== null} variant={source.id === selectedSource ? 'secondary' : 'ghost'} aria-pressed={source.id === selectedSource} onClick={() => { setSelectedSource(source.id); }} style={{ justifyContent: 'flex-start', width: '100%', height: 'auto', minHeight: 44 }} icon={source.complete ? 'tool' : 'help'}><span className="grow">{source.label}</span><span className="hint num">{source.complete ? source.tools.length : '未知'}</span></Button>)}</div></aside>
    <div>{query.data?.sources.filter((source) => source.id === selectedSource).map((source) => <section className="card" key={source.id}>
      <div className="card-head"><span className="tile"><Icon name="tool" /></span><div className="grow"><span className="section-title">{source.label}</span><div className="hint">{source.kind === 'external' ? `外部 MCP 来源 · ${source.state ?? '状态未知'}` : '内置 MCP 来源'} · {source.tools.length} 个工具 · {source.complete ? '清单完整' : '清单不完整'}</div></div>
        <Button size="sm" variant="ghost" icon="stop" disabled={pending !== null || !source.complete || source.tools.some((tool) => !tool.editable)} disabledReason={source.reason ?? source.tools.find((tool) => !tool.editable)?.reason} onClick={() => { setSourceToDisable(source.id); }}>停用此来源</Button>
      </div>
      {!source.complete ? <div className="banner warn"><Icon name="alert" /><span>{source.reason}</span><Button size="sm" icon="refresh" onClick={() => { void query.refetch(); }}>重新读取</Button></div> : null}
      {source.tools.map((tool) => { const meta = MANAGED_MCP_TOOLS.find((item) => item.name === tool.name); return <div className="list-row" style={{ cursor: 'default', flexWrap: 'wrap' }} key={tool.name}>
        <span className="tile"><Icon name={tool.enabled ? 'check' : 'minus'} size="sm" /></span>
        <div className="grow" style={{ minWidth: 160 }}><span className="mono">{tool.name}</span><div>{meta?.title}</div><div className="hint">{tool.reason ?? (projectId === '' ? `全局${tool.globalEnabled ? '启用' : '停用'}` : tool.projectOverride === null ? `继承全局：${tool.globalEnabled ? '启用' : '停用'}` : `项目明确${tool.projectOverride ? '启用' : '停用'}`)}</div>{projectId === '' ? tool.projectOverrides?.map((override) => <div className="hint" key={override.projectId}>项目 {projects.data?.find((project) => project.id === override.projectId)?.name ?? override.projectId} 明确{override.enabled ? '启用' : '停用'}，不受全局默认修改影响</div>) : null}</div>
        <Badge icon={tool.enabled ? 'check' : 'minus'} tone={tool.enabled ? 'ok' : 'idle'}>{tool.enabled ? '允许新会话' : '已停用'}</Badge>
        <div className="row" role="group" aria-label={`${tool.name} 工具策略`} style={{ gap: 4 }}>
          {(projectId === '' ? [true, false] : [null, true, false]).map((value) => <Button key={String(value)} size="sm" variant={(projectId === '' ? tool.globalEnabled : tool.projectOverride) === value ? 'secondary' : 'ghost'} aria-pressed={(projectId === '' ? tool.globalEnabled : tool.projectOverride) === value} disabled={pending !== null || !tool.editable || !source.complete} disabledReason={tool.reason ?? source.reason} onClick={() => { void save({ toolName: tool.name, enabled: value }); }}>{value === null ? '继承' : value ? '启用' : '停用'}</Button>)}
        </div>
      </div>; })}
    </section>)}</div>
    </div>
    <Modal open={sourceToDisable !== null} title="停用这个来源的全部工具？" onClose={() => { setSourceToDisable(null); }} footer={<><Button variant="ghost" onClick={() => { setSourceToDisable(null); }}>取消</Button><Button variant="danger" icon="stop" onClick={() => { if (sourceToDisable !== null) { void save({ sourceId: sourceToDisable, enabled: false }); setSourceToDisable(null); } }}>确认停用</Button></>}>
      <p>此来源的 {query.data?.sources.find((source) => source.id === sourceToDisable)?.tools.length ?? 0} 个工具将停止供新会话调用；运行中会话的后续调用也会被拒绝。之后可以逐个重新启用。{projectId === '' ? '项目的明确设置保留，不受全局默认变更影响。' : ''}</p>
      <div className="col">{query.data?.sources.find((source) => source.id === sourceToDisable)?.tools.map((tool) => <span className="mono" key={tool.name}>{tool.name}</span>)}</div>
    </Modal>
    <div className="banner info"><Icon name="shield" /><div>策略来自服务端完整注册清单。保存不会重发结果未知的操作。外部来源只有在运行服务提供完整清单和连接契约后才可管理；本页不把未连接来源显示为已安装。</div></div>
  </div>;
}
