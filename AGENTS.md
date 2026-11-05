# MovieFlix / VikyFlix — agent guide

A personal streaming service. One React 19 frontend (`web/`) shipped three ways —
the `vikyflix.uk` website, the Android phone app (`uk.vikyflix.app`) and the
Android TV app (`uk.vikyflix.tv`) — plus one Express API (`server/`) that
resolves MovieBox catalog/streams, subtitles, audio tracks and OTA updates.

**Read this file first, then load only the role playbook you need from
`Skills/` (index: `Skills/README.md`). The legacy first drafts were moved to
`backups/legacy-skills-2026-11-05/` — reference only, never authority.**

## Golden rules (never violate)

1. **Content policy is a hard constraint.** The catalog must exclude adult
   content, kids' cartoons, anime and other-region titles. Filters live in
   `server/moviebox.js` (`isNigerian`, `isFilipino`, `isBengali`, `isUrdu`,
   region/curation logic); a second display filter in `web/src/App.jsx`
   (`_isExcludedItemImpl`, ~line 794) must stay in sync with it. Never widen
   the catalog as a "side improvement".
2. **Never expose or commit secrets.** `server/.env`, `ADMIN_KEY`, the keystore
   under `web/android/keystore/` and any signing material in
   `%USERPROFILE%\.android\` stay out of reports, commits and logs. Use
   `server/.env.example` for reference, never real values.
3. **The design spec is binding.** Before any UI change read
   `web/DESIGN_SPEC.md`. Use tokens from `web/src/styles/aurora.css`; use the
   shared `<Poster>` for artwork (never a raw `<img>`); never invent a second
   visual language.
4. **PC-primary, cloud-fallback.** `vikyflix.uk` is a Cloudflare tunnel to the
   PC; `https://vikyflix-server.onrender.com` is the fallback. Resolve hosts
   through `web/src/config.js` (`getApiBase()`), never hard-code a server URL.
5. **Ask before anything destructive or public:** deploys, pushing to Render,
   restarts of a live server, deleting media/cache/APKs, rotating keys,
   changing content filters.
6. **Leave the environment alone:** don't touch `node_modules/`, `server/cache/`,
   media directories, `.apk`/`.ipk` artifacts or signing files unless the task
   is explicitly about them.
7. **No change is done without evidence.** Follow `docs/verification.md` and
   report the commands you ran and their results.

## Repo map

| Path | What it is |
|---|---|
| `server/index.js` | Express API: catalog, search, detail, stream proxy, subtitles, OTA, downloads, health (874 lines) |
| `server/moviebox.js` | MovieBox scraper/BFF, region + content filters, stream resolution (1591 lines) |
| `server/transcoder.js`, `server/subtitles.js` | ffmpeg transcode/cache pruning; subtitle search/convert |
| `server/scanner.js`, `server/metadata.js`, `server/sessions.js` | legacy local-library code (scan, metadata, session tracking) — not wired into `server/index.js` today; don't delete without approval |
| `server/rebuild-catalog.js` | one-off catalog rebuild script (writes `server/cache/moviebox_cache.json`) |
| `server/cache/` | runtime cache (posters, catalog snapshots, HTML probes) — never commit |
| `web/src/` | React app: `App.jsx` shell, `components/`, `styles/`, `VideoPlayer.jsx` (hls.js), `config.js` |
| `web/android/` | Capacitor Android project; `RELEASE_SIGNING.md` is the release build procedure |
| `web/dist/` | Vite build output; served by Express in production (`WEB_DIST` in `server/index.js`) |
| `Skills/` | agent role playbooks + index (`Skills/README.md`) |
| `docs/` | verification commands (`verification.md`) and error memory (`error-register.md`) |
| `docs/telemetry.md` | failure-event contract + capture design; stages 1/2/4 implemented, Android install outcome still planned |
| `*.bat` / `*.vbs` | Windows start/watchdog scripts (server + cloudflared tunnel) |
| `*.apk` / `*.ipk` | release artifacts served by `/download*` endpoints |

## Run it

Server (API on port 5000, serves `web/dist` when built):

```powershell
cd server
npm install            # first time; npm ci for a clean install
copy .env.example .env # first time, then fill in real values
npm start              # or npm run dev (nodemon)
```

Web dev server (Vite on 5173; `web/src/config.js` points the API at `:5000`
directly — there is no Vite proxy):

```powershell
cd web
npm install
npm run dev            # http://localhost:5173
```

Android/TV builds: see `web/android/RELEASE_SIGNING.md` (requires the external
signing key; never run a release build without the owner present).

APK test loop: `scripts\android-emulator.ps1 -Action test` installs the debug
APK on the existing AVD and prints logcat. Run it from a **normal PowerShell
window** — the emulator cannot write `%USERPROFILE%\.android` inside the DSH
sandbox. The script also supports `-Flavor tv`, `-Action install|status|stop`.

