# 区域 13 · 恢复 / 需求目录 / 历史角色配置 — 处置记录

> 来源：`docs/review/design-audit-2026-10-20/13-recovery-requirements-legacy.md`（24 条：P1 1 / P2 13 / P3 10）。

| ID | 状态 | 证据（文件:行） | 说明 |
|---|---|---|---|
| P23-01 | 已修复 | `apps/web/src/pages/recovery/RecoveryPage.tsx`（身份改由 `GET /api/tasks/:id/detail` 的 `task/project` 解析，摘要仅作 display shortcut；no-parent 仅在 detail 404 时展示；其余读取失败给重试而非“父任务不存在”；候选列表改用 `GET /api/tasks?attention=<waiting_user/blocked/failed/unknown>&limit=200` 四路查询合并去重，不再依赖 bootstrap 前 100 条） | >100 任务的失败任务可从恢复地址与 `/recovery` 选择列表进入；读取失败不再冒充“任务不存在”。需 GUI 复验（>100 任务场景，审计标注需真实服务）。 |
| P23-02..24（除 P23-01） | 延后 | — | P2/P3 后续批次（见 `p2-p3-backlog.md`）。 |

---

## 追加处置（2026-10-20 · task-16，P2/P3 收口；保留上表 P23-01 行不改）

> 本轮范围：区域 13 剩余 P2/P3 按可验证性优先处理；仅改 `apps/web/src/pages/{recovery,requirements,roles-legacy}/**`，未改共享契约/服务端（除文档外无共享文件改动）。验证：本区域文件 `tsc -p tsconfig.json --noEmit` 0 错误；GUI/真实服务项标注需复验。

| ID | 状态 | 证据（文件:行） | 说明 |
|---|---|---|---|
| P23-02 | 已修复 | `RecoveryPage.tsx:223`（`previewIneligible` = 预览 `allowed===false`）、`:353-372`（不可恢复专属空态：原因 + 「返回原任务」+「重新读取恢复上下文」，隐藏恢复方式卡与创建区） | `allowed:false` 现在是独立结论状态，不再只是禁用创建按钮；原任务/证据不变。真实已完成任务场景需 GUI 复验。 |
| P23-03 | 延后（C9，需 Lead 裁定） | `RecoveryPage.tsx:461-598`（“执行恢复”区块保留） | 恢复页多出的 resume/retry/cancel/skip 与统一任务画布能力重复；报告建议由产品/Lead 确认归属后移回任务画布或补设计增量。属跨页信息架构裁定，本轮不动，避免破坏 E34 已验收能力。 |
| P23-04 | 延后（C1） | `RecoveryPage.tsx:63-119`（TaskContext 仅失败节点错误文本） | 失败原因分组/尝试次数/证据入口需预览或详情返回汇总投影（attempt 数据分散在节点详情），本轮无服务字段，不伪造。 |
| P23-05 | 延后（P3 视觉） | `RecoveryPage.tsx:395-449`（方式卡；差异在下方预览区） | 卡内阶段复制条/图例属视觉结构增强，功能语义已由预览阶段行给出；四主题视觉需 GUI，本轮不做。 |
| P23-06 | 已修复 | `RecoveryPage.tsx:453-473`（创建成功 `banner ok` + 打开草稿、失败 `banner danger`、受理/未知 `banner unknown`）、`:645-650`（派生记录：`TASK_STAGE_LABEL` 中文阶段、恢复方式权限徽标、刚创建标记） | 状态块与派生记录辨识度按设计补齐；需 GUI 复验视觉。 |
| P23-07 | 部分 | `RecoveryPage.tsx:669`（标题随任务/不可恢复变化）、`:671-678`（页头「重新读取恢复上下文」）、`:255-267`（loading 两栏骨架） | 面包屑含父任务标题属全局导航（`app/navigation.ts`，非本任务写范围），记录延后；其余页头/加载态已修。 |
| P24-04 | 已修复 | `RequirementsPage.tsx:294-306`（项目列表读取失败横幅 + 「重试」调用 `projectsQuery.refetch()`，重试中禁用） | 失败可原地重试，不再需整页刷新；仍显示全部需求。 |
| P24-05 | 部分 | `RequirementsPage.tsx:36-41`（行 `aria-selected` + 选中背景）、`:309`（抽屉底部按 `taskHref` 判定画布类型并提示“需求画布继续规划与确认 / 执行画布查看进度与交付物”） | 补选中态与画布分流提示；状态说明段与“当前需求原文”标注未做（P3 细节）。 |
| P24-01 | 延后（C1/C2） | `RequirementsPage.tsx:277-284`（仍为原生 select + 前端过滤） | 可搜索 combo + 服务端 `projectId` 过滤需改 hooks/读模型（`fetchTasks` 丢弃分页/过滤字段）与项目分页；本轮时间不足，记录延后。 |
| P24-02 | 延后（C1） | `RequirementsPage.tsx:167-193` | 需“该项目任务总数”判断项目无需求态；服务按 projectId 过滤能力未接，本轮不伪造计数。 |
| P24-03 | 延后（C1） | `RequirementsPage.tsx:70,120-121,220-237` | `fetchTasks` 封装丢弃 `nextCursor/total`，页面无法服务分页；需先扩读模型（C1）。 |
| P24-06 | 延后（C10，Lead 统一） | `RequirementsPage.tsx:153-165,242-262` | 面包屑/错误文案/页头入口口径与全站导航相关，Lead 已在区域 00/13 统一记录；额外阶段筛选/搜索为设计增量（能力保留）。 |
| P25-01..05, P25-07, P25-09, P25-10 | 延后（C1/C4/C5，本轮时间不足） | `RolesLegacyPage.tsx`、`RolePackageImport.tsx` | 四页签 URL 深链（P25-02）、perms 结构化清单/规则表（P25-03）、prompt 按修订渲染（P25-04）、历史导出/完整快照/比较计数（P25-05）、导入四步状态（P25-07）、错误/空态收敛目录（P25-09）、位置 chip/键盘（P25-10）均需契约或较大重构；本轮未开新改动，记录顺延，避免半成品。 |
| P25-06 | 延后（本轮时间不足） | `RolePackageImport.tsx:27,34`（pending 仅锁导入组件）、`RolesLegacyPage.tsx:119`（页签未锁） | 发布 UNKNOWN 的页面级锁定需把 pending registry 上提到 `RolesLegacyPage` 并联动目录/页签/返回；改动面较大，本轮未做，建议下一批。 |
| P25-08 | 延后（C9） | `RolePackageImport.tsx:47,103`（候选 sessionStorage 持久 + “保留候选并离开”文案） | 与设计“放弃未发布配置包”语义相反，属设计-实现决策差异，需 Lead/产品确认后统一文案或行为。 |

## 逐条补充处置（Lead 收口核对后补录）

| ID | 状态 | 证据 | 说明 |
|---|---|---|---|
| P23-08 | 延后 | 区域报告 P23-08 | 设计为一键创建、实现保留创建前确认对话框（数据诚实的安全确认）；属 C9 设计冲突，需产品确认后统一，不擅自删除确认。 |

