# Verification — evidence handbook

How a MovieFlix/VikyFlix change is proven — golden rule 7 of `AGENTS.md`: every claim
traces to a command below or a recorded observation, and a claim absent from the
evidence block was **not verified**. Expectations derive from `server/index.js`
(routes, status, auth, cache headers), `server/package.json`, `web/package.json`,
`web/capacitor.config.json`, `web/android/RELEASE_SIGNING.md`, `server/render.yaml`,
`server/.env.example`, `docs/error-register.md`, `web/DESIGN_SPEC.md`; terminology per
`Skills/developer.md` and `Skills/tester.md`.

## 1. Evidence rules

- Per check record: env (local PC / `vikyflix.uk` / Render / device), exact command,
  exit code, and the one output line that proves the result.
- One pass/fail per acceptance item; a failed row stays visible. Non-zero exit = fail;
  warnings pass only with a note on why they are unrelated.
- Verify the shippable artifact (`web/dist`, signed APK), not an HMR dev server; no git repo yet, so cite changed files + timestamps instead of a commit.
- Never print `.env` values, `ADMIN_KEY`, keystore paths or signing passwords; every fixed
  defect gets a register row with a prevention rule whose cases are re-run before done.

## 2. Preconditions

Run from the repo root `E:\projects\My Streaming Services`; server commands in
`server/`, web commands in `web/` (`.env`, `cache/`, `dist` resolve from there).

```powershell
node --version; npm --version     # Node v18+ (global fetch, AbortSignal.timeout), npm 9+
ffmpeg -version                   # poster ?w= variants / transcode path
Test-Path server\.env; Test-Path web\dist   # True / True after build; .env missing -> copy server\.env.example to server\.env
Get-NetTCPConnection -LocalPort 5000,5173 -ErrorAction SilentlyContinue   # expect none
```

Ports `5000` (API, `PORT`), `5173` (Vite dev), `10000` (Render). Ask the owner before deploys, Render
pushes, restarting the live server, deleting cache/media/APKs, key rotation, filter changes or signed
release builds. All `POST` checks run locally.

## 3. Web — install, lint, build

```powershell
cd web
npm ci                    # clean install from the committed package-lock.json
npm run lint              # oxlint -> exit 0, no findings
npm run build             # vite   -> exit 0, "built in ..." line, writes dist/
Test-Path dist\index.html # True
```

`npm run dev` (5173) is manual UI work only — never build evidence. `vite.config.js` declares
no proxy: dev API calls resolve to `http://localhost:5000` via `getApiBase()` (`web/src/config.js`).

## 4. Server — syntax, install, start

```powershell
cd server
node --check index.js; node --check moviebox.js; node --check transcoder.js; node --check subtitles.js; node --check scanner.js
node --check sessions.js; node --check metadata.js; node --check rebuild-catalog.js
npm ci                    # or npm install
npm start                 # node index.js — keep the window open
```

Expect `🎬 VickyFlix Server running on port 5000` + `[Server] Serving frontend build from:
...\web\dist`; `npm run dev` uses nodemon. Catalog/edition sync starts ~3 s after boot — wait a minute.

## 5. API smoke — GET routes

```powershell
$b = 'http://localhost:5000'
$paths = @('/api/health','/api/app/version','/api/app/version?platform=tv','/api/movies','/api/series','/api/moviebox/catalog/meta','/api/moviebox/catalog','/api/moviebox/search?q=love','/api/does-not-exist','/','/download','/download/tv','/download/share','/download/lg','/promo/')
foreach ($p in $paths) { '{0,-42} {1}' -f $p, (curl.exe -s -o NUL -w '%{http_code}' "$b$p") }
```

Download routes stream the APK/IPK into `NUL` (a few MB each) — use `-I` for status only; `curl` alone is the PowerShell alias, so always `curl.exe`.

