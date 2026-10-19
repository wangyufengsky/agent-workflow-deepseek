# 剩余工作与已知缺口

按优先级排列；“已验证/未验证”严格区分。

## P0 收尾（本轮之后立即做）

1. **Canvas / Git 页面接线**：`/start`、`/requirement/:id`、`/tasks/:id`、`/git`、`/git/:projectId` 的最终路由与
   面包屑；候选图层读取 `/api/tasks/:id/plan/revisions/:revisionId`（已提供）。
2. **交付合并 UI**：`POST /api/tasks/:id/delivery/merge` 已实现（临时 worktree + CAS，冲突返回
   `MERGE_CONFLICT`）；Git 工作台/交付面板需加“合并到目标分支”独立确认步骤。
3. **Electron 完整链路**：`npm run build && npm run desktop` 使用生产 bundle 启动，验证窗口、主题、真实任务
   列表、规划/执行/交付；补充截图证据与 `docs/evidence/`。
4. **主题四套截图对照**：同一任务画布在 deepseek/warm/spdb/github-white 下截图；1024 宽度检查。

## P1 后端能力

5. **GitHub/GitLab 凭据**：设置页写令牌 → AES-GCM 保存 → 远端 adapter 注入；fetch/push/MR 的端到端；
   protected branch 查询；`git.commit` 的 hook 输出脱敏已实现，未做真实远端验证。
6. **AI 审查/修复**：Git 页 `review.start` / `fix.start` 目前 UI 与执行引擎已有基础（`ReviewRun`/`FixRun` 存储、
   Git 包读模型），需把 OpenCode 会话、findings 产物校验、修复 worktree、校验命令接通并测试。
7. **非 Git 任务**：独立副本准备已有接口占位（`copyToDirectory` 未实现）、三方应用/冲突处理未实现。
8. **工作区清理**：confirm 已有基础实现；需补阻塞条件（活动写入/未核对回执/未交付内容）与 UI 预览。
9. **恢复工作台**：恢复方式（resume/restart/snapshot）目前只做了前端本地选择；后端恢复命令与状态机未接通。
10. **mysql2 真实联调**：用 `opencode-workflow-java-test` 的本地 MySQL 凭据（由用户注入环境变量）验证
    probe/query、错误映射与超时；当前 fake driver 已覆盖守卫。
11. **pipeline/approvals/分页**：Git 远程读口缺省值按“未知”展示，远端实现时补。

## P2 产品页面

12. 知识库、PPT、恢复、质量与用量等页面的真实后端（当前只读/未接通，已禁用并写原因）。
13. 规划 PE28/PE37/PE38（并行写冲突、大需求总览、有界局部细化）、执行中调整的完整交互与真实冲突竞态。
14. 附件/产物导出（Electron 宿主保存对话框）、在文件管理器显示（preload 已提供）。

## 质量与发布

15. Playwright/Electron 自动截图回归（四主题 × 1280/1024，关键状态）。
16. `npm run build` 全链路 + 打包（electron-builder，macOS 签名/公证、Windows/Linux 构建）。
17. 运行数据备份/迁移与升级策略；`secrets.key` 丢失时的处理（当前会无法解密旧密钥）。
18. 崩溃恢复：服务重启后运行中的 planning/execution 会话 reconciliation（已有 unknown + reconcile 基础，
    需覆盖进程重启场景）。

## 已知技术债

- `packages/server` 内部的 GitCliAdapter 与 `packages/git` 有部分功能重叠：前者是 engine `GitPort` 的最小实现，
  后者是更完整的读模型/worktree/REST 库。后续统一为 `packages/git` 适配器，删除重复代码。
- 根 npm 配置若 `omit=dev` 会导致 electron/vite/tsx 未安装，README 已提示改用 `npm install --include=dev`。
- `settings.server.port` 与 Electron 实际端口（默认 5288）可能不同；设置页显示的是配置值，不是运行时端口。
- 首页早期使用 `.side` class 与设计系统 `.side`（右侧抽屉）冲突，已改为 `.home-side`；其他页面新增 class 时
  需避免与 `ds.css` 全局 class 重名（`.side`、`.tile`、`.card` 等）。
