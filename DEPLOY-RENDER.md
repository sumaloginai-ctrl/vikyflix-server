# Deploy MovieFlix to Render — Always-On Cloud

This makes the app survive your PC being off. The cloud instance serves the
MovieBox catalog, playback, subtitles and OTA updates. Your PC stays the fast
primary whenever it's awake; phones and the TV fall back to the cloud
automatically.

Playback is already PC-independent: the APK resolves and streams MovieBox
directly on the device (embedded Stremio-style server on 127.0.0.1).

## Steps (10 minutes, one time)

1. Push this project to GitHub (repo `vikyflix-server`, branch `main`).
   The app's fallback expects the Render URL:
   `https://vikyflix-server.onrender.com`
   (If Render assigns a different name, update the fallback URL in
   `web/src/App.jsx` — search for `vikyflix-server.onrender.com` — and rebuild.)

2. Go to https://dashboard.render.com → **New +** → **Blueprint** →
   pick the repo → **Apply**. Render reads `server/render.yaml`.

3. When prompted for `ADMIN_KEY`, enter a secret (any long string).

4. Wait for the first deploy (~2-3 min). Verify:
   `https://vikyflix-server.onrender.com/api/app/version` returns JSON.

5. **Test playback from the cloud IP**: open the app while your PC is
   offline and play a MovieBox title. If MovieBox throttles datacenter IPs
   (rare), playback stays PC-dependent and I'll route playback differently.

## Free tier behavior
- Sleeps after ~15 idle minutes; the next request wakes it in ~50s.
- The app covers this: it retries the catalog against the fallback, so a
  waking cloud instance is invisible to users after the first slow request.
- Upgrade to `starter` ($7/mo) in the Render dashboard for zero-sleep.

## What the cloud instance does NOT do
- It does not serve the personal local library (discontinued feature).
- It does not run the Cloudflare tunnel — `vikyflix.uk` still points at
  your PC and remains the fast primary while the PC is on.
