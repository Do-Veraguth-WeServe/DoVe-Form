# Form v3.3 — lokal denken, serverseitig gespeichert

Ein privater, interaktiver KI-Chat auf deinem eigenen Server. Du verbindest dein eigenes OpenAI-kompatibles Modell (z. B. z.ai, OpenAI, OpenRouter, Ollama) — der API-Key bleibt in einer lokalen Datei auf dem Server.

**Aktueller Ablauf: besprechen → Blueprint → ausdrücklich „Plan starten“ → Hintergrundbau.** Chatnachrichten erstellen oder überarbeiten ausschliesslich einen gespeicherten Bauplan, niemals ein Element. Das gilt auch für „baue jetzt“ und für markierte bestehende Elemente. Der Blueprint-Container zeigt die kumulierte Zusammenfassung und Versionsnummer; nur sein Startknopf bestätigt genau diese Version. Während des Baus bleibt der Chat unabhängig verfügbar. Spätere Wünsche bilden eine neue Planversion und ändern den laufenden Bau nicht.

Planung hat serverseitig keine Tools und keine Render-Persistenz. Bestätigte Bauten nutzen weiterhin den bestehenden QuickJS-WASM-/DOMPurify-Sandbox-Renderer. Plan-/Build-Kapazität ist getrennt, sodass ein langer Bau keine Chatkapazität belegt. Geschwindigkeit hängt weiterhin vom gewählten Modell ab; der isolierte GLM-5.3-Flash-Test lieferte ersten Antwortinhalt nach 22 s, den fertigen Blueprint nach 36 s (kein Element in einem Benutzerkonto gebaut).

**v3.1 «Elements»**: Artefakte sind benannte **Elemente** — ⌑ Name antippen zum Markieren, ★ anpinnen, ↗ öffnen (Vollbild-Overlay mit «Mit KI bearbeiten», «Code bearbeiten» und Versionen). Markierte Elemente werden nach Besprechung und explizitem Blueprint-Start **an Ort und Stelle verfeinert** (keine Duplikate, alte Version bleibt im Element-Verlauf). Lab-Shell-Elemente bekommen mit `ui.ping(host, cb)` genau eine begrenzte Netzwerk-Primitive: einen echten ICMP-Ping über den Server (nur öffentliche Hosts, 10/Minute, geloggt).

**v3.3 «Echte Hintergrund-Baustelle & Scroll-Anker»**:
- Element-Erstellung ist ein **servereigener Hintergrundjob** (SQLite-Tabelle `jobs`): Der Chat endet, während das Element weiterbaut — weitere Nachrichten werden sofort beantwortet. Jobs überleben Reload und Tab-Schliessen (Snapshot + Event-Stream, keine Duplikate, kein zweiter Provider-Aufruf), Abbrechen/Wiederholen pro Baustellen-Container, Restart markiert unterbrochene Jobs ehrlich als fehlgeschlagen.
- Jedes künftige Element hat seinen **Baustellen-Container** (Kran, Gerüst, Blöcke — reduced-motion statisch) mit ehrlichen Phasentexten (in Warteschlange/baut/prüft) statt Fake-Prozenten; davor «Denken» (pulsierende Punkte) und «Schreiben» (Antwortanzeige und Cursor-Puls) live am Stream.
- **Scroll-Anker**: Absenden (Enter/Button), Streaming und Element-Fertigstellung springen den Viewport weder an den Anfang noch automatisch ans Ende; 390px inklusive.

**v3.2 «Accounts & Daten»**:
- **Login** mit Benutzername + Passwort (scrypt+Salt, Node-Bordmittel). Session-Cookie HttpOnly + SameSite=Strict (+Secure hinter HTTPS-Ingress). Der **erste registrierte Benutzer wird Owner**; danach ist Registrierung standardmässig **zu** (Config-Flag `form.config.json`). Passwort-Reset nur serverseitig per CLI (siehe unten).
- **Gespräche liegen serverseitig** in SQLite (`data/form.db`) — strikt pro Benutzer getrennt (users → conversations → elements). Der Browser hält nur einen Cache; nach dem ersten Login gibt es ein Import-Angebot für bisher lokale Gespräche — nichts geht verloren, auch beim Gerätewechsel nicht.
- **`ui.db`**: Elemente bekommen **persistente eigene Tabellen** auf dem Server (`data/elements.sqlite`, physisch pro Element namespace-isoliert). Strukturierte Aufrufe only — niemals freies SQL aus Gast-Code. Quotas serverseitig erzwungen: 10 Tabellen/Element, 5000 Zeilen/Tabelle, ~2 MB/Element, 16 KB/Zeile. Damit bauen Todo-Listen, Tracker und Mini-DBs, die Reloads überleben.
- **Private/geteilte Provider**: jeder Benutzer verwaltet eigene, zunächst private Provider. Owner/Admin können eigene Provider ausdrücklich teilen; andere erhalten nur Nutzungsrechte, nie Keys oder Konfigurationsrechte.

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
- Auf dem Handy scrollen vertikale Wischgesten über Inline-Elementen den Chat statt einen inneren Elementbereich; zum separaten Scrollen eines Elements die Vollbildansicht öffnen.
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

