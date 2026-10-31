// Server-side persistence (SQLite via node:sqlite, no external deps).
// data/form.db: users -> sessions -> conversations -> messages -> versions.
// Element app databases live in data/elements/<messageId>.db (see dbstore.mjs).
// Everything is user-scoped: every query filters by user_id. Keys for models
// stay in form.models.json (models.mjs) and are never stored here.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { validateRender } from './contract.mjs';

export const USERNAME = /^[a-zA-Z0-9_.-]{3,32}$/;
const SESSION_DAYS = 30;

// --- passwords: scrypt + per-user salt, timing-safe compare ---
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const N = 16384, r = 8, p = 1;
  const hash = crypto.scryptSync(String(pw), salt, 64, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  try {
    const [tag, Ns, rs, ps, saltHex, hashHex] = String(stored).split('$');
    if (tag !== 'scrypt') return false;
    const hash = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), 64, { N: Number(Ns), r: Number(rs), p: Number(ps) });
    return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
  } catch { return false; }
}

export class Store {
  constructor(dataDir) {
    this.dir = dataDir;
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(dataDir, 0o700); } catch {}
    this.db = new DatabaseSync(path.join(dataDir, 'form.db'));
    try { fs.chmodSync(path.join(dataDir, 'form.db'), 0o600); } catch {}
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS users(
        id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
        pw_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        csrf TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS conversations(
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages(
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL, role TEXT NOT NULL, text TEXT, prose TEXT, error TEXT, render TEXT,
        pinned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
        UNIQUE(conversation_id, seq));
      CREATE TABLE IF NOT EXISTS versions(
        message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL, at TEXT NOT NULL, render TEXT NOT NULL,
        PRIMARY KEY(message_id, seq));
    `);
  }

  // --- users & sessions ---
  userCount() { return Number(this.db.prepare('SELECT COUNT(*) AS c FROM users').get().c); }
  getUserByName(username) { return this.db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '')) || null; }
  getUser(id) { return this.db.prepare('SELECT * FROM users WHERE id = ?').get(String(id || '')) || null; }

  createUser(username, password, role) {
    if (!USERNAME.test(String(username || ''))) throw Error('Benutzername: 3–32 Zeichen, nur Buchstaben, Zahlen . _ -');
    if (typeof password !== 'string' || password.length < 8 || password.length > 200) throw Error('Passwort: 8–200 Zeichen');
    if (this.getUserByName(username)) throw Error('Benutzername ist bereits vergeben');
    const finalRole = role || (this.userCount() === 0 ? 'owner' : 'user'); // first registered user = Owner
    const user = { id: crypto.randomUUID(), username, pw_hash: hashPassword(password), role: finalRole, created_at: new Date().toISOString() };
    this.db.prepare('INSERT INTO users(id, username, pw_hash, role, created_at) VALUES (?,?,?,?,?)')
      .run(user.id, user.username, user.pw_hash, user.role, user.created_at);
    return { id: user.id, username: user.username, role: user.role };
  }

  verifyLogin(username, password) {
    const user = this.getUserByName(username);
    if (!user) { verifyPassword(password, 'scrypt$16384$8$1$' + '0'.repeat(32) + '$' + '0'.repeat(128)); return null; } // flat timing
    if (!verifyPassword(password, user.pw_hash)) return null;
    return { id: user.id, username: user.username, role: user.role };
  }

  close() { try { this.db.close(); } catch {} }

  resetPassword(username, newPassword) {
    const user = this.getUserByName(username);
    if (!user) throw Error('Benutzer nicht gefunden');
    if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 200) throw Error('Passwort: 8–200 Zeichen');
    this.db.prepare('UPDATE users SET pw_hash = ? WHERE id = ?').run(hashPassword(newPassword), user.id);
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id); // invalidate all sessions
    return true;
  }

  createSession(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const csrf = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    this.db.prepare('INSERT INTO sessions(token_hash, user_id, csrf, created_at, expires_at) VALUES (?,?,?,?,?)')
      .run(crypto.createHash('sha256').update(token).digest('hex'), userId, csrf, now, now + SESSION_DAYS * 86400000);
    if (Math.random() < 0.05) this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
    return { token, csrf };
  }

  // Returns {user, csrf} for a raw session token, or null. Sliding expiry.
  getSession(token) {
    if (typeof token !== 'string' || !token.length || token.length > 128) return null;
    const row = this.db.prepare(
      'SELECT s.token_hash, s.csrf, s.expires_at, u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?'
    ).get(crypto.createHash('sha256').update(token).digest('hex'));
    if (!row) return null;
    const now = Date.now();
    if (Number(row.expires_at) < now) { this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash); return null; }
    this.db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(now + SESSION_DAYS * 86400000, row.token_hash);
    return { user: { id: row.id, username: row.username, role: row.role }, csrf: row.csrf };
  }

  deleteSession(token) {
    if (typeof token !== 'string') return;
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(crypto.createHash('sha256').update(token).digest('hex'));
  }

  // --- conversations & messages ---
  createConversation(userId, title) {
    const id = crypto.randomUUID(), now = new Date().toISOString();
    const count = Number(this.db.prepare('SELECT COUNT(*) AS c FROM conversations WHERE user_id = ?').get(userId).c);
    if (count >= 40) throw Error('Maximal 40 Gedankengänge');
    this.db.prepare('INSERT INTO conversations(id, user_id, title, created_at, updated_at) VALUES (?,?,?,?,?)')
      .run(id, userId, String(title || 'Neuer Gedankengang').slice(0, 80), now, now);
    return { id, title: String(title || 'Neuer Gedankengang').slice(0, 80), createdAt: now, updatedAt: now, messages: [] };
  }

  conversationOwner(convId) {
    const row = this.db.prepare('SELECT user_id FROM conversations WHERE id = ?').get(String(convId || ''));
    return row ? row.user_id : null;
  }
  // Owner (user id) + conversation of a message; null if absent.
  messageOwner(msgId) {
    const row = this.db.prepare('SELECT c.user_id AS uid, c.id AS conv_id, m.render AS render FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.id = ?').get(String(msgId || ''));
    return row ? { userId: row.uid, conversationId: row.conv_id, hasRender: !!row.render } : null;
  }

  deleteConversation(userId, convId, onElements) {
    const conv = this.db.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').get(String(convId || ''), userId);
    if (!conv) return false;
    const msgs = this.db.prepare('SELECT id, render FROM messages WHERE conversation_id = ?').all(conv.id);
    this.db.prepare('DELETE FROM conversations WHERE id = ?').run(conv.id); // FK cascades messages+versions
    if (typeof onElements === 'function') onElements(msgs.filter(m => m.render).map(m => m.id));
    return true;
  }

  nextSeq(convId) {
    const row = this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM messages WHERE conversation_id = ?').get(convId);
    return Number(row.s) + 1;
  }

  appendMessage(convId, role, fields = {}) {
    const count = Number(this.db.prepare('SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ?').get(convId).c);
    if (count >= 100) throw Error('Gedankengang voll (100 Nachrichten) — bitte neu starten');
    const id = crypto.randomUUID(), seq = this.nextSeq(convId);
    this.db.prepare('INSERT INTO messages(id, conversation_id, seq, role, text, prose, error, render, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, convId, seq, role,
        fields.text != null ? String(fields.text).slice(0, 2000) : null,
        fields.prose != null ? String(fields.prose).slice(0, 8000) : null,
        fields.error != null ? String(fields.error).slice(0, 300) : null,
        fields.render != null ? JSON.stringify(fields.render) : null,
        new Date().toISOString());
    this.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), convId);
    return id;
  }

  setTitleIfFirst(convId, text) {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ?').get(convId);
    if (Number(row.c) <= 1) this.db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(String(text).slice(0, 45), convId);
  }

  // Server-side history window (last 12, alternating semantics like the client used).
  getHistory(convId, limit = 12) {
    const rows = this.db.prepare('SELECT role, text, prose, error, render FROM messages WHERE conversation_id = ? ORDER BY seq DESC LIMIT ?').all(convId, limit + 8).reverse();
    const out = [];
    for (const r of rows.slice(-limit)) {
      if (r.role === 'user') out.push({ role: 'user', content: String(r.text || '') });
      else {
        let content = String(r.prose || '').slice(0, 1500);
        if (r.render) content += (content ? ' ' : '') + '[enthielt ein interaktives Artefakt]';
        if (r.error) content += (content ? ' ' : '') + '[Fehler]';
        out.push({ role: 'assistant', content: content || '[leer]' });
      }
    }
    return out;
  }

  // Last N element states (renders) of a conversation, for prompt context.
  getStates(convId, limit = 3) {
    const rows = this.db.prepare('SELECT id, render FROM messages WHERE conversation_id = ? AND render IS NOT NULL ORDER BY seq DESC LIMIT ?').all(convId, limit).reverse();
    const out = [];
    for (const r of rows) {
      try { const render = JSON.parse(r.render); if (render && render.state && typeof render.state === 'object') out.push({ id: r.id, state: render.state }); } catch {}
    }
    return out;
  }

  getRender(msgId) {
    const row = this.db.prepare('SELECT render FROM messages WHERE id = ?').get(String(msgId || ''));
    if (!row || !row.render) return null;
    try { return JSON.parse(row.render); } catch { return null; }
  }

  // In-place refinement: archive the current render (cap 5), then replace it
  // (and optionally refresh the element message's prose).
  replaceRender(convId, msgId, render, prose) {
    const row = this.db.prepare('SELECT id, render FROM messages WHERE id = ? AND conversation_id = ?').get(String(msgId || ''), convId);
    if (!row || !row.render) throw Error('Element nicht gefunden');
    const next = Number(this.db.prepare('SELECT COALESCE(MAX(seq),0)+1 AS s FROM versions WHERE message_id = ?').get(msgId).s);
    this.db.prepare('INSERT INTO versions(message_id, seq, at, render) VALUES (?,?,?,?)').run(msgId, next, new Date().toISOString(), row.render);
    this.db.prepare('DELETE FROM versions WHERE message_id = ? AND seq <= ?').run(msgId, next - 5); // keep last 5
    this.db.prepare('UPDATE messages SET render = ?' + (prose != null ? ', prose = ?' : '') + ' WHERE id = ?')
      .run(...(prose != null ? [JSON.stringify(render), String(prose).slice(0, 8000), msgId] : [JSON.stringify(render), msgId]));
    this.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), convId);
  }

  // Code-editor/manual state updates: replace only the state inside a stored render.
  updateMessageRender(userId, msgId, render) {
    const owner = this.messageOwner(msgId);
    if (!owner || owner.userId !== userId || !owner.hasRender) throw Error('Element nicht gefunden');
    this.db.prepare('UPDATE messages SET render = ? WHERE id = ?').run(JSON.stringify(render), msgId);
    return true;
  }

  setPinned(userId, msgId, pinned) {
    const owner = this.messageOwner(msgId);
    if (!owner || owner.userId !== userId || !owner.hasRender) throw Error('Element nicht gefunden');
    if (pinned) {
      const count = Number(this.db.prepare(
        'SELECT COUNT(*) AS c FROM messages m JOIN conversations c2 ON c2.id = m.conversation_id WHERE c2.user_id = ? AND m.pinned = 1').get(userId).c);
      if (count >= 40) throw Error('Maximal 40 angepinnte Elemente');
    }
    this.db.prepare('UPDATE messages SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, msgId);
    return true;
  }

  // Full snapshot for one user: conversations (newest first) with messages, pins, versions.
  listConversations(userId) {
    const convs = this.db.prepare('SELECT id, title, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 40').all(userId);
    const out = [];
    for (const c of convs) {
      const msgs = this.db.prepare('SELECT id, role, text, prose, error, render, pinned FROM messages WHERE conversation_id = ? ORDER BY seq LIMIT 100').all(c.id);
      const messages = msgs.map(m => {
        const o = { id: m.id, role: m.role };
        if (m.text != null) o.text = m.text;
        if (m.prose != null) o.prose = m.prose;
        if (m.error != null) o.error = m.error;
        if (m.render != null) { try { o.render = JSON.parse(m.render); } catch {} }
        if (m.pinned) o.pinned = true;
        return o;
      });
      out.push({ id: c.id, title: c.title, updatedAt: c.updated_at, messages });
    }
    const versions = {};
    for (const c of out) for (const m of c.messages) {
      if (!m.render) continue;
      const rows = this.db.prepare('SELECT at, render FROM versions WHERE message_id = ? ORDER BY seq LIMIT 5').all(m.id);
      if (rows.length) versions[m.id] = rows.map(r => { try { return { at: r.at, render: JSON.parse(r.render) }; } catch { return null; } }).filter(Boolean);
    }
    return { conversations: out, versions };
  }

  // Import validated archive sessions (ids regenerated, pins/versions remapped).
  importSessions(userId, archive) {
    const clean = validateArchive(archive);
    const count = Number(this.db.prepare('SELECT COUNT(*) AS c FROM conversations WHERE user_id = ?').get(userId).c);
    if (count + clean.sessions.length > 40) throw Error('Import überschreitet 40 Gedankengänge');
    const idMap = new Map(), created = [];
    for (const s of clean.sessions) {
      const conv = this.createConversation(userId, s.title);
      for (const m of s.messages) {
        const mid = crypto.randomUUID();
        if (m.id) idMap.set(m.id, mid);
        this.db.prepare('INSERT INTO messages(id, conversation_id, seq, role, text, prose, error, render, pinned, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
          .run(mid, conv.id, this.nextSeq(conv.id), m.role,
            m.text != null ? m.text : null, m.prose != null ? m.prose : null, m.error != null ? m.error : null,
            m.render != null ? JSON.stringify(m.render) : null, 0, new Date().toISOString());
        if (m.render) {
          const list = (clean.versions[m.id] || []).slice(-5);
          list.forEach((v, i) => {
            try { this.db.prepare('INSERT INTO versions(message_id, seq, at, render) VALUES (?,?,?,?)').run(mid, i + 1, v.at || '', JSON.stringify(v.render)); } catch {}
          });
        }
      }
      created.push(conv);
    }
    const remap = list => list.map(x => idMap.get(x)).filter(Boolean);
    for (const oldId of remap([...new Set([...(clean.pins || [])])])) {
      try { this.setPinned(userId, oldId, true); } catch {}
    }
    return created;
  }
}

// Defensive re-validation of an imported archive (same caps as the client normalize()).
export function validateArchive(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw Error('Ungültiges Archiv');
  const sessions = x.sessions;
  if (!Array.isArray(sessions) || !sessions.length || sessions.length > 40) throw Error('Ungültiges Archiv');
  const out = sessions.map(s => {
    if (!s || typeof s !== 'object' || typeof s.title !== 'string' || !Array.isArray(s.messages) || s.messages.length > 100) throw Error('Ungültige Sitzung');
    return {
      id: typeof s.id === 'string' ? s.id.slice(0, 64) : undefined,
      title: s.title.slice(0, 80),
      messages: s.messages.map(m => {
        if (!m || typeof m !== 'object') throw Error('Ungültige Nachricht');
        const id = typeof m.id === 'string' ? m.id.slice(0, 64) : undefined;
        if (m.role === 'user' && typeof m.text === 'string') return { id, role: 'user', text: m.text.slice(0, 2000) };
        if (m.role === 'assistant') {
          const o = { id, role: 'assistant' };
          if (typeof m.error === 'string') { o.error = m.error.slice(0, 300); return o; }
          if (typeof m.prose === 'string') o.prose = m.prose.slice(0, 8000);
          if (m.render != null) o.render = validateRender(m.render);
          if (o.prose || o.render) return o;
          throw Error('Ungültige Nachricht');
        }
        throw Error('Ungültige Nachricht');
      })
    };
  });
  let pins = [], versions = {};
  if (x.elements && typeof x.elements === 'object' && !Array.isArray(x.elements)) {
    if (Array.isArray(x.elements.pins)) pins = x.elements.pins.filter(p => typeof p === 'string' && p.length <= 64).slice(0, 40);
    const v = x.elements.versions;
    if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, list] of Object.entries(v)) {
      if (typeof k !== 'string' || k.length > 64 || !Array.isArray(list)) continue;
      const cleanV = list.filter(e => e && typeof e === 'object' && e.render)
        .map(e => { try { return { at: typeof e.at === 'string' ? e.at.slice(0, 30) : '', render: validateRender(e.render) }; } catch { return null; } })
        .filter(Boolean).slice(-5);
      if (cleanV.length) versions[k] = cleanV;
    }
  }
  return { sessions: out, pins, versions };
}

// Config file (form.config.json): {"registration": true|false}. Missing file = defaults.
// ENV FORM3_REGISTRATION=1 forces registration on (tests / controlled setup).
export function loadConfig(file) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) cfg = {}; }
  catch (e) { if (e.code !== 'ENOENT') console.error('config unreadable:', e.message); }
  return { registration: cfg.registration === true || process.env.FORM3_REGISTRATION === '1' };
}
