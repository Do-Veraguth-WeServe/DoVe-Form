# Architektur

```
Browser (127.0.0.1:5177)
└── index.html + dist/app.js          UI: Sessions, Streaming, Settings-Dialog
    ├── dist/worker.js                QuickJS-WASM-Interpreter (ui.* API)
    └── iframe (srcdoc, sandbox)      opaker Renderer für Artefakt-HTML/CSS
            └── privater MessageChannel zwischen iframe-Bootstrap und Worker-Host

server.mjs (node, nur 127.0.0.1)
├── Statisch: /, /app.js, /worker.js, /quickjs.wasm   (aus dist/, explizite Datei-Map)
├── /api/bootstrap   Version, CSRF-Token, maskierte Modellliste
├── /api/models      POST add / DELETE / GET — Datei: form.models.json (chmod 600)
└── /api/chat (SSE)  Proxy zum konfigurierten Provider, two-phase Parsing, Retry
        └── POST {baseUrl}/chat/completions  (stream:true, Bearer apiKey)
```

## Datenfluss einer Antwort

1. Client sendet `POST /api/chat` mit Text, Fenster-Verlauf (letzte 12) und letzten 3 Zuständen.
2. Server baut `[system, ...history, user]` (Consecutive-Rollens werden gemerged) und ruft den Provider **streaming** auf.
3. `stream.mjs` (inkrementeller Parser) erkennt live: Prosa vs. genau einen ```` ```json ````-Fence. Robust gegen Marker, die über Chunk-Grenzen splittern.
4. Der Server relayt per SSE: `prose-chunk` → `artifact-start` → `render` → `retry` → `error` → `done`.
5. Ungültiges Artefakt (kein validierbares JSON/Render) → **genau ein** Korrektur-Lauf (Assistent+Korrektur-Anweisung als zweite Upstream-Runde), dessen Prosa/Artefakt erneut gestreamt wird. Bleibt es ungültig: `error`, Prosa bleibt erhalten.
6. Client validiert `render` erneut (`validateRender`) und übergibt es der v2-Renderer-Pipeline.

## SSE-Protokoll (Server → Browser)

| Event | Payload | Bedeutung |
|---|---|---|
| `prose-chunk` | `{text}` | Prosa-Anteil, live |
| `artifact-start` | `{}` | ```json-Fence geöffnet |
| `render` | `{render}` | validiertes Artefakt `{version:1,html,css,js,state}` |
| `retry` | `{reason}` | Artefakt ungültig, ein Korrekturversuch läuft |
| `error` | `{message}` | Abbruch/Timeout/Upstream-Fehler |
| `done` | `{requestId}` | Abschluss |

Stop = Client bricht den fetch ab → Server sieht `res.close` → `AbortController` killt die Upstream-Verbindung.

## Elements v3.1 (Benennung, Pinning, Overlay, In-Place-Verfeinerung)

- Artefakt-JSON: optionales `name` (Text ≤ 80, bereinigt); Fallback über `deriveName` (erste Überschrift, sonst Prosa-Schnipsel). Alte v3-Renders werden lazy beim Anzeigen benannt.
- localStorage-Schema v4 (`form.v3`-Key bleibt): `elements:{pins:[msgId], versions:{msgId:[{at,render}]}}` (max 5/Element, global ~3 MB getrimmt). Normalize akzeptiert v3 und v4; Message-IDs bleiben über Reloads stabil (Pins/Versionen hängen daran).
- Pro Element: Kopfzeile mit Name (Markieren), Pin (★/☆, Quick-Access-Leiste über dem Composer) und ↗ (Overlay). Overlay: Vollbild-Render (gleiche renderUI-Pipeline), «Mit KI bearbeiten» (markiert + Fokus), «Code bearbeiten» (HTML/CSS/JS/State-Textfelder; Apply läuft durch validateRender + safeHTML/safeCSS — identisch bereinigt/abgelehnt wie Modell-Ausgaben), «Versionen» (letzte 5, Wiederherstellen).
- In-Place-Verfeinerung: Chat-Request bekommt optionales `refineTarget {id,name,html,css,js,state}` (Caps 32k/12k/32k/4k, Body-Limit 120 KB); Server hängt den Element-Code als `[marked-element]` (untrusted data) an die User-Message und ergänzt den Systemprompt um eine full-update-Anweisung. Der Client ersetzt das markierte Element (alte Version → Verlauf), fügt keine neue Assistant-Message an; Abort/Fehler lassen das Original unberührt.

## ui.ping (einzige Netzwerk-Primitive für Elemente)

- Sandbox-API `ui.ping(host, callback)`: Bridge schickt `{op:"ping"}` an die App; die App ruft `POST /api/ping` (CSRF/Origin/JSON wie Chat) auf; das Ergebnis wird als synthetisches Event an den Worker zurückgeliefert (Callback bekommt `{host, ok, ip, ms}` bzw. `{ok:false, error}`). Queue-Max 8, Ungültige Hosts sofort `ok:false`.
- Server (`ping.mjs`): strikter Hostname (≥2 Labels, keine IP-Literale/URLs/Ports, keine rein numerischen TLDs), DNS-Auflösung aller A/AAAA, jede Adresse gegen private/reservierte Bereiche (net.BlockList, v4+v6 inkl. IPv4-mapped per Fallback — `::ffff:0:0/96` darf NICHT in die BlockList, sonst sperrt es alles IPv4), dann `execFile('/bin/ping',['-c','1','-W','2',ip])` mit Timeout. Antwort `{ok,ip,ms}` / `{ok:false,error}`; 403 bei blockierten Ranges, 400 bei invalidem Host, 429 bei >10 Pings/Minute/Session; jeder Ping geloggt (`[ping] session host ip ok`). Kein fetch, keine Sockets, kein exec aus Elementen — die Sandbox bleibt netzfrei.

## Renderer-Pipeline (portiert aus v2, unveränderte Security-Eigenschaften)

- **QuickJS-Worker** (`src/worker.js`): 16 MB Heap, 256 KB Stack, Interrupt-Deadline pro Evaluation, Op-Budget 250, Grössenlimits pro Op. Generiertes JS bekommt *nur* `state` + `ui.*` (text/value/html/attr/on/persist/suggest/ping) — keine Browser-Objekte; `ping` läuft als op über die App, nicht im Sandbox-Netz.
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

- Ein Chat gleichzeitig (429 mit klarem Text), 30 Chats/Minute, 180 s Timeout, Upstream auf 300 KB begrenzt.
- Verlaufsfenster 12 Nachrichten / Zustände 3 — bewusst (Kontext-Kosten, Disclosed in UI).
- Der Interpreter isoliert Logik, ist aber keine GPU/Layout-Isolation; CSP verhindert Netz/Navigation im Renderer.
- Kein HTTPS nötig (nur localhost); trotzdem CSRF + Origin-Checks gegen Cross-Site-Requests anderer Tabs.
