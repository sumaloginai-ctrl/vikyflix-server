/**
 * Watch activity reporter — "what was watched" (option A: title only, no timing).
 *
 * Deliberately separate from telemetry.js (failures). Sends a batched event to
 * POST /api/activity/events whenever playback actually starts. Queue is
 * bounded, deduped per title for 5 minutes, and stored locally so a dead
 * network never blocks playback.
 *
 * Privacy: anonymous installId only — no name, no IP, no account. A user can
 * opt out by setting localStorage.vf_activity_opt_out = '1'.
 */
import { API_BASE, IS_NATIVE_APP } from './config.js';
import { getInstallId } from './telemetry.js';
import { describeDevice } from './device.js';

const QUEUE_KEY = 'vf_actq_v1';
const MAX_QUEUE = 50;
const BATCH = 20;
const FLUSH_MS = 20000;
const DEDUPE_MS = 5 * 60 * 1000;
const OPT_OUT_KEY = 'vf_activity_opt_out';

const seen = new Map(); // mediaKey -> last report ms
let timer = null;

function optedOut() {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === '1';
  } catch (e) {
    return false;
  }
}

function platformName() {
  try {
    if (IS_NATIVE_APP) {
      const ua = navigator.userAgent || '';
      if (/MovieFlixTV|TV|BRAVIA|AFT|FireTV|Broadcast|Android TV/i.test(ua) || ua.includes('CrKey')) return 'tv';
      return 'android';
    }
  } catch (e) { /* ignore */ }
  return 'web';
}

function appContext() {
  const info = (typeof window !== 'undefined' && window.__VF_APP_INFO) || {};
  let versionName = info.versionName;
  let versionCode = info.versionCode;
  // The launch heartbeat can fire before the version manifest loads; read the
  // installed APK version straight from the Android bridge as a fallback.
  try {
    const bridge = typeof window !== 'undefined' ? window.AndroidStreamBridge : null;
    if (!versionName && bridge && typeof bridge.getAppVersionName === 'function') versionName = bridge.getAppVersionName();
    if (!versionCode && bridge && typeof bridge.getAppVersionCode === 'function') versionCode = bridge.getAppVersionCode();
  } catch (e) { /* bridge unavailable on web */ }
  return {
    appVersion: versionName || undefined,
    versionCode: versionCode || undefined
  };
}

function readQueue() {
  try {
    const parsed = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function writeQueue(queue) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE)));
  } catch (e) { /* quota/private mode: drop silently */ }
}

function scheduleFlush() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flushActivity();
  }, 4000);
}

function sendBatch(batch) {
  try {
    fetch(`${API_BASE}/api/activity/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }),
      keepalive: true,
      cache: 'no-store'
    })
      .then(res => {
        if (res.ok || res.status === 204) {
          const queue = readQueue();
          writeQueue(queue.slice(batch.length));
        }
      })
      .catch(() => { /* keep queued; retried next flush */ });
  } catch (e) { /* fetch unavailable: keep queued */ }
}

/**
 * Report that playback started for a title. Safe to call repeatedly — the same
 * title is ignored for 5 minutes so resume/seek does not spam.
 */
export function reportPlay({ mediaId, title, se, ep }) {
  try {
    if (optedOut()) return;
    if (typeof window === 'undefined') return;
    const mediaKey = `${mediaId || title}|${se || ''}|${ep || ''}`;
    const now = Date.now();
    const last = seen.get(mediaKey);
    if (last && now - last < DEDUPE_MS) return;
    seen.set(mediaKey, now);
    if (seen.size > 200) seen.clear();

    const event = Object.assign({
      type: 'play',
      mediaId: mediaId ? String(mediaId) : undefined,
      title: title ? String(title) : undefined,
      se: se === undefined || se === null ? undefined : Number(se),
      ep: ep === undefined || ep === null ? undefined : Number(ep),
      platform: platformName(),
      device: describeDevice(),
      installId: getInstallId()
    }, appContext());

    const queue = readQueue();
    queue.push(event);
    writeQueue(queue);
    scheduleFlush();
  } catch (e) { /* never break playback for activity reporting */ }
}

/**
 * Tell the owner "this install exists and runs version X". Sent once per app
 * session; it is how you learn that a user installed the new APK (old builds
 * cannot send anything at all).
 */
export function reportAppOpen() {
  try {
    if (optedOut() || typeof window === 'undefined') return;
    if (sessionStorage.getItem('vf_ao_sent') === '1') return;
    sessionStorage.setItem('vf_ao_sent', '1');
    const event = Object.assign({
      type: 'app_open',
      platform: platformName(),
      device: describeDevice(),
      installId: getInstallId()
    }, appContext());
    const queue = readQueue();
    queue.push(event);
    writeQueue(queue);
    scheduleFlush();
  } catch (e) { /* never block boot for a heartbeat */ }
}

export function flushActivity() {
  try {
    const queue = readQueue();
    if (!queue.length) return;
    const batch = queue.slice(0, BATCH);
    sendBatch(batch);
  } catch (e) { /* ignore */ }
}

/** Call once from main.jsx. Never throws. */
export function initActivity() {
  try {
    if (typeof window === 'undefined') return;
    reportAppOpen();
    setInterval(flushActivity, FLUSH_MS);
    window.addEventListener('pagehide', flushActivity);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushActivity();
    });
    setTimeout(flushActivity, 5000);
  } catch (e) { /* activity must never block boot */ }
}
