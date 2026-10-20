# 区域 12 · P21 角色管理 / P22 设置 处置记录（2026-10-20）

> 任务：task-8（roles-settings）。基线 `fix/design-audit-2026-10-20`（基于 `main@3f6f9b2`）。
> 权威输入：`docs/review/design-audit-2026-10-20.md`（§0/§3.2/§3.4/§7）与 `docs/review/design-audit-2026-10-20/12-roles-settings.md`（P21/P22）。
> 设计依据：只读 `opencode-workflow-design-showcase/originals/main/pages/{roles,settings}.html` + `originals/main/REVIEW.md` §B-02/§B-03/§B-10/§B-11/§B-12 + `sources/supplement-v5/*`（Q9 规划职责只读）。
> 约束遵守：设计稿目录只读；无 TS enum/namespace；导入带扩展名；颜色只走主题令牌；写操作 `requestKey` + 回执，UNKNOWN 只按原 requestKey 核对、不重发、不伪造发布态；共享文件（`contracts.ts`/`http.ts`）只做最小 `edit`，未整文件重写；未 commit/push/checkout。
> 验证（本轮实际执行）：本任务写范围内 `tsc -p tsconfig.json --noEmit` **0 错误**（收尾复跑时全仓仍夹有其他成员并行编辑产生的区域错误，见文末交接注意 3）；`node --import tsx --test packages/engine/src/role-*.test.ts` 3/3 通过；角色相关集成测试 16/16 通过（roles-api / role-catalog-extended / catalog-request-replay / runtime-role-insights / role-packages）；另起临时服务（`AGENT_WORKFLOW_DATA_DIR=/tmp/...`，端口 5199，禁用 OpenCode）用 curl 实测新增只读发布回执端点与 409 冲突链（证据见各条）。

## 状态汇总

| ID | 严重度 | 状态 | 摘要 |
|---|---|---|---|
| P21-01 | P1 | **已修复** | B-02 已发布版本核对整块：契约 `contentSha256` + 只读发布回执端点 + pub-draft/view/unchecked/loading/error/dep 全可达 |
| P21-02 | P1 | **已修复** | `expectedDraftVersion` + 409 STALE_TARGET；save-unknown/pub-unknown 整页锁定、仅按原 requestKey 核对；pub-conflict 冲突横幅 + 放弃本地修改读取服务器草稿 |
| P22-04 | P2 | **已修复** | 设置保存未明：普通设置只读、保存条“核对中”、banner 内「重新读取」按原请求核对并将 dirty 字段与服务值逐项比对 |
| P22-01 | P2 | 延后（C1） | `openCode.mode`/`baseUrl` 契约在 `packages/shared/src/config/settings.ts`，不在 task-8 写范围；未伪造三卡 |
| P22-02 | P2 | 延后（C1） | `designerMonitorDelayMillis` 等字段同样缺契约；未伪造字段/越界态 |
| P22-03 | P2 | 部分 | 服务端口可编辑（重启生效）+ 运行事实收进“运行信息”折叠 + 缺字段诚实说明；3 个 B-11 字段 C1 |
| P22-05 | P2 | 部分 | 普通设置离开保护（beforeunload + 站内链接拦截 + 设计式确认对话框）；Git 修改未纳入统计（P22-06 未整体重构） |
| P22-06 | P2 | 延后 | Git 账号字段仍是组件本地 state，需整体提升为统一脏状态；本轮只做了保存未明时禁止写入 |
| P22-07 | P2 | 部分 | 服务端口字段的“重启后生效”徽标与保存条重启计数已真实（不再恒为 0）；其余字段仍需服务返回生效清单（C1） |
| P22-08 | P3 | 部分 | 补开关组首 warn 提醒、左侧强调线、“10080 分钟=7 天”换算、关闭态文案；三组卡结构未重排，2 字段 C1 |
| P22-09 | P3 | **已修复** | 保存条补“其中”；issue 态指出首个异常字段（如“设计监控间隔超出范围”） |
| P22-10 | P3 | 交接 task-1 | `AppearanceSection.tsx`/`ThemeSelector.tsx` 归 global-shell，本任务禁止改动，未触碰 |
| P22-11 | P3 | 部分 | 模型服务仍按各自按钮保存（保存条已诚实说明）；统一保存条/服务地址/超时折叠依赖 P22-01 契约 |
| P21-03 | P2 | 部分 | v5 规划职责只读视图：只读徽标、绑定的流程方法与规划策略、能力范围只读、保存/发布禁用、可选返回需求画布；精确版本/摘要/能力上限/最近任务 C1 |
| P21-04 | P3 | **已修复**（建议口径） | 保留检查弹窗形态，按报告建议拆出独立“发布修订 N？”确认对话框；检查/差异仍在弹窗 |
| P21-05 | P3 | 部分 | 补“查看完整权限原文（JSON）”只读弹窗 + 复制；工具行类型中文说明；行级编辑未做 |
| P21-06 | P3 | 延后（C1/C9） | 契约无“可承担的职责类别”字段，未伪造 |
| P21-07 | P3 | 部分 | 页头文案改“历史角色配置”；版本日期列表 / 单步最长运行下拉未改（原因见条目） |

