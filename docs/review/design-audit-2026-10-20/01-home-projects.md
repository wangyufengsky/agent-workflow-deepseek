# P01 主页 + P02 项目/项目详情 前端设计一致性审计

> 基线：main @ `3f6f9b2`（2026-10-20）。范围：`opencode-workflow-design-showcase/originals/main/pages/{home,projects}.html`（含页面内 `?state=` 分支、inline `<style>`、渲染脚本、`DS.mount` 状态注册表）与 planning 补充入口态 `e-home`（`sources/planning/STATES.md:133`）vs 实现 `apps/web/src/pages/{home,projects}/`、路由 `/`、`/projects`、`/projects/:projectId`（`apps/web/src/app/App.tsx:37-48`）。审计方式：静态代码 vs 只读设计稿；未运行 GUI 的部分标注“需GUI”。旧审查文档只作线索，结论均已在当前代码核实（见「未覆盖 / 说明」C10 条）。

## 概览

| 页面 | 设计状态数 | 已逐项核对 | P0 | P1 | P2 | P3 | 结论 |
|---|---|---|---|---|---|---|---|
| P01 主页（`home.html`） | 0 注册（单页）+ planning `e-home` 1 | 是 | 0 | 0 | 1 | 1 | 与设计基本一致，仅行提示信息降级与样式间距偏差 |
| P02 项目/项目详情（`projects.html`） | 16（`projects.html:302-306`） | 是 | 0 | 0 | 10 | 9 | 与设计有偏差：卡片事实条/筛选/公约页签/登记抽屉等关键结构待修 |

**最重要的问题（≤5 条）**
1. `P02-03` 项目卡与详情把 `capability_unavailable` 当“路径不可用”禁用「开始任务/模板任务」，而服务端创建任务只校验项目是否归档，用户无法对可读项目发起任务。
2. `P02-01` 项目卡片事实条由设计的三格单行（当前分支/技术栈/任务总数）变成 2×2 四格（进行中任务/需要处理），且缺“N 个运行中”徽标。
3. `P02-05` 项目公约“草稿已就绪”态缺设计要求的差异审阅（+N 行 / diff）与「放弃草稿」，写入前无法看清将变更什么。
4. `P02-04` 项目公约页签缺设计的「生成步骤」时间线；对应 CSS 已写好（`project-detail.css:126-179`）但没有任何 JSX 引用。
5. `P02-07` 登记项目抽屉关闭（X/Esc/遮罩/取消）不确认未保存输入，直接复位丢失，设计有「放弃未登记的内容？」对话框。

## 状态覆盖

### P01 主页（`originals/main/pages/home.html`，`DS.mount` 无 states）

| mock state | 设计名称 | 实现判定 | 证据（实现文件:行 / 无） | 说明 |
|---|---|---|---|---|
| （无 states 注册） | 主页单页：hero + 进行中卡 + 流程演示 + 能力卡/入口 + 底部 CTA | 已实现 | `home.html:151`（DS.mount 无 states）；`apps/web/src/pages/home/HomePage.tsx:11-37`；`HomeCapabilities.tsx:87-135`；`HomeFlowDemo.tsx:113-174` | 设计页面为纯展示单页，无 `?state=` 分支 |
| `e-home`（planning 补充） | 主页·冷启动 | 已实现 | `sources/planning/STATES.md:133`；`HomeOngoing.tsx:12-19`；`apps/web/src/app/taskStatus.ts:168-174` | “进行中”卡片里的规划/确认阶段任务直达 `/requirement/:id`，其余进 `/tasks/:id`；真实数据来自 `fetchTaskPage({ongoing:true,limit:3})` |
| （实现新增，设计未定义） | 进行中卡：加载 / 读取失败 / 空 | 已实现（诚实降级） | `HomeOngoing.tsx:16` | 设计单页无这些态；实现显示骨架/`ServiceNotice`/“当前没有进行中的任务”，未伪造数据 |
| （演示内部阶段，非 state） | 流程演示 5 阶段循环、暂停/播放、点阶段停留、减少动效 | 已实现 | `home.html:150-180`；`HomeFlowDemo.tsx:15-46,78-176` | 常量/节奏/caption/阶段文案逐项一致；动效与可见性暂停需 GUI |

### P02 项目/项目详情（`originals/main/pages/projects.html`）

| mock state | 设计名称 | 实现判定 | 证据（实现文件:行 / 无） | 说明 |
|---|---|---|---|---|
| `list` | 列表 | 已实现 | `ProjectsPage.tsx:436-442`、`67-176` | 整卡可点/键盘 Enter/`aria-label` 与设计一致（`:73`）；卡片事实条与筛选标签见 P02-01/02 |
| `list-loading` | 列表·加载中 | 已实现 | `ProjectsPage.tsx:392-408` | 骨架卡 2 张 vs 设计 4 张（P02-16） |
| `list-error` | 列表·读取失败 | 已实现 | `ProjectsPage.tsx:409-417`；`components/ServiceNotice.tsx:20-23` | 有重试；文案与设计不一致（P02-08） |
| `list-empty` | 列表·无项目 | 已实现 | `ProjectsPage.tsx:418-432` | 标题/动作一致，描述多一句（P02-16） |
| `register` | 登记项目（480 抽屉） | 部分 | `ProjectsPage.tsx:565-704`（`size="md"` `:568`；`ds.css:88,297` = 480px） | 目录/名称/说明/绝对路径校验/自动填名/按钮禁用原因一致；缺“更多·文档目录”（P02-06）与关闭确认（P02-07） |
| `reg-unknown` | 登记结果未明 | 已实现 | `ProjectsPage.tsx:244-245,310-312,366-389,481-495,621-639` | 用原 requestKey 走 `GET /api/operations/:key` 核对、不重复登记，符合设计“核对前不会重复登记”；横幅样式为 unknown banner 而非设计内联 spinner |
| `unmanage` | 取消管理确认 | 已实现（产品扩展：归档/恢复） | `ProjectsPage.tsx:447`；入口 `:172` | 设计语义为从列表移除；实现为归档（默认隐藏、可显示/恢复），文件不删除一致；样式/文案偏差见 P02-17 |
| `detail` | 详情·概览 | 部分 | `ProjectDetailPage.tsx:1483-1553`；配置状态 `1102-1243` | 两栏 1fr+360px、四页签、配置状态清单均在；头部/概览细节与配置状态语义见 P02-11/12 |
| `detail-git` | 详情·Git 账号 | 部分 | `ProjectDetailPage.tsx:522-545`；`ProjectGitAccount.tsx:92-101` | 继承/独立、认证方式、验证用仓库地址、验证不保存均实现；表单结构与设计不同（P02-14） |
| `detail-git-custom` | 详情·Git 单独配置 | 已实现 | `ProjectGitAccount.tsx:93-95` | 选“此项目单独配置”后出现 Provider/认证方式/用户名/凭据/验证仓库；设计无 Provider 选择（产品扩展） |
| `detail-gitlab` | 详情·GitLab 与证据 | 部分 | `ProjectDetailPage.tsx:547-617`、`369-432`；`ProjectEvidence.tsx:5` | 证据来源（类型/路径/移除/添加/上限 16/切换类型清空）、检查绑定前置保存均实现；设计的“搜索 GitLab 项目”退化为手填（P02-09） |
| `detail-docs` | 详情·文档路径 | 部分 | `ProjectDetailPage.tsx:633-761` | 保存/放弃/实际位置预览一致；单目录输入变多路径列表（产品扩展，P02-15） |
| `detail-conv` | 公约·未生成 | 部分 | `ProjectDetailPage.tsx:941-1048` | 有生成草稿 CTA/编辑器；无设计空态标题与右侧步骤条（P02-04/13） |
| `conv-running` | 公约·生成中 | 部分 | `ProjectDetailPage.tsx:1011-1014` | 有生成中横幅、开始时间、停止确认、离开拦截；无“已运行 X 分 Y 秒”与读取文件清单（P02-13） |
| `conv-ready` | 公约·草稿就绪 | 部分 | `ProjectDetailPage.tsx:965-1048`、`1016-1039` | 草稿编辑/保存/确认写入/当前文件只读都在；缺差异审阅与放弃草稿（P02-05） |
| `conv-unknown` | 公约·状态未明 | 已实现 | `ProjectDetailPage.tsx:949-964` | 只重新读取、不重新生成，符合设计 |

