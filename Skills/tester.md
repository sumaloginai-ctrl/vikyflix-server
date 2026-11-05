# Tester (QA) — evidence, not opinions

**Purpose:** turn a change into pass/fail evidence or a fixable bug report. You do not fix code, deploy, or refresh production.
**Load when:** after any change, before a release, before touching playback/catalog/subtitles/OTA (`docs/error-register.md`), or for a periodic website + Android + TV sweep.
**Rules:** `AGENTS.md` binds QA — content policy is a test target (never widen it as a "fix"), no secrets in evidence, no destructive/public action (deploy, refresh, restart, delete artifacts, rotate keys) without the owner; never build/sign releases without the owner. This is a runbook: nothing is "executed" until the command was actually run.

## 1. Environments

| Env | How to reach it | What it proves | Isolation |
|---|---|---|---|
| Local PC (primary) | `cd server; npm start` → API `:5000` (serves `web/dist`); `cd web; npm run dev` → `http://localhost:5173`; `getApiBase()` targets `:5000` when the port is 5173 (no Vite proxy). `npm run build` + `http://localhost:5000/` = the production build | full API + fresh UI; production build proves exactly what vikyflix.uk serves | `PORT` + `CACHE_DIR` overrides |
| Public tunnel | `https://vikyflix.uk` / `https://www.vikyflix.uk`; `start-server.bat` starts `server/cloudflared.exe tunnel run` then `npm start` | tunnel path real users hit | **read-only QA** |
| Render fallback | `https://vikyflix-server.onrender.com`; free tier sleeps ~15 min, first request ~50 s wake; Render health check is `/api/app/version` (`server/render.yaml`) | cloud-only mode with the PC off | no deploys/writes |
| Android phone (device/emulator) | install `web/android/app/build/outputs/apk/mobile/debug/app-mobile-debug.apk` (`adb install -r …`); package `uk.vikyflix.app`; app calls `https://vikyflix.uk` (`web/src/config.js`) | WebView quirks, OTA, on-device Stremio bridge | debug build only |
| Android TV (device/emulator) | `web/android/app/build/outputs/apk/tv/debug/app-tv-debug.apk`; package `uk.vikyflix.tv`, UA appends `MovieFlixTV` | D-pad navigation, TV GPU/perf | debug build only |
| Browser previews | `http://localhost:5173/?app=1` forces native UI (`IS_NATIVE_APP`); `?tv=1` forces TV mode (`IS_TV`); `localStorage.vickyflix_server_url` repoints the API | device logic without hardware | — |

### 1.1 Emulator & device loop (APK testing)

One script boots the existing AVD (`vixa_qa`, Android 35), installs the debug
APK, launches the app and prints a filtered logcat:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\android-emulator.ps1 -Action test              # phone AVD
powershell -ExecutionPolicy Bypass -File scripts\android-emulator.ps1 -Action test -Flavor tv   # TV APK
powershell -ExecutionPolicy Bypass -File scripts\android-emulator.ps1 -Action test -ShowWindow  # watch live
powershell -ExecutionPolicy Bypass -File scripts\android-emulator.ps1 -Action stop
```

- **Run it from a normal PowerShell window, not the DSH sandbox.** The emulator
  writes `%USERPROFILE%\.android\*`; the sandbox denies that (`error: 5` on
  `emu-last-feature-flags.protobuf.lock`). The agent can still use
  `-Action status`, `-Action install` and `adb` itself.
- **Physical phone:** enable USB debugging, accept the RSA prompt, confirm
  `adb devices` shows one `device`, then `-Action install` and `-Action logcat`.
- Debug APKs: `web/android/app/build/outputs/apk/{mobile,tv}/debug/app-{mobile,tv}-debug.apk`.
  Build first: `cd web; npm run build; npx cap sync android; cd android; .\gradlew.bat :app:assembleMobileDebug`
  (or `:app:assembleTvDebug`).
- APK evidence: exact package id (`uk.vikyflix.app` / `uk.vikyflix.tv`), installed
  `versionCode`, app launches, no `FATAL`/`AndroidRuntime` in logcat, and one
  title starts playback on the device/emulator.

Logs: browser console; `adb logcat`; `server/server.log`, `server/server_err.log`, `server/server_out.log`, `server/service.log`, `server/tunnel.log`, `server/watchdog.log`. Release builds: `web/android/RELEASE_SIGNING.md` only.

## 2. Preconditions & test data

- Node/npm, `ffmpeg` on PATH, `server/.env` from `server/.env.example`; ports 5000/5173 free; `web/dist/index.html` present for the production-build env.
- Warm: poll `Invoke-RestMethod http://localhost:5000/api/health` until `onlineMoviesCount > 0` (cold sync starts ~3 s after boot; allow ≤120 s). Baseline: catalog `total`, health count, app `versionCode`, APK sha256 (`Get-FileHash .\MovieFlix.apk -Algorithm SHA256` from the repo root), `fetchedAt`.
- Pick fixtures from the live catalog (never hard-code subject ids):
  ```powershell
  $b="http://localhost:5000"; $cat=Invoke-RestMethod "$b/api/moviebox/catalog"
  $movie = $cat.movies | ? { $_.subjectType -eq 1 -and $_.audioVersions.Count -gt 1 } | select -First 1
  $series= $cat.movies | ? { $_.subjectType -eq 2 } | select -First 1
  $plain = $cat.movies | ? { $_.subjectType -eq 1 -and -not $_.audioVersions } | select -First 1
  ```
  Required: `$movie` (multi-audio), `$series`, `$plain`, a no-poster row, a known-unplayable row if present (`hasResource=false`), search hit `love`, no-hit `zzzzqqq`.
