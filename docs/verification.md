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

结果（本轮）：**309 tests / 54 suites / 299 pass / 10 skipped / 0 fail**，约 24s。

跳过项：需要真实模型 / 真实 MySQL / GitHub 令牌的 gated 场景（见 §3），以及无凭据时的 MySQL 探测。

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
| server/concurrency | 两个任务并发准备独立 worktree，分支/目录不同；互不污染、main 不变；清理后无残留分支 |
| server/review | review/fix 服务与 15 条 HTTP 路由、findings 校验丢弃、CAS、worktree 隔离、revert/commit/discard |
| server/remote | GitHub token 加密/连接/MR 读取/令牌不泄漏；fetch 更新本地远端引用；非 Git 目录副本 |
| server/apply | 非 Git 三方预览 → 冻结 → 逐项应用：真实 prepare baseline、无冲突写入、冲突处理、备份、漂移拒绝、路径逃逸 |
| server/push-mr | 本地 bare 远端 push 创建/非快进拒绝；GitHub/GitLab REST 创建 MR（stub）→ delivered/lifecycle completed |
| server/recovery | 进程重启后 running review / editing fix → unknown + 回执结算；requestKey 保留 |
| server/recovery-api | 恢复派生草稿：原任务保持、requestKey 幂等、历史列表、无失败态拒绝 |
| server/roles | 职业草稿/发布/归档：修订递增、有效目录热更新、内置可还原、自定义草稿可见 |
| server/ppt | 草稿 CRUD/大纲编辑/文本附件/Markdown+PPTX 导出；真实模型生成大纲与逐页（live PASS） |
| server/templates | 固定模板详情/导出；自定义模板导入/更新版本（旧任务仍冻结旧版本）/归档；按模板生成计划/历史 |
| server/settings | 断连轮询间隔持久化/校验、模型档案启停、工具集启停（非空/合法校验）、数据库概览跳转；任务页轮询使用该设置 |
| mcp/runtime | 工具集过滤：只注入启用前缀的工具；空/未知工具集回退默认；设置经 AGENT_WORKFLOW_TOOLSETS 注入 |
| server/session-limit | 并发 runSession 达到 opencode.maxSessions 即拒绝并返回 OPENCODE_SESSION_LIMIT(429)；状态口暴露 sessions/maxSessions；告警阈值可配置并驱动运行状态告警 |
| server/insights | 计数；规划成本/token、执行/审查/修复用量；逐任务规划 tokens；逐任务审查次数/待处理问题 |
| server/insights-old | 真实 SQLite 聚合：任务/规划/执行/尝试/审查/待处理 finding/修复/交付计数；规划成本从 usage_json 累计，未知预算轮次单独计数 |
| server/skills | 只读扫描 ~/.claude/skills 与 ~/.agents/skills 的 SKILL.md 元数据；可配置扫描目录；不安装/不执行 |
| server/projects | 名称/说明/项目级设置编辑；同目录重复登记幂等；重新检测路径/Git 状态并落库；归档/恢复 |
| server/plan-edit | 执行中调整计划：标题/验收/前置依赖（order 边）；自依赖、缺失节点、已领取依赖与环路被拒绝 |
| server/knowledge | 只读来源清单/搜索/正文；文档问答返回 answer + 校验引用；问答历史本机保存（最多 30 条） |
| server/logs | 受管 OpenCode 日志尾部读取（≤500 行/2KB 行截断）并对 PAT/Bearer/密码形态脱敏 |
| server/database-delete | 删除数据库连接：关闭连接池、设置移除、二次删除 404；同主机/端口/库重复登记 409；不触碰真实数据库 |
| server/opencode-detect | PATH / ~/.opencode/versions 扫描、候选 --version 探测、当前 binary 标记；不改设置 |
| server/node-skip | 跳过节点及全部下游 → cancelled；上游/无关节点不变；回执与操作登记 |
| server/cleanup | 清理预览对执行中/规划中/交付中/工作区忙给出 blockers；确认拒绝 blockers 与过期预览；清理后状态 cleaned |

## 2.5 最近一次模型冒烟（第 27 轮）

`npm run test:model` PASS：受管 OpenCode **1.19.0** 启动成功（临时端口 59871），内部 MCP `agent-workflow: connected`，
flash 模型经兼容网关返回文本 `OK`。验证发生在工具集过滤、会话上限、洞察统计等改动之后。

