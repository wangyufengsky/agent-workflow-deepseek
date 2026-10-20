# 全局横切（外壳 / 页头 / 导航 / 主题 / 组件 / 文档口径）前端设计一致性审计

> 基线：main @ `3f6f9b2`（2026-10-20）。范围：`apps/web/src/app/{Shell.tsx,App.tsx,navigation.ts}`、`theme/`、`components/`、`styles/`、`packages/shared/src/config/themes.ts`、`packages/shared/src/domain/labels.ts`；设计权威 `opencode-workflow-design-showcase/originals/main/assets/{shell.js,ds.css,skins.css}`、`originals/main/REVIEW.md`、`showcase/navigation.js`、`showcase/bridge.js`、`sources/navigation-coverage-v2.json`。审计方式：静态代码 vs 只读设计稿；V（像素/四主题渲染）未跑 GUI，标注“需GUI”。

## 概览

| 核对域 | 结论 | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| 外壳结构（侧栏/页头/内容） | 侧栏对齐；页头偏离（多出审阅/主题/芯片控件、标题与主操作位置偏差） | 0 | 1 | 4 | 2 |
| 菜单与路由 | 17 项菜单/顺序/图标与共享菜单一致；25 页均有承载；P06/P07 无独立路由 | 0 | 0 | 1 | 0 |
| 四主题令牌 | 令牌完整（86×4）、ds.css 逐字节一致、无硬编码颜色、无外部资源 | 0 | 0 | 0 | 1 |
| 共享组件 | 结构与设计 class 对齐；焦点陷阱/禁用原因可达性不足 | 0 | 0 | 0 | 2 |
| 文档口径 | `docs/design-system.md` 构建期校验声明不存在 | 0 | 0 | 0 | 1 |
| 自建横切 UI | PendingCommands / connection-strip / 404 / ErrorBoundary 设计稿未定义 | 0 | 0 | 0 | 2 |

**最重要的问题（≤5 条）**
1. `GLB-01` 页头出现设计明确禁止的「展示/审阅」审阅控件，且该控件是**空操作**（只写 localStorage，不驱动任何界面/服务状态），设置页还宣称“顶栏切换后立即生效”。
2. `GLB-02` 页头出现设计已明确迁移到「设置→外观」的**主题切换按钮**（重复入口，违反设计 v5 页头规则）。
3. `GLB-03` 页头新增设计没有的「N 个项目」「服务已连接」chip，与侧栏底部运行环境芯片重复。
4. `GLB-04` 设计把本页主操作放在页头，实现的页头 action 槽位几乎未用（只有工具页使用），主操作下沉到内容区 `PageHeader`，全站页头结构与设计不合。
5. `GLB-05` 页头标题与内容标题重复：设计有 10 个页面 shell header 为空、标题只由内容 page-head 承担；实现 Shell 一律渲染页面名并与 `PageHeader` 同名重复。

## 问题清单

### GLB-01: 页头「展示/审阅」是设计禁止的审阅控件，且切换无任何实际效果
- **严重度**：P1
- **维度**：结构 / 交互 / 状态（D 数据诚实）
- **类别**：结构 / 交互
- **设计依据**：`opencode-workflow-design-showcase/originals/main/REVIEW.md:31`「页头只放面包屑/页名 + 本页主操作。**设计审阅控件（状态、版本、皮肤切换）不进产品页头**」；`:39`「皮肤切换移到‘设置→外观’；页头不再放皮肤下拉框」。设计里「展示模式/审阅模式」只存在于原型的评审工具栏（`showcase/bridge.js:9`，`#scToolbar` 为离线演示控制条），不属于产品界面。
- **实现位置**：`apps/web/src/app/Shell.tsx:14-23`（localStorage key + 读取）、`:45`（state）、`:64-70`（仅写 state+localStorage）、`:156-166`（页头 `SegmentedControl`「展示/审阅」）；`apps/web/src/pages/settings/AppearanceSection.tsx:24`「顶栏『展示 / 审阅』切换后立即生效」。
- **差异**：设计禁止审阅控件进入产品页头，实现不仅放入页头，而且该分段控件除写 `agent-workflow.display-mode` 外没有任何消费者：无 CSS/DOM 分支（全仓 `display-mode|displayMode|review-mode` 在样式与组件中无命中），也不与服务端 `settings.ui.displayMode` 联动（`AppearanceSection` 只读展示服务值）。点击“审阅”视觉与行为完全不变。
- **原因**：直接原因：把设计原型的评审模式开关当产品功能搬进 Shell 页头（C4/C5）。根本原因：没有区分“设计评审控件”和“产品控件”的边界（验收矩阵 K 与设计 REVIEW 已明确该边界）；同时用前端本地状态冒充产品状态，违反「界面状态必须由服务真实数据支撑」的约定（C6/D）。
- **影响**：所有页面页头多出一个无效开关；用户会误以为产品有展示/审阅两种模式；设置页文案与实际行为不符。属于“假控件/误导性 UI”。
- **建议**：从产品页头移除「展示/审阅」分段与其 localStorage 状态；若确需该能力，由服务端 `settings.ui.displayMode` 真实驱动并只在设置页呈现；同时修正设置页文案。
- **验证**：静态已确认；需 GUI 点击确认“无视觉变化”。
- **关联**：无（横切所有页面页头）。