- Reset client state: clear `localStorage` `vikyflix_watch_progress`, `vickyflix_watchlist`, `vickyflix_theme`, `vikyflix_view_mode`, `vikyflix_cached_catalog_v2`, `vikyflix_cached_catalog_synced_at`, `vickyflix_server_url`, `movieflix_subs_*`; delete IndexedDB `movieflix-catalog-db`.
- Failure checks only on a scratch server: `$env:PORT=5010; $env:CACHE_DIR="$env:TEMP\vfqa"; cd server; npm start`. Never delete/corrupt `server/cache/` or the `.apk`/`.ipk` artifacts.

## 3. Automated gate (run before any manual pass)

Commands are the accepted ones in `docs/verification.md`; record command, exit code, key output.

```powershell
cd web; npm run lint; npm run build          # oxlint + vite must both exit 0
cd ..; node --check server/index.js; node --check server/moviebox.js; node --check server/subtitles.js; node --check server/transcoder.js
$b="http://localhost:5000"
Invoke-RestMethod "$b/api/health"; Invoke-RestMethod "$b/api/app/version"
Invoke-RestMethod "$b/api/app/version?platform=tv"; Invoke-RestMethod "$b/api/moviebox/catalog/meta"
Invoke-RestMethod "$b/api/moviebox/search?q=love"; Invoke-RestMethod "$b/api/movies"
```

PASS: lint/build exit 0 and `web/dist/index.html` rewritten; health `status:"ok"` count >0; both OTA tracks `200` with correct package ids; `/api/movies` returns `{movies:[], discontinued:true}` (intentional).

## 4. Test matrix (steps → expected; a miss becomes a bug per §8)

### 4.1 Content & discovery

