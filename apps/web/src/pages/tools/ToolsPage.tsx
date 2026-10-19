import { ToolsPolicyView } from './ToolsPolicyView.tsx';
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ROUTES, type SkillSourceResponse, type SkillsResponse } from '@agent-workflow/shared';
import { apiGet, errorMessage } from '../../api/client.ts';
import { useOpenCodeStatus } from '../../api/hooks.ts';
import { MANAGED_MCP_TOOLS } from '../../api/catalog.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { Modal } from '../../components/Modal.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { formatRelativeTime } from '../../app/format.ts';

type ToolsTab = 'tools' | 'skills';

function SkillsView() {
  const [source, setSource] = useState<SkillSourceResponse | null>(null);
  const [sourceError, setSourceError] = useState<string | undefined>(undefined);
  const query = useQuery({
    queryKey: ['skills'],
    queryFn: async () => (await apiGet<SkillsResponse>('/api/skills')).data,
    retry: false,
  });
  if (query.isLoading) return <p className="hint">正在读取 Skill 目录…</p>;
  if (query.isError) {
    return <ServiceNotice error={query.error} onRetry={() => { void query.refetch(); }} />;
  }
  const skills = query.data?.skills ?? [];
  return (
    <div className="col" style={{ gap: 16 }}>
      {skills.length === 0 ? (
        <EmptyState
          icon="wand"
          title="没有发现 Skill"
          description="服务端只读扫描 ~/.claude/skills 与 ~/.agents/skills；当前目录中没有 SKILL.md。本页不展示示例 Skill，也不允许安装或修改。"
          action={
            <Button variant="secondary" size="sm" icon="refresh" onClick={() => { void query.refetch(); }}>
              重新读取
            </Button>
          }
        />
      ) : (
        <section className="card">
          <div className="card-head">
            <span className="tile"><Icon name="wand" /></span>
            <div className="grow">
              <span className="section-title">本机 Skill</span>
              <div className="hint" style={{ marginTop: 2 }}>共 {String(skills.length)} 个，只读扫描；不安装、不修改、不执行。</div>
            </div>
            <Button variant="secondary" size="sm" icon="refresh" onClick={() => { void query.refetch(); }}>重新读取</Button>
          </div>
          <div style={{ padding: '4px 6px 8px' }}>
            {skills.map((skill) => (
              <div key={skill.id} className="list-row" style={{ cursor: 'default', alignItems: 'flex-start' }}>
                <span className="tile" style={{ marginTop: 2 }}><Icon name="wand" size="sm" /></span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row wrap" style={{ gap: 8 }}>
                    <span className="mono" style={{ fontSize: 13 }}>{skill.name}</span>
                    <Badge outline>只读</Badge>
                  </div>
                  <div style={{ fontSize: 13, marginTop: 3 }}>{skill.description === '' ? '没有描述' : skill.description}</div>
                  <div className="hint mono" style={{ marginTop: 3, wordBreak: 'break-all' }}>{skill.path}</div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  icon="doc"
                  onClick={() => {
                    setSourceError(undefined);
                    void (async () => {
                      try {
                        setSource((await apiGet<SkillSourceResponse>(ROUTES.skillSource(skill.id))).data);
                      } catch (error) {
                        setSourceError(errorMessage(error));
                      }
                    })();
                  }}
                >
                  带行号源文
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}
      <p className="hint">Skill 正文与启用状态由 OpenCode 自身管理；本页只展示服务端扫描到的 SKILL.md 名称与描述。</p>
      {sourceError === undefined ? null : <p className="hint" style={{ color: 'var(--danger)' }}>读取源文失败：{sourceError}</p>}
      <Modal open={source !== null} title={source === null ? 'Skill 源文' : `Skill 源文 · ${source.name}`} onClose={() => { setSource(null); }} footer={<Button variant="ghost" onClick={() => { setSource(null); }}>关闭</Button>}>
        {source === null ? null : (
          <div className="col" style={{ gap: 8 }}>
            <div className="hint mono" style={{ wordBreak: 'break-all' }}>{source.path}</div>
            <div style={{ maxHeight: 520, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--fill-1)', padding: 8 }}>
              {source.lines.map((line) => (
                <div key={line.number} className="mono" style={{ display: 'flex', gap: 12, fontSize: 12.5, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  <span className="hint" style={{ width: 44, textAlign: 'right', flexShrink: 0 }}>{String(line.number)}</span>
                  <span>{line.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export function ToolsPage() {
  const [tab, setTab] = useState<ToolsTab>('tools');
  const statusQuery = useOpenCodeStatus();
  const lastChecked = useMemo(() => {
    if (statusQuery.isError) return '读取失败';
    if (statusQuery.dataUpdatedAt === 0) return '尚未读取';
    return formatRelativeTime(new Date(statusQuery.dataUpdatedAt).toISOString());
  }, [statusQuery.dataUpdatedAt, statusQuery.isError]);

  let body: ReactNode;
  if (statusQuery.isLoading) {
    body = <p className="hint">正在读取 OpenCode 与工具状态…</p>;
  } else {
    body = tab === 'tools' ? <ToolsPolicyView /> : <SkillsView />;
  }

  return (
    <div className="page">
      <PageHeader
        title="工具与 Skill"
        lede="管理服务端工具来源、单工具与项目继承策略；Skill 目录来自本机只读扫描。"
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon="refresh"
            onClick={() => {
              void statusQuery.refetch();
            }}
          >
            刷新状态
          </Button>
        }
      />

      <div className="tabs" role="tablist" aria-label="工具与 Skill" style={{ marginBottom: 16 }}>
        <button type="button" className="tab" role="tab" aria-selected={tab === 'tools'} onClick={() => { setTab('tools'); }}>
          工具 <span className="hint num">{String(MANAGED_MCP_TOOLS.length)}</span>
        </button>
        <button type="button" className="tab" role="tab" aria-selected={tab === 'skills'} onClick={() => { setTab('skills'); }}>
          Skill <span className="hint num">只读</span>
        </button>
      </div>

      <p className="hint" style={{ marginBottom: 12 }}>
        最近读取 OpenCode 状态：{lastChecked} · 运行状态来自 /api/opencode/status，不在此页缓存或模拟。
      </p>

      {body}
    </div>
  );
}
