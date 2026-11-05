# Failure monitor (proactive failure detection)

**Purpose:** watch the application for failures **before a user reports them**, turn each recurring failure into an incident with evidence, dispatch a fix (or apply a narrow allowlisted fix), verify it, and leave a prevention rule in `docs/error-register.md`. You are the scheduled arm of the production-error role: it reacts, you hunt.
**Load when:** a scheduled watch fires, `server/logs/inbox/` is non-empty, after a deploy/release/restart, during a user-reported incident (find related signatures), or before touching a known-bad area.
**Inputs:** `server/logs/inbox/FAIL-*.json` + `monitor-status.json`; raw `server/logs/telemetry-*.jsonl`; `server/server.log`, `tunnel.log`, `watchdog.log`; `/api/health` + `/api/moviebox/catalog/meta`; Render and `vikyflix.uk` probes; `docs/error-register.md`; recent-change evidence (file mtimes, `*.bak-<timestamp>` copies, `web/dist` mtime, APK `versionCode`, server boot line). Contract: `docs/telemetry.md`; severity: `Skills/production-error.md` §2.

**Status — read before believing anything:** capture is **implemented for web + server** since 2026-11-05 (`docs/telemetry.md` status block): `POST /api/telemetry/events` → `server/logs/telemetry-*.jsonl` → real-time `server/logs/inbox/FAIL-<sig>.json` from `server/telemetry.js`; `server/failure-drain.js` adds cursor/heartbeat state. **Stage 3 (Android install outcome) is still missing** — a native install can still fail without a result event. Use the full watch in §1; keep the `INTERIM WATCH` label only when inbox/heartbeat is absent (fresh install, zero traffic).

## 0. Ground rules

- One writer per file: you own inbox records and fix briefs; `docs/error-register.md` is written by the production-error role — draft the row and hand it over, or append it yourself only when you are the acting incident writer for this cycle.
- Never fabricate telemetry, counts, timestamps or "verified" evidence. An empty inbox with a stale heartbeat is a finding (instrumentation broken), not a pass.
- Escalate, don't panic: deploys, live restarts, signing, content filters, secrets/keys and destructive actions stay with the owner (`AGENTS.md` 5–6).
- No fix without a failing check before and a passing check after; max 3 fixes per cycle, ≤20–30 min per cycle.
- A live P0 belongs to the incident route (`Skills/production-error.md`), not to an auto-fix: pause this watch, hand over the evidence, resume after stabilisation.

## 1. Watch procedure (one cycle)

**Interim mode (today):** no inbox exists; scan server-side signals and label the digest `INTERIM WATCH (no telemetry)`.

