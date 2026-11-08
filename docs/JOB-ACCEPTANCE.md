# Detached build acceptance — 2026-11-08

The legacy jobs suite predated explicit Plan → approval → build. Five of ten baseline cases failed: ordinary chat intentionally no longer creates artifacts; job creation also precedes upstream connection, so immediate disconnect/concurrency assertions raced the provider. No production defect or safety relaxation was inferred from those obsolete fixtures.

Build cases now obtain a real plan using the authenticated chat API, assert no artifact was built, then explicitly execute its exact blueprint revision. They subscribe to the real job SSE before execution and inspect actual artifact-phase transitions. Ordinary chat tests remain ordinary chat. Assertions still require one provider call after detachment, the same job across reload, exactly one persisted result, reverse completion landing in the correct ordered message, deletion without resurrection, explicit restart failure and an explicit retry.

Cancellation waits for an observed provider connection rather than assuming a job event means upstream is open. Approved-build cancellation is covered separately from chat cancellation. Foreign-user cancellation now uses the foreign account’s VALID CSRF token and requires ownership rejection (404), rather than accepting a CSRF failure as proof of account isolation. A vacuous `true` assertion was removed; actual ready/persistence assertions remain.

Run with the isolated mock provider (`node test/mock-provider.mjs`) and `node --test test/jobs.test.mjs`; stop the mock afterward. `FORM_TEST_ROOT=/opt/form node --test test/jobs.test.mjs` exercises deployed server modules with disposable local accounts, models and databases. Production registration, jobs, users, artifacts and provider credentials are never used or changed. The existing full runner already invokes this suite.

No runtime release is needed for test-only changes. The API/browser legacy suites are separate remaining backlog; this does not claim the full npm test gate is green. No new browser/UI behavior or visual acceptance is claimed. Dated jobs-approval logs retain the baseline and final isolated results.

Verified: source and deployed-module isolated runs each passed all 11 tests. The unchanged baseline failed 5 of 10; final assertions were preserved or strengthened, not disabled. No production runtime restart or deployment occurred.
