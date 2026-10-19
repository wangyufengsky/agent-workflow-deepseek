# 补稿 v5 · 覆盖表（决定 → 正式入口 · 状态 · 返回 · 证据 · API）

> 设计样例 · 全部模拟。交互记录见 `TEST-REPORT-v5.md`（路径 H、I、J；v4 的 A–G 一并重跑）。

| 决定 / 细则 | 正式入口（只用菜单与页面按钮） | 状态 | 返回 | 截图 | 交互记录 | API |
|---|---|---|---|---|---|---|
| Q10 · PE37 开放 | 任务列表“会员积分体系重构” | PE37 | 面包屑任务列表 | states/pe37-start | H：总览、确认禁用原因、无“后续分期” | S1 S5 |
| 每次继续规划是新的一轮 | PE37 → 继续规划选区 | 预览框（第 N 轮）→ LG-PLANNING | 预览“返回”取消 | states/lg-preview、lg-planning | H：预览第 2 轮、取消、确认开始 | S2 |
| 本轮各有 1 次修订 | LG-CAND | LG-CAND | — | states/lg-cand | H：修订 0 / 1 | S3 |
| 应用 / 停止 / 不采用 | LG-CAND / LG-PLANNING | PE37（applied / stopped / rejected） | 同页 | flows/*-H1 | H：应用后还有 N 组；停止与不采用后仍未细化 | S4 |
| 已细化的组不先执行 | PE37 | PE37 | — | states/pe37-left1 | H：应用确认框写“不会先执行”；未全部细化前确认禁用 | S5 |
| 全部细化后确认 → 准备 → 开始 | PE37（done=3 组）→ 确认 | PE32 → PW-READY → ut-running（T-2060） | 节点详情往返、在需求画布查看 | states/pe37-all、pe32-large、ut-running-large；flows/*-H2 | H：18 步、修订 5、命令不增加历史、节点往返、B08 | S5 S6 |
| Q9 · 角色管理只读 | 需求画布“需求与输入”→ 需求分析师（规划职责）；左侧角色管理 | planning-role | 返回需求画布 | states/planning-role | I：版本、绑定、能力上限、最近使用、不可编辑 | C1 C2 |
| Q9 · 流程目录只读 | 规划职责“查看流程”；左侧流程 | detail-planning | 返回需求画布 | states/detail-planning | I：AI 规划一节、AI 规划标记 | C3 |
| Q6 · 维持现状 + 口径 | 左侧待处理中心 | inbox（规划事项 13 项） | — | states/inbox-plan | J：与任务列表数量一致、不弹窗 | N1 |

## 计数口径

| 计数 | 数 |
|---|---|
| 新增状态 | 4（LG-PLANNING、LG-CAND、planning-role、detail-planning）；变更 1（PE37） |
| 需求画布状态注册表 | 64（v4 62 + 2） |
| 新增 HTML | 0 |
| 原型目录入口 | 95（v4 86 + 9） |
| 交互检查 | 117 步 / 次（v4 85 + v5 32）× 四主题 × 1280 / 1024，另 deepseek 1440 一次；全部通过 |
| 遍历检查 | 193 个 URL × 四主题 × 2 宽度；脚本错误 / 外部请求 / 溢出均为 0 |
