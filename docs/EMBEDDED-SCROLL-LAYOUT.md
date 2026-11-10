# Embedded scrolling and Blueprint alignment — 2026-11-10

## Reproduction

The requester reported an offset response container around the Blueprint top/fold on mobile, plus slower scrolling over the Bern-Ost migration Element. Its saved render was read-only copied to a protected local fixture; no production messages, element rows or state were edited. The product fixture is not stored in Git.

The installed-code baseline at 390px measured the same 144px gesture at 136px/289px (drag/after release) in chat vs 144px/147px over the Element. At 320px, a 180px wheel input over the long iframe scrolled the iframe's last 37px and the conversation zero pixels; the same input over chat scrolled 180px. The frame height cap remains unchanged. Desktop Blueprint width was 860px while response surfaces are limited to 760px. Long mobile headers compressed the title against status/chevron. The precise user-visible top offset has not been measured on their physical device; the fixture checks consistent edges, width and wrapping across fold states.

## Changes

- One trusted app-owned input implementation is used by the feed and serialized into the opaque iframe bootstrap. Equal touch displacement, release velocity bounds and inertia apply on either surface; vertical wheel events route directly to the same feed, without nested scroll consumption or delta scaling differences. Pixel, line and page modes remain explicit. Event timestamps, rather than handler execution time, determine gesture velocity. Ctrl-wheel zoom, horizontal gestures, pinch, controls and overlay-native scrolling are retained.
- No guest scrolling API, DOM capability, network access or channel authorization is introduced. Only trusted input generates scroll messages through the existing private MessageChannel. Global forged messages remain ineffective. Existing momentum interruption, teardown and 1200ms limit remain.
- The CSP hash now covers the exact bridge invocation including its injected input helper; no CSP relaxation. Build extracts both actual bundled functions.
- Blueprint width matches the 760px response column. Mobile title/version and status are separate grid rows, with a fixed chevron column. Question text/legends wrap within their container; model selection can wrap; top inset is explicit and scrollbar gutter remains stable.

## Acceptance

The corrected saved-render fixture passes at 390, 320 and 1280px: drag 144px on both surfaces, 180px wheel on both, after-release totals within 2px in the recorded run (354–358px). No feed horizontal overflow; equal open/closed x and width, question contained inside Blueprint. Ten input/momentum units pass. Dated embed logs retain early fixture errors and intermediate timing diagnostics, not just passing reruns. Initial fixture failures were caused by an undefined SQLite nullable binding, then the fixture placing its Element outside the last-12-message window; both were fixed in the fixture before meaningful comparison.

Physical Android/browser variation remains unverified. This is targeted layout/input acceptance, not a full npm-test or arbitrary generated-product certification. Existing capped inline preview and full Element overlay remain separate surfaces. Pending owner-loading work at source commit 25e61f2 must not be included in this targeted rollout; the fix worktree starts from the deployed 6ff927d lineage.

Release results and installed-code acceptance are appended after collection.

A separate intermittent early-stop was captured: the first rAF callback can predate performance.now() at release (recorded dt -3.6ms), reversing the first step; an exactly zero or rounded subpixel first step also satisfied the old boundary check and killed inertia. Nonpositive frame intervals now defer without moving; fractional displacement carries forward and only a blocked whole-pixel step is treated as a boundary. Both new deterministic units fail against the original source and pass after correction. Earlier comparison failures remain recorded; no timeout/assertion tolerance was relaxed.

## Verified rollout

Final synthetic and protected saved-render browser fixtures pass all three widths, as do both new failing-before/passing-after timing units and eight previous input/momentum units. Existing touch/overlay/momentum, fold, direct question-answer flow and all 24 browser-core checks pass. On the installed application, the saved-render three-width comparison and touch/momentum/overlay suite also pass. Screenshots at mobile/desktop were inspected. Exact frame totals are finite emulated measurements, not physical-device guarantees.

The initial deployment preflight aborted before any mutation because the worktree's symlinked dependencies changed esbuild module-label paths in the rebuilt Worker. After inspection, path-normalized Worker is byte-identical and Worker source is identical; the release preserves the installed Worker and verifier bundle byte-for-byte. No security gate was disabled. Three idle production-job checkpoints preceded the Form-user restart/save. Loopback and both public routes passed exact HTML/app bytes, CSP hash, health and anonymous authorization checks. App SHA256: dd287598f6dd13140f97dd0a4c1a576fee099df7df93ecc91f62eb69442e2652. Rollback: /opt/form/.rollback/20261110-embedded-scroll (code only at idle; never restore live data).

No schema, configuration, user-artifact or production-state changes. The unrelated withheld owner-loading checkpoint remains source-only. The precise original physical-device top-offset observation still needs user confirmation after reload; the released layout has stable open/closed widths and aligned mobile header rows under the tested fixtures.
