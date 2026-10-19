# 架构

## 1. 进程与边界

```
Electron 主进程
  ├─ BrowserWindow（renderer = apps/web）
  └─ 子进程：packages/server（Node 24，Electron RUN_AS_NODE 或系统 node）
        ├─ SQLite + JSONL（.data/）
        ├─ MySQL（mysql2）/ PostgreSQL（pg）只读查询
        ├─ 受管 OpenCode 1.19.0（opencode serve，回环 + Basic 密码）
        │     └─ MCP stdio 子进程（.build/mcp/server.mjs）
        └─ 本机 Git CLI（worktree）
```

- renderer 只有 HTTP/SSE：`/api/*`。Electron preload 只暴露最小宿主能力（打开外链、在文件管理器显示、
  选择目录），不做业务代理。
- 服务端是唯一状态机权威与会话签发者；URL/参数里的 id 只用于选择资源，不授予权限。
- 未知 `/api/*` 请求返回 JSON 404；SPA 兜底只接管非 API 路由，不会把未知 API 当成页面返回 HTML。
- OpenCode 与产品之间只有 MCP + 回环内部端点；OpenCode 内置文件/命令工具在权限规则中被禁用，文件写入必须
  走 MCP `workspace.file.*`，服务端按 taskId 解析真实工作区并做根约束。

## 2. 模块

| 模块 | 职责 | 关键文件 |
| --- | --- | --- |
| shared | 枚举/状态机/领域模型/API DTO/配置/主题 | `domain/enums.ts`、`domain/machines.ts`、`domain/models.ts`、`api/contracts.ts` |
| storage | SQLite 迁移与仓库、JSONL、密钥 | `migrations.ts`、`store.ts`、`jsonl.ts`、`secrets.ts` |
| engine | 领域服务（project/task/planning/plan/workspace/execution/delivery） | `engine.ts`、`planning.ts`、`execution.ts` |
| git | Git CLI 读模型、worktree、远端 REST | `packages/git/src/*` |
| database | MySQL（mysql2）与 PostgreSQL（pg）只读查询、探针 | `packages/database/src/service.ts`、`mysql.ts`、`postgres.ts` |
| mcp | 内部工具 + 错误信封（默认 13 个，按启用工具集计数） | `packages/mcp/src/tools/*` |
| opencode | 进程管理、配置注入、SSE 事件桥 | `packages/opencode/src/{manager,runner,client}.ts` |
| server | HTTP/SSE、内部 MCP 端点、Opencode/Git/DB 适配 | `packages/server/src/{http,internal,application}.ts` |
| web | 壳/画布/页面/主题 | `apps/web/src/*` |
| desktop | Electron 主进程与 preload | `apps/desktop/src/*` |

## 3. 状态机

所有状态迁移集中在 `packages/shared/src/domain/machines.ts`，服务端在持久化前用同一份定义校验：

- 任务总阶段（五段胶囊）：`draft → planning → confirming → preparing → executing`，允许回退重规划。
- 规划 run：`queued/running/stopping/stopped/failed/unknown/completed`；unknown 只能核对结算。
- 规划 stage：`preparing_input → generating → validating →（revising）→ awaiting_review / needs_answer`。
- 计划修订：`draft → unconfirmed → confirmed → superseded`。
- 执行：`idle → ready → running → pausing/paused / waiting_confirmation / stopping → stopped / completed / failed / unknown`。
- 节点：`pending → ready → running → succeeded/failed/cancelled/unknown`；失败可按原配置重试。
- 工作区：`not_started → preparing → ready / partial / blocked / unknown → cleaning → cleaned`。
- 回执：`accepted → succeeded / failed / unknown`，unknown 仅可被服务核对结算。
- 启动恢复：进程启动时 execution running→unknown、planning running→unknown（可 reconcile）、workspace preparing→unknown，
  并结算持久化的 start/stop 回执（`Engine.recoverOnStartup`），避免重启后永久 running。

`packages/shared/src/domain/machines.test.ts` 覆盖非法迁移与关键路径。

## 4. 命令与回执

