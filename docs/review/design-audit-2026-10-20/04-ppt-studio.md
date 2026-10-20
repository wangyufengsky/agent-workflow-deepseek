# P07 PPT 工作台 前端设计一致性审计

> 基线：main @ 3f6f9b2（2026-10-20）。范围：只读设计稿 `opencode-workflow-design-showcase/originals/main/pages/ppt-studio.html` 的 22 个 mock 状态（`discuss/plan/make/done/issues/edit` + `pl-*` 16 个）与同页补充稿 B-09「PPT 七模块制作方案」（`originals/main/REVIEW.md` §18 与 §B-09）；实现链路 `apps/web/src/pages/ppt/`（PptPage → PptWorkbench → PptStudio / PptWorkbenchSteps / PptStepExport / PptPlanDrawer / PptPlanSections / PptAssistantPanel / PptAssistantProposal / PptProductionPanels）及相关的共享/引擎契约（`packages/shared/src/domain/{models,ppt-renderer}.ts`、`packages/engine/src/{ppt,ppt-plan}.ts`）。审计方式：静态代码 vs 只读设计稿；未运行 GUI 的部分标注“需GUI”，不做像素级断言。旧审查文档仅作线索，结论均以当前代码核实。

## 概览

| 页面 | 设计状态数 | 已逐项核对 | P0 | P1 | P2 | P3 | 结论 |
|---|---|---|---|---|---|---|---|
| P07 PPT 工作台（ppt-studio） | 22 | 是 | 1 | 3 | 10 | 9 | 与设计有偏差：四步框架、逐页制作状态、手动对象编辑、助手差异卡、真实回执与导出可用；但 ①讨论/②方案两阶段的交互与 ③检查呈现、B-09 制作方案的阶段层与自动保存/冲突/加载只读状态明显缺失，并且保存制作方案/加一页的整份 PATCH 会伪造“全部完成”（P0，见 P07-23） |

**最重要的问题（≤5 条）**

1. `P07-23`（P0，数据诚实）保存制作方案 / 加一页的整份 PATCH 携带 `slides`，服务会把 `productionPages` 全部改写成“已完成人工页”并清空生成状态：停止/失败后的“部分完成、本次已制作 X/Y”变成“全部完成”，导出门槛被放开，可导出缺内容的空页。
2. `P07-01` ① 讨论需求没有设计要求的“五项简报逐项补全”视图：无 pending/已补/新补高亮、无“还差 N 项”、CTA 不是“生成制作方案”，助手问题也没有快捷选项。
3. `P07-02` ② 设计方案的大纲只读、不可增删排序，且没有“回到讨论 / 确认并开始制作 · 页数与预计时长”的底部确认条；方案确认被搬到制作方案抽屉。
4. `P07-03` B-09 制作方案抽屉缺阶段层：无顶部阶段条与“按方案制作 / 修改方案”，`pl-review` 的“已用于制作即整表只读、重新打开才可改”边界未实现。
5. `P07-08` 编辑保存模型与设计相反：设计是自动保存 + 保存状态栏（pl-saving/pl-conflict 依赖它），实现是显式保存，pl-saving 不可达，保存期间抽屉反而显示“当前只读”。

## 状态覆盖

### PPT 工作台（`opencode-workflow-design-showcase/originals/main/pages/ppt-studio.html`）

| mock state | 设计名称 | 实现判定 | 证据（实现文件:行 / 无） | 说明 |
|---|---|---|---|---|
| `discuss` | ① 讨论需求 | 部分 | `apps/web/src/pages/ppt/PptWorkbenchSteps.tsx:36-178`；`PptProductionPanels.tsx:15-23`；`PptAssistantPanel.tsx:54-62` | 五项简报表单可编辑可保存；缺设计“逐项补全”状态（pending/已补/新补高亮）、“还差 N 项”底部提示、“生成制作方案”CTA、助手快捷选项；中心区多出标题/主题/大纲 |
| `plan` | ② 设计方案 | 部分 | `PptWorkbenchSteps.tsx:181-329`；`PptProductionPanels.tsx:33-35` | 三个视觉方向卡（真实页面预览 + aria-pressed + 已选）可达；大纲只读、无行级菜单/加一页、无“回到讨论 / 确认并开始制作”与页数/时长；方向点选即 PATCH（另见 `P07-12`） |
| `make` | ③ 制作中 | 部分 | `PptStudio.tsx:91-112`；`PptGenerationControls.tsx:22-28` | 逐页 `pending/generating/...` 状态、当前页“正在制作这一页…”、停止生成与真实回执均实现；缺设计助手消息里的“正在制作第 N 页 · 还剩 M 页”（改由顶部横幅“本次已制作 X/Y 正文页”承担） |
| `done` | ③ 已全部生成 | 已实现 | `PptStudio.tsx:112`；`PptGenerationControls.tsx:25` | 全部 `completed` 时页面正常渲染，横幅显示“本次逐页制作已完成”；无生成遮罩 |
| `issues` | ③ 检查有问题 | 部分 | `PptStudio.tsx:107,120` | 缩略图有 `alert` 图标、检查页签有可定位到页的问题列表；缺琥珀旗标/页头问题文案徽标/“X 页已检查”/三项通过清单/“让助手精简” |
| `edit` | ③ 手动编辑 | 已实现 | `PptStudio.tsx:111-119`（`:112` 对象命中区、`:119` 对象属性） | 手动编辑开关、点击页面文字选中对象、右侧自动切“对象属性”（文字/字号/颜色/对齐）、banner 原文与设计一致；保存为显式（见 `P07-08`）、备注默认展开（见 `P07-19`） |
| `pl-brief` | 补充 · 制作方案 · 制作目标 | 部分 | `PptPlanDrawer.tsx:64`；`PptPlanSections.tsx:29` | 受众/目的/汇报时长/预计页数/补充要求齐；缺阶段条、自动保存状态、入口“页面已生成后”约束 |
| `pl-narrative` | 补充 · 叙事结构 | 部分 | `PptPlanDrawer.tsx:65`；`PptPlanSections.tsx:33` | 三方向单选 + 折叠字段（title/description/storyline/chapters/visual）+ 大纲主线 + 章节增删可编辑；缺“建议页数”字段、“自行填写方向”（服务受限）、DIRECTION 阶段语义 |
| `pl-frozen` | 补充 · 方向已冻结 | 部分 | `PptPlanDrawer.tsx:45,59`；`PptPlanSections.tsx:33` | `plan.confirmed` 时方向字段/radio 与制作目标被锁，章节/页面仍可改（与设计一致）；缺“已确认”徽标、叙事结构内 banner“方向已经确认，重新打开需求后可以修改”原文 |
| `pl-slides` | 补充 · 页面内容 | 部分 | `PptPlanSections.tsx:37` | 每页卡可折叠、标题/章节/版式/核心观点/页面内容、上移/下移/移除/加一页齐；缺标题行“版式 · 核心观点”摘要、删除确认、边界禁用原因文案 |
| `pl-visual-bad` | 补充 · 视觉规范（色值无效） | 部分 | `PptPlanDrawer.tsx:44,57`；`PptPlanSections.tsx:41` | 强调色非法时保存被禁 + `error-text` 提示（“修正前不会保存”）；缺色块预览/斜纹、输入框标红、页签红点；文字密度仍是下拉（设计明确改为分段控件） |
| `pl-assets` | 补充 · 图表素材 | 部分 | `PptPlanSections.tsx:45` | 素材使用/图表表达/配图要求三字段 + 每页依据复选（只列作品附件）；无设计“未就绪资料=解析中且禁用”的胶囊，也无项目文档可选（C1） |
| `pl-notes` | 补充 · 演讲辅助 | 已实现（文案差异） | `PptPlanSections.tsx:49` | 每页备注可编辑；缺“讲稿、时长与过渡”标题与“这一页还没有讲稿”占位 |
| `pl-delivery` | 补充 · 交付设置 | 已实现（文案差异） | `PptPlanSections.tsx:53` | 文件名/目标办公软件/包含演讲备注齐；缺 `.pptx` 自动后缀提示与设计“正式导出为可编辑 PPTX，页面预览为 PNG”原文（实现改为“页面预览来自当前作品内容渲染”，属诚实降级） |
| `pl-saving` | 补充 · 等待自动保存 | 缺失 | 无；`PptPlanDrawer.tsx:43-49,57` | 无自动保存与“已自动保存 · 时间/等待自动保存…”；保存中 `busyKind='update'` 令 `blocked=true`，抽屉 footer 显示“当前只读”而不是“保存中” |
| `pl-conflict` | 补充 · 版本冲突 | 部分 | `PptPlanDrawer.tsx:46-48,58` | 有“方案已有新版本，本地输入保留”+查看服务方案+“已比对，按当前修订保存”的客户端合入路径，但只在 `work.revision` prop 变化后出现；无“读取最新方案”按钮，409 后作品列表不主动刷新（`PptPage.tsx:193-206`） |
| `pl-review` | 补充 · 已用于制作（需重新打开） | 部分 | `PptPlanDrawer.tsx:59`；`PptPlanSections.tsx:37,41,45,49,53` | 有“方案方向已确认；页面、素材与备注仍可调整”+“重新打开需求”+“确认方案”；但已用于制作时整表仍可编辑保存（除方向和制作目标），无“修改方案”确认对话框与完整只读边界 |
| `pl-ro-active` | 补充 · 只读（制作中） | 部分 | `PptWorkbench.tsx:53-58`；`PptPlanDrawer.tsx:57` | `generating` 令全局 `blocked`，控件禁用、footer“当前只读”；无设计中“助手正在制作，方案暂时只读……制作完成或停止后，才能重新打开修改”的 phase 横幅，禁用控件无原因文案 |
| `pl-ro-archived` | 补充 · 只读（已归档） | 部分 | 同上；`PptWorkbench.tsx:72-77` | 归档令 `blocked=true`、`blockedReason='作品已归档；请先在作品库恢复。'`，但未传入计划抽屉；页头无“已归档”徽标（只有草稿/生成中/已生成/部分完成），抽屉无“作品已归档，方案只读……恢复作品后才能修改或重新制作”横幅 |
| `pl-loading` | 补充 · 读取中 | 缺失 | 无；`PptPage.tsx:92-97,296-351` | 抽屉无字段骨架/“正在读取制作方案…”；plan 内嵌在作品列表，工作台深链在列表加载中显示“还没有选择作品”空态 |
| `pl-error` | 补充 · 读取失败 | 缺失 | 无；`PptPage.tsx:296-351` | 抽屉无错误条+“重新读取”+页签禁用；作品列表读取失败时工作台视图同样退化为空态，不显示错误原因与重试 |
| `pl-blocked` | 补充 · 有未保存属性被拦截 | 缺失 | 无；`PptWorkbench.tsx:95`、`PptStudio.tsx:56-77` | 对象属性草稿（studio 内部 state/sessionStorage）不参与打开制作方案的拦截；无“制作方案没有打开 / 对象或页面输入尚未保存，请先核对属性；草稿仍保留”提示，也无属性页签“标题文字未保存”徽标 |

