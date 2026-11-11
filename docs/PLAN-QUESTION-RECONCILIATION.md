# Planner question reconciliation — 2026-11-11

Related working report: #052141fe. Bounded source checkpoint, NOT a runtime release or resolved report.

## Changes

- Reconcile the existing production jobs.mjs correction instruction: a complete closed question/text/option schema within the existing one-round planner repair. No extra tools or construction authorization.
- Fix a separately reproduced canonical parser defect: nested structural option/text/question tags inside an option capture fail validation instead of becoming an answer label. Existing bounded correction applies; repeated failure preserves the previous Blueprint.
- Preserve single-option compatibility and literal comparisons such as x < 5. The prompt recommendation of two choices is not an existing parser requirement.

## Evidence and limits

Initial baseline reproduced absent exact repair guidance. Its single-option fixture incorrectly assumed rejection; existing compatibility explicitly accepts one option. Corrected the fixture without changing validation. The nested option case exposed a real defect: <option>List<option>Grid</option> was accepted as one answer containing markup. Original failures retained. A temporary explicit TODO captured this gap and was removed after implementation; final assertions require rejection, corrected persistence and double-failure preservation.

Disposable SQLite stores and loopback mock SSE only. Existing cancellation, valid-first-result, truncation, empty-chat, required-artifact, ownership and timeout cases remain. No real-provider, visual/browser, live-user or full-suite certification. Dated plan-question logs retain baseline, intermediate failures and final gates. An attempted shell edit failed at parse time without mutation, then the first-class edit succeeded.

Before the parser fix, installed guidance/adjacent checks passed 36 tests. Final regression against untouched /opt/form deliberately reproduces the nested-option gap; NOT a passing installed release. The installed parser also has an independent tolerant missing-end-tag branch and memory prompt changes: review those rather than overwrite them.

## Release boundary

No production runtime replacement, restart, schema/config/provider or user artifact/data mutation. Only this doc and the regression test synchronized to production. Active backend predates other independent filesystem changes; restarting activates all of them. Reconcile remaining jobs auto-report/quota, server memory/report context, store Forms history and dependent frontend/verifier/shared-state changes before idle restart. Do not label every HTTP429 exhausted credits.

New automatic report #2b0b2303 records failed HTML verification after bounded generation correction, queued for diagnosis, not attributed to planner. #052141fe and #6a876098 stay working; #c1b9fed2 stays open. User products untouched.

Rollback this source-only checkpoint by reverting its task-owned commit; no runtime rollback needed. Never restore live databases. Publish only to origin/form-platform, no force push/history merge.
