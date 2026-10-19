import { useMemo, useState } from 'react';
import {
  NODE_STATUS_LABEL,
  PLAN_REVISION_STATUS_LABEL,
  type ActionAvailability,
  type ExecutionView,
  type PlanNode,
  type PlanRevision,
  type TaskDetailResponse,
} from '@agent-workflow/shared';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { confirmPlan, beginPlanEdit, finishPlanEdit, savePlanEdit, useWorkflowCommand } from '../../api/workflow.ts';
import { ActionReasonLine, CommandErrorNotice, ReceiptNotice, ServiceActionButton } from '../../flow/workflow-ui.tsx';
import { PanelEmpty, Section } from '../requirement/requirement-ui.tsx';

interface LocalChange {
  readonly title?: string;
  readonly acceptance?: readonly string[];
}

export interface PlanEditPanelProps {
  readonly taskId: string;
  readonly detail: TaskDetailResponse;
  readonly execution?: ExecutionView;
  readonly plan?: PlanRevision;
  readonly actions: Record<string, ActionAvailability>;
  readonly onRefresh: () => Promise<void>;
  readonly onOpenNode: (nodeId: string) => void;
}

/**
 * 执行中调整待执行计划：先暂停新增领取 → 只改未领取步骤 → 保存 → 重新确认 → 继续。
 * 领取竞态时保留本地草稿并显示服务真实错误。
 */
