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

结果（最近一次完整验证：2026-10-19，日志 `.tmp/wave3b-verify.log`）：**360 tests / 54 suites / 349 pass / 11 skipped / 0 fail**，约 55.1s。数字以最近一次 `npm test` 日志为准，不在本文档固定历史计数。

跳过项（共 11）：10 个 `live:` gate（planning / execution / AI review / AI fix / GitHub 写入 / GitHub 只读 / knowledge / provider gateway / PPT / MySQL，需 `AGENT_WORKFLOW_LIVE=1` 或真实凭据）＋ 1 个 MySQL 探测（无可达实例或未提供账号时 skip）。其余测试全部执行。

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
| server/roles-history | 发布快照（≤20）：读取/恢复为草稿；未知快照或角色 404 |
| server/roles | 职业草稿/发布/归档：修订递增、有效目录热更新、内置可还原、自定义草稿可见 |
| server/ppt | 草稿 CRUD/大纲编辑/文本+图片附件/四主题 PPTX/Markdown 导出；真实模型大纲与逐页（live PASS） |
| server/templates | 固定模板详情/导出；自定义模板导入/可视化编辑新版本（旧任务冻结旧版本）/归档；按模板生成计划/历史 |
| server/settings | 断连轮询间隔持久化/校验、模型档案启停、工具集启停（非空/合法校验）、数据库概览跳转；任务页轮询使用该设置 |
| mcp/runtime | 工具集过滤：只注入启用前缀的工具；空/未知工具集回退默认；设置经 AGENT_WORKFLOW_TOOLSETS 注入 |
| server/session-limit | 并发 runSession 达到 opencode.maxSessions 即拒绝并返回 OPENCODE_SESSION_LIMIT(429)；状态口暴露 sessions/maxSessions；告警阈值可配置并驱动运行状态告警 |
| server/acceptance | 人工验收结论 accepted/rejected + 备注，可覆盖重录，requestKey 回执；未知任务 404 |
| server/insights | 计数与用量；逐任务规划 tokens、节点通过/失败、审查次数/待处理问题 |
| server/insights-old | 真实 SQLite 聚合：任务/规划/执行/尝试/审查/待处理 finding/修复/交付计数；规划成本从 usage_json 累计，未知预算轮次单独计数 |
| server/skills-source | 读取单个 SKILL.md 带行号源文（≤2000 行），未知 id 404 |
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
问答结果含 usage tokens 与会话 id 写入本机历史；同一会话后续问题带最近 3 条问答作上下文。live PASS 约 24 秒：首问 + 追问同一 conversationId、历史 2 条、usage>0。

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

### 3.10 真实 GitHub 远端写（PASS，2026-10-19）

`AGENT_WORKFLOW_LIVE=1` + `GITHUB_TEST_WRITE_REPO=wangyufengsky/opencode-workflow-java-test` 运行
`tests/integration/github-live-write.test.ts`（使用本机 `gh` 凭据，令牌不写入仓库/日志）：

1. 克隆测试仓库 → 从 `main` 创建一次性分支 `agent-workflow/write-test-*` 并提交测试文件；
2. `git push` 到 GitHub，`ls-remote` 确认分支存在；
3. 通过 `RemoteService.createMergeRequest` 创建 **MR #1**，`listMergeRequests('opened')` 能读到；
4. 清理：REST 关闭 MR（HTTP 200），删除远端分支；
5. 复核：MR #1 状态 `closed`，`refs/heads/agent-workflow/write-test-*` 剩余 0。

总耗时约 15s。注意：`.tmp/github-env` 中的 PAT 对 git 写为 403（读可用）；写验证使用本机 `gh` 凭据。

## 4. 构建

```sh
npm run build:mcp       # .build/mcp/server.mjs（esbuild，stdio 冒烟 13 tools）
npm run build:server    # .build/server/main.mjs
npm run build:web       # apps/web/dist（Vite）
node scripts/build-desktop.mjs  # .build/desktop/{main,preload}.mjs
```

