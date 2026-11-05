# Production error (incident response + error memory)

**Purpose:** stabilise a live failure with the least risk, isolate the broken
layer, prove one cause, fix or roll back, then write a prevention rule into
`docs/error-register.md` — the project's retrieval store ("RAG of past errors")
agents read before touching a known-bad area. **Load when:** a live issue is
reported, a probe/watchdog fires, playback breaks, the catalog stops updating,
subtitles/OTA/downloads misbehave, or a past bug returns.

**Inputs:** symptom, platform(s), first-seen time, change window, evidence;
commands in `docs/verification.md`, routing/gates in `Skills/orchestrator.md`
(incident route `I`). **Hard rules while live:** read-only checks first; ask the
owner before any restart, rollback, Render action, deletion or key change
(`AGENTS.md` 5–6); never paste secrets; never present an unrun command as
evidence.

## 1. Intake (copy, fill, do not skip)

```
Detected:      <date time IST> by <owner/tester/monitor/self>
Symptom:       <what a user sees, verb + screen/URL> — one sentence
Platforms:     web | Android phone | Android TV | LG webOS | cloud | all
Scope:         everyone / one title / one device / one network
Change window: <last deploy/edit/restart/APK/filter change; exact time>
Frequency:     always / intermittent (x per hour) / one report
Evidence:      <HTTP status, endpoint, log line, screenshot, console line>
Severity:      P0 / P1 / P2 / P3 (matrix below)
Owner asked:   <what was approved and when>
```

A healthy `/api/health` proves only that Express answers — not the tunnel,
upstream, ffmpeg or catalog freshness. "Restarted and it worked" is mitigation,
not a cause; record the start time before touching anything.

## 2. Severity and response targets (single-owner service, IST)

| Sev | Definition | First response | Stabilise target | Notify |
|---|---|---|---|---|
| P0 | site/playback down for everyone, failed deploy, secrets exposed, data loss | 5 min | 30 min, then root-cause | owner direct (call/chat), then every 15 min |
| P1 | major feature or one platform broken (catalog, subtitles, one OTA track, downloads, TV) | 30 min | same day | owner + orchestrator |
| P2 | degraded: fallback-only, slow, some titles, one device/network, stale rails | same day | 3 days | register row, daily report |
| P3 | cosmetic or low-frequency annoyance | next maintenance | backlog | register row if it may recur |

Severity tracks user impact, not how interesting the bug is; unsure → higher
level for the first hour, then downgrade with evidence.

## 3. Stabilise (run commands from the repo root) — read-only first, then per layer

```powershell
Get-Process node,cloudflared -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,StartTime
Get-NetTCPConnection -LocalPort 5000 -State Listen | Select-Object LocalAddress,OwningProcess
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:5000/api/health
curl.exe -s -o NUL -w "%{http_code}`n" https://vikyflix.uk/api/health
Invoke-WebRequest https://vikyflix-server.onrender.com/api/app/version -TimeoutSec 90 -UseBasicParsing | Select-Object StatusCode
Invoke-RestMethod http://localhost:5000/api/health | ConvertTo-Json -Compress
Invoke-RestMethod http://localhost:5000/api/moviebox/catalog/meta | ConvertTo-Json -Compress
Get-Command ffmpeg,ffprobe -ErrorAction SilentlyContinue | Select-Object Name,Source
Get-PSDrive -PSProvider FileSystem | Select-Object Name,@{n='FreeGB';e={[math]::Round($_.Free/1GB,1)}}
Get-Item server\server.log,server\service.log,server\watchdog.log,server\tunnel.log -ErrorAction SilentlyContinue | Select-Object Name,LastWriteTime,Length
```

| Layer | Healthy signal | If not → |
|---|---|---|
| PC process | one long-running `node`, started before the symptom | crash loop / PC offline (§5.7) |
| Port 5000 | `LISTENING` owned by that node | double start / stale node (§12.4) |
| Local API | `/api/health` 200, `status:"ok"` | playback §5.2, catalog §5.3 |
| Tunnel | public `/api/health` 200 via `vikyflix.uk` | §5.7 |
| Cloud fallback | Render `/api/app/version` 200 JSON | §5.6 cloud cold start |
| ffmpeg | `ffmpeg` + `ffprobe` on PATH | §5.9 |
| Disk/cache | free space healthy, cache not runaway | §5.8 |
| Logs | `server\server.log` written within ~5 min | wrong launcher / log split (§6) |

Escalate a P0/P1 to the owner now and record what you did not check. Do not
"fix" two layers at once.

## 4. Layer isolation method (first broken hop wins)

Probe bottom-up with the same read-only GET and stop at the first failure:
client assets → public `/api/health` → tunnel/DNS → PC `:5000` →
`/api/moviebox/catalog/meta` → `/api/moviebox/detail/:id` →
`/api/moviebox/stream/:id` → upstream play host.

- PC 200 but public fails → tunnel/DNS/Cloudflare (or an old connector); PC fails but Render 200 → PC process/disk/network; both fail → shared API code, upstream MovieBox, or client network.
- One title fails while the catalog works → title/resource (VIP lock, no stream), not system; one platform fails → client bundle/OTA/Android bridge.
- Same probe from another network (phone hotspot) → ISP/DNS filtering; comparing `vikyflix.uk` with `https://vikyflix-server.onrender.com` separates "PC-side" from "upstream/shared" before any log reading.

