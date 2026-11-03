// Server-owned generation jobs ("echte Hintergrund-Baustelle", v3.3.1).
// The job owns the ENTIRE provider generation: the chat request persists an
// immutable bounded context snapshot (messages incl. refine target) and
// returns immediately; this runner later invokes the real provider round
// (runRound, streaming, with the SAME bounded corrective-retry semantics as
// the inline chat used) fully detached from any HTTP/SSE connection.
//
// Consequences:
// - closing the chat SSE (reload, navigation, tab close) NEVER aborts the
//   provider call — only an explicit cancel (or process restart) stops a job.
// - results are persisted even with zero connected subscribers.
// - cancel aborts the job's own AbortController -> the upstream fetch aborts.
// - a process restart marks running jobs honestly failed; explicit retry
//   re-runs the generation FROM THE SNAPSHOT and MAY call the provider again
//   (that is disclosed, never silent).
// - provider credentials live only in the model config (models.mjs); jobs
//   store model_id only — never keys, and the job API never exposes the
//   request snapshot.
//
// States: queued -> building -> validating -> ready
//         (any active state) -> cancelled | failed
// Phases (live, honest): 'prose' until the artifact fence appears, then
// 'artifact'. Every transition bumps a monotonic revision so clients can
// discard stale events and reconcile gaplessly via snapshot + event stream.

import crypto from 'node:crypto';
import {runToolLoop} from './agent-loop.mjs';
import { runRound, ProviderError, SizeError } from './provider.mjs';

// The two-round turn with exactly ONE bounded corrective retry — semantics
// identical to the former inline chat path (v3.2.1 streaming fix): truncated
// (finish_reason=length) => one compact retry replaying the ACTUAL assistant
// content; invalid artifact => one corrected retry. Returns
// { render, prose, failure, failureCode }.
export async function executeTurn(model, messages, opts, emit) {
  const { signal = null, deadlineMs = Date.now() + 300000 } = opts || {};
  const onProse = t => emit({ type: 'prose-chunk', text: t });
  const onArtifactStart = () => emit({ type: 'artifact-start' });
  let liveProse = '';
  const wrapProse = t => { liveProse += t; onProse(t); };

  const roundOpts = { signal, deadlineMs };
  let round1;
  if(opts?.toolContext?.catalog.length){
    const out=await runToolLoop(model,messages,{...roundOpts,...opts.toolContext},ev=>{if(ev.type==='prose-chunk')wrapProse(ev.text);else emit(ev)});
    round1=out.result;messages=out.messages;
  }else round1 = await runRound(model, messages, roundOpts, wrapProse, onArtifactStart);
  let finalRender = round1.render;
  let failure = null;
  let failureCode = null; // 'truncated' | 'invalid-artifact'
  if (!finalRender) {
    if (round1.truncated) failureCode = 'truncated';
    else if (round1.hadArtifact) failureCode = 'invalid-artifact';
  }

  let round2 = null;
  if (failureCode) {
    if (Date.now() >= deadlineMs) {
      const e = new Error('round-aborted'); e.name = 'RoundAbort'; e.abortKind = 'timeout'; throw e;
    }
    emit({
      type: 'retry', code: failureCode,
      reason: failureCode === 'truncated'
        ? 'Antwort wurde durch das Ausgabe-Längenlimit des Modells abgeschnitten — kompakter zweiter Versuch'
        : (round1.error || 'ungültiges JSON')
    });
    const prev = round1.contentText.slice(0, 4000); // ACTUAL content, never raw SSE envelopes
    const corrective = failureCode === 'truncated'
      ? 'Your previous answer was cut off by the output token limit before it completed (the JSON artifact is truncated). Answer again, much more compact: FIRST a short prose answer, THEN exactly ONE fenced ```json artifact {"version":1,"html","css","js","state"} — valid JSON, well under 10KB, minimal HTML/CSS/JS, no truncation, ids matching between html and js.'
      : 'Your previous answer contained an invalid JSON artifact (' + (round1.error || 'parse error') + '). Answer again in the same language: FIRST a short prose answer, THEN exactly ONE corrected fenced ```json artifact {"version":1,"html","css","js","state"}. The JSON must be valid (no trailing commas, no comments, no truncation), under 20KB total, with ids matching between html and js.';
    round2 = await runRound(model,
      [...messages, { role: 'assistant', content: prev }, { role: 'user', content: corrective }],
      roundOpts, wrapProse, onArtifactStart);
    if (round2.render) {
      finalRender = round2.render;
      failure = null; // success on round2 clears round1's failure
    } else if (round2.truncated) {
      failure = 'Die Antwort wurde auch im zweiten Versuch durch das Ausgabe-Längenlimit gekürzt. Der Text-Anteil oben bleibt erhalten — bitte die Darstellung kleiner/stückweise anfragen.';
    } else {
      failure = 'Das Modell lieferte auch im zweiten Versuch kein gültiges Artefakt' + (round2.hadArtifact ? ' (' + (round2.error || 'unbekannt') + ')' : '') + '. Der Text-Anteil oben bleibt erhalten.';
    }
  }
  return {
    render: finalRender || null,
    prose: liveProse.slice(0, 8000),
    failure, failureCode,
    rounds: failureCode ? 2 : 1,
    finish: (round1.finishReason || '-') + (round2 ? '/' + (round2.finishReason || '-') : ''),
    chars: round1.contentChars + (round2 ? round2.contentChars : 0)
  };
}