结果：均成功。MCP 产物通过 SDK stdio 冒烟：默认工具集 13 个工具（workflow 4 / git 4 / database 1 / workspace 4，可按设置缩减）、stdout 仅 JSON-RPC、错误返回结构化 code。

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
- 启动恢复（Wave 0）：进程重启后 execution running→unknown、planning running→unknown（可 reconcile）、workspace preparing→unknown，并结算 accepted 回执；`tests/integration/startup-recovery.test.ts` PASS。
- 恢复三模式（Wave 2）：`from_failed_stage / all_stages / verify_only` 产生不同继承上下文与后续动作（`tests/integration/recovery-modes.test.ts` PASS）；`verify_only` 硬只读已在 Wave 3B 落地（migration v11 + 9 类写接口 403），W2-4c 投影/`updateDraft` 守卫待收口。
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

- Git 远端写：GitHub 真实 push → 创建 MR → 关闭/删分支已在可丢弃测试仓库 PASS（§3.10）。远端 push/MR 的不可判定结果已在 Wave 3B 结算为 UNKNOWN（分类矩阵 + 重放不重发）；`fetch` 与 fix push 仍待 W3-13。GitLab 真实实例未连接，MR 列表/创建仍为桩验证；关闭/合并/删分支产品边界（W2-8）未确认。
- AI 审查/修复的服务端结果已验证；模型自报的校验命令未由服务独立执行；`fix.merge` 已实现并由 live 修复流程验证（§3.4）。
- FixRun/ReviewRun 的启动恢复已实现：进程重启后 running/editing 进入 unknown 并结算持久化 requestKey（`tests/integration/review-fix-recovery.test.ts`）。
- 非 Git 目录副本与三方应用（预览/逐项应用/备份）已实现；目录级空目录、ACL/mtime 不做处理。工作区清理 UI 已接线，非 Git 清理真实删除受管副本/baseline/settings 键（`workspace-cleanup-nongit.test.ts` 4 pass）；storage `removeJson` 已落地（W2-14）。
- 恢复三模式真实差异已实现（`recovery-modes.test.ts`）；`verify_only` 硬只读已强制（migration v11 + 9 类写接口 403）；W2-4c（`planning.actions` 投影/`updateDraft` 守卫）与 W2-15（放弃调整恢复暂停态）仍进行中；恢复不复制执行上下文/阶段图。
- W3-12（`GET /api/tasks/:id/changes/files/:fileId/diff` 未传 headSha 时把空字符串当 revision → 500 `REVISION_NOT_FOUND`）正在 Wave 3C 修复；验收前运行内容页的文件 diff 仍按真实错误展示。
- Electron 打包：第 64 轮 `npm run dist` 的未签名 .app 可启动；签名/公证、Windows/Linux 目标、自动更新未验证，且 Wave 0–3B 后未重新打包。
- 视觉与设计稿：Wave 3A/3B 页面验收使用一次性 Electron 冒烟（W3-7c 47 项、知识历史 33 项等），未进入 `npm test`/CI；`npm run ui:smoke` 在当前沙箱仍失败，`docs/evidence/` 为 Wave 0 前旧图，无像素级视觉回归。
- 设计覆盖：`docs/design-coverage.md` 已更新到 Wave 3A/3B：25 页中 ✅ 3 / 🟡 21 / ⛔ 1（唯一整页缺失 `workflow-editor`）。`docs/api.md` 已由 ROUTES + 服务端注册生成，`check:docs-routes` 接入 `verify`。
- 节点验收（`node.accept` / `node.reject`）已在 Wave 3A 落地（审计叠加 + 回执），但验收 gating 待 W0-4b。
- 其他未完成：W3-1b（charter/docPaths/GitLab 绑定）、W3-3（角色四页签）、W3-4（知识研究体验，W3-4a 进行中）、W3-5（任务画布扩展/快照评审）、W3-6（PE37）、W3-8（工作流编辑器）、W3-9b（结构缺口）、W3-10（节点详情子视图）、W3-11（主页/品牌）、W3-7d（run/legacy 面包屑）。

## 11. 轮次日志（历史）

### 第 64 轮打包回归（2026-10-19）

