# 区域 12 · P21 角色管理 + P22 设置 前端设计一致性审计

> 基线：main @ 3f6f9b2（2026-10-20）。范围：只读设计稿 `opencode-workflow-design-showcase/originals/main/pages/roles.html` 的 25 个 mock 状态（8 原有 + B-02 9 + B-03 7 + v5 planning-role）与 `originals/main/pages/settings.html` 的 17 个 mock 状态（12 原有 + B-10/B-11/B-12 5 个补充态），设计口径见 `originals/main/REVIEW.md` §23/§24、§B-02/§B-03、§B-10/§B-11/§B-12 及 `sources/supplement-v5/`（Q9 规划职责只读）；实现 `apps/web/src/pages/roles/`（RolesPage、RoleInsights、roles.css）、`apps/web/src/pages/settings/`（SettingsPage、draft、shared 与 10 个分区组件）及共享/引擎契约（`packages/shared/src/{api/contracts,config/settings,domain/models}.ts`、`packages/engine/src/role-catalog.ts`、`packages/server/src/http.ts`）。审计方式：静态代码 vs 只读设计稿；未运行 GUI 的部分标注“需GUI”，不做像素级断言；旧审查文档仅作线索，结论均以当前代码核实。

## 概览

| 页面 | 设计状态数 | 已逐项核对 | P0 | P1 | P2 | P3 | 结论 |
|---|---|---|---|---|---|---|---|
| P21 角色管理（roles） | 25 | 是 | 0 | 2 | 1 | 4 | 四页签/头卡/命令参数/B-03 权限预估等主体已实现且有真实服务数据；B-02 已发布版本核对整块缺失、保存结果未明与版本冲突未闭环、v5 规划职责只读缺失 |
| P22 设置（settings） | 17 | 是 | 0 | 0 | 7 | 4 | 分区导航/圆点/底部保存条/外观四皮肤/重试/发布网络/执行限制大部分已实现；B-10 连接方式、B-11 设计监控间隔因契约缺字段整块缺失，生效徽标与保存未明/离开确认/Git 独立保存未按设计闭环 |

**最重要的问题（≤5 条）**

1. `P21-01` B-02“已发布版本核对”整块缺失：无「草稿 vN / 已发布版本」切换、无只读回执卡（指令文档块、能力 chips、内容摘要、核对当前发布引用、只读说明），只剩发布历史弹窗 + 恢复草稿。
2. `P21-02` 保存/发布「结果未明」与 409 版本冲突未闭环：RolesPage 未接入 pending/回执核对，网络超时后不锁定、允许立即重发，无「核对原操作 / 放弃本地修改读取服务器草稿」；契约 `RoleSaveRequest` 无 expectedRevision，409 冲突态不可达。
3. `P22-01` B-10「连接方式」三卡缺失：契约无 `openCode.mode`（managed/auto/http），模型服务分区只有 CLI 路径/职责模型/模型档案，缺服务地址、运行方式、重启后生效徽标与「已保存/未保存」标签。
4. `P22-02` B-11「设计监控间隔」与超范围校验整块缺失：契约无 `designerMonitorDelayMillis` 及 B-11 提到的任务状态检查间隔/中止清理尝试次数，monitor / monitor-range 两状态不可达。
5. `P22-04` 保存结果未明（settings）：只有黄色 banner 与一句“请使用上方核对原操作”，但本页没有核对入口；字段仍可编辑、保存条按钮仍可点（点击静默返回），设计要求的普通设置整体只读 + 重新读取核对未实现。

## 状态覆盖

### P21 角色管理（`opencode-workflow-design-showcase/originals/main/pages/roles.html`）

| mock state | 设计名称 | 实现判定 | 证据（实现文件:行 / 无） | 说明 |
|---|---|---|---|---|
| `overview` | 职责与指令 | 已实现 | `apps/web/src/pages/roles/RolesPage.tsx:713-847,1306-1331` | 名称/标识（只读）/职业定位/职责条目/指令大文本框/模型/单步最长运行 + 头卡保存草稿/检查并发布 + 右侧使用情况与版本；单步最长运行为数字输入而非设计下拉（见 `P21-07`） |
| `caps` | 能力范围 | 部分 | `RolesPage.tsx:849-897` | 服务返回的四组能力（知识与资料/数据/任务/工具，标签与设计一致）胶囊开关 + 顶部“能力范围 vs 资源权限”说明；缺设计 mock 的「可承担的职责」卡（见 `P21-06`） |
| `perms` | 资源权限 | 部分 | `RolesPage.tsx:899-1105`；`RoleInsights.tsx:20-45` | 公式「职业上限 ∩ 项目 ∩ 运行环境 ∩ 冻结范围 = 实际可用」、工具/文件/命令/资源能力四分组、空清单说明、命令参数逐格展示、B-03 权限预估卡均在；缺「查看完整权限原文（JSON）」与工具/文件/资源行的编辑入口（见 `P21-05`） |
| `perm-edit` | 编辑命令参数 | 已实现 | `RolesPage.tsx:570-593,902-975,1040-1070` | 行内展开、每参数一格（placeholder“空参数（保留）”）、可删/加参数、工作区可选、放弃这项修改/应用、“只修改职业草稿，不授予实际运行权限” |
| `subform-block` | 有未应用的权限修改 | 已实现 | `RolesPage.tsx:1282-1294,508-524` | 顶部“还有一项命令参数修改没有应用。”+“回到这项修改”；保存/发布被禁并带原因；新旧职业切换走放弃确认 |
| `publish` | 发布前检查 | 部分 | `RolesPage.tsx:645-682,1498-1561` | 服务 `catalogRoleValidate` 检查项 + 前端对上一修订快照的差异 + “已冻结任务继续使用旧修订”说明；但检查、差异、确认合并在同一弹窗，缺设计的独立检查页区与发布确认对话框（见 `P21-04`） |
| `save-unknown` | 保存结果未明 | 缺失 | 无；`RolesPage.tsx:269-271,361-412,1276-1281` | 仅当本页收到 `unknown/accepted` 回执时 `locked` 才成立（同步保存/发布实际不可达）；网络超时只显示 failure 横幅，不锁定字段、也拿不到 receipt 因而不出现核对入口，保存按钮可再次提交（见 `P21-02`） |
| `appearance` | 形象 | 已实现 | `RolesPage.tsx:1107-1148`；`RoleInsights.tsx:46-49` | 当前绑定/清除、历史形象（无记录显示占位、不用当前形象回填）、服务返回的可选形象；与设计“冻结任务显示当时形象/无记录占位”一致 |
| `pub-draft` | 补充 · 草稿 / 已发布版本切换 | 缺失 | 无 | 职责与指令页签内没有「草稿 vN / 已发布版本」分段切换；`RolesPage.tsx:1306-1331` 只有普通页签 |
| `pub-view` | 补充 · 已发布版本 | 缺失 | 无；近似物 `RolesPage.tsx:1425-1466` | 无只读回执卡（发布修订标题/已核对/只读徽标、指令文档块、能力 chips、内容摘要折叠+复制、底部“核对不会发布/改草稿/改冻结修订”说明）；现有“发布历史”弹窗是修订列表+恢复，不是已发布内容核对 |
| `pub-unchecked` | 补充 · 未核对发布回执 | 缺失 | 无 | 无「尚未核对发布回执」空状态与「核对当前发布引用」入口 |
| `pub-loading` | 补充 · 读取中 | 缺失 | 无 | 无固定发布修订的骨架读取态（`aria-busy` + “正在读取固定的发布修订…”） |
| `pub-error` | 补充 · 读取失败 | 缺失 | 无 | 无“没能读取发布修订 / 重试，草稿与已发布修订都没有变化”态 |
| `pub-dep` | 补充 · 尚未发布 | 缺失 | 无；列表仅显示“未发布” `RolesPage.tsx:1212` | 无“这个职业还没有发布过…发布修订 1 之后才能核对/配置形象/预估权限”的依赖提示与空状态 |
| `pub-dirty-switch` | 补充 · 有本地修改时切换职业 | 已实现 | `RolesPage.tsx:546-568,1563-1580` | 切换职业时弹“放弃未保存的修改？”、“继续编辑 / 放弃修改并切换”，文案含“已发布修订保持原样” |
| `pub-conflict` | 补充 · 版本冲突 | 缺失 | 无；契约 `packages/shared/src/api/contracts.ts:1176-1191` | `RoleSaveRequest` 无 expectedRevision，服务端保存为 last-write-wins（`packages/engine/src/role-catalog.ts:261-320`），409 冲突态不可能出现；也没有冲突横幅与“放弃本地修改，读取服务器草稿”（见 `P21-02`） |
| `pub-unknown` | 补充 · 原操作未结清 | 缺失 | 无；`RolesPage.tsx:1295-1304` 仅内存 receipt 触发的锁定横幅 | 无持久 pending 检查；同步保存/发布超时时拿不到 receipt，因此也没有核对入口；网络超时不会进入该态（见 `P21-02`） |
| `perm-pv-none` | 补充 · 权限预估 · 未核对发布版本 | 部分 | `RoleInsights.tsx:39-41` | 卡内常驻；未核对时仅一行“请先核对精确发布修订。”，无设计的独立空态卡与“查看已发布版本”跳转（B-02 视图缺失连带） |
| `perm-pv-pick` | 补充 · 权限预估 · 待选择位置 | 已实现 | `RoleInsights.tsx:41` | 下拉默认“请选择职责位置”，未选时「读取预估」禁用并有原因；只列发布修订 `allowedSlots`，未登记位置回退“该发布版本的职责位置（目录未登记）” |
| `perm-pv-loading` | 补充 · 权限预估 · 读取中 | 部分 | `RoleInsights.tsx:42` | 有 `aria-busy` 文案“正在读取发布依据与权限上限…”；无骨架屏 |
| `perm-pv-result` | 补充 · 权限预估 · 结果 | 已实现 | `RoleInsights.tsx:43` | 已读取徽标 + 位置/修订/读取时间、限制说明、有效工具上限两列表（用途/工具名）、无诊断时绿色“没有诊断问题” |
| `perm-pv-notools` | 补充 · 权限预估 · 无有效工具 | 部分 | `RoleInsights.tsx:43` | 显示“没有有效工具声明。空清单不表示不受限制。”，缺设计后半句“运行时这个位置不能调用任何工具” |
| `perm-pv-diag` | 补充 · 权限预估 · 有诊断 | 已实现 | `RoleInsights.tsx:43` | 诊断 warn 列表逐条渲染；未登记职责位置按发布原样标注 |
| `perm-pv-error` | 补充 · 权限预估 · 读取失败 | 已实现 | `RoleInsights.tsx:42` | 卡内 danger 条 + “旧预估已清空，可重新核对或读取”；读取失败可再点（对应设计重试） |
| `planning-role` | v5 · 规划职责（只读） | 缺失 | 无；`RolesPage.tsx:350-355,1242-1244` | 列表里该内置职业以普通职业出现，头卡只有“被 N 个流程指定为规划职责”一句；无只读徽标、无绑定的流程方法与规划策略、精确版本（任务类型/模板/提示词引用与修订、内容摘要）、能力上限、最近使用任务与返回需求画布（见 `P21-03`） |