## 问题清单

### P01-01: “进行中”行提示信息比设计降级，缺少待回答数量/执行段号
- **严重度**：P2
- **维度**：S / T / D
- **类别**：文案 / 数据契约
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/home.html:87-89`（state：单页“进行中”）；原文要点：行 1「规划中 · 生成候选 · 最近活动 14:07:58 · 离开不会停止规划」、行 2「需要你回答 2 个业务问题」、行 3「执行中 · 第 3 段 · 可调整待执行计划」。
- **实现位置**：`apps/web/src/pages/home/HomeOngoing.tsx:18`；相关：`packages/shared/src/domain/models.ts:386-406`（`TaskSummary.planning` 只有 `status/stage/lastActivity`，`:398-402`）。
- **差异**：只有 `planning.status==='running'` 的行复用设计句式（规划中 · 阶段 · 最近活动 · 离开不会停止规划）；其余行回退成「项目名 · 通用待处理/进度文案」。设计要求的“回答 N 个业务问题”“第 N 段”“可调整待执行计划”均无法显示；实现还会在行前加设计没有的项目名。
- **原因**：直接原因：`HomeOngoing` 用 `taskNeedText()` 通用状态文案兜底（C3）。根本原因：`TaskSummary` 没有规划问题数量、执行段号、计划可调整标记三个字段（C1），前端无法按设计原文渲染，只能降级。
- **影响**：需要用户介入的任务在主页只显示“需要你处理”，用户必须点进画布才知道要回答什么；处理优先级判断变弱。
- **建议**：服务补 `planning.questions` 计数/执行段号/可调整标记后按设计句式渲染；短期至少把兜底文案改成可行动原因，无法获取的数据明确写“服务未返回个数”，不要用通用词覆盖。
- **验证**：静态已确认契约无字段；真实数据渲染需真实服务 / GUI。
- **关联状态**：`e-home`、进行中卡

### P01-02: 主页垂直间距、断点与设计稿页面级样式不一致
- **严重度**：P3
- **维度**：V
- **类别**：样式主题 / 布局
- **设计依据**：`home.html:19`（`.window` `margin:48px auto 0`）、`:35-36`（`.cap-head` `margin:96px 0 28px`）、`:61`（`.foot` `margin-top:96px`）、`:39`/`:57`（能力卡/入口折叠断点 `max-width:1000px`）。
- **实现位置**：`apps/web/src/styles/app.css:452-453`（`.window` 32px）、`:561-563`（`.cap-head` 72px）、`:699-700`（`.foot` 72px）、`:575-579`/`:679-684` 与 `:1246-1252`（折叠断点统一为 1100px）；`HomeOngoing.tsx:14` 缺设计的 `animation-delay:.06s`（`home.html:85`）。
- **差异**：三处垂直间距比设计小 16–24px；能力卡/入口折叠断点 1100px 而设计是 1000px；进行中卡入场延迟缺失。
- **原因**：直接原因：主页样式迁移时沿用了 `app.css` 旧值与统一断点（C7）。根本原因：设计页 inline `<style>` 的页面级数值没有逐项落到实现样式层。
- **影响**：主页整体节奏比设计稿紧、断点附近布局切换时机不同；不影响功能与主流程。
- **建议**：把 `.window`/`.cap-head`/`.foot` 间距与 home 断点对齐设计（或明确记录为产品化调整并同步设计文档）；补 `animation-delay`。
- **验证**：需GUI（四主题 + 1440/1280/1024 视宽）。
- **关联状态**：单页主页

### P02-01: 项目卡片事实条由设计三格变成四格，缺任务总数与“N 个运行中”
- **严重度**：P2
- **维度**：结构 / T / D
- **类别**：结构 / 数据契约
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/projects.html:146-150`（state：`list`；`.pfacts` `repeat(3)` 单行：当前分支 / 技术栈 / 任务 `N 个`，`:22-25` 定义带分隔线的三格样式）；`:144`（模式徽标 + `N 个运行中` 徽标）。
- **实现位置**：`apps/web/src/pages/projects/ProjectsPage.tsx:103-126`（`grid-2` 四格：当前分支 / 技术栈 / 进行中任务 / 需要处理）；`:91-93`（顶栏 Git 状态徽标替代设计第二行模式徽标）；相关：`packages/shared/src/domain/models.ts:135-138`（`ProjectSummary` 只有 `openTaskCount`/`attentionCount`）、`packages/storage/src/projects-tasks.ts:84-98`（两个计数口径为 active 任务与 attention 任务）。
- **差异**：设计是“三格事实条”（任务总数 `N 个`）；实现是 2×2 四格，第三格语义变成“进行中任务”，新增“需要处理”；设计“N 个运行中”徽标完全没有（DTO 无 running 计数）。
- **原因**：直接原因：卡片改用通用 `grid-2` 承载四项（C4/C6）。根本原因：`ProjectSummary` 无任务总数与运行中数（C1），运行中徽标无法真实呈现，前端改用现有两个计数。
- **影响**：卡片关键概览与设计不符，用户看不到设计承诺的“任务总数/运行中”；四格在窄卡上更容易换行。
- **建议**：恢复三格单行事实条：当前分支/技术栈/任务总数（服务补 `totalTaskCount`，暂缺时明确“服务未返回”）；`runningCount` 补齐前不要用“进行中任务”冒充。
- **验证**：结构静态；任务总数/运行中需服务补字段并 GUI 核对。
- **关联状态**：`list`

