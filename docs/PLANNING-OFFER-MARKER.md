# Compact planning-offer history

User request6347: clicking Element planen should consume the large offer and leave a small history marker. UI immediately replaces the offer with a pending indicator, preventing double clicks. Only server job admission marks it as started. The job ID is saved in the original assistant message forms.planningStarted within the existing messages/job transaction, scoped to the owned conversation. No schema migration. Reload/other devices read the same marker; model metadata does not authorize it. Used offers cannot create a second job; failed admission rolls back and can be retried. Later provider failure uses existing job recovery. Build approval stays separate.

Tests and deployment status recorded after acceptance.

Acceptance: five metadata/transaction unit tests pass. Enhanced actual guided-planning Chromium fixture passes desktop1280/mobile390: forced503 before admission keeps retry available, double-click accepts one plan, compact marker under65px, server reload retains marker without new provider call, no build before separate approval, existing targeted refinement remains functional. Both marker screenshots inspected. Chat API regression recorded separately. Initial implementation omitted new field from request allowlist; browser test caught it and the contract was corrected before deployment. No existing messages migrated.
