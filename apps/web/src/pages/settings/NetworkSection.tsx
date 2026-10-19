import { isPublishHttpHost, type PublicSettings } from '@agent-workflow/shared';
import { DraftNumberRow, useSettingsDraft } from './draft.tsx';
import { SettingsHeading, SettingsRow } from './shared.tsx';

export function NetworkSection({ settings }: { readonly settings: PublicSettings }) {
  const draft = useSettingsDraft();
  const textRow = (path: string, label: string, baseline: string, hosts = false) => {
    const field = draft.fields[path];
    const value = field === undefined ? baseline : Array.isArray(field.value) ? field.value.join('\n') : String(field.value);
    const change = (value: string) => {
      const normalized = hosts ? value.split('\n').map((line) => line.trim().toLowerCase()).filter(Boolean) : value;
      let issue: string | undefined;
      if (hosts) { if ((normalized as string[]).length > 64 || (normalized as string[]).some((host) => !isPublishHttpHost(host))) issue = '每行一个主机名或主机名:端口，不含协议、路径或通配符，最多64项'; }
      else { try { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error(); } catch { issue = '填写无凭据的完整 HTTP(S) 地址'; } }
      draft.setField({ path, label, section: 'network', value, baseline, effect: 'live', issue });
    };
    return <SettingsRow key={path} label={label} hint={hosts ? '每行一个；HTTPS无需添加，HTTP只允许明确列出的主机。' : undefined} dirty={field !== undefined} effect="live"><div className="col">{hosts ? <textarea className="textarea mono" aria-label={label} value={value} onChange={(event) => change(event.target.value)} /> : <input className="input mono" aria-label={label} value={value} onChange={(event) => change(event.target.value)} />}{field?.issue ? <span className="hint" role="alert">{field.issue}</span> : null}</div></SettingsRow>;
  };
  return <div className="sect"><SettingsHeading title="发布网络" lede="发布到 GitLab 时使用的地址与超时；修改随底部“保存设置”一起保存，后续远端请求生效。" /><div className="card card-sec">
    {textRow('git.gitlab.baseUrl', 'GitLab 地址', settings.git.gitlab.baseUrl)}
    {textRow('git.gitlab.apiBaseUrl', 'API 地址', settings.git.gitlab.apiBaseUrl)}
    {textRow('git.network.allowedHttpHosts', '允许的 HTTP 主机', settings.git.network.allowedHttpHosts.join('\n'), true)}
    <DraftNumberRow path="git.network.connectTimeoutMs" label="连接超时" hint="建立网络连接的最长等待；用于 GitHub/GitLab API。" section="network" baseline={settings.git.network.connectTimeoutMs} min={1} max={120} factor={1000} unit="秒" />
    <DraftNumberRow path="git.network.requestTimeoutMs" label="请求超时" hint="包含响应正文读取的整次请求时限。" section="network" baseline={settings.git.network.requestTimeoutMs} min={1} max={300} factor={1000} unit="秒" />
  </div></div>;
}
