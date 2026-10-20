# 区域 05 · 开始任务 / 流程目录 / 流程画布 — 处置记录

> 来源：`docs/review/design-audit-2026-10-20/05-start-workflows-editor.md`（31 条：P1 1 / P2 15 / P3 15）。
> 本轮负责人：Lead（task-10，P08-01 等 P1）。代码证据均在 `fix/design-audit-2026-10-20` 分支。

| ID | 状态 | 证据（文件:行） | 说明 |
|---|---|---|---|
| P08-01 | 已修复 | `apps/web/src/pages/start/StartPage.tsx`（UNKNOWN/ACCEPTED/SUBMITTING 一等态、原 requestKey 核对、表单锁定、错误文案区分）；`apps/web/src/api/pending-identity.ts`（`usePendingCommands`）；复用 `api/pending-commands.ts` 持久身份 + `GET /api/operations/:key` | 接入 `usePendingIdentity(ROUTES.tasks)`：刷新后仍锁定并显示原请求号；传输超时/断连/响应不可读经 `isUncertainCommandFailure` 进入 UNKNOWN，不再写“形成需求草稿失败/未创建任务”；「按原请求号核对」只读 `operations.by-key`，结算后展示任务/回退任务列表；提交前检查 durable pending，禁止换新 key 重投。需 GUI/断网复验（审计标注需真实服务）。 |
| P08-03 | 部分 | 同上：`locked` 驱动项目/目标/名称/流程/提交按钮禁用；`title`/`disabledReason` 给原因 | 提交中/未知/已受理三态锁定已随 P08-01 落地；错误态（project-error）表单保留属 P08-02，未做。 |
| P08-02 / P08-04..10、P09-01..11、P10-01..09 | 延后 | — | 本批仅处理 P0/P1；P2/P3 见 `p2-p3-backlog.md`，后续批次按区域报告逐条收口。 |

---

## 追加处置（task-15 · 2026-10-20 P2/P3 收口批次）

> 承接上表（P08-01 已修复 / P08-03 部分 / 其余延后）。本批按区域报告「建议」做**低成本、可静态验证**的 P2/P3：数据诚实/失败态/空态、职业显示、list 态、加载态、死代码接线、保存态图标；需 GUI 或较大结构调整的条目记录为延后并写明原因。设计稿目录未改；未改 `docs/api.md`。

