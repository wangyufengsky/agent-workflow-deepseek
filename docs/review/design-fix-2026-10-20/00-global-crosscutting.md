# 全局横切（外壳 / 页头 / 导航 / 主题 / 组件 / 设计系统）处置记录

> 审计来源：`docs/review/design-audit-2026-10-20/00-global-crosscutting.md`（GLB-01..14）。
> 设计权威：只读 `opencode-workflow-design-showcase/`（`originals/main/REVIEW.md`、`assets/{shell.js,ds.css,skins.css}`、各 `pages/*.html`、`originals/git/`）。
> 分支：`fix/design-audit-2026-10-20`（基于 `main@3f6f9b2`）。执行：global-shell（task-1）。本文件只记录全局横切 14 条，不重复各页面区域 finding。
> 判定口径：设计态不可达若根因是 C1 契约 / C9 设计裁决 / 需 GUI / 外部服务，只做诚实降级并在本表记录，不得伪造已修复。

## 1. 总表

| ID | 严重度 | 状态 | 证据（文件:行） | 说明 |
|---|---|---|---|---|
| GLB-01 | P1 | 已修复 | `apps/web/src/app/Shell.tsx:119-137`（页头只保留面包屑+页名+动作槽）；`pages/settings/AppearanceSection.tsx:36-56` | 移除页头「展示/审阅」分段与其 localStorage 状态（`agent-workflow.display-mode` 不再读写）；设置→外观删除「顶栏切换后立即生效」的错误说明，改为真实的三态动效控件（见 GLB-07）。服务端 `settings.ui.displayMode` 保留在契约中，但产品界面不再呈现无消费者的假控件。 |
| GLB-02 | P2 | 已修复 | `Shell.tsx:119-137`；`theme/ThemeProvider.tsx:5-11`（删除 `cycleTheme`）；`docs/design-system.md:24` | 删除页头主题循环按钮与 `cycleTheme`；主题入口收敛为设置→外观四皮肤卡；`?theme=` + localStorage 持久化保留。文档同步删去「顶部一键循环切换」。 |
| GLB-03 | P2 | 已修复 | `Shell.tsx:119-137`；侧栏运行环境芯片 `Shell.tsx:105-114` | 删除页头「N 个项目」「服务已连接」chip 与 `app.css` 对应样式（`.project-chip/.conn-chip/.header-theme/.display-seg`）；连接状态只在侧栏底部「运行环境」芯片呈现，项目入口保留菜单。 |
| GLB-04 | P2 | 部分 | 机制：`components/PageHeaderSlot.tsx:13-37`、`components/Card.tsx:42-64`、`app/navigation.ts:98-130`；验证代表页：`/tasks`、`/workflows`、`/templates`、`/databases`、`/requirements`、`/runtime`、`/recovery` | 落地「页头=面包屑/页名+本页主操作」机制：`navigation.ts shellHeaderPolicy().headerActions` 标记设计页头带主操作的 7 类路由，`Card.tsx` 的 `PageHeader actions` 经 `PageHeaderSlot` 自动送入 `#page-header-actions`，内容区 `page-head` 只留标题/说明；无页头挂载点时内联兜底（不再丢控件）。**残余**：其余页面（inbox/insights/git 概览/knowledge-history/ppt 作品库/settings 等）的主操作仍在内容区——这些页面视觉区块归各区域 owner，且设计对其中部分页面页头本无动作；完整收敛需页面 owner 采纳 + 设计确认（C9）。 |
| GLB-05 | P2 | 已修复 | `app/navigation.ts:98-130`（`designHeaderEmpty` + `shellHeaderPolicy`）；`Shell.tsx:117-137`（`header.hidden` 时不渲染 Shell 页头） | 设计 `DS.mount({header:''})` 的 11 个页面不再渲染 Shell 页头标题，由内容 `page-head` 唯一承担：知识库 `/knowledge`、项目 `/projects`、`/projects/:id`、PPT 工作台 `/ppt?work=`、需求画布 `/requirement/:id`、角色 `/roles`、`/roles/legacy`、运行内容 `/runs/:id`、开始任务 `/start`、任务画布 `/tasks/:id`、工具与 Skill `/tools`、流程画布 `/workflows/:id/edit`（画布页自带 `canvas-bar`，项目详情自带 `项目/名称` 面包屑，均静态核对存在）。**残余**：有页头页面（如任务列表）内容标题措辞与设计「任务/任务列表」不同，属页面区域 finding，不在本文件范围。 |
| GLB-06 | P3 | 已修复 | `app/navigation.ts:132-172`；`Shell.tsx:34-40`（用真实 bootstrap 数据补名称） | 补齐 5 处面包屑：`/knowledge/history`→「知识库 / 对话记录」；`/ppt`→「PPT 制作 / 全部作品」；`/ppt?work=`→「PPT 制作 / 全部作品 / PPT 工作台」（该视图设计 header:''，面包屑只用于标题）；`/git/:projectId`→「Git 仓库 / <项目名>」（项目名取自服务端 projects）；`/tasks/:id/recovery`→「任务列表 / <原任务标题> / 恢复」、`/recovery`→「任务列表 / 恢复」；`/requirements`→「任务列表 / 需求」。未知路由标题改为「页面不存在」。**说明**：PPT 工作台按设计 shell 页头为空，内容区返回入口由 P07 页面 owner 承担（`PptWorkbench` 已有「作品库」返回按钮）；`KnowledgeHistoryPage` 内容区 eyebrow 与新增页头面包屑轻微重复，归 02 区域 owner 后续清理。 |
| GLB-07 | P2 | 已修复（需 GUI 复核动画） | `theme/motion.ts:1-66`；`pages/settings/AppearanceSection.tsx:13-56`；`Shell.tsx:56-60`；`main.tsx:10,62`；`app.css:83-127` | 设置→外观「减少动态效果」改为设计的三态下拉（跟随系统 / 始终减少 / 不减少）。消费者：`<html data-motion>`——`reduce` 无条件抑制动效；`system` 沿用 ds.css 的 `prefers-reduced-motion`；`full` 在系统要求减少时恢复设计动效（按 ds.css 动画类逐一恢复）。优先级：本机显式选择 > 服务端 `settings.ui.reducedMotion` > 系统。服务端值真实被消费（bootstrap 到达后由 Shell effect 应用），不再只读展示。 |
| GLB-09 | P3 | 已修复 | `theme/themeLabels.ts:1-18`；`pages/settings/ThemeSelector.tsx:5,53,70` | 设置→外观皮肤卡与「当前主题」使用设计原名：`deepseek 风 / claude 风 / SPDB / GitHub 白`（`settings.html:108`）；`THEME_CONFIGS[id].label` 仍为产品/品牌名，供其他功能文案使用，不改生成器与 `packages/shared`。`docs/design-system.md` 记录该映射。 |
| GLB-10 | P3 | 部分 | `Shell.tsx:139-156`（connection-strip 仅 bootstrap 首屏失败时出现）；`components/PendingCommands.tsx:8-23`（保留）；文档 `docs/design-system.md` §7 | 保留两条机制（AGENTS 要求 UNKNOWN 原 key 核对；首屏数据不可用时给出全局不可用说明），删除第三处重复展示（页头连接 chip，见 GLB-03），并在设计系统文档记录呈现层分层：连接失败以页面内 notice 为主、全局条只在首屏无法读取数据时出现。**残余**：全局条与个别页面内错误条在断连场景可能同时出现，需 GUI 故障注入 + 产品/设计确认呈现层（C9）。 |
| GLB-11 | P3 | 已修复 | `scripts/check-design.mjs:1-54`；`scripts/generate-theme-config.mjs:52-201`（导出 `renderThemeConfig()`，保持原生成输出不变）；`package.json:32-33`；`docs/design-system.md:8-9,§8` | 新增 `npm run check:design`：① `apps/web/src/styles/ds.css` 与设计稿 `assets/ds.css` 逐字节比较；② `packages/shared/src/config/themes.ts` 与生成器输出完全一致（防 skins 令牌漂移）；已纳入 `npm run verify`。实测通过（见 §3）。文档不再声称不存在的 `diff -q` 构建期校验。 |
| GLB-12 | P3 | 已修复 | `app.css:49-55`（新增内联兜底样式）、`app.css:83-127`（动效规则）、`app.css:1162-1194`（404 所需规则）；删除段：`app.css` 原 `.project-chip/.conn-chip/.header-theme/.display-seg/.header-actions .seg button`、`.placeholder .route/.status-banner` 及对应响应式规则 | 删除随 GLB-01/02/03 失效的页头控件样式与 Placeholders 死子规则；删前已全局 grep 确认无 TSX 引用（`placeholder` 仅 `placeholders.tsx` 404 使用；`.route/.status-banner` 0 命中）。保留 404 实际使用的 `.placeholder/.tile/h2/p/.actions`。 |
| GLB-13 | P3 | 已修复（需 GUI 键盘复核） | `components/focusTrap.ts:1-49`；`components/Modal.tsx:28-40,52`；`components/Drawer.tsx:32-38,53`；`components/Button.tsx:35-70`；`components/IconButton.tsx:13-44` | Modal/Drawer：Tab/Shift+Tab 焦点陷阱（`trapTabKey`）、`aria-labelledby` 关联标题、Esc 关闭、关闭后焦点归还（Modal 用 ref 保持 `onClose` 稳定，避免父级重渲染打断焦点）。Button/IconButton：带 `disabledReason` 的禁用按钮改为设计系统已支持的 `aria-disabled` 模式（可聚焦），原因通过 `aria-describedby` + `.sr` 隐藏文本可读，点击/回车被组件内拦截；无原因时保留原生 `disabled`。 |
| GLB-14 | P3 | 已修复（文档纳入设计口径） | `docs/design-system.md:§7`；`app/placeholders.tsx:6-27`；`main.tsx:18-54` | 404 页与 `AppErrorBoundary` 是设计 25 页之外的工程健壮性界面：保留界面，纳入 `docs/design-system.md`「设计稿未覆盖的产品界面（需设计确认）」，明确复用 ds.css class 语言、改动须保持设计系统一致并记录；未知路由标题修正为「页面不存在」。不伪装为设计稿页面。 |
| GLB-08 | P2 | 延后 | — | P06/P07 独立路由（`/ppt/works`、`/ppt/studio/:workId`）需改 `pages/ppt/PptPage.tsx` 的视图状态与深链语义（页面 owner = ppt-parity 写范围），且属产品/设计裁决（是否保留折叠视图，C9）；本轮已通过 GLB-06 补齐面包屑与返回语义，路由拆分交 P05/P06/P07 区域统一处理。 |