Record the first failing hop with URL + status + log line; a cause is one
sentence backed by one of those, otherwise it is still a hypothesis.

## 5. Diagnosis runbooks

### 5.1 Site down / Cloudflare error page at vikyflix.uk
- Local 200 + public fails → tunnel/DNS; both fail → PC process/code; public fails + Render 200 → PC-side; Render also fails → shared API/upstream.
- `Resolve-DnsName vikyflix.uk` no answer = DNS/Cloudflare (owner); `Get-Item web\dist\index.html` missing → 404/blank even with a healthy API (`web\dist` is checked only at boot — rebuild then restart with approval); `server\tunnel.log` `Registered tunnel connection` healthy vs `ERR`/`Unable to establish connection`/`Serve tunnel error` broken (`x509` = historical h2 failure, `tunnel_h2.log`).
- Restart one launcher/tunnel only with owner approval, then re-probe public; until it passes it is mitigation, not a fix.

### 5.2 Playback broken
- Reproduce the client URL: web/desktop `${API_BASE}/api/moviebox/stream/<id>`; Android uses the on-device bridge `http://127.0.0.1:<port>/play?...` (`VideoPlayer.jsx`) — Android playing while web fails localises the fault to the PC proxy.
- Real id: `$id = (Invoke-RestMethod 'http://localhost:5000/api/moviebox/search?q=love').results[0].id`; then `curl.exe -s -D - -o NUL -H "Range: bytes=0-1023" "http://localhost:5000/api/moviebox/stream/$id"`.
- Status: 200/206 healthy → client/HLS; 404 `Title not found` → stale/empty catalog (§5.3); 404 `Stream not available` → resolve failed (VIP lock/no resource); 502 → upstream/CDN; 416 → seek past EOF, normal. Stream URLs cached 2.5 min, failures 90 s (`moviebox.js`); force `?r=1`; series `?se=&ep=`, audio `?audio=<detail.audioVersions[].subjectId>` (wrong id silently falls back to the default edition).
- Evidence: `Stream request`, `Stream resolve failed`, `Stream proxy error` in `server\server.log`; `[HLS]` / `[Player] Video error` in console; "Connection is taking too long" after 40 s. ffmpeg is not in the MovieBox playback path — don't chase it for playback.