### P02-02: 列表分段筛选与状态标签由设计 4 段漂移为 5 段
- **严重度**：P2
- **维度**：T / 结构 / 数据
- **类别**：文案 / 结构 / 数据语义
- **设计依据**：`projects.html:126`（state：`list`；seg 为 全部 / Git 分支 / 直接目录 / 不可用 + 计数，`aria-label="工作模式"`）；`:100`（标签 `Git 分支模式` / `直接执行目录` / `路径不可用`）；`:144`（卡片同款模式徽标）。
- **实现位置**：`apps/web/src/pages/projects/ProjectsPage.tsx:254-260`（全部 / Git 仓库 / 非 Git / 路径不可用 / 能力不可用）、`:510`（`ariaLabel="Git 状态"`）、`:31-36`（徽标标签映射）；`ProjectDetailPage.tsx:55-60` 同款漂移。
- **差异**：分段 4→5；标签整体改写（Git 分支→Git 仓库、直接目录→非 Git、不可用拆成路径不可用/能力不可用）；分组语义从设计“项目工作模式”变成服务 `RepoGitState`。
- **原因**：直接原因：前端直接用 `RepoGitState` 枚举生成分段与徽标（C3/C6）。根本原因：产品新增 `capability_unavailable` 设计稿未定义，UI 未做“不可用”聚合与设计语言映射（C4）。
- **影响**：按设计预期找“直接目录/不可用”筛选的用户找不到对应项；两个“不可用”增加理解成本。
- **建议**：保留能力不可用作为真实状态，但标签对齐设计（Git 分支/直接执行目录/不可用）或把路径/能力不可用聚合到“不可用”并在徽标里写原因；`aria-label` 改回“工作模式”。
- **验证**：静态。
- **关联状态**：`list`

### P02-03: `capability_unavailable` 项目被假禁用「开始任务/模板任务」
- **严重度**：P2
- **维度**：A / 数据
- **类别**：数据语义 / 操作
- **设计依据**：`projects.html:151`（state：`list`；不可用卡提示“目录在本机找不到…”）、`:153-154`（**仅** `unavailable` 时禁用开始/模板任务；设计没有“Git 能力不可用”态）。
- **实现位置**：`apps/web/src/pages/projects/ProjectsPage.tsx:70-71,139-168`（`unavailable` 同时包含 `PATH_UNAVAILABLE`/`CAPABILITY_UNAVAILABLE` 并禁用）；`ProjectDetailPage.tsx:1370-1371,1400-1418`（同样禁用）；`apps/web/src/pages/start/StartPage.tsx:149-152`（`pathAvailable` 也排除 `capability_unavailable`）。服务端：`packages/engine/src/project-task.ts:350-380`（创建任务校验，`:368` 唯一项目状态校验为“已归档”）、`packages/engine/src/workspace.ts:117-122,153-155`（非 Git 状态走 `directory_copy`，能力缺失在准备阶段才报错）。
- **差异**：设计只在“路径不可用”禁用入口；实现把“Git 能力不可用”一并禁用开始/模板任务，而服务端创建任务并不限制该状态。
- **原因**：直接原因：前端 `cannotStart` 合并两种 `gitState`（C6）。根本原因：服务没有把 `capability_unavailable` 映射成创建入口的禁用原因（C1），前端自行加限制（旧审查 `frontend-gaps.md` F-12 同类问题，当前代码仍成立）。
- **影响**：Git CLI 不可用但目录可读的项目无法发起任务，即使用户只想先形成需求草稿；开始页也会把该项目从可选列表剔除。
- **建议**：仅 `path_unavailable` 禁用；`capability_unavailable` 允许创建草稿（准备阶段失败时由服务给明确原因），或服务返回单独禁用 reason 后再禁用；同步 StartPage 的 `pathAvailable`。
- **验证**：静态已确认；真实行为需真实服务（创建任务 + 工作区准备）。
- **关联状态**：`list`、`detail`

### P02-04: 项目公约页签缺设计的「生成步骤」时间线
- **严重度**：P2
- **维度**：结构
- **类别**：结构
- **设计依据**：`projects.html:249`（state：`detail-conv`/`conv-*`；`timeline` 三节点：生成草稿 / 审阅差异 / 写入项目，带 on/ok 轨道点与说明）、`:265-267`（右栏 `aside`「生成步骤」，与正文组成 `1fr 260px`）。
- **实现位置**：`ProjectDetailPage.tsx:941-1099`（`CharterTab` 只有单列 `DetailSection`，无 aside/时间线）；`apps/web/src/pages/projects/project-detail.css:126-179` 已定义 `.project-charter-steps` / `.project-charter-step(.pending)` 但全仓 TSX 无引用（grep 0 命中）。
- **差异**：设计右侧三步时间线完全未渲染；对应 CSS 是现成的，但没有 JSX 消费。
- **原因**：直接原因：`CharterTab` 未实现 aside 结构（C4）。根本原因：组件重构时只带回样式，步骤状态映射（none/draft/generating/written）没有接回 UI。
- **影响**：用户看不到公约生成/审阅/写入当前在哪一步、下一步是什么；与设计的信息架构不一致。
- **建议**：复用现有 CSS，在 `DetailSection` 外增加右栏，用 `charter.status`/`needsReconcile` 映射 on/ok/pending 三步。
- **验证**：静态；布局与窄屏折叠需 GUI。
- **关联状态**：`detail-conv`、`conv-running`、`conv-ready`、`conv-unknown`

