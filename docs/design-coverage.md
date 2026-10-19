# 设计稿覆盖矩阵 · 当前分层口径

更新时间：2026-10-20；当前实现/证据核对基线 **818bf6c**（文档工作区由54b9c4c创建，补核Lead已集成提交）。设计权威为只读 v5（22 正式页 + recovery/requirements/roles-legacy 共25页）及 planning/delivery/git/node 补充稿。仅有路由/截图或主流程不能判整页通过。

- **I 实现**：契约与代码路径存在；**H 服务/HTTP**：真实SQLite/HTTP/子进程或受控端口回归；**M 模型/外部**：配置的真实模型或真实服务；**G GUI**：CUA浏览器/原生界面的具体操作。离线模型端口、隐藏BrowserWindow脚本、原型图不计M/G。
- 25页都有载体，但**当前不能给出25页全状态验收通过数量**。以下逐页列已获证据与具体仍缺状态；“—”表示未取得该层证据，不是失败。
- 历史Wave403/392与后续整合556/545/11跳过均是各自基线的回归记录，不是本次818bf6c全仓重跑，也不是GUI状态通过数量。本批仅文档核对，没有新模型、GUI或远端写。
- 已实现的公约生成、知识来源/增量、快照报告、图编辑、PPT/角色/工具/DB合同不再列为“501/无接口”。诚实未知仍不自动等于设计已完成；设计明示缺能力态除外。
- **已整合818bf6c（原90d45b9）**：模板归档严格原回执/原key核对、当前质量与历史open findings分离；11项回归及正式CUA归档来自E25，不扩大为模板/Insights全部状态通过。

## 1. 25页分层覆盖与待补GUI