## 2. 关键实现说明（便于 Review）

### 2.1 页头策略（GLB-01/02/03/05 + GLB-04 机制）

- `app/navigation.ts` 新增 `shellHeaderPolicy(pathname, search)`：`hidden` 对应设计 `header:''` 的 11 个页面（含 `/ppt?work=` / `/tasks/:id` 动态判断，排除 `/tasks/:id/recovery`）；`headerActions` 对应设计页头带主操作的 7 类路由（`tasks/workflows/templates/databases/requirements/runtime/recovery`）。
- `Shell.tsx` 页头只剩：页面图标 + 面包屑/页名 + `#page-header-context` + `#page-header-actions`；`hidden` 时不渲染 `<header>`（设计页头为空，同时消除内容标题重复）。
- `Card.tsx PageHeader`：`headerActions` 路由把页面主操作经 `PageHeaderSlot` 送进页头槽；其余路由保持内容区原有位置。`PageHeaderSlot` 新增「无挂载点时内联兜底」，保证 `/tools`（设计 header:''、页面 owner 曾把刷新/范围控件放进页头槽）控件不丢失。
- 连接状态唯一展示在侧栏底部「运行环境」芯片（设计 `showcase/navigation.js:51`）。

### 2.2 减少动态效果（GLB-07）

- `theme/motion.ts`：`MotionPreference = 'system' | 'reduce' | 'full'`；`readStoredMotion/persistMotionPreference`（localStorage `agent-workflow.motion`）、`resolveMotionPreference(serviceReducedMotion)`、`applyMotionPreference` 写 `<html data-motion>`。
- 启动：`main.tsx` 首屏前应用本机选择；bootstrap 到达后 `Shell` effect 以服务端值兜底（本机显式选择优先）。
- CSS：`app.css` 用 `html[data-motion='reduce']` 无条件抑制；`@media (prefers-reduced-motion: reduce)` 下 `html[data-motion='full']` 恢复设计动效关键类（pulse/spin/skel/toast/in/fade/flow/sideIn/页面进入淡入）与过渡时长。

