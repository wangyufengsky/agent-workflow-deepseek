import { useState } from 'react';
import {
  ROUTES,
  createRequestKey,
  type CommandResponse,
  type OperationReceipt,
  type OperationsByKeyResponse,
  type TaskTemplate,
} from '@agent-workflow/shared';
import { ApiClientError, apiGet, errorMessage, request } from '../../api/client.ts';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Modal } from '../../components/Modal.tsx';

const STEP_KINDS = ['implementation', 'test', 'delivery'] as const;
type StepKind = (typeof STEP_KINDS)[number];

const STEP_KIND_LABELS: Readonly<Record<StepKind, string>> = {
  implementation: '实现（implementation）',
  test: '测试（test）',
  delivery: '交付（delivery）',
};

const DEFAULT_GROUP = '固定步骤';

type MutationPhase = 'idle' | 'saving' | 'failed' | 'unknown';

interface VisualStep {
  readonly key: string;
  readonly title: string;
  readonly kind: StepKind;
  readonly group: string;
}

export interface TemplateSaveResult {
  readonly templateId: string;
  readonly requestKey: string;
  readonly receiptStatus: string;
  readonly auditId?: string;
  readonly version?: number;
}

export interface TemplateArchiveResult {
  readonly templateId: string;
  readonly requestKey: string;
  readonly receiptStatus?: string;
  readonly auditId?: string;
  readonly verifiedBy: 'receipt' | 'catalog';
}

function narrowKind(kind: string): StepKind {
  return kind === 'test' || kind === 'delivery' ? kind : 'implementation';
}

function toVisualSteps(template: TaskTemplate): readonly VisualStep[] {
  return template.steps.map((step) => ({ key: step.key, title: step.title, kind: narrowKind(step.kind), group: step.group }));
}

function buildTemplate(template: TaskTemplate, name: string, steps: readonly VisualStep[]): TaskTemplate {
  return {
    ...template,
    name: name.trim(),
    version: template.version + 1,
    lockedAfterCreate: true,
    parameters: template.parameters,
    steps: steps.map((step) => ({
      key: step.key.trim(),
      title: step.title.trim(),
      kind: step.kind,
      group: step.group.trim().length === 0 ? DEFAULT_GROUP : step.group.trim(),
    })),
  };
}

function isUnknownFailure(error: unknown): boolean {
  return error instanceof ApiClientError && (error.kind === 'timeout' || error.kind === 'unavailable');
}

function moveStep(steps: readonly VisualStep[], from: number, to: number): readonly VisualStep[] {
  if (to < 0 || to >= steps.length) return steps;
  const next = [...steps];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return steps;
  next.splice(to, 0, moved);
  return next;
}

function nextStepKey(steps: readonly VisualStep[]): string {
  const used = new Set(steps.map((step) => step.key));
  let index = steps.length + 1;
  while (used.has(`step.custom.${String(index)}`)) index += 1;
  return `step.custom.${String(index)}`;
}

interface OperationBannerProps {
  readonly phase: MutationPhase;
  readonly message: string;
  readonly requestKey: string;
  readonly failureTitle: string;
  readonly unknownTitle: string;
  readonly reconcileLabel: string;
  readonly reconcileBusy: boolean;
  readonly onReconcile: () => void;
}

function OperationBanner({ phase, message, requestKey, failureTitle, unknownTitle, reconcileLabel, reconcileBusy, onReconcile }: OperationBannerProps) {
  if (phase === 'failed') {
    return (
      <div className="banner danger" role="alert" style={{ marginBottom: 16 }}>
        <Icon name="alert" />
        <div className="grow">
          <b>{failureTitle}</b>
          <br />
          {message}
        </div>
      </div>
    );
  }
  if (phase !== 'unknown') return null;
  return (
    <div className="banner unknown" role="alert" style={{ marginBottom: 16 }}>
      <Icon name="help" />
      <div className="grow">
        <b>{unknownTitle}</b>
        <br />
        {message}
        <div className="hint mono" style={{ marginTop: 4 }}>requestKey {requestKey}</div>
      </div>
      <div className="actions">
        <Button
          variant="secondary"
          size="sm"
          icon="refresh"
          disabled={reconcileBusy}
          disabledReason={reconcileBusy ? '正在按原请求核对' : undefined}
          onClick={onReconcile}
        >
          {reconcileBusy ? '核对中…' : reconcileLabel}
        </Button>
      </div>
    </div>
  );
}

