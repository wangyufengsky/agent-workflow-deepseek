# P04 知识对话历史与真实待答闭环

设计依据：只读权威 `opencode-workflow-design-showcase/originals/main/pages/knowledge-history.html` 的需要回答、进行中、已完成、去回答、重命名及可恢复归档；不改设计或既有验收脚本。

## 实现

- 新增独立 conversation 元数据服务：名称、版本、归档时间、实际请求索引。标题变更不改原问题、回答、引用或冻结输入。历史按真实 conversation 聚合，状态取当前运行与绑定的真实原生问题；没有运行问题时不生成假 needs_answer。
- 新增 conversation 读取和 rename/archive/restore HTTP 契约，写操作分别持有 requestKey、原子持久化标记和回执。重放先于状态/版本检查；UNKNOWN 只用 operations.by-key 查持久提交证明，不重做。运行、停止中、未知和待答阻止归档；归档禁止追问，恢复保留同一模型/项目上下文。
- 新问答的持久请求索引可读取超过旧30条窗口的已保留结果；已有旧数据只能展示实际仍保留的记录，不承诺找回已被旧窗口丢弃的正文。
- 知识请求增加 questions_only 策略：仅允许原生 question，无文件、命令或内部MCP额外授权。问题绑定 project/conversation/request/session，无虚构 task/node。待答进入真实 Inbox；回答失败/未知沿用原生交互的只读核对；来源许可撤回后隐藏问题正文和结果。明确完成或确认停止才关闭未发送问题，不能据此猜测 UNKNOWN 写成功。
- 历史页接真实状态、名称、归档、恢复；保留原问答/引用。知识页提供真实待答入口、固定已有模型和项目、阻止归档追问。持久路由保留 conversation/request 身份，刷新可回原对话。

## 自动验证

- 新 `knowledge-conversations.test.ts`：8/8，真实SQLite/文件/HTTP，显式离线运行端口。覆盖元数据重放、accepted/UNKNOWN只读核对、旧版本、归档追问阻止、跨项目、真实事件形状绑定、未知答复不得重发、许可撤回遮蔽（含已完成结果的工具/步骤证据副本）、停止关闭未答、questions_only禁止MCP、33轮持久请求索引重建。它证明离线控制流，不冒充真实模型。
- 知识/权限/来源/路由/原生交互既有定向回归34/34；新增及steps最终定向21/21（其中会话回归8/8）。
- 最终全仓测试595项：581通过、14跳过、0失败。前一轮593项有一项既有 `ppt-studio-layout.test.ts:67` 标题断言偶发失败（“第二页”与“待制作二”）；本批未修改PPT，最终完整复跑该项及全仓均通过。
- 最终 typecheck、build 通过；diff检查通过。

## 实际模型与 GUI 证据

`knowledge-history-live.test.ts` 走受管OpenCode1.19、配置的 `opencode-go/deepseek-v4.1-flash`，临时公开README/RULES文本，不使用生产项目或凭据，不合成模型事件。命令：`AGENT_WORKFLOW_LIVE=1 AGENT_WORKFLOW_GUI_REVIEW=1 node --import tsx --test tests/integration/knowledge-history-live.test.ts`。本轮1/1通过，耗时约183秒；该实际测试不在默认离线通过数中。

1. 实际模型先提出多选原生 question，历史真实显示需要回答1。GUI由“去回答”进入Inbox，选择Markdown、HTML，补充PDF，正式提交得到 succeeded；待答清零。
2. 同原OpenCode session继续完成第一轮，19190 tokens，README三处真实行号引用，复述Markdown/HTML/PDF。
3. GUI从历史打开同一 conversation 追问 requestKey/UNKNOWN，第二轮9563 tokens，RULES第2/3行引用；同conversation已保留2轮。第二轮沿既有架构启动独立OpenCode session，不宣称两轮共用同一运行时session。
4. 测试完成自动关闭服务，故 `followup-answer-citations.png` 包含关闭后的连接提示；独立测试日志已在关闭前核对成功。随后用同持久数据重新启动只读审阅服务（不启动模型），GUI重命名、归档、恢复，记录仍保留两轮，点开原文并核对行号。刷新后conversation/request身份与冻结模型仍保留；运行环境未启动时追问按钮明确禁用。

证据图位于 `docs/evidence/knowledge-history-live-2026-10-20/`：历史待答、原生问题草稿/成功回执、第一轮正文引用、第二轮结果、归档保存、恢复后原文。截图仅临时公开文档，不包含真实凭据。

边界：没有将端口夹具当模型证明；没有声称归档/恢复启用了模型运行；历史元数据操作不扩张读取范围。原有知识单次运行120秒截止仍适用，长时间人工等待会按真实超时/停止状态结束，不伪造继续成功。
