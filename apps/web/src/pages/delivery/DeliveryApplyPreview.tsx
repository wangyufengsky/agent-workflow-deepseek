import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createRequestKey,
  type ConflictResolutionValue,
  type DirectoryApplyPreview,
  type TaskDelivery,
} from '@agent-workflow/shared';
import {
  applyDirectoryApply,
  fetchOperationByKey,
  gitKeys,
  previewDirectoryApply,
  type DirectoryApplyResult,
} from '../../api/git.ts';
import { errorMessage, isServiceUnavailable } from '../../api/client.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { CHANGE_STATUS_LABEL } from '../git/git-shared.tsx';

const CHECK_LABEL: Record<DirectoryApplyPreview['items'][number]['check'], string> = {
  applicable: '可应用',
  conflict: '冲突',
  unsupported: '不支持',
};

const CHECK_TONE: Record<DirectoryApplyPreview['items'][number]['check'], 'ok' | 'danger' | 'idle'> = {
  applicable: 'ok',
  conflict: 'danger',
  unsupported: 'idle',
};

const EFFECT_LABEL: Record<DirectoryApplyPreview['items'][number]['plannedEffect'], string> = {
  add: '新增',
  replace: '替换',
  delete: '删除',
};

const RESOLUTION_LABEL: Record<ConflictResolutionValue, string> = {
  keep_original: '保留原目录',
  take_task: '采用任务版本',
  manual_then_recheck: '手动处理后重检',
  exclude: '排除本次应用',
};

type Resolution = Exclude<ConflictResolutionValue, 'manual_then_recheck'>;

function expiryReason(preview: DirectoryApplyPreview): string | undefined {
  return Date.parse(preview.expiresAt) <= Date.now() ? '预览已过期，请重新生成。' : undefined;
}

/**
 * 非 Git 任务的三方应用：生成只读预览 → 逐项处理冲突 → 冻结预览并写入原目录。
 * 所有写入由服务端执行并返回回执；失败/未知原样展示，不做假成功。
 */
