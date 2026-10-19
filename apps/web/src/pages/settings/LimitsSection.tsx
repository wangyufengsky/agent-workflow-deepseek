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
            hint="服务保存该字段；当前验证路径仍使用 Git 命令超时，尚未读取此字段。"
            section="limits"
            baseline={settings.execution.verifyCommandTimeoutMs}
            min={1}
            max={120}
            unit="分钟"
            factor={60000}
            effect="saved"
            issueMessage="验证命令超时需要在 1–120 分钟之间"
          />
        </div>
      </div>

      <div className="card card-sec" aria-label="未读取或未提供的执行字段" style={{ marginTop: 16 }}>
        <div className="row wrap" style={{ gap: 8, marginBottom: 2 }}>
          <span className="section-title grow">执行字段：只读与未提供</span>
          <Badge tone="unknown" icon="help">不伪造可编辑</Badge>
        </div>
        <SettingsRow label="最大并发节点" hint="字段已由服务保存，但当前执行引擎未读取；本页不提供编辑。" effect="unavailable">
          <ReadOnlyValue>{String(settings.execution.maxConcurrentNodes)} 个</ReadOnlyValue>
        </SettingsRow>
        <SettingsRow label="单节点最多尝试" hint="字段已由服务保存，但当前执行引擎未读取；本页不提供编辑。" effect="unavailable">
          <ReadOnlyValue>{String(settings.execution.maxAttempts)} 次</ReadOnlyValue>
        </SettingsRow>
        <SettingsRow label="暂停等待上限" hint="字段已由服务保存，但当前执行引擎未读取；本页不提供编辑。" effect="unavailable">
          <ReadOnlyValue>{String(Math.round(settings.execution.pauseTimeoutMs / 1000))} 秒</ReadOnlyValue>
        </SettingsRow>
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