| Route | Expected evidence |
|---|---|
| `GET /api/health`, `GET /api/app/version`, `?platform=tv` | health 200 `{status:"ok", mode:"cloud-stremio", onlineMoviesCount}` (`0` only before the first sync); version 200 `packageName:"uk.vikyflix.app"` / `uk.vikyflix.tv` on tv, `versionCode:66`, `versionName:"2.9.9"`, `apkUrl` (`/download/tv` on tv), `apkSha256`, `fileSize`, `releaseDate`, `releaseNotes`, `Cache-Control: no-cache, no-store, must-revalidate`; never cross packages |
| `GET /api/movies`, `GET /api/series` | 200 discontinued shells `{movies:[],series:[],directories:[],discontinued:true}` / `{series:[],directories:[],discontinued:true}` — intentional |
| `GET /api/moviebox/catalog/meta`, `.../catalog` | meta 200 `{total, fetchedAt}` `no-store`; catalog 200 `{fetchedAt, total, movies[]}` `no-cache`, repeat with `If-None-Match` → 304, 500 `{error,message}` = upstream scrape failure |
| `GET /api/moviebox/search?q=<term>` | 200 `{query, total, results[]}` (empty `q` allowed); 500 `{error:"Search failed",message}` on upstream error |
| `GET /api/moviebox/detail/:id`, `.../episodes/:id` | 200 `{movie:{...}}` for an id from search / `{seasons:[{se,maxEp}]}` for a series, `{seasons:[]}` for a movie; unknown → 404 `{error}` |
| `GET /api/moviebox/poster/:id` (`?w=720`), `.../backdrop/:id`, `/api/poster/:hash` | 200 `image/jpeg` (`max-age:604800`; baked variant `immutable`) or 200 `image/svg+xml` designed placeholder (`max-age:60`) — MovieBox artwork never 4xx; local `/api/poster/:hash` is 404 text when uncached |
| `GET /api/moviebox/stream/:id` (+ `OPTIONS`) | 200, or 206 with `--range 0-1023`: `video/mp4`, `Cache-Control: no-store`, `X-Stream-Resolution`, `Accept-Ranges: bytes`; unknown 404; past-EOF 416; upstream 502; OPTIONS → 200 + `Access-Control-Allow-*` |
| `GET /download` (`/download/app`, `/movieflix.apk`, `/vikyflix.apk`), `/download/tv` (`/movieflixtv.apk`), `/download/share` (`/movieflix-share.apk`), `/download/lg` (`/download/webos`, `/vikyflix.ipk`) | 200 attachments `MovieFlix.apk` / `MovieFlixTV.apk` / `MovieFlix-Share.apk` / `VikyFlix.ipk` (app + tv send `no-store`); 404 text when the artifact is missing |
| `GET /api/movies/:id/subtitles/online?query=&year=`, `.../subtitles/custom/:filename` | 200 `{subtitles:[{id,lang,name,sourceUrl}]}` / 200 `text/vtt; charset=utf-8` (`max-age:86400`); missing `query` → 400 `{error:"Title required for search"}`, unknown file → 404 text |
| `GET /` and client routes; `GET /api/<unknown>`; `GET /promo/<asset>` | `/` → 200 `dist/index.html` (`no-store`, needs a build); unknown `/api/*` → 404 `{error:"Endpoint not found"}` (JSON only while `dist` exists); `/promo/*` → 200 static file while `promo/` exists |

Field-level checks (status alone is not evidence):

```powershell
$b = 'http://localhost:5000'; Invoke-RestMethod "$b/api/health" | Select status, mode, onlineMoviesCount
(Invoke-RestMethod "$b/api/app/version").packageName; (Invoke-RestMethod "$b/api/app/version?platform=tv").packageName
$id = (Invoke-RestMethod "$b/api/moviebox/search?q=love").results[0].id
curl.exe -s -D - -o NUL --range 0-1023 "$b/api/moviebox/stream/$id" | Select-String 'HTTP/|Content-Range|X-Stream-Resolution'
```

## 6. API smoke — POST and auth

