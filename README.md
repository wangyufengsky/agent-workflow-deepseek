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

- `npm test`（最近一次：2026-10-19）：**379 tests / 54 suites / 368 pass / 11 skipped / 0 fail**，约 62.4s
  （日志 `.tmp/wave3d-test.log`）。覆盖共享状态机、存储/JSONL/密钥、规划图与校验、HTTP 集成、Git 读模型、
  worktree 合并/冲突回退、MCP 工具、数据库只读守卫、启动恢复、API 契约与回执、执行控制/验收 gating、非 Git 清理、
  恢复只读、interactions、远端 UNKNOWN、diff 回归、角色四页签、节点详情子视图、PE37 作用域规划、打包评估等
  （详见 `docs/verification.md`）。
- `npx tsc -p tsconfig.json --noEmit` 0 errors；`npm run build:web`/`build:server` 成功；`npm run check:docs-routes`
  （148 路由）与 `npm run test:e2e -- --skip-build` 通过（Wave 0–3D 验收；CI 配置见 `.github/workflows/ci.yml`）。

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

- **Wave 3E 进行中**（不要当作已完成）：W3-1b 项目详情后端（charter/docPaths/GitLab 绑定）、W3-6b PE37 HTTP/UI
  接线、W3-8a 工作流编辑器后端核心、W4-3b `ui:smoke` 兼容 flags/截图刷新。
- **W3-4b 知识库研究体验**：研究步骤、工具轨迹、流式/轮询回答、命中相关度等 DTO 未提供；W3-4a 已完成来源选择/
  引用原文 520/研究员面板。
- **W3-5 任务画布扩展**：冻结计划、审计记录、运行内容入口、快照评审 B-07（`/runs/:taskId`、待验收情况条与节点
  面板推进入口已有）。
- **W3-8a/W3-8b 工作流编辑器**：method CRUD/复制/归档/校验 + 画布编辑；当前唯一整页缺失（`workflow-editor`）。
- **W4-5/W2-5 真实环境（blocked）**：本机无 PostgreSQL/GitLab 实例或凭据，仓库也无 PG/GitLab live 测试。需提供
  PG 连接串 + 只读账号、GitLab base/API URL + api scope PAT + 测试项目；环境变量与补测步骤见 `docs/packaging.md` §7。
  GitHub 远端关闭/合并/删分支产品边界仍待确认（W2-8）。
- **打包分发（W4-4）**：2026-10-19 21:20 已用当前代码重建 346MB `.app`，但未签名/未公证、无 dmg/zip 安装包、仅 arm64、
  默认 Electron 图标、asar 关闭；本沙箱默认 GUI 启动被 Chromium sandbox/GPU 拦截（兼容 flags 离屏捕获 PASS）。
  签名/公证、桌面默认参数验收、Windows/Linux、自动更新、CI 打包未做，见 `docs/packaging.md` §5/§8/§9。
- **视觉回归（W4-3b）**：CI/e2e 已接入，但 `docs/evidence/` 22 张截图仍为 Wave 0 前历史证据（见 `docs/evidence/README.md`）；
  无像素级视觉回归，需桌面环境 + 真实 OpenCode/模型重拍或补自动截图。
- **剩余结构/深度项**：数据库授权/多 schema、工具项目级配置/单工具策略、模板分支/时间/文档/B-06、角色权限预估/
  形象目录、审查并排代码差异、恢复不复制执行上下文/阶段图、PPT 高级视觉（品牌模板/PDF/逐页视觉检查）。
- **文档/证据体系**：`docs/design-coverage.md` 已更新到 Wave 3D；`docs/api.md` 由 `ROUTES + 服务端注册` 生成（148 路由）；
  `test:e2e` + 最小 CI + 证据清单已在 W4-3a 落地；live 日志摘要与像素级视觉回归仍待 W4-3b。

## 界面证据

`docs/evidence/` 是 Wave 0 之前的手工截图（真实服务 + 真实 Git 仓库 + 真实模型），覆盖主页、任务列表、开始任务、
需求画布（模型候选）、任务执行画布、节点执行现场、Git 工作台、四主题与 1024 宽度；`evidence/` 是 `npm run ui:smoke`
输出的路由截图。Wave 3A–3D 页面验收使用的是 agent 一次性 Electron 冒烟（未入库/未进 CI）；当前沙箱 UI smoke 仍未成功，
截图与页面文案可能落后于新实现。`docs/evidence/README.md` 已列出 22 张 PNG 的轮次/数据源/有效性（全部标注为 Wave 0 前
历史证据），并区分两个证据目录；CI 与 e2e 见 `.github/workflows/ci.yml`、`scripts/test-e2e.mjs`。

协议与设计细节见 `docs/architecture.md`、`docs/design-system.md`、`docs/api.md`、`docs/design-coverage.md`、`docs/remaining-work.md`、`docs/verification.md`、`docs/packaging.md`、`AGENTS.md`。
设计覆盖现状见 `docs/design-coverage.md`：2026-10-19 更新到 Wave 3A–3D 的 25 页覆盖矩阵（当前 **✅ 3 / 🟡 21 / ⛔ 1**，
唯一整页缺失 `workflow-editor`），不是验证记录。打包与真实环境 blocked 状态见 `docs/packaging.md`。

## 品牌与命名（2026-10-19 决策）

- 产品名继续使用 **`agent-workflow` / `Agent Workflow`**：仓库名、npm workspace 包名、Electron `productName` 与主进程
  窗口标题、Web Shell 品牌和 `document.title` 均已统一为 agent-workflow。
- 设计稿目录 `opencode-workflow-design-showcase/` 中的 `opencode-workflow` 作为**设计来源名**保留，只在引用设计稿/上游
  来源时出现；不据此做仓库、包名、Electron 或 UI 的全局改名。
- 因此 `CLAUDE-设计结果.md` 与 README/界面中的名称差异不是实现缺陷；新代码与用户可见品牌一律用 agent-workflow。

## 实现状态

截至 2026-10-19（Wave 0–3D 完成，Wave 3E 进行中）：核心链路（Electron/主题/画布/后端/存储/
MySQL/Git/MCP/受管 OpenCode/规划/执行/审查/修复/交付/恢复）均已真实运行；离线测试
**379 tests / 54 suites / 368 pass / 11 skipped / 0 fail**（约 62.4s，`.tmp/wave3d-test.log`）。

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
文档同步。**W3-6b、W3-1b、W3-8a 与上列「未完成 / 下一步」仍未完成**，详见 `docs/remaining-work.md`、`docs/packaging.md`
与 `docs/design-coverage.md`。

> 若从某些工具终端启动桌面应用时只见日志、不开窗，检查是否继承了 `ELECTRON_RUN_AS_NODE=1`；桌面主进程需要普通 Electron 模式（可 `unset ELECTRON_RUN_AS_NODE` 后再启动）。

> 若设置页显示「受管 OpenCode 未启用」，检查启动命令是否设置了 `AGENT_WORKFLOW_DISABLE_OPENCODE=1`，或设置中 `opencode.enabled=false`；启用后需要重启整个 Agent Workflow 服务。
