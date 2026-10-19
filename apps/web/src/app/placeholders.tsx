import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useBootstrap } from '../api/hooks.ts';
import { Badge } from '../components/Badge.tsx';
import { Card } from '../components/Card.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { Icon, type IconName } from '../components/Icon.tsx';
import { LinkButton } from '../components/Button.tsx';
import { ServiceNotice } from '../components/ServiceNotice.tsx';

export interface PlaceholderPageProps {
  readonly icon: IconName;
  readonly title: string;
  readonly description: string;
  readonly route?: string;
  readonly actions?: ReactNode;
}

/**
 * Route placeholder. Task/requirement canvases are implemented by other
 * modules under src/pages/**; until they land, these placeholders keep the
 * shell routable without importing modules that do not exist yet.
 */
export function PlaceholderPage({ icon, title, description, route, actions }: PlaceholderPageProps) {
  return (
    <div className="page">
      <Card className="placeholder">
        <span className="tile">
          <Icon name={icon} size="lg" />
        </span>
        <Badge tone="accent" icon="layers">
          占位页
        </Badge>
        <h2>{title}</h2>
        <p>{description}</p>
        {route === undefined ? null : <span className="route">{route}</span>}
        <div className="actions">
          {actions ?? (
            <>
              <LinkButton to="/" variant="secondary" size="sm" icon="home">
                返回主页
              </LinkButton>
              <LinkButton to="/tasks" variant="ghost" size="sm" icon="list">
                任务列表
              </LinkButton>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

export function TaskCanvasPlaceholder() {
  const { taskId } = useParams<{ taskId: string }>();
  const bootstrap = useBootstrap();
  return (
    <div className="page">
      <Card className="placeholder">
        <span className="tile">
          <Icon name="flow" size="lg" />
        </span>
        <Badge tone="accent" icon="layers">
          占位页
        </Badge>
        <h2>任务画布</h2>
        <p>统一任务画布由任务画布页面实现。节点、执行现场与交付面板接通后在这里展示；当前不会显示任何示例步骤或执行结果。</p>
        <span className="route">/tasks/{taskId ?? ':id'}</span>
        {bootstrap.isError ? <ServiceNotice className="status-banner" error={bootstrap.error} compact /> : null}
        <div className="actions">
          <LinkButton to="/tasks" variant="secondary" size="sm" icon="arrowLeft">
            返回任务列表
          </LinkButton>
          <LinkButton to={`/requirement/${encodeURIComponent(taskId ?? '')}`} variant="ghost" size="sm" icon="file">
            查看需求画布
          </LinkButton>
        </div>
      </Card>
    </div>
  );
}

export function RequirementCanvasPlaceholder() {
  const { requirementId } = useParams<{ requirementId: string }>();
  return (
    <div className="page">
      <Card className="placeholder">
        <span className="tile">
          <Icon name="file" size="lg" />
        </span>
        <Badge tone="accent" icon="layers">
          占位页
        </Badge>
        <h2>需求画布</h2>
        <p>需求草稿、规划记录、候选审阅与确认计划由需求画布页面实现。当前为占位页，不展示模拟规划结果。</p>
        <span className="route">/requirement/{requirementId ?? ':id'}</span>
        <div className="actions">
          <LinkButton to="/requirements" variant="secondary" size="sm" icon="arrowLeft">
            返回需求目录
          </LinkButton>
          <LinkButton to="/tasks" variant="ghost" size="sm" icon="list">
            任务列表
          </LinkButton>
        </div>
      </Card>
    </div>
  );
}

export function StartPlaceholder() {
  return (
    <PlaceholderPage
      icon="plus"
      title="开始任务"
      description="开始任务向导（项目 → 目标 → 流程 → 形成需求草稿）由后续页面实现。当前占位页不会创建任务，也不会调用模型。"
      route="/start"
      actions={
        <>
          <LinkButton to="/projects" variant="secondary" size="sm" icon="folder">
            查看项目
          </LinkButton>
          <LinkButton to="/" variant="ghost" size="sm" icon="home">
            返回主页
          </LinkButton>
        </>
      }
    />
  );
}

export function InboxPlaceholder() {
  return (
    <PlaceholderPage
      icon="inbox"
      title="待处理中心"
      description="等待你回答的规划问题、候选审阅、交付确认与执行失败集中在这里。当前为占位页；主页的「需要你处理」直接读取 /api/bootstrap 的真实条目。"
      route="/inbox"
    />
  );
}

export function ProjectsPlaceholder() {
  return (
    <PlaceholderPage
      icon="folder"
      title="项目"
      description="项目登记、工作模式与 Git 分支由项目页面实现。当前为占位页。"
      route="/projects"
    />
  );
}

export function GitPlaceholder() {
  return (
    <PlaceholderPage icon="gitRepo" title="Git 仓库" description="仓库浏览、提交差异、审查与合并请求由 Git 页面实现。当前为占位页。" route="/git" />
  );
}

export function RequirementsPlaceholder() {
  return (
    <PlaceholderPage
      icon="file"
      title="需求目录"
      description="按阶段汇总需求与规划任务；打开具体条目进入需求画布。当前为占位页。"
      route="/requirements"
    />
  );
}

export function WorkflowsPlaceholder() {
  return <PlaceholderPage icon="flow" title="流程" description="流程目录与步骤定义由流程页面实现。当前为占位页。" route="/workflows" />;
}

export function RuntimePlaceholder() {
  return (
    <PlaceholderPage
      icon="server"
      title="运行环境"
      description="OpenCode 受管进程、MCP 连接与运行时日志由运行环境页面实现。设置 → 服务里已展示 /api/opencode/status 的真实状态。"
      route="/runtime"
      actions={
        <>
          <LinkButton to="/settings" variant="secondary" size="sm" icon="settings">
            打开设置
          </LinkButton>
          <LinkButton to="/" variant="ghost" size="sm" icon="home">
            返回主页
          </LinkButton>
        </>
      }
    />
  );
}

export function TemplatesPlaceholder() {
  return <PlaceholderPage icon="template" title="模板任务" description="固定模板任务与参数填写由模板页面实现。当前为占位页。" route="/templates" />;
}

export function InsightsPlaceholder() {
  return <PlaceholderPage icon="chart" title="质量与用量" description="质量、用量与成本统计由质量页面实现。当前为占位页。" route="/insights" />;
}

export function KnowledgePlaceholder() {
  return <PlaceholderPage icon="book" title="知识库" description="只读资料与引用来源由知识库页面实现。当前为占位页。" route="/knowledge" />;
}

export function PptPlaceholder() {
  return <PlaceholderPage icon="slides" title="PPT 制作" description="演示文稿创作由 PPT 页面实现。当前为占位页。" route="/ppt" />;
}

export function ToolsPlaceholder() {
  return <PlaceholderPage icon="tool" title="工具与 Skill" description="内部 MCP 工具与 Skill 清单由工具页面实现。当前为占位页。" route="/tools" />;
}

export function DatabasesPlaceholder() {
  return <PlaceholderPage icon="db" title="数据库" description="数据库连接登记与只读查询由数据库页面实现。当前为占位页。" route="/databases" />;
}

export function RolesPlaceholder() {
  return <PlaceholderPage icon="users" title="角色管理" description="角色、职责与流程版本由角色页面实现。当前为占位页。" route="/roles" />;
}

export function NotFoundPlaceholder() {
  return (
    <PlaceholderPage
      icon="help"
      title="页面不存在"
      description="没有找到这个地址。可以从左侧菜单返回正式页面，或回到主页。"
      actions={
        <>
          <LinkButton to="/" variant="primary" size="sm" icon="home">
            返回主页
          </LinkButton>
          <Link className="btn ghost sm" to="/tasks">
            <Icon name="list" size="sm" />
            任务列表
          </Link>
        </>
      }
    />
  );
}

