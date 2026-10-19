# P03 原回执重放边界验证（2026-10-20）

## 设计依据

- `sources/delivery/STATES.md`：UNKNOWN 只核对原操作，不重复 prepare/push/MR/apply/delete。
- `sources/delivery/API-DESIGN-CANDIDATE.md` 第 57–63 行：原 requestKey 与请求体绑定；修改选择产生新意图与新 key；accepted → succeeded/failed/unknown。
- 项目 AGENTS.md：写操作必须有 requestKey 与回执，UNKNOWN 不自动重发。

本批将原回执的只读重放放在可变资源状态、文件系统、Git、模型配置和预览有效期检查之前。accepted、succeeded、failed、unknown 均返回原记录，不再把 accepted 当成重新执行许可。读取附带资源时资源已删除仍可返回原回执。

## 范围与实现

覆盖任务创建/草稿、计划模板采用/确认/编辑/节点决定、规划、执行控制、工作区准备/清理、交付、评审/修复、恢复、验收决定、原目录应用。`project-task.ts` 只修改 TaskService。

CommandService 校验 operation + bodyHash；新回执将工作区基线选择和远端预期纳入身份。原始规范请求体只对白名单 plan.template.use、review.start、fix.start、fix.merge 保存，用于冻结服务补齐的模板、模型和默认消息，不全局存储可能含密码的设置请求体。

旧版遗漏选择字段的哈希只允许读取原回执，不能由重放再次执行。旧 review/fix 记录未保存原模型且该模型已被删除时，无法逆推原 SHA256 请求体；此时保留 by-key 可读，不重新派发。不能声称可重建所有历史输入。

## 验证

- `npm run typecheck`：通过。
- 最终定向组合：27/27 通过，覆盖 command-replay-boundaries、directory-apply、recovery-context、review-fix-api、plan-edit-binding。
- 前一完整 `npm test`：451 项，440 通过、11 项按条件跳过、0 失败；随后新增目录应用用例由上述最终定向组合覆盖。
- 操作矩阵覆盖 26 类写操作的 succeeded/failed/accepted/unknown，在任务只读、旧计划失效、执行结束、工作区清理后仍读取原回执。
- 并发 accepted push 适配器只调用一次；unknown 不调用适配器；改变分支与跨 operation 复用 key 被拒绝。
- 原目录应用先真实写入文件，之后用户修改原文件、删除预览并清理工作区，三类重放均不覆盖用户新内容。
- 禁用/删除模型、角色变化、预览过期、资源删除不触发新模型、Git、任务或规划轮次。

这些是领域/真实本地文件与 HTTP 回归；适配器故障和并发夹具是离线控制流证据，不是实际模型或远端写入验收。

## 交接边界

Lead 负责 HTTP 包装层以及 ProjectService；PPT、knowledge、project-charter、模板目录服务由其他负责人处理。本批未修改这些文件，也未修改设计稿或前端验收脚本。

静态发现 role-catalog 新角色 save 在哈希前生成新 ID，publish/archive 也存在状态检查先于重放及 accepted 再写风险；已通知 Lead，需由对应负责人继续。template-catalog 的重放也需由 P10 负责人核对。本批不是全仓所有写入口已完成的声明。
