# STATES · 普通流程 AI 规划与节点细化（50 个状态）

> 设计样例 · 全部模拟。本文件由 `prototype/assets/pe-states.js` 生成（原型“说明”抽屉同源）。PE01–PE38 对应 CLAUDE-DESIGN-BRIEF §四；B01–B07 为复用的基础态；E-* 为正常入口页。

类别：正常 / 加载 / 空态 / 权限或配置缺失 / 漂移 / 冲突 / 明确失败 / 取消保留 / 部分效果 / UNKNOWN / 成功 / 后续分期。四主题共用同一状态集。


## F01 普通流程开始

| ID | 页面 | 名称 | 类别 | 设计意图 | 验收要点 | 功能 / 验收 | 设计图 |
|---|---|---|---|---|---|---|---|
| [`pe01`](prototype/start.html?state=pe01) | start.html | 开始任务 · 普通方法选择 | 正常 | 流程方法卡写清“必经步骤 / 可按需求拆分的范围 / 是否支持 AI 规划”。未适配方法照样可选，但卡上直接写“可用骨架手动调整，不能 AI 规划”。固定步骤的“模板任务”不在这里混用，只给去模板任务的入口。主按钮仍是“形成需求草稿”，按钮下说明“只建草稿，不调用模型”。 | 形成草稿不出现模型/费用预览；三类方法卡（支持、未适配、选中）可键盘选择；模板任务入口不在方法列表里。 | F01 F08 A01 | [图](design/deepseek-pe01.png) |
| [`pe02`](prototype/requirement.html?state=pe02) | requirement.html | 需求画布 · 空草稿 | 空态 | 画布保持原 planning 空态，说明“还没有计划”。页头主按钮“生成计划”，次按钮“使用方法骨架”。右侧“需求与输入”显示不可改的原文、补充、资料、方法；状态条写“尚未调用模型”。点“使用方法骨架”只复制方法图，不发模型；之后主按钮变为“AI 细化计划”。 | “生成计划”只打开预览，不直接派发；“使用方法骨架”后图为未确认草稿；原文只读。 | F01 A01 | [图](design/deepseek-pe02.png) |
| [`pe03`](prototype/requirement.html?state=pe03) | requirement.html | 规划预览（确认开始前） | 正常 | 一次性列清：项目与授权范围、来源输入（原文 / 补充 / 资料修订）、方法与规划策略版本、模型（来自现有设置）、最多 2 次派发（初稿 1 + 修订 1）、自动传输重试 0、总时限与单次时限、本轮预算上限与预留、节点/边/组/深度上限、预览有效期。写明“确认后不改当前图；候选需要你审阅、应用、确认”。只有这一处确认模型调用。 | 数值与服务预览一致（UI 不自造）；修订次数显示实际值（可能为 0）；取消回到原处，草稿不丢。 | F01 F05 A01 A13 | [图](design/deepseek-pe03.png) |
| [`pe04`](prototype/requirement.html?state=pe04) | requirement.html | 配置 / 依据不足（生成禁用） | 权限或配置缺失 | 预览列出缺什么：预算上限未设置（去现有设置）、一份资料无读取权限（选择资料 / 去项目授权）、能力未安装等。每项给去处，生成按钮禁用并写原因。草稿、补充、已选资料原样保留。 | 不提供“仍然生成”；原因来自服务 reason；跳转到现有设置页而不是在主流程里塞专业字段。 | F01 F04 A11 A19 | [图](design/deepseek-pe04.png) |

## F02 长规划由需求画布承接

