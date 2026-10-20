import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ROUTES, type RoleImageBinding, type RolePermissionPreview, type RoleInsightsResponse, type RoleImageCatalogResponse } from '@agent-workflow/shared';
import { apiGet, errorMessage } from '../../api/client.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { formatAbsoluteTime } from '../../app/format.ts';
type Insights = RoleInsightsResponse;
function useInsights(id: string) { return useQuery({ queryKey: ['role-insights', id], queryFn: async () => (await apiGet<Insights>(ROUTES.catalogRoleInsights(id))).data, retry: false, staleTime: 0 }); }
export function RoleUsage({ id, compact = false }: { readonly id: string; readonly compact?: boolean }) {
  const query = useInsights(id);
  if (query.isLoading) return <span className="hint">正在读取使用情况…</span>;
  if (query.isError) return <ServiceNotice error={query.error} onRetry={() => { void query.refetch(); }} />;
  const usage = query.data?.usage;
  if (usage === undefined) return null;
  return <div className="col" style={{ gap: 6 }}><span className="hint">{usage.workflows.length} 个流程 · {usage.templates.length} 个模板 · 当前已确认计划冻结 {usage.frozenNodes} 个步骤</span>{compact ? null : <>{usage.workflows.map((workflow) => <div key={workflow.id}><Icon name="flow" size="sm" /> {workflow.name}<p className="hint">{[...(workflow.planning ? ['规划职责'] : []), ...workflow.steps].join('、')}</p></div>)}{usage.templates.map((template) => <div key={template.id}>{template.name}<p className="hint">{template.steps.join('、')}</p></div>)}</>}</div>;
}
export function RolePermissionEstimate({ id, locked, onViewPublished }: { readonly id: string; readonly locked: boolean; readonly onViewPublished?: () => void }) {
  const [basis, setBasis] = useState<Insights | null>(null);
  const [slot, setSlot] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RolePermissionPreview | null>(null);
  const [error, setError] = useState('');
  const readBasis = async () => {
    setBusy(true); setError(''); setResult(null); setBasis(null); setSlot('');
    try { setBasis((await apiGet<Insights>(ROUTES.catalogRoleInsights(id))).data); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  };
  const preview = async () => {
    if (basis?.published == null || slot === '') return;
    setBusy(true); setError(''); setResult(null);
    try { setResult((await apiGet<RolePermissionPreview>(`${ROUTES.catalogRolePermissionPreview(id)}?revision=${encodeURIComponent(basis.published.revision)}&slot=${encodeURIComponent(slot)}`)).data); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  };
  return <section className="card pad" style={{ marginTop: 12 }}><div className="row wrap"><Icon name="shield" /><b className="grow">已发布版本权限预估</b><Badge outline icon="lock">只读预估</Badge>{basis?.published == null ? null : <Badge tone="ok" icon="check">发布修订 {basis.published.revision}</Badge>}</div>
    <div className="banner info" style={{ marginTop: 12 }}><Icon name="info" /><span>预估 ≠ 实际授权。运行时还要经过本次会话的授权、工具发现和工作区许可；选择或读取不会写入配置。</span></div>
    <div className="row wrap" style={{ marginTop: 12, gap: 8 }}>
      <Button disabled={busy || locked} onClick={() => { void readBasis(); }}>核对精确发布修订</Button>
      {basis?.published == null ? (<><span className="hint">{basis === null ? '请先在“职责与指令”里打开“已发布版本”完成核对，或在这里核对精确发布修订。' : '该职业尚未发布，发布修订 1 之后才能预估。'}</span>{onViewPublished === undefined ? null : <Button size="sm" variant="ghost" icon="arrowRight" onClick={onViewPublished}>查看已发布版本</Button>}</>) : <><label htmlFor={`preview-slot-${id}`}>预估职责位置</label><select id={`preview-slot-${id}`} className="select" value={slot} disabled={busy || locked} onChange={(event) => { setSlot(event.target.value); setResult(null); setError(''); }}><option value="">请选择职责位置</option>{basis.published.allowedSlots.map((value) => <option key={value} value={value}>{basis.slots.find((item) => item.id === value)?.label ?? '该发布版本的职责位置（目录未登记）'}</option>)}</select><Button disabled={busy || locked || slot === ''} disabledReason={slot === '' ? '请选择该发布修订允许的职责位置' : undefined} onClick={() => { void preview(); }}>读取预估</Button></>}
    </div>
    {busy ? <div aria-busy="true"><p className="hint">正在读取发布依据与权限上限…</p><div className="col" style={{ gap: 8 }}><div className="skel" style={{ height: 36 }} /><div className="skel" style={{ height: 36 }} /></div></div> : null}{error === '' ? null : <p className="banner danger" role="alert"><Icon name="alert" />{error}；旧预估已清空，可重新核对或读取。</p>}
    {result === null ? null : <div style={{ marginTop: 12 }}><Badge icon="check" tone="ok">已读取</Badge><p className="hint">{basis?.slots.find((item) => item.id === result.slot)?.label ?? '该发布版本的职责位置（目录未登记）'} · {result.revision} · {formatAbsoluteTime(result.readAt)}</p><b>限制说明</b><ul>{result.limitations.map((item) => <li key={item}>{item}</li>)}</ul><b>有效工具上限 · {result.tools.length} 项</b>{result.tools.length === 0 ? <p className="hint">没有有效工具声明。空清单不表示不受限制：运行时这个位置不能调用任何工具。</p> : <table className="table"><thead><tr><th>用途</th><th>工具名</th></tr></thead><tbody>{result.tools.map((tool) => <tr key={tool.name}><td>{tool.description}</td><td className="mono-wrap">{tool.name}</td></tr>)}</tbody></table>}<b>诊断</b>{result.diagnostics.length === 0 ? <p><Icon name="check" />没有诊断问题</p> : <ul>{result.diagnostics.map((item) => <li key={item}><Icon name="alert" size="sm" /> {item}</li>)}</ul>}</div>}
  </section>;
}
export function RoleImageChoices({ disabled, onSelect }: { readonly disabled: boolean; readonly onSelect: (image: RoleImageBinding) => void }) {
  const query = useQuery({ queryKey: ['role-image-catalog'], queryFn: async () => (await apiGet<RoleImageCatalogResponse>(ROUTES.catalogRoleImages)).data.images, retry: false });
  return <section style={{ marginTop: 12 }}><b>可选形象</b><p className="hint">选择写入本地编辑草稿；保存草稿并发布后用于新任务，历史冻结形象保持原样。</p>{query.isError ? <ServiceNotice error={query.error} onRetry={() => { void query.refetch(); }} /> : query.isLoading ? <p className="hint">正在读取形象目录…</p> : <div className="row wrap" style={{ gap: 8 }}>{query.data?.map((image) => <Button key={image.id} disabled={disabled} disabledReason={disabled ? '当前编辑操作已锁定' : undefined} onClick={() => onSelect(image)}>{image.value} {image.label}</Button>)}</div>}</section>;
}
