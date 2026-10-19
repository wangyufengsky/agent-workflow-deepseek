# 界面证据清单（docs/evidence/）

> 首次整理：2026-10-19；本轮刷新：2026-10-19 21:47（Asia/Shanghai，W4-3c 设置导航修复后重拍）。
> 目录内现有 **30 张 PNG** + 本 README：22 张 Wave 0 前历史截图 + 8 张本轮的当前 UI smoke 截图。
> 本文件是清单与有效性说明，不是验收记录；验收以 `npm test`、`npm run build:web`、
> `node scripts/test-e2e.mjs`、`npm run check:docs-routes` 与 `docs/review/execution-log.md` 为准。

## 1. 结论先说

- **本轮的 8 张带 `-2026-10-19` 后缀的截图是当前 UI**：由官方 `npm run ui:smoke`（兼容 flags）
  在 2026-10-19 21:47 从真实服务 + `apps/web/dist`（21:47 重新构建）渲染，HEAD 为 `14c9fdd`，
  并包含本轮未提交的 `settings.css` 导航修复；提交后以新提交哈希为准。
- 其余 22 张仍产生于 Wave 0 之前（或第 35 轮旧打包）；**不能作为当前 UI 证据**，只作历史实现/设计对照。
- UI smoke 本轮已通过：13 个截图目标（11 个默认 + roles/ppt 两个显式扩展）+ 2 个交互 smoke；
  脚本 exit 0。它只断言文案存在、主题与关键交互，不是像素级视觉回归。
- 根目录 `evidence/` 是 smoke 自动产物（本轮 13 张）；本目录是人工整理的当前 8 张 + 历史 22 张，见 §5。
- **上一轮发现的设置导航间距缺陷已修复**：`.snav .cap` 不再继承全局首页 `.cap` 的 `min-height:300px`/`display:flex`；
  本轮 `settings-2026-10-19.png` 已确认导航分组紧凑正常。见 §4。

## 2. 本轮当前 UI 证据（8 张）

数据源：真实 `.build/server/main.mjs` + `apps/web/dist`（21:47 `npm run build:web`），隔离 `AGENT_WORKFLOW_DATA_DIR`
（`.tmp/ui-task46/ui-data`）与演示 Git 仓库；OpenCode 在该 smoke 中禁用，因此**不包含模型生成内容**。
截图尺寸均为 1440×900。

| 文件 | 内容 | 来源 root evidence | 时间 | 当前有效？ |
| --- | --- | --- | --- | --- |
| `home-deepseek-2026-10-19.png` | 主页（deepseek）：真实项目/任务概览 | `evidence/ui-home-deepseek.png` | 21:47:33 | **是**（当前 dist） |
| `tasks-2026-10-19.png` | 任务列表：阶段胶囊/聚合进度/行菜单/加载更多 | `evidence/ui-tasks-deepseek.png` | 21:47:36 | **是** |
| `requirement-canvas-2026-10-19.png` | 需求画布：真实草稿/计划/工作区入口（未调用模型） | `evidence/ui-requirement-canvas.png` | 21:47:38 | **是** |
| `task-canvas-2026-10-19.png` | 任务画布：执行面板/节点/交付入口 | `evidence/ui-task-canvas.png` | 21:47:41 | **是** |
| `git-overview-2026-10-19.png` | Git 仓库概览（真实本地 Git） | `evidence/ui-git.png` | 21:47:46 | **是** |
| `settings-2026-10-19.png` | 设置页：分区导航/服务页；`.snav .cap` 修复后导航间距正常 | `evidence/ui-settings.png` | 21:47:49 | **是**（导航已修复） |
| `roles-2026-10-19.png` | 角色管理：真实角色目录/草稿/发布入口 | `evidence/ui-roles.png` | 21:48:03 | **是** |
| `ppt-2026-10-19.png` | PPT 制作：真实作品库空态/新建入口 | `evidence/ui-ppt.png` | 21:48:05 | **是** |

补充：根目录另有 `evidence/ui-home-warm/spdb/github-white.png`（四主题首页）、
`ui-settings-model.png`（模型服务页）、`ui-start.png`（开始任务）共 5 张同批产物；
它们已刷新，但未复制进本目录（保持本目录 8 张关键页）。

## 3. 历史截图（22 张，Wave 0 前；仅历史参考）

