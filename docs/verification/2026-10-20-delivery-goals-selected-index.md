# 交付补充稿：目标完成点与确认文件范围修复

基线：`03d70a5`。范围只涉及任务交付服务、Git commit 适配、对应交付说明及定向回归；不修改只读设计、模型执行、角色、PPT、知识或交付 HTTP 写包装。

## 设计依据与实现

- `opencode-workflow-design-showcase/sources/delivery/DESIGN-DELTA.md:258–265`：本地提交、推送分支、创建 MR 分别在所选目标完成时交付；未选文件保留。`originals/delivery/assets/td-desc-git.js:14` 与 `td-states.js:46` 对应本地提交完成态。
- `local_commit` 在真实 commit 返回 SHA 后写 `delivered` / `commit:<sha>`；`push_branch` 在真实 push 成功后写 `delivered` / 远端 ref+SHA。MR 目标在 commit/push 后仍等待独立确认，沿用原 MR 成功完成点。任务生命周期同步 completed，验证结论沿用已有事实，缺省 `not_run`，不把提交成功当作测试通过。
- Git 使用 literal pathspec、确认路径的 whole-file `commit --only`。只有同一已确认 rename 条目会展开 oldPath 删除与新 path；不加入其他暂存文件。已暂存 rename 的旧路径不再重复 add。
- 提交前保存所选路径 index stage0；冲突多 stage 在写前拒绝。确定失败且 HEAD 未变时只恢复所选 index 条目（包含原不存在条目），不重置整个 index、不回滚 hook 或用户的工作区内容。HEAD 已变化或暂存恢复失败保留 UNKNOWN，要求核对原 key。
- commit 的 changes/revision/空选择检查及 push 的非 Git 检查纳入 accepted 后的 catch→failed；原请求 replay 仍首先执行，避免 accepted 永久悬挂。
- 预览与步骤说明按本地目标显示“提交成功即完成”，其他目标仍独立确认后续步骤。

## 分层证据

H / 本地真实 Git：以下组合 18/18，含真实 SQLite/HTTP、Git CLI、临时 worktree 与本地 bare remote。命令：

```sh
node --import tsx --test tests/integration/delivery-selected-commit.test.ts tests/integration/delivery-goals.test.ts tests/integration/delivery-fixroot.test.ts tests/integration/remote-unknown-settlement.test.ts tests/integration/git-api.test.ts tests/integration/git-push.test.ts
npm run typecheck
```

- 所选修改与新增 literal 文件提交；未选 staged 内容与随后 unstaged 内容保留。
- rename/delete、服务端单个 rename fileId 展开、未选 staged 文件保留。
- 拒绝 hook 后 HEAD 不变、所选原 staged 内容及原未跟踪状态恢复；所选冲突多 stage 拒绝且全 index 不变。
- 三种目标分别检查 commit/push 完成投影，实际 bare 远端 ref=所确认 SHA；MR 目标仍等待，未调用外部 MR。
- stale revision、空选择、非 Git push 的操作记录 failed；原 key replay 返回原失败。
- 原有真实 merge/CAS、Git 读取、push non-fast-forward、远端 UNKNOWN 回归继续通过。

G / Chrome CUA：真实服务 5547 + Web 5543，选“仅本地提交”→保存目标→预览→确认提交，界面显示“任务已交付”“本地提交目标已完成”、真实 commit SHA 与“未运行验证”；刷新后仍保持完成。截图 `/tmp/delivery-local-complete.png`，无凭据。该任务的代码文件是本地 fixture；未运行其模型执行节点，不将画布计数作为模型证据。

M / 外部：本批没有真实外部 push、MR 创建或真实模型调用。MR 外部完成态、网络 UNKNOWN 全部 GUI、四主题与全部尺寸不在本批验收结论内。没有重复全仓测试。
