# Standalone MCP — first release

Form calls the configured model directly. No external agent harness is required.

## Available
- Owner-only MCP configuration through Connections; Streamable HTTP, HTTPS for remote endpoints (HTTP loopback for local servers).
- Official MCP SDK pinned in package-lock.json. Bearer credentials stored in data/mcp.json, mode 0600; never returned to browser.
- Discovery disables the connection and resets tool grants. Owner explicitly selects tools.
- Model/tool/result loop: six rounds, twelve calls maximum; each call needs explicit owner confirmation.
- Approval binds call arguments and the connection/schema fingerprint. Call records persist in SQLite.
- Interrupted running calls are marked unknown; pending approvals expire. Jobs containing tool calls cannot be blindly retried.
- Browser disconnect does not cancel server execution; approval state reloads from server.

## Not yet available
- OAuth, stdio transports, MCP resources/prompts, server-initiated sampling.
- Per-user shared connection grants; initially owner only.
- Tool-capability probing for arbitrary live models (must be verified with each provider).
- Generated iframe code cannot call arbitrary tools; actions are explicitly bound through trusted Form controls.
- Action results currently appear as JSON in the trusted action panel; automatic binding into generated visual widgets is not included.
- Automatic continuation across server restart; interrupted jobs fail honestly.

## Trust boundary
Only the owner configures destinations. Connecting a server is not proof of trust; tool output is untrusted data. No tool or secret is exposed to the generated iframe. Private endpoints are intentionally allowed for owner-selected MCP services, not client/model-controlled URLs. No redirects are followed. MCP tool declarations do not self-authorize execution.

## Verification
npm test includes MCP protocol fixture, argument checks, approval isolation, bounded agent loop, and browser end-to-end owner setup/approval/result/reload. These use deterministic fixtures, not claims of live provider compatibility.

## Memory
User-owned memories support literal text search, edit and delete. Chat access is opt-in (off by default); owner tool calls use the same confirmation mechanism. No OpenClaw files are imported. Non-owner accounts can manage their own stored memories, but agent tool execution remains owner-only in this release.

## Element actions
Open an element, expand Tool-Aktionen, select a granted MCP tool and fixed JSON arguments. Every run requires approval and stores its result. No model request is needed. Changed endpoint/schema credentials invalidate old bindings; simultaneous duplicate clicks are rejected.

## Live provider probe (2026-11-03)
Both configured models returned a valid native tool call for a harmless protocol probe: minimax-m3.1-flash (1192 ms), glm-5.3-flash (4768 ms). No external tool was executed. This proves basic tool-call compatibility, not general tool-use quality or end-to-end production MCP credentials.