### P22 设置（`opencode-workflow-design-showcase/originals/main/pages/settings.html`）

| mock state | 设计名称 | 实现判定 | 证据（实现文件:行 / 无） | 说明 |
|---|---|---|---|---|
| `service` | 服务 | 部分 | `apps/web/src/pages/settings/ServiceSection.tsx:8-80` | 有允许的项目根目录/断连轮询间隔/会话告警阈值；缺设计的服务端口、启动时打开浏览器、任务状态检查间隔、中止后清理尝试次数与「高级」折叠，且多出应用/运行时/启动时间/服务地址/数据目录/SQLite/JSONL/模型档案只读行（见 `P22-03`） |
| `dirty` | 服务 · 有未保存修改 | 已实现 | `SettingsPage.tsx:113-142`；`draft.tsx:66-87`；`settings.css:12-22,30-58` | 选分区导航琥珀圆点、修改字段琥珀描边、底部保存条“有 N 处未保存的修改 · M 处需要重启后生效”+放弃/保存设置；但重启计数由前端 draft 统计，当前无字段标 restart（见 `P22-07`） |
| `save-unknown` | 保存结果未明 | 部分 | `draft.tsx:95-129,131-149`；`SettingsPage.tsx:97-111` | 请求未明时显示 unknown banner，但字段不锁定、保存条按钮不置灰（save() 内部静默 return）、无“重新读取核对”入口，banner 提到的“上方核对原操作”在本页不存在（见 `P22-04`） |
| `appearance` | 外观（皮肤） | 部分 | `AppearanceSection.tsx:11-39`；`ThemeSelector.tsx:20-71` | 四主题缩略卡（`role=radio`、选中勾、立即生效并写 URL/本地存储）与设计一致；减少动态效果为只读服务值，设计是可编辑三选一（本地）；多出显示模式/界面语言/侧栏收起只读行（见 `P22-10`） |
| `model` | 模型服务 | 部分 | `ModelSection.tsx:38-316`；`OpenCodeCard.tsx:49-336`；`ModelCatalogPicker.tsx:9-26` | 有 OpenCode 可执行文件、运行时开关、默认模型（提供方+模型+刷新+“共 N 个可用模型 · 读取时间”）、职责模型、模型档案；缺设计运行方式 seg、服务地址、超时折叠；各块按独立按钮保存而设计走统一保存条（见 `P22-01`、`P22-11`） |
| `model-refresh` | 读取模型中 | 已实现 | `ModelCatalogPicker.tsx:17-24` | 读取中显示“正在读取可用模型（最多 40 秒）…”；失败显示错误且“旧目录仅供查看，重新读取后才能选择”；读取后显示数量与时间 |
| `limits` | 执行限制 | 部分 | `LimitsSection.tsx:21-90` | 规划限制只读卡 + 可编辑（默认自动推进、验证命令超时）+ 调度策略与业务时限（并发/尝试/暂停/停止等待/会话异常阈值/业务超时三字段）；分组与设计三卡不同、缺模板任务并发数与阶段最多尝试（契约无字段，见 `P22-08`） |
| `retry` | 重试等待 | 已实现 | `RetrySection.tsx:5-24` | 模型限流/会话错误/验证失败各一行，初始/最长并排、说明逐次翻倍、最长<初始前端提示；最小值 0 vs 设计 1–600（见 已核对一致 的备注） |
| `git` | Git 账号 | 部分 | `GitSection.tsx:40-219` | 独立卡片、提交作者/Provider/GitHub/GitLab 地址、独立「保存 Git 账号」、令牌只写不读、连接状态/上次验证、“Git 账号单独保存”说明；缺“使用这个账号/停用全局账号”单选卡、认证方式、用户名、验证用仓库地址；“保存令牌并验证”把保存与验证合并（见 `P22-06`） |
| `git-dirty` | Git 与普通设置都有修改 | 缺失 | 无；`SettingsPage.tsx:35-65,113-142` | Git 修改是组件本地 state，不进入 draft：导航无 Git 圆点、底部保存条不计 Git 未保存、Git 分区无“普通设置还有 N 处未保存”提示、离开无确认（见 `P22-06`） |
| `network` | 发布网络 | 已实现 | `NetworkSection.tsx:5-25` | GitLab 地址/API 地址/允许的 HTTP 主机（逐行校验）/连接超时/请求超时，与设计一致，均走底部保存条 |
| `dev` | 开发辅助 | 已实现（诚实降级） | `DevSection.tsx:5-29` | 设计“显示示例数据”开关在服务契约中无对应字段；实现明确禁用并说明“产品约定不使用示例数据”，不伪造写入（C9）。 |
| `conn-auto` | 补充 · 连接方式自动检测 | 缺失 | 无；契约 `packages/shared/src/config/settings.ts:27-54` | `OpenCodeSettings` 无 mode（managed/auto/http）、无连接方式相关字段，UI 也没有三张单选卡、「已保存/未保存」标签、服务地址说明与“重启后生效”徽标（见 `P22-01`） |
| `monitor` | 补充 · 设计监控间隔 | 缺失 | 无 | 契约与 UI 均无 `designerMonitorDelayMillis`（全仓 grep 无）；服务分区没有“设计监控间隔 250–10000 毫秒”字段/单位/范围/换算提示（见 `P22-02`） |
| `monitor-range` | 补充 · 间隔超出范围 | 缺失 | 无 | 无越界红框、`aria-invalid`、错误说明“请输入 250 到 10000 之间的整数，上次保存为 1000…”、“有 1 处需要修正 · 设计监控间隔超出范围”保存条与服务分区圆点 |
| `limits-off` | 补充 · 执行限制（超时关闭） | 部分 | `LimitsSection.tsx:80-87` | 业务超时开关默认关闭、三个时长字段隐藏、关闭说明有；但缺设计的三组卡结构、开关组首提醒与左侧强调线缩进（见 `P22-08`） |
| `limits-on` | 补充 · 执行限制（超时开启） | 部分 | `LimitsSection.tsx:81-88` | 开关开启后三个分钟字段在 `role="group" aria-label="业务超时时长"` 内展开、范围正确；缺“开启后，超过下列时长的新任务会被中断。已在运行的任务不受影响”warn 提醒与「最大时长 10080 分钟=7 天」换算（见 `P22-08`） |

## 问题清单

