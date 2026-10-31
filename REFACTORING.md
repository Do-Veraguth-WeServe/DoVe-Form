# Refactoring-Plan — Form v2 Cleanup

Stand: 2026-10-31 · Baseline: Commit `68d6c2d` · Alle Phasen verhaltensneutral.

**Goldene Regel:** Security-Architektur, Limits, UI-Strings und Verhalten werden nicht
verändert — nur Struktur, Lesbarkeit und Tooling. Nach jeder Phase: `npm run build && npm test`.
Vor jedem Deploy auf den Server: zusätzlich `boundary-test.cjs` und `live-test.cjs` gegen die
Tailnet-URL, und `dist/` + `server/` **zusammen** deployen (bridge-hash.txt wird von server.mjs
gelesen und muss zum Bundle passen).

---

## Phase 0 — Fundament (kein Verhalten, sofort machbar)

- [ ] Artefakte aus dem Git entfernen und ignorieren:
      `git rm --cached desktop.png mobile.png live-desktop.png live-mobile.png test-results.json`
      → `.gitignore` ergänzen (`*.png`, `test-results.json`). `live-proof.json` nach
      `docs/evidence/` verschieben (TESTING.md verweist darauf).
- [ ] `.editorconfig` (2 Spaces, LF, UTF-8, final newline).
- [ ] ESLint + Prettier als devDependencies, npm scripts `lint` / `format` / `fmt:check`.
      Prettier-Regel bewusst: printWidth 100 — verhindert, dass je wieder Einzeiler entstehen.
- [ ] Naming klären: Repo `DoVe-Form` ↔ Package `form-private`. Vorschlag: package name
      `dove-form`, version 2.0.x lassen.
- [ ] `README.md` Dev-Quickstart aktualisieren (lokal: install/build/test in 3 Befehlen).

## Phase 1 — Verzeichnisstruktur

- [ ] Zielbild:

```
src/
  app/        main.js, storage.js (normalize/save), api.js (fetch/chat), views.js (render),
              composer.js (send/stop/import/export)
  render/     renderer.js, bridge.js, sanitize.js (DOMPurify + css-tree)
  sandbox/    worker.js (QuickJS)
  shared/     contract.js (systemPrompt, validateRender, parseResponse)  ← von Root
  styles/     app.css (aus index.html extrahiert)
server/       server.mjs (statisch + API), limits.js (alle Magic Numbers gebündelt)
demo/         index.html (Legacy-v1-Demo 1:1, wird nicht gebaut — nur Referenz/Testbasis)
scripts/      build.mjs
test/
  unit/       security.test.mjs
  browser/    demo.test.cjs, boundary.test.cjs, live.test.cjs
docs/         SECURITY.md, ADAPTER.md, TESTING.md, evidence/live-proof.json
```

- [ ] Alle Imports anpassen, `npm run build && npm test` muss grün bleiben.
- [ ] Docs-Pfade in README/TESTING/ADAPTER entsprechend mitziehen.

## Phase 2 — Code lesbar machen (grösster Gewinn)

- [ ] **Alle Einzeiler-Dateien formatieren** (`prettier --write` + händisch in sinnvolle
      Funktionen zerlegen). Keine Logikänderung, keine String-Änderung.
- [ ] `src/app.js` (7 Zeilen → ~300) in die Module aus Phase 1 zerlegen:
      storage/normalize, api-client, render-loop, composer, session-switch.
- [ ] `src/renderer.js` (3 Zeilen → ~200): `bridge()` und `renderUI()` getrennt formatieren,
      Message-Handling benennen (`onResize`, `onReady`, `onOps`, `onEvent`).
- [ ] `server.mjs` (13 Zeilen → ~200): zerlegen in Header/CSP-Setup, Routing-Tabelle,
      Request-Validierung, Rate-Limit, Gateway-Proxy, Error-Handler.
- [ ] **limits.js / limits-Konstanten**: alle Magic Numbers (16 MB Heap, 256 KB Stack,
      150 ms Budget, 3 s Watchdog, 250 Ops, 8 KB/Op, 40 Sessions, 100 Messages, 12 gerendert,
      16 KB Body, 12 req/min, 180 s Timeout, 128/64/24 KB Feld-Limits) an **einer** Stelle
      mit Kommentar *warum* — Werte unverändert. Server und Renderer importieren daraus.
- [ ] Jede Datei: kurzer Header-Kommentar (Zweck + Security-Rolle, Verweis auf SECURITY.md).

## Phase 3 — Build & Tests robuster machen

- [ ] `build.mjs` neu schreiben:
      - String-Replacements (`.replace('INTERAKTIVE DEMO','FORM / LIVE')` …) durch echte
        Template-Platzhalter in einer `src/index.template.html` ersetzen.
      - Hash-Extraktion `bundled.slice(indexOf('function bridge()'),…)` ersetzen: Bridge in
        eigenes Modul `src/render/bridge.js`, Hash über esbuild metafile/chunk des Bundles
        oder eigenen Mini-Bundle-Schritt bilden. Kein String-Slicing mehr.
      - CSS aus `src/styles/app.css` injizieren statt inline im HTML-Template.
- [ ] Browser-Tests lauffähig machen ohne Produktionsserver-Pfade:
      - `playwright-core` als devDependency (statt `/usr/lib/node_modules/openclaw/...`).
      - Chrome-Pfad + Base-URL via env (`CHROME_PATH`, `BASE_URL`) mit Defaults.
      - Live-Test bleibt bewusst manuell/Server-only, aber mindestens auf dem Server
        ohne Code-Änderung lauffähig.
- [ ] Optional: `start`-Script für lokalen Server (`node server/server.mjs` mit env-Config
      und localhost-Socket/TCP für Development).

## Phase 4 — CI & Deployment-Doku

- [ ] GitHub Actions: `npm ci --ignore-scripts && npm run build && npm test && npm run fmt:check`.
      Browser-Tests manuell/markiert ( brauchen Tailnet + echtes Gateway).
- [ ] `docs/DEPLOY.md`: Schritte `/opt/form` sync (server/ + dist/), `pm2 restart form`
      als user form, Verifikation (bootstrap 200, boundary-test, live-test), Rollback
      (bereits in ADAPTER.md vorhanden — verlinken).
- [ ] TESTING.md nach jedem Deployment fortschreiben (Datum + Ergebnisse).

---

## Risiken &_guardrails

- **CSP-Bridge-Hash:** wird pro Build aus dem Bundle berechnet → Reformatieren ist sicher,
  aber `dist/` und `server.mjs` müssen immer zusammen deployt werden.
- **Demo v1 (`index.html`)** wird vom Produktions-Server gar nicht aus diesem Repo geservt
  (liegt unter `/root/.openclaw/workspace/...`, siehe ADAPTER.md Rollback) — im Repo ist sie
  nur Testbasis/Referenz. Deshalb: unangetastet nach `demo/` verschieben, nicht refaktorieren.
- **Keine Grenzwerte anfassen:** Die "hässlichen" Zahlen sind Security-Boundaries. Nur
  bündeln + dokumentieren, niemals Wert ändern.
- Nach jeder Phase commit mit Prefix `refactor(phaseN): …` — einzeln revertsbar.