### 5.3 Catalog empty or stale (no new releases)
- `onlineMoviesCount` 0 = cold/empty cache; `catalog/meta.fetchedAt` older than ~60 min while refresh runs every 20 min = sync not landing.
- Grep `server\server.log`: `Loaded .* from disk cache`, `Incremental update saved`, `Could not load disk cache`, `Could not write cache file`, `Rejected catalog rebuild` (35+ page failures), `Rejected partial catalog rebuild` (<60% of cached when cached ≥500).
- Single `Page N ... fetch failed` / `Listing scrape /web/tv-series failed` lines are normal upstream noise; only repeated full cycles without `Incremental update saved` are an incident. Upstream: `Invoke-WebRequest https://moviebox.ac/wefeed-h5api-bff/country-code -TimeoutSec 10 -UseBasicParsing | Select-Object StatusCode`; mirrors from `server\moviebox_hosts.json` (.ac, .ph, .ng, .re, hifimove.io), 8 s origin probes, 12 s BFF timeouts. Cache `server\cache\moviebox_cache.json`: validate with `ConvertFrom-Json`; corrupt = refetch at boot; `cd server; node rebuild-catalog.js` writes it explicitly (approval; prints `REBUILT_CATALOG_COUNT=`).
- Client stale: the app never accepts an older `fetchedAt` (`App.jsx`); a bad `vickyflix_server_url` in localStorage overrides `getApiBase()` (`config.js`) — clear site/app data. Never widen filters to "fix" staleness (rule 1).
- Control endpoints: `POST /api/moviebox/refresh` is gate-kept by `requireAdmin` (`x-admin-key` header, or `?admin=` — never the query form, it lands in logs); 401 without the key, and it must not run against production without owner approval.

### 5.4 Subtitle failures
- Search: `Invoke-RestMethod "http://localhost:5000/api/movies/$id/subtitles/online?query=love&year=2020"`; 400 = missing `query`; `{subtitles: []}` = none found or provider silently failed — `searchOnlineSubtitles` swallows errors (`server/subtitles.js`), so `[Subtitles] Search error` in the log separates outage from "no subtitles exist".
- Download: POST `/api/movies/<id>/subtitles/download` `{sourceUrl}` → `server/cache/<id>/online_<hash>.vtt`, served at `/api/movies/<id>/subtitles/custom/<file>` as `text/vtt` + CORS (IMDb 4 s / yts-subs 5–6 s timeouts); 404 = file gone/pruned.
- Upload: POST `/api/movies/<id>/subtitles/upload` `{text}` — verified defect (`AGENTS.md`): always 500 `Failed to process custom subtitle` because the handler uses an undefined `movie.id` at `server/index.js:818`; fix with `req.params.id` and register it. A 200 VTT that does not render = client `<track>`/CORS, not the API.

### 5.5 OTA wrong track, no update, or download 404
- Manifests: `/api/app/version` must be `uk.vikyflix.app`; `?platform=tv` must be `uk.vikyflix.tv`; they must never cross (`server/index.js`).
- `versionCode`/`versionName` exist twice — `server/index.js` (currently 66 / 2.9.9) and `web/android/app/build.gradle` — bump both or updates stall. `apkSha256` is computed from the APK actually found; `sha256: null` means missing artifact.
- Artifact resolution: mobile root `MovieFlix.apk` then `server\MovieFlix.apk`; TV root `MovieFlixTV.apk`/`MovieFlixTv.apk` then server; share `MovieFlix-Share.apk`; webOS `server\VikyFlix.ipk`. A TV APK copied as `MovieFlix.apk` is the classic wrong-track cause.
- No prompt: server `versionCode` <= installed build. OTA fallback tries 3 hosts with 6 s each (`App.jsx`), so a sleeping Render instance (~50 s) cannot serve OTA.
- `apkUrl` is hard-coded to `https://vikyflix.uk/download[/tv]`; with the PC offline the manifest can come from Render but the download still points at the dead host — known limitation. Verify `curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:5000/download/tv` and match `apkSha256` against `Get-FileHash` of the intended file.

### 5.6 Cloud cold start / Render fallback
- Free plan sleeps after ~15 idle minutes, wakes in ~50 s (`server/render.yaml`, `server/DEPLOY-RENDER.md`); Render's health-check path is `/api/app/version`, not `/api/health`.
- Probe patiently: `Invoke-WebRequest https://vikyflix-server.onrender.com/api/app/version -TimeoutSec 90 -UseBasicParsing | Select-Object StatusCode`; one 502/503 during wake is expected, still failing after ~2 min is not.
- Catalog fallback allows 90 s (120 s forced) and ignores older `fetchedAt`, so cold start is invisible to load; OTA fallback allows only 6 s (§5.5). Persistent failure = Render deploy/suspension/plan: dashboard logs, then owner (deploy is owner-only); don't hammer it awake without a plan/billing decision.

