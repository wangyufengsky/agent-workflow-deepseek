# 实现状态与剩余缺口

> 更新时间：2026-10-19（第 62 轮）。核心链路已真实运行；本文件只列真实未完成项，不把设计稿当实现。

## 已实现并验证

| 目标能力 | 状态 | 证据 |
| --- | --- | --- |
| Electron 桌面（开发 + 打包 .app） | ✅ | `npm run desktop`；`release/mac-arm64/Agent Workflow.app` 启动/截图/优雅退出 |
| React + TypeScript + Vite | ✅ | `apps/web`，`npm run build` |
| React Flow 流程画布（需求/任务/节点） | ✅ | `docs/evidence/requirement-candidate.png`、`node-execution-detail.png` |
| 四主题配置式、一键切换 | ✅ | `packages/shared/src/config/themes.ts`、`apps/web/src/theme/*`、多主题截图 |
| Node.js 24 + TypeScript 后端 | ✅ | Fastify 5，Node 24 原生 TS + esbuild 生产包 |
| SQLite + JSONL | ✅ | 迁移 v1–v7、仓库、事件/规划/执行 journal |
| MySQL（mysql2） | ✅ | 真实 MySQL 9.2 探针/只读查询/写入拦截（`database-live.test.ts`） |
| Git CLI + GitHub/GitLab REST + worktree | ✅/🟡 | 读模型/合并/fetch/推送防护；MR 创建用 GitHub/GitLab 桩验证；真实远端写未执行 |
| 任务独立分支 + worktree + 并发 | ✅ | `concurrent-worktrees.test.ts`、delivery/fix merge CAS |
| 内部 MCP + 受管 OpenCode 1.19.0 | ✅ | 启动注入 MCP、13 工具、错误码、真实规划/执行/审查/修复 live |
| 规划/执行/审查/修复/交付/恢复 | ✅ | 候选、worktree、MCP 写文件、AI 审查/修复、合并、重试/跳过、任务恢复 |
| 常量/枚举/状态机/回执 | ✅ | `domain/enums.ts`、`machines.ts`、operations 回执与 UNKNOWN 核对 |
| 模型测试（opencode-go） | ✅ | flash 经兼容网关；规划/执行/审查/修复/知识库/PPT live 均通过 |
| 角色目录编辑 | ✅ | 草稿/发布/修订热更新/归档 |
| 非 Git 三方应用 | ✅ | 真实 prepare baseline → preview → apply |
| 自定义固定模板 | ✅ | 导入/JSON 编辑新版本/归档/按模板生成计划；旧任务冻结旧版本 |
| 知识库 | ✅ | 来源/搜索/正文 + 真实模型问答（引用校验）+ conversationId 会话/历史 |
| PPT | ✅/🟡 | 草稿 CRUD、模型大纲/逐页、手动编辑、Markdown/PPTX 导出；高级视觉/附件未做 |
| 用量 | ✅ | 规划/执行/审查/修复/知识库/PPT token 采集；Insights 聚合与逐任务规划 tokens |

## 剩余缺口（按优先级）

1. **真实远端写**：需一个可丢弃测试仓库跑 push → 创建 MR → 关闭/删除分支；当前 GitHub 只读 + GitHub/GitLab 桩写验证。
2. **模板拖拽式编辑器**：已支持导入、JSON 编辑新版本、归档、按模板计划；缺可视化步骤编辑器。
3. **PPT 高级视觉与附件**：基础版式 PPTX 可导出；品牌模板、附件资料、逐页视觉检查未做。
4. **审查快照对比视图**：审查/修复真实可用；并排比较两次快照的 UI 未做。
5. **验收/评审结论聚合**：Insights 的验收通过率、人工认定仍显示未知。
6. **恢复深度**：进程重启后的规划上下文恢复仍以核对/未知为主。
7. **打包**：macOS 未签名/未公证；Windows/Linux 目标未验证；无自动更新。
8. **UI 回归**：关键状态有截图证据；未建立自动视觉回归。
