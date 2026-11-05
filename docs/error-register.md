# Error register — the project's error memory

> The owner's "RAG": one row per error, defect or near-miss that escaped into a
> build. Read before touching a risky area, write after the fix, and turn every
> lesson into a regression case (`Skills/README.md` §Memory). Markdown by design
> — not a changelog or log dump: work items go on the task board, raw logs stay
> in `server/*.log`.

## The memory loop

| # | Move | What you do | Evidence left behind |
|---|---|---|---|
| 1 | **Search** | Before editing an area, search this file for area, platform and symptom words. Read every hit and run its regression case *before* changing code. | Test brief: "ERR-n regression case run — pass/fail". |
| 2 | **Fix** | Reproduce → isolate → fix. Restart, rollback and cache clears are mitigation, not a fix — record both. | Root-cause sentence + changed files. |
| 3 | **Write** | Same session as the fix: new row at the top, next free ID, every column filled. | The row itself. |
| 4 | **Prevent** | Turn the lesson into a typed rule (code / test / process / monitoring) and a named regression case. Commands go in `docs/verification.md`; device/manual cases in the matrix of `Skills/tester.md`. Ask that file's owner to add them — one writer per file. | Prevention rule + regression-case reference. |
| 5 | **Verify / close** | Independent evidence moves `fixed` → `verified`. Same symptom later: same ID, `regressed` → `open`, new dated timeline line — never a duplicate row. | `Verified by` entry. |

**Rule of the loop:** an unexecutable prevention case means the incident is not
finished — only quiet.

## Register

Newest first; the placeholder row is replaced by the first real entry. One
writer at a time; never paste secrets here — no `server/.env` values, `ADMIN_KEY`,
signing paths or tokens (golden rule 2, `AGENTS.md`); name the log file instead.

| ID | Date | Area | Platform | Sev | Symptom | Root cause | Fix (files / commit) | Prevention rule | Regression case | Status | Verified by | Links |
|----|------|------|----------|-----|---------|-----------|----------------------|-----------------|-----------------|--------|-------------|-------|
| ERR-2 | 2026-11-05 | health/deploy | pc | P0 | `vikyflix.uk` returned 502 and the local API stopped listening; a stray node process was alive but not serving. | The working server was a child of an interactive DSH shell and was killed when the harness restarted; a duplicate "port in use" process stayed alive and masked the outage. | Killed stray PID; restarted one server via `server\watchdog.bat`; registered `MovieFlixServerWatchdog` scheduled task (every 5 min, test-run OK). | `[process]` Production must be owned by the 24/7 launcher/Task Scheduler, never by an interactive agent shell; only one node process may bind :5000 — if health fails while a node exists, kill it and restart via watchdog. | `docs/verification.md` §8 + §16: local `/api/health` 200 **and** `https://vikyflix.uk/api/health` 200 after restart; `server/watchdog.log` shows revival. | verified | failure-watch — zombie killed, watchdog restart, local+public health 200, manifest 67/2.10.0, 2026-11-05 20:50 | server/watchdog.log · scheduled task MovieFlixServerWatchdog |
| ERR-1 | 2026-11-05 | subtitles | web | P2 | Custom subtitle upload returns 500 for every file; the picker cannot add a subtitle. | Handler used undefined `movie.id` (`server/index.js:818,827`) instead of `req.params.id`. | `server/index.js` upload handler → `req.params.id`; commit `708ac8e`. | `[test]` Any edit to the subtitle handlers must POST a valid SRT and expect 200 + `vttUrl`, then GET `vttUrl` → 200 `text/vtt`. | `docs/verification.md` §6 subtitle-upload smoke. | verified | lead — 3×500 captured → fix → upload 200 + vtt 200, 2026-11-05 | FAIL-fx_f9bc12caa93d9f5c.json · telemetry-2026-11-05.jsonl |

### Column definitions

