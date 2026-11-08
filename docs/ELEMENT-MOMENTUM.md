# Mobile Element gesture momentum — #6152b42b

The app-owned iframe bridge previously forwarded finger displacement but discarded touchend velocity. Reproduced using real Chromium CDP touch input over an isolated Element: scrollTop144 at release and144 after200ms. Plain chat retains browser-native scrolling.

The private MessageChannel now carries bounded release velocity from trusted single-finger vertical gestures. App-owned requestAnimationFrame continues the parent feed with exponential decay (240ms time constant, maximum2.5px/ms and1200ms). Only one continuation exists across Elements. Fresh touch/pointer/wheel/key input, hidden document, iframe teardown/detachment and scroll boundaries stop it. Held releases older than100ms, horizontal gestures and touchcancel do not fling. No guest API, DOM access, arbitrary CSS or channel authorization was added. Overlay Elements retain their own native scrolling. Direct gesture inertia remains enabled under reduced motion, like native scrolling; no decorative motion is introduced.

Regression: test/element-momentum.test.mjs (also supports FORM_TEST_ROOT=/opt/form) runs actual mobile touches, after-release displacement, held/cancelled gestures, interruption by fresh touch, reduced motion, forged global messages, taps, overlay/native scrolling and desktop controls. Unit tests cover decay/deadline/velocity/boundary/detachment/input trust. Existing scroll test now waits for genuine momentum to finish before its unchanged exact forged-message assertion; the initial mixed measurement failure is retained in logs, not hidden. Screenshots are synthetic fixtures, not user products.

Chromium mobile emulation does not certify every physical Android/iOS browser or exact OS fling physics. Forms native layouts are not given custom inertia. Session-entry placement and iframe flickering remain separate reports. No user artifact or state is edited.

Release status: pending final suite and safe zero-job deployment. Evidence logs use docs/test-results/2026-11-08-momentum-*. Full npm test has pre-existing failures and is not claimed green.
