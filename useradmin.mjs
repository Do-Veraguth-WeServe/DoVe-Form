#!/usr/bin/env node
// Server-CLI für Benutzerverwaltung (als form-User ausführen!).
//
//   node useradmin.mjs list
//   node useradmin.mjs add <username>                     # legt einen User an (Passwort wird abgefragt)
//   node useradmin.mjs reset <username>                   # Passwort-Reset (alle Sessions werden ungültig)
//   node useradmin.mjs owner <username>                   # Rolle auf owner setzen (Modell-Verwaltung)
//
// Auf dem Server:  su - form -c "node /opt/form/useradmin.mjs reset <username>"
// Der Passwort-Prompt liest von stdin (ohne Echo, wenn tty). Kein Web-Reset — bewusst.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { Store } from './store.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const DATA = process.env.FORM3_DATA || path.join(ROOT, 'data');

const [cmd, arg] = process.argv.slice(2);
const usage = 'Usage: node useradmin.mjs <list|add|reset|owner> [username]';

async function askPassword() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const pw = await rl.question('Neues Passwort (min. 8 Zeichen): ');
  const pw2 = await rl.question('Wiederholen: ');
  rl.close();
  if (pw !== pw2) throw Error('Passwörter stimmen nicht überein.');
  return pw;
}

const store = new Store(DATA);
try {
  if (cmd === 'list') {
    const users = store.db.prepare('SELECT username, role, created_at FROM users ORDER BY created_at').all();
    if (!users.length) console.log('Noch keine Benutzer. Der erste registrierte Benutzer wird Owner.');
    for (const u of users) console.log(`${u.username}\t${u.role}\t${u.created_at.slice(0, 10)}`);
  } else if (cmd === 'add' && arg) {
    const user = store.createUser(arg, await askPassword());
    console.log(`Benutzer angelegt: ${user.username} (Rolle: ${user.role})`);
  } else if (cmd === 'reset' && arg) {
    store.resetPassword(arg, await askPassword());
    console.log(`Passwort zurückgesetzt für ${arg}; alle Sessions wurden ungültig.`);
  } else if (cmd === 'owner' && arg) {
    const u = store.getUserByName(arg);
    if (!u) throw Error('Benutzer nicht gefunden');
    store.db.prepare('UPDATE users SET role = ? WHERE id = ?').run('owner', u.id);
    console.log(`${arg} ist jetzt Owner (Modell-Verwaltung freigegeben).`);
  } else {
    console.log(usage);
    process.exitCode = 1;
  }
} catch (e) {
  console.error('Fehler: ' + e.message);
  process.exitCode = 1;
}
