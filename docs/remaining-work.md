# 实现状态与剩余缺口

> 更新时间：2026-10-19（Wave 3B 完成；Wave 3C 进行中）。核心链路已真实运行；本文件只列真实未完成项，不把设计稿、进行中工作或"已禁用入口"当实现。
> 基线：`npm test` **360 tests / 54 suites / 349 pass / 11 skipped / 0 fail**（55.1s，日志 `.tmp/wave3b-verify.log`）；`npx tsc -p tsconfig.json --noEmit` exit 0；`npm run build:web` / `build:server` / `check:docs-routes` 通过（`docs/review/execution-log.md` 21:06 整合记录）。
> 设计覆盖逐页状态见 `docs/design-coverage.md`（25 页矩阵，当前 ✅ 3 / 🟡 21 / ⛔ 1）。

## 已实现并验证

| 目标能力 | 状态 | 证据 |
| --- | --- | --- |
| Electron 桌面（开发 + 第 64 轮未签名 .app） | ✅/🟡 | `npm run desktop`；`release/mac-arm64/Agent Workflow.app`（Wave 0–3B 后未重新打包，见缺口 9） |
| React + TypeScript + Vite | ✅ | `apps/web`，`npm run build:web` exit 0 |
| React Flow 流程画布（需求/任务/节点） | ✅ | `apps/web/src/flow/*`、`docs/evidence/` 截图 |
| 四主题配置式、一键切换 | ✅ | `packages/shared/src/config/themes.ts`（四套各 86 令牌）、`apps/web/src/theme/*` |
| Node.js 24 + TypeScript 后端 | ✅ | Fastify 5，Node 24 原生 TS + esbuild 生产包 |
| SQLite + JSONL | ✅ | 迁移 **v1–v11**（v11 任务只读/verify_only）、仓库、事件/规划/执行 journal |
| MySQL（mysql2）+ PostgreSQL（pg） | ✅/🟡 | MySQL 9.2 真实探针/只读/写入拦截；PostgreSQL 已有驱动与分流单测，未接真实实例 |
| Git CLI + GitHub/GitLab REST + worktree | ✅/🟡 | GitHub 真实 push/MR/关闭/删分支已验证；GitLab 仅桩验证；worktree 合并/冲突/CAS 有测试 |
| 任务独立分支 + worktree + 并发 | ✅ | `concurrent-worktrees.test.ts`、delivery/fix merge CAS |
| 内部 MCP + 受管 OpenCode 1.19.0 | ✅ | 启动注入 MCP、默认 13 工具（按启用工具集计数）、错误码、真实规划/执行/审查/修复 live |
| 规划/执行/审查/修复/交付/恢复 | ✅ | 候选、worktree、MCP 写文件、AI 审查/修复、合并、重试/跳过、任务恢复 |
| 常量/枚举/状态机/回执 | ✅ | `domain/enums.ts`、`machines.ts`、operations 回执与 UNKNOWN 核对 |
| API 契约与回执（Wave 0/1） | ✅ | `restart`/`git fetch` 返回合法 `CommandResponse`；未知 `/api/*` JSON 404；缺 `requestKey` 400；`api-contract.test.ts`、`routes-contract.test.ts` |
| 启动恢复（Wave 0/1） | ✅ | execution/planning/workspace 重启后 running→unknown 并结算回执；`startup-recovery.test.ts` |
| 真实运行态投影（Wave 0） | ✅ | `output.terminal` 按 attempt 状态、`mcp.tools` 按启用工具集、`database.connected` 按最近探针真实计算 |
| 执行控制（Wave 2） | ✅ | 自动推进开关、整体推进、推进直接后继、放弃调整；`execution-control.test.ts` 5 pass |
| 非 Git 清理真实删除（Wave 2） | ✅ | 删除受管目录副本 + baseline + settings 键，越界拒绝、可重试；`workspace-cleanup-nongit.test.ts` 4 pass |
| 恢复三模式 + unknown UI（Wave 2） | ✅ | `recovery-modes.test.ts`；`RecoveryPage` unknown 三入口（W2-10） |
| PPT 生成启动恢复（Wave 2） | ✅ | `ppt-startup-recovery.test.ts` |
| 知识历史页（Wave 2） | ✅/🟡 | `/knowledge/history` 路由与筛选/分组/展开/继续追问（W3-7a）；会话状态按引用降级，不造状态 |
| `viewActions` 回归 / 路径健壮性（Wave 2） | ✅ | `execution-control.test.ts`；静态路径边界与 legacy DELETE 回执 |
| 模型测试（opencode-go） | ✅ | flash 经兼容网关；规划/执行/审查/修复/知识库/PPT live 均通过 |
| 角色目录编辑与发布历史 | ✅ | 草稿/发布/修订热更新/归档；发布快照查看与恢复 |
| 非 Git 三方应用 / 自定义固定模板 | ✅ | `directory-apply-e2e.test.ts`；导入/可视化+JSON 编辑/归档（W1-2） |
| 工作区清理 UI + 真实清理 | ✅ | 预览/blockers/确认/回执（W1-11）；非 Git 真实删除（W2-3） |
| 知识库 / PPT / 用量 | ✅/🟡 | 来源/问答/历史 + 作品/附件/生成/导出/删除全链路；研究体验（W3-4）与 PPT 高级视觉仍缺 |
| 节点验收 accept/reject（Wave 3A） | ✅/🟡 | 审计叠加（accepted/rejected）、`actions`/`reasonCode`、requestKey 幂等/冲突、3 个集成测试；**验收 gating 待 W0-4b** |
| 项目详情四页签（Wave 3A） | ✅/🟡 | `/projects/:projectId`：概览/Git 与 GitLab/文档路径/项目公约；charter、docPaths、项目级 GitLab 绑定待 W3-1b |
| PPT 作品库 + 四步工作台（Wave 3A） | ✅/🟡 | `/ppt` 内作品视图（网格/列表/选中）+ 四步工作台（讨论需求/设计方案/制作检查/导出）；真实数据降级 |
| 任务列表/开始页结构（Wave 3A） | ✅/🟡 | W3-9a 行菜单/聚合进度/加载更多；开始页项目→目标（自动名称）→流程三段卡、版本与回执 |
| Inbox interactions 就地处理（Wave 3B） | ✅/🟡 | `interactions.test.ts` 3 pass；列表/详情/答复、草稿保留、回执；选项/多选/推荐/权限/策略按服务能力诚实降级 |
| `verify_only` 硬只读（Wave 3B） | ✅ | migration v11 + 9 类写接口 403（`recovery-readonly.test.ts`）；W2-4c 投影/updateDraft 待收口 |
| 远端 push/MR 超时 UNKNOWN（Wave 3B） | ✅/🟡 | `remote-unknown-settlement.test.ts`；fetch 与 fix push 待 W3-13 |
| storage `removeJson`（Wave 3B） | ✅ | 非 Git 清理不再直接 SQL DELETE；settings 单测 |
| 运行内容页 `/runs/:taskId`（Wave 3B） | ✅/🟡 | W3-7c 47 项 UI 断言：真实任务/需求覆盖/节点输出/变更文件；diff 受 W3-12 影响，面包屑 W3-7d |
| 历史角色配置 `/roles/legacy`（Wave 3B） | ✅/🟡 | 真实目录/分组/四组只读/发布快照 diff；能力/资源权限/形象契约缺失（如实标注） |
| API 文档生成与校验（Wave 3B） | ✅ | `docs/api.md` 由 ROUTES + 服务端注册生成（147 条唯一路由）；`check:docs-routes` 接入 `verify` |

