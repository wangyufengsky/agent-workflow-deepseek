# Git 仓库页 前端设计一致性审计

> 基线：main @ 3f6f9b2（2026-10-20）。范围：`sources/git/STATES.md` 的 g01–g61 共 44 状态 + `originals/git/index.html` 与 `originals/git/assets/{states.js,git.js,fixtures.js,git.css}`；实现为 `apps/web/src/pages/git/`（GitPage、GitOverview、RepoWorkbench、CommitList、CommitDetail、DiffViewer、BranchesPanel、MergeRequestsPanel、ReviewPanel、FixPanel、git-shared）与 `apps/web/src/api/git.ts`，路由 `/git`、`/git/:projectId`（`apps/web/src/app/App.tsx:49-50`，侧栏 `navigation.ts:27`）。审计方式：静态代码 vs 只读设计稿；未运行 GUI 的部分标注「需GUI」。设计稿目录只读，本报告未修改任何代码/设计稿/其他文档。

## 概览

| 页面 | 设计状态数 | 已逐项核对 | P0 | P1 | P2 | P3 | 结论 |
|---|---|---|---|---|---|---|---|
| Git 仓库（仓库概览 + 仓库工作台 + 审查/修复 + 提交推送合并） | 44 | 是（44/44） | 0 | 6 | 14 | 6 | 与设计有系统性偏差：浏览骨架、diff 基础能力、审查/修复数据链已接通，但提交图谱、diff 展开上下文与语法高亮、审查历史/问题分组、合并方式选择与写操作失败态出路与设计不同构 |

**最重要的问题（≤5 条）**

1. `GIT-02` 提交 diff 缺设计核心阅读能力：没有「展开未改动上下文（展开 20 行 / 全部）」、没有语法着色、没有成对改动的行内高亮（`DiffViewer.tsx` 全文只渲染纯文本行；契约 `DiffHunk` 无展开信息、`git.diff.read` 请求无 `expand`）。
2. `GIT-01` 中栏提交图谱缺失：实现每行只画「一个圆点 + 一条竖线」并在注释中明确「不做伪造的泳道图谱」（`CommitList.tsx:106-116`），设计要求最多 3 条泳道、合并提交画合流点；契约 `GitCommitSummary` 无 graph 字段。
3. `GIT-03` 「③ 选择合并方式（MR / 直接合并）」整块缺失：没有单选卡、没有保护分支/当前检出/可快进等前提禁用原因、没有 MR 草拟描述/评审人；取而代之是独立的「④ 合并回基线分支」本地 no-ff+CAS（`FixPanel.tsx:638-706,967-970`），与设计「直接合并后自动推送目标分支」语义不同。
4. `GIT-04` 审查结果缺历史审查切换与问题分组：同一提交的多次审查无法回看（服务已有 `/reviews` 列表读口，前端只用来做 compare）；问题列表不能按严重度/按文件分组；设计要求的「建议修改」patch 无契约字段。
5. `GIT-06` 写操作失败态没有设计要求的出路：推送被拒无「获取远端更新 + 远端多出提交 + 换分支名推送」；推送认证失败无「去设置验证连接」；MR 已存在无已有 MR 链接；合并冲突无冲突文件清单与「改为创建合并请求」。

## 状态覆盖

判定口径：`已实现`＝有可达分支且内容与设计一致；`部分`＝有分支但缺设计要点；`缺失`＝无分支/无数据源且无等价呈现。行号以当前 main 代码为准。

### 概览（`sources/git/STATES.md:15-17`，mock `originals/git/assets/states.js:24-32`）

| mock state | 设计名称 | 实现判定 | 证据（实现文件:行 / 无） | 说明 |
|---|---|---|---|---|
| `g01-overview` | 仓库概览（GitLab 已连接） | 部分 | `apps/web/src/pages/git/GitOverview.tsx:228-257`（连接条）、`:286-291`（卡片网格）、`:39-171`（RepoCard） | 连接条（连接状态/主机/账号/去设置）与项目卡六项事实（分支/与远端/未提交/打开 MR/最近提交/AI 待处理）都有；非 Git/路径不可用/空仓库卡片有原因与出路，但不可用卡片把设计的「进入（禁用+原因）」换成「查看项目」链接（GIT-22）；能力未接入的整页样式问题见 GIT-15。 |
| `g02-no-gitlab` | GitLab 未配置 | 部分 | `GitOverview.tsx:228-257`；`:88-94`（MR 计数） | 连接条显示「未配置/去设置」，MR 计数显示「—（GitLab 未配置或未读取）」；本地浏览器可进入（卡片可用）。缺设计要求的「与远端差异显示上次已知值并标注」——`RepoCard` 的 ahead/behind 没有 stale 标注，只在卡片底部单独给「上次获取远端」（GIT-21）。 |
| `g03-capability-missing` | Git 能力尚未接入 | 部分 | `GitOverview.tsx:259-269`（unknown 横幅）；`:198-209`（错误分支） | `capability.allowed === false` 时有 unknown 虚线横幅与「内部 MCP」说明，符合「不是错误」；但能力未接入若以 `CAPABILITY_UNAVAILABLE`/404 到达，会走 `UnavailablePanel`，`git-shared.tsx:446-451` 对 `not_connected` 用 danger 红色样式，违反设计「不出现红色错误样式」（GIT-15）。 |

### 工作台浏览（`STATES.md:23-38`，mock `states.js:35-82`）

| mock state | 设计名称 | 实现判定 | 证据 | 说明 |
|---|---|---|---|---|
| `g10-commits` | 提交列表（选中最新提交） | 部分 | `RepoWorkbench.tsx:454-528`（左栏）、`:530-609`（中栏）、`:611-658`（右栏）；`CommitList.tsx:92-161` | 三栏骨架、左栏筛选（引用下拉/关键词）、按日期分组、审查徽标、加载更早都在；图谱只有单点+单线（GIT-01）；头部缺「未提交改动」chip（GIT-21）；左栏只有单个引用下拉，不是设计的「本地分支快捷列表 + 过滤」。 |
| `g11-commit-detail` | 提交详情 · 新增退款接口 | 部分 | `CommitDetail.tsx:191-267`（头部）、`:269-280`（三页签）、`:283-381`（改动文件） | 标题/正文、作者/提交者/时间、完整 SHA 复制、父提交、包含分支、统计都实现；「AI 审查此提交」只切到审查页签而非直接打开审查设置抽屉（GIT-19）。 |
| `g12-diff-unified` | 差异 · 统一视图 | 部分 | `DiffViewer.tsx:327-349`（统一渲染）、`:246-253`（忽略空白）、`:306-324`（hunk 折叠） | 双列行号、hunk 头（含 `hunk.section`）、文件列表 A/M/D/R 与 +/−、忽略空白都有；缺「折叠未改动上下文的展开 20 行 / 全部」、语法着色、成对行内高亮（GIT-02）。 |
| `g13-diff-split` | 差异 · 并排视图（全宽） | 部分 | `DiffViewer.tsx:350-385`（并排）、`:232-245`（切并排自动全宽） | 左右双列行号、删除/新增对齐、空位占位、长行折行（`git.css:880-883`）都有；但「切回统一视图不自动退出全宽」的设计检查不成立——实现会在切回统一时主动退出全宽（GIT-20）。 |
| `g14-diff-full` | 差异 · 全宽阅读 | 部分 | `RepoWorkbench.tsx:454-455` + `git.css:262-267`；`CommitDetail.tsx:107-125`（Esc） | 全宽隐藏左栏/中栏、Esc 退出、选中与滚动状态不丢失（组件未卸载，静态推断）；缺设计要求的「面包屑旁保留提交身份」条，文件树在窄视口会被堆叠（GIT-20，需GUI）。 |
| `g15-merge-commit` | 合并提交 · 选择对比的父 | 已实现 | `CommitDetail.tsx:255-266`（对比基线分段）；`ReviewPanel.tsx:488-509`（审查范围含父选项） | 合并提交给出对比基线分段（父 1/父 2）、切换后文件与统计随 `compareId` 重读；审查设置里同样列出父选项。 |
| `g16-branches` | 分支（本地 / 远端） | 部分 | `RepoWorkbench.tsx:584-596`；`BranchesPanel.tsx:19-116` | 分支表含本地/远端分组、当前、upstream、相对默认分支领先/落后、最后提交、保护分支锁；但表在中栏而非设计右栏（GIT-10），且缺「关联合并请求」列（契约 `GitBranch` 无该字段，GIT-13）。 |
| `g17-merge-requests` | 合并请求（GitLab） | 部分 | `RepoWorkbench.tsx:597-607`；`MergeRequestsPanel.tsx:34-186` | 列表有标题、源→目标、状态（打开/已合并/已关闭/锁定+冲突徽标）、流水线、审批、更新时间；详情缺设计要求的「概要（描述）与提交列表、点提交进入提交详情」（契约 `GitMergeRequest` 无 description/commits，GIT-12）。 |
| `g18-large-binary` | 大 diff 截断 · 二进制 · 重命名 · 权限 | 部分 | `DiffViewer.tsx:264-281`（重命名/权限）、`:283-290`（二进制）、`:393-409`（截断/加载全部） | 截断有文案+「加载全部」；权限变更显示 old→new；二进制只写「二进制文件，不显示差异」、重命名只写 old→new——缺二进制大小与重命名相似度（契约 `FileChange` 无字段，GIT-11）。 |
| `g19-empty-repo` | 空仓库（还没有提交） | 部分 | `RepoWorkbench.tsx:446-451`（横幅）；`:568-583`（空列表）、`:611-620`（空详情） | 空仓库横幅+空列表+空详情，不画伪图谱；缺设计「GitLab 未绑定的提示与出路」（GIT-23）。 |
| `g20-detached-shallow` | 分离 HEAD · 浅克隆 | 部分 | `RepoWorkbench.tsx:389-395`（页头 chip/meta）、`:440-445`（分离横幅）；`CommitList.tsx:149-160`（浅克隆边界） | 分离 HEAD 文本与横幅、浅克隆徽标与「已到达浅克隆边界/不提供加载更早」都有；页头 chip 未用设计要求的提示色（纯文本 span，GIT-21）。 |
| `g21-read-error` | 读取失败（保留已加载内容） | 部分 | `RepoWorkbench.tsx:550-567`（分块失败保留）；`DiffViewer.tsx:299-301`（diff 失败）；`CommitList.tsx:149-160`（加载更多失败） | 列表/分支/MR 分块读取失败保留已加载内容并给「重新读取」；但 diff 单文件失败用 `FailureNotice` 直接替换已加载 diff，没有设计「保留已加载内容并标读取时间」（GIT-17）。 |
| `g22-fetch-auth-fail` | 获取远端更新失败（认证） | 部分 | `RepoWorkbench.tsx:396-406`（获取按钮）、`:423-439`（回执/失败条） | 失败有回执/错误条与错误码；缺认证失败专用的「去设置验证连接」入口，ahead/behind 也未标注「10:42 的数据」（GIT-21）。 |
| `g23-wb-no-gitlab` | 补充 · 工作台中 GitLab 未配置 | 部分 | `RepoWorkbench.tsx:396-406`、`:517-527`；`MergeRequestsPanel.tsx:34-46`；`BranchesPanel.tsx` 远端组 | MR 页签有引导空态；但「获取远端更新」只在 `repo.remote === undefined` 时禁用，GitLab 未配置时仍可点（GIT-14）；远端分支组没有整组不可用说明。 |
| `g24-not-git` | 补充 · 项目不受 Git 管理 | 已实现 | `RepoWorkbench.tsx:329-358`；`GitOverview.tsx:124-133` | 用 `UnavailablePanel` 说明「不显示空的三栏」与出路，卡片也写明原因。 |
| `g25-path-unavailable` | 补充 · 本机路径不可用 | 部分 | `RepoWorkbench.tsx:329-358`；`GitOverview.tsx:125-131` | 有「本机路径不可用」说明与「到项目页更新路径」出路；但设计检查「路径以 mono 显示」未实现——工作台不可用视图没有显示 `displayRoot`（GIT-22）。 |

