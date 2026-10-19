# P07 follow-up · Reconfirmed plans control the same execution

## Design authority and confirmed defect

`opencode-workflow-design-showcase/sources/planning/DESIGN-DELTA.md` §3.5 specifies separate re-confirmation (no model/dispatch) and continuation; continuation is absent before re-confirmation. §3.6 specifies completed/running/claimed nodes and their incoming edges are locked, pending nodes use dependency forms, semantic saves require re-confirmation, and continuation restores the original mode. The existing task PlanEditPanel already follows this sequence. This patch adds no confirmation interaction or approval node.

Previously plan.editFinish confirmed a new revision but neither it nor plan.confirm changed executions.plan_revision_id. The scheduler always read that old binding, so changed dependencies and acceptance did not drive actual execution. plan.confirm also changed an editing task back to the workspace preparation stage. Edit sessions reused one ID per execution and save did not check current identity/revision.

## Implementation

Re-confirmation now validates locked attempted-node definitions and incoming dependencies, preserves their immutable attempt snapshots, atomically binds the same execution to the new revision, synchronizes never-attempted node rows and recalculates readiness from the new graph and existing acceptance. A READY node whose new predecessor is incomplete returns to PENDING through the explicit shared `node.plan.rebound` transition. Existing attempts, counts, results, workspace and frozen execution policy remain intact. New dispatches snapshot their own plan revision and node definition; missing historical snapshots are backfilled from the original bound plan before switching, without overwriting any retained snapshot.

Confirming an edit keeps the executing task stage and workspace, and leaves the execution waiting for the separate finish/continue command. Finish requires an already confirmed revision, retains the prior paused/auto-advance mode and clears obsolete terminal/pause fields when appropriate. UNKNOWN/stopping executions cannot switch plans. Replayed confirm/finish receipts do not redispatch. Each new edit receives a unique ID; save checks the ID, revision, current claim state and affected node existence. Completed nodes can be predecessors of pending nodes, while their definitions and incoming edges remain locked.

The existing dependency test had taken execution.create's old object after execution.update and consequently sent an empty editSessionId. It now reads the actual persisted session; its original cycle rejection is tested before the successful save, while the session and revision are still editable. No design or acceptance script was modified.

## Verification

New offline scheduler regressions keep A active while changing B's predecessor to C and C's title/acceptance. Re-confirmation does not dispatch; continuation settles A and actually dispatches revised C before B (the old graph would dispatch B). B stays blocked until C's new acceptance is explicitly accepted. The same execution/workspace survives; A's old definition and C's new definition retain their respective revisions across SQLite close/reopen; the original graph is unchanged. Other cases cover stale edit generations, newly claimed nodes, locked history rewrites, UNKNOWN plan switches and receipt replay.

Focused binding, pause-mode and dependency suites: 7 tests pass. Full suite: 445 tests, 434 pass, 11 gated skips, zero failures. Typecheck passes. These are offline control-flow tests using persisted state and controlled ports; they do not assert a real model/provider call or native desktop acceptance.
