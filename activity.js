/**
 * Activity sink — captures what was watched (option A: title only, no timing).
 *
 * POST /api/activity/events  →  204 always
 *   body: { events: [ { type:"play", mediaId, title, se?, ep?, platform, appVersion, installId } ] }
 * stored: server/logs/activity-YYYY-MM-DD.jsonl (one line per play, 30-day retention)
 *
 * Deliberately separate from telemetry.js:
 *  - telemetry = failures (alerts, incidents, fixes)
 *  - activity  = normal usage ("what was watched"), never triggers alerts
 * No names, no IPs, no accounts — only the anonymous installId.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const LOG_DIR = process.env.ACTIVITY_DIR || path.join(__dirname, 'logs');
const RETENTION_DAYS = Math.max(1, parseInt(process.env.ACTIVITY_RETENTION_DAYS || '30', 10) || 30);
const MAX_BATCH = 50;
const MAX_PER_MINUTE = 300;

const TYPES = new Set(['play', 'app_open']);
const FIELDS = ['type', 'installId', 'platform', 'appVersion', 'versionCode', 'mediaId', 'title', 'se', 'ep'];

const rateBuckets = new Map();
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
  } catch (e) { /* telemetry degrades to no-op */ }
}

function activityFile() {
  return path.join(LOG_DIR, `activity-${todayStamp()}.jsonl`);
}

function cleanText(value, max = 140) {
  if (typeof value !== 'string') return '';
  const s = value
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/https?:\/\/[^\s"']+/gi, '[url]')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

function pickNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) < 1e6 ? n : undefined;
}

function sanitizeEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = String(raw.type || '').toLowerCase();
  if (!TYPES.has(type)) return null;

  const event = { type, ts: new Date().toISOString() };
  for (const key of FIELDS) {
    if (key === 'type' || raw[key] === undefined || raw[key] === null) continue;
    if (key === 'se' || key === 'ep' || key === 'versionCode') {
      const n = pickNumber(raw[key]);
      if (n !== undefined) event[key] = n;
      continue;
    }
    if (key === 'installId') {
      const id = String(raw[key] || '');
      if (/^[A-Za-z0-9-]{8,64}$/.test(id)) event.installId = id;
      continue;
    }
    event[key] = cleanText(String(raw[key]), key === 'title' ? 140 : 120);
  }
  if (event.type === 'play' && !event.mediaId && !event.title) return null;
  if (event.type === 'app_open' && !event.installId) return null; // launch must at least identify the install
  return event;
}

function pruneOldFiles() {
  const today = todayStamp();
  if (today === lastPruneDay) return;
  lastPruneDay = today;
  try {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const name of fs.readdirSync(LOG_DIR)) {
      if (!/^activity-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)) continue;
      const full = path.join(LOG_DIR, name);
      try {
        if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
      } catch (e) { /* keep going */ }
    }
  } catch (e) { /* no directory yet */ }
}

function appendEvents(events) {
  if (!events.length) return 0;
  try {
    ensureDir();
    pruneOldFiles();
    const lines = events.map(e => JSON.stringify(e)).join('\n') + '\n';
    fs.appendFileSync(activityFile(), lines, 'utf8');
    return events.length;
  } catch (e) {
    return 0;
  }
}

/** POST /api/activity/events — always 204; never throws into the request path. */
function handler(req, res) {
  try {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const minute = Math.floor(Date.now() / 60000);
    let bucket = rateBuckets.get(ip);
    if (!bucket || bucket.minute !== minute) {
      bucket = { minute, count: 0 };
      rateBuckets.set(ip, bucket);
    }
    const body = req.body;
    const list = Array.isArray(body) ? body : (body && Array.isArray(body.events) ? body.events : []);
    if (!list.length || bucket.count >= MAX_PER_MINUTE) return res.status(204).end();

    const accepted = [];
    for (const raw of list.slice(0, MAX_BATCH)) {
      if (bucket.count >= MAX_PER_MINUTE) break;
      const event = sanitizeEvent(raw);
      if (!event) continue;
      bucket.count++;
      accepted.push(event);
    }
    appendEvents(accepted);
  } catch (e) { /* never surface activity problems to clients */ }
  return res.status(204).end();
}

/** GET /api/activity/status (admin) — cheap health for the watch report. */
function statusHandler(req, res) {
  try {
    ensureDir();
    const today = new Date();
    const files = fs.existsSync(LOG_DIR)
      ? fs.readdirSync(LOG_DIR).filter(n => /^activity-\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).sort()
      : [];
    const todayFile = activityFile();
    let todayLines = 0;
    if (fs.existsSync(todayFile)) {
      todayLines = fs.readFileSync(todayFile, 'utf8').split('\n').filter(Boolean).length;
    }
    res.json({
      status: 'ok',
      dir: LOG_DIR,
      retentionDays: RETENTION_DAYS,
      fileCount: files.length,
      latestFile: files[files.length - 1] || null,
      todayLines,
      date: todayStamp(today)
    });
  } catch (e) {
    res.status(500).json({ error: 'activity status failed', message: e.message });
  }
}

module.exports = { handler, statusHandler, sanitizeEvent };