### AI 审查（`STATES.md:44-50`，mock `states.js:85-105`）

| mock state | 设计名称 | 实现判定 | 证据 | 说明 |
|---|---|---|---|---|
| `g30-review-setup` | 审查设置（抽屉） | 已实现 | `ReviewPanel.tsx:456-599`（抽屉）、`:481-511`（范围）、`:513-539`（维度）、`:541-569`（职业）、`:571-589`（上下文）、`:200-211`（禁用原因） | 四项设置、只读说明、维度全不选时禁用并写原因、开始成功后关闭抽屉并切到审查页签都已实现（`onReviewStarted`，`CommitDetail.tsx:389-392`）。 |
| `g31-review-running` | 审查进行中 | 部分 | `ReviewPanel.tsx:251-255`（停止）、`:267-333`（状态/阶段文本）；`git-shared.tsx:111-119`（阶段词表） | 显示状态徽标、当前阶段文字、起止时间、停止与重新读取；缺设计三阶段条（读取改动→分析→汇总）、已用时间、停止确认弹窗、「在任务中查看详情」（GIT-05）。 |
| `g32-review-result` | 审查结果（5 个问题） | 部分 | `ReviewPanel.tsx:287-333`（结论卡）、`:376-439`（问题列表）、`:443-452`（底部固定栏） | 结论摘要、严重度/维度计数、审查对象、逐条问题（位置/说明/接受/忽略/误报/选入修复）与底部「已选 N 个问题 · AI 修复所选问题」都在；缺历史审查下拉、按严重度/文件分组、建议修改 patch（GIT-04）。 |
| `g33-review-in-diff` | 问题在 diff 中定位 | 部分 | `DiffViewer.tsx:94-115,336-345`（问题圆点）、`:414-418`（文件问题提示）；`CommitDetail.tsx:136-150`（定位） | diff 行号旁有按严重度着色的问题圆点，点击定位并聚焦；缺设计「点圆点在行下展开问题卡（可直接接受/忽略）」、范围行左侧色条、工具栏「问题 1 / 4」上下跳转（GIT-09）。 |
| `g34-review-clean` | 审查无问题 | 部分 | `ReviewPanel.tsx:369-375`（空态）；`CommitDetail.tsx:276-278`（修复页签仍可点） | 有肯定空态与维度计数（0）；缺设计「6 个维度逐项打勾」与「修复页签不可用」，修复页签仍可进入（GIT-18）。 |
| `g35-review-failed` | 审查失败 | 部分 | `ReviewPanel.tsx:302-311`（失败说明）、`:256-258`（再次审查） | 失败徽标+说明+「再次审查」；缺「停在哪个阶段/已读取内容」的结构化卡、「在任务中查看详情」；历史审查无法切换查看（GIT-04/05）。 |
| `g36-review-unknown` | 审查结果未知（核对原操作） | 部分 | `ReviewPanel.tsx:302-311`；`git-shared.tsx:527-579`（回执核对） | 本次请求回执未知时 `ReceiptBanner` 有「核对原操作」且不重发；但服务读回的 `ReviewRun.state === 'unknown'` 场景只有一句说明，没有核对按钮（GIT-05）。 |

### AI 修复（`STATES.md:56-61`，mock `states.js:108-125`）

| mock state | 设计名称 | 实现判定 | 证据 | 说明 |
|---|---|---|---|---|
| `g40-fix-confirm` | 开始 AI 修复？（确认） | 部分 | `FixPanel.tsx:726-780`（确认弹窗）、`:441-472`（修复前卡） | 弹窗写明隔离分支、基于基线最新提交而非审查提交、职业选择、校验命令来源；缺「之后又有 N 个提交」的确认前说明（修复开始后才有 `commitsAfterReviewed`）、缺设计所示真实分支名（服务生成后才知道，GIT-07）。 |
| `g41-fix-running` | 修复进行中 | 部分 | `FixPanel.tsx:475-516`（状态/停止/校验）、`:518-569`（结果区） | 有状态徽标、停止、写操作锁定；缺设计全宽阶段条（准备修复分支→修改代码→校验→完成）与实时记录摘要（`FixRun` 无阶段/日志字段，GIT-07）。 |
| `g42-fix-result` | 修复结果（校验通过） | 部分 | `FixPanel.tsx:518-538`（问题对照）、`:540-569`（修复改动/撤销）、`:571-706`（下一步） | 问题对照含修复/部分/未修复+位置映射、修复 diff 可打开、单文件撤销、校验结果、逐步依赖清楚；但「下一步」做成 4 步（提交/推送/MR/本地合并），非设计 3 步（提交/推送/合并），合并语义不同（GIT-03）。 |
| `g43-fix-verify-failed` | 修复后校验失败 | 部分 | `FixPanel.tsx:510-516`（校验）、`:834-839`（知情确认） | 校验失败+必须勾选「我已了解校验未通过」才能提交；缺失败用例与输出展开（契约只有计数/摘要），缺「重新修复」入口（GIT-08）。 |
| `g44-fix-nochange` | AI 认为无需修改 | 部分 | `FixPanel.tsx:544-547`（无改动说明）、`:518-538`（逐问题 outcome） | 无改动文案+逐问题 outcome（若服务返回 reason）；但「清理修复分支」仍走放弃确认弹窗，设计明确「不需要二次确认」（GIT-08）。 |
| `g45-fix-failed` | 补充 · 修复失败（模型未完成） | 部分 | `FixPanel.tsx:475-516`（失败徽标/状态）、`:708-713`（放弃） | 失败态可读、可放弃、不可提交；缺「重新修复（新开一次）」入口与失败阶段标红/部分改动只读说明（GIT-07）。 |

### 提交 · 推送 · 合并（`STATES.md:67-78`，mock `states.js:128-163`）