| ID | Case | Steps | Expected (PASS) |
|---|---|---|---|
| CAT-01 | Catalog contract | `GET /api/moviebox/catalog`, inspect a row | `200 {source, fetchedAt, total, banners[≤6], categories{trending,action,drama,comedy,series,topRated}, movies[total]}`; row has `id:"mb_<digits>"`, `subjectType:1\|2`, `source:"MovieBox"`, `title`, `year`, `genres[]`, `detailPath`, `poster:"/api/moviebox/poster/<id>"` or `/favicon.svg` |
| CAT-02 | Cold start | scratch `CACHE_DIR`, start, poll `/api/health` | `200`; count rises 0 → >0 within ≤120 s; no crash in `server/server.log` |
| CAT-03 | Freshness | `GET /api/moviebox/catalog/meta` twice, catalog unchanged | `200 {total,fetchedAt}`, `Cache-Control: no-cache, no-store`; `total` equals `movies.length` and health count; catalog GET with `If-None-Match` → `304` |
| CAT-04 | Home rails | `/` and `/?app=1` at 390/768/1440 px | hero ≤5; "New Releases (Last 7 Days)" only 7-day items; "Top 10" exactly 10 (fewer only if catalog too small); no blank rail when candidates exist; every artwork is `<Poster>`, no broken image |
| CAT-05 | Artwork proxy | `GET /api/moviebox/poster/<id>?w=700`, `/api/moviebox/backdrop/<id>`, unknown id | `200 image/jpeg`, or `200 image/svg+xml` designed placeholder for unknown/no-art; never `500`/broken image; cached variants get long `Cache-Control` |
| SRC-01 | Search contract & edges | `?q=love`, `?q=` (empty), `?q=zzzzqqq`, `%3Cscript%3E`, 200-char term; repeat `?q=love` on a scratch server with upstream unreachable (§6) | `200 {query,total,results[]}`; `total === results.length`; empty/miss `{total:0}` (not error); special chars echoed as text, no HTML execution, no 5xx; upstream down → catalog-scan matches from `searchMovieBox` fallback, not `500` |
| SRC-02 | UI live search | open via `Ctrl+K`, type `love` (~160 ms debounce), arrows, Enter, Esc | results render without jank; arrow highlight; Enter opens detail; Esc/Ctrl+K closes; no-results state has a human sentence + recovery |
| FLT-01 | Genre/language filters | Movies tab → Genres/Languages → pick one; then pick a genre+language with no overlap | active chip shows count; every card's mapped genre/language matches; reset clears all; no-overlap combo → designed empty state with reset (no crash/blank); phone widths (≤768 px) anchor the dropdown under its button, not a detached sheet |
| FLT-02 | Sort (all 8) | `recent`, `rating-desc`, `title-asc`, `title-desc`, `year-desc`, `year-asc`, `duration-desc`, `duration-asc` | first 10 visible results obey the order; changing sort does not reset active filters |
| FLT-03 | Infinite pagination | scroll catalog to tail (page size 36) | next 36 append automatically, no "Load More", spinner at tail, filters still applied |
| DET-01 | Movie details | open a movie card; choose an alternate audio edition; Play | hero, 2-line synopsis, Play + My List, metadata one line, editions listed; player opens on the chosen edition (watch for `404` — merged edition ids may not resolve, see §12.5); "More Like This" uses `<Poster>`; Esc/back returns to grid |
| DET-02 | Series details | open `$series`; switch seasons; block episodes fetch | season dropdown shows counts; tiles = `maxEp`; switch changes tiles; grid/cards toggle; blocked fetch → designed error + Retry (≤12 skeleton tiles), not endless skeleton |
| EPI-01 | Episodes contract | `GET /api/moviebox/episodes/<$series.subjectId>` | `200 {seasons:[{se,maxEp}]}`, ascending `se`, `maxEp>0` |
| EPI-02 | Episodes edges | same for `$plain`; unknown id; `?audio=<edition id>` | non-series `200 {seasons:[]}`; unknown `404 {error:"Title not found"}`; valid audio selects that edition (same map); invalid audio ignored |
| EPI-03 | Episode stepping | play S1E1, next/prev arrows | S/E chip updates; stream request carries new `se`/`ep`; position resets to 0; prev returns correctly |

### 4.2 Playback & media

