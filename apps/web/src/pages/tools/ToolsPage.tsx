import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROUTES, createRequestKey, type SkillSourceResponse, type SkillsResponse } from '@agent-workflow/shared';
import { apiGet, errorMessage, isServiceUnavailable, request } from '../../api/client.ts';
import { useBootstrap, useOpenCodeStatus } from '../../api/hooks.ts';
import { MANAGED_MCP_TOOLS, MCP_TOOLSETS, TOOL_ACCESS_LABEL, toolsOfToolset, type ManagedToolMeta } from '../../api/catalog.ts';
import { Badge, type BadgeTone } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { Modal } from '../../components/Modal.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Icon, type IconName } from '../../components/Icon.tsx';
import { PendingBackendNotice, ServiceNotice } from '../../components/ServiceNotice.tsx';
import { formatRelativeTime } from '../../app/format.ts';

type ToolsTab = 'tools' | 'skills';

const TOGGLE_BLOCKED_REASON = '单个工具开关未开放；按工具集启停并重启受管 OpenCode 后生效。';

const TOOLSET_ICON: Record<string, IconName> = {
  workflow: 'flow',
  git: 'git',
  database: 'db',
  workspace: 'terminal',
};

const ACCESS_TONE: Record<ManagedToolMeta['access'], BadgeTone> = {
  read: 'idle',
  write: 'wait',
  execute: 'danger',
};

function ToolRow({ tool }: { readonly tool: ManagedToolMeta }) {
  return (
    <div className="list-row" style={{ cursor: 'default', alignItems: 'flex-start' }}>
      <span className="tile" style={{ marginTop: 2 }}>
        <Icon name={TOOLSET_ICON[tool.toolset] ?? 'tool'} size="sm" />
      </span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="mono" style={{ fontSize: 13 }}>
            {tool.name}
          </span>
          <Badge tone={ACCESS_TONE[tool.access]} icon={tool.access === 'read' ? 'eye' : tool.access === 'write' ? 'edit' : 'terminal'}>
            {TOOL_ACCESS_LABEL[tool.access]}
          </Badge>
        </div>
        <div style={{ fontSize: 13, marginTop: 3 }}>{tool.title}</div>
        <div className="hint" style={{ marginTop: 2, lineHeight: 1.55 }}>
          {tool.description}
        </div>
        {tool.constraint === undefined ? null : (
          <div className="hint" style={{ marginTop: 4 }}>
            <Icon name="shield" size="sm" /> {tool.constraint}
          </div>
        )}
      </div>
      <Button variant="ghost" size="sm" icon="lock" disabled disabledReason={TOGGLE_BLOCKED_REASON}>
        工具集控制
      </Button>
    </div>
  );
}