### P21-01: B-02「已发布版本核对」整块缺失（pub-draft / pub-view / pub-unchecked / pub-loading / pub-error / pub-dep）
- **严重度**：P1
- **维度**：S / 结构 / D
- **类别**：结构 / 状态 / 数据契约
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/roles.html:260-268`（`pubSeg`：「草稿 vN | 已发布版本」分段切换 + 右侧说明“只读 · 查看已发布版本不会发布，也不会改动草稿”/“保存草稿不会生成可执行版本”）、`:269-286`（已发布回执卡：`发布修订 3` + 已核对/只读徽标、“精确修订与草稿/实例/运行中任务相互独立”、右上「核对当前发布引用」、指令只读文档块、能力 chips、内容摘要折叠显示 7 位短摘要+复制、“核对不会发布/改草稿/改冻结修订”页脚；读取中骨架 `:272-273`）、`:287-299`（未核对空状态、尚未发布依赖提示、读取失败+重试）；`:651-663` 状态表；边界与 React 对应见 `originals/main/REVIEW.md:633-649,665-669,672-682`
- **实现位置**：`apps/web/src/pages/roles/RolesPage.tsx:1306-1331`（职责与指令页签只有普通表单，无草稿/已发布切换）；`:1425-1466`（现有“职业发布历史”弹窗：修订列表 + 恢复为草稿，不是只读回执核对）；`:1498-1561`（发布前检查弹窗才有上一修订差异）；契约 `packages/shared/src/api/contracts.ts:1215-1245`（`RoleCatalogEntry` 顶层即已发布/生效内容、`RoleRevisionSnapshot` 无内容摘要字段）、`:1262-1265`（history 返回修订快照）、`:2116-2157`（路由清单无“读取发布引用/已发布版本”端点）
- **差异**：设计要求的「草稿 / 已发布版本」视图切换、只读发布回执卡（指令文档块、能力 chips、内容摘要短/全长 + 复制、核对当前发布引用、只读页脚）、未核对/尚未发布/读取中/读取失败四个分支全部没有。当前用户只能在发布历史弹窗看到修订列表和“恢复为草稿”，无法像设计那样“核对当前发布的精确内容而不改动草稿”。`contentSha256` 与“核对当前发布引用”的服务语义在契约里不存在，因此至少这两项需先补契约。
- **原因**：直接原因前端未实现已发布视图组件，把“版本”做成了历史弹窗；根本原因 C4（关键区域缺失）+ C1（`contentSha256`、发布引用核对语义/端点缺失）；`pub-loading/pub-error` 另涉 C2。
- **影响**：发布前后核对路径缺失——用户无法确认“当前发布修订到底包含哪些指令/能力”，只能靠发布前检查弹窗的差异猜；B-02 的 9 个状态中 6 个不可达，`perm-pv-none` 的“查看已发布版本”跳转也失去落点。
- **建议**：在职责与指令页签内加分段切换；用 `selected` 顶层（已发布/生效字段）+ `history[0]` 快照渲染只读回执卡（指令块、能力 chips、能力/权限计数、只读徽标、页脚说明），加载/错误态按设计；「核对当前发布引用」先按重新读取 catalog + history 实现，内容摘要需要服务在 DTO 增加 `contentSha256`（C1）。
- **验证**：静态 / 需GUI / 需真实服务（历史与发布状态）
- **关联状态**：`pub-draft, pub-view, pub-unchecked, pub-loading, pub-error, pub-dep, perm-pv-none`

### P21-02: 保存/发布「结果未明」与版本冲突未闭环（save-unknown / pub-unknown / pub-conflict）
- **严重度**：P1
- **维度**：A / S / D
- **类别**：交互 / 状态 / 数据契约
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/roles.html:109`（`LOCK` = pub-unknown）、`:117`（dirty 集合含 save-unknown/pub-conflict）、`:132-144`（保存结果未明 banner“请求已发出但没有收到确认。正在读取草稿核对全部字段与权限是否一致，确认前所有内容保持锁定，不会重新保存”、保存草稿按钮变“核对中”、版本冲突 banner“服务器上的草稿已更新到 v6…你的本地修改和原来的草稿都保留着”+「放弃本地修改，读取服务器草稿」、原操作未明 banner+「核对原操作」）、`:260-268`（LOCK 时草稿/已发布切换禁用）、`:338-340` 状态表；边界见 `opencode-workflow-design-showcase/originals/main/REVIEW.md:648,662-663,666-669`
- **实现位置**：`RolesPage.tsx:269-271`（`isLockingReceipt` 只认本页内存 receipt 的 unknown/accepted）、`:357-359`（`locked` 驱动只读）、`:361-412`（save/publish mutation 只在 onSuccess 写 receipt；网络超时/不可用走 onError 仅 `setFailure`）、`:1276-1281`（failure 横幅）、`:1295-1304`（锁定横幅；「核对」按钮由 `ReceiptNotice` 在 unknown receipt 时提供，但同步保存/发布拿不到 receipt 时不会出现）、`:1270-1275`（ReceiptNotice 仅在拿到 receipt 时渲染）；契约 `packages/shared/src/api/contracts.ts:1176-1191`（RoleSaveRequest 无 expectedRevision / 确认令牌）、`packages/engine/src/role-catalog.ts:261-320`（save 直接写草稿，last-write-wins）、`:351-412`（publish 无期望修订校验）
- **差异**：① 网络超时/断连后请求可能已被服务执行，但页面只显示 failure 文案，**不锁定表单、不清空/保留待核对请求，保存草稿按钮仍可点**（会换新 requestKey 再保存一次）；② 没有设计要求的“读取草稿核对全部字段与权限是否一致”的核对流程——本页虽复用了 `ReceiptNotice`（unknown receipt 时它自带「按原请求号核对」，`apps/web/src/flow/workflow-ui.tsx:114-152`），但 save/publish 是同步 HTTP，超时/断连时根本拿不到 receipt，页面也不会据此进入锁定态；③ 契约没有草稿期望修订/冲突令牌，服务端保存与发布都无法返回 409，`pub-conflict` 的冲突横幅与“放弃本地修改，读取服务器草稿”不可达。与之对比，PPT 区域用 `PptReceiptBanner` 实现了同类的 unknown→仅核对路径（`apps/web/src/pages/ppt/ppt-shared.tsx:285-353`），可复用同类模式。
- **原因**：直接原因 RolesPage 未接入 `pending-commands`/`operations.by-key` 与锁定态；根本原因 C2（保存未明/冲突状态缺失）+ C5（核对与放弃重读交互缺失）+ C1（草稿 expectedRevision / 冲突语义缺失）。
- **影响**：真实的数据安全风险——超时后再次保存可能覆盖他人刚保存的草稿（last-write-wins），且用户无法确认第一次保存是否生效；设计想防的“结果未明重复保存”和“409 保留双份草稿”都没有实现。
- **建议**：接入 `pendingForScope('/api/catalog/roles')` 与 `operations.by-key`：有任何未结清请求时整页锁定（字段/保存/发布/切换/新建），提供「核对原操作」；失败不确定时给出失败/未知分流文案，不要断言“未保存”。冲突侧需服务在 `RoleSaveRequest` 增加 `expectedRevision`（或 draft version）并在不一致时返回 409 STALE_TARGET，前端按设计给“放弃本地修改，读取服务器草稿”。
- **验证**：静态 / 需真实服务（构造超时与并发）/ 需GUI
- **关联状态**：`save-unknown, pub-unknown, pub-conflict, pub-dirty-switch`

### P21-03: v5「规划职责（只读）」详情缺失，且该职业页仍可编辑发布
- **严重度**：P2
- **维度**：结构 / S / 数据契约
- **类别**：结构 / 范围 / 数据契约
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/roles.html:224-226`（v5 Q9：目录只读详情，主流程只露摘要“规划策略 v1 · 需求分析师（规划职责）”；本期只读，不新增顶层页面）、`:227-230`（`back` 返回需求画布条）、`:231-252`（只读详情：职业头“已发布修订 1 + 只读”徽标、说明“只用于 AI 规划…不出现在流程步骤‘谁来做’里”、绑定的流程方法与规划策略（需求开发 r12 → 规划策略 v1，可细化：实现、测试；缺陷修复 r4；文档整理 r2 未配置）、最近使用任务（可回到对应需求画布）、精确版本（职业/任务类型/模板/提示词引用与修订 + 内容摘要）、能力上限（只读资料/不写文件/不跑命令/不调外部服务；每轮派发 ≤2、节点 ≤20、分组 ≤8、深度 ≤2）、本期只读说明）；`:111-116,118-119`（列表项与选中）；`:338-340` 状态；设计决策与互链见 `sources/supplement-v5/DESIGN-DELTA-v5.md:30-40`、`sources/supplement-v5/STATES-v5.md:11`、`sources/supplement-v5/STATE-MAP-v5.md:12,28-33`、`sources/supplement-v5/COVERAGE-v5.md:13`
- **实现位置**：`RolesPage.tsx:350-355`（仅计算“被哪些流程指定为规划职责”的方法列表）、`:1242-1244`（头卡一句“被 N 个流程指定为规划职责”）、`:289-290`（支持 `?roleId=` 选中）、`:713-847`（页面仍是通用的可编辑职责表单，保存草稿/检查并发布可用）；`RoleInsights.tsx:12-19`（使用情况含 `planning` 标记）；契约 `packages/shared/src/domain/models.ts:163-171`（`WorkflowMethod.planningStrategy {id, version, roleId}` 有）、`packages/shared/src/api/contracts.ts:2199-2203`（insights 只有 published revision/allowedSlots 与 usage），无任务类型/模板/提示词引用、内容摘要、最近任务、能力上限端点
- **差异**：v5 的目录只读详情整体没有：列表没有“规划职责 · 只读”标记，头卡没有只读徽标与职责边界说明，没有绑定的流程方法/规划策略列表（只给数量），没有精确版本（任务类型/模板/提示词）、内容摘要、能力上限、最近使用任务，也没有 `back` 返回需求画布；同一职业页面仍允许编辑草稿与发布，与“本期在目录里只读；修改方式另行决定”的边界不符。
- **原因**：直接原因前端未实现 v5 规划职责视图；根本原因 C4（区域缺失）+ C1（精确引用/摘要/最近使用/能力上限的读契约缺失）+ C5（只读边界与 `back` 往返）。
- **影响**：v5 新增的“目录里只读查看规划职责”能力不可用；从需求画布/流程详情进入规划职责（`/roles?roleId=…`）会落到可编辑页，用户可能误改内置规划职责；跨页互链只完成了一半。
- **建议**：按设计加只读规划职责视图（可从列表点击或 `?roleId=` 进入时自动只读）+ 返回条；数据先用现有 `planningStrategy` 绑定与 insights usage 渲染方法/策略/最近任务，能力上限与精确版本需要服务补读契约（C1）；规划职责在只读视图内隐藏保存/发布。
- **验证**：静态 / 需真实服务 / 需GUI（与需求画布往返）
- **关联状态**：`planning-role`

### P21-04: 发布前检查以单个弹窗替代设计的检查页 + 发布确认对话框
- **严重度**：P3
- **维度**：结构 / A
- **类别**：结构 / 交互
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/roles.html:152-156`（`publish` 态：「发布前检查 · 草稿 v5」独立页区，检查清单逐项 + 右侧「与修订 3 的差异」+ 底部“检查通过，可以发布为修订 4”+「发布修订 4」）、`:101-104`（`pubDlg` 确认对话框：“发布‘软件工程师’修订 4？发布后，新创建的流程步骤可以选用这个修订。已经冻结了修订 3 的任务继续使用修订 3，不会改变。”按钮“先不发布 / 发布”）；`opencode-workflow-design-showcase/originals/main/REVIEW.md:475`（逐项检查结果与差异，确认后发布；对话框说明已冻结任务不受影响）
- **实现位置**：`RolesPage.tsx:645-682`（`checkAndPublish`：校验后再读 history 取上一修订，客户端 `compareDrafts` 算差异）、`:1498-1561`（“发布前检查”弹窗 = 检查项 + 差异 + info 横幅 + 发布按钮直接提交）
- **差异**：检查、差异、发布确认三步合并在一个弹窗；没有设计里的页面级检查区（页签仍是草稿态）和第二个“发布修订 N？”确认对话框。发布按钮在弹窗里直接调用 publish，冻结任务不受影响的说明是 info 横幅（与设计对话框正文语义一致）。
- **原因**：直接原因实现把该状态做成单一 Modal；根本原因 C4（页面区结构）+ C5（独立确认步骤）。
- **影响**：能力完整、风险低；与设计的分区/确认层级不一致，单弹窗里按钮“发布修订 N”承担了确认职责。
- **建议**：可保留弹窗形态但拆出确认步骤（点击发布后弹设计原文的确认框）；或在职责与指令页签内渲染设计式检查页区。
- **验证**：静态 / 需GUI
- **关联状态**：`publish`

