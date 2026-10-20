# 设计系统与四主题

## 1. 是否直接复用前端设计稿？

设计稿是静态 HTML + 原生 JS 的原型（`originals/**`，状态用 URL 参数和 fixtures 驱动），不能直接作为
产品前端复用：它没有真实数据、路由、权限、并发回执与状态机。决策是：

- **复用视觉层**：`originals/main/assets/ds.css` 原样复制为 `apps/web/src/styles/ds.css`
  （`npm run check:design` 校验逐字节一致，并校验 `themes.ts` 与生成器输出一致），页面沿用设计稿的 class 与结构语言。
- **不复制原型交互层**：页面、状态、操作逻辑用 React + TypeScript + Vite 重写，数据来自真实 API；
  `@xyflow/react` 承接流程画布（设计稿 `canvas.js` 只作为交互参考）。
- 原型中的样例数据、假成功、模拟命令一律不进入产品代码。

## 2. 四主题 = 纯配置

设计稿的 `skins.css` 定义了 deepseek / warm / spdb / github-white 四套颜色与效果令牌。本项目把它们生成
为 TypeScript 配置：

- 生成器：`scripts/generate-theme-config.mjs` 读取只读设计稿，输出
  `packages/shared/src/config/themes.ts`：`BASE_TOKENS`（字体/间距/圆角/尺寸）、`THEME_CONFIGS`
  （每套主题 86 个颜色/效果令牌）、`themeCssVariables(theme)`、`nextTheme()`。
- 运行时：`apps/web/src/theme/ThemeProvider.tsx` 在切换时把全部令牌写到 `<html>` 的内联 CSS 变量，
  同时设置 `data-theme`、`data-skin`、`color-scheme`；组件只使用 `var(--*)`。
- 持久化：localStorage + URL `?theme=`；**唯一切换入口**是设置 → 外观的四张皮肤卡（设计 v5 已把皮肤切换从页头移除，
  产品页头只放面包屑/页名 + 本页主操作，不放皮肤切换/设计审阅控件）。
- 扩展新主题：在设计稿中加一套 `[data-skin="x"]`（或直接扩展 `THEME_CONFIGS`），重新运行生成器，
  在 `THEME_IDS` 中加入 id；无需改任何组件。
- **外观区文案用设计原名**：设置 → 外观的皮肤名按设计稿显示 `deepseek 风 / claude 风 / SPDB / GitHub 白`
  （`apps/web/src/theme/themeLabels.ts`）；`THEME_CONFIGS[id].label` 仍是产品/品牌名，供功能文案使用。

约束（已在 `AGENTS.md` 固化）：组件/样式中不得出现 `#hex`、`rgb()`、`hsl()` 颜色字面量；不得引入外部字体；
状态必须同时有文字与图标，不只靠颜色。

## 3. 颜色令牌清单（摘要）

| 组 | 令牌 |
| --- | --- |
| 背景/层级 | `--bg --bg-sunken --surface --panel --raised --overlay --sidebar --node-bg --bubble` |
| 叠层/线 | `--fill-1..5 --line --line-2 --line-3 --hairline --edge --edge-done` |
| 文字 | `--ink --ink-2 --sub --muted --faint --ink-strong` |
| 品牌/强调 | `--accent --accent-ink --accent-fill --accent-line --brand --brand-hover --brand-fill --primary-bg --primary-ink` |
| 状态 | `--ok --run --stall --danger --warn --done --wait --idle --unknown`（各带 `-fill` / `-line`） |
| 效果 | `--shadow-pop --shadow-lift --ring --glass --glow --dots --focus-line --selection --scrim` |
| 角色色 | `--role-1..6` |

## 4. 组件约定

- `apps/web/src/components/` 是共享 UI kit：Button、Badge、StageCapsule（五段阶段胶囊）、Card、
  EmptyState、Modal/Drawer、SegmentedControl、Icon（设计稿图标内联 SVG）。
- 阶段与状态文案来自 `packages/shared/src/domain/labels.ts`，不手写零散中文。
- 禁用操作必须展示服务端 `reason`/`reasonCode`；服务未连接时显示「服务未连接 · 重试」，不显示样例数据。
  带 `disabledReason` 的 Button/IconButton 用 `aria-disabled` + `aria-describedby` 关联隐藏文本（`.sr`），
  键盘用户可聚焦并读到原因；Modal/Drawer 有 Tab 焦点陷阱、Esc 关闭与关闭后焦点归还。
- 画布节点/边颜色全部来自令牌（`--node-bg`、`--edge`、`--run-line` 等），选中/失败/未知用描边 + 图标 + 文案。

## 5. 外壳与页头（设计 v5 收敛）

- **页头职责**：只放面包屑/页名 + 本页主操作（`REVIEW.md:31`）。主题切换（只在设置 → 外观）、
  设计评审控件（展示/审阅等）不进入产品页头。
- **页头可选**：设计 `DS.mount({header:''})` 的页面（知识库、项目、需求画布、角色、角色历史、运行内容、
  开始任务、任务画布、工具与 Skill、流程画布、PPT 工作台）不渲染 Shell 页头标题，标题只由内容区
  `page-head` 承担。策略在 `apps/web/src/app/navigation.ts` 的 `shellHeaderPolicy()`。
- **主操作位置**：设计页头带主操作的页面（任务列表、流程、模板任务、数据库、需求目录、运行环境、任务恢复）
  由 `Card.tsx` 的 `PageHeader actions` 通过 `PageHeaderSlot` 送入页头；设计 `header:''` 页面动作保留在内容区。
  没有页头挂载点时 `PageHeaderSlot` 内联兜底，控件不会消失。
- 连接状态只在侧栏底部「运行环境」芯片展示；页头不再放项目数/服务连接 chip。

## 6. 动效与可访问性

- 系统级 `prefers-reduced-motion` 由 ds.css（设计原样）抑制。
- 设置 → 外观「减少动态效果」为三态（跟随系统 / 始终减少 / 不减少），通过 `<html data-motion>` 生效，
  消费者在 `apps/web/src/theme/motion.ts` 与 `app.css`：本机偏好优先，未选择时以服务端
  `settings.ui.reducedMotion` 为默认。
- 状态表达必须「图标 + 文字 + 颜色」；禁用原因不得只靠 `title`。

## 7. 设计稿未覆盖的产品界面（需设计确认）

- 404 页（`apps/web/src/app/placeholders.tsx`）与渲染错误边界（`apps/web/src/main.tsx` 的
  `AppErrorBoundary`）是设计稿 25 个正式页面之外的工程健壮性界面，用于避免白屏/死链；两者复用 ds.css
  的 class 语言，视觉与产品一致。设计稿未定义这两页，属「产品补设计」，改动时保持与设计系统一致并在此记录。
- 全局「操作结果待核对」横幅（`components/PendingCommands.tsx`）用于 AGENTS 要求的 UNKNOWN 原请求核对；
  设计稿无该全局横切层，呈现层需产品/设计确认。服务连接失败只在首屏无法读取数据时出现全局条，其他页面内
  错误由页面 `ServiceNotice`/banner 承担。

## 8. 校验命令

- `npm run check:design`：`ds.css` 与设计稿逐字节一致 + `themes.ts` 与生成器输出一致；已纳入 `npm run verify`。
- `npm run typecheck` / `npm test` / `npm run check:docs-routes`：常规验证。