## 问题清单

### P07-23: 保存制作方案 / 加一页的整份 PATCH 会伪造“全部页面已完成”，抹掉逐页停止/失败状态并放开导出
- **严重度**：P0
- **维度**：S / D / A
- **类别**：状态 / 数据契约 / 数据诚实
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/ppt-studio.html:164-165`（`PST` 逐页 warn/gen/wait 状态驱动缩略图旗标与中央“正在制作/等待制作”）、`:186`（页头当前页状态徽标）、`:214`（检查页签“N 个问题 · M 页已检查”按已完成页计）、`:225`（制作中导出告警“第 5、6 页仍在制作。现在导出将只包含已完成的 4 页”）；`originals/main/REVIEW.md:358`（“导出（制作完成前禁用并说明原因）”）、`:365`（状态区分“制作中 / 已全部生成”）；项目自身的验收口径也要求部分完成不得假称全部完成/导出（`docs/review/ppt-page-progress-2026-10-20.md:8`、`:26`）。
- **实现位置**：`apps/web/src/pages/ppt/PptPlanDrawer.tsx:21`（`slides` 初值 = 全量 `work.slides`）、`:49`（`save()` 每次 PATCH 都带 `slides: slides`）；`apps/web/src/pages/ppt/PptStudio.tsx:108`（“加一页”的 update 也带全量 `slides`）；`packages/engine/src/ppt.ts:233-236`（`input.slides` 存在时 `productionPages` 被重写为全部 `status:'completed', source:'manual'`，随后 `this.#generation.clear(id)`）。
- **差异**：任何“保存方案 / 确认方案 / 加一页”的整份 update 都会把已有 `productionPages` 全部改写为“已完成人工页”并清空持久生成状态。由此：① 停止/失败/未知后的“部分完成 / 本次已制作 X/Y / 已知停止页 / 待核对页”立即变成“全部完成”，`PptGenerationControls.tsx:23-27` 的计数与 `ppt-shared.tsx:38-41` 的“部分完成”标签失效；② `derivePptProgress`（`ppt-shared.tsx:109-135`）与导出门槛（`PptStepExport.tsx:78-79`）按“未完成页 = 0”放行导出，可导出缺内容的空页；③ 设计/实现已强调的“停止后保留已有内容、不宣称完成”被抹平（`docs/review/ppt-page-progress-2026-10-20.md:8`）。设计要求的逐页进度与“制作完成前禁用导出”被伪造。
- **原因**：直接原因前端两个入口把“方案/骨架保存”实现成整份 `slides` PATCH；根本原因 C6（数据语义/映射错误：服务把“带 slides 的整份更新”等义为“全部页面人工完成”）+ C1（契约缺少“只更新方案/只新增页、保留生产状态”的语义），并直接违反 D 数据诚实。
- **影响**：在真实流程（停止后再调整方案、确认后仍可改章节/页面的路径）中会制造假完成；用户可能因此导出空页 PPTX 并当作真实结果；同时抹掉服务已持久化的停止/失败原因，违背“部分完成不能假称全部完成或导出”的验收要求。
- **建议**：① 制作方案保存只提交 `plan/brief/direction`（不带 `slides`），页面增删/排序走独立命令或 `pageEdit` 语义；② 服务端 `update` 在带 `slides` 时不得把已有 `productionPages` 中未完成页改写为 completed，应保留原状态或要求显式“全部完成”确认；③“加一页”只改 `outline` 并 append `pending` 页，不做全量 completed 重写。
- **验证**：静态（代码路径可判定）/ 需真实服务（停止后保存方案，核对 `productionPages`、页头标签与导出门槛）
- **关联状态**：`make, done, issues, pl-*`（保存方案）、`export`

### P07-01: ① 讨论需求缺少“五项简报逐项补全”状态与“生成制作方案”CTA
- **严重度**：P1
- **维度**：S / T / 结构
- **类别**：状态 / 结构 / 文案
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/ppt-studio.html:174-176`（state `discuss`；原文：中心区为“需求简报 / 讨论中逐项补全 · 你也可以直接改”，五项 `给谁看/想达到/篇幅/风格/依据资料` 逐项渲染，未补项 `bf.pending` 显示“等待讨论”，刚补项 `bf.fresh` 高亮动画；底部“还差 N 项，回答右侧助手的问题即可”/“信息已经足够，可以让助手出方案”+ 主按钮“生成制作方案”，`st.brief>=4` 前禁用）；`:195-199`（助手消息内带“工程新人 / 产品与设计 / 外部合作方”“10 分钟 · 3–4 页 … 你决定”等快捷选项）；另见 `originals/main/REVIEW.md:359`（“随右侧对话逐项补全，新补的一项会闪一下；助手问题带快捷选项。还差几项写在底部，补齐后‘生成制作方案’”）。
- **实现位置**：`apps/web/src/pages/ppt/PptWorkbenchSteps.tsx:36-178`（`PptStepDiscussion`，`:75-177` 为渲染）；`apps/web/src/pages/ppt/PptProductionPanels.tsx:15-23`（`PptBriefEditor` 固定渲染 5 个 textarea + “保存需求简报”）；`:161-175`（保存 + “下一步：设计方案”两按钮）；`apps/web/src/pages/ppt/PptAssistantPanel.tsx:54-62`（消息仅 ReactMarkdown 文本、无快捷选项）
- **差异**：五项简报始终全量可编辑，没有逐项完成状态、没有“还差 N 项”、没有“新补一项”高亮；主 CTA 是“下一步：设计方案”（纯导航）而不是设计里“补齐后生成制作方案”（推进方案生产）；助手没有快捷选项；讨论中心额外出现设计没有放在本阶段的标题/主题/大纲编辑（设计把标题/主题放在创建卡、把大纲放在②设计方案）。
- **原因**：直接原因 `PptBriefEditor` 只做全量表单，讨论阶段没有从 `work.brief` 派生逐项完成度的 UI 分支，CTA 只是切步骤；根本原因 C2（状态分支缺失）+ C4（区域/控件缺失）+ C3（文案），助手快捷选项还受 C1 限制（`packages/shared/src/domain/models.ts:1265` `PptAssistantMessage` 只有 `text` 字段，没有结构化选项）。
- **影响**：讨论阶段用户看不到还差什么、什么时候可以出方案；设计“对话引导逐项补全”的核心体验消失，新用户容易卡住；从助手候选补全某项后中间区没有反馈。
- **建议**：用 `work.brief` 与服务 `work.actions.design.reason`（`packages/engine/src/ppt.ts:86-89,447`）派生五项完成度，按设计渲染 pending/已补/新补样式与底部“还差 N 项 / 信息已经足够”；主 CTA 文案改为“生成制作方案”并驱动方案生成（生成大纲）而非仅切步骤；快捷选项若要做需先在共享 DTO 增加结构化候选字段。
- **验证**：静态 / 需GUI
- **关联状态**：`discuss, pl-brief`

### P07-02: ② 设计方案的大纲不可增删排序、缺“回到讨论 / 确认并开始制作”确认条
- **严重度**：P1
- **维度**：结构 / A
- **类别**：结构 / 交互
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/ppt-studio.html:177-183`（state `plan`；原文：工具栏“制作方案 / 确认后才开始逐页制作 · 之后仍可调整”；大纲“大纲 · 6 页”+“加一页”，每行 `序号 · 标题 · 说明 · ⋯菜单（改写要点 / 上移 / 删除这一页）`；“视觉方向”三个带色块预览的方向卡；底部 sticky `foot-cta`“确认方案 / 将生成 6 页 · 约 3 分钟 · 制作中可以继续和助手讨论”+“回到讨论”+主按钮“确认并开始制作”）；另见 `originals/main/REVIEW.md:360`（“大纲（可增删、调整顺序）+ 三个视觉方向缩略图（推荐一个）；底部‘回到讨论 / 确认并开始制作’，说明页数与预计时长”）。
- **实现位置**：`apps/web/src/pages/ppt/PptWorkbenchSteps.tsx:181-329`（`PptStepDesign`）；只读大纲 `:239-268`（`<ol className="ppt-outline">` 仅渲染文本）；视觉方向 `PptProductionPanels.tsx:33-35`；确认动作只在 `apps/web/src/pages/ppt/PptPlanDrawer.tsx:59`（`确认方案`）与 `:49`（`保存方案`）；加页只在制作检查左栏 `PptStudio.tsx:108`
- **差异**：① 大纲在本阶段只是只读列表，没有行级 ⋯ 菜单、上下移、删除、加一页；② 没有底部确认条（页数、预计时长、回到讨论、确认并开始制作）；③ 方向卡存在且有真实预览与“已选”，但点选即写服务（见 `P07-12`）；④ 本阶段主操作是“生成大纲 / 生成逐页内容”两个命令按钮，设计语义被替换。
- **原因**：直接原因 design 步骤只接入了大纲/逐页生成，方案确认与大纲行编辑被放在 480 抽屉（`PptPlanDrawer` / `PptPlanSections.tsx:37` 才有行移动），本阶段没有承载它们的组件与命令；根本原因 C4（关键区域/操作缺失）+ C5（确认/返回流程不同）。
- **影响**：主流程第②步没有“完成”动作，用户不清楚何时可以进入制作；想调整大纲要回讨论步骤改文本框或另开抽屉，与设计“方案阶段直接增删排序”不符；设计“确认并开始制作”的一句话收束不存在。
- **建议**：在②设计方案补大纲行编辑（复用 `PATCH /api/ppt/works/:id` 的 update 命令与 `outline/slides` 字段）、加一页；补底部确认条（页数 = `plan.pageCount` 或 outline 长度、预计时长按服务能力给出或如实标注未知、回到讨论、确认并开始制作）；确认动作与抽屉“确认方案”共用同一命令，避免两个入口两套语义。
- **验证**：静态 / 需GUI
- **关联状态**：`plan, pl-frozen, pl-review`

