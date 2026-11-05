/**
 * Failure telemetry sink — see docs/telemetry.md.
 *
 * Append-only JSONL under <server>/logs/telemetry-YYYY-MM-DD.jsonl, one line
 * per failure event, plus a stable signature (`fx_<16hex>`) so the drainer and
 * the error register can join on the same key.
 *
 * Rules:
 *  - no PII, no secrets, no IPs, no request bodies are stored;
 *  - a telemetry write must NEVER throw into a request handler;
 *  - the client can never make the server fail because of telemetry.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOG_DIR = process.env.TELEMETRY_DIR || path.join(__dirname, 'logs');
const RETENTION_DAYS = Math.max(1, parseInt(process.env.TELEMETRY_RETENTION_DAYS || '14', 10) || 14);
const MAX_BODY_BYTES = 64 * 1024;
const MAX_EVENTS_PER_BATCH = 50;
const MAX_EVENTS_PER_MINUTE = 300;

const CLASSES = new Set([
  'app_error',
  'player_error',
  'api_error',
  'update_download_failed',
  'update_install_failed',
  'stream_resolve_failed',
  'proxy_upstream_error',
  'subtitle_failed',
  'catalog_fetch_failed',
  'app_restart'
]);

// Only these fields may leave a device. Everything else is dropped.
const FIELDS = [
  'cls', 'kind', 'code', 'route', 'msg', 'platform', 'appVersion',
  'versionCode', 'mediaId', 'se', 'ep', 'res', 'src', 'detail', 'sessionId',
  'installId'
];

const rateBuckets = new Map(); // ip -> { minute, count }
let lastPruneDay = '';

function todayStamp(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function ensureDir() {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (e) {
    /* read-only disk: telemetry degrades to a no-op */
  }
}

function telemetryFile() {
  return path.join(LOG_DIR, `telemetry-${todayStamp()}.jsonl`);
}

/** Strip secrets/URLs/control chars, collapse whitespace, bound length. */
function normalizeMessage(value) {
  if (typeof value !== 'string') return '';
  let s = value
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/https?:\/\/[^\s"']+/gi, '[url]')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '[hex]')
    .replace(/\b[A-Za-z0-9+/=]{60,}\b/g, '[blob]')
    .replace(/\b(token|secret|password|apikey|api_key|authorization)=?[^\s&"']*/gi, '$1=[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > 300) s = s.slice(0, 297) + '...';
  return s;
}

function pickNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  if (Math.abs(n) > 1e9) return undefined;
  return n;
}

function sanitizeEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const cls = String(raw.cls || '').toLowerCase();
  if (!CLASSES.has(cls)) return null;

  const event = { cls };
  for (const key of FIELDS) {
    if (key === 'cls' || raw[key] === undefined || raw[key] === null) continue;
    if (key === 'se' || key === 'ep' || key === 'res' || key === 'versionCode') {
      const n = pickNumber(raw[key]);
      if (n !== undefined) event[key] = n;
      continue;
    }
    if (key === 'installId') {
      // Anonymous random per-install id only — never a name/email/IP. Reject
      // anything that does not look like a generated id so users cannot smuggle
      // personal data in through this field.
      const id = String(raw[key] || '');
      if (/^[A-Za-z0-9-]{8,64}$/.test(id)) event.installId = id;
      continue;
    }
    if (key === 'msg' || key === 'detail') {
      event[key] = normalizeMessage(String(raw[key]));
      continue;
    }
    const value = String(raw[key]);
    event[key] = value.length > 120 ? value.slice(0, 120) : value;
  }
  event.platform = event.platform || 'unknown';
  event.ts = new Date().toISOString();
  event.sig = signature(event);
  return event;
}

/** fx_ + sha256(cls|kind|code|route|normalizedMsg|src) first 16 hex. */
function signature(event) {
  const base = [event.cls, event.kind, event.code, event.route, event.msg, event.src]
    .map(v => (v === undefined || v === null ? '' : String(v)))
    .join('|');
  return 'fx_' + crypto.createHash('sha256').update(base).digest('hex').slice(0, 16);
}

function pruneOldFiles() {
  const today = todayStamp();
  if (today === lastPruneDay) return;
  lastPruneDay = today;
  try {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const name of fs.readdirSync(LOG_DIR)) {
      if (!/^telemetry-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)) continue;
      const full = path.join(LOG_DIR, name);
      try {
        if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
      } catch (e) { /* keep going */ }
    }
  } catch (e) { /* no directory yet */ }
}

const INBOX_DIR = path.join(LOG_DIR, 'inbox');
const WINDOW_MS = 15 * 60 * 1000;
const THRESHOLD = 3;
const P0_SIGNATURES = new Set([
  'update_install_failed|signature_mismatch',
  'update_install_failed|parse_error',
  'app_error|render_crash'
]);

const sigStats = new Map(); // sig -> in-memory counters for real-time incidents

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

