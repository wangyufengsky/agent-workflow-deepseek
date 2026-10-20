# P05 / P06 PPT 制作与作品 · 设计一致性修复处置（2026-10-20）

> 基线：`main@3f6f9b2`，分支 `fix/design-audit-2026-10-20`（未 commit/push）。权威审计：`docs/review/design-audit-2026-10-20/03-ppt-main.md`。
> 写范围：`apps/web/src/pages/ppt/**`、`packages/engine/src/ppt*.ts`、`packages/shared/src/api/contracts.ts`（PPT 段）、`apps/web/src/api/workflow.ts`（无改动）、本文件。
> 验证：`npm run typecheck`（PPT 相关文件 0 错误）；`node --import tsx --test packages/engine/src/ppt.test.ts`（5/5 通过，P07-23 回归，见 `04-ppt-studio.md`）；`node --import tsx --test tests/integration/ppt-works.test.ts tests/integration/ppt-production.test.ts tests/integration/ppt-plan-stop.test.ts tests/integration/ppt-page-generation.test.ts`（15/15 通过）。

## 结论摘要

- P05 的创作页按设计恢复了独立承载：`/ppt?view=create` 的 hero + 创作框 + 示例想法 + 三步说明卡 + 最近的演示；创建不再折叠在作品库弹窗里（弹窗组件退役为空模块）。
- 创建的失败/超时/UNKNOWN 回执现在渲染在操作发生处（创作框上方），UNKNOWN 锁定输入与提交、按原请求号核对、不换新 key 重发；项目列表读取失败不再误示为“没有项目”。
- P06 作品库修正了页面身份（eyebrow/h1/lede/主操作）、作品卡下一步现场态（方案待确认 / 部分完成 / 检查未通过，带图标与色彩语义）、归档标识、页数角标与网格规格。
- 未完成项集中在契约缺口（创建阶段附件、已导出持久状态、项目文档可选依据）与跨区域共享组件（labels.ts / SegmentedControl 语义 / GLB-08 路由），按 C1/C9 记录。

## 逐条处置

