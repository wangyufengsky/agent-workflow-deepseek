import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useBootstrap } from '../../api/hooks.ts';
import { Button, LinkButton } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { Skeleton } from '../../components/EmptyState.tsx';
import { Icon, type IconName } from '../../components/Icon.tsx';
import { IconButton } from '../../components/IconButton.tsx';
import { Modal } from '../../components/Modal.tsx';
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
  const message = draft.saveMessage;
  const pending = draft.pending;
  if (message === undefined && pending === undefined) return null;
  const tone = message?.tone ?? 'unknown';
  return (
    <div
      className={`banner ${tone === 'ok' ? 'ok' : tone === 'unknown' ? 'unknown' : 'danger'}`}
      role={tone === 'ok' ? 'status' : 'alert'}
      style={{ marginBottom: 14 }}
    >
      <Icon name={tone === 'ok' ? 'check' : tone === 'unknown' ? 'help' : 'alert'} />
      <div className="grow">
        {message?.message ?? '没有收到保存结果：上次保存在本页刷新前没有确认。普通设置保持只读；Git 账号仍可单独查看。'}
        {pending === undefined ? null : (
          <span className="mono" style={{ display: 'block', marginTop: 4, fontSize: 11.5, color: 'var(--muted)' }}>
            请求号 {pending.requestKey}
          </span>
        )}
      </div>
      {pending === undefined ? null : (
        <div className="actions">
          <Button variant="secondary" size="sm" icon="refresh" disabled={draft.reconciling} onClick={draft.reconcile}>
            {draft.reconciling ? '正在核对…' : '重新读取'}
          </Button>
        </div>
      )}
    </div>
  );
}

function SettingsSaveBar() {
  const draft = useSettingsDraft();
  const pending = draft.pending !== undefined;
  if (draft.dirtyCount === 0 && !pending) return null;
  const firstIssue = Object.values(draft.fields).find((field) => field.issue !== undefined);
  const issueText = draft.issueCount === 0 ? undefined : `有 ${String(draft.issueCount)} 处需要修正 · ${firstIssue?.label ?? '设置字段'}超出范围`;
  return (
    <div className={draft.issueCount > 0 ? 'settings-savebar has-issue' : 'settings-savebar'} role="region" aria-label={pending ? '正在核对上一次保存' : '未保存的设置'}>
      <Icon name={pending ? 'help' : draft.issueCount > 0 ? 'alert' : 'info'} />
      <div className="grow">
        <div style={{ fontSize: 13.5 }}>
          {pending ? '正在核对上一次保存' : `有 ${String(draft.dirtyCount)} 处未保存的修改 · 其中 ${String(draft.restartCount)} 处需要重启后生效`}
        </div>
        <div className="hint" style={{ marginTop: 3 }}>
          {pending
            ? '核对完成前普通设置保持只读，不会重新保存；可点击上方“重新读取”按原请求核对。'
            : issueText ?? '修改过的字段以琥珀描边标记；保存后写回服务端。Git 账号与模型服务中的路径/运行时/模型档案仍按各自按钮保存。'}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        disabled={draft.saving || pending}
        disabledReason={pending ? '先核对上一次保存。' : undefined}
        onClick={draft.discard}
      >
        放弃
      </Button>
      <Button
        variant="primary"
        size="sm"
        icon="check"
        disabled={draft.issueCount > 0 || draft.saving || pending}
        disabledReason={pending ? '正在核对上一次保存，确认前不能再次保存。' : draft.issueCount > 0 ? '先修正标红的字段' : draft.saving ? '正在保存…' : undefined}
        onClick={draft.save}
      >
        {pending ? <><span className="spin" aria-hidden="true" />核对中</> : draft.saving ? '保存中…' : '保存设置'}
      </Button>
    </div>
  );
}

function SettingsPageContent() {
  const [params, setParams] = useSearchParams();
  const section = parseSection(params.get('section'));
  const bootstrap = useBootstrap();
  const draft = useSettingsDraft();
  const navigate = useNavigate();
  const [leaveTarget, setLeaveTarget] = useState<string | null>(null);
  const dirtyCount = draft.dirtyCount;

  // P22-05: protect unsaved ordinary settings on reload/close and in-app links.
  useEffect(() => {
    if (dirtyCount === 0) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    const intercept = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target === '_blank' || anchor.origin !== location.origin) return;
      const url = new URL(anchor.href);
      if (url.pathname === location.pathname) return;
      event.preventDefault();
      event.stopPropagation();
      setLeaveTarget(`${url.pathname}${url.search}${url.hash}`);
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', intercept, true);
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', intercept, true); };
  }, [dirtyCount]);

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

      <Modal
        open={leaveTarget !== null}
        title="离开前要放弃哪些修改？"
        onClose={() => { setLeaveTarget(null); }}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setLeaveTarget(null); }}>留在本页</Button>
            <span className="spacer" />
            <Button
              variant="danger"
              onClick={() => {
                const target = leaveTarget;
                setLeaveTarget(null);
                if (target !== null) navigate(target);
              }}
            >
              全部放弃并离开
            </Button>
          </>
        }
      >
        <p>普通设置有 {String(dirtyCount)} 处未保存的修改；离开本页会丢弃这些修改。</p>
        <p className="hint">Git 账号与模型服务按各自按钮单独保存，与底部的“保存设置”互不影响。</p>
      </Modal>
    </div>
  );
}
