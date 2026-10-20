import { SkillsView } from './SkillsView.tsx';
import { ToolsPolicyView } from './ToolsPolicyView.tsx';
import { type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useOpenCodeStatus } from '../../api/hooks.ts';
import { Button } from '../../components/Button.tsx';
import { PageHeaderSlot } from '../../components/PageHeaderSlot.tsx';
import { PageHeader } from '../../components/Card.tsx';

type ToolsTab = 'tools' | 'skills';

export function ToolsPage() {
  const [params, setParams] = useSearchParams();
  const tab: ToolsTab = params.get('tab') === 'skills' ? 'skills' : 'tools';
  const setTab = (value: ToolsTab) => setParams((current) => { const next = new URLSearchParams(current); next.set('tab', value); return next; });
  const statusQuery = useOpenCodeStatus();
  const queryClient = useQueryClient();

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
          工具
        </button>
        <button type="button" className="tab" role="tab" aria-selected={tab === 'skills'} onClick={() => { setTab('skills'); }}>
          Skill<span className="hint num">只读</span>
        </button>
      </div>

      {body}
    </div>
  );
}
