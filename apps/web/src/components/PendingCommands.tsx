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
  return <div className="banner unknown" role="alert"><Icon name="help" /><div className="grow"><b>操作结果待核对</b>{commands.map((command) => <div key={command.requestKey}>请求号 {command.requestKey} · {command.path}</div>)}{message}</div><Button disabled={checking} onClick={() => {
    setChecking(true);
    void Promise.all(commands.map(async (command) => {
      const response = await apiGet<OperationsByKeyResponse>(ROUTES.operationsByKey(command.requestKey));
      return `${command.requestKey}：${response.data.operation.status}`;
    })).then((results) => setMessage(results.join('；'))).catch((error: unknown) => setMessage(`仍待核对：${errorMessage(error)}`)).finally(() => setChecking(false));
  }}>核对原操作</Button></div>;
}
