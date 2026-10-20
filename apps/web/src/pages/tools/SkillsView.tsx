import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ROUTES, type SkillSourceResponse, type SkillsResponse } from '@agent-workflow/shared';
import { apiGet } from '../../api/client.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ReadableText } from '../node/ReadableText.tsx';

export function SkillsView() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('skill') ?? '';
  const search = params.get('search') ?? '';
  const setSelectedId = (value: string) => setParams((current) => { const next = new URLSearchParams(current); next.set('skill', value); return next; });
  const setSearch = (value: string) => setParams((current) => { const next = new URLSearchParams(current); if (value) next.set('search', value); else next.delete('search'); return next; }, { replace: true });
  const query = useQuery({ queryKey: ['skills'], queryFn: async () => (await apiGet<SkillsResponse>('/api/skills')).data, retry: false });
  const skills = query.data?.skills ?? [];
  const selected = skills.find((skill) => skill.id === selectedId) ?? skills[0];
  const source = useQuery({ queryKey: ['skill-source', selected?.id], enabled: selected !== undefined && !query.isError, queryFn: async () => (await apiGet<SkillSourceResponse>(ROUTES.skillSource(selected!.id))).data, retry: false });
  if (query.isLoading) return <p className="hint" role="status">正在读取 Skill 目录…</p>;
  if (query.isError) return <div className="banner danger" role="alert"><Icon name="alert" /><div className="grow"><b>Skill 目录读取失败</b><br />OpenCode 的 Skill 服务暂时不可用（OPENCODE_SKILLS_UNAVAILABLE）；目录读取成功前不显示任何 Skill 正文或示例内容。<br /><span className="hint mono">{query.error instanceof Error ? query.error.message : '读取失败'}</span></div><Button size="sm" icon="refresh" onClick={() => { void query.refetch(); }}>重试</Button></div>;
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
      {source.isError ? (
        <div className="banner danger" role="alert">
          <Icon name="alert" />
          <div className="grow">
            <b>Skill 正文读取失败</b>
            <br />
            文档读取失败，请重试；左侧目录仍可使用，可以先阅读其他 Skill。
            <span className="hint mono" style={{ display: 'block', marginTop: 4 }}>{source.error instanceof Error ? source.error.message : '读取失败'}</span>
          </div>
          <Button size="sm" icon="refresh" onClick={() => { void source.refetch(); }}>重试</Button>
        </div>
      ) : source.isLoading || document === undefined ? (
        <p role="status" className="hint">正在读取正文…</p>
      ) : document.lines.length === 0 || document.lines.every((line) => line.text === '') ? (
        <EmptyState icon="doc" title="Skill 正文为空" description={`文件已读取成功，但没有正文内容。需要补充时，请在 ${selected?.path ?? '对应 SKILL.md'} 中编辑；原文视图无内容可显示。`} />
      ) : (
        <>
          <div className="row wrap" style={{ gap: 8, marginBottom: 6 }}>
            <Badge outline icon="doc">Markdown 原文</Badge>
            <span className="hint">{String(document.lines.length)} 行 · 自动换行由阅读器工具栏控制 · 复制不含行号</span>
          </div>
          <ReadableText key={document.id} text={document.lines.map((line) => line.text).join('\n')} mediaType="text/markdown" markdownText={document.lines.map((line) => line.text).join('\n').replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '')} />
        </>
      )}
    </section>
  </div>;
}
