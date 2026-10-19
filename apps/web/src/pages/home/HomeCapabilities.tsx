import { Link } from 'react-router-dom';
import { Badge } from '../../components/Badge.tsx';
import { Icon } from '../../components/Icon.tsx';
import { LinkButton } from '../../components/Button.tsx';

const CAPABILITY_LINKS = [
  { to: '/workflows', title: '可复用的流程', body: '把团队做事的方法沉淀成流程：需求讨论、规划、实施、验收。下一次直接套用。', cta: '流程目录' },
  { to: '/tasks', title: '看得见的执行', body: '每个任务都有一张执行画布：哪一步在跑、哪一步停滞、为什么失败，一眼可见。', cta: '任务列表' },
  { to: '/inbox', title: '关键决定留给你', body: '执行中遇到需要判断的问题、需要授权的操作，会停下来等你，而不是自作主张。', cta: '待处理中心' },
  { to: '/knowledge', title: '每个结论都有出处', body: '知识库只读你授权的代码、文档和数据库，回答里的每一处引用都能回到原文。', cta: '知识库' },
] as const;

const ENTRY_LINKS = [
  { to: '/projects', icon: 'folder', title: '项目', desc: '接入本地项目' },
  { to: '/templates', icon: 'template', title: '模板任务', desc: '固定流程，填参即跑' },
  { to: '/ppt', icon: 'slides', title: 'PPT 制作', desc: '把想法讲清楚' },
  { to: '/insights', icon: 'chart', title: '质量与用量', desc: '看效果，算成本' },
] as const;

function CapabilityVisual({ index }: { readonly index: number }) {
  if (index === 0) {
    return (
      <div className="mini">
        <div className="eyebrow" style={{ marginBottom: 10 }}>
          需求开发 · 版本 r12
        </div>
        <div className="chain">
          <span>需求讨论</span>
          <i>→</i>
          <span>规划</span>
          <i>→</i>
          <span>实施</span>
          <i>→</i>
          <span>验收</span>
        </div>
      </div>
    );
  }
  if (index === 1) {
    return (
      <div className="mini col" style={{ gap: 8 }}>
        <div className="row between">
          <span style={{ fontSize: 13 }}>定位问题</span>
          <Badge tone="done" icon="check">
            已完成
          </Badge>
        </div>
        <div className="row between">
          <span style={{ fontSize: 13 }}>实施修复</span>
          <Badge tone="stall" icon="alert">
            停滞 · 等待权限
          </Badge>
        </div>
        <div className="row between">
          <span style={{ fontSize: 13 }}>验证</span>
          <Badge tone="idle" icon="clock">
            待执行
          </Badge>
        </div>
      </div>
    );
  }
  if (index === 2) {
    return (
      <div className="mini q-card">
        <span style={{ fontSize: 13 }}>本轮资料核对从哪里开始？</span>
        <div className="q-opt on">
          <span className="r" />
          先核对接口与错误恢复
        </div>
        <div className="q-opt">
          <span className="r" />
          先核对使用说明
        </div>
      </div>
    );
  }
  return (
    <div className="mini" style={{ fontSize: 13, lineHeight: 1.75, color: 'var(--ink-2)' }}>
      任务是否可执行由任务服务决定<span className="cite">1</span>；能读取哪些来源，由资料服务核对当前许可
      <span className="cite">2</span>。
    </div>
  );
}

/** Static product story from the design authority — contains no task data. */
export function HomeCapabilities() {
  return (
    <>
      <section aria-labelledby="home-cap-title">
        <div className="cap-head">
          <h3 id="home-cap-title">能力不断拓展，工作由你掌握</h3>
          <p>从一个目标出发，规划、执行、确认、交付，都在同一套流程里完成。</p>
        </div>
        <div className="caps">
          {CAPABILITY_LINKS.map((capability, index) => (
            <Link key={capability.to} className="card hoverable cap" to={capability.to}>
              <h4>{capability.title}</h4>
              <p>{capability.body}</p>
              <span className="go">
                {capability.cta}
                <Icon name="chevRight" size="sm" />
              </span>
              <div className="vis">
                <CapabilityVisual index={index} />
              </div>
            </Link>
          ))}
        </div>
        <div className="entries">
          {ENTRY_LINKS.map((entry) => (
            <Link key={entry.to} className="card hoverable entry" to={entry.to}>
              <span className="tile">
                <Icon name={entry.icon} />
              </span>
              <span>
                <span className="t">{entry.title}</span>
                <span className="d" style={{ display: 'block' }}>
                  {entry.desc}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="foot">
        <h3>从一个目标开始</h3>
        <p>选一个项目，写下想完成的事。agent-workflow 先给你一份需求草稿，确认之后才会执行。</p>
        <LinkButton to="/start" variant="primary" size="lg" iconAfter="arrowRight">
          开始任务
        </LinkButton>
      </section>
    </>
  );
}