### 2.3 设计系统校验（GLB-11）

- `scripts/generate-theme-config.mjs` 重构为 `renderThemeConfig()`（导出）+ 直接执行时仍写文件；输出与仓库现有 `themes.ts` 逐字节一致（已核）。
- `scripts/check-design.mjs`：ds.css 字节比较 + themes.ts 生成一致比较；失败给出可执行修复指令并以非 0 退出。`verify` 已串联。

## 3. 验证证据

| 验证 | 结果 | 证据 |
|---|---|---|
| `npm run check:design` | **通过** | `check:design OK · ds.css 与设计稿逐字节一致（30045 字节）；themes.ts 与生成器输出一致（86 个主题令牌 × 4 主题，39 个基础令牌）。` |
| `npm run build:web` | **通过** | vite 产物构建成功（756 modules，4.03s），CSS/JS 打包无错误。 |
| `npm run typecheck`（全仓） | 本任务改动文件 **0 错误**；收尾时全仓仍有约 20–30 条错误，全部位于**其他成员并行进行中的文件**（如 `apps/web/src/pages/git/FixPanel.tsx`、`pages/task/situation.ts`、`packages/engine/src/plan.ts`、`packages/server/src/http.ts` 等，不属 task-1 写范围，不得由本任务修改）；最终以 Lead 合并前全仓 0 错误为准 | `npm run typecheck` 输出按文件过滤：`apps/web/src/{app,components,theme,styles,main.tsx}`、`pages/settings/{AppearanceSection,ThemeSelector}.tsx`、`scripts/*` 无 error。收尾时另补 `components/Icon.tsx` 的 `chevUp`（供 git DiffViewer 使用，见 §6）。 |
| 静态策略自检 | 11 个 `header:''` 路由 `hidden=true`、7 类设计页头动作路由 `headerActions=true`（其余 false）；5 类新面包屑按设计文案输出 | `node --import tsx` 直接调用 `shellHeaderPolicy/breadcrumbsFor` 全量断言（临时脚本，未入库）。 |
| 设计稿只读 | 未修改 `opencode-workflow-design-showcase/**` | `git status` 该目录无改动。 |

