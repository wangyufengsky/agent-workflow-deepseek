import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROUTES, createRequestKey, type PptWork } from '@agent-workflow/shared';
import { apiGet, apiPost, errorMessage, isServiceUnavailable, request } from '../../api/client.ts';
import { useProjects } from '../../api/hooks.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button, LinkButton } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { PendingBackendNotice, ServiceNotice } from '../../components/ServiceNotice.tsx';

const CREATE_BLOCKED_REASON = 'PPT 内容生成尚未接通：当前只能创建/删除作品草稿，不会生成页面或调用模型。';
const UPLOAD_BLOCKED_REASON = '附件上传接口尚未接通：当前不能添加资料文件。';

const IDEAS = ['新人入门：项目架构说明', '季度复盘：交付与质量', '技术方案评审：恢复机制'] as const;

const STEPS = [
  { ordinal: '01', title: '讨论需求', detail: '助手会问清对象、目的和篇幅，必要时读取项目资料。', icon: 'help' as const },
  { ordinal: '02', title: '确认制作方向', detail: '给出大纲和视觉方向，你确认后才开始逐页制作。', icon: 'eye' as const },
  { ordinal: '03', title: '逐页制作与检查', detail: '每页生成后自动检查文字溢出与一致性，可随时手动改。', icon: 'layers' as const },
];

export function PptPage() {
  const queryClient = useQueryClient();
  const worksQuery = useQuery({ queryKey: ['ppt', 'works'], queryFn: async () => (await apiGet<{ works: readonly PptWork[] }>('/api/ppt/works')).data.works, retry: false });
  const createDraft = useMutation({
    mutationFn: async () => {
      await apiPost('/api/ppt/works', { requestKey: createRequestKey(), ...(projectId === '' ? {} : { projectId }), title: text.trim().slice(0, 40) || '未命名演示', topic: text.trim(), confirmCreate: true });
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['ppt', 'works'] }); },
  });
  const generateDraft = useMutation({
    mutationFn: async (id: string) => {
      await apiPost(ROUTES.pptWorkGenerate(id), { requestKey: createRequestKey(), confirmGenerate: true });
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['ppt', 'works'] }); },
  });
  const deleteDraft = useMutation({
    mutationFn: async (id: string) => { await request(`/api/ppt/works/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['ppt', 'works'] }); },
  });
  const projectsQuery = useProjects();
  const projects = projectsQuery.data ?? [];
  const [projectId, setProjectId] = useState('');
  const [text, setText] = useState('');

  const project = useMemo(() => projects.find((item) => item.id === projectId), [projectId, projects]);
  const valid = project !== undefined && text.trim().length >= 6;

  return (
    <div className="page">
      <PageHeader
        title="PPT 制作"
        lede="先讨论清楚要讲什么，再逐页制作。当前支持草稿与模型生成大纲；逐页生成仍未接通。"
        actions={
          <Badge tone="wait" icon="layers">
            仅草稿
          </Badge>
        }
      />

      {projectsQuery.isError ? (
        <div style={{ marginBottom: 16 }}>
          <ServiceNotice
            error={projectsQuery.error}
            onRetry={() => {
              void projectsQuery.refetch();
            }}
          />
        </div>
      ) : null}

      <section
        className="card"
        style={{ padding: 28, background: 'var(--glow), var(--fill-1)', backgroundRepeat: 'no-repeat' }}
        aria-label="创建演示"
      >
        <div className="eyebrow">PPT 制作</div>
        <h2 style={{ fontSize: 26, fontWeight: 500, marginTop: 10, letterSpacing: '-0.5px' }}>把想法，整理成一份演示。</h2>
        <p className="lede" style={{ marginTop: 10 }}>
          先和助手讨论清楚要讲什么，再逐页制作。全程可以改。
        </p>

        <div className="col" style={{ gap: 14, marginTop: 22 }}>
          <div className="row wrap" style={{ gap: 10 }}>
            <label className="label" htmlFor="ppt-project">
              项目
            </label>
            <select
              id="ppt-project"
              className="select ctl"
              style={{ width: 280 }}
              value={projectId}
              onChange={(event) => {
                setProjectId(event.target.value);
              }}
            >
              <option value="">选择项目</option>
              {projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <span className="hint">
              {project === undefined ? '演示归属于一个项目，便于引用资料与项目公约。' : `已选择 ${project.name}；创建时会把项目写入演示记录。`}
            </span>
          </div>

          <div className="field" style={{ margin: 0 }}>
            <label className="label" htmlFor="ppt-text">
              你希望这份 PPT 讲什么
            </label>
            <textarea
              id="ppt-text"
              className="textarea"
              value={text}
              placeholder={project === undefined ? '选择项目后填写' : '对象、目的、大概几页…（当前输入不会发送）'}
              onChange={(event) => {
                setText(event.target.value);
              }}
            />
            <div className="row" style={{ gap: 8 }}>
              <span className="hint grow">建议写清对象、目的与篇幅；创建讨论后由助手继续追问。</span>
              <span className="hint num">{String(text.length)} 字</span>
            </div>
          </div>

          <div className="row wrap" style={{ gap: 8 }}>
            <Button variant="ghost" size="sm" icon="upload" disabled disabledReason={UPLOAD_BLOCKED_REASON}>
              添加资料
            </Button>
            <span className="spacer" />
            <Button
              variant="primary"
              icon="arrowRight"
              disabled={!valid || createDraft.isPending}
              disabledReason={!valid ? '选择项目并至少写 6 个字' : undefined}
              onClick={() => { createDraft.mutate(); }}
            >
              {createDraft.isPending ? '正在创建…' : '保存为演示草稿'}
            </Button>
          </div>
          {projects.length === 0 && !projectsQuery.isLoading ? (
            <div className="banner info">
              <Icon name="info" />
              <div className="grow">
                服务里还没有登记项目。先在项目页登记一个本机项目，演示才能归属到真实项目。
              </div>
            </div>
          ) : null}
          <p className="hint">
            表单校验：{valid ? '已具备项目与说明，可以保存为演示草稿；页面生成仍未接通。' : '需要选择项目，并至少填写 6 个字说明。'}草稿可生成大纲（只读模型）；逐页生成仍未接通。
          </p>
        </div>

        {projectId.length === 0 ? (
          <div className="row wrap" style={{ gap: 8, marginTop: 18 }}>
            <span className="hint">灵感：</span>
            {IDEAS.map((idea) => (
              <button
                key={idea}
                type="button"
                className="chip"
                onClick={() => {
                  setText(idea);
                }}
              >
                {idea}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <div className="grid-3" style={{ marginTop: 16 }}>
        {STEPS.map((step) => (
          <section key={step.ordinal} className="card pad">
            <div className="row" style={{ gap: 8, marginBottom: 8 }}>
              <span className="badge outline num">{step.ordinal}</span>
              <Icon name={step.icon} size="sm" />
            </div>
            <h3 style={{ fontSize: 14, fontWeight: 500 }}>{step.title}</h3>
            <p className="hint" style={{ marginTop: 6, lineHeight: 1.6 }}>
              {step.detail}
            </p>
          </section>
        ))}
      </div>


      <PendingBackendNotice message="需要先接通：创建演示 / 讨论会话、逐页生成与检查、作品与导出、附件上传。当前页面不会发起任何模型调用或写入文件。" />
    </div>
  );
}
