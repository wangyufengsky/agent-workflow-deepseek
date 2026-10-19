import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ROUTES, type SkillSourceResponse, type SkillsResponse } from '@agent-workflow/shared';
import { apiGet } from '../../api/client.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { ReadableText } from '../node/ReadableText.tsx';

export function SkillsView() {
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const query = useQuery({ queryKey: ['skills'], queryFn: async () => (await apiGet<SkillsResponse>('/api/skills')).data, retry: false });
  const skills = query.data?.skills ?? [];
  const selected = skills.find((skill) => skill.id === selectedId) ?? skills[0];
  const source = useQuery({ queryKey: ['skill-source', selected?.id], enabled: selected !== undefined && !query.isError, queryFn: async () => (await apiGet<SkillSourceResponse>(ROUTES.skillSource(selected!.id))).data, retry: false });
  if (query.isLoading) return <p className="hint" role="status">正在读取 Skill 目录…</p>;
  if (query.isError) return <ServiceNotice error={query.error} onRetry={() => { void query.refetch(); }} />;
  if (skills.length === 0) return <EmptyState icon="wand" title="没有发现 Skill" description="当前发现目录中没有 SKILL.md。安装或修改请在对应目录中进行。" action={<Button size="sm" icon="refresh" onClick={() => { void query.refetch(); }}>重新读取</Button>} />;
  const matches = skills.filter((skill) => `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  // Never display an older document beneath a newly selected name or a read failure.
  const document = !source.isError && source.data?.id === selected?.id ? source.data : undefined;
  return <div className="tool-policy-layout">
    <aside className="card tool-sources" aria-label="Skill">
      <label className="tool-skill-search"><Icon name="search" /><input className="input ctl" aria-label="搜索 Skill" placeholder="搜索 Skill" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <div className="skill-directory">{matches.map((skill) => <button type="button" className="tool-source" key={skill.id} aria-current={selected?.id === skill.id} onClick={() => setSelectedId(skill.id)}><span className="tile"><Icon name="wand" size="sm" /></span><span className="grow"><span className="tool-source-name mono">{skill.name}</span><span className="tool-source-description">{skill.description || '没有描述'}</span></span></button>)}</div>
      {matches.length === 0 ? <p className="hint">没有匹配的 Skill。</p> : null}
      <p className="hint tool-source-note">Skill 从已配置的本机目录发现。这里只读，安装或修改请在对应目录中进行。</p>
    </aside>
    <section className="card tool-skill-document" aria-label={selected === undefined ? 'Skill 正文' : `${selected.name} 正文`}>
      <div className="row wrap"><Badge outline icon="eye">只读 · 阅读不会执行 Skill</Badge><span className="hint mono grow tool-skill-path">{selected?.path}</span></div>
      {source.isError ? <ServiceNotice error={source.error} onRetry={() => { void source.refetch(); }} /> : source.isLoading || document === undefined ? <p role="status" className="hint">正在读取正文…</p> : document.lines.length === 0 || document.lines.every((line) => line.text === '') ? <EmptyState icon="doc" title="Skill 正文为空" description="目录仍可浏览，当前文件没有可显示的正文。" /> : <ReadableText key={document.id} text={document.lines.map((line) => line.text).join('\n')} mediaType="text/markdown" markdownText={document.lines.map((line) => line.text).join('\n').replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '')} />}
    </section>
  </div>;
}