| ID | 页面 | 名称 | 类别 | 设计意图 | 验收要点 | 功能 / 验收 | 设计图 |
|---|---|---|---|---|---|---|---|
| [`pe05`](prototype/requirement.html?state=pe05) | requirement.html | 规划中 · 准备输入 | 正常 | 页头状态条：阶段轨道只点亮真实到达的阶段；开始时间、已用时、最近活动、已读资料数、预算（已知 / 预留 / 未明）。右侧规划记录显示服务阶段卡与只读资料工具（一个仍在运行）。画布保留原方法骨架，角标“当前草稿 · 候选尚未生成”。 | 无百分比、无剩余时间；离开页面不取消；停止与离开都可用。 | F02 A02 | [图](design/deepseek-pe05.png) |
| [`pe06`](prototype/requirement.html?state=pe06) | requirement.html | 生成候选 · 运行时无公开正文 | 正常 | 记录区顶部写“此运行时暂未提供公开正文；阶段与工具活动仍然真实显示”，不把“无正文”当失败，也不补演示文字。工具卡照常更新。 | 提示文字来自能力声明；没有任何占位“模型在思考”文案。 | F02 A02 A04 | [图](design/deepseek-pe06.png) |
| [`pe07`](prototype/requirement.html?state=pe07) | requirement.html | 生成候选 · 公开正文与工具 | 正常 | 复用节点执行现场的阅读组件：公开正文（标“模型陈述”）与工具卡（callId、参数、结果、状态）按服务序号排列；来源标签区分“服务事实 / 模型陈述 / 外部资料”。上翻停止跟随，出现“回到最新”；工具卡可点开只读详情（宽阅读）。 | 模型说“完成了”不改变阶段；上翻不被拉回；工具晚回在原卡更新。 | F02 A02 A04 | [图](design/deepseek-pe07.png) |
| [`pe08`](prototype/requirement.html?state=pe08) | requirement.html | 部分草稿（检查点） | 部分效果 | 画布切到“部分草稿 · 检查点 #2”，角标“尚未完成，不能执行”；已生成的分组与节点只读，缺的“测试”组画成虚线缺口。原方法骨架仍在“当前草稿”里。应用 / 确认按钮不出现；“草稿与问题”页签列已覆盖需求与未覆盖范围。 | 部分草稿不可应用、不可确认；切回“当前草稿”可见原图未变。 | F02 F09 A02 A17 | [图](design/deepseek-pe08.png) |

## F04 候选审阅与确认

| ID | 页面 | 名称 | 类别 | 设计意图 | 验收要点 | 功能 / 验收 | 设计图 |
|---|---|---|---|---|---|---|---|
| [`pe09`](prototype/requirement.html?state=pe09) | requirement.html | 程序检查中 | 正常 | “检查”页签按实际检查层显示：已完成的写结果与问题数，正在跑的转圈，没跑到的写“未开始”，不预先打勾。候选只读预览可看，但没有应用按钮。 | V1–V8 各层状态独立；没有一个总绿勾。 | F04 A09 A10 | [图](design/deepseek-pe09.png) |

## F05 补充与有界修订

| ID | 页面 | 名称 | 类别 | 设计意图 | 验收要点 | 功能 / 验收 | 设计图 |
|---|---|---|---|---|---|---|---|
| [`pe10`](prototype/requirement.html?state=pe10) | requirement.html | 有界修订中（1/1） | 正常 | 阶段轨道出现“修订候选”，状态条写“修订 1/1”与具体原因（某步骤缺少必需输入），并显示剩余已知额度。只能停止；修订后仍不合格就停给用户，不再循环。 | 修订次数、原因与预算来自服务；没有“再修一次”。 | F05 A13 | [图](design/deepseek-pe10.png) |
| [`pe11`](prototype/requirement.html?state=pe11) | requirement.html | 需要你答复 | 正常 | 列出关键问题、影响的步骤与来源，以及模型提出的假设（标“假设，未确认”）。用户答复后“保存补充”生成新的输入修订，再“预览新一轮”。模型不自答，旧轮输入不变。 | 答复不会改旧轮；预览新一轮带 previousRound；不提供“让 AI 自己决定”。 | F04 F05 A08 | [图](design/deepseek-pe11.png) |
| [`pe12`](prototype/requirement.html?state=pe12) | requirement.html | 预算 / 时限 / 次数达到 | 部分效果 | 写清达到的是哪一项上限、原账（已知 / 预留 / 未明分开）、保留下来的草稿与问题。账已结清时可“编辑输入”或“预览新一轮”；有未明用量时新派发禁用并写原因。 | 不自动加预算；未明不显示为 0。 | F05 F06 A13 | [图](design/deepseek-pe12.png) |
| [`pe13`](prototype/requirement.html?state=pe13) | requirement.html | 规划中补充（未纳入本轮） | 正常 | 补充保存为“需求输入修订 2”，横幅写“本轮仍按修订 1 生成”。两条路：等本轮结果后按补充再规划；或“停止本轮并按补充重新规划”（先停稳、核对原账再预览）。 | 补充不改当前轮；第二条路先走停止确认。 | F05 A08 | [图](design/deepseek-pe13.png) |

