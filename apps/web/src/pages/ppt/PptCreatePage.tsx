import { ROUTES, type ProjectSummary, type PptWork, type PptWorkCreateRequest } from '@agent-workflow/shared';
import { formatRelativeTime } from '../../app/format.ts';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { PptCreateForm } from './PptCreateForm.tsx';
import { derivePptProgress, pptPageSummary, type PptReceiptState } from './ppt-shared.tsx';

export interface PptCreatePageProps {
  readonly projects: readonly ProjectSummary[];
  readonly projectsLoading: boolean;
  readonly projectsError?: unknown;
  readonly receipt: PptReceiptState | null;
  readonly busy: boolean;
  readonly onVerify: (requestKey: string) => void;
  readonly onRetryProjects: () => void;
  readonly onCreate: (body: PptWorkCreateRequest) => void;
  readonly onOpenWork: (workId: string) => void;
  readonly onOpenWorks: () => void;
  readonly recentWorks: readonly PptWork[];
}

const HOW = [
  { no: '01', title: '讨论需求', text: '助手会问清对象、目的和篇幅，必要时读取项目资料。', art: 'talk' },
  { no: '02', title: '确认制作方向', text: '给出大纲和视觉方向，你确认后才开始逐页制作。', art: 'plan' },
  { no: '03', title: '逐页制作与检查', text: '每页生成后自动检查文字溢出与一致性，可随时手动改。', art: 'slides' },
] as const;

function HowArt({ art }: { readonly art: (typeof HOW)[number]['art'] }) {
  if (art === 'talk') {
    return (
      <div className="ppt-create-mini" aria-hidden="true">
        <span style={{ position: 'absolute', left: 12, top: 14, width: '46%', height: 16, borderRadius: 8, background: 'var(--fill-4)' }} />
        <span style={{ position: 'absolute', right: 12, top: 40, width: '38%', height: 16, borderRadius: 8, background: 'var(--accent)', opacity: 0.35 }} />
        <span style={{ position: 'absolute', left: 12, top: 62, width: '30%', height: 10, borderRadius: 5, background: 'var(--fill-4)' }} />
      </div>
    );
  }
  if (art === 'plan') {
    return (
      <div className="ppt-create-mini" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <span key={index} style={{ position: 'absolute', left: 14, top: 14 + index * 22, width: `${[70, 55, 62][index]}%`, height: 10, borderRadius: 5, background: `var(--fill-${index === 0 ? '5' : '4'})` }} />
        ))}
        {[0, 1, 2].map((index) => (
          <span key={`check-${String(index)}`} style={{ position: 'absolute', right: 14, top: 12 + index * 22, width: 14, height: 14, borderRadius: '50%', background: 'var(--ok-fill)', color: 'var(--ok)', display: 'grid', placeItems: 'center' }}>
            <Icon name="check" size="sm" />
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className="ppt-create-mini" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <span
          key={index}
          style={{
            position: 'absolute',
            left: `${12 + index * 24}%`,
            top: 18,
            width: '20%',
            aspectRatio: '16/9',
            borderRadius: 4,
            border: `1px solid ${index === 1 ? 'var(--accent)' : 'var(--line-2)'}`,
            background: 'var(--fill-3)',
          }}
        />
      ))}
    </div>
  );
}

/**
 * P05-01：设计 ppt.html 的独立创作页 —— hero + 创作框 + 示例想法 + 三步说明 + 最近的演示。
 * 创建不再折叠在作品库弹窗里（P05-03 的遮罩吞回执根因一并消除）。
 */
export function PptCreatePage({
  projects,
  projectsLoading,
  projectsError,
  receipt,
  busy,
  onVerify,
  onRetryProjects,
  onCreate,
  onOpenWork,
  onOpenWorks,
  recentWorks,
}: PptCreatePageProps) {
  return (
    <div className="ppt-create">
      <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
        <span className="grow" />
        <Button variant="ghost" size="sm" icon="list" onClick={onOpenWorks}>
          全部作品
        </Button>
      </div>
      <div className="ppt-create-hero">
        <span className="eyebrow">PPT 制作</span>
        <h2 style={{ marginTop: 10 }}>把想法，整理成一份演示。</h2>
        <p className="lede" style={{ marginTop: 10 }}>先和助手讨论清楚要讲什么，再逐页制作。全程可以改。</p>
      </div>

      <PptCreateForm
        projects={projects}
        projectsLoading={projectsLoading}
        {...(projectsError === undefined ? {} : { projectsError })}
        receipt={receipt}
        busy={busy}
        onVerify={onVerify}
        onRetryProjects={onRetryProjects}
        onCreate={onCreate}
      />

      <div className="ppt-create-how">
        {HOW.map((item) => (
          <div className="card" key={item.no}>
            <HowArt art={item.art} />
            <div className="ppt-create-n">{item.no}</div>
            <h4>{item.title}</h4>
            <p className="hint" style={{ lineHeight: 1.6 }}>{item.text}</p>
          </div>
        ))}
      </div>

      <div className="row" style={{ marginTop: 44 }}>
        <h3 style={{ fontSize: 15, fontWeight: 500 }} className="grow">最近的演示</h3>
      </div>
      {recentWorks.length === 0 ? (
        <p className="hint" style={{ marginTop: 12 }}>还没有演示；创建第一份后会出现在这里，并可以直接进入工作台。</p>
      ) : (
        <div className="ppt-create-recent">
          {recentWorks.slice(0, 4).map((work) => {
            const progress = derivePptProgress(work);
            return (
              <button type="button" className="ppt-create-wk" key={work.id} onClick={() => onOpenWork(work.id)}>
                <span className="ppt-create-thumb">
                  <img alt="" src={ROUTES.pptWorkThumbnail(work.id)} />
                </span>
                <span className="ellipsis" style={{ fontSize: 13.5 }}>{work.title}</span>
                <span className="hint ellipsis">{progress.stageLabel} · {pptPageSummary(work)} · {formatRelativeTime(work.updatedAt)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
