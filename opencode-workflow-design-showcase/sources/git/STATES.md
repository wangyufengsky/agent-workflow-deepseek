# Git 仓库页 · 原型状态清单

原型：[prototype/index.html](prototype/index.html)，地址 `?state=<id>&theme=<deepseek|warm|spdb|github-white>`（加 `&stream=paused` 冻结模拟进度）。底部控制条可切状态、主题、暂停 / 继续模拟，并打开每个状态的说明抽屉。

- 隔离：离线，不加载外部资源；不调用 fetch / XHR / WebSocket / window.workflowDesktop；不写 localStorage / sessionStorage。每个状态页头都有「设计样例 · 不连接真实 Git / GitLab / 模型」标识（审查设置抽屉内另有一份）。
- 交互程度：**可交互** = 状态内的点击、页签、抽屉、对话框、模拟的写操作（定时器）都能操作；**静态示意** = 只展示说明与出路，没有可操作的内容。
- 设计图：design/，1440×900。deepseek 每个状态一张；warm / spdb / github-white 各 6 张（G01、G11、G12、G32、G42、G54）；另有 5 张交互后补充图，以及 overview-contact-sheet.png 总览拼图。
- 带「补充」的 id（g23–g25、g45、g59–g61）是规格 §5 之外新增的，覆盖 §4 中没有固定 id 的边界情况；规格里的 id 一个没改。


## 概览

| 状态 id | 名称 | 展示内容 | 交互程度 | 设计图 |
|---|---|---|---|---|
| `g01-overview` | 仓库概览（GitLab 已连接） | 未选项目时的入口：所有已登记项目一张卡。受 Git 管理的卡给出分支、与远端差异、未提交改动、最近提交、打开的合并请求和待处理审查问题；不受管理 / 路径不可用 / 空仓库的卡写清原因和出路。 | 可交互 | [deepseek-g01-overview.png](design/deepseek-g01-overview.png)<br>[warm-g01-overview.png](design/warm-g01-overview.png)<br>[spdb-g01-overview.png](design/spdb-g01-overview.png)<br>[github-white-g01-overview.png](design/github-white-g01-overview.png) |
| `g02-no-gitlab` | GitLab 未配置 | GitLab 没配置时，本地提交仍可浏览；远端分支、合并请求、推送不可用。概览顶部给出去设置的出路，卡片里的远端相关数字显示“—”并说明。 | 可交互 | [deepseek-g02-no-gitlab.png](design/deepseek-g02-no-gitlab.png) |
| `g03-capability-missing` | Git 能力尚未接入 | 内部 MCP（git / gitlab）还没接入时整页说明，不是错误：用 unknown 虚线风格，说明后续通过应用服务 → 内部 MCP 提供，并列出已登记项目。 | 静态示意 | [deepseek-g03-capability-missing.png](design/deepseek-g03-capability-missing.png) |

## 工作台浏览

