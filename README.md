# Form v3.3 — lokal denken, serverseitig gespeichert

Ein privater, interaktiver KI-Chat auf deinem eigenen Server. Du verbindest dein eigenes OpenAI-kompatibles Modell (z. B. z.ai, OpenAI, OpenRouter, Ollama) — der API-Key bleibt in einer lokalen Datei auf dem Server.

Antworten kommen in **zwei Phasen**: erst kurzer, klarer Text (live gestreamt), dann — nur wenn es wirklich hilft — **ein** interaktives Artefakt (HTML/CSS/JS), das in einem gehärteten Sandbox-Renderer läuft (QuickJS-WASM-Interpreter + DOMPurify + opakes iframe, portiert aus dem bewährten Form v2).

**v3.1 «Elements»**: Artefakte sind benannte **Elemente** — ⌑ Name antippen zum Markieren, ★ anpinnen, ↗ öffnen (Vollbild-Overlay mit «Mit KI bearbeiten», «Code bearbeiten» und Versionen). Markierte Elemente werden mit der nächsten Nachricht **an Ort und Stelle verfeinert** (keine Duplikate, alte Version bleibt im Element-Verlauf). Lab-Shell-Elemente bekommen mit `ui.ping(host, cb)` genau eine begrenzte Netzwerk-Primitive: einen echten ICMP-Ping über den Server (nur öffentliche Hosts, 10/Minute, geloggt).

**v3.3 «Echte Hintergrund-Baustelle & Scroll-Anker»**:
- Element-Erstellung ist ein **servereigener Hintergrundjob** (SQLite-Tabelle `jobs`): Der Chat endet, während das Element weiterbaut — weitere Nachrichten werden sofort beantwortet. Jobs überleben Reload und Tab-Schliessen (Snapshot + Event-Stream, keine Duplikate, kein zweiter Provider-Aufruf), Abbrechen/Wiederholen pro Baustellen-Container, Restart markiert unterbrochene Jobs ehrlich als fehlgeschlagen.
- Jedes künftige Element hat seinen **Baustellen-Container** (Kran, Gerüst, Blöcke — reduced-motion statisch) mit ehrlichen Phasentexten (in Warteschlange/baut/prüft) statt Fake-Prozenten; davor «Denken» (wachsendes ⌑-Drahtgitter) und «Schreiben» (Cursor-Puls) live am Stream.
- **Scroll-Anker**: Absenden (Enter/Button), Streaming und Element-Fertigstellung springen den Viewport weder an den Anfang noch automatisch ans Ende; 390px inklusive.

**v3.2 «Accounts & Daten»**:
- **Login** mit Benutzername + Passwort (scrypt+Salt, Node-Bordmittel). Session-Cookie HttpOnly + SameSite=Strict (+Secure hinter HTTPS-Ingress). Der **erste registrierte Benutzer wird Owner**; danach ist Registrierung standardmässig **zu** (Config-Flag `form.config.json`). Passwort-Reset nur serverseitig per CLI (siehe unten).
- **Gespräche liegen serverseitig** in SQLite (`data/form.db`) — strikt pro Benutzer getrennt (users → conversations → elements). Der Browser hält nur einen Cache; nach dem ersten Login gibt es ein Import-Angebot für bisher lokale Gespräche — nichts geht verloren, auch beim Gerätewechsel nicht.
- **`ui.db`**: Elemente bekommen **persistente eigene Tabellen** auf dem Server (`data/elements.sqlite`, physisch pro Element namespace-isoliert). Strukturierte Aufrufe only — niemals freies SQL aus Gast-Code. Quotas serverseitig erzwungen: 10 Tabellen/Element, 5000 Zeilen/Tabelle, ~2 MB/Element, 16 KB/Zeile. Damit bauen Todo-Listen, Tracker und Mini-DBs, die Reloads überleben.
- **Modell-Verwaltung bleibt Owner-only**: alle Benutzer sehen die Modellnamen und können chatten; Keys sieht nie jemand (nur Owner: maskiert).

## Quickstart

```bash
npm ci          # installiert gepinnte Dependencies
npm run dev     # baut + startet den Dev-Server
```

Dann im Browser öffnen: **http://127.0.0.1:5177**

(Der Port ist fix: `5177`. Überschreibbar mit `PORT=... npm run dev`.)

### Erster Start: Benutzer anlegen

Solange kein Benutzer existiert, darf sich jeder registrieren — der **erste Benutzer wird Owner** (verwaltet Modelle + API-Keys). Danach ist Registrierung zu; weitere Benutzer legt der Server-Admin an (CLI, siehe unten).

### Erstes Modell einrichten

Beim ersten Start ist die Modellliste **leer** (gewollt). Klicke oben rechts auf **⚙** und füge z. B. hinzu:

