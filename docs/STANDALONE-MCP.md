<!-- Current policy: 2026-11-04, automatic execution requested by owner. -->
# Standalone MCP — first release

Form calls the configured model directly. No external agent harness is required.

## Available
- Owner-only MCP configuration through Connections; Streamable HTTP, HTTPS for remote endpoints (HTTP loopback for local servers).
- Official MCP SDK pinned in package-lock.json. Bearer credentials stored in data/mcp.json, mode 0600; never returned to browser.
- Discovery disables the connection and resets tool grants. Owner explicitly selects tools.
- Model/tool/result loop: six rounds, twelve calls maximum; authorized calls execute immediately without per-call confirmation.
- Execution rechecks owner access and the connection/schema fingerprint. Call records persist in SQLite.
- Interrupted running calls are marked unknown; pending approvals expire. Jobs containing tool calls cannot be blindly retried.
- Browser disconnect does not cancel server execution; execution outcomes persist server-side.

## Not yet available
- OAuth, stdio transports, MCP resources/prompts, server-initiated sampling.
- Per-user shared connection grants; initially owner only.
- Tool-capability probing for arbitrary live models (must be verified with each provider).
- Generated iframe code cannot call arbitrary tools; actions are explicitly bound through trusted Form controls.
- Action results appear in the trusted panel and can be delivered into generated widgets through explicitly linked ui.action callbacks; see HTTP-ACTIONS.md.
- Automatic continuation across server restart; interrupted jobs fail honestly.

## Trust boundary
Only the owner configures destinations. Connecting a server is not proof of trust; tool output is untrusted data. No tool or secret is exposed to the generated iframe. Private endpoints are intentionally allowed for owner-selected MCP services, not client/model-controlled URLs. No redirects are followed. MCP tool declarations do not self-authorize execution.

## Verification
npm test includes MCP protocol fixture, argument checks, approval isolation, bounded agent loop, and browser end-to-end owner setup/approval/result/reload. These use deterministic fixtures, not claims of live provider compatibility.

## Memory
User-owned memories support literal text search, edit and delete. Chat access is opt-in (off by default); owner tool calls use the same automatic, logged execution mechanism. No OpenClaw files are imported. Non-owner accounts can manage their own stored memories, but agent tool execution remains owner-only in this release.

## Element actions
Open an element, expand Tool-Aktionen, select a granted MCP tool and fixed JSON arguments. Every authorized run executes immediately and stores its result. No model request is needed. Changed endpoint/schema credentials invalidate old bindings; simultaneous duplicate clicks are rejected.

## Live provider probe (2026-11-03)
Both configured models returned a valid native tool call for a harmless protocol probe: minimax-m3.1-flash (1192 ms), glm-5.3-flash (4768 ms). No external tool was executed. This proves basic tool-call compatibility, not general tool-use quality or end-to-end production MCP credentials.

HTTP/API integration: see [HTTP actions](HTTP-ACTIONS.md). Fixed public HTTPS endpoints, secret headers, dynamic query/body arguments and explicit element-scoped callbacks use the existing approval journal.