### GLB-02: 页头主题切换按钮与设计 v5 冲突并与设置页重复
- **严重度**：P2
- **维度**：结构 / 交互
- **类别**：结构 / 交互
- **设计依据**：`originals/main/REVIEW.md:31`（皮肤切换不进产品页头）、`:39`（皮肤切换移到设置→外观）、`:487`「原设计的问题：皮肤切换放在每个页面的页头里，占用产品空间」、`:493`「外观（新分区）：四套皮肤的缩略预览卡……皮肤切换从各页页头移到这里」；`originals/main/pages/settings.html:107-110`（外观区四皮肤卡）。
- **实现位置**：`apps/web/src/app/Shell.tsx:167-177`（`header-theme` 一键循环）；`apps/web/src/pages/settings/ThemeSelector.tsx:23-70`（设置→外观已正确提供四皮肤卡并即时切换）。
- **差异**：实现同时保留“页头一键换主题”和“设置→外观”两个入口，页头入口正是设计明确删除的旧形态。
- **原因**：直接原因：保留历史一键主题切换组件（C4）。根本原因：主题切换的入口策略未按设计 v5 收敛到设置页；`ThemeProvider.cycleTheme` 专门为页头保留（`theme/ThemeProvider.tsx:51-56`）。
- **影响**：产品页头拥挤且违反设计规则；用户可能误操作循环主题；与设置页入口语义重复。
- **建议**：删除页头主题按钮与 `cycleTheme` 的页头调用（保留 URL/localStorage 持久化）；设计评审时以设置→外观为唯一入口。
- **验证**：静态。
- **关联**：P22（设置→外观）会再核对皮肤卡细节。

### GLB-03: 页头新增设计没有的项目数 chip 与服务连接 chip，与侧栏运行环境芯片重复
- **严重度**：P2
- **维度**：结构 / 视觉
- **类别**：结构
- **设计依据**：`originals/main/REVIEW.md:31`（页头只放面包屑/页名+本页主操作）；`showcase/navigation.js:51` 侧栏 `navHTML` 底部只有「运行环境」芯片；`originals/main/index.html`/各页 `DS.mount({header})` 均无项目数/服务连接 chip（如 `tasks.html:115`、`settings.html:221` 页头只有页名+本页操作）。
- **实现位置**：`apps/web/src/app/Shell.tsx:145-156`（`project-chip`「N 个项目」、`conn-chip`「服务已连接/未连接」）；`Shell.tsx:116-128` 同时保留侧栏底部运行环境芯片。
- **差异**：页头多出两块设计中不存在的全局信息，其中连接状态已在侧栏底部运行环境芯片呈现（同一事实两处展示）。
- **原因**：直接原因：为便利增加全局入口（C4）。根本原因：设计外壳只规定“页头=页名+本页操作、侧栏底部=运行环境状态”，实现未按该分工收敛，形成信息重复。
- **影响**：页头拥挤、信息层级与设计不一致；窄屏时被隐藏（`app.css:1379-1380`）说明其本身非关键，进一步说明可删除。
- **建议**：移除页头两块 chip；连接状态保留侧栏芯片；项目入口保留菜单。
- **验证**：静态；需 GUI 确认四主题下页头排版。
- **关联**：GLB-01、GLB-02 同属页头偏离。