| 状态 id | 名称 | 展示内容 | 交互程度 | 设计图 |
|---|---|---|---|---|
| `g10-commits` | 提交列表（选中最新提交） | 三栏工作台：左栏过滤与分支快捷，中栏按日期分组的提交列表与简化图谱（最多 3 条泳道，合并提交画合流点），右栏提交详情。 | 可交互 | [deepseek-g10-commits.png](design/deepseek-g10-commits.png) |
| `g11-commit-detail` | 提交详情 · a1b2c3d 新增退款接口 | 提交详情头部：标题与正文、作者 / 提交者 / 时间、完整 SHA（可复制）、父提交、包含此提交的分支、统计，主按钮“AI 审查此提交”。下方页签“改动文件 / AI 审查 / 修复”。 | 可交互 | [deepseek-g11-commit-detail.png](design/deepseek-g11-commit-detail.png)<br>[warm-g11-commit-detail.png](design/warm-g11-commit-detail.png)<br>[spdb-g11-commit-detail.png](design/spdb-g11-commit-detail.png)<br>[github-white-g11-commit-detail.png](design/github-white-g11-commit-detail.png) |
| `g12-diff-unified` | 差异 · 统一视图 | 统一视图：双列行号、hunk 头（含所在函数）、折叠未改动上下文（展开 20 行 / 全部）、语法着色、成对改动的行内高亮、忽略空白。 | 可交互 | [deepseek-g12-diff-unified.png](design/deepseek-g12-diff-unified.png)<br>[warm-g12-diff-unified.png](design/warm-g12-diff-unified.png)<br>[spdb-g12-diff-unified.png](design/spdb-g12-diff-unified.png)<br>[github-white-g12-diff-unified.png](design/github-white-g12-diff-unified.png) |
| `g13-diff-split` | 差异 · 并排视图（全宽） | 并排视图需要宽度：在三栏布局里切到并排会自动展开到全宽（中栏、左栏收起），左右各自行号，删除 / 新增对齐，长行折行。 | 可交互 | [deepseek-g13-diff-split.png](design/deepseek-g13-diff-split.png) |
| `g14-diff-full` | 差异 · 全宽阅读 | 全宽：隐藏中栏和左栏，文件树与 diff 占满；面包屑旁保留提交身份，Esc 或“退出全宽”回到三栏，选中与滚动位置保持。 | 可交互 | [deepseek-g14-diff-full.png](design/deepseek-g14-diff-full.png) |
| `g15-merge-commit` | 合并提交 · 选择对比的父 | 合并提交有两个父：用户选“对比父 1 / 对比父 2”。父 1 = 合并进来的 main 改动；父 2 = 这条分支相对 main 的改动。审查时也必须先选父。 | 可交互 | [deepseek-g15-merge-commit.png](design/deepseek-g15-merge-commit.png) |
| `g16-branches` | 分支（本地 / 远端） | 左栏切到“分支”时右栏显示分支表：本地 / 远端，是否当前、相对默认分支领先 / 落后、最后提交、关联合并请求、保护分支锁。只读：点分支 = 在提交列表筛选该分支。 | 可交互 | [deepseek-g16-branches.png](design/deepseek-g16-branches.png) |
| `g17-merge-requests` | 合并请求（GitLab） | GitLab 合并请求列表：标题、源 → 目标、状态（打开 / 已合并 / 已关闭 / 冲突）、流水线、审批、更新时间；点开显示概要和提交，点提交进入提交详情。只读，“在 GitLab 打开”。 | 可交互 | [deepseek-g17-merge-requests.png](design/deepseek-g17-merge-requests.png) |
| `g18-large-binary` | 大 diff 截断 · 二进制 · 重命名 · 权限 | 边界文件：1,240 行种子数据只显示前 400 行（“加载全部”模拟读取）；二进制只给大小；重命名显示 old → new 与相似度；只改权限显示 100644 → 100755。 | 可交互 | [deepseek-g18-large-binary.png](design/deepseek-g18-large-binary.png) |
| `g19-empty-repo` | 空仓库（还没有提交） | 客户服务平台是刚初始化的仓库：当前分支 main 还没有任何提交。不显示图谱和详情空架子，直接说明，并提示工作区里已有 12 个未提交文件（只读）。 | 静态示意 | [deepseek-g19-empty-repo.png](design/deepseek-g19-empty-repo.png) |
| `g20-detached-shallow` | 分离 HEAD · 浅克隆 | 当前不在任何分支上（HEAD 指向 c7d8e9f）：页头分支 chip 变为“分离 HEAD · c7d8e9f”并提示；浅克隆只有最近 50 个提交，列表底部说明，不提供“加载更早”。 | 可交互 | [deepseek-g20-detached-shallow.png](design/deepseek-g20-detached-shallow.png) |
| `g21-read-error` | 读取失败（保留已加载内容） | 读取失败只影响失败的那一块：加载更早的提交失败时列表保留已加载的 14 个提交；某个文件的差异读取失败时其他文件照常。都给“重试”。 | 可交互 | [deepseek-g21-read-error.png](design/deepseek-g21-read-error.png) |
| `g22-fetch-auth-fail` | 获取远端更新失败（认证） | “获取远端更新”失败：认证失败时引导到 设置 → GitLab 验证连接；网络失败给重试。领先 / 落后保持上次已知值并标注时间。 | 可交互 | [deepseek-g22-fetch-auth-fail.png](design/deepseek-g22-fetch-auth-fail.png) |
| `g23-wb-no-gitlab` | 补充 · 工作台中 GitLab 未配置 | 工作台里 GitLab 未配置：本地提交可浏览；合并请求、远端分支、获取远端更新不可用，并就地说明去设置。 | 可交互 | [deepseek-g23-wb-no-gitlab.png](design/deepseek-g23-wb-no-gitlab.png) |
| `g24-not-git` | 补充 · 项目不受 Git 管理 | 从链接直接进入不受 Git 管理的项目（运营报表脚本 · 直接执行目录）：说明原因与出路，不显示空的三栏。 | 静态示意 | [deepseek-g24-not-git.png](design/deepseek-g24-not-git.png) |
| `g25-path-unavailable` | 补充 · 本机路径不可用 | 支付网关受 Git 管理，但本机路径不存在：不能读取任何 Git 信息，引导到项目页更新路径。 | 静态示意 | [deepseek-g25-path-unavailable.png](design/deepseek-g25-path-unavailable.png) |