## F03 离开、回看与历史

| ID | 页面 | 名称 | 类别 | 设计意图 | 验收要点 | 功能 / 验收 | 设计图 |
|---|---|---|---|---|---|---|---|
| [`pe14`](prototype/tasks.html?state=pe14) | tasks.html | 任务列表 · 规划状态 | 正常 | 原任务卡/表格增加规划状态：规划中（阶段 + 最近活动）、等待审阅、需要处理、正在停止、待核对。点行回到同一任务的需求画布当前轮；完成只更新站内标记，不弹窗、不强跳。 | 状态文字 + 图标，不只靠颜色；点行带 returnTo；“需要处理”筛选包含规划问题。 | F03 A03 A20 | [图](design/deepseek-pe14.png) |
| [`pe15`](prototype/requirement.html?state=pe15) | requirement.html | 返回 · 按游标补读 | 加载 | 回来时先显示已持久的记录，再按游标补读离开期间的记录，横幅写“正在补读 18 条记录（从 #42 起），不会再次调用模型”。恢复画布视角、选中分组 / 节点与右侧阅读位置。 | 浏览器后退/前进不重复 POST；刷新不重新计时；不新增派发。 | F03 A03 A04 | [图](design/deepseek-pe15.png) |
| [`pe16`](prototype/requirement.html?state=pe16) | requirement.html | 断连 / 重连 | UNKNOWN | 横幅只说本页连接：“数据连接已断开，正在重连”，并写最后已知的服务状态与时间。规划本身不判失败、不停止、不重发。重读 / 停止是否可用由服务回执决定，断连期间停止按钮写“连接恢复后可用”。 | 已读内容不清空；连接状态与运行状态分开展示。 | F03 F06 A04 | [图](design/deepseek-pe16.png) |
| [`pe17`](prototype/requirement.html?state=pe17) | requirement.html | 不可补的记录缺口 | UNKNOWN | 记录流中画一条虚线缺口，写清范围（#41–#57）与服务给的原因；前后已读内容照常可看。不填造内容。 | 缺口可被键盘读到；不出现“补全中”的假进度。 | F03 F06 A04 | [图](design/deepseek-pe17.png) |

## F06 取消、失败与恢复

