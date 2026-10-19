import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createRequestKey, type CatalogSnapshot, type PublicSettings } from '@agent-workflow/shared';
import { errorMessage, isServiceUnavailable, request } from '../../api/client.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { PendingBackendNotice } from '../../components/ServiceNotice.tsx';
import { SettingsHeading } from './shared.tsx';

function Limits({ title, rows }: { readonly title: string; readonly rows: readonly (readonly [string, string])[] }) {
  return (
    <div className="card kv-card">
      <div className="section-title" style={{ marginBottom: 12 }}>
        {title}
      </div>
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

export function ModelSection({ settings, catalog }: { readonly settings: PublicSettings; readonly catalog: CatalogSnapshot }) {
  const queryClient = useQueryClient();
  const toggleModel = useMutation({
    mutationFn: async (profileId: string) => {
      const models = settings.models.map((profile) => (profile.id === profileId ? { ...profile, enabled: !profile.enabled } : profile));
      await request('/api/settings', { method: 'PATCH', body: { requestKey: createRequestKey(), patch: { models } } });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
        queryClient.invalidateQueries({ queryKey: ['settings'] }),
      ]);
    },
  });
  const planningRows: readonly (readonly [string, string])[] = [
    ['单轮最多草稿', String(settings.planning.maxDrafts)],
    ['每轮修订次数', String(settings.planning.maxRevisions)],
    ['单次派发时长', `${String(settings.planning.perDispatchLimitMinutes)} 分钟`],
    ['规划总时长', `${String(settings.planning.timeLimitMinutes)} 分钟`],
    ['预算上限', `${String(settings.planning.budgetLimit)} ${settings.planning.currency}`],
    ['预览有效期', `${String(settings.planning.previewTtlMinutes)} 分钟`],
    ['记录保留', `${String(settings.planning.recordRetentionDays)} 天`],
  ];
  const executionRows: readonly (readonly [string, string])[] = [
    ['默认自动推进', settings.execution.autoAdvanceByDefault ? '开启' : '关闭'],
    ['最大并发节点', String(settings.execution.maxConcurrentNodes)],
    ['单节点最多尝试', String(settings.execution.maxAttempts)],
    ['节点超时', `${String(settings.execution.nodeTimeoutMinutes)} 分钟`],
    ['验证命令超时', `${String(Math.round(settings.execution.verifyCommandTimeoutMs / 1000))} 秒`],
    ['暂停等待上限', `${String(Math.round(settings.execution.pauseTimeoutMs / 1000))} 秒`],
  ];

  return (
    <div className="sect">
      <SettingsHeading title="模型与执行" lede="模型档案来自服务端 catalog；规划与执行限制来自当前设置（只读）。" readOnly />

      <div className="card card-sec">
        {catalog.modelProfiles.length === 0 ? (
          <EmptyState compact icon="sparkle" title="还没有模型档案" description="服务端 catalog 未提供模型配置。" />
        ) : (
          catalog.modelProfiles.map((profile) => (
            <div key={profile.id} className="model-row">
              <span className="tile">
                <Icon name="sparkle" />
              </span>
              <div className="grow">
                <div className="name">{profile.label}</div>
                <div className="meta">
                  {profile.provider} / {profile.model} · 角色 {profile.roles.join(' / ')}
                </div>
              </div>
              <Badge tone={profile.enabled ? 'ok' : 'idle'} icon={profile.enabled ? 'check' : 'stop'}>
                {profile.enabled ? '已启用' : '已停用'}
              </Badge>
              <Button
                variant="secondary"
                size="sm"
                icon={profile.enabled ? 'stop' : 'play'}
                disabled={toggleModel.isPending}
                onClick={() => { toggleModel.mutate(profile.id); }}
              >
                {profile.enabled ? '停用' : '启用'}
              </Button>
            </div>
          ))
        )}
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <Limits title="规划限制" rows={planningRows} />
        <Limits title="执行限制" rows={executionRows} />
      </div>

      {toggleModel.isError ? <p className="hint" style={{ marginTop: 10, color: 'var(--danger)' }}>{isServiceUnavailable(toggleModel.error) ? '服务未连接，设置未保存。' : errorMessage(toggleModel.error)}</p> : null}
      <PendingBackendNotice
        className="settings-note"
        message="模型档案启停通过服务端设置接口保存；角色映射与默认模型仍由配置决定，停用不会结束正在运行的任务会话。"
      />
    </div>
  );
}
