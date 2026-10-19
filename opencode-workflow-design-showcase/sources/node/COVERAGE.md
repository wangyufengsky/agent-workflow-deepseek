# 节点执行详情 · 覆盖表（COVERAGE）

> 设计样例 · 不连接真实服务/模型。原型完成不等于前后端接通、真实模型验证或整条流程验收。

- 原型入口：[prototype/index.html](prototype/index.html)（本地直接打开）。地址参数：`?state=<状态 id>&theme=deepseek|warm|spdb|github-white`；可选 `&motion=reduce`（减少动态）、`&stream=paused`（进入时暂停模拟流式，设计图都用它固定画面）。
- 底部原型控制条（不属于产品界面）：状态下拉（按 N01–N20 分组）、主题、减少动态、流式暂停 / 继续、说明抽屉（每个状态的设计意图与验收要点）。
- 设计图：[design/](design/)，1440×900。deepseek 每个状态一张（60 张）+ 3 张交互后的补充图；warm / spdb / github-white 各 8 张主要阅读 / 状态表面；总览拼图 [overview-contact-sheet.png](design/overview-contact-sheet.png)。
- 交互程度：**可交互** = 进入后可以继续点击、切换、流式追加并得到符合设计的结果；**静态示意** = 只固定展示该画面。

## 状态映射