| # / 页面 | 路由与当前实现（I） | 服务/HTTP（H） | 模型/真实外部（M） | 正式GUI（G） | 仍缺的具体GUI状态 / 当前限制 |
|---|---|---|---|---|---|
| P01.home.V/.A/.S | `/ · HomePage`；进行中单卡、真实最近任务及动作已接；不再列单卡缺失 | E10；task-catalog HTTP | — | E11：浏览器首页局部观察 | 有任务/无任务/读取失败/需处理分流；四主题×三尺寸、键盘与返回 |
| P02.projects.V/.A/.S | `/projects、/projects/:id`；公约真实生成/停止/原key、项目GitLab消费者/docPaths已接；网格/取消管理确认 | E09/E11：12+13定向 | —（公约端口测试不算live） | E11：同名目录登记/非Git重检/取消管理 | 公约none/running/ready/unknown、生成重启恢复、项目GitLab真实endpoint、权限拒绝；技术栈真实投影仍缺 |
| P03.knowledge.V/.A/.S | `/knowledge`；多来源选择、独立原文/联网许可、冻结model/role/source、真实增量/停止继续及原key恢复已接 | E03：离线/HTTP；knowledge-inputs相关代码已在基线 | E01：真实问答+精确引用2项中的知识项 | E03：来源/研究员抽屉实现；无完整重建后状态证据 | 代码/文档/DB选择、联网失败/撤权、stopped→continue、重启原会话取结果；原生追问由A继续，不能写已全通 |
| P04.knowledge-history.V/.A/.S | `/knowledge/history`；真实状态、日期/搜索、原会话回读及追问身份已接；设计无强制重命名删除动作 | E03：按key结果/历史控制流 | E01仅知识问答，非整页历史验收 | 未找到本轮独立正式GUI记录 | 历史空/断裂/需回答/被撤权、返回原会话/原问题、同项目与跨项目身份、搜索与返回 |
| P05.ppt.V/.A/.S | `/ppt`；五项简报、附件、三个方向、真实作品/生成已接 | E04/E05/E06：生产/停止/助手HTTP | E05：真实单页助手候选17秒后原key取回 | E05原生CUA；E06浏览器工作台 | 首页五项简报全部状态、模型自然澄清、附件失败/未知生成；不能以助手单页PASS代整份生成 |
| P06.ppt-works.V/.A/.S | `/ppt作品库`；真实SVG封面、复制/归档/恢复/修订已接；不再称无接口 | E04/E05：复制/归档/版本与回执 | — | E04兼容Electron图不算CUA；E06浏览器局部 | 作品库loading/error/empty、分页/筛选、复制unknown、归档恢复和取消、原生文件返回 |
| P07.ppt-studio.V/.A/.S | `/ppt工作台`；三栏逐页、对象属性、七模块方案、候选审阅应用与PDF/PPTX已接 | E04/E05/E06：19/20项定向 | E05单页真实候选→应用r3→r4 | E05原生保存/取消/PDF hash；E06四主题CUA对象/备注/抽屉 | 整份助手/方案真实模型、stop失败/idle未知、版本409及draft恢复全矩阵、Windows/Linux导出 |
| P08.start.V/.A/.S | `/start`；最近3项目/常用3流程+搜索抽屉、当前版本核对、只建草稿 | E11：过期版本/原key HTTP | E01规划不等于开始页全态 | E11：选项目/流程→实际草稿回执 | 版本reading/flow-error、project-error、submit/unknown/handoff-error；三尺寸键盘/取消保留 |
| P09.workflows.V/.A/.S | `/workflows`；目录/历史/真实使用记录、规划职责策略只读节已接 | E07/E18：目录/版本/跨修订统计 | — | E18：真实目录总2/当前1→精确草稿 | 详情loading/error、more-error、复制/归档取消及unknown、规划职责返回定位 |
| P10.workflow-editor.V/.A/.S | `/workflows/:id/edit`；真实requires图、并行/连边、拖动/缩放/模板抽屉、版本视觉diff已接 | E07：图/保存/冻结与HTTP；非模型 | — | E07：四主题浏览器、布局保存截图 | 409本地草稿对照、unknown跨刷新、unbound/empty、撤销键盘、PE28/PE38禁用原因全态 |
| P11.requirement.V/.A/.S | `/requirement/:id`；五段、PE37、候选应用确认、记录分页/callId与seq已接 | E02/E08/E19：规划/编辑/505条分页 | E01：真实规划→应用确认准备 | E19：505条/缺口/工具原位；早期模型画布图属历史 | PE/PW全状态；超限/预算/资料撤权/停止迟到/跨组/重启unknown；不可把规划主流程扩成全矩阵 |
| P12.tasks.V/.A/.S | `/tasks`；归档恢复/结束前置、项目ID过滤分组及规划活动已接 | E10/E11：归档/同名/HTTP | — | E11：同名项目精确ID空结果 | 加载更多失败/归档与恢复/菜单禁用、planning计数与Inbox一致、步骤进度历史/空/unknown |
| P13.task.V/.A/.S | `/tasks/:id`；真实执行控制/停止确认/调整绑定/冻结、snapshot mode/depth/units/report已接 | E02/E08/E12/E13：停止19、计划7、作用域retry33、报告权限 | E01：真实节点修改README；非snapshot专用模型验收 | E14/E15节点局部；不替代整画布 | running两并行/auto-off/waiting/stalled/claim-race/stop未知；snapshot full/light批次与报告loading/error/cancelled可读 |
| P14.inbox.V/.A/.S | `/inbox`；规划选项及原生节点permission/question、once/session/reject/hard、持久草稿/原key已接 | E17/E20：问题/权限26定向，HTTP/SQLite | E26：真实模型原生question→多选/其他答复→同session结果1/1 | E20：Chrome离线unknown/hard；E26：IAB实际模型问题答复、角标同步 | 真实模型permission事件及授权后继续；跨attempt/撤权/重启/全页筛选状态；后台无上下文来源仍限制 |
| P15.insights.V/.A/.S | `/insights`；四阶段任务计量/未知、分币、完整全集、项目/状态/质量/归档同范围已接 | E16：10项定向；205任务/混币/零 | — | E16：同名ID/归档/质量实际驳回/服务失败保留 | 全部未知/加载与错误详细对照、四主题三尺寸；E25已修正历史问题污染当前质量；未新增全状态GUI |
| P16.templates.V/.A/.S | `/templates`；必要范围/branch/date/source/doc冻结、B06历史档案已接；旧合同不回填 | E10/E12：模板范围/历史/原key | E26：v8单文件5步真实模型、3项JUnit与独立复核1/1 | E11：必要参数；E25：真实归档succeeded/key/auditId | source/doc/date所有参数失败、启动unknown、created/pending-start、历史run核对失败/导出；UNKNOWN原key恢复的完整GUI故障态仍待补 |
| P17.run.V/.A/.S | `/runs/:taskId`；专用文档/源码/单测布局、冻结输入/报告/逐文件独立复核、真实JUnit结果已接 | E12/E13：50定向，actual子进程JUnit；结果权限 | E26：新逐文件单测合同真实5步/3测试/独立复核通过 | E14原生artifact保存；E26 Run覆盖、产物hash、实际JUnit，四主题1280×720 | 批次失败/限批retry/停止/unknown、通过失败跳过文件定位、报告re-read/download撤权、输入迟到切换/宽阅读返回 |
| P18.runtime.V/.A/.S | `/runtime`；启动/重启、维护锁/活动session防护、真实路径/操作历史已接 | E11/E16：runtime-role HTTP；E02/E08活动阻止 | E01真实1.19 ready/idle只是运行时连通 | E11：未受管禁用与路径局部 | managed/external/offline/start-failed/unknown/read-error、restart unknown锁与原key恢复；不能按本地pending0判停稳 |
| P19.tools.V/.A/.S | `/tools`；来源/单工具/项目三态、冻结会话策略、Skill目录/Markdown/原文已接 | E21：4项HTTP权限，旧/新会话分离 | — | E21：停用→回读、Skill空/原文/四主题/刷新同ID | 外部MCP真实授权/清单partial、来源整体确认/项目继承、write-unknown、Skill读取错误/搜索命中与返回 |
| P20.databases.V/.A/.S | `/databases`；项目/schema/table授权、临时草稿探针、会话只读/撤权已接；planned驱动明确缺能力 | E22：45+9定向、真实关闭端口 | E01：已有MySQL真实1/1；非模型 | E22：草稿ECONNREFUSED保留输入、变更清探针、取消0连接 | 成功连接三格/重检失败、保存unknown/归档、运行中授权撤销；PG/其他驱动真实实例不可冒充MySQL通过 |
| P21.roles.V/.A/.S | `/roles`；发布快照真正控制模型/时限/指令/工具资源；权限预估/形象/使用统计已接 | E23/E16：角色/冻结/原key/统计 | E01真实执行不等于全部角色配置live | E23包页CUA可打开精确roleId；角色页四tab未全态 | 编辑草稿取消/发布unknown/restore冲突、B02/B03完整界面与真实资源拒绝、形象目录/统计空与读取失败 |
| P22.settings.V/.A/.S | `/settings`；分区脏状态/原key、业务限制与分类等待真正冻结生效、模型/Git真实配置 | E08/E24：19项配置/等待/模板、冻结policy | E01使用实际模型配置；非配置全态 | E24：30/300草稿跨分区/刷新/保存回读 | Git+普通同时脏/保存unknown、离开确认取消、模型读取失败/限额、重试真实429/会话错误、四主题键盘 |
| P23.recovery.V/.A/.S | `/recovery、/tasks/:id/recovery`；三模式派生冻结计划/真实工作区快照、只核对硬只读及策略继承已接 | E08：真实Git/目录恢复与policy回归 | — | 早期恢复截图仅历史；本轮无独立正式CUA | 三模式差异预览→确认→准备→开始、unknown阻止、父旧结果只读、重启后lineage与原key；真实模型并行仍缺 |
| P24.requirements.V/.A/.S | `/requirements`；B15只读详情/需求输入修订与计划号已接 | E10：需求/目录/冻结HTTP | — | E10未给完整B15正式GUI状态 | 抽屉loading/error、长需求/搜索空/项目切换、返回原任务及历史计划原文不能混入当前需求 |
| P25.roles-legacy.V/.A/.S | `/roles/legacy`；JSON/ZIP只读校验→差异审阅→发布绑定，四tab及完整角色字段已接 | E23：25定向、CRC/路径/回滚/绑定原key | — | E23：原生文件选择真实ZIP、8差异→勾选→发布r1 | import-invalid/nodiff/replace/back-confirm/publish-unknown全态；角色归档被绑定阻止/错误与跨刷新草稿 |

