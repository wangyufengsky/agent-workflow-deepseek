import { DisplayMode, type PublicSettings } from '@agent-workflow/shared';
import { PendingBackendNotice } from '../../components/ServiceNotice.tsx';
import { SettingsHeading, SettingsRow } from './shared.tsx';
import { ThemeSelector } from './ThemeSelector.tsx';

const DISPLAY_MODE_LABEL: Record<'present' | 'review', string> = {
  [DisplayMode.PRESENT]: '展示',
  [DisplayMode.REVIEW]: '审阅',
};

export function AppearanceSection({ settings }: { readonly settings?: PublicSettings }) {
  return (
    <div className="sect">
      <SettingsHeading title="外观" lede="四套主题完全由 packages/shared 的主题配置驱动：只替换 CSS 变量，不影响任务数据。" />
      <ThemeSelector />

      {settings === undefined ? (
        <PendingBackendNotice
          className="settings-note"
          message="服务未连接，只读设置值暂不可读；主题仍可立即在本地切换并写入 URL。"
        />
      ) : (
        <div className="card card-sec">
          <SettingsRow label="显示模式" hint="顶栏「展示 / 审阅」切换后立即生效">
            <span style={{ fontSize: 13.5 }}>{DISPLAY_MODE_LABEL[settings.ui.displayMode]}</span>
          </SettingsRow>
          <SettingsRow label="减少动态效果" hint="跟随系统 prefers-reduced-motion">
            <span style={{ fontSize: 13.5 }}>{settings.ui.reducedMotion ? '已开启' : '跟随系统'}</span>
          </SettingsRow>
          <SettingsRow label="界面语言">
            <span style={{ fontSize: 13.5 }}>{settings.ui.locale === 'zh-CN' ? '中文（简体）' : settings.ui.locale}</span>
          </SettingsRow>
          <SettingsRow label="侧栏收起" hint="宽屏下默认展开，窄屏（≤1024px）自动收起为图标栏">
            <span style={{ fontSize: 13.5 }}>{settings.ui.sidebarCollapsed ? '已收起' : '展开'}</span>
          </SettingsRow>
        </div>
      )}

      <p className="hint" style={{ marginTop: 14 }}>
        只有外观在本地生效；其余设置项的保存需要服务端设置接口接通。
      </p>
    </div>
  );
}
