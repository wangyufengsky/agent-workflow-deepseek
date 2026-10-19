import { pendingCommands, rememberCommand } from '../../api/pending-commands.ts';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ROUTES, createRequestKey, type OperationsByKeyResponse, type CommandResponse, type OperationReceipt, type PptWork } from '@agent-workflow/shared';
import { apiGet, apiPost, errorMessage } from '../../api/client.ts';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Modal } from '../../components/Modal.tsx';
import { ReceiptNotice } from '../../flow/workflow-ui.tsx';
export function PptGenerationControls({ work }: {
    readonly work: PptWork;
}) {
    const client = useQueryClient();
    const [confirm, setConfirm] = useState(false);
    const [busy, setBusy] = useState(false);
    const [receipt, setReceipt] = useState<OperationReceipt>();
    const [error, setError] = useState('');
    const run = work.generation;
    if (!run) return null;
    if (run.status === 'stopped') return <div className="banner ok" role="status"><Icon name="check"/><div>原生成已停止，已有内容和版本保留。<br/>原请求号 {run.requestKey}</div></div>;
    return <><div className={`banner ${run.status === 'unknown' ? 'unknown' : 'info'}`}><Icon name={run.status === 'unknown' ? 'help' : 'clock'}/><div className="grow"><b>{run.status === 'stopping' ? '正在停止原生成' : run.status === 'unknown' ? '生成/停止结果待核对' : '正在生成'}</b><br />原请求号 {run.requestKey}{run.stopRequestKey ? ` · 停止请求号 ${run.stopRequestKey}` : ''}<br />停止受理后仍等待原会话空闲；已有内容和版本保留。</div><Button variant="secondary" disabled={busy || run.stopRequestKey !== undefined || run.status === 'unknown'} disabledReason={run.stopRequestKey ? '核对原停止请求，不重复提交停止' : undefined} onClick={() => setConfirm(true)}>停止生成</Button></div><ReceiptNotice receipt={receipt}/>{error ? <p role="alert">{error}</p> : null}<Modal open={confirm} title="停止本次PPT生成？" onClose={() => { if (!busy)
        setConfirm(false); }} footer={<><Button variant="ghost" disabled={busy} onClick={() => setConfirm(false)}>取消</Button><Button disabled={busy} onClick={() => {
                setBusy(true);
                setError('');
                void (async () => {
                    const original = await apiGet<OperationsByKeyResponse>(ROUTES.operationsByKey(run.requestKey));
                    if (original.data.operation.status !== 'accepted')
                        throw new Error('原调用状态待核对，请先核对原生成请求');
                    const pending = pendingCommands().find(item => item.requestKey === run.requestKey);
                    if (pending)
                        rememberCommand({ ...pending, phase: 'accepted' }); // Explicit server acceptance, not a guessed unlock.
                    const response = await apiPost<CommandResponse>(ROUTES.pptWorkStop(work.id), { requestKey: createRequestKey(), confirmStop: true });
                    setReceipt(response.data.receipt);
                    setConfirm(false);
                    await client.invalidateQueries({ queryKey: ['ppt', 'works'] });
                })().catch(caught => setError(errorMessage(caught))).finally(() => setBusy(false));
            }}>确认停止</Button></>}>只停止原生成，保留简报、方案、已有页面和版本。不会收到abort回执就宣称原进程已经结束。</Modal></>;
}
