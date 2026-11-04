# Bounded realtime elements

ui.every(ms, callback) replaces the single per-element clock. Host clamps 50–1000ms (max 20Hz), supplies {dt}, drops ticks while busy rather than queueing, pauses when document hidden, and clears on destroy or sandbox error/watchdog. Existing QuickJS heap, stack, per-event deadline, operation cap and host watchdog remain. No native timer, DOM or network capabilities are exposed.

ui.on(id, "keydown", callback) is local to a focusable element, with JSON key/code/repeat. Space and ArrowUp prevent page scrolling only on that element. Click supports pointer/touch activation.

Flappy fixture preserves saved SVG/CSS, adds bounded physics, pause/reset, playfield and keyboard input, collision/game over/restart. Reset ID renamed to restart because DOMPurify removes clobbering id=reset; no sanitizer relaxation. No per-frame server persistence. A restored game opens paused.

Acceptance: test/flappy.test.mjs exercises actual QuickJS Worker and opaque iframe: autonomous movement, pause, reset, playfield, keyboard, game over/restart and lifecycle destruction. Full regression includes runaway sandbox cases. This is not a general automatic behavioral verifier for every generated element.