### P02-05: 公约“草稿已就绪”态缺差异审阅与「放弃草稿」
- **严重度**：P2
- **维度**：A / 结构
- **类别**：结构 / 交互
- **设计依据**：`projects.html:257-264`（state：`conv-ready`；主面板为“草稿已就绪 + 与当前公约相比 +18 行 + diff + 放弃草稿 + 确认写入”）、`:251`（未生成态 CTA）。
- **实现位置**：`ProjectDetailPage.tsx:965-1048`（编辑器 + 当前文件只读）、`:1016-1039`（保存草稿 / 确认写入，无 diff、无放弃草稿）；契约：`packages/shared/src/api/contracts.ts:321-336`（`current.content` 与 `draft.content` 都已返回）。
- **差异**：设计的就绪态核心是“草稿 vs 当前文件”的差异视图与 `+N 行` 摘要；实现是纯文本编辑区 + 下方当前文件只读，没有差异汇总，也没有“放弃草稿”动作（只能覆盖保存或不管）。
- **原因**：直接原因：前端未实现差异视图与丢弃草稿（C4/C5）。根本原因：不涉及缺契约——两边正文都已由 `ProjectCharterView` 提供，可在前端计算 diff，属实现缺口。
- **影响**：写 AGENTS.md 前无法一眼确认变更；误生成草稿后无干净退路，只能重新编辑覆盖。
- **建议**：就绪态增加差异视图（行级 +N/−N 摘要）与「放弃草稿」（结合现有保存/删除策略与服务能力），确认写入前置展示差异摘要。
- **验证**：静态；diff 渲染与确认流程需 GUI。
- **关联状态**：`conv-ready`、`detail-conv`

### P02-06: 登记抽屉缺「更多（可选）·文档目录」字段，创建契约无 settings
- **严重度**：P2
- **维度**：结构 / D
- **类别**：结构 / 数据契约
- **设计依据**：`projects.html:72-76`（state：`register`；`details`「更多（可选）」含文档目录输入与 hint“相对项目目录或绝对路径，留空则不生成项目文档”）、`:74`。
- **实现位置**：`apps/web/src/pages/projects/ProjectsPage.tsx:641-695`（只有项目目录/项目名称/说明）；契约：`packages/shared/src/api/contracts.ts:274-279`（`CreateProjectRequest` 无 `settings`/`docPaths`），文档路径只能登记后经 `UpdateProjectRequest.settings.docPaths` 改（`:281-299`）。
- **差异**：设计登记时可一次填写文档目录；实现必须登记完成后进入项目详情“文档路径”页签再配置。
- **原因**：直接原因：抽屉没有该字段（C4）。根本原因：创建项目契约不支持 settings（C1），服务无法在登记时保存文档路径。
- **影响**：设计的单步登记被拆成两步；只登记不配文档的项目在生成任务时不会产出文档。
- **建议**：`CreateProjectRequest` 增加可选 `settings.docPaths`（服务落库），抽屉补“更多（可选）”折叠区；若不做则记录为设计缺口并在抽屉里给跳转说明。
- **验证**：静态；真实登记需服务。
- **关联状态**：`register`

### P02-07: 登记抽屉关闭不确认未保存输入
- **严重度**：P2
- **维度**：A / K
- **类别**：交互
- **设计依据**：`projects.html:81-84`（state：`register`；`leaveDlg`「放弃未登记的内容？」继续填写/放弃）、`:286-287`（`tryCloseReg`：`regDirty` 时先弹确认）。
- **实现位置**：`apps/web/src/pages/projects/ProjectsPage.tsx:565-573`（`onClose` 仅挡 `submitting`，随后直接关闭并 `resetForm()`）；`apps/web/src/components/Drawer.tsx:31,46,52`（Esc / 遮罩 / X 都直接调用 `onClose`）。
- **差异**：已输入目录/名称/说明后，点 X、Esc、遮罩、取消都会直接关闭并清空，没有设计中的放弃确认。
- **原因**：直接原因：项目页 `onClose` 未检查脏状态（C5）。根本原因：共享 `Drawer` 没有通用“脏关闭”拦截能力（C5/C8），项目页也未自建确认对话框。
- **影响**：用户输入可能被误丢；与设计明确保护的行为不一致。
- **建议**：抽屉维护 dirty（目录/名称/说明任一非空），关闭前弹 `Modal`「放弃未登记的内容？」（继续填写/放弃），确认后再 reset。
- **验证**：静态；需 GUI 点测 X/Esc/遮罩/取消四条路径。
- **关联状态**：`register`

### P02-08: 列表读取失败态文案与设计不一致，缺“已登记项目未受影响”
- **严重度**：P2
- **维度**：S / T
- **类别**：状态 / 文案
- **设计依据**：`projects.html:116`（state：`list-error`；`banner danger`：「项目列表读取失败」「本地服务没有返回项目摘要。已登记的项目没有受影响。」+ 重试）。
- **实现位置**：`apps/web/src/pages/projects/ProjectsPage.tsx:409-417`（直接复用 `ServiceNotice`）；`apps/web/src/components/ServiceNotice.tsx:20-23`（标题退化为“服务未连接/数据读取失败”，正文为通用服务连接提示）。
- **差异**：设计针对“项目列表读取失败”的具体提示与数据未受影响的安抚缺失，替换为通用连接失败文案；重试按钮保留。
- **原因**：直接原因：页面直接用通用 `ServiceNotice` 未传 `title`/专用正文（C3）。根本原因：错误态没有按页面/错误码区分文案（C2）。
- **影响**：用户无法区分“项目摘要读取失败”和“后端整体不可用”，可能误以为已登记项目数据丢失。
- **建议**：列表错误态传 `title="项目列表读取失败"`，正文保留“已登记的项目没有受影响”，再按错误码附加细节。
- **验证**：静态；断网/503 复现需 GUI。
- **关联状态**：`list-error`

