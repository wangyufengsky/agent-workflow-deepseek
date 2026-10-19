import type { PublicSettings } from '@agent-workflow/shared';
import { Button } from '../../components/Button.tsx';
import { PendingBackendNotice } from '../../components/ServiceNotice.tsx';
import { SettingsHeading, SettingsRow } from './shared.tsx';

const SAVE_BLOCKED_REASON = 'Git 账号写入接口尚未接通（服务端设置写入未就绪）。';
const VERIFY_BLOCKED_REASON = '服务端未提供 Git 连接校验接口。';

export function GitSection({ settings }: { readonly settings: PublicSettings }) {
  const git = settings.git;

  return (
    <div className="sect">
      <SettingsHeading title="Git 账号" lede="全局 Git 身份与 Provider；访问令牌只保存在服务端凭据存储，界面不展示。" readOnly />

      <div className="card card-sec">
        <SettingsRow label="提交作者名称">
          <input className="input" readOnly value={git.author.name} aria-label="提交作者名称" />
        </SettingsRow>
        <SettingsRow label="提交作者邮箱">
          <input className="input mono" readOnly value={git.author.email} aria-label="提交作者邮箱" />
        </SettingsRow>
        <SettingsRow label="默认 Provider" hint="创建合并请求时默认使用">
          <select className="select" disabled value={git.defaultProvider} aria-label="默认 Git Provider">
            <option value="github">GitHub</option>
            <option value="gitlab">GitLab</option>
          </select>
        </SettingsRow>
        <SettingsRow label="GitHub 地址">
          <input className="input mono" readOnly value={git.github.baseUrl} aria-label="GitHub 地址" />
        </SettingsRow>
        <SettingsRow label="GitHub API">
          <input className="input mono" readOnly value={git.github.apiBaseUrl} aria-label="GitHub API 地址" />
        </SettingsRow>
        <SettingsRow label="GitLab 地址">
          <input className="input mono" readOnly value={git.gitlab.baseUrl} aria-label="GitLab 地址" />
        </SettingsRow>
        <SettingsRow label="GitLab API">
          <input className="input mono" readOnly value={git.gitlab.apiBaseUrl} aria-label="GitLab API 地址" />
        </SettingsRow>
        <SettingsRow label="工作区分支前缀">
          <span className="mono">{git.branchPrefix}</span>
        </SettingsRow>
        <SettingsRow label="工作区根目录">
          <span className="mono-wrap">{git.worktreeRoot}</span>
        </SettingsRow>
        <SettingsRow label="默认测试命令">
          <span className="mono-wrap">{git.defaultTestCommand.length === 0 ? '未配置' : git.defaultTestCommand}</span>
        </SettingsRow>
        <SettingsRow label="超时" hint="获取与命令执行">
          <span className="hint">
            获取 {String(Math.round(git.fetchTimeoutMs / 1000))} 秒 · 命令 {String(Math.round(git.commandTimeoutMs / 1000))} 秒
          </span>
        </SettingsRow>
      </div>

      <div className="row wrap" style={{ marginTop: 16, gap: 8 }}>
        <Button variant="secondary" icon="link" disabled disabledReason={VERIFY_BLOCKED_REASON}>
          验证连接
        </Button>
        <Button variant="primary" icon="check" disabled disabledReason={SAVE_BLOCKED_REASON}>
          保存 Git 账号
        </Button>
      </div>

      <PendingBackendNotice
        className="settings-note"
        message="Git 账号与 Provider 表单为只读占位：保存、验证与令牌写入在服务端接口接通后开放；界面不会收集令牌。"
      />
    </div>
  );
}