function writeJsonSafe(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Real-time incident creation: the moment a signature crosses its threshold
 * (any P0 class, or 3 occurrences in 15 minutes), write the inbox record the
 * failure-monitor role reads. No scheduler needed for detection.
 */
function trackIncident(event) {
  try {
    const sig = event.sig;
    const now = Date.parse(event.ts) || Date.now();
    let stat = sigStats.get(sig);
    if (!stat) {
      stat = { count: 0, times: [], firstSeen: event.ts, lastSeen: event.ts, platforms: {}, versions: {}, installs: {}, samples: [] };
      sigStats.set(sig, stat);
    }
    stat.count++;
    stat.lastSeen = event.ts;
    stat.times.push(now);
    if (stat.times.length > 200) stat.times = stat.times.slice(-200);

    const platform = event.platform || 'unknown';
    stat.platforms[platform] = (stat.platforms[platform] || 0) + 1;
    const version = String(event.appVersion || event.versionCode || 'unknown');
    stat.versions[version] = (stat.versions[version] || 0) + 1;
    if (event.installId) stat.installs[event.installId] = (stat.installs[event.installId] || 0) + 1;
    if (stat.samples.length < 3) {
      stat.samples.push({ ts: event.ts, cls: event.cls, kind: event.kind, code: event.code, route: event.route, msg: event.msg, detail: event.detail, platform, appVersion: event.appVersion, mediaId: event.mediaId, installId: event.installId, src: event.src });
    }

    const windowCount = stat.times.filter(t => now - t <= WINDOW_MS).length;
    const isP0 = P0_SIGNATURES.has(`${event.cls}|${event.kind}`);
    const open = isP0 || windowCount >= THRESHOLD;
    if (!open) return;

    const inboxFile = path.join(INBOX_DIR, `FAIL-${sig}.json`);
    const existing = readJsonSafe(inboxFile);
    writeJsonSafe(inboxFile, {
      sig,
      cls: event.cls,
      kind: event.kind || '',
      code: event.code || '',
      route: event.route || '',
      sev: isP0 ? 'P0' : 'P2',
      reason: isP0 ? 'p0-class' : `${windowCount}-in-15min`,
      count: stat.count,
      windowCount,
      firstSeen: stat.firstSeen,
      lastSeen: stat.lastSeen,
      platforms: stat.platforms,
      versions: stat.versions,
      installs: Object.keys(stat.installs).length,
      installIds: Object.keys(stat.installs).slice(0, 5),
      samples: stat.samples,
      status: existing && existing.status ? existing.status : 'new',
      createdAt: existing && existing.createdAt ? existing.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  } catch (e) {
    /* detection must never break the sink */
  }
}

function appendEvents(events) {
  if (!events.length) return 0;
  try {
    ensureDir();
    pruneOldFiles();
    const lines = events.map(e => JSON.stringify(e)).join('\n') + '\n';
    fs.appendFileSync(telemetryFile(), lines, 'utf8');
    for (const event of events) trackIncident(event);
    return events.length;
  } catch (e) {
    return 0;
  }
}

/** Server-side emitter for a failure discovered in our own code. Never throws. */
function emit(cls, fields) {
  try {
    const event = sanitizeEvent(Object.assign({ platform: 'server', src: 'server' }, fields, { cls }));
    if (event) appendEvents([event]);
  } catch (e) { /* telemetry must never break a request */ }
}

/** POST /api/telemetry/events — batched client events. Always answers 204. */
function handler(req, res) {
  try {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const minute = Math.floor(Date.now() / 60000);
    const bucket = rateBuckets.get(ip);
    if (!bucket || bucket.minute !== minute) {
      rateBuckets.set(ip, { minute, count: 0 });
    }
    const budget = rateBuckets.get(ip);

    const body = req.body;
    const list = Array.isArray(body) ? body : (body && Array.isArray(body.events) ? body.events : []);
    if (!list.length || budget.count >= MAX_EVENTS_PER_MINUTE) return res.status(204).end();

    const accepted = [];
    for (const raw of list.slice(0, MAX_EVENTS_PER_BATCH)) {
      if (budget.count >= MAX_EVENTS_PER_MINUTE) break;
      const event = sanitizeEvent(raw);
      if (!event) continue;
      budget.count++;
      accepted.push(event);
    }
    appendEvents(accepted);
  } catch (e) {
    /* always 204: a telemetry failure must not surface to clients */
  }
  return res.status(204).end();
}

/** GET /api/telemetry/status (admin) — pipeline health for the failure monitor. */
function statusHandler(req, res) {
  try {
    ensureDir();
    const files = fs.existsSync(LOG_DIR)
      ? fs.readdirSync(LOG_DIR).filter(n => /^telemetry-\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).sort()
      : [];
    const today = telemetryFile();
    let todayLines = 0;
    let todayBytes = 0;
    if (fs.existsSync(today)) {
      todayBytes = fs.statSync(today).size;
      todayLines = fs.readFileSync(today, 'utf8').split('\n').filter(Boolean).length;
    }
    res.json({
      status: 'ok',
      dir: LOG_DIR,
      retentionDays: RETENTION_DAYS,
      fileCount: files.length,
      latestFile: files[files.length - 1] || null,
      todayLines,
      todayBytes
    });
  } catch (e) {
    res.status(500).json({ error: 'telemetry status failed', message: e.message });
  }
}

module.exports = {
  emit,
  handler,
  statusHandler,
  sanitizeEvent,
  signature,
  normalizeMessage,
  CLASSES
};
