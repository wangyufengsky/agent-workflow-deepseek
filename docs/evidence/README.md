# 界面证据清单（docs/evidence/）

> 生成时间口径：2026-10-19（Asia/Shanghai）。目录内现有 **22 张 PNG** + 本 README。
> 本文件是清单与有效性说明，不是验收记录；验收以 `npm test`、`npm run build:web`、
> `node scripts/test-e2e.mjs`、`npm run check:docs-routes` 与 `docs/review/execution-log.md` 为准。

## 1. 结论先说

- **22 张截图全部产生于 Wave 0 之前**（Wave 0 于 20:15 分派）。因此没有一张能作为 Wave 0–3 之后当前 UI 的像素证据；
  它们只作历史实现与设计对照，不能用来证明现在的页面/交互仍然正确。
- 仓库没有为每张截图记录轮次。下表用 **git 添加/更新提交 + 时间** 定位；唯一有明确轮次记录的是
  `electron-packaged-current.png`（第 35 轮重新打包）。
- 当前沙箱内官方 `npm run ui:smoke` 因 Electron GPU/sandbox 初始化失败（`GPU process isn't usable`）
  未计为通过；**当前没有可复现的自动视觉回归**。刷新方式见 §6。
- 根目录 `evidence/` 是 `npm run ui:smoke` 的自动产物（11 张 `ui-*.png`），与本目录（人工整理、含打包/模型场景）不同，见 §5。

## 2. 清单（22 张）

数据源代号：

- **A**：真实 `apps/web/dist` + `.build/server/main.mjs`，`AGENT_WORKFLOW_DATA_DIR=.tmp/run-data`、端口 5288；
  真实 SQLite/Git；带模型的页面由真实受管 OpenCode 1.19.0 + opencode-go 生成。
- **B**：同 A 的真实服务与本地数据，但该页面本身不调用模型（设置/Git/角色/用量/交付预览）。
- **C**：Electron 打包产物（electron-builder，未签名 `.app`，内置/托管 server）。
- **D**：Electron 官方产物加载 bundled server（无预启服务的自托管场景）。

