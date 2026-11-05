# Activity tracking — what was watched and for how long (Option B)

The failure pipeline explains **what broke**. This pipeline answers **what was
watched, on which device, and for how long** — anonymously.

## What it records / what it refuses

| Records | Refuses |
|---|---|
| anonymous `installId` (e.g. `VF-4A9C21`) | names, emails, phone numbers |
| friendly device model from the user-agent (`Android / SM-S918B`, `Android TV / AFTMM`, `iPhone`, `Windows / Chrome`) | serial numbers, unique hardware ids, IP addresses |
| platform (`android` / `tv` / `web`) and app version | passwords, tokens, `.env` values |
| `mediaId` + title (+ season/episode) | search queries |
| **watch duration** (`watchedSeconds`) and **percent watched** | device location |
| one `app_open` heartbeat per launch (device + version) | anything that identifies the person |

Playback time counts only while the video is actually playing — paused,
seeking and buffering are excluded client-side. Retention: 30 days
(`activity-YYYY-MM-DD.jsonl`). Opt-out on a device:
`localStorage.vf_activity_opt_out = '1'` — nothing is sent.

## Pipeline

```
VideoPlayer ──► web/src/activity.js (queue, dedupe, batch)
  onPlaying    │  POST /api/activity/events  (always 204)
  every 60 s   ▼
  onEnded    server/activity.js ──► server/logs/activity-YYYY-MM-DD.jsonl
  unmount        │
                 ▼
              scripts/build-watch-report.ps1 ──► server/logs/watch-report.html
```

Event types (same `playId` groups one playback session):

```json
{"type":"play",         "playId":"ply_x1","mediaId":"mb_500","title":"Festival Movie","se":1,"ep":2,
 "platform":"android","device":"Android / SM-S918B","appVersion":"2.11.0","installId":"…"}
{"type":"play_progress","playId":"ply_x1","watchedSeconds":65,"percent":12, …}
{"type":"play_end",     "playId":"ply_x1","watchedSeconds":185,"percent":42,"completed":false, …}
{"type":"app_open",     "platform":"android","device":"Android / SM-S918B","appVersion":"2.11.0", …}
```

The report groups by `playId` and keeps the **maximum** `watchedSeconds`, so
progress pings never double-count; a session with no `play_end` (app killed)
still contributes its last progress value.

## Read the report

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-watch-report.ps1 -Open
```

Shows:

- **Stats** — watches, different titles, devices seen, **total watch time**, app opens
- **Top titles** — watched count, devices, total watch time, last seen
- **Devices** — support code, **phone/TV model**, platform, version, opens, plays, **watch time**, last seen
- **Recent plays** — title (+ S/E), device model, **duration and percent**, support code

A "watch" = same device + same title + same day. Watch time sums real playing
time across sessions.

## Android / TV notes

- Works through the same React bundle, but the installed apps only send these
  fields after an APK update that includes this code (2.11.0+).
- Android plays through the **on-device** stream server, so the PC cannot infer
  playback: this client report is the only source.
- No accounts exist: the report identifies devices, not people. Optional device
  nicknames (Option C) would replace `VF-XXXXXX` with names like "Living Room TV".

## Limits

- Duration is wall-clock playing time, not "content minutes" (a 2× playback
  counts at 2× speed).
- If the app is force-killed before any flush, the last ≤60 s can be lost.
- The report is regenerated on demand and by each failure-watch cycle; it is
  runtime data, not committed.
