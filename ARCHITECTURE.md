# Architektur

## Aktueller Blueprint-Vertrag (2026-11-07)

`POST /api/chat` erstellt ausschliesslich `kind=plan`-Jobs. `blueprints.mjs` gibt ein begrenztes Planungsformat vor; der Runner streamt nur den Antwortteil und speichert erst den vollständig validierten kumulativen Plan. Keine Tools und kein Render-Attachment im Planungszweig. SQLite `blueprints` speichert unveränderliche Revisionen pro Gespräch mit Ziel, Modell, zugehöriger Nachricht und genau einem bestätigten Job.

`POST /api/blueprints/execute` prüft Session/Origin/CSRF, Eigentümer, aktuelle Revision, offene Planung, Bereitschaft und aktuelle Modellberechtigung. Start und Blueprint-Zuordnung erfolgen atomar; erneutes Klicken liefert denselben Job. Build-Kontext enthält ausschliesslich den bestätigten Blueprint-Snapshot und ggf. die aktuelle Zielversion mit CAS-Hash. Alte unbestätigte Jobs können nicht per Retry neu bauen. Alle neuen Änderungen brauchen wieder eine explizite Bestätigung.

Planungs- und Baukapazität werden getrennt begrenzt (2 Planungen global; Bauten wie bisher konfiguriert). Pro Gespräch läuft höchstens eine Planung; sie blockiert keinen laufenden Bau. Pläne überleben Reload/Neustart; ein beim Neustart laufender Job wird wie bisher ehrlich fehlgeschlagen markiert. Neue Tabelle ist additiv, Altdaten bleiben erhalten. Historische Ablaufbeschreibungen unten gelten für den Build-Transport, nicht mehr für die automatische Erzeugung aus Chatnachrichten.


```
Browser (127.0.0.1:5177; Production via tailscale serve :9444, HTTPS)
└── index.html + dist/app.js          UI: Login, Sessions, Streaming, Settings-Dialog
    ├── dist/worker.js                QuickJS-WASM-Interpreter (ui.* API inkl. ui.db)
    └── iframe (srcdoc, sandbox)      opaker Renderer für Artefakt-HTML/CSS
            └── privater MessageChannel zwischen iframe-Bootstrap und Worker-Host

server.mjs (node, nur 127.0.0.1)
├── Statisch: /, /app.js, /worker.js, /quickjs.wasm   (aus dist/, explizite Datei-Map)
├── /api/auth/*      register (nur solange kein User ODER Config-Flag) / login /
│                    logout / status — scrypt, Session-Cookie, session-gebundenes CSRF
├── /api/bootstrap   Version, User, Session-CSRF, Modellliste (Owner maskiert, sonst Namen)
├── /api/models      POST add / DELETE (Owner-only) / GET — Datei: form.models.json (chmod 600)
├── /api/conversations  GET list / POST create / DELETE — alles user-scoped
├── /api/state       Element-State (ui.persist) ODER voller Render (Code-Editor/Restore)
├── /api/pin         Element anpinnen/lösen (max 40/User)
├── /api/import      Archiv-Import — Server validiert + regeneriert alle IDs
├── /api/db          ui.db: strukturierte Tabellen-Ops, Ownership+Rate serverseitig
├── /api/ping        ICMP über /bin/ping (10/Minute/User)
└── /api/chat (SSE)  Proxy zum Provider, two-phase Parsing, Retry, Server-Persistenz
        └── POST {baseUrl}/chat/completions  (stream:true, Bearer apiKey)

data/ (ein Backup-Verzeichnis)
├── form.db          SQLite: users → sessions → conversations → messages → versions
└── elements.sqlite  ui.db-Tabellen, physisch namespaced per Element (db.mjs)
```

## Datenfluss einer Antwort