| mock state | 设计名称 | 实现判定 | 证据 | 说明 |
|---|---|---|---|---|
| `g50-commit` | ① 提交修复 | 部分 | `FixPanel.tsx:782-846`（提交弹窗）、`:576-604`（步骤①） | 编辑提交信息、勾选文件、作者来自设置、校验失败知情确认、两个按钮（只提交/提交后确认推送）等价 split button；页面级没有 split dropdown，后果说明在弹窗内（GIT-19）。 |
| `g51-committed` | 已提交 · 等待推送 | 部分 | `FixPanel.tsx:576-604`（已提交+sha）、`:606-636`（推送解锁） | 提交步显示 succeeded+commitSha，② 解锁且写清「永不强推」；「撤销文件」是否禁用依赖服务 action/`fix.state === 'ready'`（`FixPanel.tsx:551-552`），静态无法证明提交后一定禁用（需GUI/服务）。 |
| `g52-push-rejected` | 推送被拒（non-fast-forward） | 部分 | `FixPanel.tsx:848-876`（推送确认）、`:714-722`（错误条） | 推送失败有回执/错误条与「永不强推」文案；缺设计「先获取远端更新，看到远端多出的提交，再换分支名推送/稍后处理」——产品没有换名推送能力（请求 DTO 无远端 ref 选择）也没有远端提交列表（GIT-06）。 |
| `g53-pushed` | 已推送 | 部分 | `FixPanel.tsx:606-636`（已推送+remoteRef）、`:638-673`（MR 解锁） | 推送步显示 succeeded、remoteRef（无 pushedSha 展示、无远端分支链接）；③ 解锁。 |
| `g54-merge-choose` | ③ 选择合并方式（MR / 直接合并） | 缺失 | `FixPanel.tsx:638-706`（只有「创建 MR」与「④ 合并回基线分支」）；`git-shared.tsx:106`（DELIVERY_STEP_LABEL 的「直接合并」未用于这里） | 没有 MR/直接合并单选卡、目标分支选择、保护分支/当前检出/可快进前提的禁用原因、MR 草拟描述（附审查问题）与评审人；「直接合并」被替换为本地 no-ff+CAS 合并且不推送目标分支，与设计语义不同（GIT-03）。 |
| `g55-mr-created` | 合并请求已创建 | 部分 | `FixPanel.tsx:638-673`（MR 步 succeeded + mrWebUrl） | 有 !iid 与「在 GitLab 打开」，流程步 ③ 显示已创建；缺设计「源→目标、流水线、指派评审人」卡；「放弃修复入口消失」未实现（沿用底部按钮）；提交列表「已修复」徽标无数据（审查状态枚举无 fixed，GIT-24）。 |
| `g56-merge-conflict` | 直接合并冲突 | 部分 | `FixPanel.tsx:936-973`（合并弹窗）、`:714-722`（错误条） | 合并失败走通用错误条；没有冲突文件清单、「feature/refund 未被改动」说明与「改为创建合并请求」一键切换（GIT-06）。 |
| `g57-op-unknown` | 推送回执未知（核对原操作） | 已实现 | `FixPanel.tsx:494-508`（unknown 横幅+逐步核对）；`git-shared.tsx:527-579`（回执条+核对） | 回执 UNKNOWN 保持原记录、只提供「核对原操作」、不重发；合并步骤在推送成功前保持锁定（步骤状态机）。 |
| `g58-discard-confirm` | 放弃修复（确认） | 已实现 | `FixPanel.tsx:975-1001`（弹窗） | 列明删除本地修复分支/副本、已推送远端分支不删除、审查记录保留；危险按钮与取消清楚。 |
| `g59-commit-hook-rejected` | 补充 · 提交被 hook 拒绝 | 部分 | `FixPanel.tsx:782-846`（提交弹窗/错误）、`git-shared.tsx:551-556`（回执输出） | 提交失败时回执条会显示 `error.output`（若服务下发 hook 输出，mono 呈现），可重试，无 `--no-verify`；但没有专属「hook 拒绝」状态与「重试提交」按钮（GIT-06）。 |
| `g60-push-auth-fail` | 补充 · 推送认证失败 | 部分 | `FixPanel.tsx:848-876`、`:714-722` | 失败回执含错误码/消息；缺「去设置验证连接」入口与账号显示（GIT-06）。 |
| `g61-mr-exists` | 补充 · 合并请求已存在 | 部分 | `FixPanel.tsx:878-934`、`:714-722` | 创建失败显示错误码（含 `MR_ALREADY_EXISTS`）；缺「链接到已有 !58」与「推送已更新这个 MR」说明（错误详情无 iid，GIT-06）。 |

## 问题清单

### GIT-01: 中栏提交图谱缺失（无泳道 / 合流点）
- **严重度**：P1
- **维度**：结构 / S / V
- **类别**：结构 / 数据契约
- **设计依据**：`opencode-workflow-design-showcase/sources/git/STATES.md:23`（「中栏按日期分组的提交列表与简化图谱（最多 3 条泳道，合并提交画合流点）」）；`:24`（g11 检查「图谱：feature/refund、origin/feature/refund 分叉、main 合入；合并提交是空心双圈」）；`sources/git/API-DESIGN.md:164`（CommitSummary 含「简化图谱泳道」）、`:269`（`graph?: { lane; laneCount; joinsFrom? }`）；mock 计算与绘制 `originals/git/assets/git.js:99-139`（layout/graphSVG）、`:308-339`（commitList 用 graphSVG/passSVG）。
- **实现位置**：`apps/web/src/pages/git/CommitList.tsx:106-116`（每行只画一条 `.line` + 一个 `.dot`，注释第 38 行明写「不做伪造的泳道图谱」）；`packages/shared/src/domain/models.ts:1075-1090`（`GitCommitSummary` 只有 sha/parents/subject/author/authoredAt/refs/review，无 graph）；服务端 `packages/server/src/http.ts:773-803` 也只投影这些字段。
- **差异**：设计要求最多 3 条泳道、分叉/合流可视化、合并提交空心双圈、按泳道着色的分支走向；实现退化为无泳道的点线列表，用户无法从列表看出分支分叉、合入关系，只能靠「合并」chip 与 refs 推断。
- **原因**：契约没有 graph 泳道字段（C1，API-DESIGN §7 第 20 项把「谁计算泳道」列为待确认，未冻结）；前端选择不计算（C2/C4）。
- **影响**：g10 的核心画面与 g11 检查点不成立；这是 Git 历史阅读的主要导航结构，缺失会显著降低多分支仓库的可读性。
- **建议**：先在契约补 `graph: { lane, laneCount, joinsFrom? }`（或前端用 parents+排序计算并注明仅示意）；`CommitList` 用 SVG 泳道绘制，合并提交空心双圈，日期分组处续接泳道。
- **验证**：静态（已可判定）；渲染观感需GUI。
- **关联状态**：`g10-commits`, `g11-commit-detail`, `g15-merge-commit`

### GIT-02: diff 缺「展开未改动上下文 / 语法着色 / 行内高亮」
- **严重度**：P1
- **维度**：结构 / T / V / S
- **类别**：结构 / 样式主题 / 数据契约
- **设计依据**：`sources/git/STATES.md:25`（g12「双列行号、hunk 头（含所在函数）、折叠未改动上下文（展开 20 行 / 全部）、语法着色、成对改动的行内高亮、忽略空白」）；`sources/git/README.md:35`（「diff 支持统一 / 并排、忽略空白、展开上下文、全宽阅读」）；`sources/git/API-DESIGN.md:294-306`（DiffHunk/DiffPage 设计含 `collapsedBefore` 与 `nextCursor`「加载全部」；`git.diff.read` 请求含 `expand?{hunkId,direction,lines}`）；mock `originals/git/assets/git.js:480-536`（折叠区 + 展开 20 行/全部；`intraPairs` 行内高亮；`hlHTML` 语法着色）。
- **实现位置**：`apps/web/src/pages/git/DiffViewer.tsx:142-161`（请求只有 path/base/head/ignoreWhitespace，无 expand）；`:306-324`（只支持整 hunk 折叠，不展开未改动上下文）；`:327-349`、`:350-385`（直接渲染 `line.text`，无 tokenize、无行内高亮）；`apps/web/src/api/git.ts:198-217`（`GitDiffOptions` 无 expand）；`packages/shared/src/domain/models.ts:906-929`（`DiffHunk` 无 `collapsedBefore`，`DiffPage` 无 `findingMarks`/总行数）。
- **差异**：设计要求的三项 diff 阅读能力均无：未改动上下文只能整 hunk 收起/展开，不能「展开 20 行 / 全部」；代码是纯文本无色；成对改动没有行内字符级高亮。文件列表、双列行号、hunk 头/所在函数、忽略空白已实现。
- **原因**：契约没有 expand 请求与折叠区间（C1）；前端没有实现语法着色与行内 diff（C7/C2）。
- **影响**：g12 主画面不成立；大改动阅读时无法聚焦变化内容，代码可读性明显低于设计；g18「前 400 行 + 加载全部」的上下文折叠体验也受影响。
- **建议**：服务补 `expand{hunkId,up,lines}`/`collapsedBefore`；前端实现折叠条与「展开 20 行/全部」；引入轻量语法着色器与行内字符 diff（成对删/增行）。
- **验证**：静态（已可判定）；渲染需GUI。
- **关联状态**：`g12-diff-unified`, `g13-diff-split`, `g14-diff-full`, `g18-large-binary`