- `npm run dist` 成功：`release/mac-arm64/Agent Workflow.app`（341MB，未签名）。
- 打包产物包含 `Contents/Resources/app/node_modules/pptxgenjs`（PPTX 运行时依赖）。
- 直接启动 `.app` 可执行文件时需确保 shell 未设置 `ELECTRON_RUN_AS_NODE=1`（本工具环境默认设置，会令 Electron 以 Node 模式运行而无法开窗）。
- 启动后 `/api/health` 返回 200；通过打包内 server 创建 PPT 草稿并导出 `.pptx`，55,341B、标准 ZIP 头（运行时 `pptxgenjs` 在打包环境中可用）。

### 第 77 轮 UI 截图冒烟（2026-10-19）

`npm run ui:smoke`（即 `env -u ELECTRON_RUN_AS_NODE electron scripts/capture-ui.cjs`）：以真实服务（隔离数据目录 + 演示 Git 仓库）渲染、断言并截图 10 个路由：
`/`、`/tasks`、`/requirement/:id`、`/tasks/:id`、`/start`、`/git`、`/settings` 以及 3 个非默认主题首页。
断言每个页面的期望文案非空且存在，并校验主题 `data-theme`；全部通过；
- **抽屉连续输入回归（第 82 轮）**：`Drawer` 的 focus 副作用不再依赖内联 `onClose`，父组件每输入一个字符重渲染时不会重新聚焦抽屉根节点。UI smoke 新增：数据库「添加连接」抽屉输入 `aaaaa`，断言值与 `document.activeElement` 保持 `#db-name`，PASS。
`evidence/ui-git.png`、`ui-requirement-canvas.png`、`ui-settings.png`、`ui-task-canvas.png` 已更新为当前实现。

### 第 83 轮数据库连接输入修复（2026-10-19）

- 数据库表单支持粘贴 JDBC URL 并自动拆分（也接受 Spring `${WF_DB_URL:...}` 默认值写法和 `url:` 前缀）：
  `jdbc:mysql://127.0.0.1:3306/opencode_workflow_test?connectionTimeZone=UTC&...`
  → 类型 mysql / 主机 127.0.0.1 / 端口 3306 / 库 opencode_workflow_test。
- 用用户提供的本地 MySQL 凭据复测：服务端 `POST /settings/databases` 保存 + `POST /probe` 返回 `connected`（MySQL 9.2.0，目标库存在）；密码不写入文档。
- 抽屉 focus 修复后，UI smoke 验证连续输入 `aaaaa` 焦点不丢，且粘贴 JDBC URL 后四个字段被正确拆分。

### 第 84 轮设置页模型/OpenCode 配置（2026-10-19）

- 「模型与执行」不再只读：职责模型下拉（规划/开发/审查/修复）会重分配 `roles` 并保存；支持新增/编辑模型档案（provider/model/角色/启停）；禁止停用最后一个启用模型；模型字段与角色由 `validateSettings` 校验（PATCH 非法 400）。
- 同页可直接配置：OpenCode 可执行文件路径（保存后重启生效）、启用受管运行时、自动启动、权限模式、Agent、重启按钮；完整检测/日志仍在「服务」分区。
- UI smoke 新增 `/settings?section=model` 断言（职责模型/添加模型/OpenCode 可执行文件），截图 `evidence/ui-settings-model.png`。
- 服务端测试：自定义模型写入、全部停用 400、非法角色 400。

### 第 85 轮 OpenCode 未启用状态（2026-10-19）

- `/api/opencode/status` 新增 `managed`（本次进程是否加载了受管适配器）与 `enabled`（保存的设置）。
- 服务页在 `managed=false` 时显示明确原因：“受管 OpenCode 未启用（opencode.enabled=false 或启动环境 AGENT_WORKFLOW_DISABLE_OPENCODE=1），请启用后重启 Agent Workflow 服务”，不再把重启的 NOT_CONFIGURED 误报成“本地后端未连接”。
- 重启按钮在未加载适配器时禁用；重启错误直接显示服务返回文案。
- 测试：disabledOpenCode 应用 status 返回 stopped/managed=false/enabled=true/MCP 未连接 0 工具。

### 第 86 轮整栈重启与并发会话计数（2026-10-19）

