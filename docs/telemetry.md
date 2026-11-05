# Failure telemetry — event contract and capture design

> **STATUS: STAGES 1, 2, 4 IMPLEMENTED (2026-11-05).** The server accepts
> `POST /api/telemetry/events` (sink: `server/telemetry.js`, wired in
> `server/index.js`); the web client captures JS crashes, HLS/video errors, API
> failures and update download/install failures (`web/src/telemetry.js`, wired
> in `main.jsx`, `App.jsx`, `VideoPlayer.jsx`, `AppUpdateModal.jsx`); and each
> signature that crosses a threshold — or any P0 class immediately — writes
> `server/logs/inbox/FAIL-<sig>.json` in real time. `server/failure-drain.js`
> rebuilds cursor/state from JSONL for recovery and adds the heartbeat.
> **Stage 3 (Android install OUTCOME: user-cancel / signature / parse) is still
> planned**: the native state machine reports `permission`/`installing` but no
> install result yet, so some install failures remain invisible until that
> lands. Everything still marked **(planned)** below is not built.
>
> Verified 2026-11-05: `node --check` on all touched server files; live HTTP
> round-trip `POST → 204 → JSONL`; real-time inbox creation for a 3× signature
> and for a single P0 signature; `failure-drain.js` heartbeat/state; web
> `oxlint` 0 errors and `vite build` exit 0. The browser client was not clicked
> through (no browser automation) — browser-side capture is code-reviewed, not
> observed.
>
> Companion procedure: `Skills/failure-monitor.md` (reads what this contract
> produces). Schema conflicts: this file wins. Incident/register schema:
> `docs/error-register.md` wins.

## 1. Goals and non-goals

**Goals**

1. Capture user-visible failures **before a user reports them**, on every
   surface: website (`vikyflix.uk` / `localhost:5173`), Android phone
   (`uk.vikyflix.app`), Android TV (`uk.vikyflix.tv`), and the PC/Render API.
2. Store them where the failure-monitor agent can read them on the PC:
   append-only JSONL under `server/logs/`.
3. Turn repeated failures into a small **failure inbox** (`FAIL-<sig>.json`)
   with a stable signature, count, severity, versions, platforms and ≤3 samples.
4. Feed `docs/error-register.md` so every fixed failure leaves a prevention rule.

**Non-goals**

- No third-party analytics/crash SDK, no user tracking, no ad IDs, no session
  replay, no watch-history recording, no remote upload of customer content.
- Not a metrics dashboard or an APM product; no per-request tracing.
- No telemetry storage on Render: the free instance has an ephemeral disk and
  no reader endpoint (`server/render.yaml` has no disk; the monitor runs on the
  PC). When the PC is unreachable, clients queue locally (bounded) instead.
- No auto-fix logic here — that is the monitor playbook's autonomy matrix.
- No capturing of `ADMIN_KEY`, `.env` values, keystore material or tokens.

## 2. Privacy rules (hard, enforced server-side too)

**Allowed fields:** event class, error code/message (sanitized), platform,
site/app version and `versionCode`, API endpoint **path template** (no query
values), HTTP status, duration, media title id (`mb_<digits>`), season/episode,
resolution, audio-edition index, build flavour, boolean capabilities
(`canInstallApks`), counts and timestamps.

**Forbidden (never collected, never stored):** names, emails, phone numbers,
precise location, IP addresses, device identifiers (IMEI, Android ID,
advertising ID), cookies/tokens/Authorization headers, admin keys, `.env`
values, keystore paths/passwords, full URLs with query strings, watch history,
subtitle text, poster URLs with signed tokens.

**Sanitization** (function `normalizeEvent` in `server/telemetry.js` (planned),
applied again on the server because clients are untrusted): redact
`token|key|admin|auth|sig|signature|expires|password` query params and
`Bearer …`; replace emails, IPv4/IPv6, `C:\Users\…` / `E:\…` paths and hex
strings ≥32 chars with `[redacted]`; collapse whitespace; truncate `msg` to 300
chars and `data` values to 200 chars (≤1 KiB `data`). Timestamps: reject events
older than 7 days, clamp future >5 min to server time. The server never stores
`req.ip` and never logs request headers.

## 2.1 Identity model — no accounts, anonymous installs