| ID | Case | Steps | Expected (PASS) |
|---|---|---|---|
| PLY-01 | Start | tap Play on `$plain` | loading overlay then playback (resolve typically 1–3 s); network `GET /api/moviebox/stream/<id>` `200/206`; no console exception |
| PLY-02 | Seek | drag to ~50 % (in-range, no new request) then ~90 %/near end | position jumps and continues; labels consistent; far seek resumes at target — if it sits on "Streaming video…" forever that is P1 (buffering never recovers) |
| PLY-03 | Resume | play >30 s, close, reopen from "Continue Watching" | resumes at saved second (`>10 s`, not 0); >95 % watched removes the entry |
| PLY-04 | Range proxy | `curl.exe -s -D - -o NUL -H "Range: bytes=0-1023" "$b/api/moviebox/stream/<id>"`; then `999999999-` | `206` + `Content-Range`, `Accept-Ranges: bytes`, `X-Stream-Resolution` non-empty; past-EOF `416 {"error":"Requested range not satisfiable"}` (if 200, upstream ignored Range — note it) |
| PLY-05 | Quality | open Quality, choose Auto/1080/720/480/360 | only the online ladder for MovieBox; request gains `?res=<n>`; `X-Stream-Resolution` is nearest available (server falls back up/down); position preserved; toast confirms; exactly ONE quality chip on screen |
| PLY-06 | Controls, fullscreen, speed | wait 3.5 s, tap; rotate/fullscreen; speeds 0.5–2×; long-press 2×; ±10 s gestures | controls hide only while playing and no menu open; rotate locks landscape in player and restores portrait; speed applies and restores; HUD values correct; no accidental pause on scrub |
| PLY-07 | Stream failure | DevTools block stream URL (or scratch upstream down) | designed "Playback Problem" + Retry + Close, not infinite spinner; Retry cache-busts and resumes near last position; 40 s no-data timeout fires |
| AUD-01 | Audio menu | play `$movie` → Audio | languages listed with first "(Default)"; single-audio title shows "No alternate audio editions" |
| AUD-02 | Audio swap | select alternate; also block one edition's stream | URL gains `?audio=<subjectId>`; audio changes; position preserved; series keeps `se`/`ep`; a broken edition shows designed error, never silent wrong-language playback |
| SUB-01 | Online search | player → Subtitles → Search Online | spinner then language/name list; zero results → "No subtitles found for …"; modal closes cleanly |
| SUB-02 | Download online | pick a subtitle | activates, toast "Subtitle Activated: <lang>"; direct browser fetch tried first, server `POST …/subtitles/download` fallback; cues match audio within ±1 s |
| SUB-03 | Persistence | close/reopen player; switch series episode; delete track | saved tracks return under "Imported & Downloaded" (`movieflix_subs_<titleId>[_sNeM]`); no cross-episode leakage; delete removes it |
| SUB-04 | Upload file | upload `.srt` and `.vtt`; upload binary/junk | SRT converts to VTT, activates, persists; junk shows an alert and playback is unaffected |
| SUB-05 | Upload endpoint | `POST /api/movies/mb_<id>/subtitles/upload` with `{"text":"1\n00:00:01,000 --> 00:00:02,000\nHi","filename":"a.srt","label":"A"}`; empty body | empty → `400 {error:"Subtitle text required"}`; valid text should be `200 {success,vttUrl,label}` — **current source uses an undefined `movie` at `server/index.js:818,827`, so expect 500**: file P2 (UI imports locally, impact limited) |
| SUB-06 | Serve custom VTT | `GET /api/movies/<id>/subtitles/custom/<file>.vtt`; missing file | `200 text/vtt; charset=utf-8`, CORS `*`, `Cache-Control` 86400; missing → `404` text "Subtitle not found" |
| ERR-01 | Offline & cold failure | DevTools offline → back online; separately offline with empty cache | banner "You're offline — showing what's already loaded" (`role=status`); "Back online" ~2.6 s, cached catalog browsable; empty cache → designed "Can't reach MovieFlix servers" + "Retry Connection", retry recovers |
| ERR-02 | Artwork failure | block `/api/moviebox/poster/*` | designed fallback card (initial + title, tap-to-retry); reserved box height, no layout shift, no broken-image icon |
| ERR-03 | Slow network/restart | Slow 3G; restart scratch server mid-play | skeletons then content; player shows progress; stall/restart surfaces error + Retry within seconds, refresh recovers |
| ERR-04 | Error shape | every negative request in §5 | JSON `{error}` (some add `message`); only text errors are `/api/poster/:hash` 404, `/download*` 404, subtitle-custom 404; HTML `/api/*` 404 means `web/dist` is missing (deploy defect) |

### 4.3 Platform, release & policy

