# 设计一致性验收矩阵 · 2026-10-20

当前整理基线为 **f9bfaba**（已整合快照评审、恢复执行、模型目录、项目证据来源与工具原回执恢复），保留初次审查 `55c389f` 的状态ID/来源身份。后续真实GUI/模型证据见E26–E36；没有将旧审查全部升级PASS。设计只读，状态原名保留。归档与质量后续90d45b9已集成818bf6c，保持原证据身份E25。

## 判定与执行方法

- 优先级：合集 README v5 与 supplement-v5 > supplement-v4 > planning/delivery/git/node 补充稿 > originals/main。历史备份不用于覆盖最新版。
- 页面存在、文本断言、单元测试、API 通过、原型截图均不能替代实际产品 GUI 一致性。逐状态条目默认 **未完整验收**；已获局部证据只回填到对应身份/层，不覆盖未测的V/S/R/K。旧501/无接口等已由当前实现替代，不继续当现存缺陷。
- V：四主题 deepseek/warm/spdb/github-white，1440×900、1280×800、1024×768，以同状态设计截图逐区核对排版/宽高/间距/颜色令牌/字号/文本/图标/溢出。移除设计辅助控制条后比较产品区；品牌按已有 agent-workflow 决策。
- A：真实服务驱动操作，记录输入、可用操作及原因、requestKey、accepted/终态回执与实际副作用。模型结果必须来自配置模型；不能复制设计数据当运行事实。
- S：逐条注入加载/空/缺权限配置/漂移冲突/明确失败/取消保留/部分效果/UNKNOWN/成功；断线保留最后事实，恢复补读去重，未知只查询原操作。
- R：从正式菜单/列表进入、后退前进/刷新/返回，验证同任务身份、选中、页签、画布视角、滚动和草稿；不得重复POST。
- K：键盘Tab/方向键/Enter/Esc、焦点限制与归还、图标+文字、禁用原因可读、减少动态。
- 每条完成须补：实现commit、服务/故障数据、主题尺寸截图、交互记录、实际副作用证据、未覆盖项。服务未提供的“诚实降级”仍为设计缺口；设计本来明确缺能力态则按该态验收。

## 25 页验收入口 · 当前分层回填

每页保留P01–P25的.V/.A/.S身份；I实现/H服务或受控测试/M真实模型外部/G正式CUA相互独立。完整状态未测不得写PASS；原注册状态/行号在下方保留。具体证据见E索引。

| # / 页面 | 路由与当前实现（I） | 服务/HTTP（H） | 模型/真实外部（M） | 正式GUI（G） | 仍缺的具体GUI状态 / 当前限制 |
|---|---|---|---|---|---|
| P01.home.V/.A/.S | `/ · HomePage`；进行中单卡、真实最近任务及动作已接；不再列单卡缺失 | E10；task-catalog HTTP | — | E11：浏览器首页局部观察 | 有任务/无任务/读取失败/需处理分流；四主题×三尺寸、键盘与返回 |
| P02.projects.V/.A/.S | `/projects、/projects/:id`；公约实际快照生成/停止/原key、GitLab消费者/docPaths、真实技术栈与当前分支已接 | E09/E11/E27/E28：公约/项目22项定向 | E27：真实公约生成→单独写入1/1 | E27：生成中/草稿/写入；E28：三识别态/当前分支/修改清单重检 | E33已接GitLab及JUnit/目录来源配置与真实探针；项目独立账号继续；公约停止/UNKNOWN由服务测试覆盖，未做全主题全异常GUI |
| P03.knowledge.V/.A/.S | `/knowledge`；冻结来源/权限、真实研究/停止/继续及原生问题已接 | E03/E29：输入许可/同conversation/撤权清正文21项 | E01/E29：真实问答+原生问题答复后原session继续，GUI追问新session | E29/E35：真实问题答复与引用、研究中/待回答/撰写/完成、accepted回执 | 网络失败/DB多来源全部状态、停止继续与重启原会话的完整GUI仍待覆盖 |
| P04.knowledge-history.V/.A/.S | `/knowledge/history`；持久conversation元数据、实际needs_answer、重命名/归档/恢复、原上下文追问已接 | E29：8项会话定向，21项知识组合 | E29：配置模型实际原生问题与两轮问答1/1 | E29：历史去回答→原会话继续→引用→追问；重启后重命名/归档/恢复/刷新 | 全主题/搜索空/读取失败/UNKNOWN故障UI；服务撤权回归不冒充GUI全态 |
| P05.ppt.V/.A/.S | `/ppt`；五项简报、附件、三个方向、真实作品/生成已接 | E04/E05/E06：生产/停止/助手HTTP | E05：真实单页助手候选17秒后原key取回 | E05原生CUA；E06浏览器工作台 | 首页五项简报全部状态、模型自然澄清、附件失败/未知生成；不能以助手单页PASS代整份生成 |
| P06.ppt-works.V/.A/.S | `/ppt作品库`；真实SVG封面、复制/归档/恢复/修订已接；不再称无接口 | E04/E05：复制/归档/版本与回执 | — | E04兼容Electron图不算CUA；E06浏览器局部 | 作品库loading/error/empty、分页/筛选、复制unknown、归档恢复和取消、原生文件返回 |
| P07.ppt-studio.V/.A/.S | `/ppt工作台`；三栏/七模块/逐页持久制作与人工编辑保留、独立助手及精确停止已接 | E04/E05/E06/E30：新增逐页及停止26项 | E05助手；E30真实三页制作及第二轮2/3停止保留 | E05原生保存/PDF；E06布局；E30四主题部分完成/刷新/导出禁用 | 整份助手真实模型、停止失败/idle未知GUI、版本409草稿全矩阵、Windows/Linux导出 |
| P08.start.V/.A/.S | `/start`；最近3项目/常用3流程+搜索抽屉、当前版本核对、只建草稿 | E11：过期版本/原key HTTP | E01规划不等于开始页全态 | E11：选项目/流程→实际草稿回执 | 版本reading/flow-error、project-error、submit/unknown/handoff-error；三尺寸键盘/取消保留 |
| P09.workflows.V/.A/.S | `/workflows`；目录/历史/真实使用记录、规划职责策略只读节已接 | E07/E18：目录/版本/跨修订统计 | — | E18：真实目录总2/当前1→精确草稿 | 详情loading/error、more-error、复制/归档取消及unknown、规划职责返回定位 |
| P10.workflow-editor.V/.A/.S | `/workflows/:id/edit`；真实requires图、并行/连边、拖动/缩放/模板抽屉、版本视觉diff已接 | E07：图/保存/冻结与HTTP；非模型 | — | E07：四主题浏览器、布局保存截图 | 409本地草稿对照、unknown跨刷新、unbound/empty、撤销键盘、PE28/PE38禁用原因全态 |
| P11.requirement.V/.A/.S | `/requirement/:id`；五段、PE37、候选应用确认、记录分页/callId与seq已接 | E02/E08/E19：规划/编辑/505条分页 | E01：真实规划→应用确认准备 | E19：505条/缺口/工具原位；早期模型画布图属历史 | PE/PW全状态；超限/预算/资料撤权/停止迟到/跨组/重启unknown；不可把规划主流程扩成全矩阵 |
| P12.tasks.V/.A/.S | `/tasks`；归档恢复/结束前置、项目ID过滤分组及规划活动已接 | E10/E11：归档/同名/HTTP | — | E11：同名项目精确ID空结果 | 加载更多失败/归档与恢复/菜单禁用、planning计数与Inbox一致、步骤进度历史/空/unknown |
| P13.task.V/.A/.S | `/tasks/:id`；真实执行控制/停止确认/调整绑定/冻结、snapshot mode/depth/units/report已接 | E02/E08/E12/E13：停止19、计划7、作用域retry33、报告权限 | E01/E32：真实节点修改及full/light专用快照评审 | E14/E15节点局部；E32报告加载/正文/下载/完整性失败恢复 | running两并行/auto-off/waiting/stalled/claim-race/stop未知；snapshot取消报告GUI及全主题全尺寸仍未齐 |
| P14.inbox.V/.A/.S | `/inbox`；规划选项及原生节点permission/question、once/session/reject/hard、持久草稿/原key已接 | E17/E20：问题/权限26定向，HTTP/SQLite | E26：真实模型原生question→多选/其他答复→同session结果1/1 | E20：Chrome离线unknown/hard；E26：IAB实际模型问题答复、角标同步 | 真实模型permission事件及授权后继续；跨attempt/撤权/重启/全页筛选状态；后台无上下文来源仍限制 |
| P15.insights.V/.A/.S | `/insights`；四阶段任务计量/未知、分币、完整全集、项目/状态/质量/归档同范围已接 | E16：10项定向；205任务/混币/零 | — | E16：同名ID/归档/质量实际驳回/服务失败保留 | 全部未知/加载与错误详细对照、四主题三尺寸；E25已修正历史问题污染当前质量；未新增全状态GUI |
| P16.templates.V/.A/.S | `/templates`；必要范围/branch/date/source/doc冻结、B06历史档案已接；旧合同不回填 | E10/E12：模板范围/历史/原key | E26：v8单文件5步真实模型、3项JUnit与独立复核1/1 | E11：必要参数；E25：真实归档succeeded/key/auditId | source/doc/date所有参数失败、启动unknown、created/pending-start、历史run核对失败/导出；UNKNOWN原key恢复的完整GUI故障态仍待补 |
| P17.run.V/.A/.S | `/runs/:taskId`；专用文档/源码/单测布局、冻结输入/报告/逐文件独立复核、真实JUnit结果已接 | E12/E13：50定向，actual子进程JUnit；结果权限 | E26：新逐文件单测合同真实5步/3测试/独立复核通过 | E14原生artifact保存；E26 Run覆盖、产物hash、实际JUnit，四主题1280×720 | 批次失败/限批retry/停止/unknown、通过失败跳过文件定位、报告re-read/download撤权、输入迟到切换/宽阅读返回 |
| P18.runtime.V/.A/.S | `/runtime`；autoStart真实生效、手动启动/重启、维护锁/活动保护、历史与侧栏同步 | E11/E16/E31：12项回执/权限/启动定向 | E31：实际受管进程启动/重启两轮；不是模型调用 | E31：发送中→启动中→ready、不同PID/代次与两条成功原key | 外部/失败/unknown/read-error全态GUI、restart未知跨刷新；活动拒绝由服务回归证明 |
| P19.tools.V/.A/.S | `/tools`；来源/单工具/项目三态、冻结会话策略、Skill目录/Markdown/原文已接 | E21：4项HTTP权限，旧/新会话分离 | — | E21：停用→回读、Skill空/原文/四主题；E36丢回执/Skill返回/刷新原key | 外部MCP真实授权/清单partial、来源整体确认/项目继承、Skill读取错误/搜索命中与返回 |
| P20.databases.V/.A/.S | `/databases`；项目/schema/table授权、临时草稿探针、会话只读/撤权已接；planned驱动明确缺能力 | E22：45+9定向、真实关闭端口 | E01：已有MySQL真实1/1；非模型 | E22：草稿ECONNREFUSED保留输入、变更清探针、取消0连接 | 成功连接三格/重检失败、保存unknown/归档、运行中授权撤销；PG/其他驱动真实实例不可冒充MySQL通过 |
| P21.roles.V/.A/.S | `/roles`；发布快照真正控制模型/时限/指令/工具资源；权限预估/形象/使用统计已接 | E23/E16：角色/冻结/原key/统计 | E01真实执行不等于全部角色配置live | E23包页CUA可打开精确roleId；角色页四tab未全态 | 编辑草稿取消/发布unknown/restore冲突、B02/B03完整界面与真实资源拒绝、形象目录/统计空与读取失败 |
| P22.settings.V/.A/.S | `/settings`；分区脏状态/原key、业务限制与分类等待真正冻结生效、模型/Git真实配置 | E08/E24：19项配置/等待/模板、冻结policy | E01使用实际模型配置；非配置全态 | E24：30/300草稿跨分区；E35实际模型目录/网络保存重载 | Git+普通同时脏/保存unknown、离开确认取消、模型读取失败/限额、重试真实429/会话错误、四主题键盘 |
| P23.recovery.V/.A/.S | `/recovery、/tasks/:id/recovery`；三模式派生冻结计划/真实工作区快照、只核对硬只读及策略继承已接 | E08/E34：真实Git/目录恢复与policy/来源漂移回归 | E34：派生真实模型2/2 | E34：三模式预览确认/UNKNOWN刷新/原key、模型执行完成；E35只读画布 | 四主题全部异常态/键盘/窄屏仍未齐；不以两步骤模型结果外推任意任务 |
| P24.requirements.V/.A/.S | `/requirements`；B15只读详情/需求输入修订与计划号已接 | E10：需求/目录/冻结HTTP | — | E10未给完整B15正式GUI状态 | 抽屉loading/error、长需求/搜索空/项目切换、返回原任务及历史计划原文不能混入当前需求 |
| P25.roles-legacy.V/.A/.S | `/roles/legacy`；JSON/ZIP只读校验→差异审阅→发布绑定，四tab及完整角色字段已接 | E23：25定向、CRC/路径/回滚/绑定原key | — | E23：原生文件选择真实ZIP、8差异→勾选→发布r1 | import-invalid/nodiff/replace/back-confirm/publish-unknown全态；角色归档被绑定阻止/错误与跨刷新草稿 |

## 可追溯证据索引

| 证据ID | 原记录 / 历史身份 | 可以证明 / 不可外推 |
|---|---|---|
| E01 | docs/verification.md §2026-10-20追加/真实MySQL | 模型：1.19最小OK、知识/规划2项、README执行/审查/修复3项；MySQL1项；与2026-10-19 GitHub远端写历史分开。没有新GitLab或新fileEvidence模型PASS |
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
| E20 | docs/verification/2026-10-20-runtime-inbox.md | 26定向；实际runtime健康/OpenAPI无模型；Chrome生产组件+离线port多选/unknown/hard。真实模型自然问答由E26补证，权限事件仍按原边界 |
| E21 | docs/review/tools-parity-2026-10-20.md | 4HTTP会话冻结；CUA来源/单工具/Skill/主题/URL恢复；外部MCP真实授权未全验 |
| E22 | docs/verification/2026-10-20-database-draft-scope.md | 45+9定向；关闭端口真实网络/Chrome失败保留/取消；成功MySQL独立见E01 |
| E23 | docs/review/role-package-parity-2026-10-20.md | 25定向；Chrome+原生文件框真ZIP校验8差异→明确发布；目录绑定冻结，不算角色所有发布态 |
| E24 | docs/verification.md §2026-10-20重试设置分区 | 19配置/等待/模板回归、CUA草稿与保存回读30/300；不是真实429或全主题 |
| E25 | docs/review/p14-final-visible-gaps-2026-10-20.md（原90d45b9，集成818bf6c） | 11回归+正式CUA真实归档succeeded/key/auditId；当前质量仅当前执行最近复核，历史审计保留。该记录旧roles-legacy问题由29d80bf/E23覆盖，不继续列当前缺口 |
| E26 | docs/review/live-session-scope-2026-10-20.md；p09-file-evidence-2026-10-20.md追加 | 87c0e92修复0无限时会话30秒到期和嵌套写入。真实模型原生多选/其他→IAB答复→同session提交1/1；单文件5步真实模型+3项JUnit+独立复核1/1，Run GUI覆盖/源码hash/报告已读，四主题1280×720。不是多文件、权限与全部GUI状态PASS |
| E27 | docs/review/project-config-consumers-2026-10-20.md 后续实际快照批次 | 真实公约模型1/1+CUA单独确认写入，16项定向；首次测试断言错误保留，不算首次PASS |
| E28 | docs/verification/2026-10-20-project-technology.md | 实际清单hash与当前分支、unknown/unavailable、Chrome重检React→Vue；未声称依赖已安装 |
| E29 | docs/verification/2026-10-20-knowledge-history.md | 真实native question+原session回答、同conversation新session追问1/1；21项服务回归与历史管理CUA |
| E30 | docs/review/ppt-page-progress-2026-10-20.md | 真实逐页进行/第二轮停止2/3、四主题刷新/部分导出禁用；助手并行与重启属离线回归 |
| E31 | docs/review/runtime-controls-live-2026-10-20.md | autoStart关闭+实际启动重启、不同PID与原回执GUI；无模型调用；12项定向 |
| E32 | docs/verification/2026-10-20-snapshot-review-live.md | full/light真实模型、独立复核及阶段报告读取/下载/hash，loading/完整性失败重读GUI；离线失败报告仍可读不算模型失败验收 |
| E33 | docs/verification/2026-10-20-project-evidence-sources.md | GitLab绑定/JUnit规则/目录探针、实际Node JUnit2通过1跳过；GUI来源保存/检查；未调用真实GitLab账号 |
| E34 | docs/review/recovery-gui-2026-10-20.md | Git与目录三模式差异预览/确认、丢回执刷新原key、派生真实模型2/2与父数据不变；readonly画布补验见E35 |
| E35 | docs/review/final-gap-2026-10-20.md | 21回归、实际74模型目录、网络保存重载、人工验收推进、知识原生question及后续问答真实中间态；不代表外部发布 |
| E36 | docs/review/tools-policy-receipts-2026-10-20.md | 策略真实保存后丢响应、Skill返回/刷新锁定原key、GET原回执解锁；不重复写 |

## 全状态逐项登记

以下从设计状态表逐行提取，保留原 ID 和验收内容；链接及图路径相对于“来源”对应目录。每行均是可独立回填的验收条目。原型的计时、固定样例、模拟下载只证明画面，产品需真实服务证据。重复 ID 按最新补稿覆盖；不能重复算完成。