### P02-09: GitLab 与证据页签：设计的“搜索 GitLab 项目”降级为手填 projectPath
- **严重度**：P2
- **维度**：结构 / 数据契约
- **类别**：结构 / 数据契约
- **设计依据**：`projects.html:211`（state：`detail-gitlab`；input-wrap + search 图标，「搜索 GitLab 项目路径，例如 platform/opencode-loopper」）、`:220`（保存绑定后才能检查）。
- **实现位置**：`ProjectDetailPage.tsx:384-409`（GitLab 地址 / Project Path 手填 + 正则校验）、`:415-428`（检查绑定/保存）；契约：`packages/shared/src/api/contracts.ts:290-299`（只有 `baseUrl`/`projectPath`，无项目搜索）；`packages/server/src` 全仓无 GitLab 项目搜索端点。
- **差异**：设计是可搜索/选择 GitLab 项目；实现退化为手工输入 `group/repo`，只能本地正则校验，无法从服务拉候选。
- **原因**：直接原因：前端用普通输入框承载（C4）。根本原因：契约/服务没有 GitLab 项目搜索接口（C1），实现只能诚实降级。
- **影响**：用户需自己记住或拼写 projectPath，绑定错误率高、发现成本高。
- **建议**：增加受控的 GitLab 项目搜索端点后恢复选择器；短期在输入框旁写明“需手工填写 group/repo（服务暂未提供项目搜索）”，避免用户以为可搜索。
- **验证**：静态；真实 GitLab 调用需真实服务。
- **关联状态**：`detail-gitlab`

### P02-10: 项目卡片栅格缺设计断点，≤1100px 仍两列
- **严重度**：P2
- **维度**：V
- **类别**：样式/布局
- **设计依据**：`projects.html:13-14`（state：`list`；`.pgrid` 两列，`@media (max-width:1100px)` 变单列）。
- **实现位置**：`ProjectsPage.tsx:437`（`grid-2`）；`apps/web/src/styles/ds.css:249`（`.grid-2` 固定两列无媒体查询）；`apps/web/src/styles/app.css:1246-1252`（≤1100px 只折叠 `.grid-3/.grid-4/.entries/.caps`，不含 `.grid-2`）。
- **差异**：设计在 1100px 及以下变单列，实现始终两列；1024px 是产品声明支持宽度之一。
- **原因**：直接原因：项目卡片复用了通用 `grid-2` 而不是专用响应式栅格（C7）。根本原因：设计页面级媒体查询未迁移到实现样式层。
- **影响**：1024/窄屏下卡片更挤、路径与操作按钮更易换行溢出，与设计布局不一致。
- **建议**：为项目列表增加专用类（如 `.project-grid`）并在 ≤1100px 单列。
- **验证**：需GUI（1024/640）+ 静态。
- **关联状态**：`list`

### P02-11: 详情头部操作区与概览信息细节与设计不一致
- **严重度**：P3
- **维度**：结构 / T
- **类别**：结构 / 文案
- **设计依据**：`projects.html:178-182`（state：`detail`；操作顺序：开始任务 primary / 查看 Git secondary / 模板任务 secondary / 更多菜单含“取消管理…”）、`:192-193`（项目信息 `dl.kv` 四行：说明 / 当前分支 / 技术栈 / 文档目录）、`:194-197`（最近任务右侧「全部 N 个」）。
- **实现位置**：`ProjectDetailPage.tsx:1400-1438`（开始任务 / 模板任务 / 查看 Git / 重新检测，无更多菜单与取消管理）、`:1486-1503`（7 行：说明/当前分支/技术栈/Git 状态/Git Provider/默认流程方法/更新时间，缺“文档目录”）、`:1505-1523`（右侧「任务列表」+ hint“N 个任务属于这个项目”）。
- **差异**：详情页没有设计中的“更多 → 取消管理…”入口（只能回列表卡取消）；操作顺序与设计不同且多“重新检测”；项目信息缺“文档目录”行、多 5 行；最近任务入口文案/计数呈现与设计不同。
- **原因**：直接原因：详情头部与概览按实现需要重排（C4/C3）。根本原因：产品扩展（重新检测/归档恢复）先落在页面，未同步设计结构。
- **影响**：详情页无法直接取消管理；信息层级与设计稿有可见差异，但不阻断操作。
- **建议**：详情头部恢复“更多”菜单并放取消管理；项目信息补“文档目录”行；最近任务入口按设计显示“全部 N 个”。
- **验证**：静态；GUI 核对布局。
- **关联状态**：`detail`

### P02-12: 配置状态清单的状态语义与色调漂移
- **严重度**：P3
- **维度**：T / D
- **类别**：文案 / 数据语义
- **设计依据**：`projects.html:199-202`（state：`detail`；四行状态：Git 账号 `已配置` st-ok / GitLab 与证据 `可选` st-idle / 文档路径 `已设置` st-ok / 项目公约 `建议生成` st-fail，详情文案“尚未生成 AGENTS.md”）。
- **实现位置**：`ProjectDetailPage.tsx:1102-1243`（`ConfigStatusCard` 四项结构、点击跳转与设计一致）；`:1125-1200`（状态动态化：GitLab `未配置/未绑定/不适用`，项目公约 `尚未创建` idle 调）。
- **差异**：结构对齐，但状态词/色调语义不同：设计的 GitLab “可选”在实现显示为“未配置”；设计的项目公约“建议生成”（warn/fail 提醒）在实现显示为“尚未创建”（idle，不醒目）。
- **原因**：直接原因：状态映射按服务值直译（C3/C6）。根本原因：缺少“设计语义层”映射（可选 vs 未配置、建议生成 vs 尚未创建）。
- **影响**：公约未生成这一待办不再醒目，GitLab 可选项的“可选”含义丢失。
- **建议**：保留动态原因，但补设计语义：GitLab 未绑定用“可选”，项目公约 `none` 用“建议生成”+ warn 色调。
- **验证**：静态；GUI 核对四主题色调。
- **关联状态**：`detail`

