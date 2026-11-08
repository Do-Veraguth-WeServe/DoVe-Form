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


## Same-state owner code snapshot — source only, 2026-11-08

The source browser queue carries expectedCodeRevision: a second SHA256 content token over its original code snapshot, including declarative actions but excluding state. The server compares it inside the owner-save transaction before state or full-render writes. A stale mounted sandbox/editor therefore cannot overwrite newer code/actions merely because state is identical. Shared owner-code.mjs sorts object keys, including action arguments, while preserving array order. A first browser run exposed differing field insertion order between client/server; canonical serialization fixed it without relaxing conflict checks.

The queue freezes the initial code snapshot, retains it through state writes and advances only after a full replacement with matching server acknowledgement. Missing/wrong acknowledgement blocks the queue and reconciles; no automatic retry. These are content hashes, not monotonic revisions: exact change-and-revert is indistinguishable.

Compatibility boundary: the code token remains opt-in at the owner endpoint; every current source browser queue sends it. Legacy clients omitting it retain the state-only contract. BEFORE shared-mode release, require code tokens for grant-era owner requests and test old clients fail closed, including invalidated old-code grants. This slice does not close that gate or establish universal stale-owner protection. Recipient ACL, grant scope and plan/build approval are unchanged.

Baseline: two isolated same-state HTML/actions changes returned200 instead of required409. Focused units now cover state/full replacement rejection, fresh snapshot success, immutable queue snapshot, acknowledgement progression and failure without replay. Chromium additionally changes code/actions behind the mounted sandbox, requiring409, unchanged stored render and authorized reload, alongside existing desktop/390px state/editor/offline tests. Disposable accounts/data only; no user product repaired. Logs: docs/test-results/2026-11-08-owner-code-{before,unit,browser,release}.txt.

Not deployed. #6911dd6f remains working; UI/live per-delivery ACL/invalidation/reconnect/startup/migration and zero-job rollout gates remain. #e89344ad remains open with its recorded missing-artifact blocker. Production jobs read returned zero; no restart/migration occurred. Final gate result and exact hashes are appended after collection.

Verification: 31 focused tests passed. Full test:blueprints exited0: 114 unit passes, one optional ping skip, real grant HTTP, strengthened owner browser, two integrations and all Chromium stages including Calendar/Flappy. Desktop/390px owner screenshots inspected. Exact source/test/bundle hashes: docs/test-results/2026-11-08-owner-code-sha256.txt. Production bundle remains separate; documentation only is synchronized, with no runtime/schema/data deployment.


## Grant-era fail-closed owner saves — source only (2026-11-08)

Supersedes the earlier optional-token compatibility boundary. Once an Element has ANY grant history, both state and owner-code content tokens are mandatory on owner state/full-render saves. Pending, active, revoked, declined and invalidated-code grants all keep this boundary: closing a grant or changing code cannot make an already-mounted legacy client safe again. Never-offered private Elements retain tokenless compatibility; supplied tokens are still validated. This is conservative reload-required compatibility, not automatic sharing. Owner editing remains available with fresh matching snapshots, and recipient rights do not change.

Five isolated baseline variants reproduced legacy writes returning200 rather than409. Regression covers omitted, state-only, code-only and null code tokens on state/full-render writes; unchanged stored renders on rejection; fresh owner success. Existing atomic version history and separate-process exclusion assertions remain. The real HTTP fixture additionally rejects state-only clients and old-code saves after close, then proves a fresh owner save succeeds. Its initial run caught a fixture assuming a closed-grant legacy write had saved n=6; the final fixture explicitly performs that write with current tokens, preserving the logout-during-upload assertion unchanged.

36 focused tests passed. Full release gate and final hashes are recorded after completion below. No runtime/schema/data deployment or restart; sharing #6911dd6f remains working. The remaining opt-in UI, per-delivery session/ACL live synchronization, sandbox invalidation/reconnect, saved startup variations, three-account desktop/mobile acceptance, additive migration rehearsal and zero-job release gates remain mandatory. Source-slice publication is not a shipped sharing feature.

Resumed verification: all three saved source/test SHA256 values match. The prior retained broad log has 119 unit passes, one optional ping skip, two integration passes and all HTTP/Chromium stages through Calendar/Flappy; its process result was no longer retained. Therefore an unchanged full rerun now records an explicit EXIT_CODE in grant-era-release-confirmed.txt rather than inferring process success from log text. Desktop/390px owner conflict screenshots inspected. Production has no active jobs and remains unchanged; the only unresolved reports are #6911dd6f (working) and #e89344ad (open).

Confirmed unchanged full rerun exited0 (persisted EXIT_CODE=0): 119 unit passes, one optional ping skip, real grant HTTP, owner desktop/mobile conflict/browser checks, two integrations, and all remaining Chromium stages including Calendar/Flappy. No assertion or tolerance was weakened. Source/test hashes remain unchanged. This is source-only safety work, not deployed sharing; documentation alone is synchronized to production.