### P07-03: 制作方案抽屉缺阶段层（顶部阶段条 / 按方案制作 / 修改方案），`pl-review` 只读边界未实现
- **严重度**：P1
- **维度**：A / S / 结构
- **类别**：交互 / 状态 / 数据契约
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/ppt-studio.html:297-303`（`plPhase()` 四种情况：已归档只读+原因；制作中只读+原因；已用于制作→“方案已用于制作 / 重新打开后才能修改；现有页面和导出会保留。”+`修改方案` 按钮，`:301` 点击弹确认“修改制作方案？/现有页面和导出会保留。修改后需要重新制作才会生效。”；可编辑→“按方案制作”，`:302` dirty/loading/error 时禁用并 title“先保存方案，再开始制作”）；`:260` `plRO()`（`active||archived||!PL_EDIT.includes(phase)`，`:242` `PL_EDIT=['BRIEFING','DIRECTION','DESIGN']`）；`originals/main/REVIEW.md:1293-1297`（顶部阶段条四种情况）、`:1339`（pl-review：“已用于制作，需重新打开（「修改方案」带确认）”）、`:1346-1352`（“只有 BRIEFING / DIRECTION / DESIGN 阶段可编辑；制作中、已归档、正在看历史版本或有原操作未结清时只读”）、`:1358-1360`（按方案制作=`ppt.generate`；修改方案=`ppt.reopenPlan`，确认后执行）
- **实现位置**：`apps/web/src/pages/ppt/PptPlanDrawer.tsx:43-59`（`dirty` → footer；`:45` `frozen = plan.confirmed`；`:57` footer 状态 + 保存按钮；`:59` 顶部一行“方案方向已确认；页面、素材与备注仍可调整”+“重新打开需求”/“确认方案”）；`apps/web/src/pages/ppt/PptPlanSections.tsx:29,33,37,41,45,49,53`（各模块禁用条件：只有制作目标与方向字段吃 `frozen`，页面内容/视觉规范/图表素材/演讲辅助/交付设置不吃）；`packages/shared/src/domain/models.ts:1205-1216`（`PptProductionPlan` 只有 `confirmed` 布尔，无阶段字段）
- **差异**：① 抽屉没有顶部阶段条与设计的主操作：无“按方案制作”，也没有“修改方案”确认对话框；“重新打开需求”只是把本地 `plan.confirmed` 置 false（`PptPlanDrawer.tsx:59`），要再点“保存方案”才生效，且没有设计的确认文案与“修改后需要重新制作才会生效”的后果说明。② `pl-review`“已用于制作”时设计是**整表只读**（`plRO()===true`，fieldset disabled），实现里除方向与制作目标外，页面内容、视觉规范、图表素材、演讲辅助、交付设置仍可编辑并随“保存方案”直接落库（`PptPlanDrawer.tsx:49` 会提交 `plan`+`slides`+`brief`+`direction`）。③ 缺叙事结构内的“已确认”徽标与 banner 原文（设计 `:275-277`）。
- **原因**：直接原因前端只把 `confirmed` 单布尔当成冻结开关，缺少“未确认 / 已确认 / 已用于制作（REVIEW）”的阶段建模与整表只读；设计阶段状态服务契约里也没有对应字段（`PptProductionPlan` 只有 `confirmed`），只能从“是否已有生产状态/已开始制作”派生而实现未做；根本原因 C5（阶段操作缺失）+ C2（状态分支缺失），并按 C1 记录“服务未暴露阶段字段”这一契约缺口。
- **影响**：方案一旦确认并用于制作，用户仍能无声修改页面/视觉/交付等模块并保存，设计要防的“已用于制作后的方案改动”没有防住；“按方案制作”入口缺失使 B-09 阶段条无法完成；与 `pl-frozen`（可编辑章节/页面）语义接近但和 `pl-review`（全只读）无法区分。
- **建议**：短期按设计把 `confirmed` 且已有生产记录的作品视为 REVIEW 阶段：整表只读、只留“修改方案”确认对话框；补顶部阶段条四态与“按方案制作/修改方案”两个操作（修改方案=确认后置 `confirmed=false` 并保存一次，按方案制作=在有已保存方案且无脏草稿时触发生成/逐页制作）；如需精确 BRIEFING/DIRECTION/DESIGN 阶段，先在共享契约加字段（C1）。
- **验证**：静态（可判定只读语义）/ 需GUI
- **关联状态**：`pl-review, pl-frozen, pl-ro-active, pl-ro-archived, pl-saving`

### P07-04: 只读态（制作中 / 已归档）无原因说明、页头无“已归档”徽标、只读时保存按钮未隐藏
- **严重度**：P2
- **维度**：S / T / A
- **类别**：状态 / 文案 / 交互
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/ppt-studio.html:299-301`（已归档：“作品已归档，方案只读 / 恢复作品后才能修改或重新制作。”+`修改方案` disabled title“作品已归档”；制作中：“助手正在制作，方案暂时只读 / 制作完成或停止后，才能重新打开修改。”+title“制作进行中”）；`:338`（归档时页头 `PL_HEAD` 徽标“已归档”）；`originals/main/REVIEW.md:1296-1297`（制作中/已归档只读并写明原因、页头加已归档徽标）、`:1324`（只读时隐藏保存，改为“只读 · 已保存修订 8”）
- **实现位置**：`apps/web/src/pages/ppt/PptWorkbench.tsx:53-58`（`blocked` 与 `blockedReason` 计算，归档原因为“作品已归档；请先在作品库恢复。”）；`:72-77`（页头只渲染 `pptStatusMeta(work.status)` 徽标：草稿/生成中/已生成/部分完成/生成失败，无归档徽标）；`:63`/`PptPlanDrawer.tsx:12-18`（抽屉只收到 `blocked`，没收到 `blockedReason`）；`PptPlanDrawer.tsx:57`（只读时 footer 显示“当前只读”但保存按钮仍以 disabled 形式显示）；`:50-51`（所有输入只设 `disabled`，无原因）
- **差异**：制作中/已归档时抽屉只显示“当前只读”，不告诉用户为什么、怎么恢复；只读时保存按钮未按设计隐藏；工作台页头无法区分“已归档”作品与正常作品；两段 phase 横幅原文均未出现。
- **原因**：直接原因 `blockedReason` 只传给了讨论/设计/导出步骤与 `PptStudio`，没有传到计划抽屉；归档徽标只在作品库使用（`PptWorksView.tsx:53` 的归档/恢复按钮）；根本原因 C3（文案/状态缺失）+ C2（只读原因状态未渲染）。
- **影响**：只读状态下用户无法判断原因与恢复路径；禁用控件无原因违反项目约定“禁用按钮必须有服务给出的原因”。
- **建议**：把 `blockedReason` 与 `busyKind` 传入 `PptPlanDrawer`，按设计渲染两条 phase 横幅原文；只读时隐藏保存按钮并显示“只读 · 已保存修订 N”；`PptWorkbench` 页头补 `work.archived` 的“已归档”徽标（并放恢复入口，见 `P07-05`）。
- **验证**：静态 / 需GUI
- **关联状态**：`pl-ro-active, pl-ro-archived`

