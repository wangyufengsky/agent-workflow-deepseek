import type { GitMergeRequest } from '@agent-workflow/shared';
import { Badge } from '../../components/Badge.tsx';
import { EmptyState, Skeleton } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { CopyText } from './git-shared.tsx';
import { FailureNotice, MR_STATE_LABEL, formatTime, formatAbsolute, mrStateTone } from './git-shared.tsx';

export interface MergeRequestsPanelProps {
  readonly mergeRequests: readonly GitMergeRequest[];
  readonly loading: boolean;
  readonly error: unknown;
  readonly onRetry: () => void;
  readonly selectedIid: number | null;
  readonly onSelect: (mr: GitMergeRequest) => void;
  readonly gitlabConfigured: boolean;
}

function PipelineBadge({ status }: { readonly status: string }) {
  const tone = status === 'success' ? 'ok' : status === 'failed' ? 'danger' : status === 'running' || status === 'pending' ? 'run' : 'neutral';
  return (
    <Badge tone={tone} icon={status === 'success' ? 'check' : status === 'failed' ? 'alert' : 'clock'}>
      流水线 {status}
    </Badge>
  );
}

/** 合并请求列表（GitLab 只读投影）。 */
export function MergeRequestsPanel({ mergeRequests, loading, error, onRetry, selectedIid, onSelect, gitlabConfigured }: MergeRequestsPanelProps) {
  if (!gitlabConfigured) {
    return (
      <div className="git-mid-empty">
        <EmptyState
          compact
          icon="lock"
          title="GitLab 未配置"
          description="合并请求来自 GitLab 只读投影。本地提交仍可浏览；配置连接后这里才会出现真实 MR。"
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: 12 }}>
        {[0, 1, 2].map((index) => (
          <div key={index} className="stack-tight" style={{ padding: '8px 2px' }}>
            <Skeleton width="72%" height={11} />
            <Skeleton width="44%" height={9} />
          </div>
        ))}
      </div>
    );
  }

  if (error !== null && error !== undefined) {
    return (
      <div style={{ padding: 12 }}>
        <FailureNotice error={error} onRetry={onRetry} compact />
      </div>
    );
  }

  if (mergeRequests.length === 0) {
    return (
      <div className="git-mid-empty">
        <EmptyState compact icon="gitRepo" title="没有合并请求" description="GitLab 没有返回合并请求；产品内不提供合并操作，合并在 GitLab 完成。" />
      </div>
    );
  }

  return (
    <div className="mr-list" role="list">
      {mergeRequests.map((mr) => (
        <button
          key={mr.iid}
          type="button"
          className="mr-card"
          role="listitem"
          aria-selected={mr.iid === selectedIid}
          onClick={() => { onSelect(mr); }}
        >
          <span className="row-wrap">
            <Badge tone={mrStateTone(mr.state)}>{MR_STATE_LABEL[mr.state]}</Badge>
            {mr.draft ? <Badge tone="idle">草稿</Badge> : null}
            {mr.hasConflicts ? <Badge tone="danger" icon="alert">冲突</Badge> : null}
            <span className="mr-meta" style={{ marginLeft: 'auto' }}>!{String(mr.iid)}</span>
          </span>
          <span className="mr-title">{mr.title}</span>
          <span className="mr-branches">
            {mr.sourceBranch} → {mr.targetBranch}
          </span>
          <span className="mr-meta">
            <span>{mr.author.name}</span>
            <span>·</span>
            <span>{formatTime(mr.updatedAt)}</span>
            {mr.pipeline === undefined || mr.pipeline === null ? null : <PipelineBadge status={mr.pipeline.status} />}
            {mr.approvals === undefined || mr.approvals === null ? null : (
              <Badge tone={mr.approvals.given >= mr.approvals.required ? 'ok' : 'wait'} icon="check">
                审批 {String(mr.approvals.given)}/{String(mr.approvals.required)}
              </Badge>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}

/** 右栏合并请求详情：只读；合并动作只在 GitLab 进行。 */
export function MergeRequestDetail({ mr }: { readonly mr: GitMergeRequest }) {
  return (
    <div className="stack-loose">
      <div className="mr-detail-head">
        <div className="row-wrap">
          <Badge tone={mrStateTone(mr.state)} icon={mr.state === 'opened' ? 'run' : mr.state === 'merged' ? 'check' : 'x'}>
            {MR_STATE_LABEL[mr.state]}
          </Badge>
          {mr.draft ? <Badge tone="idle">草稿</Badge> : null}
          {mr.hasConflicts ? <Badge tone="danger" icon="alert">存在冲突</Badge> : null}
          <span className="grow" />
          <span className="mono-sm">!{String(mr.iid)}</span>
        </div>
        <h2 className="mr-detail-title">{mr.title}</h2>
        <div className="mr-meta">
          <span className="mr-branches">
            {mr.sourceBranch} → {mr.targetBranch}
          </span>
          <span>·</span>
          <span>{mr.author.name}</span>
          <span>·</span>
          <span>更新于 {formatAbsolute(mr.updatedAt)}</span>
        </div>
      </div>

      <div className="radio-card-list">
        <div className="radio-card" style={{ cursor: 'default' }}>
          <Icon name="info" />
          <span>
            <span className="radio-title">合并请求是 GitLab 的独立事实</span>
            <span className="radio-desc">
              产品内不提供合并按钮。合并、关闭与流水线都在 GitLab 完成；MR 未合并不影响任务交付记录。
            </span>
          </span>
        </div>
      </div>

      <div className="mr-facts">
        <div className="git-stat">
          <span className="l">源分支</span>
          <span className="v mono">{mr.sourceBranch}</span>
        </div>
        <div className="git-stat">
          <span className="l">目标分支</span>
          <span className="v mono">{mr.targetBranch}</span>
        </div>
        <div className="git-stat">
          <span className="l">流水线</span>
          <span className="v">{mr.pipeline === undefined || mr.pipeline === null ? '—' : mr.pipeline.status}</span>
        </div>
        <div className="git-stat">
          <span className="l">审批</span>
          <span className="v">
            {mr.approvals === undefined || mr.approvals === null
              ? '—'
              : `${String(mr.approvals.given)} / ${String(mr.approvals.required)}`}
          </span>
        </div>
      </div>

      <div className="row-wrap">
        <a className="btn secondary" href={mr.webUrl} target="_blank" rel="noreferrer noopener">
          <Icon name="external" size="sm" />
          在 GitLab 打开
        </a>
        <CopyText value={mr.webUrl} label="MR 链接" />
      </div>
      <p className="muted-note">链接由服务端的 GitLab 连接返回；界面不拼接外部地址，也不读取凭据。</p>
    </div>
  );
}
