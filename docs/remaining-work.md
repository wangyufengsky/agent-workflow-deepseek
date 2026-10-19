# 实现状态与剩余缺口

> 更新时间：2026-10-19（Wave 3E 完成；Wave 3F 进行中）。核心链路已真实运行；本文件只列真实未完成项，不把设计稿、进行中工作或"已禁用入口"当实现。
> 基线：`npm test` **391 tests / 54 suites / 380 pass / 11 skipped / 0 fail**（65.0s，日志 `.tmp/wave3e-verify.log`）；`npx tsc -p tsconfig.json --noEmit` exit 0；`npm run docs:api` / `check:docs-routes`（153 路由）/ `build:web` / `build:server` / `test:e2e -- --skip-build` 通过；`npm run ui:smoke`（兼容 flags）13 截图 + 2 交互 smoke 通过（`docs/review/execution-log.md` 21:45 整合记录）。
> 设计覆盖逐页状态见 `docs/design-coverage.md`（25 页矩阵，当前 ✅ 3 / 🟡 21 / ⛔ 1）。
> 打包与真实环境：见 `docs/packaging.md`（W4-4 已重建 346MB 未签名 .app；W4-5 真实 PG/GitLab 因本机无实例/凭据 **blocked**）。
> 品牌决策：产品名继续 `agent-workflow` / `Agent Workflow`；设计稿 `opencode-workflow` 仅作来源名，不做全局改名（见 README「品牌与命名」）。

## 已实现并验证