export class JobRunner {
  constructor(store, { concurrency = 2, perUser = 2, getModel = () => null, totalMs = 300000, getToolContext = () => null, hasToolCalls = () => false } = {}) {
    this.store = store;
    this.getToolContext=getToolContext;this.hasToolCalls=hasToolCalls;
    this.concurrency = Math.max(1, Math.min(Number(concurrency) || 2, 4));
    this.perUser = Math.max(1, Math.min(Number(perUser) || 2, 4));
    this.getModel = getModel; // (modelId) -> {baseUrl, apiKey, model} | null (keys never persisted)
    this.totalMs = Math.max(10000, Number(totalMs) || 300000);
    this.queue = [];             // job ids, FIFO
    this.active = new Map();     // jobId -> { ctrl, userId }
    this.subs = new Map();       // userId -> Set<fn(event)>
  }

  publicJob(job, { withResult = false } = {}) {
    const o = {
      id: job.id, conversationId: job.conversationId,
      messageId: job.messageId || null, targetMessageId: job.targetMessageId || null,
      kind: job.kind, state: job.state, phase: job.phase || 'prose', rev: job.rev,
      error: job.error || null, createdAt: job.createdAt
    };
    o.prose = typeof job.prose === 'string' ? job.prose.slice(0, 8000) : null; // partial prose survives reload
    if (withResult) { o.render = job.render || null; }
    return o;
  }

  emitJob(job, withResult = false) {
    this.broadcast(job.userId, { kind: 'job', job: this.publicJob(job, { withResult }) });
  }

  // live stream events (prose chunks etc.) for the chat SSE relay
  emitStream(jobId, userId, event) {
    this.broadcast(userId, { kind: 'stream', jobId, event });
  }

  broadcast(userId, msg) {
    const set = this.subs.get(userId);
    if (set) for (const fn of set) { try { fn(msg); } catch {} }
  }

  subscribe(userId, fn) {
    if (!this.subs.has(userId)) this.subs.set(userId, new Set());
    this.subs.get(userId).add(fn);
    return () => { try { this.subs.get(userId).delete(fn); } catch {} };
  }

  snapshot(userId) {
    const jobs = this.store.listJobs(userId).map(j => this.publicJob(j));
    return { jobs, rev: jobs.reduce((m, j) => Math.max(m, j.rev), 0) };
  }

  enqueue(job) {
    this.queue.push(job.id);
    this.emitJob(job);
    this.pump();
  }

  activeCount(userId) {
    let n = 0;
    for (const a of this.active.values()) if (!userId || a.userId === userId) n++;
    return n;
  }

  pump() {
    while (this.active.size < this.concurrency && this.queue.length) {
      const idx = this.queue.findIndex(id => {
        if (this.active.has(id)) return false;
        const j = this.store.getJob(id);
        if (!j) return true; // vanished (conversation deleted): drop below
        return this.activeCount(j.userId) < this.perUser;
      });
      if (idx === -1) break;
      const [id] = this.queue.splice(idx, 1);
      if (!this.store.getJob(id)) continue;
      void this.run(id);
    }
    this.queue = this.queue.filter(id => this.store.getJob(id));
  }