---

## P1

### P21-01 · B-02「已发布版本核对」整块 —— 已修复

- **契约（先行）**
  - `packages/shared/src/api/contracts.ts:1302-1321` 新增 `RolePublishedReceipt` / `RolePublishedReceiptResponse`（精确修订、已核对时间 `readAt`、只读内容 `instructions`/`capabilities`/`allowedSlots`/`resourceCount`、`contentSha256`、从不发布时的 `dependency` 文案）。
  - `contracts.ts:1274` 历史快照补可选 `contentSha256`；`contracts.ts:1246,1248` 目录项补 `draftVersion`/`draftRevision`；`contracts.ts:2354` 新增 `ROUTES.catalogRolePublished(id)`。
- **服务（只读回执，无 requestKey、不写任何状态）**
  - `packages/engine/src/role-catalog.ts:446-478` `publishedReceipt()`：读取当前已发布修订，返回发布内容与 `contentSha256`/`readAt`；从未发布时只返回 `dependency`（不伪造空回执）；职业不存在时 `NOT_FOUND`。
  - `role-catalog.ts:1151-1178` `roleContentSha256()`：对 name/purpose/responsibilities/allowedSlots/instructions/model/maxRuntimeMinutes/capabilityGroups/resourcePermissions/image 做规范化 JSON 后 sha256；不含时间戳，保证同一修订多次读取摘要稳定、发布新修订摘要变化。`role-catalog.ts:438` 历史快照读取时同样派生摘要，旧快照兼容。
  - `packages/server/src/http.ts:1438` `GET /api/catalog/roles/:id/published`（只读，不进写命令白名单）。
- **前端（状态逐条可达）**
  - `apps/web/src/pages/roles/RolesPage.tsx:992-1015` `renderViewSwitch()`：“草稿 rN | 已发布版本”分段 + 右侧只读/草稿说明（草稿态“保存草稿不会生成可执行版本…”；已发布态“只读 · 查看已发布版本不会发布，也不会改动草稿”）。锁定（UNKNOWN）时分段禁用。
  - `RolesPage.tsx:1017-1183` `renderPublished()`：
    - `idle` → 「尚未核对发布回执」+ 主按钮「核对当前发布引用」（pub-unchecked）；
    - `loading` → `aria-busy` 骨架 + “正在读取固定的发布修订…” + 按钮转圈（pub-loading）；
    - `error` → danger 条「没能读取发布修订 / 服务暂时没有响应。草稿和已发布修订都没有变化。」+「重试」+ 空态（pub-error）；
    - `ready` 且已发布 → 只读回执卡：标题「发布修订 N」+「已核对」+「只读」徽标、职业名与“精确修订与草稿/实例/运行中任务相互独立”、右上「核对当前发布引用」、指令只读文档块、能力 chips、`<details>` 内容摘要（7 位短摘要 + 展开完整 + 复制）、底部“核对不会发布新修订/不改草稿/不改变冻结任务…”（pub-view）；
    - `ready` 且从未发布 → info 条「这个职业还没有发布过…」+ 空态「暂无发布修订」（pub-dep）。
  - `RolesPage.tsx:473-507` `readPublished('verify')`：重新读取固定发布引用并与上次修订/摘要比较，给出“发布引用一致：仍为修订 N（内容摘要未变）”或“发布引用已更新为修订 M”，不写入任何状态。
  - `RolesPage.tsx:1673-1683` 职责与指令页签顶部渲染视图切换；头卡（`RolesPage.tsx:1769` 规划职责徽标）与「发布历史」入口（`RolesPage.tsx:1344`，弹窗 `:2024`）保持原样；`apps/web/src/pages/roles/RoleInsights.tsx:20,43` `perm-pv-none` 增加「查看已发布版本」入口/落地，跳转到已发布视图。
  - 样式：`apps/web/src/pages/roles/roles.css:437-561` 按设计 `.rv-*` 类移植（无硬编码颜色，全走令牌）。
