# Agent Workflow

需求 → AI 规划 → 可确认计划 → 多角色执行 → 节点验收 → 交付/合并 的桌面工作台。设计稿来自
`opencode-workflow-design-showcase/`（只读权威），本项目是其产品化实现。

## 技术栈与架构

| 层 | 目录 | 说明 |
| --- | --- | --- |
| 桌面 | `apps/desktop` | Electron 44（内置 Node 24），主进程托管本地服务与最小宿主 IPC |
| 前端 | `apps/web` | React 19 + TypeScript + Vite 7，`@xyflow/react` 流程画布，四主题配置化 |
| 服务 | `packages/server` | Fastify HTTP + SSE，应用操作（读口/命令）与内部 MCP 回环 |
| 领域 | `packages/engine` | 任务/规划/计划/执行/工作区/交付服务，状态机权威 |
| 契约 | `packages/shared` | 枚举、常量、状态机、领域模型、API DTO、配置、主题令牌 |
| 存储 | `packages/storage` | SQLite（`node:sqlite`，WAL）+ JSONL 追加日志 + 本地 AES-GCM 密钥 |
| Git | `packages/git` | 本机 Git CLI 读模型、worktree 管理、GitHub/GitLab REST 适配 |
| 数据库 | `packages/database` | mysql2 连接池、PostgreSQL（pg）驱动、探针、严格只读查询 |
| MCP | `packages/mcp` | 内部 stdio MCP 服务（默认 13 工具，按启用工具集计数），错误以结构化错误码返回 OpenCode |
| OpenCode | `packages/opencode` | OpenCode 1.19.0 受管进程（配置注入 + MCP）、HTTP 客户端、SSE 事件桥 |

关键边界：renderer 不直接调用 Git、MCP、SQLite 或 OpenCode；凭据、路径、令牌只在服务端。
所有写操作走 `requestKey + bodyHash + 回执（accepted → succeeded / failed / unknown）`，
UNKNOWN 只能 `GET /api/operations/:key` 核对，不自动重发。

## 受管 OpenCode 与内部 MCP

应用启动时由服务端启动一个受管控的 `opencode serve`（固定 1.19.0）：

1. 生成 `data/opencode/opencode.json`，通过 `OPENCODE_CONFIG` 注入；`mcp.agent-workflow` 指向本项目的
   `.build/mcp/server.mjs`。
2. OpenCode 以 `OPENCODE_SERVER_PASSWORD` 保护，回环 Bearer token 连接内部 MCP 端点。
3. 内置 edit/bash/web 等工具被权限规则禁用；文件读写、测试执行、规划提交全部通过内部 MCP 工具：
   `workflow.context.get`、`workflow.plan.submit`、`workflow.question.ask`、`workflow.result.submit`、
   `git.*` 读工具、`database.query`、`workspace.file.*`、`workspace.exec`。
4. 工具失败返回 `{isError:true, code, message, details}`；模型可据此修正（例如候选计划校验问题）。

开发/生产启动前会构建 MCP：`npm run build:mcp`。如果 MCP 不可用，规划会明确失败而不是伪造候选。

## 任务隔离与 Git

- 每个任务独立分支 + worktree：`data/worktrees/<taskId>`，分支前缀 `task/`。
- 并发任务在不同 worktree 执行；准备/清理/合并都由服务端校验路径与 CAS。
- 交付分步：选择范围 → 提交 → 推送 / 创建 MR → 或合并到目标分支（临时 worktree 合并 + `update-ref` CAS，
  冲突自动 abort，目标分支不变；永不强推）。
- Git 工作台只读浏览提交/差异/分支（服务端 `GET /api/git/*`）；设置 → Git 账号可保存 GitHub/GitLab
  令牌（AES-GCM 加密、只写不读）并验证连接；`fetch` 使用一次性 `http.extraheader` 注入令牌，合并请求读取/
  创建走 GitHub/GitLab REST 适配。
- 非 Git 项目的工作区准备是独立目录副本（排除 `.git/node_modules/.data` 等），写入仍经 MCP。

## 运行

要求：Node.js 24.19、Git 2.45+、OpenCode 1.19.0（已登录 opencode-go 时可用模型）。

```sh
npm install                 # 注意：若本机 npm 配置 omit=dev，用 npm install --include=dev
npm run dev                 # 构建 MCP，起后端 :5177 与 Vite :5173
npm run desktop:dev         # Electron 加载 Vite（需先 npm run dev）
npm run build               # 构建 web / server / desktop / MCP
npm run test                # 单元 + 集成（离线，跳过 live）
AGENT_WORKFLOW_LIVE=1 npm run test:integration   # 需要真实 opencode-go 的端到端场景
```

