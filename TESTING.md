# Testing

## Mobile Element-Gesten — #8271aa99 (2026-11-07)

`node test/element-scroll.test.mjs` nutzt isolierte Konten und Chromium-CDP-Touchgesten bei 390×844. Vorher-Nachweis: Chat scrollTop=0, innerer Element-Scroller=207. Korrektur: Chat=144, innerer Scroller=0 bei 144 px Fingergeste. Zusätzlich: Button-Tap, gefälschte globale Scrollnachricht und unabhängiges internes Scrollen im Vollbild-Overlay. Logs: `docs/test-results/2026-11-07-element-touch-*.log`. Keine Prüfung auf physischem iOS/Safari; kein künstlicher Nachlauf/Momentum. Keine Benutzerartefakte verändert.

Ausgerollt und geprüft: `npm run test:blueprints` exit 0; separate Units 24 bestanden / 1 optional übersprungen; Touch-Suite zusätzlich gegen `/opt/form/server.mjs` und dessen Bundles mit isoliertem Data-Dir bestanden (Test-Harness aus Source wegen dort installierter Playwright-Devdependency). Live-Homepage und Auth-Status über Loopback und Tailnet HTTPS 200; ausgelieferter Bundle-SHA256 `03095191b934bdc25260f0aa684cb4edc931863c85a11f03d74774bac8eda4ae`, CSP-Bridgehash passend. Neustart nur nach Prüfung auf null aktive Jobs. Rollback: `/opt/form/.rollback/20261107-element-touch/files.tar` plus pm2-Dump; ausschliesslich enthaltene Code-/Dokumentationsdateien wiederherstellen, dann bei inaktiven Jobs im form-User-Scope neu starten; keine DB-Rücksicherung. Vollständiges historisches `npm test` nicht als grün behauptet (siehe Legacy-Hinweis unten).

## Blueprint-Release (2026-11-07)

Aktueller fokussierter Release-Gate: `npm run test:blueprints`. Enthält Build; Vertrags-/Provider-/ACL-/Tool-/Memory-/Sandbox-Units; neuen Blueprint-API/Browserpfad; angepasste Mehrbenutzertests; Sidebar-Layout; explizit bestätigte MCP-Ausführung; API-Elemente; gespeicherte Kalender; Spielrenderer. Log: `docs/test-results/2026-11-07-blueprint-release.log`.

`test/blueprints.test.mjs` beweist: keine Render/Tool-Ausführung aus Chat (auch bei „baue sofort“ oder Artefakt-Antwort); kumulierte Revisionen; Start nur aktuell/eigen/CSRF-geschützt; Doppelklick-Deduplizierung; bei Baukapazität 1 offener Upstream und gleichzeitig erfolgreiche Besprechung im selben Chat; unveränderter bestätigter Snapshot; Reload mit genau einer Baustelle; interaktiver Zustand nach Reload; Änderungen bestehender Elemente erst nach Bestätigung; fehlerhafte Planung baut nichts.

Die älteren `api.test.mjs`, `jobs.test.mjs` und `browser.test.cjs` enthalten noch Assertions für den abgelösten automatischen Build-aus-Chat-Vertrag. Sie sind nicht als grüner aktueller Gesamt-Gate ausgewiesen und brauchen weitere Migration auf explizite Freigabe; `npm test` enthält sie weiterhin. Keine Behauptung, diese Legacy-Suiten seien beim Blueprint-Release grün. Die neuen aktiven Tests ersetzen gezielt diesen Ablauf, nicht die unveränderten Sandbox-/Transport-Units.

Migrationsprobe: echte SQLite-Sicherung in isoliertem temporärem Verzeichnis geöffnet; Hashes aller Zeilen in users/sessions/conversations/messages/versions unverändert, neue Tabelle vorhanden, integrity_check=ok. Probe danach entfernt. Rollback `/opt/form/.rollback/20261107-blueprints/` enthält Quellcode/Bundles, beide SQLite-Datenbanken, Providerdatei und pm2-Dump. Bei Code-Rollback kann die additive Tabelle bestehen bleiben; Datenbanken nicht blind über zwischenzeitliche Nutzerdaten zurückkopieren.