### GLB-04: 本页主操作位置偏离设计——页头槽位几乎未用，动作下沉到内容区
- **严重度**：P2
- **维度**：结构 / 交互
- **类别**：结构
- **设计依据**：`originals/main/REVIEW.md:31`「页头 = 面包屑/页名 + **本页主操作**」；样例：`tasks.html:115` 页头含刷新+「开始任务」，`databases.html:275` 页头含刷新+「添加连接」，`templates.html:149` 页头含历史任务+历史模板记录，`workflows.html:144` 页头含「新建流程」；而对应内容 `page-head` 只放标题+说明（如 `tasks.html:101`、`workflows.html:128`）。
- **实现位置**：`Shell.tsx:141-145` 提供 `#page-header-context` / `#page-header-actions` 槽位；全仓仅 `pages/tools/ToolsPage.tsx:37-41` 与 `pages/tools/ToolsPolicyView.tsx:67-69` 使用 `PageHeaderSlot`；其余页面把动作放进内容区 `PageHeader`（`components/Card.tsx:39-51`），例如 `pages/tasks/TasksPage.tsx:209-227`、`pages/projects/ProjectsPage.tsx:448-466`、`pages/templates/TemplatesPage.tsx:725`、`pages/workflows/WorkflowsPage.tsx:328` 等。
- **差异**：设计是“页头放主操作、内容 page-head 只放标题说明”；实现是“页头只有面包屑+全局 chip，主操作全部在内容标题右侧”，且内容标题与页头标题重复（见 GLB-05）。
- **原因**：直接原因：页面统一使用内容区 PageHeader 组件承载标题+操作，未使用 Shell 预留槽位（C4）。根本原因：Shell 与页面组件的职责边界未按设计外壳定义落地——`PageHeaderSlot` 机制存在但未被采用（C5）。
- **影响**：全站页头与内容层级和设计不一致；页头 action 槽位成为半死代码；视觉上主操作位置偏低、页头空间浪费。
- **建议**：二选一收敛：①按设计把每页主操作通过 `PageHeaderSlot` 送入页头，内容 page-head 只留标题+说明；②若产品决定保留内容区动作，需设计确认并删除页头槽位与相关样式，避免两套机制并存。
- **验证**：静态；需 GUI 对比 tasks/databases/templates/workflows 四页。
- **关联**：GLB-05。

### GLB-05: 页头标题与内容标题重复，设计中对 header 为空的页面处理相反
- **严重度**：P2
- **维度**：结构 / 视觉
- **类别**：结构
- **设计依据**：以下设计页 `DS.mount({header:''})`，**shell 页头为空**、标题只由内容 `page-head` 承担：`knowledge.html`、`projects.html:302`、`requirement.html`、`roles-legacy.html`、`roles.html`、`run.html`、`start.html`、`task.html`、`tools.html`、`workflow-editor.html`、`ppt-studio.html:229`。而有页头的页面，内容标题与页头措辞并不雷同：`tasks.html:115` 页头「任务列表」vs `tasks.html:101` 内容「任务」；`requirements` 页头面包屑「任务列表/需求」+ 内容 `requirements.html:178`「需求」。
- **实现位置**：`Shell.tsx:130-140`（页头 `<h1>` 始终渲染面包屑/页名）；页面内容再渲染 `PageHeader`（`components/Card.tsx:39-51`）：`pages/projects/ProjectsPage.tsx:448`「项目」、`pages/tasks/TasksPage.tsx:209`「任务列表」、`pages/knowledge/KnowledgePage.tsx:461-462`「知识库」、`pages/start/StartPage.tsx:239/266/286/345`、`pages/tools/ToolsPage.tsx:36`、`pages/run/RunContentPage.tsx:168` 等。
- **差异**：设计在 10 个页面刻意不使用 shell 页头标题；实现 Shell 对所有路由统一显示页面名，导致这些页面出现“页头页面名 + 内容标题”双标题。有页头的页面也出现同样的同名双标题（设计内容标题措辞不同）。
- **原因**：直接原因：Shell 无条件渲染面包屑 h1（C4）。根本原因：未按设计“页头可选/由页面决定”的外壳契约实现，路由级 Shell 与页面级标题职责重叠。
- **影响**：页面首屏层级与设计不符；画布类页面（requirement/task/workflow-editor）顶部多出产品式页头，与设计“画布自带工具栏”不符；垂直空间浪费。
- **建议**：按设计让 Shell 页头支持“空/自定义”模式（或改由页面决定页头内容）；对 header 为空的 10 页禁用 Shell 标题，仅保留内容 page-head。
- **验证**：静态；需 GUI 抽查画布三页与列表四页。
- **关联**：GLB-04。