运行数据默认在 `.data/`（SQLite、JSONL、worktree、OpenCode 配置与日志、密钥），可用
`AGENT_WORKFLOW_DATA_DIR` 覆盖。真实凭据不进入仓库。

## 已验证（离线）

- `npm test`（最终，2026-10-19）：**403 tests / 54 suites / 392 pass / 11 skipped / 0 fail**，约 67.6s
  （日志 `.tmp/wave3g-verify.log`）。覆盖共享状态机、存储/JSONL/密钥、规划图与校验、HTTP 集成、Git 读模型、
  worktree 合并/冲突回退、MCP 工具、数据库只读守卫、启动恢复、API 契约与回执、执行控制/验收 gating、非 Git 清理、
  恢复只读、interactions、远端 UNKNOWN、diff 回归、角色四页签、节点详情子视图、PE37 作用域规划、项目公约、
  方法目录/工作流编辑器、任务冻结/审计/快照评审/运行内容、知识研究步骤/工具轨迹、打包评估等（详见 `docs/verification.md`）。
- `npx tsc -p tsconfig.json --noEmit` 0 errors；`npm run docs:api` / `check:docs-routes`（**163 路由**）、`build:web`/
  `build:server`、`test:e2e -- --skip-build`、`ui:smoke`（兼容 flags，13 截图 + 2 交互）通过（Wave 0–3G 验收；
  CI 配置见 `.github/workflows/ci.yml`）。

## 已验证（真实环境）

- **规划端到端**（`AGENT_WORKFLOW_LIVE=1`）：受管 OpenCode + MCP 注入 → 模型调用 `workflow.plan.submit` →
  候选校验通过 → 应用到草稿 → 确认计划 → 真实 Git worktree 准备成功。
- **执行端到端**：确认/准备后开始执行，模型通过 MCP 文件工具修改 README.md 并 `workflow.result.submit`
  提交结果；节点成功，worktree 变更可读。
- **AI 审查**：真实模型对真实提交产出结构化 findings，服务端校验位置/严重度/维度后结算 completed。
- **AI 修复**：真实模型在 `ai-fix/*` 隔离 worktree 内通过 MCP 修改代码，outcome=fixed（exact）→ 提交 → 放弃
  并清理 worktree/本地分支；修复分支可单独合并回基线分支（no-ff + CAS）。
- **MySQL**：连接本机 `opencode_workflow_test`（MySQL 9.2.0），探针 / `SHOW TABLES` / 只读 SELECT 通过，
  DELETE 与多语句被拒绝；密码从测试项目 `application.yml` 注入，不落库明文。
- **GitHub 读**：PAT 加密保存后连接为 `wangyufengsky`，读取到 9 个 open MR；响应与日志不包含令牌。
- **GitHub 真实写**：在 `wangyufengsky/opencode-workflow-java-test` 推送一次性分支、创建 MR #1、列表确认、关闭 MR 并删除分支（15s，已复核远端干净）。
- **用量**：规划/执行/审查/修复 token 聚合到 Insights；知识库与 PPT 的 usage tokens 随结果展示。
- **知识库问答**：基于项目 docs 提问，flash 返回答案、经校验引用与 conversationId；同一会话追问带上下文（live PASS 约 24 秒）。
- **PPT 大纲/逐页**：草稿 → flash 模型生成 12 页大纲与逐页要点并落库（live PASS 32s）；可添加文本/图片附件，导出 Markdown 与四主题真实 .pptx。
- **GitLab**：GitLab 的 MR 列表/创建通过本地桩服务端到端验证，**真实 GitLab 实例与真实写未执行**；GitHub 的 MR 创建除桩测试外另有真实写验证（见上条）。

> 模型说明：`opencode-go/deepseek-v4.1-flash` 在 thinking 模式下拒绝 tool_choice。本项目内置受管
> provider 兼容网关（仅回环、随机路径 secret、日志脱敏）在 MCP 工具存在时去掉该字段，因此默认规划/开发使用
> **flash**（更快、更省），审查用 v4-pro；网关计数可在 `GET /api/opencode/status` 的 `status.gateway` 查看。

## 未完成 / 下一步

**功能波次 Wave 0–3G 已全部完成**；以下仅为外部阻塞、发布/分发与可选视觉深度项，不代表功能未实现。

- **W4-5/W2-5 真实环境（blocked）**：本机无 PostgreSQL/GitLab 实例或凭据，仓库也无 live 测试。需提供
  PG 连接串 + 只读账号（`WF_PG_URL`/`WF_PG_USER`/`WF_PG_PASSWORD`）与 GitLab base/API URL + api scope PAT +
  测试项目（`GITLAB_TEST_*`）；环境变量、补测步骤与评估见 `docs/packaging.md` §7，不伪造 PASS。
  GitHub 远端关闭/合并/删分支产品边界仍待产品确认（W2-8）。