| 目标能力 | 状态 | 证据 |
| --- | --- | --- |
| Electron 桌面（开发 + Wave 3D 重建 .app） | ✅/🟡 | `npm run desktop`；**2026-10-19 21:20 `npm run dist:dir`**：`release/mac-arm64/Agent Workflow.app`（346MB，arm64，未签名/未公证；见缺口 8 与 `docs/packaging.md`） |
| React + TypeScript + Vite | ✅ | `apps/web`，`npm run build:web` exit 0 |
| React Flow 流程画布（需求/任务/节点） | ✅ | `apps/web/src/flow/*`；PE37 占位层已接入 `RequirementCanvasPage` |
| 四主题配置式、一键切换 | ✅ | `packages/shared/src/config/themes.ts`（四套各 86 令牌）、`apps/web/src/theme/*` |
| Node.js 24 + TypeScript 后端 | ✅ | Fastify 5，Node 24 原生 TS + esbuild 生产包 |
| SQLite + JSONL | ✅ | 迁移 **v1–v11**（v11 任务只读/verify_only）、仓库、事件/规划/执行 journal |
| MySQL（mysql2）+ PostgreSQL（pg） | ✅/🟡 | MySQL 9.2 真实探针/只读/写入拦截；PostgreSQL 驱动/分流单测 19 pass、JDBC 解析通过，**未接真实实例且无 PG live 测试**（W4-5 评估见 `docs/packaging.md` §7.2） |
| Git CLI + GitHub/GitLab REST + worktree | ✅/🟡 | GitHub 真实 push/MR/关闭/删分支已验证；GitLab 仅本地桩测试，**无真实实例/令牌且无 GitLab live 测试**；W2-5 仍 pending；worktree 合并/冲突/CAS 有测试 |
| 任务独立分支 + worktree + 并发 | ✅ | `concurrent-worktrees.test.ts`、delivery/fix merge CAS |
| 内部 MCP + 受管 OpenCode 1.19.0 | ✅ | 启动注入 MCP、默认 13 工具（按启用工具集计数）、错误码、真实规划/执行/审查/修复 live |
| 规划/执行/审查/修复/交付/恢复 | ✅ | 候选、worktree、MCP 写文件、AI 审查/修复、合并、重试/跳过、任务恢复 |
| 常量/枚举/状态机/回执 | ✅ | `domain/enums.ts`、`machines.ts`、operations 回执与 UNKNOWN 核对 |
| API 契约与回执（Wave 0/1） | ✅ | `restart`/`git fetch` 返回合法 `CommandResponse`；未知 `/api/*` JSON 404；缺 `requestKey` 400；`api-contract.test.ts`、`routes-contract.test.ts` |
| 启动恢复（Wave 0/1） | ✅ | execution/planning/workspace 重启后 running→unknown 并结算回执；`startup-recovery.test.ts` |
| 真实运行态投影（Wave 0） | ✅ | `output.terminal` 按 attempt 状态、`mcp.tools` 按启用工具集、`database.connected` 按最近探针真实计算 |
| 执行控制（Wave 2） | ✅ | 自动推进开关、整体推进、推进直接后继、放弃调整；`execution-control.test.ts` 5 pass |
| 非 Git 清理真实删除（Wave 2） | ✅ | 删除受管目录副本 + baseline + settings 键，越界拒绝、可重试；`workspace-cleanup-nongit.test.ts` 4 pass |
| 恢复三模式 + unknown UI（Wave 2） | ✅ | `recovery-modes.test.ts`；`RecoveryPage` unknown 三入口 |
| PPT 生成启动恢复（Wave 2） | ✅ | `ppt-startup-recovery.test.ts` |
| 知识历史页（Wave 2） | ✅/🟡 | `/knowledge/history` 路由与筛选/分组/展开/继续追问；会话状态按引用降级 |
| `viewActions` 回归 / 路径健壮性（Wave 2） | ✅ | `execution-control.test.ts`；静态路径边界与 legacy DELETE 回执 |
| 模型测试（opencode-go） | ✅ | flash 经兼容网关；规划/执行/审查/修复/知识库/PPT live 均通过 |
| 角色目录编辑与发布历史（Wave 2/3A） | ✅ | 草稿/发布/修订热更新/归档；发布快照查看与恢复 |
| 非 Git 三方应用 / 自定义固定模板 | ✅ | `directory-apply-e2e.test.ts`；导入/可视化+JSON 编辑/归档（W1-2） |
| 工作区清理 UI + 真实清理 | ✅ | 预览/blockers/确认/回执（W1-11）；非 Git 真实删除（W2-3） |
| 知识库 / PPT / 用量 | ✅/🟡 | 来源选择/引用原文 520/研究员面板（W3-4a）；PPT 作品/附件/生成/导出/删除全链路；研究步骤/流式（W3-4b）与 PPT 高级视觉仍缺 |
| 节点验收 accept/reject + gating（Wave 3A/3C） | ✅ | 审计叠加、actions/reasonCode、requestKey 幂等/冲突；有验收标准节点 park→paused，accept 后完成、reject 可重试 |
| 待验收情况条/去验收/重试（W0-4c，Wave 3D） | ✅ | 任务画布「待验收 N / 已退回 N」、去验收打开节点、驳回原因、按原配置重试被退回步骤 |
| 项目详情四页签（Wave 3A） | 🟡 | `/projects/:projectId` 概览/Git 与 GitLab/文档路径/项目公约；**charter/docPaths/GitLab 后端已在 Wave 3E 接线，UI 接入 W3-1c 进行中** |
| 项目公约后端（W3-1b，Wave 3E） | ✅/🟡 | `GET/PATCH /projects/:id/charter`、`confirm` 原子写 AGENTS.md、unknown 恢复、`generate` 诚实 501；`docPaths` 与项目级 GitLab 覆盖契约/读回；`charter.test.ts` + `pe37-http.test.ts` 5 pass。模型生成未接线 |
| 角色管理四页签（W3-3，Wave 3D） | ✅/🟡 | 后端新字段 + validate/publish checks/history（`role-catalog-extended.test.ts` 5 pass）；前端四页签/资源权限/形象/发布检查；B-02/B-03、形象目录、步骤级使用统计仍缺 |
| 节点详情子视图（W3-10，Wave 3D） | ✅/🟡 | 工具详情/产物详情/引用原文/900px 宽阅读区/断线 seq 缺口提示；服务无产物正文/工具增量读取接口处降级；平移到节点未实现 |
| 数据库/工具/模板结构（W3-9c，Wave 3D） | ✅/🟡 | 可读范围/授权项目/三格检查降级、配置范围/单工具/来源停用原因、模板分组/运行说明/B-06 只读说明；33 项 UI 断言 |
| PE37 分组逐步细化（W3-6/6b，Wave 3D/3E） | ✅/🟡 | 引擎 proposal/refinePreview/scoped start/merge/confirm 前置（`pe37-scope-planning.test.ts` 3 pass）；HTTP `proposal`/`refine-preview`/`scope`/`continuePlanning`（`pe37-http.test.ts` 5 pass）；UI 总览/占位/选区弹窗/组候选/确认拦截 |
| PPT 作品库 + 四步工作台（Wave 3A） | ✅/🟡 | `/ppt` 内作品视图 + 四步工作台；真实数据降级；Wave 3D/3E 未改 PPT |
| 任务列表/开始页结构（Wave 3A） | ✅/🟡 | 行菜单/聚合进度/加载更多；开始页三段卡、版本与回执 |
| Inbox interactions 就地处理（Wave 3B） | ✅/🟡 | `interactions.test.ts` 3 pass；自由文本/草稿/回执；选项/权限/策略按服务能力诚实降级 |
| `verify_only` 硬只读 + 投影（W2-4b/4c） | ✅ | migration v11 + 9 类写接口 403 + `planning.actions` 全 denied + `updateDraft` 403 |
| abandon 恢复暂停态（W2-15） | ✅ | `wasPausedBeforeEdit` 持久化；原 paused 保持、原 running 恢复；跨重启测试 |
| 远端 push/MR/fetch/fix push UNKNOWN（W2-12/W3-13） | ✅ | `remote-unknown-settlement.test.ts` + `backend-hardening.test.ts` 分类矩阵/重放不重发/by-key 核对 |
| `changes` 文件 diff 修复（W3-12） | ✅ | 无 headSha 时 `git diff base -- path`，有 headSha 保持 `base..head`；回归测试 |
| storage `removeJson`（W2-14） | ✅ | 非 Git 清理不再直接 SQL DELETE；settings 单测 |
| 运行内容页 / 历史角色配置页（Wave 3B/3C） | ✅/🟡 | W3-7c 47 项 UI 断言 + W3-12/W3-7d；无专用运行内容接口、角色能力/权限/形象契约缺失（如实标注） |
| 设置页结构（W3-9b） | ✅/🟡 | 执行限制/重试等待/发布网络/开发辅助分区、脏保存条、部分字段真实降级 |
| 主页展示化（W3-11a） | ✅/🟡 | 移除统计三卡/业务列表，保留 hero/流程演示/能力卡；设计「进行中」单卡仍未做 |
| 方法目录后端核心（W3-8a，Wave 3E） | ✅/🟡 | 合并视图/CRUD/validate/版本冲突/复制/归档/instantiate（`method-catalog.test.ts` 7 pass）；HTTP/Engine 接线 W3-8c 进行中 |
| UI 视觉回归兼容 flags + 截图刷新（W4-3b，Wave 3E） | ✅/🟡 | `CAPTURE_UI_NO_SANDBOX=1 CAPTURE_UI_PORT=5292 CAPTURE_UI_TMP_DIR=.tmp/ui-task44 CAPTURE_UI_EXTRA=1 npm run ui:smoke` → 13 截图 + 2 交互 smoke；`evidence/` 11 张刷新 + `ui-roles/ui-ppt`；`docs/evidence/` 8 张当前 + 22 张历史（README 30 张清单）；W4-3c 设置页导航样式缺陷待修 |
| CI / e2e / 证据清单（W4-3a） | ✅ | `.github/workflows/ci.yml`、`scripts/test-e2e.mjs` PASS、`docs/evidence/README.md` |
| API 文档生成与校验（W4-2） | ✅ | `docs/api.md` 由 ROUTES + 服务端注册生成（**153 路由**）；`check:docs-routes` 接入 `verify` |
| 品牌命名决策（W3-11b） | ✅ | 继续 `agent-workflow`；设计稿 `opencode-workflow` 仅作来源名（README「品牌与命名」） |
| 打包重建与启动冒烟（W4-4，Wave 3D） | ✅/🟡 | `npm run dist:dir` exit 0 → 346MB `.app`；打包内 server/Web smoke PASS；默认 GUI 沙箱失败、兼容 flags 离屏 PASS；未签名/未公证/无安装包（`docs/packaging.md`） |
| 真实环境评估（W4-5，Wave 3D） | 🟡/⛔ | 本机无 PostgreSQL/GitLab 实例或凭据；PG 驱动单测 19 pass；**无 PG/GitLab live 测试，未写 PASS**；所需环境变量/补测见 `docs/packaging.md` §7 |

