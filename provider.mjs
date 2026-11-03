// One streaming round against the configured OpenAI-compatible provider.
// Extracted from server.mjs (v3.2.1) so the transport can be unit-tested
// against a local mock without the whole server.
//
// Handles, distinctly:
// - malformed SSE frames (invalid JSON payload) -> ignored, stream continues
// - explicit provider error frames ({"error":{...}}) -> ProviderError
// - content vs transport size caps -> SizeError (abort upstream, free socket)
// - round deadline (timeout) vs external abort (user stop / client disconnect)
// - finish_reason (esp. "length" => truncated) + ACTUAL assistant content
//   (prose + fenced artifact), bounded, for corrective retries — never raw
//   SSE envelopes.
// - the final unterminated SSE line when the stream ends without a newline.
import { parseArtifact } from './contract.mjs';
import { createStreamParser } from './stream.mjs';

const CONTENT_MAX = Number(process.env.FORM3_CONTENT_MAX || 200000);   // accumulated delta chars
const TRANSPORT_MAX = Number(process.env.FORM3_TRANSPORT_MAX || 64000000); // raw SSE bytes ceiling
const CONTEXT_MAX = 8000;      // captured assistant content for retry context
const ROUND_CAP_MS = 300000;   // hard cap for a single round

export class ProviderError extends Error { constructor(m, status) { super(m); this.name = 'ProviderError'; if (status) this.status = status; } }
export class SizeError extends Error { constructor(m) { super(m); this.name = 'SizeError'; } }

function endpoint(base) { const u = String(base).replace(/\/+$/, ''); return /\/chat\/completions$/.test(u) ? u : u + '/chat/completions'; }

function abortErr(external) {
  const e = new Error('round-aborted');
  e.name = 'RoundAbort';
  e.abortKind = external ? 'external' : 'timeout';
  return e;
}

export async function runRound(cfg, messages, opts, onProse, onArtifactStart) {
  const { signal = null, deadlineMs = Date.now() + ROUND_CAP_MS, tools = [] } = opts || {};
  const parser = createStreamParser({ onProse, onArtifactStart });
  const round = new AbortController();
  const onExternal = () => round.abort();
  if (signal) {
    if (signal.aborted) round.abort();
    else signal.addEventListener('abort', onExternal, { once: true });
  }
  let roundTimedOut = false;
  let timer = null;
  try {
    const remaining = deadlineMs - Date.now();
    if (remaining <= 0) throw abortErr(false);
    timer = setTimeout(() => { roundTimedOut = true; round.abort(); }, Math.min(remaining, ROUND_CAP_MS));

    const resp = await fetch(endpoint(cfg.baseUrl), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + cfg.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, stream: true, max_tokens: 16384, messages, ...(tools.length ? {tools,tool_choice:"auto"} : {}) }),
      signal: round.signal
    });
    if (!resp.ok) {
      let detail = '';
      try { const t = await resp.text(); detail = String(JSON.parse(t)?.error?.message || '').slice(0, 180); } catch {}
      throw new ProviderError(`Modell-Endpunkt antwortete ${resp.status}${detail ? ' – ' + detail : ''}`, resp.status);
    }
    if (!resp.body) throw new ProviderError('Modell-Endpunkt lieferte keinen Stream');

    const reader = resp.body.getReader(), dec = new TextDecoder();
    let sseBuf = '', total = 0, content = 0, contentText = '', finishReason = null;

    const toolCalls=new Map();
    let toolBytes=0;
    const handleLine = line => {
      if (!line.startsWith('data:')) return;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') return;
      let j;
      try { j = JSON.parse(payload); } catch { return; } // malformed frame: skip, do not poison the round
      if (j && typeof j === 'object' && !Array.isArray(j) && j.error) {
        const msg = String((j.error && typeof j.error === 'object' && j.error.message) || j.error).slice(0, 180);
        throw new ProviderError('Modellfehler beim Streaming: ' + msg);
      }
      const ch = Array.isArray(j?.choices) && j.choices[0] ? j.choices[0] : null;
      if (ch && ch.finish_reason) finishReason = String(ch.finish_reason);
      for(const part of ch?.delta?.tool_calls||[]){
        if(!Number.isInteger(part.index)||part.index<0||part.index>7)throw new SizeError('Zu viele Tool-Aufrufe.');
        const tc=toolCalls.get(part.index)||{id:'',type:'function',function:{name:'',arguments:''}};
        if(part.id)tc.id+=part.id;
        if(part.function?.name)tc.function.name+=part.function.name;
        if(part.function?.arguments)tc.function.arguments+=part.function.arguments;
        toolBytes+=JSON.stringify(part).length;
        if(toolBytes>64000||tc.id.length>200||tc.function.name.length>100||tc.function.arguments.length>16000)throw new SizeError('Tool-Aufruf zu gross.');
        toolCalls.set(part.index,tc);
      }
      const delta = ch?.delta?.content;
      if (typeof delta === 'string' && delta) {
        content += delta.length;
        if (content > CONTENT_MAX) { round.abort(); throw new SizeError('Antwort des Modells zu gross (Zeichenlimit erreicht)'); }
        if (contentText.length < CONTEXT_MAX) contentText += delta.slice(0, CONTEXT_MAX - contentText.length);
        parser.feed(delta);
      }
    };

    while (true) {
      let r;
      try { r = await reader.read(); }
      catch (e) {
        if (round.signal.aborted) throw abortErr(!!signal && signal.aborted);
        throw e;
      }
      const { done, value } = r;
      if (done) break;
      const text = dec.decode(value, { stream: true });
      total += text.length;
      if (total > TRANSPORT_MAX) { round.abort(); throw new SizeError('Antwort des Modells zu gross (Transportlimit erreicht)'); }
      sseBuf += text;
      let nl;
      while ((nl = sseBuf.indexOf('\n')) !== -1) {
        const line = sseBuf.slice(0, nl).replace(/\r$/, '');
        sseBuf = sseBuf.slice(nl + 1);
        handleLine(line);
      }
    }
    const tail = dec.decode(); // flush multibyte sequences held by the decoder
    if (tail) sseBuf += tail;
    // final unterminated SSE line(s): stream ended without trailing newline
    for (const line of sseBuf.split('\n')) handleLine(line.replace(/\r$/, ''));

    const fin = parser.finish();
    let render = null, error = null;
    if (fin.hadArtifact) { try { render = parseArtifact(fin.artifactRaw); } catch (e) { error = String(e.message || e).slice(0, 160); } }
    return {
      render, error, hadArtifact: fin.hadArtifact,
      truncated: finishReason === 'length', finishReason,
      toolCalls:[...toolCalls.values()], contentText, contentChars: content
    };
  } catch (e) {
    if (e && (e.name === 'AbortError' || e.name === 'RoundAbort')) {
      const external = !!(signal && signal.aborted);
      throw abortErr(external); // else: roundTimedOut => timeout
    }
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onExternal);
    try { round.abort(); } catch {} // release the upstream socket in every exit path
  }
}