| N | 原型状态 id | 设计图 | 交互程度 | 说明 / 未完成项 |
| --- | --- | --- | --- | --- |
| N01 | [n01-default](prototype/index.html?state=n01-default) | [deepseek-n01-default.png](design/deepseek-n01-default.png) | 可交互 | 默认全图（无面板）。右侧没有面板，画布占满 |
| N01 | [n01-open](prototype/index.html?state=n01-open) | [deepseek-n01-open.png](design/deepseek-n01-open.png) | 可交互 | 实现接口 · 详情打开（执行现场）。面板头：步骤 2 · 软件工程师、节点名、状态徽标、尝试选择“尝试 #3 · 当前” |
| N01 | [n01-closed](prototype/index.html?state=n01-closed) | [deepseek-n01-closed.png](design/deepseek-n01-closed.png) | 可交互 | 关闭详情（选中 / 视口保持）。进入时把缩放调到 95%，打开再关闭；关闭按钮保留选中描边与视口，点空白处才清除选中。 |
| N02 | [n02-loading](prototype/index.html?state=n02-loading) | [deepseek-n02-loading.png](design/deepseek-n02-loading.png) | 可交互 | 正文首次加载。约 2.5 秒后模拟载入；骨架不冒充正文。 |
| N02 | [n02-empty](prototype/index.html?state=n02-empty) | [deepseek-n02-empty.png](design/deepseek-n02-empty.png) | 可交互 | 尚无正文（已开始，模型未输出）。空态写“模型还没有输出正文”，语气中性 |
| N03 | [n03-stream](prototype/index.html?state=n03-stream) | [deepseek-n03-stream.png](design/deepseek-n03-stream.png)<br>[warm-n03-stream.png](design/warm-n03-stream.png)<br>[spdb-n03-stream.png](design/spdb-n03-stream.png)<br>[github-white-n03-stream.png](design/github-white-n03-stream.png) | 可交互 | 正文流式追加（未闭合代码块 / 长链接）。每 1.3 秒按 seq 追加样例片段；控制条可暂停 / 继续。截图时用 &stream=paused 固定画面。 |
| N04 | [n04-wait-tool](prototype/index.html?state=n04-wait-tool) | [deepseek-n04-wait-tool.png](design/deepseek-n04-wait-tool.png) | 可交互 | 等待工具（排队）。工具卡徽标“排队” |
| N04 | [n04-tool-running](prototype/index.html?state=n04-tool-running) | [deepseek-n04-tool-running.png](design/deepseek-n04-tool-running.png) | 可交互 | 工具运行中。工具卡“运行中”徽标带图标与文字 |
| N04 | [n04-tool-done](prototype/index.html?state=n04-tool-done) | [deepseek-n04-tool-done.png](design/deepseek-n04-tool-done.png) | 可交互 | 工具完成、正文继续。工具：全部结束；尝试：执行中 |
| N05 | [n05-reasoning](prototype/index.html?state=n05-reasoning) | [deepseek-n05-reasoning.png](design/deepseek-n05-reasoning.png)<br>[deepseek-n05-reasoning-expanded.png](design/deepseek-n05-reasoning-expanded.png) | 可交互 | 有公开推理摘要。标签“公开推理摘要 · 由模型服务提供” |
| N05 | [n05-no-reasoning](prototype/index.html?state=n05-no-reasoning) | [deepseek-n05-no-reasoning.png](design/deepseek-n05-no-reasoning.png) | 可交互 | 无公开推理摘要。记录流里没有空的摘要块 |
| N06 | [n06-ended-unsubmitted](prototype/index.html?state=n06-ended-unsubmitted) | [deepseek-n06-ended-unsubmitted.png](design/deepseek-n06-ended-unsubmitted.png) | 可交互 | 正文传输结束 · 结果未提交。正文：传输结束；尝试：执行中；结果：未提交 |
| N06 | [n06-pending-accept](prototype/index.html?state=n06-pending-accept) | [deepseek-n06-pending-accept.png](design/deepseek-n06-pending-accept.png) | 可交互 | 结果已提交 · 待验收。服务事件行“结果已提交 · 等待验收” |
| N07 | [n07-failed-partial](prototype/index.html?state=n07-failed-partial) | [deepseek-n07-failed-partial.png](design/deepseek-n07-failed-partial.png) | 可交互 | 执行失败 · 保留部分正文。失败时运行中的工具改为“结果未知”，并演示“时间未知”。 |
| N08 | [n08-cancelling](prototype/index.html?state=n08-cancelling) | [deepseek-n08-cancelling.png](design/deepseek-n08-cancelling.png) | 可交互 | 取消中。继续流式时测试结果仍会到达，演示“取消请求 ≠ 已停止”。 |
| N08 | [n08-cancelled](prototype/index.html?state=n08-cancelled) | [deepseek-n08-cancelled.png](design/deepseek-n08-cancelled.png) | 可交互 | 已确认取消。尝试：已取消 |
| N08 | [n08-cancel-unknown](prototype/index.html?state=n08-cancel-unknown) | [deepseek-n08-cancel-unknown.png](design/deepseek-n08-cancel-unknown.png) | 可交互 | 取消结果未知。“核对原操作”模拟读取约 0.9 秒后给出“仍未确认”；没有重发入口。 |
| N09 | [n09-receipt-unknown](prototype/index.html?state=n09-receipt-unknown) | [deepseek-n09-receipt-unknown.png](design/deepseek-n09-receipt-unknown.png) | 可交互 | 结果提交回执未知。同上；结果不显示为已提交，画布节点为“状态未核对”。 |
| N10 | [n10-disconnected](prototype/index.html?state=n10-disconnected) | [deepseek-n10-disconnected.png](design/deepseek-n10-disconnected.png) | 可交互 | 数据连接断开。“重新连接”可交互：重连中 → 补读中 → 补读完成（继续流式）。 |
| N10 | [n10-reconnecting](prototype/index.html?state=n10-reconnecting) | [deepseek-n10-reconnecting.png](design/deepseek-n10-reconnecting.png) | 可交互 | 重新连接中。连接：重新连接中 |
| N10 | [n10-backfilling](prototype/index.html?state=n10-backfilling) | [deepseek-n10-backfilling.png](design/deepseek-n10-backfilling.png) | 可交互 | 补读中（按序补齐 / 去重）。剩余补读片段随流式到达，最后一条补读完成事件去掉过时标记并写“已补读 N 条（去重 2 条）”。 |
| N10 | [n10-backfilled](prototype/index.html?state=n10-backfilled) | [deepseek-n10-backfilled.png](design/deepseek-n10-backfilled.png) | 可交互 | 补读完成。服务事件行“已补读 N 条（去重 2 条）” |
| N10 | [n10-gap](prototype/index.html?state=n10-gap) | [deepseek-n10-gap.png](design/deepseek-n10-gap.png)<br>[warm-n10-gap.png](design/warm-n10-gap.png)<br>[spdb-n10-gap.png](design/spdb-n10-gap.png)<br>[github-white-n10-gap.png](design/github-white-n10-gap.png) | 可交互 | 补读有缺口（服务未保留）。缺口用虚线条画出；落在缺口内的 #c-b7e1 为“结果未知”。 |
| N11 | [n11-done](prototype/index.html?state=n11-done) | [deepseek-n11-done.png](design/deepseek-n11-done.png)<br>[warm-n11-done.png](design/warm-n11-done.png)<br>[spdb-n11-done.png](design/spdb-n11-done.png)<br>[github-white-n11-done.png](design/github-white-n11-done.png) | 可交互 | 完成（结果提交 + 验收通过）。结果与验收：验收通过（r3 · 策略 v3） |
| N11 | [n11-accept-rejected](prototype/index.html?state=n11-accept-rejected) | [deepseek-n11-accept-rejected.png](design/deepseek-n11-accept-rejected.png) | 可交互 | 验收未通过。结果与验收：未通过 |
| N11 | [n11-manual-accept](prototype/index.html?state=n11-manual-accept) | [deepseek-n11-manual-accept.png](design/deepseek-n11-manual-accept.png) | 可交互 | 待人工验收。结果与验收：待人工验收 |
| N12 | [n12-follow-on](prototype/index.html?state=n12-follow-on) | [deepseek-n12-follow-on.png](design/deepseek-n12-follow-on.png) | 可交互 | 跟随最新：开（在底部）。开关“跟随最新”为开 |
| N12 | [n12-follow-off](prototype/index.html?state=n12-follow-off) | [deepseek-n12-follow-off.png](design/deepseek-n12-follow-off.png) | 可交互 | 跟随最新：关（只计数）。进入时以真实机制追加 6 个片段（3 条新条目），只计数不滚动。 |
| N12 | [n12-scrolled-new](prototype/index.html?state=n12-scrolled-new) | [deepseek-n12-scrolled-new.png](design/deepseek-n12-scrolled-new.png) | 可交互 | 上翻阅读 · 有新内容。进入时把阅读位置放在中部并标记已暂停，再追加 8 个片段；点胶囊回到底部并恢复跟随。 |
| N13 | [n13-tool-text](prototype/index.html?state=n13-tool-text) | [deepseek-n13-tool-text.png](design/deepseek-n13-tool-text.png) | 可交互 | 工具详情 · 长文本。头部：工具名 + 来源、调用 ID、所属尝试 #3、状态、开始 / 结束 / 时长 |
| N13 | [n13-tool-json](prototype/index.html?state=n13-tool-json) | [deepseek-n13-tool-json.png](design/deepseek-n13-tool-json.png)<br>[warm-n13-tool-json.png](design/warm-n13-tool-json.png)<br>[spdb-n13-tool-json.png](design/spdb-n13-tool-json.png)<br>[github-white-n13-tool-json.png](design/github-white-n13-tool-json.png) | 可交互 | 工具详情 · JSON。字符串 / 数字 / 布尔与空 三种颜色 |
| N13 | [n13-tool-code](prototype/index.html?state=n13-tool-code) | [deepseek-n13-tool-code.png](design/deepseek-n13-tool-code.png) | 可交互 | 工具详情 · 代码（分段读取）。“继续读取”按 200 行追加（模拟），自动换行切换。 |
| N13 | [n13-tool-empty](prototype/index.html?state=n13-tool-empty) | [deepseek-n13-tool-empty.png](design/deepseek-n13-tool-empty.png) | 可交互 | 工具详情 · 空结果。“工具返回空结果”中性样式 |
| N13 | [n13-tool-failed](prototype/index.html?state=n13-tool-failed) | [deepseek-n13-tool-failed.png](design/deepseek-n13-tool-failed.png)<br>[deepseek-n13-tool-failed-readfail.png](design/deepseek-n13-tool-failed-readfail.png) | 可交互 | 工具详情 · 失败（命令输出 / 读取失败）。第一次“继续读取”成功，第二次模拟失败：保留已加载内容 + 重新读取。 |
| N13 | [n13-tool-twice](prototype/index.html?state=n13-tool-twice) | [deepseek-n13-tool-twice.png](design/deepseek-n13-tool-twice.png) | 可交互 | 同一工具两次调用 + 晚回。两次调用并行发起，较早的 #c-b7e1 晚于后续正文返回，在原位置更新。 |
| N14 | [n14-redacted](prototype/index.html?state=n14-redacted) | [deepseek-n14-redacted.png](design/deepseek-n14-redacted.png)<br>[warm-n14-redacted.png](design/warm-n14-redacted.png)<br>[spdb-n14-redacted.png](design/spdb-n14-redacted.png)<br>[github-white-n14-redacted.png](design/github-white-n14-redacted.png) | 可交互 | 工具详情 · 服务端脱敏。fixtures 里只有 {"$redacted":…} 标记；复制输出 "[已隐藏]"（剪贴板已在自测中读回核对）。 |
| N14 | [n14-no-permission](prototype/index.html?state=n14-no-permission) | [deepseek-n14-no-permission.png](design/deepseek-n14-no-permission.png) | 可交互 | 工具详情 · 无权限。锁图标 + “你没有查看此调用完整参数的权限” |
| N14 | [n14-no-capability](prototype/index.html?state=n14-no-capability) | [deepseek-n14-no-capability.png](design/deepseek-n14-no-capability.png) | 可交互 | 工具详情 · 缺能力。“当前服务尚未提供工具完整参数读取” |
| N14 | [n14-truncated](prototype/index.html?state=n14-truncated) | [deepseek-n14-truncated.png](design/deepseek-n14-truncated.png) | 可交互 | 工具详情 · 已截断。warn 提示“内容已截断：服务只保留了前 64 KB” |
| N15 | [n15-art-text](prototype/index.html?state=n15-art-text) | [deepseek-n15-art-text.png](design/deepseek-n15-art-text.png) | 可交互 | 产物阅读 · Markdown 文本。面包屑“实现接口 › 尝试 #3 › 产物 …” |
| N15 | [n15-art-json](prototype/index.html?state=n15-art-json) | [deepseek-n15-art-json.png](design/deepseek-n15-art-json.png) | 可交互 | 产物阅读 · JSON。JSON 树可折叠 |
| N15 | [n15-art-code](prototype/index.html?state=n15-art-code) | [deepseek-n15-art-code.png](design/deepseek-n15-art-code.png) | 可交互 | 产物阅读 · 代码。搜索框“在已加载内容中查找” |
| N15 | [n15-art-unsupported](prototype/index.html?state=n15-art-unsupported) | [deepseek-n15-art-unsupported.png](design/deepseek-n15-art-unsupported.png) | 可交互 | 产物阅读 · 不支持格式。“这种格式（application/octet-stream · 2.3 MB）不能在这里预览” |
| N15 | [n15-art-missing](prototype/index.html?state=n15-art-missing) | [deepseek-n15-art-missing.png](design/deepseek-n15-art-missing.png) | 可交互 | 产物阅读 · 不存在 / 失效 / 无权 / 未生成。左栏可切换：不存在 / 无权读取 / 正文尚未生成 / 读取失败（可重新读取）/ 不能预览。版本失效见 n17-history 的 r1。 |
| N15 | [n15-download](prototype/index.html?state=n15-download) | [deepseek-n15-download.png](design/deepseek-n15-download.png)<br>[deepseek-n15-download-done.png](design/deepseek-n15-download-done.png) | 可交互 | 产物下载（失败 → 重试 → 已下载）。进入时为“下载失败”；重试 → 下载中 → 已下载（原型模拟，未保存任何文件）。 |
| N16 | [n16-cite-source](prototype/index.html?state=n16-cite-source) | [deepseek-n16-cite-source.png](design/deepseek-n16-cite-source.png) | 可交互 | 引用 · 原文段落。也可从执行现场正文里的引用 [1] 进入。 |
| N16 | [n16-cite-code](prototype/index.html?state=n16-cite-code) | [deepseek-n16-cite-code.png](design/deepseek-n16-cite-code.png)<br>[warm-n16-cite-code.png](design/warm-n16-cite-code.png)<br>[spdb-n16-cite-code.png](design/spdb-n16-cite-code.png)<br>[github-white-n16-cite-code.png](design/github-white-n16-cite-code.png) | 可交互 | 引用 · 精确代码行。“引用定位：第 42–48 行 · 来源版本 r3（不是最新文件）” |
| N16 | [n16-cite-excerpt](prototype/index.html?state=n16-cite-excerpt) | [deepseek-n16-cite-excerpt.png](design/deepseek-n16-cite-excerpt.png) | 可交互 | 引用 · 只有节选 / 摘要。info 提示“仅提供节选（第 40–60 行附近），不是完整原文” |
| N17 | [n17-list](prototype/index.html?state=n17-list) | [deepseek-n17-list.png](design/deepseek-n17-list.png) | 可交互 | 多次尝试列表。#1 失败、#2 已取消、#3 当前执行中 |
| N17 | [n17-history](prototype/index.html?state=n17-history) | [deepseek-n17-history.png](design/deepseek-n17-history.png)<br>[warm-n17-history.png](design/warm-n17-history.png)<br>[spdb-n17-history.png](design/spdb-n17-history.png)<br>[github-white-n17-history.png](design/github-white-n17-history.png) | 可交互 | 历史 #1 单次详情。‹ › 切换 #1/#2/#3；#2 的 r2 验收未通过并绑定策略 v3；当前有结果时标“已被尝试 #3 的结果 r3 替代”。 |
| N17 | [n17-history-session](prototype/index.html?state=n17-history-session) | [deepseek-n17-history-session.png](design/deepseek-n17-history-session.png) | 可交互 | 历史 #1 执行现场（只读）。当前尝试继续流式时，只读条内出现“当前尝试有新内容”。 |
| N17 | [n17-back-current](prototype/index.html?state=n17-back-current) | [deepseek-n17-back-current.png](design/deepseek-n17-back-current.png) | 可交互 | 回到当前（当前仍在加载）。约 2.5 秒后模拟载入当前尝试。 |
| N18 | [n18-not-retained](prototype/index.html?state=n18-not-retained) | [deepseek-n18-not-retained.png](design/deepseek-n18-not-retained.png) | 可交互 | 历史记录未保留。按样例改写为“超出 7 天保留期”，见偏离说明。 |
| N18 | [n18-page-fail](prototype/index.html?state=n18-page-fail) | [deepseek-n18-page-fail.png](design/deepseek-n18-page-fail.png) | 可交互 | 加载更早的尝试失败。重试约 0.9 秒后载入 #1。 |
| N19 | [n19-late](prototype/index.html?state=n19-late) | [deepseek-n19-late.png](design/deepseek-n19-late.png) | 可交互 | 切节点后旧响应晚到。约 3 秒后载入“编写测试”的内容；不采用“实现接口”的晚到响应。 |
| N19 | [n19-revoked](prototype/index.html?state=n19-revoked) | [deepseek-n19-revoked.png](design/deepseek-n19-revoked.png) | 静态示意 | 撤权（内容清除）。只演示结果画面；撤权发生的过程没有动画演示。 |
| N19 | [n19-project](prototype/index.html?state=n19-project) | [deepseek-n19-project.png](design/deepseek-n19-project.png) | 可交互 | 项目切换（面板关闭）。也可在任意状态用页头“⋯ → 切换到另一个示例项目”在原型内重现：清空记忆的阅读位置并换画布。 |
| N20 | [n20-reader](prototype/index.html?state=n20-reader) | [deepseek-n20-reader.png](design/deepseek-n20-reader.png)<br>[warm-n20-reader.png](design/warm-n20-reader.png)<br>[spdb-n20-reader.png](design/spdb-n20-reader.png)<br>[github-white-n20-reader.png](design/github-white-n20-reader.png) | 可交互 | 宽阅读区展开与返回。阅读器打开 / 关闭不调用画布重渲染；自测比对 .cv-world 的 transform 前后一致。 |
| N20 | [n20-keyboard](prototype/index.html?state=n20-keyboard) | [deepseek-n20-keyboard.png](design/deepseek-n20-keyboard.png) | 可交互 | 键盘操作（焦点环 / 页签方向键 / Esc）。强制显示焦点环（演示用）；方向键切页签、Esc 先关阅读区再关子视图均已自测。 |
| N20 | [n20-reduced](prototype/index.html?state=n20-reduced) | [deepseek-n20-reduced.png](design/deepseek-n20-reduced.png) | 可交互 | 减少动态。也可在任意状态用控制条“减少动态”开关；URL 参数 &motion=reduce。 |