| ID | 页面 | 名称 | 类别 | 设计意图 | 验收要点 | 功能 / 验收 | 设计图 |
|---|---|---|---|---|---|---|---|
| [`pe18`](prototype/requirement.html?state=pe18) | requirement.html | 请求停止（确认） | 取消保留 | 确认框写清：只停止这一轮规划，不影响任何执行中的业务步骤；已有记录、草稿与用量都保留；停止完成前不能开始新一轮。 | 取消对话框焦点回到原按钮；确认后按钮进入“请求中”防双击。 | F06 A05 | [图](design/deepseek-pe18.png) |
| [`pe19`](prototype/requirement.html?state=pe19) | requirement.html | 正在停止 | 取消保留 | 三件事分开写：停止请求已受理（回执号）、原进程是否已停稳、用量是否已结账。期间可查看记录与草稿；新一轮、应用都禁用并写原因。 | 不写“已停止”直到 process=stopped 且 accounting=closed。 | F06 A05 | [图](design/deepseek-pe19.png) |
| [`pe20`](prototype/requirement.html?state=pe20) | requirement.html | 已停止 | 取消保留 | 写停稳时间与原账核对结果；部分草稿、记录可看；可“从保留草稿预览新一轮”（新调用，重新预览）。迟到的候选只记审计，不复活。 | 新一轮必须重新预览；旧轮不变成 running。 | F06 A05 | [图](design/deepseek-pe20.png) |
| [`pe21`](prototype/requirement.html?state=pe21) | requirement.html | 停止 / 派发结果待核对 | UNKNOWN | 写原请求号、哪一步结果不明（停止回执未知 / 派发是否发出不明）。唯一动作“核对原轮次”（只读核对，不发模型）；不出现“重试生成”或换新请求号重投。 | 核对动作幂等；核对后按真实证据转为已知状态，仍不明则保持。 | F06 A06 A07 | [图](design/deepseek-pe21.png) |
| [`pe22`](prototype/requirement.html?state=pe22) | requirement.html | 明确失败 | 明确失败 | 写失败在哪个阶段、服务给出的公开错误、保留了什么（检查点 #2、记录、原账）。下一步按权限给：核对、编辑输入（如缩小资料范围）、从保留草稿预览新一轮。无自动重试。 | 失败原因与“连接断开”文案区分；新轮必须重新预览。 | F06 A07 | [图](design/deepseek-pe22.png) |
| [`pe23`](prototype/requirement.html?state=pe23) | requirement.html | 服务重启后核对 | UNKNOWN | 写“服务在 14:06 重启，正在核对原轮次的进程、会话与用量”，逐项显示核对进度；不写“自动恢复成功”。期间只读。 | 核对期间不派发；不重置时限与修订计数。 | F06 A07 | [图](design/deepseek-pe23.png) |
| [`pe24`](prototype/requirement.html?state=pe24) | requirement.html | 原轮仅观察续接 | 正常 | 核对确认原轮仍在运行，提供“继续查看原轮次（不会发送新的提示）”。若不能续接，另一种结果是“从保留草稿开始新轮次”，写明是新调用。 | 两种结果文案清楚区分；不提供万能“恢复”。 | F06 A07 | [图](design/deepseek-pe24.png) |

## F04 候选审阅与确认

| ID | 页面 | 名称 | 类别 | 设计意图 | 验收要点 | 功能 / 验收 | 设计图 |
|---|---|---|---|---|---|---|---|
| [`pe25`](prototype/requirement.html?state=pe25) | requirement.html | 候选待审阅（diff） | 成功 | 画布默认“对照”：新增 / 修改 / 由细化替换 / 未变四种标记，分组可折叠。右侧“计划”页签给差异摘要、需求覆盖、需人工判断项；“检查”页签分“结构检查 / 需人工判断 / 依据 / 执行准备”四块，不压成一个绿勾。主按钮“应用到草稿”，旁注“应用后仍需确认计划，不会执行”。 | 原图在“当前草稿”中保留；每个问题可定位到节点；需人工判断项需逐项勾选“已核对”才可应用（候选规则，见待决 Q6）。 | F04 F09 A10 A14 | [图](design/deepseek-pe25.png) |
| [`pe26`](prototype/requirement.html?state=pe26) | requirement.html | 候选已到 · 原进程未停稳 | 部分效果 | 可只读审阅候选；“应用到草稿”禁用，原因“正在核对本轮结束（原调用尚未停稳 / 未结账）”。不能把“正文已结束”当作完成。 | 应用禁用原因可被键盘聚焦读出。 | F04 F06 A05 | [图](design/deepseek-pe26.png) |
| [`pe27`](prototype/requirement.html?state=pe27) | requirement.html | 候选硬阻塞 | 冲突 | 问题清单逐条：循环依赖、必需输入未绑定、引用的行号不存在、写入超出授权。每条可“定位”到画布节点 / 边；没有“忽略继续”。下一步：编辑输入后新一轮，或不采用候选。 | 应用按钮禁用并写“有 4 个必须处理的问题”；定位改变画布选中与视角。 | F04 A09 A11 | [图](design/deepseek-pe27.png) |