There are no user accounts, so the pipeline must answer "how many installs were
affected?" without knowing who anyone is:

| Id | Scope | What it is | Where it goes |
|---|---|---|---|
| `installId` | one install | random UUID created once and kept on the device (`localStorage.vf_install_id`) | sent with events, stored 14 days in JSONL |
| `sessionId` | one app launch | random, `sessionStorage`; resets on every launch | sent with events |
| support code | shown to the user | last 6 characters of `installId`, e.g. `VF-4A9C21`; read out in a support message | displayed on the error screen only |

Rules: never attach a name, email, phone number, IP or account. The server
accepts `installId` only if it is random-id shaped and silently drops anything
else, so personal data cannot be smuggled into the log. Incidents report
**unique installs** (`installs`, `installIds`) next to the event count, so
"30 events" from 3 phones reads as "3 installs affected". When a user reports a
problem, their support code + `versionCode` lets the failure-monitor filter
`telemetry-*.jsonl` for that one install — no other identity is exposed.

## 3. What exists today (verified capture inventory)

| Surface | Current behaviour | Verified location | Gap |
|---|---|---|---|
| Web JS errors | `console.error` only in the React error boundary; no global handlers anywhere | `web/src/main.jsx:11-64` (`componentDidCatch` 21-23); grep finds no `window.onerror`/`unhandledrejection` | nothing persisted or reported |
| Web API failures | Each call has its own `try/catch`, most swallow silently (e.g. catalog candidate catch, update-check catch) | `web/src/App.jsx:519-562` (561, 563), `:652-753` (673, 745-747); `web/src/components/AppUpdateModal.jsx:46-55,103-107`; `web/src/VideoPlayer.jsx:1613-1624,1702-1703` | no counter, no endpoint/status record |
| Catalog failure UI | `loadError` is never set to `true` (only `setLoadError(false)` at `App.jsx:502`), so the designed "Can't reach MovieFlix servers" screen at `App.jsx:1224-1232` is effectively unreachable; its Retry button calls undefined `fetchAdminStats` (`:1229`) | `web/src/App.jsx:370,502,1224-1232` | failure is invisible; retry throws |
| Playback | HLS fatal errors are logged with `console.warn` and may only destroy the player; a 40 s no-data timer shows an overlay; `<video onError>` shows a message | `web/src/VideoPlayer.jsx:933-955`, `:805-814`, `:1963-1978` | no media id, no event, no count |
| OTA/update | In-app updater polls `bridge.getApkUpdateState()`: `idle`, `downloading:<pct>`, `ready`, `permission`, `installing`, `error:<message>` → UI text only | `web/src/components/AppUpdateModal.jsx:58-92`; state machine `web/android/.../MainActivity.java:29-31,41-131,134-171` | download/install failures never leave the device |
| Android install outcome | State stops at `installing`; user cancel, signature mismatch and parse error produce no signal to JS; `AutoRelaunchReceiver` only relaunches | `MainActivity.java:134-171`, `:310-318`; `AutoRelaunchReceiver.java:12-24` | **install failures are unobservable today** |
| Android stream resolution | Failures only `Log.w` to logcat; `/play` returns 404 JSON to the `<video>` element | `LocalStreamServer.java:37` (tag `VikyFlixStreamServer`), `:224-242`, `:303-306`, `:525-549` | device-only, no persistence |
| Server errors | `console.error`/`console.warn` into split launcher logs; no structured format, request id or client correlation | `server/index.js:755-758,864-870`; `server/moviebox.js:817,120-142,601-604,809-811` | not machine-groupable |
| Existing beacon | `navigator.sendBeacon` to `/api/stream/<id>/stop` on player unmount — that route no longer exists | `web/src/VideoPlayer.jsx:1006-1016`; route list ends at `server/index.js:836-848` and the old HLS routes are gone (`Skills/developer.md` §2.4) | the only beacon is dead; proves there is no working channel |

