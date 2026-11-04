# Fresh prompt acceptance — 2026-11-04

Prompt exactly: `Bau Flappy Bird`. Fresh empty conversation for each model; deployed /opt/form server, isolated temporary user/data/config, existing model credentials referenced read-only. No application changes, prompt additions or hand repairs. Temporary data removed after completion.

## Original model: minimax-m3.1-flash

241568 ms; one automatic corrective retry; both responses truncated by output length limit. Final job failed with no render. SSE: element-job 1, retry 1, prose-chunk 5, artifact-start 1, error 1, done 1. No playable artifact available for browser testing.

## Comparison: glm-5.3-flash

133637 ms; no corrective retry; ready render. SSE: element-job 1, prose-chunk 61, artifact-start 1, render 1, done 1. Unchanged output retained in test/fixtures/flappy-generated-glm.json. Browser loaded the artifact through actual QuickJS Worker / sanitized opaque iframe. Checked autonomous motion, Space lifting bird, floor collision/game over, restart, 390px touch start, actual pipe traversal and score increment (observed score 1), retained best score on restart. No runtime errors. Mobile screenshot visually inspected. No claim of every future generation succeeding or automatic per-element quality gating.

Reproduce generation: node test/flappy-generation.live.mjs (original model); PROBE_PORT=4615 PROBE_MODEL=42b5b291-7bfe-4b45-a598-272ab0e2d504 PROBE_OUTPUT=test/fixtures/flappy-generated-glm.json node test/flappy-generation.live.mjs (comparison). Requires authorized access to existing local model configuration; calls real providers.

Browser-only replay without model calls: node test/flappy-generated.browser.mjs test/fixtures/flappy-generated-glm.json.