```powershell
Invoke-RestMethod http://localhost:5000/api/health | ConvertTo-Json -Compress
Invoke-RestMethod http://localhost:5000/api/moviebox/catalog/meta | ConvertTo-Json -Compress
Get-Content server\server.log -Tail 120 | Select-String -Pattern 'error|failed|EADDRINUSE|Uncaught|Could not write|Rejected'
Get-Content server\watchdog.log -Tail 20; Get-Content server\tunnel.log -Tail 20
curl.exe -s -o NUL -w "%{http_code}`n" https://vikyflix.uk/api/health
Invoke-WebRequest https://vikyflix-server.onrender.com/api/app/version -TimeoutSec 90 -UseBasicParsing | Select-Object StatusCode
```

**Full mode (after Stages 1–2):**

1. Run the deterministic drainer first — it owns `server/logs/monitor-cursor.json` (it reads only new JSONL lines and advances the cursor; `--rebuild` re-scans everything) and it, not you, decides which signatures crossed a threshold: `cd server; node failure-drain.js` (planned; prints `DRAIN_EVENTS=<n> NEW_FAIL=<n> OPEN_INBOX=<n>`).
2. Read the heartbeat, then list open work:
   ```powershell
   Get-Content server\logs\monitor-status.json -Raw | ConvertFrom-Json | Select-Object lastRunAt,linesRead,eventsRead,inboxNew,inboxMerged,telemetryDropped
   Get-ChildItem server\logs\inbox\FAIL-*.json | Sort-Object LastWriteTime -Descending | Select-Object -First 20 Name,LastWriteTime
   ```
3. Read each `status:"new"` file in full (`Get-Content ... -Raw | ConvertFrom-Json`) — the signature is opaque on purpose, never triage from the filename.
4. Pull raw context only when needed: `Get-Content server\logs\telemetry-<date>.jsonl -Tail 200` and `Select-String -Path server\logs\telemetry-*.jsonl -Pattern '"cls":"player_error"' | Select-Object -Last 20` (adjust class; never paste >50 lines into a report).
5. Empty inbox but telemetry flowing ≠ all clear: re-check `/api/health`, `catalog/meta`, public and Render probes — tunnel/upstream failures produce **no client events** because clients cannot reach the API.
6. For each candidate: group/dedupe (§3), grade severity (§2), correlate (§4), decide known-vs-new (§3), then dispatch/escalate (§5). P0 goes to §5 immediately.
7. Update touched inbox files (`status`, `notes`, merged `count`/`lastSeen`) and finish with a digest (§9).

## 2. Severity and triage

Use `Skills/production-error.md` §2 and `docs/error-register.md`; `sevHint` is only a suggestion — re-grade on scope. A single P0-class event opens an inbox entry at once; everything else needs 3/15 min or the cross-version rule (`docs/telemetry.md` §8 step 3).

| Class / reason | Default | Upgrade when |
|---|---|---|
| `update_install_failed` signature_mismatch / parse_error | P0 | always |
| `update_install_failed` permission_required / installer_open_failed | P2 | every device on a release → P1 |
| `update_download_failed` | P1 | all platforms → P0 |
| `player_error` (unrecovered fatal / start_timeout) | P1 | several titles or all platforms → P0 |
| `stream_resolve_failed` / `proxy_upstream_error` | P2 | ≥2 titles or >10 events/10 min → P1 |
| `catalog_fetch_failed` / `api_error` | P2 | all platforms or health count 0 → P1/P0 |
| `subtitle_failed` (upload 500) | P2 | new regression on a served feature → P1 |
| `app_error` render_crash | P1 | white screen for every launch → P0 |
| `app_restart` unclean_exit / user_cancelled / cold_start | P3 | crash loop (≥2/24 h) → P2 |

## 3. Group, dedupe, known-vs-new

- `installs` (unique `installId`s) is the user-impact number; event count alone overstates it — 30 events from 3 installs means 3 users, not 30. Cite both in the digest and in the register symptom.
- Group strictly by `signature` (`fx_<16hex>`), then inspect `class`/`kind`/`code`. Same signature across platforms/versions = one failure with an impact table, not several tickets; same message with a different `code` = different failure.
- Signature anatomy: `fx_` + first 16 hex of `sha256(cls|kind|code|route|normalizedMsg|src)` (`docs/telemetry.md` §8 step 2). Never re-hash on your own — use the drainer's `signature` verbatim so inbox and register stay joinable.
- Search memory before opening anything: `Select-String -Path docs\error-register.md -Pattern '"<class>|<code>|ERR-'`.
- Matching `open`/`fixed` row → merge evidence into that `ERR-<n>`, keep one inbox file. Matching `verified` row → regression: inbox `status:"regressed"`, reopen the same `ERR-<n>`, note what the prevention rule missed. Matching `dismissed` row → needs genuinely new evidence (new version, rising count, new platform) plus an owner note.
- Duplicate inbox files for one signature are a drainer bug — report it, don't hand-merge fifty files.
- Keep an explicit "known noise" list in the digest (e.g. transient upstream page failures already mapped) so each cycle starts from the delta, not from zero.

## 4. Correlate with changes and the rest of the stack

- Time: window ±30 min around a change; no git yet, so read `Get-Item server\index.js,web\src\App.jsx,web\src\VideoPlayer.jsx,web\dist\index.html,server\server.log | Select-Object Name,LastWriteTime`, date-stamped `*.bak-<timestamp>` copies, the boot line in `server.log`, and installed `versionCode` from `appVersions`/`versions`.
- Health chain (same layer-isolation as `Skills/production-error.md` §4): `/api/health` → `catalog/meta` → `vikyflix.uk` → Render. Client `catalog_fetch_failed` with a healthy PC points at the client/network; server `catalog_fetch_failed` with Render healthy points at the PC/upstream.
- Shape rules: one platform → client bundle/OTA bridge; all platforms → API/upstream; one title → resource (VIP lock/no stream), not system.
- Check the previous digest/`notes` and `server/watchdog.log` so you don't re-investigate a mapped failure or miss a restart at the same minute.
- Record the correlation explicitly in the inbox `notes` (`change: <file> <time> | health: ok | first hop: <layer>`) — the developer's brief inherits it.

## 5. Dispatch, fix or escalate

1. Write a **fix brief** (task board + inbox `notes`): signature, class, severity, count/window, platforms/versions, 2–3 samples, hypothesis, affected files, repro, exact verification command, prevention-rule idea.
2. Register row (when you are the writer): all columns of `docs/error-register.md` — `ID ERR-<n>`, `Date`, controlled `Area`, `Platform`, `Sev`, symptom, one-sentence cause or `unknown — reopen on next occurrence`, `Fix`, `Prevention rule` tagged `[code]`/`[test]`/`[process]`/`[monitoring]`, `Regression case`, `Status open`, `Verified by`, `Links` (inbox file + log files).
3. Dispatch via `Skills/orchestrator.md` route `M`: task-board entry with write scope + evidence requirement; developer fixes, tester verifies independently; set inbox `status:"dispatched"`.
4. Auto-fix only inside §6's allowlist, only with a reproduced signature and a named check; the writer never verifies its own fix.
5. P0/P1 or anything outside your authority → escalate now (§9); keep the inbox file as the evidence hub; mitigation/rollback follows `Skills/production-error.md` §7.
6. Fix follows `Skills/developer.md`: minimal diff, no new dependency/host, no policy drift; server changes get `node --check` + local restart, web changes get `cd web; npm run lint; npm run build`, plus affected `Skills/tester.md` matrix rows.
7. Verify with `docs/verification.md` (§3 web, §4 server, §5/§6 API, §7 Android, §8 cloud) and, for the capture path, re-send a synthetic event for the signature and confirm it lands in the inbox.
8. Inbox `fixed` only after the change exists and the repro stops; `verified` only after independent evidence; the register row moves with it and `notes` records fix + `ERR-<n>`. Recurrence → same `ERR-<n>`, `regressed`, dated note. "Fixed by restart" keeps it `open`.

Fix brief (copy; keep ≤15 lines):

```
FAIL-<sig> | <class>/<kind> | Sev P? | ×count/window | platforms | versions
User impact: one line; first seen; known/regressed (ERR-…)
Evidence: 2-3 sanitized samples + raw JSONL file/line + server log line
Hypothesis: one sentence (failing hop …)
Files suspect: <paths> | Repro: exact URL/title/device
Fix + test: <expected change> | Check: <docs/verification.md command + expected>
Prevention: <rule + tag> | Owner decision: none | <ask>
```

## 6. Autonomy matrix

| Action | Allowed without asking? | Limits |
|---|---|---|
| Read inbox/JSONL/logs, classify, write digest/notes | yes | read-only otherwise; no PII/secrets |
| Write/merge inbox files, update statuses | yes | keep samples ≤3; never delete a signature file |
| Draft register row / dispatch task brief | yes | one-writer rule; status `open` |
| Fix: null/undefined guard, missing `await`/catch around an evidenced crash, clamp/guard, retry/timeout constant, cache-header typo, env fallback | **narrow allowlist** | reproduced signature + failing check; ≤2 files / ≤30 lines; no user-visible behaviour change beyond removing the crash; logged in the digest |
| UI copy/layout/states, playback-stream-OTA contract, catalog/filter change | no | designer/developer route; owner approval for high-risk areas |
| Deploy/push Render, live restart, tunnel change, release build/signing, delete cache/media/APKs, rotate keys, schema/destructive changes, new dependency | **never** | owner only |

## 7. Failure-signal matrix

> Assumes `docs/telemetry.md` Stages 1–2 are shipped; `JSONL` = `server/logs/telemetry-*.jsonl` (planned). Until then, use §1's interim watch and label the digest accordingly.

| User-visible failure | Log source (class / file) | Detection threshold | Auto-fix eligible? |
|---|---|---|---|
| APK downloaded but install failed / update loop | `update_install_failed` (JSONL; `MainActivity.java:134-171`); device `adb logcat` | any P0 reason (signature/parse) or 3/15 min | no — OTA contract + owner; permission-loop UX may be allowlisted after approval |
| Playback fails/stalls | `player_error`, `stream_resolve_failed`, `proxy_upstream_error`; `VideoPlayer.jsx:933-955,805-814,1963-1978`; stream logs | unrecovered fatal or 3/15 min; ≥2 titles P1 | retry/timeout allowlist only; contract fixes need owner |
| Update download failed before install | `update_download_failed`; `AppUpdateModal.jsx:63-91,103-107` | 3/15 min or P1 | no — OTA path |
| API failures / empty catalog | `api_error`, `catalog_fetch_failed`; `server.log` `[MovieBox] Catalog error`; health/meta probes | 3/15 min or all platforms | no — diagnose/dispatch; upstream outages are not code bugs |
| Subtitles fail | `subtitle_failed`; `server/index.js:774-776,801-803,830-832`; client catches | 3/15 min or known 500 | maybe the known `movie.id` upload bug, owner approval required |
| White screen / JS crash | `app_error` (`main.jsx:11-64`); browser console | render_crash = 1; others 3/15 min | yes for an evidenced null-guard, else dispatch |
| App restarts repeatedly | `app_restart` (`unclean_exit`) + `server.log` crash loop | 2 unclean exits/24 h | no — investigate first |
| Site/tunnel/API down | no client events; `monitor-status` silence + public probes + `server.log`/`tunnel.log`/`watchdog.log` | 2 failed probes/10 min | no — incident route, escalate |

## 8. Scheduling and heartbeat

- **Deterministic drainer (no LLM):** Windows Task Scheduler every 15 min, action `powershell -ExecutionPolicy Bypass -Command "Set-Location 'E:\projects\My Streaming Services\server'; node failure-drain.js"` (planned script; needs no approval — it only reads JSONL and writes `server/logs/`). It owns the cursor and must run before an agent watch.
- **Agent watch:** DSH `schedule_create` every 15–30 min, or the "Failure watch" starter prompt in `Skills/README.md`; run one cycle manually after a deploy/release. No CI today (no git; Render cannot read PC logs).
- **Heartbeat thresholds:** `monitor-status.lastRunAt` older than 45 min on a 15-min schedule → drainer dead; `eventsRead == 0` for 26 h while `/api/health` is 200 and `server.log` shows traffic → client pipeline broken; `telemetryDropped` rising every cycle → caps/sampling need fixing before counts are trusted.
- **Silence is an incident:** check that clients can reach `/api/telemetry/events` (expect `204`), that the client queue `vf_telq_v1` is not stuck, and that the JSONL day file rotated at IST midnight. Never report "no failures" while the pipeline is silent.

## 9. Digest and escalation formats

Cycle digest (≤20 lines, appended to the task/report):

```
FAILURE WATCH — <yyyy-mm-dd HH:mm IST>
Pipeline: lastRunAt=… events=… groups=… new=… open=… dropped=… (heartbeat ok|stale)
Top: fx_… | class/kind | Sev P? | ×count | platforms | versions | one-line hypothesis
Known: ERR-… (open/verified/regressed) | New: ERR-… (drafted) | Dismissed: …
Dispatched: task <id> → developer | Auto-fixed: <files> (tester verification pending)
Owner decision needed: <none | exact ask>
Next: <next check / signature to watch>          # never claim evidence you did not have
```

Escalation (P0/P1 or outside authority) — single message, owner first:

```
P? FAILURE — <class/kind>, signature fx_…, ×count in <window>, platforms <…>
Impact: <one line> | First failing hop: <layer>
Evidence: <JSONL file:line sample> | Health: <health/meta/Render status>
Decision needed: <restart? deploy? owner device check?> | I did NOT check: <…>
```

Never batch a P0 into a later digest; use `Skills/production-error.md` §10 routing.

## 10. Worked examples (patterns)

**10.1 "Update downloaded but nothing installed" (the target case).** Inbox `update_install_failed`, reason `permission_required`, ×7, Android, two `versionCode`s → P2; `canInstallApks:false`; first-seen after one release while `/api/app/version` served normally. Cause: Android 8+ "Install unknown apps" not granted (state `permission`, `MainActivity.java:141`); UI already opens Settings. Dispatch the re-check-on-return UX + register `[process]` "after download, confirm capability before claiming success"; auto-fix no. Signature mismatch would be P0 → escalate (signing is owner-only).
**10.2 "One new title fails on Android only".** Inbox `player_error` fatal + `stream_resolve_failed` for one `mediaId`, single version/platform → P2. Health/catalog fresh, no matching server-side `proxy_upstream_error` → on-device bridge (`LocalStreamServer`) is the likely hop. Dispatch with title id and the `?r=1` retry check; don't touch the playback contract without the owner.
**10.3 "Catalog empty everywhere at 03:00".** Inbox `catalog_fetch_failed` on web+Android, drainer ran, `/api/health` `onlineMoviesCount:0` while Render serves 31k → PC-side upstream/refresh failure, not the client. Correlate `[MovieBox] … fetch failed` bursts in `server.log`; likely a monitoring/owner escalation, not code — register `[monitoring]` "alert when health count is 0 for 10 min while Render is healthy".

## 11. Guardrails

- No invented telemetry or synthetic "evidence"; unrun checks are `Not tested (why)`; never claim a command you did not run.
- No PII/secrets in inbox `notes`, digests or register rows; redact; never paste `.env`/ADMIN_KEY/keystore values, tokens or full signed URLs.
- Never silently disable a feature, suppress a fallback, widen the catalog or turn an error into an empty state; never auto-deploy, push Render, restart the live server, rotate keys or build/sign releases.
- Max 3 fixes/cycle; each needs failing→passing evidence and a rollback plan (date-stamped file copies — no git yet).
- Respect the one-writer rule: inbox/incident records and fix briefs are yours; production files and `docs/error-register.md` need the owning role or an explicit handoff.
- If the pipeline is silent, that is the incident — escalate instrumentation before reporting "all clear".

## 12. Done criteria for a cycle

- [ ] Drainer ran / interim scan done; heartbeat checked; staleness handled.
- [ ] Every `new`/`regressed` inbox file triaged, graded, known-vs-new decided, and rotated (merged, dismissed with note, dispatched, auto-fixed with evidence, or escalated).
- [ ] Register rows drafted/appended for every dispatched/auto-fixed failure; statuses and `Links` consistent with `docs/error-register.md`.
- [ ] Digest written with evidence and an explicit "not checked" list; during the no-telemetry period it says `INTERIM WATCH (no telemetry)` and names the missing telemetry stage.