## 2. 证据索引与版本边界

下列记录保留各自基线、fixture/真实模型/GUI身份；旧文件中的“仍未完成”若被后续集成替代，只作为历史，不继续复制成当前缺口。具体操作、图路径、原key/hash与测试命令以原记录为准。

| 证据ID | 原记录 / 历史身份 | 可以证明 / 不可外推 |
|---|---|---|
| E01 | docs/verification.md §2026-10-20追加/真实MySQL | 模型：1.19最小OK、知识/规划2项、README执行/审查/修复3项；MySQL1项；与2026-10-19 GitHub远端写历史分开。没有新GitLab；新fileEvidence模型PASS见后续E26 |
| E02 | docs/verification/2026-10-20-execution-stop.md | 19离线/HTTP；abort拒绝/UNKNOWN/idle/重启/迟到代际。未做实际provider停止GUI |
| E03 | docs/review/knowledge-receipts-sources-2026-10-20.md | 该文件早期“来源未接/live未做”不是当前实现结论；追加记录实际流式/停止/角色抽屉，当前代码另有KnowledgeInputs冻结来源；具体live只取E01 |
| E04 | docs/review/ppt-production-2026-10-20.md；ppt-plan-stop-2026-10-20.md | 生产/复制/版本/方案/停止。兼容隐藏Electron12图不是正式CUA；后续由E05/E06补 |
| E05 | docs/review/ppt-assistant-pdf-2026-10-20.md | 原生CUA真实单页助手proposal→r4、原key17秒取回、原生PDF5页/3页hash与取消、四主题；不是整份/全部停止状态 |
| E06 | docs/review/ppt-studio-layout-2026-10-20.md | 20定向；浏览器CUA选页/对象/备注/72字号溢出→修复16/页签/抽屉，4主题1512×790 |
| E07 | docs/verification/2026-10-20-workflow-editor.md | 真实图依赖/版本差异；浏览器四主题与布局保存，不证明真实模型规划 |
| E08 | docs/verification/2026-10-20-plan-edit-binding.md；2026-10-20-recovery-execution-policy.md；2026-10-20-execution-business-limits.md | 计划同execution绑定/恢复工作区/冻结调度及业务限制；离线端口不等于provider并行 |
| E09 | docs/review/project-config-consumers-2026-10-20.md | 12定向，charter只读模型端口、项目GitLab本机HTTP替身、docPaths真实prompt。旧无sessionMessages恢复限制须按现代码核对，不当永久缺口 |
| E10 | docs/review/task-catalog-2026-10-20.md | 首页/任务归档/B15/模板完整scope与历史档案；实现/HTTP，不宣称25页GUI |
| E11 | docs/review/p14-seven-pages-2026-10-20.md | 13定向；正式Chrome CUA项目/Start实际草稿/同名ID/取消管理/必要参数/runtime禁用/DB空态，非七页所有状态 |
| E12 | docs/review/p09-file-evidence-2026-10-20.md | 50定向；受控真实Node子进程JUnit+HTTP；本条写作/复核为离线fixture；后续真实模型与Run GUI见E26 |
| E13 | docs/verification/2026-10-20-scoped-retry.md；docs/verification.md运行阅读权限追加 | 33定向只重试明确failed集合；权限过滤/报告下载精确身份；不是GUI全状态 |
| E14 | docs/review/node-artifacts-2026-10-20.md | 原生Electron产物读取、macOS保存/取消/hash；CJS preload修复与四主题，非整个Run专页 |
| E15 | docs/verification/2026-10-20-node-detail-read.md | HTTP/Chrome组件夹具：旧attempt/撤权清摘要与产物；工具详情引用同一身份。非真实模型与整任务GUI |
| E16 | docs/review/p14-insights-2026-10-20.md | 10定向/205任务；CUA真实筛选、人工驳回与失败保留。a5c50af集成29f5083；当前质量修正原90d45b9已集成818bf6c，见E25 |
| E17 | docs/review/inbox-choices-2026-10-20.md | 规划question选项/必答/多选/其他持久答复；不能替代节点原生问答 |
| E18 | docs/review/workflow-usage-2026-10-20.md | 10定向；CUA真实目录使用2/当前1及准确草稿跳转；无模型调用 |
| E19 | docs/review/planning-record-2026-10-20.md | 4定向；CUA 505记录/删除#7/加载后504、callId单卡、向上关闭跟随；fixture非模型 |
| E20 | docs/verification/2026-10-20-runtime-inbox.md | 26定向；实际runtime健康/OpenAPI无模型；Chrome生产组件+离线port多选/unknown/hard。真实模型自然问答已由后续E26补证，权限事件仍保留原边界 |
| E21 | docs/review/tools-parity-2026-10-20.md | 4HTTP会话冻结；CUA来源/单工具/Skill/主题/URL恢复；外部MCP真实授权未全验 |
| E22 | docs/verification/2026-10-20-database-draft-scope.md | 45+9定向；关闭端口真实网络/Chrome失败保留/取消；成功MySQL独立见E01 |
| E23 | docs/review/role-package-parity-2026-10-20.md | 25定向；Chrome+原生文件框真ZIP校验8差异→明确发布；目录绑定冻结，不算角色所有发布态 |
| E24 | docs/verification.md §2026-10-20重试设置分区 | 19配置/等待/模板回归、CUA草稿与保存回读30/300；不是真实429或全主题 |
| E25 | docs/review/p14-final-visible-gaps-2026-10-20.md（原90d45b9，集成818bf6c） | 11回归+正式CUA真实归档succeeded/key/auditId；当前质量仅当前执行最近复核，历史审计保留。该记录旧roles-legacy问题由29d80bf/E23覆盖，不继续列当前缺口 |
| E26 | docs/review/live-session-scope-2026-10-20.md；p09-file-evidence-2026-10-20.md追加 | 87c0e92修复0无限时会话30秒到期和嵌套写入。真实模型原生多选/其他→IAB答复→同session提交1/1；单文件5步真实模型+3项JUnit+独立复核1/1，Run GUI覆盖/源码hash/报告已读，四主题1280×720。不是多文件、权限与全部GUI状态PASS |

