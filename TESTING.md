# Verification — 2026-10-31, Form v2

Verified on actual Tailnet HTTPS, real Chromium 153, actual zai/glm-5.3-flash through dedicated OpenClaw agent form (not simulated). Model generated custom calculator HTML/CSS/QuickJS code, changed input 250→700, rendered 8400, persisted through reload. Followup remembered test word Waldstern and consumed changed amount 700; generated second response showing 700 and 8400. Raw non-sensitive test conversation: live-proof.json. Screenshots live-desktop.png/live-mobile.png inspected for original dark/lime app shell.

Passed npm test: response bounds, no browser/Node globals or Function host escape, infinite-loop interruption. npm audit --omit=dev: zero known vulnerabilities at test time.

Passed boundary-test.cjs: malicious meta refresh, href/svg links, img, scripts, onclick, CSS import/url removed; zero external requests; real QuickJS bridge interactions; suggestions do not send; missing CSRF 403; arbitrary target field 400; .env route 404; export/import fresh sessions; loading/stop/stale-response suppression and recoverable errors (fault-injected only for error UX).

Passed original demo test.cjs against /form-demo: all 14 checks including controls, refresh, forged bridge, opaque frame, export/import, 390px mobile and reduced motion. Original index.html untouched.

Operational proof: HTTPS 200; private Unix socket 0600 in 0700 dir; missing identity 403; unrelated nobody user cannot connect to socket. Form process runs as form via user-scoped PM2 and pm2-form.service. Gateway PID 3821137 still started 2026-10-31 00:00:41: no restart/update/stop. Only agents.entries.form merged, config validate passed and CLI reported hot-apply. Existing 443 Tailscale handler preserved.

Limitations: Chromium only; no Safari/Firefox/physical-keyboard audit. Free generation occasionally yields invalid response (observed one rejected response); no unsafe fallback execution. JS intentionally has no DOM/window, network, async timers or module imports. CSS at-rules and URL assets disallowed. 150ms JS execution/16MB heap/3s watchdog; last 12 messages mounted, full local archive retained. No cloud archive sync, no forks, no external tool actions. LocalStorage and exports unencrypted. Owner gateway token remains high-privilege and is protected server-side, not a scoped gateway credential. Isolation depends on maintained QuickJS/WASM/browser and sanitizer correctness; not a formal penetration test.
