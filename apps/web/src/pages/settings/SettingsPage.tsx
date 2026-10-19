import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useBootstrap } from '../../api/hooks.ts';
import { LinkButton } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { Skeleton } from '../../components/EmptyState.tsx';
import { Icon, type IconName } from '../../components/Icon.tsx';
import { IconButton } from '../../components/IconButton.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { AppearanceSection } from './AppearanceSection.tsx';
import { DatabaseSection } from './DatabaseSection.tsx';
import { GitSection } from './GitSection.tsx';
import { ModelSection } from './ModelSection.tsx';
import { ServiceSection } from './ServiceSection.tsx';

type SectionKey = 'service' | 'appearance' | 'model' | 'git' | 'database';

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
    items: [{ key: 'model', label: '模型与执行', icon: 'sparkle' }],
  },
  {
    caption: '账号与网络',
    items: [{ key: 'git', label: 'Git 账号', icon: 'git' }],
  },
  {
    caption: '其他',
    items: [{ key: 'database', label: '数据库', icon: 'db' }],
  },
];

const SECTION_KEYS: readonly SectionKey[] = ['service', 'appearance', 'model', 'git', 'database'];

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
  const [params, setParams] = useSearchParams();
  const section = parseSection(params.get('section'));
  const bootstrap = useBootstrap();

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
        content = <ModelSection settings={data.settings} catalog={data.catalog} />;
        break;
      case 'git':
        content = <GitSection settings={data.settings} />;
        break;
      case 'database':
        content = <DatabaseSection settings={data.settings} />;
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
        lede="外观、本机服务、模型执行、Git 与数据库连接。写入能力随服务端接口逐步接通。"
        actions={
          <>
            <IconButton icon="refresh" label="刷新设置" onClick={retry} />
            <LinkButton to="/runtime" variant="secondary" size="sm" icon="server">
              运行环境
            </LinkButton>
          </>
        }
      />

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
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div>{content}</div>
      </div>
    </div>
  );
}
