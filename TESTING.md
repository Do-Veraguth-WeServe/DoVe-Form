# Testing

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

- `test/mock-provider.mjs` — OpenAI-kompatibler SSE-Stream mit Szenarien (`slider`, `invalid`→`corrected`, prose-only, `slow`, `boundary`), `/admin/stats` liefert Aufrufzähler, Disconnects, Auth-Check und letzte Rollen. Keine echten Keys: `test-key-1234567890`.
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

## Browser-Tests auf deinem Rechner

Benötigen ein Chrome/Chromium (Headless). Erkannt wird CHROME_PATH, dann bekannte Pfade, dann `chromium`/`google-chrome` im PATH. Ohne Chrome: die Browser-Suite wird übersprungen (`SKIP`), unit+api laufen weiter.

## Bekannte Grenzen

- Ein Chat gleichzeitig (bewusst); Test-Suite hält die Reihenfolge ein.
- Mock ersetzt echte Provider-Semantik nicht vollständig (z. B. keine echten Reasoning-Deltas) — Adapter-Kontrakt ist in `ADAPTER.md` dokumentiert.
- `/api/ping`-API-Tests laufen gegen deterministische Injection (`FORM3_PING_FIXTURE=1`, siehe `ping.mjs`); echter `/bin/ping` wird im Real-Smoke auf dem Deployment geprüft (optionaler Unit-Probe via `FORM3_REAL_PING=1`).

## Real-Deployment-Smoke (manuell, mit echtem Modell)

`SMOKE_URL=https://host:9444 SMOKE_USER=... SMOKE_PASS=... node test/smoke.deployed.cjs` — fährt die live App mit dem konfigurierten Modell: Login-Flow als erster Benutzer, datengetriebenes Todo-Element mit `ui.db` (überlebt Reload), In-Place-Verfeinerung (Assistant-Anzahl unverändert), Lab-Shell-Element mit `ui.ping` (echtes `/bin/ping`, Ergebnis im Element), Pin → Quick-Access, Overlay, Logout/Login mit intakten Daten, 390px. Screenshots: `docs/screenshots/smoke-{desktop,mobile}.png`. Teil des Deployments, nicht von `npm test`.
