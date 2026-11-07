# Form sharing — bounded rollout, 2026-11-07

Report 6911dd6f is NOT fully resolved. This slice adds independent Form library copies and persisted custom-Form state snapshots. Element template copies and revocable shared-data Elements/live synchronization remain pending. Nothing is auto-shared.

## Copy semantics

- In Forms choose **Kopie anbieten**, enter the exact recipient username and confirm. **Form-Zustand kopieren** on a custom Form in chat captures its persisted state instead of library defaults. The originating Form must still exist in the owner library.
- The recipient explicitly accepts in Forms. A fresh recipient-owned, initially disabled Form is created; inspect/edit/activate it. Repeated acceptance returns the same ID.
- Offers can be declined/withdrawn before acceptance. Accepted independent copies cannot be recalled; source edits/deletion do not affect them. This is NOT a revocable shared-data grant.
- Snapshots contain only definition and validated template/state. No conversations, history, tables, provider keys or linked tool capabilities transfer. Declarative actions are stripped. Existing sandbox restrictions remain.
- Session/Origin/CSRF/rate limits apply. Source ownership/revision, recipient, custom-card ownership/index and size are checked. Failed acceptance rolls back; pending offers are bounded.
- Standard text-only library definitions are copied; copying per-message text/checklist checkbox state remains pending. Custom per-message persisted JSON state is covered.
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
