> Current integration acceptance (2026-11-08): see [Shared Elements release](SHARED-ELEMENTS-RELEASE.md). Earlier source-only statements below are historical checkpoints. Production status is recorded in that release document.

# Form sharing — bounded rollout, 2026-11-07

Report 6911dd6f is NOT fully resolved. This slice adds independent Form library copies and persisted custom-Form state snapshots. Revocable shared-data Elements/live synchronization remain pending. Element template copy verification is recorded below. Nothing is auto-shared.

## Copy semantics

- In Forms choose **Kopie anbieten**, enter the exact recipient username and confirm. **Form-Zustand kopieren** on a custom Form in chat captures its persisted state instead of library defaults. The originating Form must still exist in the owner library.
- The recipient explicitly accepts in Forms. A fresh recipient-owned, initially disabled Form is created; inspect/edit/activate it. Repeated acceptance returns the same ID.
- Offers can be declined/withdrawn before acceptance. Accepted independent copies cannot be recalled; source edits/deletion do not affect them. This is NOT a revocable shared-data grant.
- Snapshots contain only definition and validated template/state. No conversations, history, tables, provider keys or linked tool capabilities transfer. Declarative actions are stripped. Existing sandbox restrictions remain.
- Session/Origin/CSRF/rate limits apply. Source ownership/revision, recipient, custom-card ownership/index and size are checked. Failed acceptance rolls back; pending offers are bounded.
- Standard library definitions and per-message text/checklist checkbox states can be copied. Standard card acceptance creates a fresh recipient-owned chat containing only the selected card (bounded title/text/items and boolean checkbox state), plus a disabled library definition. The UI opens this chat immediately; edits and reload persistence remain independent. Custom per-message persisted JSON state is covered.
- Checklist persistence prerequisite: ordinary checklist ticks are now saved per owned message/card and restored on reload, including mobile. Saves are serialized per card; rejected saves restore the last confirmed state. Only a bounded boolean array matching the stored checklist is accepted; card text/layout cannot be replaced through the state endpoint. No sharing grant or generated artifact is changed.
- Regression: `node test/checklist-state.test.mjs` (after build), also included in `test:blueprints`. `REPRO_BASELINE=1 FORM_TEST_ROOT=/opt/form` can target a pre-fix deployment in an isolated disposable store; it must fail the checked-state reload assertion on the old code. Dated checklist test logs preserve before/after evidence.

## Verification

Run `npm run test:form-sharing`: isolated unit/Chromium fixtures, three accounts, desktop/390px/reload, immutable state, foreign ownership denial, withdrawn offers, disabled copies and no action transfer. No production artifacts or credentials used.

Migration: additive `form_copy_offers` table only. No existing rows rewritten. Rehearse on a protected disposable SQLite backup and compare pre-existing table fingerprints before rollout. Rollback restores code/bundle only, never the user DB; unused additive table can remain.

Release evidence lives in dated test logs and automation scratch. Tests alone do not establish deployment/push completion.

## Verified rollout

This copy slice was deployed on 2026-11-07 after test:blueprints passed, the final five unit tests passed and the three-account Chromium fixture passed against both source and deployed code. Desktop/390px screenshots were inspected. Live loopback/Tailnet bundles match SHA256 baa8ced3375be4126eae588bd054b2adbf45c8e7d801237efe38fcd24c3c7834; CSP, closed registration and anonymous-copy rejection verified. This is an isolated authenticated fixture, not a production-user login test. Restart occurred only after zero-active-job checks. Rollback: /opt/form/.rollback/20261107-form-copy/files.tar plus protected pm2-dump.json and SQLite snapshot; restore code only, not user DB.

Git remote is configured: local `main` is published to `origin/form-platform`; remote `main` contains unrelated history and must not be force-pushed or automatically merged. The report remains working because the remaining sharing modes above are not implemented.

Checklist persistence follow-up (2026-11-07): reproduced reset on reload against the previous deployed code, then passed the dedicated desktop/390px/reload/error rollback and ACL/CSRF fixture, the sharing suite and full `test:blueprints`. The dedicated fixture also passed against deployed code using an isolated store; screenshots inspected. Live loopback/Tailnet health, CSP, closed registration, anonymous rejection and bundle SHA256 `3d3ebff3e2a496164088e9d6349273ce1f40f641cb96a8fb5b03aec460173055` verified. Restart followed two zero-active-job checks. No schema migration. Protected code-only rollback: `/opt/form/.rollback/20261107-checklist-state/files.tar`; never restore a user database for this release. Logs: `docs/test-results/2026-11-07-checklist-*`. This does not implement ordinary Form state copies or shared-data Elements.

