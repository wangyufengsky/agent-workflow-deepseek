import type { PublicSettings } from '@agent-workflow/shared';
import { Badge } from '../../components/Badge.tsx';
import { DraftBooleanRow, DraftNumberRow } from './draft.tsx';
import { ReadOnlyValue, SettingsHeading, SettingsRow } from './shared.tsx';

function Limits({ title, rows }: { readonly title: string; readonly rows: readonly (readonly [string, string])[] }) {
  return (
    <div className="card kv-card">
      <div className="section-title" style={{ marginBottom: 12 }}>{title}</div>
      <dl className="kv">
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: 'contents' }}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function LimitsSection({ settings }: { readonly settings: PublicSettings }) {
  const planningRows: readonly (readonly [string, string])[] = [
    ['单轮最多草稿', String(settings.planning.maxDrafts)],
    ['每轮修订次数', String(settings.planning.maxRevisions)],
    ['单次派发时长', `${String(settings.planning.perDispatchLimitMinutes)} 分钟`],
    ['规划总时长', `${String(settings.planning.timeLimitMinutes)} 分钟`],
    ['预算上限', `${String(settings.planning.budgetLimit)} ${settings.planning.currency}`],
    ['预览有效期', `${String(settings.planning.previewTtlMinutes)} 分钟`],
    ['记录保留', `${String(settings.planning.recordRetentionDays)} 天`],
  ];

  return (
    <div className="sect">
      <SettingsHeading title="执行限制" lede="只开放当前执行路径真实读取的字段；可编辑字段保存后立即生效（用于新任务/新执行），本页没有需要重启的字段。未读取或未提供的字段明确标注，不伪造可编辑控件。" />

      <div className="grid-2" style={{ marginTop: 16, alignItems: 'start' }}>
        <Limits title="规划限制 · 只读" rows={planningRows} />
        <div className="card card-sec" aria-label="执行限制">
          <div className="row wrap" style={{ gap: 8, marginBottom: 2 }}>
            <span className="section-title grow">可编辑字段</span>
            <span className="hint">保存后用于新任务/新执行；已有任务保留创建时配置。</span>
          </div>
          <DraftBooleanRow
            path="execution.autoAdvanceByDefault"
            label="默认自动推进"
            hint="新执行创建时的默认值；已有执行不变。"
            section="limits"
            baseline={settings.execution.autoAdvanceByDefault}
            effect="live"
          />
          <DraftNumberRow
            path="execution.nodeTimeoutMinutes"
            label="节点超时"
            hint="单节点执行超时；保存后用于新执行。"
            section="limits"
            baseline={settings.execution.nodeTimeoutMinutes}
            min={1}
            max={1440}
            unit="分钟"
            effect="live"
          />
          <DraftNumberRow
            path="execution.verifyCommandTimeoutMs"
            label="验证命令超时"
            hint="独立验证与受控验证命令的最长运行时间。"
            section="limits"
            baseline={settings.execution.verifyCommandTimeoutMs}
            min={1}
            max={120}
            unit="分钟"
            factor={60000}
            effect="live"
            issueMessage="验证命令超时需要在 1–120 分钟之间"
          />
        </div>
      </div>

      <div className="card card-sec" aria-label="调度策略与未提供的业务时限" style={{ marginTop: 16 }}>
        <div className="row wrap" style={{ gap: 8, marginBottom: 2 }}>
          <span className="section-title grow">调度策略与业务时限</span>
          <Badge tone="unknown" icon="help">不伪造可编辑</Badge>
        </div>
        <DraftNumberRow path="execution.maxConcurrentNodes" label="最大并发节点" hint="只读且无命令/写权限的独立节点可并行；写节点独占任务工作区。用于新执行。" section="limits" baseline={settings.execution.maxConcurrentNodes} min={1} max={16} unit="个" effect="live" />
        <DraftNumberRow path="execution.maxAttempts" label="单节点总尝试上限" hint="包含首次执行和显式重试；达到上限后创建恢复任务，不自动重投。用于新执行。" section="limits" baseline={settings.execution.maxAttempts} min={1} max={10} unit="次" effect="live" />
        <DraftBooleanRow path="execution.pauseAfterFailure" label="失败后暂停新增领取" hint="已运行的节点继续结算；关闭时可完成独立分支，失败分支仍待处理。用于新执行。" section="limits" baseline={settings.execution.pauseAfterFailure} effect="live" />
        <DraftNumberRow path="execution.pauseTimeoutMs" label="停止确认等待上限" hint="超过等待上限保留原请求号进入未知，不自动重发停止。用于新执行。" section="limits" baseline={settings.execution.pauseTimeoutMs} min={1} max={120} unit="秒" factor={1000} effect="live" />
        <SettingsRow label="业务超时限制" hint="shared execution 没有 timeoutEnabled / 最大时长 / 尝试超时 / 设计超时字段。" effect="unavailable">
          <div className="col" style={{ gap: 6 }}>
            <label className="row" style={{ gap: 8, opacity: 0.6, whiteSpace: 'nowrap' }}>
              <input type="checkbox" disabled />
              启用业务超时限制
            </label>
            <span className="hint">服务未提供该字段，不能编辑。</span>
          </div>
        </SettingsRow>
        <SettingsRow label="重试等待" hint="模型限流 / 会话错误 / 验证失败的重试等待没有共享字段。" effect="unavailable">
          <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
            <input className="input" disabled placeholder="服务未提供" aria-label="模型限流重试等待（服务未提供）" style={{ width: 140 }} />
            <span className="hint">初始 / 最长等待均未提供</span>
          </div>
        </SettingsRow>
      </div>
    </div>
  );
}