- **验证**：临时服务 curl `GET /api/catalog/roles/role.requirement-analyst/published` 返回 `revision r5`、64 位 sha、能力/职责/readAt；发布后再次读取 `r6` 且摘要变化、`readAt` 更新。摘要稳定性在临时引擎脚本中两次读取一致。UI 交互标记**需 GUI**复核。

### P21-02 · save-unknown / pub-unknown / pub-conflict 闭环 —— 已修复

- **契约**：`contracts.ts:1201` `RoleSaveRequest.expectedDraftVersion`；`contracts.ts:1231` `RolePublishRequest.expectedDraftVersion`；`contracts.ts:1246,1248` 目录项暴露 `draftVersion`/`draftRevision`。
- **引擎（409 冲突，不再 last-write-wins）**
  - `packages/engine/src/role-catalog.ts:1188-1197` `assertDraftVersion()`：客户端携带的草稿版本与服务端当前草稿版本不一致 → `AppError(STALE_TARGET)`（`defaultStatus` = **409**），details 含 `currentDraftVersion` / `currentRevision` / `expectedDraftVersion` / `action`；仅当客户端传了版本号时才校验（旧客户端保持兼容）。
  - `role-catalog.ts:281-291` 保存前校验；`:316,319` 保存成功 `draftVersion + 1`；`:373` 发布前校验“发布者检查过的草稿”；发布后记录不再保留 draft/draftVersion（草稿被消费）。
  - `role-catalog.ts:566-583`（`#entry`）与 `:585-599`（`#draftOnlyEntry`）在目录项暴露 `draftVersion`/`draftRevision`。
- **前端（UNKNOWN 只核对、不重发）**
  - `apps/web/src/pages/roles/RolesPage.tsx:363-375` 挂载即读 `pendingForScope(ROUTES.catalogRoleSave)` 并 `subscribePending`，刷新/超时后仍保持锁定。
  - `RolesPage.tsx:441-471` `handleRoleCommandError()`：有 pending → 进入未知锁定（不清 pending、不重发）；`409` → 冲突态；其余 → 明确失败。保存/发布 mutation 均改为先记录本页基线再带 `expectedDraftVersion`（`RolesPage.tsx:617-627`、`:644-682`）。
  - `RolesPage.tsx:509-591` `reconcileRoleCommand()`：只 `GET /api/operations/:key` 核对原请求，并重读目录：
    - 服务已 succeeded → 刷新目录/草稿，提示“原操作已被服务确认成功”；
    - failed → 明确失败、保留本地修改；
    - 仍 unknown/accepted → 保存操作：仅当“本页记录的基线版本被推进且服务器草稿与本地提交完全一致”才 `settleCommand` 解锁（否则保持锁定并提示稍后再核对）；发布操作：仅当目录发布修订相对本页基线已推进才解锁。**任何分支都不重新提交**。
  - `RolesPage.tsx:1814-1846` 页级横幅：save-unknown（“请求已发出但没有收到确认…确认前所有内容保持锁定，不会重新保存”+ 请求号 +「核对原操作」）、pub-unknown（“上一次发布的结果未明…不会重复发布”+ 核对）、版本冲突横幅 +「放弃本地修改，读取服务器草稿」（先弹确认框，`RolesPage.tsx:2188-2202`，操作 `:593-616` 只重读目录草稿，不覆盖服务器内容）。
  - 冲突/未明时保存/发布按钮禁用并给原因（`RolesPage.tsx:790-806`）；`RolesPage.tsx` 页签、职业列表、新建职业同样按锁定禁用。