Logs: failures land in `server\logs\`. Read them with
`scripts\build-failure-report.ps1` (plain-English HTML report) or
`scripts\show-failures.ps1` (console table). Raw events:
`server\logs\telemetry-*.jsonl`; incidents: `server\logs\inbox\`.
"What was watched" (titles + watch duration): `scripts\build-watch-report.ps1` →
`server\logs\watch-report.html`; contract in `docs/activity.md`.

## Verify before claiming done

Short version — full command list with expected results in `docs/verification.md`:

```powershell
cd web; npm run lint; npm run build
node --check server/index.js
curl.exe -s http://localhost:5000/api/health
```

## Agent team

| Need | Load |
|---|---|
| Route a request, plan, assign, gate | `Skills/orchestrator.md` |
| Product facts, platforms, architecture, constraints | `Skills/project-domain.md` |
| Write the code (backend / web / mobile-TV) | `Skills/developer.md` |
| Visual + UX work | `Skills/designer.md` |
| Test, reproduce, prove | `Skills/tester.md` |
| Production incident + error memory | `Skills/production-error.md` |
| Detect failures before users report; auto-triage/fix | `Skills/failure-monitor.md` |

Starter prompts and the handoff contract are in `Skills/README.md`; the routing
matrix and phase gates (G0–G4) are in `Skills/orchestrator.md`. Error memory is
`docs/error-register.md` (owned by the production-error role): search it before
touching an area that broke before.

## Running the team

- **Small task** (one file, one area): one agent works through the matching
  playbook sequentially — no team needed.
- **Larger task**: one teammate per role, each with the playbook path, a
  disjoint write scope and the same handoff format. Gate after every phase;
  never let two agents write the same file. `Skills/README.md` has the starter
  prompts and the phase order.
- **Other agent tools** (Cursor, Claude Code, Codex): paste the role file into
  the prompt; the contracts and gates are tool-independent.

### Quick start for a new agent session

1. Read this file; check `git status` if the repo is under version control.
2. Read the playbook for your role only — don't load all of them.
3. Search `docs/error-register.md` for the area you will touch.
4. Work strictly inside the brief's scope; no unrelated edits or reformatting.
5. Run the checks in `docs/verification.md` for what you changed.
6. Report with the handoff contract; write a register row if you fixed a bug.

## Definition of done

- [ ] Scope matches the brief; no unrelated reformatting.
- [ ] `npm run lint` and `npm run build` pass in `web/` (if web changed).
- [ ] `node --check` passes on every changed `server/*.js`; smoke endpoints pass.
- [ ] UI matches `DESIGN_SPEC.md` (tokens, `<Poster>`, states, 44px targets).
- [ ] No secrets, no new hard-coded hosts, no content-policy regressions.
- [ ] Evidence recorded (commands + results); error register updated if a bug.
- [ ] Changed files and risks reported to the user.

## Known gaps and verified defects

- Two local git repos exist: `server/` (remote `vikyflix-server`) and `web/` —
  there is no repo for root-level `docs/`, `Skills/` or `scripts/` yet. Commit in
  the matching repo before risky edits.
- No automated test suite; verification is build + API smoke + manual matrix.
- Failure telemetry is live for web + server (`server/telemetry.js`,
  `web/src/telemetry.js`): events land in `server/logs/telemetry-*.jsonl`, and a
  signature crossing a threshold (or any P0 class) writes
  `server/logs/inbox/FAIL-<sig>.json` immediately. Still missing: Android
  install **outcome** (cancel/signature/parse) — the native state machine stops
  at `installing`. `npm run build` fails inside the DSH sandbox (Vite spawns a
  helper → EPERM); run it with wider access.
- `web/src/App.jsx` calls undefined `setShowIntro` (line ~1191) and
  `fetchAdminStats` (line ~1229): replay-intro and the boot "Retry Connection"
  action throw. Flagged by the designer pass; fix with owner approval.
- The client still calls removed local-library routes (`/api/movies/:id`,
  `/api/stream/*`, embedded-VTT, thumbnails); they 404 by design.
- The UI stacks three CSS layers — legacy `web/src/App.css`, Aurora tokens in
  `aurora.css`, and `premium.css` re-tinting with `!important`. Say which layer
  a style change edits, or the next fix fights the last one.
- `POST /api/movies/:id/subtitles/upload` was **fixed** on 2026-11-05 (ERR-1,
  commit `708ac8e`): the handler used an undefined `movie.id`. It must return
  `200 + vttUrl`; keep the regression check in `docs/verification.md` §6.
- `/api/moviebox/search` applies only audiobook/anime/adult filters, not the
  regional/content-policy filters (`server/moviebox.js:1398`); the web UI hides
  this by searching the already-filtered catalog client-side.
- `web/android/app/build.gradle` contains signing credentials inline and pins
  the keystore to `web/android/keystore/`, which is **inside the repo** — while
  `web/android/RELEASE_SIGNING.md` documents the key as living outside the
  project. Treat both copies as secret; reconcile the docs with the owner.
- OTA version constants are duplicated (`server/index.js:131-132` vs
  `web/android/app/build.gradle:10-11`); bump both or updates stall.
- LG webOS source lives in `lg-webos/` (packaged to `server/VikyFlix.ipk`); its
  `appinfo.json` currently reuses the TV package id — verify before repackaging.
- `ADMIN_KEY` has a default literal in `server/index.js`; production must set it.
