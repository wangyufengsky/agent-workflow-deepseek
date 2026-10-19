import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { FileChange, GitBranch, GitCommit, GitRepo, ReviewFinding } from '@agent-workflow/shared';
import { GIT_EMPTY_TREE_SHA, classifyGitFailure, fetchGitCommit, fetchGitCommitFiles, fetchReview, gitKeys } from '../../api/git.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { EmptyState, Skeleton } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { SegmentedControl } from '../../components/SegmentedControl.tsx';
import { DiffViewer } from './DiffViewer.tsx';
import { FixPanel } from './FixPanel.tsx';
import { ReviewPanel } from './ReviewPanel.tsx';
import {
  CHANGE_STATUS_LABEL,
  CHANGE_STATUS_TONE,
  FailureNotice,
  ReadOnlyHint,
  ShaCopy,
  formatAbsolute,
  reviewLabel,
  reviewStateTone,
  shortSha,
} from './git-shared.tsx';

type CommitTab = 'files' | 'review' | 'fix';

function shouldRetry(failureCount: number, error: unknown): boolean {
  return classifyGitFailure(error) === 'failed' && failureCount < 2;
}

export interface CommitDetailProps {
  readonly projectId: string;
  readonly sha: string;
  readonly repo: GitRepo;
  readonly branches: readonly GitBranch[];
  readonly onDiffFullscreenChange: (fullscreen: boolean) => void;
  readonly onBackToList: () => void;
}