## 剩余缺口（按优先级）

1. **W0-4b 节点验收 gating（进行中，Wave 3C）**：验收通过才结束执行/推进下游、驳回可触发重跑尚未收口；当前 accept/reject 只是审计结论。
2. **Wave 3C 后端 follow-up（进行中）**：W2-4c（readOnly 任务的 `planning.actions` 投影与 `updateDraft` 守卫）、W2-15（放弃调整恢复「调整前已暂停」）、W3-12（`changes` 文件 diff 未传 headSha 时空串导致 500）、W3-13（`fetch` 与 fix push 接入远端 UNKNOWN 结算）。
3. **项目详情后端（W3-1b，pending）**：项目公约 charter 生成/读取/写入、`ProjectSettings.docPaths`、项目级 GitLab 绑定与执行证据来源契约。
4. **角色管理四页签（W3-3，pending）**：职责与指令/能力范围/资源权限/形象、能力分组、发布核对/差异、权限预估；`/roles/legacy` 已只读可用。
5. **知识库研究体验（W3-4，进行中）**：研究四步、来源选择、流式/轮询回答、引用原文 520 面板、研究员检查面板；前端 W3-4a 进行中。
6. **任务画布扩展（W3-5，进行中）**：恢复/冻结计划/审计记录入口、运行内容入口（run 页已有）、快照评审 B-07；节点面板推进入口已补。
7. **其余整块能力**：PE37 分组细化（W3-6）、工作流编辑器（W3-8，唯一整页缺失）、W3-9b 结构缺口（模板分支/时间/文档、数据库授权项目/类型/三态、设置分区/脏保存、工具范围、需求目录抽屉）、节点详情子视图（W3-10）、主页与品牌（W3-11，进行中）、W3-7d run/legacy 面包屑。
8. **真实外部环境（W2-5 / W2-8 / W4-5）**：GitLab 真实实例与真实写未执行；PostgreSQL 未接真实实例；GitHub 远端关闭/合并/删分支产品边界待确认。
9. **打包分发（W4-4）**：`release/` 内仍是第 64 轮未签名 .app，Wave 0–3B 后未重新 `npm run dist`；签名/公证、Windows/Linux、自动更新未做。
10. **视觉回归与证据（W4-3）**：Wave 3A/3B 页面验收有一次性的 Electron 冒烟（W3-7c 47 项、知识历史 33 项等），但**未进入 `npm test`/CI**；`docs/evidence/` 仍是 Wave 0 前旧截图；像素级回归与证据清单未建立。
11. **文档/CI（W4-3）**：`docs/design-coverage.md`/`docs/api.md` 已更新并接入 `check:docs-routes`；live 日志摘要、`test:e2e` 修复、最小 CI 仍待 W4-3a/3。
12. **PPT 高级视觉 / 审查深度**：品牌模板、PDF 附件、逐页视觉检查未做；审查快照对比已有 resolved/introduced/persisting，并排代码差异与任务画布快照评审（W3-5）未做；恢复不复制执行上下文/阶段图。

## 说明

- 本文件与 `docs/review/execution-log.md`、`docs/task-assignment.md` 配套；Wave 3C/4 完成后需要把对应条目从"进行中/缺口"移到"已实现并验证"。
- 测试数字以最近一次 `npm test` 日志为准，不在本文件固定为长期常量；skip 只允许 gated live/凭据场景。