### GLB-06: 子页面包屑层级缺失（知识对话记录 / PPT 作品 / PPT 工作台 / Git 子视图）
- **严重度**：P3
- **维度**：路由 / 结构
- **类别**：结构 / 导航
- **设计依据**：`knowledge-history.html:77` 页头「知识库 / 对话记录」；`ppt-works.html:85` 页头「PPT 制作 / 全部作品」；`ppt-studio` 与 `ppt` 之间的进入关系（`ppt.html` 页头「全部作品」按钮）；`git/index.html` 工作台面包屑（项目内页）。
- **实现位置**：`apps/web/src/app/navigation.ts:80-98`：仅对 `/tasks/*`、`/runs/*`、`/requirement/*`、`/roles/legacy` 做多级面包屑；`/knowledge/history`、`/ppt` 子视图、`/git/:projectId` 落到单级（`:96-97` NAV_ITEMS 回退）。
- **差异**：这些子页在 Shell 页头只有一级（知识库 / PPT 制作 / Git 仓库），设计稿在页头呈现二级层级；部分页面用内容区 `eyebrow` 拼了一部分（如 `KnowledgeHistoryPage.tsx:226-231`），但页头仍缺层。
- **原因**：直接原因：`breadcrumbsFor` 未覆盖子路由（C5）。根本原因：路由层级与设计页面层级未建立映射表，新增子页时未同步面包屑。
- **影响**：页头路径信息不完整；与设计导航语义不一致。
- **建议**：为 `/knowledge/history`、`/ppt` 作品/工作台视图、`/git/:projectId` 增加二级面包屑；P06/P07 若改为独立路由则一并修正。
- **验证**：静态；需 GUI 确认面包屑显示。
- **关联**：GLB-08、P03/P04、P05/P06/P07、GIT。

### GLB-07: 「减少动态效果」设置只读、无消费者，设计给的是三选一控件
- **严重度**：P2
- **维度**：状态 / 交互
- **类别**：状态 / 交互
- **设计依据**：`originals/main/pages/settings.html:110`：外观区「减少动态效果」为 `<select>`（跟随系统 / 始终减少 / 不减少），说明“跟随系统时，系统开启‘减少动态效果’后自动关闭动画”；`:112` 为四皮肤卡。
- **实现位置**：`pages/settings/AppearanceSection.tsx:27-29` 只读文本（`settings.ui.reducedMotion ? '已开启' : '跟随系统'`），无控件；`packages/shared/src/config/settings.ts:183` 有 `reducedMotion` 字段但全仓无消费者（仅外观区展示）；动画抑制只有 `apps/web/src/styles/ds.css:327` 的 `@media (prefers-reduced-motion: reduce)`。
- **差异**：设计要求可设置“始终减少/不减少”，实现只显示服务值；即便服务返回 true，产品也没有任何全局抑制逻辑（除系统媒体查询外）。
- **原因**：直接原因：外观分区按只读展示实现（C2）。根本原因：`settings.ui.reducedMotion` 未接入任何动效控制；设置页 UI 未实现设计的三态控件（C6）。
- **影响**：用户无法按设计选择减少动态效果；已设置值不生效，属“展示但无效”。
- **建议**：补三态控件并让根元素携带相应 class（如 `data-motion`）驱动全局动效；或明确服务端不支持并显示“未接通”原因，不能只展示字段值。
- **验证**：静态；需 GUI 验证选择后动画变化。
- **关联**：P22。