## AI 审查

| 状态 id | 名称 | 展示内容 | 交互程度 | 设计图 |
|---|---|---|---|---|
| `g30-review-setup` | 审查设置（抽屉） | 审查是只读的：范围（对比父提交 / 对比目标分支）、维度（多选，默认全选）、审查职业（冻结发布修订）、上下文（只读改动 / 改动 + 相关文件）。 | 可交互 | [deepseek-g30-review-setup.png](design/deepseek-g30-review-setup.png) |
| `g31-review-running` | 审查进行中 | 审查运行：阶段（读取改动 → 分析 → 汇总），不显示假百分比；可停止；“在任务中查看详情”说明审查以只读模板任务运行，复用执行详情。 | 可交互 | [deepseek-g31-review-running.png](design/deepseek-g31-review-running.png) |
| `g32-review-result` | 审查结果（5 个问题） | 结论卡（一句话 + 严重度计数 + 维度计数 + 审查对象），问题列表可按严重度 / 按文件分组；每条有位置、说明、建议修改、接受 / 忽略 / 误报（原因可选）与“选入修复”复选框；底部固定栏“已选 4 个问题 · AI 修复所选问题”。 | 可交互 | [deepseek-g32-review-result.png](design/deepseek-g32-review-result.png)<br>[warm-g32-review-result.png](design/warm-g32-review-result.png)<br>[spdb-g32-review-result.png](design/spdb-g32-review-result.png)<br>[github-white-g32-review-result.png](design/github-white-g32-review-result.png) |
| `g33-review-in-diff` | 问题在 diff 中定位 | 审查问题在 diff 的行号旁显示圆点（按严重度着色），范围内的行有左侧色条；点圆点在行下展开问题卡，可直接接受 / 忽略或回到问题列表。 | 可交互 | [deepseek-g33-review-in-diff.png](design/deepseek-g33-review-in-diff.png) |
| `g34-review-clean` | 审查无问题 | 没有发现需要处理的问题：结论卡给出肯定结论，维度清单逐项打勾；修复页签不可用（没有问题可修）。 | 可交互 | [deepseek-g34-review-clean.png](design/deepseek-g34-review-clean.png) |
| `g35-review-failed` | 审查失败 | 审查没完成（模型服务超时）：说明停在哪个阶段、已读取的内容；给“重新审查”（新开一次）与“在任务中查看详情”。历史审查记录不受影响。 | 可交互 | [deepseek-g35-review-failed.png](design/deepseek-g35-review-failed.png) |
| `g36-review-unknown` | 审查结果未知（核对原操作） | “开始审查”请求发出后没有收到回执：不知道审查是否已开始。保持原记录，按钮“核对原操作”，不重发（与系统一致的 UNKNOWN 规则）。 | 可交互 | [deepseek-g36-review-unknown.png](design/deepseek-g36-review-unknown.png) |

## AI 修复