## 2.6 知识库问答（真实模型，PASS）

`AGENT_WORKFLOW_LIVE=1 tests/integration/knowledge-ask-live.test.ts`：基于项目 README/docs 提问“交付流程/清理前要做什么”，
flash 模型返回答案并给出 `README.md:3`、`README.md:4` 两条引用（服务端校验路径与行号），**PASS 31s**。
问答结果含 usage tokens 与会话 id 写入本机历史；同一会话后续问题带最近 3 条问答作上下文。live PASS 24s：首问 + 追问同一 conversationId、历史 2 条、usage>0。

## 2.7 PPT 大纲生成（真实模型，PASS）

`AGENT_WORKFLOW_LIVE=1 tests/integration/ppt-live.test.ts`：草稿“季度汇报/交付质量计划” → flash 模型生成 12 页大纲，
再生成逐页标题+要点（每页 2–6 条）并落库，usage tokens>0，列表读取一致，**PASS 29s**。PPTX 文件导出已验证（真实 zip，生产 server 冒烟 55KB）；逐页高级视觉仍为基础版式。

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

结果（PASS，52s）：使用单写节点的确定性计划（确认 → 准备真实 worktree → 开始执行）；模型通过
`workspace.file.*` 修改 `README.md`，调用 `workflow.result.submit` 提交结果；节点 succeeded、attempt 有结果；
`GET /changes` 返回 `README.md`；随后取消执行。

### 3.3 AI 审查（真实模型，PASS）

```sh
AGENT_WORKFLOW_LIVE=1 node --import tsx --test --test-force-exit tests/integration/review-fix-live.test.ts
```

结果（PASS，208s）：真实仓库提交 → 模型（flash，经兼容网关）输出严格 JSON findings → 服务端按 diff 校验
位置/枚举后结算 completed，回执已结算；非法 findings 被丢弃并计数。

### 3.4 AI 修复（真实模型，PASS）

```sh
AGENT_WORKFLOW_LIVE=1 node --import tsx --test --test-force-exit tests/integration/fix-live.test.ts
```

结果（PASS，25s）：构造真实 finding → 在 `ai-fix/*` 隔离 worktree 内用 MCP 文件工具修复 →
outcome=fixed(exact)、`app.ts` 为唯一变更 → `fixes/:id/commit` 成功 → `fixes/:id/merge` 在真实仓库把修复分支
合并回 main（verify merge commit 出现在 main 历史）→ discard 清理 worktree、本地分支与 `fix.worktree.<id>` 映射；
用户工作区未被触碰。真实 live 36s PASS。

### 3.5 真实 MySQL（PASS）

凭据来自 `opencode-workflow-java-test/src/main/resources/application.yml`，通过环境变量注入（不入库）：

```sh
export WF_DB_URL='jdbc:mysql://127.0.0.1:3306/opencode_workflow_test?...'
export WF_DB_USER='<user>' WF_DB_PASSWORD='<password>'
node --import tsx --test --test-force-exit tests/integration/database-live.test.ts
```

结果（PASS）：MySQL 9.2.0，probe connected（~50ms），`SHOW TABLES` 返回 3 张 `wf_test_*` 表，
`SELECT COUNT(*) FROM wf_test_project` 成功；`DELETE` 与多语句注入返回 `DATABASE_QUERY_BLOCKED`；响应不含密码。

### 3.6 GitHub 只读联调（PASS）

```sh
export GITHUB_TEST_TOKEN='<pat>'
node --import tsx --test --test-force-exit tests/integration/github-live.test.ts
```

结果（PASS）：PAT 加密保存后连接为 `wangyufengsky`，读取到 9 个 open MR；`/api/bootstrap` 与仓库视图显示
connected；响应中不包含令牌。未执行任何写操作（push / 创建 MR / 合并）以避免修改真实仓库。

GitLab 适配用本地桩服务覆盖：`tests/integration/gitlab-mr.test.ts` 校验 PRIVATE-TOKEN、`/projects/:id/merge_requests`
列表与创建、交付结算 delivered。真实 GitLab 实例未连接。

### 3.7 flash + 兼容网关（PASS）

```sh
AGENT_WORKFLOW_LIVE=1 node --import tsx --test --test-force-exit tests/integration/planning-gateway-live.test.ts
```