### 5.7 Tunnel down / PC offline
- Local 200 + public fail + DNS resolves = connector; `Get-Process cloudflared` can show a stale process, so trust the public probe. `server\tunnel.log`: `Registered tunnel connection connIndex=...` healthy; `ERR ...`, `Unable to establish connection`, `Serve tunnel error` broken; stale `LastWriteTime` = not the live connector. `Resolve-DnsName vikyflix.uk` no result = DNS/Cloudflare account (owner).
- Duplicate-tunnel trap: `server\start-vickyflix.bat` always starts one, while `start-server.bat`/`start-server-hidden.vbs` start one only if none exists (the VBS comment records ~10 leaked duplicates) — use one launcher, restart with approval, verify public.
- PC offline means `vikyflix.uk` (site served by the PC) is down by design: apps still get catalog/OTA from Render and Android playback resolves on-device (`AndroidStreamBridge`), but website/desktop playback needs the PC proxy. Recovery order: `running on port 5000` in `server.log` → local health 200 → public health 200; don't close while public still fails.

### 5.8 Cache or disk full
- Symptoms: `Could not write cache file` / `Could not write cache after latest feed` (updates live in memory but are lost on restart), poster writes failing, OS low-space errors.
- Measure: free space + `Get-ChildItem server\cache -Recurse -File | Measure-Object Length -Sum`; `(Get-ChildItem server\cache\posters -File).Count` (38,505 files observed at time of writing). `pruneCache` runs at boot and every 10 min with `CACHE_MAX_GB` (default 2 GB) but protects `posters`, `subtitles`, `metadata`, `data` (`transcoder.js`), so poster originals+variants grow unbounded; logs grow too (`watchdog.log` ~1,400 lines).
- Deleting cache/media/APKs/logs is an owner decision (rules 5–6). Propose moving `CACHE_DIR` to a larger drive, raising the cap, archiving logs or pruning posters deliberately; never delete `server\cache\moviebox_cache.json` casually (next boot must rebuild from upstream).

### 5.9 ffmpeg missing / media pipeline degraded
- `Get-Command ffmpeg,ffprobe`; poster variants spawn `ffmpeg.exe` on win32. Missing = no `_w700` variants (originals still served, placeholders for artless titles) — degraded artwork, not a broken catalog.
- The modern online path does not need ffmpeg: `server/index.js` imports only `pruneCache` from `server/transcoder.js`; legacy local transcodes are not wired in. `TRANSCODE_HW=off` forces software if probing misbehaves; for a legacy `/api/stream/*` route (local-library ids, not `mb_*`) check `[Transcoder]` lines in `service.log`, otherwise do not diagnose MovieBox playback as ffmpeg (§5.2).

## 6. Log file map — who writes what, what to grep

| File | Writer (verified in repo) | Grep for / meaning |
|---|---|---|
| `server\server.log` | `start-server-hidden.vbs` appends `npm start`; `watchdog.bat` restart truncates with `>` | `running on port 5000`; `Uncaught exception` / `Unhandled rejection` / `EADDRINUSE`; `[MovieBox] Catalog error` / `Search error` / `Stream proxy error` / `Stream resolve failed`; `Could not write cache`; `Rejected ... catalog rebuild`; `Page N ... fetch failed` (noise); `[Cache] Pruned` |
| `server\service.log` | `server\run_service.bat` restart loop (node stdout/stderr) | `Server exited with code` (crash loop, 5 s retry); legacy `[Watcher]` / `Scanning media directories` = old build, don't diagnose from it |
| `server\watchdog.log` | `server\watchdog.bat` (Task Scheduler, ~5 min per its header) | `Server down - restarting`, `Restart FAILED - port 5000 still not listening`, `Server revived OK`; count per day |
| `server\tunnel.log` / `tunnel_h2.log` | cloudflared output from an earlier redirect-based launcher | `Registered tunnel connection` (good); `ERR` / `Unable to establish connection` / `Serve tunnel error`; `x509` in the h2 file was the historical cert failure; stale timestamp = not the live connector |
| `server\server_err.log` / `server_out.log` | no current writer (err empty); out is a legacy pre-MovieBox run | any content = external capture; `Scanning media directories` / `[Watcher]` = outdated, not a current log |
| root `server.log` | a launch with the repo root as working directory | `ENOENT ... package.json` = wrong cwd; launch from `server/`, not the root |
| browser console (web) | `web/src` | `[HLS]`, `[Player] Video error`, `[CatalogSync]`, `[AppUpdate] Server: x, Local: y`, `[Stremio]` |
| device logcat | Android app | `adb logcat -d`, then filter `Capacitor`, `HLS`, `Stremio` |