## 3. 当前优先项与明确不开放

1. 当前818bf6c的后台原生交互：E20明确无节点/规划上下文的knowledge/charter/review/fix原生question/permission自动拒答；知识独立来源由A后续负责。节点问答协议/GUI已通，不能外推这些后台会话也已通。真实模型节点自然提问→IAB多选及其他答复→同session提交已由E26补证；后台业务域仍按各自证据。
2. 模板归档与当前质量已在818bf6c修复并有E25独立回归/CUA；继续补UNKNOWN重启与完整质量状态GUI，不再列现存功能缺陷。
3. 项目原稿 projects.html:148/193 的技术栈事实尚无真实Project字段/详情投影。当前显示Git/非Git状态是真实工作区能力，不得伪造技术栈。Lead已排后续独立实现，本矩阵不提前判通过。
4. 新普通源码/单测逐文件合同已经真实HTTP/JUnit子进程验证；其模型写作→独立复核→Run实际阅读的整体M/G仍待Lead当前live批，不得用README普通执行或离线fixture替代。
5. 具体GUI缺项按第1节和验收矩阵逐状态登记补测；四主题×三尺寸、UNKNOWN/撤权/迟到/冲突/取消返回普遍未齐，不降为可选。

设计边界：PE28子隔离/汇合、PE38跨范围替换禁用；PE37已开放且受限，不能退回“后续”。TaskDelivery reviewer按sources/delivery/API-DESIGN-CANDIDATE.md:271/449明确无字段/当前未接通；Fix reviewer是sources/git/API-DESIGN.md:143/697/728可选候选P3，不冒充完成扩展。外部MCP安装/连接编辑、数据库planned驱动按服务能力与只读权威逐项判断，不把UI禁用本身作为完成证据。