Android capability fact (verified from source): the main manifest deliberately
does **not** declare `REQUEST_INSTALL_PACKAGES` (`web/android/app/src/main/AndroidManifest.xml:64-67`)
and the share overlay removes it (`web/android/app/src/share/AndroidManifest.xml:9-11`),
so `canInstallApks()` (`MainActivity.java:271-283`) is expected to return `false`
on builds from this source (not executed here) → `AppUpdateModal` takes the
`Browser.open` branch (`:95-102`) and the native install state machine only runs
on older installed builds that still hold the permission. Telemetry must record
`canInstallApks` so the monitor does not "fix" install failures that cannot
occur on the installed base.

**Biggest existing gap:** there is no durable capture at all. User-visible
failures become console strings or a modal sentence that dies with the session,
so detection today = a human noticing or a server watchdog failure — exactly the
"users report it first" mode this role exists to end.

## 4. Event envelope and shared fields

Client wire format — `POST /api/telemetry/events` (planned), JSON:
`{ v:1, sentAt, session, platform, appVersion, versionCode, events:[…] }`.
`session` is a random per-app-session token (`s_<10 hex>`), not a device id.

Each event (client and server share the shape):

| Field | Required | Meaning |
|---|---|---|
| `eid` | client only | random per event, for dedupe by the drainer |
| `ts` | yes | ISO-8601 with offset (client event time) |
| `src` | yes | `client` \| `server` |
| `cls` | yes | one class from §5 |
| `code` | recommended | short snake_case code, ≤64 chars (e.g. `hls_fatal_network`) |
| `kind` | optional | sub-kind used by grouping |
| `msg` | recommended | human message, sanitized, ≤300 chars |
| `route` | for API/player | endpoint template or screen context, no query values |
| `data` | optional | small allowlisted key/values (numbers, booleans, short strings, ≤1 KiB) |
| `count` | optional | occurrences aggregated by the client, default 1 |
| `sevHint` | optional | P0–P3 suggestion; the monitor re-grades |

Server-derived fields added before storage: `receivedAt` (ISO Z), `day`
(IST date), `sig` (signature, §8), `sourceHost` (`pc` \| `cloud` \| `dev`).
Server-side events (`src:"server"`) are written straight to the same JSONL by
`server/telemetry.js` (planned) and need no envelope.

## 5. Event taxonomy

For each class: capture point(s) today, then the planned emitter. Required
`data` keys are listed; all extra keys are optional. Default severity is a
hint — the monitor applies `Skills/production-error.md` §2 and
`docs/error-register.md` severity.

**`app_error`** — uncaught JS exception, unhandled promise rejection, React
render crash. Today: console only (`main.jsx:21-23`). Planned: `initTelemetry()`
in `web/src/telemetry.js` (planned) registers
`window.addEventListener('error', …)` and `('unhandledrejection', …)`; the
boundary's `componentDidCatch` calls `trackError('render_crash', error, info)`.
Required `kind` (`js_error|unhandled_rejection|render_crash`),
`filename` (basename only), `lineno`, `colno`, `stackTop` (≤3 normalized
frames). Sev hint: render_crash P1, others P2.

**`player_error`** — HLS fatal/auto-recovery, `<video>` element error, start
timeout, buffer stall. Today: `VideoPlayer.jsx:933-955` (hls.js `Hls.Events.ERROR`,
`data.type`/`data.details`/`data.fatal`), `:805-814` (`setStreamError` after
40 s), `:1963-1978` (`video.error.code`, `[Player] Video error code`).
Planned: `trackEvent('player_error', …)` in all three places. Required
`kind` (`hls_fatal_network|hls_fatal_media|hls_fatal_other|video_element|start_timeout|stall_recovered`),
`mediaId`, `se`, `ep`, `quality`, `audioIndex`, `details` (hls.js string),
`videoErrorCode`, `readyState`, `elapsedMs`, `delivery` (`proxy|native`).
Sev hint: unrecovered fatal/start_timeout P1, recovered P2.

**`api_error`** — fetch failure, non-2xx, timeout/abort against our API.
Today: swallowed per call site (see §3). Planned: `trackApiError(endpoint
template, status, durationMs)` from `App.jsx` catalog/update hooks,
`AppUpdateModal.jsx`, `VideoPlayer.jsx` subtitle calls and
`SeriesDetailsView.jsx` (`:63` episodes fetch). Required data: `endpoint`
(path template only), `method`, `status` (0 = network), `durationMs`,
`hostClass` (`primary|fallback|render|native`). Sev hint: P2.