| ID | Case | Steps | Expected (PASS) |
|---|---|---|---|
| OTA-01 | Mobile track | `GET /api/app/version` | `200`; `packageName:"uk.vikyflix.app"`, `apkUrl:"https://vikyflix.uk/download"`, `versionCode` number, `versionName` string, `apkSha256` 64-hex/`null`, `fileSize`, ISO `releaseDate`, `releaseNotes`; no-cache/no-store |
| OTA-02 | TV track | `GET /api/app/version?platform=tv` | `packageName:"uk.vikyflix.tv"`, `apkUrl:"https://vikyflix.uk/download/tv"` — never the mobile package or `/download` |
| OTA-03 | No cross-update | compare manifests; test `?platform=TV` | ids/paths never cross; `platform` is case-sensitive (uppercase returns the mobile track) — clients must send lowercase `tv`; TV client sends it via `IS_TV` |
| OTA-04 | Checksum truth | `Get-FileHash .\MovieFlix.apk -Algorithm SHA256` vs manifest; then the Render response | equal fileSize/sha256 on a host that has the APKs; a host without artifacts must return `apkSha256:null`, `fileSize:5501048` — check what Render actually serves, don't assume |
| OTA-05 | In-app update | install debug APK; scratch copy with a raised version constant; open app (native) | modal only when server `versionCode` > installed; SHA-256 verified before install; `apkUrl` host must be exactly `vikyflix.uk`, path `/download` or `/download/tv`, or the modal refuses |
| OTA-06 | Tunnel-down update | serve manifest from Render while vikyflix.uk is down | note: `apkUrl` is hard-coded to vikyflix.uk, so the download fails with the tunnel down — manifest is fine, report as P2 |
| DL-01 | Artifacts & identity | `/download`, `/download/app`, `/movieflix.apk`, `/vikyflix.apk`, `/download/tv`, `/movieflixtv.apk`, `/download/share`, `/download/lg`, `/download/webos`; then `adb shell dumpsys package uk.vikyflix.tv \| findstr versionCode` (and `uk.vikyflix.app`) | `200` `MovieFlix.apk` / `MovieFlixTV.apk` / `MovieFlix-Share.apk` / `VikyFlix.ipk` (LG from `server/VikyFlix.ipk`); phone/TV `Cache-Control: no-store`; missing artifact `404` text, not `500`; bytes equal `Get-FileHash`; installed package ids exact and `versionCode` equals the manifest and `build.gradle`; signing material never printed |
| FBK-01 | Render cold start | stop PC server + tunnel; open app | app tries API_BASE → vikyflix.uk → Render (`App.jsx`); catalog appears after wake (~50 s first request) with loader, then normal; no crash on `null`/empty responses |
| FBK-02 | No downgrade | seed newer `vikyflix_cached_catalog_synced_at`, serve older catalog | client skips older snapshot (`incomingAt < syncedAt`) and keeps the newer catalog |
| FBK-03 | Playback with PC off | Android device with PC off; browser on Render origin | Android uses the on-device bridge (`127.0.0.1` port); web playback builds its stream URL from `API_BASE` only, so a page served from vikyflix.uk does **not** fall back to Render when the tunnel dies — verify and report as P2 if cloud playback is promised |
| FBK-04 | Update check fallback | block API_BASE `/api/app/version` | tries vikyflix.uk then Render automatically, first `200` wins, 6 s timeout each; no modal spam |
| TV-01 | TV mode | open `/?tv=1` | `<html class="tv-mode">`; bold focus ring; focus lands on first visible card ~1.4 s after load |
| TV-02 | D-pad | arrows all directions, held keys, rail ends | spatial moves, no dead ends, focused card scrolled clear of header/dock, page moves one shelf at the last row; repeats rate-limited but responsive |
| TV-03 | Activate/back + device | Enter/Space on a div card; Back from section/detail/player; install `app-tv-debug.apk` | action fires once; Back consumes drilled-in state → catalog → Home → exit; search modal owns arrows/Back; UA contains `MovieFlixTV` → `IS_TV`; `adb logcat` clean; no overscan clipping |
| A11Y-01 | Targets & labels | Tab through nav/cards/player; inspect icon-only buttons/dialogs | controls ≥44 px; visible `:focus-visible` ring; `aria-label` on player/search/poster controls; dialogs `role="dialog" aria-modal="true"`; banners `role="status"` |
| A11Y-02 | Motion & type | OS reduce motion; 200 % zoom; light theme | `prefers-reduced-motion` suppresses entrances/loops; no text <11 px; metadata one line with ellipsis; primary CTA visible when zoomed |
| POL-01 | Counts stable | catalog `total` = meta `total` = health count; after 20-min refresh | equal; no mass churn or duplicate dub rows; total changes only on real content changes |
| POL-02 | Excluded genres | scan `movies[]` genres/titles | no `animation`/`anime` rows, no franchise titles (Naruto, One Piece, Dragon Ball, per `moviebox.js` regexes) |
| POL-03 | Region filters | scan `countryName`, scripts, title/desc markers | no Nigeria/Ghana/Philippines/Indonesia/Bangladesh/Pakistan-origin rows; no Bengali/Urdu/Punjabi script; no Tagalog/Nollywood markers — per `isNigerian`/`isFilipino`/`isBengali`/`isUrdu` |
| POL-04 | Search policy leak | `GET /api/moviebox/search?q=nollywood`, `?q=tagalog`, `?q=vivamax`, `?q=bangla` | any excluded title = P1 content-policy gap. Code inspection: `searchMovieBox` filters only audiobook/anime/adult (`server/moviebox.js:1398`), not region filters (catalog build does, `moviebox.js:1144`) — a real probe |
| POL-05 | Client mirror + change guard | inspect rendered rails after an API/UI change; compare before/after counts | client `isExcludedOnline` (`web/src/onlineLibrary.js`) shows no excluded rows even if the API leaks; no widening without owner approval |