## 剩余缺口（按优先级）

1. **Wave 3F 进行中（不得当作已完成）**：W3-1c 项目详情 UI 接入 charter/docPaths/GitLab、W3-8c method catalog HTTP/Engine 接线、W3-8b 工作流编辑器 UI、W3-5 任务画布后端核心（冻结/审计/快照评审/运行内容读模型）。
2. **W4-3c 设置页导航样式**：`.snav .cap` 命中全局首页 `.cap` 样式（min-height:300px/display:flex），设置页分组导航出现约 300px 间距；`docs/evidence/settings-2026-10-19.png` 与 `evidence/ui-settings.png` 如实显示。需修样式并重拍截图。
3. **W3-4b 知识库研究体验**：研究步骤、工具轨迹、流式/轮询回答、命中相关度等 DTO 未提供；W3-4a 只做到来源选择/引用原文/研究员面板。
4. **W3-5 任务画布扩展**：冻结计划、审计记录、运行内容入口、快照评审 B-07（`/runs/:taskId`、待验收情况条、节点面板推进入口已有）。
5. **W3-8b/W3-8c 工作流编辑器**：method catalog 后端核心已完成（7 测试），HTTP/Engine（W3-8c）与画布编辑 UI（W3-8b）进行中；当前仍无 `/workflows/:id/edit` 页面（唯一整页缺失）。
6. **W3-10 剩余降级项**：平移到节点未实现；服务无产物正文/工具增量读取/完整补读接口，子视图按真实错误降级。
7. **W4-5 / W2-5 真实环境（blocked）**：本机无 PostgreSQL/GitLab 实例或凭据，仓库无 PG/GitLab live 测试。需要 PG 连接串 + 只读账号（`WF_PG_URL/WF_PG_USER/WF_PG_PASSWORD` + 新增 PG live）；GitLab base/API URL + api scope PAT + 测试项目（`GITLAB_TEST_*`，先完成 W2-5）。GitHub 远端边界（W2-8）仍待确认。详见 `docs/packaging.md` §7。
8. **打包分发（W4-4）**：21:20 已重建 346MB 未签名 `.app`，但未签名/未公证、无 dmg/zip、仅 arm64、默认图标、asar 关闭；默认 GUI 沙箱失败（兼容 flags 离屏 PASS）；签名/公证、桌面默认验收、Windows/Linux、自动更新、CI 打包未做（`docs/packaging.md` §5/§8/§9）。
9. **其余深度项**：数据库授权/多 schema、工具项目级配置/单工具策略、模板分支/时间/文档/B-06、角色 B-02/B-03 权限预估/形象目录/使用统计、审查并排代码差异、恢复不复制执行上下文/阶段图、PPT 高级视觉、live 日志摘要入库。

## 说明

- 本文件与 `docs/review/execution-log.md`、`docs/task-assignment.md` 配套；Wave 3F/4 完成后需要把对应条目从"进行中/缺口"移到"已实现并验证"。
- 测试数字以最近一次 `npm test` 日志为准，不在本文件固定为长期常量；skip 只允许 gated live/凭据场景。
- 品牌：产品名继续 `agent-workflow`；`opencode-workflow` 为设计来源名，全局改名不在范围内。
- 打包与真实环境 blocked 的完整证据、环境变量与复现命令见 `docs/packaging.md`；当前 UI 截图清单见 `docs/evidence/README.md`。
