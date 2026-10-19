import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createRequestKey, type GitConnectionStatus, type PublicSettings } from '@agent-workflow/shared';
import { apiGet, apiPost, errorMessage, isServiceUnavailable, request } from '../../api/client.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { SettingsHeading, SettingsRow } from './shared.tsx';

interface GitConnectionState {
  readonly provider: 'github' | 'gitlab';
  readonly state: GitConnectionStatus['state'];
  readonly hostDisplayName?: string;
  readonly accountUsername?: string;
  readonly lastVerifiedAt?: string;
  readonly message?: string;
}

interface GitSettingsResponse {
  readonly connection: {
    readonly github: GitConnectionState;
    readonly gitlab: GitConnectionState;
    readonly defaultProvider: 'github' | 'gitlab';
  };
}

const STATE_LABEL: Record<GitConnectionStatus['state'], string> = {
  connected: '已连接',
  not_configured: '未配置',
  auth_failed: '认证失败',
  unreachable: '不可达',
};

function stateTone(state: GitConnectionStatus['state']): 'ok' | 'warn' | 'fail' | 'idle' {
  if (state === 'connected') return 'ok';
  if (state === 'auth_failed') return 'fail';
  if (state === 'unreachable') return 'warn';
  return 'idle';
}

export function GitSection({ settings }: { readonly settings: PublicSettings }) {
  const queryClient = useQueryClient();
  const git = settings.git;
  const [authorName, setAuthorName] = useState(git.author.name);
  const [authorEmail, setAuthorEmail] = useState(git.author.email);
  const [provider, setProvider] = useState<'github' | 'gitlab'>(git.defaultProvider);
  const [githubBase, setGithubBase] = useState(git.github.baseUrl);
  const [githubApi, setGithubApi] = useState(git.github.apiBaseUrl);
  const [gitlabBase, setGitlabBase] = useState(git.gitlab.baseUrl);
  const [gitlabApi, setGitlabApi] = useState(git.gitlab.apiBaseUrl);
  const [token, setToken] = useState('');
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);

  const connectionQuery = useQuery({
    queryKey: ['git', 'connection'],
    queryFn: async () => (await apiGet<GitSettingsResponse>('/api/settings/git')).data,
    retry: false,
    refetchInterval: 30_000,
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['settings'] }),
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
      queryClient.invalidateQueries({ queryKey: ['git', 'connection'] }),
    ]);
  };

  const saveAccount = useMutation({
    mutationFn: async () => {
      const response = await request<unknown>('/api/settings', {
        method: 'PATCH',
        body: {
          requestKey: createRequestKey(),
          patch: {
            git: {
              author: { name: authorName.trim(), email: authorEmail.trim() },
              defaultProvider: provider,
              github: { baseUrl: githubBase.trim(), apiBaseUrl: githubApi.trim() },
              gitlab: { baseUrl: gitlabBase.trim(), apiBaseUrl: gitlabApi.trim() },
            },
          },
        },
      });
      return response.data;
    },
    onSuccess: async () => {
      setFailure(undefined);
      setNotice('Git 账号设置已保存');
      await invalidate();
    },
    onError: (error) => setFailure(isServiceUnavailable(error) ? '服务未连接，设置未保存' : errorMessage(error)),
  });

  const saveToken = useMutation({
    mutationFn: async () => {
      const response = await apiPost<{ connection: GitConnectionState }>('/api/settings/gitlab', {
        requestKey: createRequestKey(),
        provider,
        baseUrl: provider === 'github' ? githubBase.trim() : gitlabBase.trim(),
        apiBaseUrl: provider === 'github' ? githubApi.trim() : gitlabApi.trim(),
        token: token.trim(),
      });
      return response.data.connection;
    },
    onSuccess: async (connection) => {
      setToken('');
      setFailure(undefined);
      setNotice(
        connection.state === 'connected'
          ? `连接成功：${connection.accountUsername ?? connection.hostDisplayName ?? ''}`
          : `连接结果：${STATE_LABEL[connection.state]}${connection.message === undefined ? '' : ` · ${connection.message}`}`,
      );
      await invalidate();
    },
    onError: (error) => setFailure(isServiceUnavailable(error) ? '服务未连接，令牌未保存' : errorMessage(error)),
  });

  const testConnection = useMutation({
    mutationFn: async () => {
      const response = await apiPost<{ connection: GitConnectionState }>('/api/settings/gitlab/test', { provider });
      return response.data.connection;
    },
    onSuccess: async (connection) => {
      setFailure(undefined);
      setNotice(`连接检查：${STATE_LABEL[connection.state]}${connection.message === undefined ? '' : ` · ${connection.message}`}`);
      await invalidate();
    },
    onError: (error) => setFailure(isServiceUnavailable(error) ? '服务未连接，无法验证' : errorMessage(error)),
  });

  const connection = connectionQuery.data?.connection;
  const current = connection?.[provider];

  return (
    <div className="sect">
      <SettingsHeading title="Git 账号" lede="提交作者、Provider 地址与访问令牌。令牌只保存在服务端加密凭据存储，界面不回显。" />

      <div className="card card-sec">
        <SettingsRow label="提交作者名称">
          <input className="input" value={authorName} onChange={(event) => setAuthorName(event.target.value)} aria-label="提交作者名称" />
        </SettingsRow>
        <SettingsRow label="提交作者邮箱">
          <input className="input mono" value={authorEmail} onChange={(event) => setAuthorEmail(event.target.value)} aria-label="提交作者邮箱" />
        </SettingsRow>
        <SettingsRow label="默认 Provider" hint="推送 / 合并请求默认使用">
          <select className="select" value={provider} onChange={(event) => setProvider(event.target.value === 'gitlab' ? 'gitlab' : 'github')} aria-label="默认 Git Provider">
            <option value="github">GitHub</option>
            <option value="gitlab">GitLab</option>
          </select>
        </SettingsRow>
        <SettingsRow label="GitHub 地址">
          <input className="input mono" value={githubBase} onChange={(event) => setGithubBase(event.target.value)} aria-label="GitHub 地址" />
        </SettingsRow>
        <SettingsRow label="GitHub API">
          <input className="input mono" value={githubApi} onChange={(event) => setGithubApi(event.target.value)} aria-label="GitHub API 地址" />
        </SettingsRow>
        <SettingsRow label="GitLab 地址">
          <input className="input mono" value={gitlabBase} onChange={(event) => setGitlabBase(event.target.value)} aria-label="GitLab 地址" />
        </SettingsRow>
        <SettingsRow label="GitLab API">
          <input className="input mono" value={gitlabApi} onChange={(event) => setGitlabApi(event.target.value)} aria-label="GitLab API 地址" />
        </SettingsRow>
        <SettingsRow label="工作区分支前缀" hint="每个任务独立分支">
          <span className="mono">{git.branchPrefix}</span>
        </SettingsRow>
        <SettingsRow label="工作区根目录">
          <span className="mono-wrap">{git.worktreeRoot}</span>
        </SettingsRow>
        <SettingsRow label="默认测试命令" hint="执行阶段 workspace.exec 白名单">
          <span className="mono-wrap">{git.defaultTestCommand.length === 0 ? '未配置（模型不能执行命令）' : git.defaultTestCommand}</span>
        </SettingsRow>
      </div>

      <div className="row wrap" style={{ marginTop: 16, gap: 8 }}>
        <Button variant="primary" icon="check" disabled={saveAccount.isPending} onClick={() => saveAccount.mutate()}>
          {saveAccount.isPending ? '保存中…' : '保存 Git 账号'}
        </Button>
      </div>

      <div className="card card-sec" style={{ marginTop: 16 }}>
        <SettingsRow label="访问令牌" hint={`${provider === 'github' ? 'GitHub' : 'GitLab'} personal access token；只写不读`}>
          <input
            className="input mono"
            type="password"
            autoComplete="off"
            placeholder={current === undefined || current.state === 'not_configured' ? '未配置' : '已保存（如需更换请重新输入）'}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            aria-label="访问令牌"
          />
        </SettingsRow>
        <SettingsRow label="连接状态">
          <span className="row" style={{ gap: 8 }}>
            <Badge tone={current === undefined ? 'idle' : stateTone(current.state)}>{current === undefined ? '读取中' : STATE_LABEL[current.state]}</Badge>
            {current?.accountUsername === undefined ? null : <span className="mono">{current.accountUsername}</span>}
            {current?.message === undefined ? null : <span className="hint">{current.message}</span>}
          </span>
        </SettingsRow>
        <SettingsRow label="上次验证">
          <span className="hint">{current?.lastVerifiedAt === undefined ? '尚未验证' : new Date(current.lastVerifiedAt).toLocaleString('zh-CN')}</span>
        </SettingsRow>
      </div>

      <div className="row wrap" style={{ marginTop: 16, gap: 8 }}>
        <Button variant="secondary" icon="link" disabled={token.trim() === '' || saveToken.isPending} onClick={() => saveToken.mutate()}>
          {saveToken.isPending ? '保存并验证…' : '保存令牌并验证'}
        </Button>
        <Button variant="secondary" icon="check" disabled={testConnection.isPending} onClick={() => testConnection.mutate()}>
          {testConnection.isPending ? '验证中…' : '验证连接'}
        </Button>
      </div>

      {failure === undefined ? null : <p className="hint" style={{ marginTop: 12, color: 'var(--danger)' }}>{failure}</p>}
      {notice === undefined ? null : <p className="hint" style={{ marginTop: 12 }}>{notice}</p>}
      <p className="settings-note" style={{ marginTop: 12 }}>
        推送 / 创建合并请求使用这里的 Provider 与令牌；令牌只在服务端注入 git 进程的 http 头，不写入 remote URL、argv 或日志。
      </p>
    </div>
  );
}
