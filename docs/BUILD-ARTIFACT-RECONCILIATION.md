# Build artifact reconciliation — 2026-11-11

Related report: #052141fe (generation failure). This is a bounded reconciliation of production commit ec96dcf into canonical source, not resolution of the entire report.

## Reproduction and change

On source 397c067, an explicitly approved build receiving only prose completed without an Element and without the corrective round. The isolated HTTP regression fails with one provider request instead of two. The reconciled patch makes create/refine request an artifact, then use the existing single correction with specific missing-artifact guidance. Two prose-only responses fail honestly and retain the original refinement target. Legacy direct prose-only callers and the existing tool-result exception remain compatible.

Inherited Blueprint targets and the save boundary now retain only rendered Elements belonging to the same user and conversation. Missing, non-rendered, foreign-account and foreign-conversation targets are not persisted as future refinement targets. This run did not repair or otherwise mutate existing production Blueprints or products.

The patch was selected file/hunk-wise from the independently initialized production history. It does not import the entire history or overwrite the production design, memory, quota, CSS or sharing changes. Pre-existing source renderer, busy-timeout, editor/shared fixture and screenshot changes are excluded from this commit.

## Evidence and limits

- Baseline: docs/test-results/2026-11-11-prose-build-baseline.txt.
- Corrected source HTTP plan -> explicit start -> prose-only response -> corrected artifact: docs/test-results/2026-11-11-prose-build-fixed.txt.
- Focused source gate: docs/test-results/2026-11-11-build-required-source.txt.
- Installed-module isolated fixtures: docs/test-results/2026-11-11-build-required-installed.txt and 2026-11-11-prose-build-installed.txt.
- Initial additional target fixture mistakenly passed foreign targets through createJob, which already rejects them. It was corrected to exercise saveBlueprint directly; the initial failure is retained in 2026-11-11-build-required-fixture-initial.txt. No product assertion was loosened.

All fixtures use disposable SQLite stores and synthetic local providers. No paid provider requests or production user data writes. These are backend/API and isolated sanitizer checks, not new visual acceptance or a full-suite pass.

## Deployment boundary

The selected behavior already exists on disk in /opt/form, but the production backend started at 00:20:49 CET, before ec96dcf and later quota changes. An isolated process using installed modules is NOT proof that the long-running production process loaded them. No production code replacement or restart is performed by this reconciliation. Restart remains pending review of the other independent backend deltas; blindly replacing production with canonical source would regress unrelated capabilities. No ticket is resolved by source publication alone.

Canonical source rollback is a normal revert of this bounded commit; no production runtime was changed, so no runtime rollback is required. Never restore production databases. Remaining release queue: reconcile independent backend/frontend changes without losing either worktree, run their acceptance gates, recheck zero active jobs immediately before any approved safe restart, then verify live behavior. #6a876098 and #c1b9fed2 also remain unresolved.
