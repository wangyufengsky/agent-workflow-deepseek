import type { PublicSettings } from '@agent-workflow/shared';
import { DraftNumberControl, useSettingsDraft } from './draft.tsx';
import { SettingsHeading, SettingsRow } from './shared.tsx';

export function RetrySection({ settings }: { readonly settings: PublicSettings }) {
  const draft = useSettingsDraft();
  return <div className="sect">
    <SettingsHeading title="重试等待" lede="明确选择重试后，等待从初始值逐次翻倍，不超过最长值。结果未知时先核对原操作。" />
    <div className="card card-sec">
      {([['modelRateLimit', '模型限流'], ['sessionError', '会话错误'], ['verificationFailure', '验证失败']] as const).map(([key, label]) => {
        const initialPath = `execution.retryDelays.${key}.initialMs`; const maxPath = `execution.retryDelays.${key}.maxMs`;
        const initial = draft.fields[initialPath]?.value ?? settings.execution.retryDelays[key].initialMs;
        const maximum = draft.fields[maxPath]?.value ?? settings.execution.retryDelays[key].maxMs;
        return <SettingsRow key={key} label={label} effect="new_execution" dirty={draft.fields[initialPath] !== undefined || draft.fields[maxPath] !== undefined}>
          <div className="row wrap" style={{ gap: 16, alignItems: 'flex-start' }}>
            <div className="col" style={{ gap: 4 }}><span className="hint">初始</span><DraftNumberControl compact path={initialPath} label={`${label} · 初始等待`} section="retry" baseline={settings.execution.retryDelays[key].initialMs} min={0} max={600} unit="秒" factor={1000} effect="new_execution" /></div>
            <div className="col" style={{ gap: 4 }}><span className="hint">最长</span><DraftNumberControl compact path={maxPath} label={`${label} · 最长等待`} section="retry" baseline={settings.execution.retryDelays[key].maxMs} min={0} max={3600} unit="秒" factor={1000} effect="new_execution" /></div>
          </div>
          {typeof initial === 'number' && typeof maximum === 'number' && maximum < initial ? <p className="hint" role="alert" style={{ color: 'var(--danger)' }}>最长等待不能小于初始等待，保存时服务将拒绝这组值。</p> : null}
        </SettingsRow>;
      })}
    </div>
    <p className="hint" style={{ marginTop: 14 }}>保存后用于新任务与新执行；已有任务保留冻结配置。0 秒表示不额外等待。</p>
  </div>;
}