### P07-05: 作品菜单缺失，制作方案入口不受“页面已生成后”约束
- **严重度**：P2
- **维度**：结构 / 导航
- **类别**：结构
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/ppt-studio.html:171`（`STAGE>=2` 才渲染“作品菜单” ⋯ 图标按钮）、`:334`（菜单项：制作方案 / 资料与素材 / 版本与导出 / 归档或恢复这份作品）；`originals/main/REVIEW.md:1281`（“页面已生成后（制作检查阶段），页头最右侧新增「⋯ 作品菜单」”）、`:532`（新入口：PPT 工作台「作品菜单」）
- **实现位置**：`apps/web/src/pages/ppt/PptWorkbench.tsx:84-106`（页头直接平铺“资料/版本/制作方案/导出”四个按钮，无 ⋯ 菜单）；归档/恢复只在作品库 `apps/web/src/pages/ppt/PptWorksView.tsx:53`
- **差异**：无作品菜单；没有归档/恢复入口；“制作方案”按钮在讨论/设计阶段也常显，而设计只在制作检查阶段出现；“版本与导出”合并项被拆成两个独立按钮（能力不丢，入口结构不同）。
- **原因**：直接原因页头按四个并列按钮实现；根本原因 C4（菜单/入口结构缺失）。
- **影响**：从工作台无法归档/恢复（必须回作品库）；讨论阶段就能打开七模块方案，容易在方案未定时误操作；B-09 的入口设计无法验收。
- **建议**：按设计加 ⋯ 作品菜单（制作方案 / 资料与素材 / 版本与导出 / 归档或恢复作品），归档/恢复复用 `kind:'archive'` 命令；制作方案入口加“已有页面/进入制作检查”可见条件。
- **验证**：静态 / 需GUI
- **关联状态**：`make, done, issues, edit, pl-*`

### P07-06: `pl-blocked` 对象草稿未保存时不拦截打开制作方案
- **严重度**：P2
- **维度**：A / S
- **类别**：交互 / 状态
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/ppt-studio.html:330-337`（`openPlan` 时若 `st.edit && st.sel` 走 `plBlock()`；`plBlock` 给工作台顶部插入“制作方案没有打开 / 对象或页面输入尚未保存，请先核对属性；草稿仍保留。”+“去核对属性”，并给属性面板顶部加“标题文字未保存”徽标）；`:339`（`pl-blocked` 启动态）；`originals/main/REVIEW.md:1283,1344,1356`（protect() 拦截）
- **实现位置**：`apps/web/src/pages/ppt/PptWorkbench.tsx:95`（制作方案按钮无拦截）；`apps/web/src/pages/ppt/PptStudio.tsx:56-77`（对象/页面草稿只存在 studio 内部 state 与 sessionStorage，未向 workbench 暴露“有未保存草稿”）；无对应 banner/徽标代码
- **差异**：对象属性修改未保存（`drafts` 非空）时仍可直接打开制作方案抽屉。更糟的是：保存方案会推进作品修订，studio 里的旧草稿随后变成“旧修订草稿”，保存被禁（`PptStudio.tsx:114`），只能“放弃本页修改”或先比对，用户会困惑；设计要求的拦截提示与属性页“未保存”徽标都不存在。
- **原因**：直接原因页面草稿状态没有上提为工作台共享状态、也没有 protect() 等价逻辑；根本原因 C2（状态缺失）+ C5（交互保护缺失）。
- **影响**：用户按设计预期以为会被拦住，实际会制造旧修订草稿，存在丢失/混淆人工编辑的风险。
- **建议**：把“studio 有未保存页面草稿”上提为 workbench 状态，打开制作方案前拦截；在工作台顶部与对象属性页签补设计原文提示与“标题文字未保存”徽标。
- **验证**：静态 / 需GUI
- **关联状态**：`pl-blocked, edit`

### P07-07: `pl-loading` / `pl-error` 缺失；工作台深链加载/读取失败退化为空态
- **严重度**：P2
- **维度**：S / D
- **类别**：状态
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/ppt-studio.html:307-309`（读取失败：danger 条“制作方案读取失败 / 作品服务暂时没有返回方案（错误 502）。已保存的方案没有变化。”+“重新读取”）、`:313-315`（读取中：`role=status`“正在读取制作方案…”+ 4 块骨架，页签 `disabled`；读取失败 body 显示“方案暂时不可用 / 重新读取成功后，七个模块会显示在这里”；`:310` 页签 disabled）；`originals/main/REVIEW.md:1326`
- **实现位置**：`apps/web/src/pages/ppt/PptPlanDrawer.tsx:12-18,64-70`（直接读 `work.plan`，无 loading/error 分支，页签从不 disabled）；`apps/web/src/pages/ppt/PptPage.tsx:92-97`（works 查询）、`:296-351`（`view==='workbench'` 且 `selectedWork===undefined` 时只渲染空态：loading 与 error 都被当成“还没有选择作品”）
- **差异**：制作方案数据随作品列表返回，抽屉自身永远瞬时 ready，没有读取中/读取失败分支，也没有设计要求的错误条+重试+页签禁用；而工作台深链（`/ppt?work=<id>`）在作品列表加载中或失败时显示误导性的空态，没有 loading 骨架、错误原因与重试。
- **原因**：直接原因 `plan` 内嵌于 `PptWork`、没有独立读取接口（C1：`packages/shared/src/domain/models.ts:1300`），工作台视图缺 works 查询的 loading/error 分支（C2）。
- **影响**：深链/刷新/网络失败时用户看到“还没有选择作品”，会以为作品丢了；无重试入口。
- **建议**：工作台视图补 `worksQuery.isLoading`（加载骨架/进行中文案）与 `worksQuery.isError`（`ServiceNotice` + 重试 + 返回作品库）；抽屉若要保留内嵌数据，把“读取中/读取失败”判定落在作品列表读取上，而不是伪造 per-panel 状态并记入设计变更。
- **验证**：静态 / 需GUI
- **关联状态**：`pl-loading, pl-error`

### P07-08: 编辑保存模型与设计相反（自动保存状态层缺失，`pl-saving` 不可达，保存中显示“当前只读”）
- **严重度**：P2
- **维度**：A / S / T
- **类别**：交互 / 状态
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/ppt-studio.html:169`（页头“修订 8 · 已自动保存”/“草稿 · 已自动保存”）；`:316-321`（底部状态三态：“已自动保存 · 14:32”/“等待自动保存…”/“修改已保留，请核对后保存 · 强调色格式不正确 · 自动保存已暂停”；只读时“只读 · 已保存修订 8”）；`:325-328`（`plTouch` 1.4s debounce 自动保存）；`:258`（`saved:'14:32'`）；`originals/main/REVIEW.md:1322-1326`（固定底部保存栏三态、冲突停止自动保存）、`:1348`（版本冲突时停止自动保存，输入保留）
- **实现位置**：`apps/web/src/pages/ppt/PptPlanDrawer.tsx:43-49,57`（`dirty` 计算 + 显式 `save()`；无定时自动保存、无已保存时间，footer 只有“有未保存的修改 / 已保存 rN / 本地修改保留，请先核对新修订”）；`apps/web/src/pages/ppt/PptStudio.tsx:113-114`（演讲备注与页面对象编辑需“保存本页修改”，未保存草稿仅存 sessionStorage）；`apps/web/src/pages/ppt/PptWorkbenchSteps.tsx:161-175`（讨论保存也是显式按钮）；`apps/web/src/pages/ppt/PptWorkbench.tsx:135-145`（页头 meta 用“最近保存于 X”而非“已自动保存”）；`PptWorkbench.tsx:53` → `PptPlanDrawer.tsx:57`（保存中 `busyKind='update'` 令 `blocked=true`，footer 显示“当前只读”）
- **差异**：① 没有自动保存，也就没有“已自动保存 · 时间/等待自动保存…”状态与“修改已保留，请核对后保存”；`pl-saving` 不可达，`pl-conflict` 的“自动保存已暂停”也不存在；② 页头没有设计要求的保存状态提示（只有最近保存时间）；③ 保存进行中抽屉状态位变成“当前只读”，而不是“正在保存/等待保存”，语义错误。
- **原因**：直接原因前端整体采用显式保存（写操作统一 requestKey + 回执），设计稿假设自动保存；根本原因 C5（交互模型不同）+ C2（保存状态分支缺失）。这一条属于“设计交互 vs 实现交互”的取舍，显式保存更符合回执模型，建议 Lead 在汇总时确认：按设计补自动保存，或把该差异登记为设计变更（C9/C10）并同步更新设计说明。
- **影响**：用户每一步都要记得点保存，容易漏存；设计验收中 `pl-saving`/`pl-conflict`/页头“已自动保存”均无法演示；保存中状态污染只读文案。
- **建议**：二选一并记录决策——(a) 按设计实现 debounce 自动保存（PATCH 带 `expectedRevision`，409 转冲突态并暂停）；(b) 保留显式保存，但在抽屉与页头补“有未保存修改 / 正在保存 / 已保存 R”状态，保存期间显示“正在保存…”而不是“当前只读”，并把差异写入设计变更记录。
- **验证**：静态 / 需GUI
- **关联状态**：`pl-saving, pl-conflict, edit, discuss`

