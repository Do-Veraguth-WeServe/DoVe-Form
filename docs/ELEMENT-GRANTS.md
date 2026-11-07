# Shared-data Element grants — foundation only (2026-11-07)

Report #6911dd6f remains working. This module is deliberately NOT imported by the production server. No HTTP endpoints, UI, event stream or production database migration are activated by this slice. Independent copies remain a separate mode in FORM-SHARING.md.

## Implemented boundary

- Explicit owner offer to an exact enabled account; recipient acceptance required. No automatically copied chat, source conversation access or existing content sharing.
- Each operation checks both enabled users, current source ownership/render, grant status and code revision. Namespace comes solely from the stored source, never from client session/element IDs.
- Recipient can read/insert/update/delete rows in the selected Element database. Schema create/drop is owner-only. Generated startup create calls need a safe existing-table compatibility response in the future adapter; do not simply relax this boundary.
- No code-edit method or ownership alias. Existing Store/HTTP edit authorization stays unchanged. The shared view strips declarative actions; linked tools/provider permissions never transfer.
- Owner withdrawal and recipient decline invalidate every subsequent operation; re-offering creates a new token and cannot revive a revoked token. Previously delivered information cannot be recalled from a recipient, as with any sharing system.
- Code hashes omit mutable state and stripped actions. Source state updates become visible on the next authorized read. Code changes fail closed until a fresh offer/acceptance; this conservative first slice does not silently execute newly changed code for recipients.
- Pending/active grants are bounded to 40 for the owner/recipient admission check. Repeated offers/acceptance are idempotent. Source deletion cascades grant rows. Revoked history is retained.
- All authorization + database operations are synchronous, with no await boundary between check and execution. A future asynchronous adapter must recheck after any wait.

## Evidence and remaining acceptance

Six isolated tests use real Store + ElementDB SQLite files and three accounts: acceptance/foreign denial/owner-only edits, shared row updates and namespace injection, immediate revocation and new-token behavior, state versus code revision, disabled/deleted source and additive initialization, quotas. The six existing copy tests also pass. Temporary fixtures are removed in finally blocks. Logs: docs/test-results/2026-11-07-element-grants-unit.txt.

The module is included in test:blueprints and test:form-sharing unit gates. These are library tests, NOT authenticated browser sharing or live synchronization evidence. Production is unchanged; no restart or rollback needed for this unexposed source slice.

Next integration must implement authenticated/rate-limited/Origin+CSRF routes; bounded grant list; explicit offer/accept/revoke UI; shared-state conflict handling; a server-owned event stream that rechecks ACL on EVERY delivery (including owner writes, code changes, disabled users and revocation); destroy/clear recipient sandbox on invalidation; and reconnect reconciliation without replaying stale data. Read-only frontend controls alone are not authorization. No shared element may enter recipient blueprint/edit/copy/action paths accidentally. Do not send source chat or provider context in stream events.

The complete existing test:blueprints gate passed (83 unit passes, one existing optional real-ping skip, two integration passes, and desktop/mobile Chromium with all unchanged assertions). test:form-sharing also passed (13 units plus the existing three-account copy browser fixture). Existing Blueprint desktop/390px screenshots were inspected; frontend bundle remains byte-identical to production. No new shared-grant UI exists yet, so this is regression coverage, not shared-mode browser acceptance.

Before exposing: three-account HTTP/browser adversarial tests, desktop/390px, reload/reconnect, owner/recipient simultaneous writes, revoke-during-request, existing saved code initialization variants, migration rehearsal preserving existing tables, full release gate, zero-active-job deployment and verified publication. This source foundation does not resolve the report.