- 写命令必须带 `requestKey`（前端 `createRequestKey()` 在用户确认时生成一次）。
- 服务端对 body 做稳定序列化哈希；同 key 同 hash 返回原回执，同 key 不同 hash → `REQUEST_KEY_REUSED`。
- 结果落库 `operations`，并可经 `GET /api/operations/:key` 读回；UNKNOWN 不自动重发、不换 key。
- `restart`、`git fetch`、数据库登记/删除、GitLab 验证等写/验证命令同样返回合法 `CommandResponse`（含 receipt），
  前端按回执而不是按裸资源读取结果。
- 长操作（规划）先返回 accepted，异步推进，最终 `operation.settled` 事件 + 读口权威。

## 5. 规划流程（已验证真实模型）

1. `POST /planning/preview`：只读预览（预算、时限、派发上限、图规模上限、预览有效期）。
2. `POST /planning/start`：创建 planning round，任务阶段→planning，异步启动 OpenCode 会话。
3. 模型通过 MCP `workflow.plan.submit` 提交候选；服务端用确定性校验（V1–V8：必经步骤/key 唯一/引用/
   自依赖/环/输入绑定/写资源冲突/规模）校验并落库为候选计划修订；工具返回 problems 供模型修正。
4. 会话结束后 round→completed、stage→awaiting_review（有必须答复问题则为 needs_answer）。
5. `apply`：要求结构化检查通过、必答问题已答、需人工判断项逐项 accepted；生成未确认计划修订。
6. `confirm`：计划修订→confirmed，创建 execution + workspace（not_started），任务阶段→preparing。
7. `workspace/prepare`：Git 项目创建任务分支 + worktree；非 Git 项目生成独立目录副本与 baseline 快照，
   后续交付走「预览 → 冻结 → 逐项应用」（已实现并有集成测试）。

失败/停止/未知：停止请求只标记 stopping，进程停稳且用量结账后才 stopped；结果不明进入 unknown，
`POST /planning/reconcile` 只按原轮次会话核对，不重发。模型输出超长/未提交时明确失败或从正文解析候选并
在记录中标注“模型未调用提交工具，已从正文解析候选”。

## 6. 执行流程（已验证真实模型）

1. `execution/start` 要求工作区 ready；执行器逐个领取 ready 节点。
2. 每个节点创建 attempt，通过 OpenCode 会话 + MCP 工具在工作区内读写/执行允许的命令；模型必须调用
   `workflow.result.submit` 提交 summary/verification，否则节点明确失败（不伪造成功）。
3. 验证失败 → 节点 failed；全部叶子成功 → execution completed，生成交付记录，任务 attention→waiting_user。
4. 暂停/继续/取消均走状态机；取消后工作区保留。

## 7. Provider 兼容网关

OpenCode Go 的 flash 模型在 thinking 模式下拒绝任何 `tool_choice`，而 OpenCode 1.19 在存在 MCP 工具时会发送它。
服务端在回环地址上提供 OpenAI 兼容转发网关（随机 path secret，仅 OpenCode 使用）：

- 请求转发到 `providerGateway.upstreamBaseUrl`，仅对配置中的模型去掉 `tool_choice`；
- 记录请求/归一化计数与脱敏错误（`data/logs/provider-gateway.jsonl`）；
- OpenCode 的 `provider['opencode-go'].options.baseURL` 指向该网关，其余 provider 行为不变；
- 状态经 `GET /api/opencode/status` 的 `status.gateway` 暴露（requests / normalized / lastError）。

可用 `opencode.providerGateway.enabled=false` 关闭；关闭后请勿把 flash 模型用于带工具的会话。

## 8. 安全

- GitLab/GitHub token、数据库密码存本地 `secrets` 表（AES-256-GCM，密钥文件 0600，仅服务端读取）。
- 内部 MCP 端点需要 Bearer token；OpenCode 服务使用随机 Basic 密码。
- 路径约束：所有相对路径 realpath 后必须位于项目根/工作区内；拒绝绝对路径、`..`、符号链接逃逸。
- `workspace.exec` 只允许配置的命令（argv 前缀匹配 + `shell:false`），拒绝 shell 操作符。
- 错误信息统一脱敏（token/密码/Authorization）；provider key 不进入 API 响应。
