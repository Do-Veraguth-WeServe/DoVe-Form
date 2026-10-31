# Testing

Testlauf: `npm test` (orchestriert alles: build → unit → mock+server → api → browser).

```
✅ build (esbuild + bridge hash + wasm)
✅ unit tests (contract, stream parser, models, QuickJS sandbox)   node --test test/unit.test.mjs
✅ api tests (models, masking, SSE streaming, retry, stop, CSRF)   node --test test/api.test.mjs
✅ browser tests (empty state, streaming UX, artifact, boundary, mobile)  test/browser.test.cjs
ALL TEST SUITES PASSED
```

Letzter Lauf: 2026-10-31, alle Suiten grün (node v24, Chromium 153 headless).

## Fixtures

- `test/mock-provider.mjs` — OpenAI-kompatibler SSE-Stream mit Szenarien (`slider`, `invalid`→`corrected`, prose-only, `slow`, `boundary`), `/admin/stats` liefert Aufrufzähler, Disconnects, Auth-Check und letzte Rollen. Keine echten Keys: `test-key-1234567890`.
- Server + Mock laufen auf Test-Ports (4598/4599) mit **eigener temporärer Models-Datei** — die echte `form.models.json` wird nie angerührt.

## Abgedeckte Akzeptanzkriterien

**Unit (9 Tests)**
- Render-Contract (Version, Grössen, State) + Fence-Stripping
- System-Prompt enthält Two-Phase- und SVG-Regeln (Text- nach Shapes, stroke-dasharray-Donut, viewBox-Skalierung)
- Stream-Parser: Prosa-only, über Chunk-Grenzen gesplittete Marker, Artefakt im selben Chunk, offener Fence, Holdback ohne Verlust
- Models-Datei: Validierung, Maskierung, chmod 600, ENOENT-Sicherheit
- QuickJS: keine Browser-Globals, kein Function-Escape, CPU-Interrupt

**API (12 Tests)**
- Bootstrap leer beim Start; CSRF Pflicht für Mutationen
- Modell-Add: Validierung, maskierte Liste, Datei 600, Key nie im Response-Body
- Chat: mehrere `prose-chunk`s **vor** `render`, `done` zuletzt, Key nie im SSE-Body, Bearer-Key upstream korrekt
- Windowed History erreicht den Provider als `system + alternierende` Turns
- Ungültiges Artefakt: **genau ein** retry-Event, Mock-Zähler `invalid +1`, `corrected +1`, danach Erfolg
- Prose-only ohne Artefakt-Events
- Stop: Client-Abort → Disconnect beim Provider (Zähler steigt)
- Anfrage-Validierung (unbekannte Felder/Rollen/States), `form.models.json` wird nicht statisch ausgeliefert
- Nach Modell-Löschung: Chat mit 400 + klarem Text blockiert

**Browser (16 Checks, Chromium headless, reduced-motion + normal)**
- Empty-State blockt Composer, bis ein Modell existiert
- Modell-Add über UI; Key nur maskiert (`…7890`); Esc schliesst Dialog (Tastatur)
- Prosa streamt **sichtbar** (≥2 wachsende Zwischenstände) bevor das Artefakt fertig ist
- Artefakt interaktiv: Slider ändert Wert, State überlebt Reload
- Ungültiges Artefakt: genau eine Korrektur-Notiz, korrigiertes Artefakt rendert
- Prose-only-Antwort ohne Artefakt
- v3.1: Element-Name aus Artefakt-JSON; Pin → Quick-Access → Overlay öffnet/schliesst (iframe wird aufgeräumt)
- v3.1: In-Place-Verfeinerung — Assistant-Message-Anzahl UNVERÄNDERT, Element in place ersetzt (Farbe), alte Version archiviert (Schema v4)
- v3.1: Overlay-Versionen + Wiederherstellen; Code-Editor: gültige Änderung wirkt, Script/Img/Inline-Handler-Injection identisch bereinigt
- v3.1: `ui.ping` via gemocktem `/api/ping`: public ok (ms+ip im Element gerendert), private 403, Rate-Limit 429
- v3.1: lazy v3→v4-Migration (geseedete v3-Session lädt, Auto-Name «Boundary check.»)
- Sketch-Animation: Element in beiden Modi, `draw`-Animation läuft normal, still bei reduced-motion
- Stop-Button: UI zurück, Provider-Disconnect nachweisbar
- Export + localStorage enthalten **keine** Keys
- v2-Boundary-Regression: Scripts/Inline-Handler/meta-refresh/Links/Bilder/SVG-Links/CSS-Imports/URLs blockt (auch im dynamischen `ui.html`-Pfad), `ui.value`-Missbrauch sichtbar, gefälschte resize/Channel-Messages ignoriert, Parent-DOM und Netz im iframe blockiert, CSRF 403, `/form.models.json` 404, null externe Requests
- 390px ohne horizontalen Overflow, Screenshots: `docs/screenshots/{desktop,mobile}.png`
- Keine uncaught JS-Fehler

## Browser-Tests auf deinem Rechner

Benötigen ein Chrome/Chromium (Headless). Erkannt wird CHROME_PATH, dann bekannte Pfade, dann `chromium`/`google-chrome` im PATH. Ohne Chrome: die Browser-Suite wird übersprungen (`SKIP`), unit+api laufen weiter.

## Bekannte Grenzen

- Ein Chat gleichzeitig (bewusst); Test-Suite hält die Reihenfolge ein.
- Mock ersetzt echte Provider-Semantik nicht vollständig (z. B. keine echten Reasoning-Deltas) — Adapter-Kontrakt ist in `ADAPTER.md` dokumentiert.
- `/api/ping`-API-Tests laufen gegen deterministische Injection (`FORM3_PING_FIXTURE=1`, siehe `ping.mjs`); echter `/bin/ping` wird im Real-Smoke auf dem Deployment geprüft (optionaler Unit-Probe via `FORM3_REAL_PING=1`).

## Real-Deployment-Smoke (manuell, mit echtem Modell)

`SMOKE_URL=https://host:9444 node test/smoke.deployed.cjs` — fährt die live App mit dem konfigurierten Modell: Lab-Shell-Element mit `ui.ping` (echtes `/bin/ping`, Ergebnis im Element), In-Place-Verfeinerung (Assistant-Anzahl unverändert), Pin → Quick-Access, Overlay, 390px. Screenshots: `docs/screenshots/smoke-{desktop,mobile}.png`. Teil des Deployments, nicht von `npm test`.
