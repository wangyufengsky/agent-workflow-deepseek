import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ROUTES, createRequestKey, type RoleDefinition, type WorkflowMethod } from '@agent-workflow/shared';
import { ApiClientError, apiGet, errorMessage, isServiceUnavailable } from '../../api/client.ts';
import { useBootstrap } from '../../api/hooks.ts';
import { formatAbsoluteTime } from '../../app/format.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button, LinkButton } from '../../components/Button.tsx';
import { EmptyState, Skeleton } from '../../components/EmptyState.tsx';
import { Modal } from '../../components/Modal.tsx';
import { Drawer } from '../../components/Drawer.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import {
  builtinCatalogFromBootstrap,
  copyWorkflow,
  fetchWorkflowDetail,
  isWorkflowUnavailable,
  saveWorkflow,
  workflowErrorDetail,
  validateWorkflow,
  type WorkflowCatalogDetail,
  type WorkflowDraft,
  type WorkflowStepView,
  type WorkflowValidationProblem,
} from './workflow-api.ts';
import {
  STEP_KINDS,
  WORKFLOW_STEP_KIND_LABEL,
  countDraftChanges,
  draftFromDetail,
  draftToSaveBody,
  localProblems,
  newStep,
  type LocalProblem,
} from './workflow-model.ts';
import './workflows.css';

const NODE_W = 212;
const NODE_H = 118;
const NODE_GAP = 64;
const START_W = 92;
const END_W = 92;
const CANVAS_TOP = 56;
const START_LEFT = 8;
const STEPS_LEFT = START_LEFT + START_W + 44;

type SavePhase = 'idle' | 'saving' | 'saved' | 'failed' | 'unknown' | 'conflict';

interface SaveState {
  readonly phase: SavePhase;
  readonly requestKey?: string;
  readonly message?: string;
  readonly currentVersion?: number;
}

function roleName(roles: readonly RoleDefinition[], roleId: string | undefined): string | undefined {
  if (roleId === undefined) return undefined;
  return roles.find((role) => role.id === roleId)?.name;
}

function CanvasNode({ step, x, index, selected, readonly, roleLabel, onSelect, onInsertAfter }: {
  readonly step: WorkflowStepView;
  readonly x: number;
  readonly index: number;
  readonly selected: boolean;
  readonly readonly: boolean;
  readonly roleLabel?: string;
  readonly onSelect: () => void;
  readonly onInsertAfter: () => void;
}) {
  return (
    <div className="wfe-node-wrap" id={`wfe-node-${step.key}`} style={{ left: x, top: CANVAS_TOP, width: NODE_W }}>
      <button
        type="button"
        className="wfe-node"
        aria-pressed={selected}
        onClick={onSelect}
        style={{ height: NODE_H }}
      >
        <span className="wfe-node-head">
          <span className="wfe-node-index mono">{String(index + 1).padStart(2, '0')}</span>
          <span className="wfe-node-title ellipsis" title={step.title}>{step.title}</span>
        </span>
        <span className="wfe-node-role">
          {step.roleId === undefined ? (
            <Badge tone="warn" icon="help">未指定职业</Badge>
          ) : (
            <span className="hint ellipsis">职业：{roleLabel ?? step.roleId}</span>
          )}
        </span>
        <span className="wfe-node-meta hint">
          {WORKFLOW_STEP_KIND_LABEL[step.kind]} · {step.group}
          {step.optional === true ? ' · 可选' : ''}
        </span>
      </button>
      {readonly ? null : (
        <div className="wfe-node-actions">
          <Button variant="ghost" size="sm" icon="plus" onClick={onInsertAfter}>
            下一步
          </Button>
        </div>
      )}
    </div>
  );
}

