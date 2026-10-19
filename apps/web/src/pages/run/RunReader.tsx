import { ArtifactDetailView } from '../node/ArtifactDetailView.tsx';
import { useQuery } from '@tanstack/react-query';
import {
  NODE_STATUS_LABEL,
  ROUTES,
  type DiffPage,
  type ExecutionView,
  type FileChange,
  type NodeStatusValue,
  type PlanNode,
  type PlanRevision,
  type Task,
  type TaskChanges,
} from '@agent-workflow/shared';
import { apiGet, errorMessage } from '../../api/client.ts';
import { useNodeDetail } from '../../api/workflow.ts';
import { formatAbsoluteTime } from '../../app/format.ts';
import { Badge } from '../../components/Badge.tsx';
import { EmptyState, Skeleton } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import {
  CHANGE_STATUS_LABEL,
  CHANGE_STATUS_TONE,
  FRAGMENT_CATEGORY_LABEL,
  NODE_KIND_LABEL,
  NODE_STATUS_TONE,
  type RunSelection,
} from './run-shared.tsx';

const REQUIREMENT_KIND_LABEL = {
  requirement: '需求',
  constraint: '约束',
  acceptance: '验收',
} as const;

export interface RunReaderProps {
  readonly taskId: string;
  readonly task: Task;
  readonly plan: PlanRevision | undefined;
  readonly execution: ExecutionView | undefined;
  readonly changes: TaskChanges | undefined;
  readonly changesError: unknown;
  readonly selection: RunSelection;
  readonly onSelectNode: (nodeId: string) => void;
}

function nodeStatus(execution: ExecutionView | undefined, nodeId: string): NodeStatusValue {
  const state = execution?.nodes.find((item) => item.nodeId === nodeId);
  return state === undefined ? 'pending' : state.status;
}

function NodeLink({ nodeId, plan, execution, onSelectNode }: {
  readonly nodeId: string;
  readonly plan: PlanRevision | undefined;
  readonly execution: ExecutionView | undefined;
  readonly onSelectNode: (nodeId: string) => void;
}) {
  const node = plan?.graph.nodes.find((item) => item.id === nodeId);
  const status = nodeStatus(execution, nodeId);
  return (
    <button
      type="button"
      className="list-row run-node-link"
      onClick={() => {
        onSelectNode(nodeId);
      }}
    >
      <span className="tile">
        <Icon name="layers" size="sm" />
      </span>
      <span className="grow" style={{ minWidth: 0, textAlign: 'left' }}>
        <span style={{ display: 'block', fontSize: 13 }}>{node?.title ?? nodeId}</span>
        <span className="hint mono" style={{ display: 'block', marginTop: 2 }}>
          {nodeId}
        </span>
      </span>
      <Badge tone={NODE_STATUS_TONE[status]}>{NODE_STATUS_LABEL[status]}</Badge>
      <Icon name="chevRight" size="sm" />
    </button>
  );
}

function CoveragePane({ task, plan, execution, requirementId, onSelectNode }: {
  readonly task: Task;
  readonly plan: PlanRevision | undefined;
  readonly execution: ExecutionView | undefined;
  readonly requirementId: string;
  readonly onSelectNode: (nodeId: string) => void;
}) {
  const entry = task.requirement.entries.find((item) => item.id === requirementId);
  const coverage = plan?.validation?.requirementCoverage.find((item) => item.requirementId === requirementId);
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <Badge tone="accent" icon="target">
          需求覆盖
        </Badge>
        {entry === undefined ? null : <Badge tone="neutral">{REQUIREMENT_KIND_LABEL[entry.kind]}</Badge>}
        {coverage === undefined ? (
          <Badge tone="unknown" icon="help">
            服务未返回覆盖结论
          </Badge>
        ) : (
          <Badge tone={coverage.covered ? 'ok' : 'fail'} icon={coverage.covered ? 'check' : 'alert'}>
            {coverage.covered ? '已覆盖' : '未覆盖'}
          </Badge>
        )}
      </div>

      <div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          需求正文
        </div>
        <p className="run-doc-text">{entry?.text ?? coverage?.label ?? '服务未返回这条需求的正文条目。'}</p>
      </div>

      {coverage === undefined ? (
        <div className="banner warn">
          <Icon name="help" />
          <div className="grow">
            计划没有返回这条需求的 <span className="mono">requirementCoverage</span> 结论（可能尚未校验或规划未完成）。
            页面不推测覆盖与否，也不补造覆盖节点。
          </div>
        </div>
      ) : (
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            覆盖节点 · {coverage.nodeIds.length}
          </div>
          {coverage.nodeIds.length === 0 ? (
            <p className="hint">计划没有把任何节点绑定到这条需求。</p>
          ) : (
            <div className="list">
              {coverage.nodeIds.map((nodeId) => (
                <NodeLink key={nodeId} nodeId={nodeId} plan={plan} execution={execution} onSelectNode={onSelectNode} />
              ))}
            </div>
          )}
        </div>
      )}
      <p className="hint">覆盖结论与节点绑定都来自当前计划修订的校验结果；本页不再做覆盖推断。</p>
    </div>
  );
}

