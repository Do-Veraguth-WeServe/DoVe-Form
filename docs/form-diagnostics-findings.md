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