/** Shared PATCH /api/catalog/templates/:id flow for both editors. */
function useTemplateSave(templateId: string, onSaved: (result: TemplateSaveResult) => void) {
  const [phase, setPhase] = useState<MutationPhase>('idle');
  const [message, setMessage] = useState('');
  const [requestKey, setRequestKey] = useState('');
  const [reconcileBusy, setReconcileBusy] = useState(false);

  const settle = (receipt: OperationReceipt, key: string, version?: number) => {
    if (receipt.status === 'succeeded') {
      onSaved({
        templateId,
        requestKey: key,
        receiptStatus: receipt.status,
        ...(receipt.auditId.length === 0 ? {} : { auditId: receipt.auditId }),
        ...(version === undefined ? {} : { version }),
      });
    } else if (receipt.status === 'failed') {
      setPhase('failed');
      setMessage(receipt.error?.message ?? '服务返回失败回执，模板没有更新。');
    } else {
      setPhase('unknown');
      setMessage('保存请求已受理，但服务尚未确认结果；参数已锁定，不会自动重复保存。');
    }
  };

  const save = async (template: TaskTemplate) => {
    const key = createRequestKey();
    setRequestKey(key);
    setPhase('saving');
    setMessage('');
    try {
      const response = await request<CommandResponse<readonly TaskTemplate[]>>(ROUTES.catalogTemplateUpdate(templateId), {
        method: 'PATCH',
        body: { requestKey: key, template, confirmUpdate: true },
      });
      settle(response.data.receipt, key, template.version);
    } catch (error) {
      setPhase(isUnknownFailure(error) ? 'unknown' : 'failed');
      setMessage(errorMessage(error));
    }
  };

  const reconcile = async () => {
    if (requestKey.length === 0) return;
    setReconcileBusy(true);
    try {
      const response = await apiGet<OperationsByKeyResponse>(ROUTES.operationsByKey(requestKey));
      const operation = response.data.operation;
      if (operation.status === 'succeeded') {
        const outcome = operation.outcome ?? {};
        const version = typeof outcome.version === 'number' ? outcome.version : undefined;
        onSaved({
          templateId,
          requestKey,
          receiptStatus: operation.status,
          ...(operation.auditId.length === 0 ? {} : { auditId: operation.auditId }),
          ...(version === undefined ? {} : { version }),
        });
      } else if (operation.status === 'failed') {
        setPhase('failed');
        setMessage(operation.error?.message ?? '按原请求核对：模板更新失败。');
      } else {
        setPhase('unknown');
        setMessage('核对后仍未确认结果；不会自动重复保存。');
      }
    } catch (error) {
      setPhase('unknown');
      setMessage(`核对失败：${errorMessage(error)}`);
    } finally {
      setReconcileBusy(false);
    }
  };

  return { phase, message, requestKey, reconcileBusy, save, reconcile };
}

