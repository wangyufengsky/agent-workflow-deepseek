import { useQuery } from '@tanstack/react-query';
import { ROUTES, type TemplateRunInput, type TemplateRunInputContent } from '@agent-workflow/shared';
import { apiGet, ApiClientError } from '../../api/client.ts';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Badge } from '../../components/Badge.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
export function TemplateRunInputView({ taskId, input, line }: { readonly taskId: string; readonly input: TemplateRunInput; readonly line?: number }) {
  const query = useQuery({ queryKey: ['run-frozen-input', taskId, input.id, input.version, input.contentSha256], retry: false, enabled: input.available,
    queryFn: async () => { const value = (await apiGet<TemplateRunInputContent>(`${ROUTES.taskRunContent(taskId)}?inputId=${encodeURIComponent(input.id)}&version=${encodeURIComponent(input.version)}&sha256=${encodeURIComponent(input.contentSha256)}`)).data; if (value.taskId !== taskId || value.inputId !== input.id || value.version !== input.version || value.contentSha256 !== input.contentSha256) throw new ApiClientError({ kind: 'protocol', message: '冻结输入身份或版本不一致，请重新读取运行内容' }); return value; } });
  const data = query.error || query.isFetching ? undefined : query.data;
  return <section className="run-frozen-reader"><div className="row wrap"><Badge icon="lock">冻结原文</Badge><h3>{input.name}</h3><Button size="sm" icon="refresh" onClick={() => { void query.refetch(); }}>重新读取</Button></div><p className="hint">版本 {input.version} · {input.bytes} 字节；不会读取当前项目文件替代。</p>
    {!input.available ? <p><Icon name="info" />{input.reason}</p> : query.isFetching ? <p role="status">正在核对冻结输入版本…</p> : query.error ? <ServiceNotice error={query.error} onRetry={() => { void query.refetch(); }} /> : data ? <>{data.truncated ? <p className="banner warn"><Icon name="alert" />正文超过单次阅读上限，当前展示前128000字符；此节选不代表已读全文。</p> : null}<div className="run-source-code" role="region" aria-label="冻结原文正文">{data.content.split('\n').map((text, index) => <div key={index} className={line === index + 1 ? 'hit' : ''}><span>{index + 1}</span><code>{text || ' '}</code></div>)}</div></> : null}
  </section>;
}
