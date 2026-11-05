# Project domain — MovieFlix / VikyFlix

**Purpose:** verified product, platform, API and deployment facts; no procedures (those are in role files).
**Load when:** planning, coding, testing, or answering "how does this app work?". **Convention:** `file:line` refs are current; `(verify)` marks what the repo cannot prove. Copy shapes from here — never invent them.

## 1. Product definition

- A **personal** streaming service: one React 19 SPA (`web/`) + one Express API (`server/`) that scrapes/BFF-proxies the **MovieBox** catalog, resolves streams, serves artwork/subtitles and ships Android OTA updates.
- Branding: website + LG TV = **VikyFlix** (`vikyflix.uk`); Android apps = **MovieFlix**.
- No viewer accounts, payments or auth — only control endpoints are key-gated. Curation *is* the product; the catalog is deliberately small.
- The old local-file library is **discontinued**: `/api/movies` + `/api/series` return empty shells with `discontinued: true` (`index.js:254-261`). Don't "fix" them.
- No media is stored server-side — only caches (posters, catalog snapshot JSON, subtitle VTTs). Surfaces: website, Android phone, Android TV, LG webOS, plus a permission-free "share" APK.

## 2. Content policy — HARD constraint, never widened

Excluded: **adult/erotic, audiobooks/podcasts/DJ mixes, all animation + anime (western included), and "other-region" titles** (Filipino/Tagalog, Nigerian/African, Bengali, Urdu/Pakistani, Indonesian, Punjabi, Marathi). Implemented in `server/moviebox.js`:

| Filter | Lines | Excludes |
|---|---|---|
| `isAudiobook` | 824-827 | audiobook / erotic audio / dj mix / podcast genres |
| `isAdult` | 829-832 | `adult`, `erotic` genres |
| `isFilipino` | 838-848 (+`filipinoTitleScore` 51-62, regexes 47-49) | country PH/Filipino/Tagalog; keywords philippines/filipino/tagalog/pinoy/vivaone/**vivamax**/teleserye; Tagalog grammar score (1 strong or ≥2 distinct weak markers) |
| `isBengali` | 850-863 | bengali/bangla words; Unicode U+0980–U+09FF; country Bangladesh |
| `isUrdu` | 865-877 | `urdu` word; country Pakistan unless "india" in title (its audio-tag branch just returns false) |
| `isNigerian` = `isExcludedForeign` | 879-908 | ~25 African countries (Nigeria/Ghana/Kenya/South Africa…), **plus Indonesia and Philippines**; keywords nollywood/yoruba/igbo/hausa/naija/african movie/punjabi/marathi/indonesian; Gurmukhi U+0A00–U+0A7F. The broad catch-all region filter |
| `isAnime` | 952-979 (+regexes 916-950) | **any `animation` genre**, title-franchise list (doraemon/tom & jerry/ben 10/avatar TLA…), explicit anime genre, Japan animation, named anime/donghua franchises |

Enforcement sites (every ingest path). Note `mergeDubVersions`/`normalizeDubKey`/`parseAudioLabel` (479-502, 981-1101) are **not** filters — they collapse language-dub editions into `audioVersions` so a Punjabi *dub* never deletes the Hindi film (comment 902-903):

| Site | Lines | Path |
|---|---|---|
| Boot purge of persisted catalog | 73-142 | animation/anime genre+title list, Filipino, Nigerian, artless-and-undated junk |
| Latest releases + SSR scrape | 630-663 | filter API pages, then `/web/movie` + `/web/tv-series` scrape, 7-filter gate; requires real artwork |
| Latest-feed sync | 535-540 | `refreshLatestFeed` (source "recently added" order) |
| Full rebuild | 1142-1148 | `buildCatalog`, channels 1/2 × up to 170 pages |
| Search | 1392-1399 | only `isAudiobook`/`isAnime`/`isAdult` — regional filters missing ⇒ §11.3 |
| Client display (2nd layer) | `web/src/App.jsx:794-851` | `_isExcludedItemImpl` + `__foreignTitle` on every online title; also drops unrated `0.0` and no-country-unrated |

Rules: (1) widening = product-policy change → owner; (2) the server and client filters are **separate implementations** — change both; (3) after touching filters compare counts and re-check excluded categories (`docs/error-register.md`); (4) exported filters are only `isBengali`, `isUrdu`, `isNigerian` (+`__debug`) — `isFilipino`/`isAnime`/`isAdult` stay internal (`moviebox.js:1570-1591`).

