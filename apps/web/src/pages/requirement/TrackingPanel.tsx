import { NODE_STATUS_LABEL, type ExecutionView, type PlanRevision } from '@agent-workflow/shared';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { PanelEmpty, Section } from './requirement-ui.tsx';

export interface TrackingPanelProps {
  readonly plan?: PlanRevision;
  readonly execution?: ExecutionView;
  readonly readOnlyReason?: string;
  readonly onOpenTask: () => void;
  readonly onOpenNode: (nodeId: string) => void;
}

/** B08 read-only tracking after execution starts; evidence lives on the execution side. */
export function TrackingPanel({ plan, execution, readOnlyReason, onOpenTask, onOpenNode }: TrackingPanelProps) {
  if (readOnlyReason !== undefined) {
    return <PanelEmpty icon="lock" title="只读验证已有产物" description={readOnlyReason} action={<Button size="sm" icon="panel" onClick={onOpenTask}>查看验证任务</Button>} />;
  }
  if (execution === undefined) {
    return <PanelEmpty icon="play" title="执行尚未创建" description="确认计划并准备工作区后，执行侧才会产生可追踪的步骤与结果。" action={<Button size="sm" icon="panel" onClick={onOpenTask}>打开任务画布</Button>} />;
  }
  const coverage = plan?.validation?.requirementCoverage ?? [];
  const statusByNode = new Map(execution.nodes.map((node) => [node.nodeId, node]));
  const nodeTitle = new Map((plan?.graph.nodes ?? []).map((node) => [node.id, node.title]));

  return (
    <div>
      <div className="banner info" style={{ marginBottom: 12 }}>
        <Icon name="lock" />
        <div className="grow">
          <b>执行已开始，规划与需求追踪只读。</b>
          <br />
          工作包、尝试与产出归执行侧；点“查看工作包”进入节点执行现场。这里只取当前有效计划与真实执行状态，不预造产物。
        </div>
        <div className="actions">
          <Button size="sm" variant="secondary" icon="panel" onClick={onOpenTask}>
            打开任务画布
          </Button>
        </div>
      </div>

      <Section
        title="执行进度"
        aside={
          <span className="hint">
            {execution.progress.done} / {execution.progress.total} 步完成
            {execution.progress.running > 0 ? ` · ${execution.progress.running} 步执行中` : ''}
            {execution.progress.failed > 0 ? ` · ${execution.progress.failed} 步失败` : ''}
          </span>
        }
      >
        <div className="progress-line">
          <span className={`badge ${execution.status === 'failed' ? 'st-fail' : execution.status === 'unknown' ? 'st-unknown' : execution.status === 'running' ? 'st-run' : 'st-done'}`}>{execution.status}</span>
          <span className="grow">以服务执行视图为准，不显示百分比与剩余时间。</span>
        </div>
      </Section>

      <Section title="需求 → 验收 → 步骤" aside={<span className="hint">只读追踪</span>}>
        {coverage.length === 0 ? (
          <p className="hint">服务未返回需求覆盖表；没有覆盖表时不推断覆盖关系。</p>
        ) : (
          <table className="cov">
            <thead>
              <tr>
                <th>需求 / 方法步骤</th>
                <th>覆盖</th>
                <th>步骤 · 执行状态</th>
                <th>证据</th>
              </tr>
            </thead>
            <tbody>
              {coverage.map((row) => (
                <tr key={row.requirementId}>
                  <td>
                    <span className="mono">{row.requirementId}</span>
                    <br />
                    {row.label}
                  </td>
                  <td>
                    <Badge tone={row.covered ? 'ok' : 'unknown'} icon={row.covered ? 'check' : 'alert'}>
                      {row.covered ? '已覆盖' : '未覆盖'}
                    </Badge>
                  </td>
                  <td>
                    {row.nodeIds.length === 0 ? (
                      '—'
                    ) : (
                      row.nodeIds.map((nodeId) => {
                        const state = statusByNode.get(nodeId);
                        return (
                          <div key={nodeId} style={{ marginBottom: 3 }}>
                            {nodeTitle.get(nodeId) ?? nodeId.slice(0, 12)} ·{' '}
                            <Badge tone={state?.status === 'succeeded' ? 'done' : state?.status === 'failed' ? 'fail' : state?.status === 'running' ? 'run' : 'idle'}>
                              {state === undefined ? '未执行' : NODE_STATUS_LABEL[state.status]}
                            </Badge>
                            <button type="button" className="linkish" onClick={() => onOpenNode(nodeId)}>
                              查看工作包
                            </button>
                          </div>
                        );
                      })
                    )}
                  </td>
                  <td>
                    <span className="hint">执行结果 / 证据在节点执行现场</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}
