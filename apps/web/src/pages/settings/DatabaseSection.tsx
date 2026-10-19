import { DATABASE_TYPE_META, type PublicSettings } from '@agent-workflow/shared';
import { Badge } from '../../components/Badge.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { LinkButton } from '../../components/Button.tsx';
import { PendingBackendNotice } from '../../components/ServiceNotice.tsx';
import { SettingsHeading } from './shared.tsx';

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
            description="登记连接、测试探针与只读查询在「数据库」页完成；密码只保存在服务端凭据存储。"
            action={
              <LinkButton to="/databases" variant="secondary" size="sm" icon="plus">
                去添加连接
              </LinkButton>
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
        <LinkButton to="/databases" variant="secondary" icon="zap">
          打开数据库管理
        </LinkButton>
        <LinkButton to="/databases" variant="primary" icon="check">
          新增/测试连接
        </LinkButton>
      </div>

      <PendingBackendNotice
        className="settings-note"
        message="这里只展示连接概览；新增、探针与只读查询在「数据库」页执行，密码只在服务端加密存储。"
      />
    </div>
  );
}