## 复用与新增

| 来源 | 复用方式 |
| --- | --- |
| `deepseek/assets/ds.css`、`skins.css`、`canvas.js` | 原样复制（逐字节一致），四主题令牌不改 |
| `deepseek/assets/shell.js` | 复制后修改副本：主题读 `?theme=`（兼容 `?skin=`）映射到 `data-skin`；去掉本机存储；侧栏导航不跳出原型；运行环境卡写“设计样例 · 未连接”；`mount({proto:false})` 不插原稿状态条 |
| `task.html` | 页头工具条、情况条、画布 + 480 右侧面板、三页签、概览原因卡、页脚业务动作、`.att` / `.log` / `.reason` / `.lockline` 样式 |
| `run.html` | 宽阅读区的左列表 + 阅读主体、`.para` 段落高亮、`.code` 行号 / 定位高亮、“只筛选已加载的记录”文案口径 |
| 新增（`node-detail.css/js`、`fixtures.js`、`states.js`） | 事实条、模型正文 / 公开推理摘要 / 工具卡 / 服务事件行 / 缺口、跟随最新、工具详情（JSON 树、代码 / 命令输出查看器、脱敏 chip、无权 / 缺能力 / 截断）、尝试单次详情、宽阅读区、原型控制条与说明抽屉 |

