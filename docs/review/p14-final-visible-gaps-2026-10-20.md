# P14 可见未接通文案最终复核（2026-10-20）

基线 a5c50af；本批独立范围模板归档 UI/回执合同消费、Insights 当前质量投影与相关测试。只读设计未改。Inbox/knowledge、Roles/PPT、Lead 的规划记录不在写范围。

## 实际问题与修复

### 模板归档的陈旧回执兼容

原 TemplatesPage 声称“归档路由暂未签发回执，已按目录核对”。实际 DELETE `/api/catalog/templates/:id` 已返回 `TemplateArchiveResponse`，其 requestKey/operation/target/auditId 均真实存在。前端仍接受无回执且目录消失为成功，UNKNOWN 也只重读目录，这是陈旧实现。

现直接消费已有 TemplateArchiveResponse：成功必须匹配原 requestKey、`catalog.template.archive` 和 target.ref。缺失/错配保持 UNKNOWN；不再以模板目录缺项结算。只通过 GET operations.by-key 核对原操作；accepted/unknown 不重发。复用全局 pending-commands 的持久原请求号，关闭/刷新后重开归档仍可恢复原 key；响应身份错配时重新锁定该 key，不把其他模板/操作的回执算作当前成功。通知显示真实 succeeded/requestKey/auditId。

### Insights 历史问题污染当前质量

原 hasIssues 复用 taskQuality 的历史 open findings 汇总，会让旧执行或旧复核中的问题永久把新版本归为“存在问题”。现当前质量仅取 task.executionId 下最近一次 review 的 state/findings，且不可读 findings 不能证明通过。历史 `taskQuality()` 仍原样保留所有 review/execution 的审计问题计数；未删除、改写历史。回归覆盖同执行新复核和跨执行历史 open findings 与当前通过并存。

## 仍可见文案逐类核对

以下是对活动页源码中“未接通 / 未提供 / 不支持 / 暂未 / 占位”命中的语义逐项分类，未把普通空态误报为未实现能力。