### GIT-03: 「选择合并方式（MR / 直接合并）」缺失，合并语义被替换
- **严重度**：P1
- **维度**：结构 / A / 语义
- **类别**：交互 / 结构
- **设计依据**：`sources/git/STATES.md:71`（g54 两种方式单选卡 + 直接合并前提禁用原因）；`:72`（g55 合并请求已创建卡）；`:73`（g56 直接合并冲突：冲突文件、目标分支未被改动、建议改用 MR）；`sources/git/README.md:49-52`（推荐创建 MR；直接合并仅在目标分支未受保护、未检出且有改动、可无冲突时可用，否则禁用写原因；「提交并推送」是显式两次命令）；`sources/git/API-DESIGN.md:636-645`（§5.3 直接合并六条前提，含「合并后推送目标分支」）；mock `originals/git/assets/git.js:764-859`（nextSteps/stepMerge/directBlock，含单选卡、禁用原因、确认框写「合并后自动推送 origin/…」）。
- **实现位置**：`apps/web/src/pages/git/FixPanel.tsx:638-706`（步骤③只提供「创建合并请求」；步骤④为「合并回基线分支」）；`:936-973`（合并弹窗写「只更新本地目标分支（no-ff + CAS）；不会推送、不会创建 MR」）；`packages/shared/src/api/contracts.ts:1798-1804`（`FixMergeRequest` 只有 expectedBaseTip/message/strategy，无 targetBranch/推送）；`packages/engine/src/fix.ts:511-532`（merge 目标固定为 `fix.base.branch`，仅 CAS，无保护分支/当前检出/推送判定）。
- **差异**：设计把「合并」作为一个三选一决策（MR / 直接合并）并在直接合并时列出前提、冲突文件与「合并后自动推送目标分支」；实现把 MR 与本地合并拆成两个独立步骤，本地合并不推送、不检查保护分支/当前检出/可快进，也没有 MR 草稿（标题/描述/评审人）的确认卡。
- **原因**：契约与引擎的 merge 语义不同（C1：无 targetBranch、无推送结果步、无保护分支/保护策略投影）；前端未实现方式选择与前提展示（C2/C5）。
- **影响**：g54 整块缺失、g55/g56 随之退化；用户无法在合并前看到「为什么不能直接合并」以及「合并后会推送」，与设计责任边界（逐步确认、后果写清）不一致。
- **建议**：补 targetBranch/推送能力与 `actions.merge` 的前提原因；UI 增加 MR/直接合并单选卡、MR 草稿（标题/描述自动附审查问题）、前提禁用原因与「合并后自动推送」确认；冲突时返回文件清单并一键切 MR。
- **验证**：静态 + 需真实服务（保护分支/冲突）。
- **关联状态**：`g54-merge-choose`, `g55-mr-created`, `g56-merge-conflict`

### GIT-04: 审查结果缺历史审查切换、问题分组与「建议修改」
- **严重度**：P1
- **维度**：S / 结构 / T
- **类别**：结构 / 数据契约
- **设计依据**：`sources/git/STATES.md:46`（g32「问题列表可按严重度 / 按文件分组」「历史审查下拉：第 2 次 … / 第 1 次 …」）；`:49`（g35「历史审查记录不受影响」「历史下拉仍可切到第 1 次审查」）；`:42`（README 操作逻辑「同一提交可以多次审查，历史记录保留」）；`sources/git/API-DESIGN.md:326-341`（ReviewRun/Finding 设计）、`:348`（Finding 含 `suggestion` patch）；mock `originals/git/assets/git.js:641-642`（histBtn 历史下拉）、`:681-688`（分组 toggle）、`:699-713`（fdCard 含建议修改）。
- **实现位置**：`apps/web/src/pages/git/ReviewPanel.tsx:339-365`（只有「对比上次审查」，没有历史列表选择）；`:376-439`（问题列表固定顺序，无按严重度/文件分组）；`packages/shared/src/domain/models.ts:1129-1148`（`ReviewFinding` 无 `suggestion`）；服务端历史列表读口已存在：`packages/server/src/http.ts:811-820`（`/commits/:sha/reviews`）、`review-plugin.ts:74-76`（`/reviews`）。
- **差异**：多轮审查虽然服务端保留，但前端没有入口切到「第 1 次审查」只读查看；问题列表不能切换分组；「建议修改」只能来自 `finding.detail` 文本，没有结构化 patch 展示。
- **原因**：前端未消费已有历史列表读口（C2）；契约缺 suggestion 与分组所需字段（C1）。
- **影响**：g32/g35 的审查历史与分组检查点不成立；用户无法回看上一轮审查关闭了哪些问题（虽有「对比上次审查」，但不能查看单次历史）。
- **建议**：接入 `/commits/:sha/reviews` 做历史下拉（ordinal+时间+状态），历史审查只读；补按严重度/文件分组切换；契约补 suggestion patch 并只在 diff 中「应用建议」入口（若产品要）。
- **验证**：静态；需真实多次审查数据。
- **关联状态**：`g32-review-result`, `g35-review-failed`, `g33-review-in-diff`

### GIT-05: 审查「进行中 / 失败 / 未知」缺阶段条、停止确认、任务详情与核对入口
- **严重度**：P1
- **维度**：S / A / D
- **类别**：状态 / 交互
- **设计依据**：`sources/git/STATES.md:45`（g31「阶段（读取改动 → 分析 → 汇总），不显示假百分比；可停止；"在任务中查看详情"」）；`:49`（g35 失败「说明停在哪个阶段、已读取的内容」「在任务中查看详情」）；`:50`（g36「核对后：审查已在运行 → 切到进行中」，虚线 unknown 样式）；`sources/git/API-DESIGN.md:647-678`（REVIEW_FAILED：失败卡+原因+「在任务中查看详情」+重新审查）；mock `originals/git/assets/git.js:642-698`（阶段列表/失败卡/unknown 核对）。
- **实现位置**：`apps/web/src/pages/git/ReviewPanel.tsx:233-265`（工具栏）、`:267-333`（状态/阶段文本）、`:302-311`（失败/未知一句话）、`:251-255`（停止按钮无确认）；无「在任务中查看详情」按钮；`packages/shared/src/domain/models.ts:1150-1171`（ReviewRun 有 executionId 但无 taskId，无法直接跳任务页）。
- **差异**：运行中只有一行「当前阶段：分析」与起止时间，没有三阶段条与已用时间；停止按钮直接提交无确认；失败没有「停在哪个阶段/已读取内容」的结构化卡；读回的 `state === 'unknown'` 没有「核对原操作」按钮（只有本次请求回执 UNKNOWN 才有）；没有任务详情入口。
- **原因**：前端未把 `stage/startedAt/executionId` 渲染成设计结构（C2/C5）；契约缺 taskId/任务跳转（C1）。
- **影响**：g31/g35/g36 的主画面与操作路径不成立；长审查过程中用户无法判断进度，停止是不可逆的即时动作。
- **建议**：按 `stage` 渲染三阶段条与已用时间；停止加确认；`state === 'unknown'` 时提供「核对原操作」（复用 operations.by-key）；契约补 taskId 并放「在任务中查看详情」。
- **验证**：静态；运行态需GUI。
- **关联状态**：`g31-review-running`, `g35-review-failed`, `g36-review-unknown`

### GIT-06: 写操作失败态缺设计规定的出路（推送被拒/认证失败/MR 已存在/合并冲突/hook）
- **严重度**：P1
- **维度**：A / T / D
- **类别**：交互 / 文案
- **设计依据**：`sources/git/STATES.md:69`（推送被拒：先获取远端更新、看到远端提交后再决定「换分支名推送 / 稍后处理」）；`:77`（推送认证失败：引导到设置 → GitLab 验证连接后重试）；`:76`（hook 拒绝：显示 hook 输出、可修改后重试、不提供跳过）；`:78`（MR 已存在：链接到已有 MR、说明推送已更新它）；`:73`（合并冲突：列出冲突文件、建议改用 MR）；`sources/git/API-DESIGN.md:647-678`（错误码 → UI 处理表：PUSH_REJECTED_NON_FF/REMOTE_BRANCH_EXISTS/GITLAB_AUTH_FAILED/MR_ALREADY_EXISTS/MERGE_CONFLICT/HOOK_REJECTED）。
- **实现位置**：`apps/web/src/pages/git/FixPanel.tsx:848-876`（推送）、`:878-934`（MR）、`:936-973`（合并）、`:714-722`（统一错误条）；`git-shared.tsx:446-478`（FailureNotice 只展示 message/code）；`apps/web/src/api/git.ts:392-405`（`FixPushRequest` 无远端 ref 选择）、`contracts.ts:1798-1810`（MR 创建请求无 reviewer、错误无 iid 字段）。
- **差异**：所有写失败都退化为一条「操作失败 + message + code」；没有设计要求的下一步入口：推送被拒后的「获取远端更新/远端提交列表/换名推送」，推送认证失败的「去设置验证连接」，MR 已存在的「打开已有 MR」，合并冲突的冲突文件清单与「改为创建 MR」，hook 拒绝的重试按钮与脱敏输出块（仅当服务把 output 塞进回执时才有一行 code）。
- **原因**：契约没有为这些错误携带可操作上下文（C1：无远端提交列表、无已有 MR iid、无冲突文件数组）；前端未按错误码分支（C2/C5）。
- **影响**：g52/g56/g59/g60/g61 五个状态的设计出路不可达；用户在写失败后只能在原按钮上反复重试，容易和设计「先获取更新再决定、绝不强推」的安全规则冲突。
- **建议**：服务在错误详情中补结构化上下文（remoteCommits、existingMrIid/webUrl、conflictPaths、hookOutput）；前端按 `ErrorCode` 渲染专属失败卡与行动按钮；仍不提供 force/跳过 hook。
- **验证**：静态；需真实服务/远端故障注入。
- **关联状态**：`g52-push-rejected`, `g56-merge-conflict`, `g59-commit-hook-rejected`, `g60-push-auth-fail`, `g61-mr-exists`