## 原型做不到或刻意不做

- **真实流式**：正文、工具事件都是 `fixtures.js` 里的固定片段，`setInterval` 每 1.3 秒按稳定 `seq` 追加；去重只演示“同 seq 不重复渲染”。
- **真实下载 / 复制范围以外的导出**：下载只切换按钮状态（下载中 → 已下载 / 失败），不生成文件、不调用系统保存。
- **真实读取 / 分页 / 补读**：“继续读取”“重新读取”“加载更早的尝试”“核对原操作”“重新连接”都是本地计时模拟；读取失败固定在第二次“继续读取”。
- **网络与桥接**：不调用 `window.workflowDesktop`、fetch、XHR、WebSocket、IPC；不写本机存储。自动检查：所有状态 × 四主题加载过程中没有任何非 `file://` 请求。
- **字体**：去掉了原稿的 Google Fonts 链接，按 `ds.css` 的回退栈显示（DM Sans / Montserrat / JetBrains Mono 未安装时落到系统 / Noto 字体），所以字形与原稿截图会有细微差异。`ds.css` 中仅有的 `http://www.w3.org/2000/svg` 是 data: SVG 的命名空间，不是网络请求。
- **跨刷新保持**：阅读位置与跟随状态只存在内存（key = 项目:节点:尝试），刷新页面会丢失；同一面板内切页签、开工具详情、开阅读器、切尝试后都能恢复（已自测）。
- **只为“实现接口”展开完整数据**：其余节点（梳理需求、编写测试）只有简短记录与单行尝试；它们的工具卡没有完整参数样例，“查看”单次详情给原型提示。
- **撤权过程**（n19-revoked）只做结果画面。
- **语法着色**为简化的正则着色（ts / sh / yaml），不是完整语法分析。
- 不提供“重新执行 / 重放 / 执行此命令”类入口，历史区域没有主按钮式的执行动作——这是设计决定，不是遗漏。