  async run(jobId) {
    const ctrl = new AbortController();
    this.active.set(jobId, { ctrl, userId: null });
    try {
      let job = this.store.getJob(jobId);
      if (!job || job.state !== 'queued') return;
      this.active.get(jobId).userId = job.userId;
      job = this.store.transitionJob(jobId, ['queued'], 'building');
      if (!job) return;
      this.emitJob(job);

      const model = this.getModel(job.modelId);
      if (!model) throw Error('Modell nicht mehr konfiguriert.');

      let artifactSeen = false;
      let liveProse = '', lastProsePersist = 0;
      const emit = ev => {
        if (ev.type === 'prose-chunk') {
          liveProse += String(ev.text || '');
          // bounded + throttled partial-prose persistence: a reload mid-stream
          // (or a timeout/abort) must not silently lose the visible text
          const now = Date.now();
          if (now - lastProsePersist > 1000) {
            lastProsePersist = now;
            try { this.store.setJobProse(jobId, liveProse.slice(0, 8000)); } catch {}
          }
        }
        if (ev.type === 'artifact-start' && !artifactSeen) {
          artifactSeen = true;
          try { this.store.setJobPhase(jobId, 'artifact'); const j = this.store.getJob(jobId); if (j) this.emitJob(j); } catch {}
        }
        this.emitStream(jobId, job.userId, ev);
      };

      const t0 = Date.now();
      const result = await executeTurn(model, job.request.messages, {
        signal: ctrl.signal,
        toolContext: this.getToolContext(job),
        deadlineMs: t0 + this.totalMs
      }, emit);
      try { this.store.setJobProse(jobId, result.prose); } catch {}

      // both rounds failed (truncation/invalid artifact): the job FAILS
      // honestly — retryable, the original element stays untouched
      if (!result.render && result.failure) {
        const upd = this.store.transitionJob(jobId, ['queued', 'building', 'validating'], 'failed', result.failure);
        if (upd) {
          if (upd.messageId) this.store.finishMessage(upd.conversationId, upd.messageId, { prose: result.prose || null, error: result.failure });
          this.emitJob(upd);
        }
        console.log(`[job] id=${String(jobId).slice(0, 8)} failed after ${result.rounds} round(s): ${result.failureCode}`);
        return;
      }

      if (result.render) {
        // validating: artifact exists, atomic completion follows synchronously
        const moved = this.store.transitionJob(jobId, ['building'], 'validating');
        if (!moved) return; // cancelled meanwhile
        this.emitJob(moved);
        // refinement CAS: if the target element changed while this job ran
        // (manual edit, newer refinement), the late result must NOT overwrite
        const expectedHash = job.request && job.request.targetHash;
        if (job.kind === 'refine' && expectedHash) {
          const cur = this.store.getRender(job.targetMessageId);
          const curHash = cur ? crypto.createHash('sha256').update(JSON.stringify(cur)).digest('hex') : null;
          if (curHash !== expectedHash) {
            const stale = this.store.transitionJob(jobId, ['validating'], 'failed', 'Das Element wurde während der Aktualisierung geändert — erneut versuchen.');
            if (stale) this.emitJob(stale);
            console.log(`[job] id=${String(jobId).slice(0, 8)} refine aborted: target changed meanwhile`);
            return;
          }
        }
      }

      const done = this.store.completeJob(jobId, j => {
        if (j.kind === 'refine') {
          // original element stays untouched on failure — the job's failed
          // state (with retry) carries the error; no error onto the element
          if (result.render) this.store.replaceRender(j.conversationId, j.targetMessageId, result.render, result.prose || undefined);
        } else {
          if (result.render) this.store.attachRender(j.conversationId, j.messageId, result.render);
          this.store.finishMessage(j.conversationId, j.messageId, { prose: result.prose || null, error: result.failure || null });
        }
      });
      if (done) {
        done.prose = result.prose; // for subscribers/relay only
        if (result.render) done.render = result.render;
        this.emitJob(done, true);
      } else {
        const j = this.store.getJob(jobId);
        if (j) this.emitJob(j);
      }
      // sanitized diagnostics: counts/flags only, no content, no secrets
      console.log(`[job] id=${String(jobId).slice(0, 8)} user=${job.userId.slice(0, 8)} kind=${job.kind} dur=${Date.now() - t0}ms rounds=${result.rounds} finish=${result.finish} chars=${result.chars} render=${result.render ? 'yes' : 'no'} fail=${result.failureCode || '-'}`);
    } catch (e) {
      if (e && (e.name === 'JobCancelled' || (e.name === 'AbortError' || e.name === 'RoundAbort') && ctrl.signal.aborted)) {
        // explicit cancel wins; persist the partial prose honestly
        const cur = this.store.getJob(jobId);
        if (cur) {
          try { this.store.setJobProse(jobId, cur.prose || ''); } catch {}
          const upd = this.store.transitionJob(jobId, ['queued', 'building', 'validating'], 'cancelled');
          if (upd) {
            if (upd.messageId) this.store.finishMessage(upd.conversationId, upd.messageId, { error: 'Abgebrochen.' });
            this.emitJob(upd);
          }
        }
        return;
      }
      let msg;
      if (e.abortKind === 'timeout') {
        msg = 'Zeitlimit erreicht (' + Math.round(this.totalMs / 1000) + ' s). Bitte die Anfrage aufteilen oder kleiner stellen.';
      } else if (e instanceof ProviderError || e instanceof SizeError) {
        msg = e.message; // bounded, no content/secrets
      } else {
        msg = 'Modellaufruf fehlgeschlagen: ' + String(e.message || e).slice(0, 200);
      }
      console.error('[job] failed:', String(jobId).slice(0, 8), msg);
      const cur = this.store.getJob(jobId);
      if (cur) try { this.store.setJobProse(jobId, cur.prose || ''); } catch {}
      const upd = this.store.transitionJob(jobId, ['queued', 'building', 'validating'], 'failed', msg);
      if (upd) {
        if (upd.messageId) this.store.finishMessage(upd.conversationId, upd.messageId, { prose: upd.prose || null, error: msg });
        this.emitJob(upd);
      }
    } finally {
      this.active.delete(jobId);
      this.pump();
    }
  }