- **W4-4 打包（发布类）**：2026-10-19 21:20 已用当前代码重建 346MB `.app`，但未签名/未公证、无 dmg/zip 安装包、
  仅 arm64、默认 Electron 图标、asar 关闭；默认 GUI 在本沙箱被 Chromium sandbox/GPU 拦截（兼容 flags 离屏捕获 PASS）。
  签名/公证、桌面默认参数验收、Windows/Linux、自动更新、CI 打包未做，见 `docs/packaging.md` §5/§8/§9。
- **W4-6 推送 main（pending）**：功能完成后由 Lead 推送 `https://github.com/wangyufengsky/agent-workflow-deepseek`
  的 `main` 并 `git ls-remote` 核对；`origin` 已配置、本地当前分支 `master`。
- **视觉回归（可选深度）**：`ui:smoke` 已通过（13 截图 + 2 交互），`docs/evidence/` 30 张（8 当前 + 22 历史）；
  但没有像素级 diff，四主题 × 全状态未自动覆盖。
- **设计级降级（非阻塞，逐页见 `docs/design-coverage.md`）**：B-07 阶段报告 `available:false`、知识问答非流式
  （无 SSE，旧历史无时间线字段）、charter generate 真实 501、GitLab 项目级配置只保存非敏感项且运行时仍用全局、
  角色 B-02/B-03 与形象/使用统计、数据库/工具/模板后端字段、工作流编辑器无并行/任意连线/缩放/视觉 diff、
  PPT 高级视觉、首页「进行中」单卡、恢复不复制执行上下文等。

## 界面证据

`docs/evidence/` 现有 **30 张 PNG**：22 张 Wave 0 前历史截图 + 8 张 `*-2026-10-19.png` 当前 UI smoke 截图
（W4-3c 设置导航修复后 21:47 重拍）；`evidence/` 是 `ui:smoke` 自动产物的 13 张。当前截图由
`CAPTURE_UI_NO_SANDBOX=1 CAPTURE_UI_PORT=5292 CAPTURE_UI_TMP_DIR=.tmp/ui-task46 CAPTURE_UI_EXTRA=1 npm run ui:smoke`
在 `apps/web/dist`（提交前 HEAD `14c9fdd` + 未提交 settings 修复）上生成：13 截图目标 + 2 交互 smoke 通过（最终日志
`.tmp/final-ui-smoke.log`），但**不是像素级视觉回归**。设置导航 `.snav .cap` 间距缺陷已在 W4-3c 修复并确认。
清单/有效性/命令见 `docs/evidence/README.md`；CI 与 e2e 见 `.github/workflows/ci.yml`、`scripts/test-e2e.mjs`。

协议与设计细节见 `docs/architecture.md`、`docs/design-system.md`、`docs/api.md`、`docs/design-coverage.md`、`docs/remaining-work.md`、`docs/verification.md`、`docs/packaging.md`、`docs/evidence/README.md`、`AGENTS.md`。
设计覆盖现状见 `docs/design-coverage.md`：2026-10-19 更新到 Wave 3A–3G 的 25 页覆盖矩阵（当前 **✅ 3 / 🟡 22 / ⛔ 0**，
全部页面已实现，逐页降级见该文件），不是验证记录。打包与真实环境 blocked 状态见 `docs/packaging.md`。
仓库：`https://github.com/wangyufengsky/agent-workflow-deepseek`（origin 已配置；main 推送由 W4-6/Lead 在文档收口后执行）。

## 品牌与命名（2026-10-19 决策）

- 产品名继续使用 **`agent-workflow` / `Agent Workflow`**：仓库名、npm workspace 包名、Electron `productName` 与主进程
  窗口标题、Web Shell 品牌和 `document.title` 均已统一为 agent-workflow。
- 设计稿目录 `opencode-workflow-design-showcase/` 中的 `opencode-workflow` 作为**设计来源名**保留，只在引用设计稿/上游
  来源时出现；不据此做仓库、包名、Electron 或 UI 的全局改名。
- 因此 `CLAUDE-设计结果.md` 与 README/界面中的名称差异不是实现缺陷；新代码与用户可见品牌一律用 agent-workflow。

## 实现状态

