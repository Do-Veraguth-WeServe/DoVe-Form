# Checkbox appearance stability — #fb0fcaad

Read-only report diagnosis found a standard list Form, not a generated sandbox Element. The platform disabled every checkbox while any checkbox save was pending, visibly changing all native controls. No user product or stored card is repaired or rewritten.

The list now keeps its controls enabled and focused, marks the section aria-busy, and guards overlapping changes using the pending checked snapshot. A second toggle during the pending save is restored immediately; it does not issue a concurrent write. After success, subsequent changes are accepted normally. Failure restores the acknowledged state and clears busy status. This retains the previous one-save-at-a-time contract without the collective disabled appearance. No sandbox permissions, account access, registration or backend logic changes.

Regression: test/checklist-stability.test.mjs holds the real state request open, asserts every checkbox remains enabled, focus survives, a competing click cannot issue a second request or overwrite pending state, and checks desktop/390px reload persistence, rollback, CSRF and foreign-account denial. Baseline fails the explicit enabled assertion. The first fixed run caught Playwright uncheck requiring a final unchecked state even when intentional HTTP rejection instantly rolls it back; using click plus the unchanged explicit rollback assertion tests the intended behavior. Existing checklist tests now await aria-busy rather than disabled.

Release isolation: sharing is staged in source and NOT ready for deployment. A temporary git archive of c43a4c4 rebuilds the current production app byte-for-byte with the same dependencies. Only src/forms-ui.js is then changed and rebuilt. Deploy only that source file and dist/app.js, after candidate and full source regression gates. Bridge hash, worker and backend remain unchanged; no restart or schema migration needed. Preserve both old files in a protected code-only rollback. Do not deploy the workspace bundle containing staged owner/sharing changes.

Evidence: docs/test-results/2026-11-08-checklist-stability-*.txt and synthetic desktop/mobile screenshots. Final release/deployment outcomes are recorded below only once observed.

The initial full source gate passed 109 units (one optional skip), HTTP/owner browser checks, checklist tests, other browser stages and both integrations, then failed the known immediate Flappy reset assertion (135.75 versus155). No assertion was weakened. The original log is retained; an unchanged full rerun is recorded separately. The production-compatible candidate has its own full gate, without staged sharing features.

Rollback after deployment: restore only src/forms-ui.js and dist/app.js from /opt/form/.rollback/20261108-checklist-stability/files.tar. Static assets are read per request; unchanged bridge CSP hash means no process restart is needed. Never restore user databases for this frontend-only fix.


## Verified rollout

Both final gates exited0: unchanged full source rerun (109 unit passes, one optional skip, grant HTTP/owner browser, two integrations and all Chromium stages) and production-base full gate (including Calendar/Flappy). The focused stability fixture passed against source, isolated release candidate, and deployed modules with disposable accounts/data. Desktop/390px screenshots inspected; no live-user mutation or real-model generation claimed.

Only src/forms-ui.js and dist/app.js were atomically replaced after zero-active-job verification. No restart, migration or staged sharing release. Bridge hash, worker and backend unchanged. Live loopback and Tailnet homepage/CSP, closed registration and anonymous401 passed. Served SHA256: a70c9710408fa5c7871b31277de5db6c15415fc7095aa3c8cf9715638f167e4f. Protected rollback contains only the two previous code files. Documentation synchronized to production.

Build preflight recovered from path-dependent dependency comments by copying the installed dependencies; the installed compiler binary was used because /tmp is non-executable. Before applying the hotfix, rebuilding c43a4c4 then matched production byte-for-byte. The retained bundle diff shows only the checklist change. An initial live probe used the wrong status field name; the corrected probe follows server.mjs (registration) and passes. These were test/build harness errors, not production failures.
