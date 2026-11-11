# Empty chat recovery reconciliation — 2026-11-11

Related queue: #052141fe. This imports only the existing production empty-chat recovery hunk from jobs.mjs into canonical source. Independent production history is not merged wholesale. It does not resolve the whole generation/sanitizer report.

## Behavior

An empty, whitespace-only or reasoning-only successful chat response receives one additional content round. Both rounds share the same 60-second deadline, cancellation signal, original request and 3200-token per-round cap, with no tools or implicit build. A second empty result fails honestly. Valid prose remains one round. Truncated output and HTTP429/503 do not enter this recovery path. Existing bounded low-level transient transport retry remains independent; this is not a promise of at most two HTTP requests under every transport failure.

## Reproduction and verification

The pre-change canonical baseline failed five of ten fixtures on missing second-round recovery; five unaffected cases passed. The added deadline case separately verifies that expiry before the second round prevents another provider request. Test fixtures replace fetch with synthetic SSE Responses and use disposable SQLite stores. They exercise real provider parsing, JobRunner persistence, cancellation, error storage and active-slot cleanup; no production user data or actual provider is used.

Evidence: docs/test-results/2026-11-11-empty-chat-baseline.txt, empty-chat-source.txt, empty-chat-installed.txt, and the final source/installed gate logs under the same date prefix. The final source gate includes planner recovery, required-artifact/target isolation, timeout labels and provider tests; installed gates run in an isolated process against /opt/form modules. Final results: 47 source tests and 25 installed-module tests passed, including all 11 empty-response cases on each. The new regression is registered in test/run-all.mjs. Initial fixture newline escaping was corrected before execution.

## Release boundary

This behavior already exists on the production filesystem. No production runtime file replacement, restart, schema/account/provider change or user-product mutation is performed here. Source publication and isolated installed-module tests DO NOT prove the long-running production backend loaded its independent recent changes. Its process predates later commits. Full deployment remains pending reconciliation/review of the other backend deltas and an idle restart with rollback and live verification. No full-suite pass, browser/visual acceptance or real-provider replay is claimed. A frontend/UI change is not part of this slice.

Keep #052141fe and #6a876098 working and #c1b9fed2 open. In particular, production quota handling currently labels every HTTP429 as exhausted credits; ordinary rate limiting must not be misrepresented when reconciling that separate change. Other remaining deltas include automatic bug reporting, planner question guidance, memory context, bug notes, Forms history, CSS/verifier capabilities and shared rendering. Preserve existing dirty source changes and production history.

Rollback: revert this bounded source commit; no production runtime rollback is required because runtime files were not changed. Never restore user databases.
