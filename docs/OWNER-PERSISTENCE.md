# Owner persistence integration — source only, 2026-11-08

Part of #6911dd6f. **Not deployed; shared-data sharing remains incomplete.** Do not release the staged backend/bundle until the remaining ELEMENT-GRANTS.md gates pass. Production data, schema, runtime and registration are unchanged.

## This slice

Owner sandbox saves now carry the SHA256 token of the last acknowledged JSON state. A bounded (32 pending) per-message-snapshot queue serializes writes and snapshots caller input; queued full-render writes use the same contract. No conflict/network/error write is automatically retried. Uncertain or rejected saves stop that queue, destroy the failed sandbox and reload authorized server data. If reconciliation fails, the Element stays frozen behind a reload notice rather than pretending it saved. Fresh server snapshots/logout stop old queues, including checks after async hashing/transport. The hidden feed's workers are stopped while the overlay is open, including feed re-renders, to avoid two simultaneously editable sandbox instances.

Code-editor and version-restore changes wait for HTTP success and valid confirmation before changing the local render/version list or announcing success. A stale editor cannot silently overwrite a recipient state update. This does not solve stale code with identical state: code-revision tokens and approved background refinements still require review before sharing exposure. The queue is not a durable offline outbox; closing/reloading a page may discard unconfirmed queued changes, and refresh races may force explicit retry. No uncertain writes are blindly replayed.

No new opt-in grant UI or live event stream is included. Existing server ACL and explicit Plan/build approval remain unchanged. Custom Forms use their existing separate state path.

## Evidence

- Nine isolated queue tests: acknowledged token progression, immutable queued payloads, full-render ordering, 409/401/403/503, transport failure, malformed success, stopped snapshots and overload. No request flood/retry after failure.
- Real source HTTP grant regression passes (three accounts, CSRF/Origin/ACL, owner/recipient CAS, logout-during-upload, revocation, lock recovery).
- Real Chromium fixture uses disposable accounts and an explicitly activated grant. Desktop/390px owner saves/reload, recipient-write conflict with unchanged server state, stale editor rejection, confirmed full replacement, and 503 plus failed reconciliation freezing the sandbox. Screenshots inspected; synthetic counter only, not a user's product.
- Baseline serves the unchanged deployed app bundle against the new isolated backend: owner save returns409 rather than200 because its client sends no token. Earlier baseline logged a timeout awaiting200; the strengthened baseline records the exact status mismatch.
- Logs: docs/test-results/2026-11-08-owner-client-*.txt. Full gate result and exact hashes must be checked before publication; passing isolated tests is not production delivery.

## Release-gate checkpoint

The first broad gate passed before the final overload/frozen-sandbox additions. The exact-final-source gate passed 103 units (one optional ping skip), grant HTTP, owner browser including offline freeze, both integrations and preceding Chromium stages, then hit the existing immediate Flappy reset assertion (135.75 versus155). No test or tolerance was changed. The failure log is retained; an unchanged full rerun is recorded separately. No production rollout is authorized by a partial gate.

Final unchanged full rerun exited0: 103 unit passes, one optional skip, grant HTTP, owner desktop/mobile/offline browser, both integrations and all remaining Chromium tests including Calendar/Flappy. Exact source/test/bundle hashes are retained in owner-client-sha256.txt. The staged bundle is f270ddb245fc56e1d9df88be8d8d14ee882497e36945c0fefee1f749f17c48ef; live bundle remains 6ba6b6c8b4b2177db4d582ea263179affdb627621585d5684fb4f5202d74d58d. Production grant table is absent; no restart/migration occurred. Documentation only is synchronized to production.

## Next

Explicit offer/accept/close UI and shared recipient view; per-delivery session/ACL-checked events; invalidation on revocation, disable, deletion and code change; reconnect reconciliation; same-state stale-code protection and background-refinement CAS review; three-account browser acceptance and saved-code startup variations; additive migration rehearsal; zero-job safe rollout with code-only rollback. #6911dd6f remains working; no all-issues-complete claim.