Log freshness is evidence: `Get-Item` timestamps show which launcher is actually
writing. Five launchers exist (`start-server.bat`, `start-server-hidden.vbs`,
`run_service.bat`, `start-vickyflix.bat`, the watchdog) and they write different
files — split-brain logs are why watchdogs and apps "disagree". Render logs live
only in the Render dashboard (manual step).

## 7. Rollback (mitigation, not a fix)

1. Before a risky change (no git repo yet): `Copy-Item server\index.js "server\index.js.bak-$(Get-Date -Format yyyyMMdd-HHmm)"`; record the change start time — it is the timeline anchor.
2. Trigger: new P0/P1 within 30 min of the change, or evidence points at it; roll back to stabilise, keep the evidence, root-cause afterwards.
3. Restore with `Copy-Item <backup> <file> -Force`; `node --check` changed server files; `cd web; npm run lint; npm run build` if web changed; restart via the same launcher with owner approval and re-run the failing probe plus the `docs/verification.md` smoke set.
4. Render: dashboard → Manual Deploy → previous deploy (owner only — it is public); verify `/api/app/version` after.
5. OTA/APK: never lower `versionCode` (Android blocks downgrades) — roll forward with a higher code; keep the old artifact as the rollback reference. Record the rollback in the register row; it stays `open` until root cause + prevention rule exist.

## 8. Closing an incident

Incident summary (always):

```
Impact:      who/what was affected, duration
Timeline:    detected → stabilised → fixed (IST)
Cause:       one sentence + the evidence that proves it
Fix:         files changed / action taken / rollback
Verified:    command + result (public URL first)
Prevention:  the register rule added
Follow-up:   monitoring/cleanup still owed
```

Postmortem (P0/P1 only): timeline table (minute · event · evidence) · impact
scope · root cause vs trigger · detection gap (why a user/probe found it late) ·
contributing factors (config drift, split launchers, missing guard) · what
worked · action items with owner and date · linked `ERR` id.

## 9. Error-memory protocol (`docs/error-register.md`)

- **Read before changing** playback, stream proxy, catalog/scraper, subtitles, OTA, tunnel/deploy, filters or cache/pruning: `Select-String -Path docs\error-register.md -Pattern 'stream|catalog|subtitle|OTA|tunnel|filter'`; re-test the prevention cases that match.
- **Write after every incident/fix**, at the top of the Register table, one row: ID `ERR-<n>` · date · platform · Sev · symptom · root cause · fix (file) · prevention rule · status · verified by. Detail block when logs/timeline/hypotheses matter: copy the `Entry template` below the table and fill it; the one-line row stays the index.
- A prevention rule must be actionable and testable ("if you touch X, check Y", e.g. "any `/api/moviebox/stream` change needs a Range request and an `audio` switch test"); if it needs a command, add that command to `docs/verification.md`.
- Lifecycle `open` → `fixed` → `verified` → `regressed` (regressed reopens; link both rows). Append-only — never delete or rewrite history, correct with a new row. Rollback-only mitigation is still `open`; a rule without a check is a wish. Systemic lessons: propose changes to `AGENTS.md` / `docs/verification.md` to the owner; never store secrets, keys or tokens in the register or reports.

## 10. Escalation matrix

