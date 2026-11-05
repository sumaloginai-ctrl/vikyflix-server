#!/usr/bin/env node
/**
 * failure-drain.js — deterministic failure detector for the MovieFlix server.
 *
 * Reads new lines from server/logs/telemetry-*.jsonl (cursor kept in
 * logs/drain-state.json), groups them by signature, and writes one inbox file
 * per failure that crosses a threshold:
 *
 *   logs/inbox/FAIL-<sig>.json      incident record (status: new)
 *   logs/monitor-status.json        heartbeat for the failure-monitor agent
 *
 * Thresholds (docs/telemetry.md §8): any P0-class event, or >= 3 events for
 * the same signature within 15 minutes. Run it from anywhere:
 *
 *   node server/failure-drain.js            # normal run
 *   node server/failure-drain.js --status   # print state, no scan
 *   node server/failure-drain.js --rebuild  # ignore cursor, rescan all files
 *
 * No dependencies, no network, must never throw.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOG_DIR = process.env.TELEMETRY_DIR || path.join(__dirname, 'logs');
const INBOX_DIR = path.join(LOG_DIR, 'inbox');
const STATE_FILE = path.join(LOG_DIR, 'drain-state.json');
const STATUS_FILE = path.join(LOG_DIR, 'monitor-status.json');

const WINDOW_MS = 15 * 60 * 1000;
const THRESHOLD = 3;
const P0_PREFIX = [
  'update_install_failed|signature_mismatch',
  'update_install_failed|parse_error',
  'app_error|render_crash'
];
const MAX_SAMPLES = 3;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

function telemetryFiles() {
  try {
    return fs.readdirSync(LOG_DIR)
      .filter(n => /^telemetry-\d{4}-\d{2}-\d{2}\.jsonl$/.test(n))
      .sort();
  } catch (e) {
    return [];
  }
}

function loadState() {
  const state = readJson(STATE_FILE, null);
  if (!state || typeof state !== 'object') return { cursor: null, sigs: {} };
  if (!state.sigs) state.sigs = {};
  return state;
}

function verdictFor(sigState) {
  const recent = (sigState.times || []).filter(t => Date.now() - t <= WINDOW_MS);
  const isP0 = P0_PREFIX.includes(`${sigState.cls}|${sigState.kind}`);
  if (isP0) return { open: true, sev: 'P0', reason: 'p0-class' };
  if (recent.length >= THRESHOLD) return { open: true, sev: 'P2', reason: `${recent.length}-in-15min` };
  return { open: false, sev: 'P3', reason: 'below-threshold' };
}

function ingestLine(line, state, counters) {
  let event;
  try {
    event = JSON.parse(line);
  } catch (e) {
    return;
  }
  if (!event || !event.sig || !event.cls) return;
  counters.eventsRead++;

  const sig = String(event.sig);
  let sigState = state.sigs[sig];
  if (!sigState) {
    sigState = state.sigs[sig] = {
      sig,
      cls: event.cls,
      kind: event.kind || '',
      code: event.code || '',
      route: event.route || '',
      firstSeen: event.ts || new Date().toISOString(),
      lastSeen: event.ts || new Date().toISOString(),
      count: 0,
      times: [],
      platforms: {},
      versions: {},
      installs: {},
      samples: []
    };
  }

  sigState.count++;
  sigState.lastSeen = event.ts || new Date().toISOString();
  sigState.times.push(Date.parse(event.ts) || Date.now());
  if (sigState.times.length > 200) sigState.times = sigState.times.slice(-200);

  const platform = event.platform || 'unknown';
  sigState.platforms[platform] = (sigState.platforms[platform] || 0) + 1;
  const version = String(event.appVersion || event.versionCode || 'unknown');
  sigState.versions[version] = (sigState.versions[version] || 0) + 1;
  if (event.installId) sigState.installs[event.installId] = (sigState.installs[event.installId] || 0) + 1;

  if (sigState.samples.length < MAX_SAMPLES) {
    sigState.samples.push({
      ts: event.ts,
      cls: event.cls,
      kind: event.kind || '',
      code: event.code || '',
      route: event.route || '',
      msg: event.msg || '',
      platform,
      appVersion: event.appVersion,
      mediaId: event.mediaId,
      installId: event.installId,
      src: event.src
    });
  }

  const verdict = verdictFor(sigState);
  if (!verdict.open) return;

  const inboxFile = path.join(INBOX_DIR, `FAIL-${sig}.json`);
  const existing = readJson(inboxFile, null);
  const record = {
    sig,
    cls: sigState.cls,
    kind: sigState.kind,
    code: sigState.code,
    route: sigState.route,
    sev: verdict.sev,
    reason: verdict.reason,
    count: sigState.count,
    windowCount: (sigState.times || []).filter(t => Date.now() - t <= WINDOW_MS).length,
    firstSeen: sigState.firstSeen,
    lastSeen: sigState.lastSeen,
    platforms: sigState.platforms,
    versions: sigState.versions,
    installs: Object.keys(sigState.installs || {}).length,
    installIds: Object.keys(sigState.installs || {}).slice(0, 5),
    samples: sigState.samples,
    status: existing && existing.status ? existing.status : 'new',
    createdAt: existing && existing.createdAt ? existing.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (writeJson(inboxFile, record)) {
    if (existing) counters.inboxMerged++;
    else {
      counters.inboxNew++;
      if (verdict.sev === 'P0') counters.p0++;
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const state = loadState();

  if (args.includes('--status')) {
    const inbox = readInbox();
    console.log(JSON.stringify({
      logDir: LOG_DIR,
      fileCount: telemetryFiles().length,
      signatureCount: Object.keys(state.sigs || {}).length,
      cursor: state.cursor,
      inbox: inbox.map(r => ({ sig: r.sig, cls: r.cls, sev: r.sev, status: r.status, count: r.count }))
    }, null, 2));
    return 0;
  }

  if (args.includes('--rebuild')) {
    state.cursor = null;
    state.sigs = {};
  }

  const counters = { filesScanned: 0, linesRead: 0, eventsRead: 0, inboxNew: 0, inboxMerged: 0, p0: 0 };
  const files = telemetryFiles();
  const cursor = state.cursor || { file: '', offset: 0 };

  for (const name of files) {
    const full = path.join(LOG_DIR, name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch (e) {
      continue;
    }
    const isCursorFile = name === cursor.file;
    if (!isCursorFile && cursor.file && name < cursor.file) continue; // already consumed
    let size = stat.size;
    let start = 0;
    if (isCursorFile) {
      start = cursor.offset > size ? 0 : cursor.offset; // rotation/truncation guard
    }
    if (size <= start) {
      continue;
    }
    let text;
    try {
      const fd = fs.openSync(full, 'r');
      const length = size - start;
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, start);
      fs.closeSync(fd);
      text = buffer.toString('utf8');
    } catch (e) {
      continue;
    }
    const lines = text.split('\n');
    const complete = lines.slice(0, -1); // last may be partial
    const consumed = complete.length;
    counters.filesScanned++;
    for (const line of complete) {
      if (!line.trim()) continue;
      counters.linesRead++;
      ingestLine(line, state, counters);
    }
    const consumedBytes = complete.reduce((n, l) => n + Buffer.byteLength(l, 'utf8') + 1, 0);
    state.cursor = { file: name, offset: start + consumedBytes };
    if (consumed === 0 && lines.length > 1) {
      state.cursor = { file: name, offset: start };
    }
  }

  const status = {
    lastRunAt: new Date().toISOString(),
    logDir: LOG_DIR,
    filesScanned: counters.filesScanned,
    linesRead: counters.linesRead,
    eventsRead: counters.eventsRead,
    inboxNew: counters.inboxNew,
    inboxMerged: counters.inboxMerged,
    p0: counters.p0,
    signatureCount: Object.keys(state.sigs || {}).length,
    cursor: state.cursor
  };
  writeJson(STATE_FILE, state);
  writeJson(STATUS_FILE, status);

  console.log(`DRAIN_EVENTS=${counters.eventsRead} NEW_FAIL=${counters.inboxNew} MERGED=${counters.inboxMerged} P0=${counters.p0}`);
  return 0;
}

function readInbox() {
  try {
    return fs.readdirSync(INBOX_DIR)
      .filter(n => /^FAIL-.+\.json$/.test(n))
      .map(n => readJson(path.join(INBOX_DIR, n), null))
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

try {
  process.exitCode = main();
} catch (e) {
  console.error('DRAIN_FAILED:', e && e.message);
  process.exitCode = 1;
}
