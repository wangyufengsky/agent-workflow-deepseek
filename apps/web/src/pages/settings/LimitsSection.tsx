import type { PublicSettings } from '@agent-workflow/shared';
import { DraftBooleanRow, DraftNumberRow, useSettingsDraft } from './draft.tsx';
import { SettingsHeading } from './shared.tsx';

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
  const draft = useSettingsDraft();
  const timeoutsEnabled = (draft.fields['execution.timeoutEnabled']?.value ?? settings.execution.timeoutEnabled) === true;
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

      <div className="card card-sec" aria-label="调度策略与业务时限" style={{ marginTop: 16 }}>
        <div className="row wrap" style={{ gap: 8, marginBottom: 2 }}>
          <span className="section-title grow">调度策略与业务时限</span>
          <span className="hint">保存后用于新任务</span>
        </div>
        <DraftNumberRow path="execution.maxConcurrentNodes" label="最大并发节点" hint="只读且无命令/写权限的独立节点可并行；写节点独占任务工作区。用于新执行。" section="limits" baseline={settings.execution.maxConcurrentNodes} min={1} max={16} unit="个" effect="live" />
        <DraftNumberRow path="execution.maxAttempts" label="单节点总尝试上限" hint="包含首次执行和显式重试；达到上限后创建恢复任务，不自动重投。用于新执行。" section="limits" baseline={settings.execution.maxAttempts} min={1} max={10} unit="次" effect="live" />
        <DraftBooleanRow path="execution.pauseAfterFailure" label="失败后暂停新增领取" hint="已运行的节点继续结算；关闭时可完成独立分支，失败分支仍待处理。用于新执行。" section="limits" baseline={settings.execution.pauseAfterFailure} effect="live" />
        <DraftNumberRow path="execution.pauseTimeoutMs" label="停止确认等待上限" hint="超过等待上限保留原请求号进入未知，不自动重发停止。用于新执行。" section="limits" baseline={settings.execution.pauseTimeoutMs} min={1} max={120} unit="秒" factor={1000} effect="live" />
        <DraftNumberRow path="execution.maxTaskAttempts" label="任务总尝试上限" hint="所有节点的尝试合计，包含首次执行；达到上限后保留现场并停止新增领取。" section="limits" baseline={settings.execution.maxTaskAttempts} min={1} max={50} unit="次" effect="live" />
        <DraftNumberRow path="execution.sessionErrorThreshold" label="会话异常阈值" hint="达到阈值后不再领取新步骤；检查运行环境后通过恢复任务继续。" section="limits" baseline={settings.execution.sessionErrorThreshold} min={1} max={10} unit="次" effect="live" />
        <DraftBooleanRow path="execution.timeoutEnabled" label="启用业务超时限制" hint="默认关闭。开启后总时长、尝试与设计阶段时限用于新任务；职业单独设置的时限仍有效。" section="limits" baseline={settings.execution.timeoutEnabled} effect="live" />
        {timeoutsEnabled ? (
          <div role="group" aria-label="业务超时时长">
            <DraftNumberRow path="execution.taskTimeoutMinutes" label="任务最大时长" hint="从首次开始到结束的总时长，包含暂停和等待；达到时限后确认停止全部活动步骤。" section="limits" baseline={settings.execution.taskTimeoutMinutes} min={1} max={10080} unit="分钟" effect="live" />
            <DraftNumberRow path="execution.nodeTimeoutMinutes" label="尝试超时" hint="单次尝试的最长时间；无法确认会话停稳时只核对原操作。" section="limits" baseline={settings.execution.nodeTimeoutMinutes} min={1} max={1440} unit="分钟" effect="live" />
            <DraftNumberRow path="execution.designTimeoutMinutes" label="设计阶段超时" hint="同一设计阶段从首次开始的累计时长，包含该阶段的重试与等待。" section="limits" baseline={settings.execution.designTimeoutMinutes} min={1} max={1440} unit="分钟" effect="live" />
          </div>
        ) : <p className="hint">业务时限关闭；已填写的时长保留，关闭期间不生效。验证命令超时始终有效。</p>}
        <div className="section-title" style={{ marginTop: 16 }}>显式重试等待</div>
        <p className="hint">只在你明确选择重试后等待；结果未知时先核对原操作，不自动重投。</p>
        {([
          ['modelRateLimit', '模型限流'],
          ['sessionError', '会话错误'],
          ['verificationFailure', '验证失败'],
        ] as const).map(([key, label]) => (
          <div key={key}>
            <DraftNumberRow path={`execution.retryDelays.${key}.initialMs`} label={`${label} · 初始等待`} hint="连续尝试按次数增加等待，最长不超过下项。" section="limits" baseline={settings.execution.retryDelays[key].initialMs} min={0} max={300} unit="秒" factor={1000} effect="live" />
            <DraftNumberRow path={`execution.retryDelays.${key}.maxMs`} label={`${label} · 最长等待`} section="limits" baseline={settings.execution.retryDelays[key].maxMs} min={0} max={300} unit="秒" factor={1000} effect="live" />
          </div>
        ))}
      </div>
    </div>
  );
}