### P07-09: `pl-conflict` 无“读取最新方案”合入路径，409 后不主动刷新
- **严重度**：P2
- **维度**：A / S / R
- **类别**：交互 / 状态
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/ppt-studio.html:308`（琥珀条“方案已有新版本（修订 9）/ 当前输入已保留，自动保存已暂停。读取最新方案后再决定如何合并你的修改。”+按钮“读取最新方案”）；`:326`（冲突时暂停自动保存）；`originals/main/REVIEW.md:1325`（版本冲突：琥珀提示 + “读取最新方案”）
- **实现位置**：`apps/web/src/pages/ppt/PptPlanDrawer.tsx:46-48`（`revision` 仅在本地 plan/slides 与服务一致时同步）、`:58`（`stale` 条：`details` 查看服务当前方案 JSON + “已比对，按当前修订保存我的修改”）；`apps/web/src/pages/ppt/PptPage.tsx:150-209`（命令失败只 `setReceipt`，不刷新 works）、`:96`（works 仅当生成中/`mutationBlock` 时 1.5s 轮询）
- **差异**：`stale` 条只有在 `work.revision` prop 变化后才出现；PATCH 409 后作品列表不刷新，抽屉不会自动进入陈旧态，用户只看到回执条的失败文案（服务原文“作品已有新版本，本地修改保留，请重新读取并比对”），没有设计中的“读取最新方案”按钮，也没有立即拉取最新方案比对的动作；当前“已比对，按当前修订保存我的修改”是本地覆盖式保存，不是设计的先读取再合并。
- **原因**：直接原因作品列表查询 hook 没有向抽屉暴露 reload，冲突恢复依赖背景刷新（窗口聚焦/其它命令）；根本原因 C5（恢复交互缺失）+ C2（冲突状态未主动进入）。
- **影响**：双窗口/多端编辑时 409 后用户难以继续，容易反复重试或放弃本地修改，与设计“保留输入→读取最新→决定合并”的闭环不符。
- **建议**：给抽屉传入 reload 回调（重新 GET 作品列表或单作品读口），在 `stale`/PATCH 409 时展示设计原文的琥珀条与“读取最新方案”；命令失败后主动 `invalidateQueries(['ppt','works'])`。
- **验证**：静态 / 需真实服务（并发修订）/ 需GUI
- **关联状态**：`pl-conflict`

### P07-10: 资料抽屉与“每页依据”偏离设计：项目文档不可选，只有作品附件
- **严重度**：P2
- **维度**：结构 / D
- **类别**：数据契约 / 结构
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/ppt-studio.html:145`（资料抽屉 head：“资料 / 助手制作时可以引用的内容”+ footer “上传资料”/“完成”）、`:170`（页头“资料 3”）、`:224`（`openSrcs` 列出 `architecture.md / design-contract.md / api-reference.md` 项目文档并带勾选）、`:292`（图表素材“每页依据”为胶囊复选，未就绪资料显示“解析中”并禁用）；`originals/main/REVIEW.md:1319`（“每页依据用胶囊复选：未就绪资料显示「解析中」，并且禁用”）
- **实现位置**：`apps/web/src/pages/ppt/PptWorkbench.tsx:84-93`（“资料 {attachments.length}”）、`:149`（`Drawer title="作品资料"`，内容为 `PptStepCheck attachmentsOnly`）；`apps/web/src/pages/ppt/PptWorkbenchSteps.tsx:409-461`（附件列表 + 添加文本/图片表单，无项目文档、无“上传资料/完成”页脚）；`apps/web/src/pages/ppt/PptPlanSections.tsx:45`（每页依据复选框只遍历 `work.attachments`）；`packages/shared/src/domain/models.ts:1296-1321`（`PptWork` 只有 `attachments`，无项目文档/来源选择字段、无解析状态）
- **差异**：① 资料抽屉不是设计的信息架构（项目文档列表 + 勾选 + 上传资料 + 完成），而是作品附件的增删表单；② 不可把项目文档勾选为依据；③ 每页依据只列作品附件，没有“解析中/禁用”状态（服务端附件即时可用，无解析阶段）；④ 页头“资料 N”的 N 语义从“项目资料数”变成“附件数”。
- **原因**：直接原因设计依赖“作品来源/文档选择 + 就绪状态”的结构化字段（设计说明本身把结构化字段标为 PROPOSED，见 `originals/main/REVIEW.md:367`），服务只把项目资料自动喂给生成/助手（`packages/engine/src/ppt.ts:388-398 #documents`、`:39` 的 documents 闭包）而没有可选来源端点与解析状态；根本原因 C1（契约缺失）+ C4（抽屉结构）。
- **影响**：用户无法像设计那样挑选依据资料、也看不到项目文档被引用；简报“依据资料”只能手填；资料抽屉沦为附件管理，助手/生成实际读到的资料与用户以为的不一致。
- **建议**：若要对齐，先立契约：服务新增“作品来源”读/选接口（项目文档列表、每页 `sourceIds`、就绪/解析状态），前端再补胶囊复选。短期至少把抽屉标题/说明/页脚与“项目文档（只读列出，来自项目根）”补上，并在简报“依据资料”写清附件与项目文档的区别。
- **验证**：静态 / 需真实服务
- **关联状态**：`discuss, plan, pl-assets`

### P07-11: 检查页签信息架构缺失（已检查页数、三项通过清单、“让助手精简”、用户化问题文案）
- **严重度**：P2
- **维度**：结构 / T
- **类别**：结构 / 文案
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/ppt-studio.html:214-216`（state `issues`/`make` 检查页签：顶部“1 个问题 · 5 页已检查”/“1 个问题 · 6 页已检查”+“重新检查”；问题行“第 3 页 · 正文可能溢出 / 在 16:9 投影下超出安全区约 2 行”+按钮“让助手精简”；下方三项通过“字号层级一致 / 颜色在投影下可读 / 无占位文字”）
- **实现位置**：`apps/web/src/pages/ppt/PptStudio.tsx:120`（标题“当前修订检查”+重新检查+问题列表+“尚需人工核对”；无计数与通过清单）；`apps/web/src/pages/ppt/PptStudio.tsx:107`（缩略图问题图标）；`packages/shared/src/domain/ppt-renderer.ts:78-106`（`checkPpt` 的 issue code/message 与 `unchecked` 文案）
- **差异**：① 无“X 个问题 · Y 页已检查”的头部计数（只有“修订 N · 由当前内容与版式规则检查”）；② 无设计固定三项通过清单，只有“当前规则未发现问题”整句 + 服务 `unchecked` 列表（内容不同：事实准确性/字体投影/图片授权）；③ 问题行没有“让助手精简”直达操作（只能手动切助手页签再描述）；④ 问题文案直接显示服务技术口径（如“文本框底边 1.23 英寸，超出页面安全区域 7.1 英寸”），设计面向用户的“在 16:9 投影下超出安全区约 2 行”没有映射。
- **原因**：直接原因检查页签只做了“问题列表 + 人工核对”，没有按设计组织计数/通过项/联动操作；根本原因 C4（清单与操作缺失）+ C3（用户文案未映射），服务消息本身是工程口径（C6 映射缺失）。
- **影响**：用户难以判断“检查了什么、哪里没问题”，也不方便直接让助手修；技术文案对非工程用户不友好，影响“检查有问题”状态的使用。
- **建议**：补“X 个问题 · Y 页已检查”和三项通过清单——能用服务 code 映射的映射（`FONT_HIERARCHY`→字号层级一致、`PLACEHOLDER`→无占位文字），“颜色在投影下可读”服务无能力则放入“尚需人工核对”并记为设计缺口（C9）；问题行加“让助手精简”（切助手页签并把问题描述预填 composer）；issue.message 做用户化映射或由服务返回 `title/detail` 两级文案。
- **验证**：静态 / 需GUI
- **关联状态**：`issues, make`

### P07-12: 同一“视觉方向”字段在两处入口保存语义不一致
- **严重度**：P2
- **维度**：A / S
- **类别**：交互 / 数据语义
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/ppt-studio.html:181-183`（②设计方案三个方向卡选择写本地 `st.dir`，`确认并开始制作` 才推进）；`:269-277`（制作方案叙事结构里方向卡单选取本地 `pl.dir`，底部“保存方案”才提交）；`originals/main/REVIEW.md:1294`（有未保存修改时“按方案制作”禁用）、`:1350`（保存、重新打开、制作都是显式操作）
- **实现位置**：`apps/web/src/pages/ppt/PptProductionPanels.tsx:33-35`（`PptDirections` 点选立即 `onCommand({kind:'update', ..., direction, expectedRevision: work.revision})` 持久化）；`apps/web/src/pages/ppt/PptPlanSections.tsx:33`（抽屉内 radio 只 `setDirection` 本地草稿）+ `PptPlanDrawer.tsx:49`（保存时提交 `direction`）
- **差异**：同一字段 `direction` 在两处语义相反：②设计方案点选即发 PATCH（服务立即变、无脏态、无确认），制作方案抽屉内需点“保存方案”；设计在两处都是本地草稿、由确认/保存提交。方案步骤的即时 PATCH 还使用全局 `work.revision` 作 expectedRevision，期间若有其它修改会得到 409，用户视角莫名其妙。
- **原因**：直接原因 `PptDirections` 直接复用命令通道，抽屉走草稿提交；根本原因 C5（交互/回执语义不一致）+ C6（同一字段两套保存路径）。
- **影响**：用户在两处看到不同行为，方案阶段误点方向会立即改服务数据与后续模型提示；产生无谓的 409；难以解释“为什么这里点一下就变了”。
- **建议**：统一为“本地草稿 + 底部显式提交”（推荐，与设计一致），方案步骤的方向选择进入方案草稿、随确认条提交；或反向把抽屉也改成即时保存并显示回执，但需 Lead 确认，并保证同一字段只有一个保存语义。
- **验证**：静态 / 需GUI
- **关联状态**：`plan, pl-narrative`

### P07-13: 检查问题标记弱化（缩略图灰图标、页头仅数量）
- **严重度**：P2
- **维度**：V / 结构
- **类别**：样式主题 / 结构
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/ppt-studio.html:191-194`（页头当前页 warn 时显示 `badge st-fail`“文字可能溢出”；左栏 `.tb .flag` 为右上角 16×16 圆形、`background: var(--warn)`、深色 alert 图标；`:214` 检查页签计数徽标 `${I('shield','sm')}检查 1`）；`originals/main/REVIEW.md:361`（“左侧缩略图，有问题的页右上角琥珀标记”）
- **实现位置**：`apps/web/src/pages/ppt/PptStudio.tsx:107`（缩略图内 `<Icon name="alert" size="sm"/>`）；`apps/web/src/pages/ppt/ppt.css:537-539`（`.ppt-studio-thumb{... color: var(--muted)}`，`>svg` 只做绝对定位，无 warn 色/圆形旗标）；`PptStudio.tsx:111`（页头只显示 `{currentIssues.length} 个检查问题` 的 hint，无具体问题文案徽标）
- **差异**：问题页标记是继承 muted 的灰色小图标，不是设计要求的琥珀旗标；页头没有“第 N 页 · 正文可能溢出”这样的具体问题徽标（只有数量）。深色主题下灰色图标与普通缩略图信息对比不足（静态推断，需 GUI 确认）。
- **原因**：直接原因未给缩略图标记套 `--warn` 与圆形旗标样式，页头未把当前页首个 issue 映射成徽标；根本原因 C7（样式/视觉）+ C3（问题文案未上页头）。
- **影响**：缩略图“一眼看出哪页有问题”的改版目的被弱化；四主题下可见性存疑。
- **建议**：按设计给缩略图加琥珀圆形旗标（`background: var(--warn)` + 深色图标）；页头按当前页问题显示 `badge st-fail` 文案（取 issue 的用户化文案，见 `P07-11`）；保留检查页签计数徽标。
- **验证**：静态推断 / 需GUI
- **关联状态**：`issues, make, edit`

### P07-14: 视觉规范：文字密度未按设计改分段控件，无效态呈现缺三处
- **严重度**：P3
- **维度**：结构 / V
- **类别**：样式主题 / 结构
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/ppt-studio.html:288`（文字密度为 `seg role=group` 精简/适中/详细，`aria-pressed`）；`:287`（强调色带 `pl-sw` 色块预览，无效时 `pl-sw bad` 斜纹 + `input mono invalid` + error-text“请输入 6 位十六进制色值，例如 #4D6BFE。修正前不会保存。”）；`:310`（有无效字段的页签带红点 `.bad`）；`originals/main/REVIEW.md:1316-1317`（强调色色块/斜纹/输入框标红；文字密度“改成了分段控件”）、`:1381`（文字密度原系统下拉，原型改成分段控件，存值不变）
- **实现位置**：`apps/web/src/pages/ppt/PptPlanSections.tsx:41`（文字密度 `<select>`；强调色 `input.mono` + `aria-invalid` + error-text；无 swatch、无页签红点）；`apps/web/src/styles/ds.css:204`（`.input.invalid` 才标红，`aria-invalid` 不自动生效）
- **差异**：文字密度仍是下拉框（设计明确“改成了分段控件”）；强调色缺色块预览与无效斜纹、输入框不标红（只靠 error-text）、视觉规范页签无红点；error-text 文案缺空格与句号（“请输入6位十六进制色值，例如 #4D6BFE，修正前不会保存。” vs 设计“请输入 6 位十六进制色值，例如 #4D6BFE。修正前不会保存。”）。
- **原因**：直接原因未实现分段控件与色块预览、未套 `.invalid` 类、页签没有无效态标记；根本原因 C4 + C7（细节样式/控件）。
- **影响**：与 B-09 明确改版点不符，验收逐项对比会差异；无效强调色的定位弱于设计。
- **建议**：文字密度换 `SegmentedControl`（shared 已有组件，存值不变）；强调色补 40×40 色块（无效斜纹）+ `.invalid` 类 + 视觉规范页签红点；error-text 文案按设计原文。
- **验证**：静态 / 需GUI
- **关联状态**：`pl-visual-bad`

