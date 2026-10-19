# 项目配置消费者修复 · 2026-10-20

设计依据：`originals/main/pages/projects.html` 项目 Git/GitLab、文档路径与公约 none/running/ready/unknown 状态；只读设计稿未修改。

本批实现：

- 公约通过配置的 planner 模型只读检查项目，确认调用后受理异步生成；受理前保存原 key/开始时间。生成结果保存 model 来源草稿，不写项目文件；编辑保存与确认写入保持独立回执。错误不造草稿。
- 相同 key accepted 重放不再次派发；不同 key 并发、生成中编辑/写入阻止覆盖。停止请求的回执与原运行结束分开，迟到结果不会覆盖保留草稿。原会话创建未返回时先记录停止意图；尚未派发则直接保留，已派发则等待原调用结束。服务重启遗留 generating 转为 unknown，保留原身份并禁止新派发。
- 项目公约页展示能力原因、实际生成身份、开始时间、停止确认与轮询。运行时阻止普通菜单链接离开并保留浏览器关闭提示。原操作受理后失败仍按回执展示，不再声称“501未接通”。
- RemoteService 的 MR 列表/创建与保护分支查询采用项目 GitLab baseUrl/projectPath，enabled=false 停止项目 GitLab 调用；全局 token 留在本机秘密存储。继承全局仍保持原行为。连接卡明确项目 endpoint 尚未验证，账户连接事实不当作项目验证成功。
- docPaths 按设计定义为文档产出目录。新 helper `projectDocumentInstructions` 被真实节点执行 prompt 调用：配置目录用于设计/变更说明输出，空列表明确不生成此类文档；不授予额外读写许可，也不等同知识来源授权。

验证：`npm run typecheck` 通过；`node --import tsx --test tests/integration/project-config-consumers.test.ts tests/integration/charter.test.ts tests/integration/remote-git.test.ts` 12/12 通过。覆盖模型端口只读派发与相同key去重、不同key/编辑竞争、停止受理/停止错误后原调用仍运行及迟到结果保留、restart未知防重投、文档目录策略、真实本地HTTP替身接收项目GitLab路径/密钥头与停用无调用，以及既有公约写入/冲突/权限与GitHub回归。

验收边界：模型为离线受控端口，GitLab为本机HTTP替身，不是实际 provider/GitLab live PASS；未做四主题GUI/浏览器后退离开拦截验收、模型实际文档产出落盘与权限拒绝、真实GitLab写入。文档策略已进入实际执行提示，但这不能证明模型遵守该策略。生成后重启而原进程状态无法证明时保留 UNKNOWN；现有 OpenCodePort 只提供会话身份而无终态正文重读能力，尚不能自动恢复生成产物或安全解锁新轮次。这些是待补验收/契约缺口，不降为可选。

集成提示：本批 `execution.ts` 仅新增 helper import 和执行提示中的一个插值；与职业提示改动合并时保留两者。与通用回执批次合并后，应将公共 commandScope 纳入 `/api/projects/:id`，让项目配置网络结果未知也使用公共持久核对入口。

## Lead停止复审

停止回执维持accepted直到明确idle/尚未派发；生成超时且停止未确认保留UNKNOWN，持久保存session与原停止key支持重启后只读核对，不重复abort。补充abort失败+超时+重启核对测试；公约相关10项通过，typecheck通过。真实模型/GUI仍待验收。

## 普通公约生成的原会话恢复

原请求号核对现在可从已持久化 sessionId 读取实际会话状态及消息：仅 idle + 已完成 assistant 正文才生成草稿并结算原回执，不派新模型、不写 AGENTS.md。停止请求仍按原停止路径处理，旧请求号不能结算其他新轮次；核对后迟到旧正文不会覆盖用户后续编辑。公约/项目配置相关 11 项测试通过，包含服务对象重建、未停稳、正文未完成、恢复成功、迟到覆盖保护。


## 实际项目上下文与真实模型验收（Lead，2026-10-20）

复查发现旧生成提示只有项目说明与现有AGENTS.md；adapter的隔离工作目录和受控工具并未授予这个无taskId的会话读取项目的能力。因此撤回上文“只读检查项目”已获实证的含义。现在由服务先读取有界项目快照（三层/120条、16份白名单文档或构建清单、单份64KB/总128KB），保存相对路径/内容hash/限制说明，再以toolPolicy=none交给模型。隐藏目录、运行数据、依赖、符号链接不读取，不执行项目脚本；缺失内容明确未知。快照按原requestKey持久保存，恢复只读原会话，不扩大权限或重派。

同时修正全局原操作条与公约禁用原因：正常accepted显示“已受理，等待完成”，UNKNOWN才显示待核对。原key读取返回unknown时同步持久phase，避免旧accepted继续开放其他操作。

- 定向回归：context/config-consumers/command-receipts **16/16**；类型检查与Web构建通过。新测试覆盖实际清单进入提示、源码/隐藏凭据/依赖/链接不泄漏、超大/二进制未知、请求去重及accepted转unknown。
- 真实模型：`AGENT_WORKFLOW_LIVE=1 AGENT_WORKFLOW_GUI_REVIEW=1 node --import tsx --test tests/integration/project-charter-live.test.ts` **1/1，exit0**（`/tmp/aw-charter-live-r2.log`）。IAB真实点击生成→生成中→审阅草稿→独立确认写入；项目`prj_0mvfmh822ozww7lgln3`，生成key `req_0mvfmhk7qpodrpvrnuq`，写入key `req_0mvfmijjbeff3al38bx`。
- 模型准确记录Cedar Ledger、库存非负整数约定、`node --test spec/*.test.mjs`；明确未运行测试/未读取源码。package.json hash `a95492a49fff26ac5bb857e174e6ff5c68c60d23f13903f1103afb212b794819`，README hash `f03826c0dc5276480ab361251a2ab747d3fccca888439677e77f3e85bb1b9e68`。写入前AGENTS.md不存在，写入后与审阅草稿逐字相等。
- 第一次实际生成/GUI写入成功，但测试错误地读取确认后已清除的draft，断言TypeError；该失败保留于`/tmp/aw-charter-live.log`，修正为比较观察过的草稿正文后新隔离项目重跑通过。不是业务成功被测试伪造。
- 图：`docs/evidence/project-charter-live-2026-10-20/generating-accepted.png`、`draft-r2.png`、`written-r2.png`；无r2后缀的draft/confirm/written是首次流程证据。当前覆盖DeepSeek 1280×720与正常链，停止/重启/UNKNOWN由定向服务回归证明，不声称全部主题/全部异常GUI通过。