## 3. Platform matrix

| Surface | Identity | Build / delivery | API base | Playback |
|---|---|---|---|---|
| Website | `vikyflix.uk` (`www` in bat echo) | Vite → `web/dist`, Express serves SPA (`index.js:852-862`) | `config.js` rule 4: `location.origin` | Browser → `GET /api/moviebox/stream/:id` on the PC |
| Android phone | `uk.vikyflix.app` "MovieFlix" | Capacitor `appId` (`web/capacitor.config.json`), Gradle namespace+applicationId, flavor `mobile`; `versionCode 66`/`2.9.9`; `app-mobile-release.apk` → `MovieFlix.apk` → `/download` | rule 2: native default `https://vikyflix.uk` | **On-device** `LocalStreamServer` (`127.0.0.1:8844-8848`) via `AndroidStreamBridge`; server proxy = fallback |
| Android TV | `uk.vikyflix.tv` "MovieFlix TV" | Same project, flavor `tv`, assets `src/tv/assets` (config appId `uk.vikyflix.tv`); `app-tv-release.apk` → `MovieFlixTV.apk` → `/download/tv` | same rule 2 | same on-device bridge; `IS_TV` (`web/src/tv.js:20-27`: `?tv=1`, UA `MovieFlixTV`/Bravia/AFT/FireTV/Chromecast/Android TV/CrKey) enables D-pad nav |
| LG webOS | `appinfo.json` id **`uk.vikyflix.tv`** (duplicate of TV package — verify intent), v1.0.0, 1920×1080 | `lg-webos/` sources (appinfo + redirect shell + icons) → packaged `server/VikyFlix.ipk` → `/download/lg` | shell redirects to `https://vikyflix.uk` | website path (PC proxy) |
| Share APK | phone app minus `REQUEST_INSTALL_PACKAGES` | Gradle buildType `share` (initWith debug); `MovieFlix-Share.apk` → `/download/share` | as phone | as phone; OTA falls back to browser |

- OTA track is client-selected `platform=tv|mobile` (`App.jsx:510-518`); manifest is re-read at download time (checksum refresh, `AppUpdateModal.jsx:24-58`). The two Android apps are **separate installs, never cross-update** (`index.js:113-142`) and can coexist (`build.gradle:19-37`).
- JS bridge (`MainActivity.java:202-303`): `getPort`, `resolveStream`, `fetchEpisodes`, `getProxyUrl`, `startApkUpdate`, `getApkUpdateState`, `canInstallApks`, `getAppVersionCode/Name`; plus `AndroidFullscreen`. `LocalStreamServer` routes: `/play`, `/stream?url=`, `/resolve`, `/episodes`.
- Launch intro: `web/index.html` inline "The Premiere" animation is **app-only** (native WebView or `?app=1`, `:196-210`) — the website removes it; it holds ≥2.95 s and is dismissed by the `movieflix-ready` event or an 8 s hard cap.
- `web/src/config.js` base tiers: localStorage `vickyflix_server_url` → native default `https://vikyflix.uk` → dev port 5173 ⇒ `:5000` → same origin.

## 4. Feature inventory

| Area | Verified behavior |
|---|---|
| Home | Continue Watching (localStorage), **rolling Top 10** (45-day window, rating→recency, `App.jsx:1049-1083`), New Releases (added within 7 days, `:1085-1098`), Action, South Cinema (Indian-origin Tamil/Telugu/Malayalam/Kannada), Sci-Fi, Thriller |
| Navigation | Home, All Movies, Web Series, Genres, Languages, My List (`App.jsx:1280-1756`); genre filters Action/Sci-Fi/Thriller/Comedy/Drama/Horror/Romance/Crime/Fantasy; language hubs Tamil/Telugu/English/Hindi/Malayalam/Kannada/Korean |
| Detail/player | Movie + series views, seasons/episodes, audio-version and subtitle pickers, watchlist, resume; `hls.js` + native `<video>`; MovieBox = upstream-content-type proxy with `?audio=&se=&ep=&res=` (360/480/720/1080) |
| Subtitles | Online search (IMDb suggestion → yts-subs), download + SRT→VTT, upload, custom VTT serve; client also keeps text locally |
| Catalog sync | IndexedDB/localStorage snapshot → `catalog/meta` probe → 3-tier fetch (`App.jsx:686-692`); re-sync on focus and every 10 min (`:779-783`); search is client-side (Ctrl/⌘+K) |
| OTA/downloads | Version manifest, native APK download + SHA-256 verify + Android installer, browser fallback, share build, APK/IPK/promo endpoints |