Echtes Modell separat getestet: GLM-5.3-Flash, XML-artige Textabschnitte statt fehleranfälliger Plan-JSON-Quotes. Erster Inhalt 22276 ms, vollständiger valider Blueprint 35871 ms; kein Build gestartet, keine Unterhaltung des Benutzers verändert. Anbieterlatenz ist nicht durch die UI garantiert. Z.ai dokumentiert bei GLM-5.3(-Flash) erzwungenes Thinking; kein wirkungsloses „Thinking deaktiviert“ versprechen.

## Historischer Gesamt-Gate vor Blueprint-Umstellung


Testlauf: `npm test` (orchestriert alles: build → unit → mock+server → api → browser).

```
✅ build (esbuild + bridge hash + wasm)
✅ unit tests (contract, stream, models, store/auth, db quotas, QuickJS sandbox)  node --test test/unit.test.mjs
✅ api tests (auth, scoping, models, SSE streaming, retry, stop, CSRF, ui.db)     node --test test/api.test.mjs
✅ browser tests (login, streaming UX, artifact, ui.db, boundary, isolation, mobile)  test/browser.test.cjs
ALL TEST SUITES PASSED
```

Letzter Lauf: 2026-10-31 (v3.2), alle Suiten grün — 23 Unit-Tests (+1 optionaler Real-Ping-Probe), 27 API-Tests, 26 Browser-Checks (node v24, Chromium 153 headless).

Die Browser-Suite bekommt von `run-all.mjs` einen **eigenen Server mit frischem Data-Dir** (die API-Tests registrieren bereits den ersten Owner; sonst wäre der Browser-User kein Owner und dürfte keine Modelle anlegen — genau der gating-Mechanismus, den die API-Tests separat prüfen).

## Fixtures

- `test/mock-provider.mjs` — OpenAI-kompatibler SSE-Stream mit Szenarien (`slider`, `invalid`→`corrected`, prose-only, `slow`, `boundary`, `truncate` (finish_reason=length, abgeschnittenes Artefakt), `errframe` (expliziter Provider-Fehlerframe), `unauthorized` (HTTP 401), `trailingline` (letzte SSE-Zeile ohne Newline), `utf8split` (Multibyte-Char über TCP-Reads getrennt)), `/admin/stats` liefert Aufrufzähler, Disconnects, Auth-Check, letzte Rollen und letzte Messages. Keine echten Keys: `test-key-1234567890`.
- `test/provider.test.mjs` — Unit-Tests des Provider-Transports (`provider.mjs`) gegen Loopback-Upstream: finish_reason=length, fehlerhafte vs. explizite Fehler-Frames, Content-/Transport-Caps (kleine Env-Limits `FORM3_CONTENT_MAX`/`FORM3_TRANSPORT_MAX`), Timeout vs. externer Abort, unabgeschlossene letzte SSE-Zeile, UTF-8-Splits, HTTP-401.

### Retry-Politik (v3.2.1)

- Genau EIN Korrektur-Round, nur bei unvollständigem/ungültigem Artefakt oder `finish_reason=length`. Das Replay an den Provider ist der tatsächliche Assistant-Inhalt (bounded), nie rohe SSE-Hüllen.
- Verbindungsabbrüche (z. B. ECONNRESET/UND_ERR_SOCKET) werden genau einmal automatisch wiederholt, aber nur bevor sichtbarer Antworttext oder ein Artefakt begonnen hat. Bereits ausgeführte Tools werden nicht wiederholt. Wiederholung wird als `retry` mit `code: transport` angezeigt. Auth-/HTTP-Fehler (401/403/429), Grössenlimits und Abbrüche nach sichtbarer Ausgabe werden NICHT wiederholt.
- Gesamt-Budget beider Rounds: `FORM3_CHAT_TIMEOUT_MS` (Default 0 = kein Zeitlimit); ein Round-Timeout (`code: timeout`) ist von Stopp/Disconnect (`code: stopped`) getrennt.
- Server + Mock laufen auf Test-Ports (4598/4599) mit **eigener temporärer Models-Datei** — die echte `form.models.json` wird nie angerührt.

