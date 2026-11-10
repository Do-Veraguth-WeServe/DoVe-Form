# Owner live synchronization — #ca705d41

## Source checkpoint, 2026-11-10 — NOT deployed

Reproduced the reported missing recipient-to-owner update with isolated synthetic accounts against the deployed application modules. The recipient's authorized shared state write reaches SQLite, but the owner's ordinary feed and full-screen Element remain at their previous values after 2.5 seconds, at desktop1280 and mobile390. The shared dialog has its own working stream; ownerView currently only mounts renderUI and has no remote subscription. No user's product or data was changed.

Implemented the bounded backend transport needed for ordinary owner views:

- GET /api/elements/owner/stream?id=... accepts 1–12 distinct owned message ids and emits only id/state/code/DB revision metadata, once per second when changed, otherwise a heartbeat. Two streams per account, no replay history, close on backpressure.
- GET /api/elements/owner/view?id=... returns one current owner-authorized render and the matching revision metadata, without chats, table rows or credentials. Declarative owner actions remain part of this owner-only snapshot; grant recipients cannot use it.
- Session and source ownership are rechecked inside the synchronous ACL lock before every delivery. An invalid member invalidates the whole batch without partially exposing other members. Logout, disabled owner, source deletion, contention and disconnect close the stream. Grant revocation does not revoke the owner's own content.
- Same-state code changes (including owner actions) and ElementDB revisions are distinguished from state changes. Hashes are content tokens, not monotonic history cursors. Snapshot/DB revision sampling is not a distributed transaction across the two SQLite files.
- Existing grant routes, owner CAS writes, schema, renderer and guest capabilities are unchanged. The source endpoint is not yet consumed by the frontend and MUST NOT be described as a shipped fix.

## Evidence and limits

41 focused owner/grant/stream/DB tests pass, including transaction-bound authorization, redaction, unavailable batch members, bounds/caps and backpressure cleanup. Real HTTP checks pass recipient-to-owner state notifications, DB table/row and code changes, owner-only snapshots, three-account isolation, Origin/auth, logout/disable/delete, stream caps and cleanup. The same endpoint test fails against old deployed code with404 as expected.

Browser reproduction: FORM_TEST_ROOT=/opt/form FORM_OWNER_STALE_REPRO=1 node test/owner-live-browser.mjs. Synthetic screenshots cover both view types and widths. Without the reproduction flag, that fixture requires live updates plus a successful subsequent owner save; it is the pending frontend acceptance, not yet registered in the all-tests runner. Transport unit/HTTP tests are registered.

Initial fixture authoring had an escaped-newline syntax error before any server start; corrected before meaningful reproduction. One adjacent gate overlapped the old reproduction port4775 and failed EADDRINUSE; retained in the dated log, not a product failure. The new reproduction fixture uses4777 and adjacent gates are rerun after cleanup. No assertions were lowered. No full npm-test or completed visual synchronization claim.

## Remaining implementation / release gate

Wire a single bounded subscription to mounted owner feed/overlay views, with explicit handling of the 12-target/two-stream budgets. Compare against acknowledged local state/code rather than blindly reloading on own events. Defer snapshots during pending state/DB operations; reconcile conflicts without replaying uncertain writes. Replace the owner persistence queue only after fresh canonical state is accepted. Preserve a frozen initialized surface until replacement is ready, and prevent generated startup mutations from replaying on remote refresh. Close subscription/Workers on navigation, logout, offline and teardown; keep code editing isolated from automatic replacement.

Extend the real browser fixture for recipient-to-owner DB changes, owner-to-recipient continuation, delayed Worker/DB handoff, pending writes, startup-write guards, stale code/editor, offline/reconnect and deletion. Keep CAS rejection tests for races rather than deleting them because background sync usually wins. Run desktop/mobile, existing shared-view and core gates; inspect screenshots. Only then deploy at zero user jobs with rollback, verify served hashes and commit/push release evidence. #ca705d41 remains working, #6a876098 remains working for broader loading, #e89344ad remains open with its existing missing-original blocker. Production runtime remains unchanged.

Adjacent shared SSE security regression passed. The first browser-core run reached fourteen passing checks, then failed during a construction screenshot because its element detached; the prior scratch already records that symptom, but this run does not claim its root cause is fixed. The unchanged rerun is retained separately. Desktop feed and mobile overlay reproduction screenshots were visually inspected: these are stale-state evidence, not synchronization acceptance.

Final unchanged browser-core rerun exited0 (25 PASS lines); the isolated deployed-baseline reproduction rerun at its corrected port also exited0 for all four stale-view cases. All five source/test SHA256 checks pass; fixture processes have ended. Source/deployed app bundles remain identical at 7ceb626c60110517e598f69d8c01a93e3bd217e6db4880da4c592e40ec91efbb. Documentation only is synchronized to production; no backend module, endpoint, schema or frontend integration has been deployed by this checkpoint.