| 状态 id | 名称 | 展示内容 | 交互程度 | 设计图 |
|---|---|---|---|---|
| `g40-fix-confirm` | 开始 AI 修复？（确认） | 修复是写操作，但在隔离的修复分支中进行：确认框写清修复位置（ai-fix/a1b2c3d-1013，基于 feature/refund 最新提交 e4f5a6b，以及为什么不是 a1b2c3d）、修复职业、修复后校验命令。 | 可交互 | [deepseek-g40-fix-confirm.png](design/deepseek-g40-fix-confirm.png) |
| `g41-fix-running` | 修复进行中 | 修复以全宽打开：阶段条（准备修复分支 → 修改代码 → 校验 → 完成）+ 实时记录摘要；可停止。写操作进行中，相关按钮锁定。 | 可交互 | [deepseek-g41-fix-running.png](design/deepseek-g41-fix-running.png) |
| `g42-fix-result` | 修复结果（校验通过） | 修复结果：问题对照（已修复 / 部分修复 / 未修复）、修复改动（同一个 diff 查看器，可撤销单个文件）、校验结果；右侧“下一步”分三步，依赖清楚，不自动连锁。 | 可交互 | [deepseek-g42-fix-result.png](design/deepseek-g42-fix-result.png)<br>[warm-g42-fix-result.png](design/warm-g42-fix-result.png)<br>[spdb-g42-fix-result.png](design/spdb-g42-fix-result.png)<br>[github-white-g42-fix-result.png](design/github-white-g42-fix-result.png) |
| `g43-fix-verify-failed` | 修复后校验失败 | 校验失败：显示失败用例与输出；仍可提交，但需要勾选“我已了解校验未通过”。也可以“重新修复”（新开一次）。 | 可交互 | [deepseek-g43-fix-verify-failed.png](design/deepseek-g43-fix-verify-failed.png) |
| `g44-fix-nochange` | AI 认为无需修改 | 修复没有产生改动：逐条说明 AI 的判断（例如最新代码已经处理），没有可提交的内容；可以清理修复分支或回到问题列表调整。 | 可交互 | [deepseek-g44-fix-nochange.png](design/deepseek-g44-fix-nochange.png) |
| `g45-fix-failed` | 补充 · 修复失败（模型未完成） | 模型没能完成修复：停在“修改代码”阶段，修复分支里可能有部分改动但未校验，不提供提交；可重新修复或放弃。 | 可交互 | [deepseek-g45-fix-failed.png](design/deepseek-g45-fix-failed.png) |

## 提交 · 推送 · 合并