/** 右栏提交详情：改动文件 / AI 审查 / 修复 三个页签。 */
export function CommitDetail({ projectId, sha, repo, branches, onDiffFullscreenChange, onBackToList }: CommitDetailProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<CommitTab>('files');
  const [compareId, setCompareId] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<FileChange | null>(null);
  const [fixDiff, setFixDiff] = useState<{ readonly file: FileChange; readonly fixRunId: string } | null>(null);
  const [reviewRunId, setReviewRunId] = useState<string | undefined>(undefined);
  const [selectedFindingIds, setSelectedFindingIds] = useState<ReadonlySet<string>>(new Set());
  const [focusFindingId, setFocusFindingId] = useState<string | null>(null);
  const [diffFullscreen, setDiffFullscreen] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  const commitQuery = useQuery({
    queryKey: gitKeys.commit(projectId, sha),
    queryFn: () => fetchGitCommit(projectId, sha),
    retry: shouldRetry,
  });
  const commit: GitCommit | undefined = commitQuery.data;

  useEffect(() => {
    if (commit === undefined || reviewRunId !== undefined) return;
    if (commit.review !== undefined) setReviewRunId(commit.review.reviewRunId);
  }, [commit, reviewRunId]);

  useEffect(() => {
    if (commit === undefined) return;
    setCompareId((current) => {
      if (current.length > 0 && commit.compareOptions.some((option) => option.compareId === current)) return current;
      return commit.compareOptions[0]?.compareId ?? '';
    });
  }, [commit]);

  const compareBase = commit?.compareOptions.find((option) => option.compareId === compareId)
    ?? commit?.compareOptions[0];
  // 根提交的 compareOptions 为空；服务用它约定的空树 SHA 作为基线。
  const diffBaseSha = compareBase?.baseSha ?? GIT_EMPTY_TREE_SHA;

  const filesQuery = useQuery({
    queryKey: gitKeys.commitFiles(projectId, sha, compareBase?.compareId ?? null),
    queryFn: () => fetchGitCommitFiles(projectId, sha, compareBase?.compareId),
    enabled: commit !== undefined,
    retry: shouldRetry,
  });
  const files = filesQuery.data?.files ?? [];

  const reviewQuery = useQuery({
    queryKey: gitKeys.review(projectId, reviewRunId ?? ''),
    queryFn: () => fetchReview(projectId, reviewRunId ?? ''),
    enabled: reviewRunId !== undefined,
    retry: shouldRetry,
  });
  const reviewFindings = reviewQuery.data?.findings ?? [];

  useEffect(() => {
    if (files.length === 0) {
      setSelectedFile(null);
      return;
    }
    setSelectedFile((current) => {
      if (current === null) return files[0] ?? null;
      return files.find((file) => file.fileId === current.fileId) ?? files[0] ?? null;
    });
  }, [files]);

  useEffect(() => {
    if (!diffFullscreen) return;
    onDiffFullscreenChange(true);
    return () => { onDiffFullscreenChange(false); };
  }, [diffFullscreen, onDiffFullscreenChange]);

  useEffect(() => {
    if (tab !== 'files' && diffFullscreen) setDiffFullscreen(false);
  }, [tab, diffFullscreen]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && diffFullscreen) {
        setDiffFullscreen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => { window.removeEventListener('keydown', handler); };
  }, [diffFullscreen]);

  const toggleFinding = (findingId: string, selected: boolean) => {
    setSelectedFindingIds((current) => {
      const next = new Set(current);
      if (selected) next.add(findingId);
      else next.delete(findingId);
      return next;
    });
  };

  const locateFinding = (finding: ReviewFinding) => {
    setActionError(null);
    const file = files.find((item) => item.path === finding.location?.path);
    if (file === undefined) {
      setActionError(new Error(`问题位置 ${finding.location?.path ?? '未知文件'} 不在本次改动的文件列表里；服务数据不一致，界面不伪造定位。`));
      return;
    }
    setFixDiff(null);
    setSelectedFile(file);
    setFocusFindingId(finding.findingId);
    setTab('files');
    window.setTimeout(() => {
      tabsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, 0);
  };

  const openFixDiff = (file: FileChange, fixRunId: string) => {
    setActionError(null);
    setSelectedFile(file);
    setFixDiff({ file, fixRunId });
    setFocusFindingId(null);
    setTab('files');
  };

  if (commitQuery.isError) {
    return (
      <div className="git-detail-scroll">
        <FailureNotice error={commitQuery.error} onRetry={() => { void commitQuery.refetch(); }} />
      </div>
    );
  }

  if (commit === undefined) {
    return (
      <div className="git-detail-scroll">
        <div className="stack-tight">
          <Skeleton width="72%" height={16} />
          <Skeleton width="46%" height={11} />
          <Skeleton width="88%" height={11} />
        </div>
      </div>
    );
  }

  const totalAdditions = commit.stats.additions;
  const totalDeletions = commit.stats.deletions;

  return (
    <div className="git-detail">
      <div className="git-detail-scroll">
        <button type="button" className="btn ghost sm only-narrow" style={{ marginBottom: 10 }} onClick={onBackToList}>
          <Icon name="arrowLeft" size="sm" />
          提交列表
        </button>

        <div className="commit-head">
          <div className="commit-head-top">
            <div className="grow" style={{ minWidth: 0 }}>
              <h2>{commit.subject}</h2>
              <div className="row-wrap" style={{ marginTop: 6 }}>
                {commit.refs.map((ref) => (
                  <Badge key={`${ref.kind}:${ref.name}`} outline tone={ref.kind === 'head' ? 'accent' : 'neutral'}>
                    {ref.kind === 'head' ? 'HEAD' : ref.kind === 'tag' ? `tag ${ref.name}` : ref.name}
                  </Badge>
                ))}
                {commit.review === undefined ? null : (
                  <Badge tone={reviewStateTone(commit.review.state)} icon="sparkle">
                    AI 审查 · {reviewLabel(commit.review.state)}
                    {commit.review.openCount === undefined ? '' : ` · ${String(commit.review.openCount)} 个待处理`}
                  </Badge>
                )}
                {commit.parents.length > 1 ? <Badge tone="wait" icon="split">合并提交</Badge> : null}
              </div>
            </div>
            <div className="commit-head-actions">
              <Button variant="primary" size="sm" icon="sparkle" onClick={() => { setTab('review'); }}>
                AI 审查此提交
              </Button>
            </div>
          </div>

          {commit.body.trim().length === 0 ? null : <div className="commit-body-text">{commit.body}</div>}

          <div className="commit-facts">
            <span className="fact">
              <Icon name="users" size="sm" />
              作者 <b>{commit.author.name}</b>
            </span>
            <span className="fact">
              <Icon name="clock" size="sm" />
              {formatAbsolute(commit.authoredAt)}
            </span>
            <span className="fact">
              提交者 <b>{commit.committer.name}</b> · {formatAbsolute(commit.committedAt)}
            </span>
          </div>

          <div className="commit-facts">
            <span className="fact">
              完整 SHA <ShaCopy value={commit.sha} label="完整 SHA" />
            </span>
            <span className="fact">
              父提交
              {commit.parents.length === 0 ? <b>根提交</b> : commit.parents.map((parent) => (
                <ShaCopy key={parent} value={parent} label="父提交 SHA" truncate={12} />
              ))}
            </span>
          </div>

          <div className="commit-stats">
            <span><Icon name="file" size="sm" /> {String(commit.stats.files)} 个文件</span>
            <span className="add">+{String(totalAdditions)}</span>
            <span className="del">−{String(totalDeletions)}</span>
            <span className="muted-note">
              包含于 {commit.containedIn.branches.length === 0 ? '（服务未返回分支）' : commit.containedIn.branches.slice(0, 4).join('、')}
              {commit.containedIn.truncated ? ' 等（已截断）' : ''}
            </span>
          </div>

          {commit.compareOptions.length > 1 ? (
            <div className="row-wrap">
              <span className="muted-note">合并提交有两个父；先选择对比基线：</span>
              <SegmentedControl
                ariaLabel="对比基线"
                value={compareBase?.compareId ?? ''}
                onChange={(value) => { setCompareId(value); setFixDiff(null); }}
                options={commit.compareOptions.map((option) => ({ value: option.compareId, label: option.label }))}
              />
              <span className="mono-sm">base {compareBase?.baseSha === undefined ? '—' : shortSha(compareBase.baseSha)}</span>
            </div>
          ) : null}
        </div>

        <div className="tabbar" role="tablist" ref={tabsRef}>
          <button type="button" role="tab" className="tab" aria-selected={tab === 'files'} onClick={() => { setTab('files'); }}>
            改动文件 {filesQuery.data === undefined ? '' : `(${String(files.length)})`}
          </button>
          <button type="button" role="tab" className="tab" aria-selected={tab === 'review'} onClick={() => { setTab('review'); }}>
            AI 审查
          </button>
          <button type="button" role="tab" className="tab" aria-selected={tab === 'fix'} onClick={() => { setTab('fix'); }}>
            修复 {selectedFindingIds.size === 0 ? '' : `(${String(selectedFindingIds.size)})`}
          </button>
          <span className="spacer" />
        </div>

        <div className="tab-body">
          {tab === 'files' ? (
            <>
              <ReadOnlyHint>浏览全部只读：查看提交、文件与 diff 不会改动仓库；切换统一 / 并排与忽略空白只影响本视图。</ReadOnlyHint>
              {actionError === null ? null : (
                <div className="banner warn" role="alert" style={{ marginTop: 10 }}>
                  <Icon name="alert" />
                  <div className="grow">{actionError instanceof Error ? actionError.message : '操作失败'}</div>
                  <div className="actions">
                    <Button variant="ghost" size="sm" onClick={() => { setActionError(null); }}>收起</Button>
                  </div>
                </div>
              )}
              {filesQuery.isPending ? (
                <div className="stack-tight" style={{ marginTop: 12 }}>
                  <Skeleton height={30} />
                  <Skeleton height={30} />
                  <Skeleton height={30} />
                </div>
              ) : filesQuery.isError ? (
                <FailureNotice error={filesQuery.error} onRetry={() => { void filesQuery.refetch(); }} />
              ) : (
                <>
                  <div className="files-note">
                    <span>{String(files.length)} 个文件</span>
                    {filesQuery.data?.truncated === true ? (
                      <Badge tone="fail" icon="alert">文件列表已截断（服务上限）</Badge>
                    ) : null}
                    {fixDiff === null ? null : (
                      <Badge tone="accent" icon="wand">正在查看修复副本 diff · {fixDiff.file.path}</Badge>
                    )}
                    <span className="grow" />
                    {fixDiff === null ? <span className="muted-note">base {shortSha(diffBaseSha)}{compareBase === undefined ? '（根提交 · 空树）' : ''}</span> : (
                      <Button variant="ghost" size="sm" icon="x" onClick={() => { setFixDiff(null); }}>
                        退出修复 diff
                      </Button>
                    )}
                  </div>
                  {files.length === 0 ? (
                    <EmptyState compact icon="file" title="这个提交没有改动文件" description="可能是空的合并提交，或服务判断没有可显示的改动。" />
                  ) : (
                    <div className="files-split">
                      <div className="file-list-pane">
                        {files.map((file) => {
                          const findingCount = filesQuery.data?.reviewBadges.find((badge) => badge.fileId === file.fileId)?.findingCount ?? file.findingCount ?? 0;
                          const selected = selectedFile?.fileId === file.fileId;
                          return (
                            <button
                              key={file.fileId}
                              type="button"
                              className="file-row"
                              aria-selected={selected}
                              onClick={() => { setSelectedFile(file); setFixDiff(null); setFocusFindingId(null); }}
                            >
                              <Badge tone={CHANGE_STATUS_TONE[file.status]}>{CHANGE_STATUS_LABEL[file.status]}</Badge>
                              <span className="file-path">
                                {file.oldPath === undefined ? '' : `${file.oldPath} → `}
                                {file.path}
                              </span>
                              {file.binary ? <Badge tone="neutral">二进制</Badge> : null}
                              {file.mode === undefined ? null : <Badge tone="wait">权限</Badge>}
                              {findingCount === 0 ? null : <Badge tone="accent" icon="sparkle">{String(findingCount)}</Badge>}
                              <span className="file-delta">
                                {file.additions === null && file.deletions === null ? (
                                  <span>行数未知</span>
                                ) : (
                                  <>
                                    <span className="add">+{String(file.additions ?? 0)}</span>
                                    <span className="del">−{String(file.deletions ?? 0)}</span>
                                  </>
                                )}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="diff-pane">
                        {selectedFile === null ? (
                          <EmptyState compact icon="file" title="选择一个文件查看差异" />
                        ) : (
                          <DiffViewer
                            key={`${selectedFile.fileId}:${fixDiff?.fixRunId ?? compareBase?.baseSha ?? 'fix'}`}
                            projectId={projectId}
                            file={selectedFile}
                            baseSha={fixDiff === null ? diffBaseSha : undefined}
                            headSha={fixDiff === null ? commit.sha : undefined}
                            fixRunId={fixDiff?.fixRunId}
                            findings={fixDiff === null ? reviewFindings : []}
                            focusFindingId={fixDiff === null ? focusFindingId : null}
                            onFindingSelect={(finding) => { locateFinding(finding); }}
                            fullscreen={diffFullscreen}
                            onToggleFullscreen={() => { setDiffFullscreen((current) => !current); }}
                          />
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          ) : tab === 'review' ? (
            <ReviewPanel
              projectId={projectId}
              commit={commit}
              reviewRunId={reviewRunId}
              selectedFindingIds={selectedFindingIds}
              onToggleFinding={toggleFinding}
              onReviewStarted={(id) => {
                setReviewRunId(id);
                void queryClient.invalidateQueries({ queryKey: gitKeys.commit(projectId, sha) });
              }}
              onLocate={locateFinding}
              onRequestFix={() => { setTab('fix'); }}
            />
          ) : (
            <FixPanel
              projectId={projectId}
              repo={repo}
              commit={commit}
              reviewRunId={reviewRunId}
              selectedFindingIds={selectedFindingIds}
              branches={branches}
              onOpenDiff={openFixDiff}
              onClearSelection={() => { setSelectedFindingIds(new Set()); }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