| 验收ID | 来源与行号 | 设计原条目（保留名称、状态/意图/检查点） | 当前实现差异与验收 |
|---|---|---|---|
| planning.pe01.001 | `sources/planning/STATES.md:12` | pe01 / start.html / 开始任务 · 普通方法选择 / 正常 / 流程方法卡写清“必经步骤 / 可按需求拆分的范围 / 是否支持 AI 规划”。未适配方法照样可选，但卡上直接写“可用骨架手动调整，不能 AI 规划”。固定步骤的“模板任务”不在这里混用，只给去模板任务的入口。主按钮仍是“形成需求草稿”，按钮下说明“只建草稿，不调用模型”。 / 形成草稿不出现模型/费用预览；三类方法卡（支持、未适配、选中）可键盘选择；模板任务入口不在方法列表里。 / F01 F08 A01 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe02.002 | `sources/planning/STATES.md:13` | pe02 / requirement.html / 需求画布 · 空草稿 / 空态 / 画布保持原 planning 空态，说明“还没有计划”。页头主按钮“生成计划”，次按钮“使用方法骨架”。右侧“需求与输入”显示不可改的原文、补充、资料、方法；状态条写“尚未调用模型”。点“使用方法骨架”只复制方法图，不发模型；之后主按钮变为“AI 细化计划”。 / “生成计划”只打开预览，不直接派发；“使用方法骨架”后图为未确认草稿；原文只读。 / F01 A01 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe03.003 | `sources/planning/STATES.md:14` | pe03 / requirement.html / 规划预览（确认开始前） / 正常 / 一次性列清：项目与授权范围、来源输入（原文 / 补充 / 资料修订）、方法与规划策略版本、模型（来自现有设置）、最多 2 次派发（初稿 1 + 修订 1）、自动传输重试 0、总时限与单次时限、本轮预算上限与预留、节点/边/组/深度上限、预览有效期。写明“确认后不改当前图；候选需要你审阅、应用、确认”。只有这一处确认模型调用。 / 数值与服务预览一致（UI 不自造）；修订次数显示实际值（可能为 0）；取消回到原处，草稿不丢。 / F01 F05 A01 A13 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe04.004 | `sources/planning/STATES.md:15` | pe04 / requirement.html / 配置 / 依据不足（生成禁用） / 权限或配置缺失 / 预览列出缺什么：预算上限未设置（去现有设置）、一份资料无读取权限（选择资料 / 去项目授权）、能力未安装等。每项给去处，生成按钮禁用并写原因。草稿、补充、已选资料原样保留。 / 不提供“仍然生成”；原因来自服务 reason；跳转到现有设置页而不是在主流程里塞专业字段。 / F01 F04 A11 A19 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe05.005 | `sources/planning/STATES.md:21` | pe05 / requirement.html / 规划中 · 准备输入 / 正常 / 页头状态条：阶段轨道只点亮真实到达的阶段；开始时间、已用时、最近活动、已读资料数、预算（已知 / 预留 / 未明）。右侧规划记录显示服务阶段卡与只读资料工具（一个仍在运行）。画布保留原方法骨架，角标“当前草稿 · 候选尚未生成”。 / 无百分比、无剩余时间；离开页面不取消；停止与离开都可用。 / F02 A02 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe06.006 | `sources/planning/STATES.md:22` | pe06 / requirement.html / 生成候选 · 运行时无公开正文 / 正常 / 记录区顶部写“此运行时暂未提供公开正文；阶段与工具活动仍然真实显示”，不把“无正文”当失败，也不补演示文字。工具卡照常更新。 / 提示文字来自能力声明；没有任何占位“模型在思考”文案。 / F02 A02 A04 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe07.007 | `sources/planning/STATES.md:23` | pe07 / requirement.html / 生成候选 · 公开正文与工具 / 正常 / 复用节点执行现场的阅读组件：公开正文（标“模型陈述”）与工具卡（callId、参数、结果、状态）按服务序号排列；来源标签区分“服务事实 / 模型陈述 / 外部资料”。上翻停止跟随，出现“回到最新”；工具卡可点开只读详情（宽阅读）。 / 模型说“完成了”不改变阶段；上翻不被拉回；工具晚回在原卡更新。 / F02 A02 A04 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe08.008 | `sources/planning/STATES.md:24` | pe08 / requirement.html / 部分草稿（检查点） / 部分效果 / 画布切到“部分草稿 · 检查点 #2”，角标“尚未完成，不能执行”；已生成的分组与节点只读，缺的“测试”组画成虚线缺口。原方法骨架仍在“当前草稿”里。应用 / 确认按钮不出现；“草稿与问题”页签列已覆盖需求与未覆盖范围。 / 部分草稿不可应用、不可确认；切回“当前草稿”可见原图未变。 / F02 F09 A02 A17 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe09.009 | `sources/planning/STATES.md:30` | pe09 / requirement.html / 程序检查中 / 正常 / “检查”页签按实际检查层显示：已完成的写结果与问题数，正在跑的转圈，没跑到的写“未开始”，不预先打勾。候选只读预览可看，但没有应用按钮。 / V1–V8 各层状态独立；没有一个总绿勾。 / F04 A09 A10 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe10.010 | `sources/planning/STATES.md:36` | pe10 / requirement.html / 有界修订中（1/1） / 正常 / 阶段轨道出现“修订候选”，状态条写“修订 1/1”与具体原因（某步骤缺少必需输入），并显示剩余已知额度。只能停止；修订后仍不合格就停给用户，不再循环。 / 修订次数、原因与预算来自服务；没有“再修一次”。 / F05 A13 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe11.011 | `sources/planning/STATES.md:37` | pe11 / requirement.html / 需要你答复 / 正常 / 列出关键问题、影响的步骤与来源，以及模型提出的假设（标“假设，未确认”）。用户答复后“保存补充”生成新的输入修订，再“预览新一轮”。模型不自答，旧轮输入不变。 / 答复不会改旧轮；预览新一轮带 previousRound；不提供“让 AI 自己决定”。 / F04 F05 A08 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe12.012 | `sources/planning/STATES.md:38` | pe12 / requirement.html / 预算 / 时限 / 次数达到 / 部分效果 / 写清达到的是哪一项上限、原账（已知 / 预留 / 未明分开）、保留下来的草稿与问题。账已结清时可“编辑输入”或“预览新一轮”；有未明用量时新派发禁用并写原因。 / 不自动加预算；未明不显示为 0。 / F05 F06 A13 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe13.013 | `sources/planning/STATES.md:39` | pe13 / requirement.html / 规划中补充（未纳入本轮） / 正常 / 补充保存为“需求输入修订 2”，横幅写“本轮仍按修订 1 生成”。两条路：等本轮结果后按补充再规划；或“停止本轮并按补充重新规划”（先停稳、核对原账再预览）。 / 补充不改当前轮；第二条路先走停止确认。 / F05 A08 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe14.014 | `sources/planning/STATES.md:45` | pe14 / tasks.html / 任务列表 · 规划状态 / 正常 / 原任务卡/表格增加规划状态：规划中（阶段 + 最近活动）、等待审阅、需要处理、正在停止、待核对。点行回到同一任务的需求画布当前轮；完成只更新站内标记，不弹窗、不强跳。 / 状态文字 + 图标，不只靠颜色；点行带 returnTo；“需要处理”筛选包含规划问题。 / F03 A03 A20 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe15.015 | `sources/planning/STATES.md:46` | pe15 / requirement.html / 返回 · 按游标补读 / 加载 / 回来时先显示已持久的记录，再按游标补读离开期间的记录，横幅写“正在补读 18 条记录（从 #42 起），不会再次调用模型”。恢复画布视角、选中分组 / 节点与右侧阅读位置。 / 浏览器后退/前进不重复 POST；刷新不重新计时；不新增派发。 / F03 A03 A04 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe16.016 | `sources/planning/STATES.md:47` | pe16 / requirement.html / 断连 / 重连 / UNKNOWN / 横幅只说本页连接：“数据连接已断开，正在重连”，并写最后已知的服务状态与时间。规划本身不判失败、不停止、不重发。重读 / 停止是否可用由服务回执决定，断连期间停止按钮写“连接恢复后可用”。 / 已读内容不清空；连接状态与运行状态分开展示。 / F03 F06 A04 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe17.017 | `sources/planning/STATES.md:48` | pe17 / requirement.html / 不可补的记录缺口 / UNKNOWN / 记录流中画一条虚线缺口，写清范围（#41–#57）与服务给的原因；前后已读内容照常可看。不填造内容。 / 缺口可被键盘读到；不出现“补全中”的假进度。 / F03 F06 A04 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe18.018 | `sources/planning/STATES.md:54` | pe18 / requirement.html / 请求停止（确认） / 取消保留 / 确认框写清：只停止这一轮规划，不影响任何执行中的业务步骤；已有记录、草稿与用量都保留；停止完成前不能开始新一轮。 / 取消对话框焦点回到原按钮；确认后按钮进入“请求中”防双击。 / F06 A05 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe19.019 | `sources/planning/STATES.md:55` | pe19 / requirement.html / 正在停止 / 取消保留 / 三件事分开写：停止请求已受理（回执号）、原进程是否已停稳、用量是否已结账。期间可查看记录与草稿；新一轮、应用都禁用并写原因。 / 不写“已停止”直到 process=stopped 且 accounting=closed。 / F06 A05 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe20.020 | `sources/planning/STATES.md:56` | pe20 / requirement.html / 已停止 / 取消保留 / 写停稳时间与原账核对结果；部分草稿、记录可看；可“从保留草稿预览新一轮”（新调用，重新预览）。迟到的候选只记审计，不复活。 / 新一轮必须重新预览；旧轮不变成 running。 / F06 A05 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe21.021 | `sources/planning/STATES.md:57` | pe21 / requirement.html / 停止 / 派发结果待核对 / UNKNOWN / 写原请求号、哪一步结果不明（停止回执未知 / 派发是否发出不明）。唯一动作“核对原轮次”（只读核对，不发模型）；不出现“重试生成”或换新请求号重投。 / 核对动作幂等；核对后按真实证据转为已知状态，仍不明则保持。 / F06 A06 A07 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe22.022 | `sources/planning/STATES.md:58` | pe22 / requirement.html / 明确失败 / 明确失败 / 写失败在哪个阶段、服务给出的公开错误、保留了什么（检查点 #2、记录、原账）。下一步按权限给：核对、编辑输入（如缩小资料范围）、从保留草稿预览新一轮。无自动重试。 / 失败原因与“连接断开”文案区分；新轮必须重新预览。 / F06 A07 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe23.023 | `sources/planning/STATES.md:59` | pe23 / requirement.html / 服务重启后核对 / UNKNOWN / 写“服务在 14:06 重启，正在核对原轮次的进程、会话与用量”，逐项显示核对进度；不写“自动恢复成功”。期间只读。 / 核对期间不派发；不重置时限与修订计数。 / F06 A07 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe24.024 | `sources/planning/STATES.md:60` | pe24 / requirement.html / 原轮仅观察续接 / 正常 / 核对确认原轮仍在运行，提供“继续查看原轮次（不会发送新的提示）”。若不能续接，另一种结果是“从保留草稿开始新轮次”，写明是新调用。 / 两种结果文案清楚区分；不提供万能“恢复”。 / F06 A07 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe25.025 | `sources/planning/STATES.md:66` | pe25 / requirement.html / 候选待审阅（diff） / 成功 / 画布默认“对照”：新增 / 修改 / 由细化替换 / 未变四种标记，分组可折叠。右侧“计划”页签给差异摘要、需求覆盖、需人工判断项；“检查”页签分“结构检查 / 需人工判断 / 依据 / 执行准备”四块，不压成一个绿勾。主按钮“应用到草稿”，旁注“应用后仍需确认计划，不会执行”。 / 原图在“当前草稿”中保留；每个问题可定位到节点；需人工判断项需逐项勾选“已核对”才可应用（候选规则，见待决 Q6）。 / F04 F09 A10 A14 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe26.026 | `sources/planning/STATES.md:67` | pe26 / requirement.html / 候选已到 · 原进程未停稳 / 部分效果 / 可只读审阅候选；“应用到草稿”禁用，原因“正在核对本轮结束（原调用尚未停稳 / 未结账）”。不能把“正文已结束”当作完成。 / 应用禁用原因可被键盘聚焦读出。 / F04 F06 A05 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe27.027 | `sources/planning/STATES.md:68` | pe27 / requirement.html / 候选硬阻塞 / 冲突 / 问题清单逐条：循环依赖、必需输入未绑定、引用的行号不存在、写入超出授权。每条可“定位”到画布节点 / 边；没有“忽略继续”。下一步：编辑输入后新一轮，或不采用候选。 / 应用按钮禁用并写“有 4 个必须处理的问题”；定位改变画布选中与视角。 / F04 A09 A11 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe28.028 | `sources/planning/STATES.md:74` | pe28 / requirement.html / 并行写冲突（设计候选 · 后续分期） / 冲突 / 列出互不依赖但写同一资源域的两个步骤与真实资源（文件子树）。MVP 只给“改为先后执行（形成新差异）”；“申请子隔离与汇合”禁用并写“未安装 · 后续分期”。采纳串行后出现新的资源边并重新检查。 / 程序不静默加边；外部写入（DB/HTTP）不因 worktree 被当作隔离。 / F10 A12 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe29.029 | `sources/planning/STATES.md:80` | pe29 / requirement.html / 输入 / 原图 / 依据漂移 / 漂移 / 写清候选基于哪些版本、现在变成了什么（补充需求修订 2、手改计划修订 3、一份资料内容变化）。旧候选保留可比较；应用禁用；给“按当前输入重新预览”。 / 不能覆盖当前草稿；差异逐项可读。 / F04 A11 A14 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe30.030 | `sources/planning/STATES.md:86` | pe30 / requirement.html / 历史轮次（只读） / 正常 / 常驻“历史轮次 · 只读”横幅与“回到当前”；显示当时的输入、候选、记录与原账。没有应用、继续执行等动作；旧格式轮只显示已知事实。 / 回到当前恢复原选中与页签；历史不借当前权限绕读。 / F03 A19 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe31.031 | `sources/planning/STATES.md:92` | pe31 / requirement.html / 已应用到草稿 · 未确认 / 成功 / 横幅写“已把第 3 轮候选应用到草稿（计划修订 3，未确认）”和改动摘要。可以继续手改；主按钮“确认计划”，不直接开始执行。 / 应用与确认是两个动作；后退不重复应用。 / F04 A14 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe32.032 | `sources/planning/STATES.md:93` | pe32 / requirement.html / 确认计划 → 准备独立工作区 / 成功 / 确认框给真实范围摘要：步骤 / 依赖 / 需求覆盖 / 已审阅的人工判断 / 读写范围，并写“确认不调用模型、不执行”。确认后衔接最新 TD 两步：“准备独立工作区” → 成功后单独“开始执行”。 / 确认范围包含规划依据；准备成功前“开始执行”禁用。 / F04 F10 A18 A20 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe33.033 | `sources/planning/STATES.md:99` | pe33 / task.html / 执行中申请调整（暂停新增领取） / 正常 / 先说明会发生什么：暂停新增领取，运行中的“后端筛选查询”按原快照继续。确认后情况条写“正在暂停新增领取…”，回执成功才开放编辑。 / 围栏成功前编辑不可用；运行中节点不被强停。 / F07 A15 A16 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe34.034 | `sources/planning/STATES.md:100` | pe34 / task.html / 编辑待执行区 · 领取竞态 / 冲突 / 可编辑节点标“可修改”，已领取 / 运行中 / 已完成节点与其入边带锁。示例：保存时服务回 REVISION_CONFLICT——“导出 CSV 接口”在暂停生效前已被领取。本地修改保留为草稿，“重新读取并比对”后只剩可用的修改。 / 冲突不丢本地草稿；锁节点无编辑入口；新增依赖有表单替代拖拽。 / F07 A15 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe35.035 | `sources/planning/STATES.md:101` | pe35 / task.html / 语义保存后重新确认 → 继续 / 正常 / 情况条醒目写“计划已变更，后续步骤等待重新确认”。“重新确认计划”后才出现“继续执行”；继续时恢复进入调整前的自动推进设置（原为开启 → 开启；原为暂停 → 仍暂停）。 / 布局移动不触发重确认；继续不暗开自动推进。 / F07 A15 A16 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe36.036 | `sources/planning/STATES.md:107` | pe36 / task.html / 固定模板任务 · 只读 / 正常 / 阶段胶囊在“确认计划 · 固定模板 · 待确认”（模板：单元测试开发 · 版本 7）。新增步骤、AI 细化、改职业 / 依赖 / 参数全部禁用，统一原因：“该任务使用固定模板，创建后不能修改步骤；要改要求，请新建模板任务。”可查看、调整布局、确认、准备、开始。 / 画布无“+”；节点详情无编辑；入口文案统一。 / F08 A01 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe37.037 | `sources/planning/STATES.md:113` | pe37 / requirement.html / 大需求总览 · 未细化范围 / 部分效果 / 覆盖全需求的分组总览：已细化的组可展开为叶子，未细化的组写“未细化，不能执行”。选择一个组“继续规划选区”（新一轮预览）。确认按钮禁用：“还有 3 个组未细化”。超出本期上限时写明能力上限，不自动把剩余需求丢进待办。 / 分组不是执行节点；折叠不改 DAG；未细化不可确认。 / F09 A17 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.pe38.038 | `sources/planning/STATES.md:114` | pe38 / task.html / 有界局部细化候选（设计候选 · 后续分期） / 后续分期 / 选区外的图保留并变淡；选区边界画只读端口（入口 / 出口与 IO 指针），候选 B1→B2 接回端口。右侧列端口重接与覆盖变化。“边界端口契约未冻结，跨范围替换暂不可用”，应用禁用。 / 端口不可编辑；不出现旁路边；已领取的外部节点使端口不可用。 / F07 F09 A14 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.b01.039 | `sources/planning/STATES.md:120` | b01 / requirement.html / 加载中 / 加载 / 保留外壳、页头与右侧骨架；画布区骨架，不出现假节点。 / 侧栏与主题在加载前就在。 / F03 A03 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.b02.040 | `sources/planning/STATES.md:121` | b02 / requirement.html / 读取失败 / 明确失败 / 写“规划记录读取失败（服务返回 503）”，给“重新读取”。读取失败不等于规划失败。 / 重读不发模型。 / F03 A04 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.b03.041 | `sources/planning/STATES.md:122` | b03 / requirement.html / 无权限 / 权限或配置缺失 / 只显示可公开的任务信息，正文与工具结果写“当前账号无权查看”；不展示缓存内容。 / 历史引用不能绕过权限。 / F03 A19 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.b04.042 | `sources/planning/STATES.md:123` | b04 / requirement.html / 旧版本不支持该轮次 / 权限或配置缺失 / 写“此版本不支持该规划轮次（planning-expansion.v1）”，只显示旧轮已知事实；旧 stopped 显示“已请求停止，停稳待核对”，不映射成“已停止”。 / 禁止降级写入。 / F03 A19 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.b05.043 | `sources/planning/STATES.md:124` | b05 / requirement.html / 命令结果未知（应用） / UNKNOWN / 按钮进入“请求中”防双击；响应丢失后写“应用结果待核对（请求号）”，只给“按原请求号核对”。 / 不生成新请求号重投。 / F04 F06 A06 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.b06.044 | `sources/planning/STATES.md:125` | b06 / requirement.html / 弹窗取消 · 草稿保留 / 取消保留 / 在预览里返回后，补充文字与已选资料原样保留，提示“已取消预览，补充草稿保留”。 / 焦点回到原按钮。 / F05 A08 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.b07.045 | `sources/planning/STATES.md:126` | b07 / requirement.html / 方法未适配 AI 规划 / 权限或配置缺失 / “生成计划”禁用并写“该流程尚未配置 AI 规划；可使用骨架并手动调整”，主按钮让位给“使用方法骨架”。 / 不回退为空图自由生成。 / F01 A01 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.b08.046 | `sources/planning/STATES.md:127` | b08 / requirement.html / 执行后需求追踪（工作包归执行侧） / 正常 / 执行开始后需求画布只读：阶段胶囊在“开始执行”；需求追踪表在需求 → 验收条款之后增加“步骤 · 执行结果 / 证据”，只取当前有效且验收通过的结果；“查看工作包”进入节点详情。原 B-05 面板的“工作包”页签由此归到执行侧。 / 未执行的步骤不显示产物；规划面板无应用 / 确认动作；能回到任务画布。 / F04 F10 A10 A18 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.e-home.047 | `sources/planning/STATES.md:133` | e-home / home.html / 主页 · 冷启动 / 正常 / 冷开即有完整正式菜单；“进行中”卡片里规划中的任务直接回到需求画布。 / 无底部演示链接也能到达全部状态。 / F03 A20 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.e-requirements.048 | `sources/planning/STATES.md:134` | e-requirements / requirements.html / 需求目录 · 规划状态列 / 正常 / 需求行显示规划状态，点行回到同任务需求画布。 / 返回保留来源。 / F03 A03 A20 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.e-inbox.049 | `sources/planning/STATES.md:135` | e-inbox / inbox.html / 待处理中心 · 规划事项 / 正常 / 需要答复、候选待审阅、结果待核对三类事项，点击回到对应需求画布状态。 / 不另建“规划中心”。 / F03 A03 A20 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| planning.e-templates.050 | `sources/planning/STATES.md:136` | e-templates / templates.html / 模板任务 · 创建固定任务 / 正常 / 创建前填写路径、任务说明与模板声明的参数，并预览固定步骤；写明“创建后不能修改步骤”。 / 创建后进入 PE36。 / F08 A01 / 图 | 主流程已有；此状态细节未验证。PE28/PE38遵守禁用边界。 V+A+S+R+K |
| delivery.td01-git-plan.001 | `sources/delivery/STATES.md:13` | td01-git-plan / start.html / Git 项目 · 计划确认（准备工作区 → 开始执行） / 正常 / 沿用原稿“项目 → 目标 → 流程”结构，前三步在计划确认后收为只读摘要；选中的项目卡直接显示隔离方式「Git · 独立分支与 worktree」和原项目路径。计划确认区新增「工作区」卡：任务名 / ID、基线 main @ 7c1e9a2、系统生成的任务分支、工作目录显示名与可复制路径、读写授权摘要、并行写策略（服务决定，只读文字）和可折叠的「诊断详情」。按钮分两步：先「准备独立工作区」（确认框列出将创建与保持不变的对象），准备成功后才能「开始执行」；没有“直接在原目录运行”选项（TD-A01 / TD-A04）。 / TD-A01 TD-A04 / deepseek warm spdb github-white | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td01-nongit-plan.002 | `sources/delivery/STATES.md:14` | td01-nongit-plan / start.html / 非 Git 项目 · 基线快照与独立副本 / 正常 / 非 Git 项目卡显示「非 Git · 基线快照与独立副本」，界面只叫“独立副本”，不出现 worktree、分支或 SHA，也不会 git init。工作区卡逐项列出快照时间（准备时固定）、范围、排除项，并把未复制的 data/raw-2025.parquet（210 MB）单独列出、说明需要它的节点会读不到，不能宣称整个项目已隔离。本计划没有并行写节点，策略显示为“串行写入独立副本”（TD-A16）。 / TD-A16 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td01-checking.003 | `sources/delivery/STATES.md:15` | td01-checking / start.html / 项目类型正在核对 / 加载 / 刚选中项目时，项目卡的隔离方式显示“正在核对项目类型”（unknown 虚线样式），不默认按非 Git 处理。核对完成前「形成需求草稿」禁用并就近说明原因；已填写的目标与流程不受影响。点击其他项目可看到核对 → 结果的切换（TD-A01）。 / TD-A01 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td01-combined.004 | `sources/delivery/STATES.md:16` | td01-combined / start.html / 备选文案：「准备并开始」（待 API 评审二选一） / 正常（备选文案） / 备选文案：若隔离准备是启动事务的一部分，单个按钮写「准备并开始」，按钮上方与确认框里都标明「备选文案 · 待 API 评审二选一」，并写清“准备成功前不会运行任何写文件的节点，失败或未知停在本页”。它与两步方案（td01-git-plan）只能择一，不能在产品里混用（TD-A04）。 / TD-A04 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td01-preparing.005 | `sources/delivery/STATES.md:17` | td01-preparing / start.html / 准备独立工作区中（阶段名，无百分比） / 加载 / 进行中 / 准备进度只用阶段名：登记任务身份 → 固定基线 → 创建任务分支（非 Git 为“复制快照”）→ 创建工作目录 → 核对，每阶段带结果摘要，不造百分比。准备期间「开始执行」禁用并说明“准备成功后才能开始执行”；离开页面不影响准备，回来读原准备记录。从按钮进入时按阶段自动推进到 td01-ready（备选文案方案则直接进入任务画布）。 / TD-A04 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td01-ready.006 | `sources/delivery/STATES.md:18` | td01-ready / start.html / 准备成功 · 单独开始执行 / 成功 / 准备成功：工作区卡状态“已就绪”，任务分支与工作目录标“已创建”，阶段全部完成并写完成时间。此时才出现可用的「开始执行」，点击后先确认（说明写节点只在任务工作区运行、结束后停在“等待交付”），再进入 task.html 的 td02-running。准备和开始是两次独立操作（TD-A01 / TD-A04）。 / TD-A01 TD-A04 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td01-unavailable.007 | `sources/delivery/STATES.md:19` | td01-unavailable / start.html / 项目不可用 / 权限不足 / 权限或配置缺失 / 项目不可读（权限不足）：项目卡用 danger 样式并显示“无法读取 · 权限不足”，隔离方式无法确定；错误留在项目步骤下方，给「查看项目」与「授权说明」（说明 opencode-workflow 不会自行改权限）。形成草稿禁用并说明原因，已填写的目标与流程保留（TD-A02）。 / TD-A02 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td01-empty-repo.008 | `sources/delivery/STATES.md:20` | td01-empty-repo / start.html / Git 空仓库 / 基线不可用 / 配置缺失 / 空态 / Git 空仓库：隔离方式仍是 Git，但标“空仓库 · 没有可用基线”；不显示任何占位 SHA，不自动创建初始提交，也不改用非 Git 副本。只给「重新读取」和「查看项目」，用户在原项目完成首次提交后再继续（TD-A02）。 / TD-A02 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td01-name-conflict.009 | `sources/delivery/STATES.md:21` | td01-name-conflict / start.html / 分支 / 目录同名冲突 / 冲突 / 准备在“创建任务分支”阶段停止：同名分支 task/T-2041-refund-export（指向 3f2e1d0）与同名非空目录都已存在且不属于本任务。两个对象逐个列出、可复制、可只读查看；不覆盖、不静默复用，需求草稿和计划保留，没有创建任何对象。「使用新名称重新预览」生成 -2 后缀名称，需再次确认才准备（TD-A02）。 / TD-A02 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td01-baseline-drift.010 | `sources/delivery/STATES.md:22` | td01-baseline-drift / start.html / 基线前移 · 重读后重新确认 / 漂移 / 固定基线时发现 main 已前移：并排显示确认计划时的旧基线 5b3a8f1 与当前 7c1e9a2，列出 2 个新提交。不静默换基线继续；「重新读取基线」后工作区卡显示“新基线 · 待确认”，按钮变为「按新基线准备独立工作区」，必须再次确认（TD-A02）。 / TD-A02 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td01-prepare-unknown.011 | `sources/delivery/STATES.md:23` | td01-prepare-unknown / start.html / 准备回执未知 · 核对原创建 / UNKNOWN / 准备请求发出后没有回执：从“创建任务分支”起的阶段都标为未知（虚线），说明原请求 prep-T-2041-01 保持不变。唯一动作是「核对原创建」，没有重新准备、再试一次或分配第二个目录的入口；开始执行同样禁用。核对结果读回后才进入已就绪（TD-A03）。 / TD-A03 / deepseek warm spdb github-white | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td01-partial.012 | `sources/delivery/STATES.md:24` | td01-partial / start.html / 部分创建 · 已发生步骤与定向恢复 / 部分效果 / 部分创建：任务分支已建、工作目录因无写入权限未建成、核对未执行，阶段条逐项显示已发生的步骤。已创建的分支保留，不自动清理；定向恢复入口「补建工作目录」沿用原准备记录、只补缺失的一步（确认框写明不会再建分支），另给「授权说明」（TD-A03）。 / TD-A03 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td02-running.013 | `sources/delivery/STATES.md:30` | td02-running / task.html / 执行中 · 状态栏显示独立工作区 / 进行中 / 执行中的原任务画布。页头新增工作区 chip（order-service · T-2041 · worktree），情况条拆成「执行与验收」「交付」两个事实；交付端点显示「未到达」。写入节点在节点卡上标出子工作区，原项目目录不被写入。不新增第二套画布或隐藏节点。 / TD-A01 TD-A04 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td02-parallel.014 | `sources/delivery/STATES.md:31` | td02-parallel / task.html / 同任务并行写 · 子隔离与汇合策略 / 进行中 / 同任务并行写：实现接口、编写测试各写各的子工作区，连线标「汇合」，由服务执行汇合；回归测试与人工验收读汇合后的一致快照。策略由调度服务决定，画布浮层与步骤面板只展示，不让用户分配目录（TD-A04）。 / TD-A04 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td02-awaiting.015 | `sources/delivery/STATES.md:32` | td02-awaiting / task.html / 执行已结束 · 等待交付（交付端点 + 面板） / 待交付 / 执行与验收已结束：任务徽标写「执行已结束 · 等待交付」（wait 色），绝不显示绿色「任务已完成」；节点保留各自真实状态。系统端点「交付」可点击，打开 480 面板，显示身份、执行与验收摘要和验证日志、A/M/D、未处理项、所选目标、当前动作、原请求核对、保留资源、最后更新时间。首要「查看变更并交付」：Git → td03-changes，非 Git（面板内原型变体切到 T-2043）→ td05-overview，都带 from/fromState。 / TD-A05 TD-A22 / deepseek warm spdb github-white | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td02-blocked.016 | `sources/delivery/STATES.md:33` | td02-blocked / task.html / 交付受阻 · 仍有活动写入 / 未停稳 / 受阻（禁重复） / 仍有活动写入 / 执行未停稳时，「查看变更并交付」用 aria-disabled 保持可聚焦，原因写在按钮上方并由 aria-describedby 关联；面板顶部列出原因，每条可定位到节点或审计记录。界面不会代为结束进程，也不跳过停稳。 / TD-A05 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td02-no-changes.017 | `sources/delivery/STATES.md:34` | td02-no-changes / task.html / 没有文件变更（特殊结算为候选） / 空态 / 明确「没有文件变更」，不生成空提交、不创建假 MR。「确认无文件交付并结束」标「候选 · 待产品 / API 核准」，点击只弹说明、不结算；任务仍为等待交付（TD-A07）。 / TD-A07 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td02-failed-candidate.018 | `sources/delivery/STATES.md:35` | td02-failed-candidate / task.html / 验证未通过 · 失败候选交付资格 / 明确失败（验证） / 保留真实的回归测试失败（2 个用例），节点仍为失败。面板单独显示「交付资格 · 由原证据规则判定」：允许时说明依据与「提交时再次知情确认」；原型变体可切到「不允许」，此时交付按钮禁用并写明原因。界面没有能清除失败的勾选（TD-A08）。 / TD-A08 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td02-step-committed.019 | `sources/delivery/STATES.md:36` | td02-step-committed / task.html / 已提交 · 等待推送确认（任务未完成） / 部分效果（已提交待推送） / 目标为「提交、推送并创建 MR」时，提交成功只记一步：任务徽标「交付进行中 · 等待推送确认」，端点「进行中 · 1 / 3」，面板列 ①提交 ✓ ②推送等待确认 ③MR 未开始。推送不会自动发送，按钮「继续交付：确认推送」进入 td04-committed-wait-push（TD-A12）。 / TD-A12 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td02-delivered.020 | `sources/delivery/STATES.md:37` | td02-delivered / task.html / 任务已交付 · MR 未合并（独立事实） / 成功 / 服务读回结算后才显示「任务已交付」：提交 SHA、远端 ref、MR !58 链接与完成时间；MR「打开中 · 未合并」作为 GitLab 只读的独立事实另起一块，说明合并在 GitLab 进行、之后合并或关闭不改交付记录。节点保持原样（TD-A13/15/22）。 / TD-A13 TD-A15 TD-A22 / deepseek warm spdb github-white | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td02-delivered-verify-failed.021 | `sources/delivery/STATES.md:38` | td02-delivered-verify-failed / task.html / 已交付 · 验证未通过（与全部通过区分） / 成功（验证未通过） / 「已交付，验证未通过」：任务徽标与回执卡用 warn 色而不是绿色，回执写明失败的验证与「知情交付，依据失败候选规则由服务许可」；与全部通过的 td02-delivered 明确区分，失败节点保持失败。 / TD-A08 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td02-background.022 | `sources/delivery/STATES.md:39` | td02-background / task.html / 另一个任务后台待交付 · 不抢当前视图 / 待交付（后台） / 用户正在看 T-2041（执行中），后台 T-2042 执行结束：只在侧栏「任务列表」加计数、待处理中心计数 +1，并在画布左上角放一条不抢焦点的 role=status 提示（打开 / 稍后），不切换视图、不改变当前选中与视角（TD-A05/06）。 / TD-A05 TD-A06 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td02-cancelled-retained.023 | `sources/delivery/STATES.md:40` | td02-cancelled-retained / task.html / 已取消 · 文件保留可稍后交付 / 取消保留 / 已取消：节点保留真实状态（3 步通过，后续未开始），情况条「未交付 · 文件保留，可稍后交付」。没有自动清理；仍可「查看变更并交付」已完成部分，交付不把取消改写成完成（TD-A20）。 / TD-A20 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td03-changes.024 | `sources/delivery/STATES.md:46` | td03-changes / git.html / 任务变更模式 · 文件树 + diff + 完成目标 / 正常 / 从任务交付面板进入原 Git 工作台的「任务变更」上下文：面包屑「Git 仓库 / 订单服务 / 任务变更 · 退款单分页查询与导出」，上下文条列任务分支、基线 main @ 7c1e9a2、工作区与快照 cr-7（读取于 16:02），「返回任务」带 from / fromState 回到来时状态。左栏是任务文件树（A/M/D 文字 + 颜色、整文件勾选），中间是原 diff 查看器，右侧 400 步骤栏先选完成目标。不显示 AI 审查 / findings；任务状态徽标是「执行已结束 · 等待交付」，不是绿色完成。 / TD-A06 TD-A09 / deepseek warm spdb github-white | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td03-excluded.025 | `sources/delivery/STATES.md:47` | td03-excluded / git.html / 未纳入 / 忽略文件及原因 / 正常（排除项） / 「未纳入 3 项」列出服务扫描排除的 dist/（构建产物）、.env.local（忽略规则，内容不显示也不读取）、coverage/（工具生成），每项给出规则来源与数量。未纳入项不会提交，也不会被清理；本页不能把它们加入交付，也没有「全部加入」。 / TD-A09 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td03-large-binary.026 | `sources/delivery/STATES.md:48` | td03-large-binary / git.html / 大文件分段 · 二进制 · 权限变更 / 正常（大文件/二进制） / fixtures/refunds-2026.csv（2.4 MB）按段读取：顶部写明第几段 / 共几段与已读行数，「读取下一段」只读差异、不改选择。docs/export-sample.xlsx 是二进制，只给大小与内容标识；scripts/export.sh 是 100644 → 100755 权限变更。三类在文件树里都有文字标签（二进制 / 权限），不只靠颜色。 / TD-A09 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td03-leave-context.027 | `sources/delivery/STATES.md:49` | td03-leave-context / git.html / 切到普通历史 · 退出任务上下文 / 上下文切换 / 在任务上下文里点左栏「提交 / 分支 / 合并请求」或面包屑，不直接跳走，而是出现确认条：退出任务上下文后交付步骤隐藏，任务的文件选择与提交信息草稿保留在该任务下，回到「任务变更」时恢复。Esc 只关闭确认条，永远不会触发离开任务上下文。 / TD-A06 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td03-loading.028 | `sources/delivery/STATES.md:50` | td03-loading / git.html / 读取任务变更中 / 加载 / 读取任务变更 cr-7 时文件树、diff 显示骨架，步骤栏锁定并说明原因；用阶段文字（文件列表 → 差异），不画假百分比。读取只读，不会改动任务工作区。 / TD-A09 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td03-read-error.029 | `sources/delivery/STATES.md:51` | td03-read-error / git.html / 变更读取失败 / 快照过期 · 重读 / 读失败 / 过期快照 / 读取失败是读取问题，不是“没有变更”：不显示旧的文件列表，步骤栏暂停，草稿保留。只提供「重新读取」（只读操作），没有任何会重复副作用的按钮。 / TD-A09 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td04-goal.030 | `sources/delivery/STATES.md:57` | td04-goal / git.html / 选择完成目标（三选一） / 正常 / 右侧顶部三选一完成目标：仅本地提交 / 提交并推送 / 提交、推送并创建 MR，每张卡写清依赖链。选择目标只记录目标，不会自动执行任何步骤；下方按目标列出 ① 提交 ② 推送 ③ 创建 MR，每步各自表单、各自确认。同时显示已选 / 未选文件数与完成后仍留在工作区的内容。 / TD-A10 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td04-commit-confirm.031 | `sources/delivery/STATES.md:58` | td04-commit-confirm / git.html / 提交确认 / 确认 / 提交确认框（焦点限定在框内，Esc 关闭并把焦点还给「预览并确认提交」）：目标任务分支、文件数与 A/M/D、提交信息、可信作者（来自设置 → Git 账号，不可在此修改）、基线、变更版本 cr-7、验证摘要，以及“提交后任务仍未交付、不会自动推送”。确认后定时器模拟提交，进入「提交完成 · 等待推送确认」。 / TD-A10 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td04-commit-drift.032 | `sources/delivery/STATES.md:59` | td04-commit-drift / git.html / 文件版本已变化 · 保留草稿重新确认 / 漂移 / 确认后服务核对发现已确认的文件版本变化（service.ts 16:04 被改）：提交停止，绝不静默采用新版本。提交信息与文件选择草稿保留，先「复核变更」读取 cr-8 并在文件树和 diff 上标出变化，再重新确认（确认框显示新版本）。 / TD-A10 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td04-hook-rejected.033 | `sources/delivery/STATES.md:60` | td04-hook-rejected / git.html / 提交被 hook 拒绝（脱敏原因） / 明确失败 / commit-msg hook 明确拒绝：显示脱敏后的 hook 输出（令牌显示为 [已脱敏]），任务分支没有新提交；错误提示放在提交信息字段旁。原请求明确失败且无副作用，所以允许修改后发起新的提交确认；不提供跳过 hook，也没有“再试一次”。 / TD-A14 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td04-commit-only-done.034 | `sources/delivery/STATES.md:61` | td04-commit-only-done / git.html / 目标「仅本地提交」· 提交成功即任务已交付 / 成功 / 目标为「仅本地提交」：提交成功后由任务服务结算并读回「任务已交付」，不推送。未选的 docs/export-sample.xlsx 与未纳入 3 项明确留在任务工作区，不顺手清理。卡片提供返回任务 / 工作区详情。 / TD-A11 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td04-committed-wait-push.035 | `sources/delivery/STATES.md:62` | td04-committed-wait-push / git.html / 提交完成 · 等待推送确认 / 部分效果 / 目标含后续步骤时，提交成功只记为 ① 已成功：步骤栏显示「提交完成 · 等待推送确认」，交付状态仍为“未交付 · 执行已结束”。不会自动推送；目标区收起为摘要并提供「改变目标…」。 / TD-A12 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td04-push-confirm.036 | `sources/delivery/STATES.md:63` | td04-push-confirm / git.html / 推送确认（新远端分支 · 不强推） / 确认 / 推送确认框：源提交 9d8c7b6、账户与服务器公开名（dev-zhang · gitlab.example.internal）、精确项目 shop/order-service 与 remote origin、新远端分支、连接版本 conn-v4。语义是只创建新分支：远端同名即停止，永不强推、不覆盖。 / TD-A12 / deepseek warm spdb github-white | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td04-push-exists.037 | `sources/delivery/STATES.md:64` | td04-push-exists / git.html / 远端同名分支 · 换新名重新预览 / 冲突 / 预览时远端已有同名分支：没有推送，不覆盖，也不先用旧名字试错。用户填写新名称后「用新名称重新预览」——服务先读远端确认无同名，再打开新的确认框。 / TD-A12 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td04-push-auth.038 | `sources/delivery/STATES.md:65` | td04-push-auth / git.html / 未认证 / 账户用途不足 · 查看 Git 设置 / 权限或配置缺失 / 连接账户只有读取用途：推送前检查未通过，没有发出推送，提交保留。只给「查看 Git 设置」和只读的「重新读取连接」；不展示、也不自动配置任何秘密。 / TD-A12 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td04-push-failed.039 | `sources/delivery/STATES.md:66` | td04-push-failed / git.html / 推送明确失败（已证明无副作用） / 明确失败 / 推送明确失败且服务已证明没有副作用（连接未建立、远端无该分支、原请求结算为失败）：此时才允许「新建推送请求…」，使用新的请求 key 并重新确认；原请求记录保留。 / TD-A14 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td04-push-unknown.040 | `sources/delivery/STATES.md:67` | td04-push-unknown / git.html / 推送回执未知 · 只核对原推送 / UNKNOWN / 推送发出后没有回执：结果未知，不能当作失败。只有「核对原推送」（读取远端分支比对 9d8c7b6），不会重新推送；核对前 ③ 创建 MR 保持锁定。 / TD-A14 / deepseek warm spdb github-white | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td04-mr-confirm.041 | `sources/delivery/STATES.md:68` | td04-mr-confirm / git.html / 创建 MR 确认 / 确认 / MR 表单与确认框：源为实际已推送的 ref / SHA，目标 main 带核对过的 tip，标题有 255 字符上限与计数，说明可编辑；评审人显示「暂未接通」且非必填。MR 创建成功即完成所选交付，不等待合并。 / TD-A13 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td04-target-drift.042 | `sources/delivery/STATES.md:69` | td04-target-drift / git.html / 目标分支前移 / 源变化 · 重读重确认 / 漂移 / 确认后服务创建前核对发现 main 已前移（7c1e9a2 → 4b7e2d0）：MR 没有创建。先「重新读取目标分支」，再用新 tip 重新确认；不会拿旧确认直接创建。 / TD-A13 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td04-mr-exists.043 | `sources/delivery/STATES.md:70` | td04-mr-exists / git.html / 已有合法原 MR · 显示原链接不重建 / 已有原操作 / 同一原请求已创建合法 MR !58：只显示原链接，不建第二个。依据原 MR 回执，任务服务结算并读回「任务已交付」。 / TD-A13 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td04-mr-unknown.044 | `sources/delivery/STATES.md:71` | td04-mr-unknown / git.html / MR 创建回执未知 · 只核对原操作 / UNKNOWN / MR 创建请求无回执：只有「核对原操作」（按原请求标记查找 MR），不重复 POST。核对到原 MR 后按「已有原 MR」处理并由服务结算交付。 / TD-A14 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td04-delivered.045 | `sources/delivery/STATES.md:72` | td04-delivered / git.html / 所选目标全部成功 · 任务已交付 / 成功 / 所选目标全部成功并由任务服务读回后，才出现「任务已交付」卡：真实验证状态、提交 SHA、远端 ref、MR !58（iid、源 / 目标、回执、读取时间）与剩余未交付文件；MR 未合并作为独立事实注明。按钮：返回任务（td02-delivered）/ 查看 MR（td07-mr-detail）/ 工作区详情（task.html td06-detail-git）。 / TD-A13 TD-A15 / deepseek warm spdb github-white | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td04-goal-change.046 | `sources/delivery/STATES.md:73` | td04-goal-change / git.html / 未完成时改变目标（API 未冻结） / 目标变更（待冻结） / 未完成时改变目标是显式确认（标「改变目标 · API 未冻结」）：列出已完成步骤保留不撤销、仍需与不再需要的步骤，已成功副作用不撤销、不删远端分支，并由服务按交付版本校验。 / TD-A10 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td05-overview.047 | `sources/delivery/STATES.md:79` | td05-overview / apply.html / 独立副本变更 · 选择要应用的文件 / 正常 / 任务交付面板展开为全宽视图（画布隐藏），面包屑「任务列表 / 月报改为按自然月汇总 / 应用到原项目」，「返回任务」回到来时状态。顶部固定三来源图例：基线（快照 10-15 09:40）｜任务副本｜当前原目录（尚未检查）；基线范围、排除项与未复制的 data/raw-2025.parquet（210 MB）在披露里。左侧 8 项变更可勾选（A/M/D 文字 + 图标 + 颜色），未选文件留在独立副本；右侧只能看「基线 → 任务副本」，三方在检查后可用。不出现 Git 图标、提交、SHA、MR，也不称 worktree。（TD-A16） / TD-A16 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td05-checking.048 | `sources/delivery/STATES.md:80` | td05-checking / apply.html / 检查当前原目录中 / 加载 / 「检查原目录」只读读取当前原目录并与基线、任务副本比较，步骤条显示「已检查 n / 8」（分母已知才显示）。逐项出现检查结果；检查中不能重复发起，「确认应用」不可用。模拟完成后自动进入冲突清单。（TD-A16） / TD-A16 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td05-preview.049 | `sources/delivery/STATES.md:81` | td05-preview / apply.html / 预览逐项结果（无冲突） / 正常（无冲突） / 变体样例：原目录在所选路径上与基线一致，8 项都「可应用」，逐项写明准确动作与绝对路径（新增 / 新增目录 / 替换 / 删除）。预览只读；必须「重新检查并冻结预览」后才能确认应用。（TD-A16、TD-A18） / TD-A16 TD-A18 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td05-conflicts.050 | `sources/delivery/STATES.md:82` | td05-conflicts / apply.html / 冲突清单（六类） / 冲突 / 主线检查结果（16:05）：可应用 2 项，冲突 6 项，覆盖六类：两边都修改、同名新增、删除对修改、原文件已删除、文件 / 目录类型不同、二进制不可合并（同类的符号链接显示「不支持」）。右侧冲突概览逐项可进入；底部「已选 8 · 冲突 6 未解决」，冻结按钮在冲突处理完前不可用并说明原因。没有「全部覆盖」。（TD-A17） / TD-A17 / deepseek warm spdb github-white | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td05-conflict-text.051 | `sources/delivery/STATES.md:83` | td05-conflict-text / apply.html / 文本冲突 · 基线 / 任务副本 / 当前原目录 / 冲突 / report/monthly.py 三方对照：基线 / 任务副本 / 当前原目录三栏标签固定（窄时堆叠），各自相对基线的改动着色，两边改到同一处的行加冲突标记；也可切统一 / 并排及三种比较方向。处理选项：保留当前原文件、采用任务版本（覆盖已有修改，需再确认对话框）、我已手动解决并只重新检查这一项、暂不交付该项（必需成果提示由服务判定）。选择只记入预览，不写文件。（TD-A17） / TD-A17 / deepseek warm spdb github-white | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td05-conflict-binary.052 | `sources/delivery/STATES.md:84` | td05-conflict-binary / apply.html / 二进制 / 链接 · 不可合并只能选择 / 冲突（不支持合并） / assets/logo.png 是二进制：不装成文本可合并，只显示三方身份（类型、大小、尺寸、修改时间），指纹在诊断详情里。可选保留当前原文件 / 采用任务版本（需再确认）/ 手动处理后重新检查 / 暂不交付。符号链接同类显示「不支持」，只能暂不交付。（TD-A17） / TD-A17 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td05-recheck.053 | `sources/delivery/STATES.md:85` | td05-recheck / apply.html / 冲突已处理 · 重新检查并冻结预览 / 冻结预览 / 冲突全部处理后「重新检查并冻结预览」：再读一次原目录，固定预览 pv-3（16:12）。逐项列出将写入 5 项（A 2 · M 3 · D 0）、保留当前原文件 2 项、留在独立副本 1 项；config/report.yaml 属必需成果被排除，显示服务判定（允许交付并记入回执），界面不自行放行。改动任何选择会让冻结失效。（TD-A17、TD-A18） / TD-A17 TD-A18 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td05-apply-confirm.054 | `sources/delivery/STATES.md:86` | td05-apply-confirm / apply.html / 应用确认 / 确认 / 确认对话框：原目录（可复制）、写入 5 项及 A/M/D 数、冲突已处理 6 项的构成、不写入与留在副本的项、不会改动的无关文件（含未复制资源）。服务未提供备份证据时明确写「服务未提供备份证据」、不声称可撤销；注明不是文件系统事务。焦点限定在对话框，Esc / 取消关闭并还原焦点，默认焦点在「取消」。（TD-A18） / TD-A18 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td05-drift.055 | `sources/delivery/STATES.md:87` | td05-drift / apply.html / 确认后原目录又变化 · 阻塞对应项 / 漂移 / 确认之后原目录又变化：README.md 在 16:13 被修改，写入前核对不一致 → 该项被阻塞、未写入，并已重新读取为新冲突；其余 4 项已应用，不重做。只能为未完成的项处理冲突后重新冻结预览、单独确认。任务尚未交付。（TD-A18） / TD-A18 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td05-partial.056 | `sources/delivery/STATES.md:88` | td05-partial / apply.html / 部分成功 / 中断 · 逐项原操作结果 / 部分效果 / 部分成功 / 中断：逐项原操作结果表——已应用 2、被阻塞 1、待核实 1、未执行 1。注明不是文件系统事务：已写入的项保留，不回滚，不整批重做；待核实项只能「核对原操作」，不进入新的预览；被阻塞与未执行项可重新检查并冻结预览。任务尚未交付。（TD-A19） / TD-A19 / deepseek warm spdb github-white | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td05-unknown.057 | `sources/delivery/STATES.md:89` | td05-unknown / apply.html / 应用结果待核实 · 只核对原操作 / UNKNOWN / 连接在写入过程中断：3 项「待核实」，每项只有「核对原操作」（读取原目录中的这一项并与原操作比对），没有重试或重新写入。样例中两项核对为已应用，README.md 核对为原操作未到达、原文件未改动 → 转为未执行，可进入下一次预览。（TD-A19） / TD-A19 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td05-applied.058 | `sources/delivery/STATES.md:90` | td05-applied / apply.html / 所选项全部应用成功 · 任务已交付 / 成功 / 所选 5 项全部可信写入后，由服务读回结算「任务已交付」（不是按钮点击后本地判定）。显示逐项回执、真实验证事实、保留当前原文件 2 项、按选择留在独立副本的 config/report.yaml（必需成果判定）；独立副本不自动清理。「返回任务」到 td02-delivered，另有「工作区详情」。（TD-A19、TD-A22） / TD-A19 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td05-read-error.059 | `sources/delivery/STATES.md:91` | td05-read-error / apply.html / 原目录不可读 / 权限 / 路径不可用 / 读失败 / 权限 / 原目录不可读：权限不足 / 路径不可用 / 读取超时（原型可切换示例原因）。明确没有写入、删除或移动任何文件，候选变更、选择与独立副本都保留，左侧仍可看「基线 → 任务副本」；只提供「重新读取」（只读，可重复），「确认应用」不可用。（TD-A16） / TD-A16 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td06-detail-git.060 | `sources/delivery/STATES.md:97` | td06-detail-git / task.html / 工作区详情 · Git 任务分支与 worktree / 正常 / 工作区详情抽屉（520）：类型与公开身份、原项目、基线（完整 SHA 只在诊断详情）、任务目录与分支（显示路径只读、可复制）、子工作区、创建 / 最后检查、活动写入、未交付、未决原请求、已交付凭证、清理可用性与原因、占用空间未知。「在文件管理器显示」在宿主缺能力时禁用并写明原因。 / TD-A20 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td06-detail-nongit.061 | `sources/delivery/STATES.md:98` | td06-detail-nongit / task.html / 工作区详情 · 非 Git 基线快照与副本 / 正常 / 非 Git（T-2043）：称「独立副本」，不出现 worktree / 分支 / SHA / MR。显示基线快照时间、范围、排除项和未复制的 data/raw-2025.parquet（210 MB），说明不能声称整项目已隔离；原目录标「从不是清理对象」。 / TD-A20 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td06-close-retain.062 | `sources/delivery/STATES.md:99` | td06-close-retain / task.html / 关闭 / 取消任务 · 文件保留提示 / 取消保留 / 取消任务确认框内固定显示「文件保留，可稍后交付 / 查看」：取消只让执行停在安全点，不清理工作区、不强迫清理。确认后模拟等待停稳，再切到 td02-cancelled-retained。 / TD-A20 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td06-cleanup-preview.063 | `sources/delivery/STATES.md:100` | td06-cleanup-preview / task.html / 清理预览 · 删除对象与保留对象 / 确认 / 清理预览对话框（已交付任务）：将删除 = 本任务自有本地对象（本地任务分支、worktree 目录、子工作区、内部缓存）；保留 = 原项目、远端分支、MR、提交与全部回执和记录；未交付 0；大小未知。确认后分步执行并核实，结束切到 td06-cleaned。没有定时或自动清理。 / TD-A21 / deepseek warm spdb github-white | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td06-cleanup-undelivered.064 | `sources/delivery/STATES.md:101` | td06-cleanup-undelivered / task.html / 有未交付内容 · 额外知情确认 / 确认（额外知情） / 有 9 个未交付文件：默认保留，必须勾选额外知情确认后「清理」才可用（未勾选时按钮 aria-disabled 并说明原因）。原型变体「含需保留的唯一产物」时不提供删除，只能关闭（TD-A21）。 / TD-A21 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td06-cleanup-blocked.065 | `sources/delivery/STATES.md:102` | td06-cleanup-blocked / task.html / 清理受阻 · 活动写 / 未知 / 恢复依赖 / 受阻 / 清理受阻：列出服务给出的阻塞原因（活动写入 / 原推送回执未知 / 恢复依赖），每条都能跳到对应位置（定位节点、核对原推送、查看恢复记录）。清理按钮禁用并说明原因；不排队、不在条件满足后自动清理（TD-A20）。 / TD-A20 / deepseek warm spdb github-white | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td06-cleanup-partial.066 | `sources/delivery/STATES.md:103` | td06-cleanup-partial / task.html / 部分清理 / 失联 · 核对原清理 / 部分效果 / UNKNOWN / 清理已部分发生且失联：抽屉按原步骤显示已核实 / 回执未知 / 未执行，唯一动作是「核对原清理」，不会再发同一删除。核对成功后切到已清理。 / TD-A21 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td06-cleaned.067 | `sources/delivery/STATES.md:104` | td06-cleaned / task.html / 工作区已清理 · 交付回执仍可读 / 成功 / 工作区已清理：抽屉与面板写「工作区已清理，可查看提交 / 保存证据」，显示路径加删除线并标「已删除」，交付回执、提交、远端分支与 MR 仍可读；变更页签用回执里的清单，不伪造本地文件仍在（TD-A22）。 / TD-A21 TD-A22 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td07-mr-detail.068 | `sources/delivery/STATES.md:110` | td07-mr-detail / git.html / MR 详情 · 任务来源与「已交付 / 未合并」 / 成功（MR 独立事实） / MR !58 详情：来源任务 chip 可返回任务；两条独立事实分开显示——「该任务已交付（10-15 16:20）」来自任务交付记录，「MR 未合并」来自 GitLab 只读读取。合并只有「在 GitLab 打开并合并」导航链接并说明产品内合并未提供；全页没有可执行合并按钮。 / TD-A15 / deepseek warm spdb github-white | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td07-mr-list.069 | `sources/delivery/STATES.md:111` | td07-mr-list / git.html / MR 列表 · 任务来源列 / 正常 / MR 列表为由任务交付创建的 MR 显示「来源任务 T-2041 · 已交付」chip，其他 MR 显示“来源任务 —”。状态列仍是 GitLab 的打开 / 合并 / 关闭，刷新只读。 / TD-A15 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| delivery.td07-mr-closed-later.070 | `sources/delivery/STATES.md:112` | td07-mr-closed-later / git.html / MR 后来关闭 · 任务交付历史不重开 / 历史不重开 / MR 之后在 GitLab 被关闭：MR 事实变为「已关闭」，任务交付事实仍是「已交付（10-15 16:20）」，不重开、不改写。继续工作按新任务或合法的新交付版本处理；只提供「在 GitLab 查看」。 / TD-A22 / deepseek | 交付主流程已有；此状态副作用/回执/文件结果未验证。 V+A+S+R+K |
| git.g01-overview.001 | `sources/git/STATES.md:15` | g01-overview / 仓库概览（GitLab 已连接） / 未选项目时的入口：所有已登记项目一张卡。受 Git 管理的卡给出分支、与远端差异、未提交改动、最近提交、打开的合并请求和待处理审查问题；不受管理 / 路径不可用 / 空仓库的卡写清原因和出路。 / 可交互 / deepseek-g01-overview.png<br>warm-g01-overview.png<br>spdb-g01-overview.png<br>github-white-g01-overview.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g02-no-gitlab.002 | `sources/git/STATES.md:16` | g02-no-gitlab / GitLab 未配置 / GitLab 没配置时，本地提交仍可浏览；远端分支、合并请求、推送不可用。概览顶部给出去设置的出路，卡片里的远端相关数字显示“—”并说明。 / 可交互 / deepseek-g02-no-gitlab.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g03-capability-missing.003 | `sources/git/STATES.md:17` | g03-capability-missing / Git 能力尚未接入 / 内部 MCP（git / gitlab）还没接入时整页说明，不是错误：用 unknown 虚线风格，说明后续通过应用服务 → 内部 MCP 提供，并列出已登记项目。 / 静态示意 / deepseek-g03-capability-missing.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g10-commits.004 | `sources/git/STATES.md:23` | g10-commits / 提交列表（选中最新提交） / 三栏工作台：左栏过滤与分支快捷，中栏按日期分组的提交列表与简化图谱（最多 3 条泳道，合并提交画合流点），右栏提交详情。 / 可交互 / deepseek-g10-commits.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g11-commit-detail.005 | `sources/git/STATES.md:24` | g11-commit-detail / 提交详情 · a1b2c3d 新增退款接口 / 提交详情头部：标题与正文、作者 / 提交者 / 时间、完整 SHA（可复制）、父提交、包含此提交的分支、统计，主按钮“AI 审查此提交”。下方页签“改动文件 / AI 审查 / 修复”。 / 可交互 / deepseek-g11-commit-detail.png<br>warm-g11-commit-detail.png<br>spdb-g11-commit-detail.png<br>github-white-g11-commit-detail.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g12-diff-unified.006 | `sources/git/STATES.md:25` | g12-diff-unified / 差异 · 统一视图 / 统一视图：双列行号、hunk 头（含所在函数）、折叠未改动上下文（展开 20 行 / 全部）、语法着色、成对改动的行内高亮、忽略空白。 / 可交互 / deepseek-g12-diff-unified.png<br>warm-g12-diff-unified.png<br>spdb-g12-diff-unified.png<br>github-white-g12-diff-unified.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g13-diff-split.007 | `sources/git/STATES.md:26` | g13-diff-split / 差异 · 并排视图（全宽） / 并排视图需要宽度：在三栏布局里切到并排会自动展开到全宽（中栏、左栏收起），左右各自行号，删除 / 新增对齐，长行折行。 / 可交互 / deepseek-g13-diff-split.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g14-diff-full.008 | `sources/git/STATES.md:27` | g14-diff-full / 差异 · 全宽阅读 / 全宽：隐藏中栏和左栏，文件树与 diff 占满；面包屑旁保留提交身份，Esc 或“退出全宽”回到三栏，选中与滚动位置保持。 / 可交互 / deepseek-g14-diff-full.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g15-merge-commit.009 | `sources/git/STATES.md:28` | g15-merge-commit / 合并提交 · 选择对比的父 / 合并提交有两个父：用户选“对比父 1 / 对比父 2”。父 1 = 合并进来的 main 改动；父 2 = 这条分支相对 main 的改动。审查时也必须先选父。 / 可交互 / deepseek-g15-merge-commit.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g16-branches.010 | `sources/git/STATES.md:29` | g16-branches / 分支（本地 / 远端） / 左栏切到“分支”时右栏显示分支表：本地 / 远端，是否当前、相对默认分支领先 / 落后、最后提交、关联合并请求、保护分支锁。只读：点分支 = 在提交列表筛选该分支。 / 可交互 / deepseek-g16-branches.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g17-merge-requests.011 | `sources/git/STATES.md:30` | g17-merge-requests / 合并请求（GitLab） / GitLab 合并请求列表：标题、源 → 目标、状态（打开 / 已合并 / 已关闭 / 冲突）、流水线、审批、更新时间；点开显示概要和提交，点提交进入提交详情。只读，“在 GitLab 打开”。 / 可交互 / deepseek-g17-merge-requests.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g18-large-binary.012 | `sources/git/STATES.md:31` | g18-large-binary / 大 diff 截断 · 二进制 · 重命名 · 权限 / 边界文件：1,240 行种子数据只显示前 400 行（“加载全部”模拟读取）；二进制只给大小；重命名显示 old → new 与相似度；只改权限显示 100644 → 100755。 / 可交互 / deepseek-g18-large-binary.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g19-empty-repo.013 | `sources/git/STATES.md:32` | g19-empty-repo / 空仓库（还没有提交） / 客户服务平台是刚初始化的仓库：当前分支 main 还没有任何提交。不显示图谱和详情空架子，直接说明，并提示工作区里已有 12 个未提交文件（只读）。 / 静态示意 / deepseek-g19-empty-repo.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g20-detached-shallow.014 | `sources/git/STATES.md:33` | g20-detached-shallow / 分离 HEAD · 浅克隆 / 当前不在任何分支上（HEAD 指向 c7d8e9f）：页头分支 chip 变为“分离 HEAD · c7d8e9f”并提示；浅克隆只有最近 50 个提交，列表底部说明，不提供“加载更早”。 / 可交互 / deepseek-g20-detached-shallow.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g21-read-error.015 | `sources/git/STATES.md:34` | g21-read-error / 读取失败（保留已加载内容） / 读取失败只影响失败的那一块：加载更早的提交失败时列表保留已加载的 14 个提交；某个文件的差异读取失败时其他文件照常。都给“重试”。 / 可交互 / deepseek-g21-read-error.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g22-fetch-auth-fail.016 | `sources/git/STATES.md:35` | g22-fetch-auth-fail / 获取远端更新失败（认证） / “获取远端更新”失败：认证失败时引导到 设置 → GitLab 验证连接；网络失败给重试。领先 / 落后保持上次已知值并标注时间。 / 可交互 / deepseek-g22-fetch-auth-fail.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g23-wb-no-gitlab.017 | `sources/git/STATES.md:36` | g23-wb-no-gitlab / 补充 · 工作台中 GitLab 未配置 / 工作台里 GitLab 未配置：本地提交可浏览；合并请求、远端分支、获取远端更新不可用，并就地说明去设置。 / 可交互 / deepseek-g23-wb-no-gitlab.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g24-not-git.018 | `sources/git/STATES.md:37` | g24-not-git / 补充 · 项目不受 Git 管理 / 从链接直接进入不受 Git 管理的项目（运营报表脚本 · 直接执行目录）：说明原因与出路，不显示空的三栏。 / 静态示意 / deepseek-g24-not-git.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g25-path-unavailable.019 | `sources/git/STATES.md:38` | g25-path-unavailable / 补充 · 本机路径不可用 / 支付网关受 Git 管理，但本机路径不存在：不能读取任何 Git 信息，引导到项目页更新路径。 / 静态示意 / deepseek-g25-path-unavailable.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g30-review-setup.020 | `sources/git/STATES.md:44` | g30-review-setup / 审查设置（抽屉） / 审查是只读的：范围（对比父提交 / 对比目标分支）、维度（多选，默认全选）、审查职业（冻结发布修订）、上下文（只读改动 / 改动 + 相关文件）。 / 可交互 / deepseek-g30-review-setup.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g31-review-running.021 | `sources/git/STATES.md:45` | g31-review-running / 审查进行中 / 审查运行：阶段（读取改动 → 分析 → 汇总），不显示假百分比；可停止；“在任务中查看详情”说明审查以只读模板任务运行，复用执行详情。 / 可交互 / deepseek-g31-review-running.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g32-review-result.022 | `sources/git/STATES.md:46` | g32-review-result / 审查结果（5 个问题） / 结论卡（一句话 + 严重度计数 + 维度计数 + 审查对象），问题列表可按严重度 / 按文件分组；每条有位置、说明、建议修改、接受 / 忽略 / 误报（原因可选）与“选入修复”复选框；底部固定栏“已选 4 个问题 · AI 修复所选问题”。 / 可交互 / deepseek-g32-review-result.png<br>warm-g32-review-result.png<br>spdb-g32-review-result.png<br>github-white-g32-review-result.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g33-review-in-diff.023 | `sources/git/STATES.md:47` | g33-review-in-diff / 问题在 diff 中定位 / 审查问题在 diff 的行号旁显示圆点（按严重度着色），范围内的行有左侧色条；点圆点在行下展开问题卡，可直接接受 / 忽略或回到问题列表。 / 可交互 / deepseek-g33-review-in-diff.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g34-review-clean.024 | `sources/git/STATES.md:48` | g34-review-clean / 审查无问题 / 没有发现需要处理的问题：结论卡给出肯定结论，维度清单逐项打勾；修复页签不可用（没有问题可修）。 / 可交互 / deepseek-g34-review-clean.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g35-review-failed.025 | `sources/git/STATES.md:49` | g35-review-failed / 审查失败 / 审查没完成（模型服务超时）：说明停在哪个阶段、已读取的内容；给“重新审查”（新开一次）与“在任务中查看详情”。历史审查记录不受影响。 / 可交互 / deepseek-g35-review-failed.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g36-review-unknown.026 | `sources/git/STATES.md:50` | g36-review-unknown / 审查结果未知（核对原操作） / “开始审查”请求发出后没有收到回执：不知道审查是否已开始。保持原记录，按钮“核对原操作”，不重发（与系统一致的 UNKNOWN 规则）。 / 可交互 / deepseek-g36-review-unknown.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g40-fix-confirm.027 | `sources/git/STATES.md:56` | g40-fix-confirm / 开始 AI 修复？（确认） / 修复是写操作，但在隔离的修复分支中进行：确认框写清修复位置（ai-fix/a1b2c3d-1013，基于 feature/refund 最新提交 e4f5a6b，以及为什么不是 a1b2c3d）、修复职业、修复后校验命令。 / 可交互 / deepseek-g40-fix-confirm.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g41-fix-running.028 | `sources/git/STATES.md:57` | g41-fix-running / 修复进行中 / 修复以全宽打开：阶段条（准备修复分支 → 修改代码 → 校验 → 完成）+ 实时记录摘要；可停止。写操作进行中，相关按钮锁定。 / 可交互 / deepseek-g41-fix-running.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g42-fix-result.029 | `sources/git/STATES.md:58` | g42-fix-result / 修复结果（校验通过） / 修复结果：问题对照（已修复 / 部分修复 / 未修复）、修复改动（同一个 diff 查看器，可撤销单个文件）、校验结果；右侧“下一步”分三步，依赖清楚，不自动连锁。 / 可交互 / deepseek-g42-fix-result.png<br>warm-g42-fix-result.png<br>spdb-g42-fix-result.png<br>github-white-g42-fix-result.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g43-fix-verify-failed.030 | `sources/git/STATES.md:59` | g43-fix-verify-failed / 修复后校验失败 / 校验失败：显示失败用例与输出；仍可提交，但需要勾选“我已了解校验未通过”。也可以“重新修复”（新开一次）。 / 可交互 / deepseek-g43-fix-verify-failed.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g44-fix-nochange.031 | `sources/git/STATES.md:60` | g44-fix-nochange / AI 认为无需修改 / 修复没有产生改动：逐条说明 AI 的判断（例如最新代码已经处理），没有可提交的内容；可以清理修复分支或回到问题列表调整。 / 可交互 / deepseek-g44-fix-nochange.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g45-fix-failed.032 | `sources/git/STATES.md:61` | g45-fix-failed / 补充 · 修复失败（模型未完成） / 模型没能完成修复：停在“修改代码”阶段，修复分支里可能有部分改动但未校验，不提供提交；可重新修复或放弃。 / 可交互 / deepseek-g45-fix-failed.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g50-commit.033 | `sources/git/STATES.md:67` | g50-commit / ① 提交修复 / 提交修复：提交信息由 AI 草拟、可编辑；作者来自 Git 账号设置；选择要提交的文件；split button 主动作“提交到 ai-fix/a1b2c3d-1013”，下拉“提交并推送”。按钮上方写清后果。 / 可交互 / deepseek-g50-commit.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g51-committed.034 | `sources/git/STATES.md:68` | g51-committed / 已提交 · 等待推送 / 提交完成显示新提交 SHA；“撤销文件”不再可用（已提交）。② 推送解锁：目标 origin / ai-fix/a1b2c3d-1013（新建远端分支），永不强推。 / 可交互 / deepseek-g51-committed.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g52-push-rejected.035 | `sources/git/STATES.md:69` | g52-push-rejected / 推送被拒（non-fast-forward） / 远端已有同名分支且包含本地没有的提交：不提供强制推送。先“获取远端更新”，看到远端提交后再决定（换分支名推送 / 稍后处理）。 / 可交互 / deepseek-g52-push-rejected.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g53-pushed.036 | `sources/git/STATES.md:70` | g53-pushed / 已推送 / 推送完成：远端分支链接；③ 合并解锁，默认推荐“创建合并请求”。 / 可交互 / deepseek-g53-pushed.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g54-merge-choose.037 | `sources/git/STATES.md:71` | g54-merge-choose / ③ 选择合并方式（MR / 直接合并） / 两种方式单选卡：“创建合并请求（推荐）”带 AI 草拟的标题 / 描述（附审查问题），可指派评审人；“直接合并”只在目标分支未受保护、可快进 / 无冲突、且不是有未提交改动的当前检出分支时可用，否则禁用并说明。 / 可交互 / deepseek-g54-merge-choose.png<br>warm-g54-merge-choose.png<br>spdb-g54-merge-choose.png<br>github-white-g54-merge-choose.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g55-mr-created.038 | `sources/git/STATES.md:72` | g55-mr-created / 合并请求已创建 / 合并请求 !58 已创建：显示源 → 目标、流水线状态、指派评审人；合并本身在 GitLab 完成。流程条全部完成（合并 = MR 已创建）。 / 可交互 / deepseek-g55-mr-created.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g56-merge-conflict.039 | `sources/git/STATES.md:73` | g56-merge-conflict / 直接合并冲突 / 工作区干净时直接合并可用；合并时发现冲突：列出冲突文件，目标分支未被改动，建议改用合并请求。 / 可交互 / deepseek-g56-merge-conflict.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g57-op-unknown.040 | `sources/git/STATES.md:74` | g57-op-unknown / 推送回执未知（核对原操作） / 推送请求发出后没有收到回执：保持原记录 op-push-7c21，按钮“核对原操作”，不重发；核对前合并步骤保持锁定。 / 可交互 / deepseek-g57-op-unknown.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g58-discard-confirm.041 | `sources/git/STATES.md:75` | g58-discard-confirm / 放弃修复（确认） / 放弃修复：删除本地修复分支与修复工作副本；已推送的远端分支不删除（说明在 GitLab 中处理）。审查记录保留。 / 可交互 / deepseek-g58-discard-confirm.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g59-commit-hook-rejected.042 | `sources/git/STATES.md:76` | g59-commit-hook-rejected / 补充 · 提交被 hook 拒绝 / 提交失败：pre-commit hook 拒绝，显示 hook 输出。修复分支内容没有变化，可修改后重试；不提供跳过 hook。 / 可交互 / deepseek-g59-commit-hook-rejected.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g60-push-auth-fail.043 | `sources/git/STATES.md:77` | g60-push-auth-fail / 补充 · 推送认证失败 / 推送认证失败（403 / 令牌过期）：引导到 设置 → GitLab 验证连接，回来后重试推送。 / 可交互 / deepseek-g60-push-auth-fail.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g61-mr-exists.044 | `sources/git/STATES.md:78` | g61-mr-exists / 补充 · 合并请求已存在 / 同一源 → 目标已有打开的合并请求：不重复创建，链接到已有 MR；推送已经更新了它。 / 可交互 / deepseek-g61-mr-exists.png | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g10-commits-older-loaded.045 | `sources/git/STATES.md:84` | deepseek-g10-commits-older-loaded.png / G10 点“加载更早的提交”后滚到底：图谱继续、根提交、“已到最早的提交” | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g10-commits-1280-rail.046 | `sources/git/STATES.md:85` | deepseek-g10-commits-1280-rail.png / 1280×800：左栏收为图标条，点“筛选”浮出完整左栏 | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g11-commit-detail-1024-list-drawer.047 | `sources/git/STATES.md:86` | deepseek-g11-commit-detail-1024-list-drawer.png / 1024×768：提交列表收成抽屉，从提交详情页头“提交列表”打开 | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g54-merge-choose-explain.048 | `sources/git/STATES.md:87` | deepseek-g54-merge-choose-explain.png / 说明抽屉：设计意图、验收要点、原型开关（工作区改动 / 测试命令 / GitLab） | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| git.g54-merge-choose-direct-confirm.049 | `sources/git/STATES.md:88` | deepseek-g54-merge-choose-direct-confirm.png / 工作区干净时直接合并可用 → 确认框写明“合并后自动推送 origin/feature/refund” | 已有工作台；此状态三栏/响应式/回执与远端事实未验证。 V+A+S+R+K |
| node.N01.001 | `sources/node/COVERAGE.md:14` | N01 / n01-default / deepseek-n01-default.png / 可交互 / 默认全图（无面板）。右侧没有面板，画布占满 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N01.002 | `sources/node/COVERAGE.md:15` | N01 / n01-open / deepseek-n01-open.png / 可交互 / 实现接口 · 详情打开（执行现场）。面板头：步骤 2 · 软件工程师、节点名、状态徽标、尝试选择“尝试 #3 · 当前” | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N01.003 | `sources/node/COVERAGE.md:16` | N01 / n01-closed / deepseek-n01-closed.png / 可交互 / 关闭详情（选中 / 视口保持）。进入时把缩放调到 95%，打开再关闭；关闭按钮保留选中描边与视口，点空白处才清除选中。 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N02.004 | `sources/node/COVERAGE.md:17` | N02 / n02-loading / deepseek-n02-loading.png / 可交互 / 正文首次加载。约 2.5 秒后模拟载入；骨架不冒充正文。 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N02.005 | `sources/node/COVERAGE.md:18` | N02 / n02-empty / deepseek-n02-empty.png / 可交互 / 尚无正文（已开始，模型未输出）。空态写“模型还没有输出正文”，语气中性 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N03.006 | `sources/node/COVERAGE.md:19` | N03 / n03-stream / deepseek-n03-stream.png<br>warm-n03-stream.png<br>spdb-n03-stream.png<br>github-white-n03-stream.png / 可交互 / 正文流式追加（未闭合代码块 / 长链接）。每 1.3 秒按 seq 追加样例片段；控制条可暂停 / 继续。截图时用 &stream=paused 固定画面。 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N04.007 | `sources/node/COVERAGE.md:20` | N04 / n04-wait-tool / deepseek-n04-wait-tool.png / 可交互 / 等待工具（排队）。工具卡徽标“排队” | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N04.008 | `sources/node/COVERAGE.md:21` | N04 / n04-tool-running / deepseek-n04-tool-running.png / 可交互 / 工具运行中。工具卡“运行中”徽标带图标与文字 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N04.009 | `sources/node/COVERAGE.md:22` | N04 / n04-tool-done / deepseek-n04-tool-done.png / 可交互 / 工具完成、正文继续。工具：全部结束；尝试：执行中 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N05.010 | `sources/node/COVERAGE.md:23` | N05 / n05-reasoning / deepseek-n05-reasoning.png<br>deepseek-n05-reasoning-expanded.png / 可交互 / 有公开推理摘要。标签“公开推理摘要 · 由模型服务提供” | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N05.011 | `sources/node/COVERAGE.md:24` | N05 / n05-no-reasoning / deepseek-n05-no-reasoning.png / 可交互 / 无公开推理摘要。记录流里没有空的摘要块 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N06.012 | `sources/node/COVERAGE.md:25` | N06 / n06-ended-unsubmitted / deepseek-n06-ended-unsubmitted.png / 可交互 / 正文传输结束 · 结果未提交。正文：传输结束；尝试：执行中；结果：未提交 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N06.013 | `sources/node/COVERAGE.md:26` | N06 / n06-pending-accept / deepseek-n06-pending-accept.png / 可交互 / 结果已提交 · 待验收。服务事件行“结果已提交 · 等待验收” | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N07.014 | `sources/node/COVERAGE.md:27` | N07 / n07-failed-partial / deepseek-n07-failed-partial.png / 可交互 / 执行失败 · 保留部分正文。失败时运行中的工具改为“结果未知”，并演示“时间未知”。 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N08.015 | `sources/node/COVERAGE.md:28` | N08 / n08-cancelling / deepseek-n08-cancelling.png / 可交互 / 取消中。继续流式时测试结果仍会到达，演示“取消请求 ≠ 已停止”。 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N08.016 | `sources/node/COVERAGE.md:29` | N08 / n08-cancelled / deepseek-n08-cancelled.png / 可交互 / 已确认取消。尝试：已取消 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N08.017 | `sources/node/COVERAGE.md:30` | N08 / n08-cancel-unknown / deepseek-n08-cancel-unknown.png / 可交互 / 取消结果未知。“核对原操作”模拟读取约 0.9 秒后给出“仍未确认”；没有重发入口。 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N09.018 | `sources/node/COVERAGE.md:31` | N09 / n09-receipt-unknown / deepseek-n09-receipt-unknown.png / 可交互 / 结果提交回执未知。同上；结果不显示为已提交，画布节点为“状态未核对”。 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N10.019 | `sources/node/COVERAGE.md:32` | N10 / n10-disconnected / deepseek-n10-disconnected.png / 可交互 / 数据连接断开。“重新连接”可交互：重连中 → 补读中 → 补读完成（继续流式）。 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N10.020 | `sources/node/COVERAGE.md:33` | N10 / n10-reconnecting / deepseek-n10-reconnecting.png / 可交互 / 重新连接中。连接：重新连接中 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N10.021 | `sources/node/COVERAGE.md:34` | N10 / n10-backfilling / deepseek-n10-backfilling.png / 可交互 / 补读中（按序补齐 / 去重）。剩余补读片段随流式到达，最后一条补读完成事件去掉过时标记并写“已补读 N 条（去重 2 条）”。 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N10.022 | `sources/node/COVERAGE.md:35` | N10 / n10-backfilled / deepseek-n10-backfilled.png / 可交互 / 补读完成。服务事件行“已补读 N 条（去重 2 条）” | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N10.023 | `sources/node/COVERAGE.md:36` | N10 / n10-gap / deepseek-n10-gap.png<br>warm-n10-gap.png<br>spdb-n10-gap.png<br>github-white-n10-gap.png / 可交互 / 补读有缺口（服务未保留）。缺口用虚线条画出；落在缺口内的 #c-b7e1 为“结果未知”。 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N11.024 | `sources/node/COVERAGE.md:37` | N11 / n11-done / deepseek-n11-done.png<br>warm-n11-done.png<br>spdb-n11-done.png<br>github-white-n11-done.png / 可交互 / 完成（结果提交 + 验收通过）。结果与验收：验收通过（r3 · 策略 v3） | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N11.025 | `sources/node/COVERAGE.md:38` | N11 / n11-accept-rejected / deepseek-n11-accept-rejected.png / 可交互 / 验收未通过。结果与验收：未通过 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N11.026 | `sources/node/COVERAGE.md:39` | N11 / n11-manual-accept / deepseek-n11-manual-accept.png / 可交互 / 待人工验收。结果与验收：待人工验收 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N12.027 | `sources/node/COVERAGE.md:40` | N12 / n12-follow-on / deepseek-n12-follow-on.png / 可交互 / 跟随最新：开（在底部）。开关“跟随最新”为开 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N12.028 | `sources/node/COVERAGE.md:41` | N12 / n12-follow-off / deepseek-n12-follow-off.png / 可交互 / 跟随最新：关（只计数）。进入时以真实机制追加 6 个片段（3 条新条目），只计数不滚动。 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N12.029 | `sources/node/COVERAGE.md:42` | N12 / n12-scrolled-new / deepseek-n12-scrolled-new.png / 可交互 / 上翻阅读 · 有新内容。进入时把阅读位置放在中部并标记已暂停，再追加 8 个片段；点胶囊回到底部并恢复跟随。 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N13.030 | `sources/node/COVERAGE.md:43` | N13 / n13-tool-text / deepseek-n13-tool-text.png / 可交互 / 工具详情 · 长文本。头部：工具名 + 来源、调用 ID、所属尝试 #3、状态、开始 / 结束 / 时长 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N13.031 | `sources/node/COVERAGE.md:44` | N13 / n13-tool-json / deepseek-n13-tool-json.png<br>warm-n13-tool-json.png<br>spdb-n13-tool-json.png<br>github-white-n13-tool-json.png / 可交互 / 工具详情 · JSON。字符串 / 数字 / 布尔与空 三种颜色 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N13.032 | `sources/node/COVERAGE.md:45` | N13 / n13-tool-code / deepseek-n13-tool-code.png / 可交互 / 工具详情 · 代码（分段读取）。“继续读取”按 200 行追加（模拟），自动换行切换。 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N13.033 | `sources/node/COVERAGE.md:46` | N13 / n13-tool-empty / deepseek-n13-tool-empty.png / 可交互 / 工具详情 · 空结果。“工具返回空结果”中性样式 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N13.034 | `sources/node/COVERAGE.md:47` | N13 / n13-tool-failed / deepseek-n13-tool-failed.png<br>deepseek-n13-tool-failed-readfail.png / 可交互 / 工具详情 · 失败（命令输出 / 读取失败）。第一次“继续读取”成功，第二次模拟失败：保留已加载内容 + 重新读取。 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N13.035 | `sources/node/COVERAGE.md:48` | N13 / n13-tool-twice / deepseek-n13-tool-twice.png / 可交互 / 同一工具两次调用 + 晚回。两次调用并行发起，较早的 #c-b7e1 晚于后续正文返回，在原位置更新。 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N14.036 | `sources/node/COVERAGE.md:49` | N14 / n14-redacted / deepseek-n14-redacted.png<br>warm-n14-redacted.png<br>spdb-n14-redacted.png<br>github-white-n14-redacted.png / 可交互 / 工具详情 · 服务端脱敏。fixtures 里只有 {"$redacted":…} 标记；复制输出 "[已隐藏]"（剪贴板已在自测中读回核对）。 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N14.037 | `sources/node/COVERAGE.md:50` | N14 / n14-no-permission / deepseek-n14-no-permission.png / 可交互 / 工具详情 · 无权限。锁图标 + “你没有查看此调用完整参数的权限” | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N14.038 | `sources/node/COVERAGE.md:51` | N14 / n14-no-capability / deepseek-n14-no-capability.png / 可交互 / 工具详情 · 缺能力。“当前服务尚未提供工具完整参数读取” | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N14.039 | `sources/node/COVERAGE.md:52` | N14 / n14-truncated / deepseek-n14-truncated.png / 可交互 / 工具详情 · 已截断。warn 提示“内容已截断：服务只保留了前 64 KB” | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N15.040 | `sources/node/COVERAGE.md:53` | N15 / n15-art-text / deepseek-n15-art-text.png / 可交互 / 产物阅读 · Markdown 文本。面包屑“实现接口 › 尝试 #3 › 产物 …” | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N15.041 | `sources/node/COVERAGE.md:54` | N15 / n15-art-json / deepseek-n15-art-json.png / 可交互 / 产物阅读 · JSON。JSON 树可折叠 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N15.042 | `sources/node/COVERAGE.md:55` | N15 / n15-art-code / deepseek-n15-art-code.png / 可交互 / 产物阅读 · 代码。搜索框“在已加载内容中查找” | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N15.043 | `sources/node/COVERAGE.md:56` | N15 / n15-art-unsupported / deepseek-n15-art-unsupported.png / 可交互 / 产物阅读 · 不支持格式。“这种格式（application/octet-stream · 2.3 MB）不能在这里预览” | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N15.044 | `sources/node/COVERAGE.md:57` | N15 / n15-art-missing / deepseek-n15-art-missing.png / 可交互 / 产物阅读 · 不存在 / 失效 / 无权 / 未生成。左栏可切换：不存在 / 无权读取 / 正文尚未生成 / 读取失败（可重新读取）/ 不能预览。版本失效见 n17-history 的 r1。 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N15.045 | `sources/node/COVERAGE.md:58` | N15 / n15-download / deepseek-n15-download.png<br>deepseek-n15-download-done.png / 可交互 / 产物下载（失败 → 重试 → 已下载）。进入时为“下载失败”；重试 → 下载中 → 已下载（原型模拟，未保存任何文件）。 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N16.046 | `sources/node/COVERAGE.md:59` | N16 / n16-cite-source / deepseek-n16-cite-source.png / 可交互 / 引用 · 原文段落。也可从执行现场正文里的引用 [1] 进入。 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N16.047 | `sources/node/COVERAGE.md:60` | N16 / n16-cite-code / deepseek-n16-cite-code.png<br>warm-n16-cite-code.png<br>spdb-n16-cite-code.png<br>github-white-n16-cite-code.png / 可交互 / 引用 · 精确代码行。“引用定位：第 42–48 行 · 来源版本 r3（不是最新文件）” | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N16.048 | `sources/node/COVERAGE.md:61` | N16 / n16-cite-excerpt / deepseek-n16-cite-excerpt.png / 可交互 / 引用 · 只有节选 / 摘要。info 提示“仅提供节选（第 40–60 行附近），不是完整原文” | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N17.049 | `sources/node/COVERAGE.md:62` | N17 / n17-list / deepseek-n17-list.png / 可交互 / 多次尝试列表。#1 失败、#2 已取消、#3 当前执行中 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N17.050 | `sources/node/COVERAGE.md:63` | N17 / n17-history / deepseek-n17-history.png<br>warm-n17-history.png<br>spdb-n17-history.png<br>github-white-n17-history.png / 可交互 / 历史 #1 单次详情。‹ › 切换 #1/#2/#3；#2 的 r2 验收未通过并绑定策略 v3；当前有结果时标“已被尝试 #3 的结果 r3 替代”。 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N17.051 | `sources/node/COVERAGE.md:64` | N17 / n17-history-session / deepseek-n17-history-session.png / 可交互 / 历史 #1 执行现场（只读）。当前尝试继续流式时，只读条内出现“当前尝试有新内容”。 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N17.052 | `sources/node/COVERAGE.md:65` | N17 / n17-back-current / deepseek-n17-back-current.png / 可交互 / 回到当前（当前仍在加载）。约 2.5 秒后模拟载入当前尝试。 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N18.053 | `sources/node/COVERAGE.md:66` | N18 / n18-not-retained / deepseek-n18-not-retained.png / 可交互 / 历史记录未保留。按样例改写为“超出 7 天保留期”，见偏离说明。 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N18.054 | `sources/node/COVERAGE.md:67` | N18 / n18-page-fail / deepseek-n18-page-fail.png / 可交互 / 加载更早的尝试失败。重试约 0.9 秒后载入 #1。 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N19.055 | `sources/node/COVERAGE.md:68` | N19 / n19-late / deepseek-n19-late.png / 可交互 / 切节点后旧响应晚到。约 3 秒后载入“编写测试”的内容；不采用“实现接口”的晚到响应。 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N19.056 | `sources/node/COVERAGE.md:69` | N19 / n19-revoked / deepseek-n19-revoked.png / 静态示意 / 撤权（内容清除）。只演示结果画面；撤权发生的过程没有动画演示。 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N19.057 | `sources/node/COVERAGE.md:70` | N19 / n19-project / deepseek-n19-project.png / 可交互 / 项目切换（面板关闭）。也可在任意状态用页头“⋯ → 切换到另一个示例项目”在原型内重现：清空记忆的阅读位置并换画布。 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N20.058 | `sources/node/COVERAGE.md:71` | N20 / n20-reader / deepseek-n20-reader.png<br>warm-n20-reader.png<br>spdb-n20-reader.png<br>github-white-n20-reader.png / 可交互 / 宽阅读区展开与返回。阅读器打开 / 关闭不调用画布重渲染；自测比对 .cv-world 的 transform 前后一致。 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N20.059 | `sources/node/COVERAGE.md:72` | N20 / n20-keyboard / deepseek-n20-keyboard.png / 可交互 / 键盘操作（焦点环 / 页签方向键 / Esc）。强制显示焦点环（演示用）；方向键切页签、Esc 先关阅读区再关子视图均已自测。 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| node.N20.060 | `sources/node/COVERAGE.md:73` | N20 / n20-reduced / deepseek-n20-reduced.png / 可交互 / 减少动态。也可在任意状态用控制条“减少动态”开关；URL 参数 &motion=reduce。 | 元数据已有；完整内容/下载/游标/版本/权限链存在缺口，此态未验证。 V+A+S+R+K |
| supplement-v4.PW-NONGIT.001 | `sources/supplement-v4/STATES-v4.md:10` | PW-NONGIT / V4 准备工作区（需求画布内 · AD02 / C02） / 非 Git 项目 · 基线快照与独立副本 / 对账单 T-2064：需求目录“待准备工作区” → 工作区页签 / T-2064 / task.workspace.prepare（kind=snapshot-copy）；skippedResources / 非 Git 项目在同一准备区显示基线快照、范围、排除与未复制资源（210 MB 文件）；写明“独立副本不等于整个项目已隔离”，不会 git init。准备 → 就绪 → 单独开始执行。 验收：未复制资源逐项可见；原目录不写入。 | 已有部分衔接；任务身份/原推进模式/围栏与工作区故障未逐态验证。 V+A+S+R+K |
| supplement-v4.PW-PREPARING.002 | `sources/supplement-v4/STATES-v4.md:11` | PW-PREPARING / V4 准备工作区（需求画布内 · AD02 / C02） / 准备独立工作区中（阶段名，无百分比） / “准备独立工作区” → 确认 / T-2051 / prepare 回执阶段：登记 / 固定基线 / 创建分支或复制快照 / 创建目录 / 核对 / 五个阶段逐个点亮，不给百分比；准备成功前“开始执行”禁用；可以离开本页，回来读原准备记录，不重新创建。 验收：准备期间无写文件步骤运行。 | 已有部分衔接；任务身份/原推进模式/围栏与工作区故障未逐态验证。 V+A+S+R+K |
| supplement-v4.PW-READY.003 | `sources/supplement-v4/STATES-v4.md:12` | PW-READY / V4 准备工作区（需求画布内 · AD02 / C02） / 准备成功 · 单独开始执行 / 准备完成 / T-2051 / prepare 回执 ready + workspaceRef / “独立工作区已就绪”；“开始执行”现在可用并单独确认；开始后进入同一任务的统一任务画布（身份、返回上下文不变）。 验收：准备回执不当成执行成功。 | 已有部分衔接；任务身份/原推进模式/围栏与工作区故障未逐态验证。 V+A+S+R+K |
| supplement-v4.PW-UNKNOWN.004 | `sources/supplement-v4/STATES-v4.md:13` | PW-UNKNOWN / V4 准备工作区（需求画布内 · AD02 / C02） / 准备回执未知 · 只核对原创建 / 工单 T-2062：准备时“固定基线”之后连接中断 / T-2062 / operations.by-key(prepareKey)；不生成新 key / 写清原请求号与中断位置；只给“核对原创建”，不再分配第二个目录或分支，不开始执行。核对结果“已创建” → 就绪。 验收：UNKNOWN 不重投。 | 已有部分衔接；任务身份/原推进模式/围栏与工作区故障未逐态验证。 V+A+S+R+K |
| supplement-v4.PW-PARTIAL.005 | `sources/supplement-v4/STATES-v4.md:14` | PW-PARTIAL / V4 准备工作区（需求画布内 · AD02 / C02） / 部分创建 · 只补建缺失部分 / 发票 T-2063：分支已建，工作目录无写入权限 / T-2063 / prepare 部分回执；repair(prepareKey, missing=workdir) / 已发生的阶段逐项列出；分支保留不自动删除；“授权说明”与“补建工作目录”（沿用原准备记录）。补建成功后才可开始。 验收：不自动清理，不重复建分支。 | 已有部分衔接；任务身份/原推进模式/围栏与工作区故障未逐态验证。 V+A+S+R+K |
| supplement-v4.PW-CONFLICT.006 | `sources/supplement-v4/STATES-v4.md:15` | PW-CONFLICT / V4 准备工作区（需求画布内 · AD02 / C02） / 同名分支 / 目录冲突 · 新名称重新预览 / 积分单 T-2065：准备时发现同名对象 / T-2065 / NAME_CONFLICT + 对象归属；rename preview / 列出同名分支与目录（不属于本任务），不覆盖不复用；“使用新名称重新预览”后按新名称再确认准备。 验收：原有同名对象保持不动。 | 已有部分衔接；任务身份/原推进模式/围栏与工作区故障未逐态验证。 V+A+S+R+K |
| supplement-v4.PW-DRIFT.007 | `sources/supplement-v4/STATES-v4.md:16` | PW-DRIFT / V4 准备工作区（需求画布内 · AD02 / C02） / 基线前移 · 重读后重新确认 / 接口文档整理 T-2027（旧需求迁入）：确认后 main 又有新提交 / T-2027 / BASELINE_MOVED；reread baseline → 重新确认 / 旧基线 → 新基线对照与新提交列表；不静默换基线；“重新读取基线”后按钮变为“按新基线准备独立工作区”（重新确认）。 验收：不复用过期准备与过期确认。 | 已有部分衔接；任务身份/原推进模式/围栏与工作区故障未逐态验证。 V+A+S+R+K |
| supplement-v4.PW-DENIED.008 | `sources/supplement-v4/STATES-v4.md:17` | PW-DENIED / V4 准备工作区（需求画布内 · AD02 / C02） / 无读取权限 · 授权后重新读取 / 支付单 T-2066：确认后项目授权变更 / T-2066 / PERMISSION_DENIED（project read） / “无法读取项目，不能准备工作区”；授权说明（不自行改权限、不换位置）与“重新读取”；读取成功后回到可准备。 验收：准备按钮禁用并写原因。 | 已有部分衔接；任务身份/原推进模式/围栏与工作区故障未逐态验证。 V+A+S+R+K |
| supplement-v4.PW-EMPTY.009 | `sources/supplement-v4/STATES-v4.md:18` | PW-EMPTY / V4 准备工作区（需求画布内 · AD02 / C02） / Git 空仓库 · 基线不可用 / 通知单 T-2067：仓库没有任何提交 / T-2067 / BASELINE_UNAVAILABLE（empty repo） / 空仓库没有可作为基线的提交：不建分支、不自动建初始提交；“重新读取”（仍为空）与“从开始任务新建”。 验收：需求与计划保留。 | 已有部分衔接；任务身份/原推进模式/围栏与工作区故障未逐态验证。 V+A+S+R+K |
| supplement-v4.FX01.010 | `sources/supplement-v4/STATES-v4.md:19` | FX01 / V4 固定模板完整路径（AD04 / C03） / 固定模板 · 计划待确认（需求画布） / 模板任务 → 创建固定任务 → 打开任务 / T-2070 / template.instantiate（origin=fixed-menu-template，实例创建即语义锁）；plan.confirm / 固定模板实例在同一需求画布确认计划：步骤全部带锁；AI 细化、修改步骤禁用并写统一原因；确认后切到“工作区”页签准备，成功后单独开始执行，进入统一任务画布且仍锁定。适用于任意固定模板（单元测试开发 r7、详细设计编写 r5 等），不按名称或版本判断。 验收：确认 → 准备 → 开始不中断；锁始终存在。 | 已有部分衔接；任务身份/原推进模式/围栏与工作区故障未逐态验证。 V+A+S+R+K |
| supplement-v4.QA02.011 | `sources/supplement-v4/STATES-v4.md:20` | QA02 / V4 业务问题明确回答（AD06 / C05） / 业务问题已回答 · 与候选一致（重新校验） / 候选审阅（第 1 轮）→ 回答 2 个业务问题 → 保存 / T-2051 / InputRevision 2（answeredBy / at / answers）；candidate.revalidate(inputRevision) / 两个业务问题（日期字段、导出上限）明确回答并保存为需求输入修订 2；答复与候选假设一致，服务按修订 2 重新校验候选（不调用模型）后才可应用。旧轮输入保留。 验收：未回答时“应用”禁用；预选建议不算回答。 | 已有部分衔接；任务身份/原推进模式/围栏与工作区故障未逐态验证。 V+A+S+R+K |
| supplement-v4.QA03.012 | `sources/supplement-v4/STATES-v4.md:21` | QA03 / V4 业务问题明确回答（AD06 / C05） / 业务问题已回答 · 与候选不一致（需新一轮） / 候选审阅（第 1 轮）→ 日期改选“完成时间”→ 保存 / T-2051 / InputRevision 2；CANDIDATE_STALE（input drift） / 答复与候选假设不一致（例如日期按 finished_at）：候选过期、不能应用；按修订 2 预览新一轮；修订 1 与本轮记录不回写。 验收：不能把旧候选当作已按新答复生成。 | 已有部分衔接；任务身份/原推进模式/围栏与工作区故障未逐态验证。 V+A+S+R+K |
| supplement-v4.ut-running.013 | `sources/supplement-v4/STATES-v4.md:27` | ut-running / UT1 统一任务画布 · 普通执行（补稿 v4） / 执行中 · 规划创建的任务刚开始（第一批） / AD03 C01 / T-2051 / 从需求画布“开始执行”进入：同一任务（T-2051），第一批只启动“梳理需求”。页头：工作区 chip、来源“AI 规划 · 计划修订 3”、“在需求画布查看”、“调整待执行计划”、自动节点推进（服务事实，开启）。与 TD 同一画布、同一交付端点；不再有第二套任务画布。 | 已有部分衔接；任务身份/原推进模式/围栏与工作区故障未逐态验证。 V+A+S+R+K |
| supplement-v4.ut-running-mid.014 | `sources/supplement-v4/STATES-v4.md:28` | ut-running-mid / UT1 统一任务画布 · 普通执行（补稿 v4） / 执行中 · 第 3 段（可调整待执行计划） / AD03 C01 / T-2050 / 规划创建的任务执行到第 3 段：“后端筛选查询”执行中，其余待执行。“调整待执行计划”可用；自动节点推进开关是真实开关（关闭后出现整体推进 / 推进选中后继）。 | 已有部分衔接；任务身份/原推进模式/围栏与工作区故障未逐态验证。 V+A+S+R+K |
| supplement-v4.ut-auto-off.015 | `sources/supplement-v4/STATES-v4.md:29` | ut-auto-off / UT1 统一任务画布 · 普通执行（补稿 v4） / 自动推进关闭 · 执行中（旧任务迁入） / AD05 C01 C04 / T-2035 / 旧任务“任务执行结果的状态反馈”迁入统一画布：用户此前关闭了自动节点推进。执行中的步骤跑完后等待手动推进；“整体推进”此刻没有可推进步骤，禁用原因写清。 | 已有部分衔接；任务身份/原推进模式/围栏与工作区故障未逐态验证。 V+A+S+R+K |
| supplement-v4.ut-advance.016 | `sources/supplement-v4/STATES-v4.md:30` | ut-advance / UT1 统一任务画布 · 普通执行（补稿 v4） / 自动推进关闭 · 可整体推进 / 推进选中节点直接后继 / AD05 C01 C04 / T-2035 / 原任务画布“推进一步”能力：整体推进放行此刻满足条件的全部后继；选中已验收步骤可只推进它的直接后继。同次不级联；有多个前置的步骤等全部前置验收（并行汇合）。 | 已有部分衔接；任务身份/原推进模式/围栏与工作区故障未逐态验证。 V+A+S+R+K |
| supplement-v4.ut-paused.017 | `sources/supplement-v4/STATES-v4.md:31` | ut-paused / UT1 统一任务画布 · 普通执行（补稿 v4） / 任务已暂停（旧任务迁入 · 需求目录“已暂停”） / AD05 C01 C04 / T-2030 / 旧任务“订单服务单元测试补齐”：你于 11:20 暂停，运行中的步骤停在安全点。仍可“调整待执行计划”；调整结束后任务保持暂停，只有“恢复任务”才继续，不会被“继续”误开。 | 已有部分衔接；任务身份/原推进模式/围栏与工作区故障未逐态验证。 V+A+S+R+K |
| supplement-v4.ut-waiting.018 | `sources/supplement-v4/STATES-v4.md:32` | ut-waiting / UT1 统一任务画布 · 普通执行（补稿 v4） / 等待你审批（旧任务画布 waiting 映射） / C01 / T-2044 / 原任务画布“等待审批”：步骤请求写入项目目录内文件。审批在步骤面板完成；其他步骤继续执行。 | 已有部分衔接；任务身份/原推进模式/围栏与工作区故障未逐态验证。 V+A+S+R+K |
| supplement-v4.ut-stalled.019 | `sources/supplement-v4/STATES-v4.md:33` | ut-stalled / UT1 统一任务画布 · 普通执行（补稿 v4） / 步骤停滞（旧任务迁入） / C01 / T-2038 / 旧任务“登录页偶发 500 错误修复”：“实施修复”停滞 18 分钟，原因是等待你授权读取数据库连接配置。停滞由执行服务判定，不是界面计时。 | 已有部分衔接；任务身份/原推进模式/围栏与工作区故障未逐态验证。 V+A+S+R+K |
| supplement-v4.ut-failed.020 | `sources/supplement-v4/STATES-v4.md:34` | ut-failed / UT1 统一任务画布 · 普通执行（补稿 v4） / 步骤失败 · 可恢复（旧任务迁入） / C01 / T-2004 / 旧任务“退款对账脚本重写…”：回归测试失败（尝试 3 / 3）。“恢复这一步”在画布右侧选择恢复方式，或从“更多 → 任务恢复…”进入独立恢复工作台。 | 已有部分衔接；任务身份/原推进模式/围栏与工作区故障未逐态验证。 V+A+S+R+K |
| supplement-v4.ut-recovering.021 | `sources/supplement-v4/STATES-v4.md:35` | ut-recovering / UT1 统一任务画布 · 普通执行（补稿 v4） / 恢复这一步 · 选择方式 → 准备 → 开始 / C01 / T-2004 / 原任务画布恢复面板迁入统一画布：原样重试 / 修改后重试 / 从上一步重新执行；原任务、失败记录与已完成步骤不变，恢复准备好后再单独开始。 | 已有部分衔接；任务身份/原推进模式/围栏与工作区故障未逐态验证。 V+A+S+R+K |
| supplement-v4.ut-review.022 | `sources/supplement-v4/STATES-v4.md:36` | ut-review / UT1 统一任务画布 · 普通执行（补稿 v4） / 待人工验收（旧任务画布 review 映射） / C01 / T-2044 / 所有自动步骤通过，等你人工验收；验收通过后执行结束，任务进入“等待交付”（交付端点可点），不直接显示“已完成”。 | 已有部分衔接；任务身份/原推进模式/围栏与工作区故障未逐态验证。 V+A+S+R+K |
| supplement-v4.ut-unknown.023 | `sources/supplement-v4/STATES-v4.md:37` | ut-unknown / UT1 统一任务画布 · 普通执行（补稿 v4） / 状态待核对（旧任务迁入） / C01 / T-1998 / 最近一次读取失败：画布保留上次进度并标“状态未核对”，核对前不能修改或恢复该步骤；可立即重新读取。 | 已有部分衔接；任务身份/原推进模式/围栏与工作区故障未逐态验证。 V+A+S+R+K |
| supplement-v4.ut-legacy-done.024 | `sources/supplement-v4/STATES-v4.md:38` | ut-legacy-done / UT1 统一任务画布 · 普通执行（补稿 v4） / 旧版记录 · 已完成（独立工作区上线前） / C01 / T-2019 / 独立工作区与交付端点上线前已完成的旧任务：明确写“旧版记录”，没有工作区 chip 与交付面板，结果已直接写入项目目录。不伪装成 TD 的“已交付”。 | 已有部分衔接；任务身份/原推进模式/围栏与工作区故障未逐态验证。 V+A+S+R+K |
| supplement-v4.ut-legacy-stopped.025 | `sources/supplement-v4/STATES-v4.md:39` | ut-legacy-stopped / UT1 统一任务画布 · 普通执行（补稿 v4） / 旧版记录 · 已终止 / C01 / T-2011 / 旧任务已终止于第 2 步：保留真实步骤状态（已完成 / 已移出），只读，不提供继续执行。 | 已有部分衔接；任务身份/原推进模式/围栏与工作区故障未逐态验证。 V+A+S+R+K |
| supplement-v4.ut-adj-pausing.026 | `sources/supplement-v4/STATES-v4.md:40` | ut-adj-pausing / UT2 调整待执行计划 · 保留原自动推进（补稿 v4） / 申请调整 · 正在暂停新增领取（捕获原模式） / AD05 C04 / T-2050 / 确认“调整待执行计划”后：服务记录调整前的自动节点推进与执行状态（原模式），再暂停新增领取。回执成功前不开放编辑；运行中的步骤按原快照继续。 | 已有部分衔接；任务身份/原推进模式/围栏与工作区故障未逐态验证。 V+A+S+R+K |
| supplement-v4.ut-adj-editing.027 | `sources/supplement-v4/STATES-v4.md:41` | ut-adj-editing / UT2 调整待执行计划 · 保留原自动推进（补稿 v4） / 编辑待执行区（锁 / 可修改 / 新增） / C04 / T-2050 / 已领取、运行中、已完成的步骤与入边带锁；待执行步骤可修改，悬停出现“+”。右侧列本地修改与锁定步骤；保存语义修改后需要重新确认。 | 已有部分衔接；任务身份/原推进模式/围栏与工作区故障未逐态验证。 V+A+S+R+K |
| supplement-v4.ut-adj-conflict.028 | `sources/supplement-v4/STATES-v4.md:42` | ut-adj-conflict / UT2 调整待执行计划 · 保留原自动推进（补稿 v4） / 保存冲突 · 领取竞态（草稿保留） / C04 / T-2050 / 保存时服务回 REVISION_CONFLICT：被修改的步骤在暂停生效前已被领取。本地草稿不丢，“重新读取并比对”后只保留仍可保存的修改。 | 已有部分衔接；任务身份/原推进模式/围栏与工作区故障未逐态验证。 V+A+S+R+K |
| supplement-v4.ut-adj-reconfirm.029 | `sources/supplement-v4/STATES-v4.md:43` | ut-adj-reconfirm / UT2 调整待执行计划 · 保留原自动推进（补稿 v4） / 保存后等待重新确认 / C04 / T-2050 / 计划修订 N → N+1：按当前整图重新检查；“重新确认计划”不调用模型、不立即领取。横幅、确认框都写调整前的原模式。 | 已有部分衔接；任务身份/原推进模式/围栏与工作区故障未逐态验证。 V+A+S+R+K |
| supplement-v4.ut-adj-ready.030 | `sources/supplement-v4/STATES-v4.md:44` | ut-adj-ready / UT2 调整待执行计划 · 保留原自动推进（补稿 v4） / 已重新确认 · 继续时恢复原模式 / AD05 C04 / T-2050 / 新增领取仍暂停；“继续执行”恢复调整前的设置：原为开启 → 开启；原为关闭 → 仍关闭、手动推进可用；原为暂停 → 按钮改为“结束调整（任务保持暂停）”。 | 已有部分衔接；任务身份/原推进模式/围栏与工作区故障未逐态验证。 V+A+S+R+K |
| supplement-v4.ut-fixed-running.031 | `sources/supplement-v4/STATES-v4.md:45` | ut-fixed-running / UT3 固定模板任务 · 只读（补稿 v4） / 固定模板任务 · 执行中（锁定不变） / AD03 AD04 C03 / T-2070 / 固定模板经“确认 → 准备工作区 → 开始执行”进入统一画布：来源 chip 写模板引用与修订；“调整待执行计划”、AI 细化、改步骤 / 依赖 / 职业 / 验收全部禁用并写同一原因；查看、布局、执行现场、交付照常。锁定按 origin=fixed-menu-template，与模板名称或版本无关。 | 已有部分衔接；任务身份/原推进模式/围栏与工作区故障未逐态验证。 V+A+S+R+K |
| supplement-v4.ut-fixed-snapshot.032 | `sources/supplement-v4/STATES-v4.md:46` | ut-fixed-snapshot / UT3 固定模板任务 · 只读（补稿 v4） / 固定模板 · 代码审查（快照评审运行面板） / AD03 C01 C03 / T-2003 / 原任务画布“快照代码评审”运行专用区迁入统一画布：页头“执行进度 / 模板报告”两个只读面板；进度不等于完成。旧深链 snap-* 子状态映射到本状态的面板参数。 | 已有部分衔接；任务身份/原推进模式/围栏与工作区故障未逐态验证。 V+A+S+R+K |
| supplement-v5.PE37.001 | `sources/supplement-v5/STATES-v5.md:7` | PE37（变更） / planning/requirement.html / 大需求总览 · 分组逐步细化 / 任务列表 / 需求目录“会员积分体系重构”；待处理“选择范围继续规划” / T-2060 / S1 S2 S5 / 未细化组“继续规划选区”；确认禁用写“还有 N 个组未细化”；done= 记录已应用的组；全部细化后确认可用。验收：未细化不可确认；已细化组不先执行；不再标“后续分期”。 | PE37已有主链；分组轮次/上限/只读目录与返回未逐态验证。 V+A+S+R+K |
| supplement-v5.LG-PLANNING.002 | `sources/supplement-v5/STATES-v5.md:8` | LG-PLANNING（新） / planning/requirement.html / 分组细化 · 规划中（新一轮） / PE37 → 继续规划选区 → 确认开始 / T-2060（gp=） / S2 S3 / 只细化所选分组；状态条第 N 轮；可停止（只停本轮）。验收：不预造候选；停止后已细化组保留。 | PE37已有主链；分组轮次/上限/只读目录与返回未逐态验证。 V+A+S+R+K |
| supplement-v5.LG-CAND.003 | `sources/supplement-v5/STATES-v5.md:9` | LG-CAND（新） / planning/requirement.html / 分组细化 · 候选待审阅 / 分组规划完成 / T-2060（gp=） / S3 S4 / 新增步骤标“新增”；修订 0 / 1；应用（修订 +1）/ 不采用。验收：应用只写未确认草稿；最后一组应用后才能确认。 | PE37已有主链；分组轮次/上限/只读目录与返回未逐态验证。 V+A+S+R+K |
| supplement-v5.PE37.004 | `sources/supplement-v5/STATES-v5.md:10` | PE37 · 全部细化（变体 done=L3,L5,L4） / 同上 / 已全部细化 · 待确认 / 依次应用 3 组 / T-2060 / S5 / 计划修订 5、18 步；确认框写轮次与覆盖；确认后进“工作区”。 | PE37已有主链；分组轮次/上限/只读目录与返回未逐态验证。 V+A+S+R+K |
| supplement-v5.planning-role.005 | `sources/supplement-v5/STATES-v5.md:11` | planning-role（新） / main/pages/roles.html / 角色管理 · 规划职责（只读） / 需求画布“需求与输入 / 版本与依据 / 规划依据”链接；角色列表 / — / C1 C2 / 精确版本、绑定的流程方法与规划策略、能力上限、最近使用；不出现在“谁来做”；只读。 | PE37已有主链；分组轮次/上限/只读目录与返回未逐态验证。 V+A+S+R+K |
| supplement-v5.detail-planning.006 | `sources/supplement-v5/STATES-v5.md:12` | detail-planning（新） / main/pages/workflows.html / 流程 · 需求开发 · AI 规划（只读） / 规划职责“查看流程”；需求画布“规划策略 v1”链接；流程目录 / — / C1 C3 / AI 规划一节：策略引用与摘要、规划职责、可细化 / 不可改、上限、最近使用；“返回需求画布”。 | PE37已有主链；分组轮次/上限/只读目录与返回未逐态验证。 V+A+S+R+K |

