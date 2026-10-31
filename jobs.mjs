// Server-owned background element jobs ("echte Hintergrund-Baustelle").
// Jobs live in SQLite (store.mjs) — they survive reload, navigation and tab
// close; only an explicit cancel (or process restart, which marks them
// honestly failed) stops a build. Retry re-runs the build from the STORED
// validated render: it never repeats a provider call, so a restart or retry
// can never double-charge the provider.
//
// States: queued -> building -> validating -> ready
//         (any active state) -> cancelled | failed
// Every transition bumps a monotonic revision so clients can discard stale
// events and reconcile gaplessly via snapshot + event stream.

export class JobRunner {
  constructor(store, { concurrency = 2, perUser = 2 } = {}) {
    this.store = store;
    this.concurrency = Math.max(1, Math.min(Number(concurrency) || 2, 4));
    this.perUser = Math.max(1, Math.min(Number(perUser) || 2, 4));
    this.queue = [];             // job ids, FIFO
    this.active = new Map();     // jobId -> { ctrl, userId }
    this.subs = new Map();       // userId -> Set<fn(job)>
  }

  publicJob(job, { withRender = false } = {}) {
    const o = {
      id: job.id, conversationId: job.conversationId,
      messageId: job.messageId || null, targetMessageId: job.targetMessageId || null,
      kind: job.kind, state: job.state, rev: job.rev,
      error: job.error || null, createdAt: job.createdAt
    };
    if (withRender) { o.render = job.render; o.prose = job.prose ?? null; }
    return o;
  }

  emit(job, withRender = false) {
    const set = this.subs.get(job.userId);
    if (set) for (const fn of set) { try { fn(this.publicJob(job, { withRender })); } catch {} }
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
        const a = this.active.get(id);
        const j = a ? null : this.store.getJob(id);
        if (!j) return true; // vanished (conversation deleted): drop below
        return this.activeCount(j.userId) < this.perUser;
      });
      if (idx === -1) break;
      const [id] = this.queue.splice(idx, 1);
      if (!this.store.getJob(id)) continue; // deleted while queued
      void this.run(id);
    }
    // drop queued jobs whose conversation vanished
    this.queue = this.queue.filter(id => this.store.getJob(id));
  }

  sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      if (signal) signal.addEventListener('abort', () => {
        clearTimeout(t);
        const e = new Error('job cancelled');
        e.name = 'JobCancelled';
        reject(e);
      }, { once: true });
    });
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
      this.emit(job);
      const buildMs = Math.max(0, Number(job.delayMs) || 0);
      if (buildMs > 0) await this.sleep(Math.round(buildMs * 0.7), ctrl.signal);
      job = this.store.transitionJob(jobId, ['building'], 'validating');
      if (!job) return; // cancelled while building
      this.emit(job);
      if (buildMs > 0) await this.sleep(buildMs - Math.round(buildMs * 0.7), ctrl.signal);
      // synchronous, atomic completion — cancel always wins over a late result
      const done = this.store.completeJob(jobId, j => {
        if (j.kind === 'refine') {
          this.store.replaceRender(j.conversationId, j.targetMessageId, j.render, j.prose ?? undefined);
        } else {
          this.store.attachRender(j.conversationId, j.messageId, j.render);
        }
      });
      if (done) this.emit(done, true);
      else { // lost the race (cancelled / deleted): nothing to resurrect
        const j = this.store.getJob(jobId);
        if (j) this.emit(j);
      }
    } catch (e) {
      if (e && e.name === 'JobCancelled') {
        const j = this.store.getJob(jobId);
        if (j) this.emit(j);
        return;
      }
      console.error('[jobs] build failed:', String(jobId).slice(0, 8), e.message);
      const j = this.store.transitionJob(jobId, ['queued', 'building', 'validating'], 'failed', String(e.message || e).slice(0, 200));
      if (j) this.emit(j);
    } finally {
      this.active.delete(jobId);
      this.pump();
    }
  }

  cancel(jobId) {
    const job = this.store.getJob(jobId);
    if (!job) return { ok: false, status: 404, error: 'Job nicht gefunden' };
    if (!['queued', 'building', 'validating'].includes(job.state)) return { ok: false, status: 409, error: 'Dieser Job läuft nicht mehr.' };
    const upd = this.store.transitionJob(jobId, ['queued', 'building', 'validating'], 'cancelled');
    if (!upd) return { ok: false, status: 409, error: 'Dieser Job läuft nicht mehr.' };
    this.queue = this.queue.filter(x => x !== jobId);
    const a = this.active.get(jobId);
    if (a) a.ctrl.abort();
    this.emit(upd);
    return { ok: true, job: upd };
  }

  // explicit retry of a FAILED job: re-runs the build from the stored render —
  // never a second provider call.
  retry(jobId) {
    const job = this.store.getJob(jobId);
    if (!job) return { ok: false, status: 404, error: 'Job nicht gefunden' };
    if (job.state !== 'failed') return { ok: false, status: 409, error: 'Nur fehlgeschlagene Jobs können wiederholt werden.' };
    const upd = this.store.transitionJob(jobId, ['failed'], 'queued', null);
    if (!upd) return { ok: false, status: 409, error: 'Nur fehlgeschlagene Jobs können wiederholt werden.' };
    this.enqueue(upd);
    return { ok: true, job: upd };
  }
}
