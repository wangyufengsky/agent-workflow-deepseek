# 补稿 v5 · 状态与跳转映射（增量）

> 在 v4 `STATE-MAP.md` 基础上只列新增 / 变化的入口与往返。命令结果仍一律 replaceState（浏览器后退不重放命令）。

## 1. 正常入口

| 入口 | 行 / 事项 | 身份 | 打开 |
|---|---|---|---|
| 任务列表 / 需求目录 | 会员积分体系重构（规划总览） | T-2060 | `planning/requirement.html?state=pe37`（v4 起已是该入口；v5 起可走通） |
| 待处理中心 · 规划事项 | 选择范围继续规划 | T-2060 | 同上 |
| 待处理中心 · 规划事项（v5 补齐） | 发票 / 对账单 / 积分单 / 支付单 / 通知单 / 接口文档整理（待准备工作区）；单元测试开发 r7、详细设计编写 r5（待确认计划） | T-2063…2067、T-2027、T-2070、T-2071 | 与任务列表同一目标 |
| 左侧“角色管理” | 需求分析师（规划职责） | — | `main/pages/roles.html?state=planning-role` |
| 左侧“流程” | 需求开发 r12 / 缺陷修复 r4（AI 规划） | — | `main/pages/workflows.html`（选中后显示“AI 规划 · 只读”）；`?state=detail-planning` 直达 |

## 2. PE37 路径内的跳转

| 从 | 操作 | 到 | URL 事实 |
|---|---|---|---|
| PE37 | 继续规划选区 → 确认开始 | LG-PLANNING | `gp=<组>`、`sim=1` |
| LG-PLANNING | 服务事件到达 | LG-CAND | — |
| LG-PLANNING | 停止规划 → 确认 | PE37（横幅“已停止”） | `stopped=<组>` |
| LG-CAND | 应用到草稿 → 确认 | PE37（横幅“已应用”） | `done+=<组>`、`applied=<组>` |
| LG-CAND | 不采用 → 确认 | PE37（横幅“已不采用”） | `rejected=<组>` |
| PE37（全部细化） | 确认计划 | PE32（工作区页签） | `task=T-2060`，清除 `done/gp` |
| PE32 → PW-READY | 准备 → 开始执行 | `delivery/task.html?state=ut-running&task=T-2060&note=started` | — |
| 统一任务画布 | 更多 → 在需求画布查看 | B08（T-2060） | `returnTo` 回原画布 |

## 3. 目录往返（Q9）

| 往返 | 去 | 回 |
|---|---|---|
| 需求画布 → 规划依据 | `roles.html?state=planning-role&back=<需求画布相对地址>` 或 `workflows.html?state=detail-planning&back=…` | “返回需求画布”回到原状态、原任务（`back` 在点击时取当前地址，含选中与视角） |
| 角色管理 ↔ 流程 | “查看流程” / “需求分析师（规划职责）· 修订 1” | 互相带同一个 `back` |
| 目录 → 最近使用的任务 | 对应任务的需求画布 | 面包屑默认“任务列表” |
