import './tools-policy.css';
import { useState, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ROUTES, createRequestKey, type ToolPolicyResponse, type ToolPolicyUpdate, type CommandResponse, type OperationsByKeyResponse } from '@agent-workflow/shared';
import { apiGet, request, errorMessage, ApiClientError } from '../../api/client.ts';
import { subscribePending } from '../../api/pending-commands.ts';
import { pendingToolPolicyCommand, toolPolicyCommandSnapshot } from './tool-policy-command.ts';
import { useProjects } from '../../api/hooks.ts';
import { MANAGED_MCP_TOOLS } from '../../api/catalog.ts';
import { PageHeaderSlot } from '../../components/PageHeaderSlot.tsx';
import { Modal } from '../../components/Modal.tsx';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';

export function ToolsPolicyView() {
  const projects = useProjects();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const projectId = params.get('projectId') ?? '';
  const setProjectId = (value: string) => setParams((current) => { const next = new URLSearchParams(current); if (value) next.set('projectId', value); else next.delete('projectId'); return next; });
  const [pending, setPending] = useState<ToolPolicyUpdate | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [saving,setSaving]=useState(false);
  const durableIdentity=useSyncExternalStore(subscribePending,toolPolicyCommandSnapshot,()=> '');
  const durableCommand=durableIdentity?pendingToolPolicyCommand():undefined;
  const originalKey=durableCommand?.requestKey??pending?.requestKey;
  const locked=saving||originalKey!==undefined;
  const uncertain=unknown||(durableCommand!==undefined&&durableCommand.phase===undefined);
  const [message, setMessage] = useState('');
  const selectedSource = params.get('source') ?? 'workflow';
  const setSelectedSource = (value: string) => setParams((current) => { const next = new URLSearchParams(current); next.set('source', value); return next; });
  const [sourceToDisable, setSourceToDisable] = useState<string | null>(null);
  const query = useQuery({ queryKey: ['tool-policy', projectId], queryFn: async () => (await apiGet<ToolPolicyResponse>(`${ROUTES.toolsPolicy}${projectId === '' ? '' : `?projectId=${encodeURIComponent(projectId)}`}`)).data, retry: false });
  const save = async (change: Omit<ToolPolicyUpdate, 'requestKey' | 'projectId'>) => {
    if(locked||pendingToolPolicyCommand()){setMessage('原工具策略操作尚未结清，请按原请求号核对。');return;}
    const body = { ...change, requestKey: createRequestKey(), ...(projectId === '' ? {} : { projectId }) };
    setSaving(true);setPending(body); setUnknown(false); setMessage('正在保存工具策略…');
    try {
      const result = (await request<CommandResponse<ToolPolicyResponse>>(ROUTES.toolsPolicy, { method: 'PATCH', body })).data;
      if (result.receipt.status === 'accepted' || result.receipt.status === 'unknown') { setUnknown(result.receipt.status==='unknown'); setMessage(result.receipt.status==='unknown'?'修改结果待核对，请按原请求号核对。':'原请求已受理，等待结算；可以按原请求号读取状态。'); return; }
      if (result.receipt.status === 'failed') { setPending(null); setMessage(result.receipt.error?.message ?? '策略保存失败'); return; }
      await client.invalidateQueries({ queryKey: ['tool-policy'] });
      setPending(null); setMessage('策略已保存；只影响新建会话，运行中的会话保持原权限。');
    } catch (error) {
      const uncertain = error instanceof ApiClientError && (error.kind === 'unavailable' || error.kind === 'timeout' || error.kind === 'protocol');
      setUnknown(uncertain); setMessage(uncertain ? '保存结果未知，已保留原请求号；请核对原操作。' : errorMessage(error));
      if (!uncertain) setPending(null);
    } finally {setSaving(false);}
  };
  const reconcile = async () => {
    const key=pendingToolPolicyCommand()?.requestKey??originalKey;
    if (key===undefined||saving) return;
    try {
      const result = (await apiGet<OperationsByKeyResponse>(ROUTES.operationsByKey(key))).data;
      if (result.operation.status === 'succeeded' || result.operation.status === 'failed') {
        setMessage(result.operation.status === 'succeeded' ? '已核对：保存成功。' : `已核对：保存失败。${result.operation.error?.message ?? ''}`);
        setPending(null); setUnknown(false); await client.invalidateQueries({queryKey:['tool-policy']});
      } else {setUnknown(result.operation.status==='unknown');setMessage(result.operation.status==='accepted'?'原请求已受理，等待结算；不会重新提交。':'原操作结果仍待核对；不会重新提交。');}
    } catch (error) { setMessage(`尚未核对成功：${errorMessage(error)}`); }
  };
  if (query.isLoading) return <p className="hint">正在读取服务端工具清单与有效策略…</p>;
  if (query.isError) return <ServiceNotice error={query.error} onRetry={() => { void query.refetch(); }} />;
  return <div className="col" style={{ gap: 16 }}>
    <PageHeaderSlot><select id="tool-policy-project" aria-label="配置范围" className="select ctl tool-header-scope" value={projectId} disabled={locked || sourceToDisable !== null} title={locked?'原工具策略操作尚未结清，请先核对原请求号':sourceToDisable?'先确认或取消当前来源操作':undefined} onChange={(event) => { setProjectId(event.target.value); setMessage(''); }}>
      <option value="">全局默认</option>{(projects.data ?? []).map((project) => <option key={project.id} value={project.id}>项目：{project.name}</option>)}
    </select></PageHeaderSlot>
    {projects.isError ? <ServiceNotice error={projects.error} compact onRetry={() => { void projects.refetch(); }} /> : null}
    {message === '' && originalKey===undefined ? null : <div className={`banner ${uncertain ? 'warn' : 'info'}`} role="status"><Icon name={uncertain ? 'help' : originalKey?'clock':'info'} /><span className="grow">{message || (uncertain?'原工具策略保存结果待核对，不能修改工具或切换范围。':'原工具策略请求已受理，等待结算。')}{originalKey===undefined?'':` 请求号：${originalKey}`}</span>{originalKey!==undefined && !saving ? <Button size="sm" icon="refresh" onClick={() => { void reconcile(); }}>核对原请求</Button> : null}</div>}
    <div className="tool-policy-layout">
      <aside className="card tool-sources" aria-label="工具来源"><div className="tool-sources-heading"><span className="eyebrow">工具来源</span><span className="hint num">{query.data?.sources.length}</span></div>{query.data?.sources.map((source) => <button type="button" className="tool-source" key={source.id} disabled={locked} title={locked?'原工具策略操作尚未结清，请先核对原请求号':undefined} aria-current={source.id === selectedSource} onClick={() => setSelectedSource(source.id)}><span className="tile"><Icon name={source.complete ? 'tool' : 'help'} size="sm" /></span><span className="grow"><span className="tool-source-name">{source.label}</span><span className="tool-source-description">{source.kind === 'external' ? source.state ?? '状态未知' : '内置'} · {source.complete ? `${source.tools.length} 个工具` : '清单不完整'}</span></span></button>)}</aside>
      <div>{query.data?.sources.filter((source) => source.id === selectedSource).map((source) => <section className="col" style={{ gap: 12 }} key={source.id}>
        <div className="card tool-policy-summary">
          <div className="row wrap"><div className="grow"><div className="row wrap"><h3>{source.label}</h3><Badge outline icon={source.complete ? 'check' : 'help'} tone={source.complete ? 'neutral' : 'warn'}>{source.complete ? '清单完整' : '状态未知'}</Badge>{source.kind !== 'external' ? <Badge icon="sparkle">内置</Badge> : null}</div><div className="hint" style={{ marginTop: 4 }}>{source.kind === 'external' ? '外部来源' : '本地来源'} · <span className="mono">{source.id}</span></div></div>
          {source.tools.some((tool) => tool.editable) ? <Button size="sm" variant="ghost" icon="stop" disabled={locked || !source.complete || source.tools.some((tool) => !tool.editable)} disabledReason={locked?'原工具策略操作尚未结清，请先核对原请求号':source.reason ?? source.tools.find((tool) => !tool.editable)?.reason} onClick={() => setSourceToDisable(source.id)}>停用这个来源…</Button> : null}</div>
          <div className="row wrap" style={{ marginTop: 12 }}><span className="chip"><Icon name="info" size="sm" />只影响新建会话，运行中的会话保持原权限</span>{projectId ? <span className="chip">项目设置优先于全局默认</span> : null}</div>
        </div>
        {!source.complete ? <div className="banner warn"><Icon name="alert" /><span className="grow">{source.reason ?? '工具清单不完整，读取成功后才能修改设置。'}</span><Button size="sm" icon="refresh" onClick={() => { void query.refetch(); }}>重新读取</Button></div> : null}
        {source.tools.length > 0 ? <div className="card"><div className="row tool-policy-list-heading"><span className="grow hint">{projectId === '' ? '全局默认' : `项目：${projects.data?.find((project) => project.id === projectId)?.name ?? projectId}`} · {source.tools.length} 个工具</span><span className="hint">{projectId === '' ? '启用' : '继承 / 启用 / 停用'}</span></div>
          {source.tools.map((tool) => { const meta = MANAGED_MCP_TOOLS.find((item) => item.name === tool.name); return <div className="tool-policy-row" key={tool.name}>
            <div><div className="mono">{tool.name}</div><div className="tool-policy-description">{meta?.title ?? tool.name}</div></div>
            {!tool.editable ? <Badge icon="lock" tone="accent">内置，始终启用</Badge> : projectId === '' ? <button type="button" className="switch" role="switch" aria-label={`${tool.name} 全局启用`} aria-checked={tool.globalEnabled} disabled={locked || !source.complete} title={locked?'原工具策略操作尚未结清，请先核对原请求号':source.reason} onClick={() => { void save({ toolName: tool.name, enabled: !tool.globalEnabled }); }} /> : <div className="seg" role="group" aria-label={`${tool.name} 的项目设置`}>{[null, true, false].map((value) => <button type="button" key={String(value)} aria-pressed={tool.projectOverride === value} disabled={locked || !source.complete} title={locked?'原工具策略操作尚未结清，请先核对原请求号':source.reason} onClick={() => { void save({ toolName: tool.name, enabled: value }); }}>{value === null ? '继承' : value ? '启用' : '停用'}</button>)}</div>}
            <div className="tool-policy-scope"><Icon name={tool.enabled ? 'check' : 'minus'} size="sm" /> {tool.reason ?? (projectId === '' ? `全局${tool.globalEnabled ? '启用' : '停用'}` : tool.projectOverride === null ? `继承全局：${tool.globalEnabled ? '启用' : '停用'}` : `项目明确${tool.projectOverride ? '启用' : '停用'} · 全局为${tool.globalEnabled ? '启用' : '停用'}`)}{projectId === '' ? tool.projectOverrides?.map((override) => <div key={override.projectId}>项目 {projects.data?.find((project) => project.id === override.projectId)?.name ?? override.projectId} 明确{override.enabled ? '启用' : '停用'}，不受全局默认修改影响</div>) : null}</div>
          </div>; })}
        </div> : <div className="card tool-policy-summary"><p className="row"><Icon name="help" />暂时读不到这个来源的工具</p><p className="hint">工具清单读取成功后才能设置。</p><Button size="sm" icon="refresh" onClick={() => { void query.refetch(); }}>重新读取</Button></div>}
      </section>)}</div>
    </div>
    <Modal open={sourceToDisable !== null} title="停用这个来源的全部工具？" onClose={() => { setSourceToDisable(null); }} footer={<><Button variant="ghost" onClick={() => { setSourceToDisable(null); }}>取消</Button><Button variant="danger" icon="stop" onClick={() => { if (sourceToDisable !== null) { void save({ sourceId: sourceToDisable, enabled: false }); setSourceToDisable(null); } }}>确认停用</Button></>}>
      <p>此来源的 {query.data?.sources.find((source) => source.id === sourceToDisable)?.tools.length ?? 0} 个工具将在新建会话中停用，已经在运行的会话不受影响。之后可以逐个重新启用。{projectId === '' ? '项目的明确设置保留，不受全局默认变更影响。' : ''}</p>
      <div className="col">{query.data?.sources.find((source) => source.id === sourceToDisable)?.tools.map((tool) => <span className="mono" key={tool.name}>{tool.name}</span>)}</div>
    </Modal>
    <p className="hint">工具设置只影响新建会话；已有会话的权限保持不变。</p>
  </div>;
}
