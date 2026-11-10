// Per-element persistent SQLite storage (v3.1 Elements DB).
// ONE database file per app under FORM3_DATA (default <app>/data/elements.sqlite,
// WAL mode) — backup-friendly single directory. Each element (session+message id)
// gets its own server-derived namespace: physical tables are named
// e_<sha256(sessionId:elementId)[0:24]>_<table>. Guests never see or choose
// physical names, and only structured operations exist — no SQL strings.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const QUOTAS = { tables: 10, rows: 5000, bytesElement: 2 * 1024 * 1024, bytesRow: 16 * 1024, responseBytes: 128 * 1024 };
const TABLE_RE = /^[a-z0-9_]{1,32}$/;
const COL_RE = /^[a-z0-9_]{1,32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OPS = new Set(['create', 'drop', 'insert', 'select', 'update', 'delete']);

function fail(status, error) { return { status, result: { ok: false, error } }; }
const isPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const size = v => Buffer.byteLength(JSON.stringify(v));
function primitive(v) { return v === null || ['string', 'number', 'boolean'].includes(typeof v); }

export class ElementDB {
  constructor(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.file = file;
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; PRAGMA synchronous=NORMAL;');
    this.db.exec('CREATE TABLE IF NOT EXISTS __form_meta__(ekey TEXT NOT NULL, tname TEXT NOT NULL, rows INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(ekey,tname))');
    this.db.exec('CREATE TABLE IF NOT EXISTS __form_revisions__(ekey TEXT PRIMARY KEY, revision INTEGER NOT NULL)');
  }
  revision(sessionId,elementId) { return this.db.prepare('SELECT revision FROM __form_revisions__ WHERE ekey=?').get(this.ekey(sessionId,elementId))?.revision||0; }
  close() { try { this.db.close(); } catch {} }

  // Drop every table of one element (conversation delete / cleanup).
  purge(sessionId, elementId) {
    const ekey = this.ekey(sessionId, elementId);
    if (!ekey) return;
    const rows = this._meta(ekey);
    for (const r of rows) {
      try { this.db.exec(`DROP TABLE IF EXISTS "${ekey}_${r.tname}"`); } catch {}
    }
    try { this.db.prepare('DELETE FROM __form_meta__ WHERE ekey=?').run(ekey); } catch {}
  }

  // Server-side namespace: derived from ids, never from guest input.
  ekey(sessionId, elementId) {
    if (!UUID_RE.test(String(sessionId || '')) || !UUID_RE.test(String(elementId || ''))) return null;
    return 'e_' + crypto.createHash('sha256').update('form-el:' + sessionId + ':' + elementId).digest('hex').slice(0, 24);
  }
  _meta(ekey) { return this.db.prepare('SELECT tname, rows, bytes FROM __form_meta__ WHERE ekey=?').all(ekey); }
  _metaRow(ekey, tname) { return this.db.prepare('SELECT rows, bytes FROM __form_meta__ WHERE ekey=? AND tname=?').get(ekey, tname); }
  _addMeta(ekey, tname, dRows, dBytes) {
    this.db.prepare('UPDATE __form_meta__ SET rows=rows+?, bytes=bytes+? WHERE ekey=? AND tname=?').run(dRows, dBytes, ekey, tname);
  }
  _tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.db.exec('COMMIT'); return r; }
    catch (e) { try { this.db.exec('ROLLBACK'); } catch {} throw e; }
  }

  op({ sessionId, elementId, op, table, columns, row, query, id, patch }) {
    const ekey = this.ekey(sessionId, elementId);
    if (!ekey) return fail(400, 'Ungültige Element-Identität.');
    if (!OPS.has(op)) return fail(400, 'Unbekannte Operation.');
    if (typeof table !== 'string' || !TABLE_RE.test(table)) return fail(400, 'Ungültiger Tabellenname ([a-z0-9_], max 32).');
    const mutate=fn=>this._tx(()=>{
      // Both endpoints are sampled under the same SQLite write lock.
      const before=this.revision(sessionId,elementId),r=fn();
      if(r.status===200){
        this.db.prepare('INSERT INTO __form_revisions__ VALUES(?,1) ON CONFLICT(ekey) DO UPDATE SET revision=revision+1').run(ekey);
        r.writeRevision={before,after:this.revision(sessionId,elementId)};
      }
      return r;
    });
    const phys = `"${ekey}_${table}"`;
    try {
      if (op === 'create') return mutate(() => this._create(ekey, table, phys, columns));
      if (op === 'drop') return mutate(() => this._drop(ekey, table, phys));
      if (op === 'insert') return mutate(() => this._insert(ekey, table, phys, row));
      if (op === 'select') return this._select(ekey, table, phys, query);
      if (op === 'update') return mutate(() => this._update(ekey, table, phys, id, patch));
      if (op === 'delete') return mutate(() => this._delete(ekey, table, phys, id));
    } catch (e) {
      const msg = String(e && e.message || e).slice(0, 160);
      return /QUOTA/.test(msg) ? fail(413, msg.replace(/^Error: QUOTA /, '')) : fail(500, 'Datenbankfehler.');
    }
    return fail(400, 'Unbekannte Operation.');
  }

  _create(ekey, table, phys, columns) {
    const meta = this._meta(ekey);
    if (meta.some(m => m.tname === table)) return fail(409, 'Tabelle existiert bereits.');
    if (meta.length >= QUOTAS.tables) return fail(413, `Tabellen-Limit erreicht (max ${QUOTAS.tables} pro Element).`);
    if (columns !== undefined && columns !== null) {
      if (!Array.isArray(columns) || columns.length > 16 || columns.length < 1 || !columns.every(c => typeof c === 'string' && COL_RE.test(c)))
        return fail(400, 'columns: Array von Namen [a-z0-9_] (max 16).');
    }
    this.db.exec(`CREATE TABLE ${phys}(id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)`);
    this.db.prepare('INSERT INTO __form_meta__(ekey,tname,rows,bytes) VALUES(?,?,0,0)').run(ekey, table);
    return { status: 200, result: { ok: true } };
  }

  _drop(ekey, table, phys) {
    const m = this._metaRow(ekey, table);
    if (!m) return fail(404, 'Tabelle nicht gefunden.');
    this.db.exec(`DROP TABLE ${phys}`);
    this.db.prepare('DELETE FROM __form_meta__ WHERE ekey=? AND tname=?').run(ekey, table);
    return { status: 200, result: { ok: true } };
  }

  _insert(ekey, table, phys, row) {
    const m = this._metaRow(ekey, table);
    if (!m) return fail(404, 'Tabelle nicht gefunden.');
    if (!isPlain(row)) return fail(400, 'row muss ein Objekt sein.');
    let payload;
    try { payload = JSON.stringify(row); } catch { return fail(400, 'row ist nicht JSON-serialisierbar.'); }
    if (payload.length > QUOTAS.bytesRow) return fail(413, `Zeile zu gross (max ${QUOTAS.bytesRow / 1024} KB).`);
    const total = this._meta(ekey).reduce((s, x) => s + x.bytes, 0);
    if (total + payload.length > QUOTAS.bytesElement) return fail(413, 'Element-Speicherlimit erreicht (max 2 MB).');
    if (m.rows >= QUOTAS.rows) return fail(413, `Zeilen-Limit erreicht (max ${QUOTAS.rows} pro Tabelle).`);
    const r = this.db.prepare(`INSERT INTO ${phys}(data) VALUES(?)`).run(payload);
    this._addMeta(ekey, table, 1, payload.length);
    return { status: 200, result: { ok: true, id: Number(r.lastInsertRowid) } };
  }

  _select(ekey, table, phys, query) {
    const m = this._metaRow(ekey, table);
    if (!m) return fail(404, 'Tabelle nicht gefunden.');
    let where = null, limit = 100;
    if (query !== undefined && query !== null) {
      if (!isPlain(query)) return fail(400, 'query muss ein Objekt sein.');
      const keys = Object.keys(query).filter(k => k !== 'where' && k !== 'limit');
      if (keys.length) return fail(400, 'query erlaubt nur {where, limit}.');
      if (query.where !== undefined && query.where !== null) {
        if (!isPlain(query.where)) return fail(400, 'where muss ein Objekt sein.');
        for (const [k, v] of Object.entries(query.where)) {
          if (!COL_RE.test(k)) return fail(400, 'where-Werte: Primitive oder Array davon.');
          const okV = primitive(v) || (Array.isArray(v) && v.length <= 32 && v.every(primitive));
          if (!okV) return fail(400, 'where-Werte: Primitive oder Array davon.');
        }
        where = query.where;
      }
      if (query.limit !== undefined && query.limit !== null) {
        if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 500) return fail(400, 'limit: 1–500.');
        limit = query.limit;
      }
    }
    const out = [];
    const stmt = this.db.prepare(`SELECT id, data FROM ${phys} ORDER BY id`);
    for (const r of stmt.iterate()) {
      let obj;
      try { obj = JSON.parse(r.data); } catch { continue; }
      if (where) {
        let keep = true;
        for (const [k, v] of Object.entries(where)) {
          const actual = obj[k];
          const hit = Array.isArray(v) ? v.includes(actual) : actual === v;
          if (!hit) { keep = false; break; }
        }
        if (!keep) continue;
      }
      out.push({ id: r.id, ...obj });
      if (out.length >= limit) break;
    }
    let truncated = false;
    while (out.length > 1 && JSON.stringify(out).length > QUOTAS.responseBytes) { out.pop(); truncated = true; }
    const result = { ok: true, rows: out };
    if (truncated) result.truncated = true;
    return { status: 200, result };
  }

  _update(ekey, table, phys, id, patch) {
    const m = this._metaRow(ekey, table);
    if (!m) return fail(404, 'Tabelle nicht gefunden.');
    if (!Number.isInteger(id) || id < 1) return fail(400, 'id muss eine positive Zahl sein.');
    if (!isPlain(patch)) return fail(400, 'patch muss ein Objekt sein.');
    const cur = this.db.prepare(`SELECT data FROM ${phys} WHERE id=?`).get(id);
    if (!cur) return fail(404, 'Zeile nicht gefunden.');
    let obj;
    try { obj = JSON.parse(cur.data); } catch { return fail(500, 'Datenbankfehler.'); }
    const next = { ...obj, ...patch };
    let payload;
    try { payload = JSON.stringify(next); } catch { return fail(400, 'patch ist nicht JSON-serialisierbar.'); }
    if (payload.length > QUOTAS.bytesRow) return fail(413, `Zeile zu gross (max ${QUOTAS.bytesRow / 1024} KB).`);
    const total = this._meta(ekey).reduce((s, x) => s + x.bytes, 0);
    if (total - cur.data.length + payload.length > QUOTAS.bytesElement) return fail(413, 'Element-Speicherlimit erreicht (max 2 MB).');
    this.db.prepare(`UPDATE ${phys} SET data=? WHERE id=?`).run(payload, id);
    this._addMeta(ekey, table, 0, payload.length - cur.data.length);
    return { status: 200, result: { ok: true } };
  }

  _delete(ekey, table, phys, id) {
    const m = this._metaRow(ekey, table);
    if (!m) return fail(404, 'Tabelle nicht gefunden.');
    if (!Number.isInteger(id) || id < 1) return fail(400, 'id muss eine positive Zahl sein.');
    const cur = this.db.prepare(`SELECT data FROM ${phys} WHERE id=?`).get(id);
    if (!cur) return fail(404, 'Zeile nicht gefunden.');
    this.db.prepare(`DELETE FROM ${phys} WHERE id=?`).run(id);
    this._addMeta(ekey, table, -1, -cur.data.length);
    return { status: 200, result: { ok: true } };
  }
}