- **验证（真实服务）**：临时服务 curl 实测——同一职业 `expectedDraftVersion:0` 首次保存 200；第二次仍用 0 保存返回 **HTTP 409 `STALE_TARGET`**（details.currentDraftVersion=1）；用 0 发布返回 **409**；用 1 发布成功并产生新修订 r6。`/api/operations/:key` 核对链复用既有 `fetchOperationByKey`（单测覆盖于 catalog-request-replay）。超时/断网场景标 **需真实服务+GUI**。

### P22-04 · 设置保存结果未明：锁定字段/保存条 + 本页核对入口 —— 已修复

- `apps/web/src/pages/settings/draft.tsx:17-33,46-48,182-244`：`SettingsPendingSave` + context `pending/readOnly/reconciling/reconcile`；`pendingForScope('/api/settings')` 持久化检测（`:228-230`）；`reconcile()` 只 `GET /api/operations/:key` 原请求 + `GET /api/bootstrap` 重读，**不重新提交**；`:79-100` 将 dirty 字段与服务值逐项比对（含目录/主机行的“文本→数组”归一化）。
- `draft.tsx:312,362` 数字/布尔控件在 pending 时 disabled；`apps/web/src/pages/settings/ServiceSection.tsx:31` 根目录文本域、`NetworkSection.tsx:17` 网络字段、`ModelSection.tsx:147,195,280`、`OpenCodeCard.tsx:217,297`、`GitSection.tsx:178,208` 的独立保存按钮在 pending 时禁用并给原因（Git 账号保持可查看）。
- `apps/web/src/pages/settings/SettingsPage.tsx:98-127`：unknown banner 文案改为设计原文语义（“没有收到保存结果…确认前普通设置保持只读；Git 账号仍可单独查看…”）+ 请求号 + 「重新读取」按钮；刷新后若仍有 pending 也显示该 banner。
- `SettingsPage.tsx:130-171`：保存条在 pending 时显示“正在核对上一次保存”、放弃/保存禁用、主按钮“核对中”；
- **验证**：typecheck 通过；`/api/operations/:key` 与 bootstrap 重读路径复用既有真实接口。需 GUI + 真实超时复核。

---

## P2

### P22-01 · B-10「连接方式」三卡（conn-auto）—— 延后（C1，写范围外）

- 设计需要 `openCode.mode`（managed/auto/http）+ 可编辑 `openCode.baseUrl` + 重启生效标识（`settings.html:144-168`、`REVIEW.md:1395-1422`）。
- 当前 `packages/shared/src/config/settings.ts` 的 `OpenCodeSettings` 无 `mode` 字段，且该文件**不在 task-8 写范围**；仅在契约层 `contracts.ts` 加字段无法改变 settings 合并/校验链（`mergeSettings` 深合并、`validateSettings` 会拒绝未知语义）。本轮**未新增三卡、未伪造已保存/未保存标签**。
- 建议：由 Lead 指派服务侧（`packages/shared/src/config/settings.ts` + `validateSettings` + `GET/PATCH /api/settings` 应用顺序）补 `opencode.mode`/`opencode.baseUrl` 与重启应用逻辑后，前端按 B-10 三单选卡 + 服务地址行 + 保存条计数实现。

### P22-02 · B-11「设计监控间隔」与越界校验（monitor/monitor-range）—— 延后（C1，写范围外）