## 5. Complete API reference

Express on `PORT` (default 5000), binds `0.0.0.0` (`index.js:872-874`); timestamped console logs (`:20-25`). Global: `compression()`, `cors({origin:'*'})`, `express.json({limit:'10mb'})`. **23 handlers / 30 paths.**

| Method | Path | Auth | Purpose / behavior | Cache | Codes |
|---|---|---|---|---|---|
| GET | `/api/health` | – | `{status:'ok', mode:'cloud-stremio', onlineMoviesCount}` (count = in-memory catalog) | – | 200 |
| GET | `/api/moviebox/catalog/meta` | – | `{total, fetchedAt}` freshness probe | `no-cache,no-store,must-revalidate` | 200 |
| GET | `/api/moviebox/catalog` | – | `{source,fetchedAt,total,banners[],categories{},movies[]}`; `?refresh=1`/`?force=true` runs `refreshLatestReleases(12)` first | `no-cache` (ETag → 304) | 200/304/500 |
| GET | `/api/moviebox/search?q=`/`?keyword=` | – | `{query,total,results[]}`; upstream search `perPage 40` + audiobook/anime/adult filter + dub merge; falls back to substring over local catalog | – | 200/500 |
| POST | `/api/moviebox/refresh` | **admin** `x-admin-key` header or `?admin=` | `pages` (query/body, default 12) → `refreshLatestReleases(pages)`; `{success:true, ...result}` (result may be `false`) | – | 200/401/500 |
| GET | `/api/moviebox/detail/:id` | – | `{movie}`; id may be `mb_*`, subjectId or detailPath | – | 200/404/500 |
| GET | `/api/moviebox/episodes/:id` | – | `{seasons:[{se,maxEp}]}` (`?audio=<subjectId>` picks edition); non-series → `{seasons:[]}`; 2 attempts, 700 ms backoff | – | 200/404/500 |

| Method | Path (artwork) | Notes | Headers |
|---|---|---|---|
| GET | `/api/moviebox/poster/:id` | `?w=120..1600` variant (ffmpeg, async queue max 2); caches `posters/mb_<md5[0:20]>.jpg`, 2 retries; always returns an image — 600×900 SVG placeholder on failure | variant `public,max-age=31536000,immutable`; original `max-age=604800`; placeholder `max-age=60` |
| GET | `/api/moviebox/backdrop/:id` | backdrop → poster fallback, `mb_bd_<hash>.jpg` | `public,max-age=604800` |
| GET | `/api/poster/:hash` | legacy local-poster reader (hex-sanitized); 404 text | `public,max-age=31536000,immutable` |

**Streaming**

| Method | Path | Behavior |
|---|---|---|
| OPTIONS | `/api/moviebox/stream/:id` | preflight 200 + `ACAO:*` (GET/OPTIONS/HEAD) |
| GET/HEAD | `/api/moviebox/stream/:id` | resolve → pipe. `audio=<subjectId>`, `se`,`ep` (series default 1/1; `se=0&ep=0` has no resource), `res=360/480/720/1080`, `r`/`refresh` clears resolve cache. Range forwarded both ways; 416 passthrough as 416 JSON; 401/403/410 → invalidate + re-resolve once else 502; 5xx→502; other 4xx passthrough. Sets `ACAO:*`, `Accept-Ranges`, upstream `Content-Type`/`Length`/`Range`, `Cache-Control:no-store`, `X-Stream-Resolution` |

**Subtitles** (any id works; `:id` just names the cache folder)

