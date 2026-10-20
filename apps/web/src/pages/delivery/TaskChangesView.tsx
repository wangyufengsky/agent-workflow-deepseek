import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DiffHunk, DiffLine, DiffPage, FileChange, TaskChanges } from '@agent-workflow/shared';
import { fetchTaskChangesDiff } from '../../api/workflow.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { EmptyState, Skeleton } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { CHANGE_STATUS_LABEL, CHANGE_STATUS_TONE, FailureNotice, formatAbsolute } from '../git/git-shared.tsx';

const TABS = [
  { id: 'changes', label: '任务变更' },
  { id: 'evidence', label: '验证与成果' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export interface TaskChangesViewProps {
  readonly taskId: string;
  readonly taskTitle: string;
  readonly projectName: string;
  readonly branch: string | undefined;
  readonly baseRef: string | undefined;
  readonly baseSha: string | undefined;
  readonly workspaceDisplayRoot: string | undefined;
  readonly changes: TaskChanges | undefined;
  readonly loading: boolean;
  readonly error: unknown;
  readonly onRetry: () => void;
  readonly files: readonly FileChange[];
  readonly selected: ReadonlySet<string>;
  readonly deliverySelected: ReadonlySet<string>;
  readonly onToggle: (fileId: string, selected: boolean) => void;
  readonly onSelectAll: () => void;
  readonly onSelectNone: () => void;
  readonly verificationLabel: string | undefined;
  readonly onClose: () => void;
}

function diffCacheKey(taskId: string, fileId: string) {
  return ['task-changes-diff', taskId, fileId] as const;
}

interface SplitRow {
  readonly left: { readonly line?: number; readonly kind: 'context' | 'del' | 'no_newline'; readonly text: string } | null;
  readonly right: { readonly line?: number; readonly kind: 'context' | 'add' | 'no_newline'; readonly text: string } | null;
}

function splitRows(hunk: DiffHunk): readonly SplitRow[] {
  const rows: SplitRow[] = [];
  let index = 0;
  while (index < hunk.lines.length) {
    const line = hunk.lines[index]!;
    if (line.kind === 'context' || line.kind === 'no_newline') {
      rows.push({
        left: { line: line.oldLine, kind: line.kind, text: line.text },
        right: { line: line.newLine, kind: line.kind, text: line.text },
      });
      index += 1;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (index < hunk.lines.length && hunk.lines[index]!.kind === 'del') { dels.push(hunk.lines[index]!); index += 1; }
    while (index < hunk.lines.length && hunk.lines[index]!.kind === 'add') { adds.push(hunk.lines[index]!); index += 1; }
    const count = Math.max(dels.length, adds.length);
    for (let row = 0; row < count; row += 1) {
      const del = dels[row];
      const add = adds[row];
      rows.push({
        left: del === undefined ? null : { line: del.oldLine, kind: 'del', text: del.text },
        right: add === undefined ? null : { line: add.newLine, kind: 'add', text: add.text },
      });
    }
  }
  return rows;
}

function UnifiedLines({ page }: { readonly page: DiffPage }) {
  return (
    <div className="td03-diff-lines" role="table" aria-label="文件差异（统一）">
      {page.hunks.map((hunk: DiffHunk) => (
        <div key={hunk.hunkId} className="td03-diff-hunk">
          <div className="td03-diff-hunk-head" role="row">
            <span>{hunk.header}</span>
            {hunk.section === undefined ? null : <span className="muted-note">{hunk.section}</span>}
          </div>
          {hunk.lines.map((line) => (
            <div key={line.anchorId} className={`td03-diff-line ${line.kind}`} role="row">
              <span className="num">{line.oldLine === undefined ? '' : String(line.oldLine)}</span>
              <span className="num">{line.newLine === undefined ? '' : String(line.newLine)}</span>
              <span className="sig">{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}</span>
              <span className="text">{line.text === '' ? ' ' : line.text}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function SplitLines({ page }: { readonly page: DiffPage }) {
  return (
    <div className="td03-diff-lines split" role="table" aria-label="文件差异（并排）">
      {page.hunks.map((hunk: DiffHunk) => (
        <div key={hunk.hunkId} className="td03-diff-hunk">
          <div className="td03-diff-hunk-head" role="row">
            <span>{hunk.header}</span>
            {hunk.section === undefined ? null : <span className="muted-note">{hunk.section}</span>}
          </div>
          {splitRows(hunk).map((row, index) => (
            <div key={`${hunk.hunkId}:${String(index)}`} className="td03-diff-row" role="row">
              <span className={`cell ${row.left?.kind ?? 'empty'}`}>
                <span className="num">{row.left?.line === undefined ? '' : String(row.left.line)}</span>
                <span className="text">{row.left?.text ?? ''}</span>
              </span>
              <span className={`cell ${row.right?.kind ?? 'empty'}`}>
                <span className="num">{row.right?.line === undefined ? '' : String(row.right.line)}</span>
                <span className="text">{row.right?.text ?? ''}</span>
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * TD03「任务变更」上下文视图（全宽）：
 * 任务上下文条 → 左文件树（A/M/D）→ 中 diff 查看器 → 验证与成果页签。
 * 只读读取服务已提供的 changes / changes diff 端点；读失败不显示旧文件列表，只给重新读取。
 * 离开视图需确认（文件选择与提交信息草稿保留在任务下，不静默丢弃）。
 */
export function TaskChangesView({
  taskId,
  taskTitle,
  projectName,
  branch,
  baseRef,
  baseSha,
  workspaceDisplayRoot,
  changes,
  loading,
  error,
  onRetry,
  files,
  selected,
  deliverySelected,
  onToggle,
  onSelectAll,
  onSelectNone,
  verificationLabel,
  onClose,
}: TaskChangesViewProps) {
  const [tab, setTab] = useState<TabId>('changes');
  const [activeFileId, setActiveFileId] = useState<string | undefined>(files[0]?.fileId);
  const [diffMode, setDiffMode] = useState<'unified' | 'split'>('unified');
  const [leaveConfirm, setLeaveConfirm] = useState(false);

  const activeFile = files.find((file) => file.fileId === activeFileId) ?? files[0];
  const dirtySelection = useMemo(() => {
    if (selected.size !== deliverySelected.size) return true;
    for (const fileId of selected) if (!deliverySelected.has(fileId)) return true;
    return false;
  }, [deliverySelected, selected]);

  const diffQuery = useQuery({
    queryKey: diffCacheKey(taskId, activeFile?.fileId ?? ''),
    queryFn: () => fetchTaskChangesDiff(taskId, activeFile?.fileId ?? ''),
    enabled: activeFile !== undefined && !activeFile.binary && tab === 'changes',
    retry: 1,
  });

  const requestLeave = () => {
    if (dirtySelection) setLeaveConfirm(true);
    else onClose();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (leaveConfirm) setLeaveConfirm(false);
      else requestLeave();
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  });

  const diff = diffQuery.data;
  const truncated = diff?.truncated;

  return (
    <div className="td03-view" role="region" aria-label="任务变更">
      <div className="td03-head">
        <div className="crumbs">
          <span>Git 仓库</span>
          <span aria-hidden="true">/</span>
          <span>{projectName}</span>
          <span aria-hidden="true">/</span>
          <strong>任务变更 · {taskTitle}</strong>
        </div>
        <div className="td03-head-actions">
          <Button variant="ghost" size="sm" icon="arrowLeft" onClick={requestLeave}>返回任务</Button>
        </div>
      </div>

      <div className="td03-context" aria-label="任务上下文">
        <div className="row"><span className="k">任务分支</span><span className="v mono">{branch ?? '服务未返回'}</span></div>
        <div className="row"><span className="k">基线</span><span className="v mono">{baseRef ?? '—'}{baseSha === undefined ? '' : ` @ ${baseSha.slice(0, 7)}`}</span></div>
        <div className="row"><span className="k">工作区</span><span className="v mono">{workspaceDisplayRoot ?? '服务未返回'}（只读显示）</span></div>
        <div className="row"><span className="k">快照</span><span className="v mono">{changes?.changesRevision ?? '—'}{changes === undefined ? '' : ` · 读取于 ${formatAbsolute(changes.readAt)}`}</span></div>
      </div>

      <div className="td03-tabs" role="tablist" aria-label="任务变更页签">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`td03-tab ${tab === item.id ? 'active' : ''}`}
            onClick={() => { setTab(item.id); }}
          >
            {item.label}
          </button>
        ))}
        <span className="spacer" />
        <Badge tone="wait" icon="clock">{taskTitle} · 执行已结束 · 等待交付</Badge>
      </div>

      {leaveConfirm ? (
        <div className="banner warn td03-leave" role="alertdialog" aria-label="退出任务变更确认">
          <Icon name="alert" />
          <div className="grow">
            <b>退出任务变更视图？</b>
            <br />
            任务的文件选择与提交信息草稿保留在 {taskTitle}，回到任务交付面板；Esc 只关闭本确认条，不会触发离开。
          </div>
          <Button variant="ghost" size="sm" onClick={() => { setLeaveConfirm(false); }}>继续留在任务变更</Button>
          <Button variant="secondary" size="sm" onClick={onClose}>退出任务变更</Button>
        </div>
      ) : null}

      {tab === 'evidence' ? (
        <div className="td03-evidence">
          <div className="td03-evidence-card">
            <h3>任务目标与成果</h3>
            <p>{taskTitle}</p>
            <p className="muted-note">成果来自任务计划的节点产出；本视图只读，不重复实现节点面板的内容阅读器。</p>
          </div>
          <div className="td03-evidence-card">
            <h3>验证摘要</h3>
            <p>交付读回验证结论：{verificationLabel ?? '服务未返回验证结论'}</p>
            {changes?.verification === undefined ? (
              <p className="muted-note">变更集未返回验证记录（服务未提供时不伪造通过）。</p>
            ) : (
              <p className="muted-note">
                原验证记录：{changes.verification.state}
                {changes.verification.passed === undefined ? '' : ` · 通过 ${String(changes.verification.passed)}`}
                {changes.verification.failed === undefined ? '' : ` · 失败 ${String(changes.verification.failed)}`}
                {changes.verification.summary === undefined ? '' : ` · ${changes.verification.summary}`}
              </p>
            )}
            <p className="muted-note">验证日志入口：节点执行详情右侧面板（按步骤查看尝试与工具结果）；本视图不复制日志，避免两处事实分叉。</p>
          </div>
        </div>
      ) : loading ? (
        <div className="td03-body">
          <div className="td03-filetree">
            <Skeleton height={26} />
            <Skeleton height={26} />
            <Skeleton height={26} />
            <span className="muted-note">读取任务变更中…</span>
          </div>
          <div className="td03-diff"><Skeleton height={120} /><span className="muted-note">读取任务变更中（文件列表 → 差异），不画假百分比。</span></div>
        </div>
      ) : error !== null && error !== undefined ? (
        <div className="td03-body single">
          <div className="banner danger" role="alert">
            <Icon name="alert" />
            <div className="grow">
              <b>任务变更读取失败</b>
              <br />
              这是读取问题，不是“没有变更”；旧的文件列表与 diff 不再显示，草稿保留，只提供只读的「重新读取」。
            </div>
          </div>
          <FailureNotice error={error} onRetry={onRetry} />
        </div>
      ) : (
        <div className="td03-body">
          <aside className="td03-filetree" aria-label="任务文件树">
            <div className="td03-filetree-head">
              <span>任务文件树</span>
              <span className="spacer" />
              <button type="button" className="linkish" onClick={onSelectAll}>全选</button>
              <button type="button" className="linkish" onClick={onSelectNone}>全不选</button>
            </div>
            {files.length === 0 ? (
              <EmptyState compact icon="file" title="没有文件变更" description="服务扫描到的变更集为空：不会创建空提交，也不会伪造变更。" />
            ) : files.map((file) => (
              <div key={file.fileId} className={`td03-file ${file.fileId === activeFile?.fileId ? 'active' : ''}`}>
                <input
                  type="checkbox"
                  checked={selected.has(file.fileId)}
                  aria-label={`选择 ${file.path}`}
                  onChange={(event) => { onToggle(file.fileId, event.target.checked); }}
                />
                <button type="button" className="td03-file-open" onClick={() => { setActiveFileId(file.fileId); }}>
                  <Badge tone={CHANGE_STATUS_TONE[file.status]}>{CHANGE_STATUS_LABEL[file.status]}</Badge>
                  <span className="path">{file.oldPath === undefined ? '' : `${file.oldPath} → `}{file.path}</span>
                  <span className="badges">
                    {file.binary ? <Badge tone="neutral">二进制</Badge> : null}
                    {file.sizeClass === 'large' || file.sizeClass === 'too_large' ? <Badge tone="wait">大文件</Badge> : null}
                    {file.mode === undefined ? null : <Badge tone="wait">权限 {file.mode.old ?? '?'} → {file.mode.new ?? '?'}</Badge>}
                  </span>
                  <span className="delta">
                    {file.additions === null && file.deletions === null ? '行数未知' : `+${String(file.additions ?? 0)} −${String(file.deletions ?? 0)}`}
                  </span>
                </button>
              </div>
            ))}
            {changes === undefined || changes.excluded.length === 0 ? null : (
              <div className="td03-excluded">
                <div className="head">未纳入 {String(changes.excluded.length)} 项（服务扫描排除，不提交、不能在此加入）</div>
                {changes.excluded.map((item) => (
                  <div key={item.path} className="row" title={item.reason}>
                    <span className="path">{item.path}</span>
                    <span>· {item.reason}</span>
                  </div>
                ))}
              </div>
            )}
          </aside>

          <section className="td03-diff" aria-label="差异查看器">
            <div className="td03-diff-bar">
              <strong className="file-title">{activeFile === undefined ? '未选择文件' : activeFile.path}</strong>
              <span className="spacer" />
              <div className="seg" role="group" aria-label="diff 视图">
                <button type="button" className={diffMode === 'unified' ? 'on' : ''} onClick={() => { setDiffMode('unified'); }}>统一</button>
                <button type="button" className={diffMode === 'split' ? 'on' : ''} onClick={() => { setDiffMode('split'); }}>并排</button>
              </div>
              <Button variant="ghost" size="sm" icon="refresh" onClick={() => { void diffQuery.refetch(); }}>重新读取</Button>
            </div>
            {activeFile === undefined ? (
              <EmptyState compact icon="file" title="选择左侧文件查看差异" description="差异只读读取任务变更快照，不会暂存或修改工作区。" />
            ) : activeFile.binary ? (
              <div className="td03-diff-note">
                <Badge tone="neutral">二进制</Badge>
                <span>二进制文件，不显示文本差异；大小与内容标识由服务端读口给出（服务未提供时不猜测）。</span>
              </div>
            ) : diffQuery.isPending ? (
              <div className="td03-diff-note"><Skeleton height={60} /><span className="muted-note">读取文件差异中…</span></div>
            ) : diffQuery.isError ? (
              <div className="td03-diff-note">
                <FailureNotice error={diffQuery.error} onRetry={() => { void diffQuery.refetch(); }} compact />
                <span className="muted-note">读取失败：保留视图与草稿，只提供「重新读取」。</span>
              </div>
            ) : diff === undefined || diff.hunks.length === 0 ? (
              <div className="td03-diff-note"><span className="muted-note">该文件没有可显示的文本差异（可能是权限或重命名变更）。</span></div>
            ) : (
              <>
                {diffMode === 'split' ? <SplitLines page={diff} /> : <UnifiedLines page={diff} />}
                {truncated === undefined ? null : (
                  <div className="td03-diff-note">
                    <span className="muted-note">
                      已显示 {String(truncated.shownLines)} 行（{truncated.reason === 'LINE_LIMIT' ? '超出单页行数' : '超出单页字节'}）；服务返回的是截断视图，当前 changes diff 端点未透传分段游标，因此不伪造「加载下一段」进度。
                    </span>
                  </div>
                )}
              </>
            )}
            {diffMode === 'split' ? <p className="muted-note">并排视图由同一份服务统一 diff 按行配对渲染，不伪造另一侧内容；未配对的行留空。</p> : null}
          </section>
        </div>
      )}
    </div>
  );
}
