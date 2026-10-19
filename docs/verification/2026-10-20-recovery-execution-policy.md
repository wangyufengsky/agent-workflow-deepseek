# P13 recovery context and execution policy

## Implemented behavior

- Writable recovery copies the frozen plan into an unconfirmed revision. `from_failed_stage` keeps failed/incomplete nodes and their descendants; earlier successful, accepted stages remain read-only source evidence in the requirement supplement. `all_stages` copies the complete frozen graph. No recovery creation dispatches a model, and explicit plan confirmation remains mandatory.
- A settled source workspace is snapshotted into a new branch/path. Git recovery retains uncommitted files and deletions without copying `.git`; directory recovery retains both the original baseline and the partial output for three-way apply. Parent task/attempt records and parent files are never rebound to the derived task. Unknown sessions, missing baselines and symbolic links are rejected. File hashes are checked before/after snapshotting; failed partial workspaces and lineage remain available for audit.
- Execution settings freeze at task creation and plan confirmation, persist across restart, and follow the parent policy during recovery. Legacy executions freeze on first use. Explicit node retries include the first dispatch in `maxAttempts`; exhausted nodes require a new recovery task. There is no automatic model redispatch.
- `maxConcurrentNodes` bounds dispatch. Only nodes whose frozen role permissions prove they are read-only, with no shell/write tools, may share a task workspace. A writer exclusively owns the whole workspace; declarations of disjoint files alone are insufficient proof. Dependency joins and human acceptance gates remain mandatory.
- `pauseAfterFailure` blocks new claims after a failure while already active sessions settle. When disabled, independent branches can complete; successors of failed nodes cannot run. User pause/resume retains original active attempts. Stop covers every active attempt/session and remains UNKNOWN until all are confirmed. Stale attempts cannot settle a new generation.
- Node timeout, stop-confirmation timeout and verification-command timeout use the frozen execution policy. Independent fix verification also freezes its command timeout; an internal caller cannot enlarge the configured verification limit. Resume/retry clear old endedAt/pause markers through explicit nullable storage patches.
- The settings/recovery UI consumes service-provided retry availability and reasons, exposes only implemented execution controls and describes copied plans instead of promising a new planning pass.

## Evidence

`execution-policy.test.ts`: bounded parallel readers, exclusive writer execution, joins, all-session stop with one rejection, retry cap/frozen settings, independent branch behavior, pause/resume, and frozen node timeout. These are offline port-injection control-flow tests, not model acceptance.

`recovery-context.test.ts`: real local Git worktrees, uncommitted output/deletions, preserved parent/original files, frozen frontier/role configuration, original-policy inheritance, independent all-stage baseline, directory baseline preservation, UNKNOWN rejection, symbolic-link refusal and preservation of failed partial lineage. These are filesystem/Git acceptance tests, not remote Git or model tests.

`fix.test.ts`: a real local child process exceeds the dedicated 40ms verification limit while Git timeout is 10 seconds; the authoritative verification records an error. Existing recovery-mode, acceptance, stopping and HTTP tests are also exercised. Full `npm test`: 419 tests, 408 passed, 11 gated live/credential tests skipped, 0 failed. The final focused regression run passed 15 tests; `npm run typecheck` and `git diff --check` also passed. No real model, native GUI, or remote write acceptance is claimed.

## Remaining design work

The design's optional total-task/attempt/design deadlines, whole-task attempt budget, session-error threshold and classified waits are implemented in the subsequent business-limits patch; see 2026-10-20-execution-business-limits.md. Real OpenCode parallel execution and native GUI verification remain outstanding.