1. Client sendet `POST /api/chat` mit Text + sessionId (Conversation-ID). Session/CSRF/Ownership werden vorab geprüft; **History (letzte 12) und Zustände (letzte 3) lädt der Server aus seinem eigenen Store** — nicht mehr aus dem Client.
2. Der Server persistiert die User-Message, baut `[system, ...history, user]` (Consecutive-Rollens werden gemerged) und ruft den Provider **streaming** auf.
3. `stream.mjs` (inkrementeller Parser) erkennt live: Prosa vs. genau einen ```` ```json ````-Fence. Robust gegen Marker, die über Chunk-Grenzen splittern.
4. Der Server relayt per SSE: `prose-chunk` → `artifact-start` → `render` → `retry` → `error` → `done`.
5. Ungültiges Artefakt (kein validierbares JSON/Render) → **genau ein** Korrektur-Lauf (Assistent+Korrektur-Anweisung als zweite Upstream-Runde), dessen Prosa/Artefakt erneut gestreamt wird. Bleibt es ungültig: `error`, Prosa bleibt erhalten.
6. Client validiert `render` erneut (`validateRender`) und übergibt es der v2-Renderer-Pipeline.

## Hintergrund-Jobs für Elemente (v3.3)

Element-Abschluss ist kein Bestandteil der Chat-Antwort mehr: Der Chat-Stream endet mit `element-job` (Job-ID, Zustand `queued`), gebunden an User/Coverstation/Message. `jobs.mjs` (`JobRunner`) baut mit begrenzter Parallelität (Standard 2 global, 2 pro User) in einer echte Zustandskette `queued → building → validating → ready` (oder `cancelled`/`failed`) fertig; die Completion ist EINE synchrone SQLite-Transaktion — Abbrechen und Löschungen gewinnen immer gegen späte Ergebnisse, kein Teil-HTML, keine Wiederherstellung gelöschter Elemente.

- Persistenz: additive Tabelle `jobs` in `data/form.db` (Migration: CREATE TABLE IF NOT EXISTS; Rollback: `DROP TABLE jobs` — Nachrichten/Elemente bleiben unberührt, fertiggestellte Elemente hängen an `messages.render`).
- Der Job speichert das bereits validierte Render; Retry baut NUR daraus neu — **kein zweiter Provider-Aufruf** (auch nicht nach Server-Restart: unterbrochene Jobs werden beim Start ehrlich als `failed` markiert, Wiederholen ist explizit).
- Endpunkte: `GET /api/jobs` (Snapshot), `GET /api/jobs/stream` (SSE: Snapshot zuerst, dann Live-Events mit monotoner `rev` — Reconnect reconciliert lückenlos), `POST /api/jobs/cancel`, `POST /api/jobs/retry` (nur `failed`; alles session- + CSRF-geschützt und user-scoped, 404 ohne Existenz-Leak).
- Client: Baustellen-Container pro Nachricht (Create) bzw. unter dem Original (Refinement — Original bleibt bis zum atomaren Tausch). Phasentexte werden in-place gepatcht; Rendern passiert nur bei Strukturwechsel, damit laufende Sandbox-Worker nicht zerlegt werden.
- Test-Hook (nur Tests, env-gegate): `FORM3_JOB_TEST_DELAYS=1` + Marker `build:<ms>` im Chat-Text bzw. `FORM3_JOB_BUILD_MS` für deterministisch langsame Builds. Produktiv ignoriert.

## SSE-Protokoll (Server → Browser)

| Event | Payload | Bedeutung |
|---|---|---|
| `prose-chunk` | `{text}` | Prosa-Anteil, live |
| `artifact-start` | `{}` | ```json-Fence geöffnet |
| `render` | `{render}` | validiertes Artefakt `{version:1,html,css,js,state}` |
| `retry` | `{reason}` | Artefakt ungültig, ein Korrekturversuch läuft |
| `error` | `{message}` | Abbruch/Timeout/Upstream-Fehler |
| `done` | `{requestId, userMessageId, assistantMessageId}` | Abschluss mit Server-IDs (`assistantMessageId: null` bei In-Place-Verfeinerung) |

Stop = Client bricht den fetch ab → Server sieht `res.close` → `AbortController` killt die Upstream-Verbindung. Der Server persistiert den Abbruch als Fehler-Turn; der Client sync't danach vom Server (`syncFromServer`). Erfolgreiche Runden: refine ersetzt das Element serverseitig (`replaceRender`, alte Version → versions-Tabelle, max 5), normale Runden hängen die Assistant-Message an — der Client übernimmt die IDs aus `done`.

## Accounts & Persistenz (v3.2)