GitHub 2026-10-19真实远端写仅保留历史验收；本轮没有新GitLab实际写。MySQL本地成功不替代PG/其他厂商。macOS原生PDF/产物保存不替代Windows/Linux或签名公证安装包。

## 4. 补充稿载体

交付面板位于任务页，不新增一级菜单；Git工作台 /git 与节点NodeDetailPanel分别按对应补充稿核对。E01保留历史Git真实模型/远端层，E14/E15补节点当前读取/导出/撤权层；完整git49/node60/delivery70登记状态仍须逐条补G。产品名agent-workflow与四套集中主题是既有决策，不当成设计缺口。

## 5. 历史矩阵快照（不作为当前完成口径）

<details><summary>2026-10-19 Wave0–3G矩阵原文，历史403测试/163路由身份保留</summary>

以下“全部功能完成”“唯一外部阻塞”“视觉可选”等旧判定已撤回；旧501/无接口/非流式等不代表818bf6c。保留原文用于追溯，不重复计算通过。

```text
# 设计稿覆盖矩阵

> 设计来源：`opencode-workflow-design-showcase/`（v5：`originals/main` 22 个正式产品页 + B-01/B-04/B-15 补出 recovery / requirements / roles-legacy，共 25 页；另核对 delivery / planning / git / node 补充稿）。
> 实现基线：`apps/web/src/app/App.tsx`（2026-10-19，Wave 0–3G 全部功能完成后的工作区快照）。
> 状态口径：✅ 主流程与设计对齐（仅文案/P2 差异，关键缺口列仍注明）；🟡 页面/载体已实现，但部分区块按服务能力降级或仍有限制；缺失/无载体 **当前 0 页**。
> 证据口径：集成测试 + `npm test`（最终 **403 tests / 54 suites / 392 pass / 11 skipped / 0 fail**，67.6s，`.tmp/wave3g-verify.log`）+ `docs/review/execution-log.md` + `npm run docs:api` / `check:docs-routes`（**163 路由**）+ `build:web`/`build:server` + `test:e2e` + `ui:smoke`（兼容 flags，13 截图 + 2 交互）。截图清单见 `docs/evidence/README.md`（30 张：8 张当前 + 22 张历史）。
> 打包/真实环境：W4-4 已重建 346MB 未签名 `.app`；W4-5 真实 PG/GitLab 因本机无实例/凭据 **blocked**。证据与复现见 `docs/packaging.md`。
> 与审查报告的关系：`docs/review/design-parity.md`（18:39 快照）是逐页差异审查；本文件是**当前覆盖矩阵**，已按 Wave 1/2/3A–3G 的最终代码更新。

## 0. 总结

- 25 个正式页：**✅ 3、🟡 22、缺失 0**。所有页面均有路由/载体；`workflow-editor` 已在 W3-8b/8c 实现并标 🟡（受服务模型限制）。
- 已闭合的全部功能波次（Wave 0–3G）包括：基础回执/启动恢复、执行控制/验收 gating、PPT 作品库/四步工作台、Inbox interactions、角色四页签、项目详情 charter/docPaths/GitLab、PE37 分组细化、知识研究步骤/工具轨迹、任务冻结/审计/快照评审 B-07/运行内容、工作流目录与编辑器、设置/工具/数据库/模板结构、CI/e2e/截图刷新、API 文档（163 路由）。
- **仍为降级但不阻塞功能**：B-07 阶段报告 `available:false`（未接评审报告服务）、知识问答非流式（无 SSE，旧历史无 steps）、charter 模型生成真实 501、GitLab 项目级配置运行时仍用全局、角色 B-02/B-03 与形象/使用统计、数据库/工具/模板部分后端字段、工作流编辑器无并行/任意连线/缩放/视觉 diff、PPT 高级视觉、首页「进行中」单卡、审查并排代码差异、恢复不复制执行上下文。
- **唯一外部阻塞**：W4-5/W2-5 真实 PostgreSQL/GitLab（无实例/凭据，未伪造 PASS，见 `docs/packaging.md` §7）；发布类 W4-4 签名/公证/跨平台/自动更新、W4-6 推送 main 待执行。
- **品牌决策**：产品名继续 `agent-workflow`；设计稿 `opencode-workflow` 仅作来源名，不做全局改名（见 README「品牌与命名」）。

## 1. 25 个正式产品页

| # | 设计页 | 实现路由 / 载体 | 覆盖度 | 已验证证据 | 关键限制 / 降级 | 更新 |
|---|---|---|---|---|---|---|
| 1 | `home` | `/` `HomePage` | 🟡 | W3-11a 展示化：hero/流程演示/能力卡；`evidence/ui-home-*.png` 刷新 | 设计「进行中」单卡未做；产品名按决策用 `agent-workflow` | 10-19 |
| 2 | `projects` | `/projects`、`/projects/:projectId` `ProjectDetailPage` | 🟡 | W3-1b+3-1c：charter 状态机/手动编辑/confirm 写 AGENTS.md/501 生成、docPaths 保存、GitLab 项目级覆盖；四页签 UI | charter 模型生成 501（手动 fallback）；GitLab 项目级只保存非敏感配置、运行时仍全局；charter 版本只读无恢复接口 | 10-19 |
| 3 | `knowledge` | `/knowledge` `KnowledgePage` | 🟡 | W3-4b：真实研究步骤（retrieve/model/tool/validate）与工具轨迹时间线；来源选择/引用原文 520/研究员面板 | **非流式**（无 SSE；完成后一次性时间线）；旧历史无 steps/toolActivity 时隐藏；角色证据/项目许可无 DTO | 10-19 |
| 4 | `knowledge-history` | `/knowledge/history` `KnowledgeHistoryPage` | 🟡 | 真实历史/引用分段/日期分组/继续追问 | 服务无会话状态字段（按引用降级）；无重命名/归档/删除 | 10-19 |
| 5 | `ppt` | `/ppt` `PptPage` + `PptWorksView`/`PptWorkbench` | 🟡 | 作品/附件/生成/编辑/导出/删除全链路；真实 PPTX；`evidence/ui-ppt.png` | 讨论需求五项/视觉方向/逐页视觉检查无契约；高级视觉（品牌模板/PDF）未做 | 10-19 |
| 6 | `ppt-works` | `/ppt` 内作品库（无独立路由） | 🟡 | 作品网格/列表/选中进入工作台 | 缩略图接口缺失（示意封面）；复制/归档/版本无接口；无分页 | 10-19 |
| 7 | `ppt-studio` | `/ppt` 内四步工作台（无独立路由） | 🟡 | 四步（讨论/设计/制作检查/导出）、阶段进度/下一步 | 三个视觉方向、简报五项、逐页视觉检查无契约；导出不标记完成 | 10-19 |
| 8 | `start` | `/start` `StartPage` | 🟡 | 项目→目标（自动名）→流程三段卡、版本/回执、深链 | 项目/流程抽屉仍为选择卡；部分状态矩阵未细分 | 10-19 |
| 9 | `workflows` | `/workflows` `WorkflowsPage` | 🟡 | W3-8：目录（内置/我的/搜索/归档）、复制/新建/归档、详情步骤链 | 并行分支/任意连线无服务字段；无使用次数统计；详情错误态有限 | 10-19 |
| 10 | `workflow-editor` | `/workflows/:id/edit` `WorkflowEditorPage` | 🟡 | W3-8b/c：画布步骤链/插入/面板/检查/保存/409 冲突（查看版本/导出修改）；内置只读→复制后改 | 无并行/任意连线（服务为有序步骤）、无拖拽平移缩放、无步骤模板抽屉、无视觉 diff；描述只能在新建对话框设置 | 10-19 |
| 11 | `requirement` | `/requirement/:id` `RequirementCanvasPage` | ✅ | planning-live；PE37 proposal/refine-preview/scoped start/组候选/确认拦截（`pe37-http.test.ts` 5 pass）；五段胶囊/图层/页签/检查/应用/确认 | 缺页头「更多操作」；跨组依赖提示依赖服务校验 | 10-19 |
| 12 | `tasks` | `/tasks` `TasksPage` | 🟡 | 行菜单/聚合进度/加载更多 | 服务无逐步骤状态（聚合替代）；归档接口未接通；分页无总数/游标 | 10-19 |
| 13 | `task` | `/tasks/:id` `TaskCanvasPage` | 🟡 | W3-5b：「⋯」四入口（恢复/冻结/审计/快照评审 B-07/运行内容）+ 冻结/审计/评审 HTTP 回执；W0-4c 待验收情况条 | B-07 阶段报告 `available:false`、mode/depth=unknown；冻结只存快照不改计划；快照评审只读；情况条缺上下文操作 | 10-19 |
| 14 | `inbox` | `/inbox` `InboxPage` + `/api/interactions` | 🟡 | interactions 3 测试；自由文本/候选审阅/unknown 只读/草稿/回执 | 无选项/多选/推荐/拒绝字段（free_text 降级）；权限/策略无来源；review/reconcile 跳画布；无分页 | 10-19 |
| 15 | `insights` | `/insights` `InsightsPage` | ✅ | insights/task-acceptance/task-usage 测试 | 少项目/任务状态/归档筛选；多出运行统计块（P2） | 10-19 |
| 16 | `templates` | `/templates` `TemplatesPage` | 🟡 | W3-9c 分组/运行说明/B-06 只读说明；33 项 UI 断言 | 分支/时间范围/源码范围/需求文档/分类/B-06 归档无后端字段 | 10-19 |
| 17 | `run` | `/runs/:taskId` `RunContentPage` | 🟡 | W3-7c 47 项断言；W3-12 diff 修复；W3-5b 任务画布入口 | 无专用运行内容接口（批次/报告/测试结果/日志降级） | 10-19 |
| 18 | `runtime` | `/runtime` `RuntimePage` | 🟡 | 状态卡/重启确认/错误态 | 「最近一次操作」空占位；缺外部进程/启动失败态（P2） | 10-19 |
| 19 | `tools` | `/tools` `ToolsPage` | 🟡 | W3-9c 配置范围/影响清单/Skill | 项目级工具配置、单工具策略、来源级停用、外部 MCP/安装状态无接口 | 10-19 |
| 20 | `databases` | `/databases` `DatabasesPage` | 🟡 | W3-9c 可读范围/授权/三格检查/驱动标签/说明 | 多 schema/表级范围、项目授权、会话只读、最近 probe 摘要、openGauss/GaussDB 无契约 | 10-19 |
| 21 | `roles` | `/roles` `RolesPage` | 🟡 | 四页签/资源权限/形象/发布检查；`role-catalog-extended` 5 pass；`evidence/ui-roles.png` | B-02 已发布回执核对、B-03 权限预估、形象目录、步骤级使用统计无接口 | 10-19 |
| 22 | `settings` | `/settings` `SettingsPage` | 🟡 | W3-9b 分区/脏保存/降级；W4-3c 修复 `.snav .cap` 并重拍；`evidence/ui-settings.png` | 保存条只覆盖执行限制+监控；部分引擎字段未读取；业务超时/分类重试字段未提供 | 10-19 |
| 23 | `recovery` | `/recovery`、`/tasks/:id/recovery` `RecoveryPage` | ✅ | recovery-api/modes；verify_only 硬只读+readOnly 投影；abandon 暂停态；unknown 三入口 | 不复制执行上下文/阶段图；规划上下文仍以核对/未知为主 | 10-19 |
| 24 | `requirements` | `/requirements` `RequirementsPage` | 🟡 | 搜索/项目筛选/阶段计数/加载更多 | B-15 详情抽屉/计划修订说明未做（结构批次） | 10-19 |
| 25 | `roles-legacy` | `/roles/legacy` `RolesLegacyPage` | 🟡 | 真实目录/分组/四组只读/发布快照 diff；面包屑 | 能力/资源权限/形象契约缺失（明确未提供）；导入无接口；阶段绑定字段缺失 | 10-19 |

## 2. 补充稿与评审辅助页

| 设计稿 | 实现载体 | 覆盖度 | 已验证证据 | 关键限制 | 更新 |
|---|---|---|---|---|---|
| `delivery/start.html` | `/start` + 需求画布「工作区」页签 | 🟡 | 开始页三段结构；workspace 测试 | 无隔离方式行/两步预览；隔离信息在需求画布 | 10-19 |
| `delivery/task.html` | 任务页 `TaskDeliveryPanel` | ✅ | delivery/directory-apply 测试 | 以右侧面板承载（设计明确不新增一级页面） | 10-19 |
| `delivery/git.html`、`delivery/apply.html` | 任务页交付面板 | ✅ | directory-apply-e2e、merge/MR 测试 | 非 Git 应用/文件选择/分步确认齐全 | 10-19 |
| `delivery/index.html`、`delivery/flows.html` | 不适用 | N/A | — | 评审辅助状态图 | 10-19 |
| `planning/start.html` | `/start` | ✅ | planning-live；三段卡 | 方法卡/版本/回执齐全 | 10-19 |
| `planning/requirement.html` | `/requirement/:id` | ✅ | planning-live；PE37 HTTP/UI | 五段/图层/页签/记录/检查/PE37 齐全 | 10-19 |
| `planning/task.html` | `/tasks/:id` | 🟡 | execution-control 5 pass；节点验收/gating；W3-5b | B-07 阶段报告/mode/depth 降级；冻结不改计划 | 10-19 |
| `git/index.html` | `/git`、`/git/:projectId` | ✅ | git 测试 + GitHub 真实读/写 | 三栏/三页签/diff/审查/修复/交付齐全 | 10-19 |
| `git/flows.html` | 不适用 | N/A | — | 操作流程说明 | 10-19 |
| `node/index.html` | 任务页 `NodeDetailPanel` + `NodeSubviews` | 🟡 | W3-10 工具/产物/引用/宽阅读/断线提示；W3-5a 推进 | 服务无产物正文/工具增量接口处降级；平移到节点未实现 | 10-19 |
| `main/index.html`、`main/skin-map.html` | 不适用 | N/A | — | 设计目录/颜色迁移图 | 10-19 |

## 3. 最终剩余项（仅外部阻塞/发布/设计降级）

| 项 | 状态 | 说明 |
|---|---|---|
| Wave 0–3G 全部功能波次 | ✅ 完成 | 403 tests / 163 路由 / build / e2e / ui:smoke 通过 |
| W4-5 真实 PostgreSQL/GitLab；W2-5 GitLab 真实写 | **blocked（外部环境）** | 本机无实例/凭据、无 live 测试；需 `WF_PG_*` / `GITLAB_TEST_*`，见 `docs/packaging.md` §7；不伪造 PASS |
| W4-4 发布：签名/公证/dmg/zip/Windows/Linux/自动更新/CI 打包 | 🟡 只有未签名 arm64 `.app` | 346MB，未签名/未公证/无安装包；`docs/packaging.md` |
| W4-6 推送 main | 🟡 pending（Lead） | `https://github.com/wangyufengsky/agent-workflow-deepseek`；origin 已配置，当前 master |
| 像素级视觉回归 | 🟡 可选深度 | ui:smoke 文案/主题/交互 + 30 张证据，无像素 diff |
| B-07 阶段报告 / mode / depth | 🟡 设计降级 | `partialReport.available:false`、unknown；不伪造审查方式/报告 |
| 知识问答非流式 | 🟡 设计降级 | 真实 steps/toolActivity 一次性返回；无 SSE；旧历史无字段时隐藏 |
| charter 模型生成；GitLab 运行时 | 🟡 设计降级 | generate 真实 501；项目级只保存非敏感配置，运行时仍全局 |
| 角色 B-02/B-03/形象/使用统计；数据库/工具/模板后端字段 | 🟡 设计降级 | 页面按真实字段禁用/降级并写原因 |
| 工作流编辑器限制 | 🟡 设计降级 | 有序步骤模型：无并行/任意连线/缩放/抽屉/视觉 diff |
| PPT 高级视觉、首页「进行中」单卡、审查并排差异、恢复上下文 | 🟡 设计降级 | 后续可选增强 |
| 品牌命名 | ✅ 决策 | 继续 `agent-workflow`；设计稿名仅来源（README） |