### P21-05: 资源权限细节缺失（完整权限原文、行级编辑、来源说明）
- **严重度**：P3
- **维度**：结构 / T
- **类别**：结构 / 文案
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/roles.html:185`（每行 `kind` 标签 + 内容 + 编辑/移除图标，`acts` 悬停显现）、`:195-206`（工具/文件/命令/资源能力四个分组；`:206` 底部「查看完整权限原文（JSON）」按钮）、`:196-198`（工具行补充“· 原生工具 / · opencode-workflow 辅助 / · 来自 example.docs.mcp”）；`opencode-workflow-design-showcase/originals/main/REVIEW.md:472`（每行类型标签 + 可读内容）
- **实现位置**：`RolesPage.tsx:1002-1098`（工具/文件/资源能力行只有移除按钮 `:1012,1031,1082`；命令行有编辑+移除 `:1058-1059`）、`:1099-1102`（结尾只有说明与权限预估卡，无 JSON 原文入口）、`:1008-1009`（工具只显示 `kind` 大写 + “来自 source”，无“原生工具/辅助工具”说明）
- **差异**：没有“查看完整权限原文（JSON）”入口；工具/文件/资源能力行不支持编辑（只能删除后重新添加，命令除外）；工具来源说明比设计简略。能力等价性保留（增删可达），但设计要求的逐行编辑与原文核对入口缺失。
- **原因**：直接原因未实现行级编辑与原文弹层；根本原因 C4 + C3。
- **影响**：改一项工具/文件权限要删了重加，操作成本与误删风险更高；无法像设计那样核对权限声明的完整原文。
- **建议**：补行级编辑（复用添加表单改造为编辑表单）与“完整权限原文”只读 JSON 弹窗（数据即 `resourcePermissions`）；工具行补 kind 中文说明。
- **验证**：静态 / 需GUI
- **关联状态**：`perms`

### P21-06: 能力范围缺「可承担的职责」卡片
- **严重度**：P3
- **维度**：结构 / 数据契约
- **类别**：结构 / 数据契约
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/roles.html:180`（能力范围底部“可承担的职责”卡：勾选“流程中的‘实施’类步骤”，说明“流程画布中只有勾选了的职责才会出现在‘谁来做’的选项里”）
- **实现位置**：`RolesPage.tsx:849-897`（只有四组能力胶囊与说明，无承担职责区）；契约 `packages/shared/src/domain/models.ts:163-171`（`WorkflowMethod`/步骤有 `roleId`“谁来做”，但职业侧没有“可承担职责类别”字段）
- **差异**：设计的能力范围包含“可承担的职责”，实现没有；当前契约里没有职业侧承担职责声明（谁来做由流程步骤的 roleId 指定），因此该项需要服务字段才能实现。
- **原因**：直接原因未实现该卡；根本原因 C1（契约无承担职责字段）+ C4（区域缺失）。
- **影响**：用户无法像设计那样通过职业声明可承担的步骤类别；流程画布的“谁来做”仍能按 roleId 选择（能力未阻断，只是设计新增声明面缺失）。
- **建议**：若要与设计对齐，需要服务在职业草稿加“可承担步骤类别/职责位置”字段并在流程画布过滤；否则在设计中标注该卡暂不开放（C9，交 Lead）。
- **验证**：静态 / 需真实服务
- **关联状态**：`caps`

### P21-07: 职责与指令/版本/入口的局部文案与控件差异
- **严重度**：P3
- **维度**：T / 结构
- **类别**：文案 / 结构
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/roles.html:136`（头卡使用情况一句“被 4 个流程的 9 个步骤使用”）、`:168-169`（模型与“单步最长运行”均为下拉：跟随设置（60 分钟）/30/120）、`:172-173`（右侧“使用情况”按流程列步骤数；“版本”列草稿 v5 编辑中 / 修订 3 当前发布 / 修订 2 日期）、`:121-125`（页头「历史角色配置」「新建职业」）；`CLAUDE-设计结果.md` 第 7 条（新入口「历史角色配置」，实现应常驻页头）
- **实现位置**：`RolesPage.tsx:1242-1244`（头卡“被 N 个流程指定为规划职责”+ 紧凑使用情况“N 个流程 · M 个模板 · 冻结 X 步骤”）、`:793-810`（单步最长运行为 1–1440 数字输入，非下拉）、`:818-843`（版本卡：当前发布/提示词修订/草稿 + 发布历史与归档按钮，无修订日期列表）、`:1344-1346`（页头按钮文案“历史配置”）
- **差异**：使用情况/版本文案与设计不同（实现为真实聚合数据，设计为示例数据；语义方向一致）；单步最长运行控件类型不同；页头入口文案短于设计的“历史角色配置”（实现常驻页头，符合 CLAUDE 的实现说明）。
- **原因**：C3（文案）+ C4（控件/信息布局差异）。
- **影响**：逐字对比会差异；不影响操作。
- **建议**：页头文案改为“历史角色配置”；单步最长运行如无服务枚举约束可改下拉（跟随设置/30/60/120 + 自定义）；版本卡补修订日期列表或明确“发布历史”入口。
- **验证**：静态 / 需GUI
- **关联状态**：`overview, appearance`

### P22-01: B-10「连接方式」三卡整块缺失（conn-auto）
- **严重度**：P2
- **维度**：S / 结构 / 数据契约
- **类别**：结构 / 状态 / 数据契约
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/settings.html:160-168`（`conn-auto`：模型服务分区内“连接方式”行，说明“选择只改动草稿，保存并重启程序后生效”+「重启后生效」徽标；三张单选卡；“服务地址”常驻并说明“选择‘自动检测’或‘连接现有服务’时会用到这个地址”；底部保存条“有 1 处未保存的修改 · 其中 1 处需要重启后生效”；分区导航模型服务圆点）、`:144-152`（MODES 三项与单选卡、已保存/未保存标签、`pickMode` 只改草稿）、`:154-158`（保存条计数/放弃/保存）；实现口径与边界见 `opencode-workflow-design-showcase/originals/main/REVIEW.md:1395-1422`（managed/auto/http 三实际值、字段 effect 沿用 `fieldEffect`、保存条文案）
- **实现位置**：`apps/web/src/pages/settings/ModelSection.tsx:38-316`（只有 OpenCode 可执行文件/运行时开关/职责模型/模型档案，无连接方式与服务地址）；`OpenCodeCard.tsx:49-336`（用运行状态卡替换：状态/进程/MCP/并发/重启/日志/自动检测）；契约 `packages/shared/src/config/settings.ts:27-54`（`OpenCodeSettings` 无 mode/baseUrl 编辑语义、无连接方式枚举）
- **差异**：设计的连接方式三卡、每项一句说明、“已保存/未保存”标签、“服务地址”常驻说明、重启后生效徽标与保存条计数全部缺失；模型服务字段按独立按钮保存（路径/运行时/模型档案），未进入底部保存条。服务契约当前是单一受管运行时 + 自动检测扫描，没有 managed/auto/http 三态字段。
- **原因**：直接原因前端没有连接方式控件；根本原因 C1（`openCode.mode`/服务地址语义缺失）+ C4（区域缺失）；保存模型差异属 C5。
- **影响**：B-10 的 conn-auto 状态（唯一一个以“连接方式”为核心的补充态）完全不可达；设计要求的“点选只改草稿、保存并重启生效”的交互也不存在，用户只能在运行状态卡里重启 OpenCode。
- **建议**：先定契约：`openCode.mode`（managed/auto/http）+ `openCode.baseUrl` 可编辑 + 重启生效标识；前端按 B-10 做三张单选卡、已保存/未保存标签、服务地址行与保存条；若产品明确只保留受管运行时，则应把该设计项登记为不开放（C9）并更新设计说明。
- **验证**：静态 / 需真实服务
- **关联状态**：`conn-auto, model`

