import { useEffect, useState } from 'react';
import type { PublicSettings } from '@agent-workflow/shared';
import { PendingBackendNotice } from '../../components/ServiceNotice.tsx';
import {
  applyMotionPreference,
  MOTION_OPTIONS,
  persistMotionPreference,
  resolveMotionPreference,
  type MotionPreference,
} from '../../theme/motion.ts';
import { SettingsHeading, SettingsRow } from './shared.tsx';
import { ThemeSelector } from './ThemeSelector.tsx';

export function AppearanceSection({ settings }: { readonly settings?: PublicSettings }) {
  const serviceReducedMotion = settings?.ui.reducedMotion;
  const [motion, setMotion] = useState<MotionPreference>(() => resolveMotionPreference(serviceReducedMotion));

  // The service value is the fallback default; re-resolve when bootstrap lands.
  useEffect(() => {
    setMotion(resolveMotionPreference(serviceReducedMotion));
  }, [serviceReducedMotion]);

  const changeMotion = (value: MotionPreference): void => {
    persistMotionPreference(value);
    applyMotionPreference(value);
    setMotion(value);
  };

  return (
    <div className="sect">
      <SettingsHeading title="外观" lede="四套主题完全由 packages/shared 的主题配置驱动：只替换 CSS 变量，不影响任务数据。" />
      <ThemeSelector />

      <div className="card card-sec">
        <SettingsRow
          label="减少动态效果"
          hint="跟随系统时，系统开启“减少动态效果”后自动关闭动画"
        >
          <select
            className="select"
            style={{ maxWidth: 220 }}
            aria-label="减少动态效果"
            value={motion}
            onChange={(event) => {
              changeMotion(event.target.value as MotionPreference);
            }}
          >
            {MOTION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </SettingsRow>
        <p className="hint" style={{ marginTop: 8 }}>
          {settings === undefined
            ? '设置值尚未读取；本机选择会立即生效并保存在本机。'
            : `本机偏好优先于服务端配置（服务端：${serviceReducedMotion === true ? '始终减少' : '跟随系统'}）。`}
        </p>
      </div>

      {settings === undefined ? (
        <PendingBackendNotice
          className="settings-note"
          message="设置值尚未读取；主题仍可立即在本地切换并写入 URL。"
        />
      ) : (
        <div className="card card-sec">
          <SettingsRow label="界面语言">
            <span style={{ fontSize: 13.5 }}>{settings.ui.locale === 'zh-CN' ? '中文（简体）' : settings.ui.locale}</span>
          </SettingsRow>
          <SettingsRow label="侧栏收起" hint="宽屏下默认展开，窄屏（≤1024px）自动收起为图标栏">
            <span style={{ fontSize: 13.5 }}>{settings.ui.sidebarCollapsed ? '已收起' : '展开'}</span>
          </SettingsRow>
        </div>
      )}
    </div>
  );
}
