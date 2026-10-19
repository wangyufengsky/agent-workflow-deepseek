import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ROUTES, type AvailableModel, type AvailableModelCatalog } from '@agent-workflow/shared';
import { apiGet, errorMessage } from '../../api/client.ts';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { SettingsRow } from './shared.tsx';

export function ModelCatalogPicker({ ready, saving, preferred, onSelect }: { readonly ready: boolean; readonly saving: boolean; readonly preferred?: { readonly provider: string; readonly model: string }; readonly onSelect: (model: AvailableModel) => void }) {
  const [provider, setProvider] = useState(preferred?.provider ?? '');
  const [model, setModel] = useState(preferred?.model ?? '');
  const catalog = useQuery({ queryKey: ['opencode', 'models'], queryFn: async () => (await apiGet<AvailableModelCatalog>(ROUTES.opencodeModels, { timeoutMs: 45000 })).data, enabled: ready, retry: false, staleTime: 60000 });
  const choices = catalog.data?.models ?? [];
  const providerId = choices.some((choice) => choice.provider === provider) ? provider : choices[0]?.provider ?? '';
  const models = choices.filter((choice) => choice.provider === providerId);
  const selected = models.find((choice) => choice.model === model) ?? models[0];
  return <SettingsRow label="默认模型" hint="从当前 OpenCode 读取已连接提供方的可用模型；明确保存后用于四种默认职责的新会话。">
    {catalog.isFetching ? <div className="row hint" role="status"><Icon name="clock" />正在读取可用模型（最多 40 秒）…</div> : <div className="row wrap">
      <select className="select" aria-label="可用模型提供方" value={providerId} disabled={!ready || catalog.isError || choices.length === 0} onChange={(event) => { setProvider(event.target.value); setModel(''); }}><option value="" disabled>选择提供方</option>{[...new Map(choices.map((item) => [item.provider, item.providerLabel])).entries()].map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
      <select className="select" aria-label="可用模型" value={selected?.model ?? ''} disabled={!ready || catalog.isError || !selected} onChange={(event) => setModel(event.target.value)}><option value="" disabled>选择模型</option>{models.map((item) => <option key={item.model} value={item.model}>{item.label}</option>)}</select>
      <Button size="sm" icon="refresh" disabled={!ready} disabledReason="OpenCode尚未就绪，请先启动运行环境" onClick={() => { void catalog.refetch(); }}>刷新模型列表</Button>
      <Button size="sm" variant="primary" icon="check" disabled={!ready || saving || catalog.isError || !selected} disabledReason={saving ? '正在保存模型' : !ready ? 'OpenCode尚未就绪' : catalog.isError ? '先重新读取模型目录' : !selected ? '尚无可用模型' : undefined} onClick={() => { if (selected) onSelect(selected); }}>设为默认模型</Button>
    </div>}
    {!ready ? <p className="hint">OpenCode 尚未就绪；已保存模型档案仍保留。</p> : catalog.isError ? <p className="hint" role="alert"><Icon name="alert" />{errorMessage(catalog.error)}；旧目录仅供查看，重新读取后才能选择。</p> : catalog.data ? <p className="hint">共 {choices.length} 个可用模型 · {new Date(catalog.data.readAt).toLocaleTimeString('zh-CN')} 读取{choices.length === 0 ? '；请先在 OpenCode 配置提供方认证。' : ''}</p> : null}
  </SettingsRow>;
}
