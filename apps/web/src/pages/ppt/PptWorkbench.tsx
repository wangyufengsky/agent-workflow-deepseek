import { PptPlanDrawer } from './PptPlanDrawer.tsx';
import { PptGenerationControls } from './PptGenerationControls.tsx';
import { PptVersions } from './PptProductionPanels.tsx';
import { useState } from 'react';
import type { PptWork } from '@agent-workflow/shared';
import { formatRelativeTime } from '../../app/format.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import {
  PPT_STAGES,
  derivePptProgress,
  pptStatusMeta,
  pptStepState,
  type PptCommand,
  type PptCommandKind,
  type PptCommandSignal,
  type PptStageKey,
} from './ppt-shared.tsx';
import { PptStepCheck, PptStepDesign, PptStepDiscussion } from './PptWorkbenchSteps.tsx';
import { PptStepExport } from './PptStepExport.tsx';

export interface PptWorkbenchProps {
  readonly work: PptWork;
  readonly projectName?: string;
  readonly busyKind: PptCommandKind | null;
  readonly lastResult: PptCommandSignal | null;
  readonly onCommand: (command: PptCommand) => void;
  readonly onBack: () => void;
}

const STEP_TITLES: Record<PptStageKey, { readonly title: string; readonly hint: string }> = {
  discuss: { title: '① 讨论需求', hint: '补全五项需求简报、标题、主题与大纲；保存会 PATCH 到服务并返回回执。' },
  design: { title: '② 设计方案', hint: '选择三个视觉方向和版式主题，生成或查看大纲与逐页内容；模型调用可能较慢。' },
  check: { title: '③ 制作检查', hint: '逐页查看真实页面、编辑正文和演讲备注；按当前修订检查页面内容与确定性版式边界。' },
  export: { title: '④ 导出', hint: '按当前内容导出 PPTX / Markdown；导出不会回写作品状态。' },
};

export function PptWorkbench({ work, projectName, busyKind, lastResult, onCommand, onBack }: PptWorkbenchProps) {
  const progress = derivePptProgress(work);
  const [planOpen,setPlanOpen] = useState(false);
  const [activeStep, setActiveStep] = useState<PptStageKey>(progress.current);
  const status = pptStatusMeta(work.status);
  const generating = work.status === 'generating';
  const anyBusy = busyKind !== null;
  const blocked = anyBusy || generating || work.archived === true || work.mutationBlock !== undefined;
  const blockedReason = work.mutationBlock?.reason ?? (work.archived ? '作品已归档；请先在作品库恢复。' : anyBusy
    ? '另一条 PPT 命令正在等待服务回执；为避免重复提交，先等它结束。'
    : generating
      ? '服务把这份作品标记为「生成中」；等模型调用结束后再操作。'
      : undefined);
  const stepMeta = STEP_TITLES[activeStep];

  return (
    <div className="ppt-workbench">
      <PptPlanDrawer {...{work,blocked,onCommand}} open={planOpen} onClose={()=>setPlanOpen(false)} />
      <PptGenerationControls work={work} />
      <section className="card pad ppt-wb-head" aria-label="工作台页头">
        <div className="row wrap" style={{ gap: 10, alignItems: 'flex-start' }}>
          <Button variant="ghost" size="sm" icon="arrowLeft" onClick={onBack}>
            作品库
          </Button>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="row wrap" style={{ gap: 8 }}>
              <h2 className="ellipsis" style={{ fontSize: 20, fontWeight: 500 }} title={work.title}>
                {work.title}
              </h2>
              <Badge tone={status.tone} icon={status.icon}>
                {status.label}
              </Badge>
            </div>
            <div className="hint ellipsis" title={work.topic}>
              {work.topic}
            </div>
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            <Button
              variant="ghost"
              size="sm"
              icon="book"
              onClick={() => {
                setActiveStep('check');
              }}
            >
              资料 {String(work.attachments.length)}
            </Button>
            <Button variant="secondary" size="sm" icon="layers" onClick={() => setPlanOpen(true)}>制作方案</Button>
            <Button
              variant="primary"
              size="sm"
              icon="download"
              onClick={() => {
                setActiveStep('export');
              }}
            >
              导出
            </Button>
          </div>
        </div>

        <PptVersions {...{ work, blocked, onCommand }} />

        <div className="ppt-stepper" role="tablist" aria-label="制作步骤">
          {PPT_STAGES.map((stage, index) => {
            const state = pptStepState(stage.key, progress);
            const selected = activeStep === stage.key;
            return (
              <button
                key={stage.key}
                type="button"
                role="tab"
                aria-selected={selected}
                data-state={state}
                onClick={() => {
                  setActiveStep(stage.key);
                }}
              >
                <span className="ppt-step-mark" aria-hidden="true">
                  {state === 'done' ? <Icon name="check" size="sm" /> : String(index + 1)}
                </span>
                <span className="ppt-step-label">{stage.label}</span>
              </button>
            );
          })}
        </div>

        <div className="row wrap ppt-meta" style={{ marginTop: 10 }}>
          <span>当前阶段：{progress.stageLabel}</span>
          <span aria-hidden="true">·</span>
          <span>{progress.pageText}</span>
          <span aria-hidden="true">·</span>
          <span>{projectName ?? '未归属项目'}</span>
          <span aria-hidden="true">·</span>
          <span>最近保存于 {formatRelativeTime(work.updatedAt)}</span>
          <span aria-hidden="true">·</span>
          <span>{progress.nextHint}</span>
        </div>
        <p className="hint" style={{ marginTop: 6 }}>
          四步进度只由服务真实数据推导（大纲 / 逐页）；「导出」不会被标成已完成（服务不记录导出），制作检查按当前修订读取逐页内容与版式边界，不代替人工判断。
          生成与保存的回执显示在页面顶部；unknown 回执可用请求号核对，不会自动重发。
        </p>
      </section>

      <section className="card ppt-wb-step" aria-label={stepMeta.title} style={{ marginTop: 16 }}>
        <div className="card-head">
          <span className="eyebrow">{stepMeta.title}</span>
          <span className="hint grow">{stepMeta.hint}</span>
        </div>
        <div className="card-body">
          {activeStep === 'discuss' ? (
            <PptStepDiscussion
              work={work}
              projectName={projectName}
              busyKind={busyKind}
              blocked={blocked}
              blockedReason={blockedReason}
              onCommand={onCommand}
              onNext={() => {
                setActiveStep('design');
              }}
            />
          ) : activeStep === 'design' ? (
            <PptStepDesign work={work} busyKind={busyKind} blocked={blocked} blockedReason={blockedReason} onCommand={onCommand} />
          ) : activeStep === 'check' ? (
            <PptStepCheck
              work={work}
              busyKind={busyKind}
              blocked={blocked}
              blockedReason={blockedReason}
              lastResult={lastResult}
              onCommand={onCommand}
              onGoDesign={() => {
                setActiveStep('design');
              }}
            />
          ) : (
            <PptStepExport
              work={work}
              busyKind={busyKind}
              blocked={blocked}
              blockedReason={blockedReason}
              lastResult={lastResult}
              onCommand={onCommand}
            />
          )}
        </div>
      </section>
    </div>
  );
}