| Method | Path | Input → output |
|---|---|---|
| GET | `/api/movies/:id/subtitles/online` | `query` (required), `year` → `{subtitles:[{id,lang,name,sourceUrl}]}`; 400 without title, 500 on scrape error |
| POST | `/api/movies/:id/subtitles/download` | `{sourceUrl,lang,name}` → `{success:true,vttUrl:'/api/movies/:id/subtitles/custom/online_<md5[0:10]>.vtt',label,name}`; 400 without `sourceUrl`; caches zip→SRT→VTT |
| POST | `/api/movies/:id/subtitles/upload` | `{text,filename,label}` → **always 500**, handler uses undefined `movie.id` (`index.js:818`); 400 for empty `text` |
| GET | `/api/movies/:id/subtitles/custom/:filename` | serves `text/vtt; charset=utf-8`, `ACAO:*`, `max-age=86400`; 404 text |

**Downloads / OTA / shells**

| Method | Path(s) | Behavior |
|---|---|---|
| GET | `/download/app`, `/movieflix.apk`, `/vikyflix.apk`, `/download` | phone APK (repo root else `server/`); `no-store,no-cache,must-revalidate`+`Pragma`; 404 text |
| GET | `/api/app/version` / `?platform=tv` | `{versionCode:66, versionName:'2.9.9', packageName, apkUrl, apkSha256, fileSize, releaseDate, releaseNotes}` — mobile `uk.vikyflix.app` → `https://vikyflix.uk/download`; TV `uk.vikyflix.tv` → `/download/tv`; sha256+mtime from the APK on disk, size fallback 5501048; `no-store` |
| GET | `/download/share`, `/movieflix-share.apk` | share build; 404 if absent |
| GET | `/download/tv`, `/movieflixtv.apk` | TV APK; `no-store`; 404 |
| GET | `/download/lg`, `/download/webos`, `/vikyflix.ipk` | `server/VikyFlix.ipk`; 404 text |
| GET | `/api/movies` / `/api/series` | discontinued shells: `{movies:[],series:[],directories:[],discontinued:true}` / `{series:[],directories:[],discontinued:true}` |
| use | `/api/stream/*` | CORS middleware only (`OPTIONS→200`), **no routes behind it** → GET falls through to `/api` 404 JSON |
| use | `/promo` | `express.static(<repo>/promo)` when present |
| use | `/` + SPA fallback | `express.static(web/dist)`; `*.html` `no-store`, hashed assets 1-year immutable; only if `web/dist` exists: non-`/api` → `index.html`, unmatched `/api/*` → 404 `{error:'Endpoint not found'}` |

Catalog card shape (`mapItem`, `moviebox.js:286-319`) — the UI depends on it exactly: `id` (`mb_<subjectId>`), `subjectId`, `title`, `year`, `releaseDate`, `addedAt`, `description`, `genres[]`, `rating` (1-dp string|null), `poster`, `posterUrl`, `backdrop`, `backdropUrl`, `subjectType` (1/2), `videoUrl` (null), `detailPath`, `hasResource`, `corner`, `countryName`, `detailUrl`, `duration`, `formattedDuration`, `isSeries`, `source:'MovieBox'`; enrichment adds `audioVersions[{language,subjectId,detailPath(,title)}]`, `dubsEnriched`, `discoveredAt`. Catalog `categories`: `trending`(36), `action`/`drama`/`comedy`/`series`/`topRated`(24); `banners`(6) = `{title,image,movieId,subjectId,description,rating,year}`. Stream result: `{url,streamUrl,resolution,format,availableResolutions[],expiresAt}`.

## 6. Architecture and data flow

```
 Web SPA (Vite build) ─ web/dist ─► Express :5000 (0.0.0.0) ─► server/moviebox.js ─► MovieBox upstream
 Capacitor WebView (mobile/tv flavors)      │                          ├ catalog mirrors (moviebox.ac/.ph/.ng/.re/hifimove.io)
        │ getApiBase() tiers               │                          ├ BFF h5-api.aoneroom.com/wefeed-h5api-bff
        ▼                                  │                          ├ play hosts raced: mzfi.me, hifimove.io, moviebox.ph/.ac
 localStorage URL → native vikyflix.uk     │                          └ artwork CDN (Referer movie-box.tv)
 → :5173 dev ⇒ :5000 → same origin          │
                                            ├ /api/moviebox/*  catalog, meta, search, detail, episodes
                                            ├ posters/backdrops: disk cache + async ffmpeg variants + SVG placeholder
                                            ├ stream/:id: resolve (2.5 min URL cache) → pipe Range/206, token retry
                                            ├ /api/movies/:id/subtitles/*: yts-subs + IMDb, VTT on disk
                                            ├ /api/app/version, /download*: OTA + artifacts
                                            └ SPA fallback / static / promo
                                                    ▼ disk
 server/cache/ : moviebox_cache.json · posters/mb_*.jpg(_wN) · <id>/online_*.vtt, custom_*.vtt · transcode scratch
 server/moviebox_hosts.json (mirror list, first probe wins) · metadata_cache.json

 Android APK only: LocalStreamServer (127.0.0.1:8844-8848) resolves+proxies MovieBox on the device's
 residential IP → zero PC bandwidth; AndroidStreamBridge is the JS entry point; PC/Render proxy is fallback.
 LG webOS: .ipk is a redirect shell to https://vikyflix.uk.
```

