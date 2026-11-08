# Background turns during session navigation

Report #55353cf1. Fixed in 975f11b862c7f54bc6691c3e8145390847c4625a; deployed with settings release 42b282651bd0e94bfcc96d4e342415b964a8e3d1, both published to origin/form-platform.

Reproduction before the fix: the real frontend issued /api/jobs/cancel when opening another/new session while a mock provider was held before its first token. The baseline assertion recorded one cancellation instead of zero. Navigation now leaves server jobs running; explicit Stop remains scoped to the selected conversation. Live thinking/prose and completion refresh must not leak into or switch the selected destination conversation.

Independent deployed-code verification 2026-11-08: FORM_TEST_ROOT=/opt/form node test/navigation-jobs.test.mjs PASS, using disposable accounts/database and a local held provider, without production user data or paid model requests. Both chat and plan tested: switch to new chat before first token, release prose, return while writing, switch to existing chat, complete, verify selection unchanged, return and reload completed response. Exactly one provider request per turn; no navigation cancellations or browser errors. This test reloads after completion; it does not independently establish reload during an active turn or mobile gesture behavior.

Source and deployed app SHA256: 2e7ad659ab9132a93a0d69730f9e309f4c6dc7c0b45fae1f91e161a5bd068692. Loopback and Tailnet health returned200 and served this exact bundle. No runtime changes/restart were required for this independent verification. Rollback is the existing settings release backup /opt/form/.rollback/2026-11-08T05-16-52-036Z-settings.

Evidence: test/navigation-jobs.test.mjs; docs/test-results/2026-11-08-navigation-before.txt and 2026-11-08-navigation-deployed.txt. Other scroll, rendering and planning-flow reports remain separate open work.