**`update_download_failed`** — APK download never produced an installable file.
Today: only text in `AppUpdateModal.jsx:63-66` (state went `idle`), `:80-91`
(`error:<message>`) and `:103-107` (caught exception). Native causes are in
`MainActivity.java`: `error:Unauthorized update source` (:44), `Download failed
(HTTP n)` (:82), size check (:98), checksum mismatch (:110-111), finalize
(:114), aggregated `error:` (:128). Planned: `trackEvent` on each branch with
`kind` (`invalid_url|manifest_unreachable|native_http|native_checksum|native_finalize|idle_no_start|unknown`),
`phase`, `status`, `bytes`, `shaExpectedPrefix` (first 12 hex only, public
artifact), `fromVersionCode`, `toVersionCode`, `canInstallApks`. Sev hint: P1
(blocks updating).

**`update_install_failed`** — the installer never completed. Today: only
`permission` (`MainActivity.java:141`), the settings-intent failure text (:149),
and `error:Installer failed to open: …` (:160) reach the UI; the state machine
ends at `installing` (:158) and there is **no** result callback for
user-cancel/signature/parse failures. Planned: reason codes in `MainActivity`,
an `onResume` cancel/reject detector (:310-318), a SharedPreferences record
written by `AutoRelaunchReceiver` (:12-24), and a new bridge method
`getBootEvents()` / `getApkUpdateResult()` exposed inside the existing
`AndroidStreamBridge` object (add after `getAppVersionName()`,
`MainActivity.java:295-301`). Required `kind` = the reason enum
(`permission_required|permission_intent_failed|installer_open_failed|user_cancelled|signature_mismatch|parse_error|aborted|unknown`)
plus `data.reason` (same value, optional) and data fields
`stateAtFailure`, `canInstallApks`, `flavour` (`mobile|tv|share`),
`fromVersionCode`, `toVersionCode`, `durationMs`. Sev hint:
signature_mismatch/parse_error P0 (nobody can update), permission_required P2,
user_cancelled P3. **Detectability today:** permission and installer-open only;
cancel/signature/parse require the planned native work (this is the role's
hardest capture gap).

**`stream_resolve_failed`** — no playable stream resolved. Today: server
`[MovieBox] Stream resolve failed` (`server/index.js:686`), 404
`Stream not available` (:690); client sees HLS/`<video>` failure; Android native
returns `{success:false,error:…}` (`LocalStreamServer.java:549`) and logs host
failures (:526). Planned: client maps a failed player start to this class with
`mediaId`; native diagnostics come from a planned `GET /diagnostics` ring buffer
in `LocalStreamServer` (see §9). Required data: `mediaId`, `se`, `ep`,
`audioIndex`, `resolution`, `errorCode`
(`no_detail_path|no_resource|vip_locked|upstream_unreachable|parse_error`),
`upstreamHost` (`moviebox.ac|moviebox.ph|mzfi.me|hifimove.io`),
`nativeHostFailures` (array of ≤3 `{host,error}`). Sev hint: P1 when shared by
several titles, P2 single title.

**`proxy_upstream_error`** — server-side stream proxy could not fetch the CDN.
Today: server logs only (`server/index.js:716-732` re-resolve on 401/403/410,
`:731` pass-through, `:755-758` catch). Planned: server emitter in those
branches. Required data: `titleId`, `rangePresent`, `upstreamStatus`
(`401|403|410|416|429|5xx|network`), `reResolveAttempted`, `retrySucceeded`,
`resolvedResolution`. Sev hint: P2 per title, P1 above 10 events/10 min.

**`subtitle_failed`** — search/download/convert/serve failure. Today: server
catches `server/index.js:774-776` (search 500), `:801-803` (download 500),
`:830-832` (upload 500, known `movie.id` defect at `:818,827`);
`server/subtitles.js:58-60` warns; client catches
`VideoPlayer.jsx:1609-1611,1620-1621,1702-1703`. Planned: emit on both sides
with `op` (`search|download|convert|upload|serve`), `mediaId`, `lang`,
`provider` (`imdb|yts-subs`), `status`, `durationMs`. Sev hint: P2 for the
always-500 upload path, P3 for one title's provider miss.