- 设计需要 `designerMonitorDelayMillis`（250–10000ms，越界 `aria-invalid` + “请输入 250 到 10000 之间的整数，上次保存为 1000…”、保存条“有 1 处需要修正 · 设计监控间隔超出范围”），并提到任务状态检查间隔 1–60 秒、中止后清理尝试次数 1–10（`settings.html:160-187`、`REVIEW.md:1434-1457`）。
- 全仓仍无这些字段（`MonitoringSettings` 只有 `pollIntervalMs`/`sessionAlertThreshold`，`settings.ts` 不在写范围）。越界校验基建（`DraftNumberControl` 的 issue → 保存条拦截）已具备，缺字段与文案。
- 本轮未伪造该字段；在 `ServiceSection.tsx:93` 明确标注“B-11 补充稿…当前服务契约没有对应字段，本页不提供可编辑控件”。

### P22-03 · 服务分区字段与设计不符 —— 部分

- **已补**：`ServiceSection.tsx:17-28` 服务端口可编辑（`server.port` 契约已有、`validateSettings` 校验 1024–65535、按“重启后生效”徽标与保存条 restart 计数计入）；`:36-88` 运行事实（应用/运行时/启动时间/服务地址/数据目录/SQLite/JSONL/受管 OpenCode/模型档案）收进「运行信息（只读）」折叠；`:93` 对 B-11 三个缺契约字段做诚实说明。
- **未做（C1）**：「启动时打开浏览器」「任务状态检查间隔」「中止后清理尝试次数」无契约字段；设计“高级”折叠中的 monitor 字段依赖 P22-02。
- 验证：typecheck；服务端 PATCH 会持久化 `server.port`、重启后生效（`engine.updateSettings` → `store.settings.saveSettings`）。需 GUI 复核。

### P22-05 · 离开页面确认 —— 部分

- `SettingsPage.tsx:177-199`：普通设置 dirty 时注册 `beforeunload` 与站内 `<a>` 点击拦截（同源、非同路径），弹出设计式对话框 `:304-327`（“离开前要放弃哪些修改？…全部放弃并离开 / 留在本页”）。
- 未覆盖：Git 账号修改仍不在统一 dirty 统计内（P22-06 未整体重构），对话框只列普通设置；设计要分别列出普通设置与 Git 两类的完整口径未达成。需 GUI 复核。

### P22-06 · Git 分区结构偏差、Git 修改不参与未保存统计（git-dirty）—— 延后

- 现状：`GitSection.tsx:40-52` 的账号字段仍是组件本地 state，不进入 draft 统计；设计要求的“使用这个账号/停用全局账号”单选卡、认证方式、用户名、验证用仓库地址在 `packages/shared/src/config/settings.ts:62-73` 也无字段（C1）。
- 本轮仅做 P22-04 相关部分：保存未明时禁用 Git 写入按钮（`GitSection.tsx:178,208`，设计允许“Git 账号仍可单独查看”）。
- 整体修复需把 Git 账号草稿提升为统一脏状态（导航圆点/保存条计数/离开确认）并拆「验证连接」与「保存 Git 账号」，同时补 Git 账号启用/停用等字段；跨 pages/settings 重构与契约变更超出本轮 P1 优先顺序，建议后续单独立项。

### P22-07 · 「立即生效 / 重启后生效」徽标硬编码、重启计数恒为 0 —— 部分

- 服务端口行（`ServiceSection.tsx:17-28`）已用 `effect="restart"`，因此保存条“其中 M 处需要重启后生效”不再恒为 0（`SettingsPage.tsx:141`），这是设计 dirty 态的关键呈现。
- 其余字段徽标仍由前端按字段硬编码（`shared.tsx:42-91` 的 `EffectBadge`）；设计明确要求以服务端 `appliedLiveFields/restartRequiredFields` 清单为准（`REVIEW.md:1416-1418,1455`），需 C1 补服务字段清单后才可整体去硬编码。
- 验证：typecheck；需 GUI 观察端口修改后的保存条计数。

