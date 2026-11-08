# API approval acceptance — 2026-11-08

The legacy API suite assumed ordinary chat could implicitly build/refine Elements. Its baseline passed 25/34 tests; nine failures were obsolete protocol expectations or dependent missing-Element fixtures, not evidence to weaken production approval.

The suite now obtains a real plan, verifies existing Elements are unchanged, explicitly approves its exact revision and consumes genuine authenticated job SSE snapshots. Foreign accounts with valid CSRF cannot approve; mismatched revisions are rejected; repeated approval returns the same job. Ordinary chat and target selection must not render a new artifact. Build/refinement results must persist, retain target identity and archive the old revision. Database quotas, ownership, provider masking, auth, cancellation and detachment tests remain active.

Corrective tests observe one transition into correcting and exactly one initial plus one corrective mock-provider call. Several snapshots may legitimately carry the same phase: snapshot count is not retry count. Truncated-response replay must contain actual artifact text, not SSE envelopes. History assertions separately identify server-owned previous messages, app-owned element evidence and the current request; no client-supplied history is trusted. The first revised run retained failures for these two fixture assumptions (31/34), then corrected them with stronger semantic checks.

Run `node test/run-legacy-api.mjs` for disposable local accounts/models/database and a loopback mock provider. `FORM_TEST_ROOT=/opt/form node test/run-legacy-api.mjs` exercises deployed server modules in the same isolated fixtures. The harness waits for both processes, awaits child exit and removes its own temporary directory. It never uses production users, keys or the live database. Existing full runner continues to invoke the API suite normally.

This change is test-only: no runtime deployment/restart or user-artifact changes. No browser/visual result is claimed or required for this HTTP fixture migration; legacy browser acceptance remains a separate queue item, as do live runtime/layout diagnostics and reply confidence metadata. Full npm test is not certified green. Dated api-baseline/after/release/final/deployed logs preserve honest outcomes.

Verified final results: all 34 tests pass against source and all 34 pass against deployed modules, zero skips. No production runtime code changed. Source/deployed documentation and acceptance-file SHA-256 manifest are retained with the logs.
