# Form self-diagnosis gap — 2026-11-07

Scope: investigate platform, do not patch user-generated products. No production writes or user artifact modifications performed.

## Evidence
- Initial read-only inspection of the reported tracker found a flame implemented using CSS ::before/::after, content, absolute positioning, rotate and gradients. The inspected version creates a flame span even at streak zero, changing its class to off. This does not establish the version at the time of the quoted reply.
- A subsequent read found the previously inspected message no longer present. Therefore no current full-artifact browser reproduction is claimed.
- Isolated reproduction with the actual deployed safeCSS confirmed removal of content, position, rotate and gradient background. Remaining pseudo-element CSS contains only dimensions. Without content the pseudo-element does not instantiate: database streak values cannot fix that rendering loss.
- contract.mjs tells generation only ordinary CSS/no at-rules, URLs or fixed positioning; actual sanitizer also removes all positioning, pseudo content, transforms such as rotate and gradients. Generation contract does not fully describe runtime capabilities.
- jobs.mjs chat path uses textOnly runRound without inspection tools. element-context.mjs supplies bounded records/state, not sanitized output or runtime diagnostics. getHistory preserves prose and artifact name, not implementation. A selected/planning target can supply source separately, but source is not effective sanitized DOM/CSS.
- Renderer onError callbacks display local notices; no persisted, revision-bound diagnostic feedback reaches chat. CSS removals are silent. Build validating state does not itself establish a browser render or feature acceptance test.

## Platform changes recommended
1. Shared versioned capability policy used by prompt, server preflight and renderer; do not loosen security just to display one artifact.
2. Sanitization returns structured diagnostics (selector/property/reason, source/effective hashes). Unsupported feature dependencies fail preflight or trigger a bounded generation correction before ready.
3. Read-only element inspection scoped to user+conversation+element+revision: original/effective code, DB snapshot, runtime errors, bounded DOM/layout evidence. Preserve opaque iframe and interpreter isolation.
4. Distinguish hypothesis, inspected cause and verified fix in app-owned result metadata. Prompt instructions alone did not reliably prevent speculation in earlier real-model tests.
5. Diagnostic investigation must not create a blueprint or write artifacts. Repair stays explicit Plan -> approval -> versioned build; test in isolated copied data, then publish only against unchanged target revision.

## Acceptance
- Seed a generic pseudo-element icon with unsupported CSS; Form must identify runtime removal, not invent missing database streaks.
- Test the same failure with zero and positive stored counts.
- Verify approved replacement renders through the real sanitizer and sandbox; a generated JSON artifact alone is not success.
- No source/data/diagnostics leakage across accounts; stale diagnostics cannot certify a new revision.
- No production element mutation from diagnosis or automatic corrective tests.


## Bounded CSS capability-policy slice (2026-11-07)

Implemented shared `css-policy.mjs`, consumed by both the generation contract and browser sanitizer. Policy v1 documents the existing blocked properties/functions, including all positioning, pseudo-element content and gradients; it recommends real spans/SVG and flex/grid rather than unsupported CSS. Restrictions are not loosened. `inspectCSS` supplies effective CSS plus bounded structured removal reasons/property/source offsets (maximum 64, total count and truncation flag); no original values or user data are included in diagnostics. `safeCSS` retains the string API.

The generic pseudo-element failure is reproduced at zero and positive counts in isolated Chromium at desktop/390px; a real-span substitute remains visible and CSS network requests remain blocked. This is a platform fixture, NOT a repair of any user product or proof of a model-generated replacement. Initial regression caught duplicate diagnostics from walking an already removed declaration; fixed by skipping its detached children, retaining the stricter assertion.

Still pending: server preflight/corrective-retry integration, source/effective revision hashes, persisted runtime/layout evidence, account-scoped inspection in chat, and app-owned diagnosis confidence metadata. Merely having `inspectCSS` does not mean Form chat can inspect a live element or certify a repair. Sharing #6911dd6f and the missing-original generation report #e89344ad remain unresolved.

Tests: `node --test test/css-policy.test.mjs`, `node test/css-policy-browser.mjs`, and the existing `npm run test:blueprints` gate (now includes both). No database schema or production registration changes. Deployment evidence appended only after verification.

Verified rollout: four focused units, exact pre-change output parity for 14 CSS variants, isolated desktop/390px Chromium fixture against source and deployed sanitizer, and full existing Blueprint release suite passed. No real-model generation or live-user login is claimed. Live loopback/Tailnet home/CSP/auth/closed registration/anonymous401 passed; served app SHA256 `6ba6b6c8b4b2177db4d582ea263179affdb627621585d5684fb4f5202d74d58d`. Two zero-active-job checks preceded the form-user pm2 restart/save. Code-only rollback: `/opt/form/.rollback/20261107-css-policy/files.tar` plus protected pm2 dump. The diagnostics doc was previously missing in production and is now synchronized. No user database or artifact changed. Logs: `docs/test-results/2026-11-07-css-policy-*`.

## Generation CSS preflight (2026-11-07)

New provider artifacts now pass the same CSS policy before being accepted. Any removed declaration/rule triggers the existing single bounded corrective round, with the trusted complete capability guidance attached separately from the provider's capped error text. If the second artifact is still incompatible, the job fails without replacing an existing Element. Supported output remains one round. This is a deliberately strict new-generation gate, not a visual-acceptance claim: HTML, dynamic fragment, runtime and layout diagnostics remain outstanding. A valid CSS preflight does not certify rendering or correct interaction.

