/* opencode-workflow · Git 仓库页 · 原型状态登记表
   id 固定（STATES.md、flows.html、API-DESIGN.md 引用），不得改名。
   字段（git.js 读取）：
     g / label           分组与下拉文字
     mode                可交互 / 静态示意
     view                overview 概览 · wb 工作台 · missing 能力未接入 · notgit 不受 Git 管理 · unavail 路径不可用
     gitlab              ok（默认）/ none 未配置
     project             order（默认）/ cs
     left                commits / branches / mrs；mr = 打开的合并请求
     commit / tab / file 选中的提交、页签（files / review / fix）、文件
     diff / full / head  unified|split、全宽、提交头 open|compact
     parent              合并提交对比的父（1 / 2）
     rv / rvPhase        审查：none / running / done / clean / failed / unknown
     drawer / dialog     review · fix / discard / merge / stop
     focus               在 diff 中定位的问题
     fx / fxPhase        修复：none / running / done / verify-failed / nochange / failed
     cm / ps / mg        提交 / 推送 / 合并步骤的剧本
     dirty               工作区未提交改动数（默认 3）
     其他                listErr / fetchErr / detached / shallow / empty
     intent / checks     说明抽屉：设计意图与验收要点
*/
window.GIT_STATES = [
  /* ---------- 概览 ---------- */
  { id: 'g01-overview', g: '概览', label: '仓库概览（GitLab 已连接）', mode: '可交互', view: 'overview',
    intent: '未选项目时的入口：所有已登记项目一张卡。受 Git 管理的卡给出分支、与远端差异、未提交改动、最近提交、打开的合并请求和待处理审查问题；不受管理 / 路径不可用 / 空仓库的卡写清原因和出路。',
    checks: ['顶部 GitLab 连接条：已连接 · gitlab.example.internal · 账号 dev-zhang', '订单服务卡：feature/refund、领先 2 · 落后 1（10:42 获取）、3 个未提交改动（只读提示）', '运营报表脚本 / 支付网关的“进入”禁用并说明原因', '点“进入”进入工作台；项目页的 Git 徽标“查看 Git”也会进入并预选该项目'] },
  { id: 'g02-no-gitlab', g: '概览', label: 'GitLab 未配置', mode: '可交互', view: 'overview', gitlab: 'none',
    intent: 'GitLab 没配置时，本地提交仍可浏览；远端分支、合并请求、推送不可用。概览顶部给出去设置的出路，卡片里的远端相关数字显示“—”并说明。',
    checks: ['连接条为提示色：“GitLab 未配置”+“去设置 → GitLab”', '订单服务卡的合并请求显示“需要 GitLab”，与远端差异显示上次已知值并标注', '“进入”仍可用'] },
  { id: 'g03-capability-missing', g: '概览', label: 'Git 能力尚未接入', mode: '静态示意', view: 'missing',
    intent: '内部 MCP（git / gitlab）还没接入时整页说明，不是错误：用 unknown 虚线风格，说明后续通过应用服务 → 内部 MCP 提供，并列出已登记项目。',
    checks: ['不出现红色错误样式', '写明“界面不直接执行 git”', '没有任何可点的写操作'] },

  /* ---------- 工作台浏览 ---------- */
  { id: 'g10-commits', g: '工作台浏览', label: '提交列表（选中最新提交）', mode: '可交互', view: 'wb', commit: 'e4f5a6b', tab: 'files', head: 'open',
    intent: '三栏工作台：左栏过滤与分支快捷，中栏按日期分组的提交列表与简化图谱（最多 3 条泳道，合并提交画合流点），右栏提交详情。',
    checks: ['图谱：feature/refund、origin/feature/refund 分叉、main 合入；合并提交是空心双圈', '标签 chip：HEAD、本地分支、远端分支、tag', '审查徽标：未审查不显示；有问题 / 无问题 / 已修复', '底部“加载更早的提交”（游标分页，模拟）'] },
  { id: 'g11-commit-detail', g: '工作台浏览', label: '提交详情 · a1b2c3d 新增退款接口', mode: '可交互', view: 'wb', commit: 'a1b2c3d', tab: 'files', head: 'open', rv: 'none', file: 'src/refund/service.ts',
    intent: '提交详情头部：标题与正文、作者 / 提交者 / 时间、完整 SHA（可复制）、父提交、包含此提交的分支、统计，主按钮“AI 审查此提交”。下方页签“改动文件 / AI 审查 / 修复”。',
    checks: ['完整 SHA 可复制（只在本机剪贴板）', '8 个文件 · +214 −37', '浏览只读：查看、复制、展开 diff 都不会修改仓库', '主按钮打开审查设置抽屉'] },
  { id: 'g12-diff-unified', g: '工作台浏览', label: '差异 · 统一视图', mode: '可交互', view: 'wb', commit: 'a1b2c3d', tab: 'files', head: 'compact', rv: 'none', file: 'src/refund/service.ts', diff: 'unified',
    intent: '统一视图：双列行号、hunk 头（含所在函数）、折叠未改动上下文（展开 20 行 / 全部）、语法着色、成对改动的行内高亮、忽略空白。',
    checks: ['折叠块“展开 20 行”可点', '勾选“忽略空白”后 summarize() 里的缩进改动变为上下文', '左侧文件列表：A / M / D / R 状态、old → new、+/− 计数', '“展开到全宽”隐藏左栏与中栏，Esc 返回'] },
  { id: 'g13-diff-split', g: '工作台浏览', label: '差异 · 并排视图（全宽）', mode: '可交互', view: 'wb', commit: 'a1b2c3d', tab: 'files', head: 'compact', rv: 'none', file: 'src/refund/service.ts', diff: 'split', full: true,
    intent: '并排视图需要宽度：在三栏布局里切到并排会自动展开到全宽（中栏、左栏收起），左右各自行号，删除 / 新增对齐，长行折行。',
    checks: ['左旧右新，空位用斜纹占位', '顶部“退出全宽 Esc”', '切回统一视图不自动退出全宽'] },
  { id: 'g14-diff-full', g: '工作台浏览', label: '差异 · 全宽阅读', mode: '可交互', view: 'wb', commit: 'a1b2c3d', tab: 'files', head: 'compact', rv: 'none', file: 'src/refund/controller.ts', diff: 'unified', full: true,
    intent: '全宽：隐藏中栏和左栏，文件树与 diff 占满；面包屑旁保留提交身份，Esc 或“退出全宽”回到三栏，选中与滚动位置保持。',
    checks: ['Esc 回到三栏', '文件树宽度不变，diff 区变宽', '新增文件全部为绿色新增行'] },
  { id: 'g15-merge-commit', g: '工作台浏览', label: '合并提交 · 选择对比的父', mode: '可交互', view: 'wb', commit: '5b6c7d8', tab: 'files', head: 'open', parent: 1,
    intent: '合并提交有两个父：用户选“对比父 1 / 对比父 2”。父 1 = 合并进来的 main 改动；父 2 = 这条分支相对 main 的改动。审查时也必须先选父。',
    checks: ['两个父提交都可点', '切换后文件数与统计变化（2 个文件 / 6 个文件）', 'AI 审查设置里出现“合并提交须选父”'] },
  { id: 'g16-branches', g: '工作台浏览', label: '分支（本地 / 远端）', mode: '可交互', view: 'wb', left: 'branches', commit: 'e4f5a6b',
    intent: '左栏切到“分支”时右栏显示分支表：本地 / 远端，是否当前、相对默认分支领先 / 落后、最后提交、关联合并请求、保护分支锁。只读：点分支 = 在提交列表筛选该分支。',
    checks: ['main、origin/main、origin/release/1.8 带锁', '点任一分支：中栏提交列表按该分支筛选', '没有切换 / 删除 / 重命名分支的入口'] },
  { id: 'g17-merge-requests', g: '工作台浏览', label: '合并请求（GitLab）', mode: '可交互', view: 'wb', left: 'mrs', mr: '!52', commit: 'e4f5a6b',
    intent: 'GitLab 合并请求列表：标题、源 → 目标、状态（打开 / 已合并 / 已关闭 / 冲突）、流水线、审批、更新时间；点开显示概要和提交，点提交进入提交详情。只读，“在 GitLab 打开”。',
    checks: ['!49 显示冲突与流水线失败', '!52 展开：审批 1 / 2、流水线三段、6 个提交', '点提交跳到提交详情（左栏切回“提交”）'] },
  { id: 'g18-large-binary', g: '工作台浏览', label: '大 diff 截断 · 二进制 · 重命名 · 权限', mode: '可交互', view: 'wb', commit: '3c4d5e6', tab: 'files', head: 'compact', file: 'db/seeds/refund_reason_codes.sql',
    intent: '边界文件：1,240 行种子数据只显示前 400 行（“加载全部”模拟读取）；二进制只给大小；重命名显示 old → new 与相似度；只改权限显示 100644 → 100755。',
    checks: ['截断提示在列表末尾，“加载全部”有读取中状态', 'docs/*.png 显示“二进制文件，不显示差异”', 'scripts/migrate.sh “权限变更 · 内容未改动”'] },
  { id: 'g19-empty-repo', g: '工作台浏览', label: '空仓库（还没有提交）', mode: '静态示意', view: 'wb', project: 'cs', empty: true,
    intent: '客户服务平台是刚初始化的仓库：当前分支 main 还没有任何提交。不显示图谱和详情空架子，直接说明，并提示工作区里已有 12 个未提交文件（只读）。',
    checks: ['中栏与右栏合并为一个空态', '没有“AI 审查”入口', 'GitLab 未绑定的提示与出路'] },
  { id: 'g20-detached-shallow', g: '工作台浏览', label: '分离 HEAD · 浅克隆', mode: '可交互', view: 'wb', commit: 'c7d8e9f', detached: true, shallow: true, head: 'open',
    intent: '当前不在任何分支上（HEAD 指向 c7d8e9f）：页头分支 chip 变为“分离 HEAD · c7d8e9f”并提示；浅克隆只有最近 50 个提交，列表底部说明，不提供“加载更早”。',
    checks: ['页头 chip 为提示色', '中栏顶部“当前不在任何分支上”', '列表末尾“只有最近 50 个提交（浅克隆）”'] },
  { id: 'g21-read-error', g: '工作台浏览', label: '读取失败（保留已加载内容）', mode: '可交互', view: 'wb', commit: 'a1b2c3d', tab: 'files', head: 'compact', file: 'src/order/repository.ts', listErr: true, diffErr: true,
    intent: '读取失败只影响失败的那一块：加载更早的提交失败时列表保留已加载的 14 个提交；某个文件的差异读取失败时其他文件照常。都给“重试”。',
    checks: ['列表末尾行内错误 + 重试（第二次成功）', 'diff 区错误条 + 重试', '没有整页错误'] },
  { id: 'g22-fetch-auth-fail', g: '工作台浏览', label: '获取远端更新失败（认证）', mode: '可交互', view: 'wb', commit: 'e4f5a6b', fetchErr: 'auth',
    intent: '“获取远端更新”失败：认证失败时引导到 设置 → GitLab 验证连接；网络失败给重试。领先 / 落后保持上次已知值并标注时间。',
    checks: ['页头下方错误条：GitLab 认证失败（401）', '“去设置验证连接”与“重试”', '领先 / 落后标注“10:42 的数据”'] },
  { id: 'g23-wb-no-gitlab', g: '工作台浏览', label: '补充 · 工作台中 GitLab 未配置', mode: '可交互', view: 'wb', gitlab: 'none', left: 'mrs', commit: 'e4f5a6b',
    intent: '工作台里 GitLab 未配置：本地提交可浏览；合并请求、远端分支、获取远端更新不可用，并就地说明去设置。',
    checks: ['“获取远端更新”禁用并说明', '合并请求区为引导空态', '分支表里远端分支整组不可用'] },
  { id: 'g24-not-git', g: '工作台浏览', label: '补充 · 项目不受 Git 管理', mode: '静态示意', view: 'notgit',
    intent: '从链接直接进入不受 Git 管理的项目（运营报表脚本 · 直接执行目录）：说明原因与出路，不显示空的三栏。',
    checks: ['写明“直接执行目录，不受 Git 管理”', '出路：返回仓库概览 / 在项目配置中查看'] },
  { id: 'g25-path-unavailable', g: '工作台浏览', label: '补充 · 本机路径不可用', mode: '静态示意', view: 'unavail',
    intent: '支付网关受 Git 管理，但本机路径不存在：不能读取任何 Git 信息，引导到项目页更新路径。',
    checks: ['路径以 mono 显示', '不显示上次缓存的提交，避免误读'] },

  /* ---------- 审查 ---------- */
  { id: 'g30-review-setup', g: 'AI 审查', label: '审查设置（抽屉）', mode: '可交互', view: 'wb', commit: 'a1b2c3d', tab: 'files', head: 'open', rv: 'none', drawer: 'review', file: 'src/refund/service.ts',
    intent: '审查是只读的：范围（对比父提交 / 对比目标分支）、维度（多选，默认全选）、审查职业（冻结发布修订）、上下文（只读改动 / 改动 + 相关文件）。',
    checks: ['说明行“审查只读取代码，不会修改文件或分支”', '维度全不选时“开始审查”禁用并说明', '开始后抽屉关闭，切到“AI 审查”页签'] },
  { id: 'g31-review-running', g: 'AI 审查', label: '审查进行中', mode: '可交互', view: 'wb', commit: 'a1b2c3d', tab: 'review', head: 'compact', rv: 'running', rvPhase: 1,
    intent: '审查运行：阶段（读取改动 → 分析 → 汇总），不显示假百分比；可停止；“在任务中查看详情”说明审查以只读模板任务运行，复用执行详情。',
    checks: ['当前阶段有转圈与已用时间', '停止需要确认，停止后保留已读取的阶段', '流程条：审查 = 进行中'] },
  { id: 'g32-review-result', g: 'AI 审查', label: '审查结果（5 个问题）', mode: '可交互', view: 'wb', commit: 'a1b2c3d', tab: 'review', head: 'compact', rv: 'done',
    intent: '结论卡（一句话 + 严重度计数 + 维度计数 + 审查对象），问题列表可按严重度 / 按文件分组；每条有位置、说明、建议修改、接受 / 忽略 / 误报（原因可选）与“选入修复”复选框；底部固定栏“已选 4 个问题 · AI 修复所选问题”。',
    checks: ['F4 命名问题已忽略，带原因，复选框不可选', '点位置跳到改动文件并高亮该行', '历史审查下拉：第 2 次 · 今天 10:46 / 第 1 次 · 今天 09:40'] },
  { id: 'g33-review-in-diff', g: 'AI 审查', label: '问题在 diff 中定位', mode: '可交互', view: 'wb', commit: 'a1b2c3d', tab: 'files', head: 'compact', rv: 'done', file: 'src/refund/service.ts', focus: 'F1',
    intent: '审查问题在 diff 的行号旁显示圆点（按严重度着色），范围内的行有左侧色条；点圆点在行下展开问题卡，可直接接受 / 忽略或回到问题列表。',
    checks: ['42–48 行高亮，问题卡展开在 48 行下方', '工具条“问题 1 / 4”上下跳转', '同一行有两个问题时显示两个圆点'] },
  { id: 'g34-review-clean', g: 'AI 审查', label: '审查无问题', mode: '可交互', view: 'wb', commit: 'c7d8e9f', tab: 'review', head: 'compact', rv: 'done',
    intent: '没有发现需要处理的问题：结论卡给出肯定结论，维度清单逐项打勾；修复页签不可用（没有问题可修）。',
    checks: ['6 个维度都打勾', '没有底部修复栏', '列表中 c7d8e9f 显示“无问题”徽标'] },
  { id: 'g35-review-failed', g: 'AI 审查', label: '审查失败', mode: '可交互', view: 'wb', commit: 'a1b2c3d', tab: 'review', head: 'compact', rv: 'failed',
    intent: '审查没完成（模型服务超时）：说明停在哪个阶段、已读取的内容；给“重新审查”（新开一次）与“在任务中查看详情”。历史审查记录不受影响。',
    checks: ['失败用 warn 色，不是红色阻断', '“重新审查”打开设置抽屉，保留上次设置', '历史下拉仍可切到第 1 次审查'] },
  { id: 'g36-review-unknown', g: 'AI 审查', label: '审查结果未知（核对原操作）', mode: '可交互', view: 'wb', commit: 'a1b2c3d', tab: 'review', head: 'compact', rv: 'unknown',
    intent: '“开始审查”请求发出后没有收到回执：不知道审查是否已开始。保持原记录，按钮“核对原操作”，不重发（与系统一致的 UNKNOWN 规则）。',
    checks: ['虚线 unknown 样式', '没有“重新审查”按钮', '核对后：审查已在运行 → 切到进行中'] },

  /* ---------- 修复 ---------- */
  { id: 'g40-fix-confirm', g: 'AI 修复', label: '开始 AI 修复？（确认）', mode: '可交互', view: 'wb', commit: 'a1b2c3d', tab: 'review', head: 'compact', rv: 'done', dialog: 'fix',
    intent: '修复是写操作，但在隔离的修复分支中进行：确认框写清修复位置（ai-fix/a1b2c3d-1013，基于 feature/refund 最新提交 e4f5a6b，以及为什么不是 a1b2c3d）、修复职业、修复后校验命令。',
    checks: ['“不改动你当前的工作区”突出显示', '基于提交的说明：之后又有 2 个提交', '项目未配置测试命令时显示“修复后不会自动校验”（说明里可切换）'] },
  { id: 'g41-fix-running', g: 'AI 修复', label: '修复进行中', mode: '可交互', view: 'wb', commit: 'a1b2c3d', tab: 'fix', full: true, head: 'compact', rv: 'done', fx: 'running', fxPhase: 1,
    intent: '修复以全宽打开：阶段条（准备修复分支 → 修改代码 → 校验 → 完成）+ 实时记录摘要；可停止。写操作进行中，相关按钮锁定。',
    checks: ['顶部流程条：审查 完成 → 修复 进行中', '记录按时间追加（暂停模拟时不追加）', '停止需确认；停止后修复分支保留，可放弃'] },
  { id: 'g42-fix-result', g: 'AI 修复', label: '修复结果（校验通过）', mode: '可交互', view: 'wb', commit: 'a1b2c3d', tab: 'fix', full: true, head: 'compact', rv: 'done', fx: 'done', cm: 'todo',
    intent: '修复结果：问题对照（已修复 / 部分修复 / 未修复）、修复改动（同一个 diff 查看器，可撤销单个文件）、校验结果；右侧“下一步”分三步，依赖清楚，不自动连锁。',
    checks: ['F5 部分修复写明原因', '撤销某个文件只影响修复分支，提交前可用', '推送、合并在提交前为锁定态，写明“先完成 ①”'] },
  { id: 'g43-fix-verify-failed', g: 'AI 修复', label: '修复后校验失败', mode: '可交互', view: 'wb', commit: 'a1b2c3d', tab: 'fix', full: true, head: 'compact', rv: 'done', fx: 'verify-failed', cm: 'todo',
    intent: '校验失败：显示失败用例与输出；仍可提交，但需要勾选“我已了解校验未通过”。也可以“重新修复”（新开一次）。',
    checks: ['2 个失败用例展开可读', '提交按钮在勾选前禁用并说明', '流程条：修复 = 校验未通过'] },
  { id: 'g44-fix-nochange', g: 'AI 修复', label: 'AI 认为无需修改', mode: '可交互', view: 'wb', commit: 'a1b2c3d', tab: 'fix', full: true, head: 'compact', rv: 'done', fx: 'nochange',
    intent: '修复没有产生改动：逐条说明 AI 的判断（例如最新代码已经处理），没有可提交的内容；可以清理修复分支或回到问题列表调整。',
    checks: ['每个问题“未修复”都有原因', '提交 / 推送 / 合并整体禁用并说明', '“清理修复分支”不需要二次确认（没有改动）'] },
  { id: 'g45-fix-failed', g: 'AI 修复', label: '补充 · 修复失败（模型未完成）', mode: '可交互', view: 'wb', commit: 'a1b2c3d', tab: 'fix', full: true, head: 'compact', rv: 'done', fx: 'failed',
    intent: '模型没能完成修复：停在“修改代码”阶段，修复分支里可能有部分改动但未校验，不提供提交；可重新修复或放弃。',
    checks: ['失败阶段标红', '部分改动只读可看', '没有提交入口'] },

  /* ---------- 提交 / 推送 / 合并 ---------- */
  { id: 'g50-commit', g: '提交 · 推送 · 合并', label: '① 提交修复', mode: '可交互', view: 'wb', commit: 'a1b2c3d', tab: 'fix', full: true, head: 'compact', rv: 'done', fx: 'done', cm: 'todo', focusStep: 'commit',
    intent: '提交修复：提交信息由 AI 草拟、可编辑；作者来自 Git 账号设置；选择要提交的文件；split button 主动作“提交到 ai-fix/a1b2c3d-1013”，下拉“提交并推送”。按钮上方写清后果。',
    checks: ['后果：只在本地修复分支新增 1 个提交，不影响 feature/refund 与工作区', '取消勾选所有文件时提交禁用', '提交中锁定其他写操作'] },
  { id: 'g51-committed', g: '提交 · 推送 · 合并', label: '已提交 · 等待推送', mode: '可交互', view: 'wb', commit: 'a1b2c3d', tab: 'fix', full: true, head: 'compact', rv: 'done', fx: 'done', cm: 'done', ps: 'todo',
    intent: '提交完成显示新提交 SHA；“撤销文件”不再可用（已提交）。② 推送解锁：目标 origin / ai-fix/a1b2c3d-1013（新建远端分支），永不强推。',
    checks: ['① 折叠为摘要：9d8c7b6', '② 后果：在 GitLab 新建分支，不改动 feature/refund', '③ 仍锁定：先完成 ②'] },
  { id: 'g52-push-rejected', g: '提交 · 推送 · 合并', label: '推送被拒（non-fast-forward）', mode: '可交互', view: 'wb', commit: 'a1b2c3d', tab: 'fix', full: true, head: 'compact', rv: 'done', fx: 'done', cm: 'done', ps: 'rejected',
    intent: '远端已有同名分支且包含本地没有的提交：不提供强制推送。先“获取远端更新”，看到远端提交后再决定（换分支名推送 / 稍后处理）。',
    checks: ['写明“不会强制推送”', '获取后列出远端多出的提交', '换名推送：ai-fix/a1b2c3d-1013-2'] },
  { id: 'g53-pushed', g: '提交 · 推送 · 合并', label: '已推送', mode: '可交互', view: 'wb', commit: 'a1b2c3d', tab: 'fix', full: true, head: 'compact', rv: 'done', fx: 'done', cm: 'done', ps: 'done', mg: 'todo',
    intent: '推送完成：远端分支链接；③ 合并解锁，默认推荐“创建合并请求”。',
    checks: ['② 摘要：origin/ai-fix/a1b2c3d-1013 @ 9d8c7b6', '③ 展开前是一行“选择合并方式”', '流程条：推送 完成'] },
  { id: 'g54-merge-choose', g: '提交 · 推送 · 合并', label: '③ 选择合并方式（MR / 直接合并）', mode: '可交互', view: 'wb', commit: 'a1b2c3d', tab: 'fix', full: true, head: 'compact', rv: 'done', fx: 'done', cm: 'done', ps: 'done', mg: 'choose',
    intent: '两种方式单选卡：“创建合并请求（推荐）”带 AI 草拟的标题 / 描述（附审查问题），可指派评审人；“直接合并”只在目标分支未受保护、可快进 / 无冲突、且不是有未提交改动的当前检出分支时可用，否则禁用并说明。',
    checks: ['目标选 main：直接合并禁用“main 是保护分支，只能通过合并请求合并”', '目标 feature/refund：当前检出且工作区有 3 个未提交改动 → 直接合并禁用', '说明抽屉可切换“工作区干净”，看到直接合并可用与确认框'] },
  { id: 'g55-mr-created', g: '提交 · 推送 · 合并', label: '合并请求已创建', mode: '可交互', view: 'wb', commit: 'a1b2c3d', tab: 'fix', full: true, head: 'compact', rv: 'done', fx: 'done', cm: 'done', ps: 'done', mg: 'mr',
    intent: '合并请求 !58 已创建：显示源 → 目标、流水线状态、指派评审人；合并本身在 GitLab 完成。流程条全部完成（合并 = MR 已创建）。',
    checks: ['“在 GitLab 打开 !58”', '列表中 a1b2c3d 徽标变为“已修复”', '放弃修复入口消失（已交给 MR）'] },
  { id: 'g56-merge-conflict', g: '提交 · 推送 · 合并', label: '直接合并冲突', mode: '可交互', view: 'wb', commit: 'a1b2c3d', tab: 'fix', full: true, head: 'compact', rv: 'done', fx: 'done', cm: 'done', ps: 'done', mg: 'conflict', dirty: 0,
    intent: '工作区干净时直接合并可用；合并时发现冲突：列出冲突文件，目标分支未被改动，建议改用合并请求。',
    checks: ['写明“feature/refund 未被改动”', '冲突文件列表', '“改为创建合并请求”一键切换'] },
  { id: 'g57-op-unknown', g: '提交 · 推送 · 合并', label: '推送回执未知（核对原操作）', mode: '可交互', view: 'wb', commit: 'a1b2c3d', tab: 'fix', full: true, head: 'compact', rv: 'done', fx: 'done', cm: 'done', ps: 'unknown',
    intent: '推送请求发出后没有收到回执：保持原记录 op-push-7c21，按钮“核对原操作”，不重发；核对前合并步骤保持锁定。',
    checks: ['虚线 unknown 样式，流程条推送 = 结果未知', '没有“重新推送”', '核对：远端已有 9d8c7b6 → 推送完成'] },
  { id: 'g58-discard-confirm', g: '提交 · 推送 · 合并', label: '放弃修复（确认）', mode: '可交互', view: 'wb', commit: 'a1b2c3d', tab: 'fix', full: true, head: 'compact', rv: 'done', fx: 'done', cm: 'done', ps: 'done', mg: 'todo', dialog: 'discard',
    intent: '放弃修复：删除本地修复分支与修复工作副本；已推送的远端分支不删除（说明在 GitLab 中处理）。审查记录保留。',
    checks: ['列出将删除 / 不会删除的内容', '危险按钮“放弃修复”', '你的工作区与 feature/refund 不受影响'] },
  { id: 'g59-commit-hook-rejected', g: '提交 · 推送 · 合并', label: '补充 · 提交被 hook 拒绝', mode: '可交互', view: 'wb', commit: 'a1b2c3d', tab: 'fix', full: true, head: 'compact', rv: 'done', fx: 'done', cm: 'hook',
    intent: '提交失败：pre-commit hook 拒绝，显示 hook 输出。修复分支内容没有变化，可修改后重试；不提供跳过 hook。',
    checks: ['hook 输出 mono 可读', '“重试提交”', '没有 --no-verify'] },
  { id: 'g60-push-auth-fail', g: '提交 · 推送 · 合并', label: '补充 · 推送认证失败', mode: '可交互', view: 'wb', commit: 'a1b2c3d', tab: 'fix', full: true, head: 'compact', rv: 'done', fx: 'done', cm: 'done', ps: 'auth',
    intent: '推送认证失败（403 / 令牌过期）：引导到 设置 → GitLab 验证连接，回来后重试推送。',
    checks: ['写明账号 dev-zhang', '“去设置验证连接”与“重试推送”'] },
  { id: 'g61-mr-exists', g: '提交 · 推送 · 合并', label: '补充 · 合并请求已存在', mode: '可交互', view: 'wb', commit: 'a1b2c3d', tab: 'fix', full: true, head: 'compact', rv: 'done', fx: 'done', cm: 'done', ps: 'done', mg: 'exists',
    intent: '同一源 → 目标已有打开的合并请求：不重复创建，链接到已有 MR；推送已经更新了它。',
    checks: ['链接到已有 !58', '说明“推送已更新这个 MR”'] },
];