| ID | 状态 | 证据（文件:行） | 说明 |
|---|---|---|---|
| P05-01 | 已修复 | `apps/web/src/pages/ppt/PptCreatePage.tsx:77-160`；`PptCreateForm.tsx:31-190`；`PptPage.tsx`（`view==='create'` 分支 + `?view=create`） | 新增独立创作页：hero（「把想法，整理成一份演示。」）、创作框、3 个示例想法 chip、三步说明卡、最近的演示（真实缩略图 + 阶段 + 相对时间）。作品库页头与空态「新建演示」都进入创作页；`PptCreateDialog.tsx` 退役为空模块并写明迁移原因。设计默认落点与作品库独立路由（GLB-08）不在本区域范围。 |
| P05-02 | 已修复 | `PptCreateForm.tsx:103-150`（项目必选 gate、`开始讨论`、设计 hint）；`:154-171` | 恢复“先选项目再写主题”：未选项目时主题框 disabled、placeholder「选择项目后填写」、项目 hint 用设计原文；主按钮文案回到「开始讨论」；无项目时如实提示“演示归属于项目”并给去项目页入口（不伪造可创建）。 |
| P05-03 | 已修复（更强形态） | `PptCreateForm.tsx:48-49,66-94,154-171`；`PptPage.tsx:140-211,213-233,238-310`（createReceipt 双发布 + verify） | 回执渲染位置改到操作发生处（创作页创作框上方），失败/超时/UNKNOWN 不再被 Modal 遮罩吞掉；UNKNOWN/accepted 时锁定字段与提交，只能按原 requestKey「核对原操作」，不自动重发；`failed` 才允许新 key 重试并保留输入；项目列表读取失败在创作框内显示原因 + 重新读取。旧弹窗层被移除，因此“弹窗内不可见”的根因消除。 |
| P05-04 | 延后（C1 契约） | `PptCreateForm.tsx:130-140`（诚实禁用「添加资料」+ 原因） | 创建 DTO（`contracts.ts` `PptWorkCreateRequest`）不携带附件，服务把创建与 attach 拆成两步；本次按诚实降级在创建阶段禁用并说明“创建后在资料抽屉添加”，未伪造设计 `files` 状态。补齐需先扩创建契约（或创建后串行 attach 回执），留待契约批次。 |
| P05-05 | 已修复 | `PptCreateForm.tsx`（无版式主题控件）；`PptWorkbenchSteps.tsx:250-266`（版式主题下沉到②设计方案） | 创建阶段只保留项目+主题；版式主题选择移到设计方案步骤，且选项文案使用主题名，不再暴露内部 id。 |
| P06-01 | 已修复 | `PptPage.tsx:246-262`（eyebrow「PPT 制作」/ title「全部作品」/ 用户口径 lede / 主操作「新建演示」） | 移除设计没有的「作品/工作台」空操作分段；作品库身份与设计一致。 |
| P06-02 | 延后（C9 设计缺口） | — | 服务无导出持久字段，「已导出」阶段/筛选无法诚实实现；维持不伪标（实现现状已是诚实降级），需产品或契约补齐 `lastExportedAt` 后另做。 |
| P06-03 | 已修复 | `apps/web/src/pages/ppt/ppt-shared.tsx:71-94`（`pptNextAction`）；`PptWorksView.tsx:89-101,127-140` | 作品卡下一步提示按真实现场态：`第 N 页制作中`（run）/`N 页未完成制作`（warn）/`方案待你确认`（wait）/`还没有制作方案`/`N 页检查未通过`（规则检查排除“缺备注”噪声），文字+图标+色彩语义，不再只有通用建议。 |
| P06-04 | 已修复 | `PptWorksView.tsx:78-99,115-125`；`ppt.css`（`[data-archived=true]` 弱化） | 卡片/列表行显示「已归档」徽标并整卡弱化；归档作品与在用作品可区分。 |
| P06-05 | 部分 | `PptWorksView.tsx:52-54`（复制/归档·恢复）；导出入口仍在工作台 `PptStepExport.tsx` | 复制/归档已有真实回执；设计要求作品卡「更多」菜单（含导出）未做：作品库导出需要与“导出为对话框/步骤页”的产品决策（P07-17）一起定，且复制后自动打开副本涉及导航联动，本轮延后。 |
| P06-06 | 已修复 | `PptWorksView.tsx:48-52`（页数角标 + 尚未生成页面）；`ppt.css`（`.ppt-cover[data-small]` 132px、`.ppt-cover` 去示意封面 padding/渐变） | 列表缩略图固定 132px；封面容器改为纯真实 SVG 缩略图，删除半成品示意封面叠加。 |
| P06-07 | 已修复（视觉规格） | `PptWorksView.tsx:48-52`（页数右下角角标）；`ppt.css`（网格 250px/gap18、卡片默认透明边框、hover 才出背景+边框） | 网格密度与卡片 hover 规格对齐设计；页数角标回到缩略图右下角。 |
| P06-08 | 部分 | `PptWorksView.tsx:211`（占位「搜索作品」）、`:253`（归档 switch 语义）、空态文案（设计原文） | 空态/搜索/归档开关语义已对齐；阶段筛选 tab 语义属共享 `SegmentedControl`（GLOBAL/GLB-13 范围），视图切换图标按钮未改，留全局批次。 |
| P06-09 | 延后（写范围外） | — | `packages/shared/src/domain/labels.ts` 不在本任务写范围；PPT 文案仍在 `ppt-shared.tsx` 集中定义，迁移需与全局文案批次一起做。 |
| P06-10 | 已修复 | `PptWorksView.tsx:95,134`（`projectId===undefined`→未归属项目；有 id 但读不到→项目不可用） | 区分“无项目”与“项目数据不可用”，与筛选下拉 fallback 一致。 |

## 验证与未覆盖

- 静态可判定项已按上表修复；折叠/断点/四主题视觉与键盘仍需 GUI 复核（P05-01 创作页、P06-03 三态色彩、P06-06/07 缩略图与网格）。本轮未运行 `npm run dev`、未截图、未做像素对比。
- 创建失败/超时/UNKNOWN 的真实路径未做故障注入（需真实服务制造失败/超时）；锁定与核对逻辑已按 `requestKey` 契约实现，UI 行为需 GUI 验证。
- 契约缺口：P05-04（创建附件）、P06-02（导出持久状态）、P06-09（labels 单一来源）未在本轮闭环。
