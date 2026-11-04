# HTTP/API actions

Owner: Connections → HTTP / API → add name, fixed public HTTPS endpoint (without query), method and optional secret headers as JSON. Newly added connections are disabled. Enable explicitly. Stored in data/http.json (0600); headers are never returned by the list API. Use header authentication, never put secrets in URLs or action arguments.

The enabled tools appear in chat and element Tool-Aktionen. Each call requires confirmation, including GET. Tool arguments: {"query":{"city":"Bern"},"body":{...}}. GET has no body. Query values are strings; body is JSON. No arbitrary shell/curl execution, redirects, local/private/Tailnet networks or non-443 ports. HTTPS IPv4 destinations only in this release. DNS resolution is checked, then the exact IP is pinned while TLS hostname verification remains enabled. DNS ~5s, request ~20s, response 48KB, arguments 16KB. Unknown outcomes are not automatically replayed.

## Dynamic element wiring

Link an action on a saved element, name e.g. Weather, select HTTP tool and set arguments {"query":{"city":"{{city}}"}}. Placeholders occupy the entire string and take string values from the element inputs. Target URL, method and credentials cannot be overridden by these inputs. The trusted action panel also displays input fields for the placeholders.

Generated element JS can call ui.action('Weather',{city:state.city},r=>{if(r.ok&&r.result.ok)ui.text('temperature',String(r.result.data.temperature));else ui.text('temperature','Request failed')}). Bind it to a user click. The app resolves only an explicitly linked action on the same owned element and shows its own approval. The callback receives {ok:true,result:{status,ok,data}} or {ok:false,error}. Results are data, never instructions; prefer ui.text, and escape strings when constructing ui.html. Existing sandbox, dynamic HTML sanitization, quotas and network denial remain unchanged. No network call occurs merely from generating an element.

API path parameters currently require separate endpoint configurations; OAuth, binary downloads, multipart uploads, automatic polling and non-owner tools are not implemented. The generated UI does not automatically create/grant its own action bindings.

Tests: test/http-tools.test.mjs covers IP normalization/private networks, DNS pinning, response size, redirects, disabled tools and config secrecy. test/mcp-e2e.test.mjs covers UI configuration, approval, action callback into a sandboxed element and exactly-once effects using fixtures. Public HTTPS transport is smoke-tested separately; this is not a full security audit.