## 5. API contract checks

`$b="http://localhost:5000"`; `curl.exe` for status/headers, `Invoke-RestMethod` for JSON.

| # | Request | Expected |
|---|---|---|
| 1 | `GET $b/api/health` | `200 {status:"ok", mode:"cloud-stremio", onlineMoviesCount:N}` |
| 2 | `GET $b/api/app/version` / `?platform=tv` | `200`; mobile `uk.vikyflix.app` + `/download`; TV `uk.vikyflix.tv` + `/download/tv` (OTA-01/02 fields) |
| 3 | `GET $b/api/moviebox/catalog/meta` | `200 {total:N, fetchedAt:"<ISO or null>"}`; no-store |
| 4 | `GET $b/api/moviebox/catalog` | `200` catalog (CAT-01); ETag; cold+upstream-down edge may be `200 null` — treat as contract defect (should be `5xx {error,message}`); `?refresh=1` forces refresh (slow, local only) |
| 5 | `GET $b/api/moviebox/search?q=love` | `200 {query:"love", total:N, results[]}`; empty `q` → `{total:0}` |
| 6 | `GET $b/api/moviebox/detail/mb_<id>` | `200 {movie}`; missing → `404 {error:"MovieBox movie not found"}`; upstream → `500 {error:"Detail fetch failed", message}` |
| 7 | `GET $b/api/moviebox/episodes/<subjectId>` | `200 {seasons:[{se,maxEp}]}`; non-series `{seasons:[]}`; unknown `404 {error:"Title not found"}`; failure `500 {error:"Episodes fetch failed", message}` |
| 8 | `GET $b/api/moviebox/stream/<id>` | `200/206`; `Accept-Ranges: bytes`, `Content-Type`, `Cache-Control: no-store`, `X-Stream-Resolution`; unknown `404 {error:"Title not found"}`; no resource `404 {error:"Stream not available", message}`; upstream `502 {error:"Stream fetch failed", message}` or `{error:"Upstream responded N"}`; `HEAD` headers-only; `OPTIONS` `200` + `Access-Control-Allow-Origin: *` |
| 9 | `GET $b/api/moviebox/poster/<id>?w=700` | `200 image/jpeg` or `200 image/svg+xml` placeholder (unknown id too — never 404) |
| 10 | `GET $b/api/poster/<hash>` | `200 image/jpeg` + immutable 1-year cache; unknown `404` text "Poster not found" |
| 11 | `GET $b/api/movies` / `$b/api/series` | `200 {movies:[],series:[],directories:[],discontinued:true}` / `{series:[],directories:[],discontinued:true}` (intentional shells) |
| 12 | `GET $b/api/movies/<id>/subtitles/online?query=love&year=` | `200 {subtitles:[...]}`; missing query `400 {error:"Title required for search"}`; provider failure `500 {error:"Failed to search subtitles", details}` |
| 13 | `POST …/subtitles/download {"sourceUrl","lang","name"}` | `200 {success:true, vttUrl:"/api/movies/<id>/subtitles/custom/online_<10hex>.vtt", label, name}`; missing sourceUrl `400 {error:"sourceUrl required"}`; failure `500 {error:"Failed to download subtitle", details}` |
| 14 | `POST …/subtitles/upload {"text","filename","label"}` | empty text `400 {error:"Subtitle text required"}`; valid text currently `500` (undefined `movie`, SUB-05) — expected `200 {success,vttUrl,label}` |
| 15 | `GET …/subtitles/custom/<file>.vtt` | `200 text/vtt; charset=utf-8`, CORS `*`, `Cache-Control` 86400; missing `404` text |
| 16 | `POST $b/api/moviebox/refresh` no header | `401 {error:"Unauthorized"}`; with correct `x-admin-key` from local `.env` → `200 {success:true, …}` — **local/scratch only**, never production |
| 17 | `GET $b/api/does-not-exist` / `GET $b/` | API `404 {error:"Endpoint not found"}` when `web/dist` is deployed; HTML instead = missing build (deploy defect); `GET /` serves `index.html` no-store, hashed assets immutable 1 year |
| 18 | Any malformed request | JSON `{error}` (401 wrong key, 400 bad body); no stack trace or secret in responses; >10 MB body → `413` (Express limit, document whether JSON or HTML) |