### P22-02: B-11「设计监控间隔」及超范围校验整块缺失（monitor / monitor-range）
- **严重度**：P2
- **维度**：S / 结构 / 数据契约
- **类别**：结构 / 状态 / 数据契约
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/settings.html:174-187`（服务分区高级内的「设计监控间隔」：毫秒、范围 250–10000、说明“设计阶段状态的检查间隔”、生效徽标、换算“1000 毫秒即每秒检查一次”；`:183` 越界时输入框标红、`aria-invalid`、“请输入 250 到 10000 之间的整数，上次保存为 1000。修正前不能保存。”、保存条“有 1 处需要修正 · 设计监控间隔超出范围”、服务分区圆点；`:186` 越界保存条禁用保存）、`:142-143`（带 invalid 的数字控件）、`:154-158`（保存条 fix 态）；`opencode-workflow-design-showcase/originals/main/REVIEW.md:1434-1443,1445-1457`
- **实现位置**：`apps/web/src/pages/settings/ServiceSection.tsx:83-114`（只有“断连轮询间隔”500–30000ms 与“会话告警阈值”1–100 个会话）；契约 `packages/shared/src/config/settings.ts:147-152`（`MonitoringSettings` 只有 pollIntervalMs/sessionAlertThreshold）；全仓 grep `designerMonitorDelayMillis`、`monitorDelaySeconds`、`abortCleanupAttempts` 均无结果
- **差异**：设计的“设计监控间隔”字段、单位/范围/换算、越界错误与保存条 fix 态、服务分区圆点都没有；实现用的是 SSE 断连轮询间隔与会话告警阈值，语义不同（前者是任务页轮询，后者是会话数量告警，均不是设计监控间隔）。B-11 还要求同组两个字段（任务状态检查间隔 1–60 秒、中止后清理尝试次数 1–10）写法一致，这两个字段在契约里也不存在。
- **原因**：直接原因前端没有该字段；根本原因 C1（服务无 designerMonitorDelayMillis/monitorDelaySeconds/abortCleanupAttempts）+ C2（无越界状态分支）；校验基建（`draft.tsx` 的 issue 机制）本身已具备，缺的是字段与文案。
- **影响**：B-11 的两个状态不可达；设计要求的“越界前不能保存”的展示无处体现（现有数字控件对所有字段都能显示 issue，但没有这个字段）。
- **建议**：需服务在 `MonitoringSettings` 增加 `designerMonitorDelayMillis`（250–10000，重启/热生效按服务实现）等字段；前端复用 `DraftNumberRow` 的 issue/保存条 fix 机制补字段与文案。若服务不开放，登记 C9。
- **验证**：静态 / 需真实服务
- **关联状态**：`monitor, monitor-range`

### P22-03: 服务分区字段与设计不符（缺服务端口/启动打开浏览器/检查间隔/清理次数，多出运行事实）
- **严重度**：P2
- **维度**：结构 / T / 数据契约
- **类别**：结构 / 数据契约
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/settings.html:97-105`（服务分区：“服务端口”（`num(8080,1,65535)` + 重启后生效）、“启动时打开浏览器”（switch + 重启后生效）、“允许的项目根目录”（留空任意、说明）、`:103-104` 高级折叠（任务状态检查间隔 5 秒 1–60、中止后清理尝试次数 3 次 1–10）、`:105` 启动配置文件（只读）路径）；`opencode-workflow-design-showcase/originals/main/REVIEW.md:490-495`
- **实现位置**：`ServiceSection.tsx:8-80`（只读应用/运行时/启动时间/服务地址/数据目录/SQLite 数据库/事件日志/受管 OpenCode/模型档案 + 允许的项目根目录 + 断连轮询间隔 + 会话告警阈值；`OpenCodeCard.tsx:49-336` 作为第二块）；契约 `packages/shared/src/config/settings.ts:139-151`（`ServerSettings` 有 `port`，但没有“启动时打开浏览器”“任务状态检查间隔”“中止后清理尝试次数”）
- **差异**：设计的服务端口没有可见/可编辑控件（契约里有 `server.port` 但前端未暴露）；启动时打开浏览器、任务状态检查间隔、中止后清理尝试次数在契约与 UI 中都没有；高级折叠与启动配置文件路径展示没有；实现多出 10 行只读运行事实（设计没有），并把断连轮询/会话告警这两个新字段放在服务分区（设计无）。
- **原因**：直接原因服务分区按产品当前字段重写；根本原因 C4（区域结构/字段缺失）+ C1（三个设置字段不存在）；`server.port` 属于 C4（可补 UI）。
- **影响**：设计 B-11 的入口（服务 → 高级）不存在；用户无法查看/修改服务端口；与设计逐项对比大面积差异；但运行事实对排障有价值（建议保留并补设计说明）。
- **建议**：补服务端口可编辑行（标注重启后生效）与启动打开浏览器（若服务新增字段）；把“断连轮询间隔/会话告警阈值”明确标注为产品新增并在设计说明记录；服务分区如需保留运行事实，建议收进“运行信息”折叠区，与设计可编辑字段分开。
- **验证**：静态 / 需GUI
- **关联状态**：`service, dirty`

### P22-04: 保存结果未明（save-unknown）未锁定、无重新读取核对入口
- **严重度**：P2
- **维度**：S / A
- **类别**：状态 / 交互
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/settings.html:214`（save-unknown：unknown banner“没有收到保存结果 / 正在重新读取设置，核对 2 处修改是否已经生效。确认前普通设置保持只读；Git 账号仍可单独查看。”+「重新读取」按钮）、`:216`（保存条文案变“正在核对上一次保存”，放弃/保存按钮禁用、主按钮显示“核对中”）、`:223` 状态表；`opencode-workflow-design-showcase/originals/main/REVIEW.md:498`（保存结果未明：普通设置只读，Git 仍可查看）
- **实现位置**：`apps/web/src/pages/settings/draft.tsx:95-129`（`saveMutation.onError`：`pendingForScope('/api/settings')` 存在时设 unknown 文案“请使用上方‘核对原操作’。核对前保留修改并禁止再次保存。”）、`:131-149`（`save()` 在 pending 时静默 return）、`SettingsPage.tsx:97-111`（SettingsSaveMessage 仅渲染 banner，无核对按钮/重新读取）、`:113-142`（保存条只在 issueCount/saving 时禁用，pending 时按钮仍可点）。
- **差异**：① 页面没有设计要求的「重新读取」核对入口，banner 却让用户使用“上方核对原操作”（该控件不存在）；② 字段与保存条未进入只读/禁用态，点击“保存设置”无反馈地什么都不做；③ 没有“正在核对上一次保存”的保存条文案；④ Git 分区确实可独立查看（与设计一致）。
- **原因**：直接原因前端只用了 pending 检测写文案，没有做锁定与核对交互；根本原因 C2（未明状态渲染不完整）+ C5（核对/重读操作缺失）。
- **影响**：用户看到“结果未明”后无法继续或核对，只能刷新页面猜测；按钮可点但无反应，容易重复操作或误以为已保存。
- **建议**：pending 时把普通设置区整体只读、保存条按钮禁用并显示“正在核对上一次保存”；提供「重新读取」按钮（重新 GET `/api/bootstrap`，对比 dirty 字段与当前服务值后给出“已生效/未生效”结论，再决定清除或保留草稿）；文案不要指向不存在的控件。
- **验证**：静态 / 需真实服务（构造超时）/ 需GUI
- **关联状态**：`save-unknown`

### P22-05: 离开页面确认缺失
- **严重度**：P2
- **维度**：A / 结构
- **类别**：交互 / 状态
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/settings.html:78-81`（`leaveDlg`：「离开前要放弃哪些修改？普通设置有 2 处未保存修改；Git 账号有 1 处未保存修改（含新的访问令牌）。」按钮“留在本页 / 全部放弃并离开”）；`opencode-workflow-design-showcase/originals/main/REVIEW.md:497`（离开时如果两边都有修改，对话框分别列出要放弃的内容）
- **实现位置**：无；`SettingsPage.tsx:208-252` 为整页结构，`draft.tsx`/各分区均无 `beforeunload`/路由阻止/离开确认（grep `beforeunload|useBlocker` 无结果）；Git 修改甚至不进入 draft（见 `P22-06`），也无从计数
- **差异**：设计要求的离开前确认（普通设置与 Git 两类修改分别列出）完全没有；用户带着未保存修改跳到别的分区/页面/刷新会直接丢失，且不会得到任何提示。
- **原因**：直接原因未实现离开保护；根本原因 C5（确认/草稿保护）+ C2（未保存状态不可见的部分见 `P22-06`）。
- **影响**：设置与 Git 修改容易静默丢失；与设计明确要求的防丢确认不符。
- **建议**：用 `useBlocker`（react-router）拦截页内导航 + `beforeunload` 拦截刷新/关闭，弹设计原文的确认对话框，分别列出普通设置与 Git 待放弃项；Git 修改需先纳入统一脏状态（见 `P22-06`）。
- **验证**：静态 / 需GUI
- **关联状态**：`dirty, git-dirty, save-unknown`