| Endpoint | Expected behaviour |
|---|---|
| `POST /api/moviebox/refresh` | `requireAdmin`: header `x-admin-key` (also `?admin=`, but it leaks the key into logs — don't). Missing/wrong key → **401** `{error:"Unauthorized"}`; correct key → 200 `{success:true, ...}` after a real scrape (slow). Local only; owner approval for Render/`vikyflix.uk` |
| `POST /api/movies/:id/subtitles/download` | body `{sourceUrl, lang?, name?}`; missing → 400 `{error:"sourceUrl required"}`; success → 200 `{success:true, vttUrl, label, name}` (first call downloads + converts) |
| `POST /api/movies/:id/subtitles/upload` | body `{text, filename?, label?}`; missing text → 400 `{error:"Subtitle text required"}`; valid SRT → **200** `{success:true, vttUrl}` and GET `vttUrl` → 200 `text/vtt`. Regression case for **ERR-1** (was a 500 `movie is not defined`; fixed in commit `708ac8e`) |

```powershell
$b = 'http://localhost:5000'
curl.exe -s -o NUL -w "%{http_code}" -X POST "$b/api/moviebox/refresh"   # 401, safe anywhere
$env:ADMIN_KEY = ((Get-Content server\.env | Where-Object { $_ -match '^ADMIN_KEY=' }) -replace '^ADMIN_KEY=','').Trim()
curl.exe -s -o NUL -w "%{http_code}" -X POST -H "x-admin-key: $env:ADMIN_KEY" "$b/api/moviebox/refresh?pages=1"   # 200 local
```

## 7. Android / TV

```powershell
cd web; npm run build        # must pass before sync
npx cap sync android         # copies dist/ into android/; expect "Sync finished"
cd android
.\gradlew.bat clean :app:assembleMobileRelease :app:assembleTvRelease   # OWNER PRESENT ONLY
powershell -ExecutionPolicy Bypass -File .\sign-release.ps1            # signs + apksigner verify
```

Gate output: `app/build/outputs/apk/{mobile,tv}/release/app-{mobile,tv}-release.apk`;
`*-unsigned.apk`/debug are not release evidence. Without the owner stop after `cap sync`;
compile-check only with `.\gradlew.bat :app:assembleMobileDebug :app:assembleTvDebug`;
after an OTA change match `server/index.js` versionCode/versionName to `build.gradle` (66 / 2.9.9).

### 7.1 Emulator / device APK loop

```powershell
powershell -ExecutionPolicy Bypass -File scripts\android-emulator.ps1 -Action test              # phone AVD
powershell -ExecutionPolicy Bypass -File scripts\android-emulator.ps1 -Action test -Flavor tv   # TV APK
powershell -ExecutionPolicy Bypass -File scripts\android-emulator.ps1 -Action stop
```

Expected: emulator (`vixa_qa`) boots, `adb install` prints `Success`, the app
launches, logcat shows no `FATAL`/`AndroidRuntime`, and one title starts playback.
**Run from a normal PowerShell window:** the emulator writes
`%USERPROFILE%\.android\*`, which the DSH sandbox denies (`error: 5`). If a real
title cannot be played on the emulator, record it as **not tested**, never as
passing.

## 8. Cloud and tunnel probes (read-only)

```powershell
$c = 'https://vikyflix-server.onrender.com'
curl.exe -s -o NUL -w "%{http_code}" "$c/api/app/version"; curl.exe -s -o NUL -w "%{http_code}" "$c/api/health"
curl.exe -s -o NUL -w "%{http_code}" "https://vikyflix.uk/api/app/version"   # needs PC + cloudflared tunnel up
```

`render.yaml` sets `healthCheckPath: /api/app/version`; a 200 after one slow request is a pass — record the delay; never mutate a remote host.

## 9. UI acceptance checklist (`web/DESIGN_SPEC.md`)

- [ ] Widths 390 / 768 / 1440 px: no horizontal overflow, padding 16 / 32 / 40, max-width 1680.
- [ ] Artwork only through `<Poster>` (no raw `<img>`): 2:3 box reserved, shimmer, fade-in, designed fallback with retry; max two badges.
- [ ] Metadata `year · genre · runtime` on one line with ellipsis, never wrapped; no text below 11px.
- [ ] States: loading skeleton, empty results, error + one clear retry — no blank screens (DevTools offline/throttle).
- [ ] Tokens from `aurora.css` only; ember gradient only on primary/active; new CSS in a per-area file, never `App.css`/`aurora.css`.
- [ ] Keyboard/TV: sane tab and D-pad order, no dead ends, visible `:focus-visible` ring, `aria-label` on icon buttons, 44px targets, safe margins; `prefers-reduced-motion` suppresses animation (no loops; hover = lift + 2–4% zoom, 280 ms).
- [ ] Player: controls auto-hide, one quality indicator, audio/quality/speed/subtitle actions reachable, seek + resume work; before/after screenshots per claimed width.

## 10. Troubleshooting

| Symptom | Likely cause | Check / fix |
|---|---|---|
| `node`/`npm` not recognised | Node missing or stale PATH | `node --version` in a fresh shell; install Node 18+ |
| `EADDRINUSE` on 5000 | server/watchdog already running | `netstat -ano \| findstr :5000`; stop only your own PID; ask before touching the live one |
| Refresh 401 with the "right" key | wrong header, server started outside `server/` (no `.env`), quotes/whitespace | re-read `.env`, restart from `server/`, send `x-admin-key` |
| `onlineMoviesCount: 0` after start / catalog+search 500 | cold cache, or upstream MovieBox/BFF blocked/slow | wait for the first sync (~3 s after boot); read `[MovieBox] ... error`; retry once; never relax filters as a fix |
| Posters stay dark | upstream artwork fetch failed | `[MovieBox] Poster proxy error`; placeholder is 200 SVG cached 60 s; warmers at boot +20 min |
| Stream 502 / stalls | CDN token expiry or network | retry with `?r=1` (invalidates cache); 416 after a seek is normal |
| `GET /` = Express "Cannot GET /" | `web/dist` missing | `cd web; npm run build` (SPA fallback needs it too) |
| `cap sync` fails / Gradle SDK error | `dist/` missing, no `sdk.dir`, wrong JDK | build first; fix `web/android/local.properties`; `.\gradlew.bat --version` (JDK 21) |
| OTA wrong app / package conflict | mobile and TV packages crossed | `uk.vikyflix.app` only via `/download`, `uk.vikyflix.tv` only via `/download/tv`; never swap artifacts |

Logs: `server/server.log`, `server/server_err.log`, `server/server_out.log`, `server/service.log`, `server/tunnel.log`, `server/tunnel_h2.log`, `server/watchdog.log`; browser console for web; `adb logcat` for Android.

## 11. Evidence block — copy into the report

```markdown
### Verification — <task / change>
Env: local PC | vikyflix.uk | Render | device     Date: <yyyy-mm-dd> <host>
Artifact: web/dist @ <time> | APK <path + sha256>   Changed files: <list>
Error-register rows touched: <ERR-... / none>

| # | Check (command) | Expected | Actual | Pass |
|---|-----------------|----------|--------|------|
| 1 | `cd web; npm run lint` | exit 0 | exit 0, no findings | yes |

Not tested (why): <signed release build — owner absent>
Risks / follow-ups: <...>
```

## 12. What does NOT count as evidence

- "It looks fine" / "should work" with no command, status code or screenshot.
- An HMR view with no `npm run lint` + `npm run build`.
- HTTP 200 alone: fields must match §5/§6. One width for a responsive change, or one platform for an OTA change.
- Results from another build/env, a retried-until-green failure missing its first red
  run, someone else's report, or an older run pasted as proof.
- Any write (`POST`) against production as a "quick check".

## 13. Acceptance gates by change type

| Change type | Gate evidence (all required) |
|---|---|
| Feature | lint + build (if web); `node --check` on every changed `server/*.js`; affected routes with fields; UI checklist if UI touched; related prevention cases re-run; handoff contract (`Skills/README.md`) complete |
| Bugfix | reproduction **before** (status/log/screenshot), root-cause sentence, after-evidence on the same repro, regression pass on prevention cases, new error-register row with a prevention rule |
| UI-only | §9 checklist at 390/768/1440 with before/after screenshots; build passes; no API contract change; no CSS added to `App.css`/`aurora.css` |
| Backend/API | syntax checks; server restarted locally; success **and** error paths of each touched route (400/401/404/500); cache headers unchanged unless intended; no new hard-coded host |
| Android/TV release | owner present; build + `cap sync`; release gradle tasks exit 0; `sign-release.ps1` verification output; both APKs exist; OTA `apkSha256` matches the APK; `/download*` all 200 |
| Cloud/deploy | owner approval first; cloud `/api/app/version`, `/api/health`, catalog probes; PC-off fallback playback; tunnel probe; cold-start delay recorded |

## 14. CI-ready command list (PowerShell) — proves shape/status only; §5 fields and §9 UI stay manual

```powershell
cd "E:\projects\My Streaming Services"; $ErrorActionPreference = 'Stop'
Push-Location web; npm ci; npm run lint; npm run build; Pop-Location
Get-ChildItem server -Filter *.js | ForEach-Object { node --check $_.FullName; if ($LASTEXITCODE) { throw "syntax: $($_.Name)" } }
$srv = Start-Process node -ArgumentList 'index.js' -WorkingDirectory server -PassThru
try {
  for ($i = 0; $i -lt 40; $i++) { if ((curl.exe -s -o NUL -w '%{http_code}' 'http://localhost:5000/api/health') -eq '200') { break }; Start-Sleep 1 }
  foreach ($p in '/api/health','/api/app/version','/api/app/version?platform=tv','/api/moviebox/catalog/meta') {
    $code = curl.exe -s -o NUL -w '%{http_code}' "http://localhost:5000$p"; if ($code -ne '200') { throw "$p -> HTTP $code" } }
} finally { Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue }
```

## 15. Failure telemetry (capture pipeline)

Use a scratch telemetry dir so production logs stay clean:

```powershell
$env:TELEMETRY_DIR = "$env:TEMP\vf-verify"; $env:PORT = '5051'; $env:ADMIN_KEY = 'test-key'
cd server; npm start          # keep this terminal; run the checks below in a second one
```

| # | Check | Expected |
|---|---|---|
| 1 | `$j = '{"events":[{"cls":"player_error","kind":"fatal","code":"NETWORK"}]}'; curl.exe -s -o NUL -w "%{http_code}" -X POST -H "Content-Type: application/json" -d $j http://localhost:5051/api/telemetry/events` | `204` (always, even on bad input) |
| 2 | `Get-ChildItem $env:TELEMETRY_DIR` | `telemetry-<date>.jsonl` exists, one JSON line per accepted event |
| 3 | Post the same signature 3× (or one P0: `{"cls":"update_install_failed","kind":"signature_mismatch"}`) | `inbox\FAIL-<sig>.json` appears with `status:"new"`, `count`, platforms, samples (≤3) |
| 4 | `node server/failure-drain.js` | prints `DRAIN_EVENTS=... NEW_FAIL=...`; writes `monitor-status.json` and `drain-state.json` |
| 5 | `curl.exe -s -H "x-admin-key: test-key" http://localhost:5051/api/telemetry/status` | `200` JSON with `fileCount`, `todayLines`, `retentionDays` |
| 6 | `node --check server/telemetry.js; node --check server/failure-drain.js` | exit 0 |

Privacy check: inspect one JSONL line — no IP, no token, no `.env` value and no
full URL (URLs become `[url]`). Browser/device capture (real click on Retry,
real HLS failure) needs a browser or device: if unavailable, record it as
**not tested**, never as passing.

## 16. Activity capture (watched titles + duration — option B)

| # | Check | Expected |
|---|---|---|
| 1 | `POST /api/activity/events` with `{events:[{type:"play",playId,mediaId,title,platform,installId}]}` | `204` always (bad input included) |
| 2 | same `playId` with `play_progress`/`play_end` + `watchedSeconds` | stored; report sums one session |
| 3 | `Get-ChildItem server\logs\activity-*.jsonl` | one JSON line per event |
| 4 | `powershell -File scripts\build-watch-report.ps1` | `watch-report.html`; console `Watches: n … watch time: Xm` |
| 5 | `node --check server/activity.js` | exit 0 |

Privacy: no names, IPs or tokens; duration + percent only while playing. Opt-out
on the device is `localStorage.vf_activity_opt_out = '1'`. Android/TV report only
after an APK update — their on-device playback is invisible to the PC.

