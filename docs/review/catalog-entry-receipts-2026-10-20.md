# 流程目录、项目登记、模板编辑原请求恢复（2026-10-20）

本批承接入口四项修复，仅覆盖 Lead 指定的 WorkflowsPage、ProjectsPage 登记、TemplateEditors 保存三个同根因入口。设计要求写入结果未知时保留原请求、锁定写操作、只按原请求核对；沿用原页面结构与现有回执契约。

## 修正

- 统一判定 timeout / unavailable / protocol 为不确定写入结果，明确 HTTP 失败不归为未知。三入口从 pendingCommands 恢复原身份，且生成新 key 之前再次检查持久身份；刷新或切换回来不会存入未发送的新 key。
- 流程目录覆盖新建/复制/归档路径，未知或 accepted 时禁用写操作并显示原 key，发送中使用发送标签；未知对话框可关闭以访问原请求核对。核对结果更新为真实 succeeded/failed 终态并刷新目录。适配器不会把 accepted/unknown 的归档回执当成成功。
- 项目登记刷新后恢复登记原 key 与参数锁，原请求核对不依赖内存请求体；原登记请求未结算时优先显示核对原因。
- 可视化与固定模板编辑器共用保存 hook 持久身份恢复、写前 guard 和协议错误未知分类。保留 existing archive 恢复逻辑。

## 验证证据

15 条针对测试通过：entry-receipts、command-receipts、workflow-catalog、template-history。故障回归对工作流新建/复制/归档、项目登记、模板更新五路径实际注入 fetch 响应丢失，验证原身份保留、第二新key未派发、按原key查询后解除；另验证 accepted/unknown 的流程三个适配器均不返回成功。属于离线客户端故障测试，不冒充模型或 GUI。

CUA Chrome 使用独立实际服务5410和受控响应截断代理5411。目录新建“目录 UNKNOWN CUA 原key”后，上游真实创建提交成功，代理才截断 JSON 回包：req_0mvfo1ikqdohbcqvutp。刷新仍显示该 key，创建/复制/归档禁用；点击页面“核对原操作”，服务返回 succeeded，同一 method.custom.unknown-cua-key-w7muu0km / version1；局部横幅更新已完成，创建恢复可用。GET operations 原始读回：operation=catalog.method.create，acceptedAt=2026-10-19T19:47:16.691Z，settledAt=19:47:16.695Z，仅一份创建。

两张正式截图：../evidence/catalog-entry-receipts-2026-10-20/ 。未调用模型。没有把临时项目/存储/代理脚本入库。

最终 typecheck、build:web、git diff --check 均通过。未跑全仓测试；项目登记和模板编辑本批未各自重复 CUA 故障验收，其恢复逻辑由针对故障测试覆盖。未扩展其他页面。