## Abgedeckte Akzeptanzkriterien

**Unit (24 Tests: 23 + 1 optionaler Probe)**
- Render-Contract (Version, Grössen, State) + Fence-Stripping
- System-Prompt enthält Two-Phase- und SVG-Regeln (Text- nach Shapes, stroke-dasharray-Donut, viewBox-Skalierung)
- Stream-Parser: Prosa-only, über Chunk-Grenzen gesplittete Marker, Artefakt im selben Chunk, offener Fence, Holdback ohne Verlust
- Models-Datei: Validierung, Maskierung, chmod 600, ENOENT-Sicherheit
- QuickJS: keine Browser-Globals, kein Function-Escape, CPU-Interrupt
- v3.2 Store: scrypt-Hashes (Salt pro Hash, Timing-safe verify, Garbage safe); erster User=Owner, zweiter=user; Session-Token nur als Hash auffindbar, CSRF rotiert, Reset killt Sessions; Gespräche/Nachrichten/Elemente user-scoped (Bob sieht/ändert nie Alices Daten); History-Fenster + States aus dem Server-Store; refine archiviert + ersetzt; Pins ownership-geprüft; Import validiert malformed Archives ab, regeneriert IDs, remapped Pins/Versionen
- v3.2 Config: Registration default OFF, ENV-Override, ENOENT/unlesbar safe
- v3.2 ui.db-Engine: Lifecycle, where (Wert + IN-Array) + limit, Update-Merge, Delete/Drop 404er, Scoping (Element B sieht nie A's Tabellen), Persistenz über Reopen; harte Quotas: 11. Tabelle 413, 5000 Zeilen dann 413 (Delete gibt Slot zurück), 2 MB Element-Limit bei ~1-KB-Zeilen erreicht, neues Element unbeeinflusst
- System-Prompt dokumentiert ui.db (create/select, DATA-DRIVEN, Quotas, Reload-Persistenz)

**API (27 Tests)**
- v3.2 Auth: Bootstrap/Chat 401 ohne Session; erste Registrierung=Owner, Cookie HttpOnly+SameSite=Strict; doppelte/schlechte Registrierungen 400; Wrong-Password uniform 401 (keine Enumeration); 11. Fehlversuch 429; CSRF session-gebunden (fremdes Token 403, fehlendes 403)
- v3.2 Modelle: Non-Owner sieht nur {id,label,model} (keine baseUrl, kein Key-Mask), add/delete 403
- v3.2 Gespräche: serverseitig angelegt/gelistet; User B sieht 0 Gespräche von A; Chat in A's Conversation 403; frische Login-Session (Gerätewechsel) sieht alles inkl. persisted render; Abort persistiert Fehler-Turn; done liefert user/assistant-Message-IDs; refine ersetzt IN PLACE (kein neues Element, Version archiviert serverseitig); /api/state ownership-geprüft
- v3.2 ui.db über HTTP: Auth-Guards 401/403; CRUD auf ECHTEM Element (create→insert→select→update→delete→drop); User B 403; 16-KB-Zeile 413; 11. Tabelle 413; Drop gibt Slot zurück
- v3.2 Import: Landet serverseitig, malformed 400; Logout invalidiert Session serverseitig
- Bootstrap leer beim Start; CSRF Pflicht für Mutationen
- Modell-Add: Validierung, maskierte Liste, Datei 600, Key nie im Response-Body
- Chat: mehrere `prose-chunk`s **vor** `render`, `done` zuletzt, Key nie im SSE-Body, Bearer-Key upstream korrekt
- Windowed History erreicht den Provider als `system + alternierende` Turns
- Ungültiges Artefakt: **genau ein** retry-Event, Mock-Zähler `invalid +1`, `corrected +1`, danach Erfolg
- Prose-only ohne Artefakt-Events
- Stop: Client-Abort → Disconnect beim Provider (Zähler steigt)
- Anfrage-Validierung (unbekannte Felder/Rollen/States), `form.models.json` wird nicht statisch ausgeliefert
- Nach Modell-Löschung: Chat mit 400 + klarem Text blockiert

**Browser (26 Checks, Chromium headless, reduced-motion + normal)**
- v3.2 Login-Gate: falsches Passwort → Inline-Fehler; erste Registrierung → Owner-Session; Abmelden → Re-Login mit allen Daten; frischer Browser-Kontext (Gerätewechsel) sieht alle Gespräche inkl. persistiertem Element-State; User B: Registrierung, sieht NUR eigene Daten, Import-Angebot migriert alte lokale Gespräche serverseitig
- Empty-State blockt Composer, bis ein Modell existiert
- Modell-Add über UI; Key nur maskiert (`…7890`); Esc schliesst Dialog (Tastatur)
- Prosa streamt **sichtbar** (≥2 wachsende Zwischenstände) bevor das Artefakt fertig ist
- Artefakt interaktiv: Slider ändert Wert, State persistiert SERVERSEITIG und überlebt Reload
- Ungültiges Artefakt: genau eine Korrektur-Notiz, korrigiertes Artefakt rendert
- Prose-only-Antwort ohne Artefakt
- v3.1: Element-Name aus Artefakt-JSON; Pin → Quick-Access → Overlay öffnet/schliesst (iframe wird aufgeräumt)
- v3.1: In-Place-Verfeinerung — Assistant-Message-Anzahl UNVERÄNDERT, Element in place ersetzt (Farbe), alte Version archiviert
- v3.1: Overlay-Versionen (jetzt aus dem SERVER geladen) + Wiederherstellen; Code-Editor: gültige Änderung wirkt, Script/Img/Inline-Handler-Injection identisch bereinigt
- v3.1: `ui.ping` via gemocktem `/api/ping`: public ok (ms+ip im Element gerendert), private 403, Rate-Limit 429
- v3.1: lazy v3→v4-Migration (geseedete v3-Session lädt, Auto-Name «Boundary check.»)
- Sketch-Animation: Element in beiden Modi, `draw`-Animation läuft normal, still bei reduced-motion
- Stop-Button: UI zurück, Provider-Disconnect nachweisbar
- Export + localStorage enthalten **keine** Keys
- v3.2 ui.db über den ECHTEN Server: create/insert/select/update/delete/drop im Element gerendert; Tabelle überlebt Reload; zweites Element sieht sie NICHT (isoliert: Tabelle nicht gefunden); 19-KB-Zeile → Fehler im Element; Drop-Button räumt auf
- v2-Boundary-Regression (per Server-Import geseedet): Scripts/Inline-Handler/meta-refresh/Links/Bilder/SVG-Links/CSS-Imports/URLs blockt (auch im dynamischen `ui.html`-Pfad), `ui.value`-Missbrauch sichtbar, gefälschte resize/Channel-Messages ignoriert, Parent-DOM und Netz im iframe blockiert, CSRF 403, `/form.models.json` 404, null externe Requests
- 390px ohne horizontalen Overflow, Screenshots: `docs/screenshots/{desktop,mobile}.png`
- Keine uncaught JS-Fehler

## v3.3 Hintergrund-Jobs & Scroll-Anker

- `test/jobs.test.mjs` (eigener Server + eigener Data-Dir): zweite Chat-Nachricht wird beantwortet, BEVOR das erste Element fertig ist; zwei Jobs in umgekehrter Reihenfolge auf den richtigen Containern; Cancel (Nachricht erhält nie ein Render); Conversations-Löschung während des Builds (keine Wiederherstellung, Server gesund); **Server-Restart** markiert laufende Jobs ehrlich `failed`, explizites Retry schliesst ab — Provider-Aufrufzähler beweist keinen Doppelstart.
- API-Tests: `element-job`-Event, Job-Snapshot/Stream nur mit Session, fremde User sehen/cancellen nichts (404), Retry-Guardrails (409), Cancel ohne Render.
- Browser: Baustellen-Animation (Kran `lower` läuft, reduced-motion statisch, Phasentext ohne Prozent), Phasen «Denken» (akkumulierendes Drahtgitter) / «Schreiben» (Prose streamt); Reload zeigt denselben Job; Tab schliessen → Server baut fertig → Wiederöffnen zeigt genau ein Element mit genau einem Provider-Aufruf; zweiter Browser desselben Users sieht denselben Job; Cancel pro Container; Mobile 390px inkl. Screenshot `docs/screenshots/site-{desktop,mobile}.png`.
- Scroll-Anker: langer Chat (per Server-Import geseedet), Position Mitte — Enter- und Button-Absendungen halten den Anker (oder die Mitte, wenn der Anker aus dem angezeigten 12-Nachrichten-Fenster rotiert); Position Ende bleibt Ende; 390px gleich. Screenshots wie oben.
- `FORM3_JOB_TEST_DELAYS=1` + `build:<ms>` im Text schalten im Testserver deterministische Build-Dauern frei (siehe ARCHITECTURE).

## Browser-Tests auf deinem Rechner

Benötigen ein Chrome/Chromium (Headless). Erkannt wird CHROME_PATH, dann bekannte Pfade, dann `chromium`/`google-chrome` im PATH. Ohne Chrome: die Browser-Suite wird übersprungen (`SKIP`), unit+api laufen weiter.

## Bekannte Grenzen

- Ein Chat gleichzeitig (bewusst); Test-Suite hält die Reihenfolge ein.
- Mock ersetzt echte Provider-Semantik nicht vollständig (z. B. keine echten Reasoning-Deltas) — Adapter-Kontrakt ist in `ADAPTER.md` dokumentiert.
- `/api/ping`-API-Tests laufen gegen deterministische Injection (`FORM3_PING_FIXTURE=1`, siehe `ping.mjs`); echter `/bin/ping` wird im Real-Smoke auf dem Deployment geprüft (optionaler Unit-Probe via `FORM3_REAL_PING=1`).

## Real-Deployment-Smoke (manuell, mit echtem Modell)

`SMOKE_URL=https://host:9444 SMOKE_USER=... SMOKE_PASS=... node test/smoke.deployed.cjs` — fährt die live App mit dem konfigurierten Modell: Login-Flow als erster Benutzer, datengetriebenes Todo-Element mit `ui.db` (überlebt Reload), In-Place-Verfeinerung (Assistant-Anzahl unverändert), Lab-Shell-Element mit `ui.ping` (echtes `/bin/ping`, Ergebnis im Element), Pin → Quick-Access, Overlay, Logout/Login mit intakten Daten, 390px. Screenshots: `docs/screenshots/smoke-{desktop,mobile}.png`. Teil des Deployments, nicht von `npm test`.

### Sidebar overflow regression (2026-11-07)

`node test/sidebar-layout.test.mjs` seeds 36 chats with pinned elements in an isolated database and checks both sidebar tabs at 1280×800, 390×844 and 390×568. Each row retains at least 40px height, wheel scrolling moves the actual list, and the list stays above the fixed footer. Baseline: desktop list grew to 1774px with zero scrolling; mobile rows shrank to 22px. Fixed: 44px rows in bounded scroll containers on all six cases. Screenshots: `docs/screenshots/sidebar-*-after.png`. Frontend-only deployment requires no restart or interruption of running jobs.

### Accounts/providers/chat deletion (2026-11-07)

Included in `npm test`: `test/accounts.test.mjs`, `test/model-access.test.mjs`, `test/sidebar-layout.test.mjs`. Covers closed public registration after owner setup; owner/admin create-user UI/API and privilege escalation denial; private provider defaults and migration; selected shared provider generating an interactive persisted artifact in another account; cross-user conversation/state/provider/delete denial; hidden keys and password hashes; confirmed chat deletion/reload; cancelling deleted chats; queued model access revoked before execution; normal-provider SSRF DNS pinning and redirect rejection. Mock-provider accounts are isolated and removed after tests. `FORM3_ALLOW_LOCAL_MODELS=1` is set only inside the local fixture, never in production.

Rollback snapshot: `/opt/form/.rollback/20261107-accounts/` contains backend/frontend source, bundle, pm2 dump, coherent pre-release SQLite backup and protected model registry. Restore code and registry together if reverting provider ownership; do not blindly overwrite newer conversation data with the database backup. No SQLite schema change is required by this release.

### Blueprint questions (2026-11-07)

`test/blueprint-questions.test.mjs` validates question schema/caps and overrides optimistic readiness while questions exist. The blueprint browser suite now also verifies two distinct question fields, disabled execute/API rejection, draft after reload, 390px layout, answer submission into a new cumulative revision, removed resolved blocks, and no build before the separate execute action. Screenshots: `docs/screenshots/blueprint-questions-{desktop,mobile}.png`. Real GLM planning smoke (isolated, no account content created): 5 questions, valid bounded format, build blocked, 11865 ms. Migration rehearsed on a fresh production SQLite snapshot with all rows in users/sessions/conversations/messages/versions/blueprints unchanged (excluding additive column questions); integrity_check=ok. Rollback: `/opt/form/.rollback/20261107-blueprint-questions/`.

## Forms/chat/admin release (2026-11-07)

Gate: npm run test:blueprints now includes test/forms.test.mjs and test/forms-flow.test.mjs. Existing blueprint/account/MCP fixtures explicitly opt into mode=plan or click Plan, rather than testing the superseded auto-plan behavior.

New browser/API coverage: normal chat and reusable comparison card with zero blueprints/builds; persisted card after reload; personal library CRUD, version restore and cross-user denials; AI proposal confirmation; explicit plan/build with independent chat during a held build; custom template saved from an owned element and reused with new data without another build; admin reset with old-session invalidation, disable/enable and blocked login, role changes, typed delete confirmation, protected owner/self and admin boundaries. Desktop/mobile screenshots inspected.

Production rehearsal: fresh coherent SQLite copy, unchanged hashes of all old columns in users/sessions/conversations/messages/versions/blueprints, integrity_check=ok; temporary data removed. Rollback /opt/form/.rollback/20261107-forms-chat-admin contains prior code, bundle, both databases, provider registry and pm2 dump. Migrations additive.

Real-provider isolated fixture: first attempt did not meet the prose-plus-card contract; subsequent run with max_tokens=3200 succeeded with GLM-5.3-Flash, first content 11188 ms and complete answer 16311 ms. Chat uses this bounded output budget; latency is not guaranteed. No real user conversation was created by the smoke test. Custom sample id=title was sanitized by the existing DOM-clobbering protection; the browser regression checks the allowed id=value and its actual updated output instead.

## Bugreport acceptance (2026-11-07)
Integrated into forms-flow: submit via browser, own-chat reference validation, persistence across reload, admin status and note updates, foreign reports absent from user list, foreign chat references rejected, unauthenticated and missing-CSRF requests rejected, non-admin status updates denied, HTML displayed as literal text, desktop/mobile screenshots. Migration rehearsal on a fresh production copy preserved all existing users/conversations/messages/versions/blueprints fields and passed integrity_check. Reports do not auto-trigger an agent or forward data externally; admins review in the same dialog.

## Plan accordion (2026-11-07)
node test/plan-fold.test.mjs covers auto-open for questions, collapse on answer submission, per-user/blueprint/revision session persistence, collapsed resolved plans, keyboard reopening, new revision questions reopening, reduced motion and mobile bounds. Existing blueprint integration verifies actual answer submission and explicit build after opening the bar. Presentation-only release; no database or server restart required.

## Element evidence (2026-11-07)
Read-only request-time snapshot, timestamped: up to three rendered elements in the current owned conversation, explicit selected element first, otherwise newest elements; max 100 newest rows/table and 18000 content characters total. Counts, omissions, truncation and unavailable state explicit. No model SQL, writes or other-account queries. Tests cover current DB mutations reflected, isolation, forged selected IDs, count/truncation, selected old element and no database mutation. Forms browser integration sends the reported flame question after inserting a done=true row, and the mock provider asserts that exact stored value arrives. Separate real-model smoke uses synthetic data, not another user account. Snapshot is not continuous screen visibility, and complex computed streak/CSS logic is not automatically evaluated.

Real GLM smoke: correctly reads the synthetic done=true row and no longer asserts zero check-offs. Residual limitation: even with explicit evidence instructions the model still speculates about flame/streak thresholds. No guarantee of hallucination-free rendering explanations; actual screen and computation rules are not evaluated by this read-context feature. Do not describe this as a verified repair of the specific user tracker.

## Forms envelope recovery (2026-11-07)
chat-envelope separates bare or fenced JSON metadata from prose, holds ambiguous streaming prefixes, and keeps library ownership/revision validation in parseChat. Unit tests cover chunk boundaries, uppercase fences, malformed/truncated payloads, foreign IDs and ordinary JSON prose. Original reported saved response tested read-only: three forms recovered and no metadata streamed. Browser suite runs with TEST_BARE_FORMS=1 as well as normal fences. Historical database rows are not rewritten.

## Markdown prose (2026-11-07)
Marked 18.1.3 + DOMPurify allowlist render assistant prose in streaming, restored in-flight and stored-history paths. Browser test covers headings, bold/emphasis/strike, ordered/unordered/task lists, quotes, links, tables, code and partial streams. Raw HTML escaped, images disabled (no tracking fetch), unsafe links removed; no model-controlled styles/IDs/events. Desktop/mobile screenshots inspected. Forms-flow asserts bold markup survives actual chat reload. User messages and generated sandbox artifacts unchanged.

## Build placement — #e56484b7 (2026-11-07)
The blueprint browser fixture pushes the old element outside the last-12 history window, confirms refinement, holds the provider, and verifies one construction site and one element at the new anchor on desktop/mobile and after reload. Completion preserves the stable ID, original prose, version history and interactive state. The extended fixture additionally checks failed build/retry/cancel, pin/element DB retention and foreign DB denial. element-timeline units cover repeated anchors, absent/foreign anchors and presentation without source mutation.
Baseline against pre-release /opt/form with isolated fixture data failed at the missing construction site (placement-before.log); the first corrected placement assertions passed. Release evidence is recorded in docs/test-results/2026-11-07-placement-*.log; deployment and final extended-test result are recorded separately below. The historical npm test gate is still not claimed green.

Final placement release: npm run test:blueprints exit 0 (62 unit tests passed, 1 optional skipped; all browser/integration stages passed), plus standalone Markdown browser suite exit 0. Extended blueprint test passed against deployed /opt/form source and bundle with isolated data, including failed/retried/cancelled builds, stable pin/state/DB and foreign DB denial. Live loopback and Tailnet homepage/auth/bundle 200; CSP verified; bundle SHA256 c7acf11a5c189dc815aa4b6de1b286ab936d00966a2884ed331029add4b76412. Restart performed as form user only after two zero-active-job checks. Rollback /opt/form/.rollback/20261107-build-placement/files.tar plus protected pm2 dump; restore code only, do not revert DB/user data. New src/element-timeline.js can remain inert on rollback.

Version-control consolidation includes reviewed, already-deployed Form runtime changes and corresponding tests/docs that predated this placement run. Unrelated screenshots and live-provider replay evidence remain outside the commit. Push remains blocked by the absent remote; no destination was guessed.

## Activity animation — #74c9b87d (2026-11-07)

`node test/activity.test.mjs` uses isolated accounts and a held mock provider: thinking before first text, live and reload-to-stream transition, Markdown partial text preserved after another reload, one indicator, no duplicate model calls, desktop/390px screenshots, reduced-motion dots AND pseudo-element cursor, completion/cancel/error cleanup and foreign-account prose stream empty. It is included in `npm run test:blueprints`. Baseline failed at missing activity indicator. Reload regression also exposed equal-revision snapshots dropping partial prose; reduced-motion regression exposed the cursor pseudo-element missing the old universal rule. No real provider calls or production account changes.

Authenticated job streams now send bounded absolute chat/plan prose snapshots to their owning user only. Chat partial prose is persisted (max 8000 chars); snapshot merge accounts for prose checkpoints not incrementing the state revision. The live POST stream remains the sole owner of its visible live turn to prevent duplicate text. No construction/approval/ACL or sandbox changes.

Deployment evidence and commit/push state are recorded in the activity test-result files. Rollback directory: /opt/form/.rollback/20261107-activity; restore only its app files and restart as form after checking zero active jobs. Never restore user databases for this code-only release.


## Current-contract editor lifecycle migration (2026-11-08)

node test/editor-lifecycle.test.mjs migrates legacy browser sections 6b/6d/6e into an independent, synthetic-account fixture. At desktop 1280px and mobile 390px it verifies name/pin persistence, opening and closing the overlay, exactly one live interpreter while the overlay is open, invalid state-JSON rejection without a write, acknowledged code/state replacement, persisted reload, server-side version history and restoring original code/state. Script/image/inline-handler injection is stripped both after manual application and reload, with zero external browser requests and page errors. This test uses no provider and modifies no production account or product.

Six browser check groups passed on source and independently against deployed /opt/form modules with disposable data; 13 owner-save/persistence units passed. Screenshots editor-lifecycle-1280.png and editor-lifecycle-390.png were inspected. Dated editor-lifecycle logs and SHA256 manifest retain evidence. Initial fixture failures are preserved: DOMPurify legitimately stripped the clobbering id="title" (fixture renamed to fixture-heading, sanitizer untouched), and destroy() retains inert iframe DOM rather than removing it (acceptance now measures the actual one-live-Worker contract, not DOM absence).

Added to test/run-all.mjs without removing the legacy browser gate. This is test coverage, not a new runtime fix or animation visual acceptance. Full npm test was not rerun here; the previous baseline still fails the old browser entry at #settingsbtn and requires migration of remaining scenarios, including refinement and later network/boundary/cancellation paths. No complete-suite-green claim. Runtime/layout diagnostic evidence and real-provider causal-answer acceptance remain pending. Reports #e89344ad and #a3daf406 remain unresolved.

Production runtime and frontend are unchanged (app SHA256 25b96b5f5910143511e762ae76d9c5fa2e5cd90493a7da37d6cc5a8ea2a02eb6); live auth-status HTTP 200. Only test files and this documentation are synchronized to production, with previous files preserved at /opt/form/.rollback/20261108-editor-tests. No restart, schema, registration, provider or user-data change.


## HTML removal diagnostics (2026-11-08)

Run node test/html-diagnostics.test.mjs (included in run-all). Isolated owner account, no provider: bounded/redacted sanitizer diagnostics and trusted feed/overlay/reload warnings at 1280/390px, allowed interaction still works, artifact unchanged and no network egress. FORM_TEST_ROOT=/opt/form verifies deployed modules with disposable data. FORM_TEST_APP_ROOT selects only the fixture server root for before/after UI reproduction. Dated html-diagnostics logs retain the pre-release missing-warning failure and regression results. This is local initial-HTML feedback, not server HTML preflight, dynamic-fragment warnings, chat runtime telemetry, or full visual certification.
