import { SkillsView } from './SkillsView.tsx';
import { ToolsPolicyView } from './ToolsPolicyView.tsx';
import { useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useOpenCodeStatus } from '../../api/hooks.ts';
import { MANAGED_MCP_TOOLS } from '../../api/catalog.ts';
import { Button } from '../../components/Button.tsx';
import { PageHeaderSlot } from '../../components/PageHeaderSlot.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { formatRelativeTime } from '../../app/format.ts';

type ToolsTab = 'tools' | 'skills';

export function ToolsPage() {
  const [tab, setTab] = useState<ToolsTab>('tools');
  const statusQuery = useOpenCodeStatus();
  const queryClient = useQueryClient();
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
    <div className="page wide">
      <PageHeader title="工具与 Skill" lede="决定新建会话里智能体能用哪些工具，并查看可用的 Skill。" />
      <PageHeaderSlot placement="actions"><Button variant="ghost" size="sm" icon="refresh" onClick={() => {
        void statusQuery.refetch();
        void queryClient.invalidateQueries({ queryKey: [tab === 'tools' ? 'tool-policy' : 'skills'] });
        if (tab === 'skills') void queryClient.invalidateQueries({ queryKey: ['skill-source'] });
      }}>刷新目录</Button></PageHeaderSlot>

      <div className="tabs" role="tablist" aria-label="工具与 Skill" style={{ marginBottom: 16 }}>
        <button type="button" className="tab" role="tab" aria-selected={tab === 'tools'} onClick={() => { setTab('tools'); }}>
          工具 <span className="hint num">{String(MANAGED_MCP_TOOLS.length)}</span>
        </button>
        <button type="button" className="tab" role="tab" aria-selected={tab === 'skills'} onClick={() => { setTab('skills'); }}>
          Skill <span className="hint num">只读</span>
        </button>
      </div>

      <p className="hint" style={{ marginBottom: 12 }}>
        最近读取 OpenCode 状态：{lastChecked}
      </p>

      {body}
    </div>
  );
}