## 主稿 HTML 已注册状态清单

以下直接提取正式主稿 `DS.mount states` 的 id/label；主稿旧需求/任务画布仅作原稿对照，最新版采用 planning/delivery。状态注册表外的抽屉、确认框、按条件分支仍需沿操作补证。

| 验收ID | 设计位置 | 状态名称 | 当前差异与验收 |
|---|---|---|---|
| MAIN.databases.list | `originals/main/pages/databases.html:276` | 连接列表 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.databases.empty | `originals/main/pages/databases.html:276` | 没有连接 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.databases.edit | `originals/main/pages/databases.html:276` | 编辑连接（600 抽屉） | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.databases.new | `originals/main/pages/databases.html:276` | 添加连接 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.databases.probe-ok | `originals/main/pages/databases.html:276` | 检查通过（SQL Server） | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.databases.probe-fail | `originals/main/pages/databases.html:276` | 检查失败 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.databases.save-unknown | `originals/main/pages/databases.html:276` | 保存结果未明 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.databases.og-new | `originals/main/pages/databases.html:277` | 补充 · 新增 openGauss | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.databases.dm-probe | `originals/main/pages/databases.html:277` | 补充 · 达梦检查通过（只读待核实） | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.databases.db2-fail | `originals/main/pages/databases.html:277` | 补充 · DB2 检查失败 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.databases.gd-edit | `originals/main/pages/databases.html:277` | 补充 · GoldenDB 编辑（已切换驱动提示） | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.databases.legacy-type | `originals/main/pages/databases.html:277` | 补充 · 历史类型不可编辑 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.databases.types-fail | `originals/main/pages/databases.html:277` | 补充 · 类型清单读取失败 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.inbox.question | `originals/main/pages/inbox.html:149` | 问题（单选 + 多选） | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.inbox.draft | `originals/main/pages/inbox.html:149` | 问题 · 有草稿 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.inbox.permission | `originals/main/pages/inbox.html:149` | 权限请求 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.inbox.hard | `originals/main/pages/inbox.html:149` | 策略禁止 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.inbox.unknown | `originals/main/pages/inbox.html:150` | 提交结果未明 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.inbox.readback | `originals/main/pages/inbox.html:150` | 已接受但刷新失败 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.inbox.empty | `originals/main/pages/inbox.html:150` | 都处理完了 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.inbox.loading | `originals/main/pages/inbox.html:150` | 加载中 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.inbox.error | `originals/main/pages/inbox.html:150` | 读取失败 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.insights.content | `originals/main/pages/insights.html:109` | 列表 + 明细 | H/G局部：E16项目ID/归档/实际驳回→质量筛选与卡片同步；E25当前质量与历史审计已分离。 |
| MAIN.insights.list | `originals/main/pages/insights.html:109` | 列表 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.insights.unknown-usage | `originals/main/pages/insights.html:109` | 用量全部未知 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.insights.loading | `originals/main/pages/insights.html:109` | 加载中 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.insights.error | `originals/main/pages/insights.html:109` | 读取失败 | G局部：E16关闭自己的服务，刷新失败保留筛选与旧快照；未全主题/三尺寸。 |
| MAIN.knowledge-history.list | `originals/main/pages/knowledge-history.html:77` | 列表 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.knowledge-history.need | `originals/main/pages/knowledge-history.html:77` | 筛选：需要回答 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.knowledge-history.loading | `originals/main/pages/knowledge-history.html:77` | 加载中 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.knowledge-history.empty | `originals/main/pages/knowledge-history.html:77` | 空 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.knowledge-history.error | `originals/main/pages/knowledge-history.html:77` | 加载失败 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.knowledge.idle | `originals/main/pages/knowledge.html:200` | 开始提问 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.knowledge.run | `originals/main/pages/knowledge.html:200` | 研究中 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.knowledge.done | `originals/main/pages/knowledge.html:200` | 回答完成 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.knowledge.cite | `originals/main/pages/knowledge.html:200` | 查看引用原文 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.knowledge.sources | `originals/main/pages/knowledge.html:200` | 资料来源面板 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.knowledge.stopped | `originals/main/pages/knowledge.html:200` | 已停止 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.knowledge.rs-welcome | `originals/main/pages/knowledge.html:201` | 补充 · 研究员面板 · 欢迎区打开（无消息） | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.knowledge.rs-full | `originals/main/pages/knowledge.html:201` | 补充 · 研究员面板 · 选中回答，证据完整 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.knowledge.rs-partial | `originals/main/pages/knowledge.html:201` | 补充 · 研究员面板 · 证据不完整 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.knowledge.rs-hist | `originals/main/pages/knowledge.html:202` | 补充 · 研究员面板 · 历史消息未冻结外观 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.knowledge.rs-loading | `originals/main/pages/knowledge.html:202` | 补充 · 研究员面板 · 证据读取中 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.knowledge.rs-denied | `originals/main/pages/knowledge.html:202` | 补充 · 研究员面板 · 读取失败（无权限） | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.knowledge.rs-changed | `originals/main/pages/knowledge.html:203` | 补充 · 研究员面板 · 读取失败（版本已变化） | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.knowledge.rs-stale | `originals/main/pages/knowledge.html:203` | 补充 · 研究员面板 · 会话版本不一致 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.knowledge.rs-notools | `originals/main/pages/knowledge.html:203` | 补充 · 研究员面板 · 无工具记录 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.ppt-studio.discuss | `originals/main/pages/ppt-studio.html:229` | ① 讨论需求 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.ppt-studio.plan | `originals/main/pages/ppt-studio.html:229` | ② 设计方案 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.ppt-studio.make | `originals/main/pages/ppt-studio.html:229` | ③ 制作中 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.ppt-studio.done | `originals/main/pages/ppt-studio.html:229` | ③ 已全部生成 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.ppt-studio.issues | `originals/main/pages/ppt-studio.html:229` | ③ 检查有问题 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.ppt-studio.edit | `originals/main/pages/ppt-studio.html:229` | ③ 手动编辑 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.ppt-studio.pl-brief | `originals/main/pages/ppt-studio.html:230` | 补充 · 制作方案 · 制作目标 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.ppt-studio.pl-narrative | `originals/main/pages/ppt-studio.html:230` | 补充 · 制作方案 · 叙事结构 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.ppt-studio.pl-frozen | `originals/main/pages/ppt-studio.html:230` | 补充 · 制作方案 · 方向已冻结 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.ppt-studio.pl-slides | `originals/main/pages/ppt-studio.html:230` | 补充 · 制作方案 · 页面内容 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.ppt-studio.pl-visual-bad | `originals/main/pages/ppt-studio.html:231` | 补充 · 制作方案 · 视觉规范（色值无效） | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.ppt-studio.pl-assets | `originals/main/pages/ppt-studio.html:231` | 补充 · 制作方案 · 图表素材 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.ppt-studio.pl-notes | `originals/main/pages/ppt-studio.html:231` | 补充 · 制作方案 · 演讲辅助 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.ppt-studio.pl-delivery | `originals/main/pages/ppt-studio.html:231` | 补充 · 制作方案 · 交付设置 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.ppt-studio.pl-saving | `originals/main/pages/ppt-studio.html:232` | 补充 · 制作方案 · 等待自动保存 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.ppt-studio.pl-conflict | `originals/main/pages/ppt-studio.html:232` | 补充 · 制作方案 · 版本冲突 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.ppt-studio.pl-review | `originals/main/pages/ppt-studio.html:232` | 补充 · 制作方案 · 已用于制作（需重新打开） | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.ppt-studio.pl-ro-active | `originals/main/pages/ppt-studio.html:233` | 补充 · 制作方案 · 只读（制作中） | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.ppt-studio.pl-ro-archived | `originals/main/pages/ppt-studio.html:233` | 补充 · 制作方案 · 只读（已归档） | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.ppt-studio.pl-loading | `originals/main/pages/ppt-studio.html:233` | 补充 · 制作方案 · 读取中 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.ppt-studio.pl-error | `originals/main/pages/ppt-studio.html:233` | 补充 · 制作方案 · 读取失败 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.ppt-studio.pl-blocked | `originals/main/pages/ppt-studio.html:234` | 补充 · 制作方案 · 有未保存属性被拦截 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.ppt-works.list | `originals/main/pages/ppt-works.html:85` | 作品 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.ppt-works.loading | `originals/main/pages/ppt-works.html:85` | 加载中 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.ppt-works.empty | `originals/main/pages/ppt-works.html:85` | 空 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.ppt.empty | `originals/main/pages/ppt.html:81` | 初始（未选项目） | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.ppt.ready | `originals/main/pages/ppt.html:81` | 已填写 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.ppt.files | `originals/main/pages/ppt.html:81` | 已添加资料 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.ppt.submitting | `originals/main/pages/ppt.html:81` | 正在创建 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.ppt.error | `originals/main/pages/ppt.html:81` | 创建失败 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.projects.list | `originals/main/pages/projects.html:303` | 列表 | G局部：E11正式CUA真实同名项目与截断目录；技术栈事实尚缺。 |
| MAIN.projects.list-loading | `originals/main/pages/projects.html:303` | 列表 · 加载中 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.projects.list-error | `originals/main/pages/projects.html:303` | 列表 · 读取失败 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.projects.list-empty | `originals/main/pages/projects.html:303` | 列表 · 无项目 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.projects.register | `originals/main/pages/projects.html:304` | 登记项目（抽屉） | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.projects.reg-unknown | `originals/main/pages/projects.html:304` | 登记结果未明 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.projects.unmanage | `originals/main/pages/projects.html:304` | 取消管理确认 | G局部：E11正式CUA确认取消管理→真实归档回读；不是全主题/失败/UNKNOWN验收。 |
| MAIN.projects.detail | `originals/main/pages/projects.html:305` | 详情 · 概览 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.projects.detail-git | `originals/main/pages/projects.html:305` | 详情 · Git 账号 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.projects.detail-git-custom | `originals/main/pages/projects.html:305` | 详情 · Git 单独配置 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.projects.detail-gitlab | `originals/main/pages/projects.html:305` | 详情 · GitLab 与证据 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.projects.detail-docs | `originals/main/pages/projects.html:306` | 详情 · 文档路径 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.projects.detail-conv | `originals/main/pages/projects.html:306` | 公约 · 未生成 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.projects.conv-running | `originals/main/pages/projects.html:306` | 公约 · 生成中 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.projects.conv-ready | `originals/main/pages/projects.html:306` | 公约 · 草稿就绪 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.projects.conv-unknown | `originals/main/pages/projects.html:306` | 公约 · 状态未明 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.recovery.default | `originals/main/pages/recovery.html:166` | 默认 · 从失败阶段恢复 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.recovery.all | `originals/main/pages/recovery.html:166` | 选择复制全部阶段 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.recovery.verify | `originals/main/pages/recovery.html:166` | 选择只读验证 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.recovery.creating | `originals/main/pages/recovery.html:167` | 正在创建 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.recovery.created | `originals/main/pages/recovery.html:167` | 已创建 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.recovery.multi | `originals/main/pages/recovery.html:167` | 已有多条派生记录 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.recovery.ineligible | `originals/main/pages/recovery.html:168` | 不可恢复 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.recovery.unknown | `originals/main/pages/recovery.html:168` | 原操作结果未明（锁定） | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.recovery.create-failed | `originals/main/pages/recovery.html:168` | 创建失败 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.recovery.loading | `originals/main/pages/recovery.html:169` | 读取中 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.recovery.error | `originals/main/pages/recovery.html:169` | 读取失败 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.recovery.no-parent | `originals/main/pages/recovery.html:169` | 无父任务 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirement.questions | `originals/main/pages/requirement.html:511` | 澄清问题 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirement.planning | `originals/main/pages/requirement.html:511` | 规划中 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirement.candidates | `originals/main/pages/requirement.html:511` | 候选计划 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirement.ready | `originals/main/pages/requirement.html:511` | 审阅计划 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirement.dirty | `originals/main/pages/requirement.html:511` | 有未保存修改 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirement.unbound | `originals/main/pages/requirement.html:512` | 有步骤未指定职业 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirement.unknown | `originals/main/pages/requirement.html:512` | 确认结果未明 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirement.conflict | `originals/main/pages/requirement.html:512` | 修订冲突 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirement.confirmed | `originals/main/pages/requirement.html:512` | 已确认 · 待开始 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirement.pl-config | `originals/main/pages/requirement.html:513` | 补充 · 规划配置 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirement.pl-rounds | `originals/main/pages/requirement.html:513` | 补充 · 规划轮次 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirement.pl-stop-unknown | `originals/main/pages/requirement.html:513` | 补充 · 停止未核明 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirement.pl-stopping | `originals/main/pages/requirement.html:513` | 补充 · 轮次停止中 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirement.pl-package | `originals/main/pages/requirement.html:514` | 补充 · 工作包详情 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirement.pl-package-noproof | `originals/main/pages/requirement.html:514` | 补充 · 工作包无证明 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirement.pl-map-ok | `originals/main/pages/requirement.html:514` | 补充 · 映射核对（通过） | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirement.pl-map-bad | `originals/main/pages/requirement.html:514` | 补充 · 映射核对（不一致） | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirement.pl-precheck | `originals/main/pages/requirement.html:515` | 补充 · 应用前检查 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirement.pl-apply-confirm | `originals/main/pages/requirement.html:515` | 补充 · 应用确认 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirement.pl-reject-confirm | `originals/main/pages/requirement.html:515` | 补充 · 退回确认 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirement.pl-applied | `originals/main/pages/requirement.html:515` | 补充 · 已应用 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirement.pl-unavailable | `originals/main/pages/requirement.html:516` | 补充 · 接口未提供 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirement.pl-conflict | `originals/main/pages/requirement.html:516` | 补充 · 版本冲突 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirement.pl-loading | `originals/main/pages/requirement.html:516` | 补充 · 规划读取中 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirement.pl-error | `originals/main/pages/requirement.html:516` | 补充 · 规划读取失败 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirement.pl-empty | `originals/main/pages/requirement.html:516` | 补充 · 尚无规划 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirements.list | `originals/main/pages/requirements.html:214` | 列表 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirements.selected | `originals/main/pages/requirements.html:214` | 已选择需求 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirements.filtered | `originals/main/pages/requirements.html:214` | 按项目筛选 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirements.project-empty | `originals/main/pages/requirements.html:214` | 项目无需求 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirements.empty | `originals/main/pages/requirements.html:214` | 全部为空 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirements.loading | `originals/main/pages/requirements.html:215` | 读取中 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirements.error | `originals/main/pages/requirements.html:215` | 读取失败 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirements.project-error | `originals/main/pages/requirements.html:215` | 项目列表读取失败 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.requirements.more | `originals/main/pages/requirements.html:215` | 加载更多 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles-legacy.catalog | `originals/main/pages/roles-legacy.html:281` | 目录（未选择） | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles-legacy.loading | `originals/main/pages/roles-legacy.html:281` | 读取中 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles-legacy.overview | `originals/main/pages/roles-legacy.html:281` | 描述 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles-legacy.perms | `originals/main/pages/roles-legacy.html:281` | 权限与 MCP | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles-legacy.prompt | `originals/main/pages/roles-legacy.html:281` | Prompt 模板 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles-legacy.history | `originals/main/pages/roles-legacy.html:282` | 版本历史 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles-legacy.history-open | `originals/main/pages/roles-legacy.html:282` | 所选历史版本 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles-legacy.compare | `originals/main/pages/roles-legacy.html:282` | 版本比较 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles-legacy.pending | `originals/main/pages/roles-legacy.html:283` | 有未发布的配置包 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles-legacy.import-validating | `originals/main/pages/roles-legacy.html:283` | 导入 · 校验中 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles-legacy.import-ok | `originals/main/pages/roles-legacy.html:283` | 导入 · 校验通过待核对 | H/G局部：E23真ZIP经原生文件框上传、8处差异勾选后发布r1；不是所有replace/unknown状态。 |
| MAIN.roles-legacy.import-invalid | `originals/main/pages/roles-legacy.html:283` | 导入 · 校验未通过 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles-legacy.import-nodiff | `originals/main/pages/roles-legacy.html:283` | 导入 · 无字段差异不能发布 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles-legacy.import-replace | `originals/main/pages/roles-legacy.html:284` | 替换配置包确认 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles-legacy.back-confirm | `originals/main/pages/roles-legacy.html:284` | 返回职业目录确认 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles-legacy.publish-unknown | `originals/main/pages/roles-legacy.html:284` | 发布结果未明 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles-legacy.read-error | `originals/main/pages/roles-legacy.html:284` | 读取失败 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles-legacy.search-empty | `originals/main/pages/roles-legacy.html:284` | 搜索无结果 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles.overview | `originals/main/pages/roles.html:338` | 职责与指令 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles.caps | `originals/main/pages/roles.html:338` | 能力范围 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles.perms | `originals/main/pages/roles.html:338` | 资源权限 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles.perm-edit | `originals/main/pages/roles.html:338` | 编辑命令参数 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles.subform-block | `originals/main/pages/roles.html:338` | 有未应用的权限修改 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles.publish | `originals/main/pages/roles.html:338` | 发布前检查 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles.save-unknown | `originals/main/pages/roles.html:338` | 保存结果未明 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles.appearance | `originals/main/pages/roles.html:338` | 形象 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles.pub-draft | `originals/main/pages/roles.html:339` | 补充 · 草稿 / 已发布版本切换 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles.pub-view | `originals/main/pages/roles.html:339` | 补充 · 已发布版本 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles.pub-unchecked | `originals/main/pages/roles.html:339` | 补充 · 已发布版本 · 未核对 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles.pub-loading | `originals/main/pages/roles.html:339` | 补充 · 已发布版本 · 读取中 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles.pub-error | `originals/main/pages/roles.html:339` | 补充 · 已发布版本 · 读取失败 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles.pub-dep | `originals/main/pages/roles.html:339` | 补充 · 已发布版本 · 尚未发布 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles.pub-dirty-switch | `originals/main/pages/roles.html:339` | 补充 · 有本地修改时切换职业 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles.pub-conflict | `originals/main/pages/roles.html:339` | 补充 · 版本冲突 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles.pub-unknown | `originals/main/pages/roles.html:339` | 补充 · 原操作未结清 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles.perm-pv-none | `originals/main/pages/roles.html:340` | 补充 · 权限预估 · 未核对发布版本 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles.perm-pv-pick | `originals/main/pages/roles.html:340` | 补充 · 权限预估 · 待选择位置 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles.perm-pv-loading | `originals/main/pages/roles.html:340` | 补充 · 权限预估 · 读取中 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles.perm-pv-result | `originals/main/pages/roles.html:340` | 补充 · 权限预估 · 结果 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles.perm-pv-notools | `originals/main/pages/roles.html:340` | 补充 · 权限预估 · 无有效工具 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles.perm-pv-diag | `originals/main/pages/roles.html:340` | 补充 · 权限预估 · 有诊断 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles.perm-pv-error | `originals/main/pages/roles.html:340` | 补充 · 权限预估 · 读取失败 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.roles.planning-role | `originals/main/pages/roles.html:340` | v5 · 规划职责（只读） | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.run.document | `originals/main/pages/run.html:313` | 文档任务 · 已完成 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.run.doc-running | `originals/main/pages/run.html:313` | 文档任务 · 核对中 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.run.source | `originals/main/pages/run.html:314` | 源码任务 · 有批次待恢复 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.run.source-unknown | `originals/main/pages/run.html:314` | 源码任务 · 重试结果未明 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.run.stopping | `originals/main/pages/run.html:314` | 源码任务 · 正在停止 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.run.unit-test | `originals/main/pages/run.html:315` | 单元测试 · 执行中 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.run.loading | `originals/main/pages/run.html:315` | 读取中 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.run.error | `originals/main/pages/run.html:315` | 读取失败 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.run.unknown-id | `originals/main/pages/run.html:315` | 运行身份无法确认 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.runtime.managed | `originals/main/pages/runtime.html:130` | 受管 · 已连接 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.runtime.external | `originals/main/pages/runtime.html:130` | 外部进程 · 已连接 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.runtime.offline | `originals/main/pages/runtime.html:130` | 离线 · 启动失败 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.runtime.starting | `originals/main/pages/runtime.html:130` | 启动中 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.runtime.unknown-status | `originals/main/pages/runtime.html:131` | 状态无法识别 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.runtime.read-error | `originals/main/pages/runtime.html:131` | 读取失败（保留上次结果） | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.runtime.cmd-unknown | `originals/main/pages/runtime.html:131` | 重启结果未明（锁定） | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.settings.service | `originals/main/pages/settings.html:222` | 服务 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.settings.dirty | `originals/main/pages/settings.html:222` | 服务 · 有未保存修改 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.settings.save-unknown | `originals/main/pages/settings.html:222` | 保存结果未明 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.settings.appearance | `originals/main/pages/settings.html:222` | 外观（皮肤） | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.settings.model | `originals/main/pages/settings.html:222` | 模型服务 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.settings.model-refresh | `originals/main/pages/settings.html:222` | 读取模型中 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.settings.limits | `originals/main/pages/settings.html:223` | 执行限制 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.settings.retry | `originals/main/pages/settings.html:223` | 重试等待 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.settings.git | `originals/main/pages/settings.html:223` | Git 账号 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.settings.git-dirty | `originals/main/pages/settings.html:223` | Git 与普通设置都有修改 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.settings.network | `originals/main/pages/settings.html:223` | 发布网络 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.settings.dev | `originals/main/pages/settings.html:223` | 开发辅助 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.settings.conn-auto | `originals/main/pages/settings.html:224` | 补充 · 连接方式自动检测 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.settings.monitor | `originals/main/pages/settings.html:224` | 补充 · 设计监控间隔 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.settings.monitor-range | `originals/main/pages/settings.html:224` | 补充 · 间隔超出范围 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.settings.limits-off | `originals/main/pages/settings.html:224` | 补充 · 执行限制（超时关闭） | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.settings.limits-on | `originals/main/pages/settings.html:224` | 补充 · 执行限制（超时开启） | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.start.ready | `originals/main/pages/start.html:220` | 空白 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.start.filled | `originals/main/pages/start.html:220` | 已填写 | G局部：E11项目/流程搜索抽屉与已填写；版本失败等仍缺。 |
| MAIN.start.reading | `originals/main/pages/start.html:220` | 核对流程版本中 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.start.flow-error | `originals/main/pages/start.html:220` | 流程版本读取失败 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.start.project-error | `originals/main/pages/start.html:220` | 项目列表读取失败 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.start.submitting | `originals/main/pages/start.html:221` | 提交中 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.start.unknown | `originals/main/pages/start.html:221` | 结果未明（锁定） | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.start.accepted | `originals/main/pages/start.html:221` | 草稿已形成 | H/G局部：E11选真实项目/流程后实际形成草稿并显示回执；不是unknown/handoff-error。 |
| MAIN.start.handoff-error | `originals/main/pages/start.html:221` | 已形成但打开失败 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.task.running | `originals/main/pages/task.html:387` | 执行中（两步并行） | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.task.auto-off | `originals/main/pages/task.html:387` | 自动推进关闭 · 可推进 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.task.waiting | `originals/main/pages/task.html:387` | 等待审批 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.task.stalled | `originals/main/pages/task.html:387` | 步骤停滞 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.task.failed | `originals/main/pages/task.html:388` | 步骤失败 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.task.recovering | `originals/main/pages/task.html:388` | 恢复 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.task.review | `originals/main/pages/task.html:388` | 待人工验收 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.task.completed | `originals/main/pages/task.html:388` | 已完成 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.task.claim-race | `originals/main/pages/task.html:389` | 修改时被领取 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.task.unknown | `originals/main/pages/task.html:389` | 状态待核对 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.task.template | `originals/main/pages/task.html:389` | 模板任务（固定流程） | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.task.snap-full | `originals/main/pages/task.html:390` | 补充 · 快照评审 · 执行进度（全量审查） | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.task.snap-light | `originals/main/pages/task.html:390` | 补充 · 快照评审 · 执行进度（轻量审查） | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.task.snap-batches | `originals/main/pages/task.html:391` | 补充 · 快照评审 · 功能批次展开 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.task.snap-batches-loading | `originals/main/pages/task.html:391` | 补充 · 快照评审 · 功能批次读取中 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.task.snap-batches-empty | `originals/main/pages/task.html:392` | 补充 · 快照评审 · 功能批次为空 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.task.snap-batches-error | `originals/main/pages/task.html:392` | 补充 · 快照评审 · 功能批次读取失败 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.task.snap-report | `originals/main/pages/task.html:393` | 补充 · 快照评审 · 阶段报告未读取 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.task.snap-report-loading | `originals/main/pages/task.html:393` | 补充 · 快照评审 · 阶段报告读取中 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.task.snap-report-read | `originals/main/pages/task.html:394` | 补充 · 快照评审 · 阶段报告已读取 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.task.snap-report-error | `originals/main/pages/task.html:394` | 补充 · 快照评审 · 阶段报告读取失败 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.task.snap-cancelled | `originals/main/pages/task.html:395` | 补充 · 快照评审 · 已取消仍可读阶段报告 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.tasks.ready | `originals/main/pages/tasks.html:116` | 日常 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.tasks.grouped | `originals/main/pages/tasks.html:116` | 按项目分组 | G局部：E11同名项目按ID选择空结果；仅此分组/身份场景。 |
| MAIN.tasks.loading | `originals/main/pages/tasks.html:116` | 加载中 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.tasks.error | `originals/main/pages/tasks.html:116` | 读取失败 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.tasks.empty | `originals/main/pages/tasks.html:116` | 没有任务 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.templates.ready | `originals/main/pages/templates.html:150` | 填写参数（周报） | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.templates.doc | `originals/main/pages/templates.html:150` | 需求代码评审（上传文档） | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.templates.source | `originals/main/pages/templates.html:150` | 单元测试开发（源码路径） | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.templates.submitting | `originals/main/pages/templates.html:151` | 启动中 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.templates.unknown | `originals/main/pages/templates.html:151` | 启动结果未明 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.templates.created | `originals/main/pages/templates.html:151` | 已启动 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.templates.pending-start | `originals/main/pages/templates.html:151` | 已创建待开始 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.templates.arc-overview | `originals/main/pages/templates.html:152` | 补充 · 历史档案 · 归档概览 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.templates.arc-templates | `originals/main/pages/templates.html:152` | 补充 · 历史档案 · 历史模板与冻结版本 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.templates.arc-rules | `originals/main/pages/templates.html:152` | 补充 · 历史档案 · 旧规则与运行记录 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.templates.arc-run | `originals/main/pages/templates.html:153` | 补充 · 历史档案 · 运行详情 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.templates.arc-verify-ok | `originals/main/pages/templates.html:153` | 补充 · 历史档案 · 核实关联任务成功 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.templates.arc-verify-fail | `originals/main/pages/templates.html:153` | 补充 · 历史档案 · 核实关联任务失败 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.templates.arc-export | `originals/main/pages/templates.html:154` | 补充 · 历史档案 · 导出说明 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.templates.arc-loading | `originals/main/pages/templates.html:154` | 补充 · 历史档案 · 读取中 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.templates.arc-error | `originals/main/pages/templates.html:154` | 补充 · 历史档案 · 读取失败 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.templates.arc-empty | `originals/main/pages/templates.html:154` | 补充 · 历史档案 · 空归档 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.tools.tools | `originals/main/pages/tools.html:232` | 工具 · 全局默认 | H/G局部：E21单工具停用真实回读、旧会话保持/新会话拒绝HTTP；不是所有来源故障。 |
| MAIN.tools.project | `originals/main/pages/tools.html:232` | 工具 · 项目设置 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.tools.partial | `originals/main/pages/tools.html:232` | 工具清单不完整 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.tools.write-unknown | `originals/main/pages/tools.html:232` | 修改结果未明 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.tools.skills | `originals/main/pages/tools.html:232` | Skill 阅读 | G局部：E21目录/Markdown/空正文/四主题和URL恢复；完整Skill错误态仍缺。 |
| MAIN.tools.skill-error | `originals/main/pages/tools.html:232` | Skill 读取失败 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.tools.skill-raw | `originals/main/pages/tools.html:233` | 补充 · Skill 原文 | G局部：E21完整原文与行号阅读；键盘/搜索返回仍缺。 |
| MAIN.tools.skill-empty | `originals/main/pages/tools.html:233` | 补充 · Skill 正文为空 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.tools.skill-read-fail | `originals/main/pages/tools.html:233` | 补充 · Skill 文档读取失败 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.workflow-editor.ready | `originals/main/pages/workflow-editor.html:198` | 我的流程 · 已保存 | H/G局部：E07浏览器拖动、布局保存回执、四主题截图；409/unknown仍缺。 |
| MAIN.workflow-editor.dirty | `originals/main/pages/workflow-editor.html:198` | 有未保存修改 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.workflow-editor.unbound | `originals/main/pages/workflow-editor.html:198` | 有步骤未指定职业 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.workflow-editor.empty | `originals/main/pages/workflow-editor.html:198` | 新流程 · 空 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.workflow-editor.builtin | `originals/main/pages/workflow-editor.html:199` | 内置流程 · 只读 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.workflow-editor.unknown | `originals/main/pages/workflow-editor.html:199` | 保存结果未明 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.workflow-editor.conflict | `originals/main/pages/workflow-editor.html:199` | 版本冲突 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.workflows.ready | `originals/main/pages/workflows.html:145` | 目录 + 详情 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.workflows.list | `originals/main/pages/workflows.html:145` | 目录（未选中） | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.workflows.detail-builtin | `originals/main/pages/workflows.html:145` | 内置流程详情 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.workflows.detail-loading | `originals/main/pages/workflows.html:145` | 详情读取中 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.workflows.loading | `originals/main/pages/workflows.html:146` | 目录加载中 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.workflows.error | `originals/main/pages/workflows.html:146` | 目录读取失败 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.workflows.more-error | `originals/main/pages/workflows.html:146` | 加载更多失败 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.workflows.copy | `originals/main/pages/workflows.html:146` | 复制对话框 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.workflows.archive | `originals/main/pages/workflows.html:146` | 归档确认 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.workflows.op-unknown | `originals/main/pages/workflows.html:146` | 复制结果未明 | V+A+S+R+K；未逐态验证，页面级差异见P表 |
| MAIN.workflows.detail-planning | `originals/main/pages/workflows.html:146` | v5 · 支持 AI 规划的流程详情 | H/G局部：E18真实使用统计2/当前1及准确草稿跳转；规划职责返回全态仍缺。 |