## 7. Upstream internals (`moviebox.js`)

| Concern | Behavior |
|---|---|
| Hosts | `CATALOG_HOST moviebox.ac`; `moviebox_hosts.json` `_mirrors` (or `DEFAULT_MIRRORS` 10-16) probed via `GET /wefeed-h5api-bff/country-code`, first 200 cached in `catalogOrigin` |
| Session | `X-Client-Token: <unix>:md5(<unix>:wefeed-h5api-bff)`; token from `x-user`/`set-cookie`, cached 2 h/host, sent as `X-User`+`Cookie` |
| Timeouts | every `bffFetch` 12 s (246-261), origin probe 8 s, poster 20 s |
| Build | `POST /subject/filter` `{page,perPage:30,channelId}` (1=movies, 2=series), ≤170 pages each; aborts (keeps old snapshot) at ≥35 page failures or previous ≥500 and new <60% (1160-1177) |
| Incremental | `refreshLatestReleases(pages)` merges new/changed rows; no-op keeps cache byte-identical (304 for devices) then runs `enrichEditionSweep()`; returns `{addedCount,updatedCount,total}` or `false` |
| New arrivals | `refreshLatestFeed(pages)` uses `sortBy:'releaseDate',sortType:0` — catches titles before they climb popularity |
| Editions | `enrichCardEditions` reads detail `dubs[]` → `audioVersions` (4.5 s race, background attach); `enrichEditionSweep(400 cards, 240 s)` rotating cursor; dub merge clusters ±1 release year, unknown-year rows only when every title has a language label |
| Resolve | races 4 play hosts (`Promise.allSettled`); resolution ladder 1080→720→480→360 for `res`, default `720‖1080‖480‖first`; URL cache 2.5 min, failure cache 90 s; VIP-locked → "Stream is VIP locked"; series seasons cached 30 min |
| Background loops | +3 s releases(15)+feed(5); every 20 min both + poster warmer; every 6 h releases(40); every 5 min edition sweep; every 10 min `pruneCache` (`index.js:216-241,490-491`) |
| Dead code | `CACHE_TTL_MS` (6 h, line 20) is declared and never used |

## 8. Deployment topology — PC primary, cloud fallback

1. **PC primary (live):** `cloudflared.exe tunnel run` (root `start-server.bat`; `server/start-vickyflix.bat` uses named tunnel `vickyflix`) → `vikyflix.uk`; Node on `0.0.0.0:5000` serves API + `web/dist`. Streaming proxy traffic uses the PC's uplink.
2. **Cloud fallback:** `server/render.yaml` — `movieflix-server`, node, **plan free** (sleeps ≈15 idle min, wake ≈50 s), `npm install`/`npm start`, `healthCheckPath /api/app/version`, `PORT=10000`, `MEDIA_DIRS=""`, `ADMIN_KEY` (sync:false). URL `https://vikyflix-server.onrender.com`; deploy steps in `server/DEPLOY-RENDER.md` (push → New+Blueprint → enter key → verify `/api/app/version`; update the fallback URL in `App.jsx` if Render renames the service).
3. **Coverage gap:** Render is the last candidate only for catalog (`App.jsx:691`) and OTA (`:517`). Website **playback** still calls `API_BASE` (= vikyflix.uk → PC), so browser streaming needs the PC; Android plays on-device and stays usable. APK/IPK are git-ignored → Render cannot serve `/download*`.
4. **Cold start:** first request after sleep ≈50 s; the app's 90-120 s timeouts and tier retries absorb it (`App.jsx:676-692`). Never shorten those timeouts.
5. **Ops:** owner approval needed for restarts, deploys, Render pushes (golden rule 5). Health is process-level only — it does not check upstream reachability.

