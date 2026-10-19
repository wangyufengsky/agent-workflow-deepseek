import { useState } from 'react';
import { ROUTES, createRequestKey, type CommandResponse, type OperationRecord } from '@agent-workflow/shared';
import { apiGet, apiPost, errorMessage, isApiClientError } from '../../api/client.ts';
import { Button } from '../../components/Button.tsx';
import { Modal } from '../../components/Modal.tsx';
import { Icon } from '../../components/Icon.tsx';
interface PendingRunCommand { readonly action: 'retry' | 'cancel' | 'archive'; readonly requestKey: string; readonly nodeIds?: readonly string[]; readonly expectedStatus?: string }
export function useRunCommands(taskId: string, refresh: () => void) {
  const storageKey = `agent-workflow.run.command.${taskId}`;
  const [pending, setPending] = useState<PendingRunCommand | null>(() => { try { return JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as PendingRunCommand | null; } catch { return null; } });
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const remember = (value: PendingRunCommand | null) => { if (value === null) sessionStorage.removeItem(storageKey); else sessionStorage.setItem(storageKey, JSON.stringify(value)); setPending(value); };
  const execute = async (action: PendingRunCommand['action'], expectedStatus: string | undefined, nodeIds?: readonly string[]) => {
    if (pending !== null || busy) return;
    const input = { action, expectedStatus, nodeIds, requestKey: createRequestKey() };
    try { remember(input); } catch { setMessage('无法保留原请求号，操作尚未发送。'); return; }
    setBusy(true); setMessage('');
    try { const result = (await apiPost<CommandResponse>(action === 'retry' ? ROUTES.executionRetry(taskId) : action === 'archive' ? ROUTES.taskArchive(taskId) : ROUTES.executionCancel(taskId), action === 'archive' ? { requestKey: input.requestKey, archived: true, confirmArchive: true } : { requestKey: input.requestKey, expectedStatus, ...(nodeIds === undefined ? {} : { nodeIds }), confirm: true })).data;
      if (result.receipt.status === 'succeeded' || result.receipt.status === 'failed') { setMessage(result.receipt.status === 'succeeded' ? action === 'archive' ? '任务已归档，原计划与产物保留。' : action === 'cancel' ? '停止已确认，已完成内容保留。' : '本批次重试请求已确认，按原配置推进；完成情况见最新尝试。' : result.receipt.error?.message ?? '操作失败'); remember(null); }
      else setMessage('结果尚未确定，保留原请求号；只重新读取，不再次发送。');
    } catch (error) { if (isApiClientError(error) && error.kind === 'http' && error.status !== null && error.status < 500 && !/UNKNOWN|IN_PROGRESS/.test(error.code ?? '')) remember(null); setMessage(errorMessage(error)); }
    finally { setBusy(false); refresh(); }
  };
  const reconcile = async (key = pending?.requestKey) => {
    if (key === undefined || busy) return; setBusy(true);
    try { const operation = (await apiGet<{ operation: OperationRecord }>(ROUTES.operationsByKey(key))).data.operation;
      if (operation.status === 'succeeded' || operation.status === 'failed') { if (pending?.requestKey === key) remember(null); setMessage(operation.status === 'succeeded' ? '原操作已确认成功，请查看最新批次状态。' : `原操作已确认失败：${operation.error?.message ?? ''}`); }
      else setMessage('原操作仍在处理中或结果未知；没有重新派发。');
    } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); refresh(); }
  };
  return { pending, busy, message, execute, reconcile };
}
export function RunCommandNotice({ command, operationKeys }: { readonly command: ReturnType<typeof useRunCommands>; readonly operationKeys: readonly string[] }) {
  const keys = [...new Set([...(command.pending === null ? [] : [command.pending.requestKey]), ...operationKeys])];
  return <>{command.message === '' && keys.length === 0 ? null : <div className="banner warn" role="status"><Icon name={keys.length ? 'help' : 'info'} /><div className="grow">{command.message || '正在停止或重试结果未明，确认前不会再次发送。'}{keys.map((key) => <div key={key}><Button variant="secondary" size="sm" icon="refresh" disabled={command.busy} onClick={() => { void command.reconcile(key); }}>重新读取原操作</Button><details><summary>请求诊断</summary><code>{key}</code></details></div>)}</div></div>}</>;
}
export function CancelRun({ blockedReason, command, status }: { readonly blockedReason?: string; readonly command: ReturnType<typeof useRunCommands>; readonly status?: string }) {
  const [open, setOpen] = useState(false);
  return <><Button variant="secondary" size="sm" icon="stop" disabled={blockedReason !== undefined || command.pending !== null || command.busy} disabledReason={blockedReason ?? '原运行操作尚未确认'} onClick={() => setOpen(true)}>取消运行</Button><Modal open={open} onClose={() => setOpen(false)} title="取消这次运行？" footer={<><Button onClick={() => setOpen(false)}>继续运行</Button><Button variant="danger" icon="stop" onClick={() => { setOpen(false); void command.execute('cancel', status); }}>取消运行</Button></>}><p>正在进行的批次会先停下来，停止完成前显示“正在停止”，这期间不能再次取消或重试。已完成的批次、尝试和产物都会保留。</p></Modal></>;
}

export function RunPendingRecovery({ taskId, refresh }: { readonly taskId: string; readonly refresh: () => void }) { const command = useRunCommands(taskId, refresh); return <RunCommandNotice command={command} operationKeys={[]} />; }

export function ArchiveRun({ command, allowed, reason }: { readonly command: ReturnType<typeof useRunCommands>; readonly allowed: boolean; readonly reason?: string }) { const [open, setOpen] = useState(false); return <><Button variant="ghost" size="sm" icon="archive" disabled={!allowed || command.pending !== null || command.busy} disabledReason={!allowed ? reason : '原操作尚未确认'} onClick={() => setOpen(true)}>归档任务</Button><Modal open={open} title="归档任务？" onClose={() => setOpen(false)} footer={<><Button onClick={() => setOpen(false)}>取消</Button><Button variant="primary" onClick={() => { setOpen(false); void command.execute('archive', undefined); }}>确认归档</Button></>}><p>归档仅改变任务列表可见范围，原计划、执行、尝试与产物保留。</p></Modal></>; }