## 明确不开放与不可误实现

| ID | 设计权威 | 必须验收的边界 |
|---|---|---|
| LIMIT.PE28 | README v5；supplement-v5/DESIGN-DELTA-v5 §0/§5；planning PE28 | 保留写冲突事实与“改为先后执行”，串行改变形成差异且重新检查；子隔离与汇合禁用并说明后续分期；不静默加边，worktree不隔离DB/HTTP写。 |
| LIMIT.PE38 | 同上；planning/DESIGN-DELTA §3.7 | 有界局部细化/跨范围替换仍禁用，原因是边界端口契约未冻结；只读预览可保留，不开放应用。 |
| LIMIT.PE37 | supplement-v5 §1 | 已开放，不能标“后续分期”。每组选区新轮次、独立1次修订；已细化组不能先执行；全组完成才确认；节点≤20/组≤8/深度≤2，超限要求明确分期，不丢需求。 |
| LIMIT.Q6Q9 | supplement-v5 §2/§3/§5 | 不新增站内/系统完成提醒、顶层规划中心；任务列表和待处理规划计数一致；规划职责/策略目录只读，不出现在业务“谁来做”。 |
| LIMIT.NODE | node/COVERAGE 原型做不到或刻意不做 | 历史区域无重新执行/重放命令入口；公开推理摘要仅能力真实提供时显示；无可信总量不显示百分比。 |

