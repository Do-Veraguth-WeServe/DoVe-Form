# Saved place-search runtime error (2026-11-04)

Reproduced the exact persisted Ortssuche artifact throwing "Interaktion angehalten: not a function" on Suchen. Generated code called e.preventDefault() although guest events are plain {value,checked}; it also treated write-only ui.value(id,value) as a getter and used unsupported form/submit/class/disabled operations. The artifact had passed shape/size validation, but no per-artifact behavioral validation.

Repair the existing saved artifact in place: retain id, actions, CSS and current state, archive prior render, replace the form wrapper with a div, track input through state.ort, bind button click directly, remove unsupported attr mutations, and prevent duplicate requests with a guest-local flag. No network or DOM permissions are broadened.

parseArtifact now checks these specific incompatible event/getter patterns and routes newly generated mistakes into the existing one-time corrective retry. validateRender remains backwards-compatible so stored older elements are not silently hidden. This targeted lint is not proof of all possible generated JS behavior; actual browser testing remains necessary. Prompt explains the exact supported semantics.

Evidence: test/fixtures/place-search-invalid-api.json reproduces the actual error through test/auto-api.live.mjs with FORM_EXPECT_INTERACTION_ERROR=1. The repaired counterpart succeeds against the real public API with Bern/Schweiz displayed after approval. Unit regression covers rejection of new incompatible generation and continued readability of existing saved data.
