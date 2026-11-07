# Shared-data Element grants — foundation only (2026-11-07)

Report #6911dd6f remains working. This module is deliberately NOT imported by the production server. No HTTP endpoints, UI, event stream or production database migration are activated by this slice. Independent copies remain a separate mode in FORM-SHARING.md.

## Implemented boundary

- Explicit owner offer to an exact enabled account; recipient acceptance required. No automatically copied chat, source conversation access or existing content sharing.
- Each operation checks both enabled users, current source ownership/render, grant status and code revision. Namespace comes solely from the stored source, never from client session/element IDs.
- Recipient can read/insert/update/delete rows in the selected Element database. Schema create/drop is owner-only. Generated startup create calls now return the same existing-table 409 as the owner path, using a read-only lookup. Missing/invalid tables remain denied; recipients never create schema.
- No code-edit method or ownership alias. Existing Store/HTTP edit authorization stays unchanged. The shared view strips declarative actions; linked tools/provider permissions never transfer.
- Owner withdrawal and recipient decline invalidate every subsequent operation; re-offering creates a new token and cannot revive a revoked token. Previously delivered information cannot be recalled from a recipient, as with any sharing system.
- Code hashes omit mutable state and stripped actions. Source state updates become visible on the next authorized read. Code changes fail closed until a fresh offer/acceptance; this conservative first slice does not silently execute newly changed code for recipients.
- Pending/active grants are bounded to 40 for the owner/recipient admission check. Repeated offers/acceptance are idempotent. Source deletion cascades grant rows. Revoked history is retained.
- All authorization + database operations are synchronous, with no await boundary between check and execution. A future asynchronous adapter must recheck after any wait.

## Evidence and remaining acceptance

Six isolated tests use real Store + ElementDB SQLite files and three accounts: acceptance/foreign denial/owner-only edits, shared row updates and namespace injection, immediate revocation and new-token behavior, state versus code revision, disabled/deleted source and additive initialization, quotas. The six existing copy tests also pass. Temporary fixtures are removed in finally blocks. Logs: docs/test-results/2026-11-07-element-grants-unit.txt.

The module is included in test:blueprints and test:form-sharing unit gates. These are library tests, NOT authenticated browser sharing or live synchronization evidence. Production is unchanged; no restart or rollback needed for this unexposed source slice.

Next integration must implement authenticated/rate-limited/Origin+CSRF routes; explicit offer/accept/revoke UI; integration of the bounded grant list and shared-state conflict handling; a server-owned event stream that rechecks ACL on EVERY delivery (including owner writes, code changes, disabled users and revocation); destroy/clear recipient sandbox on invalidation; and reconnect reconciliation without replaying stale data. Read-only frontend controls alone are not authorization. No shared element may enter recipient blueprint/edit/copy/action paths accidentally. Do not send source chat or provider context in stream events.

The complete existing test:blueprints gate passed (83 unit passes, one existing optional real-ping skip, two integration passes, and desktop/mobile Chromium with all unchanged assertions). test:form-sharing also passed (13 units plus the existing three-account copy browser fixture). Existing Blueprint desktop/390px screenshots were inspected; frontend bundle remains byte-identical to production. No new shared-grant UI exists yet, so this is regression coverage, not shared-mode browser acceptance.

Before exposing: three-account HTTP/browser adversarial tests, desktop/390px, reload/reconnect, owner/recipient simultaneous writes, revoke-during-request, existing saved code initialization variants, migration rehearsal preserving existing tables, full release gate, zero-active-job deployment and verified publication. This source foundation does not resolve the report.

## Shared-state/list foundation (second bounded slice)

Still not imported by server.mjs: these are library capabilities, NOT live HTTP/UI sharing. No production schema or runtime change.

- list(uid,{after,limit}) projects only grant ID, direction, status, offered title and counterparty. Pending code/state, conversation IDs and linked actions are absent. Closed/unavailable grants contain no title/peer. Maximum 40 results per cursor page; unrelated accounts receive empty pages. Refresh starts a new traversal; UUID cursors are not chronological event cursors.
- view includes a SHA256 stateRevision content token. state accepts only bounded JSON state and expectedRevision, checks ACL inside BEGIN IMMEDIATE, and compares the latest stored state before writing. A stale/missing token returns 409 plus the authorized current state; it does not overwrite. Legacy owner-state updates also invalidate the previous content token. Identical content has the same token (not a monotonic revision). Clients must reconcile explicitly; never silently retry a rejected write. Code and declarative actions are preserved, and forged message IDs/render fields are ignored.
- A recipient startup create for an already-existing table returns the owner's existing-table 409 without schema writes. Missing tables, drop, malformed names and revoked grants remain denied. This matches existing DB semantics; it does not guarantee every generated startup script handles 409 correctly. Actual saved-code browser variations remain an integration acceptance item.

Regression sources cover three accounts, paginated nonleaking projections, revoked/code-changed listing, stale owner/recipient writes, legacy owner-state writes, foreign namespaces, pending/revoked/disabled write denial, state size checks and transaction rollback, preserved code/actions, and unchanged SQLite schema for startup calls. Tests use isolated temporary databases and clean them in finally blocks. No user artifact changed.

Remaining: authenticated rate-limited CSRF routes; opt-in owner/recipient UI; owner persistence must join the shared-state conflict contract when grants are active; server-owned live stream with per-delivery authorization, invalidate on revoke/disable/code change, reconnect reconciliation; real browser and multi-connection concurrency/revocation tests; migration rehearsal and zero-job release. Library tests alone cannot resolve #6911dd6f. Row update/delete remains existing last-write semantics; no row-version conflict protection is claimed.

Second-slice verification: 17/17 focused grant/copy tests passed (including a second-recipient stale-token conflict and injected post-write failure proving transaction rollback). The full existing test:blueprints gate passed: 87 unit passes, one optional ping skip, two integration passes and all Chromium stages. test:form-sharing passed 17 units plus three-account desktop/mobile/reload copy browser checks. Its unit phase preceded the final extra atomicity test; that extra test passed in the focused rerun. Copy screenshots inspected: counter and wrapped controls visible at desktop/390px. Logs: docs/test-results/2026-11-07-element-state-{unit,release,copy-browser}.txt. No shared-mode UI or actual simultaneous-process test is claimed. Deployed and rebuilt app bundles remain identical; protected runtime, data and registrations untouched.
