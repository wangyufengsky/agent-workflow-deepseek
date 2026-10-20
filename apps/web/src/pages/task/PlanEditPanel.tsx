import { QualityReviewFields } from '../../flow/QualityReviewFields.tsx';
import { useMemo, useState } from 'react';
import {
  NODE_STATUS_LABEL,
  PLAN_REVISION_STATUS_LABEL,
  type ActionAvailability,
  type EditAddedNode,
  type ExecutionView,
  type NodeKindValue,
  type OperationReceipt,
  type PlanNode,
  type PlanRevision,
  type TaskDetailResponse,
} from '@agent-workflow/shared';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Modal } from '../../components/Modal.tsx';
import { abandonPlanEdit, confirmPlan, beginPlanEdit, finishPlanEdit, savePlanEdit, useWorkflowCommand } from '../../api/workflow.ts';
import { ActionReasonLine, CommandErrorNotice, ReceiptNotice, ServiceActionButton } from '../../flow/workflow-ui.tsx';
import { PanelEmpty, Section } from '../requirement/requirement-ui.tsx';

interface LocalChange {
  readonly qualityReview?: PlanNode['qualityReview'] | null;
  readonly title?: string;
  readonly acceptance?: readonly string[];
  readonly prerequisites?: readonly string[];
}

/** P13-06: a step drafted locally; only sent to the service with the save command. */
type AddedNodeDraft = EditAddedNode;

const ADD_KIND_OPTIONS: readonly { readonly value: NodeKindValue; readonly label: string }[] = [
  { value: 'implementation', label: '实现步骤' },
  { value: 'design', label: '设计步骤' },
  { value: 'test', label: '测试步骤' },
  { value: 'verify', label: '验收步骤' },
  { value: 'delivery', label: '交付步骤' },
];

export interface PlanEditPanelProps {
  readonly taskId: string;
  readonly detail: TaskDetailResponse;
  readonly execution?: ExecutionView;
  readonly plan?: PlanRevision;
  readonly actions: Record<string, ActionAvailability>;
  readonly onRefresh: () => Promise<void>;
  readonly onOpenNode: (nodeId: string) => void;
  /** Called after a successful abandon so the canvas can leave the edit side panel and show the receipt. */
  readonly onAbandoned?: (receipt: OperationReceipt) => void;
}

/**
 * 执行中调整待执行计划：先暂停新增领取 → 只改未领取步骤 → 保存 → 重新确认 → 继续。
 * 领取竞态时保留本地草稿并显示服务真实错误。
 */