## 4. 已基本对齐、不应误报的部分

- **阶段胶囊**：主稿四段，`planning/DESIGN-DELTA.md` 已定五段，实现五段，视为对齐。
- **恢复位置**：设计 `task.html` 画布右面板 vs B-01 独立页；实现独立页 + 画布入口，以 B-01 为准。
- **皮肤数量**：`index.html` 文案「五套」vs 设计实际四套；实现四套，视为对齐。
- **产品名**：设计稿 `opencode-workflow`，实现/仓库/Electron 统一 `agent-workflow`；已决策不全局改名，不算缺口。
- **菜单**：实现 17 项与 `sources/navigation-coverage-v2.json` 一致；run/legacy 面包屑已补。
- **需求画布页签**：按 planning 补充稿阶段页签，不按主稿两态。
- **主题系统**：四套令牌集中在 `themes.ts`/`ds.css`，组件无硬编码颜色。
- **Git 工作台、交付面板、恢复工作台、质量与用量**：主流程对齐，差异多为 P2。

## 5. 证据与维护规则

- 集成测试/结果见 `docs/verification.md`；每轮记录见 `docs/review/execution-log.md`；打包/真实环境见 `docs/packaging.md`；截图清单见 `docs/evidence/README.md`；逐页差异见 `docs/review/design-parity.md`（18:39 快照，已按最终代码更新）。
- 自动化证据：`npm test`（403）、`check:docs-routes`（163）、`test:e2e`、`.github/workflows/ci.yml`；`ui:smoke` 兼容 flags 通过（13 截图 + 2 交互，15 条 smoke 断言），W4-3c 设置导航缺陷已修复并重拍；仍非像素级回归。
- **blocked**：W4-5/W2-5 因本机无实例/凭据无法执行；所需环境变量/补测见 `docs/packaging.md` §7，不伪造 PASS。
- **维护规则**：每波合并后更新本文件；不得写成验证记录、不得复制 `docs/verification.md`；缺项标 🟡；缺失/无载体当前为 0，不把降级标成完成。
```
</details>