### P22-08 · 执行限制分组与字段/B-12 结构偏差 —— 部分

- 已补（`LimitsSection.tsx:80-96`）：开关开启时组首 warn 提醒“开启后，超过下列时长的**新任务**会被中断。已在运行的任务不受影响。”；业务超时时长组按设计 `.bx-dep` 用左侧 `--accent-line` 强调线缩进（`settings.css:61-96`）；「任务最大时长」补“上限 10080 分钟，即 7 天”；关闭态说明改为“开启后可以设置最大时长、尝试超时和设计超时。之前填写的时长会保留，关闭期间不生效。”；开关标签下补“默认关闭：任务不会因为运行时间长而被中断”。
- 未做：设计三组卡（并发 / 重试与异常 / 超时）结构未整体重排；“模板任务并发数”“阶段最多尝试”在 `ExecutionSettings` 无字段（C1），未伪造。
- 验证：typecheck；需 GUI 复核 limits-off/on 两态视觉与计数。

### P22-09 · 保存条 issue 文案与“其中” —— 已修复

- `SettingsPage.tsx:135`：issue 态文案改为“有 N 处需要修正 · {首个异常字段 label}超出范围”（如“设计监控间隔超出范围”的设计口径），用户可直接定位标红字段。
- `SettingsPage.tsx:141`：dirty 态补“其中”：“有 N 处未保存的修改 · 其中 M 处需要重启后生效”。
- 验证：typecheck；静态文案对照设计 `settings.html:157,216`。

### P22-10 · 外观分区 —— 交接 task-1（禁止改）

- `apps/web/src/pages/settings/AppearanceSection.tsx`、`ThemeSelector.tsx` 属 task-1（global-shell）写范围，本任务**未修改**；P22-10（减少动态效果三态、主题命名、只读行收敛）随 GLB-07/09 由 task-1 处置。

### P22-11 · 模型服务字段/保存方式差异 —— 部分（契约依赖）

- 模型服务仍按 CLI 路径/运行时/模型档案各自按钮保存；保存条提示已诚实说明（`SettingsPage.tsx` 保存条副文案）。
- 统一保存条、服务地址、三个超时折叠依赖 P22-01 的连接方式契约（`settings.ts` 写范围外）与产品对“模型服务是否并入统一保存条”的裁决；本轮不改动保存语义。
- 已做配套：保存未明时这些独立保存按钮统一禁用（`ModelSection.tsx:147,195,280`、`OpenCodeCard.tsx:217,297`）。

---

## P3

### P21-03 · v5「规划职责（只读）」详情 —— 部分（C1 部分延后）

- 列表：`RolesPage.tsx:1769` 头卡显示「规划职责 · 只读」徽标；头卡说明保留真实绑定数量。
- 只读视图：`RolesPage.tsx:1185-1225` `renderPlanningReadOnly()`：只读说明（“只用于 AI 规划，不出现在流程步骤的‘谁来做’里；修改方式另行决定”）、绑定的流程方法与规划策略（来自 `bootstrap.catalog.methods[].planningStrategy`，`RolesPage.tsx:390-402`）、能力范围只读 chips、服务未提供契约的字段明确说明“不补造”；带 `?taskId=` 时提供「返回需求画布」。
- 只读边界：规划职责职业的保存/发布/编辑禁用并给原因（`RolesPage.tsx:786-806`、`readOnly` 派生 `:761-762`），归档也禁用；切换其他职业/查看发布历史/权限预估仍可用（`roleReadOnly` 与 `readOnly` 分离）。
- **未做（C1）**：精确版本（任务类型/模板/提示词引用与修订）、内容摘要、能力上限（每轮派发/节点/分组/深度）、最近使用任务列表——服务无对应读契约（原报告 P21-03 建议亦标注 C1），未伪造。
- 验证：typecheck；需真实服务+GUI 复核从需求画布往返。

### P21-04 · 发布前检查拆确认步骤 —— 已修复（按报告建议口径）

