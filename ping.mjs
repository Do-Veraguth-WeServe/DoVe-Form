// Ping backend for lab-shell elements: exactly ONE bounded network primitive.
// A hostname (never an IP literal, never a URL) is resolved; EVERY resolved
// A/AAAA must be public; then /bin/ping runs one ICMP probe with a 2s wait.
// Injectable backend {lookup, exec} keeps tests deterministic (FORM3_PING_FIXTURE).
import dns from 'node:dns/promises';
import net from 'node:net';
import { execFile } from 'node:child_process';

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

// Strict hostname validation: lowercase DNS name, >= 2 labels, no IP literals,
// no schemes/paths/ports, no all-numeric TLD.
export function validHost(h) {
  if (typeof h !== 'string') return false;
  const host = h.trim().toLowerCase();
  if (!host || host.length > 253) return false;
  if (/[:/?#@[\]"]/i.test(host)) return false;
  const labels = host.split('.');
  if (labels.length < 2) return false;
  if (labels.every(l => /^\d+$/.test(l))) return false; // IPv4 literal
  if (/^\d+$/.test(labels[labels.length - 1])) return false; // numeric TLD
  return labels.every(l => LABEL.test(l));
}

// Reserved / private / loopback / link-local / CGNAT / multicast / documentation
// ranges — checked for both families, including IPv4-mapped IPv6.
const RANGES = [
  ['0.0.0.0', 8, 'ipv4'], ['10.0.0.0', 8, 'ipv4'], ['100.64.0.0', 10, 'ipv4'],
  ['127.0.0.0', 8, 'ipv4'], ['169.254.0.0', 16, 'ipv4'], ['172.16.0.0', 12, 'ipv4'],
  ['192.0.0.0', 24, 'ipv4'], ['192.168.0.0', 16, 'ipv4'], ['198.18.0.0', 15, 'ipv4'],
  ['224.0.0.0', 4, 'ipv4'], ['240.0.0.0', 4, 'ipv4'], ['255.255.255.255', 32, 'ipv4'],
  ['::', 128, 'ipv6'], ['::1', 128, 'ipv6'], ['100::', 64, 'ipv6'], ['64:ff9b::', 96, 'ipv6'],
  ['2001:db8::', 32, 'ipv6'], ['fc00::', 7, 'ipv6'],
  ['fe80::', 10, 'ipv6'], ['ff00::', 8, 'ipv6']
];
// NOTE: ::ffff:0:0/96 must NOT go into the BlockList — check() matches plain IPv4
// strings against that subnet, which would block the entire IPv4 space. Mapped
// addresses are covered by the explicit ::ffff:<v4> fallback in ipBlocked().
const blocklist = new net.BlockList();
for (const [addr, bits, family] of RANGES) blocklist.addSubnet(addr, bits, family);

export function ipBlocked(ip) {
  if (typeof ip !== 'string') return true;
  if (net.isIPv4(ip)) return blocklist.check(ip, 'ipv4');
  if (net.isIPv6(ip)) {
    if (blocklist.check(ip, 'ipv6')) return true;
    const m = ip.toLowerCase().match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    return !!(m && blocklist.check(m[1], 'ipv4'));
  }
  return true;
}

const defLookup = h => dns.lookup(h, { all: true, verbatim: true });
const defExec = ip => new Promise(resolve => {
  let settled = false;
  const done = (err, stdout) => { if (!settled) { settled = true; resolve({ err, stdout: String(stdout || '') }); } };
  try {
    execFile('/bin/ping', ['-c', '1', '-W', '2', ip], { timeout: 4000, killSignal: 'SIGKILL' }, (err, stdout) => done(err, stdout));
    setTimeout(() => done(Error('timeout'), ''), 6000).unref?.();
  } catch (e) { done(e, ''); }
});

let backendOverride = null;
export function setPingBackend(b) { backendOverride = b; }

// Returns { status, result }: status 200 (result carries ok/ip/ms/error),
// 400 (invalid host), 403 (resolved to a blocked range). Every ping is logged.
export async function runPing({ host, sessionId, backend }) {
  const { lookup, exec, log } = { lookup: defLookup, exec: defExec, log: console.log, ...(backend || backendOverride || {}) };
  const h = String(host || '').trim().toLowerCase();
  const sid = String(sessionId || '').slice(0, 36);
  if (!validHost(h)) return { status: 400, result: { ok: false, error: 'Ungültiger Host.' } };
  let addrs;
  try { addrs = await lookup(h); }
  catch { log(`[ping] session=${sid} host=${h} error=dns`); return { status: 200, result: { ok: false, error: 'Host nicht gefunden.' } }; }
  const ips = (Array.isArray(addrs) ? addrs : [addrs]).map(a => a && a.address).filter(a => typeof a === 'string' && a.length);
  if (!ips.length) { log(`[ping] session=${sid} host=${h} error=dns-empty`); return { status: 200, result: { ok: false, error: 'Host nicht gefunden.' } }; }
  if (ips.some(ipBlocked)) {
    log(`[ping] session=${sid} host=${h} blocked (resolved: ${ips.join(',')})`);
    return { status: 403, result: { ok: false, error: 'Private oder reservierte Adresse blockiert.' } };
  }
  const ip = ips[0];
  const { err, stdout } = await exec(ip);
  const m = String(stdout).match(/time[=<]([\d.]+)\s*ms/i);
  if (!err && m) {
    const ms = Math.round(parseFloat(m[1]));
    log(`[ping] session=${sid} host=${h} ip=${ip} ok=true ms=${ms}`);
    return { status: 200, result: { ok: true, ip, ms } };
  }
  log(`[ping] session=${sid} host=${h} ip=${ip} ok=false`);
  const timedOut = err && /timeout|timed?\s*out/i.test(String(err.message || err));
  return { status: 200, result: { ok: false, ip, error: timedOut ? 'Zeitüberschreitung.' : 'Keine Antwort.' } };
}