export function PlanEditPanel({ taskId, execution, plan, actions, onRefresh, onOpenNode, onAbandoned }: PlanEditPanelProps) {
  const command = useWorkflowCommand(taskId);
  const rawSession = execution?.editSession;
  const editSession = rawSession !== undefined && (rawSession.state === 'editing' || rawSession.state === 'conflict' || rawSession.state === 'saved') ? rawSession : undefined;
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);
  const [localChanges, setLocalChanges] = useState<Record<string, LocalChange>>({});
  // P13-06: pending-plan node add / remove drafts (sent with the same save command).
  const [addedNodes, setAddedNodes] = useState<readonly AddedNodeDraft[]>([]);
  const [removedNodeIds, setRemovedNodeIds] = useState<readonly string[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addTitle, setAddTitle] = useState('');
  const [addKind, setAddKind] = useState<NodeKindValue>('implementation');
  const [addAfterId, setAddAfterId] = useState<string | undefined>(undefined);
  const [removeTarget, setRemoveTarget] = useState<PlanNode | undefined>(undefined);
  const [beginConfirmOpen, setBeginConfirmOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [abandonOpen, setAbandonOpen] = useState(false);
  const [receiptSuccess, setReceiptSuccess] = useState<string | undefined>(undefined);

  const locked = useMemo(() => new Set(editSession?.lockedNodeIds ?? []), [editSession?.lockedNodeIds]);
  const nodes = plan?.graph.nodes ?? [];
  const editableNodes = nodes.filter((node) => !locked.has(node.id));
  const removedSet = useMemo(() => new Set(removedNodeIds), [removedNodeIds]);
  const editableExisting = editableNodes.filter((node) => !removedSet.has(node.id));
  const selectedNode = editableExisting.find((node) => node.id === selectedNodeId) ?? editableExisting[0];
  const executionState = execution?.nodes ?? [];
  const lockedNodes = nodes.filter((node) => locked.has(node.id));
  const addedIds = addedNodes.map((node) => node.nodeId);
  const selectablePrerequisites = [...editableExisting.map((node) => ({ id: node.id, title: node.title })), ...addedNodes.map((node) => ({ id: node.nodeId, title: `${node.title}（新增）` }))];
  const adjustAction = actions.adjustExecutionPlan;

  const currentPrerequisites = (node: PlanNode): readonly string[] =>
    (plan?.graph.edges ?? []).filter((edge) => edge.to === node.id).map((edge) => edge.from);
  const changeFor = (node: PlanNode): LocalChange => {
    const local = localChanges[node.id] ?? {};
    return {
      qualityReview: local.qualityReview === undefined ? node.qualityReview : local.qualityReview,
      title: local.title ?? node.title,
      acceptance: local.acceptance ?? node.acceptance,
      prerequisites: local.prerequisites ?? currentPrerequisites(node),
    };
  };

  const updateLocal = (node: PlanNode, patch: LocalChange) => {
    setLocalChanges((previous) => ({ ...previous, [node.id]: { ...changeFor(node), ...patch } }));
  };

  const dirtyChanges = Object.entries(localChanges).filter(([nodeId, change]) => {
    const node = nodes.find((item) => item.id === nodeId);
    if (node === undefined) return false;
    if (change.qualityReview !== undefined && JSON.stringify(change.qualityReview ?? undefined) !== JSON.stringify(node.qualityReview)) return true;
    if (change.title !== undefined && change.title !== node.title) return true;
    if (change.acceptance !== undefined && change.acceptance.join('\n') !== node.acceptance.join('\n')) return true;
    if (change.prerequisites !== undefined) {
      const current = currentPrerequisites(node).slice().sort().join('|');
      const next = change.prerequisites.slice().sort().join('|');
      if (current !== next) return true;
    }
    return false;
  });

  const begin = () => {
    if (plan === undefined) return;
    setBeginConfirmOpen(false);
    setReceiptSuccess('调整已开始：执行已暂停新增领取，运行中的步骤按原快照继续。');
    void command.run(() => beginPlanEdit(taskId, plan.id));
  };

  const hasLocalEdits = dirtyChanges.length > 0 || addedNodes.length > 0 || removedNodeIds.length > 0;
  const removeAdded = (nodeId: string) => {
    setAddedNodes((previous) => previous.filter((node) => node.nodeId !== nodeId));
    setAddAfterId((previous) => (previous === nodeId ? undefined : previous));
  };
  const undoRemoved = (nodeId: string) => {
    setRemovedNodeIds((previous) => previous.filter((id) => id !== nodeId));
  };
  const confirmRemove = () => {
    if (removeTarget === undefined) return;
    const target = removeTarget;
    setRemovedNodeIds((previous) => (previous.includes(target.id) ? previous : [...previous, target.id]));
    setLocalChanges((previous) => {
      const next = { ...previous };
      delete next[target.id];
      return next;
    });
    setSelectedNodeId(undefined);
    setRemoveTarget(undefined);
  };
  const addNode = () => {
    const title = addTitle.trim();
    if (title.length === 0) return;
    const nodeId = `edit_${Date.now().toString(36)}_${String(addedNodes.length + 1)}`;
    setAddedNodes((previous) => [
      ...previous,
      {
        nodeId,
        title,
        kind: addKind,
        prerequisites: addAfterId === undefined ? [] : [addAfterId],
        ...(addAfterId === undefined ? {} : { summary: `在「${selectablePrerequisites.find((item) => item.id === addAfterId)?.title ?? addAfterId}」之后新增：${title}` }),
      },
    ]);
    setAddTitle('');
    setAddOpen(false);
    setSelectedNodeId(undefined);
  };

  const save = () => {
    if (editSession === undefined || plan === undefined) return;
    const changes = dirtyChanges.map(([nodeId, change]) => {
      const node = nodes.find((item) => item.id === nodeId);
      return {
        nodeId,
        ...(change.qualityReview === undefined ? {} : { qualityReview: change.qualityReview }),
        ...(node === undefined || change.title === undefined || change.title === node.title ? {} : { title: change.title }),
        ...(node === undefined || change.acceptance === undefined ? {} : { acceptance: change.acceptance }),
        ...(node === undefined || change.prerequisites === undefined ? {} : { prerequisites: change.prerequisites }),
      };
    });
    if (!hasLocalEdits) return;
    setReceiptSuccess('修改已保存为未确认的计划修订；重新确认后才能继续执行。');
    void command
      .run(() =>
        savePlanEdit(taskId, {
          editSessionId: editSession.id,
          changes,
          ...(addedNodes.length === 0 ? {} : { addedNodes: addedNodes.map((node) => ({ ...node, prerequisites: [...node.prerequisites] })) }),
          ...(removedNodeIds.length === 0 ? {} : { removedNodeIds: [...removedNodeIds] }),
          expectedPlanRevisionNumber: plan.revisionNumber,
        }),
      )
      .then((response) => {
        if (response?.receipt.status === 'succeeded') {
          setLocalChanges({});
          setAddedNodes([]);
          setRemovedNodeIds([]);
          setSelectedNodeId(undefined);
          void onRefresh();
        }
      });
  };

  const reconfirm = () => {
    if (plan === undefined) return;
    setConfirming(true);
    setReceiptSuccess('计划已重新确认；确认后才会出现继续执行。');
    void command
      .run(() => confirmPlan(taskId, plan.id, plan.revisionNumber))
      .then((response) => {
        setConfirming(false);
        if (response?.receipt.status === 'succeeded') void onRefresh();
      });
  };

  const finish = (continueExecution: boolean) => {
    if (editSession === undefined) return;
    setReceiptSuccess(editSession.wasPausedBeforeEdit === true ? '调整已结束；任务保持调整前的暂停状态，恢复任务需单独操作。' : '调整已结束；服务按调整前的自动推进与暂停设置恢复。');
    void command
      .run(() => finishPlanEdit(taskId, { editSessionId: editSession.id, continueExecution }))
      .then((response) => {
        if (response?.receipt.status === 'succeeded') void onRefresh();
      });
  };

  const abandon = () => {
    if (editSession === undefined) return;
    setReceiptSuccess('已放弃本次调整：计划修订未变更、本地草稿丢弃，服务已恢复进入调整前的自动推进与暂停设置。');
    void command.run(() => abandonPlanEdit(taskId, editSession.id)).then((response) => {
      setAbandonOpen(false);
      if (response?.receipt.status === 'succeeded') {
        setLocalChanges({});
        setSelectedNodeId(undefined);
        const receipt = response.receipt;
        void onRefresh().then(() => {
          onAbandoned?.(receipt);
        });
      }
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
            <ServiceActionButton size="sm" variant="primary" icon="edit" action={adjustAction} busy={command.state.busy} fallbackReason="当前执行状态不能调整计划" onRun={() => { setBeginConfirmOpen(true); }}>
              调整待执行计划
            </ServiceActionButton>
            <ActionReasonLine action={adjustAction} />
          </div>
          <CommandErrorNotice error={command.state.error} />
          <ReceiptNotice receipt={command.state.receipt} successMessage={receiptSuccess} />
          <Modal
            open={beginConfirmOpen}
            title="开始调整待执行计划？"
            onClose={() => { if (!command.state.busy) setBeginConfirmOpen(false); }}
            footer={
              <>
                <Button variant="ghost" size="sm" onClick={() => { setBeginConfirmOpen(false); }} disabled={command.state.busy}>
                  取消
                </Button>
                <Button variant="primary" size="sm" icon="pause" disabled={command.state.busy} disabledReason={command.state.busy ? '正在提交操作，等待服务回执…' : undefined} onClick={begin}>
                  {command.state.busy ? '正在暂停新增领取…' : '暂停新增领取并调整'}
                </Button>
              </>
            }
          >
            <p>
              调整会先暂停新增领取；运行中的步骤按原快照继续，不会被强停。回执成功前不开放编辑，失败会显示服务原因。
            </p>
            <p className="hint">
              调整前模式（服务记录）：自动推进 {execution?.autoAdvance === true ? '开启' : '关闭'}；{execution?.status === 'paused' ? '任务当前已暂停，结束调整后会保持暂停。' : '结束调整后恢复该自动推进设置。'}
            </p>
          </Modal>
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

      <div className="row wrap" style={{ gap: 8, margin: '12px 0' }}>
        <span className="hint grow">
          {editSession.state === 'saved'
            ? '修改已保存为未确认计划修订：需重新确认或继续执行，不能再放弃这次调整。'
            : `调整前模式（服务记录）：自动推进 ${editSession.autoAdvanceBeforeEdit ? '开启' : '关闭'}；放弃调整会丢弃本地草稿并恢复该设置与调整前的暂停状态。`}
        </span>
        <Button
          variant="danger"
          size="sm"
          icon="x"
          disabled={command.state.busy || editSession.state === 'saved'}
          disabledReason={
            editSession.state === 'saved'
              ? '修改已保存为未确认计划修订；需重新确认或继续，不能放弃调整。'
              : '正在提交操作，等待服务回执…'
          }
          onClick={() => {
            setAbandonOpen(true);
          }}
        >
          放弃调整
        </Button>
      </div>

      <Section
        title="编辑待执行区"
        aside={<Badge tone={execution?.status === 'paused' ? 'idle' : execution?.status === 'waiting_confirmation' ? 'wait' : 'run'}>{execution?.status === 'waiting_confirmation' ? '等待重新确认' : execution?.status === 'paused' ? '已暂停' : '执行中'}</Badge>}
      >
        <div className="edit-layout">
          <div className="edit-nodes">
            <div className="sec-t">可修改（未领取）</div>
            <div className="box">
              {editableExisting.length === 0 ? (
                <p className="hint" style={{ padding: 10 }}>
                  没有可修改的待执行步骤。
                </p>
              ) : (
                editableExisting.map((node) => {
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
              新增的步骤（{addedNodes.length}）
            </div>
            <div className="box">
              {addedNodes.length === 0 ? (
                <p className="hint" style={{ padding: 10 }}>
                  还没有新增步骤。可在下方“新增待执行步骤”中添加。
                </p>
              ) : (
                addedNodes.map((node) => (
                  <div key={node.nodeId} className="rowx edit-node">
                    <span className="ic wait">
                      <Icon name="plus" size="sm" />
                    </span>
                    <span className="grow">
                      <span className="t">{node.title}</span>
                      <span className="s">
                        新增 · {ADD_KIND_OPTIONS.find((option) => option.value === node.kind)?.label ?? node.kind} · 前置{' '}
                        {node.prerequisites.length === 0 ? '无（起始步骤）' : node.prerequisites.map((id) => selectablePrerequisites.find((item) => item.id === id)?.title ?? id).join('、')}
                      </span>
                    </span>
                    <Button size="sm" variant="ghost" icon="undo" onClick={() => { removeAdded(node.nodeId); }}>
                      撤销新增
                    </Button>
                  </div>
                ))
              )}
            </div>

            <div className="sec-t" style={{ marginTop: 14 }}>
              待移出计划（{removedNodeIds.length}）
            </div>
            <div className="box">
              {removedNodeIds.length === 0 ? (
                <p className="hint" style={{ padding: 10 }}>
                  没有要移出的步骤。可在编辑一个待执行步骤时选择“从计划移除…”。
                </p>
              ) : (
                removedNodeIds.map((nodeId) => (
                  <div key={nodeId} className="rowx edit-node">
                    <span className="ic no">
                      <Icon name="trash" size="sm" />
                    </span>
                    <span className="grow">
                      <span className="t">{nodes.find((node) => node.id === nodeId)?.title ?? nodeId}</span>
                      <span className="s">移出后不会执行，也不计入完成条件；记录保留在审计里。</span>
                    </span>
                    <Button size="sm" variant="ghost" icon="undo" onClick={() => { undoRemoved(nodeId); }}>
                      保留
                    </Button>
                  </div>
                ))
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

            <div className="sec-t" style={{ marginTop: 14 }}>
              新增待执行步骤
            </div>
            {addOpen ? (
              <div className="box" style={{ padding: 10 }}>
                <label className="label" htmlFor="add-title">
                  名称
                </label>
                <input id="add-title" className="input" value={addTitle} placeholder="例如：导出性能测试" onChange={(event) => { setAddTitle(event.target.value); }} />
                <label className="label" htmlFor="add-after" style={{ marginTop: 8 }}>
                  在哪个步骤之后（新增步骤的前置）
                </label>
                <select id="add-after" className="select ctl" value={addAfterId ?? ''} onChange={(event) => { setAddAfterId(event.target.value === '' ? undefined : event.target.value); }}>
                  <option value="">无前置（从计划起始处开始）</option>
                  {selectablePrerequisites.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
                <label className="label" htmlFor="add-kind" style={{ marginTop: 8 }}>
                  类型
                </label>
                <select id="add-kind" className="select ctl" value={addKind} onChange={(event) => { setAddKind(event.target.value as NodeKindValue); }}>
                  {ADD_KIND_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <div className="plan-edit-actions">
                  <Button size="sm" variant="primary" icon="plus" disabled={addTitle.trim().length === 0} disabledReason={addTitle.trim().length === 0 ? '请填写新增步骤的名称' : undefined} onClick={addNode}>
                    添加为待保存步骤
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setAddOpen(false); setAddTitle(''); }}>
                    取消
                  </Button>
                </div>
                <p className="hint" style={{ marginTop: 6 }}>
                  新增步骤先保存在本地草稿；点“保存修改”后才会写入未确认的计划修订（服务会做 DAG / 依赖校验）。插入到某步之后时，还可以在下一步编辑其前置来选择它。
                </p>
              </div>
            ) : (
              <div className="plan-edit-actions">
                <Button size="sm" variant="secondary" icon="plus" onClick={() => { setAddOpen(true); }}>
                  新增待执行步骤…
                </Button>
                <span className="hint">设计能力：在待执行区新增 / 插入节点；保存后仍是未确认修订。</span>
              </div>
            )}
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
                {selectedNode.kind === 'verify' ? <QualityReviewFields id="edit-review" value={changeFor(selectedNode).qualityReview} onChange={qualityReview => updateLocal(selectedNode, { qualityReview: qualityReview ?? null })} /> : null}
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
                <div className="col" style={{ gap: 6, marginTop: 8 }}>
                  {selectablePrerequisites.filter((item) => item.id !== selectedNode.id).map((item) => {
                    const checked = (changeFor(selectedNode).prerequisites ?? []).includes(item.id);
                    return (
                      <label key={item.id} className="row" style={{ gap: 8, fontSize: 13 }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const current = changeFor(selectedNode).prerequisites ?? [];
                            updateLocal(selectedNode, {
                              prerequisites: checked ? current.filter((id) => id !== item.id) : [...current, item.id],
                            });
                          }}
                        />
                        <span className="grow">{item.title}</span>
                        <span className="hint mono">{item.id}</span>
                      </label>
                    );
                  })}
                  {lockedNodes.length === 0 ? null : <span className="hint">已领取步骤不能作为新依赖。</span>}
                </div>
                <p className="hint" style={{ marginTop: 6 }}>
                  依赖会写成 order 边；保存前服务端校验自依赖、缺失节点与环路。保存后仍需重新确认计划。
                </p>
                <div className="plan-edit-actions">
                  <Button variant="primary" size="sm" icon="check" disabled={command.state.busy || !hasLocalEdits} disabledReason={!hasLocalEdits ? '没有修改可保存' : undefined} onClick={save}>
                    {command.state.busy ? '正在保存…' : `保存修改（${String(dirtyChanges.length + addedNodes.length + removedNodeIds.length)}）`}
                  </Button>
                  <Button variant="ghost" size="sm" icon="trash" style={{ color: 'var(--danger)' }} onClick={() => { setRemoveTarget(selectedNode); }}>
                    从计划移除…
                  </Button>
                  <span className="hint">保存会生成新的未确认计划修订，状态等待重新确认。</span>
                </div>
              </>
            )}
          </div>
        </div>

        <Section title="本地修改（未保存）" aside={<span className="hint">{dirtyChanges.length + addedNodes.length + removedNodeIds.length} 项</span>}>
          {dirtyChanges.length + addedNodes.length + removedNodeIds.length === 0 ? (
            <p className="hint">还没有本地修改。改动只保存在本页草稿；保存后生成未确认的计划修订。</p>
          ) : (
            <div className="box">
              {dirtyChanges.map(([nodeId, change]) => (
                <div key={`mod:${nodeId}`} className="rowx edit-node">
                  <span className="ic wait"><Icon name="edit" size="sm" /></span>
                  <span className="grow">
                    <span className="t">{change.title ?? nodes.find((node) => node.id === nodeId)?.title ?? nodeId}</span>
                    <span className="s">修改 · 定位后可继续编辑</span>
                  </span>
                  <Button size="sm" variant="ghost" icon="target" onClick={() => { setSelectedNodeId(nodeId); }}>
                    定位
                  </Button>
                </div>
              ))}
              {addedNodes.map((node) => (
                <div key={`add:${node.nodeId}`} className="rowx edit-node">
                  <span className="ic wait"><Icon name="plus" size="sm" /></span>
                  <span className="grow">
                    <span className="t">{node.title}</span>
                    <span className="s">新增 · {node.prerequisites.length === 0 ? '无前置' : `前置 ${node.prerequisites.map((id) => selectablePrerequisites.find((item) => item.id === id)?.title ?? id).join('、')}`}</span>
                  </span>
                  <Button size="sm" variant="ghost" icon="undo" onClick={() => { removeAdded(node.nodeId); }}>
                    撤销新增
                  </Button>
                </div>
              ))}
              {removedNodeIds.map((nodeId) => (
                <div key={`rm:${nodeId}`} className="rowx edit-node">
                  <span className="ic no"><Icon name="trash" size="sm" /></span>
                  <span className="grow">
                    <span className="t">{nodes.find((node) => node.id === nodeId)?.title ?? nodeId}</span>
                    <span className="s">移出 · 保存后不再执行，也不计入完成条件</span>
                  </span>
                  <Button size="sm" variant="ghost" icon="undo" onClick={() => { undoRemoved(nodeId); }}>
                    撤销移出
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Section>
        <CommandErrorNotice error={command.state.error} title="保存未完成" />
        <ReceiptNotice receipt={command.state.receipt} successMessage={receiptSuccess} />
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
              {planChangedSummary(editSession) === undefined ? (
                <p className="hint" style={{ marginBottom: 8 }}>服务没有返回本地改动清单；改动数量以服务保存结果为准。</p>
              ) : (
                <div className="box" style={{ padding: 10, marginBottom: 10 }}>
                  <div className="sec-t">改动（将变成修订 {plan.revisionNumber}）</div>
                  <ul className="list-plain">
                    {planChangedSummary(editSession)!.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="box" style={{ padding: 10, marginBottom: 12 }}>
                <div className="sec-t">当前整图重新检查（服务结果）</div>
                {plan.validation === undefined ? (
                  <p className="hint">服务没有返回当前修订的检查结果；旧检查报告只作历史，不沿用旧绿勾。</p>
                ) : (
                  <ul className="list-plain">
                    <li>结构：{plan.validation.structural.state === 'passed' ? `通过（${String(plan.validation.structural.problems.length)} 个提示）` : plan.validation.structural.state === 'failed' ? `未通过（${String(plan.validation.structural.problems.length)} 个问题）` : '未完成'}</li>
                    <li>人工评审：{String(plan.validation.humanReview.accepted)} / {String(plan.validation.humanReview.required)} 项已接受</li>
                    <li>依据：{plan.validation.basis.state} · {plan.validation.basis.detail}</li>
                    <li>
                      需求归属：{plan.validation.requirementCoverage.length === 0 ? '服务未提供' : `${String(plan.validation.requirementCoverage.filter((item) => item.covered).length)} / ${String(plan.validation.requirementCoverage.length)} 项已覆盖`}
                    </li>
                  </ul>
                )}
                <p className="hint" style={{ marginTop: 6 }}>重新确认不会调用模型，也不会立即领取步骤。</p>
              </div>
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
                计划修订 {plan.revisionNumber} 已确认（{PLAN_REVISION_STATUS_LABEL[plan.status]}）。
                {editSession.wasPausedBeforeEdit === true
                  ? '任务在调整前已由你暂停：结束调整只会关闭编辑，任务保持暂停；恢复任务需单独操作。'
                  : `继续执行会恢复进入调整前的自动推进设置：${editSession.autoAdvanceBeforeEdit ? '开启' : '关闭'}。`}
              </p>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <Button variant="primary" size="sm" icon={editSession.wasPausedBeforeEdit === true ? 'check' : 'play'} disabled={command.state.busy} onClick={() => finish(true)}>
                  {editSession.wasPausedBeforeEdit === true ? '结束调整（任务保持暂停）' : '继续执行'}
                </Button>
                {editSession.wasPausedBeforeEdit === true ? null : (
                  <Button variant="secondary" size="sm" icon="pause" disabled={command.state.busy} onClick={() => finish(false)}>
                    保持暂停
                  </Button>
                )}
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

      <Modal
        open={removeTarget !== undefined}
        title="把这一步移出计划？"
        onClose={() => { setRemoveTarget(undefined); }}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => { setRemoveTarget(undefined); }}>
              保留
            </Button>
            <Button variant="danger" size="sm" icon="trash" onClick={confirmRemove}>
              移出计划
            </Button>
          </>
        }
      >
        <p>
          “{removeTarget?.title ?? '该步骤'}”还没开始，移出后不会执行，也不计入完成条件；记录会保留在审计里。其他步骤继续执行。
        </p>
        <p className="hint" style={{ marginTop: 8 }}>
          移出先保存在本地草稿；点“保存修改”后写入新的未确认计划修订，重新确认后才生效。
        </p>
      </Modal>

      <Modal
        open={abandonOpen}
        title="放弃这次调整？"
        onClose={() => {
          if (!command.state.busy) setAbandonOpen(false);
        }}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setAbandonOpen(false)} disabled={command.state.busy} disabledReason="正在提交操作，等待服务回执…">
              继续调整
            </Button>
            <Button variant="danger" size="sm" icon="x" disabled={command.state.busy} disabledReason="正在提交操作，等待服务回执…" onClick={abandon}>
              {command.state.busy ? '正在放弃…' : '放弃调整'}
            </Button>
          </>
        }
      >
        <p>
          本地草稿会丢弃，计划保持修订 {plan?.revisionNumber ?? '—'}；结束暂停新增领取后，服务恢复调整前的设置：自动推进{' '}
          <b>{editSession.autoAdvanceBeforeEdit ? '开启' : '关闭'}</b>，并恢复调整前的暂停 / 执行状态。
        </p>
        <p className="hint" style={{ marginTop: 8 }}>
          放弃后计划修订不变；若回执未知，只按原 requestKey 核对，不会自动重发。
        </p>
      </Modal>
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

/** P13-08: honest change summary from the service's edit-session local changes (no client diff invention). */
function planChangedSummary(session: NonNullable<ExecutionView['editSession']>): readonly string[] | undefined {
  if (session.localChanges.length === 0) return undefined;
  return session.localChanges.map((change) => {
    if (change.removed === true) return `移出：${change.nodeId}`;
    if (change.added === true) return `新增：${change.title ?? change.nodeId}（前置 ${(change.prerequisites ?? []).join('、') || '无'}）`;
    return `修改：${change.title ?? change.nodeId}`;
  });
}
