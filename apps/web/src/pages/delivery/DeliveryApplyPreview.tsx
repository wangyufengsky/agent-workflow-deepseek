import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createRequestKey,
  type ConflictResolutionValue,
  type ConflictTypeValue,
  type DirectoryApplyPreview,
  type FileChange,
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
import { Modal } from '../../components/Modal.tsx';
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

/** 设计要求的六类冲突（服务端 conflictType 一一对应，未提供时不猜）。 */
const CONFLICT_TYPE_LABEL: Record<ConflictTypeValue, string> = {
  both_modified: '原文件与任务都修改',
  add_add: '任务新增路径原目录已出现',
  delete_vs_modified: '任务删除而原文件已修改',
  modified_vs_deleted: '原文件被删而任务继续改',
  type_conflict: '目录 / 文件类型冲突',
  unsupported_binary_or_link: '不支持的二进制或链接',
};

const RESOLUTION_LABEL: Record<ConflictResolutionValue, string> = {
  keep_original: '保留当前原文件',
  take_task: '采用任务版本（覆盖已有修改，需再确认）',
  manual_then_recheck: '我已手动解决并只重新检查这一项',
  exclude: '暂不交付该项（留在独立副本）',
};

const RESULT_LABEL: Record<string, string> = {
  applied: '已应用',
  blocked: '被阻塞',
  unknown: '待核实',
  not_executed: '未执行',
  skipped: '未执行',
};

interface DeliveryApplyPreviewProps {
  readonly delivery: TaskDelivery;
  /** 原项目目录（只读显示，用于应用确认对话框）。 */
  readonly originalRoot?: string;
  /** 任务独立副本路径（只读显示，三来源图例用）。 */
  readonly copyRoot?: string;
  /** 变更集文件（二进制 / 权限 / 大文件身份来自服务扫描，不猜测）。 */
  readonly files?: readonly FileChange[];
}

/**
 * 非 Git 任务的三方应用：生成只读预览 → 逐项处理冲突 → 冻结预览 → 确认对话框 → 写入原目录。
 * 事实边界：
 * - 三方文本内容读口服务端尚未提供（C1），界面只展示服务返回的逐项事实与处理选项，不伪造三栏 diff；
 * - 备份证据只在服务真实提供时显示，否则明确写「服务未提供备份证据」；
 * - 写入由服务端执行并返回逐项回执；UNKNOWN 只按原请求核对，不重发。
 */