### GIT-07: 修复进行中/失败态缺阶段条、实时记录与「重新修复」
- **严重度**：P2
- **维度**：S / 结构
- **类别**：状态 / 数据契约
- **设计依据**：`sources/git/STATES.md:57`（g41「全宽打开：阶段条（准备修复分支 → 修改代码 → 校验 → 完成）+ 实时记录摘要；可停止」）；`:61`（g45 修复失败「停在修改代码阶段，修复分支里可能有部分改动但未校验；可重新修复或放弃」）；`sources/git/API-DESIGN.md:366-381`（FixRun 设计含 state/steps/verification，但未含过程日志；§1.4 建议「在任务中查看详情」复用执行详情）；mock `originals/git/assets/git.js:722-763`（fixPane 阶段条 + 实时日志）。
- **实现位置**：`apps/web/src/pages/git/FixPanel.tsx:475-516`（状态徽标/停止/校验摘要）、`:518-569`（结果区）；`packages/shared/src/domain/models.ts:1173-1210`（FixRun 无阶段/日志字段）。
- **差异**：修复进行中只显示状态徽标和校验摘要，没有阶段条、没有记录摘要、没有「在任务中查看」；失败态没有阶段标红/未校验说明与「重新修复（新开一次）」按钮，只能放弃。
- **原因**：契约无修复过程投影（C1）；前端无阶段条与重开入口（C2）。
- **影响**：g41/g45 主画面与出路不成立；长修复过程不可见，失败后用户只能放弃。
- **建议**：按 `FixRun.state` 映射四阶段条；过程日志/阶段明细通过执行引擎读口补充；失败/校验失败/无改动提供「重新修复（新 key）」。
- **验证**：静态；运行态需GUI。
- **关联状态**：`g41-fix-running`, `g43-fix-verify-failed`, `g45-fix-failed`

### GIT-08: 校验失败/无改动的收尾细节
- **严重度**：P2
- **维度**：T / A
- **类别**：交互 / 数据契约
- **设计依据**：`sources/git/STATES.md:59`（g43「显示失败用例与输出；仍可提交但需勾选」）；`:60`（g44「逐条说明 AI 的判断；没有可提交内容；可直接清理修复分支（不需要二次确认）」）；mock `originals/git/assets/git.js:722-762`（校验输出折叠、无改动逐条原因、清理按钮）。
- **实现位置**：`FixPanel.tsx:510-516`（校验摘要）、`:544-547`（无改动说明）、`:708-713`（放弃按钮→确认弹窗）；`packages/shared/src/domain/models.ts:750-756`（verification 只有 state/passed/failed/summary/logArtifactId，无输出文本）。
- **差异**：校验失败只显示计数与摘要，没有失败用例/输出展开；无改动时只能从 outcome.reason 看原因，没有逐条「AI 判断」；「清理修复分支」仍要求二次确认，与设计相反。
- **原因**：契约缺失败用例/输出投影（C1，log 只有 artifactId，仓库页无 artifact 阅读入口）；前端细节未做（C2）。
- **影响**：g43/g44 检查点部分不成立，用户无法判断校验失败原因，也无快捷清理路径。
- **建议**：失败时读取校验日志 artifact 并展开；无改动态用 hint 表明「无需二次确认」并直接提供清理；补「重新修复」。
- **验证**：静态 + 需真实服务。
- **关联状态**：`g43-fix-verify-failed`, `g44-fix-nochange`

### GIT-09: diff 内审查问题定位缺行内卡片与跳转工具条
- **严重度**：P2
- **维度**：结构 / A
- **类别**：结构 / 交互
- **设计依据**：`sources/git/STATES.md:47`（g33「问题在 diff 的行号旁显示圆点；范围内行有左侧色条；点圆点在行下展开问题卡，可直接接受 / 忽略或回到问题列表；工具条"问题 1 / 4"上下跳转」）；mock `originals/git/assets/git.js:456-479`（fnav 问题导航）、`:481-536`（fdCover 色条、noteHTML 行下卡片）。
- **实现位置**：`apps/web/src/pages/git/DiffViewer.tsx:94-115`（圆点按钮）、`:336-345`/`:357-381`（行内插入圆点）、`:414-418`（文件问题提示）；`CommitDetail.tsx:136-150`（点击定位）——点击只滚动/聚焦，不展开卡片。
- **差异**：没有行下问题卡（接受/忽略/回到列表）、没有范围内行左侧色条、没有「问题 N / M」上下跳转；圆点点击只做定位。
- **原因**：前端未实现行下卡片与导航（C4/C5）。
- **影响**：g33 检查点大部分不成立；用户必须跳到审查页签处理问题，diff 与问题的联动价值降低。
- **建议**：在 diff 命中行下渲染问题卡（复用审查页问题组件，接受/忽略直接调 finding 更新命令），补左侧色条与问题导航。
- **验证**：静态。
- **关联状态**：`g33-review-in-diff`

### GIT-10: 分支 / 合并请求被放进中栏，与设计的「右栏视图」不同
- **严重度**：P2
- **维度**：结构
- **类别**：结构
- **设计依据**：`sources/git/STATES.md:23`（g10 三栏：左栏过滤、中栏提交列表、右栏提交详情）；`:29`（g16「左栏切到"分支"时右栏显示分支表」）；`:30`（g17 合并请求列表与详情）；mock `originals/git/assets/git.js:861-909`（branchesView/mrView 替换右栏；中栏 commitList 保留）。
- **实现位置**：`apps/web/src/pages/git/RepoWorkbench.tsx:584-607`（分支/MR 渲染在 `.git-mid` 中栏）、`:611-658`（右栏显示单个分支/MR 详情）；`:530-609`（中栏页签切换）。
- **差异**：设计是「左栏切换，右栏整表/详情，中栏提交列表保持」；实现是「中栏被分支表/MR 列表替换，右栏显示选中项详情」。前者便于对照提交列表筛选，后者在切换分支/MR 后提交列表消失。
- **原因**：布局按产品三栏组件复刻，忽略设计的分区语义（C4）。
- **影响**：g16/g17 的布局与检查点「点提交进入提交详情（左栏切回提交）」不完全成立；用户无法在查看分支/MR 时同时看到提交列表。
- **建议**：把分支表/MR 列表放到右栏（或可切换的右栏页签），中栏保持提交列表；点分支=筛选中栏提交，点 MR 提交=中栏选中该提交并切回提交详情。
- **验证**：静态；布局需GUI。
- **关联状态**：`g16-branches`, `g17-merge-requests`

### GIT-11: 大文件 / 二进制 / 重命名的边界信息不全
- **严重度**：P2
- **维度**：D / T
- **类别**：数据契约
- **设计依据**：`sources/git/STATES.md:31`（g18「1,240 行种子数据只显示前 400 行（加载全部）；二进制只给大小；重命名显示 old → new 与相似度；只改权限显示 100644 → 100755」）；`sources/git/API-DESIGN.md:282-293`（FileChange 含 `similarity?`、`binary` 与大小类、mode）；`:664`（BINARY_FILE「显示大小变化」）。
- **实现位置**：`apps/web/src/pages/git/DiffViewer.tsx:264-281`（重命名/权限文案）、`:283-290`（二进制）；`packages/shared/src/domain/models.ts:873-886`（`FileChange` 只有 binary 布尔、无相似度/二进制前后大小）。
- **差异**：二进制只说「不显示差异」未给大小变化；重命名显示 old→new 但无相似度；截断/加载全部有且数据驱动（`sizeClass`/truncated.nextCursor），已是设计口径。
- **原因**：契约缺字段（C1）。
- **影响**：g18 的二进制与重命名检查点不成立；评审大文件时缺少「这文件多大、改名相似度」的判断依据。
- **建议**：契约补 `similarity` 与二进制 before/after 大小；UI 在对应条纹/行下补展示。
- **验证**：静态 + 需真实大仓库数据。
- **关联状态**：`g18-large-binary`

### GIT-12: 合并请求详情缺概要（描述）与提交列表
- **严重度**：P2
- **维度**：结构 / S
- **类别**：结构 / 数据契约
- **设计依据**：`sources/git/STATES.md:30`（g17「点开显示概要和提交，点提交进入提交详情」）；mock `originals/git/assets/git.js:874-891`（mrView：描述 + 提交列表 + 点提交跳详情）；`sources/git/API-DESIGN.md:316-325`（MergeRequest 设计含 `commits[]`，仅详情返回）。
- **实现位置**：`apps/web/src/pages/git/MergeRequestsPanel.tsx:116-186`（详情只有事实格与说明）；`packages/shared/src/domain/models.ts:1114-1127`（`GitMergeRequest` 无 description/commits）。
- **差异**：列表/详情只显示状态事实（分支、流水线、审批、链接），没有 MR 概要、没有提交列表，因此也无法从 MR 点进提交详情。
- **原因**：契约缺字段（C1）；前端未请求详情（C2）。
- **影响**：g17 的「概要 + 提交」检查点不成立，MR 详情信息量低于设计。
- **建议**：读口补 `description` 与 `commits[{sha, subject, presentLocally}]`；详情内提交行可点击并在中栏选中/打开提交详情。
- **验证**：静态 + 需 GitLab 连接。
- **关联状态**：`g17-merge-requests`

