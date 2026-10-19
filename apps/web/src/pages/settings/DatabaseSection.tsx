import { DATABASE_TYPE_META, type PublicSettings } from '@agent-workflow/shared';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { PendingBackendNotice } from '../../components/ServiceNotice.tsx';
import { SettingsHeading } from './shared.tsx';

const BLOCKED_REASON = '数据库连接写入接口尚未接通（服务端设置写入未就绪）。';
const PROBE_BLOCKED_REASON = '服务未连接，无法执行只读探针。';

export function DatabaseSection({ settings }: { readonly settings: PublicSettings }) {
  const database = settings.database;
  const connections = database.connections;

  return (
    <div className="sect">
      <SettingsHeading title="数据库" lede="只读查询使用的连接配置；密码通过服务端凭据存储，界面不展示明文。" readOnly />

      {connections.length === 0 ? (
        <div className="card card-sec">
          <EmptyState
            compact
            icon="db"
            title="还没有数据库连接"
            description="登记连接后可以在这里测试探针并执行只读查询。当前占位页不提供新增。"
            action={
              <Button variant="secondary" size="sm" icon="plus" disabled disabledReason={BLOCKED_REASON}>
                添加连接
              </Button>
            }
          />
        </div>
      ) : (
        <div className="card card-sec" style={{ paddingTop: 6, paddingBottom: 6 }}>
          {connections.map((connection) => (
            <div key={connection.id} className="list-row" style={{ cursor: 'default' }}>
              <span className="tile">
                <Icon name="db" />
              </span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row wrap" style={{ gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500 }}>{connection.name}</span>
                  <Badge outline>{DATABASE_TYPE_META[connection.type].label}</Badge>
                  {connection.readOnly ? (
                    <Badge tone="ok" icon="lock">
                      只读
                    </Badge>
                  ) : (
                    <Badge tone="wait" icon="alert">
                      可写（任务执行中仅允许只读查询）
                    </Badge>
                  )}
                  {connection.ssl ? <Badge tone="neutral" outline>SSL</Badge> : null}
                </div>
                <div className="hint" style={{ marginTop: 3 }}>
                  {connection.user}@{connection.host}:{String(connection.port)}/{connection.database}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid-3" style={{ marginTop: 16 }}>
        <div className="card pad">
          <div className="eyebrow">查询超时</div>
          <div className="v" style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginTop: 4 }}>
            {String(Math.round(database.queryTimeoutMs / 1000))} 秒
          </div>
        </div>
        <div className="card pad">
          <div className="eyebrow">返回行数上限</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginTop: 4 }}>{String(database.rowLimit)} 行</div>
        </div>
        <div className="card pad">
          <div className="eyebrow">语句长度上限</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginTop: 4 }}>{String(database.statementLimit)} 字符</div>
        </div>
      </div>

      <div className="row wrap" style={{ marginTop: 16, gap: 8 }}>
        <Button variant="secondary" icon="zap" disabled disabledReason={PROBE_BLOCKED_REASON}>
          测试连接
        </Button>
        <Button variant="primary" icon="check" disabled disabledReason={BLOCKED_REASON}>
          保存数据库设置
        </Button>
      </div>

      <PendingBackendNotice
        className="settings-note"
        message="数据库连接列表为只读占位：新增、测试与查询在当前阶段不发送写操作，也不会展示模拟结果。"
      />
    </div>
  );
}