截至 2026-10-19（Wave 0–3G 全部功能完成；外部验证 blocked）：核心链路（Electron/主题/画布/后端/存储/
MySQL/Git/MCP/受管 OpenCode/规划/执行/审查/修复/交付/恢复）均已真实运行；最终离线测试
**403 tests / 54 suites / 392 pass / 11 skipped / 0 fail**（约 67.6s，`.tmp/wave3g-verify.log`）。

Wave 0–2 已补齐：`restart` / `git fetch` 合法回执与前端按回执读取、未知 `/api/*` JSON 404、缺 `requestKey` 400、
真实 terminal/MCP 工具数/数据库连接状态、execution/planning/workspace 启动恢复、PPT 页完整闭环、模板可视化/JSON
编辑器与归档、工作区清理 UI 与**非 Git 真实清理**、自动推进开关/整体推进/推进直接后继/放弃调整、恢复三模式与
恢复页 unknown、PPT「生成中」启动恢复、知识历史页 `/knowledge/history`、`viewActions` 回归。

Wave 3A/3B 已补齐：节点验收 accept/reject、项目详情四页签、PPT 作品库 + 四步工作台、任务列表行菜单/聚合进度、
开始页三段结构、Inbox interactions 就地处理（free_text/权限/策略诚实降级）、`verify_only` 硬只读（migration v11）、
远端 push/MR UNKNOWN、storage `removeJson`、`/runs/:taskId`、`/roles/legacy`、`docs/api.md` 重生成与 `check:docs-routes`。

Wave 3C 已补齐：节点验收 gating（待验收 paused / accept 后完成 / reject 可重试）、放弃调整恢复「调整前已暂停」、
readOnly 投影与 `updateDraft` 守卫、`changes` diff 修复、`fetch`/fix push UNKNOWN 结算、知识库来源选择 + 引用原文
520 面板 + 研究员面板（研究步骤/流式 DTO 仍缺）、设置页执行限制/脏保存条/缺失分区、主页展示化、run/legacy 面包屑、
`test:e2e` + 最小 CI + 证据清单、文档同步。

Wave 3D 已补齐：角色管理四页签（后端字段/校验/发布核对/历史 + 前端四页签/资源权限/形象/发布检查）、待验收情况条
（去验收/驳回重试）、节点详情工具/产物/引用/宽阅读子视图、数据库/工具/模板结构诚实降级、PE37 分组细化引擎
（proposal/refinePreview/作用域合并/confirm 前置）、W4-4 打包重建与评估（346MB 未签名 `.app`，`docs/packaging.md`）、
文档同步。

Wave 3E 已补齐：PE37 HTTP + UI（proposal/refine-preview/scoped start/组候选/确认拦截）、项目公约后端
（GET/PATCH/confirm 原子写 AGENTS.md、unknown 恢复、generate 诚实 501）、`docPaths` 与项目级 GitLab 覆盖契约/读回、
方法目录（method catalog）后端核心（合并视图/CRUD/校验/版本冲突/复制/归档，7 测试）、W4-3b 视觉回归兼容 flags +
截图刷新（13 截图 + 2 交互 smoke，`docs/evidence/README.md` 30 张清单）、W4-2 API 文档重生成（当轮 153 路由）与文档同步。

Wave 3F 已补齐：工作流目录 + 编辑器（`/workflows/:id/edit`：步骤链画布/检查/保存/400-409 冲突横幅）、项目详情 UI
接入 charter/docPaths/GitLab（501 生成/手动编辑/confirm 写 AGENTS.md/unknown 核对）、任务扩展后端核心（冻结/
审计/快照评审/运行内容读模型）、设置导航 `.snav .cap` 修复+截图重拍、当轮 API 158 路由。

Wave 3G 已补齐：「⋯」菜单四入口（恢复/冻结计划/审计记录/快照评审 B-07/运行内容）+ 冻结/审计/快照评审 HTTP
与回执、知识研究步骤/工具轨迹时间线（真实执行、非流式）、最终 **163 路由 / 403 tests / ui:smoke**。**功能波次
已全部完成；仅 W4-5/W2-5 真实 PG/GitLab blocked、W4-4 签名/公证/跨平台/自动更新、W4-6 推送 main 待执行**，
逐页降级见 `docs/design-coverage.md`。

> 若从某些工具终端启动桌面应用时只见日志、不开窗，检查是否继承了 `ELECTRON_RUN_AS_NODE=1`；桌面主进程需要普通 Electron 模式（可 `unset ELECTRON_RUN_AS_NODE` 后再启动）。

> 若设置页显示「受管 OpenCode 未启用」，检查启动命令是否设置了 `AGENT_WORKFLOW_DISABLE_OPENCODE=1`，或设置中 `opencode.enabled=false`；启用后需要重启整个 Agent Workflow 服务。