### GIT-13: 分支表缺「关联合并请求」列
- **严重度**：P2
- **维度**：T / D
- **类别**：数据契约
- **设计依据**：`sources/git/STATES.md:29`（g16「是否当前、相对默认分支领先 / 落后、最后提交、关联合并请求、保护分支锁」）；`sources/git/API-DESIGN.md:307-315`（Branch 设计含 `mergeRequest?: { iid, state }`）。
- **实现位置**：`apps/web/src/pages/git/BranchesPanel.tsx:58-107`（无 MR 列）；`:78-103`（tip/upstream/ahead-behind/保护/检出）；`packages/shared/src/domain/models.ts:1101-1112`（`GitBranch` 无 mergeRequest）。
- **差异**：分支表有保护锁、当前分支、upstream、相对默认分支、最后提交；唯独没有「关联合并请求」。
- **原因**：契约缺字段（C1）。
- **影响**：g16 检查点部分不成立；用户无法从分支看出「这个分支要合到哪、有没有打开的 MR」。
- **建议**：契约补 branch.mergeRequest，表格加「合并请求」列并链到 MR 详情。
- **验证**：静态 + 需 GitLab。
- **关联状态**：`g16-branches`

### GIT-14: GitLab 未配置时工作台未按设计禁用远端能力
- **严重度**：P2
- **维度**：A / D
- **类别**：状态 / 交互
- **设计依据**：`sources/git/STATES.md:36`（g23「本地提交可浏览；合并请求、远端分支、获取远端更新不可用，并就地说明去设置」）；`:16`（g02 同上）；`sources/git/README.md:63-64`（GitLab 未配置：本地浏览仍可用，远端相关功能禁用并引导去设置）。
- **实现位置**：`apps/web/src/pages/git/RepoWorkbench.tsx:396-406`（获取按钮仅在 `repo.remote === undefined` 时禁用）；`:517-527`（分支页脚只写文案）；`MergeRequestsPanel.tsx:34-46`（MR 有引导空态）；`BranchesPanel.tsx:19-116`（远端组无禁用态）。
- **差异**：「获取远端更新」在 GitLab 未配置但存在 remote 时仍可点；远端分支整组未标不可用；只有 MR 页签做了引导。
- **原因**：前端只看 remote 是否存在，未结合 `repo.gitlab`（C2/C6）。
- **影响**：g23 检查点「获取远端更新禁用并说明」「远端分支整组不可用」不成立，用户可能触发必然失败的远端命令。
- **建议**：远端能力统一由 `repo.gitlab === 'connected'` 控制禁用并写原因；BranchesPanel 对远端组展示不可用说明；拉取按钮 tooltip 指向设置。
- **验证**：静态。
- **关联状态**：`g23-wb-no-gitlab`, `g02-no-gitlab`

### GIT-15: Git 能力未接入被渲染成红色错误
- **严重度**：P2
- **维度**：V / T / D
- **类别**：状态 / 样式主题
- **设计依据**：`sources/git/STATES.md:17`（g03「整页说明，不是错误：用 unknown 虚线风格」「不出现红色错误样式」）；`sources/git/README.md:63`（「Git 能力未接入：整页说明，不按错误处理」）；`sources/git/API-DESIGN.md:649`（GIT_CAPABILITY_UNAVAILABLE → unknown 虚线样式）。
- **实现位置**：`apps/web/src/pages/git/GitOverview.tsx:198-209`（错误分支用 `UnavailablePanel`）；`apps/web/src/pages/git/git-shared.tsx:446-451`（`FailureNotice` 对 `not_connected` 用 danger 色调）、`:481-508`（UnavailablePanel 同样依据 `not_connected` 给 lock/alert + danger 语义）；`apps/web/src/api/git.ts:103-114`（CAPABILITY_UNAVAILABLE/NOT_IMPLEMENTED → not_connected）。
- **差异**：`capability.allowed === false` 时横幅是 unknown 中性（符合）；但接口以 404/`CAPABILITY_UNAVAILABLE` 返回时整页走红色错误面板，与设计「不是错误」冲突。
- **原因**：错误分类把「能力未接入」和「服务未连接」合并成 not_connected，并按错误样式渲染（C6/C7）。
- **影响**：g03 的「不出现红色错误样式」检查点可能失败；用户会把未接入理解成故障。
- **建议**：区分 `capability_unavailable`（unknown 虚线整页 + 接入说明）与 `service_unavailable`（红色断开）；两者都不显示假数据。
- **验证**：静态。
- **关联状态**：`g03-capability-missing`

### GIT-16: 响应式断点与设计补充图不符（1280 图标左栏 / 1024 抽屉）
- **严重度**：P2
- **维度**：V / 结构
- **类别**：样式主题
- **设计依据**：`sources/git/STATES.md:85-86`（交互后补充图：「1280×800：左栏收为图标条，点"筛选"浮出完整左栏」「1024×768：提交列表收成抽屉，从提交详情页头"提交列表"打开」）；`sources/git/README.md:31`（「窄屏：左栏收成图标条，再窄时提交列表变抽屉」）。
- **实现位置**：`apps/web/src/pages/git/git.css:269-288`（≤1180 缩为 172/320 三栏；≤1000 变两栏并隐藏详情，`.detail-open` 单栏）；无图标条、无筛选浮层、无「提交列表」抽屉触发器（仅 `CommitDetail.tsx:186-189` 有移动端返回按钮）。
- **差异**：设计的两级窄屏形态（图标条 / 提交列表抽屉）未实现；当前是缩窄与隐藏详情。
- **原因**：响应式实现简化（C7/C4）。
- **影响**：1280/1024 两个补充图状态不成立；窄屏下左栏占用宽度、详情需要额外返回。
- **建议**：按断点实现图标条 + 筛选浮层、提交列表抽屉；用 `only-narrow` 复用现有类。
- **验证**：需GUI（1280/1024 + 四主题）。
- **关联状态**：`g10-commits`, `g11-commit-detail`

### GIT-17: 读取失败时 diff 不保留已加载内容
- **严重度**：P2
- **维度**：S / D
- **类别**：状态
- **设计依据**：`sources/git/STATES.md:34`（g21「读取失败只影响失败的那一块：加载更早的提交失败时列表保留已加载的 14 个提交；某个文件的差异读取失败时其他文件照常。都给重试」）；`sources/git/API-DESIGN.md:669`（READ_FAILED → 保留已加载内容 + 读取时间 + 重新读取）。
- **实现位置**：`apps/web/src/pages/git/DiffViewer.tsx:299-301`（`diffQuery.isError` 时用 `FailureNotice` 替换整个 diff 区，包括已加载的 hunks）；`CommitList.tsx:149-160`（加载更多失败保留列表，符合）；`RepoWorkbench.tsx:550-567`（分块失败保留，符合）。
- **差异**：diff 单文件读取失败会清空此前已加载的内容；设计要求保留已加载内容并标读取时间。列表/分支/MR 分块失败已按设计保留。
- **原因**：diff 失败分支没有「保留已加载」逻辑（C2）。
- **影响**：g21 的 diff 子检查点不成立；网络抖动会丢掉已加载的大 diff。
- **建议**：缓存上一次成功 hunks，失败时在顶部加错误条并保留内容 +「重新读取」，标出内容读取时间。
- **验证**：静态 + 需真实服务故障。
- **关联状态**：`g21-read-error`

### GIT-18: 审查无问题时维度打勾与修复页签可用性
- **严重度**：P2
- **维度**：T / 结构
- **类别**：状态 / 数据契约
- **设计依据**：`sources/git/STATES.md:48`（g34「结论卡给出肯定结论，维度清单逐项打勾；修复页签不可用（没有问题可修）」）；mock `originals/git/assets/git.js:714-721`（cleanCard 六维逐项 check）。
- **实现位置**：`apps/web/src/pages/git/ReviewPanel.tsx:369-375`（空态）、`:315-331`（维度计数徽标，0 也照常展示）；`CommitDetail.tsx:276-278`（修复页签始终可点）；`packages/shared/src/domain/models.ts:1150-1171`（`ReviewRun.summary` 只有 countsByDimension，无 coverage）。
- **差异**：无问题的维度显示为「计数 0」而不是逐项打勾；修复页签仍可进入（进去后要求先选问题）。
- **原因**：契约缺 coverage（C1）；前端未做「无问题时禁用修复页签」（C2）。
- **影响**：g34 两个检查点不成立；「0 个问题」与「已检查该维度」语义没有区分。
- **建议**：无 finding 时按 dimension 渲染逐项 ✓；修复页签在审查完成且无问题时禁用并写原因。
- **验证**：静态。
- **关联状态**：`g34-review-clean`

### GIT-19: 审查入口与「提交并推送」形态与设计不同
- **严重度**：P2
- **维度**：A / 结构
- **类别**：交互
- **设计依据**：`sources/git/STATES.md:24`（g11「主按钮"AI 审查此提交"」打开审查设置抽屉）；`:67`（g50「split button 主动作"提交到 …"，下拉"提交并推送"」）；mock `originals/git/assets/git.js:774-792`（split button 与下拉）、`:922-936`（审查抽屉由主按钮打开）。
- **实现位置**：`apps/web/src/pages/git/CommitDetail.tsx:211-213`（按钮只 `setTab('review')`，还需再点「开始审查」）；`apps/web/src/pages/git/FixPanel.tsx:782-798`（提交弹窗内两个按钮「只提交 / 提交（完成后确认推送）」，不是 split button）。
- **差异**：主按钮到审查设置多一步；split button 换成弹窗内双按钮。两者功能可达，但结构与设计不一致。
- **原因**：交互实现路径不同（C5/C4）。
- **建议**：主按钮直接打开审查抽屉；提交步骤使用 split button（主按钮 + 下拉「提交并推送」），保留两次独立命令与「提交 UNKNOWN 不推送」规则。
- **验证**：静态。
- **关联状态**：`g11-commit-detail`, `g50-commit`

