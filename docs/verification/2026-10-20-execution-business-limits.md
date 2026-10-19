# P13 follow-up: business deadlines, task budgets and classified waits

## Implemented

Execution policy now includes total task attempts (including first dispatch), a cumulative session-error threshold, optional whole-task/attempt/design deadlines, and separate bounded exponential waits for model rate limiting, known session errors and verification failures. Policies remain frozen for the task/execution. Old policy snapshots acquire stable defaults for newly introduced controls; current settings do not overwrite existing frozen values.

Business deadlines default to off. A zero driver timeout explicitly disables its deadline timer; an independently published profession limit can still bound the session. Whole-task duration includes pauses/waits, and a design group's clock persists across its attempts. An expired total deadline uses the normal all-session stop/UNKNOWN receipt flow. An expired design budget prevents a new model dispatch. Dedicated verification timeouts remain enabled regardless of the business-timeout switch.

A classified wait is recorded only after an explicit retry command. The original request key replays the same receipt without dispatching again, even after the node selection changed. Its durable readyAt survives restart; startup parks waiting retries until explicit resume. Pause/cancel/shutdown wake the local scheduler and invalidate timers, so closing the service cannot dispatch a delayed model request after storage closes. No UNKNOWN outcome is automatically retried.

Known session errors count once per original attempt and can independently block new retries. Unknown sessions always block further claims, including when pauseAfterFailure is disabled. Reading an original execution operation can reconcile its exact original session only after an explicit idle observation; it never starts a model. A valid submitted result can then become succeeded, while missing/failed results remain failed for explicit handling.

Structured result submissions are persisted while the attempt is still running; they do not imply success. They survive restart and cannot be overwritten by another submission. UNKNOWN, failed and stopped attempt settlement retains that candidate for audit. Startup with a recorded remote session preserves UNKNOWN until read-only reconciliation. The first attempt ordinal is now 1, matching attempt-budget wording.

SessionRunner previously treated local stream closure after result.submit as sufficient to return. The driver now sends the runtime abort request and exposes its explicit stoppedConfirmed acknowledgement. Execution can settle submitted output only after idle or a positive abort acknowledgement. Missing acknowledgement stays UNKNOWN. No test fixture is promoted to actual model/runtime acceptance.

The settings UI exposes these controls, dependent business-timeout fields and three retry-wait categories. Service action reasons include exhausted task/attempt/session/deadline budgets.

## Verification

- execution-policy.test.ts (engine unit): classification/backoff caps, combined deadline computation including profession limits, and invalid configuration rejection.
- runner-timeout.test.ts: no deadline at timeout=0, positive timeout abort behavior, and positive/negative remote abort acknowledgement after result submission. These are driver fixtures, not model tests.
- integration/execution-policy.test.ts: real scheduler control flow for task budgets, enabled/disabled deadlines, design exhaustion, durable/idempotent waits, session-error counting, UNKNOWN read-only settlement, persisted result recovery after reopening SQLite, and shutdown without delayed dispatch. Ports are offline failure fixtures.
- Existing stop, recovery, acceptance and HTTP suites remain in regression. Real OpenCode model calls, native GUI timing and remote writes are not covered here.

Validation: full suite 433 tests, 422 passed, 11 gated skips, zero failures. Subsequent state-machine and workspace guard changes passed typecheck and all 34 focused tests. An additional storage ordinal regression covers first 1, consecutive 2, explicit lower bounds and unchanged historical records.