| 状态 id | 名称 | 展示内容 | 交互程度 | 设计图 |
|---|---|---|---|---|
| `g50-commit` | ① 提交修复 | 提交修复：提交信息由 AI 草拟、可编辑；作者来自 Git 账号设置；选择要提交的文件；split button 主动作“提交到 ai-fix/a1b2c3d-1013”，下拉“提交并推送”。按钮上方写清后果。 | 可交互 | [deepseek-g50-commit.png](design/deepseek-g50-commit.png) |
| `g51-committed` | 已提交 · 等待推送 | 提交完成显示新提交 SHA；“撤销文件”不再可用（已提交）。② 推送解锁：目标 origin / ai-fix/a1b2c3d-1013（新建远端分支），永不强推。 | 可交互 | [deepseek-g51-committed.png](design/deepseek-g51-committed.png) |
| `g52-push-rejected` | 推送被拒（non-fast-forward） | 远端已有同名分支且包含本地没有的提交：不提供强制推送。先“获取远端更新”，看到远端提交后再决定（换分支名推送 / 稍后处理）。 | 可交互 | [deepseek-g52-push-rejected.png](design/deepseek-g52-push-rejected.png) |
| `g53-pushed` | 已推送 | 推送完成：远端分支链接；③ 合并解锁，默认推荐“创建合并请求”。 | 可交互 | [deepseek-g53-pushed.png](design/deepseek-g53-pushed.png) |
| `g54-merge-choose` | ③ 选择合并方式（MR / 直接合并） | 两种方式单选卡：“创建合并请求（推荐）”带 AI 草拟的标题 / 描述（附审查问题），可指派评审人；“直接合并”只在目标分支未受保护、可快进 / 无冲突、且不是有未提交改动的当前检出分支时可用，否则禁用并说明。 | 可交互 | [deepseek-g54-merge-choose.png](design/deepseek-g54-merge-choose.png)<br>[warm-g54-merge-choose.png](design/warm-g54-merge-choose.png)<br>[spdb-g54-merge-choose.png](design/spdb-g54-merge-choose.png)<br>[github-white-g54-merge-choose.png](design/github-white-g54-merge-choose.png) |
| `g55-mr-created` | 合并请求已创建 | 合并请求 !58 已创建：显示源 → 目标、流水线状态、指派评审人；合并本身在 GitLab 完成。流程条全部完成（合并 = MR 已创建）。 | 可交互 | [deepseek-g55-mr-created.png](design/deepseek-g55-mr-created.png) |
| `g56-merge-conflict` | 直接合并冲突 | 工作区干净时直接合并可用；合并时发现冲突：列出冲突文件，目标分支未被改动，建议改用合并请求。 | 可交互 | [deepseek-g56-merge-conflict.png](design/deepseek-g56-merge-conflict.png) |
| `g57-op-unknown` | 推送回执未知（核对原操作） | 推送请求发出后没有收到回执：保持原记录 op-push-7c21，按钮“核对原操作”，不重发；核对前合并步骤保持锁定。 | 可交互 | [deepseek-g57-op-unknown.png](design/deepseek-g57-op-unknown.png) |
| `g58-discard-confirm` | 放弃修复（确认） | 放弃修复：删除本地修复分支与修复工作副本；已推送的远端分支不删除（说明在 GitLab 中处理）。审查记录保留。 | 可交互 | [deepseek-g58-discard-confirm.png](design/deepseek-g58-discard-confirm.png) |
| `g59-commit-hook-rejected` | 补充 · 提交被 hook 拒绝 | 提交失败：pre-commit hook 拒绝，显示 hook 输出。修复分支内容没有变化，可修改后重试；不提供跳过 hook。 | 可交互 | [deepseek-g59-commit-hook-rejected.png](design/deepseek-g59-commit-hook-rejected.png) |
| `g60-push-auth-fail` | 补充 · 推送认证失败 | 推送认证失败（403 / 令牌过期）：引导到 设置 → GitLab 验证连接，回来后重试推送。 | 可交互 | [deepseek-g60-push-auth-fail.png](design/deepseek-g60-push-auth-fail.png) |
| `g61-mr-exists` | 补充 · 合并请求已存在 | 同一源 → 目标已有打开的合并请求：不重复创建，链接到已有 MR；推送已经更新了它。 | 可交互 | [deepseek-g61-mr-exists.png](design/deepseek-g61-mr-exists.png) |

## 交互后的补充图

| 文件 | 内容 |
|---|---|
| [deepseek-g10-commits-older-loaded.png](design/deepseek-g10-commits-older-loaded.png) | G10 点“加载更早的提交”后滚到底：图谱继续、根提交、“已到最早的提交” |
| [deepseek-g10-commits-1280-rail.png](design/deepseek-g10-commits-1280-rail.png) | 1280×800：左栏收为图标条，点“筛选”浮出完整左栏 |
| [deepseek-g11-commit-detail-1024-list-drawer.png](design/deepseek-g11-commit-detail-1024-list-drawer.png) | 1024×768：提交列表收成抽屉，从提交详情页头“提交列表”打开 |
| [deepseek-g54-merge-choose-explain.png](design/deepseek-g54-merge-choose-explain.png) | 说明抽屉：设计意图、验收要点、原型开关（工作区改动 / 测试命令 / GitLab） |
| [deepseek-g54-merge-choose-direct-confirm.png](design/deepseek-g54-merge-choose-direct-confirm.png) | 工作区干净时直接合并可用 → 确认框写明“合并后自动推送 origin/feature/refund” |
| [overview-contact-sheet.png](design/overview-contact-sheet.png) | 全部设计图总览拼图 |
