# 实现状态与剩余缺口

> 更新时间：2026-10-19（Wave 2 完成；Wave 3A 进行中）。核心链路已真实运行；本文件只列真实未完成项，不把设计稿、进行中工作或"已禁用入口"当实现。
> 基线：`npm test` **345 tests / 54 suites / 334 pass / 11 skipped / 0 fail**（46.6s，日志 `.tmp/wave2-verify.log`）；`npx tsc -p tsconfig.json --noEmit` exit 0；`npm run build:web` / `build:server` 通过（`docs/review/execution-log.md` 20:45 整合记录）。
> 设计覆盖逐页状态见 `docs/design-coverage.md`（25 页矩阵，✅/🟡/⛔）。

## 已实现并验证

| 目标能力 | 状态 | 证据 |
| --- | --- | --- |
| Electron 桌面（开发 + 第 64 轮未签名 .app） | ✅/🟡 | `npm run desktop`；`release/mac-arm64/Agent Workflow.app`（Wave 0-2 后未重新打包，见缺口 6） |
| React + TypeScript + Vite | ✅ | `apps/web`，`npm run build:web` exit 0 |
| React Flow 流程画布（需求/任务/节点） | ✅ | `apps/web/src/flow/*`、`docs/evidence/` 截图 |
| 四主题配置式、一键切换 | ✅ | `packages/shared/src/config/themes.ts`（四套各 86 令牌）、`apps/web/src/theme/*` |
| Node.js 24 + TypeScript 后端 | ✅ | Fastify 5，Node 24 原生 TS + esbuild 生产包 |
| SQLite + JSONL | ✅ | 迁移 **v1–v10**（v8 PPT 附件、v9 PPT 主题、v10 人工验收）、仓库、事件/规划/执行 journal |
| MySQL（mysql2）+ PostgreSQL（pg） | ✅/🟡 | MySQL 9.2 真实探针/只读/写入拦截；PostgreSQL 已有驱动与分流单测（`service.test.ts`），未接真实实例 |
| Git CLI + GitHub/GitLab REST + worktree | ✅/🟡 | GitHub 真实 push/MR/关闭/删分支已验证；GitLab 仅桩验证；worktree 合并/冲突/CAS 有测试 |
| 任务独立分支 + worktree + 并发 | ✅ | `concurrent-worktrees.test.ts`、delivery/fix merge CAS |
| 内部 MCP + 受管 OpenCode 1.19.0 | ✅ | 启动注入 MCP、默认 13 工具（按启用工具集计数）、错误码、真实规划/执行/审查/修复 live |
| 规划/执行/审查/修复/交付/恢复 | ✅ | 候选、worktree、MCP 写文件、AI 审查/修复、合并、重试/跳过、任务恢复 |
| 常量/枚举/状态机/回执 | ✅ | `domain/enums.ts`、`machines.ts`、operations 回执与 UNKNOWN 核对 |
| API 契约与回执（Wave 0/1） | ✅ | `restart`/`git fetch` 返回合法 `CommandResponse`；未知 `/api/*` JSON 404；缺 `requestKey` 400；`api-contract.test.ts`、`routes-contract.test.ts` |
| 启动恢复（Wave 0/1） | ✅ | execution/planning/workspace 重启后 running→unknown 并结算回执；`startup-recovery.test.ts` |
| 真实运行态投影（Wave 0） | ✅ | `output.terminal` 按 attempt 状态、`mcp.tools` 按启用工具集、`database.connected` 按最近探针真实计算 |
| 执行控制（Wave 2） | ✅ | 自动推进开关、整体推进、推进直接后继、放弃调整；`execution-control.test.ts` 5 pass；路由 `/execution/auto-advance`、`/execution/advance`、`/plan/edit/abandon` 已注册 |
| 非 Git 清理真实删除（Wave 2） | ✅ | 删除受管目录副本 + baseline + settings 键，越界拒绝、可重试；`workspace-cleanup-nongit.test.ts` 4 pass |
| 恢复三模式真实语义（Wave 2） | ✅/🟡 | `from_failed_stage / all_stages / verify_only` 产生不同继承上下文与后续动作（`recovery-modes.test.ts`）；`verify_only` 硬只读仍缺（W2-4b） |
| PPT 生成启动恢复（Wave 2） | ✅ | 重启后 generating → unknown 并结算回执；`ppt-startup-recovery.test.ts` |
| 恢复页 unknown UI（Wave 2） | ✅ | unknown 执行可从 UI 重试失败步骤/跳过/取消并核对回执（`RecoveryPage.tsx`，W2-10） |
| 知识历史页（Wave 2） | ✅/🟡 | `/knowledge/history` 路由与筛选/分组/展开/继续追问（`KnowledgeHistoryPage.tsx`，W3-7a）；会话状态字段缺失，分段按引用降级，不显示虚构状态 |
| `viewActions` 回归 / 路径健壮性（Wave 2） | ✅ | `execution-control.test.ts`：未知任务视图 404、正常任务 18 个能力键完整；静态路径边界与 legacy DELETE 回执 |
| 模型测试（opencode-go） | ✅ | flash 经兼容网关；规划/执行/审查/修复/知识库/PPT live 均通过 |
| 角色目录编辑与发布历史 | ✅ | 草稿/发布/修订热更新/归档；发布快照查看与恢复（`RolesPage.tsx`） |
| 非 Git 三方应用 | ✅ | 真实 prepare baseline → preview → apply（`directory-apply-e2e.test.ts` PASS） |
| 自定义固定模板 | ✅ | 导入、可视化步骤增删/排序/类型/分组、JSON 编辑新版本、归档、按模板生成计划（`TemplateEditors.tsx`，W1-2） |
| 工作区清理 UI + 真实清理 | ✅ | 预览/blockers/确认/回执（`WorkspacePanel.tsx`，W1-11）；非 Git 清理真实删除（W2-3） |
| 知识库 | ✅/🟡 | 来源/搜索/正文 + 真实模型问答（引用校验）+ conversationId 会话/历史 + 独立历史页；研究过程/流式/引用原文面板未做（W3-4） |
| PPT | ✅/🟡 | 作品/附件/生成大纲与逐页/编辑/导出 Markdown+PPTX/删除全链路（W1-1）；生成恢复（W2-11）；高级视觉与 PPT 作品/工作室专页未做（W3-7b） |
| 用量 | ✅ | 规划/执行/审查/修复/知识库/PPT token 采集；Insights 聚合与逐任务规划 tokens |
| Skill 源文 / 并发会话计数 / `/start` 深链 / ErrorBoundary | ✅ | W1-3~W1-8 验收（`docs/review/execution-log.md`） |
| 文档同步 W4-1a / W4-1b | ✅ | README、remaining-work、verification 同步 Wave 0/1/2；`design-coverage` 重写为 25 页真实矩阵 |

