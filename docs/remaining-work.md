# 实现状态与剩余缺口

> 更新时间：2026-10-19（Wave 0 + Wave 1 完成后；Wave 2 进行中）。核心链路已真实运行；本文件只列真实未完成项，不把设计稿、进行中工作或"已禁用入口"当实现。
> 基线：`npm test` **330 tests / 54 suites / 319 pass / 11 skipped / 0 fail**（43.8s，日志 `.tmp/final-verify.log`）；`npx tsc -p tsconfig.json --noEmit` exit 0；`npm run build:web` / `build:server` 通过（`docs/review/execution-log.md` 20:32 整合记录）。

## 已实现并验证

| 目标能力 | 状态 | 证据 |
| --- | --- | --- |
| Electron 桌面（开发 + 第 64 轮未签名 .app） | ✅/🟡 | `npm run desktop`；`release/mac-arm64/Agent Workflow.app`（Wave 0/1 后未重新打包，见缺口 5） |
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
| 启动恢复（Wave 0） | ✅ | execution/planning/workspace 重启后 running→unknown 并结算回执；`startup-recovery.test.ts` 5 条用例 |
| 真实运行态投影（Wave 0） | ✅ | `output.terminal` 按 attempt 状态、`mcp.tools` 按启用工具集、`database.connected` 按最近探针真实计算 |
| 模型测试（opencode-go） | ✅ | flash 经兼容网关；规划/执行/审查/修复/知识库/PPT live 均通过 |
| 角色目录编辑与发布历史 | ✅ | 草稿/发布/修订热更新/归档；`/catalog/roles/:id/history` 查看并恢复快照（`RolesPage.tsx`） |
| 非 Git 三方应用 | ✅ | 真实 prepare baseline → preview → apply（`directory-apply-e2e.test.ts` PASS） |
| 自定义固定模板 | ✅ | 导入、可视化步骤增删/排序/类型/分组、JSON 编辑新版本、归档、按模板生成计划（`TemplateEditors.tsx`，W1-2） |
| 工作区清理 UI | ✅/🟡 | 预览/blockers/确认/回执已接线（`WorkspacePanel.tsx`，W1-11）；非 Git 真实删除仍缺（见缺口 2） |
| 知识库 | ✅ | 来源/搜索/正文 + 真实模型问答（引用校验）+ conversationId 会话/历史；knowledge-history 页未做 |
| PPT | ✅/🟡 | 作品/附件/生成大纲与逐页/编辑/导出 Markdown+PPTX/删除全链路（`PptPage.tsx`、`PptWorkPanel.tsx`，W1-1）；高级视觉与 generating 恢复未做 |
| 用量 | ✅ | 规划/执行/审查/修复/知识库/PPT token 采集；Insights 聚合与逐任务规划 tokens |
| Skill 源文 / 并发会话计数 | ✅ | 带行号只读源文（`ToolsPage.tsx`）；状态接口区分活动会话与历史会话（`OpenCodeCard.tsx`） |
| 陈旧文案清理 / `/start` 深链 / ErrorBoundary | ✅ | W1-3~W1-8 验收（`docs/review/execution-log.md`） |

## 剩余缺口（按优先级）

1. **W0-4 节点验收（pending）**：`node.accept` / `node.reject` 目前只有 `enums.ts` 中的操作常量，没有 HTTP 路由、引擎实现与节点面板 UI。需要产品决定：实现，或移除并同步改 README（设计稿节点面板把它作为主操作，默认倾向实现）。
2. **Wave 2 进行中（不得当作已完成）**：
   - W2-1 自动推进切换/推进一步、W2-2 放弃执行中调整：`ROUTES.executionAdvance` 与 `ROUTES.planEditAbandon` 已在契约中是前置条目，但服务端尚未注册（`routes-contract.test.ts` 例外表明确标注 W2-1/W2-2）。
   - W2-3 非 Git 清理真实删除：`workspace.ts` 的 `cleanupConfirm` 当前只在 Git 项目移除 worktree；非 Git 目录副本与 baseline 仅改状态，未真正删除（"假清理"）。
   - W2-4 恢复三模式真实语义：`from_failed_stage / all_stages / verify_only` 目前只有标题差异（`recovery.ts`），未实现真正的阶段重放/只读验证语义。
   - W2-5 GitLab 真实连接/写；W2-7 硬编码状态剩余项；W2-8 远端写 UNKNOWN 与关闭/合并/删分支产品边界；W2-9 健壮性收口。
   - W2-10 恢复页 unknown UI；W2-11 PPT「生成中」启动恢复；W2-12 远端 fetch/写超时 UNKNOWN；W2-13 `viewActions` 回归（均来自 Wave 0/1 验收遗留）。
3. **设计缺失页与整块能力（W3）**：明确缺失的页面 `knowledge-history`、`ppt-works`、`ppt-studio`、`run`、`roles-legacy`（当前 App 未注册）；项目详情 `/projects/:id` 四页签 + 项目公约后端；待处理中心就地处理（interactions 契约）；角色管理四页签（能力/资源权限/形象/发布检查/权限预估，含版本对比与导入）；知识库体验与 knowledge-history；任务画布运行内容/冻结计划/审计记录与快照评审（B-07）；PE37 大需求分组逐步细化；工作流编辑器（method CRUD/画布）；任务列表步骤条/行菜单、开始页三段卡、模板分支/时间/文档、数据库授权项目/类型/三态、设置分区与脏保存、工具范围、需求目录抽屉；节点详情子视图；主页与品牌。
4. **真实外部环境（W2-5 / W4-5）**：GitLab 真实实例与真实写未执行（当前仅本地桩）；PostgreSQL 未接真实实例；GitHub 远端关闭/合并/删分支的产品边界待确认。
5. **打包分发（W4-4）**：`release/` 内仍是第 64 轮未签名 .app，Wave 0/1 后未重新 `npm run dist`；签名/公证、Windows/Linux 目标、自动更新未做。
6. **视觉回归（W4-3）**：`ui:smoke` 只有文案存在性与 `data-theme` 断言，无像素级视觉回归；Wave 0/1 后沙箱 Electron GPU 初始化失败，UI smoke 未计为通过，需桌面环境复跑；`docs/evidence/` 手工截图早于 Wave 0/1。
7. **文档体系（W4-1/W4-2/W4-3）**：`docs/design-coverage.md` 仍是 `verification.md` 的旧副本，W4-1 正在重写；`docs/api.md` 未按最新 ROUTES + 服务端注册重新生成（W4-2）；证据清单/live 日志摘要、`test:e2e`（当前指向不存在的脚本）、最小 CI 未做（W4-3）。
8. **PPT 高级视觉**：四主题 PPTX、文本+图片附件已做；品牌模板、PDF 附件、逐页视觉检查未做。
9. **恢复深度**：进程重启后的规划上下文恢复仍以核对/未知为主；W2-4 完成后仅解决恢复模式语义，不解决规划上下文重建。
10. **审查快照对比**：同提交两次审查可对比新增/已解决/仍存在；并排代码快照差异视图与任务画布快照评审（W3-5）未做。

## 说明

- 本文件与 `docs/review/execution-log.md`、`docs/task-assignment.md` 配套；Wave 2 结束后需要把对应条目从"进行中/缺口"移到"已实现并验证"。
- 测试数字以最近一次 `npm test` 日志为准，不在本文件固定为长期常量；skip 只允许 gated live/凭据场景。