export function DeliveryApplyPreview({ delivery }: { readonly delivery: TaskDelivery }) {
  const queryClient = useQueryClient();
  const preview = delivery.applyPreview;
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [result, setResult] = useState<DirectoryApplyResult | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  const currentResolutions = useMemo(
    () => Object.entries(resolutions).map(([fileId, resolution]) => ({ fileId, resolution })),
    [resolutions],
  );

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: gitKeys.delivery(delivery.taskId) }),
      queryClient.invalidateQueries({ queryKey: gitKeys.taskDetail(delivery.taskId) }),
      queryClient.invalidateQueries({ queryKey: gitKeys.taskChanges(delivery.taskId) }),
    ]);
  };

  const previewMutation = useMutation({
    mutationFn: async () => previewDirectoryApply(delivery.taskId, currentResolutions.length === 0 ? {} : { resolutions: currentResolutions }),
    onSuccess: async (next) => {
      setFailure(undefined);
      setNotice(
        `预览已生成（可应用 ${String(next.counts.applicable)} / 冲突 ${String(next.counts.conflict)} / 不支持 ${String(next.counts.unsupported)}），确认应用前原目录不会改变。`,
      );
      await invalidate();
    },
    onError: (error) => {
      setNotice(undefined);
      setFailure(isServiceUnavailable(error) ? '服务未连接，无法生成预览。' : errorMessage(error));
    },
  });

  const applyMutation = useMutation({
    mutationFn: async () =>
      applyDirectoryApply(delivery.taskId, {
        requestKey: createRequestKey(),
        previewRef: preview!.previewRef,
        previewRevision: preview!.revision,
        resolutions: currentResolutions,
        confirmApply: true,
      }),
    onSuccess: async (applied) => {
      setFailure(undefined);
      setResult(applied);
      setNotice(
        applied.receipt.status === 'succeeded'
          ? `应用完成：写入 ${String(applied.resource.result?.applied ?? 0)} 项，阻止 ${String(applied.resource.result?.blocked ?? 0)} 项，未执行 ${String(applied.resource.result?.notExecuted ?? 0)} 项。`
          : `应用回执状态：${applied.receipt.status}；请通过回执核对结果，不要重复提交。`,
      );
      await invalidate();
    },
    onError: (error) => {
      setNotice(undefined);
      setFailure(
        isServiceUnavailable(error)
          ? '服务未连接，未写入原目录。'
          : errorMessage(error),
      );
    },
  });

  const lookup = useMutation({
    mutationFn: async (requestKey: string) => fetchOperationByKey(requestKey),
    onSuccess: (record) => {
      setFailure(undefined);
      setNotice(`回执核对：${record.operation.status}${record.stillUnknown ? '（仍未结算，稍后再核对；不要重发）' : ''}`);
    },
    onError: (error) => setFailure(errorMessage(error)),
  });

  if (preview === undefined) {
    return (
      <section className="delivery-section">
        <div className="delivery-section-head">
          <h3>应用到原目录</h3>
          <Badge tone="unknown" icon="help">尚未预览</Badge>
        </div>
        <div className="apply-preview">
          <p className="delivery-hint">
            这是非 Git 项目。应用前先生成逐项预览：服务端比较基线快照、任务副本与当前原目录，列出可应用 / 冲突 / 不支持项；
            预览只读，不会改变原目录。
          </p>
          <div className="row-wrap">
            <Button variant="secondary" size="sm" icon="folder" disabled={previewMutation.isPending} onClick={() => previewMutation.mutate()}>
              {previewMutation.isPending ? '正在检查…' : '生成应用预览'}
            </Button>
          </div>
          {failure === undefined ? null : <p className="delivery-hint" style={{ color: 'var(--danger)' }}>{failure}</p>}
          {notice === undefined ? null : <p className="delivery-hint">{notice}</p>}
        </div>
      </section>
    );
  }

  const { counts } = preview;
  const expired = expiryReason(preview);
  const unresolved = counts.unresolved > 0;
  const applyReason = expired ?? (unresolved ? `还有 ${String(counts.unresolved)} 项未处理，先冻结预览。` : undefined);

  return (
    <section className="delivery-section">
      <div className="delivery-section-head">
        <h3>应用到原目录 · 预览</h3>
        <Badge tone={unresolved ? 'fail' : expired === undefined ? 'ok' : 'warn'} icon={unresolved ? 'alert' : 'check'}>
          {unresolved ? `${String(counts.unresolved)} 项待处理` : expired === undefined ? '可冻结应用' : '预览已过期'}
        </Badge>
        <span className="spacer" />
        <span className="muted-note">
          检查于 {new Date(preview.checkedAt).toLocaleString('zh-CN')} · 到期 {new Date(preview.expiresAt).toLocaleString('zh-CN')}
        </span>
      </div>
      <div className="apply-preview">
        <div className="apply-counts">
          <div className="apply-count"><span className="l">可应用</span><span className="v">{String(counts.applicable)}</span></div>
          <div className="apply-count"><span className="l">冲突</span><span className="v">{String(counts.conflict)}</span></div>
          <div className="apply-count"><span className="l">不支持</span><span className="v">{String(counts.unsupported)}</span></div>
          <div className="apply-count"><span className="l">未解决</span><span className="v">{String(counts.unresolved)}</span></div>
        </div>
        <div className="apply-items">
          {preview.items.map((item) => {
            const showResolution = item.check === 'conflict' || item.check === 'unsupported';
            const resolution = resolutions[item.fileId] ?? (item.resolution as Resolution | undefined);
            return (
              <div key={item.fileId} className="apply-item">
                <Badge tone={CHECK_TONE[item.check]}>{CHECK_LABEL[item.check]}</Badge>
                <span className="path" title={item.detail}>
                  {item.change === 'A' ? '' : `${CHANGE_STATUS_LABEL[item.change]} · `}
                  {item.path}
                </span>
                <span className="effect">{EFFECT_LABEL[item.plannedEffect]}</span>
                {showResolution ? (
                  <select
                    className="select"
                    aria-label={`${item.path} 处理方式`}
                    value={resolution ?? ''}
                    onChange={(event) => {
                      const value = event.target.value as Resolution | '';
                      setResolutions((current) => {
                        const next = { ...current };
                        if (value === '') delete next[item.fileId];
                        else next[item.fileId] = value;
                        return next;
                      });
                    }}
                  >
                    <option value="">未选择</option>
                    <option value="keep_original">{RESOLUTION_LABEL.keep_original}</option>
                    <option value="take_task">{RESOLUTION_LABEL.take_task}</option>
                    <option value="exclude">{RESOLUTION_LABEL.exclude}</option>
                  </select>
                ) : null}
              </div>
            );
          })}
        </div>
        <p className="delivery-hint">{preview.untouchedSummary}</p>
        <div className="row-wrap">
          <Button variant="secondary" size="sm" icon="refresh" disabled={previewMutation.isPending} onClick={() => previewMutation.mutate()}>
            {previewMutation.isPending ? '正在重检…' : '重新检查'}
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon="folder"
            disabled={previewMutation.isPending || applyMutation.isPending || applyReason !== undefined}
            {...(applyReason === undefined ? {} : { disabledReason: applyReason })}
            onClick={() => applyMutation.mutate()}
          >
            {applyMutation.isPending ? '正在写入…' : '确认应用到原目录'}
          </Button>
          {unresolved ? (
            <span className="action-reason"><Icon name="lock" size="sm" />选择处理方式并重新检查后，才能冻结预览。</span>
          ) : null}
        </div>
        {result === undefined ? null : (
          <div className="apply-result">
            <p className="delivery-hint">
              回执 {result.receipt.status} · 写入 {String(result.resource.result?.applied ?? 0)} · 阻止 {String(result.resource.result?.blocked ?? 0)} · 未知 {String(result.resource.result?.unknown ?? 0)} · 未执行 {String(result.resource.result?.notExecuted ?? 0)}
            </p>
            {result.resource.result?.items.map((item) => (
              <div key={item.fileId} className="apply-item">
                <Badge tone={item.result === 'applied' ? 'ok' : item.result === 'blocked' ? 'danger' : 'idle'}>{item.result}</Badge>
                <span className="path">{item.path}</span>
                {item.message === undefined ? null : <span className="effect">{item.message}</span>}
              </div>
            ))}
            {result.receipt.status === 'unknown' ? (
              <Button variant="secondary" size="sm" icon="search" onClick={() => lookup.mutate(result.receipt.requestKey)}>
                读取回执
              </Button>
            ) : null}
          </div>
        )}
        {failure === undefined ? null : <p className="delivery-hint" style={{ color: 'var(--danger)' }}>{failure}</p>}
        {notice === undefined ? null : <p className="delivery-hint">{notice}</p>}
      </div>
    </section>
  );
}