export function PlanEditPanel({ taskId, execution, plan, actions, onRefresh, onOpenNode }: PlanEditPanelProps) {
  const command = useWorkflowCommand(taskId);
  const editSession = execution?.editSession;
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);
  const [localChanges, setLocalChanges] = useState<Record<string, LocalChange>>({});
  const [confirming, setConfirming] = useState(false);

  const locked = useMemo(() => new Set(editSession?.lockedNodeIds ?? []), [editSession?.lockedNodeIds]);
  const nodes = plan?.graph.nodes ?? [];
  const editableNodes = nodes.filter((node) => !locked.has(node.id));
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? editableNodes[0];
  const executionState = execution?.nodes ?? [];
  const lockedNodes = nodes.filter((node) => locked.has(node.id));
  const adjustAction = actions.adjustExecutionPlan;

  const changeFor = (node: PlanNode): LocalChange => {
    const local = localChanges[node.id] ?? {};
    return {
      title: local.title ?? node.title,
      acceptance: local.acceptance ?? node.acceptance,
    };
  };

  const updateLocal = (node: PlanNode, patch: LocalChange) => {
    setLocalChanges((previous) => ({ ...previous, [node.id]: { ...changeFor(node), ...patch } }));
  };

  const dirtyChanges = Object.entries(localChanges).filter(([nodeId, change]) => {
    const node = nodes.find((item) => item.id === nodeId);
    if (node === undefined) return false;
    if (change.title !== undefined && change.title !== node.title) return true;
    if (change.acceptance !== undefined && change.acceptance.join('\n') !== node.acceptance.join('\n')) return true;
    return false;
  });

  const begin = () => {
    if (plan === undefined) return;
    void command.run(() => beginPlanEdit(taskId, plan.id));
  };

  const save = () => {
    if (editSession === undefined || plan === undefined) return;
    const changes = dirtyChanges.map(([nodeId, change]) => {
      const node = nodes.find((item) => item.id === nodeId);
      return {
        nodeId,
        ...(node === undefined || change.title === undefined || change.title === node.title ? {} : { title: change.title }),
        ...(node === undefined || change.acceptance === undefined ? {} : { acceptance: change.acceptance }),
      };
    });
    if (changes.length === 0) return;
    void command
      .run(() =>
        savePlanEdit(taskId, {
          editSessionId: editSession.id,
          changes,
          expectedPlanRevisionNumber: plan.revisionNumber,
        }),
      )
      .then((response) => {
        if (response?.receipt.status === 'succeeded') {
          setLocalChanges({});
          setSelectedNodeId(undefined);
          void onRefresh();
        }
      });
  };

  const reconfirm = () => {
    if (plan === undefined) return;
    setConfirming(true);
    void command
      .run(() => confirmPlan(taskId, plan.id, plan.revisionNumber))
      .then((response) => {
        setConfirming(false);
        if (response?.receipt.status === 'succeeded') void onRefresh();
      });
  };

  const finish = (continueExecution: boolean) => {
    if (editSession === undefined) return;
    void command
      .run(() => finishPlanEdit(taskId, { editSessionId: editSession.id, continueExecution }))
      .then((response) => {
        if (response?.receipt.status === 'succeeded') void onRefresh();
      });
  };

  if (editSession === undefined) {
    return (
      <div>
        <Section title="调整待执行计划" aside={<Badge tone={adjustAction?.allowed === true ? 'ok' : 'idle'}>{adjustAction?.allowed === true ? '可用' : '不可用'}</Badge>}>
          <div className="banner info">
            <Icon name="pause" />
            <div className="grow">
              <b>开始调整前，执行会先暂停新增领取。</b>
              <br />
              运行中的步骤按原快照继续，不会被强停；回执成功后才开放编辑。完成修改后需要重新确认计划，才能继续执行。
            </div>
          </div>
          <div className="plan-edit-actions">
            <ServiceActionButton size="sm" variant="primary" icon="edit" action={adjustAction} busy={command.state.busy} fallbackReason="当前执行状态不能调整计划" onRun={begin}>
              调整待执行计划
            </ServiceActionButton>
            <ActionReasonLine action={adjustAction} />
          </div>
          <CommandErrorNotice error={command.state.error} />
          <ReceiptNotice receipt={command.state.receipt} />
        </Section>
        <Section title="当前执行快照" aside={<span className="hint">只读</span>}>
          <EditSnapshot execution={execution} plan={plan} onOpenNode={onOpenNode} />
        </Section>
      </div>
    );
  }

  return (
    <div>
      {editSession.state === 'conflict' ? (
        <div className="banner warn">
          <Icon name="alert" />
          <div className="grow">
            <b>保存遇到领取竞态：</b>有步骤在暂停生效前已被领取。本地修改已保留；重新读取并比对后，涉及已领取步骤的修改会被移出。
          </div>
          <div className="actions">
            <Button
              size="sm"
              variant="secondary"
              icon="refresh"
              onClick={() => {
                void onRefresh().then(() => {
                  setLocalChanges((previous) => {
                    const next: Record<string, LocalChange> = {};
                    for (const [nodeId, change] of Object.entries(previous)) {
                      if (!locked.has(nodeId)) next[nodeId] = change;
                    }
                    return next;
                  });
                });
              }}
            >
              重新读取并比对
            </Button>
          </div>
        </div>
      ) : null}

      {editSession.state === 'saved' ? (
        <div className="banner ok">
          <Icon name="check" />
          <div className="grow">
            <b>修改已保存为计划修订 {plan?.revisionNumber ?? '—'}（未确认）。</b>
            <br />
            计划已变更，后续步骤等待重新确认；确认后才出现“继续执行”，继续时恢复调整前的自动推进设置。
          </div>
        </div>
      ) : null}

      <Section
        title="编辑待执行区"
        aside={<Badge tone={execution?.status === 'paused' ? 'idle' : execution?.status === 'waiting_confirmation' ? 'wait' : 'run'}>{execution?.status === 'waiting_confirmation' ? '等待重新确认' : execution?.status === 'paused' ? '已暂停' : '执行中'}</Badge>}
      >
        <div className="edit-layout">
          <div className="edit-nodes">
            <div className="sec-t">可修改（未领取）</div>
            <div className="box">
              {editableNodes.length === 0 ? (
                <p className="hint" style={{ padding: 10 }}>
                  没有可修改的待执行步骤。
                </p>
              ) : (
                editableNodes.map((node) => {
                  const state = executionState.find((item) => item.nodeId === node.id);
                  const active = selectedNode?.id === node.id;
                  const local = localChanges[node.id];
                  return (
                    <button
                      key={node.id}
                      type="button"
                      className={`rowx edit-node${active ? ' active' : ''}`}
                      aria-pressed={active}
                      onClick={() => {
                        setSelectedNodeId(node.id);
                      }}
                    >
                      <span className="ic wait">
                        <Icon name="edit" size="sm" />
                      </span>
                      <span className="grow">
                        <span className="t">{local?.title ?? node.title}</span>
                        <span className="s">
                          {state === undefined ? '待执行 · 可修改' : `${NODE_STATUS_LABEL[state.status]} · 可修改`}
                          {local === undefined ? '' : ' · 有本地修改'}
                        </span>
                      </span>
                      <Badge tone="wait">可修改</Badge>
                    </button>
                  );
                })
              )}
            </div>

            <div className="sec-t" style={{ marginTop: 14 }}>
              锁定的步骤（{lockedNodes.length}）
            </div>
            <div className="box">
              {lockedNodes.length === 0 ? (
                <p className="hint" style={{ padding: 10 }}>
                  当前没有锁定步骤。
                </p>
              ) : (
                lockedNodes.map((node) => {
                  const state = executionState.find((item) => item.nodeId === node.id);
                  return (
                    <button key={node.id} type="button" className="rowx edit-node locked" onClick={() => onOpenNode(node.id)}>
                      <span className="ic idle">
                        <Icon name="lock" size="sm" />
                      </span>
                      <span className="grow">
                        <span className="t">{node.title}</span>
                        <span className="s">{state === undefined ? '已锁定' : `${NODE_STATUS_LABEL[state.status]} · 已领取 / 运行中 / 已完成，连同入边锁定`}</span>
                      </span>
                      <Icon name="chevRight" size="sm" />
                    </button>
                  );
                })
              )}
            </div>
            {lockedNodes.length > 0 ? <p className="hint" style={{ marginTop: 6 }}>锁定步骤与入边不可编辑；没有编辑入口。</p> : null}
          </div>

          <div className="edit-form">
            {selectedNode === undefined ? (
              <PanelEmpty compact icon="edit" title="选择要修改的步骤" description="只有未领取的待执行步骤可以修改名称与验收。" />
            ) : (
              <>
                <div className="sec-t">编辑：{selectedNode.title}</div>
                <label className="label" htmlFor="edit-title">
                  名称
                </label>
                <input
                  id="edit-title"
                  className="input"
                  value={changeFor(selectedNode).title ?? ''}
                  onChange={(event) => {
                    updateLocal(selectedNode, { title: event.target.value });
                  }}
                />
                <label className="label" htmlFor="edit-acceptance" style={{ marginTop: 12 }}>
                  验收条款（每行一条）
                </label>
                <textarea
                  id="edit-acceptance"
                  className="textarea"
                  value={(changeFor(selectedNode).acceptance ?? []).join('\n')}
                  onChange={(event) => {
                    updateLocal(selectedNode, {
                      acceptance: event.target.value
                        .split('\n')
                        .map((line) => line.trim())
                        .filter((line) => line.length > 0),
                    });
                  }}
                />
                <div className="sec-t" style={{ marginTop: 12 }}>
                  前置步骤（表单式依赖，替代拖拽连线）
                </div>
                <div className="chip-line">
                  {plan?.graph.edges
                    .filter((edge) => edge.to === selectedNode.id)
                    .map((edge) => {
                      const from = nodes.find((node) => node.id === edge.from);
                      return (
                        <span key={edge.id} className="chip">
                          <Icon name="lock" size="sm" />
                          {from?.title ?? edge.from} · {edge.kind}
                        </span>
                      );
                    })}
                  {plan?.graph.edges.some((edge) => edge.to === selectedNode.id) === true ? null : <span className="hint">无前置步骤</span>}
                </div>
                <p className="hint" style={{ marginTop: 6 }}>
                  依赖调整未接通：当前服务保存只应用名称与验收，不改动前置步骤；这里只读显示。保存后仍需重新确认计划。
                </p>
                <div className="plan-edit-actions">
                  <Button variant="primary" size="sm" icon="check" disabled={command.state.busy || dirtyChanges.length === 0} disabledReason={dirtyChanges.length === 0 ? '没有修改可保存' : undefined} onClick={save}>
                    {command.state.busy ? '正在保存…' : `保存修改（${dirtyChanges.length}）`}
                  </Button>
                  <span className="hint">保存会生成新的未确认计划修订，状态等待重新确认。</span>
                </div>
              </>
            )}
          </div>
        </div>
        <CommandErrorNotice error={command.state.error} title="保存未完成" />
        <ReceiptNotice receipt={command.state.receipt} />
      </Section>

      {editSession.state === 'saved' ? (
        <Section title="重新确认与继续" aside={<span className="hint">两个动作分开</span>}>
          {plan === undefined ? (
            <p className="hint">计划读取中。</p>
          ) : plan.status === 'unconfirmed' ? (
            <>
              <p className="hint" style={{ marginBottom: 10 }}>
                计划修订 {plan.revisionNumber} 未确认。重新确认会对整图重新检查（旧候选覆盖与检查报告作为历史，不沿用旧绿勾）。
              </p>
              <Button variant="primary" size="sm" icon="check" disabled={command.state.busy || confirming} onClick={reconfirm}>
                {confirming ? '正在确认…' : '重新确认计划'}
              </Button>
              <div style={{ marginTop: 6 }}>
                <ActionReasonLine action={actions.confirmPlan} block />
              </div>
            </>
          ) : (
            <>
              <p className="hint" style={{ marginBottom: 10 }}>
                计划修订 {plan.revisionNumber} 已确认（{PLAN_REVISION_STATUS_LABEL[plan.status]}）。继续执行会恢复进入调整前的自动推进设置：{editSession.autoAdvanceBeforeEdit ? '开启' : '关闭'}。
              </p>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <Button variant="primary" size="sm" icon="play" disabled={command.state.busy} onClick={() => finish(true)}>
                  继续执行
                </Button>
                <Button variant="secondary" size="sm" icon="pause" disabled={command.state.busy} onClick={() => finish(false)}>
                  保持暂停
                </Button>
                <ActionReasonLine action={actions.continueExecution} />
              </div>
            </>
          )}
        </Section>
      ) : null}

      {editSession.state === 'conflict' ? (
        <div className="banner unknown">
          <Icon name="help" />
          <div className="grow">领取竞态尚未处理完：重新读取并比对后才能保存剩余修改。本地草稿保留。</div>
        </div>
      ) : null}
    </div>
  );
}

