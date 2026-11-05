# Developer (implementer)

**Purpose:** make the smallest correct change that satisfies the brief, then prove it. You are the only role that writes production code. `AGENTS.md` golden rules and `web/DESIGN_SPEC.md` are binding. This file documents how the code actually works so you can change it safely.

**Load when:** the orchestrator assigns a feature, bug fix or refactor.
**Inputs (ask before coding if missing):** objective, exact scope (files/areas), constraints, expected evidence.

## 0. Non-negotiables

1. **Content policy:** the catalog filters in `server/moviebox.js` (`isNigerian`, `isFilipino`, `isAnime`, `isAdult`, `isBengali`, `isUrdu`, `isAudiobook`) are a hard constraint. Never widen the catalog; filter/policy changes need the owner's approval and a before/after catalog count.
2. **Secrets:** never read, print or commit `server/.env`, the `ADMIN_KEY` value (the literal fallback in `server/index.js` is not a secret), the keystores in `web/android/keystore/`, or anything in `%USERPROFILE%\.android\`. `web/android/app/build.gradle` embeds signing credentials inline — treat that file as secret too and never quote or edit those values.
3. **UI:** read `web/DESIGN_SPEC.md` first; tokens from `web/src/styles/aurora.css`; content artwork only through `<Poster>`.
4. **Hosts:** resolve the API through `web/src/config.js` (`getApiBase()`/`API_BASE`). The only sanctioned hard-coded hosts are the fallback/OTA probe lists in `App.jsx` (`checkAppUpdate`, `fetchCatalog`) and `AppUpdateModal.jsx` — extend them there, never scatter new URLs.
5. **Ask the owner** before deploys, Render pushes, restarting a live server, deleting media/cache/APKs, rotating keys, changing content filters, or running a signed Android release build.
6. **Leave the environment alone:** `node_modules/`, `server/cache/`, media dirs, `.apk`/`.ipk` artifacts, `web/dist/`, signing material and other roles' `Skills/*.md` are off-limits unless the brief is exactly about them.
7. **Evidence or it didn't happen:** run the checks in `docs/verification.md`; report commands + results; never claim a build/lint/test you did not run.

## 1. Conventions observed in the code

**Server (`server/`, CommonJS, Express 4.21, port 5000)** — `require`/`module.exports`, one app in `server/index.js` (`dotenv` at the top, timestamped console, no TypeScript/build step). Every async handler owns its errors: `try { … } catch (err) { console.error('[Tag] …:', err.message); res.status(500).json({ error: '…', message: err.message }); }`. There is no Express error middleware; an uncaught async error only reaches the `uncaughtException`/`unhandledRejection` loggers and can leave the request hanging.
Error bodies match the nearest sibling: `{ error, message }` for 5xx, `{ error }` for 401/404 (`requireAdmin` returns `{ error: 'Unauthorized' }`), `{ error, details }` in subtitle routes — do not invent a new envelope. Parse input defensively (`String(...)`, `parseInt(x, 10) || fallback`, clamp ranges like the poster `?w`, 400 on missing fields).
Cache headers are deliberate: `public, max-age=31536000, immutable` (hashed assets, poster variants), `public, max-age=604800` (poster originals), `public, max-age=60` (placeholder SVG), `no-cache` (catalog, for ETag/304), `no-cache, no-store, must-revalidate` (`/api/app/version`, `/api/moviebox/catalog/meta`, `/api/movies`, `index.html`), `no-store` (stream proxy), `public, max-age=86400` (custom VTT). Read-only catalog/stream/subtitle endpoints are public; control endpoints use `requireAdmin` (`x-admin-key` header or `?admin=`).
Expensive work is bounded/backgrounded: concurrency-capped queue (`POSTER_VARIANT_MAX = 2`), single-flight flags (`posterWarmRunning`, `isRefreshing`), in-flight dedupe maps (`mbPosterInFlight`), `setTimeout`/`setInterval` with `.catch(() => {})`, `AbortSignal.timeout(...)` on upstreams. Log tags are `[Server]`, `[MovieBox]`, `[Transcoder]`, `[Subtitles]`, `[Cache]`, `[StreamTiming]`; comments explain the incident a guard prevents — keep guard and comment together. Env is read with fallbacks (`PORT`, `ADMIN_KEY`, `CACHE_DIR`, `CACHE_MAX_GB`, `MEDIA_DIRS`, `TRANSCODE_HW`; template `server/.env.example`); never hard-code a secret or a new server host.

**Web (`web/src/`, React 19 + Vite)** — function components + hooks only (one class: `ErrorBoundary` in `main.jsx`); hot cards/rails are `React.memo` (`Poster`, `MovieCard`, `ShelfRow`, `HeroBillboard`, `HomeSeriesCard`). State lives in `App.jsx` (tabs, `onlineTitles`, watchlist, `activePlayingMovie`, modal flags) and flows down as props with `on*` callbacks; no router, no store. Persistence is localStorage + IndexedDB (`vickyflix_theme`, `vickyflix_watchlist`, `vickyflix_watch_progress`, `vickyflix_view_mode`, `vickyflix_server_url`, `vikyflix_cached_catalog_v2`, `vikyflix_cached_catalog_synced_at`; IndexedDB `movieflix-catalog-db`/`catalog`) — guard every storage call.
Data fetching uses `API_BASE` plus `AbortController` + explicit timeout, `cache: 'no-store'`/`'no-cache'` like siblings, and fallback chains that never downgrade an older `fetchedAt`. Imports order: react hooks, `lucide-react` icons, local components/utils, then the area stylesheet (`import '../styles/home.css';`). Icons use `size`/`fill` props.
CSS uses design tokens and shared primitives only (`.vf-btn`, `.vf-chip`, `.vf-surface`, `.vf-enter`, `.vf-stagger`); new CSS goes in a new per-area file `web/src/styles/<area>.css` imported by the owning component, class-prefixed per area (`.cat-`, `.det-`, `.ply-`, `.home-`). Never append to the 7k-line `web/src/App.css`; never edit `web/src/styles/aurora.css` (lead-owned). Theme is `document.documentElement[data-theme]` + `body.theme-*` (set in `App.jsx`); TV mode is `html.tv-mode` from `useTvNavigation()` in `tv.js` — new interactive cards must be D-pad reachable (add to `FOCUSABLE` if not a button/link).
Dependencies: no new dependency without approval (`DESIGN_SPEC.md` §6). Server: express, cors, compression, dotenv, axios + adm-zip (subtitles only); `fluent-ffmpeg` is declared but unused (code spawns `ffmpeg` directly). Web: react 19, hls.js, lucide-react, Capacitor plugins. Lockfiles are committed (`web/package-lock.json`, `server/package-lock.json`) — use `npm ci`. Lint is `oxlint` (`web/.oxlintrc.json`: `react/rules-of-hooks` = error, `react/only-export-components` = warn). There is no test script.

## 2. Per-area implementation guides

### 2.1 Add or change an API route — `server/index.js`

1. Read neighbouring routes; put the new one in the same family (catalog `/api/moviebox/*`, subtitles `/api/movies/:id/subtitles/*`).
2. Register it **above** `if (fs.existsSync(WEB_DIST))` (SPA fallback). Below it the path is swallowed, and unknown `/api/*` returns `{ error: 'Endpoint not found' }` 404.
3. Preserve order: the `/api/stream` CORS middleware stays above stream routes; `/api/poster/:hash` (legacy) is not `/api/moviebox/poster/:id`.
4. Read-only → no admin; mutating/expensive → `requireAdmin`. Reuse helpers already imported from `./moviebox`, `./transcoder`, `./subtitles`.
5. Pick the cache header from §1, match the sibling response shape, log the tag + message and return `{ error, message }` on failure.
6. If it becomes a permanent contract, add a row to `docs/verification.md`.

### 2.2 Scraper / BFF — `server/moviebox.js`

- All upstream calls go through `bffFetch(url, options, host)`: spoofed browser headers (`baseHeaders`), the `x-user`/cookie session from `getSession()` (2h cache), 12s timeout. Never call MovieBox from a route directly.
- Hosts: `siteOrigin()` probes `server/moviebox_hosts.json` (array or `_mirrors`) else `DEFAULT_MIRRORS` via `/wefeed-h5api-bff/country-code`; `resolveMovieBoxStream` races `PLAY_HOST` + fallbacks.
- `mapItem()` is the client contract: `id: mb_<subjectId>`, `poster: /api/moviebox/poster/<id>`, `detailPath`, `audioVersions`, `formattedDuration`, `addedAt`, `subjectType`/`isSeries`. Field changes reach every consumer.
- Catalog state is one in-memory object `{ source, fetchedAt, total, banners, categories, movies }` persisted to `server/cache/moviebox_cache.json`; routes read it via `getMovieBoxCatalogSnapshot()`/`getMovieBoxCatalogMeta()`.
- Sync entry points (single-flight, merged by `subjectId`, then `mergeDubVersions()`): `refreshLatestReleases(pages)` (popularity pages + SSR `/web/movie` and `/web/tv-series` scrapes through `scrapeListingPage`/`__NUXT_DATA__`), `refreshLatestFeed(pages)` (recently-added ordering), `enrichEditionSweep()`/`enrichCardEditions()` (dubs discovery).
- Keep the no-op guard: when nothing new/updated the refresh returns before writing the cache, so bytes stay identical and clients get a 304. Writing every cycle makes devices re-download the catalog.
- Filters run at scrape/write time and again in the client (§2.6) — do not log or bypass them. Not live protection: `buildCatalog()` is defined but neither exported nor called, `CACHE_TTL_MS` is unused, and `rebuild-catalog.js` calls `fetchMovieBoxCatalog(true)` (→ `refreshLatestReleases(12)`), not `buildCatalog`; `node server/rebuild-catalog.js` is the one-off repair path (prints `REBUILT_CATALOG_COUNT=<n>`).
- Background timers live in `server/index.js`: boot +3s; 20 min latest releases(15) and feed(5); 6h deep harvest(40); 5 min edition sweep(400 cards / 240s budget); poster warm +15s/20min; prune every 10 min. New timers need a `[Tag]` log and a catch.

### 2.3 Cache, posters, transcode — `server/index.js` + `server/transcoder.js`

- Poster flow: `/api/moviebox/poster/:id?w=700` → `findMovieBoxItem` → md5(remoteUrl)[:20] → `server/cache/posters/mb_<hash>_w<w>.jpg` if present, else the original, else a designed SVG placeholder (200, `max-age=60`). Missing originals are filled by `warmMovieBoxPosters()` (boot +15s, every 20 min, 8 workers, 30ms gap, 20s timeout, rejects <1KB); the inline `ensureOriginal` closure in that handler is never called — don't assume a first request warms anything.
- Variants: `queuePosterVariant(src, out, width)` → `drainPosterVariants()` (max 2 concurrent `ffmpeg -vf scale=<w>:-2:flags=lanczos -q:v 4`, deduped by `outFile`, skipped if output exists). Keep generation async — inline ffmpeg on a 30-card grid caused request timeouts. `?w` is clamped 120–1600; variants are year-cached `immutable`, originals 7 days, placeholders 60s.
- Changing proxy/cache semantics requires bumping `POSTER_CACHE_VERSION` in `web/src/utils/mediaUtils.js` (adds `pv=`).
- Pruning: `pruneCache(CACHE_DIR, CACHE_MAX_BYTES)` on boot and every 10 min, LRU by newest file, skips active transcodes, protects `posters/subtitles/metadata/data`; `CACHE_MAX_GB` default 2. Never commit `server/cache/` or point `CACHE_DIR` at a synced folder.
- `server/transcoder.js` exports `startHlsTranscode`, `stopMovieTranscodes`, `touchMovieTranscode`, `generateLocalThumbnail`, `extractSubtitleTrack`, but `server/index.js` imports only `pruneCache` today: treat the rest as dormant local-library code (don't delete, don't claim wired).

### 2.4 HLS proxy and stream proxy

- Production playback uses the MovieBox **MP4 proxy**, not HLS: `GET /api/moviebox/stream/:id` resolves via `resolveMovieBoxStream` (2.5 min cache, 90s failure cache, 360/480/720/1080 ladder, `?audio=` edition, `?se=&ep=` episode, `?res=`, `?r=1` invalidate), forwards `Range`, re-resolves once on 401/403/410, answers 416 for past-EOF ranges, pipes with `Readable.fromWeb`, destroys on `req.on('close')`, sends `Cache-Control: no-store` + `X-Stream-Resolution`. `app.options` + the `/api/stream` CORS middleware exist for native WebViews.
- The old local HLS route is gone: no `/api/stream/:id/index.m3u8`, segment or `/stop` route exists (only the CORS middleware and a stale comment). `VideoPlayer.jsx` still builds those URLs for non-online items and `mediaUtils` points at `/api/movies/:id/thumbnail`; both are legacy paths that 404 today — do not wire the client to a missing route.
- If a brief really is to revive local HLS: `startHlsTranscode` writes `<CACHE_DIR>/<movie.id>/<audio>_<quality>[_start_N]/index.m3u8` + `.ts` (`hls_playlist_type event`, 3s), `touchMovieTranscode` is the keepalive, `stopMovieTranscodes` handles unmount; you then need routes serving the playlist as `application/vnd.apple.mpegurl`, segments as `video/mp2t`, `no-store`, plus the CORS middleware. Ask the owner first — local library is discontinued.
- Never expose the resolved upstream URL to clients; the proxy exists because the CDN has no CORS and is blocked on many mobile ISPs.

### 2.5 Subtitle pipeline

- `server/subtitles.js`: `searchOnlineSubtitles(title, year)` (IMDb suggestion → yts-subs table), `downloadAndConvertSubtitle(sourceUrl, targetVttPath)` (page → base64 `data-link`/zip → `adm-zip` → first `.srt`/`.vtt` → `srtToVtt`), `srtToVtt`.
- Routes in `server/index.js`: `GET /api/movies/:id/subtitles/online?query=&year=` → `{ subtitles: [{ id, lang, name, sourceUrl }] }`; `POST .../download { sourceUrl, lang, name }` → `{ success, vttUrl, label, name }` storing `server/cache/<id>/online_<md5[:10]>.vtt`; `POST .../upload { text, filename, label }`; `GET .../custom/:filename` serves `text/vtt; charset=utf-8`, `max-age=86400`, CORS. Public client features (no `requireAdmin`) — validate input, keep the 400 shapes.
- Client: `VideoPlayer.jsx` searches/downloads and can parse a VTT locally; `web/src/subtitleStore.js` persists VTT text in localStorage per title (`movieflix_subs_<id>[_s<se>e<ep>]`, 180-day retention, quota eviction) and revives blob URLs.
- Landmine: the upload handler currently uses `movie.id` (undefined) and returns 500 — when touching it use `req.params.id`; don't silently fix it in an unrelated brief, report it.

### 2.6 Frontend component / state / style

- New component: read `DESIGN_SPEC.md` and the nearest sibling; function component, destructured props, `export default React.memo(...)` for rail/grid cards. Use `<Poster>` for artwork, `.vf-btn`/`.vf-chip`/`.vf-surface` for controls, and design loading/empty/error/offline states instead of blank divs.
- State placement: transient UI local; shared catalog/selection/player state in `App.jsx`, passed down. Don't refetch the catalog in a child — reuse the memoized arrays `allCatalogMovies`, `allCatalogSeries`, `unifiedCatalog`.
- New CSS: create `web/src/styles/<area>.css`, import it from the owning component, prefix classes, tokens only; override legacy rules from there rather than editing `App.css`/`aurora.css`.
- Client filtering is duplicated: `server/moviebox.js` (authoritative), `web/src/onlineLibrary.js` (`isExcludedOnline`/`decorateOnlineMovie`) and `App.jsx` (`_isExcludedItemImpl`/`__foreignTitle`). Policy changes must be owner-approved, applied to all three, then re-checked with catalog counts.
- Accessibility/TV: keyboard reachable, visible `:focus-visible`, `aria-label` on icon-only buttons, 44px targets, reduced motion respected; no hover-only path may be the only way to play/open on TV.

### 2.7 Player — `web/src/VideoPlayer.jsx`

- `getStreamUrl()` has two branches: online → native bridge `http://127.0.0.1:<port>/play?…` when `AndroidStreamBridge.getPort()` exists, else `${API_BASE}/api/moviebox/stream/<id>?audio=&se=&ep=&res=`; local → `${API_BASE}/api/stream/<id>/index.m3u8?audioIndex=&quality=&start=` (legacy, §2.4).
- Playback: direct MP4 → native `<video>`; m3u8 → `hls.js` when supported, native HLS on Safari. HLS is destroyed on cleanup; unmount beacons `/stop` and writes `vickyflix_watch_progress` (skipped when >95% watched).
- Seeking: `streamStart` is the absolute offset the local transcoded timeline begins at (online MP4 uses `video.currentTime`). Online quality menu is 360/480/720/1080, local is auto/4K/1080/720/480. Audio edition switch sets `?audio=` and resumes via `audioResumeRef`.
- Native bridges (guard each in try/catch): `StatusBar`, `ScreenOrientation` landscape lock, `AndroidFullscreen.enterImmersive/exitImmersive`, `AndroidStreamBridge`. Add UI through existing HUD/toast/menu components, not a parallel overlay system.

### 2.8 OTA manifest and downloads — `server/index.js`

- `GET /api/app/version[?platform=tv]` → `{ versionCode, versionName, packageName, apkUrl, apkSha256, fileSize, releaseDate, releaseNotes }`. Mobile default: `uk.vikyflix.app`, `https://vikyflix.uk/download`; `?platform=tv`: `uk.vikyflix.tv`, `https://vikyflix.uk/download/tv`. The handler stats/hashes the APK on every request; a missing APK still returns fallback `fileSize: 5501048` and `apkSha256: null`.
- Download routes: `/download` (aliases `/download/app`, `/movieflix.apk`, `/vikyflix.apk`) serves root `MovieFlix.apk` then `server/MovieFlix.apk`; `/download/tv` serves `MovieFlixTV.apk`/`MovieFlixTv.apk` from root then `server/`; `/download/share` serves `MovieFlix-Share.apk`; `/download/lg` serves **`server/VikyFlix.ipk` only** (a root-level IPK is not served).
- Client flow: `App.jsx` `checkAppUpdate()` probes `API_BASE`, then `https://vikyflix.uk`, then Render with `t=` and `platform=tv|mobile`, comparing against `CapApp.getInfo().build`/`AndroidStreamBridge.getAppVersionCode()`. `AppUpdateModal.jsx` rejects any `apkUrl` that is not `https://vikyflix.uk` + exactly `/download` or `/download/tv`, re-reads the manifest sha at tap time, verifies bytes natively, falls back to `Browser.open`.
- Keep tracks separate: `uk.vikyflix.tv` must never cross-update `uk.vikyflix.app` (or vice versa).

## 3. File-ownership map

| Area | Primary files | Rule |
|---|---|---|
| API shell | `server/index.js` | routes, middleware, cache headers, OTA/download; SPA fallback stays last |
| Upstream/catalog | `server/moviebox.js` | BFF + filters; filter/policy edits need owner approval |
| Subtitles (server) | `server/subtitles.js` + handlers in `server/index.js` | keep public-route validation and response shapes |
| Cache/transcode | `server/transcoder.js`, poster queue in `server/index.js` | dormant exports stay; pruning stays bounded |
| Web shell | `web/src/App.jsx` | owns state/sync/update checks; avoid reformatting |
| Shared primitives | `web/src/components/Poster.jsx` | every screen uses it; changes are global |
| Cards/rails | `MovieCard`, `ShelfRow`, `HeroBillboard`, view components | `React.memo`, tokens, `<Poster>` |
| Player | `web/src/VideoPlayer.jsx` | stream URL contracts, HLS config, resume/subtitles |
| Client catalog | `web/src/onlineLibrary.js`, `web/src/utils/mediaUtils.js` | decorations + poster version; filter duplication (§2.6) |
| Config/hosts | `web/src/config.js` | `getApiBase()`/`IS_NATIVE_APP`; no hosts elsewhere |
| Styles | `web/src/styles/*.css` | tokens; not `aurora.css` (lead), not appending to `App.css` |
| TV | `web/src/tv.js` | D-pad navigation; keep `FOCUSABLE` in sync |
| Android | `web/android/**`, `RELEASE_SIGNING.md`, `sign-release.ps1` | owner-approved release builds only |
| Docs | `docs/verification.md`, `docs/error-register.md` | append evidence/prevention rows; don't rewrite history |

## 4. Safe-change checklist

- [ ] Read `AGENTS.md`, this file and the brief; confirm scope/files; check `git status` if the repo is under version control (today it has no history — take a file copy before a risky edit instead of assuming rollback).
- [ ] Search `docs/error-register.md` for the area; re-test related prevention cases.
- [ ] Read every file you will touch plus its immediate imports/callers; for UI read `web/DESIGN_SPEC.md` and the `aurora.css` token block first.
- [ ] State intent in one message (files, approach, risk). Playback/stream proxy/content filters/OTA/deploy changes need the owner's go-ahead.
- [ ] Minimal diff, matching style; no unrelated formatting, no new dependency, no new hard-coded host, no secret, no catalog-policy drift.
- [ ] Server: `node --check` every changed `server/*.js`; start locally; smoke the affected endpoints including 401/404/error cases and cache headers.
- [ ] Web: `cd web; npm run lint; npm run build`; run the UI matrix (390 / 768 / 1440 px, loading/empty/error/offline, reduced motion, TV focus if touched).
- [ ] Evidence recorded (commands, exit codes, key output/observations); report files, risks, untested areas per the handoff contract in `Skills/README.md`.
- [ ] Update `docs/verification.md` for a changed contract; append an `error-register` entry if you fixed a bug.

## 5. Version bump, OTA release and Android/TV builds

**Exact version-bump locations (keep both identical):**

1. `web/android/app/build.gradle` → `defaultConfig { versionCode 66; versionName "2.9.9" }` — the APK's real identity.
2. `server/index.js` → `app.get('/api/app/version', …)` → `versionCode: 66, versionName: '2.9.9'` — the OTA manifest clients compare against and the number that triggers the update prompt.

Also update that track's `releaseNotes` (same handler) in the same edit; change `apkUrl` only if the download path changes (the modal hard-validates it).

**Build + release (owner present; never unattended):**

```powershell
cd web
npm run build
npx cap sync android
cd android
./gradlew clean :app:assembleMobileRelease :app:assembleTvRelease
powershell -ExecutionPolicy Bypass -File .\sign-release.ps1
```

1. Use the signed outputs in `web/android/app/build/outputs/apk/{mobile,tv}/release/` (`app-mobile-release.apk`, `app-tv-release.apk`) — never `*-unsigned.apk` or debug builds; verify the signature rather than assuming a filename.
2. Stage at the repo root: `MovieFlix.apk` (mobile), `MovieFlixTV.apk` (TV), `MovieFlix-Share.apk` (share track — `REQUEST_INSTALL_PACKAGES` is stripped by `web/android/app/src/share/AndroidManifest.xml`). The download routes also fall back to copies in `server/`.
3. After an owner-approved server restart (only if API code changed), verify `curl.exe -s http://localhost:5000/api/app/version`, `.../api/app/version?platform=tv`, `/download`, `/download/tv`, `/download/share`, and that each track returns its own `packageName`, `versionCode`, `apkSha256`.
4. Signing is split and partly committed: Gradle's `signingConfigs.movieflix` points at `web/android/keystore/movieflix-release.keystore` and embeds the store/key passwords inline (never quote or edit those values), while `sign-release.ps1` re-signs `*-unsigned.apk` with the rotated key from `%USERPROFILE%\.android\`; reconcile the two stories with the owner. Inspect the output directory after a build; never replace signing material without the owner.
5. Do not deploy, push to Render or restart production yourself — report what changed and the evidence.

### 5.1 One change → three platforms (what actually reflects where)

One React codebase feeds every surface, but nothing becomes live until each
target is rebuilt. A `web/src` edit is not visible on the website, the APK or the
TV app until you do the matching step:

| Surface | Needs | Command | Users see it after |
|---|---|---|---|
| Website (PC / `vikyflix.uk`) | build | `cd web; npm run build` → Express serves `web/dist` | page refresh |
| Website (Render fallback) | build + deploy | same build, owner-approved Render redeploy | deploy finishes |
| Android phone APK | rebuild APK | `npm run build` → `npx cap sync android` → `cd android; .\gradlew.bat :app:assembleMobileRelease` → sign → replace `MovieFlix.apk` + bump `versionCode` in **both** places (§5) | install / OTA update |
| Android TV APK | rebuild TV flavor | same with `:app:assembleTvRelease` → replace `MovieFlixTV.apk` + bump version | install / OTA update |
| LG webOS | nothing in repo | `.ipk` is a redirect shell to `vikyflix.uk` | follows the website |

Rules:

- `cap sync` alone does **not** rebuild the APK, and `npm run build` alone does
  **not** update an installed app — an OTA release needs the version bump and the
  new artifact (see §5).
- Test the changed surfaces on the emulator/device: `scripts\android-emulator.ps1
  -Action test [-Flavor tv]` from a **normal PowerShell window** (not the sandbox).
- Responsive browser checks do not replace an APK build; the tester's matrix still
  applies to each surface.

## 6. Common pitfalls

1. **SPA fallback order:** a route added after `if (fs.existsSync(WEB_DIST))` is unreachable; unknown `/api/*` returns `{ error: 'Endpoint not found' }`.
2. **Stream proxy contract:** keep `Range` forwarding, 416 handling, the one-shot re-resolve on 401/403/410, `no-store`, and the `req.on('close')` teardown — removing any breaks seeking/reconnect on devices.
3. **Poster semantics:** a first request may legitimately serve a placeholder SVG (`max-age=60`); the warmer fills the cache. Bump `POSTER_CACHE_VERSION` in `mediaUtils.js` when proxy semantics change, not to "force" a refresh.
4. **Catalog sync:** clients re-download only when `fetchedAt` changes and never downgrade older data; keep no-op refreshes byte-identical.
5. **Filter duplication:** server + `onlineLibrary.js` + `App.jsx` all filter; change one and the catalog looks inconsistent. Policy changes need approval.
6. **`ADMIN_KEY` fallback:** the literal in `server/index.js` is a development default; production must set it. New control endpoints need `requireAdmin`.
7. **OTA:** the manifest reads+hashes the whole APK per request and returns a fallback `fileSize` with `apkSha256: null` when the file is missing; verify both tracks and the actual download after staging.
8. **`/download/lg`** serves only `server/VikyFlix.ipk`; copying the IPK to the repo root does not make it downloadable. LG source is `lg-webos/` (`appinfo.json` currently reuses `uk.vikyflix.tv` — verify before repackaging).
9. **Express 4:** async throws are not forwarded to an error handler — wrap every handler in try/catch; `uncaughtException` logging does not rescue the request.
10. **Known latent bugs (verified, unfixed):** subtitle upload uses undefined `movie.id` (500); the `App.jsx` error-retry button calls undefined `fetchAdminStats`; `/api/moviebox/search` skips the regional filters (the web UI hides this by searching the already-filtered catalog client-side); `buildCatalog()`/`CACHE_TTL_MS`/`fluent-ffmpeg` are unused; `web/android/app/build.gradle` embeds signing credentials inline and pins the keystore inside the repo while `RELEASE_SIGNING.md` documents an external key. Report these; fix only if the brief covers it.
11. **Dev setup:** Vite has no proxy — `config.js` sends dev requests directly to `http://<host>:5000`, which works because the server sets `cors({ origin: '*' })`. Don't add a second API base.
12. **`web/dist/` is generated:** never hand-edit; Express serves it when present, so a stale build masks frontend changes until `npm run build`.

## 7. Worked examples

### Example A — add an endpoint (hypothetical brief: "expose newest titles as JSON")

Read the neighbouring catalog routes; `getMovieBoxCatalogSnapshot` is already imported at the top of `server/index.js`.

```js
// server/index.js — with the other /api/moviebox routes, before the SPA fallback
app.get('/api/moviebox/latest', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    // The snapshot is stored recency-sorted (sortCatalogByRecency).
    const results = (getMovieBoxCatalogSnapshot() || []).slice(0, limit).map(m => ({
      id: m.id, title: m.title, year: m.year, poster: m.poster, addedAt: m.addedAt
    }));
    res.json({ total: results.length, results });
  } catch (err) {
    console.error('[MovieBox] Latest feed error:', err.message);
    res.status(500).json({ error: 'Latest feed failed', message: err.message });
  }
});
```

Verify: `node --check server/index.js`; restart locally; `curl.exe -s "http://localhost:5000/api/moviebox/latest?limit=3"` (JSON, 200) and `curl.exe -s -o NUL -w "%{http_code}`n" "http://localhost:5000/api/moviebox/latest"` (200). Add the row to `docs/verification.md` if permanent; report the observed body/status, never "should work".

### Example B — change a UI component (brief: "show runtime on catalog cards")

Read `DESIGN_SPEC.md` §4 (metadata year · genre · runtime on ONE line) and `server/moviebox.js` `mapItem()` (`formattedDuration` is a display string; raw `duration` is seconds).

```jsx
// web/src/components/MovieCard.jsx
import '../styles/card.css';
// …
const runtime = typeof movie.formattedDuration === 'string' ? movie.formattedDuration : '';
const metaSubtitle = [year, genres[0] || (isSeries ? 'Series' : 'Movie'), runtime]
  .filter(Boolean)
  .join(' • ');
```

```css
/* web/src/styles/card.css — new area file (DESIGN_SPEC.md §6) */
.cine-card-meta .cine-card-year {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

Never print raw `duration` as minutes. `.cine-card-meta` already exists in `App.css`, so the one-line guard is an override in the new area file rather than an append to `App.css`. Verify with `cd web; npm run lint; npm run build`, then run Vite + server and check home rails + catalog grid at 390 / 768 / 1440 px: meta stays one line, titles still ellipsize, poster/fallback and D-pad focus unchanged. Record the widths checked and command results; state explicitly what you could not run.
