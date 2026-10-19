import type { ChangeStatusValue, NodeKindValue, NodeStatusValue } from '@agent-workflow/shared';
import type { BadgeTone } from '../../components/Badge.tsx';
import type { IconName } from '../../components/Icon.tsx';

export const NODE_KIND_LABEL: Record<NodeKindValue, string> = {
  requirement: '需求',
  design: '设计',
  implementation: '实现',
  test: '测试',
  verify: '验证',
  delivery: '交付',
  system: '系统',
};

export const NODE_STATUS_TONE: Record<NodeStatusValue, BadgeTone> = {
  pending: 'idle',
  ready: 'wait',
  running: 'run',
  succeeded: 'done',
  failed: 'fail',
  skipped: 'idle',
  cancelled: 'idle',
  unknown: 'unknown',
};

export const CHANGE_STATUS_LABEL: Record<ChangeStatusValue, string> = {
  A: '新增',
  M: '修改',
  D: '删除',
  R: '重命名',
  C: '复制',
  T: '类型变更',
};

export const CHANGE_STATUS_TONE: Record<ChangeStatusValue, BadgeTone> = {
  A: 'ok',
  M: 'fail',
  D: 'danger',
  R: 'accent',
  C: 'accent',
  T: 'wait',
};

export const FRAGMENT_CATEGORY_LABEL = {
  model_text: '模型正文',
  public_reasoning_summary: '推理摘要',
  tool_activity: '工具调用',
  service_event: '服务事件',
} as const;

export type RunSelection =
  | { readonly kind: 'coverage'; readonly requirementId: string }
  | { readonly kind: 'node'; readonly nodeId: string }
  | { readonly kind: 'file'; readonly fileId: string };

export type RunSegmentKey = 'coverage' | 'doc' | 'source' | 'test';

export interface RunNavItem {
  readonly key: string;
  readonly label: string;
  readonly meta: string;
  readonly icon: IconName;
  readonly selection: RunSelection;
}

export interface RunNavSection {
  readonly key: RunSegmentKey;
  readonly title: string;
  readonly hint: string;
  readonly items: readonly RunNavItem[];
}

export function selectionKey(selection: RunSelection): string {
  if (selection.kind === 'coverage') return `coverage:${selection.requirementId}`;
  if (selection.kind === 'node') return `node:${selection.nodeId}`;
  return `file:${selection.fileId}`;
}

/** 服务没有文件类型字段；测试文件只能按路径名推导，页面必须注明。 */
export function isTestPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  return (
    /(^|\/)(__tests__|tests?|specs?)\//i.test(normalized) ||
    /\.(test|spec)\.[a-z0-9]+$/i.test(normalized) ||
    /(^|\/)test_[^/]+$/i.test(normalized) ||
    /_test\.[a-z0-9]+$/i.test(normalized)
  );
}

/** “文档”分组：非代码实现、非测试的步骤节点。 */
export function isDocumentKind(kind: NodeKindValue): boolean {
  return kind !== 'implementation' && kind !== 'test';
}