export function WorkflowEditorPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const bootstrap = useBootstrap();
  const queryClient = useQueryClient();
  const detailQuery = useQuery({
    queryKey: ['workflow', 'detail', id],
    queryFn: () => fetchWorkflowDetail(id),
    enabled: id !== '',
    retry: false,
  });
  const roles = bootstrap.data?.catalog.roles ?? [];
  const roleIds = useMemo(() => roles.map((role) => role.id), [roles]);

  const fallbackDetail = useMemo(() => {
    if (detailQuery.data !== undefined || bootstrap.data === undefined || detailQuery.error === null) return undefined;
    if (!isWorkflowUnavailable(detailQuery.error)) return undefined;
    const method: WorkflowMethod | undefined = bootstrap.data.catalog.methods.find((item) => item.id === id);
    return method === undefined ? undefined : builtinCatalogFromBootstrap([method])[0];
  }, [bootstrap.data, detailQuery.data, detailQuery.error, id]);

  const detail: WorkflowCatalogDetail | undefined = detailQuery.data ?? fallbackDetail;
  const fallbackMode = detailQuery.data === undefined && fallbackDetail !== undefined;
  const readonlyBuiltin = detail?.source === 'builtin';
  const readonly = readonlyBuiltin === true || detail?.archived === true;

  const [baseline, setBaseline] = useState<WorkflowDraft | null>(null);
  const [draft, setDraft] = useState<WorkflowDraft | null>(null);
  const [history, setHistory] = useState<readonly WorkflowDraft[]>([]);
  const [future, setFuture] = useState<readonly WorkflowDraft[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);
  const [serverValidation, setServerValidation] = useState<{ readonly problems: readonly WorkflowValidationProblem[]; readonly source: 'server' | 'local' } | null>(null);
  const [checking, setChecking] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ phase: 'idle' });
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyName, setCopyName] = useState('');
  const [copyError, setCopyError] = useState<string | undefined>(undefined);
  const [copyBusy, setCopyBusy] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [lookupMessage, setLookupMessage] = useState<string | undefined>(undefined);
  const loadedMarker = useRef('');
  const editingOnce = useRef(false);

  useEffect(() => {
    if (detail === undefined) return;
    const marker = `${detail.id}:${detail.version}`;
    if (loadedMarker.current === marker) return;
    loadedMarker.current = marker;
    const next = draftFromDetail(detail);
    setBaseline(next);
    setDraft(next);
    setHistory([]);
    setFuture([]);
    setSelectedKey(null);
  }, [detail]);

  const conflictLatest = useQuery({
    queryKey: ['workflow', 'conflict-latest', id, saveState.currentVersion],
    queryFn: () => fetchWorkflowDetail(id),
    enabled: saveState.phase === 'conflict' && conflictOpen,
    retry: false,
  });

  const dirty = baseline !== null && draft !== null ? countDraftChanges(baseline, draft) : 0;
  const locked = saveState.phase === 'unknown' || saveState.phase === 'saving';
  const canEdit = detail !== undefined && readonly !== true && !locked;
  const problems = draft === null ? [] : localProblems(draft, roleIds);

  const commit = useCallback((next: WorkflowDraft) => {
    setDraft((current) => {
      if (current === null) return current;
      setHistory((items) => [...items, current]);
      setFuture([]);
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    setHistory((items) => {
      if (items.length === 0) return items;
      const previous = items[items.length - 1];
      if (previous === undefined) return items;
      setDraft((current) => {
        if (current !== null) setFuture((queue) => [...queue, current]);
        return previous;
      });
      return items.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((items) => {
      if (items.length === 0) return items;
      const next = items[items.length - 1];
      if (next === undefined) return items;
      setDraft((current) => {
        if (current !== null) setHistory((stack) => [...stack, current]);
        return next;
      });
      return items.slice(0, -1);
    });
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select')) return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, [redo, undo]);

  if (bootstrap.isError) {
    return (
      <div className="page">
        <ServiceNotice error={bootstrap.error} onRetry={() => { void bootstrap.refetch(); }} />
      </div>
    );
  }

  if (detailQuery.isLoading || (bootstrap.isLoading && detail === undefined)) {
    return (
      <div className="page">
        <div className="card pad">
          <div className="col" style={{ gap: 10 }}>
            <Skeleton height={20} width="38%" />
            <Skeleton height={180} width="100%" radius={12} />
          </div>
        </div>
      </div>
    );
  }

  if (detail === undefined || draft === null) {
    const unavailable = detailQuery.error !== null && isWorkflowUnavailable(detailQuery.error);
    return (
      <div className="page">
        <section className="card pad">
          <EmptyState
            icon="flow"
            title="流程不存在或编辑接口未接通"
            description={
              detailQuery.error !== null && !unavailable
                ? `读取流程失败：${errorMessage(detailQuery.error)}`
                : '没有找到这个流程；如果这是自定义流程，后端的 /api/workflows 写入/详情接口可能尚未接通（W3-8c 进行中）。页面不展示示例流程。'
            }
            action={
              <LinkButton variant="secondary" size="sm" icon="arrowLeft" to="/workflows">
                返回流程目录
              </LinkButton>
            }
          />
        </section>
      </div>
    );
  }

  const selectedIndex = draft.requiredSteps.findIndex((step) => step.key === selectedKey);
  const selectedStep = selectedIndex >= 0 ? draft.requiredSteps[selectedIndex] : undefined;

  const setDraftField = <K extends keyof WorkflowDraft>(key: K, value: WorkflowDraft[K]): void => {
    if (draft === null) return;
    const next = { ...draft, [key]: value };
    if (editingOnce.current) {
      setDraft(next);
    } else {
      editingOnce.current = true;
      commit(next);
    }
  };

  const updateStep = (patch: Partial<WorkflowStepView>): void => {
    if (draft === null || selectedStep === undefined) return;
    commit({
      ...draft,
      requiredSteps: draft.requiredSteps.map((step) => (step.key === selectedStep.key ? { ...step, ...patch } : step)),
    });
  };

  const insertStepAt = (index: number): void => {
    if (draft === null || !canEdit) return;
    let position = Math.max(0, Math.min(index, draft.requiredSteps.length));
    const last = draft.requiredSteps[position];
    if (position >= draft.requiredSteps.length && last !== undefined && (last.kind === 'delivery' || last.kind === 'verify')) {
      position = draft.requiredSteps.length - 1;
    }
    const step = newStep(draft.requiredSteps, '新步骤');
    const steps = [...draft.requiredSteps.slice(0, position), step, ...draft.requiredSteps.slice(position)];
    commit({ ...draft, requiredSteps: steps });
    setSelectedKey(step.key);
    setPanelOpen(true);
  };

  const insertAfterSelected = (): void => {
    if (selectedIndex >= 0) insertStepAt(selectedIndex + 1);
    else insertStepAt(draft.requiredSteps.length);
  };

  const removeSelected = (): void => {
    if (draft === null || selectedStep === undefined) return;
    commit({ ...draft, requiredSteps: draft.requiredSteps.filter((step) => step.key !== selectedStep.key) });
    setSelectedKey(null);
    setPanelOpen(false);
    setDeleteOpen(false);
  };

  const runCheck = async (): Promise<readonly LocalProblem[]> => {
    if (draft === null) return [];
    const local = localProblems(draft, roleIds);
    if (fallbackMode) {
      setServerValidation({ problems: local, source: 'local' });
      setCheckOpen(true);
      return local;
    }
    setChecking(true);
    try {
      const result = await validateWorkflow({ draft: draftToSaveBody(draft), id: detail?.id });
      const merged = [...result.problems];
      for (const problem of local) {
        if (problem.code === 'STEP_ROLE_MISSING' && !merged.some((item) => item.stepKey === problem.stepKey && item.code === 'STEP_ROLE_MISSING')) {
          merged.push({ code: problem.code, message: problem.message, stepKey: problem.stepKey });
        }
      }
      setServerValidation({ problems: merged, source: 'server' });
      setCheckOpen(true);
      return local;
    } catch (error) {
      if (isWorkflowUnavailable(error)) {
        setServerValidation({ problems: local, source: 'local' });
        setCheckOpen(true);
        return local;
      }
      setServerValidation({ problems: [...local, { code: 'VALIDATE_FAILED', message: `检查接口调用失败：${errorMessage(error)}` }], source: 'local' });
      setCheckOpen(true);
      return local;
    } finally {
      setChecking(false);
    }
  };

  const save = async (): Promise<void> => {
    if (draft === null || detail === undefined || !canEdit || dirty === 0) return;
    const local = localProblems(draft, roleIds);
    if (local.length > 0) {
      setServerValidation({ problems: local, source: 'local' });
      setCheckOpen(true);
      return;
    }
    if (fallbackMode) {
      setSaveState({ phase: 'failed', message: '后端 /api/workflows 写入接口尚未接通（W3-8c 进行中），本次修改没有提交。' });
      return;
    }
    const requestKey = createRequestKey();
    setSaveState({ phase: 'saving', requestKey });
    try {
      const result = await saveWorkflow({ id: detail.id, draft: draftToSaveBody(draft), expectedVersion: detail.version, requestKey });
      if (result.kind === 'ok') {
        queryClient.setQueryData(['workflow', 'detail', detail.id], result.detail);
        loadedMarker.current = '';
        setSaveState({ phase: 'saved', requestKey });
      } else if (result.kind === 'conflict') {
        setSaveState({ phase: 'conflict', requestKey, currentVersion: result.currentVersion, message: result.message });
      } else {
        setSaveState({ phase: 'failed', requestKey, message: result.message });
      }
    } catch (error) {
      const unknown = error instanceof ApiClientError && (error.kind === 'timeout' || error.kind === 'unavailable');
      setSaveState({
        phase: unknown ? 'unknown' : 'failed',
        requestKey,
        message: unknown
          ? '保存请求已发出，但没有收到确认；画布已锁定为只读，草稿保留。可按原请求核对，不会自动重发。'
          : workflowErrorDetail(error),
      });
    }
  };

  const reconcile = async (): Promise<void> => {
    if (saveState.requestKey === undefined) return;
    setLookupMessage('正在按原请求核对…');
    try {
      const response = await apiGet<{ operation: { status: string; outcome?: Record<string, unknown> }; stillUnknown: boolean }>(ROUTES.operationsByKey(saveState.requestKey));
      const operation = response.data.operation;
      if (operation.status === 'succeeded') {
        const refreshed = await detailQuery.refetch();
        if (refreshed.data !== undefined) queryClient.setQueryData(['workflow', 'detail', id], refreshed.data);
        setSaveState({ phase: 'saved', requestKey: saveState.requestKey });
        setLookupMessage('原请求已结算：版本已刷新。');
      } else if (operation.status === 'failed') {
        setSaveState({ phase: 'failed', requestKey: saveState.requestKey, message: '按原请求核对：保存失败，未写入新版本。' });
        setLookupMessage('核对完成：保存失败。');
      } else {
        setLookupMessage(`核对后仍未确认结果（${operation.status}）；不会自动重发。`);
      }
    } catch (error) {
      setLookupMessage(`核对失败：${errorMessage(error)}`);
    }
  };

  const exportDraft = (): void => {
    if (draft === null) return;
    const blob = new Blob([JSON.stringify({ workflow: draft, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${draft.name || detail?.id || 'workflow'}-mine.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const copyBuiltin = async (): Promise<void> => {
    if (detail === undefined) return;
    const name = copyName.trim();
    if (name === '') {
      setCopyError('副本名称不能为空。');
      return;
    }
    if (name.length > 120) {
      setCopyError('副本名称最多 120 个字符。');
      return;
    }
    setCopyBusy(true);
    setCopyError(undefined);
    try {
      const mutation = await copyWorkflow({ id: detail.id, name, requestKey: createRequestKey() });
      await queryClient.invalidateQueries({ queryKey: ['workflows'] });
      setCopyOpen(false);
      navigate(`/workflows/${encodeURIComponent(mutation.method.id)}/edit`);
    } catch (error) {
      setCopyError(isServiceUnavailable(error) ? '服务未连接，未复制。' : workflowErrorDetail(error));
    } finally {
      setCopyBusy(false);
    }
  };

  const backToCatalog = (): void => {
    if (dirty > 0 && !window.confirm(`还有 ${String(dirty)} 处未保存修改，确定离开吗？`)) return;
    navigate('/workflows');
  };

  const canvasWidth = STEPS_LEFT + draft.requiredSteps.length * (NODE_W + NODE_GAP) + 40 + END_W;
  const endX = STEPS_LEFT + draft.requiredSteps.length * (NODE_W + NODE_GAP) + 14;
  const stepX = (index: number): number => STEPS_LEFT + index * (NODE_W + NODE_GAP);

  const banner =
    saveState.phase === 'unknown' ? (
      <div className="banner unknown" role="alert">
        <Icon name="help" />
        <div className="grow">
          <b>保存结果未明</b>
          <br />
          {saveState.message ?? '请求已发出但没有收到确认。'}画布已锁定为只读，草稿保留。
          {saveState.requestKey === undefined ? null : <span className="mono"> · requestKey {saveState.requestKey}</span>}
          {lookupMessage === undefined ? null : <div className="hint" style={{ marginTop: 4 }}>{lookupMessage}</div>}
        </div>
        <div className="actions">
          <Button variant="secondary" size="sm" icon="refresh" onClick={() => { void reconcile(); }}>
            按原请求核对
          </Button>
        </div>
      </div>
    ) : saveState.phase === 'conflict' ? (
      <div className="banner danger" role="alert">
        <Icon name="alert" />
        <div className="grow">
          <b>流程已被更新为版本 {String(saveState.currentVersion ?? '?')}</b>
          <br />
          你的 {String(dirty)} 处修改基于版本 {String(detail.version)}，没有保存。请先查看最新版本，再决定是否在最新版本上重新修改；不会在原请求下改写。
        </div>
        <div className="actions">
          <Button variant="secondary" size="sm" icon="eye" onClick={() => { setConflictOpen(true); }}>
            查看版本 {String(saveState.currentVersion ?? '')}
          </Button>
          <Button variant="ghost" size="sm" icon="download" onClick={exportDraft}>
            导出我的修改
          </Button>
        </div>
      </div>
    ) : saveState.phase === 'failed' ? (
      <div className="banner danger" role="alert">
        <Icon name="alert" />
        <div className="grow">
          <b>保存失败</b>
          <br />
          {saveState.message}
        </div>
        <div className="actions">
          <Button variant="ghost" size="sm" icon="x" onClick={() => { setSaveState({ phase: 'idle' }); }}>
            收起
          </Button>
        </div>
      </div>
    ) : saveState.phase === 'saved' ? (
      <div className="banner ok" role="status">
        <Icon name="check" />
        <div className="grow">
          <b>已保存</b>
          <br />
          版本 {String(detail.version)} · 回执已结算
          {saveState.requestKey === undefined ? null : <span className="mono"> · requestKey {saveState.requestKey}</span>}
          {lookupMessage === undefined ? null : <div className="hint" style={{ marginTop: 4 }}>{lookupMessage}</div>}
        </div>
      </div>
    ) : readonlyBuiltin === true ? (
      <div className="banner info">
        <Icon name="lock" />
        <div className="grow">
          这是程序内置流程，可以查看每一步；要修改请先复制一份到「我的流程」。
          {fallbackMode ? ' 当前 /api/workflows 接口尚未接通，复制按钮不可用；页面展示的是目录快照。' : null}
        </div>
      </div>
    ) : null;

  return (
    <div className="page wfe-page">
      <div className="wfe-toolbar" aria-label="流程编辑工具条">
        <button type="button" className="wfe-crumb" onClick={backToCatalog}>
          流程
        </button>
        <span className="wfe-crumb-sep" aria-hidden="true">/</span>
        <input
          className="wfe-title"
          aria-label="流程名称"
          value={draft.name}
          readOnly={!canEdit}
          onChange={(event) => {
            setDraftField('name', event.target.value);
          }}
          onBlur={() => {
            editingOnce.current = false;
          }}
        />
        <Badge tone={detail.source === 'builtin' ? 'idle' : 'accent'} icon={detail.source === 'builtin' ? 'lock' : 'users'}>
          {detail.source === 'builtin' ? '程序内置 · 只读' : '我的流程'}
        </Badge>
        <Badge outline>{detail.revision} · 版本 {String(detail.version)}</Badge>
        <span className="grow" />
        <span className="wfe-save-state" aria-live="polite">
          {saveState.phase === 'saving'
            ? '正在保存…'
            : saveState.phase === 'unknown'
              ? '保存结果未明'
              : saveState.phase === 'conflict'
                ? '版本已变化'
                : dirty > 0
                  ? `${String(dirty)} 处未保存修改`
                  : '已保存'}
        </span>
        <Button
          variant="ghost"
          size="sm"
          icon="undo"
          disabled={history.length === 0 || !canEdit}
          disabledReason={history.length === 0 ? '没有可撤销的修改' : readonly ? '只读流程不能修改' : undefined}
          onClick={undo}
        >
          撤销
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon="redo"
          disabled={future.length === 0 || !canEdit}
          disabledReason={future.length === 0 ? '没有可重做的修改' : readonly ? '只读流程不能修改' : undefined}
          onClick={redo}
        >
          重做
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon="plus"
          disabled={!canEdit}
          disabledReason={readonly ? '内置流程只读，请复制后修改' : locked ? '保存结果未明，画布已锁定' : undefined}
          onClick={insertAfterSelected}
        >
          添加步骤
        </Button>
        <Button variant="secondary" size="sm" icon="check" disabled={checking} disabledReason={checking ? '正在检查…' : undefined} onClick={() => { void runCheck(); }}>
          检查{problems.length > 0 ? ` · ${String(problems.length)}` : ''}
        </Button>
        {readonlyBuiltin === true ? (
          <Button
            variant="primary"
            size="sm"
            icon="copy"
            disabled={fallbackMode || copyBusy}
            disabledReason={fallbackMode ? '接口未接通，无法复制；请等待 W3-8c 接线' : copyBusy ? '正在复制…' : undefined}
            onClick={() => {
              setCopyName(`${detail.name} 副本`);
              setCopyError(undefined);
              setCopyOpen(true);
            }}
          >
            复制后修改
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            icon="check"
            disabled={!canEdit || dirty === 0}
            disabledReason={locked ? '保存结果未明/正在保存' : dirty === 0 ? '没有需要保存的修改' : readonly ? '只读流程不能保存' : undefined}
            onClick={() => { void save(); }}
          >
            保存
          </Button>
        )}
      </div>

      {fallbackMode ? (
        <div className="banner warn" style={{ marginBottom: 12 }}>
          <Icon name="info" />
          <div className="grow">
            `/api/workflows` 详情/写入接口尚未接通（W3-8c 进行中）；当前以目录快照只读展示内置流程。复制、保存、检查接口调用会明确报错，不伪造成功。
          </div>
        </div>
      ) : null}

      {banner === null ? null : <div style={{ marginBottom: 12 }}>{banner}</div>}

      <div className="wfe-canvas-card" aria-label="流程画布">
        <div className="wfe-canvas-scroll">
          <div className="wfe-canvas" style={{ width: Math.max(canvasWidth, 720) }}>
            <svg className="wfe-edges" width={Math.max(canvasWidth, 720)} height={260} aria-hidden="true">
              <line x1={START_LEFT + START_W} y1={CANVAS_TOP + NODE_H / 2} x2={STEPS_LEFT} y2={CANVAS_TOP + NODE_H / 2} />
              {draft.requiredSteps.map((step, index) => (
                <line
                  key={`${step.key}-line`}
                  x1={stepX(index) + NODE_W}
                  y1={CANVAS_TOP + NODE_H / 2}
                  x2={index === draft.requiredSteps.length - 1 ? endX : stepX(index + 1)}
                  y2={CANVAS_TOP + NODE_H / 2}
                />
              ))}
            </svg>

            <div className="wfe-system-node" style={{ left: START_LEFT, top: CANVAS_TOP + NODE_H / 2 - 18 }}>
              <Icon name="play" size="sm" />
              开始
            </div>

            {draft.requiredSteps.map((step, index) => (
              <CanvasNode
                key={step.key}
                step={step}
                x={stepX(index)}
                index={index}
                selected={selectedKey === step.key}
                readonly={!canEdit}
                roleLabel={roleName(roles, step.roleId)}
                onSelect={() => {
                  setSelectedKey(step.key);
                  setPanelOpen(true);
                }}
                onInsertAfter={() => {
                  insertStepAt(index + 1);
                }}
              />
            ))}

            {draft.requiredSteps.length > 0
              ? draft.requiredSteps.map((step, index) =>
                  index < draft.requiredSteps.length - 1 && canEdit ? (
                    <button
                      key={`${step.key}-insert`}
                      type="button"
                      className="wfe-edge-plus"
                      aria-label={`在第 ${String(index + 1)} 步与第 ${String(index + 2)} 步之间插入`}
                      style={{ left: stepX(index) + NODE_W + 16, top: CANVAS_TOP + NODE_H / 2 - 12 }}
                      onClick={() => {
                        insertStepAt(index + 1);
                      }}
                    >
                      <Icon name="plus" size="sm" />
                    </button>
                  ) : null,
                )
              : null}

            <div className="wfe-system-node" style={{ left: endX, top: CANVAS_TOP + NODE_H / 2 - 18 }}>
              <Icon name="check" size="sm" />
              交付
            </div>

            {draft.requiredSteps.length === 0 ? (
              <div className="wfe-empty">
                <span className="tile">
                  <Icon name="flow" />
                </span>
                <b>从第一步开始</b>
                <p className="hint">流程由一串步骤组成；服务端要求至少保留一个交付或验收步骤。</p>
                <Button
                  variant="primary"
                  size="sm"
                  icon="plus"
                  disabled={!canEdit}
                  disabledReason={readonly ? '内置流程只读，请复制后修改' : undefined}
                  onClick={() => {
                    insertStepAt(0);
                  }}
                >
                  添加第一步
                </Button>
              </div>
            ) : null}

            <div className="wfe-count">
              {String(draft.requiredSteps.length)} 个步骤 · {String(draft.requiredSteps.length + 1)} 条连线
            </div>
          </div>
        </div>
        <p className="hint wfe-canvas-note">
          画布按有序步骤链排列（服务模型没有并行分支字段，执行按步骤顺序推进）；「并行 / 连接到」不可用，已用按钮原因说明。
          职业来自角色目录；未指定职业的步骤会阻止保存（前端规则）。
        </p>
      </div>

      {checkOpen && serverValidation !== null ? (
        <div className="wfe-check" role="dialog" aria-label="检查结果">
          <div className="wfe-check-head">
            <Icon name={serverValidation.problems.length === 0 ? 'check' : 'alert'} size="sm" />
            <b>{serverValidation.problems.length === 0 ? '检查通过' : `${String(serverValidation.problems.length)} 个问题需要处理`}</b>
            <span className="spacer" />
            <Button variant="ghost" size="sm" icon="x" onClick={() => { setCheckOpen(false); }}>
              关闭
            </Button>
          </div>
          <p className="hint" style={{ padding: '0 14px 8px' }}>
            检查来源：{serverValidation.source === 'server' ? '服务端 /api/workflows/validate' : '前端规则（检查接口未接通或调用失败）'}。
          </p>
          <div className="wfe-check-list">
            {serverValidation.problems.length === 0 ? (
              <p className="hint" style={{ padding: 14 }}>所有步骤都有职业、步骤键唯一，且保留了交付/验收步骤。</p>
            ) : (
              serverValidation.problems.map((problem, index) => (
                <div key={`${problem.code}:${problem.stepKey ?? String(index)}`} className="wfe-check-row">
                  <Badge tone="warn" icon="alert">{problem.code}</Badge>
                  <span className="grow">{problem.message}</span>
                  {problem.stepKey === undefined ? null : (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="target"
                      onClick={() => {
                        setSelectedKey(problem.stepKey ?? null);
                        setPanelOpen(true);
                        setCheckOpen(false);
                        document.getElementById(`wfe-node-${problem.stepKey ?? ''}`)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'center' });
                      }}
                    >
                      定位
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}

      <Drawer
        open={panelOpen && selectedStep !== undefined}
        title="步骤"
        size="lg"
        onClose={() => { setPanelOpen(false); }}
        footer={
          <>
            {canEdit ? (
              <Button variant="ghost" size="sm" icon="trash" onClick={() => { setDeleteOpen(true); }}>
                删除这一步
              </Button>
            ) : (
              <span className="hint grow">只读流程</span>
            )}
            <span className="spacer" />
            <Button variant="primary" onClick={() => { setPanelOpen(false); }}>
              完成
            </Button>
          </>
        }
      >
        {selectedStep === undefined ? null : (
          <div className="col" style={{ gap: 16 }} id={`wfe-step-${selectedStep.key}`}>
            <div className="banner info">
              <Icon name="info" />
              <div className="grow">
                服务只提供步骤名称 / 类型 / 分组 / 职业 / 可选 / 依赖字段；设计稿的「这一步做什么 / 产出与验收」没有对应契约，本面板不伪造这些内容。
              </div>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label" htmlFor="wfe-step-title">步骤名称</label>
              <input
                id="wfe-step-title"
                className="input"
                value={selectedStep.title}
                readOnly={!canEdit}
                onChange={(event) => { updateStep({ title: event.target.value }); }}
              />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label" htmlFor="wfe-step-role">谁来做（职业）</label>
              <select
                id="wfe-step-role"
                className="select"
                value={selectedStep.roleId ?? ''}
                disabled={!canEdit}
                onChange={(event) => {
                  const value = event.target.value;
                  updateStep(value === '' ? { roleId: undefined } : { roleId: value });
                }}
              >
                <option value="">未指定职业</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>{role.name}</option>
                ))}
              </select>
              <span className="hint">职业来自角色目录；服务会校验存在的职业。未指定职业会阻止保存（前端规则）。</span>
            </div>
            <div className="grid-2" style={{ gap: 12 }}>
              <div className="field" style={{ margin: 0 }}>
                <label className="label" htmlFor="wfe-step-kind">步骤类型</label>
                <select
                  id="wfe-step-kind"
                  className="select"
                  value={selectedStep.kind}
                  disabled={!canEdit}
                  onChange={(event) => { updateStep({ kind: event.target.value as WorkflowStepView['kind'] }); }}
                >
                  {STEP_KINDS.map((kind) => (
                    <option key={kind} value={kind}>{WORKFLOW_STEP_KIND_LABEL[kind]}</option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label className="label" htmlFor="wfe-step-group">分组</label>
                <input
                  id="wfe-step-group"
                  className="input"
                  value={selectedStep.group}
                  readOnly={!canEdit}
                  onChange={(event) => { updateStep({ group: event.target.value }); }}
                />
              </div>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <span className="label">之后</span>
              <div className="col" style={{ gap: 6 }}>
                {draft.requiredSteps.slice(selectedIndex + 1, selectedIndex + 2).map((next) => (
                  <span key={next.key} className="chip" style={{ justifyContent: 'flex-start' }}>
                    <Icon name="arrowRight" size="sm" />
                    {next.title}
                  </span>
                ))}
                {selectedIndex === draft.requiredSteps.length - 1 ? <span className="hint">这是最后一步；执行完成后到达「交付」。</span> : null}
              </div>
              <p className="hint" style={{ marginTop: 6 }}>
                流程按有序步骤执行，服务没有并行分支字段；「添加并行步骤 / 连接到…」不可用（按钮会禁用并说明原因）。
              </p>
              {canEdit ? (
                <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
                  <Button variant="secondary" size="sm" icon="plus" onClick={() => { insertStepAt(selectedIndex + 1); }}>
                    添加下一步
                  </Button>
                  <Button variant="ghost" size="sm" icon="split" disabled disabledReason="服务模型只有有序步骤列表，没有并行分支字段；并行步骤无法保存。">
                    添加并行步骤
                  </Button>
                  <Button variant="ghost" size="sm" icon="link" disabled disabledReason="服务没有任意连线字段；执行按步骤顺序推进，requires 只用于依赖检查。">
                    连接到…
                  </Button>
                </div>
              ) : null}
            </div>
            <details className="wfe-advanced">
              <summary>
                <Icon name="chevRight" size="sm" />
                高级设置
                <span className="hint grow">依赖 · 可选</span>
              </summary>
              <div className="col" style={{ gap: 12, paddingTop: 10 }}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={selectedStep.optional === true}
                    disabled={!canEdit}
                    onChange={(event) => { updateStep(event.target.checked ? { optional: true } : { optional: undefined }); }}
                  />
                  <span>
                    <span style={{ fontSize: 13.5 }}>可选步骤</span>
                    <span className="hint" style={{ display: 'block' }}>optional 是服务真实字段；规划/执行时按目录语义处理。</span>
                  </span>
                </label>
                <div>
                  <span className="label">依赖（requires，仅用于检查依赖/环路）</span>
                  <div className="col" style={{ gap: 4, marginTop: 6 }}>
                    {draft.requiredSteps.filter((step) => step.key !== selectedStep.key).map((step) => {
                      const checked = (selectedStep.requires ?? []).includes(step.key);
                      return (
                        <label key={step.key} className="check">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!canEdit}
                            onChange={(event) => {
                              const current = new Set(selectedStep.requires ?? []);
                              if (event.target.checked) current.add(step.key);
                              else current.delete(step.key);
                              updateStep(current.size === 0 ? { requires: undefined } : { requires: [...current] });
                            }}
                          />
                          <span style={{ fontSize: 13 }}>{step.title}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            </details>
          </div>
        )}
      </Drawer>

      <Modal
        open={deleteOpen}
        title="删除这一步？"
        onClose={() => { setDeleteOpen(false); }}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setDeleteOpen(false); }}>保留</Button>
            <Button variant="danger" icon="trash" onClick={removeSelected}>删除</Button>
          </>
        }
      >
        <p>“{selectedStep?.title ?? ''}”会从有序步骤链中移除，前后步骤按顺序自动衔接。删除只影响这份草稿，保存前都可以撤销。</p>
      </Modal>

      <Modal
        open={copyOpen}
        title="复制为我的流程"
        onClose={() => { if (!copyBusy) setCopyOpen(false); }}
        footer={
          <>
            <Button variant="ghost" disabled={copyBusy} onClick={() => { setCopyOpen(false); }}>取消</Button>
            <Button variant="primary" icon="copy" disabled={copyBusy || copyName.trim() === ''} disabledReason={copyBusy ? '正在复制…' : copyName.trim() === '' ? '副本名称不能为空' : undefined} onClick={() => { void copyBuiltin(); }}>
              {copyBusy ? '正在复制…' : '复制'}
            </Button>
          </>
        }
      >
        <div className="col" style={{ gap: 12 }}>
          <div className="field" style={{ margin: 0 }}>
            <label className="label" htmlFor="wfe-copy-name">副本名称</label>
            <input id="wfe-copy-name" className="input" value={copyName} maxLength={120} disabled={copyBusy} onChange={(event) => { setCopyName(event.target.value); setCopyError(undefined); }} />
            <span className="hint">将复制版本 {String(detail.version)} 的步骤定义；复制后可自由修改。</span>
          </div>
          {copyError === undefined ? null : <p className="error-text">{copyError}</p>}
        </div>
      </Modal>

      <Modal
        open={conflictOpen}
        title={`最新版本 ${String(saveState.currentVersion ?? '')}`}
        onClose={() => { setConflictOpen(false); }}
        footer={<Button variant="ghost" onClick={() => { setConflictOpen(false); }}>关闭</Button>}
      >
        {conflictLatest.isLoading ? <p className="hint">正在读取最新版本…</p> : conflictLatest.isError ? (
          <p className="error-text">读取最新版本失败：{errorMessage(conflictLatest.error)}</p>
        ) : conflictLatest.data === undefined ? null : (
          <div className="col" style={{ gap: 10 }}>
            <div className="hint">版本 {String(conflictLatest.data.version)} · {formatAbsoluteTime(conflictLatest.data.updatedAt ?? '')}</div>
            <ol className="wfe-conflict-steps">
              {conflictLatest.data.requiredSteps.map((step) => (
                <li key={step.key}>{step.title}<span className="hint"> · {WORKFLOW_STEP_KIND_LABEL[step.kind]}</span></li>
              ))}
            </ol>
            <p className="hint">你的草稿不会被丢弃；如需基于最新版本继续修改，请先关闭本页重新打开，或使用「导出我的修改」。</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