- 停止旧 5177/5173 开发进程（旧 5177 运行时带 `AGENT_WORKFLOW_DISABLE_OPENCODE=1`、数据目录 `.tmp/view-data`）。
- 以 `AGENT_WORKFLOW_DATA_DIR=.tmp/view-data AGENT_WORKFLOW_PORT=5177 npm run dev` 重启：health 200；OpenCode 状态 `ready`（1.19.0，managed/enabled=true）；MCP `agent-workflow` 已连接 **13 个工具**。
- 修复并发会话误报：`/api/opencode/status` 的 `sessions` 改为受管运行中的活动会话数（强制上限使用同一计数），新增 `totalSessions` 表示 OpenCode 历史会话总数；当前 `sessions=0/8`、`totalSessions=46`，历史会话不再触发“已达上限”。
- Vite 开发地址 `http://127.0.0.1:5173`，服务地址 `http://127.0.0.1:5177`。

### 第 87 轮一键重启部署（2026-10-19）

- 新增 `npm run dev:restart`：停止 5177/5173 旧监听 → `build:web` → 以分离进程启动 `npm run dev`（日志 `.tmp/dev.log`）→ 等待 health 与 OpenCode `ready`，打印 MCP 工具数/会话数。
- 支持 `AGENT_WORKFLOW_DATA_DIR`、`AGENT_WORKFLOW_PORT`、`AGENT_WORKFLOW_WEB_PORT` 覆盖；自动移除 `AGENT_WORKFLOW_DISABLE_OPENCODE`。
- 实测：`.tmp/view-data` 数据保留（1 项目/2 任务），OpenCode 1.19.0 ready、MCP 13 工具、活动会话 0/8、历史会话 46 不计入。

### 第 88 轮项目文件夹选择器（2026-10-19）

- 项目登记不再要求手输绝对路径：「项目目录」旁新增「选择文件夹…」。
  - 桌面版：走 Electron preload 的 `workflowDesktop.pickDirectory()` 原生目录对话框。
  - 浏览器版（Chrome/5177）：打开服务端只读目录浏览器（`GET /api/fs/directories`），支持上一级/主目录/刷新、Git 仓库标记、进入目录后「选择此文件夹」。
- 目录接口只列出目录名与 `.git` 标记，不读取文件内容；要求绝对路径，未知目录 404，相对路径 400。
- 选择后自动回填绝对路径，并在名称为空时用目录 basename 填充项目名。
- 验证：集成测试目录列表/Git 标记/404/400；UI smoke 打开登记抽屉 → 文件夹选择器（首页 101 个目录）→ 关闭，PASS。

### 第 89 轮长耗时模型请求超时（2026-10-19）

- 原因：Web API 客户端默认超时 12s；知识库问答是同步模型调用（常见 15–90s），浏览器先超时并显示「本地服务响应超时」。
- 修复：知识库问答请求超时 130s；PPT 大纲 120s、PPT 逐页 150s；问答中提示“模型正在阅读文档，通常 15–90 秒”。
- 实测（运行中的服务）：知识库问答 **11s** 返回答案、4 条校验引用、usage 24119 tokens；OpenCode ready、MCP 13 工具。

### Wave 0 + Wave 1 验收（2026-10-19；历史计数 330 tests，当前 360 见下）

依据 [`docs/review/execution-log.md`](review/execution-log.md) 20:32 整合记录；验收范围 W0-1、W0-2、W0-3、W0-5、W1-1~W1-12（15 个工作包），W0-4 节点验收仍 pending。

