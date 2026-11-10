# MiniMax Flash output budget — 2026-11-10

Report #052141fe. The reported failure was not an oversized visible artifact: production build telemetry showed both rounds ending with `length`, zero visible characters and roughly 66–69k hidden reasoning characters. The affected model was MiniMax-M3.1-Flash.

The official OpenAI compatibility documentation (https://platform.minimax.io/docs/api-reference/text-openai-api, checked 2026-11-10) specifies default `reasoning_effort=max`, thinking tokens counting towards max_tokens, and rejection of disabled thinking for this model. Previously Form only lowered effort for GLM builds; compact-output corrective instructions repeated the same excessive MiniMax reasoning budget.

Provider transport now defaults exactly case-insensitive `minimax-m3.1-flash` to `reasoning_effort=low`, covering chat, planning, build and tool rounds. Existing explicit supported effort wins. Other model IDs are untouched. Thinking remains enabled; output limits, bounded retries, cancellation, credentials, sharing, sandbox and explicit build approval are unchanged. No automatic model fallback, larger token budget or product/data rewrite.

Regression: a mock emits reasoning-only length termination when effort is omitted and visible completion at low. It fails against baseline, passes with the fix, checks case variants, explicit high override, unrelated models, unchanged token caps and absence of disabled-thinking requests. Included in the canonical test runner. This is transport-policy evidence, not a promise that every provider request succeeds.

Release verification is recorded below only after completion. The initial jobs test invocation lacked its mock server and failed with ECONNREFUSED; retained honestly in the initial unit log. The corrected gate uses an owned isolated mock and cleans it up. Full npm test is not claimed.

## Verification and remaining work

Exact stored provider messages replayed twice without production conversation writes. Both now produced visible responses and stop/stop instead of reasoning-only length/length: 11,964 visible characters in 36.3s and 12,258 in 47.1s. Neither yielded an accepted artifact: first replay still used a blocked CSS property; second omitted animation declarations then emitted a CSS at-rule. Failed acceptance logs are retained. #052141fe stays working: reasoning exhaustion is improved, not all generation failures resolved.

A directly observed correction gap is also fixed: blocked-property diagnostics name the specific property from the trusted enum (e.g. content/position). No CSS values or arbitrary property names are echoed. Sanitizer restrictions and the single correction limit are unchanged.

Source gates: 32 provider/job/tool-loop tests; 34 CSS/contract/budget tests with one optional skip; 24 browser-core checks. Installed modules: six focused tests passed. Initial missing-mock failure and failed live checks are not relabeled success. No full-suite or visual-intent certification.

Release: three zero-active-job checks, form-user pm2 restart/save, rollback /opt/form/.rollback/20261110-minimax-budget. Only provider.mjs and contract.mjs runtime changes deployed. Three access routes pass health, CSP, anonymous denial, closed registration and unchanged-at-release app SHA256 29eea8e51e0e6c69afe066cba5e7a9409375ddc68ce0151ac4fffbf4c663cb7b. That app hash already differed from the previous checkpoint before this deployment; this release does not certify that unrelated frontend change.

Runtime hashes: provider a8ea6993541a09e0792f109dd2687fb98652c7b0d8879dfa0cd6428c144d83d1; contract b7087479b376d98085adaf6b2ef2043d0b5b3bc8b25e97d5b81a5d015aab5d5e. Rollback at zero jobs: restore both runtime modules from the protected directory, retain live DB/credentials, restart/save pm2 as form and verify health/hashes. /opt/form/minimax-budget-release.json retains release-time hashes; this final addendum supersedes its doc hash. No user product/data changes.

Installed browser-core recheck passed the first 14 checks, then timed out waiting for .planning-offer-start (test line 213). An isolated copy of the installed runtime/bundle with BOTH changed runtime files restored to their pre-release versions reproduced the same selector timeout at line 213 (after the first correction iteration). This failure therefore also occurs without this patch; the installed full browser gate is NOT green. The isolated baseline fixture was removed. Source browser 24/24 and installed six focused tests remain valid. Investigate the independently changed installed frontend/fixture input timing next; do not overwrite it or weaken assertions.