### GLB-08: P06/P07 无独立路由，与设计独立页面 URL/深链/后退语义不一致
- **严重度**：P2
- **维度**：路由 / 结构
- **类别**：结构 / 导航
- **设计依据**：设计为三个独立 HTML 页面：`originals/main/pages/ppt.html`、`ppt-works.html`、`ppt-studio.html`（各自 `DS.mount` 状态注册表）；入口路径：PPT 制作页「全部作品」→ ppt-works，作品→工作台。
- **实现位置**：`apps/web/src/app/App.tsx:55` 仅 `ppt` 一条路由；`pages/ppt/PptPage.tsx:40`（`PptView = 'works' | 'workbench'`）、`:105-111`（`?work=` 参数切换视图）、`:239-258`（内容区自绘页头）。
- **差异**：设计是三个可独立打开/刷新的页面；实现折叠成单路由+query 视图，作品库/工作台不能独立深链，页头/面包屑/返回语义由自定义视图状态承担。
- **原因**：直接原因：合并实现为单页多视图（C4/C5）。根本原因：路由层未按设计页面粒度建模，视图状态代替路由状态。
- **影响**：设计稿中的独立页面地址不可用；刷新/分享工作台链接只能落到 `?work=`；与设计“作品库/工作台”层级不一致。
- **建议**：若要严格对齐，拆为 `/ppt/works`、`/ppt/studio/:workId` 独立路由（或明确记录为产品决策差异）；否则至少补齐二级面包屑与返回语义（GLB-06）。
- **验证**：静态；需 GUI 验证刷新/深链。
- **关联**：P05/P06/P07。

### GLB-09: 主题名称文案与设计外观区不一致
- **严重度**：P3
- **维度**：文案
- **类别**：文案
- **设计依据**：`originals/main/pages/settings.html:108` 四皮肤名称：`deepseek 风`、`claude 风`、`SPDB`、`GitHub 白`。
- **实现位置**：`packages/shared/src/config/themes.ts:65,159,253,347`（`DeepSeek` / `Warm` / `SPDB` / `GitHub White`，由 `scripts/generate-theme-config.mjs:20-23` 生成）；`pages/settings/ThemeSelector.tsx:57-62` 直接显示 `meta.label`。
- **差异**：设置→外观皮肤卡名称与设计稿不一致（Warm vs claude 风、GitHub White vs GitHub 白、DeepSeek vs deepseek 风）。
- **原因**：直接原因：生成器 labels 使用产品化英文名（C3）。根本原因：没有以设计外观区文案为唯一来源；主题元数据文案未纳入 labels 约定。
- **影响**：设置页文案与设计不一致；与设计反复出现的“deepseek 风/claude 风”术语不统一。
- **建议**：修改生成器 labels 或新增产品文案映射，使外观区显示设计原文（品牌名保留可另注）。
- **验证**：静态。
- **关联**：P22。

### GLB-10: 产品自建全局横幅（PendingCommands / connection-strip）设计稿未定义，可能与页面内提示重复
- **严重度**：P3
- **维度**：结构 / 状态
- **类别**：结构 / 状态
- **设计依据**：设计稿没有全局“操作结果待核对”横幅或全局“服务未连接”条；未知/断连由页面内 banner 承担（例如 `tasks.html:100` 错误态、`settings.html:213` 保存结果未明、`planning` 断连态 `pe16`）。
- **实现位置**：`apps/web/src/app/Shell.tsx:180-196`（bootstrap 失败全局 `connection-strip`）、`:201`（`PendingCommands`，内容见 `components/PendingCommands.tsx:11-27`）。
- **差异**：产品在 Shell 层新增两块全局横幅；设计把对应状态放在各页面内容区。
- **原因**：直接原因：横切回执/连接状态统一上移为全局 UI（C4）。根本原因：AGENTS 要求 requestKey 回执与未知只核对，实现用全局横幅兜底；设计稿未定义该横切层，属“产品补设计”。
- **影响**：可能出现“全局横幅 + 页面内错误条”双重提示；页头/侧栏已显示连接状态，三者信息重复。
- **建议**：保留机制但需产品/设计确认呈现层（建议只保留全局未知横幅、页面不再重复；连接失败以页面内 notice 为主，全局条只在首屏无法加载时出现）。
- **验证**：静态；需 GUI 断网/丢回执场景确认是否重复。
- **关联**：P12/P13/P22 等页面错误态。

