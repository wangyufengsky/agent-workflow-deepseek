import type { ReactElement } from 'react';
import type { GitCommitSummary } from '@agent-workflow/shared';

/**
 * 中栏提交图谱（泳道 / 合流点）。
 *
 * 数据来源：服务返回的 `GitCommitSummary.parents`（真实 Git 提交父关系）。
 * 这里只做**布局**：按「新 → 旧」顺序为每个提交分配泳道，把同一父提交的
 * 分支线收进/分出。它不生成任何提交、不与服务事实冲突，仅把已加载提交的
 * 父子关系画成简化图；加载更早的提交时新增行不会改变已有行的泳道。
 *
 * 颜色只使用主题令牌（--accent / --role-*），四主题自动继承。
 */

const LANE_COLORS = [
  'var(--accent)',
  'var(--role-2)',
  'var(--role-4)',
  'var(--role-3)',
  'var(--role-5)',
  'var(--role-6)',
] as const;

function laneColor(index: number): string {
  return LANE_COLORS[index % LANE_COLORS.length] ?? 'var(--accent)';
}

/**
 * 设计稿约束「最多 3 条泳道」。真实仓库的分支数可能更多，这里按 6 列封顶显示：
 * 超出的泳道收进最右列（只影响画法，不隐藏提交），避免提交列表被图谱挤窄。
 */
const MAX_VISIBLE_LANES = 6;
const LANE_GAP = 14;
const LANE_LEFT = 13;

export interface GraphLane {
  readonly sha: string;
  readonly color: string;
}

export interface CommitGraphRow {
  readonly sha: string;
  /** 泳道数（用于计算 SVG 宽度）。 */
  readonly laneCount: number;
  /** 当前行上方每条泳道指向的提交（null 表示空位）。 */
  readonly top: readonly (GraphLane | null)[];
  /** 本提交圆点所在泳道。 */
  readonly lane: number;
  /** 本提交圆点颜色。 */
  readonly color: string;
  /** 当前行下方每条泳道指向的提交（空位已被过滤）。 */
  readonly bottom: readonly GraphLane[];
  /** 本提交的父提交在下方泳道中的位置。 */
  readonly outs: readonly GraphLane[];
  /** 上方指向同一提交、需要汇入本行圆点的泳道下标。 */
  readonly conv: readonly number[];
  /** 合并提交：空心双圈。 */
  readonly merge: boolean;
}

export interface CommitGraphLayout {
  readonly rows: readonly CommitGraphRow[];
  /** 需要绘制的泳道列数（封顶 MAX_VISIBLE_LANES）。 */
  readonly laneCount: number;
}

/**
 * 把按时间倒序的提交列表布局为泳道图。返回的行与输入按 sha 对齐；
 * 输入顺序必须是「子提交在父提交之前」（git log 的自然顺序）。
 */
export function layoutCommitGraph(commits: readonly GitCommitSummary[]): CommitGraphLayout {
  let lanes: (GraphLane | null)[] = [];
  let colorIndex = 0;
  let maxLanes = 1;
  const rows: CommitGraphRow[] = [];

  for (const commit of commits) {
    const top = lanes.slice();
    const next = top.slice();
    let lane = top.findIndex((item) => item !== null && item.sha === commit.sha);
    const color = lane === -1 ? laneColor(colorIndex++) : (top[lane]?.color ?? laneColor(0));
    if (lane === -1) {
      // 新分支的顶端：占用右侧第一个空位；空位不存在时新增一条泳道。
      lane = next.length;
      next.push(null);
    }
    // 同一提交可能被多条泳道同时指向（被多条分支包含）：这些线都汇入圆点。
    const conv: number[] = [];
    top.forEach((item, index) => {
      if (item !== null && item.sha === commit.sha) conv.push(index);
    });
    for (const index of conv) next[index] = null;

    const outs: GraphLane[] = [];
    commit.parents.forEach((parent, index) => {
      const existing = next.findIndex((item) => item !== null && item.sha === parent);
      if (existing !== -1) {
        const found = next[existing];
        if (found !== null && found !== undefined) outs.push(found);
        return;
      }
      const assigned: GraphLane = { sha: parent, color: index === 0 ? color : laneColor(colorIndex++) };
      if (index === 0) {
        next[lane] = assigned;
      } else {
        const slot = next.findIndex((item) => item === null);
        if (slot === -1) next.push(assigned);
        else next[slot] = assigned;
      }
      outs.push(assigned);
    });

    const bottom = next.filter((item): item is GraphLane => item !== null);
    maxLanes = Math.max(maxLanes, Math.max(top.length, lane + 1), bottom.length);
    rows.push({
      sha: commit.sha,
      laneCount: 0,
      top,
      lane,
      color,
      bottom,
      outs,
      conv,
      merge: commit.parents.length > 1,
    });
    lanes = bottom;
  }

  const laneCount = Math.max(1, Math.min(maxLanes, MAX_VISIBLE_LANES));
  return { rows: rows.map((row) => ({ ...row, laneCount })), laneCount };
}

