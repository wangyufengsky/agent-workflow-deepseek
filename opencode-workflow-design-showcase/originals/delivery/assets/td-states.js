/* 任务隔离与交付 · 原型状态注册表（设计样例 · 合成数据）
   - 每个状态：id（TD 前缀，非产品路由/API）、page（所在原型页）、group、label、desc（设计意图 / 验收要点）、req（对应 TD-A 验收条目）
   - 页面负责者只改自己分组内的 desc / label 文案；不得改 id 与 page。
*/
window.TD_STATES = [
  /* ===== TD01 开始任务与隔离准备 · start.html ===== */
  { id: 'td01-git-plan', page: 'start.html', group: 'TD01 开始任务与隔离准备', label: 'Git 项目 · 计划确认（准备工作区 → 开始执行）', req: ['TD-A01', 'TD-A04'], desc: '' },
  { id: 'td01-nongit-plan', page: 'start.html', group: 'TD01 开始任务与隔离准备', label: '非 Git 项目 · 基线快照与独立副本', req: ['TD-A16'], desc: '' },
  { id: 'td01-checking', page: 'start.html', group: 'TD01 开始任务与隔离准备', label: '项目类型正在核对', req: ['TD-A01'], desc: '' },
  { id: 'td01-combined', page: 'start.html', group: 'TD01 开始任务与隔离准备', label: '备选文案：「准备并开始」（待 API 评审二选一）', req: ['TD-A04'], desc: '' },
  { id: 'td01-preparing', page: 'start.html', group: 'TD01 开始任务与隔离准备', label: '准备独立工作区中（阶段名，无百分比）', req: ['TD-A04'], desc: '' },
  { id: 'td01-ready', page: 'start.html', group: 'TD01 开始任务与隔离准备', label: '准备成功 · 单独开始执行', req: ['TD-A01', 'TD-A04'], desc: '' },
  { id: 'td01-unavailable', page: 'start.html', group: 'TD01 开始任务与隔离准备', label: '项目不可用 / 权限不足', req: ['TD-A02'], desc: '' },
  { id: 'td01-empty-repo', page: 'start.html', group: 'TD01 开始任务与隔离准备', label: 'Git 空仓库 / 基线不可用', req: ['TD-A02'], desc: '' },
  { id: 'td01-name-conflict', page: 'start.html', group: 'TD01 开始任务与隔离准备', label: '分支 / 目录同名冲突', req: ['TD-A02'], desc: '' },
  { id: 'td01-baseline-drift', page: 'start.html', group: 'TD01 开始任务与隔离准备', label: '基线前移 · 重读后重新确认', req: ['TD-A02'], desc: '' },
  { id: 'td01-prepare-unknown', page: 'start.html', group: 'TD01 开始任务与隔离准备', label: '准备回执未知 · 核对原创建', req: ['TD-A03'], desc: '' },
  { id: 'td01-partial', page: 'start.html', group: 'TD01 开始任务与隔离准备', label: '部分创建 · 已发生步骤与定向恢复', req: ['TD-A03'], desc: '' },

  /* ===== TD02 任务画布与待交付 · task.html ===== */
  { id: 'td02-running', page: 'task.html', group: 'TD02 任务画布与待交付', label: '执行中 · 状态栏显示独立工作区', req: ['TD-A01', 'TD-A04'], desc: '' },
  { id: 'td02-parallel', page: 'task.html', group: 'TD02 任务画布与待交付', label: '同任务并行写 · 子隔离与汇合策略', req: ['TD-A04'], desc: '' },
  { id: 'td02-awaiting', page: 'task.html', group: 'TD02 任务画布与待交付', label: '执行已结束 · 等待交付（交付端点 + 面板）', req: ['TD-A05', 'TD-A22'], desc: '' },
  { id: 'td02-blocked', page: 'task.html', group: 'TD02 任务画布与待交付', label: '交付受阻 · 仍有活动写入 / 未停稳', req: ['TD-A05'], desc: '' },
  { id: 'td02-no-changes', page: 'task.html', group: 'TD02 任务画布与待交付', label: '没有文件变更（特殊结算为候选）', req: ['TD-A07'], desc: '' },
  { id: 'td02-failed-candidate', page: 'task.html', group: 'TD02 任务画布与待交付', label: '验证未通过 · 失败候选交付资格', req: ['TD-A08'], desc: '' },
  { id: 'td02-step-committed', page: 'task.html', group: 'TD02 任务画布与待交付', label: '已提交 · 等待推送确认（任务未完成）', req: ['TD-A12'], desc: '' },
  { id: 'td02-delivered', page: 'task.html', group: 'TD02 任务画布与待交付', label: '任务已交付 · MR 未合并（独立事实）', req: ['TD-A13', 'TD-A15', 'TD-A22'], desc: '' },
  { id: 'td02-delivered-verify-failed', page: 'task.html', group: 'TD02 任务画布与待交付', label: '已交付 · 验证未通过（与全部通过区分）', req: ['TD-A08'], desc: '' },
  { id: 'td02-background', page: 'task.html', group: 'TD02 任务画布与待交付', label: '另一个任务后台待交付 · 不抢当前视图', req: ['TD-A05', 'TD-A06'], desc: '' },
  { id: 'td02-cancelled-retained', page: 'task.html', group: 'TD02 任务画布与待交付', label: '已取消 · 文件保留可稍后交付', req: ['TD-A20'], desc: '' },

  /* ===== TD03 Git 任务变更 · git.html ===== */
  { id: 'td03-changes', page: 'git.html', group: 'TD03 Git 任务变更', label: '任务变更模式 · 文件树 + diff + 完成目标', req: ['TD-A06', 'TD-A09'], desc: '' },
  { id: 'td03-excluded', page: 'git.html', group: 'TD03 Git 任务变更', label: '未纳入 / 忽略文件及原因', req: ['TD-A09'], desc: '' },
  { id: 'td03-large-binary', page: 'git.html', group: 'TD03 Git 任务变更', label: '大文件分段 · 二进制 · 权限变更', req: ['TD-A09'], desc: '' },
  { id: 'td03-leave-context', page: 'git.html', group: 'TD03 Git 任务变更', label: '切到普通历史 · 退出任务上下文', req: ['TD-A06'], desc: '' },
  { id: 'td03-loading', page: 'git.html', group: 'TD03 Git 任务变更', label: '读取任务变更中', req: ['TD-A09'], desc: '' },
  { id: 'td03-read-error', page: 'git.html', group: 'TD03 Git 任务变更', label: '变更读取失败 / 快照过期 · 重读', req: ['TD-A09'], desc: '' },

  /* ===== TD04 Git 交付动作与回执 · git.html ===== */
  { id: 'td04-goal', page: 'git.html', group: 'TD04 Git 交付动作与回执', label: '选择完成目标（三选一）', req: ['TD-A10'], desc: '' },
  { id: 'td04-commit-confirm', page: 'git.html', group: 'TD04 Git 交付动作与回执', label: '提交确认', req: ['TD-A10'], desc: '' },
  { id: 'td04-commit-drift', page: 'git.html', group: 'TD04 Git 交付动作与回执', label: '文件版本已变化 · 保留草稿重新确认', req: ['TD-A10'], desc: '' },
  { id: 'td04-hook-rejected', page: 'git.html', group: 'TD04 Git 交付动作与回执', label: '提交被 hook 拒绝（脱敏原因）', req: ['TD-A14'], desc: '' },
  { id: 'td04-commit-only-done', page: 'git.html', group: 'TD04 Git 交付动作与回执', label: '目标「仅本地提交」· 提交成功即任务已交付', req: ['TD-A11'], desc: '' },
  { id: 'td04-committed-wait-push', page: 'git.html', group: 'TD04 Git 交付动作与回执', label: '提交完成 · 等待推送确认', req: ['TD-A12'], desc: '' },
  { id: 'td04-push-confirm', page: 'git.html', group: 'TD04 Git 交付动作与回执', label: '推送确认（新远端分支 · 不强推）', req: ['TD-A12'], desc: '' },
  { id: 'td04-push-exists', page: 'git.html', group: 'TD04 Git 交付动作与回执', label: '远端同名分支 · 换新名重新预览', req: ['TD-A12'], desc: '' },
  { id: 'td04-push-auth', page: 'git.html', group: 'TD04 Git 交付动作与回执', label: '未认证 / 账户用途不足 · 查看 Git 设置', req: ['TD-A12'], desc: '' },
  { id: 'td04-push-failed', page: 'git.html', group: 'TD04 Git 交付动作与回执', label: '推送明确失败（已证明无副作用）', req: ['TD-A14'], desc: '' },
  { id: 'td04-push-unknown', page: 'git.html', group: 'TD04 Git 交付动作与回执', label: '推送回执未知 · 只核对原推送', req: ['TD-A14'], desc: '' },
  { id: 'td04-mr-confirm', page: 'git.html', group: 'TD04 Git 交付动作与回执', label: '创建 MR 确认', req: ['TD-A13'], desc: '' },
  { id: 'td04-target-drift', page: 'git.html', group: 'TD04 Git 交付动作与回执', label: '目标分支前移 / 源变化 · 重读重确认', req: ['TD-A13'], desc: '' },
  { id: 'td04-mr-exists', page: 'git.html', group: 'TD04 Git 交付动作与回执', label: '已有合法原 MR · 显示原链接不重建', req: ['TD-A13'], desc: '' },
  { id: 'td04-mr-unknown', page: 'git.html', group: 'TD04 Git 交付动作与回执', label: 'MR 创建回执未知 · 只核对原操作', req: ['TD-A14'], desc: '' },
  { id: 'td04-delivered', page: 'git.html', group: 'TD04 Git 交付动作与回执', label: '所选目标全部成功 · 任务已交付', req: ['TD-A13', 'TD-A15'], desc: '' },
  { id: 'td04-goal-change', page: 'git.html', group: 'TD04 Git 交付动作与回执', label: '未完成时改变目标（API 未冻结）', req: ['TD-A10'], desc: '' },

  /* ===== TD05 非 Git 应用与三方冲突 · apply.html ===== */
  { id: 'td05-overview', page: 'apply.html', group: 'TD05 非 Git 应用与三方冲突', label: '独立副本变更 · 选择要应用的文件', req: ['TD-A16'], desc: '' },
  { id: 'td05-checking', page: 'apply.html', group: 'TD05 非 Git 应用与三方冲突', label: '检查当前原目录中', req: ['TD-A16'], desc: '' },
  { id: 'td05-preview', page: 'apply.html', group: 'TD05 非 Git 应用与三方冲突', label: '预览逐项结果（无冲突）', req: ['TD-A16', 'TD-A18'], desc: '' },
  { id: 'td05-conflicts', page: 'apply.html', group: 'TD05 非 Git 应用与三方冲突', label: '冲突清单（六类）', req: ['TD-A17'], desc: '' },
  { id: 'td05-conflict-text', page: 'apply.html', group: 'TD05 非 Git 应用与三方冲突', label: '文本冲突 · 基线 / 任务副本 / 当前原目录', req: ['TD-A17'], desc: '' },
  { id: 'td05-conflict-binary', page: 'apply.html', group: 'TD05 非 Git 应用与三方冲突', label: '二进制 / 链接 · 不可合并只能选择', req: ['TD-A17'], desc: '' },
  { id: 'td05-recheck', page: 'apply.html', group: 'TD05 非 Git 应用与三方冲突', label: '冲突已处理 · 重新检查并冻结预览', req: ['TD-A17', 'TD-A18'], desc: '' },
  { id: 'td05-apply-confirm', page: 'apply.html', group: 'TD05 非 Git 应用与三方冲突', label: '应用确认', req: ['TD-A18'], desc: '' },
  { id: 'td05-drift', page: 'apply.html', group: 'TD05 非 Git 应用与三方冲突', label: '确认后原目录又变化 · 阻塞对应项', req: ['TD-A18'], desc: '' },
  { id: 'td05-partial', page: 'apply.html', group: 'TD05 非 Git 应用与三方冲突', label: '部分成功 / 中断 · 逐项原操作结果', req: ['TD-A19'], desc: '' },
  { id: 'td05-unknown', page: 'apply.html', group: 'TD05 非 Git 应用与三方冲突', label: '应用结果待核实 · 只核对原操作', req: ['TD-A19'], desc: '' },
  { id: 'td05-applied', page: 'apply.html', group: 'TD05 非 Git 应用与三方冲突', label: '所选项全部应用成功 · 任务已交付', req: ['TD-A19'], desc: '' },
  { id: 'td05-read-error', page: 'apply.html', group: 'TD05 非 Git 应用与三方冲突', label: '原目录不可读 / 权限 / 路径不可用', req: ['TD-A16'], desc: '' },

  /* ===== TD06 工作区保全与清理 · task.html（抽屉 / 对话框） ===== */
  { id: 'td06-detail-git', page: 'task.html', group: 'TD06 工作区保全与清理', label: '工作区详情 · Git 任务分支与 worktree', req: ['TD-A20'], desc: '' },
  { id: 'td06-detail-nongit', page: 'task.html', group: 'TD06 工作区保全与清理', label: '工作区详情 · 非 Git 基线快照与副本', req: ['TD-A20'], desc: '' },
  { id: 'td06-close-retain', page: 'task.html', group: 'TD06 工作区保全与清理', label: '关闭 / 取消任务 · 文件保留提示', req: ['TD-A20'], desc: '' },
  { id: 'td06-cleanup-preview', page: 'task.html', group: 'TD06 工作区保全与清理', label: '清理预览 · 删除对象与保留对象', req: ['TD-A21'], desc: '' },
  { id: 'td06-cleanup-undelivered', page: 'task.html', group: 'TD06 工作区保全与清理', label: '有未交付内容 · 额外知情确认', req: ['TD-A21'], desc: '' },
  { id: 'td06-cleanup-blocked', page: 'task.html', group: 'TD06 工作区保全与清理', label: '清理受阻 · 活动写 / 未知 / 恢复依赖', req: ['TD-A20'], desc: '' },
  { id: 'td06-cleanup-partial', page: 'task.html', group: 'TD06 工作区保全与清理', label: '部分清理 / 失联 · 核对原清理', req: ['TD-A21'], desc: '' },
  { id: 'td06-cleaned', page: 'task.html', group: 'TD06 工作区保全与清理', label: '工作区已清理 · 交付回执仍可读', req: ['TD-A21', 'TD-A22'], desc: '' },

  /* ===== TD07 MR 任务来源与交付结果 · git.html ===== */
  { id: 'td07-mr-detail', page: 'git.html', group: 'TD07 MR 任务来源', label: 'MR 详情 · 任务来源与「已交付 / 未合并」', req: ['TD-A15'], desc: '' },
  { id: 'td07-mr-list', page: 'git.html', group: 'TD07 MR 任务来源', label: 'MR 列表 · 任务来源列', req: ['TD-A15'], desc: '' },
  { id: 'td07-mr-closed-later', page: 'git.html', group: 'TD07 MR 任务来源', label: 'MR 后来关闭 · 任务交付历史不重开', req: ['TD-A22'], desc: '' },
];