### GIT-20: 全宽/并排联动与面包屑身份
- **严重度**：P2
- **维度**：A / 结构
- **类别**：交互 / 结构
- **设计依据**：`sources/git/STATES.md:26`（g13 检查「切回统一视图不自动退出全宽」）；`:27`（g14「面包屑旁保留提交身份，Esc 或"退出全宽"回到三栏，选中与滚动位置保持」）；mock `originals/git/assets/git.js:456-479`（full-bar 含 commit sha/msg）、`:625-638`（fullBar）。
- **实现位置**：`apps/web/src/pages/git/DiffViewer.tsx:232-245`（切 split 自动全宽；切回 unified 时主动 `onToggleFullscreen()` 退出全宽）；`CommitDetail.tsx:107-125`（全宽状态与 Esc）、`:184-189`（无全宽面包屑条）。
- **差异**：设计明确「切回统一不自动退出全宽」，实现会自动退出；全宽态没有「全宽阅读 · 提交 sha + 标题 · Esc · 退出全宽」的顶部条。
- **原因**：交互联动实现与设计检查相反（C5）；全宽头部缺失（C4）。
- **影响**：g13/g14 两个检查点不成立；全宽时用户不知道当前阅读的是哪个提交。
- **建议**：切回统一保留全宽；全宽顶部加提交身份条与退出按钮；Esc 行为保持。
- **验证**：需GUI。
- **关联状态**：`g13-diff-split`, `g14-diff-full`

### GIT-21: 页头事实缺未提交改动 chip 与 stale 标注
- **严重度**：P3
- **维度**：T / D
- **类别**：文案 / 状态
- **设计依据**：`sources/git/STATES.md:23`（g10 页头含当前分支、领先/落后、上次获取）；`:16`（g02/g22「领先 / 落后保持上次已知值并标注」）；mock `originals/git/assets/git.js:183-206`（header：chip、ahead/behind、gh-at、gh-dirty「N 个未提交改动」）。
- **实现位置**：`apps/web/src/pages/git/RepoWorkbench.tsx:389-395`（与远端差异/上次获取/浅克隆/进行中操作，无未提交改动）；`:440-451`（只在空仓库横幅提到未提交数）。
- **差异**：未提交改动数没有作为页头事实展示（只有空仓库场景出现）；获取失败后 ahead/behind 没有「10:42 的数据」stale 样式与提示。
- **原因**：前端未消费 `status.workingTree.uncommitted` 到页头（C2/C3）。
- **影响**：g10 页头检查点缺少「3 个未提交改动（只读提示）」；g22 的 stale 标注检查点不成立。
- **建议**：页头补「N 个未提交改动（只读提示）」；`lastFetchAt` 与获取失败时给 ahead/behind 加 stale 小标。
- **验证**：静态。
- **关联状态**：`g10-commits`, `g22-fetch-auth-fail`, `g02-no-gitlab`

### GIT-22: 不可用卡片/路径展示与设计检查细节
- **严重度**：P3
- **维度**：结构 / T
- **类别**：结构 / 文案
- **设计依据**：`sources/git/STATES.md:15`（g01 检查「运营报表脚本 / 支付网关的"进入"禁用并说明原因」）；`:38`（g25 检查「路径以 mono 显示」）；mock `originals/git/assets/git.js:219-266`（卡片不可用时的禁用进入按钮、notGit/unavail 路径 mono 展示）。
- **实现位置**：`apps/web/src/pages/git/GitOverview.tsx:149-158`（可用/不可用卡片页脚：可用是 span「打开工作台」，不可用是「查看项目」链接）；`RepoWorkbench.tsx:329-358`（不可用视图未显示 `repo.displayRoot`）。
- **差异**：不可用卡片没有设计「进入」按钮的禁用态+原因，而是换成「查看项目」；工作台路径不可用视图未以 mono 展示具体路径。
- **原因**：替代实现（C4/C3）。
- **影响**：g01/g25 局部检查点不成立；用户仍能从原因文字与链接找到出路。
- **建议**：保留禁用「进入」并给原因，另放「查看项目」；不可用视图展示 mono 路径。
- **验证**：静态。
- **关联状态**：`g01-overview`, `g24-not-git`, `g25-path-unavailable`

### GIT-23: 空仓库工作台缺 GitLab 未绑定提示
- **严重度**：P3
- **维度**：T / 结构
- **类别**：文案
- **设计依据**：`sources/git/STATES.md:32`（g19「不显示图谱和详情空架子，直接说明，并提示工作区里已有 12 个未提交文件（只读）」「GitLab 未绑定的提示与出路」）；mock `originals/git/assets/git.js:893-909`（空仓库 workbench 两段 lockline）。
- **实现位置**：`RepoWorkbench.tsx:446-451`（空仓库横幅，含未提交数，无 GitLab 绑定说明）；`GitOverview.tsx:109-111`（卡片只写空仓库与首次提交）。
- **差异**：空仓库有未提交数说明，但缺「到这个项目 → Git 与 GitLab 绑定后可读取远端与 MR」的出路。
- **原因**：细节缺失（C3/C4）。
- **影响**：g19 第二检查点不成立。
- **建议**：空仓库空态补 GitLab 未绑定提示与去绑定入口（读 `repo.gitlab`/project 配置）。
- **验证**：静态。
- **关联状态**：`g19-empty-repo`

### GIT-24: 评审人、已修复徽标等候选能力缺口（C9）
- **严重度**：P3
- **维度**：D
- **类别**：范围 / 数据契约
- **设计依据**：`sources/git/STATES.md:71-72`（MR 可指派评审人）；`:72`（g55 检查「列表中 a1b2c3d 徽标变为"已修复"」）；`sources/git/API-DESIGN.md:680-710`（§7：指派评审人、MR 模板为可选候选 P3）；`sources/git/README.md:87-92`（分期：直接合并/流水线为 P3）。
- **实现位置**：`FixPanel.tsx:918`（「评审人 暂未接通（非必填）」）；`packages/shared/src/domain/models.ts:1150-1171`（ReviewRunState 无 fixed 状态）、`:1075-1090`（commit review badge state 取 ReviewRunState）。
- **差异**：评审人字段未接通（设计本身列为候选 P3，属设计缺口而非实现缺陷）；「已修复」徽标没有数据来源。
- **原因**：设计分期/候选未冻结（C9）。
- **影响**：g55 的「已修复徽标」与 MR 评审人展示不成立；不算功能缺陷，记录为设计缺口。
- **建议**：评审人待 GitLab members 能力冻结后补；「已修复」由 review/fix 投影衍生（例如 fix 已创建 MR 时展示），或明确去掉该设计点。
- **验证**：静态。
- **关联状态**：`g54-merge-choose`, `g55-mr-created`

### GIT-25: 文案细节漂移
- **严重度**：P3
- **维度**：T
- **类别**：文案
- **设计依据**：`sources/git/STATES.md:15-78` 各状态文案；mock `originals/git/assets/git.js:183-266`（页头/概览）、`:722-763`（修复）、`:764-859`（下一步）。
- **实现位置**：`GitOverview.tsx:228-257`（「在浏览器打开」vs 设计「在 GitLab 打开」）；`RepoWorkbench.tsx:389-395`（「与远端差异未知」vs 设计「领先/落后」）；`FixPanel.tsx:680`（「④ 合并回基线分支」vs 设计「③ 合并修复」）；`FixPanel.tsx:918`（「暂未接通」）。
- **差异**：多处措辞与设计原文不同（按钮名、步骤名、状态词），不影响功能但影响逐字验收与一致性。
- **原因**：C3。
- **影响**：P3 细节。
- **建议**：统一到设计词表（或共享 labels），尤其步骤编号与按钮名。
- **验证**：静态。
- **关联状态**：多个

### GIT-26: 旧文档口径与当前实现不一致（C10，报 Lead）
- **严重度**：P3
- **维度**：D
- **类别**：文档口径
- **设计依据**：`docs/design-coverage.md:171`（Git 仓库 ✅「三栏/三页签/diff/审查/修复/交付齐全」）；`docs/review/design-parity.md:107-113`（§2.7「基本对齐」「未发现结构性缺口，只余文案/细节级差异」）。
- **实现位置**：本报告 GIT-01~GIT-20 的结构与状态差异（图谱、diff 展开/着色、合并方式、审查历史/分组、失败出路、布局分区等）。
- **差异**：旧文档把 Git 页记为基本对齐/齐全，与当前代码与设计逐项对比结果不符（尤其 g10/g12/g54 与多个失败态）。
- **原因**：C10（历史口径未随实现更新/覆盖矩阵过度声称）。
- **影响**：作为线索会误导排期与验收；不占主清单。
- **建议**：由 Lead 统一更新 `design-coverage.md`/`design-parity.md` 的 Git 行，引用本报告 GIT 编号与证据。
- **验证**：静态。
- **关联状态**：全部