export function VisualTemplateEditor({ template, onClose, onSaved }: {
  readonly template: TaskTemplate;
  readonly onClose: () => void;
  readonly onSaved: (result: TemplateSaveResult) => void;
}) {
  const { phase, message, requestKey, reconcileBusy, save, reconcile } = useTemplateSave(template.id, onSaved);
  const [name, setName] = useState(template.name);
  const [steps, setSteps] = useState<readonly VisualStep[]>(() => toVisualSteps(template));
  const busy = phase === 'saving';
  const unknown = phase === 'unknown';

  const patchStep = (index: number, patch: Partial<VisualStep>) => {
    setSteps((current) => current.map((step, position) => (position === index ? { ...step, ...patch } : step)));
  };

  const addStep = () => {
    setSteps((current) => {
      if (current.length >= 30) return current;
      const previous = current[current.length - 1];
      return [
        ...current,
        {
          key: nextStepKey(current),
          title: `新步骤 ${String(current.length + 1)}`,
          kind: 'implementation',
          group: previous?.group ?? DEFAULT_GROUP,
        },
      ];
    });
  };

  const blockReason =
    unknown
      ? '保存结果未明，请先按原请求核对；不会自动重发'
      : busy
        ? '保存请求处理中'
        : name.trim().length === 0
          ? '模板名称不能为空'
          : steps.length === 0
            ? '模板至少需要 1 个步骤'
            : steps.some((step) => step.title.trim().length === 0)
              ? '每个步骤都需要标题'
              : undefined;

  return (
    <Modal
      open
      title="可视化编辑模板"
      onClose={() => {
        if (!busy && !reconcileBusy) onClose();
      }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy || reconcileBusy} disabledReason="保存请求处理中">
            取消
          </Button>
          <span className="spacer" />
          <Button
            variant="primary"
            icon="check"
            disabled={blockReason !== undefined}
            disabledReason={blockReason}
            onClick={() => {
              if (blockReason === undefined) void save(buildTemplate(template, name, steps));
            }}
          >
            {busy ? '保存中…' : `保存为版本 ${String(template.version + 1)}`}
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 16, maxHeight: 'calc(100vh - 240px)', overflowY: 'auto', paddingRight: 4 }}>
        <OperationBanner
          phase={phase}
          message={message}
          requestKey={requestKey}
          failureTitle="保存失败，模板没有更新"
          unknownTitle="保存结果未明"
          reconcileLabel="按原请求核对"
          reconcileBusy={reconcileBusy}
          onReconcile={() => void reconcile()}
        />

        <div className="field" style={{ margin: 0 }}>
          <label className="label" htmlFor="tpl-editor-name">
            模板名称
          </label>
          <input
            id="tpl-editor-name"
            className="input"
            value={name}
            maxLength={120}
            disabled={busy}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
          <span className="hint">保存会写入版本 {String(template.version + 1)}（服务端要求版本号递增）。</span>
        </div>

        <div>
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <span className="label grow">步骤 · {String(steps.length)} / 30</span>
            <Button
              variant="secondary"
              size="sm"
              icon="plus"
              disabled={steps.length >= 30 || busy}
              disabledReason={steps.length >= 30 ? '最多 30 个步骤' : '保存请求处理中'}
              onClick={addStep}
            >
              新增步骤
            </Button>
          </div>

          <div className="col" style={{ gap: 10 }}>
            {steps.map((step, index) => (
              <div
                key={step.key}
                className="col"
                style={{ gap: 8, padding: 10, border: '1px solid var(--line)', borderRadius: 10, background: 'var(--fill-2)' }}
              >
                <div className="row" style={{ gap: 8 }}>
                  <span className="num muted">{String(index + 1)}</span>
                  <div className="grow">
                    <input
                      className="input"
                      aria-label={`第 ${String(index + 1)} 步标题`}
                      value={step.title}
                      maxLength={120}
                      disabled={busy}
                      placeholder="步骤标题"
                      onChange={(event) => {
                        patchStep(index, { title: event.target.value });
                      }}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="trash"
                    aria-label={`删除第 ${String(index + 1)} 步`}
                    title="删除步骤"
                    disabled={steps.length <= 1 || busy}
                    disabledReason={steps.length <= 1 ? '模板至少需要保留 1 个步骤' : '保存请求处理中'}
                    onClick={() => {
                      setSteps((current) => (current.length <= 1 ? current : current.filter((_, position) => position !== index)));
                    }}
                  />
                </div>

                <div className="row" style={{ gap: 8 }}>
                  <div className="grow">
                    <select
                      className="select"
                      aria-label={`第 ${String(index + 1)} 步类型`}
                      value={step.kind}
                      disabled={busy}
                      onChange={(event) => {
                        patchStep(index, { kind: narrowKind(event.target.value) });
                      }}
                    >
                      {STEP_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {STEP_KIND_LABELS[kind]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grow">
                    <input
                      className="input"
                      aria-label={`第 ${String(index + 1)} 步分组`}
                      value={step.group}
                      maxLength={60}
                      disabled={busy}
                      placeholder="分组"
                      onChange={(event) => {
                        patchStep(index, { group: event.target.value });
                      }}
                    />
                  </div>
                </div>

                <div className="row" style={{ gap: 6 }}>
                  <span className="hint mono grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {step.key}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="arrowUp"
                    title="上移"
                    disabled={index === 0 || busy}
                    disabledReason={index === 0 ? '已经是第一步' : '保存请求处理中'}
                    onClick={() => {
                      setSteps((current) => moveStep(current, index, index - 1));
                    }}
                  >
                    上移
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="chevDown"
                    title="下移"
                    disabled={index === steps.length - 1 || busy}
                    disabledReason={index === steps.length - 1 ? '已经是最后一步' : '保存请求处理中'}
                    onClick={() => {
                      setSteps((current) => moveStep(current, index, index + 1));
                    }}
                  >
                    下移
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="hint" style={{ margin: 0 }}>
          这里只编辑名称与步骤；{String(template.parameters.length)} 个模板参数保持不变。保存成功后刷新目录并关闭。
        </p>
      </div>
    </Modal>
  );
}

export function JsonTemplateEditor({ template, onClose, onSaved }: {
  readonly template: TaskTemplate;
  readonly onClose: () => void;
  readonly onSaved: (result: TemplateSaveResult) => void;
}) {
  const { phase, message, requestKey, reconcileBusy, save, reconcile } = useTemplateSave(template.id, onSaved);
  const [text, setText] = useState(() => JSON.stringify({ ...template, version: template.version + 1 }, null, 2));
  const [parseError, setParseError] = useState('');
  const busy = phase === 'saving';
  const unknown = phase === 'unknown';

  const submit = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch (error) {
      setParseError(`JSON 解析失败：${errorMessage(error)}`);
      return;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setParseError('JSON 顶层必须是一个模板对象。');
      return;
    }
    setParseError('');
    void save(parsed as TaskTemplate);
  };

  const blockReason = unknown
    ? '保存结果未明，请先按原请求核对；不会自动重发'
    : busy
      ? '保存请求处理中'
      : undefined;

  return (
    <Modal
      open
      title="编辑模板 JSON"
      onClose={() => {
        if (!busy && !reconcileBusy) onClose();
      }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy || reconcileBusy} disabledReason="保存请求处理中">
            取消
          </Button>
          <span className="spacer" />
          <Button variant="primary" icon="check" disabled={blockReason !== undefined} disabledReason={blockReason} onClick={submit}>
            {busy ? '保存中…' : `保存为版本 ${String(template.version + 1)}`}
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 16, maxHeight: 'calc(100vh - 240px)', overflowY: 'auto', paddingRight: 4 }}>
        <OperationBanner
          phase={phase}
          message={message}
          requestKey={requestKey}
          failureTitle="保存失败，模板没有更新"
          unknownTitle="保存结果未明"
          reconcileLabel="按原请求核对"
          reconcileBusy={reconcileBusy}
          onReconcile={() => void reconcile()}
        />

        <div>
          <label className="label" htmlFor="tpl-editor-json">
            完整模板 JSON
          </label>
          <textarea
            id="tpl-editor-json"
            className="textarea mono"
            value={text}
            spellCheck={false}
            readOnly={busy}
            style={{ minHeight: 340, fontFamily: 'var(--mono, monospace)', fontSize: 12.5 }}
            onChange={(event) => {
              setText(event.target.value);
              if (parseError.length > 0) setParseError('');
            }}
          />
          <span className="hint">
            版本号必须大于当前版本 {String(template.version)}；保存前会在 Modal 内校验 JSON 解析。
          </span>
        </div>

        {parseError.length > 0 ? (
          <div className="banner danger" role="alert">
            <Icon name="alert" />
            <div className="grow">{parseError}</div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

export function ArchiveTemplateDialog({ template, onClose, onArchived, verifyArchived }: {
  readonly template: TaskTemplate;
  readonly onClose: () => void;
  readonly onArchived: (result: TemplateArchiveResult) => void;
  readonly verifyArchived: (templateId: string) => Promise<boolean>;
}) {
  const [phase, setPhase] = useState<'idle' | 'archiving' | 'verifying' | 'failed' | 'unknown'>('idle');
  const [message, setMessage] = useState('');
  const [requestKey, setRequestKey] = useState('');
  const busy = phase === 'archiving' || phase === 'verifying';

  const finish = (result: TemplateArchiveResult) => {
    onArchived(result);
  };

  const archive = async () => {
    const key = createRequestKey();
    setRequestKey(key);
    setPhase('archiving');
    setMessage('');
    try {
      // The archive route currently returns the remaining template list instead of a
      // CommandResponse; accept either shape and never invent a receipt.
      const response = await request<{ readonly templates?: readonly TaskTemplate[]; readonly receipt?: OperationReceipt }>(
        ROUTES.catalogTemplateArchive(template.id),
        { method: 'DELETE', body: { requestKey: key, confirmArchive: true } },
      );
      const receipt = response.data.receipt;
      if (receipt !== undefined) {
        if (receipt.status === 'succeeded') {
          finish({
            templateId: template.id,
            requestKey: key,
            receiptStatus: receipt.status,
            ...(receipt.auditId.length === 0 ? {} : { auditId: receipt.auditId }),
            verifiedBy: 'receipt',
          });
        } else if (receipt.status === 'failed') {
          setPhase('failed');
          setMessage(receipt.error?.message ?? '服务返回失败回执，模板没有归档。');
        } else {
          setPhase('unknown');
          setMessage('归档请求已受理，但服务尚未确认结果；不会自动重复归档。');
        }
        return;
      }
      const templates = response.data.templates;
      if (templates === undefined) {
        setPhase('unknown');
        setMessage('服务既没有返回回执也没有返回模板列表，无法确认归档结果；不会自动重复归档。');
        return;
      }
      if (templates.some((item) => item.id === template.id)) {
        setPhase('failed');
        setMessage('服务返回的模板目录里仍有这个模板，归档未生效。');
        return;
      }
      finish({ templateId: template.id, requestKey: key, verifiedBy: 'catalog' });
    } catch (error) {
      setPhase(isUnknownFailure(error) ? 'unknown' : 'failed');
      setMessage(errorMessage(error));
    }
  };

  const verify = async () => {
    setPhase('verifying');
    try {
      const gone = await verifyArchived(template.id);
      if (gone) {
        finish({ templateId: template.id, requestKey, verifiedBy: 'catalog' });
      } else {
        setPhase('failed');
        setMessage('刷新目录后这个模板仍在列表里，归档未生效。');
      }
    } catch (error) {
      setPhase('unknown');
      setMessage(`核对失败：${errorMessage(error)}`);
    }
  };

  return (
    <Modal
      open
      title="归档自定义模板"
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy} disabledReason="归档请求处理中">
            取消
          </Button>
          <span className="spacer" />
          <Button
            variant="danger"
            icon="archive"
            disabled={busy || phase === 'unknown'}
            disabledReason={
              phase === 'unknown'
                ? '结果未明，请先刷新目录核对；不会自动重发'
                : phase === 'verifying'
                  ? '正在刷新模板目录核对'
                  : '归档请求处理中'
            }
            onClick={() => void archive()}
          >
            {phase === 'archiving' ? '归档中…' : '确认归档'}
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 16 }}>
        <div className="banner warn" role="alert">
          <Icon name="alert" />
          <div className="grow">
            <b>归档会从自定义模板目录移除「{template.name}」（版本 {String(template.version)}）。</b>
            <br />
            已创建的任务与历史任务不受影响；模板目录里不再可选，且不会自动恢复。
          </div>
        </div>

        {phase === 'failed' ? (
          <div className="banner danger" role="alert">
            <Icon name="alert" />
            <div className="grow">
              <b>归档失败，模板仍在目录中</b>
              <br />
              {message}
            </div>
          </div>
        ) : null}

        {phase === 'unknown' || phase === 'verifying' ? (
          <div className="banner unknown" role="alert">
            <Icon name="help" />
            <div className="grow">
              <b>归档结果未明</b>
              <br />
              {message}
              <div className="hint mono" style={{ marginTop: 4 }}>requestKey {requestKey}</div>
            </div>
            <div className="actions">
              <Button
                variant="secondary"
                size="sm"
                icon="refresh"
                disabled={busy}
                disabledReason={busy ? '正在刷新模板目录' : undefined}
                onClick={() => void verify()}
              >
                {phase === 'verifying' ? '核对中…' : '刷新目录核对'}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="hint mono">templateId {template.id}</div>
      </div>
    </Modal>
  );
}