| Column | Meaning and format |
|---|---|
| `ID` | `ERR-<n>` — monotonic integer assigned at write time, **never reused or renumbered**; canonical reference from commits, bug reports and tester notes. `ERR-X<n>` is reserved for EXAMPLE rows. |
| `Date` | `YYYY-MM-DD` (Asia/Kolkata) when the error was **detected**, not fixed. Prefix `~` if estimated. |
| `Area` | One controlled tag: `health/deploy` · `catalog` · `search` · `detail` · `playback` · `audio` · `subtitles` · `ota` · `downloads` · `tunnel/fallback` · `web-ui` · `android` · `tv` · `webos` · `policy` · `security`. Primary search key. |
| `Platform` | `web` / `android` / `tv` / `webos` / `pc` (local PC + tunnel) / `cloud` (Render fallback) / `all`; comma-list if several. |
| `Sev` | `P0`–`P3` per the severity table below. |
| `Symptom` | Observable user/system behaviour, one line, no theory: "TV playback stalls at 0:00 on some titles", not "stream resolver broken". |
| `Root cause` | One evidence-backed sentence; distinguish cause from symptom. Unknown: `unknown — reopen on next occurrence`; status stays `open`. |
| `Fix` | Repo-relative files (`server/index.js`, `web/src/VideoPlayer.jsx`) plus commit hash once git history exists; until then date-time + files + artifact (`MovieFlixTV.apk`, versionCode). Not "restarted the server". |
| `Prevention rule` | Actionable "if you touch X, check Y" with a type tag `[code]` `[test]` `[process]` `[monitoring]`; executable by an agent who was not here. Never "be more careful". |
| `Regression case` | Named, repeatable check that fails on this defect: a section/command in `docs/verification.md` or a matrix row in `Skills/tester.md`, with its expected result. |
| `Status` | `open` / `fixed` / `verified` / `regressed` per the lifecycle below. |
| `Verified by` | Who + command/action + result + date, e.g. `tester-agent — curl -r 0-1023 … → 206 + Content-Range, 2026-05-04`. A name alone is not evidence. |
| `Links` | Related `ERR-n`, tester `BUG-n` (bug and register rows normally share the number), log files (`server/server_err.log`), screenshot or build reference. |

Keep each cell one line and escape literal `|` as `\|`; detail goes in blocks
below the table, never inside it. Leave no cell blank except `Links`.

## Severity

| Sev | Meaning | Response |
|---|---|---|
| `P0` | Service down, playback broken for everyone, broken deploy, wrong app delivered to users. | Stabilise first, root-cause after; wake the owner. |
| `P1` | Major feature broken: search, subtitles, OTA, or one whole platform. | Same day. |
| `P2` | Degraded: slow, fallback-only, some titles, intermittent. | Scheduled and tracked. |
| `P3` | Cosmetic or internal-only. | Backlog. |

Severity is user impact, not code difficulty; re-grade after triage and keep the
final value. `P0`/`P1` go straight to the orchestrator and the owner.

## Status lifecycle

| Status | Entered when | Requires to leave |
|---|---|---|
| `open` | Confirmed and not fixed. | A fix (→ `fixed`); "unknown cause" keeps it open, it never closes. |
| `fixed` | Change landed: local, deployed, or built into a downloadable artifact. | Independent verification (→ `verified`). |
| `verified` | `Verified by` proves the symptom is gone **and** the regression case passes. | Nothing — this is closed. A recurrence flips it to `regressed`. |
| `regressed` | The same symptom returns after `fixed`/`verified`. | Add a dated timeline line, set back to `open`, record what the old prevention rule missed. Same `ID`. |

Never delete a row, overwrite a timeline or downgrade by editing history — only advance or reopen.

## When an entry may be closed

Closed means `verified`, which requires all four:

- [ ] Fix recorded with files (and commit/artifact) — not a workaround.
- [ ] Prevention rule present and typed (code / test / process / monitoring).
- [ ] Regression case named in `docs/verification.md` or `Skills/tester.md`, with expected result.
- [ ] Evidence in `Verified by` (command + result, or tester sign-off).

`fixed` is **not** closed. A P3 may be closed as accepted risk only by explicit
owner decision recorded in the row — the prevention rule is still required.

## Entry templates

**Simple (default):** one register row — enough when cause and fix fit the
cells (bad cache header, missing null check, wrong download path).

**Complex:** add a detail block below the table when there are hypotheses,
several timelines, logs or a rollback; the row stays the index.

```text
### ERR-<n> — <short title>        (<date> · <platform> · <severity>)
- Impact:            who/what was affected, how long, scope (all / one device / one title)
- Timeline (IST):    detected (by whom/how) → stabilised → root-caused → fixed → verified
- Symptom / repro:   what was seen; minimal numbered steps or endpoint
- Evidence:          log files + key lines, HTTP codes, screenshot/build refs
- Root cause:        one sentence; rejected hypotheses in one line
- Mitigation vs fix: what stopped the bleeding vs what actually fixes it
- Fix:               files changed + commit/artifact
- Prevention:        rule + type + where it is enforced
- Regression case:   command/steps + expected result
- Status:            open | fixed | verified | regressed (reopens: <n>)
- Links:             ERR-x, BUG-x, logs, screenshots
```

## Prevention-rule taxonomy

| Type | Use when | Good | Bad |
|---|---|---|---|
| `[code]` | A guard can live in the code, making the failure impossible or loud. | "`/api/moviebox/stream/:id` must forward `Range` and set `206` + `Content-Range`; reject edits that drop either." | "Be careful editing the proxy." |
| `[test]` | A named check catches the defect before users do. | "`curl -r 0-1023 $b/api/moviebox/stream/<id>` → `206` + `Content-Range`; the same title seeks correctly on TV." | "Test playback before shipping." |
| `[process]` | Ordering, ownership or a release gate must change. | "Before any TV APK release: bump `versionCode` in `server/index.js`, rebuild, then confirm `/api/app/version?platform=tv` returns `uk.vikyflix.tv`, never the phone package." | "Remember the TV app." |
| `[monitoring]` | Return of the failure can be detected automatically or on a schedule. | "After a tunnel restart, check `server/tunnel.log` and require `/api/health` → `status: 'ok'` before declaring the site back." | "Watch the logs." |

A good rule names file/command, expected result, and the failure it catches. If
it needs no judgement to run, it can become a line in `docs/verification.md`;
if it needs a device or eyes, it stays a matrix case in `Skills/tester.md`.

## EXAMPLE rows — format only, not history

> Fabricated for layout. IDs use the reserved `ERR-X<n>` prefix. **Delete this
> whole section when the first real entry is written** — none of these are real
> incidents, none may be cited as such.