- **类型检查**：`npx tsc -p tsconfig.json --noEmit` → exit 0。
- **全量测试**：`npm test` → **330 tests / 54 suites / 319 pass / 11 skipped / 0 fail**（43.8s；日志 `.tmp/final-verify.log`）。新增 `tests/integration/api-contract.test.ts`、`routes-contract.test.ts`、`startup-recovery.test.ts`。
- **构建**：`npm run build:web` exit 0；`npm run build:server` exit 0。
- **API/回执**：未知 `GET /api/not-a-real-route` 与 3 条未实现 ROUTES 返回 JSON 404；缺 `requestKey` 的 `POST /api/tasks` → 400 `VALIDATION_FAILED`；`POST /api/opencode/restart`（`confirmRestart=true`）→ 200 + `succeeded` 回执，`GET /api/operations/:key` 可核对；`GET /api/bootstrap` 的 `database.connected` 来自真实探测；`GET /api/git/repos/:id/fetch` 签发 accepted 回执（真实 GitHub 网络超时场景按 by-key 显示 accepted/stillUnknown；本地 bare remote 成功路径由集成测试覆盖）。
- **契约快照**：`ROUTES` ↔ 服务端注册路径对比通过；本波显式例外为 `plan/edit/abandon`（W2-2）、`execution/advance`（W2-1）、单个 MR 详情（待定）；OpenCode 内部网关 `/api/opencode/gateway/:secret/v1/*` 为服务端独有、不进 ROUTES。**Wave 2 后前两条已实现并从例外表移除，只剩单个 MR 详情。**
- **启动恢复**：running execution / running planning / preparing workspace 在重启后进入 unknown 并结算回执；安静启动为 no-op；`startup-recovery.test.ts` 5 条用例 PASS。
- **前端**：PPT 页完整闭环（作品/附件/生成/编辑/导出/删除）、模板可视化 + JSON 编辑器与归档、工作区清理 UI、陈旧文案清理、`/start` 深链、ErrorBoundary；`npm run build:web` 通过。
- **未计为通过**：`npm run ui:smoke` 在当前沙箱因 Electron GPU/sandbox 初始化失败（`GPU process isn't usable`）未执行成功，UI 验证顺延到桌面环境/Wave 4；`docs/evidence/` 截图早于 Wave 0/1。

### Wave 2 验收（2026-10-19；历史计数 345 tests）

依据 [`docs/review/execution-log.md`](review/execution-log.md) 20:45 整合记录；验收范围 W2-1、W2-2、W2-3、W2-4、W2-9、W2-10、W2-11、W2-13（8 个工作包），W3-7a 知识历史页与 W4-1a 文档同步也已完成。

- **类型检查**：`npx tsc -p tsconfig.json --noEmit` → exit 0。
- **全量测试**：`npm test` → **345 tests / 54 suites / 334 pass / 11 skipped / 0 fail**（46.6s；日志 `.tmp/wave2-verify.log`）。新增 `tests/integration/execution-control.test.ts`（5 pass）、`workspace-cleanup-nongit.test.ts`（4 pass）、`recovery-modes.test.ts`、`ppt-startup-recovery.test.ts`。
- **构建**：`npm run build:web` exit 0；`npm run build:server` exit 0。
- **执行控制**：`POST /api/tasks/:id/execution/auto-advance`、`/execution/advance`、`/plan/edit/abandon` 已注册；自动推进开关/整体推进/推进直接后继/放弃调整均有回执与幂等/冲突测试；契约例外表移除 `plan/edit/abandon` 与 `execution/advance`。
- **清理与恢复**：非 Git 清理真实删除受管副本 + baseline + settings 键，越界路径拒绝、可重试、失败保留可重试状态；恢复三模式真实差异；启动恢复把进程中断的 PPT `generating` 作品标记 unknown 并结算回执。
- **知识历史**：`/knowledge/history` 可用；服务端无会话状态字段处按「全部/有引用/无引用」降级并在页面明示，不显示虚构状态（W3-7a 33 项 UI 断言）。
- **运行态**：未知任务返回 404 JSON，缺 `requestKey` 返回 400 `VALIDATION_FAILED`；未知任务三视图 404 与正常任务 18 个能力键回归通过（W2-13）；静态路径边界与 legacy DELETE 数据库回执通过（W2-9）。
- **UI**：自动推进开关/整体推进/推进直接后继、放弃调整 Modal、恢复页 unknown 三入口、知识历史页已接线；UI smoke 仍受沙箱 Electron GPU 限制，未计通过。
- **顺延 follow-up**：W2-4b（verify_only 硬只读）、W2-12（远端超时 UNKNOWN）、W2-14（storage removeJson）、W2-15（abandon 恢复暂停态）、W3-5a（节点面板推进入口）。
- **后续**：W0-4 节点验收、W3-1a 项目详情、W3-7b PPT 作品/工作台、W3-9a 任务列表/开始页已在 Wave 3A 完成（见下）；UI 冒烟仍待桌面环境复跑。
- **顺延缺口**：W0-4（节点验收，已在 Wave 3A 实现；gating 待 W0-4b）；W2-10 / W2-11 / W2-13 已在 Wave 2 完成。