结果（PASS，30s）：flash 模型经网关 4 次请求、4 次归一化（去掉 tool_choice）→ MCP `workflow.plan.submit`
候选通过。默认规划/开发/修复模型为 flash，审查可配置为 v4-pro。

### 3.8 非 Git 目录应用（离线 PASS）

```sh
node --import tsx --test --test-force-exit tests/integration/directory-apply-e2e.test.ts
```

结果（PASS）：真实 `workspace/prepare` 生成独立目录副本与 baseline 快照 → 修改副本 → preview（只读、2 项可应用）
→ apply → 原目录写入、delivery=delivered、task lifecycle=completed；UI 证据
[task-delivery-apply-preview.png](evidence/task-delivery-apply-preview.png)。

### 3.9 模型冒烟

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

## 7. 任务恢复（PASS）

`POST /api/tasks/:id/recovery` + `GET /api/tasks/:id/recoveries`：
- 仅对失败/受阻/已取消任务创建派生草稿；原任务、执行证据与交付记录不变。
- `from_failed_stage / all_stages / verify_only` 三种方式，草稿为 `draft` 阶段，不自动规划/执行。
- requestKey 幂等（重放返回同一草稿）、回执结算、操作表登记 `task.recovery.create`。
- UI 恢复工作台已接线：真实任务摘要、方式选择、创建后跳转需求画布、派生草稿历史；失败执行可直接
  「按原配置重试失败步骤」（新 attempt，保留成功步骤）/「继续执行」/「停止执行（保留工作区）」。
- `POST /api/tasks/:id/execution/retry` 已实现并登记 `execution.retry`。
测试：`tests/integration/recovery-api.test.ts` PASS。

## 8. 角色目录编辑（PASS）

`GET/POST /api/catalog/roles`、`POST /api/catalog/roles/:id/{publish,archive}`：
- 内置职业可保存草稿（不改线上角色），发布后修订 `rN→rN+1` 并热更新引擎有效目录（审查/修复职业解析立即使用新修订）。
- 自定义职业先以草稿存在，发布后进入目录；归档内置覆盖会还原默认，归档自定义会移除。
- 每个写操作 requestKey + 回执、幂等重放；目录变更发 `catalog.changed` 事件。
- UI 角色页已接线：新建/编辑草稿、发布、还原/归档、草稿徽标。
- UI 证据：[roles-editor.png](evidence/roles-editor.png)（真实服务数据：内置职业草稿待发布）。
测试：`tests/integration/roles-api.test.ts` PASS。

## 9. 质量与用量页（真实计数）

- UI 证据：[insights-real-counters.png](evidence/insights-real-counters.png)（真实服务：3 个任务、规划成本 0、执行/审查/修复/交付为 0）。
- 顶部 tokens 仍显示未知；规划成本来自 `planning_rounds.usage_json`。

## 10. 已知限制 / 未验证

- Git 远端写：fetch 用本地远端验证；MR 创建用 GitHub/GitLab 桩服务验证；真实 GitHub push / 创建 MR / 直接合并
  未执行（避免修改真实仓库），真实 GitLab 未连接。
- AI 审查/修复的服务端结果已验证；模型自报的校验命令未由服务独立执行；`fix.merge` 未实现。
- FixRun 的 start/stop requestKey 只存在内存，进程重启后的恢复仍需补（ReviewRun 可从 receipt 恢复）。
- 非 Git 目录副本与三方应用（预览/逐项应用/备份）已实现；目录级空目录、ACL/mtime 不做处理。工作区清理确认仅基础实现。
- Electron 打包分发（签名、跨平台）未验证；`desktop` 构建脚本与主进程已可启动。
- 页面视觉与设计稿的最终对照（截图）与浏览器自动化回归待补（见 `docs/remaining-work.md`）。

### 第 64 轮打包回归（2026-10-19）

- `npm run dist` 成功：`release/mac-arm64/Agent Workflow.app`（341MB，未签名）。
- 打包产物包含 `Contents/Resources/app/node_modules/pptxgenjs`（PPTX 运行时依赖）。
- 直接启动 `.app` 可执行文件时需确保 shell 未设置 `ELECTRON_RUN_AS_NODE=1`（本工具环境默认设置，会令 Electron 以 Node 模式运行而无法开窗）。
- 启动后 `/api/health` 返回 200；通过打包内 server 创建 PPT 草稿并导出 `.pptx`，55,341B、标准 ZIP 头（运行时 `pptxgenjs` 在打包环境中可用）。