### P22-06: Git 账号分区结构偏差，且 Git 修改不参与未保存统计（git-dirty 不可达）
- **严重度**：P2
- **维度**：结构 / S / A
- **类别**：结构 / 状态 / 交互
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/settings.html:125-135`（Git 账号：“账号”行 + 未保存徽标、单选卡“使用这个账号 / 停用全局账号”（说明“继承全局的项目都用它 / 改用系统 Git 凭据”）、服务器、用户名、认证方式（访问令牌/密码）、访问令牌、验证用仓库地址（验证时必填）、「验证连接」与「保存 Git 账号」分开、底部“Git 账号单独保存，和下方的‘保存设置’互不影响”）、`:89,91,217`（git-dirty：Git 与普通设置都有修改时，导航 Git 圆点 + Git 分区底部“普通设置还有 1 处未保存（模型服务）·去查看”）；`opencode-workflow-design-showcase/originals/main/REVIEW.md:496`
- **实现位置**：`GitSection.tsx:40-219`（提交作者名称/邮箱、默认 Provider、GitHub/GitLab 地址与 API、工作区分支前缀/根目录/默认测试命令只读、会话令牌输入 + 连接状态/上次验证、「保存 Git 账号」、「保存令牌并验证」、「验证连接」）；`SettingsPage.tsx:35-65`（导航 Git 项）、`:113-142`（保存条只统计 draft 字段）、`:239-241`（圆点来自 draft sections）；`GitSection.tsx:43-52`（Git 账号作者等用组件本地 `useState`，不进入统一 draft）
- **差异**：① 缺设计的两张单选卡（使用/停用全局账号）与认证方式切换、用户名、验证用仓库地址——“保存令牌并验证”把保存与验证合并，而设计要求保存与验证分开；② Git 账号修改保存在组件本地 state，不参与底部保存条的未保存计数、导航圆点与离开保护，`git-dirty` 状态不可达；③ Git 分区内没有“普通设置还有 N 处未保存”的提示；④ 服务契约无“全局账号启用/停用”“认证方式”“用户名”“验证用仓库地址”字段（`packages/shared/src/config/settings.ts:62-73`）。
- **原因**：直接原因前端 Git 保存独立于统一 draft；根本原因 C4（区域结构差异）+ C5（保存/验证分离、脏状态与离开保护）+ C1（若干 Git 字段契约缺失）。
- **影响**：Git 修改未保存时用户完全无提示（切区即丢、刷新即丢）；设计的“Git 与普通设置都有修改”状态不可达；保存+验证合并可能让用户在验证失败时不清楚令牌是否已经保存。
- **建议**：把 Git 账号字段纳入统一 dirty 统计（或明确独立脏状态并进入离开确认与导航圆点）；按设计拆开「验证连接」与「保存 Git 账号」；缺失字段（启用/停用、认证方式、用户名、验证仓库）需服务契约补充（C1），否则在设计中标注不开放。
- **验证**：静态 / 需真实服务 / 需GUI
- **关联状态**：`git, git-dirty`

### P22-07: 「立即生效 / 重启后生效」徽标由前端硬编码，非服务字段清单；重启计数恒为 0
- **严重度**：P2
- **维度**：D / T
- **类别**：数据语义 / 文案
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/settings.html:25-26,92`（`.eff.now` 立即生效 / `.eff.restart` 重启后生效，每字段由 `eff(r)` 标注）；`opencode-workflow-design-showcase/originals/main/REVIEW.md:1416-1418`（B-10：生效徽标沿用 `fieldEffect`，`restartRequiredFields` 显示“重启后生效”、`appliedLiveFields` 显示“立即生效”，以服务端返回的字段清单为准）、`:1455`（B-11：生效徽标由 `fieldEffect('runtime.designerMonitorDelayMillis')` 决定，以服务端返回的字段清单为准）；`:491`（每字段名称+说明+生效徽标）
- **实现位置**：`apps/web/src/pages/settings/shared.tsx:42-91`（`SettingsEffect` 五值 + `EffectBadge`；调用处逐字段硬编码 effect）、`ServiceSection.tsx:66,95,112`（live）、`LimitsSection.tsx:51-85`（new_execution）、`NetworkSection.tsx:17`（live）、`draft.tsx:137`（`restartCount` 由 draft 字段统计，但没有任何 draft 字段被标为 `restart`——`EffectBadge` 的 restart 分支实际不会被任何数字/布尔行命中）；全仓 grep `appliedLiveFields|restartRequiredFields` 无结果
- **差异**：设计明确要求徽标来自服务端字段清单（可随字段变化），实现是前端写死；由于进入底部保存条的所有字段都是 live/new_execution，**保存条的“M 处需要重启后生效”恒为 0**，而设计 dirty 态示例是“2 处未保存 · 其中 1 处需要重启后生效”。同时设计里大量重启字段（服务端口、启动打开浏览器、连接方式、OpenCode CLI 路径、网络超时等）在实现中要么不存在、要么独立保存且不显示徽标。
- **原因**：直接原因前端按字段手写 effect；根本原因 C1（服务未返回 appliedLiveFields/restartRequiredFields 清单）+ C6（生效语义硬编码，存在与服务实际不符的风险）。
- **影响**：用户可能被“立即生效/新执行生效”误导（若服务实际需重启才生效）；设计的保存条重启计数无法呈现；后续字段生效方式变化需要改前端。
- **建议**：服务在 bootstrap/settings DTO 暴露字段生效清单或每字段效果（可用 `appliedLiveFields/restartRequiredFields` 结构）；前端改为查表渲染并在保存条统计；过渡期把已知重启字段（服务端口、CLI 路径、连接方式等）纳入 restart 计数。
- **验证**：静态 / 需真实服务
- **关联状态**：`dirty, conn-auto, limits, network`

### P22-08: 执行限制分组与字段/B-12 结构偏差
- **严重度**：P3
- **维度**：结构 / T / V
- **类别**：结构 / 文案 / 样式主题
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/settings.html:188-209`（`limits-on/off` 三组卡：并发 = 模板任务并发数 1–16；重试与异常 = 阶段最多尝试 1–10、任务最多尝试 1–50、会话异常阈值 1–10；超时 = 验证超时 1–120 始终在前、下面是业务超时开关；`:200` 开关标签下写默认行为“默认关闭：任务不会因为运行时间长而被中断”；`:201-206` 开启时三字段用左侧强调线缩进成组，组首 warn 提醒“开启后，超过下列时长的新任务会被中断。已在运行的任务不受影响”，最大时长补“上限 10080 分钟，即 7 天”；`:206` 关闭时说明“开启后可以设置最大时长、尝试超时和设计超时。之前填写的时长会保留，关闭期间不生效。”）；`opencode-workflow-design-showcase/originals/main/REVIEW.md:1471-1484,1486-1498,1500-1510`
- **实现位置**：`LimitsSection.tsx:21-90`（规划限制只读卡 `:24-32`；可编辑字段卡 `:40-66` 默认自动推进/验证命令超时；调度策略与业务时限卡 `:69-88` 最大并发节点/单节点总尝试上限/失败后暂停/停止确认等待/任务总尝试上限/会话异常阈值/业务超时开关 + 三字段 `role="group"` `:81-86`；关闭提示 `:87`）；契约 `packages/shared/src/config/settings.ts:103-122`（无 `templateAnalysisConcurrency`、`maxStageAttempts`）
- **差异**：设计三组卡在实现中是“可编辑字段 / 调度策略与业务时限 / 规划限制只读”，且字段集不同：缺模板任务并发数与阶段最多尝试（契约无字段），多出最大并发节点、单节点总尝试、失败后暂停、停止确认等待、默认自动推进；业务超时组缺左侧强调线缩进和组首 warn 提醒，关闭态文案缺“开启后可以设置最大时长、尝试超时和设计超时”，缺“10080 分钟=7 天”换算；设计“验证超时”在实现中为“验证命令超时”（语义接近）。
- **原因**：直接原因实现按当前执行契约组织字段；根本原因 C4（分组结构）+ C1（两个设计字段不存在）+ C3/C7（提醒文案与强调线缺失）。
- **影响**：逐项对比差异较大；B-12 的“分组视觉关系”（开关与它控制字段的关系）弱化；但开关条件渲染、默认关闭说明、单位范围等都具备，主能力可用。
- **建议**：若服务补 `templateAnalysisConcurrency`/`maxStageAttempts`，按设计三组卡重排；至少补开关组首 warn 提醒与左侧强调线、“10080 分钟=7 天”换算与关闭态文案，提高与设计的一致性。
- **验证**：静态 / 需GUI
- **关联状态**：`limits, limits-off, limits-on`

### P22-09: 底部保存条 issue 文案只给数量，未指出字段；重启计数缺“其中”
- **严重度**：P3
- **维度**：T
- **类别**：文案
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/settings.html:157`（`bxSavebar`：`有 1 处需要修正 · 设计监控间隔超出范围`）、`:216`（`有 2 处未保存的修改 · 其中 1 处需要重启后生效`）
- **实现位置**：`SettingsPage.tsx:120-127`（“有 N 处未保存的修改 · M 处需要重启后生效”，无“其中”；issue 态副文案“有 N 处需要修正后才能保存。”，不指出哪个字段）
- **差异**：措辞缺“其中”一字（设计原稿措辞，B-10/B-11 都强调沿用）；issue 态只给数量，设计给出具体字段名（如“设计监控间隔超出范围”），用户需要自己找标红项。
- **原因**：C3（文案未逐字）。
- **影响**：逐字验收差异；issue 态可定位性略弱（字段本身已标红并有行内错误文案）。
- **建议**：文案按设计原文补“其中”；issue 态可列出首个异常字段名（`draft.fields` 的 issue 已带 label）。
- **验证**：静态
- **关联状态**：`dirty, save-unknown`

