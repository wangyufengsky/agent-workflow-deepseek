import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ROUTES, createRequestKey, type CommandResponse, type RoleCatalogResponse, type RolePackageValidation, type OperationsByKeyResponse } from '@agent-workflow/shared';
import { apiGet, apiPost, errorMessage } from '../../api/client.ts';
import { pendingForScope, subscribePending } from '../../api/pending-commands.ts';
import { Button } from '../../components/Button.tsx';
import { Drawer } from '../../components/Drawer.tsx';
import { Modal } from '../../components/Modal.tsx';
import { Icon } from '../../components/Icon.tsx';

const FIELD_LABEL:Record<string,string>={name:'名称',purpose:'职责定位',responsibilities:'职责',allowedSlots:'允许位置',instructions:'Prompt 模板',model:'模型',maxRuntimeMinutes:'最长运行时间',capabilityGroups:'能力范围',resourcePermissions:'资源权限',image:'形象'};
function displayValue(value:unknown,path:string):string {
 if(value===null||value===undefined)return '（不存在）';
 if(path.endsWith('/capabilityGroups')&&Array.isArray(value))return value.map((group)=>`${group.label}：${group.items.filter((item:{enabled:boolean})=>item.enabled).map((item:{label:string})=>item.label).join('、')||'未启用'}`).join('\n');
 if(path.endsWith('/resourcePermissions')&&typeof value==='object') {const data=value as {tools:{kind:string;name:string;source?:string}[];files:{kind:string;path:string;workspace?:string}[];commands:{argv:string[];workspace?:string}[];resources:{id:string}[]};return [data.tools.map(item=>`工具 ${item.kind} · ${item.name}${item.source?` · ${item.source}`:''}`).join('\n'),data.files.map(item=>`文件 ${item.kind} · ${item.path}${item.workspace?` · ${item.workspace}`:''}`).join('\n'),data.commands.map(item=>`命令 ${JSON.stringify(item.argv)}${item.workspace?` · ${item.workspace}`:''}`).join('\n'),data.resources.map(item=>`资源 ${item.id}`).join('\n')].filter(Boolean).join('\n')||'无额外授权';}
 if(Array.isArray(value))return value.map(item=>item==='execution'?'执行':item==='execution_read_only'?'只读执行':String(item)).join('\n');
 return typeof value==='string'?value:JSON.stringify(value,null,2);
}
const storageKey='roles.package.candidate.v1';
function restored(): {source:string;name:string} | undefined { try { const value=JSON.parse(sessionStorage.getItem(storageKey)??'null'); return typeof value?.source==='string' && typeof value.name==='string' ? value : undefined; } catch { return undefined; } }
export function RolePackageImport() {
  const [candidate,setCandidate]=useState(restored);
  const [open,setOpen]=useState(false);
  const [check,setCheck]=useState<RolePackageValidation>();
  const [busy,setBusy]=useState(false);
  const [locked,setLocked]=useState(()=>pendingForScope('/api/catalog/roles')!==undefined);
  const [reviewed,setReviewed]=useState(false);
  const [message,setMessage]=useState('');
  const [confirm,setConfirm]=useState<{kind:'replace';value:{source:string;name:string}}|{kind:'leave';href:string}>();
  const input=useRef<HTMLInputElement>(null);
  const navigate=useNavigate();
  const queries=useQueryClient();
  useEffect(()=>subscribePending(()=>{setLocked(pendingForScope('/api/catalog/roles')!==undefined);void queries.invalidateQueries({queryKey:['catalog']});}),[queries]);
  useEffect(()=>{
    try { if(candidate) sessionStorage.setItem(storageKey,JSON.stringify(candidate));else sessionStorage.removeItem(storageKey); }
    catch { setMessage('候选未能持久保存；离开页面可能丢失，请保留原配置文件。'); }
  },[candidate]);
  useEffect(()=>{
    if(!candidate)return;
    const unload=(event:BeforeUnloadEvent)=>{event.preventDefault();};
    const leave=(event:MouseEvent)=>{
      const anchor=(event.target as Element)?.closest('a[href]') as HTMLAnchorElement|null;
      if(!anchor || anchor.target==='_blank' || event.metaKey || event.ctrlKey || anchor.origin!==location.origin || anchor.href===location.href)return;
      event.preventDefault();event.stopPropagation();setConfirm({kind:'leave',href:anchor.pathname+anchor.search+anchor.hash});
    };
    window.addEventListener('beforeunload',unload);document.addEventListener('click',leave,true);
    return()=>{window.removeEventListener('beforeunload',unload);document.removeEventListener('click',leave,true);};
  },[candidate]);
  async function validate(value=candidate) {
    if(!value)return;
    setBusy(true);setCheck(undefined);setReviewed(false);setMessage('');setOpen(true);
    try { setCheck((await apiPost<RolePackageValidation>(ROUTES.catalogRolePackageValidate,{source:value.source})).data); }
    catch(error){setMessage(errorMessage(error));}finally{setBusy(false);}
  }
  function adopt(value:{source:string;name:string}) {setCandidate(value);void validate(value);}
  async function file(file:File) {
    try { if(file.size>2_000_000)throw new Error('配置包不能超过 2 MB');
      const source=file.name.toLowerCase().endsWith('.zip') ? JSON.stringify({archiveBase64:btoa(Array.from(new Uint8Array(await file.arrayBuffer()),(byte)=>String.fromCharCode(byte)).join(''))}) : await file.text();
      const value={source,name:file.name}; if(candidate)setConfirm({kind:'replace',value});else adopt(value);
    }catch(error){setMessage(errorMessage(error));setOpen(true);}
  }
  const reason=locked?'操作结果未知，请按原请求号核对':busy?'正在校验或发布':!check?.valid?'请先通过配置包校验':!check.differences.length?'没有可核对的字段差异，当前不能发布':!reviewed?'请明确核对全部角色、权限、提示模板与激活差异':undefined;
  async function reconcile() {
    const pending=pendingForScope('/api/catalog/roles');if(!pending)return;
    setBusy(true);
    try { const {data}=await apiGet<OperationsByKeyResponse>(ROUTES.operationsByKey(pending.requestKey));
      if(data.operation.status==='succeeded'){setCandidate(undefined);setCheck(undefined);setReviewed(false);setMessage('原配置包发布已确认成功。');}
      else if(data.operation.status==='failed'){setCheck(undefined);setReviewed(false);setMessage('原发布已确认失败。请重新校验后再审阅。');}
      else setMessage(`原请求 ${pending.requestKey} 仍为 ${data.operation.status}，继续锁定，不会重发。`);
    }catch(error){setMessage(errorMessage(error));}finally{setBusy(false);}
  }
  async function publish() {
    if(reason || !check || !candidate)return;
    setBusy(true);setMessage('');
    try {
      const response=await apiPost<CommandResponse<RoleCatalogResponse>>(ROUTES.catalogRolePackagePublish,{requestKey:createRequestKey(),source:candidate.source,sourceHash:check.sourceHash,baselineHash:check.baselineHash,confirmReviewed:true});
      if(response.data.receipt.status==='succeeded') {setCandidate(undefined);setCheck(undefined);setReviewed(false);setMessage('已发布，之后新建的会话将使用新配置。');await queries.invalidateQueries({queryKey:['catalog']});await queries.invalidateQueries({queryKey:['bootstrap']});}
      else setMessage('发布尚未确认，请按原请求号核对。');
    }catch(error){setMessage(errorMessage(error));}finally{setBusy(false);}
  }
  return <>
    <input hidden type="file" accept=".json,.zip,application/json,application/zip" ref={input} onChange={(event)=>{const value=event.target.files?.[0];event.target.value='';if(value)void file(value);}} />
    <Button variant="secondary" size="sm" icon="upload" disabled={locked||busy} disabledReason={locked?'请先核对原发布操作':busy?'正在校验或发布':undefined} onClick={()=>input.current?.click()}>导入配置包</Button>
    {locked?<Button variant="secondary" size="sm" disabled={busy} onClick={()=>void reconcile()}>核对原发布操作</Button>:null}
    {candidate?<div className="banner info rl-package-pending"><Icon name="archive"/><span className="grow">{candidate.name} 尚未发布</span><Button size="sm" onClick={()=>setOpen(true)}>打开导入结果</Button></div>:null}
    {message&&!open?<p role="status">{message}</p>:null}
    <Drawer open={open} title="导入角色配置" size="xl" onClose={()=>setOpen(false)} footer={<><Button variant="ghost" onClick={()=>setOpen(false)}>稍后再说</Button><span className="grow"/><Button variant="secondary" disabled={busy||locked||!candidate} onClick={()=>void validate()}>重新校验</Button><Button disabled={reason!==undefined} disabledReason={reason} onClick={()=>void publish()}>发布配置包</Button></>}>
      <ol className="rl-package-steps"><li>选择文件</li><li>{busy?'校验中…':'校验'}</li><li>核对差异</li><li>发布</li></ol>
      {locked?<Button variant="secondary" size="sm" disabled={busy} onClick={()=>void reconcile()}>核对原发布操作</Button>:null}
    {candidate?<div className="row wrap"><Icon name="archive"/><b className="grow">{candidate.name}</b><Button size="sm" disabled={busy||locked} onClick={()=>input.current?.click()}>换一个</Button></div>:<Button onClick={()=>input.current?.click()}>选择 JSON 或 ZIP 配置包</Button>}
      <p className="hint">JSON：version: 1、roles、可选 bindings；ZIP 包含同结构的 roles.json。校验只读，不会保存草稿或改变角色。</p>
      {message?<div className={`banner ${message.includes('已发布')||message.includes('已确认成功')?'ok':'unknown'}`} role="status"><Icon name={message.includes('已发布')||message.includes('已确认成功')?'check':'help'}/>{message}</div>:null}
      {busy?<p role="status"><Icon name="clock"/>正在读取并校验配置包与现有配置…</p>:null}
      {check?<><p className={`banner ${check.valid?'ok':'warn'}`}><Icon name={check.valid?'check':'alert'}/>{check.valid?'校验通过，请核对差异':'校验未通过，不能发布'}</p><p className="hint mono">来源摘要 {check.sourceHash}</p>
        {check.issues.map((issue,index)=><p role="alert" key={index}><Icon name="alert"/>{issue.path}：{issue.message}</p>)}
        <h3>角色版本</h3>{check.roles.map((role)=><p key={role.id}>{role.name} · {role.revision??'新角色'} · {role.changed?'更新内容':'内容未变'}</p>)}
        <h3>字段与激活差异 · {check.differences.length} 处</h3>
        {!check.differences.length?<div className="banner warn"><Icon name="alert"/>没有可核对的字段差异，当前不能发布。保留现有角色绑定。</div>:<table className="rl-compare"><thead><tr><th>内容</th><th>当前</th><th>导入后</th></tr></thead><tbody>{check.differences.map((diff)=><tr key={diff.path}><th>{diff.path.startsWith('roles/')?`${check.roles.find(role=>role.id===diff.path.split('/')[1])?.name??diff.path.split('/')[1]} · ${FIELD_LABEL[diff.path.split('/')[2]!]??diff.path.split('/')[2]}`:`激活绑定 · ${diff.path.slice(9)}`}</th><td className="rl-old"><pre>{displayValue(diff.before,diff.path)}</pre></td><td className="rl-new"><pre>{displayValue(diff.after,diff.path)}</pre></td></tr>)}</tbody></table>}
        <p className="banner info"><Icon name="info"/>发布只影响之后新建的会话，运行中会话与已冻结任务不会获得新增权限。</p>
        <label className="row"><input type="checkbox" checked={reviewed} disabled={busy||locked||!check.valid||!check.differences.length} onChange={(event)=>setReviewed(event.target.checked)}/>我已核对角色、权限、提示模板与激活差异</label></>:null}
    </Drawer>
    <Modal open={confirm!==undefined} title={confirm?.kind==='replace'?'替换尚未发布的配置包？':'离开历史角色配置？'} onClose={()=>setConfirm(undefined)} footer={<><Button variant="ghost" onClick={()=>setConfirm(undefined)}>继续核对</Button><Button onClick={()=>{const action=confirm;setConfirm(undefined);if(action?.kind==='replace')adopt(action.value);else if(action?.kind==='leave')navigate(action.href);}}>{confirm?.kind==='replace'?'替换配置包':'保留候选并离开'}</Button></>}><p>当前配置包尚未发布。{confirm?.kind==='replace'?'替换会清除当前校验结果与核对勾选。':'候选保留在当前窗口，返回后需重新校验。'}发布结果未知时只允许按原请求核对，不会自动重发。</p></Modal>
  </>;
}