function EditSnapshot({ execution, plan, onOpenNode }: { readonly execution?: ExecutionView; readonly plan?: PlanRevision; readonly onOpenNode: (nodeId: string) => void }) {
  const nodes = plan?.graph.nodes ?? [];
  return (
    <div className="box">
      {nodes.map((node) => {
        const state = execution?.nodes.find((item) => item.nodeId === node.id);
        return (
          <button key={node.id} type="button" className="rowx edit-node" onClick={() => onOpenNode(node.id)}>
            <span className={`ic ${state?.status === 'succeeded' ? 'ok' : state?.status === 'failed' ? 'no' : state?.status === 'running' ? 'run' : 'idle'}`}>
              <Icon name={state?.status === 'succeeded' ? 'check' : state?.status === 'failed' ? 'x' : state?.status === 'running' ? 'play' : 'clock'} size="sm" />
            </span>
            <span className="grow">
              <span className="t">{node.title}</span>
              <span className="s">{state === undefined ? '未执行' : `${NODE_STATUS_LABEL[state.status]} · 尝试 ${String(state.attemptCount)} 次`}</span>
            </span>
            {lockedHint(state?.status)}
          </button>
        );
      })}
    </div>
  );
}

function lockedHint(status: string | undefined) {
  if (status === undefined || status === 'pending' || status === 'ready') return <Badge tone="idle">待执行</Badge>;
  return <Badge tone="idle" icon="lock">锁定</Badge>;
}
