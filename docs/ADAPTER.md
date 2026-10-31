# Form v2 adapter

Browser POST /form/api/chat: {version:1, sessionId:UUIDv4, requestId:UUIDv4, text:string<=2000, states:up to 3 JSON snapshots, context:import summary<=4000}. JSON total <=16KB. Requires exact Origin and X-Form-CSRF from authenticated GET /form/api/bootstrap. Only configured Tailnet login accepted. Response {requestId,render:{version:1,html,css,js,state}} or bounded error. No arbitrary paths, models, headers or agent targets accepted. Backend server/server.mjs is the replaceable adapter; UI contract lives in src/shared/contract.js.

Server private Unix socket /opt/form/run/http.sock (0600) in 0700 directory. Tailscale Serve authenticates login and overwrites identity headers; no TCP adapter endpoint exists for proxy-header spoofing. Root/tailscaled and form user are the explicit local trusted boundary. Gateway owner credential in /opt/form/.env (JSON, 0600 form:form), never static assets. Session routing: fixed agent form, agent:form:form:HMAC(login:UUID). Only the dedicated workspace is supplied; agent skills [] and tools deny ["*"], codeMode/swarm/elevated disabled. Existing HTTP completions endpoint was already enabled. Agent config hot-applied without gateway restart.

Generated JS runs ONLY in QuickJS WASM worker, 16MB heap, 256KB stack, 150ms synchronous interrupt, 3s worker watchdog, 250 ops per event and 8KB/op. Host API ui.text/value/attr/on/persist/suggest; no browser objects or native DOM. HTML allowlist via DOMPurify, parsed CSS filtering via CSS Tree. URL/navigation/form/embed/script capabilities absent. Only app-authored iframe bridge runs natively, exact CSP hash plus per-frame nonce. MessageChannel per frame, source/origin/channel checks. No renderer request performs model/tool calls. Suggestion only fills composer. App-owned labels/composer remain outside.

Local archive v2 stores validated renders and state. Imports get fresh conversation IDs and bounded text context; arbitrary imported JS remains in the same interpreter boundary. Browser localStorage/exports are unencrypted. Gateway retains its own isolated conversation history. Only last 12 messages are rendered to bound worker count; full archive preserved for export. No forks, cloud archive sync, external assets, timers, async JS or direct DOM access.

## Operations
Build: npm ci --ignore-scripts && npm run build. Runtime mirrors the repo layout under /opt/form: /opt/form/server/server.mjs + /opt/form/src/shared/contract.js + /opt/form/dist (server.mjs resolves both relative to its own path — a flat /opt/form/server.mjs will NOT boot); PM2 user form entry server/server.mjs, boot via pm2-form.service, pinned pm2-logrotate 3.0.0 (10MB ×3). Do not start root PM2. Restart only Form: su - form -c 'pm2 restart form'.

## Rollback
Restore original demo at main URL (no gateway change):

tailscale serve --bg --https=9443 --set-path=/form /root/.openclaw/workspace/projects/freeform-chat/index.html

Then systemctl disable --now pm2-form if retiring runtime. Original demo also remains /form-demo. Do not use tailscale serve reset/off globally: preserve existing 443 and other handlers. Optional dedicated-agent retirement: openclaw config unset agents.entries.form (hot apply); retain history until user approves deletion. No credential values in repository.
