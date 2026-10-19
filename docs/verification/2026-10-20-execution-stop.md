# R01 execution stop verification

Cancellation retains one request key. Replayed accepted/unknown receipts never dispatch another abort. Abort rejection or pauseTimeoutMs expiry produces UNKNOWN and preserves the in-flight node, rather than claiming it stopped. A late abort acknowledgement or explicit idle outcome reconciles the original receipt; stopped nodes/attempts become cancelled and progress.running is zero. Result submission and late completion cannot revive a stopped execution.

A stop arriving before session creation completes prevents prompt dispatch by throwing from onSessionId, which the managed adapter invokes before SessionRunner.run. The adapter now rejects an unavailable runtime and a false abort acknowledgement instead of reporting success. Normal node timeouts project the execution to UNKNOWN instead of leaving it running indefinitely.

Validation: execution-stop.test.ts (4 offline port-injection tests), execution-control.test.ts (5 HTTP integration tests), npm run typecheck. Fault injection verifies local control flow only; no real model or remote stop acceptance was performed. Unknown stop state survives in the operation ledger; across process restart no abort is automatically reissued. Runtime session reconciliation after a process restart remains limited to the existing startup recovery behavior.
