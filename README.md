# Form — Interactive Agent Canvas

Live private app: https://fhisling.tail11036c.ts.net:9443/form
Original deterministic demo preserved: https://fhisling.tail11036c.ts.net:9443/form-demo

V2 connects a dedicated OpenClaw Form agent with its own conversation namespace and no tools. Freely generated HTML/CSS/JavaScript, with generated code confined to QuickJS WASM and a constrained UI bridge. Same dark/lime style, app-owned composer, explicit send of interaction values, local sessions and export/import. No forks.

Native browser JS from generated answers is never executed. Read SECURITY.md and ADAPTER.md for exact boundaries, limits and rollback. The backend is a replaceable private Unix-socket service under user form in /opt/form; only Tailscale Serve exposes HTTPS, only to the configured user. Credentials stay server-side.

## Development / tests
- npm ci --ignore-scripts && npm run build
- npm test — contract + interpreter security
- node boundary-test.cjs — real Chromium malicious markup/CSS/JS, interaction and API rejection tests
- node live-test.cjs — actual model, multi-turn memory, changed values, reload/mobile
- URL=https://fhisling.tail11036c.ts.net:9443/form-demo node test.cjs — original 14-check demo regression

Tests use existing cached Chromium and Playwright Core. Browser state/export is unencrypted. Only the last 12 messages are mounted, full history remains exported. Model generation may take time or produce rejected output; errors remain visible and retryable. See TESTING.md for measured results, not guarantees.