## 4. 需 GUI / 运行验证（不作为「已通过」）

1. 四主题 × 1440/1280/1024 下页头移除控件后的真实排版、面包屑换行与窄屏（`app.css` 响应式规则已同步删除死规则）。
2. `data-motion` 三态在真实渲染下的动画差异（尤其系统开启 reduce 时选「不减少」的恢复效果）。
3. Modal/Drawer Tab 焦点循环、Esc 关闭与关闭后焦点归还；`aria-disabled` 禁用按钮的键盘可读性（VoiceOver/NVDA）。
4. 断连/丢回执场景下全局 `connection-strip` 与页面内 notice 是否仍重复（GLB-10 残余）。
5. `/git/:projectId`、`/tasks/:id/recovery` 面包屑在真实 bootstrap 数据下的项目名/任务标题（数据缺失时回退「项目工作台」「原任务」）。

## 5. 需决断 / 跨区域事项

1. **GLB-08**：P06/P07 是否拆独立路由（`/ppt/works`、`/ppt/studio/:workId`）——需 P05/P06/P07 owner + 产品/设计裁决（C9），本轮未动 `pages/ppt/**`。
2. **GLB-04 残余**：inbox/insights/git 概览/knowledge-history/ppt 作品库/settings 等页面的主操作仍在内容区；是否全部迁到页头需设计确认（设计对部分页面页头本无动作），且涉及各页面写范围。
3. **GLB-10 呈现层**：全局横幅（PendingCommands / connection-strip）为设计外产品补设计，呈现层（全局 vs 页内）需产品/设计确认。
4. **GLB-14**：404/错误边界保留，已纳入设计系统文档，建议设计确认异常外壳视觉。
5. **页面 owner 后续**：`KnowledgeHistoryPage` 内容区 eyebrow 与页头面包屑重复；`PptPage` 作品库内容标题「PPT 制作」与页头第一级面包屑重复；任务列表等页内容标题措辞与设计差异（属各区域 finding）。

## 6. 本轮改动文件（task-1 写范围）

- 外壳/路由：`apps/web/src/app/Shell.tsx`、`apps/web/src/app/navigation.ts`、`apps/web/src/main.tsx`
- 共享组件：`apps/web/src/components/{Button,IconButton,Modal,Drawer,Card,PageHeaderSlot,Icon}.tsx`、`apps/web/src/components/focusTrap.ts`（新增）
- 主题：`apps/web/src/theme/{motion.ts,themeLabels.ts}`（新增）、`apps/web/src/theme/ThemeProvider.tsx`
- 设置外观：`apps/web/src/pages/settings/{AppearanceSection,ThemeSelector}.tsx`
- 样式：`apps/web/src/styles/app.css`
- 校验脚本：`scripts/check-design.mjs`（新增）、`scripts/generate-theme-config.mjs`、`package.json`
- 文档：`docs/design-system.md`、本文件
