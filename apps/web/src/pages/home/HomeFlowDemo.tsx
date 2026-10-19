import { useEffect, useRef, useState } from 'react';
import { Badge, type BadgeTone } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import type { IconName } from '../../components/Icon.tsx';

type DemoState = 'run' | 'idle' | 'done' | 'stall';

interface DemoNode {
  readonly name: string;
  readonly desc: string;
  readonly x: number;
  readonly y: number;
}

const DEMO_NODES: readonly DemoNode[] = [
  { name: '梳理需求', desc: '明确输入与目标', x: 40, y: 108 },
  { name: '实现功能', desc: '形成可用变更', x: 360, y: 38 },
  { name: '编写测试', desc: '验证执行结果', x: 360, y: 178 },
  { name: '核对交付', desc: '检查并交付', x: 680, y: 108 },
];

const INITIAL_STATES: readonly DemoState[] = ['run', 'idle', 'idle', 'idle'];
const DEMO_PLAN: readonly (readonly DemoState[])[] = [
  INITIAL_STATES,
  ['done', 'run', 'run', 'idle'],
  ['done', 'run', 'stall', 'idle'],
  ['done', 'done', 'run', 'idle'],
  ['done', 'done', 'done', 'run'],
];

const DEMO_CAPTIONS: readonly string[] = [
  '先把想法说清楚，明确输入与目标。',
  '规划完成后，两个步骤并行执行。',
  '“编写测试”停滞：缺少数据库读取权限，等待处理。',
  '授权后恢复执行，验证通过。',
  '全部步骤通过验收，核对交付。',
];

const DEMO_PHASES: readonly string[] = ['梳理需求', '并行执行', '停滞示例', '恢复验证', '核对交付'];

const STATE_META: Record<DemoState, { readonly label: string; readonly tone: BadgeTone; readonly icon: IconName }> = {
  run: { label: '执行中', tone: 'run', icon: 'play' },
  idle: { label: '待执行', tone: 'idle', icon: 'clock' },
  done: { label: '已完成', tone: 'done', icon: 'check' },
  stall: { label: '停滞', tone: 'stall', icon: 'alert' },
};

interface DemoEdge {
  readonly id: string;
  readonly from: number;
  readonly to: number;
  readonly d: string;
}

const DEMO_EDGES: readonly DemoEdge[] = [
  { id: 'e1', from: 0, to: 1, d: 'M240 140 C300 140 300 70 360 70' },
  { id: 'e2', from: 0, to: 2, d: 'M240 140 C300 140 300 210 360 210' },
  { id: 'e3', from: 1, to: 3, d: 'M560 70 C620 70 620 140 680 140' },
  { id: 'e4', from: 2, to: 3, d: 'M560 210 C620 210 620 140 680 140' },
];

function edgeTone(states: readonly DemoState[], edge: DemoEdge): 'idle' | 'done' | 'stall' {
  const target = states[edge.to] ?? 'idle';
  if (target === 'stall') return 'stall';
  const source = states[edge.from] ?? 'idle';
  return source === 'done' && target !== 'idle' ? 'done' : 'idle';
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Design-authority hero demo (originals/main/pages/home.html): five phases,
 * two seconds each, pausable / jumpable. It is explicitly labelled
 * 「非实时任务」and never claims to be real task data.
 */
export function HomeFlowDemo() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());
  const resumeOnVisible = useRef(false);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      setStep((current) => (current + 1) % DEMO_PLAN.length);
    }, 2000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [playing, step]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        resumeOnVisible.current = playing;
        setPlaying(false);
      } else if (resumeOnVisible.current) {
        resumeOnVisible.current = false;
        setPlaying(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [playing]);

  const states = DEMO_PLAN[step] ?? INITIAL_STATES;
  const caption = DEMO_CAPTIONS[step] ?? '';

  return (
    <section className="window in" style={{ animationDelay: '.12s' }} aria-label="流程演示">
      <div className="win-bar">
        <span className="lights" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span style={{ fontSize: 13 }}>流程演示</span>
        <span className="muted" style={{ fontSize: 13 }}>
          · 非实时任务
        </span>
        <span className="spacer" />
        <Button variant="ghost" size="sm" icon={playing ? 'pause' : 'play'} onClick={() => setPlaying((current) => !current)}>
          {playing ? '暂停' : '播放'}
        </Button>
      </div>
      <div className="demo">
        <div className="demo-inner">
          <svg viewBox="0 0 900 300" width="900" height="300" aria-hidden="true">
            {DEMO_EDGES.map((edge) => (
              <path key={edge.id} className="demo-edge" data-tone={edgeTone(states, edge)} d={edge.d} />
            ))}
          </svg>
          {DEMO_NODES.map((node, index) => {
            const state = states[index] ?? 'idle';
            const meta = STATE_META[state];
            return (
              <div key={node.name} className="dnode" data-s={state} style={{ left: node.x, top: node.y }}>
                <div className="row between">
                  <span className="n">{node.name}</span>
                  <Badge tone={meta.tone} icon={meta.icon}>
                    {meta.label}
                  </Badge>
                </div>
                <span className="d">{node.desc}</span>
              </div>
            );
          })}
          <p className="caption">{caption}</p>
        </div>
      </div>
      <div className="phase">
        <div className="seg" role="group" aria-label="演示阶段">
          {DEMO_PHASES.map((phase, index) => (
            <button
              key={phase}
              type="button"
              aria-pressed={index === step}
              onClick={() => {
                setStep(index);
                setPlaying(false);
              }}
            >
              <span className="num muted">{`0${String(index + 1)}`}</span>
              {phase}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <span className="hint">约 10 秒一轮 · 点阶段可停留查看</span>
      </div>
    </section>
  );
}