## F10 并行与独立工作区

| ID | 页面 | 名称 | 类别 | 设计意图 | 验收要点 | 功能 / 验收 | 设计图 |
|---|---|---|---|---|---|---|---|
| [`pe28`](prototype/requirement.html?state=pe28) | requirement.html | 并行写冲突（设计候选 · 后续分期） | 冲突 | 列出互不依赖但写同一资源域的两个步骤与真实资源（文件子树）。MVP 只给“改为先后执行（形成新差异）”；“申请子隔离与汇合”禁用并写“未安装 · 后续分期”。采纳串行后出现新的资源边并重新检查。 | 程序不静默加边；外部写入（DB/HTTP）不因 worktree 被当作隔离。 | F10 A12 | [图](design/deepseek-pe28.png) |

## F04 候选审阅与确认

| ID | 页面 | 名称 | 类别 | 设计意图 | 验收要点 | 功能 / 验收 | 设计图 |
|---|---|---|---|---|---|---|---|
| [`pe29`](prototype/requirement.html?state=pe29) | requirement.html | 输入 / 原图 / 依据漂移 | 漂移 | 写清候选基于哪些版本、现在变成了什么（补充需求修订 2、手改计划修订 3、一份资料内容变化）。旧候选保留可比较；应用禁用；给“按当前输入重新预览”。 | 不能覆盖当前草稿；差异逐项可读。 | F04 A11 A14 | [图](design/deepseek-pe29.png) |

## F03 离开、回看与历史

| ID | 页面 | 名称 | 类别 | 设计意图 | 验收要点 | 功能 / 验收 | 设计图 |
|---|---|---|---|---|---|---|---|
| [`pe30`](prototype/requirement.html?state=pe30) | requirement.html | 历史轮次（只读） | 正常 | 常驻“历史轮次 · 只读”横幅与“回到当前”；显示当时的输入、候选、记录与原账。没有应用、继续执行等动作；旧格式轮只显示已知事实。 | 回到当前恢复原选中与页签；历史不借当前权限绕读。 | F03 A19 | [图](design/deepseek-pe30.png) |

## F04 候选审阅与确认

| ID | 页面 | 名称 | 类别 | 设计意图 | 验收要点 | 功能 / 验收 | 设计图 |
|---|---|---|---|---|---|---|---|
| [`pe31`](prototype/requirement.html?state=pe31) | requirement.html | 已应用到草稿 · 未确认 | 成功 | 横幅写“已把第 3 轮候选应用到草稿（计划修订 3，未确认）”和改动摘要。可以继续手改；主按钮“确认计划”，不直接开始执行。 | 应用与确认是两个动作；后退不重复应用。 | F04 A14 | [图](design/deepseek-pe31.png) |
| [`pe32`](prototype/requirement.html?state=pe32) | requirement.html | 确认计划 → 准备独立工作区 | 成功 | 确认框给真实范围摘要：步骤 / 依赖 / 需求覆盖 / 已审阅的人工判断 / 读写范围，并写“确认不调用模型、不执行”。确认后衔接最新 TD 两步：“准备独立工作区” → 成功后单独“开始执行”。 | 确认范围包含规划依据；准备成功前“开始执行”禁用。 | F04 F10 A18 A20 | [图](design/deepseek-pe32.png) |

## F07 执行中调整

