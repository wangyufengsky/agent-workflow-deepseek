import type { FileChange, TaskChanges, TaskDelivery } from '@agent-workflow/shared';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { EmptyState, Skeleton } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { CHANGE_STATUS_LABEL, CHANGE_STATUS_TONE, FailureNotice } from '../git/git-shared.tsx';

export interface DeliveryFileSelectProps {
  readonly files: readonly FileChange[];
  readonly selected: ReadonlySet<string>;
  readonly onToggle: (fileId: string, selected: boolean) => void;
  readonly onSelectAll: () => void;
  readonly onSelectNone: () => void;
  readonly excluded: TaskChanges['excluded'] | undefined;
  readonly remaining: TaskDelivery['remaining'] | undefined;
  readonly loading: boolean;
  readonly error: unknown;
  readonly onRetry: () => void;
  readonly disabled: boolean;
  readonly disabledReason: string | null;
}

/** 交付文件选择：整文件选择；未纳入 / 忽略项只读列出，不能在这里加入。 */
export function DeliveryFileSelect({
  files,
  selected,
  onToggle,
  onSelectAll,
  onSelectNone,
  excluded,
  remaining,
  loading,
  error,
  onRetry,
  disabled,
  disabledReason,
}: DeliveryFileSelectProps) {
  const stats = files.reduce(
    (total, file) => {
      if (file.status === 'A') total.added += 1;
      else if (file.status === 'D') total.deleted += 1;
      else total.modified += 1;
      return total;
    },
    { added: 0, modified: 0, deleted: 0 },
  );

  return (
    <section className="delivery-section" aria-label="选择要交付的文件">
      <div className="delivery-section-head">
        <h3>变更文件</h3>
        <Badge tone="neutral">{String(selected.size)} / {String(files.length)} 已选</Badge>
        <span className="spacer" />
        {disabled ? null : (
          <>
            <Button variant="ghost" size="sm" icon="check" onClick={onSelectAll} disabled={files.length === 0} disabledReason={files.length === 0 ? '没有可选择的文件。' : undefined}>
              全选
            </Button>
            <Button variant="ghost" size="sm" icon="x" onClick={onSelectNone} disabled={selected.size === 0} disabledReason={selected.size === 0 ? '当前没有已选择的文件。' : undefined}>
              全不选
            </Button>
          </>
        )}
      </div>

      {loading ? (
        <div className="stack-tight">
          <Skeleton height={26} />
          <Skeleton height={26} />
          <Skeleton height={26} />
        </div>
      ) : error !== null && error !== undefined ? (
        <FailureNotice error={error} onRetry={onRetry} compact />
      ) : files.length === 0 ? (
        <EmptyState
          compact
          icon="file"
          title="没有文件变更"
          description="服务扫描到的变更集为空：不会创建空提交，也不会伪造变更。"
        />
      ) : (
        <div className="delivery-files" role="group" aria-label="变更文件列表">
          {files.map((file) => (
            <label key={file.fileId} className="delivery-file-row">
              <input
                type="checkbox"
                checked={selected.has(file.fileId)}
                disabled={disabled}
                onChange={(event) => { onToggle(file.fileId, event.target.checked); }}
              />
              <Badge tone={CHANGE_STATUS_TONE[file.status]}>{CHANGE_STATUS_LABEL[file.status]}</Badge>
              <span className="path">
                {file.oldPath === undefined ? '' : `${file.oldPath} → `}
                {file.path}
              </span>
              {file.binary ? <Badge tone="neutral">二进制</Badge> : null}
              {file.mode === undefined ? null : <Badge tone="wait">权限</Badge>}
              <span className="delta">
                {file.additions === null && file.deletions === null ? (
                  <span>行数未知</span>
                ) : (
                  <>
                    <span className="add">+{String(file.additions ?? 0)}</span>{' '}
                    <span className="del">−{String(file.deletions ?? 0)}</span>
                  </>
                )}
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="delivery-stats" style={{ marginTop: 8 }}>
        <div className="delivery-stat">
          <span className="l">新增</span>
          <span className="v">{String(stats.added)}</span>
        </div>
        <div className="delivery-stat">
          <span className="l">修改</span>
          <span className="v">{String(stats.modified)}</span>
        </div>
        <div className="delivery-stat">
          <span className="l">删除</span>
          <span className="v">{String(stats.deleted)}</span>
        </div>
      </div>

      {remaining === undefined ? null : (
        <p className="delivery-hint" style={{ marginTop: 6 }}>
          未选择 / 未交付：{String(remaining.unselected)} 项 · {remaining.detail}
        </p>
      )}

      {excluded === undefined || excluded.length === 0 ? null : (
        <div className="delivery-excluded" style={{ marginTop: 8 }}>
          <span className="row">
            <Icon name="lock" size="sm" />
            未纳入 {String(excluded.length)} 项（服务扫描排除，本页不能加入交付）
          </span>
          {excluded.map((item) => (
            <span key={item.path} className="row" title={item.reason}>
              <span className="path">{item.path}</span>
              <span>· {item.reason}</span>
            </span>
          ))}
        </div>
      )}

      {disabled && disabledReason !== null ? (
        <span className="action-reason" style={{ marginTop: 6 }}>
          <Icon name="lock" size="sm" />
          {disabledReason}
        </span>
      ) : null}
    </section>
  );
}
