# agent-workflow 项目约定

本仓库是 `opencode-workflow-design-showcase` 设计稿的产品化实现：Electron 桌面 + React/TS/Vite 前端 + Node.js 24/TS 后端 + SQLite/JSONL 存储 + 受管 OpenCode 1.19.0 运行时。

## 1. 视觉与交互权威

1. `opencode-workflow-design-showcase/` 是只读权威：页面结构、四主题令牌、文案、状态与操作逻辑都以它为准，不修改该目录。
2. 设计是 mock；不得把原型里的成功画面当成后端已完成。任何界面状态必须由服务真实数据或明确标注的「未接通 / 未知」状态支撑。
3. 四套主题 `deepseek / warm / spdb / github-white` 全部由 `apps/web/src/theme/themes.ts` 配置驱动，通过 `data-theme` 切换；不得在组件里写死颜色。
4. 状态一律「文字 + 图标」，不只靠颜色；禁用按钮必须有服务给出的原因。

## 2. 架构分界

| 层 | 目录 | 职责 |
| --- | --- | --- |
| 契约 | `packages/shared` | 枚举、常量、状态机、领域模型、API DTO、错误码、配置与主题元数据；不依赖运行时 |
| 存储 | `packages/storage` | SQLite（`node:sqlite`）迁移与仓库、JSONL 追加事件日志 |
| 引擎 | `packages/engine` | 任务 / 规划 / 计划 / 执行 / 工作区 / 交付领域服务；状态机权威 |
| Git | `packages/git` | 本机 Git CLI 适配、worktree 管理、GitHub/GitLab REST 适配 |
| 数据库 | `packages/database` | mysql2 连接、探针、只读查询 |
| MCP | `packages/mcp` | 内部 MCP stdio 服务，向 OpenCode 暴露受控工具；错误以结构化错误码返回 |
| OpenCode | `packages/opencode` | OpenCode 1.19.0 受管进程、配置注入、客户端、事件桥 |
| 服务 | `packages/server` | Fastify HTTP + SSE、启动编排、鉴权与会话 |
| Web | `apps/web` | React + TS + Vite；`@xyflow/react` 流程画布 |
| 桌面 | `apps/desktop` | Electron 主进程 / preload / 窗口 / 宿主能力 |

renderer 不直接调用 Git、MCP、SQLite 或 OpenCode；只调用服务端应用操作。凭据、路径、令牌只在服务端。

## 3. 开发规则

1. Node 24 + TypeScript，ESM；用 `node --import tsx` 运行 TS 源码，生产用 esbuild 打包。
2. **不使用 TS `enum` / `namespace` / 参数属性**（Node 类型剥离只支持可擦除语法）；用 `as const` 对象 + 联合类型。
3. 跨文件导入写完整 `.ts` / `.tsx` 扩展名。
4. 常量、枚举、状态集合中在 `packages/shared/src/domain/enums.ts`；状态迁移在 `packages/shared/src/domain/machines.ts`，不得散落在组件里。
5. 模块化、配置化：新增能力先加契约与配置，再加实现；禁止 God class / God component。
6. 错误码统一 `ErrorCode`；写操作必须有 `requestKey` + 回执（accepted → succeeded / failed / unknown），UNKNOWN 只能 `operations.by-key` 核对，不自动重发。
7. 任务隔离：每个开发任务独立 Git 分支 + worktree，目录在 `data/worktrees/<taskId>`；并发任务在不同 worktree；合并通过 Git 工作台。
8. 测试：领域状态机与存储用 `node --test`；HTTP 集成测试起真实服务；模型测试走配置的 `opencode-go`，不得伪造模型结果。
9. 禁止把真实凭据、个人路径、运行数据提交入库。
10. 每批工作同步文档与验证证据，说明未覆盖项。

## 4. 命令

```sh
npm install                 # 安装工作区依赖
npm run typecheck           # 全仓类型检查
npm test                    # 单元 + 集成测试
npm run dev                 # 同时起后端与 Web（Vite 代理）
npm run dev:server          # 仅后端 http://127.0.0.1:5177
npm run dev:web             # 仅 Vite http://127.0.0.1:5173
npm run build               # 构建 web / server / desktop
npm run desktop             # 构建并以 Electron 启动
npm run test:model          # 调用受管 opencode-go 做最小模型连通测试
```

## 5. 运行数据

默认数据目录 `.data/`（SQLite、JSONL、worktree、日志）。可用 `AGENT_WORKFLOW_DATA_DIR` 覆盖。真实项目数据只在本机，不入库。

## 6. 协作

- 共享任务板 + 独立写范围；Lead 负责最终审查、类型检查、测试与合并。
- 设计稿目录只读；不得为了「让测试通过」改设计稿或验收脚本。