| 文件 | 内容 | 轮次 / 提交（2026-10-19） | 当前有效？ |
| --- | --- | --- | --- |
| `home-deepseek.png` | 主页（deepseek） | 早于第 35 轮 · `f27d3d9`（11:30） | **否** |
| `tasks.png` | 任务列表 | 早于第 35 轮 · `f27d3d9`（11:30） | **否** |
| `start-task.png` | 开始任务 | 早于第 35 轮 · `f27d3d9`（11:30） | **否** |
| `requirement-candidate.png` | 需求画布：真实模型候选 | 早于第 35 轮 · `f27d3d9`（11:30） | **否** |
| `task-execution-running.png` | 任务画布执行中 | 早于第 35 轮 · `f27d3d9`（11:30） | **否** |
| `node-execution-detail.png` | 节点执行现场 | 早于第 35 轮 · `f27d3d9`（11:30） | **否** |
| `git-workbench.png` | Git 工作台提交/详情/diff | 早于第 35 轮 · `f27d3d9`（11:30） | **否** |
| `task-warm-1440.png` | 任务画布 warm 1440 | 早于第 35 轮 · `f27d3d9`（11:30） | **否** |
| `task-spdb-1440.png` | 任务画布 spdb 1440 | 早于第 35 轮 · `f27d3d9`（11:30） | **否** |
| `task-github-white-1440.png` | 任务画布 github-white 1440 | 早于第 35 轮 · `f27d3d9`（11:30） | **否** |
| `task-warm-1024.png` | 1024 宽度响应式 | 早于第 35 轮 · `f27d3d9`（11:30） | **否** |
| `settings.png` | 设置页 | 早于第 35 轮 · `f27d3d9`（11:30） | **否** |
| `inbox.png` | 待处理中心 | 早于第 35 轮 · `f27d3d9`（11:30） | **否** |
| `electron-requirements-spdb.png` | Electron + SPDB 需求目录 | 早于第 35 轮 · `f27d3d9`（11:30） | **否** |
| `electron-selfhosted-home.png` | Electron 自托管冷启动 | 早于第 35 轮 · `f27d3d9`（11:30） | **否** |
| `electron-task-warm.png` | Electron + warm 任务画布 | 早于第 35 轮 · `f27d3d9`（11:30） | **否** |
| `settings-git-remote.png` | 设置 → Git 账号 | 早于第 35 轮 · `c141f32`（11:44） | **否** |
| `electron-packaged-home.png` | 首次 electron-builder 打包 | 首次打包 · `c965bc4`（12:32） | **否** |
| `task-delivery-apply-preview.png` | 非 Git 应用预览 | 早于第 35 轮 · `ceee125`（12:25） | **否** |
| `roles-editor.png` | 角色管理编辑/发布 | 第 35 轮前后 · `405a819`（13:03） | **否** |
| `insights-real-counters.png` | 质量与用量真实计数 | 第 35 轮前后 · `56099ce`（13:18） | **否** |
| `electron-packaged-current.png` | 第 35 轮重新打包 `.app` | **第 35 轮** · `0501e10`（13:40） | **否** |

历史文件保留原名；新的当前截图使用 `-2026-10-19` 后缀，避免新旧混用。

## 4. 本轮 UI smoke 结果

- 命令（先构建，再以兼容 flags 显式开启；默认 smoke 命令不变）：
  ```sh
  npm run build:web
  CAPTURE_UI_NO_SANDBOX=1 \
  CAPTURE_UI_PORT=5293 \
  CAPTURE_UI_TMP_DIR=.tmp/ui-task46 \
  CAPTURE_UI_EXTRA=1 \
  npm run ui:smoke
  ```
- 结果：`build:web` **exit 0**（21:47，Vite 403 modules）；`ui:smoke` **exit 0**。13 个截图目标全部成功：
  `/`、`/tasks`、`/requirement/:id`、`/tasks/:id`、`/start`、`/git`、`/settings`、
  `/settings?section=model`、`/?theme=warm|spdb|github-white`、`/roles`、`/ppt`。
  交互 smoke：数据库抽屉输入保持焦点、项目目录选择器返回 102 项，均通过。
- 兼容 flags：`--no-sandbox --disable-gpu --disable-dev-shm-usage`，只在
  `CAPTURE_UI_NO_SANDBOX=1` 或 `--compat-flags` 时追加；默认行为不变。