## 9. Environment variables (`server/.env`; template `.env.example`)

| Key | Default / location | Effect |
|---|---|---|
| `PORT` | `5000` (`index.js:16`); Render injects `10000` | API + static listen port |
| `ADMIN_KEY` | fallback literal in `index.js:30` — **not a secret; must be set in production**; never print/commit | gates `POST /api/moviebox/refresh`; accepted as `x-admin-key` header or `?admin=` |
| `MEDIA_DIRS` / `MEDIA_DIR` | `''` | parsed into `MEDIA_DIRS` (`index.js:36-37`); library discontinued → unused by live routes |
| `CACHE_DIR` | `<server>/cache` | poster/catalog/subtitle/transcode root; `posters/` created at boot |
| `CACHE_MAX_GB` | `2` (×1e9) | `pruneCache` cap; protected dirs `posters`,`subtitles`,`metadata`,`data`; never prunes an actively streaming title |
| `TRANSCODE_HW` | unset → probe `h264_nvenc`, else libx264 | `off` forces CPU (`transcoder.js:13-18`) |
| `NODE_ENV` | `production` (render.yaml) | informational |

`server/.env` exists on the owner's PC — never read it into a report, paste it or commit it (golden rule 2). Keystore/key material lives outside the repo in `%USERPROFILE%\.android\`.

## 10. Files, logs, operational scripts

| Path | Role |
|---|---|
| `server/index.js` (874 L) | Express API, static/SPA, poster warmer, OTA/download routes, background loops |
| `server/moviebox.js` (1591 L) | scraper/BFF, filters, dub merge, stream resolution, catalog cache |
| `server/transcoder.js` (461 L) | ffmpeg HLS transcode + idle reaper + `pruneCache` (legacy library path; only `pruneCache` is imported) |
| `server/subtitles.js` (129 L) | yts-subs/IMDb search, zip extraction, SRT→VTT |
| `server/scanner.js`, `metadata.js`, `sessions.js`, `rebuild-catalog.js` | legacy local library + one-off catalog rebuild (writes `cache/moviebox_cache.json`); not wired into `index.js` |
| `web/src/config.js`, `tv.js` | API base tiers / `IS_NATIVE_APP`; TV detection + D-pad spatial nav |
| `web/src/App.jsx`, `VideoPlayer.jsx`, `components/*`, `styles/*` | SPA shell, player, Aurora design system (`web/DESIGN_SPEC.md`, `styles/aurora.css`) |
| `web/android/app/src/main/java/uk/vikyflix/app/{LocalStreamServer,MainActivity}.java` | on-device resolver/proxy + `AndroidStreamBridge`/`AndroidFullscreen` + APK updater |
| `docs/verification.md`, `docs/error-register.md` | accepted commands/endpoint expectations; incident memory (currently empty — add real entries) |
| `backups/` | UI snapshots, not authoritative |

Log files (relative to `server/`): `server.log` — `start-server-hidden.vbs` (append) and `watchdog.bat` (truncate with `>`); `service.log` — `run_service.bat` restart loop; `watchdog.log` — watchdog attempts; `server_err.log`/`server_out.log` — exist but no repo script writes them (verify); `tunnel.log`/`tunnel_h2.log` — cloudflared output (writer not in repo scripts; verify); root `server.log` is historical. Runtime stdout is ISO-timestamped by the `console.log` override (`index.js:20-25`).

| Script | Purpose |
|---|---|
| `start-server.bat` (root) | cd `server`, start `cloudflared.exe tunnel run` if not running, `npm start`; window stays open |
| `start-server-hidden.vbs` (root) | hidden + idempotent: tunnel only if no `cloudflared.exe`; `npm start >> server.log` only if `:5000` not LISTENING |
| `server/start-vickyflix.bat` | minimized `node index.js` + `cloudflared.exe tunnel run vickyflix` |
| `server/run_service.bat` + `run_service_hidden.vbs` | 24/7 auto-restart loop → `service.log` |
| `server/watchdog.bat` + `watchdog_hidden.vbs` | Task Scheduler every 5 min/logon: revive if `:5000` not listening → `watchdog.log` |
| `web/android/sign-release.ps1` + `RELEASE_SIGNING.md` | release signing; owner + external key required, never unattended |
| `server/cloudflared.exe` | tunnel binary (git-ignored) |

