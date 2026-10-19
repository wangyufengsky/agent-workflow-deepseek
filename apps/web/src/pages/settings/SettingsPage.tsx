import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useBootstrap } from '../../api/hooks.ts';
import { Button, LinkButton } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { Skeleton } from '../../components/EmptyState.tsx';
import { Icon, type IconName } from '../../components/Icon.tsx';
import { IconButton } from '../../components/IconButton.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { AppearanceSection } from './AppearanceSection.tsx';
import { DatabaseSection } from './DatabaseSection.tsx';
import { DevSection } from './DevSection.tsx';
import { SettingsDraftProvider, useSettingsDraft } from './draft.tsx';
import { GitSection } from './GitSection.tsx';
import { LimitsSection } from './LimitsSection.tsx';
import { ModelSection } from './ModelSection.tsx';
import { NetworkSection } from './NetworkSection.tsx';
import { RetrySection } from './RetrySection.tsx';
import { ServiceSection } from './ServiceSection.tsx';
import './settings.css';

type SectionKey = 'service' | 'appearance' | 'model' | 'limits' | 'retry' | 'git' | 'network' | 'database' | 'dev';

interface SectionItem {
  readonly key: SectionKey;
  readonly label: string;
  readonly icon: IconName;
}

interface SectionGroup {
  readonly caption: string;
  readonly items: readonly SectionItem[];
}

const SECTION_GROUPS: readonly SectionGroup[] = [
  {
    caption: '通用',
    items: [
      { key: 'service', label: '服务', icon: 'server' },
      { key: 'appearance', label: '外观', icon: 'eye' },
    ],
  },
  {
    caption: '模型与执行',
    items: [
      { key: 'model', label: '模型服务', icon: 'sparkle' },
      { key: 'limits', label: '执行限制', icon: 'shield' },
      { key: 'retry', label: '重试等待', icon: 'refresh' },
    ],
  },
  {
    caption: '账号与网络',
    items: [
      { key: 'git', label: 'Git 账号', icon: 'git' },
      { key: 'network', label: '发布网络', icon: 'link' },
    ],
  },
  {
    caption: '其他',
    items: [
      { key: 'database', label: '数据库', icon: 'db' },
      { key: 'dev', label: '开发辅助', icon: 'terminal' },
    ],
  },
];

const SECTION_KEYS: readonly SectionKey[] = ['service', 'appearance', 'model', 'limits', 'retry', 'git', 'network', 'database', 'dev'];

function parseSection(value: string | null): SectionKey {
  const match = SECTION_KEYS.find((key) => key === value);
  return match ?? 'service';
}

