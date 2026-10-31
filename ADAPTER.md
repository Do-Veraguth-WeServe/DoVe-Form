# Adapter: OpenAI-kompatible Provider

Form v3 hat **keine OpenClaw-/Gateway-Abhängigkeit**. Der Server spricht direkt jeden OpenAI-kompatiblen Chat-Completions-Endpunkt an:

```http
POST {baseUrl}/chat/completions
Authorization: Bearer {apiKey}
Content-Type: application/json

{"model":"<id>","stream":true,"messages":[{"role":"system","content":...},...]}
```

## Base-URL-Normalisierung

- `https://api.z.ai/v1` → `https://api.z.ai/v1/chat/completions`
- `https://api.example.com/v1/chat/completions` → unverändert
- Trailing Slashes werden entfernt.

## Getestete Beispiele

| Provider | Base-URL | Modell-ID | API-Key |
|---|---|---|---|
| z.ai | `https://api.z.ai/v1` | z. B. `glm-4.6` | console.z.ai |
| OpenRouter | `https://openrouter.ai/api/v1` | z. B. `anthropic/claude-sonnet-4.5` | openrouter.ai |
| Ollama (lokal) | `http://127.0.0.1:11434/v1` | z. B. `llama3.1:8b` | beliebig, min. 6 Zeichen |

In der automatisierten Test-Suite ersetzt ein **Mock-Provider** (`test/mock-provider.mjs`) den echten Endpunkt — gleiche Transport-, Streaming- und Retry-Pfade, keine echten Keys.

## Erwartete Upstream-Antwort

SSE mit `data: {"choices":[{"delta":{"content":"..."}}]}`-Deltas und `data: [DONE]`. Non-Streaming-Antworten werden nicht unterstützt (bewusst: die Two-Phase-UX braucht Deltas).

Der Modell-Text muss dem Zwei-Phasen-Format folgen (Prosa, dann optional EIN ```json-Artefakt). Der Parser toleriert:

- Marker/Spaces um den Fence
- Fences ohne schliessende ``` (Parse-Versuch am Stream-Ende)
- über Chunk-Grenzen gesplittete Marker

Ungültiges JSON/Schema → genau ein automatischer Korrektur-Lauf (Server formuliert die Korrektur-Anweisung, sendet den fehlerhaften Versuch als Assistenten-Turn mit). Schlägt auch der fehl: Fehler-Event, Prosa bleibt.

## Fehlerweitergabe

Upstream-Fehler (401/429/5xx) erscheinen als `error`-Event mit Status + gekürzter Provider-Message (max. 180 Zeichen) — der API-Key taucht in keiner Fehlermeldung auf. Abbruch des Browsers (Stop) killt die Upstream-Verbindung sofort.