### P22-10: 外观分区：减少动态效果只读、主题命名与设计不同、多出只读行
- **严重度**：P3
- **维度**：结构 / T
- **类别**：结构 / 文案
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/settings.html:106-110`（外观：四套皮肤缩略卡 + “减少动态效果”下拉：跟随系统 / 始终减少 / 不减少）；`opencode-workflow-design-showcase/originals/main/REVIEW.md:493`（外观：四套皮肤缩略预览卡 + 减少动态效果，皮肤切换从各页页头移到这里）、`:502`（皮肤与减少动态效果只存本机 — DESIGN_ONLY）
- **实现位置**：`AppearanceSection.tsx:11-39`（四主题 `ThemeSelector` + 显示模式/减少动态效果/界面语言/侧栏收起只读行）、`ThemeSelector.tsx:20-71`（四卡来自 shared 主题配置，选中勾、立即生效并写 URL/本地存储）、`packages/shared/src/config/themes.ts:65-66,159-160,253-254,347-348`（标签 DeepSeek/Warm/SPDB/GitHub White）
- **差异**：① 设计的“减少动态效果”是可编辑三选一（本地保存），实现显示为只读服务值（`ui.reducedMotion` 布尔，无三档枚举）；② 主题卡名称/描述为产品品牌命名（DeepSeek/Warm/SPDB/GitHub White），设计原型为 deepseek 风/claude 风/SPDB/GitHub 白；③ 多出显示模式/界面语言/侧栏收起只读行（设计没有）。
- **原因**：C4（控件缺失/多余）+ C1（减少动态效果枚举字段缺失，服务仅布尔）+ C3（命名）。
- **影响**：设计的本地外观设置在实现中不可编辑；多出的只读行对用户无操作价值但可解释现状。
- **建议**：为减少动态效果增加本地三档设置（localStorage，不动服务字段）；主题命名如为品牌决策需与设计同步；只读行收进“当前值”说明或删除。
- **验证**：静态 / 需GUI
- **关联状态**：`appearance`

### P22-11: 模型服务字段/保存方式与设计不同（运行方式、服务地址、超时折叠、统一保存条）
- **严重度**：P3
- **维度**：结构 / A / T
- **类别**：结构 / 交互 / 文案
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/settings.html:111-119`（模型服务：OpenCode CLI 路径（重启后生效）、“默认模型”提供方+模型+刷新+“共 6 个可用模型 · 10:42 读取”、运行方式 seg（由程序托管 / 连接已有服务，重启后生效）、“超时”折叠（连接超时 10s/请求超时 120s/启动超时 30s，均重启后生效））；`opencode-workflow-design-showcase/originals/main/REVIEW.md:494`（模型服务字段与超时收进折叠区）、`:502`（接口沿用 GET/PUT `/api/settings`、models）
- **实现位置**：`ModelSection.tsx:38-316`（CLI 路径 + 保存路径/重启 OpenCode、运行时开关（启用/自动启动/Agent）+ 独立保存、ModelCatalogPicker 默认模型、职责模型、模型档案 CRUD）、`ModelCatalogPicker.tsx:9-26`；`SettingsPage.tsx:126`（保存条提示“Git 账号与模型服务中的路径/运行时/模型档案仍按各自按钮保存。”）；契约 `packages/shared/src/config/settings.ts:27-54`（有 startupTimeoutMs/shutdownTimeoutMs/providerGateway.requestTimeoutMs，但 UI 未暴露；无连接方式）
- **差异**：设计把模型服务放在统一保存条（带重启徽标）并包含运行方式/服务地址/三个超时；实现改为三个独立保存操作（路径/运行时/模型档案）且不展示服务地址与超时，运行方式（连接方式）缺失（见 `P22-01`）。实现已在保存条提示中诚实标注“仍按各自按钮保存”，但不是设计结构。
- **原因**：C5（保存方式/交互不同）+ C4（超时折叠与服务地址缺失）+ C1（连接方式字段缺失）。
- **影响**：设计的“模型服务”字段清单无法逐项对应；重启生效徽标在此分区不可见；超时配置只能改服务配置文件。
- **建议**：如需对齐，把 CLI 路径/运行方式/服务地址/三个超时纳入统一保存条并显示重启徽标；否则把“独立保存”记录为设计变更（C10）并同步设计说明。
- **验证**：静态 / 需GUI
- **关联状态**：`model, conn-auto`

## 已核对一致

