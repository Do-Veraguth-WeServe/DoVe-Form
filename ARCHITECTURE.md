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

## Renderer-Pipeline (portiert aus v2, unveränderte Security-Eigenschaften)

- **QuickJS-Worker** (`src/worker.js`): 16 MB Heap, 256 KB Stack, Interrupt-Deadline pro Evaluation, Op-Budget 250, Grössenlimits pro Op. Generiertes JS bekommt *nur* `state` + `ui.*` (text/value/html/attr/on/persist/suggest) — keine Browser-Objekte.
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