export function DeliveryApplyPreview({ delivery, originalRoot, copyRoot, files = [] }: DeliveryApplyPreviewProps) {
  const queryClient = useQueryClient();
  const preview = delivery.applyPreview;
  const [resolutions, setResolutions] = useState<Record<string, ConflictResolutionValue>>({});
  const [selectionDirty, setSelectionDirty] = useState(false);
  const [takeTaskConfirm, setTakeTaskConfirm] = useState<string | null>(null);
  const [applyConfirmOpen, setApplyConfirmOpen] = useState(false);
  const [result, setResult] = useState<DirectoryApplyResult | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  /** 原目录读取失败：明确没有写入，确认应用不可用，只提供「重新读取」。 */
  const [previewReadFailed, setPreviewReadFailed] = useState(false);
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
      setPreviewReadFailed(false);
      setSelectionDirty(false);
      setApplyConfirmOpen(false);
      setNotice(
        `预览已冻结（可应用 ${String(next.counts.applicable)} / 冲突 ${String(next.counts.conflict)} / 不支持 ${String(next.counts.unsupported)}）；确认应用前原目录不会改变。`,
      );
      await invalidate();
    },
    onError: (error) => {
      setNotice(undefined);
      setPreviewReadFailed(true);
      setFailure(
        isServiceUnavailable(error)
          ? '服务未连接，无法生成预览；明确没有写入、删除或移动任何文件，候选变更、选择与独立副本都保留。只提供「重新读取」。'
          : `原目录读取失败：${errorMessage(error)}。明确没有写入、删除或移动任何文件；候选变更、选择与独立副本都保留，确认应用不可用，只提供「重新读取」。`,
      );
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
      setApplyConfirmOpen(false);
      setNotice(
        applied.receipt.status === 'succeeded'
          ? `应用完成：写入 ${String(applied.resource.result?.applied ?? 0)} 项，阻止 ${String(applied.resource.result?.blocked ?? 0)} 项，未执行 ${String(applied.resource.result?.notExecuted ?? 0)} 项。`
          : `应用回执状态：${applied.receipt.status}；请通过回执核对结果，不要重复提交。`,
      );
      await invalidate();
    },
    onError: (error) => {
      setNotice(undefined);
      setApplyConfirmOpen(false);
      setFailure(isServiceUnavailable(error) ? '服务未连接，未写入原目录。' : errorMessage(error));
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
      <section className="delivery-section" aria-label="应用到原项目">
        <div className="delivery-section-head">
          <h3>应用到原目录</h3>
          <Badge tone="unknown" icon="help">尚未预览</Badge>
        </div>
        <div className="apply-preview">
          <div className="apply-sources" aria-label="三来源图例">
            <span className="src">基线（快照时间服务未提供）</span>
            <span className="src">任务副本 {copyRoot === undefined ? '' : `· ${copyRoot}`}</span>
            <span className="src">当前原目录（尚未检查）</span>
          </div>
          <p className="delivery-hint">
            这是非 Git 项目。应用前先生成逐项预览：服务端比较基线快照、任务副本与当前原目录，列出可应用 / 冲突 / 不支持项；
            预览只读，不会改变原目录。三方文本内容读口服务端尚未提供，本视图不伪造三栏 diff。
          </p>
          <div className="row-wrap">
            <Button variant="secondary" size="sm" icon="folder" disabled={previewMutation.isPending} disabledReason={previewMutation.isPending ? '正在生成应用预览，等待服务回执…' : undefined} onClick={() => previewMutation.mutate()}>
              {previewMutation.isPending ? '正在检查…' : '生成应用预览'}
            </Button>
          </div>
          {failure === undefined ? null : <p className="delivery-hint danger-text">{failure}</p>}
          {notice === undefined ? null : <p className="delivery-hint">{notice}</p>}
        </div>
      </section>
    );
  }

  const { counts } = preview;
  const expiredMs = Date.parse(preview.expiresAt);
  const expired = Number.isFinite(expiredMs) && expiredMs <= Date.now();
  const unresolved = counts.unresolved > 0;
  const fileById = new Map(files.map((file) => [file.fileId, file]));
  const conflicted = preview.items.filter((item) => item.check === 'conflict' || item.check === 'unsupported');
  const resolutionOf = (fileId: string): ConflictResolutionValue | undefined =>
    resolutions[fileId] ?? preview.items.find((item) => item.fileId === fileId)?.resolution;
  const resolutionCounts = conflicted.reduce(
    (total, item) => {
      const resolution = resolutionOf(item.fileId);
      if (resolution === undefined) total.unresolved += 1;
      else if (resolution === 'take_task') total.takeTask += 1;
      else if (resolution === 'keep_original') total.keepOriginal += 1;
      else if (resolution === 'exclude') total.excluded += 1;
      else total.manual += 1;
      return total;
    },
    { takeTask: 0, keepOriginal: 0, excluded: 0, manual: 0, unresolved: 0 },
  );
  const writableItems = preview.items.filter((item) => item.check === 'applicable' && resolutionOf(item.fileId) !== 'exclude');
  const writeStats = writableItems.reduce(
    (total, item) => {
      if (item.change === 'A') total.added += 1;
      else if (item.change === 'D') total.deleted += 1;
      else total.modified += 1;
      return total;
    },
    { added: 0, modified: 0, deleted: 0 },
  );
  const applyReason = previewReadFailed
    ? '原目录读取失败：明确没有写入任何文件；先「重新读取」成功后才能确认应用。'
    : expired
    ? '预览已过期，重新检查后再确认。'
    : unresolved
      ? `还有 ${String(counts.unresolved)} 项冲突未处理，先处理并重新检查冻结预览。`
      : selectionDirty
        ? '改动选择会让冻结预览失效；先「重新检查并冻结预览」。'
        : undefined;

  const setResolution = (fileId: string, value: ConflictResolutionValue | '') => {
    if (value === 'take_task') {
      setTakeTaskConfirm(fileId);
      return;
    }
    setResolutions((current) => {
      const next = { ...current };
      if (value === '') delete next[fileId];
      else next[fileId] = value;
      return next;
    });
    setSelectionDirty(true);
  };

  return (
    <section className="delivery-section" aria-label="应用到原项目">
      <div className="delivery-section-head">
        <h3>应用到原目录 · 预览</h3>
        <Badge tone={unresolved ? 'fail' : expired ? 'warn' : 'ok'} icon={unresolved ? 'alert' : 'check'}>
          {unresolved ? `${String(counts.unresolved)} 项待处理` : expired ? '预览已过期' : '预览已冻结'}
        </Badge>
        <span className="spacer" />
        <span className="muted-note">
          冻结于 {new Date(preview.checkedAt).toLocaleString('zh-CN')} · 到期 {new Date(preview.expiresAt).toLocaleString('zh-CN')}
        </span>
      </div>
      <div className="apply-preview">
        <div className="apply-sources" aria-label="三来源图例">
          <span className="src">基线（快照时间服务未提供）</span>
          <span className="src">任务副本 {copyRoot === undefined ? '· 服务未返回副本路径' : `· ${copyRoot}`}</span>
          <span className="src">当前原目录 {originalRoot === undefined ? '· 服务未返回原目录' : `· ${originalRoot}`}</span>
        </div>
        <div className="apply-counts">
          <div className="apply-count"><span className="l">可应用</span><span className="v">{String(counts.applicable)}</span></div>
          <div className="apply-count"><span className="l">冲突</span><span className="v">{String(counts.conflict)}</span></div>
          <div className="apply-count"><span className="l">不支持</span><span className="v">{String(counts.unsupported)}</span></div>
          <div className="apply-count"><span className="l">未解决</span><span className="v">{String(counts.unresolved)}</span></div>
        </div>
        <p className="delivery-hint">
          三方对照：基线（快照）｜任务副本｜当前原目录。服务端当前只返回逐项检查事实，未提供三方文本内容读口，
          因此这里不伪造三栏 diff；文本冲突逐项处理选项由服务判定，二进制 / 链接只显示身份与大小（服务提供时）。
        </p>
        <div className="apply-items">
          {preview.items.map((item) => {
            const showResolution = item.check === 'conflict' || item.check === 'unsupported';
            const resolution = resolutionOf(item.fileId);
            const sourceFile = fileById.get(item.fileId);
            const binary = sourceFile?.binary === true;
            return (
              <div key={item.fileId} className={`apply-item ${showResolution ? 'has-conflict' : ''}`}>
                <div className="apply-item-head">
                  <Badge tone={CHECK_TONE[item.check]}>{CHECK_LABEL[item.check]}</Badge>
                  <span className="path" title={item.detail}>
                    {item.change === 'A' ? '' : `${CHANGE_STATUS_LABEL[item.change]} · `}
                    {item.path}
                  </span>
                  <span className="effect">{EFFECT_LABEL[item.plannedEffect]}</span>
                </div>
                <div className="apply-item-facts">
                  {item.conflictType === undefined ? null : <span className="fact">冲突类型：{CONFLICT_TYPE_LABEL[item.conflictType]}</span>}
                  {binary ? <span className="fact">二进制 · 不可按文本合并，只能选择保留 / 采用 / 暂不交付</span> : null}
                  {sourceFile?.mode === undefined ? null : (
                    <span className="fact">权限 {sourceFile.mode.old ?? '?'} → {sourceFile.mode.new ?? '?'}</span>
                  )}
                  {sourceFile?.binary === true || sourceFile?.sizeClass !== undefined ? (
                    <span className="fact">大小分类：{sourceFile.sizeClass === 'too_large' ? '过大' : sourceFile.sizeClass === 'large' ? '大文件' : '普通'}</span>
                  ) : null}
                  {item.detail === undefined ? null : <span className="fact">{item.detail}</span>}
                </div>
                {showResolution ? (
                  <select
                    className="select"
                    aria-label={`${item.path} 处理方式`}
                    value={resolution ?? ''}
                    disabled={applyMutation.isPending}
                    onChange={(event) => { setResolution(item.fileId, event.target.value as ConflictResolutionValue | ''); }}
                  >
                    <option value="">未选择</option>
                    <option value="keep_original">{RESOLUTION_LABEL.keep_original}</option>
                    <option value="take_task">{RESOLUTION_LABEL.take_task}</option>
                    <option value="manual_then_recheck">{RESOLUTION_LABEL.manual_then_recheck}</option>
                    <option value="exclude">{RESOLUTION_LABEL.exclude}</option>
                  </select>
                ) : null}
                {takeTaskConfirm === item.fileId ? (
                  <div className="banner warn apply-take-confirm" role="alertdialog" aria-label="采用任务版本确认">
                    <Icon name="alert" />
                    <div className="grow">
                      <b>采用任务版本会覆盖当前原文件</b>
                      <br />
                      {item.path} 的当前原目录内容将被任务版本替换；该项处理会先记入预览，确认应用后才真正写入。是否继续？
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => { setTakeTaskConfirm(null); }}>取消</Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        setResolutions((current) => ({ ...current, [item.fileId]: 'take_task' }));
                        setSelectionDirty(true);
                        setTakeTaskConfirm(null);
                      }}
                    >
                      确认采用任务版本
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        <p className="delivery-hint">不会改动（无关文件）：{preview.untouchedSummary}</p>
        <div className="row-wrap">
          <Button variant="secondary" size="sm" icon="refresh" disabled={previewMutation.isPending} disabledReason={previewMutation.isPending ? '正在重新检查，等待服务回执…' : undefined} onClick={() => previewMutation.mutate()}>
            {previewMutation.isPending ? '正在重检…' : '重新检查并冻结预览'}
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon="folder"
            disabled={previewMutation.isPending || applyMutation.isPending || applyReason !== undefined}
            disabledReason={
              applyMutation.isPending ? '正在写入原目录，等待服务回执…'
                : previewMutation.isPending ? '正在重新检查，等待服务回执…'
                  : applyReason
            }
            onClick={() => { setApplyConfirmOpen(true); }}
          >
            确认应用到原目录
          </Button>
          {applyReason === undefined ? null : <span className="action-reason"><Icon name="lock" size="sm" />{applyReason}</span>}
        </div>
        {result === undefined ? null : (
          <div className="apply-result">
            <p className="delivery-hint">
              回执 {result.receipt.status} · 写入 {String(result.resource.result?.applied ?? 0)} · 阻止 {String(result.resource.result?.blocked ?? 0)} · 未知 {String(result.resource.result?.unknown ?? 0)} · 未执行 {String(result.resource.result?.notExecuted ?? 0)}
            </p>
            <p className="delivery-hint">不是文件系统事务：已应用项保留，不整批重做；待核实项只核对原操作，不进入新的预览。</p>
            {result.resource.result?.items.map((item) => (
              <div key={item.fileId} className="apply-item">
                <Badge tone={item.result === 'applied' ? 'ok' : item.result === 'blocked' ? 'danger' : item.result === 'unknown' ? 'unknown' : 'idle'}>
                  {RESULT_LABEL[item.result] ?? item.result}
                </Badge>
                <span className="path">{item.path}</span>
                {item.message === undefined ? null : <span className="effect">{item.message}</span>}
              </div>
            ))}
            {result.receipt.status === 'unknown' ? (
              <div className="row-wrap">
                <Button variant="secondary" size="sm" icon="search" onClick={() => lookup.mutate(result.receipt.requestKey)}>
                  核对原操作（读取回执）
                </Button>
                <span className="muted-note">逐项“核对原操作”需要服务逐项核对读口（当前未提供），这里只核对整单原请求，不重发。</span>
              </div>
            ) : null}
          </div>
        )}
        {failure === undefined ? null : <p className="delivery-hint danger-text">{failure}</p>}
        {notice === undefined ? null : <p className="delivery-hint">{notice}</p>}
      </div>

      <Modal
        open={applyConfirmOpen}
        title="确认应用到原目录？"
        onClose={() => { setApplyConfirmOpen(false); }}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setApplyConfirmOpen(false); }}>取消</Button>
            <span className="spacer" />
            <Button
              variant="danger"
              icon="folder"
              disabled={applyMutation.isPending}
              disabledReason={applyMutation.isPending ? '正在写入原目录，等待服务回执…' : undefined}
              onClick={() => { applyMutation.mutate(); }}
            >
              {applyMutation.isPending ? '正在写入…' : '确认写入原目录'}
            </Button>
          </>
        }
      >
        <div className="stack-loose">
          <div className="delivery-dialog-facts">
            <div className="row-line"><span className="k">原目录</span><span className="v mono">{originalRoot ?? '服务未返回原目录路径'}</span></div>
            <div className="row-line"><span className="k">写入</span><span className="v">{String(writableItems.length)} 项 · 新增 {String(writeStats.added)} · 修改 {String(writeStats.modified)} · 删除 {String(writeStats.deleted)}</span></div>
            <div className="row-line"><span className="k">冲突处理</span><span className="v">保留当前原文件 {String(resolutionCounts.keepOriginal)} · 采用任务版本 {String(resolutionCounts.takeTask)} · 手动处理后重检 {String(resolutionCounts.manual)} · 暂不交付 {String(resolutionCounts.excluded)}</span></div>
            <div className="row-line"><span className="k">不写入 / 留副本</span><span className="v">{String(resolutionCounts.keepOriginal + resolutionCounts.excluded + resolutionCounts.manual)} 项留在独立副本或原目录</span></div>
            <div className="row-line"><span className="k">无关文件</span><span className="v">{preview.untouchedSummary}</span></div>
            <div className="row-line"><span className="k">备份证据</span><span className="v">服务未提供备份证据；不声称可撤销</span></div>
          </div>
          <div className="dialog-warning">
            <Icon name="alert" />
            <span>这不是文件系统事务：已写入项不会整批回滚；「采用任务版本」会覆盖当前原文件。焦点限定在本对话框，Esc / 取消关闭。</span>
          </div>
          {applyMutation.isError ? <p className="delivery-hint danger-text">{errorMessage(applyMutation.error)}</p> : null}
        </div>
      </Modal>
    </section>
  );
}
