import { LinkButton } from '../../components/Button.tsx';
import { SettingsHeading, SettingsRow } from './shared.tsx';

/** 开发辅助：设计稿有示例数据开关；本产品约定不展示示例数据，因此明确不可用。 */
export function DevSection() {
  return (
    <div className="sect">
      <SettingsHeading title="开发辅助" lede="设计稿包含示例数据开关与开发期入口；本产品所有页面只读取真实服务数据。" />
      <div className="card card-sec">
        <SettingsRow label="显示示例数据" hint="设计稿状态开关；服务未提供该字段，不能开启。" effect="unavailable">
          <div className="col" style={{ gap: 6 }}>
            <label className="row" style={{ gap: 8, opacity: 0.6, whiteSpace: 'nowrap' }}>
              <input type="checkbox" disabled />
              显示示例数据
            </label>
            <span className="hint">产品约定不使用示例数据；不会在本机写入该开关。</span>
          </div>
        </SettingsRow>
        <SettingsRow label="运行日志" hint="OpenCode 日志、状态与受管进程在运行环境页查看。">
          <LinkButton to="/runtime" variant="secondary" size="sm" icon="server">
            打开运行环境
          </LinkButton>
        </SettingsRow>
      </div>
      <p className="hint" style={{ marginTop: 14 }}>
        本分区没有可保存字段，因此不会出现在未保存计数里。
      </p>
    </div>
  );
}