## 剩余缺口（按优先级）

1. **W0-4 节点验收（进行中，Wave 3A）**：`node.accept` / `node.reject` 的路由、引擎、状态机与节点面板 UI 已在 Wave 3A 开始落地（task-16/task-17），**尚未验收**；完成后把 README「未完成」与设计覆盖矩阵对应项改为完成。
2. **Wave 3A 进行中（不得当作已完成）**：项目详情 `/projects/:id` 四页签与项目公约（W3-1a，`App.tsx` 已注册路由，页面/公约待验收）；PPT 作品/工作台视图（W3-7b，组件已落地）；任务列表步骤条/行菜单与开始页三段结构（W3-9a）；节点面板「推进直接后继」入口（W3-5a，已加入口待验收）。
3. **Wave 2 follow-up（未完成）**：
   - W2-4b `verify_only` 硬只读：当前只记录 `writableSession` 证据，未在 actions/plan/planning/execution 全链路强制只读。
   - W2-12 远端 fetch/写超时 UNKNOWN：客户端超时后服务端仍可能 pending，需 UNKNOWN + by-key 核对语义与测试。
   - W2-14 storage 补 `removeJson`：非 Git 清理里仍有直接 SQL DELETE settings 的绕行。
   - W2-15 abandon 恢复「调整前已暂停」：`EditSession` 只持久化 `autoAdvanceBeforeEdit`，原暂停任务会回到 running。
4. **其余设计缺失页与整块能力（W3）**：待处理中心就地处理（W3-2）、角色四页签/能力范围/资源权限/形象/发布核对/权限预估（W3-3）、知识库研究体验（W3-4）、任务画布恢复/冻结计划/审计记录/运行内容入口与快照评审 B-07（W3-5）、PE37 分组细化（W3-6）、`ppt-studio` / `run` / `roles-legacy` 页（W3-7；`ppt-works` 由 W3-7b 进行中）、工作流编辑器（W3-8）、任务列表/开始页/模板/数据库/设置/工具范围/需求目录结构缺口（W3-9）、节点详情子视图（W3-10）、主页与品牌收敛（W3-11）。
5. **真实外部环境（W2-5 / W4-5）**：GitLab 真实实例与真实写未执行（当前仅本地桩）；PostgreSQL 未接真实实例；GitHub 远端关闭/合并/删分支的产品边界待确认（W2-8）。
6. **打包分发（W4-4）**：`release/` 内仍是第 64 轮未签名 .app，Wave 0-2 后未重新 `npm run dist`；签名/公证、Windows/Linux 目标、自动更新未做。
7. **视觉回归（W4-3）**：`ui:smoke` 只有文案存在性与 `data-theme` 断言，无像素级视觉回归；Wave 0-2 后沙箱 Electron GPU 初始化失败，UI smoke 未计为通过，需桌面环境复跑；`docs/evidence/` 手工截图早于 Wave 0。
8. **文档体系（W4-2/W4-3）**：`docs/design-coverage.md` 已在 W4-1b 重写为真实矩阵；`docs/api.md` 未按最新 ROUTES + 服务端注册重新生成（W4-2）；证据清单/live 日志摘要、`test:e2e`（当前指向不存在的脚本）、最小 CI 未做（W4-3）。
9. **PPT 高级视觉**：四主题 PPTX、文本+图片附件已做；品牌模板、PDF 附件、逐页视觉检查未做。
10. **恢复/审查深度**：恢复不复制执行上下文/阶段图，规划上下文仍以核对/未知为主；审查快照对比已有 resolved/introduced/persisting，并排代码快照差异与任务画布快照评审（W3-5）未做。

## 说明

- 本文件与 `docs/review/execution-log.md`、`docs/task-assignment.md` 配套；Wave 3A/3/4 完成后需要把对应条目从"进行中/缺口"移到"已实现并验证"。
- 测试数字以最近一次 `npm test` 日志为准，不在本文件固定为长期常量；skip 只允许 gated live/凭据场景。
