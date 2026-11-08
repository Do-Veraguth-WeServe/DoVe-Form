# Session entry positioning — #3124f08e

Baseline reproduced in the real frontend: a long existing conversation opened 4939px above its end. Login/reload and explicit sidebar conversation entry now synchronously position the feed at its end, with instant behavior rather than animated scrolling through history.

Entry is separate from ordinary rendering. Submitting, streaming and completing a response still preserve the reading position; navigation does not cancel server jobs. Only existing iframe size changes are followed for up to two seconds after entry, to accommodate initial Element layout. Pointer/touch/wheel/key input, any manual scroll away, another render or the finite deadline cancel this settling. It is not a perpetual auto-follow mode, and slow Element startup beyond that deadline is not guaranteed to remain bottom-aligned. No historical artifacts are migrated or edited.

Regression: test/session-entry.test.mjs uses disposable accounts/store and a local mock provider. Desktop1280/mobile390 login, sidebar switches, reload, late isolated iframe sizing, manual scroll cancellation, Enter/button submission at middle/bottom and completion position are checked. No real provider costs or production-user changes. The initial failing reproduction is retained in docs/test-results/2026-11-08-session-entry-before.txt. General npm-test legacy failures remain separate backlog; this change does not claim the full suite is green.

Release pending final gates and deployed-code verification. Frontend-only: preserve rollback and verify exact live bundle and unchanged bridge CSP before publication; no restart needed if the bridge hash is unchanged.