| Trigger | Escalate to | Timing / note |
|---|---|---|
| P0, failed release, suspected secret exposure | owner direct (call/chat), then orchestrator | now; a chat message alone is not enough for P0 |
| Live restart, tunnel restart, Render deploy/rollback, plan change | owner approval first (orchestrator §6) | state the exact action + rollback |
| Delete cache/media/APKs/logs, rotate `ADMIN_KEY`, change content filters | owner approval | state impact; never unilateral |
| Upstream MovieBox outage or mirror move | owner + developer | degrade gracefully; never widen filters (rule 1) |
| Android/TV release build or signing | owner present | follow `web/android/RELEASE_SIGNING.md` |
| Unreproducible after 2 evidence rounds, or ambiguous scope | one question, two options | don't guess or "monitor indefinitely" |

## 11. Monitoring and autopilot

- **Watchdog:** `server\watchdog.bat` (via `server\watchdog_hidden.vbs`) probes port 5000 with netstat, logs to `watchdog.log`, revives `npm start`; its header says Task Scheduler every 5 min and at logon — verify with `Get-ScheduledTask | Where-Object { $_.Actions.Execute -match 'watchdog' } | Select-Object TaskName,State`. Alert on ≥3 `Restart FAILED` in 15 min.
- **External probes (the users' view):** `https://vikyflix.uk/api/health` every 5 min; Render `/api/app/version` every 10–15 min with a 90 s timeout; alert after 2 consecutive failures. Treat `status:"ok"` + `onlineMoviesCount:0` as warn, not green.
- **Freshness and disk:** daily `/api/moviebox/catalog/meta`; warn if `fetchedAt` is older than 2 h (refresh cadence is 20 min). Weekly free space + `server/cache` size; warn below 10 GB free or linear cache growth (posters are not capped).
- **Tunnel:** probe the public URL, never the process list; a zombie `cloudflared` passes `tasklist`.
- **Logs and releases:** one launcher, one log (§6), rotate at ~50 MB — split logs are why watchdog and app timestamps disagree; after each release check both manifests (package names, `versionCode`, `apkSha256`) and `/download`, `/download/tv`.

## 12. Worked examples (patterns, not history)

**12.1 "vikyflix.uk shows a Cloudflare error, LAN works"** — local 200, public 5xx, Render 200, `cloudflared` present. First failing hop = tunnel; `tunnel.log` stale/no `Registered tunnel connection`. Restart one tunnel (approval) → public 200; register "public health probe is the tunnel check; restart through one launcher".
**12.2 "No new releases for a week, health 200"** — count nonzero, `meta.fetchedAt` old, `server.log` shows repeated `Rejected partial catalog rebuild` or `Could not write cache file` and no `Incremental update saved`, while Render's `fetchedAt` is fresh → PC-side upstream/disk, not the app. Check mirror probe + disk (§5.8), fix, wait one sync cycle, verify, register the missing guard.
**12.3 "Playback dies only on the website, Android fine"** — a Range request through `http://localhost:5000/api/moviebox/stream/<id>` returns 206, so API/proxy are healthy; browser console shows HLS/mixed-content errors and/or a custom `vickyflix_server_url` set to `http:`. Fix client config (clear site/app data), not the server; register "the website's custom API URL must be HTTPS/same-scheme".
**12.4 "Watchdog says down every 5 min, but server.log is still being written"** — cross-check `Get-NetTCPConnection -LocalPort 5000` and local health before restarting; if both are healthy the watchdog probe is the incident (suspect its netstat/context rather than the server). Never kill a healthy server to satisfy a broken probe; log a monitoring bug.

## Guardrails

- Never delete or rotate logs; never put secrets/keys/`.env` content in reports, register rows or the incident thread.
- No fixing by hiding: don't disable a feature, suppress a fallback, widen the catalog, or turn an error into an empty list without the owner.
- No live restart, deploy or public rollback without recorded owner approval; approval covers only the named action.
- Don't declare P0 resolved until the public verification command passes; rollback is mitigation, not resolution. If a check could not be run (sandbox/permissions), say so and mark it untested — never present it as evidence.