## 横切验收 · 已实现不等于全态验收

| ID | 当前实现 / 服务证据 | 仍缺的实际证据 |
|---|---|---|
| X01 | E02停止accepted/停稳/结账分离，abort拒绝/hang保持UNKNOWN、旧代结果不污染新attempt | 真实provider停止确认、超时/idle核对和原生GUI迟到状态；旧R01缺陷已有回归，不能仍写当前必现 |
| X02 | E02/E12/E13与command-replay文档覆盖原keyaccepted/终态/丢响应控制；公共pending跨刷新 | 全部写入口的正式GUI丢响应、重启核对；E25模板原回执已整合，跨刷新故障GUI仍缺 |
| X03 | E15节点/产物/引用撤权清理、Run读模型权限已接 | 其他页资料/工具/报告打开中的撤权和跨身份迟到的完整CUA竞态 |
| X04 | E19实际seq分页去重/缺口、callId原位与阅读跟随CUA | 真实模型自然工具流+断线恢复与长记录的完整四主题/键盘 |
| X05 | E12逐文件写作/独立review、JUnit真命令；E14产物原生hash保存 | E26已补单文件整链和Run正常报告；仍缺多文件、全部测试/报告异常GUI；旧历史缺合同不能回填 |
| X06 | E10模板scope/contract冻结；E08同execution重确认与恢复原模式 | 模板确认→准备→开始、调整冲突/未知/原模式跨刷新正式GUI |
| X07 | 既有directory-apply真实三方比较与本地文件回归，E01保留历史 | 当前版本GUI逐文件冲突/UNKNOWN/取消返回/宿主保存与原目录哈希成组证据 |
| X08 | E01保留2026-10-19GitHub真实写历史；当前GitLab项目endpoint本机HTTP替身E09 | 新GitLab实际配置、hook/认证/远端移动/MR已存在/unknown；不新造远端PASS |
| X09 | E07图requires/平移缩放/视觉版本差异及保存布局CUA已接 | 409/离开取消/unknown草稿/撤销与只布局变更全态 |
| X10 | 角色冻结、项目docPaths/GitLab消费者、执行策略冻结/时限回归E08/E09/E23 | 真实模型资源拒绝/时限、真实项目GitLab与文档产出；后台原生交互无上下文范围仍受限 |