### P02-13: 公约页签状态点、空态与生成中呈现与设计不同
- **严重度**：P3
- **维度**：S / T / 结构
- **类别**：状态 / 文案 / 结构
- **设计依据**：`projects.html:184`（state：`detail`；项目公约页签旁 `dot` `title="未生成"`）、`:251`（`conv` 未生成：空态标题“还没有项目公约”+说明+生成按钮）、`:252-255`（`conv-running`：spinner、已运行 1 分 12 秒、读取文件清单、停止、不能离开提示）、`:268`（停止确认对话框文案）。
- **实现位置**：`ProjectDetailPage.tsx:1478`（页签点只在 `needsReconcile` 时显示，语义为“写入状态未明”）、`:965-1048`（未生成时不显示设计空态标题，直接给编辑器）、`:1011-1014`（生成中横幅：有开始时间/请求号/停止，无已运行时长、无读取清单）、`:1012-1014`（停止弹窗文案不同）。
- **差异**：设计状态点表示“未生成”，实现只在“写入未明”时显示；空态/生成中的信息呈现不同；生成中缺设计展示的进度信息（“已运行 X 分 Y 秒”可由 `generation.startedAt` 计算，实现未显示；读取文件清单契约无字段）。
- **原因**：直接原因：状态点语义与空态写法由实现自定（C3/C4/C6）。根本原因：`ProjectCharterView.generation` 只有 `requestKey/startedAt`（`contracts.ts:322`），读取文件清单属契约缺失（C1）。
- **影响**：用户无法从页签看出“公约尚未生成”；生成中缺少进度感。
- **建议**：状态点改回“未生成”语义（或按原因分色并写 title）；补设计空态标题；生成中显示已运行时长（前端可算）并注明读取清单服务未提供。
- **验证**：静态；需 GUI 核对生成中轮询呈现。
- **关联状态**：`detail-conv`、`conv-running`、`conv-unknown`

### P02-14: Git 账号页签结构与设计不同（单选卡→原生 radio、seg→select）
- **严重度**：P3
- **维度**：结构 / V
- **类别**：结构 / 样式
- **设计依据**：`projects.html:224-236`（state：`detail-git` / `detail-git-custom`；`.radio-cards` 两张 rcard「继承全局账号（使用设置中的 Git 账号 [已配置]）/此项目单独配置」，认证方式用 `.seg` 访问令牌/用户名与密码，下文用户名/令牌、验证仓库地址、验证连接/保存）。
- **实现位置**：`ProjectDetailPage.tsx:522-545`（`ProjectGitAccount` 卡片）；`ProjectGitAccount.tsx:92-101`（原生 `<input type="radio">` 行、Provider/认证方式用 `<select>`、`GitAccountFacts` 表格 + 版本徽标 + 回执/核对区）。
- **差异**：设计的卡片式单选与分段认证控件变成普通 radio 与下拉；实现额外增加 Provider 选择、全局账号事实表、版本/回执/原请求核对（产品扩展）。
- **原因**：直接原因：表单按实现需要重写（C4/C7）。根本原因：项目独立账号需要 provider/凭据版本等设计没有的字段，组件未保留设计的视觉控件。
- **影响**：视觉/操作层级与设计不同；功能更完整但一致性下降。
- **建议**：恢复 `.rcard` 单选卡与 `.seg` 认证方式切换；新增的 Provider/版本/回执作为次要信息纳入同一卡片并在设计中登记。
- **验证**：静态；GUI 核对交互。
- **关联状态**：`detail-git`、`detail-git-custom`

### P02-15: 存在设计稿没有的区块/扩展（产品扩展，建议设计确认）
- **严重度**：P3
- **维度**：结构
- **类别**：结构（范围扩展）
- **设计依据**：`projects.html:240-246`（文档路径为单目录输入 + 实际位置 banner）；`:188-204`（概览右栏只有配置状态卡）；`:209-221`（GitLab 页签只有绑定 + 证据来源）；`:247-269`（公约页签无当前文件/版本列表）。
- **实现位置**：`ProjectDetailPage.tsx:633-761`（文档路径为多路径列表 + 增删 + 预览 + 回执）；`:1538-1550`（概览右栏新增“相关入口”卡）；`:586-601`（GitLab 页签新增 Git 仓库事实/全局账号/MR 数）；`:1043-1066`（公约当前文件只读 + 版本列表）；`:430`（绑定检查结果卡）。
- **差异**：实现比设计稿多出 5 类区块，且文档路径由单目录扩展为多目录（与服务 `docPaths` 能力一致，见 `docs/verification/2026-10-20-project-accounts-roots.md`、`docs/review/project-config-consumers-2026-10-20.md`）。
- **原因**：直接原因：服务能力落地时顺带扩展了页面结构（C4）。根本原因：设计与验收文档未同步登记这些扩展；不是数据伪造（全部来自真实接口）。
- **影响**：页面比设计稿更长、信息更多；设计一致性验收口径需同步，否则每次审查都会重复报“多出区块”。
- **建议**：作为“设计缺口/产品扩展”记录并同步设计稿或 design-coverage；不要求删除真实数据区块。文档多路径保留设计“实际位置”预览即可。
- **验证**：静态；GUI 逐屏核对。
- **关联状态**：`detail`、`detail-gitlab`、`detail-docs`、`detail-conv`

### P02-16: 列表页头/工具栏/加载空态细节与设计不一致
- **严重度**：P3
- **维度**：结构 / T / V
- **类别**：结构 / 文案 / 样式
- **设计依据**：`projects.html:103-108`（state：`list`；顶栏 `h1 项目` + 右侧「登记项目」按钮，页面标题区只有标题+lede）、`:121`（lede 原文“项目是任务、流程和配置的归属。选一个项目开始工作，或进入查看它的配置。”）、`:123-129`（工具栏只在非 loading/error/empty 时显示；搜索 280px、placeholder「搜索名称或路径」；右侧刷新图标按钮）、`:115`（加载 4 张骨架卡）、`:118`（无匹配空态含「清除筛选」按钮、包在 card 内）、`:117`（空态描述）。
- **实现位置**：`ProjectsPage.tsx:448-459`（登记项目在页面标题区 actions，lede 改写并新增“显示已归档”按钮）、`:497-515`（工具栏始终显示：placeholder「搜索名称、路径或说明」、`.toolbar .input-wrap` 260px（`app.css:766-768`）、无刷新按钮、改为“共 N 个项目 · N 个 Git 仓库”汇总）、`:392-408`（骨架 2 张）、`:433-434`（无匹配空态无清除筛选按钮、未包 card）、`:424`（空态描述多一句）。
- **差异**：主操作位置/页头文案/工具栏内容与设计不同；加载卡数量减半；无匹配空态缺恢复动作与容器。
- **原因**：直接原因：页面头部与工具栏按实现重排，复用通用 `EmptyState`（C3/C4/C7）。根本原因：设计顶栏操作位与页面级细节未迁移。
- **影响**：空态下用户需手动清空关键词/筛选；刷新入口消失；页头文案与设计不一致。
- **建议**：保留产品需要的“显示已归档”，但把「登记项目」放回设计位置或明确记录差异；搜索 placeholder/宽度/刷新按钮对齐；无匹配空态补「清除筛选」动作并包 card；加载骨架恢复 4 张；工具栏按设计在 loading/error/empty 时隐藏。
- **验证**：静态；GUI 核对三态。
- **关联状态**：`list`、`list-loading`、`list-empty`