Generic parseArtifact/validateRender, saved artifacts, manual edits and import remain compatible; the new check is exclusively on the provider output path. Nothing rewrites a user's product, changes sanitizer permissions or bypasses Plan/build approval. A refinement containing old unsupported CSS must generate a compatible full replacement before it can complete.

Regression: test/css-preflight.test.mjs covers six unsupported CSS variations at zero/positive counts, source-value redaction, actual mock SSE corrective success/double failure, one-round valid output, persisted job states and unchanged target after a failed refinement. It supports FORM_TEST_ROOT=/opt/form for isolated deployed-module tests. Existing CSS Chromium and Blueprint suites remain release gates.

The initial targeted test exposed truncation of correction guidance by the existing 160-character provider-error cap; fixed by adding the complete trusted policy at the retry boundary without increasing the cap. The first broad gate also caught accidental coupling of strict CSS preflight to generic artifact parsing; moved the check to the provider path, retaining existing tests/fixtures unchanged. Dated logs retain both failures. No real-model or live-user build is claimed.

Remaining queue: #6911dd6f revocable shared-data Element grants, owner-only editing, live synchronization and revocation/cross-account tests; #e89344ad still lacks its original failing artifact. Diagnostics still need revision hashes, persisted runtime/layout evidence, scoped read-only chat inspection and app-owned confidence metadata. Reports stay unresolved.

Verified preflight rollout: final five focused tests passed on source and deployed modules, including actual persisted failed/ready jobs; full test:blueprints passed with existing assertions unchanged. The existing desktop/390px CSS Chromium fixture passed against source and deployed sanitizer; Blueprint screenshots inspected. Live loopback/Tailnet homepage, CSP, closed registration and anonymous401 passed. Frontend bundle remains byte-identical (SHA256 6ba6b6c8b4b2177db4d582ea263179affdb627621585d5684fb4f5202d74d58d). Two zero-active-job checks preceded form-user pm2 restart/save. No schema or user-artifact/data changes. Protected code-only rollback: /opt/form/.rollback/20261107-css-preflight/files.tar plus pm2 dump; never restore the live DB. Dated css-preflight logs preserve baseline, initial failures, release, deployed fixtures and backend file hashes. This completes the server CSS preflight/corrective-retry item previously listed as pending, not the rest of the diagnostic pipeline.


## Revision-bound static diagnostic chat evidence (2026-11-08)

The existing owner/conversation-scoped chat snapshot now includes app-owned static CSS diagnostics for up to three Elements. SHA-256 binds the immutable code (excluding state) and source/effective CSS; each request recomputes evidence from the authorized canonical render. At most 16 removal reasons/properties/offsets per Element are included, never CSS values, selectors, HTML or JavaScript. CSS above 100,000 characters is explicitly unavailable. No guest code executes.

App-owned assessment distinguishes inspected removals, no CSS removals and unavailable evidence. runtimeObserved:false and visualVerified:false prevent interpreting this as browser/layout/interaction acceptance. The trusted chat instruction separates removed pseudo-content from database streak counts and static evidence from visual causality. This does not guarantee model reasoning. Diagnostics are captured in the durable chat request, not a new runtime telemetry store. Unavailable records do not erase separately established static CSS evidence.

Regression first reproduced absent diagnostics. Tests cover zero/positive counts, revision changes, state-only stability, bounded/redacted output, account/conversation denial, read-only preservation and unavailable DB. Real Chromium desktop/390px follows login -> chat -> mock provider: exact scoped evidence, no foreign data, no blueprint/build and unchanged artifact. The mock response is not a real-model diagnostic benchmark. Existing CSS browser fixtures separately demonstrate actual sanitizer removal and a visible supported substitute; no user's product is repaired.

Remaining: authenticated revision-bound live runtime/layout inspection, structured diagnosis metadata displayed with replies, real-provider causal-answer acceptance, and legacy full npm-test backlog. Sharing #6911dd6f is now resolved (SHARED-ELEMENTS-RELEASE.md); earlier queue paragraphs are historical. #a3daf406 remains working with the old undeclared-animation product unchanged; #e89344ad remains open without its original artifact. No universal visual or interaction certification.


Verified rollout: source f47b12d, seven focused tests, complete test:blueprints (130 passes / one optional skip plus integration/browser suites), source and deployed desktop/mobile diagnostic-chat fixtures, deployed two diagnostic units and source CSS renderer fixture all passed. Live loopback/Tailnet health and byte-identical frontend bundle verified (SHA256 6a31c6582197b479db1593a6b0cef7bde3565156f27443e9f92e645a6670d7a1). Only element-context.mjs, element-diagnostics.mjs and this document deployed; no schema, sanitizer, renderer or user artifact changes. Repeated zero-active-job checks preceded form-user pm2 restart/save. Rollback: /opt/form/.rollback/20261108-static-diagnostics (restore previous context at zero jobs, restart; unused new helper is inert). Release manifest /opt/form/diagnostics-release.json records runtime hashes and the release-time doc hash, superseded by this final documentation addendum. Dated diagnostics test logs and live hashes are retained. No real-provider answer-quality or live user-login claim.