| ID | 状态 | 证据（文件:行） | 说明 |
|---|---|---|---|
| P09-01 | **已修复** | `apps/web/src/pages/workflows/WorkflowsPage.tsx`（`detailClosed` 状态 + 详情卡关闭按钮 `关闭详情，回到流程列表` + `wf-layout nodetail`）；`workflows.css`（`.wf-layout` 固定 400px 详情列、`.nodetail` 单列） | 详情可关闭回到设计 `list` 全宽列表态；再次点目录行重新打开；详情列按设计固定 400px（窄屏仍退化为单列）。像素观感需 GUI 复核。 |
| P09-02 | **已修复** | `WorkflowsPage.tsx`（`listBody` 首分支改为 `listQuery.isLoading`，不再依赖 `bootstrap.isLoading`） | 修复从其它页（bootstrap 已缓存）进入时误显示「目录里还没有流程」空态：loading > error > empty 优先级恢复；骨架只在目录加载期间出现。 |
| P09-03 | **部分** | `WorkflowsPage.tsx`（`filtered` 按 `updatedAt` 降序排序、列表脚注「已加载 N 个 · 按更新时间排列（服务一次返回全部；暂无「加载更多」）」）；服务契约 `packages/server/src/http.ts` `/api/workflows` 无分页参数（C1） | 已补设计要求的「按更新时间排序 + 已加载计数」最小对齐；`more-error`/「加载更多」需要服务 cursor/limit 契约（C1），当前如实写明一次返回全部，不伪造分页。 |
| P09-04 | **已修复** | `WorkflowsPage.tsx`（`StepChain` 使用 `workflow-model.ts:stepChainGroups` 分组渲染；同组多步渲染为「并行 · 组名」块并 `split` 图标）；`workflows.css`（`.wf-chain-par` 并排网格） | 死代码 `stepChainGroups` 已接线：同组连续步骤并排展示并标「并行」，序号跨组连续。平面流程仍保持顺序行。 |
| P09-05 | **已修复** | `WorkflowsPage.tsx`（`stepRole()`：`roleId` → bootstrap 角色名；无绑定按步骤类型回退 test→测试工程师 / verify→代码审查员 / 其余→开发工程师，文案「（按步骤类型默认）」，不再 warn；未知 roleId 标「（职业未登记）」并 `Badge outline 默认职业`）；角色来源 `bootstrap.data.catalog.roles`（回退 `DEFAULT_ROLES`） | 内置流程不再每步显示黄色「未指定职业」警告；自定义步骤不再外露 `role.developer` 之类内部 id，改显示可读职业名（名称来自服务/默认目录），职业来源与回退规则在文案中写明。 |
| P09-06 | **部分** | `WorkflowsPage.tsx`（`submitCreate` 成功后 `navigate(/workflows/:id/edit)`） | 「创建并编辑」不再停留目录，按钮承诺成立。**未达**：设计「直接进入空画布（未命名流程 · 尚未保存）」仍受服务创建校验限制（至少含交付/验收步骤，C1），空草稿态不可达；保留先创建后编辑路径并在本表记录 C9 缺口。 |
| P09-08 | **部分** | `WorkflowsPage.tsx`（按更新时间排序 + 脚注计数，见 P09-03）；行徽标/meta/页面宽度/搜索宽度/额外归档筛选 | 排序与计数已对齐；行内徽标/meta 字段、页面与搜索宽度属视觉细节（需 GUI 四主题对比），本批未做，记为部分。 |
| P08-06 | **已修复** | `apps/web/src/pages/start/StartPage.tsx`（错误横幅按 `STALE_TARGET`/`CONFLICT` 区分标题「流程版本已变化，草稿未创建」+「重新读取当前版本」按钮：`methodQuery.refetch()`，读取中禁用并给原因） | 版本过期后可在页内闭环恢复，不再只能刷新整页；重新读取前按钮进入读取中禁用态。错误文案不再把「服务未连接」写成「未创建任务」的确定性断言。需真实服务制造版本过期复验。 |
| P10-05 | **已修复** | `apps/web/src/pages/workflows/WorkflowEditorPage.tsx`（保存态渲染为 图标+文字：check 已保存 / edit N 处未保存修改 / refresh 正在保存 / help 保存结果未明 / clock 保存已受理 / alert 版本已变化；「检查」问题数改为 `Badge tone="fail"`） | 保存态与检查数改为「文字 + 图标 + 徽标」，符合设计 `.save-state` 五阶段与 `.badge` 层级；四主题对比需 GUI 复核。 |
| P08-02 | 延后 | — | project-error 需把整页 `ServiceNotice` 改为项目段内错误并保留已填目标（C2/C4），属结构性改动；本批时间盒内未做，后续按报告建议处理。 |
| P08-04 / P08-05 | 延后 | — | 方法卡默认可见性/模板型方法混入「全部流程」需产品口径与目录契约（C1/C9）；未在无口径下改默认行为。 |
| P08-07 / P08-08 / P08-09 / P08-10 | 延后 | — | 抽屉底部入口/局部视觉/页头文案属于需 GUI 与 supplement-v5 裁决的细节（P08-09 为设计冲突 C9）；accepted/handoff-error 动作差异需产品确认回执页口径。 |
| P09-07 / P09-09 / P09-10 / P09-11 | 延后 | — | 规划只读节「返回需求画布」与最近使用语义（C1）、复制/归档对话框文案与 alertdialog/焦点（GUI/可访问性）、未确认复制对象点名（需 copy 目标身份投影）、ARIA listbox 改造——均为 P3/需 GUI，本批未做。 |
| P10-01 / P10-04 | 延后 | — | 整页 `canvas-page` + 内联 480 侧栏 / 左侧 400 模板抽屉属画布骨架大改，需 GUI 与回归；本批仅静态评估，不在时间盒内实施（C4/C7）。 |
| P10-02 / P10-03 | 延后 | — | 空画布引导依赖空草稿创建（同 P09-06 C1）；「人工」职责需方法/角色契约支持（C1）。 |
| P10-06 / P10-07 / P10-08 / P10-09 / P10-10 | 延后 | — | 画布 tip/计数浮层、系统节点可移动与提示、步骤高级设置契约字段、只读工具栏收敛、检查浮层层级与焦点——均为较大结构或契约/GUI 项，本批未做并在 `p2-p3-backlog.md` 继续跟踪。 |

### 验证（本批）

- `npm run typecheck`：本次改动文件 0 错误（收尾复跑；全仓状态由 Lead 统一门禁复核）。
- 静态验证已核对的映射：`roleId` 解析（含 `method-catalog.ts` 绑定与 `graph.ts` 默认回退）、`/api/workflows` 无分页参数、`stepChainGroups` 原死代码签名、`STALE_TARGET` 服务错误码（`packages/engine/src/project-task.ts`）。
- 需 GUI/真实服务复验（未声称通过）：关闭详情全宽布局与 400px、并行块四主题观感、保存态图标、版本过期重新读取闭环、创建后跳转编辑器。