### P02-17: 取消管理对话框样式与文案与设计不同
- **严重度**：P3
- **维度**：T / V
- **类别**：文案 / 样式
- **设计依据**：`projects.html:85-89`（state：`unmanage`；标题“取消管理这个项目？”，正文“将不再显示 X，已有任务记录保留。项目目录 … 中的文件不会被删除或修改。”，按钮：保留 ghost / 取消管理 danger）。
- **实现位置**：`ProjectsPage.tsx:447`（标题“取消项目管理？”；正文“文件不会被删除或修改。历史任务与配置记录保留，取消管理后可按新路径重新登记。”；按钮：返回 / 确认 primary；另有已归档→“恢复项目管理？”产品扩展）。
- **差异**：破坏性操作的确认按钮用 primary 而非 danger；标题/按钮文案与设计不同；“保留”改“返回”。
- **原因**：直接原因：对话框按实现重写（C3/C7）。根本原因：未保留设计对危险操作的视觉强调。
- **影响**：用户对“取消管理”的破坏性感知下降（虽然实际只归档不删文件）。
- **建议**：确认按钮改 `variant="danger"`，标题/按钮文案对齐设计；恢复管理单独用正向样式。
- **验证**：GUI + 静态。
- **关联状态**：`unmanage`（`list` 入口）

### P02-18: 项目卡底部操作层次与“更多”菜单与设计不同
- **严重度**：P3
- **维度**：结构 / A
- **类别**：结构 / 操作
- **设计依据**：`projects.html:152-157`（state：`list`；底部：开始任务 secondary sm / 模板任务 ghost sm / 右侧“查看配置 ›”提示）、`:160-163`（更多菜单：查看配置 / 复制项目目录 / 取消管理…）。
- **实现位置**：`ProjectsPage.tsx:135-173`（底部：需求目录 secondary / 开始任务 ghost / 模板任务 ghost / 查看配置 ghost / `<details>` 菜单：复制目录 / 重新检测 / 编辑 / 取消管理…）。
- **差异**：新增“需求目录”抢占 secondary 主次级；设计的主操作「开始任务」被降为 ghost；“查看配置”由文字提示变按钮且菜单里没有该项；菜单新增“重新检测/编辑”。
- **原因**：直接原因：卡片操作区按实现需要扩展（C4）。根本原因：设计操作层级未随扩展重排。
- **影响**：卡片主操作视觉权重与设计不同，用户可能被“需求目录”吸引而忽略开始任务。
- **建议**：恢复“开始任务”为 secondary，模板任务 ghost；“需求目录/重新检测/编辑”收进更多菜单或图标区；菜单补“查看配置”。
- **验证**：静态；GUI 核对换行/层级。
- **关联状态**：`list`

### P02-19: 页签可访问性与抽屉初始焦点不足
- **严重度**：P3
- **维度**：K
- **类别**：可访问性
- **设计依据**：`projects.html:167-184`（state：`detail`；页签 `role="tablist"` + `role="tab"` + `aria-selected`）；`projects.html:60-79` + `originals/main/assets/shell.js:114-125`（抽屉打开后聚焦首个输入/按钮，Esc 关闭、遮罩关闭、关闭后焦点归还）。
- **实现位置**：`ProjectDetailPage.tsx:1467-1481`（`nav.tabs` + `role=tab` + `aria-selected`，无 `aria-controls`/`tabpanel`/方向键）、`:500-507`（Git 子页签同）；`apps/web/src/components/Drawer.tsx:26-38`（打开时聚焦抽屉容器，无 focus trap；Esc/遮罩关闭与焦点归还已实现，`:46,52`）。
- **差异**：页签没有 roving tabindex/方向键/页签-面板关联；抽屉初始焦点落在容器而非“项目目录”输入（设计聚焦首个控件）。
- **原因**：直接原因：页签与抽屉只做了最小 aria（C8）。根本原因：共享组件缺少完整 tablist/dialog 键盘行为；设计 mock 也未提供方向键，属横切可访问性债（同类根因见 GLOBAL）。
- **影响**：键盘用户切换页签需多次 Tab；屏幕阅读器无法把页签与面板关联。
- **建议**：页签实现 roving tabindex + ←/→ 切换 + `aria-controls`/`role=tabpanel`；Drawer 初始聚焦首个可交互控件并加 focus trap。
- **验证**：需 GUI + 键盘实测。
- **关联状态**：`detail`、`register`

## 已核对一致