| ID | 页面 | 名称 | 类别 | 设计意图 | 验收要点 | 功能 / 验收 | 设计图 |
|---|---|---|---|---|---|---|---|
| [`pe33`](prototype/task.html?state=pe33) | task.html | 执行中申请调整（暂停新增领取） | 正常 | 先说明会发生什么：暂停新增领取，运行中的“后端筛选查询”按原快照继续。确认后情况条写“正在暂停新增领取…”，回执成功才开放编辑。 | 围栏成功前编辑不可用；运行中节点不被强停。 | F07 A15 A16 | [图](design/deepseek-pe33.png) |
| [`pe34`](prototype/task.html?state=pe34) | task.html | 编辑待执行区 · 领取竞态 | 冲突 | 可编辑节点标“可修改”，已领取 / 运行中 / 已完成节点与其入边带锁。示例：保存时服务回 REVISION_CONFLICT——“导出 CSV 接口”在暂停生效前已被领取。本地修改保留为草稿，“重新读取并比对”后只剩可用的修改。 | 冲突不丢本地草稿；锁节点无编辑入口；新增依赖有表单替代拖拽。 | F07 A15 | [图](design/deepseek-pe34.png) |
| [`pe35`](prototype/task.html?state=pe35) | task.html | 语义保存后重新确认 → 继续 | 正常 | 情况条醒目写“计划已变更，后续步骤等待重新确认”。“重新确认计划”后才出现“继续执行”；继续时恢复进入调整前的自动推进设置（原为开启 → 开启；原为暂停 → 仍暂停）。 | 布局移动不触发重确认；继续不暗开自动推进。 | F07 A15 A16 | [图](design/deepseek-pe35.png) |

## F08 固定菜单模板

| ID | 页面 | 名称 | 类别 | 设计意图 | 验收要点 | 功能 / 验收 | 设计图 |
|---|---|---|---|---|---|---|---|
| [`pe36`](prototype/task.html?state=pe36) | task.html | 固定模板任务 · 只读 | 正常 | 阶段胶囊在“确认计划 · 固定模板 · 待确认”（模板：单元测试开发 · 版本 7）。新增步骤、AI 细化、改职业 / 依赖 / 参数全部禁用，统一原因：“该任务使用固定模板，创建后不能修改步骤；要改要求，请新建模板任务。”可查看、调整布局、确认、准备、开始。 | 画布无“+”；节点详情无编辑；入口文案统一。 | F08 A01 | [图](design/deepseek-pe36.png) |

## F09 分层与范围

| ID | 页面 | 名称 | 类别 | 设计意图 | 验收要点 | 功能 / 验收 | 设计图 |
|---|---|---|---|---|---|---|---|
| [`pe37`](prototype/requirement.html?state=pe37) | requirement.html | 大需求总览 · 未细化范围 | 部分效果 | 覆盖全需求的分组总览：已细化的组可展开为叶子，未细化的组写“未细化，不能执行”。选择一个组“继续规划选区”（新一轮预览）。确认按钮禁用：“还有 3 个组未细化”。超出本期上限时写明能力上限，不自动把剩余需求丢进待办。 | 分组不是执行节点；折叠不改 DAG；未细化不可确认。 | F09 A17 | [图](design/deepseek-pe37.png) |
| [`pe38`](prototype/task.html?state=pe38) | task.html | 有界局部细化候选（设计候选 · 后续分期） | 后续分期 | 选区外的图保留并变淡；选区边界画只读端口（入口 / 出口与 IO 指针），候选 B1→B2 接回端口。右侧列端口重接与覆盖变化。“边界端口契约未冻结，跨范围替换暂不可用”，应用禁用。 | 端口不可编辑；不出现旁路边；已领取的外部节点使端口不可用。 | F07 F09 A14 | [图](design/deepseek-pe38.png) |

## 基础态