## 本轮证据与剩余工作

本轮只核对文档与静态当前实现，未运行产品/模型/远端写。保留来源登记数：planning50、delivery70、git49、node60、v4补充32、v5补充6及主稿296条显式状态；这些不是去重产品状态数，更不是PASS数。注册表外的条件交互仍需由对应HTML逐项展开。

- 当前实际功能优先：后台knowledge/charter/review/fix原生交互范围(E20，A继续知识)；归档与当前质量修复已由E25证明，不再列未实现；项目技术栈真实事实投影缺口（projects.html:148/193）。已向Lead报告，只改本两份文档。
- 当前高优先证据：新sourceEvidence普通源码/单测真实模型写作→独立review→测试→Run阅读；实际模型原生question/permission→人工答复→继续。Lead在做的live不预填结果。
- GUI按P表具体状态补证；已有单页主流程/四主题截图不替代所有加载/失败/未知/撤权/冲突/取消返回及三尺寸键盘。完整状态矩阵之前，不恢复“全部功能完成/唯一外部阻塞/视觉可选”。
- 历史Wave全仓数字和2026-10-19模型/远端写仍可追溯，但只证明原基线。当前整理没有全仓新测试，未用文档编辑制造新PASS。

文档一致性检查：与54b9c4c原登记逐项对比，563条状态ID/来源/设计意图均保留；仅13条有明确记录的状态追加局部GUI证据（不是13条完整PASS）。两份当前页表均恰为25行，git diff --check通过；本批没有重新运行产品测试。