## 已核对一致

- **入口与路由**：侧栏「Git 仓库」→ `/git`，工作台 `/git/:projectId`，项目切换下拉（`RepoWorkbench.tsx:371-384`）与「所有仓库」返回（`:363-366`），与设计入口一致（`sources/git/README.md:21`）。
- **仓库概览结构**：GitLab 连接条（状态/主机/账号/去设置）+ 已登记项目卡片六项事实 + 不可用原因与出路（`GitOverview.tsx:228-291`、`:39-171`），与 g01 的「所有已登记项目一张卡」一致（`STATES.md:15`）。
- **只读边界**：浏览、复制 SHA、查看 diff/分支/MR 均不写仓库；页面没有直接调用 MCP/git，全部经应用服务读口（`apps/web/src/api/git.ts:1-11`；设计 `sources/git/README.md:76`、`API-DESIGN.md:0.4`）。
- **三栏基础结构**：左栏页签+筛选、中栏列表、右栏详情，`.git-wb-body` 三列（`git.css:255-262`；`RepoWorkbench.tsx:454-658`），骨架与 `sources/git/README.md:25-31` 一致（分支/MR 分区差异见 GIT-10）。
- **提交列表基础**：按日期分组、refs 徽标（HEAD/本地/远端/tag）、审查徽标、加载更早/游标分页、浅克隆边界不提供加载更早（`CommitList.tsx:92-161`），与 g10/g20 一致（图谱缺失见 GIT-01）。
- **提交详情头部**：标题/正文、作者/提交者/时间、完整 SHA 复制、父提交、包含分支、统计、合并提交对比基线（`CommitDetail.tsx:191-267`；`ShaCopy` 实现复制 `git-shared.tsx:391-418`），与 g11/g15 一致。
- **提交详情三页签**：改动文件 / AI 审查 / 修复（`CommitDetail.tsx:269-280`），与 `sources/git/README.md:30` 一致。
- **diff 基础能力**：统一/并排切换、并排自动全宽、忽略空白、hunk 收起/展开、双列行号、二进制/权限/重命名标注、截断 + 加载全部、Esc 退出全宽（`DiffViewer.tsx:142-161,232-262,283-290,306-409`；`CommitDetail.tsx:107-125`），与 g12/g13/g14/g18 的骨架一致（展开上下文/语法色/行内高亮缺失见 GIT-02）。
- **审查设置四项**：范围（含父提交/目标分支选项）、维度多选默认全选、审查职业（已发布修订）、上下文（只读改动 / 改动+相关文件），并写清「审查只读」；维度为空或职业缺失时禁用并给原因（`ReviewPanel.tsx:456-599`、`:200-211`），与 g30 一致。
- **审查结果骨架**：结论摘要 + 严重度/维度计数 + 审查对象 + 问题列表（位置/说明/接受/忽略/误报/恢复待处理/选入修复）+ 底部固定栏（`ReviewPanel.tsx:287-452`），与 g32 的主要结构一致（历史/分组/建议 patch 缺失见 GIT-04）。
- **问题状态写操作与禁用原因**：接受/忽略/误报通过 `review.finding.update` 写出，忽略/误报不可选入修复；按钮禁用带原因（`ReviewPanel.tsx:124-135,409-434`），与设计一致。
- **修复确认（隔离语义）**：确认框写清「新修复分支/基于基线最新提交而非审查提交/不改动当前工作区/修复职业/校验来源」（`FixPanel.tsx:726-780`、`:741-773`），与 g40 核心一致。
- **修复结果**：逐问题 fixed/partial/not_fixed + relocation（位置一致/已移动/找不到）+ reason；修复 diff 可打开、单文件可撤销；校验通过/失败/未配置三态（`FixPanel.tsx:518-569`、`:510-516`），与 g42 核心一致。
- **提交→推送→创建 MR 不自动连锁**：提交弹窗拆分「只提交 / 提交后确认推送」，推送/创建 MR 各自独立确认；提交回执 UNKNOWN 不继续（`FixPanel.tsx:238-262,782-798`），与 `sources/git/API-DESIGN.md:177-188` 的「不连锁」一致。
- **推送永不强推**：推送确认弹窗写明「只创建新远端分支：远端已有同名分支即停止，永不强推、不覆盖」（`FixPanel.tsx:848-876`），与设计一致。
- **UNKNOWN 只核对不重发**：所有写命令保留原 requestKey 回执，UNKNOWN 时只显示「核对原操作」并按 `operations.by-key` 结算（`git-shared.tsx:527-602`；`RepoWorkbench.tsx:424-438`；`FixPanel.tsx:494-508`），与 `API-DESIGN.md:184-188` 一致（g57 已实现）。
- **放弃修复确认**：删除本地修复分支/副本、已推送远端分支不删除、审查记录保留，危险按钮（`FixPanel.tsx:975-1001`），与 g58 一致。
- **空仓库 / 不受 Git 管理 / 路径不可用**：不显示假图谱/假详情，用 `UnavailablePanel` 说明原因与出路（`RepoWorkbench.tsx:329-358,446-451`；`GitOverview.tsx:109-133`），与 g19/g24/g25 的诚实降级一致。
- **数据诚实**：接口未接通/读取失败时显示原因与错误码，不显示示例数据（`api/git.ts:94-136`；`git-shared.tsx:442-508`），符合设计「离线样例只证明画面」的边界。
- **状态不只靠颜色**：状态徽标均带图标+文字（`git-shared.tsx:37-49,199-254,282-300`）。
- **主题 token**：`git.css` 300 处使用 `var(--*)`、无硬编码颜色（grep 无 hex/rgb/hsl），四主题可继承。
- **对话框焦点**：Modal/Drawer 有 `role=dialog`、`aria-modal`、Esc 关闭与焦点归还（`components/Modal.tsx:14-41`、`Drawer.tsx:22-47`）。

## 需 GUI / 运行验证

1. **44 状态 × 四主题视觉**：1440/1280/1024 三档下的三栏宽度（212/372/…，`git.css:255-262`）、全宽 diff、概览卡片网格与四主题渲染。
2. **响应式两级形态**：1280 是否应收成图标左栏、1024 提交列表抽屉（当前未实现，修复后需GUI复核，GIT-16）。
3. **全宽/并排联动**：切并排自动全宽、切回统一是否按设计保留全宽；全宽时选中文件与 diff 滚动位置是否保持（GIT-20）。
4. **图谱**：若按建议补泳道，需在真实多分支历史下目检分叉/合流与日期分组的续接（GIT-01）。
5. **审查运行中**：阶段推进（reading_diff→analyzing→summarizing）、已用时间、停止确认与停止后保留（GIT-05）。
6. **修复运行中**：阶段条/日志实时追加、写操作锁定、停止后分支保留（GIT-07）。
7. **写操作失败态**：真实 hook 拒绝输出、推送被拒（non-fast-forward）、认证失败、MR 已存在、直接合并冲突的文案与可操作按钮（GIT-06）。
8. **直接合并前提**：保护分支 / 当前检出 / 工作区改动 / 不可快进四种情况下禁用与原因（当前无 UI，GIT-03；需 GitLab 与多分支仓库）。
9. **读取失败保留**：列表分页失败保留已加载、diff 失败保留已加载内容与读取时间（GIT-17）。
10. **真实远端/模型**：GitHub/GitLab 只读、审查真实模型、修复真实 workspace、推送/MR 真实副作用（本批只做静态审计，未运行模型/远端/写操作；E01/E14/E15 证据不在本批范围内复用为完成结论）。

## 未覆盖 / 说明

- **未逐张比对设计 PNG**：本报告依据 `STATES.md`、`README.md`、`API-DESIGN.md` 文本规格与 `originals/git/assets/git.js`/`fixtures.js` 渲染逻辑判定，未读取 `sources/git/design/*.png` 逐像素比对；像素级视觉与四主题对照留 GUI 批。
- **未运行 GUI / 未调用模型 / 未连接真实 Git/GitLab**：本批为静态代码审计；`review.start`/`fix.*`/`git.fetch` 等命令的真实副作用、hook 输出、远端错误码与回执未知时序均未实际触发。
- **设计候选/分期项的判定**：评审人指派、MR 模板、直接合并（P3）、流水线状态属于设计 §7 待确认或分期候选（`API-DESIGN.md:680-710`、`README.md:87-92`），本报告把「未接通」记为 C9 设计缺口而非实现缺陷（GIT-24）；若产品决定纳入本批，需要新契约字段后再验收。
- **任务页边界**：`/tasks/:taskId` 的交付面板与 Git 页的 `src/api/git.ts` 交付命令区（`:472-637`）属交付区域（15-delivery），本报告只审计 Git 页使用部分。
- **E01/E14/E15 只作线索**：既有 Git/节点真实读写与原生下载证据（`docs/review/design-parity.md`、`docs/review/node-artifacts-2026-10-20.md`、`docs/verification/2026-10-20-node-detail-read.md`）仅用于定位方向；本报告全部条目以当前 main 代码复核后记录，未复跑其 GUI/真实远端证据。
- **旧文档口径（C10）**：见 GIT-26（`docs/design-coverage.md:171`、`docs/review/design-parity.md:107-113`），由 Lead 统一更新，不占主清单。