| ID | Date | Area | Platform | Sev | Symptom | Root cause | Fix (files / commit) | Prevention rule | Regression case | Status | Verified by | Links |
|----|------|------|----------|-----|---------|-----------|----------------------|-----------------|-----------------|--------|-------------|-------|
| `ERR-X1` EXAMPLE | 2026-01-12 | `playback` | `all` | `P1` | Seeks stall or restart the title at 0:00 on some titles. | Stream proxy dropped `Range`/`Content-Range` when it switched to a plain pass-through. | `server/index.js` (`/api/moviebox/stream/:id`) · 2026-01-12 | `[test]` Any proxy edit re-runs the ranged-request check; `206` + `Content-Range` must survive. | `Skills/tester.md` matrix → Playback (200/206 + seek) | `verified` | `tester-agent` — `curl -r 0-1023` → `206` on two titles, 2026-01-12 | `server/server_out.log` |
| `ERR-X2` EXAMPLE | 2026-01-19 | `ota` | `tv` | `P0` | TV app offered the phone package as its update. | `?platform=tv` branch lost its package selection in a refactor. | `server/index.js` (`/api/app/version`) · 2026-01-19 | `[process]` TV release gate checks both version tracks and the package id before publishing. | `docs/verification.md` API smoke → both OTA tracks (`uk.vikyflix.tv` vs `uk.vikyflix.app`) | `verified` | `tester-agent` — both tracks on local + Render, 2026-01-19 | build/versionCode ref |
| `ERR-X3` EXAMPLE | 2026-02-02 | `tunnel/fallback` | `pc` | `P1` | Site unreachable after a PC reboot; the fallback served an empty catalog. | Cloudflare tunnel did not return after reboot and the fallback catalog was still cold. | `server/watchdog.bat`, `server/start-vickyflix.bat` · 2026-02-02 | `[monitoring]` Watchdog must probe `/api/health` every 5 min and restart a dead tunnel — not only the port-5000 server. | `Skills/tester.md` matrix → Fallback (PC offline → cloud URL serves catalog) | `verified` | `tester-agent` — local restart; `/api/health` → 200 after one watchdog tick, 2026-02-02 | `server/watchdog.log`, `server/tunnel.log` |

## Search and maintenance

- **Search keys:** `Area`, `Platform`, `ERR-<n>`, symptom words, file names in `Fix`. In DSH use the grep tool on this file; PowerShell: `Select-String -Path docs/error-register.md -Pattern 'playback|ERR-3'`.
- **ID scheme:** `ERR-1`, `ERR-2`, … strictly increasing (`max + 1`); never reuse, renumber or delete. `ERR-X<n>` is reserved for the EXAMPLE block.
- **Append-only:** new rows go at the top. Allowed edits to an existing row: advance `Status`, extend `Verified by`, add a `Links` target, correct a factual typo. Never rewrite a verified symptom, root cause or prevention rule — append a dated correction to the complex block and note it in `Links`.
- **Archival:** none today; markdown is the point. Past ~300 rows, move only `verified` rows older than a year into an archive file, link it here, in one reviewed change; never archive `open` or `regressed` rows.
- **Cross-links:** every `Fix` names repo-relative files; every `Regression case` names a section in `docs/verification.md` or a matrix row in `Skills/tester.md`; complex entries name the logs used. A dangling command link is worse than none.
- **Ownership:** the production-error role writes; the orchestrator reads while planning; the tester reads before a regression pass (`Skills/README.md`).

## Integration points

| Role / file | How it uses the register |
|---|---|
| `Skills/orchestrator.md` | Planning step "Check memory": searches touched areas and puts their prevention cases into every task's test brief. |
| `Skills/production-error.md` | Owns the write path: intake → severity → fix → verification → row + prevention rule → incident summary. |
| `Skills/tester.md` | Files `BUG-<n>` reports (number matches the register row), then re-runs the `Regression case` of related entries in the regression pass. |
| `docs/verification.md` | Home of command-based regression cases. A new prevention rule that needs a command is added there (separate file, separate writer) and cited in the row. |
| `AGENTS.md` | Golden rule 7 (no change without evidence). Known gaps apply: no git yet (use date + files until commit hashes exist) and no automated test suite (regression cases are commands + manual matrix rows). |

## Quick start — first time on this file

1. Identify your area/platform and search for it (`playback`, `tv`, the file you are about to edit); read every hit and run its `Regression case` before editing.
2. Do the work per `AGENTS.md`, prove it with `docs/verification.md`, then add the `ERR-<n>` row (every column), tag the prevention rule, name the regression case and set `fixed`.
3. Register the command/case in `docs/verification.md` or `Skills/tester.md` (ask its owner), link it from the row, and hand to the tester for independent `verified` evidence.
4. If the symptom returns, reopen the same ID as `regressed` and strengthen the rule — never invent incidents, fabricate `Verified by` or delete rows.