- **角色四页签与结构**：`RolesPage.tsx:1306-1331` 页签“职责与指令 / 能力范围 / 资源权限 / 形象”与设计 `opencode-workflow-design-showcase/originals/main/pages/roles.html:147-149` 一致；页签内布局（左侧职业目录 + 右侧头卡 + 内容区）与 `opencode-workflow-design-showcase/originals/main/pages/roles.html:213-222` 一致；头卡形象/名称/发布徽标/草稿徽标/用途说明 + “保存草稿 / 检查并发布”（有未保存修改时发布禁用并给原因，`RolesPage.tsx:1247-1266,508-524`）与设计 `:133-141` 一致。
- **职业目录**：形象+名称+发布状态+草稿状态（有未保存修改琥珀色）、选中态 `aria-current`、搜索（名称/职责/标识）、脏切换确认 `RolesPage.tsx:1180-1226,546-568,1563-1580` 与设计 `:216-219,96-99` 一致。
- **能力范围**：四组能力标签与设计完全一致（`packages/shared/src/domain/enums.ts:468-473`：知识与资料/数据/任务/工具），胶囊 `aria-pressed` 开关 + 顶部“能力范围决定可以参与哪些事，具体工具/文件/命令在资源权限逐项设定，修改一项不会自动改变另一项”说明（`RolesPage.tsx:849-897`）与设计 `:177-179` 一致。
- **资源权限**：公式「职业上限 ∩ 项目 ∩ 运行环境 ∩ 冻结范围 = 实际可用」逐字一致（`RolesPage.tsx:990-1000` ↔ `opencode-workflow-design-showcase/originals/main/pages/roles.html:192-194`）；工具/文件/命令/资源能力四分组 + 类型标签（NATIVE/ASSIST/MCP/READ/WRITE/ARGV/CAP）+ 空清单“空清单不表示不受限制”（`RolesPage.tsx:1002-1098`）与设计 `:195-205` 一致。
- **命令参数编辑**：每参数一格、placeholder“空参数（保留）”、可删除/添加参数（上限 32 带原因）、工作区可选、“只修改职业草稿，不授予实际运行权限”、放弃这项修改/应用、`编辑中` 徽标，且未应用时保存/发布/新建/切换都被拦截并给原因（`RolesPage.tsx:570-593,902-975,1040-1070,1282-1294`）与设计 `:187-191,203-204,473` 一致。
- **B-03 已发布版本权限预估**：常驻卡 + 「只读预估」徽标 + 发布修订徽标、常驻“预估 ≠ 实际授权”提示、两步（选职责位置 → 读取预估，未选禁用并给原因）、结果（已读取/位置/修订/时间、限制说明、有效工具上限两列表、诊断 warn 列表/无诊断绿行）、无有效工具空态、读取失败卡内条 + 旧预估清空（`RoleInsights.tsx:20-45`）与设计 `opencode-workflow-design-showcase/originals/main/pages/roles.html:302-336`、`opencode-workflow-design-showcase/originals/main/REVIEW.md:684-741` 的状态与边界（不写入、只按发布修订、只列 allowedSlots、未登记位置回退标签）一致；除缺少“查看已发布版本”跳转（依赖 `P21-01`）与骨架屏外，七态中 pick/result/notools/diag/error 语义均已对齐。
- **使用情况/规划职责数据真实**：`RoleUsage` 走 `GET /api/catalog/roles/:id/insights`（`RoleInsights.tsx:11-19`；`packages/shared/src/api/contracts.ts:2187-2203`），展示流程/模板/冻结节点与“规划职责”标记；未使用示例数据，符合设计“使用情况 PROPOSED、未评审前隐藏”的诚实要求（实现已有接口所以展示，属可接受扩展）。
- **发布前检查数据**：`RolesPage.tsx:645-682` 用真实 `catalogRoleValidate` 检查项（服务 `publishChecks` 的 responsibilities/capabilities/resources/image，`packages/shared/src/domain/models.ts:226-233`）+ 前端对上一修订快照字段级差异（设计明确“差异由前端比对两份完整 draft 得出 — DESIGN_ONLY”，`opencode-workflow-design-showcase/originals/main/REVIEW.md:480`），并对旧快照缺字段给出“不做差异判断”的诚实说明（`RolesPage.tsx:202-245`）；发布按钮用真实 receipt，失败/成功有回执条（`:1270-1281`）。
- **设置分区导航与保存条**：`SettingsPage.tsx:35-65,226-246` 四组分区（通用 / 模型与执行 / 账号与网络 / 其他）+ 未保存分区琥珀圆点 + `aria-current`，与设计 `opencode-workflow-design-showcase/originals/main/pages/settings.html:90,213` 一致；每字段“名称+说明+生效徽标+控件”、修改字段琥珀描边（`settings.css:12-22`）、sticky 底部保存条（计数 + 放弃 + 保存设置，issue 时禁用保存并给原因，`SettingsPage.tsx:113-142`）与设计 `:21-30,92-94,157` 一致。
- **设置表单校验**：`DraftNumberControl`（`draft.tsx:182-242`）对空/非整数/越界生成 `aria-invalid` + 行内错误 + 保存条 issue 拦截保存，复用了设计的越界策略；最小/最大值与设计一致（如业务超时最大时长 1–10080、尝试超时 1–1440、设计超时 1–1440、会话异常阈值 1–10、验证超时 1–120、连接超时 1–120 秒、请求超时 1–300 秒、HTTP 主机等，`LimitsSection.tsx:74-85`、`NetworkSection.tsx:23-24`、`packages/shared/src/config/settings.ts:328-355`）。
- **B-12 核心字段**：`execution.timeoutEnabled` 默认关闭、关闭时三时长字段隐藏、开启后在 `role="group" aria-label="业务超时时长"` 内展开“任务最大时长/尝试超时/设计阶段超时”，且说明“已有任务保留创建时配置”，`LimitsSection.tsx:80-88` 与设计 `opencode-workflow-design-showcase/originals/main/pages/settings.html:198-208`、`opencode-workflow-design-showcase/originals/main/REVIEW.md:1490-1498` 的字段/条件渲染/范围一致。
- **B-10 模型刷新态**：`ModelCatalogPicker.tsx:17-24` 读取中“正在读取可用模型（最多 40 秒）…”、失败原因、“共 N 个可用模型 · HH:MM 读取”、刷新按钮与“设为默认模型”禁用原因，与设计 `opencode-workflow-design-showcase/originals/main/pages/settings.html:114-116`、`opencode-workflow-design-showcase/originals/main/REVIEW.md:1408` 的 model-refresh 复用语义一致。
- **重试等待**：三类（模型限流/会话错误/验证失败）× 初始/最长并排、逐次翻倍说明、最长<初始时前端提示（`RetrySection.tsx:5-24`）与设计 `opencode-workflow-design-showcase/originals/main/pages/settings.html:123-124` 一致。
- **发布网络**：GitLab 地址/API 地址/允许的 HTTP 主机（逐行校验，最多 64 项）/连接超时/请求超时（`NetworkSection.tsx:5-25`）与设计 `opencode-workflow-design-showcase/originals/main/pages/settings.html:136-138` 逐字段一致；走统一保存条。
- **数据诚实降级**：开发辅助“显示示例数据”在契约中无字段，实现禁用并说明“产品约定不使用示例数据”（`DevSection.tsx:5-29`）；数据库分区只读概览并引导到「数据库」页（`DatabaseSection.tsx:9-93`）；模型服务独立保存已在保存条提示中说明（`SettingsPage.tsx:126`）——均未伪造成功或示例数据。
- **样式/主题**：`roles.css`、`settings.css` 无硬编码颜色（全用令牌，无 hex/rgba）；设置保存条、脏描边、圆点、生效徽标均用 `--warn/--ok/--float` 等令牌，符合四主题要求。
- **加载/错误/空态**：角色目录与设置页都有骨架/`ServiceNotice`/空态（`RolesPage.tsx:1153-1176,1361-1365`、`SettingsPage.tsx:74-87,163-173`），没有把读取失败说成空数据。

## 需 GUI / 运行验证

1. **B-02 已发布版本核对缺失的体验**：静态确认无视图；需 GUI 复核发布后用户实际只剩“发布历史”弹窗这一核对路径（`P21-01`）。
2. **保存/发布超时与并发**：需真实服务构造超时（结果未明）与两人同时保存，确认当前“可立即重发、无核对”的实际后果与风险（`P21-02`）；静态已判定无 pending 锁。
3. **权限预估真实数据**：需真实发布修订验证 allowedSlots、诊断文案、未登记位置回退、0 工具态（`B-03` 相关已一致项）。
4. **设置保存结果未明**：需真实服务超时后在 GUI 观察 banner/按钮/字段是否如静态所述（`P22-04`）。
5. **离开确认与 Git 脏状态**：需 GUI 验证设置/Git 修改后切换分区、离开页面、刷新时是否零提示丢失（`P22-05`、`P22-06`）。
6. **业务超时开关的实际保存与生效**：GUI 验证 limits-off/on 切换后的保存条计数、字段回填与“已有任务保留配置”说明（`P22-08`）。
7. **四主题与窄屏**：roles 头卡/能力胶囊/权限行、settings 导航/保存条/徽标在四主题与 1440/1280/1024 下的对比度与折行（像素级未审）。
8. **v5 规划职责入口往返**：需 GUI+真实服务从需求画布/流程详情点“规划职责”进入 `/roles?roleId=…` 的落点（当前为可编辑页），确认与设计只读页差异（`P21-03`）。
9. **Git 令牌保存+验证流程**：GUI 验证“保存令牌并验证”失败/成功时的实际结果与提示（`P22-06`）。
10. **角色命令参数编辑的键盘/焦点与空格保留**：GUI 验证多参数行、空参数、删除后用 Tab 顺序（`P21-05`/`perm-edit`）。

## 未覆盖 / 说明

- **跨区域内容**：v5 规划职责的另一半（流程目录 `detail-planning`、需求画布“规划依据”链接与 `back`）属 P09/P11 区域；`roles-legacy`（P25 历史角色配置）与 `B-04` 不属本区域；本节只审 roles/settings 自身。
- **未运行**：本次仅静态审计，未启动 GUI、未调用真实服务/模型、未做四主题截图与像素对比；因此所有视觉、键盘、超时/并发结论标“需GUI/需真实服务”，不作为已验证。
- **未逐行审计**：`packages/engine/src/role-catalog.ts` 的全部业务规则（只核对了 save/publish/validate/history 的契约面与冲突语义）与 `packages/server/src/http.ts` 的其余设置端点；`role-event`（使用统计/快照）细节未展开。
- **B-02 近似实现说明**：发布历史弹窗（`RolesPage.tsx:1425-1466`）返回修订快照并可恢复为草稿，功能上部分覆盖“查看版本内容”，但不是设计中“核对当前已发布版本”的只读回执（无只读徽标、无内容摘要、无“核对不会发布/改草稿”的边界说明），本报告按“缺失”记录而非“已实现”。
- **设计缺口（C9，不计入问题计数）**：
  - B-10/B-11 的核心字段（`openCode.mode`、`designerMonitorDelayMillis`、`monitorDelaySeconds`、`abortCleanupAttempts`）在服务契约中不存在；本报告按 C1 记录为“设计态无法用真实数据呈现”，是否补契约由 Lead/服务侧决定。
  - 设计 `opencode-workflow-design-showcase/originals/main/pages/roles.html:111-116` 的“需求分析师（未发布草稿 v1）”执行职业与“需求分析师（规划职责）”并存；当前内置目录只有后者（`packages/shared/src/config/catalog.ts:141-145`），属目录内容差异（C1/示例数据），未计入前端问题。
  - 设计“能力可承担的职责”（`opencode-workflow-design-showcase/originals/main/pages/roles.html:180`）与“查看完整权限原文 JSON”依赖的设计字段/展示在服务契约内没有对应模型，分别记为 `P21-06`/`P21-05` 的 C1 部分。
  - 设置“显示示例数据”（`opencode-workflow-design-showcase/originals/main/pages/settings.html:140`）服务无字段，实现诚实禁用，符合项目“不得把 mock 数据当产品事实”的约定，不是缺陷。
  - B-10“运行方式”若产品最终只保留受管运行时（当前 `AGENTS.md` 与运行环境章节即如此），应把三卡登记为不开放并在设计中更新，而不是维持“设计有、实现无”的口径。
- **文档口径（C10，交 Lead 统一记录）**：`docs/review/design-parity.md:139-142`（§2.11）、`:152-156`（§2.13）、`:179`（P0-4）、`:186`（P1-5）与 `docs/review/frontend-gaps.md:42,246`（F-21）仍在称“角色四页签/能力范围/资源权限/形象/发布检查缺失、设置分区与脏保存条缺失、监控口径不同”，`docs/review/frontend-gaps.md` F-21 也称执行限制只读/分区缺失——这些结论已被当前代码修复（四页签、能力/权限/形象、发布检查、B-03 预估、分区导航、圆点、底部保存条、重试/发布网络/执行限制可编辑均已实现），旧文档不应再作为这些问题存在的证据；本报告以当前代码为准记录了仍存在的差异（B-02/B-10/B-11、保存未明、离开确认、Git 脏状态等）。
