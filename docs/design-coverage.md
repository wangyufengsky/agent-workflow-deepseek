# 设计稿覆盖矩阵

设计来源：`opencode-workflow-design-showcase/`（v5，36 个产品 HTML、468+ 原型状态）。
状态：✅ 已实现并验证（真实数据/服务）｜🟡 部分实现（读口/只读/本地交互，能力受限处禁用并写原因）｜⛔ 未实现（UI 明确未接通，不造假）。

## 1. 主稿页面（originals/main，25 页）

| 设计页面 | 路由 | 后端 | 状态 | 说明 |
| --- | --- | --- | --- | --- |
| home.html | `/` | `/api/bootstrap` | ✅ | 真实统计、进行中、待处理、最近活动、空态/未连接态 |
| start.html | `/start` | catalog + `/api/tasks` | ✅ | 方法卡、项目选择、需求草稿（不调用模型） |
| tasks.html | `/tasks` | `/api/tasks` | ✅ | 阶段胶囊、规划状态、筛选、搜索 |
| task.html | `/tasks/:id` | execution/plan/node | ✅ | 执行画布、执行面板、节点现场、调整计划、交付面板入口 |
| requirement.html | `/requirement/:id` | planning/plan/workspace | ✅ | 五段胶囊、规划状态条、候选/对照图层、检查、应用/确认、准备工作区 |
| requirements.html | `/requirements` | `/api/tasks` | ✅ | 需求目录（筛选/项目/加载更多） |
| inbox.html | `/inbox` | bootstrap.inbox | ✅ | 5 类待处理分组；写动作归画布 |
| projects.html | `/projects` | `/api/projects` | ✅ | 列表 + 登记项目（requestKey/回执核对） |
| git/index.html | `/git`、`/git/:projectId` | `/api/git/*` | ✅ | 读模型、fetch、MR、AI 审查/修复（真实模型验证）、修复分支合并 |
| delivery/* | 任务页交付 | `/delivery/*`、`/delivery/merge`、`/delivery/apply` | ✅/🟡 | 选择/提交/推送/MR/合并/非 Git 应用已接线；真实远端写待验证 |
| node/index.html | 任务页节点面板 | `/nodes/:nodeId` | ✅/🟡 | 事实条、正文/工具、attempts、输出；历史分页/补读未做 |
| databases.html | `/databases` | `/api/settings/databases` | ✅ | 连接管理、探针、只读查询；真实 MySQL 9.2 已验证 |
| roles.html / roles-legacy.html | `/roles` | `/api/catalog/roles` | ✅/🟡 | 草稿/发布/归档/自定义已接线；版本对比/导入未做 |
| templates.html | `/templates` | catalog + `/api/tasks`、`/api/templates/:id/tasks` | ✅/🟡 | 固定模板创建、计划、按模板历史任务已接线；模板编辑/导入未开放 |
| workflows.html / workflow-editor.html | `/workflows` | catalog.methods | 🟡 | 目录只读；编辑未接通 |
| settings.html | `/settings` | `/api/settings`、opencode | ✅/🟡 | 外观/服务/模型/Git 账号与令牌/数据库已接线；OpenCode 自动检测与监控设置未接 |
| tools.html | `/tools` | MCP 目录 + opencode status | 🟡 | 工具目录/状态只读；Skill 源文/开关未接通 |
| knowledge.html / knowledge-history.html | `/knowledge` | — | ⛔ | 页面结构与禁用原因；对话/资料/引用未接通 |
| ppt*.html | `/ppt` | — | ⛔ | 页面结构；制作/导入/作品未接通 |
| recovery.html | `/recovery`、`/tasks/:id/recovery` | `/recovery` API、`/execution/retry` | ✅/🟡 | 派生草稿创建/历史、执行继续/重试失败步骤/停止已接线；单节点放弃未开放 |
| insights.html | `/insights` | bootstrap 统计 | 🟡 | 任务统计真实；用量/质量接口未接通（显示未知） |
| runtime.html | `/runtime` | opencode status/data | ✅/🟡 | 受管服务状态/重启/数据路径；历史与启动控制未接通 |
| run.html / index.html | — | — | ⛔ | 未被菜单引用（设计留档） |

## 2. 规划与执行（sources/planning，PE01–PE38 + B01–B08）

| 状态组 | 覆盖 |
| --- | --- |
| PE01–PE04 开始/预览/配置不足 | ✅ 开始页方法卡；规划预览服务端生成（预算/时限/派发/规模/有效期）；配置不足返回 blockers 与禁用原因 |
| PE05–PE08 长规划/正文/部分草稿 | ✅ 规划轮次、阶段轨道、记录（model_text/tool_activity/service_event）、检查点；SSE/轮询刷新 |
| PE09 检查中 | ✅ 检查层 V1–V8 由确定性校验生成 |
| PE10 有界修订 | 🟡 状态机与 UI 支持「修订」阶段；自动二次派发未启用（引擎只派发 1 次，可手动新一轮） |
| PE11–PE13 问题/预算/补充 | ✅ 问题、假设、保存答复生成输入修订；预算/时限上限原因；补充不改当前轮 |
| PE14–PE17 任务列表/补读/断连/缺口 | 🟡 列表状态、SSE 补播（按 seq）、断连提示；缺口显示为记录顶部说明（未精确内联） |
| PE18–PE24 停止/未知/失败/重启核对 | ✅ 停止请求→停稳→结账；unknown 只核对；失败原因；非自动重试 |
| PE25–PE27 候选审阅/未停稳/硬阻塞 | ✅ 候选图层、四块检查、人工判断逐项勾选、硬问题禁用；候选与当前草稿隔离 |
| PE28 并行写冲突 | ⛔ 设计候选；未开放，UI 按未接通处理 |
| PE29 漂移 | 🟡 输入修订/计划修订版本校验（apply 前），逐项 diff 展示 |
| PE30 历史轮次 | 🟡 轮次数据只读可查；UI 轮次选择器仅当前轮（未做历史视图） |
| PE31–PE32 应用/确认 → 准备 | ✅ apply → confirm → workspace prepare 真实 Git worktree |
| PE33–PE35 执行中调整 | ✅ begin（暂停）→ 编辑标题/验收 → save（新修订、等待重新确认）→ finish（继续，恢复自动推进）；前置依赖编辑未接通 |
| PE36 固定模板只读 | ✅ 模板方法 + 锁定原因，创建后步骤不可改 |
| PE37 大需求总览 | ⛔ 分组总览/选区规划未开放 |
| PE38 局部细化 | ⛔ 后续分期，UI 未开放 |
| B01–B08 基础态 | 🟡 加载/失败/无权限/旧版本/命令未知/取消保留等由真实错误码映射；部分为通用态 |

## 3. 任务隔离与交付（sources/delivery，TD01–TD07）

| 组 | 覆盖 |
| --- | --- |
| TD01 准备（Git/非 Git/空仓库/冲突/漂移/未知/部分） | ✅ Git worktree（基线、分支、五步、冲突/漂移错误）；🟡 非 Git 副本未实现 |
| TD02 执行/并行/待交付/交付后 | ✅ 执行、待交付记录；🟡 子隔离并行未开放 |
| TD03 变更集/大文件/排除 | ✅ Git 变更集与 diff；排除规则/文件树未做 |
| TD04 目标/提交/推送/MR/未知 | ✅ 选择/提交/合并/推送；MR 创建对 GitHub/GitLab 桩服务验证；真实远端写未执行 |
| TD05 非 Git 三方应用 | ✅ 预览/冻结/逐项应用/备份；目录级语义（空目录/ACL）不支持 |
| TD06 清理/保留 | 🟡 清理预览/确认（基础）；阻塞条件未全 |
| TD07 MR 列表/详情 | ⛔ 远端未配置时只读空态 |

## 4. Git 工作台（sources/git，44 状态）与节点详情（60 状态）

- Git：✅ 概览/工作台/提交/文件/diff/分支/fetch/MR 读取；✅ AI 审查与修复后端真实模型验证；🟡 真实远端 push / MR 创建 / 直接合并未端到端。
- 节点详情：✅ 概览/事实条/正文/工具卡/尝试/输出/断连提示；🟡 历史尝试分页、产物读取/下载、来源引用、宽阅读未接通。

## 5. B 类补充设计（B-01–B-15）

| 项 | 状态 |
| --- | --- |
| B-01 恢复工作台 | ✅ 派生草稿、执行继续/重试/停止、跳过节点及下游 |
| B-02/B-03 职业版本/权限预估 | 🟡 修订发布真实可用；权限预估未做 |
| B-04 历史角色配置 | ⛔ |
| B-05 需求高级澄清与规划 | ✅ 合并为需求画布按阶段页签（见 PE01–PE32） |
| B-06 历史模板档案 | ⛔ |
| B-07 快照评审 | 🟡 审查/修复真实可用；快照对比视图未做 |
| B-08 知识研究员检查面板 | ⛔ |
| B-09 PPT 七模块 | ⛔ |
| B-10 OpenCode 自动检测 | ✅ 扫描 PATH/版本目录并探测版本，一键选用；重启生效 |
| B-11 监控间隔 / B-12 会话阈值 | 🟡 断连轮询间隔可配置并生效；会话阈值未接 |
| B-13 五种扩展数据库类型 | 🟡 MySQL/MariaDB/GoldenDB 可连（mysql2），其余类型显示不支持 |
| B-14 Skill 带行号源文 | ⛔ |
| B-15 需求目录详情 | ✅ 需求目录/列表；详情并入需求画布 |

## 6. 说明

- 本矩阵是“设计 → 实现”的覆盖记录，不把 UI 结构存在当作后端能力完成。所有 ⛔/🟡 能力在页面中均以禁用 + 原因呈现。
- 下一步优先级与验收方式见 `docs/remaining-work.md`、`docs/verification.md`。