### Generation runtime (2026-11-06)

Generation has no application deadline by default (`FORM3_CHAT_TIMEOUT_MS=0`). A positive value explicitly opts into a job deadline. User cancellation, sandbox execution budgets, content-size and tool/concurrency safety limits remain enforced. Provider/network disconnects remain possible. The construction crane appears immediately on submission and for restored queued/building/validating jobs, including the initial reasoning/prose phase; it disappears when the job completes.

Rollback for the 2026-11-06 deployment: `/opt/form/.rollback/20261106-no-deadline/` contains the previous backend files, frontend source/bundle and pm2 dump. Restore only those app files and restart as service user after checking for active jobs; do not overwrite current data or model credentials.

### Interrupted provider streams (2026-11-06)

A real replay of the original Post-it-stack prompt failed after 76,796 ms with `TypeError: terminated`, cause `ECONNRESET`, before any visible output. Removing the app deadline alone does not repair this reset. The provider adapter now retries exactly once for transient transport failures before visible output, reports a transport retry, and retains existing tool history without replaying tool execution. Once visible output starts, failure remains explicit rather than duplicating partial answers. Permanent HTTP/auth failures and user cancellation are never retried.

Opt-in real-backend replay: `FORM_LIVE_REPLAY_JOB=<authorized-id-prefix> node test/live-replay.mjs`. This uses a private temporary model registry and isolated database on loopback, compares the generated provider messages with the stored failing request, prints event counts/duration and removes temporary credentials on completion. It never appends a diagnostic turn to the production conversation.

### Accounts and provider ownership (2026-11-07)

- Owner `dominik` manages users through **Benutzer**. Owner may create user/admin accounts; admins may create ordinary users. Existing public registration policy is preserved (closed in production). Passwords are scrypt-hashed and never returned by the user-list API.
- Every user can add and delete their own OpenAI-compatible provider/model entries. Entries are private by default. Owner/admin can share their OWN provider for all accounts or revoke sharing; only its owner can delete it. Shared users see a selectable model and can generate private elements/chats, but never receive the key (including masked key fragments) or configuration controls.
- `ownerId` is always assigned from the authenticated session, never accepted from the request. Model authorization is checked at submission AND when a queued job starts/retries. Already-started requests may finish after sharing is revoked; queued and new requests cannot use a revoked provider.
- Legacy global model entries are migrated privately to the existing owner, preserving IDs and keys. No provider is shared by migration. Back up `form.models.json` before first startup of this release.
- Non-admin-owned provider endpoints must be public HTTPS; DNS is checked and pinned to a public IPv4 address per request, and redirects are denied. The test-only `FORM3_ALLOW_LOCAL_MODELS=1` is only for isolated loopback fixtures and is NOT enabled in production.
- Each chat has a delete button with explicit confirmation that messages and elements will be removed. The backend cancels owned jobs, cascades messages/versions/tool records and purges namespaced element tables. Cross-user deletion is denied. The last deleted chat is replaced with a new empty chat.
- Acceptance: `node test/accounts.test.mjs` uses multiple isolated authenticated browser/API accounts, a local mock provider, real sandbox interaction and persisted state/reload. It checks private defaults, sharing/revocation, queued revocation, secret boundaries, role escalation rejection, deletion confirmation/reload and foreign state access. No production account or live provider is modified by this test.

### Blueprint-Frageblöcke

Der Plancontainer trennt die kompakte Zusammenfassung von bis zu fünf offenen Pflichtfragen. Jede Frage hat ein Antwortfeld; «Antworten mit Form klären» sendet eine Besprechungsnachricht und startet keinen Bau. Form übernimmt geklärte Antworten in die nächste Zusammenfassung. Offene Fragen sperren «Plan starten» in UI und API, selbst wenn das Modell irrtümlich ready=true meldet. Antwortentwürfe bleiben tab-lokal nach Reload erhalten; gespeicherte Fragen sind konten-/gesprächsgebunden. Bereits vorhandene Blueprints erhalten Frageblöcke mit der nächsten Besprechung, nicht rückwirkend erfundene Fragen.

## Chat, Formen und Elemente (aktueller Stand)