| 文件 | 内容 | 轮次 / 提交（2026-10-19） | 数据源 | Wave 0–3 后有效？ |
| --- | --- | --- | --- | --- |
| `home-deepseek.png` | 主页（deepseek）：真实项目/任务/统计 | 早于第 35 轮 · `f27d3d9`（11:30） | A | **否**（W3-11a 主页展示化后改版） |
| `tasks.png` | 任务列表（阶段胶囊、规划状态、筛选） | 早于第 35 轮 · `f27d3d9`（11:30） | A | **否**（W3-1b 任务结构已改） |
| `start-task.png` | 开始任务（方法卡、项目选择） | 早于第 35 轮 · `f27d3d9`（11:30） | A | **否**（W1-4 深链 + W3-1b 结构） |
| `requirement-candidate.png` | 需求画布：真实模型候选（13 步/13 依赖/6 组）、检查、规划记录、用量 | 早于第 35 轮 · `f27d3d9`（11:30） | A | **否**（W0-4/W1-11/W2-2 后入口与面板已改） |
| `task-execution-running.png` | 任务画布执行中（1 步完成/1 步运行，自动推进只读） | 早于第 35 轮 · `f27d3d9`（11:30） | A | **否**（W2-1 自动推进开关、W2-2 放弃调整、W0-4 验收） |
| `node-execution-detail.png` | 节点执行现场：事实条 + 模型正文实时片段 + 工具记录 | 早于第 35 轮 · `f27d3d9`（11:30） | A | **否**（W0-5 终态/工具数、W0-4 节点验收） |
| `git-workbench.png` | Git 工作台：真实提交列表/详情/diff | 早于第 35 轮 · `f27d3d9`（11:30） | A | **否**（W0-1 fetch 回执、W3-12 diff 修复、W1-7 文案） |
| `task-warm-1440.png` | 同一任务画布 warm 主题 1440 | 早于第 35 轮 · `f27d3d9`（11:30） | A | **否**；仅主题/布局可参考（交互同上过期） |
| `task-spdb-1440.png` | 同一任务画布 spdb 主题 1440 | 早于第 35 轮 · `f27d3d9`（11:30） | A | **否**；仅主题/布局可参考 |
| `task-github-white-1440.png` | 同一任务画布 github-white 主题 1440 | 早于第 35 轮 · `f27d3d9`（11:30） | A | **否**；仅主题/布局可参考 |
| `task-warm-1024.png` | 1024 宽度响应式（侧栏收成图标） | 早于第 35 轮 · `f27d3d9`（11:30） | A | **否**；仅响应式布局可参考 |
| `settings.png` | 设置页 | 早于第 35 轮 · `f27d3d9`（11:30） | A | **否**（W1-7、W3-9b 设置分区/文案已改） |
| `inbox.png` | 待处理中心 | 早于第 35 轮 · `f27d3d9`（11:30） | A | **否**（W3-2 Inbox interactions 已改） |
| `electron-requirements-spdb.png` | Electron 产物 + SPDB 主题需求目录 | 早于第 35 轮 · `f27d3d9`（11:30） | D | **否**（Electron 产物早于 Wave 0） |
| `electron-selfhosted-home.png` | 无预启服务时 Electron 自行拉起 bundled server（GitHub White、空项目冷启动） | 早于第 35 轮 · `f27d3d9`（11:30） | D | **否**（同上） |
| `electron-task-warm.png` | Electron 产物 + warm 主题任务画布 | 早于第 35 轮 · `f27d3d9`（11:30） | D | **否**（同上） |
| `settings-git-remote.png` | 设置 → Git 账号（提交作者、GitHub/GitLab 地址与令牌入口） | 早于第 35 轮 · `c141f32`（11:44） | B | **否**（设置分区 W3-9b 已改） |
| `electron-packaged-home.png` | electron-builder 首次打包（未签名 `.app`）启动首页 | 首次打包 · `c965bc4`（12:32，早于第 35 轮） | C | **否**（打包产物早于 Wave 0） |
| `task-delivery-apply-preview.png` | 非 Git 任务：交付 →「应用到原目录」三方预览（2 项可应用） | 早于第 35 轮 · `ceee125`（12:25） | B | **否**（W1-12/W2-3 交付与清理已改） |
| `roles-editor.png` | 角色管理：内置职业草稿待发布、编辑/发布/还原入口 | 第 35 轮前后 · `405a819`（13:03） | B | **否**（W3-7c 角色历史页/导航与文案已改） |
| `insights-real-counters.png` | 质量与用量：真实任务计数与规划成本，未知项明确标注 | 第 35 轮前后 · `56099ce`（13:18） | B | **否**（W1-5 已改；截图仍写"验收与评审接口尚未接通"） |
| `electron-packaged-current.png` | 第 35 轮重新打包后的 `.app`（内置 server）启动截图 | **第 35 轮** · `0501e10`（13:40） | C | **否**（Wave 0–2 后未重新打包） |

## 3. Wave 0–3 后为什么全部过期

- 全部 22 张均早于 Wave 0；`docs/design-coverage.md:6`、`docs/remaining-work.md:56`、`docs/verification.md:352`
  已注明 `docs/evidence/` 是 Wave 0 前旧截图。
- 页面级变化（按本目录截图对应页面）：
  - 主页/任务/开始：W3-11a 主页展示化、W3-1b 任务/开始结构、W1-4 `/start` 深链。
  - 需求画布/任务画布/节点：W0-4 节点验收、W0-5 终态与工具数、W2-1 自动推进开关、W2-2 放弃调整、
    W1-11 工作区清理 UI、W1-12 交付入口、W2-10 unknown 重试/跳过入口。
  - 设置/Inbox/Git/角色/用量/交付：W1-5 用量、W1-7 文案、W3-2 Inbox、W3-7c 角色历史、W3-9b 设置分区、
    W0-1 fetch 回执、W3-12 diff 修复、W1-12/W2-3 交付与清理。
  - Electron：Wave 0–2 后未重新打包（`docs/verification.md:269`）；`electron-packaged-current` 本身是第 35 轮旧构建。