## 与规格的偏离

1. **原型控制条单独占底部 52px 一条**（仍是底部居中的 `.proto`），产品界面高度相应减少 52px。原因：控制条比原稿多了 4 个控件，悬浮在中间会压住 480 面板的页脚与宽阅读区；单独一条也让截图里原型控件与产品界面分得更清楚。
2. **页头沿用 task.html 的 `.canvas-bar`**（原稿同样删除了 56px `.header`）：面包屑“任务列表 /”+ 任务名 + 任务状态 + 设计样例徽标 + 自动节点推进 + ⋯。视觉上与 task.html 一致，高度约 64px 而不是 56px。
3. **概览不显示百分比进度条**：原稿概览有“这一步的进度 xx%”，与 brief / 规格“没有可信总量不显示进度”冲突，改为只列服务事实的三格（已记录工具调用 / 尝试次数 / 结果与验收）。
4. **尝试事实值**：结果已提交但未验收通过时，尝试写“执行已结束”而不是“已完成”；“已完成”只在验收通过后出现（规格第 8 节）。
5. **N18 未保留文案**：样例节点只有 3 次尝试，“服务只保留最近 20 次”说不通，改为“尝试 #1 的正文与工具记录超出 7 天保留期，只保留状态、时间、失败原因与结果摘要；更早的尝试记录未保留”。分页失败（n18-page-fail）按每页 2 次演示。
6. **N10 补读数量**按样例实际计算为“已补读 6 条（去重 2 条）”（缺口场景为 5 条），不是规格举例的 18 条；缺口时间段放在样例时间线里（10:44:12–10:44:38）。
7. **跟随计数**：“有 N 条新内容”只数新条目；同一正文块的增量不计数，胶囊写“有新内容 · 回到最新”。展开摘要 / 代码、复制、打开工具或引用都会先暂停跟随（避免被追加打断），返回最新后恢复。
8. **工具详情的“读取失败”与“不支持格式”**没有单独的状态 id：读取失败在 n13-tool-failed 里第二次“继续读取”出现（另附图 `deepseek-n13-tool-failed-readfail.png`）；不支持格式在执行现场的 `fixtures.export #c-0d6c` 卡片详情里，以及 n15-art-unsupported。
9. 字体回退说明同时写在 README 与本文件；因为离线原型不加载网页字体，`node-detail.css` 末尾把侧栏品牌名缩小到 13px，保证 “opencode-workflow” 在系统回退字体下一行显示（原稿 ds.css 未改）。

