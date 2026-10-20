# 区域 11 · 运行环境 / 工具与 Skill / 数据库 — 处置记录

> 来源：`docs/review/design-audit-2026-10-20/11-runtime-tools-databases.md`（24 条：P1 1 / P2 11 / P3 12）。
> 任务 task-14；分支 `fix/design-audit-2026-10-20`（未切换/未 commit）；设计稿只读；`docs/api.md` 未动。
> 状态：已修复 / 部分 / 延后（原因）；证据行号以当前工作区为准。

| ID | 状态 | 证据（文件） | 说明 |
|---|---|---|---|
| P18-01 | 已修复 | `apps/web/src/pages/runtime/RuntimePage.tsx`（stale/lastReadAt + 顶部 danger banner + hero/事实卡 `.stale` + “上次结果·可能已过时”）、`runtime/runtime.css` | read-error 保留旧快照时明示“上一次结果、可能已过时 + 读取时间 + 重新读取”，hero 与事实卡降透明；不再把旧数据当实时状态。 |
| P18-02 | 已修复（部分） | `RuntimePage.tsx`（`designStateLabel`/`ownershipLabel`、上次检查、管理方式行） | 状态词映射设计词（ready→已连接、stopped/failed→离线、starting→启动中、degraded→部分可用·状态待核实、未知→状态待核实+原始值）；补上次检查时间、进程归属、管理方式。三卡重排见 P18-06。 |
| P18-03 | 已修复 | `RuntimePage.tsx`（离线/启动失败、启动中、未知状态三类 banner） | 失败含原因+“任务与知识库暂时不能运行”+设置深链；启动中含 PID+等待就绪；未知含原始值+避免误操作说明+重新读取。 |
| P18-04 | 已修复 | `apps/web/src/pages/runtime/RuntimeControls.tsx`（`RuntimeSnapshot`、确认框快照/后果/启动说明） | 确认前展示状态/PID/监听地址/归属快照；后果文案按产品实际行为（活动/待核对会话时服务拒绝重启，先停止核对），并写明以回执为准。 |
| P18-05 | 已修复 | `RuntimePage.tsx`（unknown 页面 banner + `beforeunload`）、`RuntimeControls.tsx`（`onUnknownChange`、原 key 核对） | UNKNOWN 提升为页面级“操作已锁定”横幅（不重发/不能再次启动或重启）+ 离开提醒；操作卡保留原 requestKey 只读核对。 |
| P18-06 | 部分 | `RuntimePage.tsx`（管理方式/归属提示已加） | 三事实卡按设计重排（服务/进程归属/MCP）与“配置已注入不代表已连接”原文未做；“运行数据”卡保留（产品补充，C9 记录）。 |
| P18-07 | 延后 | `RuntimeControls.tsx` 仍是操作卡内全量历史 | “最近一次操作”单条摘要卡拆分需 GUI 复核信息架构。 |
| P19-01 | 延后（C1） | 现实现：`ToolsPolicyView.tsx` 来源侧栏；契约 `packages/shared/src/domain/access.ts` | 来源三态（已连接/等待授权/状态未知）与“等待授权”需服务/契约新增 status 并有真实外部 MCP 授权场景；不伪造。 |
| P19-02 | 延后（C1） | `ToolsPolicyView.tsx`、`tool-policy-command.ts` | UNKNOWN 自动重读清单与具体工具名需持久命令保存 body/工具名并加自动重读分支；当前手动核对原请求（不重发）安全语义正确。 |
| P19-03 | 已修复 | `apps/web/src/pages/tools/ToolsPolicyView.tsx`（`meta?.description ?? title`，title 作 tooltip） | 工具行用目录 description 作为一行功能说明；服务契约无 description 时前端兜底。 |
| P19-04 | 部分 | `apps/web/src/pages/tools/SkillsView.tsx`（原文头：N 行 / 复制不含行号 / 换行说明） | 分段控件形态与 Markdown 语法配色需改 node 阅读器 `ReadableText.tsx`（不在本任务写范围）。 |
| P19-05 | 已修复 | `SkillsView.tsx`（目录失败/正文失败/空正文定制文案 + role=alert + 重试） | 目录失败说明 OPENCODE_SKILLS_UNAVAILABLE 且不显示示例；正文失败提示目录仍可用、可先读其他 Skill；空正文给“文件已读取成功，请在 path 中编辑”。 |
| P19-06 | 已修复 | `apps/web/src/pages/tools/ToolsPage.tsx` | 移除与来源合计不一致的“工具 13”计数与设计外“最近读取 OpenCode 状态”行。 |
| P20-01 | 延后（C9 已登记） | `packages/shared/src/config/settings.ts` planned 驱动、`packages/server/src/http.ts`（available/缺驱原因/保存拒绝）、`DatabasesPage.tsx`（禁用+原因） | 不伪造 openGauss/GaussDB/Oracle/达梦/DB2 驱动（E22 边界：不得用 pg 冒充）；与设计确认 B-13 降级为“类型清单/缺驱原因呈现（后续分期）”。 |
| P20-02 | 延后（C1） | `DatabasesPage.tsx`（删除+启用开关）、`packages/shared/src/domain/models.ts` `DatabaseConnection` 无 archived/version | 归档/停用/版本与“已归档”需契约+服务迁移（models.ts/storage 不在本任务写范围），当前删除不可恢复。 |
| P20-03 | 延后 | `DatabasesPage.tsx` 类型分段 | 状态分段筛选依赖 P20-02 归档字段；类型分段保留为可用维度，差异已记录。 |
| P20-04 | 已修复 | `DatabasesPage.tsx`（列表卡片三格 + 抽屉“连接检查”三格） | 三格改为独立事实：会话只读=最近探针运行时测量；只读已强制=连接设置保证（`connection.readOnly`/表单 readOnly，不再用 `readOnlyEnforced=sessionReadOnly` 副本冒充）；三态可表达；三格同时进入编辑抽屉连接检查区。 |
| P20-05 | 部分 | `DatabasesPage.tsx`（未知 banner/核对锁定/关闭拦截说明） | 自动“逐页读取全部连接核对”进度未做；服务保存接口同步返回（不产生 unknown receipt，C1），未知仅网络失败兜底；关闭被拦截但原因已可读。 |
| P20-06 | 部分 | `DatabasesPage.tsx`（历史类型/未提供驱动文案区分） | “服务不再返回该类型”无契约字段（C1）；检查草稿仍按驱动可用性禁用。 |
| P20-07 | 延后 | `DatabasesPage.tsx` 抽屉 520px | 600px/`xl`、schema 表 chip 输入、每连接查询限制需 Drawer 组件与数据库契约（不在写范围）；当前表单可用。 |
| P20-08 | 延后（C1） | 类型清单与连接列表同一 `GET /api/settings/databases` | 独立类型端点未做（本轮时间闸门），设计“类型失败但连接列表可用”仍不可达。 |
| P20-09 | 延后 | `DatabasesPage.tsx` 2 列网格 | 3 列网格/引擎色块/停用降透明/加载更多属视觉细化，需 GUI 四主题复核。 |
| P20-10 | 记录（C9） | `DatabasesPage.tsx` 只读查询抽屉/删除/查询限制卡 | 设计外产品扩展保留（服务真实支撑、无伪造）；删除与归档二选一/更明确不可恢复文案需设计裁定。 |
| P20-11 | 已修复 | `DatabasesPage.tsx`（typeSwitched 提示、GoldenDB 协议说明、驱动与历史任务说明） | 切换类型清空地址后提示“已清空连接地址，请重新填写”；说明测试/保存所用服务驱动与历史任务保留原驱动；GoldenDB 提示按 MySQL 协议填写。 |

## 验证

- `npm run typecheck`：见最终汇报（本轮以最终结果为准）。
- 未运行 Web GUI / 真实外部 MCP / 真实 SQL Server·达梦·DB2 实例；四主题×断点与真实错误态需 GUI 复验。
- 未改 `docs/api.md`、设计稿、`packages/database/src/service.ts`（不在本任务写范围）。

## 待 GUI / 真实服务复核

1. read-error 真实断连后的 stale 呈现与恢复；2. 启动失败/启动中/未知状态 banner 与重启快照；3. UNKNOWN 丢响应时页面锁与离开提醒；4. 外部 MCP 授权/超时（P19-01/02 延后 C1）；5. 可用驱动实例上的会话测量 vs 配置保证三格；6. P18-06 三卡重排与 P18-07 最近操作拆分留后续批次。

## 逐条补充处置（Lead 收口核对后补录）

| ID | 状态 | 证据 | 说明 |
|---|---|---|---|
| P20-10 | 延后（C9） | 区域报告 P20-10 | 设计外只读查询抽屉、删除连接、全局查询限制卡等属产品扩展，需设计确认（保留真实能力，不伪装设计态）。 |