- **store.mjs** (`data/form.db`, WAL, FK-Kaskaden): `users(id, username, pw_hash, role)`, `sessions(token_hash, csrf, expires)` — Token 256-bit, nur als SHA-256-Hash gespeichert, 30 Tage gleitend; `conversations`/`messages(seq, role, text/prose/error/render, pinned)`; `versions(message_id, seq, render)`. Erster User = `owner`. scrypt (N=16384,r=8,p=1, 16-Byte-Salt) + `timingSafeEqual`; unbekannte User bekommen einen Dummy-Vergleich (Timing flat).
- **Login**: 10 Fehlversuche / 5 Min pro username+Client → 429; nie User-Enumeration. Cookie `form3sess` HttpOnly+SameSite=Strict, `Secure` hinter HTTPS-Ingress (`X-Forwarded-Proto: https` — tailscale serve setzt das). CSRF ist **session-gebunden** (Rotation bei jedem Login); Mutationen ohne passenden Header → 403.
- **Registrierung**: erlaubt solange kein User existiert (Bootstrap) oder `form.config.json {"registration":true}` / ENV `FORM3_REGISTRATION=1`. API-Key-Verwaltung (Modelle) nur Owner.
- **Client**: localStorage (`form.v3`, Schema v4) ist Cache; Server ist Source of Truth. Erster Login mit lokalen Alt-Gesprächen → Import-Bar (`/api/import`, Server regeneriert IDs, remapped Pins/Versionen). Logout löscht Cache + Session.
- **Quotas/Rates pro User**: 40 Gespräche à 100 Nachrichten, 40 Pins, 1 gleichzeitiger Chat + 30/Min, 10 Pings/Min, 120 DB-Ops/Min (`FORM3_DB_RATE` überschreibt für Tests).

## ui.db (persistente Element-Tabellen)