  // cancel aborts the job's own controller -> the upstream provider fetch
  // aborts; a job already terminal is a 409 no-op.
  cancel(jobId) {
    const job = this.store.getJob(jobId);
    if (!job) return { ok: false, status: 404, error: 'Job nicht gefunden' };
    if (!['queued', 'building', 'validating'].includes(job.state)) return { ok: false, status: 409, error: 'Dieser Job läuft nicht mehr.' };
    const upd = this.store.transitionJob(jobId, ['queued', 'building', 'validating'], 'cancelled');
    if (!upd) return { ok: false, status: 409, error: 'Dieser Job läuft nicht mehr.' };
    this.queue = this.queue.filter(x => x !== jobId);
    const a = this.active.get(jobId);
    if (a) a.ctrl.abort();
    if (upd.messageId) this.store.finishMessage(upd.conversationId, upd.messageId, { error: 'Abgebrochen.' });
    this.emitJob(upd);
    return { ok: true, job: upd };
  }

  // explicit retry of a FAILED job: re-runs the generation from the STORED
  // snapshot — this MAY call the provider again (disclosed, never silent).
  retry(jobId) {
    if(this.hasToolCalls(jobId))return {ok:false,status:409,error:"Auftrag enthält Tool-Aufrufe. Kein automatischer Neustart; bitte Ergebnis prüfen und neuen Auftrag senden."};
    const job = this.store.getJob(jobId);
    if (!job) return { ok: false, status: 404, error: 'Job nicht gefunden' };
    if (job.state !== 'failed') return { ok: false, status: 409, error: 'Nur fehlgeschlagene Jobs können wiederholt werden.' };
    const upd = this.store.transitionJob(jobId, ['failed'], 'queued', null);
    if (!upd) return { ok: false, status: 409, error: 'Nur fehlgeschlagene Jobs können wiederholt werden.' };
    this.enqueue(upd);
    return { ok: true, job: upd };
  }
}
