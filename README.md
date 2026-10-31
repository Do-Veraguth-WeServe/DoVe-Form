# Form v3 — lokal denken

Ein privater, interaktiver KI-Chat, der **komplett auf deinem Rechner** läuft. Kein Gateway, kein Server-Deployment, keine Cloud. Du verbindest dein eigenes OpenAI-kompatibles Modell (z. B. z.ai, OpenAI, OpenRouter, Ollama) — der API-Key bleibt in einer lokalen Datei.

Antworten kommen in **zwei Phasen**: erst kurzer, klarer Text (live gestreamt), dann — nur wenn es wirklich hilft — **ein** interaktives Artefakt (HTML/CSS/JS), das in einem gehärteten Sandbox-Renderer läuft (QuickJS-WASM-Interpreter + DOMPurify + opakes iframe, portiert aus dem bewährten Form v2).

## Quickstart

```bash
npm ci          # installiert gepinnte Dependencies
npm run dev     # baut + startet den Dev-Server
```

Dann im Browser öffnen: **http://127.0.0.1:5177**

(Der Port ist fix: `5177`. Überschreibbar mit `PORT=... npm run dev`.)

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
- Löschen eines Modells:⚙ → «Löschen».
- Bis ein Modell existiert, ist der Composer blockiert (freundlicher Empty-State).

## Bedienung

- **Enter** senden, **Shift+Enter** neue Zeile, **Esc** schliesst Sidebar/Dialog.
- **Stoppen** bricht die Modell-Antwort sofort ab (auch upstream).
- Sessions liegen im `localStorage` (max. 40), Export/Import als JSON — ohne Modelle und Keys.
- Pro Anfrage gehen die letzten ~12 Nachrichten + die 3 letzten Artefakt-Zustände upstream.
- Mobil ab 390px nutzbar; `prefers-reduced-motion` schaltet die Zeichen-Animation still.

## Sicherheit (auch im Local Dev)

Artefakte sind **nicht vertrauenswürdige Modell-Ausgabe** und laufen deshalb in der vollen v2-Pipeline:

- QuickJS-WASM-Interpreter (kein DOM, kein Netz, Zeit-/Speicher-Limits) für generiertes JS
- DOMPurify mit Positivlisten + CSS-Parser ohne URLs/@rules
- opakes `sandbox="allow-scripts"` iframe, CSP per Nonce, privater MessageChannel
- Server validiert jede Anfrage (CSRF, Origin, Grössen, Schema) und das Artefakt (Version, Limits)
- Ausführliche Abdeckung: `TESTING.md`

## Entwicklung

```bash
npm run build   # esbuild-Bundle nach dist/ (muss vor server.mjs laufen)
npm test        # komplette Suite: unit + api + browser (siehe TESTING.md)
```

`server.mjs` liest `dist/` bei jedem Request neu — Frontend-Änderungen brauchen nur `npm run build`, kein Server-Restart (Server-Code-Änderungen schon).

Struktur, Protokoll und Sandbox-Details: `ARCHITECTURE.md` · Provider-Anbindung: `ADAPTER.md`.
