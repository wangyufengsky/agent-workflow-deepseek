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
