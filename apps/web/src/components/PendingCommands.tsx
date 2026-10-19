import { useEffect, useState } from 'react';
import { ROUTES, type OperationsByKeyResponse } from '@agent-workflow/shared';
import { apiGet, errorMessage } from '../api/client.ts';
import { pendingCommands, subscribePending } from '../api/pending-commands.ts';
import { Button } from './Button.tsx';
import { Icon } from './Icon.tsx';
/** Survives routing and reload. Reconciliation only reads the original operation. */
export function PendingCommands() {
  const [commands, setCommands] = useState(pendingCommands);
  const [message, setMessage] = useState('');
  const [checking, setChecking] = useState(false);
  useEffect(() => subscribePending(() => setCommands(pendingCommands())), []);
  if (commands.length === 0) return null;
  const unknown = commands.some((command) => command.phase !== 'accepted' && command.phase !== 'sending');
  return <div className={`banner ${unknown ? 'unknown' : 'info'}`} role={unknown ? 'alert' : 'status'}><Icon name={unknown ? 'help' : 'clock'} /><div className="grow"><b>{unknown ? '操作结果待核对' : commands.some((command) => command.phase === 'sending') ? '正在发送请求，等待回执' : '请求已受理，等待完成'}</b>{commands.map((command) => <div key={command.requestKey}>{command.phase === 'sending' ? '发送中' : command.phase === 'accepted' ? '已受理' : '待核对'} · 请求号 {command.requestKey}</div>)}{message}</div><Button disabled={checking} onClick={() => {
    setChecking(true);
    void Promise.all(commands.map(async (command) => {
      const response = await apiGet<OperationsByKeyResponse>(ROUTES.operationsByKey(command.requestKey));
      const status = response.data.operation.status;
      return `${command.requestKey}：${status === 'accepted' ? '已受理，等待完成' : status === 'unknown' ? '结果待核对' : status === 'succeeded' ? '已完成' : '已失败'}`;
    })).then((results) => setMessage(results.join('；'))).catch((error: unknown) => setMessage(`仍待核对：${errorMessage(error)}`)).finally(() => setChecking(false));
  }}>核对原操作</Button></div>;
}
