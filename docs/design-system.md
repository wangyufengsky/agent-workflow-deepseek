# 设计系统与四主题

## 1. 是否直接复用前端设计稿？

设计稿是静态 HTML + 原生 JS 的原型（`originals/**`，状态用 URL 参数和 fixtures 驱动），不能直接作为
产品前端复用：它没有真实数据、路由、权限、并发回执与状态机。决策是：

- **复用视觉层**：`originals/main/assets/ds.css` 原样复制为 `apps/web/src/styles/ds.css`
  （构建前用 `diff -q` 校验逐字节一致），页面沿用设计稿的 class 与结构语言。
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
- 持久化：localStorage + URL `?theme=`，顶部一键循环切换；设置页展示四套主题卡片即时切换。
- 扩展新主题：在设计稿中加一套 `[data-skin="x"]`（或直接扩展 `THEME_CONFIGS`），重新运行生成器，
  在 `THEME_IDS` 中加入 id；无需改任何组件。

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
- 画布节点/边颜色全部来自令牌（`--node-bg`、`--edge`、`--run-line` 等），选中/失败/未知用描边 + 图标 + 文案。
