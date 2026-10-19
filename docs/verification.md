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

## 5. 界面证据（docs/evidence/）

以下截图由真实构建产物 + 受管服务（`AGENT_WORKFLOW_DATA_DIR=.tmp/run-data`，端口 5288）生成，数据为真实 SQLite +
真实 Git 仓库 + 真实模型规划：

| 文件 | 内容 |
| --- | --- |
| `home-deepseek.png` | 主页（deepseek，真实项目/任务/统计） |
| `tasks.png` | 任务列表（五段阶段胶囊、规划状态、筛选） |
| `start-task.png` | 开始任务（方法卡、项目选择） |
| `requirement-candidate.png` | 需求画布：真实模型候选（13 步/13 依赖/6 组）、检查、规划记录、用量 |
| `task-execution-running.png` | 任务画布：执行中（1 步完成、1 步运行、自动推进只读） |
| `node-execution-detail.png` | 节点执行现场：事实条 + 模型正文实时记录 + 工具记录 |
| `git-workbench.png` | Git 工作台：真实提交列表/详情/diff |
| `task-warm-1440.png` / `task-spdb-1440.png` / `task-github-white-1440.png` | 同一任务画布其余三主题 |
| `task-warm-1024.png` | 1024 宽度响应式（侧栏收成图标） |
| `settings.png` / `inbox.png` | 设置 / 待处理中心 |
| `electron-task-warm.png` | 真实 Electron 产物（bundled server）+ warm 主题的任务画布 |
| `electron-requirements-spdb.png` | 真实 Electron + SPDB 主题的需求目录 |
| `electron-selfhosted-home.png` | 无预启服务时 Electron 自行拉起 bundled server（GitHub White、空项目冷启动） |

截图获取方式：`node scripts/build-*` 后启动 `.build/server/main.mjs`，再以 Electron offscreen
`capturePage()` 加载 `http://127.0.0.1:5288/<route>?theme=<theme>`。

## 6. Electron 生产链路

```sh
npm run build   # typecheck + mcp + web + server + desktop
ELECTRON_RUN_AS_NODE= AGENT_WORKFLOW_PORT=5288 node_modules/.bin/electron .build/desktop/main.mjs
```

结果：应用启动后若本地服务未运行，主进程用 `.build/server/main.mjs` 拉起受管服务（Electron RUN_AS_NODE），
等待 `/api/health` 后加载本地 Web；截图见 `electron-selfhosted-home.png`。退出时子进程收到 SIGTERM 并正常关闭。

## 7. 已知限制 / 未验证

- 未在本机验证真实 MySQL 查询（需要 `opencode-workflow-java-test` 的本地凭据，环境未注入）；
  只读守卫与错误映射已用 fake driver 覆盖。
- GitHub/GitLab 远端写（fetch/push 凭据注入、MR 创建）未端到端验证；GitLab token 设置页待接线。
- 非 Git 目录副本与三方应用预览未实现；工作区清理确认仅基础实现。
- Electron 打包分发（签名、跨平台）未验证；`desktop` 构建脚本与主进程已可启动。
- 页面视觉与设计稿的最终对照（截图）与浏览器自动化回归待补（见 `docs/remaining-work.md`）。