### P07-15: 方案各模块字段/文案细节缺失
- **严重度**：P3
- **维度**：结构 / T
- **类别**：结构 / 文案
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/ppt-studio.html:272`（方向卡 6 字段：方案名称/方向说明/讲述主线/章节安排/**建议页数**/视觉方向）、`:277`（“自行填写方向”按钮）、`:293`（演讲辅助标题“演讲辅助 / 讲稿、时长与过渡”，备注占位“这一页还没有讲稿”）、`:294-296`（交付设置 hint“导出时自动加上 .pptx”+ banner“正式导出为可编辑 PPTX，页面预览为 PNG。”）、`:281-283`（页面卡标题行“`${lay} · ${msg}`”摘要）、`:290`（“视觉要求指导助手制作，实际对象样式可在页面制作中调整。”）
- **实现位置**：`apps/web/src/pages/ppt/PptPlanSections.tsx:33`（方向字段 `title/description/storyline/chapters/visual`，缺 `suggestedPages`）、`:37`（卡 summary 只有“序号. 标题”，无版式/核心观点摘要）、`:49`（无“讲稿、时长与过渡”标题与空占位）、`:53`（交付设置无 `.pptx` hint，banner 改为“可编辑PPTX；页面预览来自当前作品内容渲染。”）、`:41`（视觉规范无结尾提示）
- **差异**：逐项如设计依据所列；另“自行填写方向”无法实现——服务 `validatePlan` 只接受 `restrained/editorial/contrast` 三个方向 id（`packages/engine/src/ppt-plan.ts:15-24`）。默认方案虽有 `suggestedPages` 值（`apps/web/src/pages/ppt/ppt-plan-defaults.ts:4-9`）但用户不可编辑。方向描述也未全用设计原文：设计“深色克制”描述为“深色底、少量强调色，和产品界面保持一致。”（`opencode-workflow-design-showcase/originals/main/pages/ppt-studio.html:245`），实现为“深色底、少量强调色，清晰呈现关键内容。”（`apps/web/src/pages/ppt/PptProductionPanels.tsx:29`），另两个方向一致。
- **原因**：直接原因字段/文案未对齐；根本原因 C3 + C4；“自行填写方向”受 C1（服务方向枚举限制）约束。
- **影响**：用户无法设置建议页数、方案卡可读性弱；PRD 逐字对比不通过，但不影响主流程。
- **建议**：补 `suggestedPages` 数字输入与页面卡“版式 · 核心观点”摘要；演讲辅助/交付设置/视觉规范按设计文案补齐（PNG 一句若实现确实用 SVG 渲染，应按诚实降级写成“页面预览由当前内容渲染”并记 C9）；“自行填写方向”待服务放开方向 id 后再做。
- **验证**：静态 / 需GUI
- **关联状态**：`pl-narrative, pl-slides, pl-notes, pl-delivery`

### P07-16: 章节/页面删除与“重新打开需求”缺确认对话框
- **严重度**：P3
- **维度**：A
- **类别**：交互
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/ppt-studio.html:273`（移除章节 `plConfirm('移除这个章节安排？','历史版本仍会保留。','移除',true)`）、`:282`（移除页 `plConfirm('移除这页设计？','历史版本仍会保留。','移除这页',true)`）、`:301`（修改方案 `plConfirm('修改制作方案？','现有页面和导出会保留。修改后需要重新制作才会生效。','修改方案',false,...)`）；`originals/main/REVIEW.md:1352`（“删除只有在原系统确认过的地方才弹确认（章节、页面、重新打开）”）
- **实现位置**：`apps/web/src/pages/ppt/PptPlanSections.tsx:33`（移除章节直接 `filter`）、`:37`（移除这页直接 `filter`）；`apps/web/src/pages/ppt/PptPlanDrawer.tsx:59`（“重新打开需求”直接 `setPlan({...plan, confirmed:false})`）
- **差异**：三处都即时改本地草稿（仍需保存），没有设计的确认对话框与“历史版本仍会保留 / 现有页面和导出会保留、修改后需要重新制作才生效”的后果说明。对“重新打开需求”影响最大。
- **原因**：直接原因未实现确认弹窗；根本原因 C5（确认步骤缺失）。
- **影响**：误删章节/页面（本地草稿无撤销）；重开方向缺少后果说明，用户可能误以为会立即重新生成页面。
- **建议**：复用 `Modal` 实现三处确认，按设计原文；删除仍只改本地草稿，保存后生效。
- **验证**：静态 / 需GUI
- **关联状态**：`pl-narrative, pl-slides, pl-review`

### P07-17: 导出实现为第四步页面而非设计对话框，缺“检查中未处理问题”提示，多出 Markdown 与删除区
- **严重度**：P3
- **维度**：结构 / T
- **类别**：结构 / 文案
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/ppt-studio.html:225-228`（导出为对话框：制作中时告警“第 5、6 页仍在制作。现在导出将只包含已完成的 4 页。”；格式 PowerPoint (.pptx)/PDF 单选，默认 pptx；默认勾选“包含演讲备注”；底部 hint“导出基于修订 8 · 6 页 · **检查中有 1 个问题未处理**”）；`:171`（页头导出为主按钮，`STAGE<2` 禁用）；`originals/main/REVIEW.md:363`（“版本 / 资料为 480 抽屉；导出为对话框”）
- **实现位置**：`apps/web/src/pages/ppt/PptStepExport.tsx:66-79`（`format`/`includeNotes`/`exportBlocked`）、`:131-141`（未完成页用服务 reason 作 warn banner + “导出由服务即时生成…”说明）、`:142-204`（“演示文件”卡：pptx/pdf + 包含备注）、`:206-256`（“Markdown（.md）”卡，设计没有）、`:259-281`（“删除作品”危险区 + `:283-328` 删除确认，设计没有）；页头导出按钮 `PptWorkbench.tsx:96-105` 永远可点（只切步骤）
- **差异**：① 导出是第四步独立页面，不是设计对话框（结构差异，但四步条本身把“导出”列为第四步，可视为合理产品化）；② 没有任何“检查中有 N 个问题未处理”的提示；③ 多出 Markdown 导出与删除作品危险区（设计里删除/归档在作品库）；④ 未完成页面时实现直接禁用导出（服务 `#assertProductionComplete` 拒绝未完成页导出，`packages/engine/src/ppt.ts:430-434`），而设计允许“带警告导出已完成页”——这是服务与设计的冲突（设计缺口 C9）。
- **原因**：结构差异归 C4（页面 vs 对话框、多出区域）；缺检查提示归 C2/C4；未完成页导出限制属服务契约（C1/C9），不应按实现缺陷计。
- **影响**：验收逐项对比会差异；导出能力本身可用且更诚实（有真实回执/失败原因/PDF 宿主禁用原因）。
- **建议**：如需对齐，将导出改回对话框并补“检查中有 N 个问题未处理”；Markdown 与删除区保留需产品确认并同步设计；“带警告导出已完成页”需服务放开部分导出，否则在设计中明确不开放（C9）。
- **验证**：静态 / 需GUI / 需真实服务（导出）
- **关联状态**：`make, done, issues`（导出不是持久状态，服务无“已导出”字段，见 `apps/web/src/pages/ppt/ppt-shared.tsx:94,139`）

