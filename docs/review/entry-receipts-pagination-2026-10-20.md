# 入口命令身份与任务分页验收（2026-10-20）

本批只处理 Templates、WorkflowEditor 的 UNKNOWN 原请求恢复，以及 Home/Tasks 服务端筛选分页。设计依据：main templates 参数锁定与未知原请求核对（templates.html:108）、workflow-editor 未知只读与核对（:82/:100/:104）、home 进行中卡（:85）、tasks 搜索和加载更多（:104/:111）。设计目录只读。

## 实现

- Templates 与 WorkflowEditor 从 pendingCommands 恢复精确路径的原 requestKey，写前检查已有身份，protocol 包装的断网/截断也保持未知锁。刷新后继续原 key 核对，不生成新写入；accepted/unknown 回执不会被保存适配器当成成功版本。Workflow 刷新工具栏也显示“保存结果未明”。
- TaskListPage 契约增加 q/group/ongoing 与游标分页和范围计数。服务端先筛选排序，再按 limit 返回；Home 请求 ongoing+limit3；Tasks 每页50，搜索、项目与分组均交给服务，保持服务端总数，下一页失败保留已读行并允许重试。

## 验证

21 条针对测试全部通过（task-list-pagination、entry-receipts、command-receipts、task-catalog-parity、workflow-catalog、workflow-editor-graph、template-history）；typecheck 与 build:web 均退出0；git diff --check通过。未运行全仓测试，由Lead整合后执行。

真实HTTP测试创建225个较新结束任务与1个旧进行中任务：首次50行不含旧任务，但 ongoing 返回唯一旧任务；q 在服务端找到第200条之外的任务；闭合任务225条分页无重无漏，非法cursor返回400。测试使用真实HTTP和存储，非模型结果。

CUA Chrome 操作使用独立5410实际服务与5411受控截断代理、公开临时Git项目。初始226任务时Home显示唯一旧进行中；Tasks实际点击加载更多依次50→100→150→200→226。模板创建后总数227，又截图读回50→100/227。输入oldneedle后服务端计数与列表均为1/1，命中旧任务。分页尾部226的AX已读回，正式截图保存100/227及旧任务搜索，不把截图未捕获的尾部状态冒充截图证据。

Templates实际创建请求 req_0mvfnpbw27cdijlaxia 已被服务处理，代理随后截断回包：界面未知、刷新仍原key锁定、核对只返回 task_0mvfnpc1ods6tptbmgi 一份任务。Workflow最终实际保存 req_0mvfnx5t7mp2mh0s9pu 同样回包截断；刷新显示“保存结果未明”，名称/画布/保存均锁定，原key核对得到版本4，仅一次版本增量。此前版本3试验后发现工具栏误显已保存并已修复，正式证据使用最终版本4试验。

图位于 ../evidence/entry-receipts-2026-10-20/ 。template-refresh-locked截图中的参数缺失提示拍于最终禁用原因优先级文案微调前；原key/锁定行为相同，不以其证明最终提示文案。没有调用模型，没有把状态夹具标作实际模型执行；临时数据、代理和启动脚本不入库。

## 边界

本批未修改全局pending/runtime、模型、网络或项目详情验收投影。WorkflowsPage/ProjectsPage/TemplateEditors同根因三个入口由Lead另行指派下一批，本提交不包含。全仓集成与跨主题本批未重新执行。
