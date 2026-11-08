# Background turns during session navigation

Report #55353cf1. Fixed in 975f11b862c7f54bc6691c3e8145390847c4625a; deployed with settings release 42b282651bd0e94bfcc96d4e342415b964a8e3d1, both published to origin/form-platform.

Reproduction before the fix: the real frontend issued /api/jobs/cancel when opening another/new session while a mock provider was held before its first token. The baseline assertion recorded one cancellation instead of zero. Navigation now leaves server jobs running; explicit Stop remains scoped to the selected conversation. Live thinking/prose and completion refresh must not leak into or switch the selected destination conversation.

Independent deployed-code verification 2026-11-08: FORM_TEST_ROOT=/opt/form node test/navigation-jobs.test.mjs PASS, using disposable accounts/database and a local held provider, without production user data or paid model requests. Both chat and plan tested: switch to new chat before first token, release prose, return while writing, switch to existing chat, complete, verify selection unchanged, return and reload completed response. Exactly one provider request per turn; no navigation cancellations or browser errors. This test reloads after completion; it does not independently establish reload during an active turn or mobile gesture behavior.

Source and deployed app SHA256: 2e7ad659ab9132a93a0d69730f9e309f4c6dc7c0b45fae1f91e161a5bd068692. Loopback and Tailnet health returned200 and served this exact bundle. No runtime changes/restart were required for this independent verification. Rollback is the existing settings release backup /opt/form/.rollback/2026-11-08T05-16-52-036Z-settings.

Evidence: test/navigation-jobs.test.mjs; docs/test-results/2026-11-08-navigation-before.txt and 2026-11-08-navigation-deployed.txt. Other scroll, rendering and planning-flow reports remain separate open work.


## Reconnected background completion (2026-11-08)

Expanded desktop1280/mobile390 chat AND plan acceptance reproduces a second navigation defect: reload while thinking, reload while writing, leave the conversation and allow completion. The server finishes successfully with no cancellation, but returning to the conversation still shows stale prose. After reload no live POST relay remains to perform its usual ready-job reconciliation. The background ready event is intentionally held until its conversation is selected; ordinary rendering previously never applied it.

The fix reconciles queued ready results at the start of rendering, explicitly restricted to the selected conversation. It does not change provider calls, server persistence, approval, cancellation or account boundaries. Existing iframe signature caching remains intact. No user artifact migration or repair.

Regression requires the identical job ID across both active reloads, exactly one provider request, no navigation cancellation, no foreign live/completed prose in the destination, unchanged destination selection, and completed prose immediately upon returning and again after reload. Initial failure and diagnostic logs are retained. Browser-core additionally completes a second chat while an approved build provider remains held, then requires one identical job and construction crane through desktop/mobile reload before releasing the artifact. This covers a bounded part of legacy7b–7c; tab-close completion, reverse-build browser ordering and remaining legacy sections are still queued. Full npm test is not certified. Reports #a3daf406 and #e89344ad remain unresolved for their previously documented reasons.

Release verification follows after gates. All fixtures use disposable accounts/data and local mock providers; no real provider spend. One rejected ambiguous edit was inspected and reapplied precisely without partial mutation.


The first installed-module run exposed a fixture synchronization race: the immediate live activity can precede its data-jobid binding. The fixture now waits for the actual durable building job via the authenticated API, then requires that exact ID in both restored activity views. No UI or provider assertion is removed. The initial race failure is retained separately from the actual stale-completion reproduction. An initial bundle comparison used a nonexistent filename; build.mjs supplied the canonical bridge-hash.txt/worker.js paths, and all unchanged-bundle comparisons then passed.


Verified rollout: all four chat/plan desktop/mobile reconnect cases and all19 browser-core checks pass on source AND installed modules. Snapshot/feed iframe stability passes on both; source's eight held/completed scroll combinations and account-scoped selection units pass. No legacy test was removed, no full npm-test or universal visual verification claim. Only src/app.js and dist/app.js changed at runtime; bridge hash, Worker, index and verifier bundles are identical. Two idle checks preceded atomic replacement, with no restart. Loopback/Tailnet homepage+CSP, anonymous401 and served SHA256 fd7ce46a8c43f909eea0a5d1a8a4dc60a1a12ef43576449512a832fa286b817c pass. Code-only rollback: /opt/form/.rollback/20261108-reconnect-ready (restore src/app.js and dist/app.js atomically at idle; never restore DB). No production accounts, provider settings, user data or artifacts changed. Test/docs are synchronized; dated navigation-reconnect/core-background/reconnect-* logs retain reproduction, harness race, passing gates and hashes.
