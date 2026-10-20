import {pendingIdentityForPath,usePendingIdentity} from '../../api/pending-identity.ts';
import { QualityReviewFields } from '../../flow/QualityReviewFields.tsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ROUTES, createRequestKey, type WorkflowMethod } from '@agent-workflow/shared';
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
import { WorkflowGraphCanvas } from './WorkflowGraphCanvas.tsx';
import { addWorkflowStep, removeWorkflowStep, connectWorkflowSteps, workflowDifferences, workflowLayout } from './workflow-graph.ts';
import { explicitMethodSteps } from '@agent-workflow/shared';
import './workflows.css';

type SavePhase = 'idle' | 'saving' | 'saved' | 'failed' | 'unknown' | 'conflict';

interface SaveState {
  readonly phase: SavePhase;
  readonly requestKey?: string;
  readonly message?: string;
  readonly currentVersion?: number;
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
  const versionsQuery = useQuery({ queryKey: ['workflow', 'versions', id, detailQuery.data?.version], queryFn: async () => (await apiGet<{ versions: readonly WorkflowCatalogDetail[] }>(ROUTES.workflowVersions(id))).data.versions, enabled: id !== '', retry: false });
  const roles = bootstrap.data?.catalog.roles ?? [];
  const roleNames = useMemo(() => new Map(roles.map((role) => [role.id, role.name])), [roles]);
  const executionRoles = roles.filter((role) => !(bootstrap.data?.catalog.methods ?? []).some((method) => method.planningStrategy?.roleId === role.id));
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
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [diffOpen, setDiffOpen] = useState(false);
  const [comparisonVersion, setComparisonVersion] = useState<number | undefined>();
  const [connectTarget, setConnectTarget] = useState('');
  const [graphError, setGraphError] = useState<string | undefined>();
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
  const durableCommand=usePendingIdentity(ROUTES.workflow(id));
  const originalKey=durableCommand?.requestKey??(saveState.phase==='unknown'?saveState.requestKey:undefined);
  const locked = originalKey!==undefined || saveState.phase === 'saving';
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
    if (!canEdit) return;
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
  }, [canEdit]);

  const redo = useCallback(() => {
    if (!canEdit) return;
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
  }, [canEdit]);

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
                : '没有找到这个流程；如果这是自定义流程，后端的 /api/workflows 写入/详情接口可能尚未接通（服务当前不可用）。页面不展示示例流程。'
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
    const step = newStep(draft.requiredSteps, '新步骤');
    const anchor = draft.requiredSteps[Math.max(0, index - 1)]?.key;
    commit({ ...draft, requiredSteps: addWorkflowStep(draft.requiredSteps, step, index === 0 ? undefined : anchor) });
    setSelectedKey(step.key);
    setPanelOpen(true);
  };

  const insertAfterSelected = (): void => {
    if (selectedIndex >= 0) insertStepAt(selectedIndex + 1);
    else insertStepAt(draft.requiredSteps.length);
  };

  const removeSelected = (): void => {
    if (draft === null || selectedStep === undefined) return;
    const steps = removeWorkflowStep(draft.requiredSteps, selectedStep.key);
    commit({ ...draft, requiredSteps: steps, refinableGroups: draft.refinableGroups.filter((group) => steps.some((step) => step.group === group)) });
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
      setSaveState({ phase: 'failed', message: '后端 /api/workflows 写入接口尚未接通（服务当前不可用），本次修改没有提交。' });
      return;
    }
    if(pendingIdentityForPath(ROUTES.workflow(id)))return;
    const requestKey = createRequestKey();
    setSaveState({ phase: 'saving', requestKey });
    try {
      const result = await saveWorkflow({ id: detail.id, draft: draftToSaveBody(draft), expectedVersion: detail.version, requestKey });
      if (result.kind === 'ok') {
        queryClient.setQueryData(['workflow', 'detail', detail.id], result.detail);
        loadedMarker.current = '';
        setSaveState({ phase: 'saved', requestKey });
      } else if(result.kind==='pending'){setSaveState({phase:'unknown',requestKey,message:result.message});
      } else if (result.kind === 'conflict') {
        setSaveState({ phase: 'conflict', requestKey, currentVersion: result.currentVersion, message: result.message });
      } else {
        setSaveState({ phase: 'failed', requestKey, message: result.message });
      }
    } catch (error) {
      const unknown = error instanceof ApiClientError && (error.kind === 'timeout' || error.kind === 'unavailable' || error.kind==='protocol');
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
    const key=pendingIdentityForPath(ROUTES.workflow(id))?.requestKey??originalKey;
    if(key===undefined)return;
    setLookupMessage('正在按原请求核对…');
    try {
      const response = await apiGet<{ operation: { status: string; outcome?: Record<string, unknown> }; stillUnknown: boolean }>(ROUTES.operationsByKey(key));
      const operation = response.data.operation;
      if (operation.status === 'succeeded') {
        const refreshed = await detailQuery.refetch();
        if (refreshed.data !== undefined) queryClient.setQueryData(['workflow', 'detail', id], refreshed.data);
        setSaveState({ phase: 'saved', requestKey: key });
        setLookupMessage('原请求已结算：版本已刷新。');
      } else if (operation.status === 'failed') {
        setSaveState({ phase: 'failed', requestKey: key, message: '按原请求核对：保存失败，未写入新版本。' });
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

  const connect = (from: string, to: string): void => {
    if (!canEdit) return;
    const steps = connectWorkflowSteps(draft.requiredSteps, from, to);
    if (steps === undefined) { setGraphError('这条连线会造成环路，或端点不存在；修改未应用。'); return; }
    commit({ ...draft, requiredSteps: steps }); setGraphError(undefined);
  };
  const parallel = (): void => {
    if (!canEdit || selectedStep === undefined) return;
    const step = newStep(draft.requiredSteps, '并行步骤');
    commit({ ...draft, requiredSteps: addWorkflowStep(draft.requiredSteps, step, selectedStep.key, 'parallel') });
    setSelectedKey(step.key);
  };
  const comparison = versionsQuery.data?.find((item) => item.version === comparisonVersion);
  const comparisonSteps = comparison?.requiredSteps ?? baseline?.requiredSteps ?? [];
  const differences = workflowDifferences(comparisonSteps, draft.requiredSteps);

  const banner =
    originalKey!==undefined && saveState.phase!=='saving' ? (
      <div className="banner unknown" role="alert">
        <Icon name="help" />
        <div className="grow">
          <b>{durableCommand?.phase==='accepted'?'保存已受理，等待结算':'保存结果未明'}</b>
          <br />
          {saveState.message ?? '请求已发出但没有收到确认。'}画布已锁定为只读，草稿保留。
          {originalKey === undefined ? null : <span className="mono"> · requestKey {originalKey}</span>}
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
          {(() => {
            const visual = saveState.phase === 'saving'
              ? { icon: 'refresh' as const, label: '正在保存…' }
              : originalKey !== undefined
                ? (durableCommand?.phase === 'accepted' ? { icon: 'clock' as const, label: '保存已受理' } : { icon: 'help' as const, label: '保存结果未明' })
                : saveState.phase === 'conflict'
                  ? { icon: 'alert' as const, label: '版本已变化' }
                  : dirty > 0
                    ? { icon: 'edit' as const, label: `${String(dirty)} 处未保存修改` }
                    : { icon: 'check' as const, label: '已保存' };
            return (
              <>
                <Icon name={visual.icon} size="sm" />
                {visual.label}
              </>
            );
          })()}
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
          检查
          {problems.length > 0 ? <Badge tone="fail">{String(problems.length)}</Badge> : null}
        </Button>
        {readonlyBuiltin === true ? (
          <Button
            variant="primary"
            size="sm"
            icon="copy"
            disabled={fallbackMode || copyBusy}
            disabledReason={fallbackMode ? '接口未接通，无法复制；请先恢复服务连接' : copyBusy ? '正在复制…' : undefined}
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
            `/api/workflows` 详情/写入接口尚未接通（服务当前不可用）；当前以目录快照只读展示内置流程。复制、保存、检查接口调用会明确报错，不伪造成功。
          </div>
        </div>
      ) : null}

      {banner === null ? null : <div style={{ marginBottom: 12 }}>{banner}</div>}

      <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
        <Button variant="secondary" size="sm" icon="plus" disabled={!canEdit} disabledReason={readonly ? '只读流程，请复制后修改' : locked ? '保存未结算，暂不能修改' : undefined} onClick={() => { setTemplatesOpen(true); }}>从步骤模板添加</Button>
        <select className="select" style={{ width: 'auto', minWidth: 200, maxWidth: '100%' }} aria-label="选择流程步骤" value={selectedKey ?? ''} onChange={(event) => { if (event.target.value !== '') { setSelectedKey(event.target.value); setPanelOpen(true); } }}><option value="">选择步骤查看或编辑…</option>{draft.requiredSteps.map((step) => <option key={step.key} value={step.key}>{step.title}</option>)}</select>
        <Button variant="ghost" size="sm" icon="eye" onClick={() => { setDiffOpen(true); }}>查看本地修改对照 · {differences.length}</Button>
      </div>
      {graphError === undefined ? null : <div className="banner danger" role="alert"><Icon name="alert" />{graphError}</div>}
      <div className="wfe-canvas-card" aria-label="流程画布">
        <WorkflowGraphCanvas steps={draft.requiredSteps} roleNames={roleNames} baseline={comparisonSteps} selected={selectedKey} readonly={!canEdit}
          onSelect={(key) => { setSelectedKey(key); setPanelOpen(true); }} onConnect={connect}
          onDisconnect={(from, to) => { if (canEdit) commit({ ...draft, requiredSteps: explicitMethodSteps(draft.requiredSteps).map((step) => step.key === to ? { ...step, requires: step.requires!.filter((key) => key !== from) } : step) }); }}
          onInsert={(from, to) => {
            if (!canEdit) return;
            const step = { ...newStep(draft.requiredSteps, '新步骤'), requires: [from] };
            commit({ ...draft, requiredSteps: [...explicitMethodSteps(draft.requiredSteps).map((item) => item.key === to ? { ...item, requires: item.requires!.map((key) => key === from ? step.key : key) } : item), step] });
            setSelectedKey(step.key); setPanelOpen(true);
          }}
          onLayout={(positions) => { if (canEdit) commit({ ...draft, requiredSteps: draft.requiredSteps.map((step) => ({ ...step, position: positions.get(step.key)! })) }); }}
          onPosition={(key, position) => { if (canEdit) commit({ ...draft, requiredSteps: draft.requiredSteps.map((step) => step.key === key ? { ...step, position } : step) }); }} />
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
                {executionRoles.map((role) => (
                  <option key={role.id} value={role.id}>{role.name}</option>
                ))}
              </select>
              <span className="hint">职业来自角色目录；服务会校验存在的职业。未指定职业会阻止保存（前端规则）。</span>
            </div>
            <div className="field"><label className="label" htmlFor="wfe-step-summary">这一步做什么</label><textarea id="wfe-step-summary" className="textarea" value={selectedStep.summary ?? ''} readOnly={!canEdit} onChange={(event) => { updateStep({ summary: event.target.value }); }} /></div>
            <div className="field"><label className="label" htmlFor="wfe-step-outputs">产出（每行一项，执行后才有实际产物）</label><textarea id="wfe-step-outputs" className="textarea" value={(selectedStep.outputs ?? []).map((item) => item.name).join('\n')} readOnly={!canEdit} onChange={(event) => { updateStep({ outputs: event.target.value.split('\n').filter(Boolean).map((name) => ({ name, kind: 'artifact' })) }); }} /></div>
            {selectedStep.kind === 'verify' ? <QualityReviewFields id="wfe-review" value={selectedStep.qualityReview} disabled={!canEdit} onChange={qualityReview => updateStep({ qualityReview })} /> : null}
            <div className="field"><label className="label" htmlFor="wfe-step-acceptance">验收标准（每行一项）</label><textarea id="wfe-step-acceptance" className="textarea" value={(selectedStep.acceptance ?? []).join('\n')} readOnly={!canEdit} onChange={(event) => { updateStep({ acceptance: event.target.value.split('\n').filter(Boolean) }); }} /></div>
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
                {explicitMethodSteps(draft.requiredSteps).filter((step) => step.requires!.includes(selectedStep.key)).map((next) => (
                  <span key={next.key} className="chip" style={{ justifyContent: 'flex-start' }}>
                    <Icon name="arrowRight" size="sm" />
                    {next.title}
                  </span>
                ))}
                {selectedIndex === draft.requiredSteps.length - 1 ? <span className="hint">这是最后一步；执行完成后到达「交付」。</span> : null}
              </div>
              <p className="hint" style={{ marginTop: 6 }}>
                连线就是实际前驱依赖；多个后继同时就绪，汇合节点等待所有前驱通过验收。
              </p>
              {canEdit ? (
                <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
                  <Button variant="secondary" size="sm" icon="plus" onClick={() => { insertStepAt(selectedIndex + 1); }}>
                    添加下一步
                  </Button>
                  <Button variant="ghost" size="sm" icon="split" onClick={parallel}>
                    添加并行步骤
                  </Button>
                  <select className="select" aria-label="连接目标步骤" value={connectTarget} onChange={(event) => { setConnectTarget(event.target.value); }}><option value="">连接到…</option>{draft.requiredSteps.filter((step) => step.key !== selectedStep.key).map((step) => <option key={step.key} value={step.key}>{step.title}</option>)}</select>
                  <Button variant="ghost" size="sm" icon="link" disabled={connectTarget === ''} disabledReason={connectTarget === '' ? '先选择目标步骤' : undefined} onClick={() => { connect(selectedStep.key, connectTarget); }}>添加连线</Button>

                </div>
              ) : null}
            </div>
            <div className="field"><label className="label" htmlFor="wfe-step-inputs">输入映射（每行一项）</label><textarea id="wfe-step-inputs" className="textarea" value={(selectedStep.inputs ?? []).map((item) => item.name).join('\n')} readOnly={!canEdit} onChange={(event) => { updateStep({ inputs: event.target.value.split('\n').filter(Boolean).map((name) => ({ name, source: 'manual' })) }); }} /></div>
            <div className="row wrap" style={{ gap: 8 }}><span className="hint">布局位置（可代替拖动）</span>{(['x', 'y'] as const).map((axis) => <label key={axis}>{axis}<input className="input" aria-label={`步骤位置 ${axis}`} type="number" readOnly={!canEdit} value={(selectedStep.position ?? workflowLayout(draft.requiredSteps).get(selectedStep.key))?.[axis] ?? 0} onChange={(event) => { if (Number.isFinite(event.target.valueAsNumber)) updateStep({ position: { ...(selectedStep.position ?? workflowLayout(draft.requiredSteps).get(selectedStep.key) ?? { x: 0, y: 0 }), [axis]: event.target.valueAsNumber } }); }} /></label>)}</div>
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
                  <span className="label">前驱步骤（全部完成并通过验收后才就绪）</span>
                  <div className="col" style={{ gap: 4, marginTop: 6 }}>
                    {draft.requiredSteps.filter((step) => step.key !== selectedStep.key).map((step) => {
                      const checked = (explicitMethodSteps(draft.requiredSteps).find((item) => item.key === selectedStep.key)?.requires ?? []).includes(step.key);
                      return (
                        <label key={step.key} className="check">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!canEdit}
                            onChange={(event) => {
                              const current = new Set(explicitMethodSteps(draft.requiredSteps).find((item) => item.key === selectedStep.key)?.requires ?? []);
                              if (event.target.checked) current.add(step.key);
                              else current.delete(step.key);
                              const next = draft.requiredSteps.map((item) => item.key === selectedStep.key ? { ...item, requires: [...current] } : item);
                              const issues = localProblems({ ...draft, requiredSteps: next }, roleIds);
                              if (issues.some((issue) => issue.code === 'METHOD_CYCLE')) setGraphError('依赖会形成环路，修改未应用');
                              else { commit({ ...draft, requiredSteps: next }); setGraphError(undefined); }
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

      <Drawer open={templatesOpen} title="添加步骤 · 来自服务流程目录" size="lg" onClose={() => { setTemplatesOpen(false); }}>
        <input className="input" aria-label="搜索步骤模板" value={templateSearch} onChange={(event) => { setTemplateSearch(event.target.value); }} />
        <p className="hint">将模板的职责、输入、产出及验收复制到所选步骤之后；不共享实例状态。</p>
        {(bootstrap.data?.catalog.methods ?? []).flatMap((method) => method.requiredSteps.map((template) => ({ template, method }))).filter(({ template }) => template.title.includes(templateSearch)).map(({ template, method }) => <div className="card pad" key={`${method.id}:${template.key}`}><b>{template.title}</b><p className="hint">{method.name} {method.revision} · {template.kind}</p><p>{template.summary ?? template.title}</p><Button variant="secondary" size="sm" disabled={!canEdit} disabledReason={!canEdit ? '当前流程不可修改' : undefined} onClick={() => {
          const step = { ...structuredClone(template), key: newStep(draft.requiredSteps, template.title).key, position: undefined };
          commit({ ...draft, requiredSteps: addWorkflowStep(draft.requiredSteps, step, selectedKey ?? undefined) }); setSelectedKey(step.key); setTemplatesOpen(false); setPanelOpen(true);
        }}>添加这一步</Button></div>)}
      </Drawer>
      <Modal open={diffOpen} title={`草稿与流程版本对照`} onClose={() => { setDiffOpen(false); }} footer={<Button variant="ghost" onClick={() => { setDiffOpen(false); }}>关闭</Button>}>
        <label className="label" htmlFor="wfe-diff-version">对照版本</label><select id="wfe-diff-version" className="select" value={comparisonVersion ?? detail.version} onChange={(event) => { setComparisonVersion(Number(event.target.value)); }}>{(versionsQuery.data ?? [detail]).map((version) => <option key={version.version} value={version.version}>{version.name} · 版本 {version.version}</option>)}</select>
        {versionsQuery.isError ? <p className="error-text">历史读取失败：{errorMessage(versionsQuery.error)}</p> : <p className="hint">只显示服务实际保存的版本；旧版缺失的历史不会补造。</p>}
        {comparison !== undefined && (comparison.name !== draft.name || comparison.description !== draft.description) ? <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify({ before: { name: comparison.name, description: comparison.description }, after: { name: draft.name, description: draft.description } }, null, 2)}</pre> : null}
        {differences.length === 0 ? <p>步骤与依赖没有变化。</p> : differences.map((difference) => <div className="card pad" key={difference.key}><Badge icon={difference.kind === 'added' ? 'plus' : difference.kind === 'removed' ? 'trash' : 'edit'}>{difference.kind === 'added' ? '新增' : difference.kind === 'removed' ? '删除' : '修改'}</Badge> {difference.title}<p className="hint">{difference.fields.join(' · ')}</p><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify({ before: comparisonSteps.find((item) => item.key === difference.key), after: draft.requiredSteps.find((item) => item.key === difference.key) }, null, 2)}</pre></div>)}
      </Modal>

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
        <p>“{selectedStep?.title ?? ''}”会从依赖图中移除，后继会接回这一步的所有前驱。删除只影响这份草稿，保存前都可以撤销。</p>
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