### GLB-11: 文档声称构建期校验 ds.css 逐字节一致，仓库中不存在该校验
- **严重度**：P3
- **维度**：文档口径
- **类别**：文档
- **设计依据**：设计权威要求“复用视觉层：`originals/main/assets/ds.css` 原样复制为 `apps/web/src/styles/ds.css`”。
- **实现位置**：`docs/design-system.md:9`「（构建前用 `diff -q` 校验逐字节一致）」；但 `package.json` scripts 与 `scripts/` 中无该检查（`scripts/generate-theme-config.mjs` 只生成 themes.ts；`npm run build` 无 design check）。当前两文件实际一致（`cmp` 无差异，各 390 行）。
- **差异**：文档声明了一个不存在的构建守卫；当前一致性靠人工。
- **原因**：直接原因：文档描述与脚本能力不一致（C10）。根本原因：设计资产同步缺少自动化校验。
- **影响**：设计系统升级时可能静默漂移；文档不可信。
- **建议**：新增 `npm run check:design`（`cmp apps/web/src/styles/ds.css opencode-workflow-design-showcase/originals/main/assets/ds.css` + 重生成 themes.ts 后 `git diff --exit-code`），或修正文档表述。
- **验证**：静态。
- **关联**：无。

### GLB-12: 死样式残留（Placeholders 区块）
- **严重度**：P3
- **维度**：视觉
- **类别**：样式
- **设计依据**：产品无占位页设计稿（`placeholders.tsx` 现只剩 `NotFoundPlaceholder`，`App.tsx:28` 仅引用它）。
- **实现位置**：`apps/web/src/styles/app.css:1171-1218`「7. Placeholders」仍定义 `.placeholder`、`.placeholder .tile/h2/p/.route/.actions/.status-banner`；其中 `.route`、`.status-banner` 等无任何 TSX 使用。
- **差异**：404 之外的占位样式与部分子规则已成为死代码。
- **原因**：直接原因：占位页收敛为 404 后未清理样式（C2）。根本原因：缺少未使用 CSS 检查。
- **影响**：样式表膨胀、后续误用；不影响运行。
- **建议**：清理未使用选择器，只保留 404 所需规则。
- **验证**：静态。
- **关联**：无。

### GLB-13: 共享组件可访问性缺口（焦点陷阱 / 禁用原因可达性）
- **严重度**：P3
- **维度**：K 可访问性
- **类别**：可访问性
- **设计依据**：设计系统规则要求抽屉“Esc 关闭并把焦点还给触发按钮”（`REVIEW.md:30`）；验收口径 K 要求 Tab 焦点限制与归还；设计禁止只靠颜色，禁用需可读原因。
- **实现位置**：`components/Modal.tsx:18-40`、`components/Drawer.tsx:23-40`：已实现 Esc 关闭、初始聚焦、关闭后焦点归还，但**无 Tab 焦点陷阱**（焦点可跑出模态到背景）；`components/Button.tsx:32-45`：禁用原因只写 `title` 与 `aria-disabled`，禁用按钮不可聚焦时键盘用户无法读到原因。
- **差异**：设计稿原型同样没有实现焦点陷阱（原型的 `openDrawer` 只做 focus），但交付口径 K 要求；禁用原因仅在原生 title。
- **原因**：直接原因：共享组件只实现最低限度 a11y（C8）。根本原因：无障碍验收未进入组件合同。
- **影响**：键盘用户在对话框/抽屉内可能误入背景；触屏/键盘无法获知禁用原因（页面多另行展示提示，但组件层无保证）。
- **建议**：Modal/Drawer 增加焦点陷阱与 `aria-labelledby`；Button 的 `disabledReason` 通过 `aria-describedby` 关联一条可读文本（不依赖 title）。
- **验证**：静态；需 GUI 键盘验证。
- **关联**：各页面审计（禁用原因缺失会单独记录）。