function ToolsView() {
  const queryClient = useQueryClient();
  const statusQuery = useOpenCodeStatus();
  const bootstrap = useBootstrap();
  const toggleToolset = useMutation({
    mutationFn: async (toolset: string) => {
      const current = bootstrap.data?.settings.opencode.toolsets ?? [];
      const next = current.includes(toolset) ? current.filter((item) => item !== toolset) : [...current, toolset];
      await request('/api/settings', { method: 'PATCH', body: { requestKey: createRequestKey(), patch: { opencode: { toolsets: next } } } });
      return next;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
        queryClient.invalidateQueries({ queryKey: ['settings'] }),
      ]);
    },
  });
  const enabledToolsets = bootstrap.data?.settings.opencode.toolsets ?? [];
  const status = statusQuery.data;
  const integrationStatus = bootstrap.data?.integration.opencode.status;

  const mcpBadge = (() => {
    if (statusQuery.isLoading) return { tone: 'idle' as BadgeTone, icon: 'clock' as IconName, label: '正在读取 OpenCode 状态' };
    if (statusQuery.isError) return { tone: 'unknown' as BadgeTone, icon: 'help' as IconName, label: 'OpenCode 状态未知' };
    if (status?.mcp.connected === true) return { tone: 'ok' as BadgeTone, icon: 'check' as IconName, label: '内部 MCP 已连接' };
    return { tone: 'idle' as BadgeTone, icon: 'minus' as IconName, label: '内部 MCP 未连接' };
  })();

  return (
    <div className="col" style={{ gap: 16 }}>
      <section className="card pad">
        <div className="row wrap" style={{ gap: 10 }}>
          <span className="tile">
            <Icon name="tool" />
          </span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="row wrap" style={{ gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 500 }}>agent-workflow 内部 MCP</span>
              <Badge tone={mcpBadge.tone} icon={mcpBadge.icon}>
                {mcpBadge.label}
              </Badge>
              <Badge outline icon="lock">
                只读清单
              </Badge>
            </div>
            <div className="hint" style={{ marginTop: 4 }}>
              共 {String(MANAGED_MCP_TOOLS.length)} 个工具，按 toolset 分组注入受管 OpenCode。
              {status?.mcp.name === undefined ? '' : ` MCP 服务名：${status.mcp.name}。`}
              {status === undefined ? '' : status.mcp.tools > 0 ? ` 服务上报工具数：${String(status.mcp.tools)}。` : ' 服务未上报工具数。'}
            </div>
          </div>
          {status?.version === undefined ? null : <span className="hint mono">OpenCode {status.version}</span>}
        </div>
        <div className="row wrap" style={{ gap: 6, marginTop: 12 }}>
          {integrationStatus === undefined ? null : <Badge outline>集成状态：{integrationStatus}</Badge>}
          <span className="hint">按工具集启停，保存后重启受管 OpenCode 才会改变注入清单；单个工具开关未开放。</span>
        </div>
        <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
          {MCP_TOOLSETS.map((toolset) => {
            const enabled = enabledToolsets.includes(toolset.id);
            return (
              <Button
                key={toolset.id}
                variant={enabled ? 'secondary' : 'ghost'}
                size="sm"
                icon={enabled ? 'check' : 'minus'}
                disabled={toggleToolset.isPending}
                onClick={() => { toggleToolset.mutate(toolset.id); }}
              >
                {toolset.label} · {enabled ? '已启用' : '已停用'}
              </Button>
            );
          })}
        </div>
        {toggleToolset.isError ? <p className="hint" style={{ marginTop: 8, color: 'var(--danger)' }}>{isServiceUnavailable(toggleToolset.error) ? '服务未连接，未保存。' : errorMessage(toggleToolset.error)}</p> : null}
        {toggleToolset.isSuccess ? <p className="hint" style={{ marginTop: 8 }}>工具集设置已保存；重启 OpenCode 后生效。</p> : null}
        {statusQuery.isError ? (
          <div style={{ marginTop: 12 }}>
            <ServiceNotice
              error={statusQuery.error}
              compact
              onRetry={() => {
                void statusQuery.refetch();
              }}
            />
          </div>
        ) : null}
      </section>

      {MCP_TOOLSETS.map((toolset) => {
        const tools = toolsOfToolset(toolset.id);
        return (
          <section key={toolset.id} className="card">
            <div className="card-head">
              <span className="tile" style={{ width: 32, height: 32 }}>
                <Icon name={TOOLSET_ICON[toolset.id] ?? 'tool'} size="sm" />
              </span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row wrap" style={{ gap: 8 }}>
                  <span className="section-title">{toolset.label}</span>
                  <Badge outline>{String(tools.length)} 个工具</Badge>
                </div>
                <div className="hint" style={{ marginTop: 2 }}>
                  {toolset.description}
                </div>
              </div>
            </div>
            <div style={{ padding: '4px 6px 6px' }}>
              {tools.length === 0 ? (
                <EmptyState compact icon="tool" title="没有工具" description="该 toolset 尚未注册工具。" />
              ) : (
                tools.map((tool) => <ToolRow key={tool.name} tool={tool} />)
              )}
            </div>
          </section>
        );
      })}

      <PendingBackendNotice message="清单来源：packages/mcp/src/tools（服务端静态注册）。工具启用 / 停用、外部 MCP 来源与 Skill 安装状态都还没有服务端接口，因此不在此页修改。" />
    </div>
  );
}

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
    body = tab === 'tools' ? <ToolsView /> : <SkillsView />;
  }

  return (
    <div className="page">
      <PageHeader
        title="工具与 Skill"
        lede="查看受管 OpenCode 可用的内部工具与 Skill。工具清单来自服务端静态注册，按工具集启停；Skill 目录来自本机只读扫描。"
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
