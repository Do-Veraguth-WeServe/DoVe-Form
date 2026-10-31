import fs from 'node:fs';
import crypto from 'node:crypto';

// Model registry: {models:[{id,label,baseUrl,model,apiKey,added}]}
// Stored in a local file (default form.models.json next to the app, chmod 600).
// Keys are NEVER returned to the client — only masked (last 4 chars).

export function maskKey(k) { return k ? '…' + k.slice(-4) : ''; }

export function validateModelInput(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw Error('Ungültige Eingabe');
  const label = String(d.label ?? '').trim();
  const baseUrl = String(d.baseUrl ?? '').trim();
  const model = String(d.model ?? '').trim();
  const apiKey = String(d.apiKey ?? '').trim();
  if (!label || label.length > 60) throw Error('Bezeichnung fehlt oder zu lang (max. 60)');
  if (!/^https?:\/\/[a-z0-9.-]+(:\d+)?(\/[\w./-]*)?$/i.test(baseUrl) || baseUrl.length > 200)
    throw Error('Base-URL muss mit http:// oder https:// beginnen (z. B. https://api.z.ai/v1)');
  if (!model || model.length > 100) throw Error('Modell-ID fehlt oder zu lang');
  if (!apiKey || apiKey.length < 6 || apiKey.length > 400) throw Error('API-Key fehlt oder ist zu kurz (min. 6 Zeichen)');
  return { label, baseUrl, model, apiKey };
}

export function loadModels(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || !Array.isArray(data.models)) return { models: [] };
    data.models = data.models.filter(m => m && typeof m === 'object' && typeof m.apiKey === 'string');
    return data;
  } catch (e) {
    if (e.code === 'ENOENT') return { models: [] }; // never abort on a missing file
    throw e;
  }
}

export function saveModels(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.chmodSync(tmp, 0o600); // umask-safe
  fs.renameSync(tmp, file);
}

export function toPublic(m) {
  return { id: m.id, label: m.label, baseUrl: m.baseUrl, model: m.model, keyMasked: maskKey(m.apiKey) };
}