## 11. Known limitations, defects and drift (verified)

| # | Item |
|---|---|
| 1 | `POST /api/movies/:id/subtitles/upload` is **broken**: undefined `movie.id` (`index.js:818`) → ReferenceError → 500. Should use `req.params.id`. |
| 2 | Legacy player endpoints are **absent**: `/api/movies/:id`, `/api/movies/:id/thumbnail`, `/api/stream/:id/index.m3u8`, `/api/stream/:id/stop`, `/api/movies/:id/subtitles/:index.vtt` are still called by `VideoPlayer.jsx`/`mediaUtils.js` but only MovieBox paths exist. Harmless for online titles (404 ignored), broken for any local item. |
| 3 | **Content-policy gap:** `/api/moviebox/search` applies only audiobook/anime/adult filters (`moviebox.js:1398`), not regional ones; the web UI masks this by searching client-side over the filtered catalog, but any API client can get Filipino/Nigerian/etc. results. |
| 4 | Two independent filter implementations (server `moviebox.js`, client `App.jsx:794-845`) must change together. |
| 5 | OTA constants duplicated: `index.js:131-132` (66 / 2.9.9) vs `build.gradle:10-11`; `apkUrl` hard-codes `https://vikyflix.uk`. Bump both or OTA stalls/loops. |
| 6 | Fallback hosts are hard-coded in `App.jsx:515-518,686-692` (vikyflix.uk + onrender) — exception to "resolve via `getApiBase()`"; keep in sync if Render renames. |
| 7 | AGENTS drift: Vite has **no API proxy** (`web/vite.config.js` is 7 lines; dev works via `config.js:26-28`); LG webOS **source is in repo** (`lg-webos/`), contrary to the AGENTS "known gap"; `config.js:36-38` says MovieBox is app-only but the website renders the online catalog (no native gate). |
| 8 | LG `appinfo.json` reuses TV package id `uk.vikyflix.tv`; the LG app is a redirect shell, not a bundled SPA (verify the id is intentional). |
| 9 | No git repository (`.git/HEAD` absent) and no automated tests — verification is lint/build + API smoke + manual matrix (`docs/verification.md`). |
| 10 | `ADMIN_KEY` has a code default, CORS is `*`, no rate limiting — the public tunnel can hammer upstream unless the key is set and private. |
| 11 | `CACHE_TTL_MS` unused; `/api/health` `mode:'cloud-stremio'` naming stale; SPA fallback only when `web/dist` exists (unbuilt clone → Express default 404s). |
| 12 | Signing credentials are inlined in `web/android/app/build.gradle` (~lines 48-53); key material is outside the repo. Never echo, copy or rotate without the owner. |
| 13 | Render free tier sleeps and cannot serve OTA (`*.apk`/`*.ipk` git-ignored) — `/download*` requires the PC. |
| 14 | Poster variants are async: the first request for a width gets the original (7-day cache); missing upstream artwork shows the placeholder (60 s) until warmed. |
| 15 | `server/cache/` and logs grow at runtime; `pruneCache` only prunes movie folders, not posters/VTTs. |

## 12. Glossary

| Term | Meaning |
|---|---|
| **MovieBox** | upstream catalog/streaming source scraped by `server/moviebox.js` |
| **BFF** | backend-for-frontend calls (`wefeed-h5api-bff`) hiding upstream hosts/tokens from clients |
| **mb_ id** | catalog id `mb_<subjectId>`; server also accepts raw `subjectId` and `detailPath` |
| **subjectId / detailPath** | upstream numeric title id + its detail path; both are needed to resolve a stream |
| **Edition / dub** | separate upstream subject for the same title in another language; merged into one card's `audioVersions` |
| **dubs / `dubsEnriched`** | upstream authoritative language list, and the flag that it was fetched |
| **Resolve** | turning (subjectId, detailPath, se, ep) into a signed CDN URL (2.5 min cache) |
| **Stremio method / LocalStreamServer** | on-device 127.0.0.1 resolver+proxy inside the Android APK (zero PC bandwidth) |
| **Track** | Android OTA channel: `mobile` (`uk.vikyflix.app`) vs `tv` (`uk.vikyflix.tv`) — never cross-update |
| **Aurora** | the binding design language (`web/DESIGN_SPEC.md`, `web/src/styles/aurora.css`) |
