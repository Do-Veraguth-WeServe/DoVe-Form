# Form v2 security architecture

Preflight: use maintained QuickJS-Emscripten (0.32.0), DOMPurify (3.4.17), CSS Tree (3.2.1), not an ad-hoc JS interpreter, eval or patched browser globals. Existing demo retained independently.

Generated JavaScript executes only inside a memory-limited QuickJS WASM runtime in a dedicated worker, with interrupt budget. It has no browser globals, imports, sockets or native DOM. Its only host capability emits bounded JSON UI operations. HTML passes a positive element/attribute allowlist; CSS is parsed and filtered. Trusted iframe bridge alone executes native JavaScript. No generated script, event attributes, URL attributes, CSS URLs, forms, embeds, links, meta refresh or navigation primitives are admitted.

Server listens on a Unix socket in a 0700 service directory; only service user and root (tailscaled) can reach it. Tailnet identity headers are accepted only through this restricted socket, never an exposed TCP listener. Only the explicitly configured Tailnet login is accepted. The browser never receives Gateway credentials. Same-origin POST plus custom CSRF token, JSON-only payload limits and per-user admission/rate limits. Fixed form agent; session keys are server-derived HMACs, never caller-supplied Gateway keys.

All interaction state is local until an app-owned send action. No renderer message can call the backend. Generated UI can mislead inside its bounded frame, so identity labels and composer stay outside. This is not a formal audit; browser/WASM engine vulnerabilities and visual social engineering remain residual risks.