- **Senden / Enter** ist normaler Chat. Auch über Apps reden erstellt keinen Blueprint. **Plan** rechts im Eingabefeld überführt die Besprechung ausdrücklich in einen Blueprint. Ein weiterer Klick auf **Plan starten** beginnt den Bau; Chat und Planung haben eigene Kapazität neben dem Bau. Antworten auf Blueprint-Fragen sowie «Gespräch in Plan übernehmen» aktualisieren den Plan ausdrücklich.
- Das Modell oben ist das **Chatmodell**. Im Blueprint ist das **Baumodell** vor dem bestätigten Start separat wählbar; Berechtigungen werden erneut geprüft. Keine neuen Provider werden automatisch eingerichtet.
- **Formen** sind private wiederverwendbare Darstellungsbausteine: Hinweis, Checkliste, Schritte, Vergleich, Kennzahl und Auswahlfrage sind sofort vorhanden. Das Modell liefert nur Daten; kein neuer UI-Code wird für diese Karten erzeugt. Auswahlchips füllen den Composer, sie senden nicht automatisch. Checklisten-Häkchen der Standardkarte sind eine lokale Anzeigehilfe, keine persistente Aufgaben-App.
- Unter **Formen** lassen sich Name, Layout, Einsatzregeln und Verfügbarkeit bearbeiten; Versionen können wiederhergestellt werden. Form kann im Chat neue Formen oder Regeländerungen vorschlagen. «In Formen speichern» übernimmt den Vorschlag einmalig und versioniert; keine heimliche Präferenzänderung.
- Für eine **eigene Vorlage**: im Chat besprechen → Plan → bauen → am fertigen Element **Als Form** → Einsatzregeln ergänzen und speichern. Wiederverwendung erfolgt mit neuen Daten im vorhandenen Sandbox-Code, ohne erneuten Bau. Eigene Formen unterstützen persistentes ui.persist pro Nachricht; App-Datenbanken und externe Tool-Aktionen werden nicht automatisch als Rechte in Formen übernommen. Änderungen am Vorlagencode werden wie ein Element gebaut, nicht im laufenden Chat ausgeführt.
- **Einstellungen** bündelt Modelle, Verbindungen, Memory und Benutzer. Owner/Admin können unter Benutzer Startpasswörter zurücksetzen, Konten sperren/aktivieren und nach Namensbestätigung löschen; Owner kann Admin/User-Rollen ändern. Owner und eigenes Konto sind vor diesen Verwaltungsaktionen geschützt. Admins dürfen nur normale Benutzer verwalten. Reset/Rollenwechsel invalidieren bestehende Sessions; Sperren beendet zusätzlich aktive Aufträge. Löschen entfernt die eigenen Chats, Elemente, Formen und Provider des Zielkontos.

Hinweis: Die älteren Abschnitte zum automatisch planenden Chat sind durch diesen expliziten Planmodus abgelöst. Geschwindigkeit hängt weiterhin vom Modell ab. Isolierter GLM-5.3-Flash-Test: erster Inhalt 11188 ms, fertige Antwort mit Vergleichsform 16311 ms; kein Nutzerchat oder Element dabei erstellt.

## Bugmeldungen
„Bug melden“ in der Seitenleiste sammelt Titel, Reproduktionsschritte und erwartetes Verhalten. Optional wird nur die ID des aktuellen eigenen Chats angehängt, keine Gesprächsinhalte, Screenshots, Logs oder Zugangsdaten. Meldungen sind dauerhaft in SQLite gespeichert. Benutzer sehen ihre eigenen Meldungen; Owner/Admin sehen alle und pflegen Offen / In Arbeit / Behoben samt Bearbeitungsnotiz. Keine automatische KI-Ausführung, externe Weiterleitung oder automatische Fehlerbehebung. Die Übersicht zeigt die neuesten 200 Meldungen.

### Elementwerte im Gespräch
Chat und Planung erhalten einen begrenzten, datierten Lesestand der Elementdaten im aktuellen eigenen Chat (einschliesslich ui.db). Ein markiertes Element wird bevorzugt. Fehlende und gekürzte Daten sind als unbekannt gekennzeichnet. Dies ist keine Bildschirmansicht und kein allgemeiner Schreibzugriff. Bei vielen Elementen das gewünschte Element markieren; Antworten können nur den Datenstand beim Absenden berücksichtigen.

### Bauposition im Verlauf (#e56484b7)
Jeder bestätigte Bau bekommt eine neue Position am aktuellen Ende des Chats. Auch ein älteres Element wird dort genau einmal angezeigt, während es aktualisiert wird, und bleibt nach erfolgreichem Bau dort. Frühere Texte und Formen bleiben an ihrer ursprünglichen Position. Identität, Pins, Versionen und Elementdatenbank ändern sich nicht. Fehler oder Abbruch erhalten den letzten erfolgreichen Stand; Wiederholen bleibt ausdrücklich. Bestehende Benutzerprodukte werden nicht automatisch repariert oder neu gebaut.

### Denk- und Antwortanimationen (#74c9b87d)
Chat und Planung zeigen sofort drei ruhig pulsierende Punkte. Sobald sichtbarer Text eintrifft, wechselt die Anzeige zu «Form antwortet …» mit Schreibcursor. Der Zustand und begrenzte Teiltext bleiben nach Reload erhalten; Abschluss, Fehler und Abbruch beenden die Animation. Reduzierte Bewegung deaktiviert auch den Cursor. Der Baukran bleibt ausschliesslich beim ausdrücklich gestarteten Bau. Die Anzeige beschreibt die Antwortphase, nicht interne Modellgedanken oder einen gemessenen Fertigstellungsgrad.
