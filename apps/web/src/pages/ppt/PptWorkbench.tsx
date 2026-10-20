import { PptStudio } from './PptStudio.tsx';
import { Drawer } from '../../components/Drawer.tsx';
import { PptAssistantPanel } from './PptAssistantPanel.tsx';
import { PptPlanDrawer } from './PptPlanDrawer.tsx';
import { PptGenerationControls } from './PptGenerationControls.tsx';
import { PptVersions } from './PptProductionPanels.tsx';
import { useEffect,useState } from 'react';
import { createRequestKey, type PptWork } from '@agent-workflow/shared';
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
  readonly onRefresh?: () => void;
}

const STEP_TITLES: Record<PptStageKey, { readonly title: string; readonly hint: string }> = {
  discuss: { title: '① 讨论需求', hint: '与右侧助手逐项补全五项需求简报；信息足够后生成制作方案。保存会 PATCH 到服务并返回回执。' },
  design: { title: '② 设计方案', hint: '确认后才开始逐页制作 · 之后仍可调整：维护大纲、选择视觉方向，底部确认条提交并开始制作。' },
  check: { title: '③ 制作检查', hint: '逐页查看真实页面、编辑正文和演讲备注；按当前修订检查页面内容与确定性版式边界。' },
  export: { title: '④ 导出', hint: '按当前修订导出 PPTX / PDF / Markdown；导出不会回写作品状态。' },
};

export function PptWorkbench({ work, projectName, busyKind, lastResult, onCommand, onBack, onRefresh }: PptWorkbenchProps) {
  const progress = derivePptProgress(work);
  const [planOpen,setPlanOpen] = useState(false);
  const [sourcesOpen,setSourcesOpen] = useState(false);
  const [versionsOpen,setVersionsOpen] = useState(false);
  const [activeStep, setActiveStep] = useState<PptStageKey>(()=>{try{const saved=sessionStorage.getItem(`ppt.step.${work.id}`);return PPT_STAGES.some(stage=>stage.key===saved)?saved as PptStageKey:progress.current;}catch{return progress.current;}});
  useEffect(()=>{try{sessionStorage.setItem(`ppt.step.${work.id}`,activeStep);}catch{/* The current view remains in memory. */}},[work.id,activeStep]);
  useEffect(()=>{if(work.generation?.pages && work.generation.status==='running')setActiveStep('check');},[work.generation?.requestKey]);
  const status = pptStatusMeta(work.status, work);
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
      <PptPlanDrawer {...{work,blocked,onCommand}} blockedReason={blockedReason} busyKind={busyKind} {...(onRefresh === undefined ? {} : { onRefresh })} open={planOpen} onClose={()=>setPlanOpen(false)} />
      <PptGenerationControls work={work} /><PptGenerationControls work={work} assistant/>
      <section className="card pad ppt-wb-head" aria-label="工作台页头">
        <div className="row wrap" style={{ gap: 10, alignItems: 'flex-start' }}>
          <Button variant="ghost" size="sm" onClick={onBack}>
            PPT 制作
          </Button>
          <span className="hint" aria-hidden="true">/</span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="row wrap" style={{ gap: 8 }}>
              <h2 className="ellipsis" style={{ fontSize: 20, fontWeight: 500 }} title={work.title}>
                {work.title}
              </h2>
              <Badge tone={status.tone} icon={status.icon}>
                {status.label}
              </Badge>
              {work.archived === true ? (
                <Badge tone="idle" icon="archive">已归档</Badge>
              ) : null}
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
                setSourcesOpen(true);
              }}
            >
              资料 {String(work.attachments.length)}
            </Button>
            <Button variant="ghost" size="sm" icon="clock" onClick={()=>setVersionsOpen(true)}>版本</Button>
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

        <Drawer open={versionsOpen} title="版本" size="md" onClose={()=>setVersionsOpen(false)}><p className="hint" style={{ marginTop: 0 }}>每次确认方案或批量修改都会生成一个修订</p><PptVersions expanded {...{work,blocked,onCommand}}/></Drawer>

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
          <span>修订 {work.revision??1} · {progress.stageLabel}</span>
          <span aria-hidden="true">·</span>
          <span>{progress.pageText}</span>
          <span aria-hidden="true">·</span>
          <span>{projectName ?? '未归属项目'}</span>
          <span aria-hidden="true">·</span>
          <span>最近保存于 {formatRelativeTime(work.updatedAt)}</span>
          <span aria-hidden="true">·</span>
          <span>{progress.nextHint}</span>
        </div>

      </section>

      <Drawer open={sourcesOpen} title="资料" size="md" onClose={()=>setSourcesOpen(false)}><p className="hint" style={{ marginTop: 0 }}>助手制作时可以引用的内容</p><PptStepCheck attachmentsOnly {...{work,busyKind,blocked,blockedReason,lastResult,onCommand}} onGoDesign={()=>setActiveStep('design')}/></Drawer>
      <div className="ppt-studio-shell" hidden={activeStep!=='check'}><PptStudio commandBusy={anyBusy} key={work.id} {...{work,blocked,blockedReason,onCommand}}/></div>
      <div className="ppt-work-area" hidden={activeStep==='check'}>
       <section className="card ppt-wb-step" aria-label={stepMeta.title}>
        <div className="card-head"><span className="eyebrow">{stepMeta.title}</span></div><div className="card-body">
         {activeStep==='discuss'?<PptStepDiscussion {...{work,projectName,busyKind,blocked,blockedReason,onCommand}} onNext={()=>setActiveStep('design')} onGeneratePlan={()=>{onCommand({kind:'generate',workId:work.id,body:{expectedRevision:work.revision??1,requestKey:createRequestKey(),confirmGenerate:true}});}}/>:activeStep==='design'?<PptStepDesign {...{work,busyKind,blocked,blockedReason,onCommand}} onBackToDiscuss={()=>setActiveStep('discuss')}/>:<PptStepExport {...{work,busyKind,blocked,blockedReason,lastResult,onCommand}}/>}
        </div>
       </section>
       <PptAssistantPanel key={work.id} work={work} blocked={blocked} mode={activeStep === 'discuss' ? 'discuss' : 'make'}/>
      </div>
    </div>
  );
}
