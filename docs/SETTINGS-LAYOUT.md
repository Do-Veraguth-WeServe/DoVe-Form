# Unified settings and sidebar

Requested by Dominik (Telegram6297): central settings instead of sidebar-footer clutter; consistent non-resizable connection and bug-report fields.

Sidebar footer contains only profile and settings. Library sits above the collections; Elements has Own/Shared controls. Account/logout, models, connections (MCP/HTTP), memory, authorized users and help/reports live in one settings shell. Existing authenticated form handlers and IDs are reused in embedded nonmodal panes, not stacked modal dialogs. Element-specific connection settings stay at the Element. Desktop uses a category rail; mobile a full-height sheet with visible two-column category navigation.

Management inputs/selects/textareas use consistent borders, background, typography and widths. Textareas grow with content to a bounded360px, then scroll; no drag handles. Checkbox layout remains compact. No backend/auth/database changes. Model onboarding hint now points to Settings/Models.

Acceptance: dedicated isolated real-browser desktop1280/mobile390 fixture checks one modal, footer count, collections, category navigation, real bug submission, styled status notes, auto-growing HTTP fields and horizontal bounds. Existing accounts/forms/sharing tests use the new navigation path without dropping their behavioral/security assertions. Screenshots inspected.

Existing maintenance writer was stopped at takeover; its completed navigation regression/release results were inspected and changes preserved separately in975f11b. That fix prevents switching/new chats from cancelling background turns; it is included in this frontend release, without new model calls in tests.

Release results and hashes recorded after deployment. No blanket claim that legacy full npm test backlog is green.

Final gates: dedicated settings desktop/mobile PASS; navigation-job regression PASS; full test:blueprints PASS; shared-elements browser PASS; final settings/sidebar/accounts PASS; private connection browser PASS. Short390x568 sidebar initially left only2px for elements; spacing corrected and regression strengthened to require at least88px. Final measured132px, rows44px and scroll functional. Final mobile/desktop screenshots inspected.

Bundler renamed a local bridge variable after removal of obsolete stopAll in navigation fix; CSP hash therefore changes although bridge behavior does not. Publish dist/bridge-hash.txt together with app and restart only after zero-active-job checks. Backend source/database remain unchanged.
