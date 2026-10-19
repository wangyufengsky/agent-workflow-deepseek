# 实现状态与剩余缺口

> 更新时间：2026-10-19（第 15 轮）。核心链路已真实运行；本文件只列真实未完成项，不把设计稿当实现。

## 已实现并验证

| 目标能力 | 状态 | 证据 |
| --- | --- | --- |
| Electron 桌面（开发 + 打包 .app） | ✅ | `npm run desktop`；`release/mac-arm64/Agent Workflow.app` 启动/截图/优雅退出 |
| React + TypeScript + Vite | ✅ | `apps/web`，`npm run build` |
| React Flow 流程画布（需求/任务/节点） | ✅ | `docs/evidence/requirement-candidate.png`、`node-execution-detail.png` |
| 四主题配置式、一键切换 | ✅ | `packages/shared/src/config/themes.ts`、`apps/web/src/theme/*`、多主题截图 |
| Node.js 24 + TypeScript 后端 | ✅ | Fastify 5，Node 24 原生 TS + esbuild 生产包 |
| SQLite + JSONL | ✅ | 迁移/仓库/事件/规划/执行 journal（`journal/events|planning-*|attempt-*`） |
| MySQL（mysql2） | ✅ | 真实 MySQL 9.2 探针/只读查询/写入拦截（`database-live.test.ts`） |
| Git CLI + GitHub/GitLab REST + worktree | ✅/🟡 | 读模型/合并/fetch/推送防护；MR 创建用 GitHub/GitLab 桩验证；真实远端写未执行 |
| 任务独立分支 + worktree + 并发 | ✅ | `concurrent-worktrees.test.ts`、delivery merge CAS |
| 内部 MCP + 受管 OpenCode 1.19.0 | ✅ | 启动注入 MCP、13 工具、错误码、真实规划/执行/审查/修复 live |
| 规划/执行/审查/修复/交付/恢复 | ✅ | 规划候选、worktree、MCP 写文件、交付合并、AI 审查/修复、执行重试/跳过、任务恢复草稿 |
| 常量/枚举/状态机/回执 | ✅ | `domain/enums.ts`、`machines.ts`、operations 回执与 UNKNOWN 核对 |
| 模型测试（opencode-go） | ✅ | flash 经兼容网关 + v4-pro 备选；4 条 live 测试 |
| 角色目录编辑 | ✅ | 草稿/发布/修订热更新/归档（`roles-api.test.ts`、roles-editor.png） |
| 非 Git 三方应用 | ✅ | 真实 prepare baseline → preview → apply（`directory-apply-e2e.test.ts`） |

## 剩余缺口（按优先级）

1. **真实远端写**：建议用一个可丢弃测试仓库跑 push → 创建 MR → 关闭/删除分支；当前为避免污染用户仓库只做了 GitHub 只读 + 桩写验证。
2. **模板可视化编辑**：固定模板导入/导出/计划/历史已实现；还没有可视化步骤编辑器。
3. **知识库多轮 / PPT 视觉**：知识库与 PPT 大纲/逐页/PPTX 基础导出已实现；高级视觉模板、附件与多轮会话未实现。
4. **用量质量**：无 token/成本采集；质量页对未知项明确显示未知。
5. **会话阈值 / 监控**：断连轮询间隔已可配置；会话数阈值与自动监控未接。
6. **审查快照对比**：审查/修复真实可用，但“快照对比视图”未做。
7. **交付边界**：push/MR 用桩验证；真实 GitLab 未连接；`fix.merge` 已实现（本地 no-ff）。
8. **恢复深度**：任务派生草稿、执行继续/重试/跳过已实现；进程重启后的规划上下文恢复仍以核对/未知为主。
9. **打包**：macOS 未签名/未公证；Windows/Linux 目标未验证；无自动更新。
10. **UI 回归**：关键状态有截图证据；未建立自动视觉回归。
