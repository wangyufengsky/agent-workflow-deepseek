# P01 主页 / P02 项目 · 设计一致性修复处置（2026-10-20）

> 基线：`main@3f6f9b2`，分支 `fix/design-audit-2026-10-20`（未 commit/push）。权威审计：`docs/review/design-audit-2026-10-20/01-home-projects.md`。
> **本轮受 Lead 20 分钟时间闸门限制**：在区域 01 的 P02 批次完成后停止，不再开新 finding；P01 / P02 剩余项与区域 10（模板/运行内容）整体延后，原因见文末。
> 写范围：`apps/web/src/pages/home/**`、`apps/web/src/pages/projects/**` 等（见 task-11）；实际改动仅 `apps/web/src/pages/projects/ProjectsPage.tsx` 与 `apps/web/src/pages/projects/projects.css`。
> 验证：`npm run typecheck` 本项目文件 0 错误（全仓快照另有其他并行成员文件的错误，见汇报）；静态核对设计 `projects.html:11-25,60-89,103-163`，未运行 GUI。

## 逐条处置

| ID | 状态 | 证据（文件:行） | 说明 |
|---|---|---|---|
| P01-01 | 延后（时间闸门） | — | “进行中”行的待回答数量/执行段号属 `TaskSummary` 契约缺口（C1）；未在闸门前开始修改，未动代码。注意：区域 07 并行批次已补 `TaskSummary.execution/stepStates`，后续可据此按设计句式补全。 |
| P01-02 | 延后（时间闸门 + 写范围） | — | 主页间距/断点值在全局 `apps/web/src/styles/app.css`（不在本任务写范围），且需四主题 GUI 核对；未动代码。 |
| P02-01 | 部分 | `ProjectsPage.tsx` 卡片 `.pfacts`（当前分支/技术栈/任务三格单行）；`projects.css` `.pfacts` | 已恢复设计三格单行事实条；`attentionCount` 改为右上角「N 个需要处理」徽标。任务格诚实写「N 个进行中 · 服务未返回任务总数」——`ProjectSummary` 无 `totalTaskCount/runningCount` 且 `models.ts` 不在写范围（C1），不用“进行中”冒充总数；运行中徽标延后。 |
| P02-02 | 已修复 | `ProjectsPage.tsx`：`GIT_MODE_LABEL` / `workModeOf` / `WorkModeFilter` / 分段 aria-label「工作模式」 | 5 段漂移→设计 4 段（全部/Git 分支/直接目录/不可用，两种不可用聚合）；卡片徽标改设计文案（Git 分支模式/直接执行目录/路径不可用/能力不可用）；能力不可用原因保留在徽标与提示中。 |
| P02-03 | 部分 | `ProjectsPage.tsx`：`pathUnavailable` 仅路径不可用禁用；能力不可用给 info 提示 | 列表卡已按“仅 path_unavailable 禁用开始/模板任务”修正。**未改**：`ProjectDetailPage.tsx` 同款合并禁用（时间闸门内未完成）；`StartPage.tsx` 不在写范围。 |
| P02-04 | 延后（时间闸门） | — | 公约「生成步骤」时间线未接线；`project-detail.css:126-179` 现成样式保留可用。未动代码。 |
| P02-05 | 延后（时间闸门 + C1） | — | 差异视图可前端计算，但「放弃草稿」服务无端点/能力（`ProjectCharterView.capabilities` 只有 generate/edit/confirmWrite），整条未在闸门前完成；未动代码。 |
| P02-06 | 部分 | `ProjectsPage.tsx` 登记抽屉「更多（可选）」内说明 | 抽屉补「更多（可选）」折叠区并诚实说明“创建接口暂不支持 settings（C1），文档目录登记后在项目详情配置”；`CreateProjectRequest` 未扩字段（契约/服务改动延后）。 |
| P02-07 | 已修复 | `ProjectsPage.tsx`：`leaveRegister`/`registerDirty`、Drawer `onClose`、取消按钮、末尾 `Modal「放弃未登记的内容？」` | 目录/名称/说明任一非空时，X/Esc/遮罩/取消统一弹「放弃未登记的内容？」（继续填写/放弃），确认后才关闭并 reset；unknown 态保留原请求核对流程不受影响。 |
| P02-08 | 已修复 | `ProjectsPage.tsx` `projectsQuery.isError` 分支 | 列表读取失败改为设计专用 danger 文案：「项目列表读取失败 / 本地服务没有返回项目摘要。已登记的项目没有受影响。」+ 服务错误细节 + 重试；不再复用通用 ServiceNotice。 |
| P02-09 | 延后（时间闸门） | — | GitLab 页签仍为手填 projectPath；未补“服务暂未提供项目搜索”的输入框旁提示。 |
| P02-10 | 已修复 | `ProjectsPage.tsx`：加载/列表容器 `.project-grid`；`projects.css` | 项目卡专用响应式栅格：两列，`@media(max-width:1100px)` 单列（设计 `projects.html:13-14`），替换固定 `.grid-2`。 |
| P02-11 | 延后（时间闸门） | — | 详情头部「更多→取消管理」、项目信息「文档目录」行、最近任务「全部 N 个」未改。 |
| P02-12 | 延后（时间闸门） | — | 配置状态语义（GitLab「可选」、公约「建议生成」warn）未改。 |
| P02-13 | 延后（时间闸门） | — | 公约页签状态点/空态标题/生成中已运行时长未改。 |
| P02-14 | 延后（时间闸门） | — | Git 账号单选卡/分段认证控件未重排（功能已由现有控件覆盖）。 |
| P02-15 | 已登记（C9/产品扩展） | — | 文档多路径、相关入口卡、Git 仓库事实、公约文件/版本列表等真实数据区块保留，作为设计缺口记录，不建议删除；需设计/验收口径同步。 |
| P02-16 | 部分 | `ProjectsPage.tsx`：`showToolbar`、页头 lede、搜索 placeholder/`.project-search`、刷新 IconButton、4 张骨架、无匹配空态 | 已修：lede 回设计原文；工具栏仅非 loading/error/empty 显示；搜索「搜索名称或路径」280px；右侧刷新图标按钮；加载 4 骨架卡；无匹配空态包 card +「清除筛选」；空态描述回设计；「显示已归档」从页头移入工具栏。**未修**：设计页头顶栏主操作槽位（GLB 范围）与 skeleton 卡片内部结构。 |
| P02-17 | 已修复 | `ProjectsPage.tsx` 归档 Modal | 标题「取消管理这个项目？」；正文含将不再显示/已有任务记录保留/目录文件不会被删除或修改；按钮「保留」ghost +「取消管理」danger；恢复管理用正向 primary，文案区分。 |
| P02-18 | 部分 | `ProjectsPage.tsx` 卡片 `.pfoot` + 更多菜单 | 已修：开始任务恢复 secondary、模板任务 ghost、查看配置右置 ghost、需求目录/重新检测/编辑/复制项目目录/取消管理收进「⋯」菜单，菜单补「查看配置」。**未修**：卡片右上角 hover 更多图标按钮形态（现为底部 details 菜单）。 |
| P02-19 | 延后（时间闸门） | — | 页签 roving tabindex/aria-controls、抽屉初始焦点（Drawer 组件不在写范围）未改。 |