- Sandbox-API (Async-Callback-Stil wie `ui.ping`): `ui.db.create(table, columns?, cb)`, `insert(table,row,cb)→{ok,id}`, `select(table,{where,limit},cb)→{ok,rows}`, `update(table,id,patch,cb)→{ok}`, `delete(table,id,cb)→{ok}`, `drop(table,cb)`. Werte JSON-safe (Objekte/Arrays erlaubt), Zeilen ≤16 KB.
- Bridge: Worker emit't `{op:"db",dbop,table,args,ref}` → Renderer validiert (Op-/Tabellen-Whitelist) → App hängt **serverseitig die Element-Identität an** (`m.id` + aktuelle Conversation — Gast-Code wählt sie nie selbst) → `POST /api/db` → Ergebnis als synthetisches Event an den Worker-Callback. Queue-Max 8 parallel.
- Server (`db.mjs`): EINE `elements.sqlite`; physische Tabellen heissen `e_<sha256(convId:elementId)[0:24]>_<table>` — Scoping ist strukturell (Element B kommt an A's physische Tabelle nie heran), zusätzlich prüft der Handler User-Ownership der Element-Message. Meta-Tabelle führt Zeilen-/Byte-Zähler für Quota-Checks in Transaktionen. Statuscodes: 400 validierung, 404 Tabelle/Zeile fehlt, 409 doppelt, 413 Quota (alle landen im Callback als `{ok:false,error}`). Conversation-Löschen purgt die Tabellen des Elements.

## Elements v3.1 (Benennung, Pinning, Overlay, In-Place-Verfeinerung)

- Artefakt-JSON: optionales `name` (Text ≤ 80, bereinigt); Fallback über `deriveName` (erste Überschrift, sonst Prosa-Schnipsel). Alte v3-Renders werden lazy beim Anzeigen benannt.
- Schema v4 (`form.v3`-Key bleibt, jetzt Cache): `elements:{pins:[msgId], versions:{msgId:[{at,render}]}}` (max 5/Element). Serverseitig spiegeln `messages.pinned` und die `versions`-Tabelle dasselbe. Normalize akzeptiert v3 und v4; Message-IDs bleiben stabil (Pins/Versionen hängen daran).
- Pro Element: Kopfzeile mit Name (Markieren), Pin (★/☆, Quick-Access-Leiste über dem Composer) und ↗ (Overlay). Overlay: Vollbild-Render (gleiche renderUI-Pipeline), «Mit KI bearbeiten» (markiert + Fokus), «Code bearbeiten» (HTML/CSS/JS/State-Textfelder; Apply läuft durch validateRender + safeHTML/safeCSS — identisch bereinigt/abgelehnt wie Modell-Ausgaben), «Versionen» (letzte 5, Wiederherstellen).
- In-Place-Verfeinerung: Chat-Request bekommt optionales `refineTarget {id,name,html,css,js,state}` (Caps 32k/12k/32k/4k, Body-Limit 120 KB); Server hängt den Element-Code als `[marked-element]` (untrusted data) an die User-Message und ergänzt den Systemprompt um eine full-update-Anweisung. Der Client ersetzt das markierte Element (alte Version → Verlauf), fügt keine neue Assistant-Message an; Abort/Fehler lassen das Original unberührt.

## ui.ping (einzige Netzwerk-Primitive für Elemente)

- Sandbox-API `ui.ping(host, callback)`: Bridge schickt `{op:"ping"}` an die App; die App ruft `POST /api/ping` (CSRF/Origin/JSON wie Chat) auf; das Ergebnis wird als synthetisches Event an den Worker zurückgeliefert (Callback bekommt `{host, ok, ip, ms}` bzw. `{ok:false, error}`). Queue-Max 8, Ungültige Hosts sofort `ok:false`.
- Server (`ping.mjs`): strikter Hostname (≥2 Labels, keine IP-Literale/URLs/Ports, keine rein numerischen TLDs), DNS-Auflösung aller A/AAAA, jede Adresse gegen private/reservierte Bereiche (net.BlockList, v4+v6 inkl. IPv4-mapped per Fallback — `::ffff:0:0/96` darf NICHT in die BlockList, sonst sperrt es alles IPv4), dann `execFile('/bin/ping',['-c','1','-W','2',ip])` mit Timeout. Antwort `{ok,ip,ms}` / `{ok:false,error}`; 403 bei blockierten Ranges, 400 bei invalidem Host, 429 bei >10 Pings/Minute/Session; jeder Ping geloggt (`[ping] session host ip ok`). Kein fetch, keine Sockets, kein exec aus Elementen — die Sandbox bleibt netzfrei.

## Mobile Touch-Weiterleitung

Der vertrauenswürdige iframe-Bootstrap leitet vertikale Einfinger-Gesten nur bei Inline-Elementen im Chat über den privaten MessageChannel an den app-eigenen Feed weiter. screen-Koordinaten verhindern Rückkopplung durch das mitbewegte iframe. Ein Delta ist auf 160 px begrenzt; nur echte Browser-Touchereignisse werden verarbeitet. Horizontale Gesten, Taps und das Vollbild-Overlay behalten ihr natives Verhalten. Weder generiertes JS noch globale postMessage-Aufrufe erhalten eine Scroll-API.

## Renderer-Pipeline (portiert aus v2, unveränderte Security-Eigenschaften)

- **QuickJS-Worker** (`src/worker.js`): 16 MB Heap, 256 KB Stack, Interrupt-Deadline pro Evaluation, Op-Budget 250, Grössenlimits pro Op. Generiertes JS bekommt *nur* `state` + `ui.*` (text/value/html/attr/on/persist/suggest/ping/db) — keine Browser-Objekte; `ping`/`db` laufen als op über die App (authentifizierter Server-Call), nicht im Sandbox-Netz.
- **Sanitizer** (`src/sanitize.js`): DOMPurify-Positivliste; CSS über css-tree ohne URLs/@rules/Positions-Eigenschaften; `safeFragment` macht SVG-Fragmente namespace-bewusst (zweiter Pass in `<svg>`-Kontext, Flatten, Wahl html vs. svg anhand `namespaceURI`).
- **Opaker iframe** (`src/renderer.js`): `sandbox="allow-scripts"`, eigener CSP-Nonce, kein Netz, kein Parent-DOM; Kommunikation nur über verifizierten MessageChannel; Resize begrenzt; Missbrauch von `ui.value` auf Containern wird sichtbar bemängelt statt still ignoriert.
- **Seiten-CSP** erlaubt inline im srcdoc nur den exakten Bootstrap-Code (sha256 aus `dist/bridge-hash.txt`, beim Build berechnet).

## Modellverwaltung

`form.models.json`: `{models:[{id,label,baseUrl,model,apiKey,added}]}` — atomar geschrieben (tmp+rename), chmod 600. Antworten maskieren Keys (`…1234`). Base-URL-Normalisierung: `/chat/completions` wird ergänzt, falls fehlt. Löschen entfernt den Eintrag sofort aus Datei und Speicher.

## Zwei-Phasen-Prompt (Kernpunkte)

1. Erst 2–6 Sätze klare Prosa (kein Fence) — Prosa-only ist vollständige Antwort.
2. Dann höchstens EIN ```json-Artefakt `{version:1,html,css,js,state}`, zuletzt.
3. SVG-Regeln: Shapes zuerst, **alle** Texte/Labels danach (Donut-Bug-Fix); Donut via `circle`-Strokes + `stroke-dasharray`, Prozent in der Mitte als **letztes** Element; Charts in viewBox skalieren; schlankes CSS.

## Grenzen

- Ein Chat gleichzeitig pro User (429 mit klarem Text), 30 Chats/Minute/User, kein standardmässiges Generierungs-Zeitlimit, Upstream auf 300 KB begrenzt.
- Verlaufsfenster 12 Nachrichten / Zustände 3 — bewusst (Kontext-Kosten, Disclosed in UI).
- Der Interpreter isoliert Logik, ist aber keine GPU/Layout-Isolation; CSP verhindert Netz/Navigation im Renderer.
- Lokal ohne HTTPS: Cookie ohne `Secure` (nur loopback); hinter tailscale serve wird HTTPS erkannt und `Secure` gesetzt. CSRF + Origin-Checks gelten immer.

## Expliziter Chat / Plan und Formen

/api/chat kennt mode=chat (Default) und mode=plan. Chatjobs nutzen einen kurzen Gesprächsvertrag und optional abschliessende JSON-Metadaten für bekannte Formen; keine Toolausführung, keine Render-Anlage, keine Blueprint-Persistenz. Bestehender Parser hält Metadaten vom sichtbaren Prosastream fern. Formen-Ausgaben werden serverseitig typ-/grössenbegrenzt und nur gegen eigene verfügbare IDs aufgelöst. Der Renderer setzt Standardkarten ausschliesslich über textContent/app-eigene DOM-Controls um. Eigene Vorlagen bleiben im QuickJS-/iframe-Sandboxpfad.

SQLite forms / form_versions / form_seeds / form_acceptances gehören Benutzern. Die Library wird einmalig pro Konto mit sechs Standards initialisiert; gelöschte Standards erscheinen nicht wieder. Updates sind revisionsgeprüft und mit Versionsjournal in einem Savepoint atomar. Bestätigte KI-Vorschläge sind pro message_id/index idempotent. Gesendete Formen speichern ihren Snapshot in messages.forms und ändern sich nicht rückwirkend bei Library-Updates. Der Modellprompt enthält keine Vorlagencodes, nur IDs/Layout/Einsatzregeln und bei eigenen Vorlagen Beispieldaten. Jobkontexte enthalten ebenfalls keine Vorlagencodes; die vor Ausführung referenzierten Revisionen werden vor Übernahme verglichen.

Neue APIs: /api/forms (list), /save, /remove, /versions, /restore, /accept, /state. Alle mutations sind session-/CSRF-/Origin-gebunden; keine fremden Formen-/Nachrichten-IDs. /api/admin/users/action bietet reset/disable/role/delete mit serverseitigem Rollen- und Selbstschutz. users.disabled sperrt Login und bestehende Sessionauflösung. Offene SSE-Streams prüfen widerrufene Sessions erneut.

## Build timeline projection
Blueprint execution now appends a message anchor for both create and refine jobs. Refine still replaces the original render atomically under its stable ID, and writes build prose on the anchor rather than overwriting historical prose. Snapshot renderPositionId is derived only from ready refinement jobs in each owned conversation. elementTimeline projects the single original element onto that anchor (or a current active refinement anchor) before applying the visible-history window. State/DB/actions/pins remain bound to the original object and ID. Failed/cancelled jobs do not supersede the last successful position. No schema migration, user artifact rewrite or new grants.