- 端口 5288 在运行时被另一 Electron 进程占用；脚本新增可选 `CAPTURE_UI_PORT` /
  `CAPTURE_UI_TMP_DIR` 隔离，默认值仍为 5288 / `.tmp`。脚本失败改为 `app.exit(1)`，
  不再以 0 掩盖失败。
- GPU 缓存写入仍打印非致命错误（`Gpu Cache Creation failed` / `SharedImageManager`），
  不影响 11 个默认截图与 2 个扩展截图的写入；不视为 smoke 通过依据，只记录环境事实。

### 已修复视觉问题（W4-3c 验证）

- 上一轮发现设置页左侧分区导航大间距：全局 `.cap`（首页能力卡）规则作用到 `.snav .cap`，
  实测 `min-height: 300px`、`display: flex`，导致组标题与按钮分离。
- 本轮在 `apps/web/src/pages/settings/settings.css` 增加 `.snav .cap` 覆盖
  （`display:block; min-height:0; padding:12px 10px 6px; overflow:visible`），不影响首页 `.cap`；
  `settings-2026-10-19.png` 与 `evidence/ui-settings.png` 已确认导航紧凑正常。
- 本轮截图来自 21:47 重新构建的 `apps/web/dist`；若工作树在 21:48 之后仍有未提交前端改动，
  这些截图不代表该后改代码。Lead 整合后应重新 `build:web` + 本 smoke 再更新一次。

## 5. 根目录 `evidence/` 与 `docs/evidence/` 的区别

| 目录 | 生成方式 | 数量/命名 | 内容 | 更新方式 | 当前状态 |
| --- | --- | --- | --- | --- | --- |
| `docs/evidence/`（本目录） | 人工挑选 + 从 root smoke 复制 | 30 张：22 历史 + 8 当前 `-2026-10-19` | 当前 8 张关键页 + 历史 22 张 | 本轮手工复制当前 smoke 图；历史不覆盖 | 当前 8 有效；历史 22 过期 |
| `evidence/`（仓库根） | `npm run ui:smoke` / `ui:capture` 自动写出 | 13 张 `ui-*.png`（11 默认 + roles/ppt 扩展） | 各主要路由的 smoke 画面（含四主题首页） | 重跑脚本覆盖；可复现 | 2026-10-19 21:47 产物，当前 |

注意：`ui:capture` 与 `ui:smoke` 指向同一个 `scripts/capture-ui.cjs`；根目录文件会被脚本覆盖。
两者都不是像素级视觉回归（只断言文案存在与 `data-theme`）。

## 6. 如何刷新与复验

1. **离线结构 smoke（CI 同款）**：
   ```sh
   npm run build:web
   node scripts/test-e2e.mjs --skip-build
   ```
   不是像素证据。
2. **自动路由截图（需要桌面环境）**：
   ```sh
   npm run build:web
   # 普通桌面环境（默认，不追加兼容 flags）
   npm run ui:smoke
   # 沙箱/CI 兼容模式
   CAPTURE_UI_NO_SANDBOX=1 npm run ui:smoke
   ```
   成功会刷新根目录 `evidence/`；失败会 exit 1，不要手工修补图片。
3. **本目录当前证据刷新**：`npm run ui:smoke` 成功后，按 §2 的 root 文件复制并更新本 README
   的时间/提交/有效性；本轮同时使用 `CAPTURE_UI_EXTRA=1` 生成 roles/ppt。
4. **CI**：`.github/workflows/ci.yml` 只跑离线检查（typecheck、`npm test`、`check:docs-routes`、
   `build:web`、`test:e2e --skip-build`），不跑 live/Electron。

## 7. 限制

- 本轮截图是开发构建 + 隔离演示数据，不是打包签名版本或跨平台验收。
- 没有像素级视觉回归；四主题 × 全状态没有自动覆盖。
- 模型生成内容、Electron 打包产物、GitLab/数据库连接场景不在本轮 smoke；历史 22 张中的
  Electron/模型场景无法在 CI 复现，有效性只以本 README 标注为准。
- 设置页导航间距缺陷已在 W4-3c 修复并重拍；`.snav .cap` 覆盖只作用于设置导航，首页 `.cap` 不受影响。