## Standard card snapshot follow-up

All six standard layouts are snapshotted from the owned stored message, never from request-supplied content. Other messages, arbitrary extra fields and capabilities are excluded. Acceptance creates the library definition and chat atomically; reaching the 40-chat limit leaves the offer pending and no partial copy. Repeated acceptance creates no duplicate. No schema change. Unit fixtures cover all six layouts, immutable snapshots, recipient-only edits, retry and quota rollback; Chromium covers mobile/desktop acceptance, immediate navigation, independent checklist changes and reload. Shared-data Elements and private Element template copies remain pending.

Standard-card rollback: `/opt/form/.rollback/20261107-standard-card-copy/files.tar` and protected `pm2-dump.json`. Restore code only after checking active jobs; do not restore user databases. Baseline rejection evidence: `docs/test-results/2026-11-07-standard-copy-before.txt`. Initial broad gate hit the pre-existing asynchronous Flappy reset assertion (immediate DOM read 135.75 versus expected155); assertions were not relaxed. Final gate results are recorded separately.

Verified standard-card rollout: final full `test:blueprints` passed unchanged, six Form/sharing unit tests passed, and the extended three-account Chromium fixture passed on source and deployed code (isolated stores). Desktop/390px screenshots inspected. Loopback and Tailnet homepage/CSP, closed registration, anonymous401 and bundle SHA256 `61469496e72d69240aca8325ea6d55575e1b326297111ca56d1d69ddb74951ba` verified. Restart followed two zero-active-job checks. No production-user content changed. Dated standard-copy logs retain before/after/deployed evidence, including the initial timing failure.

## Element template copies (bounded slice)

The full-screen Element view offers **Element-Vorlage kopieren**. Enter the exact recipient username; the recipient accepts explicitly under **Formen**. This copies the selected validated HTML/CSS/JS and persisted JSON state into a new recipient-owned chat/message with a fresh, initially empty database namespace. No source table rows, history, versions, linked tools or declarative actions transfer. Both users can independently edit their own copy; KI edits still require the normal explicit Plan/build approval. Offers are immutable and checked against a SHA256 of the normalized render at offering time; stale/foreign offers fail. Acceptance is atomic, quota bounded and idempotent, including retry navigation. Pending offers may be withdrawn/declined; accepted independent copies are not revocable.

This is NOT the requested shared-data mode. Revocable grants, shared values, live synchronization and owner-only editing of shared Elements remain outstanding; #6911dd6f remains working. No existing user artifact is modified by deployment.

Verification: extended `npm run test:form-sharing` covers normalized revisions, action stripping, quota rollback and three-account Chromium UI acceptance, empty/independent database namespaces, edit ACL, persisted state and desktop/390px. Baseline checks the previous deployed UI lacks the copy control in an isolated store. No schema migration. Code-only rollback target: `/opt/form/.rollback/20261107-element-copy/files.tar`; never restore the live user DB for rollback.

Element-copy rollout 2026-11-07: seven focused units and full `test:blueprints` passed. Three-account Chromium desktop/390px/reload and DB/CSRF/ACL fixture passed on source; screenshots inspected. Initial browser failure exposed raw-versus-normalized render property ordering in revision hashes; normalization fixed it without weakening the stale-revision check. Live loopback/Tailnet homepage, CSP, closed registration and anonymous401 verified; bundle SHA256 `eddb389ed86d9247cb7bd8c846a7d2051940fa3857423fafafa4c97583a693fa`. Restart followed two zero-active-job checks. Source/deployed code and documentation kept identical. Dated `2026-11-07-element-copy-*` logs retain baseline, initial failure, final units/browser, release and deployment evidence. No production-user login or real-model build is claimed by these isolated fixtures.

The extended three-account Chromium fixture also passed against deployed code using an isolated disposable store; no production data used.

## Wartende Freigaben sichtbar (2026-11-09)
Empfänger sehen nach Anmeldung einen grünen Punkt am Elemente-Tab und an „Geteilte“, sobald eine eingehende Freigabe auf Annahme wartet. Der Punkt verschwindet nach dem Annehmen; ausgehende Freigaben badgen den Besitzer nicht. Aktualisierung bei Login/Neuladen sowie beim Öffnen und Annehmen der Freigabeliste. Test: test/shared-badge.test.mjs.