## 6. Failure injection checklist (scratch instance unless marked)

| Injection | How (safe) | Expected behaviour | Evidence |
|---|---|---|---|
| Upstream MovieBox down | scratch server + firewall/network block of `moviebox.ac`/mirrors, or hosts entry (owner approval) | catalog falls back to cache; search falls back to catalog scan; designed playback error | status codes, `server/server.log` |
| Cold + upstream down | scratch `PORT`+`CACHE_DIR`, block network, boot | health 0; catalog contract defect (`200 null`) recorded; app tries next host | response bodies |
| CDN token expiry | `GET …/stream/<id>?r=1`, wait ~2.5 min TTL, replay | proxy re-resolves on 401/403/410, otherwise passes status through | status, `X-Stream-Resolution` |
| Range past EOF | `Range: bytes=999999999-` | `416` JSON, not `502` | headers |
| APK mismatch | truncated copy on a scratch host only | manifest sha256 changes; install must reject; update surfaces error | sha256 before/after |
| No APK on host | `/api/app/version` on a host without artifacts (verify Render's actual response) | `apkSha256:null`, `fileSize:5501048`; downloads `404` text | JSON |
| Offline/throttle/block | DevTools offline, Slow 3G, request blocking for poster/stream/episodes | designed states per ERR-01…04, DET-02 | screenshots |

## 7. Severity

| Sev | Definition | Examples |
|---|---|---|
| P0 | Down / data-loss / secret exposure / cross-track update | vikyflix.uk unreachable; TV app installed over phone app; key material in a report |
| P1 | Core feature broken for all (or content-policy breach) | playback never starts; catalog empty; excluded region content in UI/search; wrong OTA package |
| P2 | Degraded / bad contract / one device or title | one episode fails; subtitle-upload endpoint 500; cloud update download fails; no Render stream fallback; wrong resolution header |
| P3 | Cosmetic | clipped metadata, wrong toast, misaligned chip; no functional loss |

## 8. Bug report template (hand the row to the production-error role; never edit production files)

```
ID: BUG-<n> | Sev: P0/P1/P2/P3 | Platform: web/Android/TV/cloud | Build: versionCode + dist mtime + server start
Title: one user-visible line
Steps: 1) … 2) … 3) … (minimal repro from a clean state)
Expected: what should happen, contract reference (file:line)
Actual: what happens — status code, JSON body, log line with ISO timestamp, screenshot ref
Environment: local | vikyflix.uk | Render | emulator/device + network condition
Scope: all users / one device / one title; first seen (date+env); always reproducible? Y/N
Evidence: command+output, screenshot file, console/adb excerpt
Register: ERR-<n> row with symptom, root cause, fix, prevention rule
```

## 9. Evidence rules

- No evidence → **Not Tested**, never "Passed"; "looks fine" is not evidence.
- Record exact command, exit code, HTTP status, key JSON excerpt, log line with timestamp, screenshot/video name (`YYYY-MM-DD_<env>_<case-id>_<n>.png`) and build identity (no git repo: `web/dist` mtime + installed `versionCode` + server start time); results from a different build do not count.
- Redact secrets: never paste `.env` values, `ADMIN_KEY`, signing passwords or key material (`web/android/keystore/` is currently inside the repo; `RELEASE_SIGNING.md` says external — treat both as secret and reconcile with the owner), tokens, or unnecessary IPs.
- End every report with an explicit "Not tested / why" list.

## 10. Regression strategy (`docs/error-register.md`)

1. **Before** touching an area, grep the register; read every prevention rule; add its re-test cases to this run.
2. **Coverage map:** playback/stream → PLY-01…07 + API-8; catalog/scraper/policy → CAT-01…05, POL-01…05; subtitles → SUB-01…06; OTA → OTA-01…06; tunnel/cloud → FBK-01…04; TV/Android → TV-01…03. Attach `server/server.log` + platform console.
3. **After a fix:** rerun the prevention case, the affected area and the §3 gate; only then may status move `fixed → verified` (register writes belong to production-error).
4. Every new bug gets a register row **and** at least one new matrix row here; the register currently has no rows — the first real defect starts it.
5. Cadence: risk-based matrix per change; full matrix per release; §3 smoke before any deploy; full fallback pass after any upstream/tunnel/cloudflared change.

## 11. Release sign-off checklist

- [ ] §3 gate green with commands/outputs attached.
- [ ] Phone + TV debug builds installed; package ids/versionCodes verified; release builds only with owner present, signing key location reconciled (`web/android/keystore/` vs external per `RELEASE_SIGNING.md`), no signing material in evidence.
- [ ] Catalog/policy baseline recorded and unchanged (POL-01…05); no excluded content.
- [ ] Playback: start, seek, resume, quality, audio swap, episode stepping pass on web + phone.
- [ ] Subtitles: search, download, upload, serve, persistence pass.
- [ ] OTA: both tracks correct package/path/checksum; no cross-update; update link works with tunnel up.
- [ ] Downloads: all artifact endpoints return the right file and SHA-256.
- [ ] Fallback: Render catalog cold start and PC-off playback verified.
- [ ] Offline/error states, artwork fallback, TV remote + accessibility (44 px, focus ring, aria-labels, reduced motion).
- [ ] Design acceptance: 390/768/1440 layouts, `<Poster>`, one quality chip, `DESIGN_SPEC.md` states; evidence + "Not tested" list + register update done.

## 12. Suspected defects to verify first (source reading only — unexecuted)

1. `POST /api/movies/:id/subtitles/upload` uses an undefined `movie` (`server/index.js:818,827`) → 500 on every valid upload (now tracked in `AGENTS.md` known gaps; fix needs owner approval + an error-register row).
2. Cold catalog + upstream failure can return `200 null` (`server/moviebox.js` `fetchMovieBoxCatalog` returns `null` without throwing) — should be `5xx` JSON.
3. `searchMovieBox` omits region filters (`moviebox.js:1398`; catalog build applies them at `:1144`) — content-policy leak risk, probe POL-04.
4. OTA links are hard-coded to vikyflix.uk, and `versionCode:66 / versionName:"2.9.9"` are duplicated constants (`server/index.js:131-134` and `web/android/app/build.gradle:10-11`): cloud-served updates cannot download with the tunnel down, and the two copies can drift so updates stall.
5. Detail-page audio edition: choosing an alternate edition then Play sets `id:"mb_<editionSubjectId>"` (`web/src/components/MovieDetailsView.jsx:117-129`), but `findMovieBoxItem` (`moviebox.js:1219-1231`) matches only top-level ids/subjectIds, not merged `audioVersions` → likely `404`; verify and file P1/P2 accordingly.

## 13. Out of scope

- Legacy local library (`/api/stream/:id/index.m3u8`, `/api/movies/:id` record, `scanner.js`/`metadata.js`/`sessions.js`) — discontinued, its absence is not a regression; LG webOS source is in `lg-webos/` (packaged to `server/VikyFlix.ipk`) and its `appinfo.json` reuses `uk.vikyflix.tv`, so verify `/download/lg` identity and the package-id conflict before any repackaging; building/installing webOS is out of scope without the owner.
- Play Store publishing, DRM/piracy, payments, iOS (not shipped); pentesting beyond secret-leak/Unauthorized checks; soak/load beyond sanity timing; upstream MovieBox account/geo/billing behaviour.
- Deploys, Render plan changes, key rotation, tunnel edits, content-filter changes — owner decides; QA verifies afterwards.

## 14. Automation roadmap (proposals; each needs owner approval and evidence)

1. **Now:** no automated suite; §3 smoke + this matrix is the gate.
2. **Script:** `scripts/qa-smoke.ps1` asserting status/shape for health, both version tracks, catalog meta, search, downloads, SPA fallback; non-zero exit on failure; no new runtime deps.
3. **UI:** Playwright as a `web/` devDependency (the `DESIGN_SPEC.md` no-new-dependencies rule applies to shipped code — request approval explicitly): catalog → detail → player start, filters, search, error states.
4. **CI:** GitHub Actions once the repo is under git (owner initialises/pushes; do not push without approval) running the §3 gate on PRs and a nightly Render smoke.
5. **Contracts + failure harness:** redacted response fixtures with schema assertions; an env-controlled mirror/outage switch (e.g. a future `MOVIEBOX_MIRRORS`; not present today) to replace hosts-file/firewall hacks and to automate §6, including an OTA sha256/versionCode gate for both tracks.