**`catalog_fetch_failed`** — the catalog could not be fetched at all by a
client, or the server refresh failed. Today: client candidates are tried and
discarded silently (`App.jsx:686-749`), UI never shows the error (§3); server
logs `[MovieBox] Catalog error` (`server/index.js:280-283`) and refresh guards
(`server/moviebox.js:817,1160-1176`). Planned: client emits after the candidate
loop returns `false` (`App.jsx:749`) with `candidatesTried`, `lastStatus`,
`elapsedMs`, `cachedCount`, `metaAgeMs`; server emits on refresh/catalog
failures with `pagesFailed`, `rejectedReason` (`page_failures|shrink_guard|cache_write`),
`catalogCount`. Sev hint: P1 when all platforms affected, P2 fallback-only.

**`app_restart`** — the app started again, with how the previous run ended.
Today: only `MY_PACKAGE_REPLACED` relaunch exists (`AutoRelaunchReceiver.java:12-24`);
no clean-exit marker. Planned: `web/src/telemetry.js` writes
`vf_session_state_v1` (`{startedAt, clean:false}`) at boot, sets `clean:true` on
`pagehide`/`visibilitychange→hidden`, and at next boot emits this event;
`AutoRelaunchReceiver` writes a SharedPreferences flag read through
`getBootEvents()` so an update relaunch is distinguishable. Required
`kind` (`cold_start|unclean_exit|update_relaunch|install_suspected`),
`previousSessionMs`, `exitClean`, `versionChanged`. Sev hint: P3, except
repeated `unclean_exit` P2.

## 6. Wire format, caps and client pipeline (all planned)

