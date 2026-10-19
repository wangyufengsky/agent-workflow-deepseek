import { LinkButton } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { HomeCapabilities } from './HomeCapabilities.tsx';
import { HomeFlowDemo } from './HomeFlowDemo.tsx';

/**
 * 主页是设计定位的展示页：标语 + 产品窗口流程演示 + 能力卡/入口 + 收尾 CTA。
 *
 * It deliberately reads no business data (no bootstrap statistics, inbox or
 * recent-activity dashboards). The shell already owns the service-connection
 * state; tasks/inbox/requirements remain one click away in the official menu
 * and in the capability entry cards below.
 */
export function HomePage() {
  return (
    <div className="page home">
      <section className="hero in">
        <span className="badge outline">
          <Icon name="sparkle" size="sm" />
          本地开发工作区
        </span>
        <h2>
          Everything is a <em>Workflow.</em>
        </h2>
        <p>
          万事皆流程，执行由你掌控。
          <br />
          先把想法说清楚，再让工作沿流程展开，每一步都有迹可循。
        </p>
        <div className="row">
          <LinkButton to="/start" variant="primary" size="lg" iconAfter="arrowRight">
            开始任务
          </LinkButton>
          <LinkButton to="/projects" variant="secondary" size="lg" icon="folder">
            查看项目
          </LinkButton>
        </div>
      </section>

      <HomeFlowDemo />
      <HomeCapabilities />
    </div>
  );
}
