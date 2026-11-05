/**
 * Client failure capture — see docs/telemetry.md.
 *
 * Every user-facing failure is reported as a small structured event:
 * JS crashes, HLS/video errors, API failures, update download/install
 * failures. Events are queued in localStorage (bounded) and shipped in
 * batches to POST /api/telemetry/events; the server answers 204 always.
 *
 * Hard rules:
 *  - capture must never throw into the app, never block rendering/playback;
 *  - no PII, no tokens, no full URLs with secrets (server re-sanitizes too).
 */
import { API_BASE, IS_NATIVE_APP } from './config.js';

const QUEUE_KEY = 'vf_telq_v1';
const SESSION_KEY = 'vf_tsess_v1';
const MAX_QUEUE = 100;
const BATCH = 20;
const FLUSH_MS = 30000;
const DEDUPE_MS = 60000;

let started = false;
let sessionId = 'anon';
let timer = null;
const seen = new Map(); // signature -> last report ms (in-memory dedupe)

function nowStamp() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function getSessionId() {
  try {
    let s = sessionStorage.getItem(SESSION_KEY);
    if (!s) {
      s = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem(SESSION_KEY, s);
    }
    return s;
  } catch (e) {
    return 'anon';
  }
}

function platformName() {
  try {
    if (IS_NATIVE_APP) {
      const ua = navigator.userAgent || '';
      if (/MovieFlixTV|TV|BRAVIA|AFT|FireTV|Broadcast|Android TV/i.test(ua) || ua.includes('CrKey')) return 'tv';
      return 'android';
    }
  } catch (e) {
    /* ignore */
  }
  return 'web';
}

function appContext() {
  const info = (typeof window !== 'undefined' && window.__VF_APP_INFO) || {};
  return {
    appVersion: info.versionName || undefined,
    versionCode: info.versionCode || undefined
  };
}

function readQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function writeQueue(queue) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE)));
  } catch (e) {
    /* quota/full or private mode: drop silently */
  }
}

function sigOf(event) {
  return [event.cls, event.kind, event.code, event.route, event.msg, event.src].join('|');
}

function enqueue(event) {
  const sig = sigOf(event);
  const last = seen.get(sig);
  const t = Date.now();
  if (last && t - last < DEDUPE_MS) return;
  seen.set(sig, t);
  if (seen.size > 200) seen.clear();

  const queue = readQueue();
  queue.push(event);
  writeQueue(queue);
  scheduleFlush();
}

/** Public: report any classified failure. Never throws. */
export function reportFailure(fields) {
  try {
    if (typeof window === 'undefined' || !fields || !fields.cls) return;
    const event = Object.assign({}, fields, {
      ts: new Date().toISOString(),
      sessionId,
      platform: fields.platform || platformName()
    }, appContext());
    enqueue(event);
  } catch (e) {
    /* never break the app for telemetry */
  }
}

export function reportApiError(route, status, method) {
  reportFailure({
    cls: 'api_error',
    kind: 'http_error',
    route,
    code: status ? String(status) : 'network_error',
    detail: method ? `${method} ${status || 'network'}` : undefined,
    src: 'fetch'
  });
}

export function reportPlayerError(detail) {
  reportFailure({
    cls: 'player_error',
    kind: (detail && detail.kind) || 'video_error',
    code: detail && detail.code !== undefined ? String(detail.code) : undefined,
    mediaId: detail && detail.mediaId,
    detail: detail && detail.detail
  });
}

export function reportAppError(kind, detail, src) {
  reportFailure({
    cls: 'app_error',
    kind: kind || 'uncaught_error',
    detail,
    src: src || 'window'
  });
}

function removeBatch(batch) {
  const ids = new Set(batch.map(e => e._qid));
  const queue = readQueue().filter(e => !ids.has(e._qid));
  writeQueue(queue);
}

function sendBatch(batch) {
  const payload = JSON.stringify({ events: batch });
  const url = `${API_BASE}/api/telemetry/events`;
  try {
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
      cache: 'no-store'
    })
      .then(res => {
        if (res.ok || res.status === 204) removeBatch(batch);
      })
      .catch(() => { /* keep queued; retried on the next flush */ });
  } catch (e) {
    /* fetch unavailable: keep queued */
  }
}

export function flushTelemetry() {
  try {
    const queue = readQueue();
    if (!queue.length) return;
    const batch = queue.slice(0, BATCH).map(e => Object.assign({ _qid: nowStamp() }, e));
    // Persist the assigned ids so a successful send can remove exactly these.
    const rest = queue.slice(BATCH);
    writeQueue(batch.concat(rest));
    sendBatch(batch.map(e => {
      const copy = Object.assign({}, e);
      delete copy._qid;
      return copy;
    }));
  } catch (e) {
    /* ignore */
  }
}

function scheduleFlush() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flushTelemetry();
  }, 2500);
}

/** Call once from main.jsx before rendering. Never throws. */
export function initTelemetry() {
  try {
    if (started || typeof window === 'undefined') return;
    started = true;
    sessionId = getSessionId();

    window.addEventListener('error', (event) => {
      reportAppError('uncaught_error', event.message || 'unknown error', 'window');
    });

    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      const detail = reason && (reason.message || String(reason));
      reportAppError('unhandled_rejection', detail, 'promise');
    });

    window.addEventListener('pagehide', () => flushTelemetry());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushTelemetry();
    });

    setInterval(flushTelemetry, FLUSH_MS);
    setTimeout(flushTelemetry, 4000);
  } catch (e) {
    /* telemetry must never block boot */
  }
}