| ID | 页面 | 名称 | 类别 | 设计意图 | 验收要点 | 功能 / 验收 | 设计图 |
|---|---|---|---|---|---|---|---|
| [`b01`](prototype/requirement.html?state=b01) | requirement.html | 加载中 | 加载 | 保留外壳、页头与右侧骨架；画布区骨架，不出现假节点。 | 侧栏与主题在加载前就在。 | F03 A03 | [图](design/deepseek-b01.png) |
| [`b02`](prototype/requirement.html?state=b02) | requirement.html | 读取失败 | 明确失败 | 写“规划记录读取失败（服务返回 503）”，给“重新读取”。读取失败不等于规划失败。 | 重读不发模型。 | F03 A04 | [图](design/deepseek-b02.png) |
| [`b03`](prototype/requirement.html?state=b03) | requirement.html | 无权限 | 权限或配置缺失 | 只显示可公开的任务信息，正文与工具结果写“当前账号无权查看”；不展示缓存内容。 | 历史引用不能绕过权限。 | F03 A19 | [图](design/deepseek-b03.png) |
| [`b04`](prototype/requirement.html?state=b04) | requirement.html | 旧版本不支持该轮次 | 权限或配置缺失 | 写“此版本不支持该规划轮次（planning-expansion.v1）”，只显示旧轮已知事实；旧 stopped 显示“已请求停止，停稳待核对”，不映射成“已停止”。 | 禁止降级写入。 | F03 A19 | [图](design/deepseek-b04.png) |
| [`b05`](prototype/requirement.html?state=b05) | requirement.html | 命令结果未知（应用） | UNKNOWN | 按钮进入“请求中”防双击；响应丢失后写“应用结果待核对（请求号）”，只给“按原请求号核对”。 | 不生成新请求号重投。 | F04 F06 A06 | [图](design/deepseek-b05.png) |
| [`b06`](prototype/requirement.html?state=b06) | requirement.html | 弹窗取消 · 草稿保留 | 取消保留 | 在预览里返回后，补充文字与已选资料原样保留，提示“已取消预览，补充草稿保留”。 | 焦点回到原按钮。 | F05 A08 | [图](design/deepseek-b06.png) |
| [`b07`](prototype/requirement.html?state=b07) | requirement.html | 方法未适配 AI 规划 | 权限或配置缺失 | “生成计划”禁用并写“该流程尚未配置 AI 规划；可使用骨架并手动调整”，主按钮让位给“使用方法骨架”。 | 不回退为空图自由生成。 | F01 A01 | [图](design/deepseek-b07.png) |
| [`b08`](prototype/requirement.html?state=b08) | requirement.html | 执行后需求追踪（工作包归执行侧） | 正常 | 执行开始后需求画布只读：阶段胶囊在“开始执行”；需求追踪表在需求 → 验收条款之后增加“步骤 · 执行结果 / 证据”，只取当前有效且验收通过的结果；“查看工作包”进入节点详情。原 B-05 面板的“工作包”页签由此归到执行侧。 | 未执行的步骤不显示产物；规划面板无应用 / 确认动作；能回到任务画布。 | F04 F10 A10 A18 | [图](design/deepseek-b08.png) |

## 正常入口

| ID | 页面 | 名称 | 类别 | 设计意图 | 验收要点 | 功能 / 验收 | 设计图 |
|---|---|---|---|---|---|---|---|
| [`e-home`](prototype/home.html?state=e-home) | home.html | 主页 · 冷启动 | 正常 | 冷开即有完整正式菜单；“进行中”卡片里规划中的任务直接回到需求画布。 | 无底部演示链接也能到达全部状态。 | F03 A20 | [图](design/deepseek-e-home.png) |
| [`e-requirements`](prototype/requirements.html?state=e-requirements) | requirements.html | 需求目录 · 规划状态列 | 正常 | 需求行显示规划状态，点行回到同任务需求画布。 | 返回保留来源。 | F03 A03 A20 | [图](design/deepseek-e-requirements.png) |
| [`e-inbox`](prototype/inbox.html?state=e-inbox) | inbox.html | 待处理中心 · 规划事项 | 正常 | 需要答复、候选待审阅、结果待核对三类事项，点击回到对应需求画布状态。 | 不另建“规划中心”。 | F03 A03 A20 | [图](design/deepseek-e-inbox.png) |
| [`e-templates`](prototype/templates.html?state=e-templates) | templates.html | 模板任务 · 创建固定任务 | 正常 | 创建前填写路径、任务说明与模板声明的参数，并预览固定步骤；写明“创建后不能修改步骤”。 | 创建后进入 PE36。 | F08 A01 | [图](design/deepseek-e-templates.png) |