- 保留设计外“检查弹窗”形态（报告建议允许），但拆出独立确认对话框：`RolesPage.tsx:2161-2188` “发布‘{职业}’{draftRevision}？”+ 设计原文语义（“发布后新建流程步骤可以选用这个修订；已冻结任务继续使用原修订，不会改变”）+「先不发布 / 发布」；发布按钮只打开确认框，真正提交在确认框中执行。
- 验证：typecheck；需 GUI。

### P21-05 · 资源权限细节 —— 部分

- 新增「查看完整权限原文（JSON）」只读弹窗 + 复制（入口 `RolesPage.tsx:1620`，模态 `:1996-2029`；数据即当前草稿 `resourcePermissions`，不含凭据）。
- 工具行来源说明补类型中文标签：原生工具 / 辅助工具 / 外部 MCP（`RolesPage.tsx:123` `toolKindLabel`，用于 `:1523` 行），来源仍显示“来自 …”。
- 未做：工具/文件/资源行级编辑（仍为删除后重加；命令参数已可编辑）。属交互增强，未伪造编辑入口。

### P21-06 · 能力范围「可承担的职责」卡 —— 延后（C1/C9）

- 契约（`packages/shared/src/domain/models.ts`）无职业侧“可承担职责类别/职责位置”字段，`RoleSaveRequest` 也无对应输入；本轮未伪造该卡。
- 建议：按 C9 在产品/设计层裁定“暂不开放”或服务补字段后实现（原报告建议同）。

### P21-07 · 职责与指令/版本/入口局部文案与控件 —— 部分

- 页头入口文案改为“历史角色配置”（`RolesPage.tsx:1917`）。
- 未做：单步最长运行仍为 1–1440 数字输入（设计 mock 为下拉，服务无枚举约束，改成下拉会丢失任意分钟能力，保留并记录）；版本卡未加修订日期列表（发布历史弹窗已提供真实修订列表与时间）。
- 验证：typecheck；静态对照。

---

## 给 Lead 的交接注意

1. **新端点需同步文档**：本任务新增 `GET /api/catalog/roles/:id/published`（只读）。`npm run check:docs-routes` 当前会列出该路由等 18 条未文档化路由（其余为其他成员新增），合并前请统一执行 `npm run docs:api` 并人工检查 `docs/api.md`。
2. **C1 待指派**：P22-01/P22-02 需要 `packages/shared/src/config/settings.ts`（`OpenCodeSettings.mode/baseUrl`、`MonitoringSettings.designerMonitorDelayMillis` 等）+ `validateSettings` + 设置应用/重启生效语义；该文件不在 task-8 写范围，本轮按约定记录 C1、未伪造。P21-03 的精确版本/内容摘要/能力上限/最近任务读契约同样待服务侧。
3. **并发写**：只对 `contracts.ts`/`http.ts` 做最小 `edit`；`npm run typecheck` 在本轮收尾时全仓 0 错误（其他成员并行改动期间曾出现其区域内错误，现已恢复）。若合并前其他成员继续改动导致 typecheck 失败，与本任务文件无关的失败请按各自任务归属处理。
4. **需 GUI/真实服务复核**：B-02 六态交互与「核对当前发布引用」、保存/发布超时后的 UNKNOWN 锁定与核对、409 后“放弃本地修改读取服务器草稿”、设置保存未明只读与「重新读取」、离开确认、B-12 两态视觉。

## 逐条补充处置（Lead 收口核对后补录）

| ID | 状态 | 证据 | 说明 |
|---|---|---|---|
| P22-10 | 已修复（由 task-1 GLB-07/GLB-09 覆盖） | `theme/motion.ts`、`pages/settings/AppearanceSection.tsx`、`theme/themeLabels.ts`（见 00-global-crosscutting.md GLB-07/09） | 外观分区：减少动态效果改为三态控件且有 `<html data-motion>` 消费者；主题命名按设计原文（deepseek 风/claude 风/SPDB/GitHub 白）；移除不实“只读行”。 |