function NodePane({ taskId, plan, execution, nodeId }: {
  readonly taskId: string;
  readonly plan: PlanRevision | undefined;
  readonly execution: ExecutionView | undefined;
  readonly nodeId: string;
}) {
  const node: PlanNode | undefined = plan?.graph.nodes.find((item) => item.id === nodeId);
  const executionState = execution?.nodes.find((item) => item.nodeId === nodeId);
  const detailQuery = useNodeDetail(taskId, nodeId);
  const detail = detailQuery.data;
  const status = executionState?.status ?? 'pending';

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <Badge tone="accent" icon="layers">
          {node === undefined ? '步骤节点' : NODE_KIND_LABEL[node.kind]}
        </Badge>
        <Badge tone={NODE_STATUS_TONE[status]} icon={status === 'succeeded' ? 'check' : status === 'failed' ? 'alert' : 'clock'}>
          {NODE_STATUS_LABEL[status]}
        </Badge>
        {executionState === undefined ? <Badge tone="idle">此任务没有执行记录</Badge> : null}
      </div>

      <div>
        <h3 style={{ fontSize: 18, fontWeight: 500 }}>{node?.title ?? '节点'}</h3>
        <p className="run-doc-text" style={{ marginTop: 8 }}>
          {node?.summary ?? '服务没有返回节点摘要。'}
        </p>
        <div className="hint mono" style={{ marginTop: 6, wordBreak: 'break-all' }}>
          {nodeId}
        </div>
      </div>

      <div className="run-facts">
        <span>
          分组：{node?.groupId ?? '—'}
          {detail?.group === undefined ? '' : `（${detail.group.label}）`}
        </span>
        <span>角色：{node?.roleId ?? '未绑定'}</span>
        <span>输入：{node?.inputs.length ?? 0}</span>
        <span>输出：{node?.outputs.length ?? 0}</span>
        {executionState === undefined ? null : <span>尝试次数：{executionState.attemptCount}</span>}
        {executionState?.error === undefined ? null : (
          <span className="error-text">
            执行错误：{executionState.error.message}
          </span>
        )}
      </div>

      {node !== undefined && node.acceptance.length > 0 ? (
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            验收条件
          </div>
          <ul className="run-list">
            {node.acceptance.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {detailQuery.isLoading ? (
        <div className="col" style={{ gap: 8 }}>
          <Skeleton height={14} width="42%" />
          <Skeleton height={80} width="100%" radius={12} />
        </div>
      ) : detailQuery.isError ? (
        <ServiceNotice
          error={detailQuery.error}
          onRetry={() => {
            void detailQuery.refetch();
          }}
          title="读取节点详情失败"
        />
      ) : detail === undefined ? null : (
        <>
          {detail.attempts.length > 0 ? (
            <div>
              <div className="eyebrow" style={{ marginBottom: 8 }}>
                尝试 · {detail.attempts.length}
              </div>
              <div className="col" style={{ gap: 8 }}>
                {detail.attempts.slice(0, 5).map((attempt) => (
                  <div key={attempt.id} className="run-attempt">
                    <div className="row wrap" style={{ gap: 8 }}>
                      <Badge tone={NODE_STATUS_TONE[attempt.status]}>第 {attempt.ordinal} 次 · {NODE_STATUS_LABEL[attempt.status]}</Badge>
                      {attempt.startedAt === undefined ? null : <span className="hint">{formatAbsoluteTime(attempt.startedAt)}</span>}
                      {attempt.usage === undefined ? null : <span className="hint num">{String(attempt.usage.total)} tokens</span>}
                    </div>
                    {attempt.result?.summary === undefined ? null : <p className="run-doc-text" style={{ marginTop: 6 }}>{attempt.result.summary}</p>}
                    {attempt.result?.verification === undefined ? null : (
                      <div className="hint" style={{ marginTop: 4 }}>
                        验证：{attempt.result.verification.state}
                        {attempt.result.verification.passed === undefined ? '' : ` · 通过 ${String(attempt.result.verification.passed)}`}
                        {attempt.result.verification.failed === undefined ? '' : ` / 失败 ${String(attempt.result.verification.failed)}`}
                        {attempt.result.verification.summary === undefined ? '' : ` · ${attempt.result.verification.summary}`}
                      </div>
                    )}
                    {attempt.result === undefined || attempt.result.errors.length === 0 ? null : (
                      <div className="error-text" style={{ marginTop: 4 }}>
                        {attempt.result.errors.map((error) => `${error.code}: ${error.message}`).join('；')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {detail.attempts.length > 5 ? <p className="hint">这里只展示最近5次尝试，完整尝试列表可在节点详情中查看。</p> : null}
            </div>
          ) : (
            <p className="hint">该节点还没有执行尝试。</p>
          )}

          <div><h3>文件产物</h3>{detail.attempts.some((attempt) => (attempt.result?.artifacts.length ?? 0) > 0) ? detail.attempts.map((attempt) => attempt.result?.artifacts.map((artifact) => <details key={artifact.id}><summary>{artifact.name} · 第{attempt.ordinal}次尝试</summary><ArtifactDetailView taskId={taskId} artifact={artifact} attemptLabel={`第${attempt.ordinal}次尝试`} /></details>)) : <p className="hint">尚未提交文件产物。</p>}</div>
          <div>
            <div className="row" style={{ gap: 8, marginBottom: 8 }}>
              <span className="eyebrow">输出片段</span>
              <span className="hint num">{detail.output.fragments.length}</span>
              <span className="spacer" />
              {detail.output.nextSeq > 0 ? <span className="hint">服务返回的片段水位：{String(detail.output.nextSeq)}</span> : null}
            </div>
            {detail.output.fragments.length === 0 ? (
              <EmptyState icon="terminal" title="没有输出片段" description="该节点没有产出正文、推理摘要或工具记录；这是服务的真实结果。" compact />
            ) : (
              <div className="run-fragments">
                {detail.output.fragments.map((fragment) => (
                  <div className="run-fragment" key={fragment.fragmentId}>
                    <div className="run-frag-head">
                      <Badge tone={fragment.category === 'tool_activity' ? 'accent' : fragment.category === 'service_event' ? 'idle' : 'neutral'}>
                        {FRAGMENT_CATEGORY_LABEL[fragment.category]}
                      </Badge>
                      {fragment.recordedAt === undefined ? null : <span className="hint">{formatAbsoluteTime(fragment.recordedAt)}</span>}
                      {fragment.toolCallRef === undefined ? null : (
                        <span className="hint mono">
                          {fragment.toolCallRef.callId} · {fragment.toolCallRef.status}
                        </span>
                      )}
                      {fragment.eventKind === undefined ? null : <span className="hint mono">{fragment.eventKind}</span>}
                    </div>
                    {fragment.text === undefined || fragment.text === '' ? null : (
                      <p className="run-frag-text">{fragment.text}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
            <p className="hint" style={{ marginTop: 8 }}>
              输出来自节点只读接口返回的一页片段；完整运行日志/报告没有专用阅读接口，本页不伪造缺失片段。
            </p>
          </div>

          {detail.requirementLinks.length > 0 ? (
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>
                关联需求
              </div>
              <div className="col" style={{ gap: 6 }}>
                {detail.requirementLinks.map((link) => (
                  <p key={link.entryId} className="hint" style={{ margin: 0 }}>
                    {link.label}：{link.text}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function DiffLines({ diff }: { readonly diff: DiffPage }) {
  if (diff.hunks.length === 0) {
    return <p className="hint">服务返回的 diff 没有 hunk（可能是空变更或仅元数据变更）。</p>;
  }
  return (
    <div className="run-diff">
      {diff.hunks.map((hunk) => (
        <div className="run-hunk" key={hunk.hunkId}>
          <div className="run-hunk-head mono">
            {hunk.header}
            {hunk.section === undefined ? '' : ` · ${hunk.section}`}
          </div>
          {hunk.lines.map((line) => (
            <div className={`run-line run-line-${line.kind}`} key={line.anchorId}>
              <span className="run-ln mono">{line.oldLine ?? ''}</span>
              <span className="run-ln mono">{line.newLine ?? ''}</span>
              <span className="run-code mono">{line.text === '' ? ' ' : line.text}</span>
            </div>
          ))}
        </div>
      ))}
      {diff.truncated === undefined ? null : (
        <p className="hint">
          diff 被服务截断（{diff.truncated.reason}，已显示 {String(diff.truncated.shownLines)} 行）；本页不自动继续拉取。
        </p>
      )}
    </div>
  );
}

function FilePane({ taskId, file }: { readonly taskId: string; readonly file: FileChange }) {
  const diffQuery = useQuery({
    queryKey: ['run', 'diff', taskId, file.fileId],
    queryFn: async () => (await apiGet<{ diff: DiffPage }>(ROUTES.changesDiff(taskId, file.fileId))).data.diff,
    enabled: !file.binary && file.sizeClass !== 'too_large',
    retry: false,
  });

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <Badge tone="accent" icon="file">
          变更文件
        </Badge>
        <Badge tone={CHANGE_STATUS_TONE[file.status]}>{CHANGE_STATUS_LABEL[file.status]}</Badge>
        {file.binary ? <Badge tone="idle">二进制</Badge> : null}
        {file.sizeClass === 'too_large' ? <Badge tone="warn">文件过大</Badge> : null}
      </div>
      <div>
        <h3 style={{ fontSize: 17, fontWeight: 500, wordBreak: 'break-all' }}>{file.path}</h3>
        {file.oldPath === undefined ? null : <div className="hint mono">原路径：{file.oldPath}</div>}
        <div className="run-facts" style={{ marginTop: 8 }}>
          <span>新增行：{file.additions ?? '—'}</span>
          <span>删除行：{file.deletions ?? '—'}</span>
          <span>版本引用：<span className="mono">{file.versionRef}</span></span>
          {file.findingCount === undefined ? null : <span>审查问题：{String(file.findingCount)}</span>}
        </div>
      </div>

      {file.binary ? (
        <div className="banner info">
          <Icon name="info" />
          <div className="grow">二进制文件不提供文本 diff；页面不渲染占位内容。</div>
        </div>
      ) : file.sizeClass === 'too_large' ? (
        <div className="banner warn">
          <Icon name="alert" />
          <div className="grow">文件过大，服务不提供 diff；请到 Git 工作台或本地查看。</div>
        </div>
      ) : diffQuery.isLoading ? (
        <div className="col" style={{ gap: 8 }}>
          <Skeleton height={18} width="60%" />
          <Skeleton height={160} width="100%" radius={12} />
        </div>
      ) : diffQuery.isError ? (
        <ServiceNotice error={diffQuery.error} onRetry={() => { void diffQuery.refetch(); }} title="读取文件 diff 失败" />
      ) : diffQuery.data === undefined ? null : (
        <>
          <div className="run-facts">
            <span>基线：{diffQuery.data.baseSha ?? '—'}</span>
            <span>末端：{diffQuery.data.headSha ?? '—'}</span>
            <span>工作区修订：{diffQuery.data.worktreeRevision ?? '—'}</span>
          </div>
          <DiffLines diff={diffQuery.data} />
        </>
      )}
      <p className="hint">diff 来自变更只读接口（复用现有 diff 读取），不会修改工作区。</p>
    </div>
  );
}

export function RunReader({ taskId, task, plan, execution, changes, changesError, selection, onSelectNode }: RunReaderProps) {
  if (selection.kind === 'coverage') {
    return (
      <CoveragePane
        task={task}
        plan={plan}
        execution={execution}
        requirementId={selection.requirementId}
        onSelectNode={onSelectNode}
      />
    );
  }
  if (selection.kind === 'node') {
    return <NodePane taskId={taskId} plan={plan} execution={execution} nodeId={selection.nodeId} />;
  }
  const file = changes?.files.find((item) => item.fileId === selection.fileId);
  if (file === undefined) {
    return (
      <div className="banner warn">
        <Icon name="alert" />
        <div className="grow">
          选中的变更文件不在当前变更列表中（可能已刷新或被排除）。
          {changesError === undefined ? '' : `变更读取失败：${errorMessage(changesError)}`}
        </div>
      </div>
    );
  }
  return <FilePane taskId={taskId} file={file} />;
}
