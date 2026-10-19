import type { PublicSettings } from '@agent-workflow/shared';
import { LinkButton } from '../../components/Button.tsx';
import { SettingsHeading, SettingsRow, ReadOnlyValue } from './shared.tsx';

/**
 * 发布网络：共享设置里只有 Git 远端地址与超时，没有独立的发布网络字段。
 * 本页只读展示真实值，避免复制一套可编辑但无后端的假控件。
 */
export function NetworkSection({ settings }: { readonly settings: PublicSettings }) {
  const git = settings.git;
  return (
    <div className="sect">
      <SettingsHeading title="发布网络" lede="Git 远端发布地址与超时来自共享设置；本页只读，编辑在「Git 账号」分区。" readOnly />
      <div className="card card-sec">
        <SettingsRow label="GitHub 地址" hint="远端仓库地址与 API 地址">
          <div className="col" style={{ gap: 4 }}>
            <ReadOnlyValue><span className="mono-wrap">{git.github.baseUrl}</span></ReadOnlyValue>
            <ReadOnlyValue><span className="mono-wrap">{git.github.apiBaseUrl}</span></ReadOnlyValue>
          </div>
        </SettingsRow>
        <SettingsRow label="GitLab 地址" hint="远端仓库地址与 API 地址">
          <div className="col" style={{ gap: 4 }}>
            <ReadOnlyValue><span className="mono-wrap">{git.gitlab.baseUrl}</span></ReadOnlyValue>
            <ReadOnlyValue><span className="mono-wrap">{git.gitlab.apiBaseUrl}</span></ReadOnlyValue>
          </div>
        </SettingsRow>
        <SettingsRow label="工作区根目录" hint="任务隔离工作区的本机路径">
          <ReadOnlyValue><span className="mono-wrap">{git.worktreeRoot}</span></ReadOnlyValue>
        </SettingsRow>
        <SettingsRow label="任务分支前缀" hint="新任务分支的命名前缀">
          <ReadOnlyValue><span className="mono">{git.branchPrefix}</span></ReadOnlyValue>
        </SettingsRow>
        <SettingsRow label="网络超时" hint="获取远端与 Git 命令超时">
          <ReadOnlyValue>
            获取 {String(Math.round(git.fetchTimeoutMs / 1000))} 秒 · 命令 {String(Math.round(git.commandTimeoutMs / 1000))} 秒
          </ReadOnlyValue>
        </SettingsRow>
      </div>
      <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
        <LinkButton to="/settings?section=git" variant="secondary" icon="git">
          打开 Git 账号
        </LinkButton>
        <span className="hint">地址与超时只在 Git 账号分区保存；本页不提供第二套编辑控件。</span>
      </div>
    </div>
  );
}