### P07-18: 页头无面包屑、无“已自动保存”状态提示
- **严重度**：P3
- **维度**：R / T
- **类别**：导航 / 文案
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/ppt-studio.html:168`（页头 `<a href="ppt-works.html">PPT 制作</a> / <span class="ellipsis">项目入门与架构说明</span>` 面包屑）；`:169`（“修订 8 · 已自动保存”/“草稿 · 已自动保存”）；`originals/main/REVIEW.md:358`（页头：面包屑 + 四步进度 + 自动保存状态 + 资料/版本 + 导出）
- **实现位置**：`apps/web/src/pages/ppt/PptWorkbench.tsx:67-82`（返回按钮“作品库”+ h2 作品名 + 状态徽标，无面包屑链接）；`:135-145`（meta 行“修订 N · 阶段标签 · 页数 · 项目 · 最近保存于 X · 下一步”）
- **差异**：返回是按钮不是面包屑链接（URL 与导航语义仍在，`?work=` 可回退）；没有页头“已自动保存”状态提示（“修订 N”在 meta 行有，最近保存时间有）。保存模型差异见 `P07-08`。
- **原因**：C3（文案/结构）+ C5（导航形式），保存状态缺失根因同 `P07-08`。
- **影响**：页头信息层级弱于设计；用户在页头无法确认“是否已保存”。
- **建议**：补面包屑“PPT 制作 / 作品名”（前者回作品库，保留返回按钮或用链接）；保存状态提示与 `P07-08` 的决策统一。
- **验证**：静态 / 需GUI
- **关联状态**：全部

### P07-19: 四步进度条与制作检查细节偏差
- **严重度**：P3
- **维度**：V / 结构
- **类别**：样式主题 / 结构
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/ppt-studio.html:166`（`stepper()`：已完成 `done`/当前 `on` 两态，`:87-88` done 用勾）；`:91`（`@media (max-width:1380px){.stepper span:not(.on) .lb{display:none}}` 窄屏只显示当前步名称）；`:192`（演讲备注 `<details class="notes" ${S==='edit'?'':'open'}>`，手动编辑态收起，其余态展开）；`originals/main/REVIEW.md:358`（窄屏只显示当前步名称）
- **实现位置**：`apps/web/src/pages/ppt/ppt-shared.tsx:140-148`（`pptStepState` 返回 `done/current/todo/available`，`:144` 导出步骤有 `available` 态）；`apps/web/src/pages/ppt/ppt.css:271-340`（`.ppt-stepper` 仅 `flex-wrap`，无窄屏隐藏 label 的媒体查询）；`apps/web/src/pages/ppt/PptStudio.tsx:113`（`<details className="ppt-studio-notes" open>` 恒展开）
- **差异**：实现给导出步骤新增设计没有的 `available` 强调态（`data-state="available"` → accent 色）；窄屏未实现“只显示当前步名称”，4 个 label 一律显示并换行；手动编辑态演讲备注默认展开（设计在该态收起）。
- **原因**：C7（布局/视觉）+ C4（细节状态）；`available` 是实现自加的语义，需产品确认。
- **影响**：窄屏页头折行/拥挤风险（静态推断，需 GUI）；与设计像素差异。
- **建议**：按设计补 `max-width:1380px` 隐藏非当前步 label；确认 `available` 是否保留（若保留需在设计侧补状态）；备注 `details` 的 open 与当前是否手动编辑联动。
- **验证**：静态推断 / 需GUI（窄屏）
- **关联状态**：`make, done, issues, edit`

### P07-20: 可访问性与焦点细节
- **严重度**：P3
- **维度**：K / 结构
- **类别**：可访问性
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/ppt-studio.html:188`（开关 `role=switch aria-checked aria-label`）、`:206`（页签 `role=tablist/tab aria-selected`）、`:219`（aside `aria-label="PPT 助手"`）、`:221`（render 后 `m.scrollTop=m.scrollHeight` 助手消息自动滚到底）；`:223`（关闭按钮 aria-label）
- **实现位置**：`apps/web/src/pages/ppt/PptWorkbench.tsx:111-133`（`stepper` 用 `role=tablist/tab`，但无方向键处理、无 `aria-controls`、4 个 tab 均可 Tab 聚焦——`tabIndex` 未按 ARIA roving 约定设置）；`apps/web/src/pages/ppt/PptWorkbench.tsx:109,149` 使用的 `Drawer`（`apps/web/src/components/Drawer.tsx:18-41` 只有 Esc 与焦点归还，无 Tab 圈定；只有 `PptPlanDrawer.tsx:28-42` 自行实现了焦点圈定）；`apps/web/src/pages/ppt/PptAssistantPanel.tsx:53-56`（历史消息容器无自动滚动）
- **差异**：四步条 ARIA tab 语义不完整（缺 roving tabindex/方向键/aria-controls）；版本与资料抽屉没有 Tab 焦点圈定（计划抽屉有）；助手历史新消息不自动滚到底（设计在 render 后滚到底）。
- **原因**：C8（可访问性/键盘）+ C4（细节）；静态可判定语义，真实体验需 GUI。
- **影响**：键盘用户在 stepper 上 Tab 顺序不佳；抽屉内可 Tab 到背景；长对话需手动滚动。
- **建议**：`role=tablist` 补 roving tabindex + 左右键（参考 `PptStudio.tsx:82-90` 已实现的三页签键盘逻辑）；把焦点圈定下沉到 `Drawer` 公共组件；助手历史加 ref 自动滚底。
- **验证**：静态（语义）/ 需GUI（真实键盘）
- **关联状态**：`make, done, issues, edit, pl-*`

### P07-21: 版本/资料抽屉宽度与标题文案偏差
- **严重度**：P3
- **维度**：V / T
- **类别**：样式主题 / 文案
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/ppt-studio.html:144`（`drawer md`“版本 / 每次确认方案或批量修改都会生成一个修订”）、`:145`（`drawer md`“资料 / 助手制作时可以引用的内容”）；`originals/main/REVIEW.md:363`（版本/资料为 480 抽屉）、`:1282`（制作方案 480 抽屉）
- **实现位置**：`apps/web/src/pages/ppt/PptWorkbench.tsx:109`（`<Drawer ... title="版本与修订" size="lg">` → 520px，见 `apps/web/src/styles/ds.css:88,297` 的 `--drawer-lg:520px`）、`:149`（`<Drawer title="作品资料" size="lg">`）；`apps/web/src/pages/ppt/PptProductionPanels.tsx:55`（版本内容标题“版本与修订 · 当前 rN”，无设计说明）
- **差异**：版本/资料抽屉宽度 520 而非设计的 480（制作方案抽屉 `md`=480 是对的）；版本抽屉标题“版本与修订”且无“每次确认方案或批量修改都会生成一个修订”说明；资料抽屉标题“作品资料”而非“资料”，无“助手制作时可以引用的内容”。
- **原因**：C7（尺寸）+ C3（文案）。
- **影响**：与设计尺寸规范不符；标题语义偏差小。
- **建议**：两处改 `size="md"`；标题/说明按设计原文（资料抽屉标题随 `P07-10` 的信息架构一起改）。
- **验证**：静态 / 需GUI
- **关联状态**：全部