function laneX(index: number, laneCount: number): number {
  return LANE_LEFT + Math.min(index, laneCount - 1) * LANE_GAP;
}

function graphWidth(laneCount: number): number {
  return 12 + laneCount * LANE_GAP;
}

/** 同一泳道画竖线；跨泳道用中点控制的三次曲线，避免细线斜穿。 */
function lanePath(x1: number, y1: number, x2: number, y2: number): string {
  if (x1 === x2) return `M${String(x1)} ${String(y1)}V${String(y2)}`;
  const mid = (y1 + y2) / 2;
  return `M${String(x1)} ${String(y1)}C${String(x1)} ${String(mid)} ${String(x2)} ${String(mid)} ${String(x2)} ${String(y2)}`;
}

/** 单行 SVG：泳道线 + 圆点（合并提交空心双圈）。行高与提交行一致。 */
export function CommitGraphCell({
  row,
  rowHeight,
  head,
}: {
  readonly row: CommitGraphRow;
  readonly rowHeight: number;
  readonly head: boolean;
}): ReactElement {
  const width = graphWidth(row.laneCount);
  const centerY = rowHeight / 2;
  const centerX = laneX(row.lane, row.laneCount);
  const paths: ReactElement[] = [];

  row.top.forEach((item, index) => {
    if (item === null) return;
    // 上方汇入本提交的泳道：从顶部曲线收敛到圆点。
    if (row.conv.includes(index)) {
      paths.push(
        <path
          key={`top-${String(index)}`}
          d={lanePath(laneX(index, row.laneCount), 0, centerX, centerY)}
          stroke={item.color}
        />,
      );
      return;
    }
    // 其余泳道：如果下方继续存在则画到对应位置（穿越本行）。
    const below = row.bottom.findIndex((lane) => lane.sha === item.sha);
    if (below === -1) return;
    paths.push(
      <path
        key={`through-${String(index)}`}
        d={lanePath(laneX(index, row.laneCount), 0, laneX(below, row.laneCount), rowHeight)}
        stroke={item.color}
      />,
    );
  });

  row.outs.forEach((out, index) => {
    const below = row.bottom.findIndex((lane) => lane.sha === out.sha);
    if (below === -1) return;
    paths.push(
      <path
        key={`out-${String(index)}`}
        d={lanePath(centerX, centerY, laneX(below, row.laneCount), rowHeight)}
        stroke={out.color}
      />,
    );
  });

  return (
    <svg
      className="commit-graph-svg"
      width={width}
      height={rowHeight}
      viewBox={`0 0 ${String(width)} ${String(rowHeight)}`}
      aria-hidden="true"
      focusable="false"
    >
      {paths}
      {row.merge ? (
        <>
          <circle cx={centerX} cy={centerY} r={5.5} fill="var(--bg)" stroke={row.color} />
          <circle cx={centerX} cy={centerY} r={2} fill={row.color} />
        </>
      ) : head ? (
        <>
          <circle cx={centerX} cy={centerY} r={7.5} fill="none" stroke={row.color} strokeWidth={1.4} opacity={0.55} />
          <circle cx={centerX} cy={centerY} r={4} fill={row.color} />
        </>
      ) : (
        <circle cx={centerX} cy={centerY} r={4.2} fill={row.color} stroke="var(--bg)" />
      )}
    </svg>
  );
}

/** 日期分组头 / 列表底部的泳道续接线，保证分叉在分组之间连续。 */
export function CommitGraphPass({
  lanes,
  laneCount,
  height,
}: {
  readonly lanes: readonly GraphLane[];
  readonly laneCount: number;
  readonly height: number;
}): ReactElement {
  const width = graphWidth(laneCount);
  return (
    <svg
      className="commit-graph-svg pass"
      width={width}
      height={height}
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      aria-hidden="true"
      focusable="false"
    >
      {lanes.map((lane, index) =>
        index >= laneCount ? null : (
          <path key={`${lane.sha}-${String(index)}`} d={`M${String(laneX(index, laneCount))} 0V${String(height)}`} stroke={lane.color} />
        ),
      )}
    </svg>
  );
}