### Wave 3A 验收（2026-10-19；历史计数 348 tests）

依据 [`docs/review/execution-log.md`](review/execution-log.md) 21:06 整合记录；验收范围：W0-4 节点验收（后端 + UI）、W3-5a 节点推进入口、W3-1a 项目详情、W3-7b PPT 作品/工作台、W3-9a 任务列表/开始页、W4-1b 文档同步 + design-coverage 重写。

- **类型检查**：`npx tsc -p tsconfig.json --noEmit` → exit 0。
- **全量测试**：`npm test` → **348 tests / 54 suites / 337 pass / 11 skipped / 0 fail**（51.2s；日志 `.tmp/wave3a-verify.log`）。
- **构建**：`npm run build:web` exit 0；`npm run build:server` exit 0。
- **运行态（5177）**：`POST /api/tasks/:id/nodes/:nodeId/accept` 缺 requestKey → 400；未知任务 reject → 404 JSON；`/projects/:id` 与 `/knowledge/history` SPA 路由 200 HTML。
- **功能证据**：节点验收契约（accepted/rejected 审计叠加、actions/reasonCode、requestKey 幂等/冲突，3 个集成测试）；项目详情四页签（charter 明确「服务未提供」，不造假）；PPT 作品库/四步工作台；任务列表行菜单/聚合进度；开始任务三段卡/回执；节点面板「推进直接后继」（W3-5a）。
- **UI**：页面验收使用一次性 Electron 冒烟（未进入 `npm test`/CI）；`docs/evidence/` 未更新。
- **新登记 follow-up**：W0-4b（验收 gating）、W3-1b（charter/docPaths/GitLab 项目绑定）、W3-7c（run/roles-legacy）、W3-9b（结构缺口）、W3-11（主页/品牌）。

### Wave 3B 验收（2026-10-19，360 tests）

依据 [`docs/review/execution-log.md`](review/execution-log.md) 21:06 整合记录；验收范围：W3-2 Inbox interactions 后端 + 前端、W3-7c run/roles-legacy、W2-4b/W2-12/W2-14 后端加固、W4-2 API 文档与路由校验。

- **类型检查**：`npx tsc -p tsconfig.json --noEmit` → exit 0。
- **全量测试**：`npm test` → **360 tests / 54 suites / 349 pass / 11 skipped / 0 fail**（55.1s；日志 `.tmp/wave3b-verify.log`）。
- **构建与契约**：`npm run build:web` exit 0；`npm run build:server` exit 0；`npm run check:docs-routes` exit 0（`docs/api.md` 与 ROUTES + 服务端注册一致）。
- **运行态（5177）**：`GET /api/interactions` 返回真实空列表 + 诚实 capabilities（permissions/policy=false + reason）；`/runs/:taskId`、`/roles/legacy` SPA 路由 200；节点验收/项目详情/知识历史路由可用。
- **功能证据**：Inbox interactions 3 个集成测试（free_text 降级、权限/策略诚实降级、requestKey 回执）；`verify_only` 只读强制（9 类写接口 403 + migration v11）；远端超时 → UNKNOWN（分类矩阵/重放不重发）；storage `removeJson`；运行内容页（47 项 UI 断言：真实任务/节点输出/需求覆盖/变更文件）；历史角色配置页（真实目录/历史/快照 diff，能力/权限/形象明确未提供）；`docs/api.md` 147 条唯一路由生成并由脚本校验。
- **发现缺陷**：`GET /api/tasks/:id/changes/files/:fileId/diff` 未传 headSha 时空字符串被当作 revision → 500 `REVISION_NOT_FOUND`（新登记 W3-12）；运行内容页按真实错误展示，未伪造 diff。
- **UI**：一次性 Electron 冒烟（W3-7c 47 项等）未进入 `npm test`/CI；`npm run ui:smoke` 在当前沙箱仍失败。
- **新登记 follow-up**：W2-4c（readOnly 投影/updateDraft）、W2-15（abandon 恢复暂停态）、W3-12（diff bug）、W3-13（fetch/fix push UNKNOWN）、W3-7d（run/legacy 面包屑）。