- Bezeichnung: `z.ai`
- Base-URL: `https://api.z.ai/v1`
- Modell-ID: `glm-4.6`
- API-Key: dein Key von z.ai

Jeder OpenAI-kompatible Endpunkt funktioniert (`POST {baseUrl}/chat/completions`, Streaming). Für lokales Ollama: Base-URL `http://127.0.0.1:11434/v1`, beliebige Modell-ID, API-Key `ollama`.

### Smoke-Test (eine Zeile)

```bash
curl -s http://127.0.0.1:5177/api/bootstrap
# erwartet: {"version":3,"csrf":"...","models":[...]}
```

Danach im Chat: «Zeig mir einen Spar-Rechner mit Slider» — der Text streamt sichtbar, dann erscheint das interaktive Artefakt.

## Modelle & Keys

- Gespeichert in `form.models.json` **neben der App** (git-ignored, chmod 600).
- Keys erscheinen **nie** in der UI (nur maskiert, letzte 4 Zeichen), nie in Exporten, nie in Logs, nie im Chat-Stream.
- Hinzufügen/Löschen kann **nur der Owner**; alle Benutzer sehen Modellnamen und können chatten.
- Bis ein Modell existiert, ist der Composer blockiert (freundlicher Empty-State).

## Benutzer-Verwaltung (Server-CLI)

Registrierung ist nach dem ersten Benutzer standardmässig **geschlossen** (`form.config.json`: `{"registration": true}` schaltet sie frei; ENV `FORM3_REGISTRATION=1` in Tests). Passwort-Resets und neue Benutzer macht der Admin **als form-User** auf dem Server — es gibt bewusst keinen Web-Reset:

```bash
su - form -c "node /opt/form/useradmin.mjs list"
su - form -c "node /opt/form/useradmin.mjs add <username>"        # Passwort wird abgefragt
su - form -c "node /opt/form/useradmin.mjs reset <username>"      # Passwort-Reset, killt alle Sessions
su - form -c "node /opt/form/useradmin.mjs owner <username>"      # Rolle owner (Modell-Verwaltung)
```

## Daten & Backup

Alles Persistente liegt in **einem** Verzeichnis: `data/` — `form.db` (Benutzer, Sessions, Gespräche, Element-Versionen) und `elements.sqlite` (Element-Tabellen). Sicherung = Verzeichnis kopieren (Server kurz stoppen oder SQLite-WAL mitnehmen). localStorage im Browser ist nur Cache; Export/Import als JSON funktioniert weiter — ohne Modelle und Keys.

## Bedienung

- **Enter** senden, **Shift+Enter** neue Zeile, **Esc** schliesst Sidebar/Dialog.
- **Stoppen** bricht die Modell-Antwort sofort ab (auch upstream).
- Gespräche liegen **serverseitig** (max. 40 pro Benutzer); localStorage ist Cache. Export/Import als JSON — ohne Modelle und Keys. Beim ersten Login gibt es ein Import-Angebot für alte lokale Gespräche.
- Pro Anfrage gehen die letzten ~12 Nachrichten + die 3 letzten Artefakt-Zustände upstream (beides lädt der Server aus seinem Store, nicht aus dem Client).
- Mobil ab 390px nutzbar; `prefers-reduced-motion` schaltet die Zeichen-Animation still.

## Sicherheit (auch im Local Dev)

Artefakte sind **nicht vertrauenswürdige Modell-Ausgabe** und laufen deshalb in der vollen v2-Pipeline:

- QuickJS-WASM-Interpreter (kein DOM, kein Netz, Zeit-/Speicher-Limits) für generiertes JS
- DOMPurify mit Positivlisten + CSS-Parser ohne URLs/@rules
- opakes `sandbox="allow-scripts"` iframe, CSP per Nonce, privater MessageChannel
- Server validiert jede Anfrage (**Session + session-gebundenes CSRF**, Origin, Grössen, Schema) und das Artefakt (Version, Limits)
- Login-Versuche rate-limited (10 Fehlversuche / 5 Min pro Benutzer+Client), keine User-Enumeration, Timing-Flat-Vergleich
- `ui.db`: nur strukturierte Operationen, physisch pro Element namespace-isoliert, harte Quotas, Ownership serverseitig geprüft
- Ausführliche Abdeckung: `TESTING.md`

## Entwicklung

```bash
npm run build   # esbuild-Bundle nach dist/ (muss vor server.mjs laufen)
npm test        # komplette Suite: unit + api + browser (siehe TESTING.md)
```

`server.mjs` liest `dist/` bei jedem Request neu — Frontend-Änderungen brauchen nur `npm run build`, kein Server-Restart (Server-Code-Änderungen schon).

Struktur, Protokoll und Sandbox-Details: `ARCHITECTURE.md` · Provider-Anbindung: `ADAPTER.md`.
