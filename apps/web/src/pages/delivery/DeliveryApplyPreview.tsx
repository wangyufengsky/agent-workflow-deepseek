import type { DirectoryApplyPreview, TaskDelivery } from '@agent-workflow/shared';
import { CHANGE_STATUS_LABEL } from '../git/git-shared.tsx';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';

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

/**
 * 非 Git 应用预览（只读）。本轮没有冻结「应用确认」请求契约，
 * 因此「确认应用」始终禁用并显示服务原因；不伪造写入成功。
 */
export function DeliveryApplyPreview({ delivery }: { readonly delivery: TaskDelivery }) {
  const preview = delivery.applyPreview;

  if (preview === undefined) {
    return (
      <section className="delivery-section">
        <div className="delivery-section-head">
          <h3>应用到原目录</h3>
          <Badge tone="unknown" icon="help">预览未接通</Badge>
        </div>
        <div className="apply-preview">
          <p className="delivery-hint">
            这是非 Git 项目。三方检查与应用确认接口尚未接通，面板不会显示“可应用”或“已应用”的假结果。
            服务接通后会在这里给出逐项预览（基线 / 任务副本 / 当前原目录）。
          </p>
          <Button variant="secondary" size="sm" icon="folder" disabled disabledReason="非 Git 应用预览接口尚未接通。">
            确认应用
          </Button>
        </div>
      </section>
    );
  }

  const { counts } = preview;
  const unresolved = counts.unresolved > 0;

  return (
    <section className="delivery-section">
      <div className="delivery-section-head">
        <h3>应用到原目录 · 只读预览</h3>
        <Badge tone={unresolved ? 'fail' : 'ok'} icon={unresolved ? 'alert' : 'check'}>
          {unresolved ? `${String(counts.unresolved)} 项待处理` : '逐项检查完成'}
        </Badge>
        <span className="spacer" />
        <span className="muted-note">检查于 {preview.checkedAt}</span>
      </div>
      <div className="apply-preview">
        <div className="apply-counts">
          <div className="apply-count"><span className="l">可应用</span><span className="v">{String(counts.applicable)}</span></div>
          <div className="apply-count"><span className="l">冲突</span><span className="v">{String(counts.conflict)}</span></div>
          <div className="apply-count"><span className="l">不支持</span><span className="v">{String(counts.unsupported)}</span></div>
          <div className="apply-count"><span className="l">未解决</span><span className="v">{String(counts.unresolved)}</span></div>
        </div>
        <div className="apply-items">
          {preview.items.map((item) => (
            <div key={item.fileId} className="apply-item">
              <Badge tone={CHECK_TONE[item.check]}>{CHECK_LABEL[item.check]}</Badge>
              <span className="path" title={item.detail}>
                {item.change === 'A' ? '' : `${CHANGE_STATUS_LABEL[item.change]} · `}
                {item.path}
              </span>
              <span className="effect">{EFFECT_LABEL[item.plannedEffect]}</span>
            </div>
          ))}
        </div>
        <p className="delivery-hint">{preview.untouchedSummary}</p>
        <p className="delivery-hint">
          预览只读；应用确认接口尚未接通，本轮不提供写入原目录的动作。原目录中的文件不会因为查看预览而改变。
        </p>
        <div className="row-wrap">
          <Button variant="secondary" size="sm" icon="folder" disabled disabledReason="非 Git 应用确认接口尚未接通；先保留只读预览。">
            确认应用
          </Button>
          {unresolved ? (
            <span className="action-reason"><Icon name="lock" size="sm" />还有 {String(counts.unresolved)} 项未解决，不能冻结预览。</span>
          ) : null}
        </div>
      </div>
    </section>
  );
}
