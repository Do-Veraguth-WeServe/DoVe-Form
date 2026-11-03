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
- Dedicated element action bindings and standalone memory (next steps).
- Automatic continuation across server restart; interrupted jobs fail honestly.

## Trust boundary
Only the owner configures destinations. Connecting a server is not proof of trust; tool output is untrusted data. No tool or secret is exposed to the generated iframe. Private endpoints are intentionally allowed for owner-selected MCP services, not client/model-controlled URLs. No redirects are followed. MCP tool declarations do not self-authorize execution.

## Verification
npm test includes MCP protocol fixture, argument checks, approval isolation, bounded agent loop, and browser end-to-end owner setup/approval/result/reload. These use deterministic fixtures, not claims of live provider compatibility.