- 仍可参考的部分：四主题截图与 1024 宽度可参考主题令牌和响应式布局；但按钮、文案、交互同样不能作为当前证据。
- 结论：**当前没有任何一张 docs/evidence 截图能证明 Wave 3 之后的 UI**；需要按 §6 在桌面环境重拍。

## 4. UI smoke 当前状态

- 官方脚本：`npm run ui:smoke`（即 `env -u ELECTRON_RUN_AS_NODE electron scripts/capture-ui.cjs`）。
  它以真实服务（隔离 dataDir + 演示 Git 仓库）渲染 10 个路由并写根目录 `evidence/ui-*.png`。
- 当前沙箱结果：**未通过**——Electron GPU/sandbox 初始化失败（`GPU process isn't usable`），
  记录见 `docs/review/execution-log.md:172` 与 `docs/verification.md:352`。此结果不得计为 UI 验证通过。
- 个别 agent 在任务中用临时 Electron offscreen 脚本做过断言（见 execution-log 的 Wave 3 记录），
  但那是临时脚本、产物未入库，不能替代官方 smoke 或本目录证据。
- 因此在 CI 中不运行 `ui:smoke`（需要显示服务/GPU）；CI 只做离线 `test:e2e`（HTTP + 构建产物，无 Electron）。

## 5. 根目录 `evidence/` 与 `docs/evidence/` 的区别

| 目录 | 生成方式 | 数量/命名 | 内容 | 更新方式 | 当前状态 |
| --- | --- | --- | --- | --- | --- |
| `docs/evidence/`（本目录） | 人工在真实构建 + 真实数据/模型/打包产物上截图 | 22 张，语义化文件名；含本 README | 主页/任务/需求/执行/节点/Git/设置/Inbox/角色/用量/交付预览、四主题、Electron 打包与自托管 | 手工（需真实 OpenCode/模型/打包环境） | Wave 0 前历史证据，全部过期 |
| `evidence/`（仓库根） | `npm run ui:smoke` / `ui:capture` 自动写出的断言截图 | 11 张固定 `ui-*.png`（10 路由 + `settings?section=model`） | 各主要路由的 smoke 画面（含 3 个主题首页） | 重跑脚本覆盖；可复现 | 16:58 产物也早于 Wave 0，同样过期；脚本当前沙箱失败 |

注意：`ui:capture` 与 `ui:smoke` 指向同一个 `scripts/capture-ui.cjs`；根目录文件会被脚本覆盖。
两者都不是像素级视觉回归（只断言文案存在与 `data-theme`）。

## 6. 如何刷新与复验

1. **离线结构 smoke（CI 同款）**：
   ```sh
   npm run build:web
   node scripts/test-e2e.mjs --skip-build
   ```
   验证构建产物、真实 server 启动、`/api/health`、`/api/bootstrap`、SPA 首页与未知 API JSON 404；
   不是像素证据。
2. **自动路由截图（需要桌面环境）**：
   ```sh
   npm run ui:smoke
   ```
   成功后会刷新根目录 `evidence/` 的 11 张图；失败时不要手工修补图片。
3. **本目录手工证据刷新**：需要真实受管 OpenCode 1.19.0 + opencode-go（模型页面）、真实 Git 仓库、
   以及 Electron 打包产物（Electron 页面）；按 §2 的轮次/提交更新本 README 的"轮次 / 提交"与"是否有效"列。
4. **CI**：`.github/workflows/ci.yml` 只跑离线检查（typecheck、`npm test`、`check:docs-routes`、
   `build:web`、`test:e2e --skip-build`），不跑 live/Electron。

## 7. 限制

- 截图是开发构建 + 本机数据，不代表打包签名版本或跨平台验收。
- 没有像素级视觉回归；四主题 × 全状态没有自动覆盖。
- `docs/evidence/` 中的真实模型/打包场景无法在 CI 或当前沙箱复现；有效性只以本 README 的标注为准。
