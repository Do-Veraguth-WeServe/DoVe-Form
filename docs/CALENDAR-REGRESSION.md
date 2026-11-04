# Calendar day-cell regression (2026-11-04)

The saved dynamic-row calendar produced 0 day cells with no sandbox error; the static-button revision produced 30. Reproduced using anonymous copies of both saved render objects with empty drafts, no user notes, and immediate/delayed database callbacks.

Root cause: generic HTML-fragment sanitization parses table-only tags in a body context, discarding tr/td before insertion into tbody. Fix: sanitize inside an explicit table/tbody wrapper and send separately sanitized table/section/row variants through the app-owned bridge; select the variant from the actual target tag. Existing SVG namespace handling and all allowlists remain. The bridge still writes only sanitized content; no arbitrary DOM or network capabilities were added.

Regression: test/calendar.test.mjs checks both saved versions, 30-day and 31-day navigation, adding a synthetic note, delayed callbacks and removal of scripts/images/event handlers/links from dynamic cells. The stored production render objects, state and element SQLite databases are not migrated or rewritten.