| 位置 / 文案 | 分类与真实依据 | 本批结论 |
| --- | --- | --- |
| TaskDeliveryPanel：评审人暂未接通（非必填） | **设计明确当前不支持**。`sources/delivery/API-DESIGN-CANDIDATE.md:271` 明确 MR 输入无评审人字段（未接通 P9），449 对应 td04 的“当前未接通”；`originals/delivery/flows.html:694` 同样明确不复用 g54 多选。 | 保留不可选说明；没有新增外部平台写入。 |
| FixPanel：评审人暂未接通（非必填） | **设计明示可选候选 / 未冻结扩展**。`sources/git/API-DESIGN.md:143` 将 members.search 标可选/候选，697 把指派范围列未决问题，728 将评审人列在 P3；不能由普通任务 delivery 的不复用结论泛推 Git 修复永久禁止。 | 保留当前能力缺失说明，未把 P3 指派扩展算作实现完成；已向 Lead 报告精确边界。 |
| TemplatesPage：归档路由暂未签发 | **实际缺口 / 陈旧文案**，真实路由已签回执。 | 已修复，见上。 |
| WorkflowsPage / WorkflowEditorPage：目录/详情/检查接口未接通、只读目录快照 | **服务能力/版本失败态**。workflow-api 仅在 404 等能力缺失时回退；当前真实 workflows CRUD、validate、versions 路由已存在，正常响应不走此分支。保存/复制在 fallback 禁止而不是伪造成功。 | 保留作为错误与兼容态；非正常路径占位功能。 |
| GitOverview、RepoWorkbench、ProjectDetail、api/git：Git 能力未接入、读取接口未接通 | **明确服务错误或项目状态**。API 将 404/501/CAPABILITY_UNAVAILABLE 与断连区分，或来自 repo.gitState；当前 Git 读写端口真实实现。not_git/path_unavailable 均不是“以后再实现”。 | 保留，依真实服务状态出现。 |
| RepoWorkbench：空仓库不显示占位图谱 | **真实空态**，没有提交时显示实际未提交文件，不补示例节点。 | 保留。 |
| PlanningRecordPanel / NodeDetailPanel：运行时暂未提供公开正文 | **受管运行时真实能力边界**，由正文读取权限、实际记录及 runtime capability 判断；阶段/工具活动继续可见。没有公开正文不代表模型失败。 | 保留，未与 Lead/A 当前记录与权限修改交叉。 |
| RunContentPage：模板阅读模型未接通 | **错误/历史能力缺失态**。仅固定模板却未返回 specialized 模型时出现；正常已实现文档/源码/单测模型，不能降级通用列表伪装完成。 | 保留重新读取及真实失败说明。 |
| RunReader / RunTemplatePanes / ArtifactDetailView：历史未保留正文/报告、无文件产物、不能保存 | **版本/权限/宿主能力态**。以冻结输入与真实产物 identity、readability、宿主保存返回状态为准；二进制没有文本 diff。 | 保留，不用当前磁盘回填旧证据。 |
| TaskExtrasPanel：服务未提供进度/审查方式/深度/目标/分支 | **历史字段或真实缺失态**。仅对应字段 absent/unknown 时展示；新 P06 snapshot 与 P10 scope 冻结字段已有真实投影。 | 保留，不把普通节点数改名为快照分析范围。 |
| PE37 总览/Canvas/RefineScopeDialog：“未细化占位” | **设计领域状态**，是尚未细化的分组，不是伪造执行节点。unresolvedScopes 阻确认/执行，继续规划有真实请求。 | 保留。 |
| DraftPanel、RequirementCanvas：没有候选/检查点、尚未完成不能执行 | **真实规划中间态**，按服务候选/检查点是否存在禁用；不合成草稿。 | 保留。 |
| WorkspacePanel / StartPage：计划未确认、未登记项目、版本未核对 | **真实前置条件**，服务能力与版本核对驱动。 | 保留。 |
| DatabasesPage：模块未接通、类型未提供驱动、历史连接只读 | **服务失败/明确类型能力**。只读 `originals/main/pages/databases.html:240` 明确服务类型清单外的历史类型不能新增/修改；当前 mysql2/pg 能力和 supportedTypes 由服务返回。扩展类型驱动及草稿探针由 A 范围负责，本批未把“planned”字样当实现完成证明。 | 保留能力态；外部驱动真连接验收依对应安装和连接配置，交 A/Lead 汇总。 |
| Settings DevSection：显示示例数据不可用 | **产品约定明确禁止**，AGENTS.md §1.2 要求真实服务数据/明确未知，不得用设计 mock 成功冒充后端能力。 | 保留禁用；不会新建示例数据开关服务。 |
| Settings LimitsSection：未读取字段不可编辑 | **配置的实际生效边界**。仅展示执行路径真实读取的设置，未提供字段不可伪造可保存项。 | 保留；现有可保存项真实接通。 |
| Runtime/ModelSection/GitSection：无日志、无模型档案、尚未验证、能力未提供 | **空态/配置/受管状态**，来自 status/catalog/config/probe 实际返回，不代表静态成功画面。 | 保留；外部连接需真实配置。 |
| roles-legacy：capabilities/resourcePermissions/image 无契约 | **非本批写范围，已告知 Lead/C 复核**。新角色已支持这些字段；旧历史视图应描述“旧记录未保留”，不能泛称整个服务没有合同。 | 未交叉改 C 的角色页面；不据此宣布全页完结。 |

## 验证与边界

- 11/11 相关回归（模板原回执/重放、Insights 四阶段计量与历史质量区分、目录及项目原 key 回放）通过；全仓 typecheck、生产 build 退出 0。
- 新归档回归通过真实 HTTP 归档后取得正式回执；校验缺失、错 key/op/target 不能成功；将原操作置 UNKNOWN 后，目录确已不存在仍保持 UNKNOWN，DELETE 原 key 回放不重做。此 UNKNOWN 是明确的受控存储 fixture，不宣称真实网络丢包验收。
- 正式 Chrome CUA 在独立服务 5507/Web 5503 对明确命名的 GUI 夹具执行真实归档；页面实际显示 `succeeded`、原 requestKey、auditId，目录由 7→6。截图 `/tmp/final-gaps-template-archive.png`。
- 没有配置/发起外部 GitHub/GitLab MR；reviewer 本来就由现行设计禁选。没有真实模型调用；本批为回执、投影与真实服务 GUI 验证。
