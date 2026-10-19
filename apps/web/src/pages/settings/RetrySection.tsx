import type { PublicSettings } from '@agent-workflow/shared';
import { Badge } from '../../components/Badge.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ReadOnlyValue, SettingsHeading, SettingsRow } from './shared.tsx';

/**
 * 重试等待：设计稿要求按模型限流 / 会话错误 / 验证失败分别配置初始与最长等待。
 * shared settings 没有这些字段，因此只展示真实存在的规划传输重试次数，并明确其余不可用。
 */
export function RetrySection({ settings }: { readonly settings: PublicSettings }) {
  return (
    <div className="sect">
      <SettingsHeading title="重试等待" lede="设计稿要求按模型限流、会话错误与验证失败分别设置初始 / 最长等待；当前共享设置没有这些字段。" />
      <div className="card card-sec">
        {[
          ['模型限流重试等待', '遇到 provider 限流时的重试等待'],
          ['会话错误重试等待', 'OpenCode 会话异常时的重试等待'],
          ['验证失败重试等待', '验证命令失败后的重试等待'],
        ].map(([label, hint]) => (
          <SettingsRow key={label} label={label} hint={hint} effect="unavailable">
            <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
              <input className="input" disabled placeholder="服务未提供" aria-label={`${label}（服务未提供）`} style={{ width: 140 }} />
              <Badge tone="unknown" icon="lock">服务未提供</Badge>
              <span className="hint">初始 / 最长等待均不可编辑</span>
            </div>
          </SettingsRow>
        ))}
        <SettingsRow label="规划传输重试次数" hint="现有 planning.transportRetries；本页只读，不纳入下方保存条。">
          <ReadOnlyValue>{String(settings.planning.transportRetries)} 次</ReadOnlyValue>
        </SettingsRow>
      </div>
      <p className="hint" style={{ marginTop: 14, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        <Icon name="info" size="sm" />
        页面不会为缺失字段提供可编辑控件；等共享契约补齐后再接入。
      </p>
    </div>
  );
}