- P01 hero：badge「本地开发工作区」、标题 `Everything is a Workflow.`、副标题、两个按钮（开始任务/查看项目）逐字一致（`home.html:75-83` vs `HomePage.tsx:11-32`）。
- P01 进行中卡：单卡结构、eyebrow「进行中」+「全部任务」入口、行内 tile/标题/提示/状态徽标、数据来自真实 `ongoing` 任务（`home.html:85-90` vs `HomeOngoing.tsx:12-19`）；规划/确认阶段任务直达 `/requirement/:id`（`taskStatus.ts:168-174`），符合 planning `e-home`。
- P01 流程演示：窗口/three lights/「流程演示 · 非实时任务」/暂停按钮/4 节点 4 边/5 阶段/约 10 秒一轮/点阶段停留/减少动效与可见性暂停（`home.html:92-107,150-180` vs `HomeFlowDemo.tsx:15-176`）。
- P01 能力卡 4 张（标题/正文/CTA/示意图内容）、入口网格 4 项、页脚标题/说明/CTA（`home.html:109-145` vs `HomeCapabilities.tsx:6-18,87-135`）。
- P01 无设计外统计卡/“需要你处理”块/“最近活动”块：当前 `HomePage.tsx:34-36` 只渲染进行中/流程演示/能力卡三段（旧 `design-parity.md` 结论已过时，见 C10）。
- P01 品牌名 `opencode-workflow` → `agent-workflow` 属已决策差异（METHOD §1.6），不计缺陷。
- P02 整卡可点 + 键盘 Enter + `role="link"`/`aria-label`，内部链接按钮不误触（`projects.html:135` vs `ProjectsPage.tsx:73`）。
- P02 分段数量徽标来自真实项目计数（`projects.html:126` vs `ProjectsPage.tsx:248-260`；标签漂移见 P02-02）。
- P02 详情四页签「概览 / Git 与 GitLab / 文档路径 / 项目公约」、页签状态走 URL `?tab=`、配置状态四项点击分别落到对应页签/子页签（`projects.html:167-168,184-185,199-202` vs `ProjectDetailPage.tsx:48-53,95-98,1253,1287-1293,1467-1481,1208-1239`）。
- P02 480 登记抽屉：`size="md"` 命中 `--drawer-md:480px`（`projects.html:60` vs `ProjectsPage.tsx:568`、`ds.css:88,297`）；目录/名称/说明字段与设计一致（文档目录缺失见 P02-06）。
- P02 登记校验：绝对路径/名称必填、按钮禁用原因、目录选择后自动填名（`projects.html:275-285` vs `ProjectsPage.tsx:271-290,576-604,645-679`）。
- P02 登记结果未明：pending identity 恢复原 requestKey、GET `/api/operations/:key` 核对、不重复登记、结果未明时锁提交（`projects.html:122` vs `ProjectsPage.tsx:244-245,310-312,366-389,481-495`）。
- P02 取消管理确认 + 文件/任务记录不删除的文案语义（`projects.html:85-89` vs `ProjectsPage.tsx:447`；样式/文案偏差见 P02-17）。
- P02 Git 账号：继承/项目独立、访问令牌/用户名密码、验证用仓库地址、验证不保存、保存后凭据不回显（`projects.html:222-238` vs `ProjectGitAccount.tsx:92-101`、`docs/verification/2026-10-20-project-accounts-roots.md`）。
- P02 GitLab 与证据：执行证据来源（JUnit/日志）增删、16 条上限、切换类型清空路径、检查绑定前置保存、保存绑定与来源（`projects.html:209-221` vs `ProjectDetailPage.tsx:369-432`、`ProjectEvidence.tsx:5`）。
- P02 文档路径：相对路径校验、实际位置预览、放弃修改/保存回执（`projects.html:240-246` vs `ProjectDetailPage.tsx:633-761`）。
- P02 公约生成链路：none/generating/draft/written/unknown 由真实 `ProjectCharterView` 驱动；生成中禁止编辑/重复生成/写入、禁止离开、停止需确认、UNKNOWN 只重新读取不重新生成（`projects.html:247-269` vs `ProjectDetailPage.tsx:783-1100`；缺项见 P02-04/05/13）。
- P02 跨页入口：卡片「开始任务」/「模板任务」把项目 ID 带到 `/start?project=`、`/templates?project=`，`StartPage` 已读取并预选/过滤（`ProjectsPage.tsx:150,165,136` vs `StartPage.tsx:149-155`）；旧审查“跨页参数不生效”已修复，不构成当前问题。
- P02 归档（未管理）：默认从列表隐藏、可“显示已归档”、可恢复管理、不删文件，属对设计“取消管理后不再显示”的产品扩展（记录于说明）。

## 需 GUI / 运行验证

1. 四主题（deepseek/warm/spdb/github-white）+ 1440/1280/1024 下主页间距、能力卡/入口折叠断点、进行中卡入场动画（P01-02）。
2. 1024/640 视宽下项目卡片两列→单列表现与操作按钮换行（P02-10）。
3. 登记抽屉 480 宽度、X/Esc/遮罩/取消四条关闭路径与脏确认（修复后验收，P02-07）。
4. 列表 error / empty / loading 三态真实断连与 503 文案（P02-08、P02-16）。
5. 公约页签：步骤条渲染、就绪态差异视图、生成中轮询/停止、UNKNOWN 重新读取（P02-04/05/13）。
6. Git 账号表单单选卡/分段控件视觉，独立账号“验证→保存→回读”（P02-14）。
7. `capability_unavailable` 项目真实发起任务/工作区准备行为（P02-03，需真实服务）。
8. 详情页签键盘方向键/焦点顺序，抽屉初始焦点与 focus trap（P02-19）。
9. 整卡可点与内部链接/更多菜单点击不误跳详情（静态 guard 已确认，需 GUI 点测边界）。

## 未覆盖 / 说明

- **设计未定义的状态**：`projects.html` 无“无权限”“空仓库”“项目详情加载/读取失败”状态；实现有加载骨架、404、`ServiceNotice`、Git 页签非 Git/能力不可用兜底（`ProjectDetailPage.tsx:1318-1358,509-520`），属诚实降级，未逐态 GUI 验收，不按缺陷计数。
- **未运行**：四主题像素级、GUI 交互、真实服务/Git/GitLab/模型链路均未在本审计运行；上文“需GUI/需真实服务”条目不得视为已通过。
- **C10 线索（报 Lead 统一记录）**：`docs/review/design-parity.md` §0/§1.1/§2.1 的“主页多出统计卡/‘需要你处理’/‘最近活动’”“项目无详情页与四页签”“跨页参数不生效”在当前 `3f6f9b2` 已不成立（`HomePage.tsx:34-36`、`ProjectDetailPage.tsx`、`StartPage.tsx:149-155`）；仅 `docs/review/frontend-gaps.md` F-12 的 `capability_unavailable` 假禁用仍成立（本报告 P02-03）。请勿把旧文档结论当当前缺口。
- **死代码（建议 GLB 统一处理，不占本区编号）**：`apps/web/src/styles/app.css:338-449` 仍保留旧主页 `.stat-grid/.home-live-grid/.home-card/.home-row/.home-recent` 样式，当前无任何组件引用（grep 0 命中），是“多出统计卡”历史的残留，容易误导后续审查。
- **公约步骤 CSS**：`apps/web/src/pages/projects/project-detail.css:126-179` 的 `.project-charter-steps/.project-charter-step` 无引用，已作为 P02-04 证据；修复时可直接复用。
- **产品扩展（非缺陷，建议同步设计/验收口径）**：归档与恢复管理、重新检测、编辑项目、需求目录入口、显示已归档、登记失败态、Web 目录选择器、文档多路径、相关入口卡、Git 仓库事实/绑定检查结果/公约当前文件与版本列表。数据均来自真实接口，不构成误导；但设计稿未登记，建议在 `docs/design-coverage.md` 或设计补充稿中确认。
- **设计明确不开放/缺口（C9）**：设计未定义 `capability_unavailable`/`archived`；`e-home` 只说明冷启动入口，不定义主页状态。实现遵守“不伪造数据”原则，未发现假成功或占位数据泄漏。