## 自检结果（2026-10-11）

- 60 个状态 × 4 主题（1440×900）：无 JS 错误、无 console error、无非 `file://` 请求、面板 / 阅读区 / 页头 / 控制条无横向溢出、设计样例标识可见。deepseek 另测 1280×800、1024×768：同样通过（1024 宽阅读区为 574px，左栏收窄到 180px）。
- 交互自测 25 项全部通过：跟随到底；上翻自动暂停且位置不动；切页签往返保留滚动与暂停；胶囊回到最新并恢复；历史模式无跟随开关、无当前尝试内容、只读页脚、“当前尝试有新内容”提示；阅读器宽 960 且画布 transform 不变；Esc 回到原页签；关闭阅读器后执行现场滚动恢复；←/→ 切页签；Esc 关子视图；关闭面板保留选中与视口；脱敏 chip 与复制 `"[已隐藏]"`；#1 详情无结果 / 无验收 / 无 r3；#2 绑定 r2 · 策略 v3 未通过；完成态 #2 标“已被尝试 #3 的结果 r3 替代”且无通过徽标；核对原操作 → 仍未确认；补读完成去重计数并去掉过时；晚到响应不串节点；项目切换清空。
- grep `prototype/`：无 http(s) 外链（只有 ds.css 内 data: SVG 的命名空间）、无 localStorage / sessionStorage / workflowDesktop / fetch( / XMLHttpRequest / WebSocket。
- 原稿 `/mnt/user-data/outputs/deepseek/` 未改动；复制的 ds.css、skins.css、canvas.js 与原稿逐字节一致。
- 已知限制：1024×768 时执行现场的记录区只剩约 200px 高（事实条 + 组合说明占位固定）；可读但偏挤。

## 开放问题（待 C / 后端确认，影响设计）

1. 正文是否可持久读取、保留多久——决定 N18 的“未保留”口径和历史执行现场能否回看。
2. 上游是否真的提供可展示的公开推理摘要，以及它在正文投影里的类别名。
3. OpenCode 一般工具活动是否会有完整参数 / 输出读口；目前设计按“缺能力”画（n14-no-capability）。
4. 补读是否有可重放游标与稳定片段序号；没有时只能画缺口，不能承诺补齐。
5. 工具输出的长度上限、截断规则与脱敏范围（复制 / 下载是否同一投影）。
6. 产物下载是否由宿主提供保存能力；哪些 mediaType 可预览。
7. attempt 分页大小、历史验收是否按“结果版本 + 策略版本”可查询。
8. 跟随状态是否需要跨刷新保存（目前只在内存，同一面板内一致）。