## 统计

- 区域 01 共 21 条：已修复 5（P02-02/07/08/10/17），部分 5（P02-01/03/06/16/18），延后 10（P01-01/02、P02-04/05/09/11/12/13/14/19），P02-15 登记为设计扩展（C9，不计缺陷）。

## 未覆盖 / 风险

- 未运行 GUI/四主题/1024 窄屏；“三格事实条是否换行、`pfacts` 分隔线、`pfoot` 层级、清除筛选空态、登记脏关闭四条路径（X/Esc/遮罩/取消）”均需 GUI 点测。
- P02-01/P02-03/P02-06 都被契约/写范围卡住：`ProjectSummary` 缺任务总数/运行中数、`CreateProjectRequest` 无 settings、`StartPage` 不在本任务写范围；按 C1 记录，未伪造字段。
- 时间闸门原因：Lead 要求在 20 分钟内收尾当前批次；区域 10（模板/运行内容 19 条）整体未开始，见 `10-templates-run.md`。

## 逐条补充处置（Lead 收口核对后补录）

| ID | 状态 | 证据 | 说明 |
|---|---|---|---|
| P02-15 | 延后（C9） | 区域报告 P02-15 | 设计稿没有的区块属产品扩展（如真实运行数据区块），需产品/设计确认后再定去留；本轮不删除真实数据展示，不伪造设计态。 |

