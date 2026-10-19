import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createRequestKey, ROUTES, type OperationRecord, type RuntimeOperationHistoryResponse, type OpenCodeRestartResponse } from '@agent-workflow/shared';
import { apiGet, apiPost, ApiClientError, errorMessage } from '../../api/client.ts';
import { Button } from '../../components/Button.tsx';
import { Modal } from '../../components/Modal.tsx';
import { Badge } from '../../components/Badge.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { formatAbsoluteTime } from '../../app/format.ts';

const RECEIPT_LABEL: Record<string, string> = { accepted: '已受理', succeeded: '已成功', failed: '已失败', unknown: '结果未知' };
export function RuntimeControls({ state, blockedReason, onRefresh }: { readonly state: string | null; readonly blockedReason?: string; readonly onRefresh: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [message, setMessage] = useState('');
  const history = useQuery({ queryKey: ['runtime-operations'], queryFn: async () => (await apiGet<RuntimeOperationHistoryResponse>(ROUTES.opencodeOperations)).data.operations, retry: false });
  const action = state === 'stopped' || state === 'failed' ? 'start' : 'restart';
  const label = action === 'start' ? '启动' : '重启';
  const execute = async () => {
    const key = createRequestKey(); setPending(key); setConfirm(false); setMessage('');
    try {
      const result = (await apiPost<OpenCodeRestartResponse>(action === 'start' ? ROUTES.opencodeStart : ROUTES.opencodeRestart, { requestKey: key, [action === 'start' ? 'confirmStart' : 'confirmRestart']: true })).data;
      const settled = result.receipt.status === 'succeeded' || result.receipt.status === 'failed';
      setUnknown(!settled); if (settled) setPending(null);
      setMessage(`原操作回执：${RECEIPT_LABEL[result.receipt.status] ?? result.receipt.status}。${settled ? '' : '请按原请求号核对，不能重复提交。'}`);
    } catch (error) {
      const uncertain = error instanceof ApiClientError && ['unavailable', 'timeout', 'protocol'].includes(error.kind);
      setUnknown(uncertain); if (!uncertain) setPending(null);
      setMessage(uncertain ? '操作结果未知，请核对原请求；当前进程状态不能证明该操作成功。' : errorMessage(error));
    } finally { onRefresh(); void history.refetch(); }
  };
  const reconcile = async () => {
    if (pending === null) return;
    try {
      const result = (await apiGet<{ operation: OperationRecord }>(`/api/operations/${encodeURIComponent(pending)}`)).data.operation;
      setMessage(`原请求回执：${RECEIPT_LABEL[result.status] ?? result.status}${result.error === undefined ? '' : ` · ${result.error.message}`}`);
      if (result.status === 'succeeded' || result.status === 'failed') { setPending(null); setUnknown(false); }
      void history.refetch(); onRefresh();
    } catch (error) { setMessage(errorMessage(error)); }
  };
  return <section className="card pad" style={{ marginTop: 16 }}>
    <div className="row wrap"><b className="grow">运行时操作</b><Button icon="refresh" variant="secondary" disabled={blockedReason !== undefined || pending !== null} disabledReason={blockedReason ?? (pending !== null ? '原操作尚未核对完成' : undefined)} onClick={() => setConfirm(true)}>{label} OpenCode</Button><Button size="sm" onClick={() => { void history.refetch(); }}>读取历史</Button></div>
    {message === '' ? null : <p role="status" className="hint">{message}{pending === null ? '' : ` 请求号：${pending}`}</p>}
    {unknown ? <Button size="sm" icon="refresh" onClick={() => { void reconcile(); }}>核对原请求</Button> : null}
    <p className="hint">历史来自本机操作回执，保留启动与重启的真实结果；服务启动时的自动拉起不伪装成手动操作。</p>
    {history.isError ? <ServiceNotice error={history.error} /> : history.isLoading ? <p className="hint">正在读取操作历史…</p> : history.data?.length === 0 ? <p className="hint">暂无手动启动或重启记录。</p> : history.data?.map((operation) => <div className="row wrap" key={operation.requestKey} style={{ marginTop: 8 }}><Badge icon={operation.status === 'succeeded' ? 'check' : operation.status === 'failed' ? 'alert' : 'clock'}>{RECEIPT_LABEL[operation.status] ?? operation.status}</Badge><span>{operation.operation === 'opencode.start' ? '启动' : '重启'} · {formatAbsoluteTime(operation.acceptedAt)}</span><span className="hint mono-wrap">{operation.requestKey} {operation.error?.message}</span></div>)}
    <Modal open={confirm} title={`确认${label} OpenCode`} onClose={() => setConfirm(false)} footer={<><Button onClick={() => setConfirm(false)}>取消</Button><Button variant="primary" onClick={() => { void execute(); }}>确认{label}</Button></>}><p>当前状态：{state ?? '未知'}。此确认仅表示本次操作意图，提交后以原请求回执核对结果。</p><p>重启会结束运行时会话。服务会拒绝存在活动或待核对任务、规划、知识对话的重启；请先停止并核对它们。</p></Modal>
  </section>;
}
