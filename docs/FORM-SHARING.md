# Form sharing — bounded rollout, 2026-11-07

Report 6911dd6f is NOT fully resolved. This slice adds independent Form library copies and persisted custom-Form state snapshots. Element template copies and revocable shared-data Elements/live synchronization remain pending. Nothing is auto-shared.

## Copy semantics

- In Forms choose **Kopie anbieten**, enter the exact recipient username and confirm. **Form-Zustand kopieren** on a custom Form in chat captures its persisted state instead of library defaults. The originating Form must still exist in the owner library.
- The recipient explicitly accepts in Forms. A fresh recipient-owned, initially disabled Form is created; inspect/edit/activate it. Repeated acceptance returns the same ID.
- Offers can be declined/withdrawn before acceptance. Accepted independent copies cannot be recalled; source edits/deletion do not affect them. This is NOT a revocable shared-data grant.
- Snapshots contain only definition and validated template/state. No conversations, history, tables, provider keys or linked tool capabilities transfer. Declarative actions are stripped. Existing sandbox restrictions remain.
- Session/Origin/CSRF/rate limits apply. Source ownership/revision, recipient, custom-card ownership/index and size are checked. Failed acceptance rolls back; pending offers are bounded.
- Standard text-only library definitions are copied; per-message text/checklist checkbox state remains pending. Custom per-message persisted JSON state is covered.

## Verification

Run `npm run test:form-sharing`: isolated unit/Chromium fixtures, three accounts, desktop/390px/reload, immutable state, foreign ownership denial, withdrawn offers, disabled copies and no action transfer. No production artifacts or credentials used.

Migration: additive `form_copy_offers` table only. No existing rows rewritten. Rehearse on a protected disposable SQLite backup and compare pre-existing table fingerprints before rollout. Rollback restores code/bundle only, never the user DB; unused additive table can remain.

Release evidence lives in dated test logs and automation scratch. Tests alone do not establish deployment/push completion.

## Verified rollout

This copy slice was deployed on 2026-11-07 after test:blueprints passed, the final five unit tests passed and the three-account Chromium fixture passed against both source and deployed code. Desktop/390px screenshots were inspected. Live loopback/Tailnet bundles match SHA256 baa8ced3375be4126eae588bd054b2adbf45c8e7d801237efe38fcd24c3c7834; CSP, closed registration and anonymous-copy rejection verified. This is an isolated authenticated fixture, not a production-user login test. Restart occurred only after zero-active-job checks. Rollback: /opt/form/.rollback/20261107-form-copy/files.tar plus protected pm2-dump.json and SQLite snapshot; restore code only, not user DB.

Git push remains blocked by absent remote; report remains working, also because the remaining sharing modes above are not implemented.
