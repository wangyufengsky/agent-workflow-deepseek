# 验证记录

日期：2026-10-19（Asia/Shanghai）。命令在仓库根目录执行。

## 1. 类型检查

```sh
npx tsc -p tsconfig.json --noEmit
```

结果：exit 0，0 errors（shared/storage/engine/git/database/mcp/opencode/server/web/desktop）。

## 2. 离线测试

```sh
npm test        # scripts/test.mjs → node --test --test-force-exit
```

结果（本轮）：**238 tests / 54 suites / 235 pass / 3 skipped / 0 fail**，约 30s。

跳过项：`live:` 两个模型端到端（需 `AGENT_WORKFLOW_LIVE=1`）与真实 MySQL 探测（无凭据时 skip）。

覆盖模块（摘要）：

| 模块 | 覆盖 |
| --- | --- |
| shared | 12 组状态机合法/非法迁移、规划图校验（V1–V8、环、缺失步骤、写冲突） |
| storage | 项目/任务/计划/轮次/记录/工作区/操作/密钥、JSONL 事件日志、迁移幂等与重开 |
| engine | `methodToGraph`/`candidateToGraph`/`diffGraphs`、候选校验 |
| git | 100 项：状态/log/commit/diff/branches/worktree、注入拒绝、REST stub、脱敏 |
| database | 只读守卫注入、错误映射、连接池/超时 |
| mcp | 工具注册、错误信封、路径逃逸、写权限、exec 白名单、fake 内部服务 |
| server | 项目→任务→骨架→确认→真实 worktree 准备、requestKey 幂等/冲突、内部 MCP 鉴权 |
| server/git | `/api/git/*` 读口；任务分支合并成功、STALE_TARGET、冲突中止且目标分支不变 |

## 3. 模型端到端（真实 opencode-go，用户已授权）

### 3.1 受管 OpenCode + MCP 注入

```sh
AGENT_WORKFLOW_LIVE=1 node --import tsx --test --test-force-exit tests/integration/planning-live.test.ts
```

结果（PASS，81s）：受管 OpenCode 1.19.0 启动（随机端口 + Basic 密码），`/mcp` 显示
`agent-workflow: connected`；模型（`opencode-go/deepseek-v4-pro`）调用 MCP
`workflow.plan.submit` 提交候选；确定性校验 0 problems；`apply → confirm → workspace/prepare`
成功；workspace 状态 ready，真实 Git worktree 与 `task/...` 分支创建成功。

### 3.2 执行：模型通过 MCP 修改 worktree 并提交结果

```sh
AGENT_WORKFLOW_LIVE=1 node --import tsx --test --test-force-exit tests/integration/execution-live.test.ts
```

结果（PASS，42s）：确认计划 + 准备 worktree 后开始执行；模型通过 `workspace.file.*` 修改
`README.md`，调用 `workflow.result.submit` 提交结果；节点 succeeded、attempt 有结果；
`GET /changes` 返回 `README.md`；随后取消执行。

### 3.3 模型冒烟

```sh
npm run test:model
```

结果（PASS）：受管服务 ready，MCP connected，模型返回非空文本。

## 4. 构建

```sh
npm run build:mcp       # .build/mcp/server.mjs（esbuild，stdio 冒烟 13 tools）
npm run build:server    # .build/server/main.mjs
npm run build:web       # apps/web/dist（Vite）
node scripts/build-desktop.mjs  # .build/desktop/{main,preload}.mjs
```

结果：均成功。MCP 产物通过 SDK stdio 冒烟：13 个工具、stdout 仅 JSON-RPC、错误返回结构化 code。

## 5. 已知限制 / 未验证

- 未在本机验证真实 MySQL 查询（需要 `opencode-workflow-java-test` 的本地凭据，环境未注入）；
  只读守卫与错误映射已用 fake driver 覆盖。
- GitHub/GitLab 远端写（fetch/push 凭据注入、MR 创建）未端到端验证；GitLab token 设置页待接线。
- 非 Git 目录副本与三方应用预览未实现；工作区清理确认仅基础实现。
- Electron 打包分发（签名、跨平台）未验证；`desktop` 构建脚本与主进程已可启动。
- 页面视觉与设计稿的最终对照（截图）与浏览器自动化回归待补（见 `docs/remaining-work.md`）。