`POST /api/telemetry/events` — batched; response **204 always** (accepted,
ignored, throttled or malformed; a client never retry-loops on an HTTP response).
No cookies/credentials; CORS is already `origin:'*'` (`server/index.js:54`) and
`express.json({limit:'10mb'})` is mounted globally (`:55`), so the handler
enforces the caps below after parsing and drops oversize batches with a counted
`204` (a >10 MB body still gets Express' 413 first; clients never send that). A
page served from Render (if `web/dist` is ever hosted there) gets a 404 for this
endpoint — the client treats any HTTP response as terminal and drops the batch
instead of retrying forever.

Caps (constants exported from `server/telemetry.js` (planned) and mirrored in
`web/src/telemetry.js` (planned)): batch ≤20 events; body ≤32 KiB; `msg` ≤300
chars; `data` ≤1 KiB; global token bucket 120 req/min; per-session 20 req/min;
per-class per-session 40 req/min; excess dropped silently and summarised in the
next `monitor-status.json` (`telemetry_dropped`). Client queue: `localStorage`
`vf_telq_v1`, ≤50 events / 64 KiB, 7-day expiry, drop-oldest; flush every 15 s,
on `pagehide` via `navigator.sendBeacon(url, new Blob([json], {type:'application/json'}))`
(the `sendBeacon` pattern already exists at `VideoPlayer.jsx:1009-1013`), else
`fetch(..., {keepalive:true})`; backoff 30 s → 5 min with jitter; no retry after
a 4xx-coded web response. Aggregation: identical signature per session sent
individually 3×, then one aggregate every 5 min with `count`; noisy P3 kinds
(e.g. recovered HLS stalls) sampled at 10 % with `sampled:true`; everything
else 100 %.

## 7. Server storage, rotation and retention (planned)

- Path: `server/logs/telemetry-YYYY-MM-DD.jsonl` (one sanitized event per line,
  date in IST). Append-only via `fs.appendFile` from `appendClientEvents` in
  `server/telemetry.js`; on write error, increment an in-memory drop counter and
  never throw into the request path.
- Rotation: filename per day; retention 14 days (delete older `telemetry-*.jsonl`);
  total cap 100 MB and per-day soft cap 25 MB (above it, only P0/P1-class events
  are written). Inbox retention 90 days. A `server/logs/` folder must be added
  to `server/.gitignore` (it currently ignores `*.log` but not `*.jsonl`/`logs/`;
  `server/.gitignore` is 16 lines).
- The PC store is the system of record. Render is not a store (no disk, no
  reader); clients queue and re-send to the PC when reachable.

## 8. Local failure pipeline (planned `server/failure-drain.js`)

Deterministic Node script, no new dependencies (pattern: `server/rebuild-catalog.js`
— prints a marker and exits 0/1). Run `cd server; node failure-drain.js`
(add `--rebuild` to re-scan all JSONL, `--now` to ignore windows for tests).

1. **Cursor** `server/logs/monitor-cursor.json`:
   `{ "schema":"monitor-cursor/1", "file":"telemetry-2026-11-05.jsonl", "offset":12345, "lastTs":"…" }`.
   Read new lines from `offset`; on rotation (`file` date older than today's or
   size < offset) restart that file at 0. Cursor is written atomically
   (temp file + rename) only after inbox/status writes succeed.
2. **Signature** (same algorithm in the playbook; do not fork it):
   `canonical = [cls, kind||'', code||'', normRoute, normMsg, src].join('|').toLowerCase()`;
   `sig = 'fx_' + sha256(canonical).hex.slice(0,16)`.
   `normMsg`: sanitize, lowercase, digits→`#`, collapse whitespace, keep
   `[a-z0-9 #_]`, cut 160. `normRoute`: path only, `/mb_\d+`→`/mb_:id`,
   `/\d+(?=/|$)`→`/:n`, drop query/fragment.
3. **Counters and thresholds:** per signature evaluate events inside a rolling
   15-minute window — open/merge when `count >= 3` **or** any single event is a
   P0-class event (`update_install_failed.kind ∈ {signature_mismatch,parse_error}`)
   **or** ≥2 events across ≥2 app versions / platforms within 24 h. Classes that
   are P3-only (e.g. `user_cancelled`, `cold_start`) still need 3/15 min.
4. **Inbox** `server/logs/inbox/FAIL-<sig>.json` (atomic write, merge if it
   exists: bump `count`, extend `lastSeen`, keep ≤3 newest samples, never
   duplicate). Schema `fail-inbox/1`:

```json
{
  "schema": "fail-inbox/1",
  "signature": "fx_1a2b3c4d5e6f7a8b",
  "class": "update_install_failed",
  "kind": "permission_required",
  "code": "permission_required",
  "severity": "P2",
  "status": "new",
  "firstSeen": "2026-11-05T10:00:00+05:30",
  "lastSeen": "2026-11-05T10:12:00+05:30",
  "count": 7,
  "platforms": ["android"],
  "appVersions": ["2.9.9"],
  "versions": [66],
  "sources": ["client"],
  "routes": ["/api/app/version"],
  "suggestedArea": "ota",
  "samples": [
    { "eid": "e_ab12", "ts": "2026-11-05T10:00:00+05:30", "src": "client", "cls": "update_install_failed",
      "kind": "permission_required", "code": "permission_required", "msg": "…", "data": { "canInstallApks": false } }
  ],
  "firstTelemetryDay": "2026-11-05",
  "notes": ""
}
```

   `status`: `new` → `triaged` → `dispatched` → `fixed` → `verified`, plus
   `dismissed` (owner-approved duplicate / not-a-defect) and `regressed`.
   `suggestedArea` uses the controlled tags from `docs/error-register.md`
   (`playback`, `ota`, `subtitles`, `catalog`, `web-ui`, `android`, `tv`,
   `downloads`, `health/deploy`, …).
5. **Heartbeat** `server/logs/monitor-status.json`:
   `{ "schema":"monitor-status/1", "lastRunAt":"…", "durationMs":42, "filesScanned":1,
   "linesRead":88, "eventsRead":88, "groups":4, "inboxNew":1, "inboxMerged":2,
   "telemetryDropped":0, "lastEventAt":"…", "heartbeat":"ok" }`.
   Exit code 0 when the scan completed (inbox entries are data, not failure),
   1 on I/O/parse-crash; print `DRAIN_EVENTS=<n> NEW_FAIL=<n> OPEN_INBOX=<n>`.

## 9. Instrumentation edit points (all planned; nothing below is implemented)

> Line numbers were verified by reading the files on 2026-11-05. If a file has
> changed since (other agents edit `web/src/**` and `server/**`), re-grep the
> named symbol/route first — treat the symbol as the anchor, the line as a hint.

| # | File | Exact edit point | What is added |
|---|---|---|---|
| S1 | `server/telemetry.js` (new) | new module | `normalizeEvent`, `signatureFor`, `appendClientEvents`, `emitServerEvent`, caps constants |
| S2 | `server/index.js` | import near line 9-11; insert route between the custom-VTT handler end (`:848`) and `// SPA Fallback` (`:851`) — above the SPA guard, else it is swallowed (`:852-861`) | `app.post('/api/telemetry/events', …)` → validate/cap/append → `204`; must not be shadowed by the SPA fallback |
| S3 | `server/.gitignore` | append one line | `logs/` (current 16-line file ignores `*.log`, not `logs/*.jsonl`) |
| S4 | `server/index.js` error paths | `:280-283` catalog, `:291-293` search, `:356-359` episodes, `:684-692` stream resolve, `:716-733` upstream retry/pass-through, `:755-758` proxy catch, `:774-776`/`:801-803` subtitles | `emitServerEvent(cls, data)` calls (no behaviour change) |
| S5 | `server/moviebox.js` | `:816-818` refresh catch, `:601-604`/`:809-811`/`:1213` cache-write warnings, `:1160-1176` rebuild guards, `:443-468` listing scrape | `emitServerEvent('catalog_fetch_failed', …)` (require lazily to avoid a cycle) |
| S6 | `web/src/telemetry.js` (new) | new module | `initTelemetry()`, `trackEvent(cls, code, data)`, `trackError`, queue/flush/sanitize; uses `getApiBase()` (`web/src/config.js:4-32`) — never a new host |
| S7 | `web/src/main.jsx` | after imports (`:9`), `componentDidCatch` (`:21-23`), before `createRoot` (`:65-66`) | import + `initTelemetry()`; `trackError('render_crash', error, errorInfo)` in the boundary |
| S8 | `web/src/App.jsx` | import block (`:6-18`); update-check catches (`:519-563`); catalog meta catch (`:673`), candidate catch (`:745-747`), failed return (`:749`); retry button (`:1229`) | `trackEvent('api_error')` / `catalog_fetch_failed`; note the undefined `fetchAdminStats` throw is captured by the global handler |
| S9 | `web/src/VideoPlayer.jsx` | import (`:41-43`); HLS ERROR (`:933-955`); 40 s timer (`:805-814`); `video.onError` (`:1963-1978`); subtitle catches (`:1620-1621`, `:1702-1703`) | `player_error`, `stream_resolve_failed`, `subtitle_failed` |
| S10 | `web/src/components/AppUpdateModal.jsx` | import (`:1-4`); state poll branches `:63-66` (idle), `:70-74` (permission), `:75-79` (ready/installing), `:80-91` (error), outer catch `:103-107` | `update_download_failed` / `update_install_failed` with `phase`/`reason`; keep polling after `installing` instead of clearing at `:76` |
| S11 | `web/android/.../MainActivity.java` | state constants `:29-34`; `openInstallerFor` `:134-171`; `onResume` `:310-318`; bridge object `:214-303` (add after `getAppVersionName` `:295-301`) | reason codes, install-start timestamp, cancel/reject detection, `getApkUpdateResult()`, `getBootEvents()` |
| S12 | `web/android/.../AutoRelaunchReceiver.java` | `:14-23` | write SharedPreferences `update_boot` flag before relaunch (success signal) |
| S13 | `web/android/.../LocalStreamServer.java` | tag `:37`; failure sites `:225,240,303-306,525-549`; dispatch `:162-172` | 20-entry diagnostic ring buffer + `GET /diagnostics` JSON so `player_error.nativeDiag` can attach host/status causes |
| S14 | `server/failure-drain.js` (new) + task scheduling | new script; Task Scheduler/DSH schedule | cursor, grouping, inbox, `monitor-status.json` (§8) |

Not changed: `web/android/app/src/main/AndroidManifest.xml` (INTERNET already at
`:61`; no new permission needed), `server/render.yaml` (no store on cloud),
`web/src/config.js` (telemetry resolves through `getApiBase()`).

## 10. Ordered implementation plan (each stage shippable, owner-approved)

**Stage 0 — baseline (no code).** Record current behaviour: no endpoint, no
storage, no handlers (§3). Owner approves privacy rules and retention. Evidence:
this file + grep results.

**Stage 1 — server sink + storage (smallest end-to-end).** S1, S2, S3. Verify:
`curl.exe -s -o NUL -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "{\"v\":1,\"events\":[]}" http://localhost:5000/api/telemetry/events` → `204`;
`Get-Content server\logs\telemetry-<today>.jsonl -Tail 3` shows normalized
events (use a crafted payload, not a real incident); `node --check server/telemetry.js`;
`node --check server/index.js`; restart locally (owner approval if live).

**Stage 2 — web capture (highest value per line).** S6, S7, S8, S9 (player), S10
(download/install branches that exist today). This alone catches JS crashes,
API outages, player failures and the permission-loop class. Verify: build/lint
(`cd web; npm run lint; npm run build` per `docs/verification.md` §3); in a dev
tab force a JS error and a blocked API call, confirm new JSONL lines; inspect the
204 network response and that no `console` errors are introduced.

**Stage 3 — install outcome + relaunch (closes the target example).** S11, S12.
Verify on a debug build/emulator only (owner present for device work):
permission state emits; cancel-from-installer emits `update_install_failed`
`user_cancelled` after returning to the app; an update relaunch emits
`app_restart.update_relaunch`. Signature/parse discrimination stays `unknown`
until an install-session API is added — do not fake it.

**Stage 4 — native playback diagnostics.** S13 + S9 hook. Verify: block
`mzfi.me` on a device, play a title, confirm `stream_resolve_failed` carries
`upstreamHost`/`nativeHostFailures`.

**Stage 5 — server-side failure classes.** S4, S5. Verify: force a 502 via an
invalid edition, confirm `proxy_upstream_error`; stop upstream access and confirm
`catalog_fetch_failed` with `rejectedReason`.

**Stage 6 — pipeline + role activation.** S14, then `Skills/failure-monitor.md`
takes over; verify `node failure-drain.js` prints the marker, creates
`server/logs/inbox/FAIL-<sig>.json`, updates `monitor-status.json`, and that a
second run with no new lines is a no-op (`NEW_FAIL=0`).

Rollback: every stage is additive; revert the touched files from date-stamped
copies (no git yet). The endpoint can be disabled by reverting S2 only — clients
then retry/queue and drop silently, no user-visible change.

## 11. Verification checklist for when it is implemented (not run today)

- [ ] `node --check` on `server/telemetry.js`, `server/failure-drain.js`, `server/index.js`.
- [ ] `POST /api/telemetry/events` → `204` for: empty batch, oversized batch (>caps), malformed JSON, token-in-message payload (stored sanitized), replayed event (deduped by `eid`/sig counters only — storage is append-only).
- [ ] `POST` from a browser at `http://localhost:5173` (CORS) and from the packaged app (`https://vikyflix.uk`) — same 204.
- [ ] JSONL file rotates at IST midnight and older files beyond 14 days are deleted; `server/logs/` is ignored by git.
- [ ] Drainer idempotence: run twice, second run `DRAIN_EVENTS=0`; inbox count does not double.
- [ ] Threshold proof: 3 synthetic events with the same signature in 15 min → one `FAIL-<sig>.json` with `count:3`, `samples` ≤3; 2 events → none.
- [ ] P0-class proof: one synthetic `update_install_failed` with `signature_mismatch` → inbox immediately.
- [ ] Privacy proof: a payload containing an email/IP/token path is stored redacted; no `.env`/admin values anywhere in `server/logs/`.
- [ ] `monitor-status.json` updates every run; staleness triggers the playbook's silence alert.
- [ ] Add rows to `docs/verification.md` (§5/§6) for the endpoint and the drainer when they land — separate file owner.

## 12. Open questions for the owner

1. Approve client telemetry at all for a personal service (privacy + effort)?
2. Retention: 14 days JSONL / 90 days inbox acceptable? Location +
   `server/logs/` in git ignore?
3. Is capturing React render crashes and JS errors on the website worth the
   bundle cost (telemetry module should stay <2 KB gzipped)?
4. Android: acceptable to add the planned `onResume` cancel detector and a
   diagnostic ring buffer (no new permissions, no user-visible change)?
5. Should the drainer run on a Windows Task Scheduler job every 15 min, or only
   when an agent wakes (DSH schedule)? (The deterministic half never needs an LLM.)