function SectionSkeleton() {
  return (
    <div className="sect">
      <div className="card card-sec">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="frow">
            <Skeleton width={140} height={13} />
            <Skeleton width="60%" height={13} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SettingsPage() {
  return (
    <SettingsDraftProvider>
      <SettingsPageContent />
    </SettingsDraftProvider>
  );
}

function SettingsSaveMessage() {
  const draft = useSettingsDraft();
  if (draft.saveMessage === undefined) return null;
  const tone = draft.saveMessage.tone;
  return (
    <div
      className={`banner ${tone === 'ok' ? 'ok' : tone === 'unknown' ? 'unknown' : 'danger'}`}
      role={tone === 'ok' ? 'status' : 'alert'}
      style={{ marginBottom: 14 }}
    >
      <Icon name={tone === 'ok' ? 'check' : tone === 'unknown' ? 'help' : 'alert'} />
      <div className="grow">{draft.saveMessage.message}</div>
    </div>
  );
}

function SettingsSaveBar() {
  const draft = useSettingsDraft();
  if (draft.dirtyCount === 0) return null;
  return (
    <div className={draft.issueCount > 0 ? 'settings-savebar has-issue' : 'settings-savebar'} role="region" aria-label="未保存的设置">
      <Icon name={draft.issueCount > 0 ? 'alert' : 'info'} />
      <div className="grow">
        <div style={{ fontSize: 13.5 }}>
          有 {String(draft.dirtyCount)} 处未保存的修改 · {String(draft.restartCount)} 处需要重启后生效
        </div>
        <div className="hint" style={{ marginTop: 3 }}>
          {draft.issueCount > 0
            ? `有 ${String(draft.issueCount)} 处需要修正后才能保存。`
            : '修改过的字段以琥珀描边标记；保存后写回服务端。Git 账号与模型服务中的路径/运行时/模型档案仍按各自按钮保存。'}
        </div>
      </div>
      <Button variant="ghost" size="sm" disabled={draft.saving} onClick={draft.discard}>放弃</Button>
      <Button
        variant="primary"
        size="sm"
        icon="check"
        disabled={draft.issueCount > 0 || draft.saving}
        disabledReason={draft.issueCount > 0 ? '先修正标红的字段' : draft.saving ? '正在保存…' : undefined}
        onClick={draft.save}
      >
        {draft.saving ? '保存中…' : '保存设置'}
      </Button>
    </div>
  );
}

function SettingsPageContent() {
  const [params, setParams] = useSearchParams();
  const section = parseSection(params.get('section'));
  const bootstrap = useBootstrap();
  const draft = useSettingsDraft();

  const selectSection = (key: SectionKey) => {
    const next = new URLSearchParams(params);
    next.set('section', key);
    setParams(next, { replace: true });
  };

  const retry = () => {
    void bootstrap.refetch();
  };

  let content: ReactNode;
  if (section === 'appearance') {
    content = <AppearanceSection settings={bootstrap.data?.settings} />;
  } else if (bootstrap.isLoading) {
    content = <SectionSkeleton />;
  } else if (bootstrap.isError) {
    content = (
      <div className="sect">
        <ServiceNotice error={bootstrap.error} onRetry={retry} />
        <p className="hint" style={{ marginTop: 10 }}>
          设置数据来自 /api/bootstrap；服务未连接时只保留本地主题切换（外观），其余分区显示未连接状态。
        </p>
      </div>
    );
  } else if (bootstrap.data !== undefined) {
    const data = bootstrap.data;
    switch (section) {
      case 'service':
        content = <ServiceSection data={data} />;
        break;
      case 'model':
        content = <ModelSection data={data} />;
        break;
      case 'limits':
        content = <LimitsSection settings={data.settings} />;
        break;
      case 'retry':
        content = <RetrySection settings={data.settings} />;
        break;
      case 'git':
        content = <GitSection settings={data.settings} />;
        break;
      case 'network':
        content = <NetworkSection settings={data.settings} />;
        break;
      case 'database':
        content = <DatabaseSection settings={data.settings} />;
        break;
      case 'dev':
        content = <DevSection />;
        break;
      default:
        content = null;
    }
  } else {
    content = null;
  }

  return (
    <div className="page settings">
      <PageHeader
        title="设置"
        lede="外观、本机服务、模型与 OpenCode、执行限制、Git 与数据库连接；执行限制与监控字段共用底部保存条。"
        actions={
          <>
            <IconButton icon="refresh" label="刷新设置" onClick={retry} />
            <LinkButton to="/runtime" variant="secondary" size="sm" icon="server">
              运行环境
            </LinkButton>
          </>
        }
      />

      <SettingsSaveMessage />

      <div className="settings-split">
        <nav className="snav" aria-label="设置分区">
          {SECTION_GROUPS.map((group) => (
            <div key={group.caption}>
              <div className="cap">{group.caption}</div>
              {group.items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  aria-current={section === item.key ? true : undefined}
                  onClick={() => selectSection(item.key)}
                >
                  <Icon name={item.icon} />
                  {item.label}
                  {draft.dirtySections.has(item.key) ? (
                    <span className="settings-nav-dot" title="有未保存修改" aria-label="有未保存修改" />
                  ) : null}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div>{content}</div>
      </div>

      <SettingsSaveBar />
    </div>
  );
}
