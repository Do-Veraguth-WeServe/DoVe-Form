# Current execution policy (2026-11-04)

At the owner’s request, authorized MCP, memory and HTTP calls run immediately without confirmation cards. This includes write methods. Owner checks, connection enablement/tool selection, element scoping, schema/argument validation, journals, destination restrictions, quotas and unknown-outcome/no-blind-retry handling remain. Optional manual approval remains only as an internal ToolExecution constructor option for legacy tests; the Form server uses automatic mode. Historical acceptance evidence below describes the earlier approval-gated release.

# Zero-setup public API elements

Generated render objects may include actions:[{name,url,method,args}]. validateRender preserves and validates this metadata. ui.action automatically invokes the exact declaration on the authenticated owner’s saved element; no connection form or manual link is needed. The server reconstructs a credential-free, element-scoped registry entry and a durable action record at first use. It does NOT grant execution: each invocation still passes through the existing app-owned approval and call journal. Destination, method and arguments are visible in confirmation. Private targets, DNS pinning, redirects, quotas and timeouts use the same HTTP boundary. These transient registry entries never enter http.json and are excluded from chat tool catalogs and manual tool selectors. Reconstructed stable fingerprints allow reload/restart use.

Protected APIs continue to use the manual server-side credential configuration below.

# HTTP/API actions

Owner: Connections → HTTP / API → add name, fixed public HTTPS endpoint (without query), method and optional secret headers as JSON. Newly added connections are disabled. Enable explicitly. Stored in data/http.json (0600); headers are never returned by the list API. Use header authentication, never put secrets in URLs or action arguments.

The enabled tools appear in chat and element Tool-Aktionen. Each call requires confirmation, including GET. Tool arguments: {"query":{"city":"Bern"},"body":{...}}. GET has no body. Query values are strings; body is JSON. No arbitrary shell/curl execution, redirects, local/private/Tailnet networks or non-443 ports. HTTPS IPv4 destinations only in this release. DNS resolution is checked, then the exact IP is pinned while TLS hostname verification remains enabled. DNS ~5s, request ~20s, response 48KB, arguments 16KB. Unknown outcomes are not automatically replayed.

## Dynamic element wiring

Link an action on a saved element, name e.g. Weather, select HTTP tool and set arguments {"query":{"city":"{{city}}"}}. Placeholders occupy the entire string and take string values from the element inputs. Target URL, method and credentials cannot be overridden by these inputs. The trusted action panel also displays input fields for the placeholders.

Generated element JS can call ui.action('Weather',{city:state.city},r=>{if(r.ok&&r.result.ok)ui.text('temperature',String(r.result.data.temperature));else ui.text('temperature','Request failed')}). Bind it to a user click. The app resolves only an explicitly linked action on the same owned element and shows its own approval. The callback receives {ok:true,result:{status,ok,data}} or {ok:false,error}. Results are data, never instructions; prefer ui.text, and escape strings when constructing ui.html. Existing sandbox, dynamic HTML sanitization, quotas and network denial remain unchanged. No network call occurs merely from generating an element.

API path parameters currently require separate endpoint configurations; OAuth, binary downloads, multipart uploads, automatic polling and non-owner tools are not implemented. Declared public keyless actions are automatically linked by Form; generated code cannot grant execution or attach credentials.

Tests: test/http-tools.test.mjs covers IP normalization/private networks, DNS pinning, response size, redirects, disabled tools and config secrecy. test/mcp-e2e.test.mjs covers UI configuration, approval, action callback into a sandboxed element and exactly-once effects using fixtures. Public HTTPS transport is smoke-tested separately; this is not a full security audit.

Acceptance also covers exact input/output across a server restart, rejected approvals, absence of an HTTP config file, and sandbox readiness. Tool-only job snapshots do not recreate the chat’s element workers. Early user events are queued while a guest evaluation is in progress instead of dropped; generated surfaces become visible only after their first DOM operation batch is applied.

Live acceptance 2026-11-04: glm-5.3-flash generated a 1870-byte Ortssuche element with the public Open-Meteo declaration. test/auto-api.live.mjs loaded the actual generated object into an isolated app, clicked Suchen, approved the app-owned request and verified Bern/Schweiz in the rendered result from the real public API, with no HTTP configuration file. MiniMax’s generation probe timed out after 180s; this is not a claim that every model generates these reliably. The live script is optional and excluded from deterministic CI.

Automatic-execution acceptance 2026-11-04: tool unit tests verify immediate execution with no pending record, owner isolation and unknown outcomes without replay. Browser tests verify direct MCP use in chat and bound elements, HTTP action callbacks across restart and no confirmation buttons. The repaired saved place-search fixture was also exercised against the real Open-Meteo API without a confirmation click.