### P07-22: 助手面板呈现细节与设计不一致
- **严重度**：P3
- **维度**：T / 结构
- **类别**：文案 / 结构
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/ppt-studio.html:195-204`（助手消息 `.who` 带 20px 角色图标 + 名称；`:202` 修改建议差异卡“删除/替换”标签 + “只影响第 3 页 · 你手动改过的内容不受影响”+“不用了/应用”；`:203` 制作中助手消息“正在制作第 5 页 · 还剩 2 页”）；`:218`（composer 占位按阶段：“回答问题，或补充你的想法…”/“告诉助手要怎么改…”；修改范围为胶囊切换“仅第 N 页/整份演示”）；`:197,199`（助手问题带快捷选项）
- **实现位置**：`apps/web/src/pages/ppt/PptAssistantPanel.tsx:54`（消息只渲染 `div.hint`“你 / PPT 助手 · createdAt”，无角色图标）、`:61`（占位固定“回答问题，或告诉助手要怎么改…”）、`:58-60`（修改范围为 `<select>`，选项“需求讨论/仅所选页面/整份演示”）、`PptAssistantProposal.tsx:10-15`（页面级差异卡完整；`:13` brief/outline/plan 字段级候选以 `JSON.stringify` 的 `<pre>` 展示）
- **差异**：占位文案不随阶段变化；修改范围是下拉且多出设计没有的“需求讨论”选项（讨论态设计没有范围控件）；消息角色样式简化；字段级候选是 JSON 原文而非可读差异（设计只有页面级差异卡，字段级无设计）。
- **原因**：C3（文案）+ C4（控件形态）+ C9（字段级候选无设计，属实现自造；但可读性差属于实现自担）。
- **影响**：可读性与设计一致性；JSON 对非技术用户难以审阅简报/方案候选。
- **建议**：占位按步骤派生；范围控件按设计胶囊（“仅第 N 页/整份演示”）；字段级候选改可读 before/after（可复用页面级差异卡样式）；角色图标按设计补。
- **验证**：静态 / 需GUI
- **关联状态**：`discuss, plan, make, done, issues, edit`

## 已核对一致

- **四步框架**：`apps/web/src/pages/ppt/ppt-shared.tsx:84-89` 的 `PPT_STAGES` 键/顺序/文案（讨论需求 → 设计方案 → 制作检查 → 导出）与设计 `ppt-studio.html:166` 完全一致；导出不标记完成（服务无导出状态，`ppt-shared.tsx:94,139-148`）与设计 stepper 只到“当前=制作检查”的语义一致；四步入口在 `PptWorkbench.tsx:111-133` 可点可达。
- **逐页制作状态**：`PptStudio.tsx:91-112` 用服务真实 `production/generation.pages` 投影 `pending/generating/completed/failed/unknown/stopped`（标签与图标来自 `packages/shared/src/domain/enums.ts:846`），等待页显示“等待制作这一页”，生成中显示“正在制作这一页…”，thumb 有“等待制作”与状态徽标；生成进行中且当前页未完成时禁止手动编辑（`PptStudio.tsx:93-95,111-112`），与设计 `ppt-studio.html:188` 对 gen/wait 页禁用开关的意图一致。
- **停止生成**：`PptGenerationControls.tsx:22-28` 显示原请求号/停止请求号/“停止受理后仍等待原会话空闲；已有内容和版本保留”，`:28-44` 确认弹窗文案与“只停止原生成，保留简报、方案、已有页面和版本”一致；只核对原请求，不自动重发，符合设计与项目约定。
- **手动对象编辑**：`PptStudio.tsx:111` 开关（`role=switch` + disabled 原因）、`:112` 三个对象命中区（layout 驱动坐标，与 SVG 渲染共用 `pptPageLayout`）、`:119` 对象属性四项（文字/字号（8–72）/颜色（主文字/强调色/次要）/对齐（左/中/右））以及 banner“手动修改会被保留。之后让助手改这一页时，会先列出将覆盖的内容。”与设计 `ppt-studio.html:208-213` 一致；未保存草稿 sessionStorage 恢复、旧修订禁止覆盖（`:114`）是实现在设计“草稿保留”之上补充的诚实保护，不与设计冲突。
- **助手差异卡（应用/不用）**：`PptAssistantProposal.tsx:10-15` 页面级候选显示前/后正文与备注、“基于修订 N · 仅第 N 页/仅封面/整份演示”“不会自动覆盖人工内容”“只应用列出的字段；未列出的页面、字号、颜色、对齐与图片会保留”“不用了/应用”，过期修订禁用应用并提示重新讨论，与设计 `ppt-studio.html:202` 差异卡语义一致；应用走真实 requestKey 命令与回执（`PptAssistantPanel.tsx:54`）。
- **三个视觉方向**：`PptProductionPanels.tsx:24-35` 方向标题与设计 `ppt-studio.html:182` 一致（深色克制/浅色编辑/高对比；“深色克制”描述文案不同，见 `P07-15`），卡内有真实页面预览（`/thumbnail?direction=`）、`aria-pressed` 与“· 已选”，并把方向写回作品、经 `pptPalette` 同时影响页面渲染与 PPTX 导出（`packages/shared/src/domain/ppt-renderer.ts:11-14`、`packages/engine/src/ppt.ts:134`）。
- **检查服务真实**：`PptStudio.tsx:120` 的检查来自 `GET /api/ppt/works/:id/check`（`packages/server/src/http.ts:1006`），报告带 `revision` 与 `checkedAt`，问题可定位到页、可重新检查、有 loading/error 分支，并明确“尚需人工核对”（`ppt-renderer.ts:106`），不把规则检查称作视觉验收——数据诚实符合要求。
- **状态覆盖的逐页判定（正常路径）**：制作中/部分完成时 `pptStatusMeta` 给出“部分完成”（`ppt-shared.tsx:38-41`），导出按服务 `actions.export.reason` 禁用并显示原因（`PptStepExport.tsx:69-70,131`），正常读取下不会把部分完成当全部完成——但保存制作方案/加一页会触发 `P07-23` 的伪造完成，此处只确认读取侧映射正确。
- **导出**：`PptStepExport.tsx:142-204` 有 pptx/pdf 单选、包含演讲备注（默认取 `plan.delivery.includeNotes`）、修订与页数说明、在浏览器缺桌面宿主时禁用 PDF 并给原因“PDF需要桌面打印宿主”、失败/取消/已保存（含 SHA-256）分别呈现；导出不回写作品状态；归档作品仍可只读导出（`PptStepExport.tsx:69` 未用 archived 禁用）。
- **版本**：`PptProductionPanels.tsx:55` 列真实 `work.versions` + 恢复（服务恢复会创建新修订，提示“恢复会创建新修订，不改变当前附件”），与设计“恢复不覆盖历史”的语义一致。
- **主题/令牌**：`apps/web/src/pages/ppt/ppt.css` 无硬编码颜色（全文只有令牌与 `color-mix`），PPT 页面组件内唯一十六进制是示例文案“#4D6BFE”（`PptPlanSections.tsx:41` 用户提示），符合四主题令牌要求；文字+图标的状态呈现（`PPT_STATUS_META`、`PPT_PAGE_GENERATION_META`）齐全。
- **无演示数据泄漏**：产品页未出现原型状态切换条/皮肤切换/“设计样例”水印/演示计时；助手、检查、导出均为真实服务数据（模型调用/回执/检查报告）；无假成功。设计稿状态注册表 22 项与实现分支的对应关系已逐项登记于“状态覆盖”。

## 需 GUI / 运行验证

1. **检查问题标记可见性**：缩略图 alert 图标继承 `--muted`（`ppt.css:537-539`），在四主题、尤其是深色与 github-white 下的实际对比度与“右上角旗标”位置需 GUI 确认（`P07-13`）。
2. **窄屏布局**：设计在 `max-width:1380px` 隐藏非当前步名称、1180 以下隐藏页头保存提示；实现未实现（`P07-19`），需在 1440/1280/1024/850 视口确认四步条与页头是否折行/溢出。
3. **对象命中区**：`PptStudio.tsx:112` 用 `left/top/width:88%/height` 的近似矩形覆盖文字行，是否与渲染文字对齐、点击是否误选，需 GUI 实测（`edit`、`issues` 状态）。
4. **助手历史自动滚动**：实现无 scroll 逻辑，多轮消息后是否停在最新一条需 GUI 确认（`P07-20`）。
5. **抽屉焦点圈定**：版本/资料抽屉可 Tab 到背景的实际行为，以及计划抽屉自定义 trap（`PptPlanDrawer.tsx:28-42`）与 Esc/焦点归还的配合需 GUI 确认（`P07-20`）。
6. **保存中状态体验**：`busyKind==='update'` 时计划抽屉 footer 显示“当前只读”的实际观感与可操作性（`P07-08`）。
7. **导出焦/预览**：导出从对话框改为步骤页后的返回、焦点与“取消/失败/已保存”提示在真实桌面宿主下的呈现（含 PDF 宿主存在/不存在两种），需 GUI + 真实服务（`P07-17`）。
8. **冲突恢复**：需要真实服务并发修改同一作品（双窗口或两浏览器）确认 409 后 UI 是否能走到“读取最新方案/比对”（`P07-09`），属需真实服务。
9. **方向点选即保存**：在设计方案步骤点选方向会立即写服务并弹回执，需 GUI 确认这一步的回执条位置与用户感知（`P07-12`）。
10. **P07-23 的伪造完成**：需要真实服务复现“逐页制作中途停止 → 打开制作方案并保存 → 回到工作台/导出”，核对 `productionPages`、页头“部分完成”、本次制作计数与导出按钮是否被放开；静态代码路径已明确，但必须真实服务确认影响面。

## 未覆盖 / 说明

- **范围边界**：P05 PPT 制作、P06 PPT 作品（`ppt.html`、`ppt-works.html`、`PptWorksView`/`PptCreateDialog`）由 03 区域负责，本文件只在工作台入口/归档/资料等交叉处引用，不做逐状态判定。
- **未运行**：本次仅静态审计，未运行 `npm run dev`、未调用真实模型、未跑 PDF/PPTX 导出、未做四主题截图/像素对比；因此所有视觉、窄屏、键盘、真实模型/停止/导出结论均标“需GUI/需真实服务”，不作为已验证。
- **助手字段级候选的完整解析**（服务如何把模型回复解析成 `brief/outline/plan` 候选、越界防护）只在展示层核对，未逐行审计 `packages/engine/src/ppt-assistant.ts` 的业务正确性（非前端设计一致性范围）。
- **不可达分支**：`PptWorkbenchSteps.tsx:409-461` 的 `PptStepCheck` 非附件分支（含“逐页制作检查”与“回到设计方案”、`:456-457`“演讲备注 / 检查问题 服务未提供”过时文案）在当前工作台路由下不可达——工作台只在资料抽屉里以 `attachmentsOnly` 使用它（`PptWorkbench.tsx:149`），check 步骤渲染的是 `PptStudio`（`:150-154`）；`PptObjectEditor`（`PptObjectEditor.tsx:7`）仅被该不可达分支引用。该过时文案未展示给用户，故不计入问题清单，但建议清理或在复用前按设计校对（“服务未提供”与当前已有检查报告/备注不符）。
- **设计缺口（C9，不计入问题计数）**：
  - 设计 `ppt-studio.html:225` 允许“第 5、6 页仍在制作时导出只含已完成 4 页”，而服务 `#assertProductionComplete` 明确拒绝未完成页导出（`packages/engine/src/ppt.ts:430-434`）→ 实现选择禁用导出并给服务原因，属诚实降级，不是前端缺陷。
  - 设计导出提供 PDF 且不区分宿主；实现 PDF 依赖受控桌面打印宿主、浏览器内禁用并说明（`PptStepExport.tsx:93-94,159-167`），属宿主能力边界。
  - 设计检查清单有“颜色在投影下可读”；服务 `checkPpt` 无对比度/投影能力（`packages/shared/src/domain/ppt-renderer.ts:78-106`），实现未伪造该项，应作为设计缺口/服务能力项记录。
  - 设计“资料抽屉可勾选项目文档作为依据”“每页依据显示解析中并禁用”“助手问题快捷选项”“自行填写方向”“建议页数”依赖结构化来源/候选字段，设计说明本身把部分标为 PROPOSED（`originals/main/REVIEW.md:367`）；当前服务 DTO 无对应字段（C1），本文件在相关条目中按 C1 记录，不写作“已实现”。
  - 设计的“自动保存”交互与实现的显式保存+回执模型冲突（`P07-08`）；实现方式更符合仓库“写操作必须有 requestKey + 回执”的约定，建议 Lead 汇总时统一裁定是补自动保存还是登记设计变更（C10 口径）。
- **文档口径**：`docs/review/ppt-studio-layout-2026-10-20.md`（称“左侧缩略图/中央当前页/右侧三页签已落地”）、`ppt-page-progress-2026-10-20.md`（称逐页状态已补齐）、`ppt-assistant-pdf-2026-10-20.md`（称助手/PDF 已验）、`ppt-plan-stop-2026-10-20.md`（称七模块/阶段冻结/冲突/只读已落地）与当前代码基本对得上，但“七模块、方向冻结、自动保存与版本冲突（B-09）”中的自动保存、阶段条、pl-review 整表只读、pl-blocked 拦截与读取中/失败并未在代码中闭环，旧文档不应被当作这些状态已完成的证据（C10 交 Lead 统一记录）。