### GLB-14: 404 页与全局错误边界为设计外自建界面
- **严重度**：P3
- **维度**：结构
- **类别**：结构 / 范围
- **设计依据**：设计稿无 404 页与“页面渲染出错”兜底页；25 页之外无产品路由设计。
- **实现位置**：`apps/web/src/app/placeholders.tsx:6-27`（404）、`apps/web/src/main.tsx:16-54`（ErrorBoundary 渲染“页面渲染出错”）。
- **差异**：产品新增两块设计外界面。
- **原因**：直接原因：工程健壮性需要（C9）。根本原因：设计稿未覆盖异常外壳场景。
- **影响**：不影响主流程；视觉语言与设计体系基本一致（使用了 ds.css 类）。
- **建议**：保留，但补设计确认或纳入设计系统文档；不算实现缺陷。
- **验证**：静态。
- **关联**：无。

## 已核对一致（本轮静态确认）

- **ds.css 复用**：`apps/web/src/styles/ds.css` 与 `originals/main/assets/ds.css` 逐字节一致（`cmp` 无输出，各 390 行）。
- **四主题令牌完整**：`skins.css` 四皮肤共 344 条声明 = 86 个主题令牌 × 4，`THEME_TOKEN_NAMES` 86 个 + `BASE_TOKENS` 结构令牌；`themeCssVariables` 合并后由 `applyTheme` 全量写入 `<html>`（`apps/web/src/theme/theme.ts:45-58`），同时设置 `data-theme`、`data-skin`、`color-scheme`；localStorage + `?theme=` + popstate 同步（`theme.ts:26-73`、`ThemeProvider.tsx:39-74`）。
- **无硬编码颜色/外部资源**：`apps/web/src/**/*.{ts,tsx,css}` 除 `styles/ds.css` 与主题配置外无颜色字面量（唯一命中 `pages/ppt/PptPlanSections.tsx:41` 为强调色输入的示例文本 `#4D6BFE`，属用户输入示例而非样式）；无 `@import`/`@font-face`/外部 `url(http…)`。
- **菜单与设计权威一致**：`showcase/navigation.js` 的 17 项共享菜单（含「Git 仓库」`gitRepo`、「需求目录」）顺序、分组、标签、图标与 `apps/web/src/app/navigation.ts:21-53` 完全一致；「开始任务」作为侧栏顶部主按钮（`Shell.tsx:110-116`）；侧栏底部运行环境芯片保留（`Shell.tsx:116-128`）。
- **25 正式页均有承载**：`App.tsx:31-58` 含全部页面路由（P06/P07 以视图承载，见 GLB-08）；`/start`、`/recovery`、`/runs/:taskId`、`/roles/legacy`、`/knowledge/history`、`/workflows/:id/edit` 均存在。
- **图标集合**：`components/Icon.tsx` 的图标名与 `showcase/icons.js` 的 `SC_ICONS` 一致（额外包含共享菜单专用的 `gitRepo`）。
- **品牌差异**：`agent-workflow`/`Agent Workflow` 替代设计来源名 `opencode-workflow` 属已决策的品牌差异（`docs/remaining-work.md`），不计为问题。
- **主题预览卡结构**：设置→外观使用设计 class 语言（`.skins/.skin/.pv/.nm`），四卡 `role=radio` + `aria-checked`，点击即时切换（`ThemeSelector.tsx:30-66`）。
- **系统减少动态效果**：`ds.css:327` 提供 `prefers-reduced-motion` 全局抑制（与设计系统一致；设置项问题见 GLB-07）。

## 需 GUI / 运行验证

1. 四主题 × 1440/1280/1024 下 Shell 页头在移除/保留上述控件后的真实排版与溢出（`app.css:1321-1330` 已有窄屏隐藏规则，需确认设计目标宽度）。
2. 页头 h1 与内容 PageHeader 双标题在真实数据/长标题下的换行与视觉层级。
3. 页面主操作位置调整到页头后的对齐与响应式（GLB-04 方案落地时）。
4. 全局横幅在断连/丢回执场景下与页面内提示是否重复（GLB-10）。
5. Modal/Drawer Tab 焦点行为（GLB-13）。

## 未覆盖 / 说明

- 未运行 Web GUI / 四主题截图对比，未做像素级布局核对（V 维度需 GUI 验收）；本文件只做静态结构与契约核对。
- 未审计主题 `skins.css` 之外的设计资产（design PNG 不在仓库内可读目录）。
- 各页面的页头动作/标题细节由 15 个区域报告负责；本文件只汇总跨页结构性偏差，不重复页面级问题。
