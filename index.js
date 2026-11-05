const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Readable } = require('stream');
require('dotenv').config();

const { pruneCache } = require('./transcoder');
const { searchOnlineSubtitles, downloadAndConvertSubtitle, srtToVtt } = require('./subtitles');
const { fetchMovieBoxCatalog, refreshLatestReleases, refreshLatestFeed, findMovieBoxItem, searchMovieBox, resolveMovieBoxStream, invalidateStreamCache, fetchSeriesSeasons, enrichCardEditions, enrichEditionSweep, getMovieBoxCatalogSnapshot, getMovieBoxCatalogMeta } = require('./moviebox');

const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 5000;

// Timestamped logs — the raw console lines made incidents impossible to
// correlate with real time.
{
  const _log = console.log;
  console.log = (...a) => _log(new Date().toISOString(), ...a);
  const _warn = console.warn;
  console.warn = (...a) => _warn(new Date().toISOString(), ...a);
}

// Control endpoints (library rescan, catalog refresh) trigger expensive
// work — gate them behind a shared key so random internet traffic cannot
// use the public tunnel to hammer MovieBox or the server.
const ADMIN_KEY = process.env.ADMIN_KEY || 'movieflix-admin-2026';
function requireAdmin(req, res, next) {
  const key = String(req.headers['x-admin-key'] || req.query.admin || '');
  if (key === ADMIN_KEY) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}
const rawMediaDirs = process.env.MEDIA_DIRS || process.env.MEDIA_DIR || '';
const MEDIA_DIRS = rawMediaDirs.split(',').map(s => s.trim()).filter(Boolean);
const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, 'cache');
const POSTERS_DIR = path.join(CACHE_DIR, 'posters');
const WEB_DIST = path.join(__dirname, '../web/dist');

if (!fs.existsSync(POSTERS_DIR)) {
  fs.mkdirSync(POSTERS_DIR, { recursive: true });
}

// Clean any leftover transcode cache to keep PC disk free
if (fs.existsSync(CACHE_DIR)) {
  const CACHE_MAX_BYTES = (parseFloat(process.env.CACHE_MAX_GB) || 2) * 1e9;
  pruneCache(CACHE_DIR, CACHE_MAX_BYTES);
  setInterval(() => pruneCache(CACHE_DIR, CACHE_MAX_BYTES), 10 * 60 * 1000);
}

app.use(compression());
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// High-speed local poster cache delivery with immutable 1-year browser cache
// --- Poster variant queue (bounded concurrency, async) ---
const posterVariantQueue = [];
let posterVariantRunning = 0;
const POSTER_VARIANT_MAX = 2;

function queuePosterVariant(srcFile, outFile, width) {
  if (posterVariantQueue.some(j => j.outFile === outFile)) return;
  posterVariantQueue.push({ srcFile, outFile, width });
  drainPosterVariants();
}

function drainPosterVariants() {
  while (posterVariantRunning < POSTER_VARIANT_MAX && posterVariantQueue.length) {
    const job = posterVariantQueue.shift();
    if (fs.existsSync(job.outFile)) continue;
    posterVariantRunning++;
    try {
      const { spawn } = require('child_process');
      const bin = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
      const child = spawn(bin, ['-y', '-loglevel', 'error', '-i', job.srcFile,
        '-vf', `scale=${job.width}:-2:flags=lanczos`, '-q:v', '4', job.outFile],
        { stdio: 'ignore' });
      const done = () => { posterVariantRunning--; drainPosterVariants(); };
      child.on('error', done);
      child.on('close', done);
    } catch (e) {
      posterVariantRunning--;
    }
  }
}

app.get('/api/poster/:hash', (req, res) => {
  const hash = (req.params.hash || '').replace(/[^a-f0-9]/gi, '');
  const localFile = path.join(POSTERS_DIR, `${hash}.jpg`);
  if (fs.existsSync(localFile)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Type', 'image/jpeg');
    return res.sendFile(localFile);
  }
  return res.status(404).send('Poster not found');
});

// Direct 1-click download endpoint for MovieFlix Android APK
app.get(['/download/app', '/movieflix.apk', '/vikyflix.apk', '/download'], (req, res) => {
  const rootMovieFlix = path.join(__dirname, '..', 'MovieFlix.apk');
  const serverMovieFlix = path.join(__dirname, 'MovieFlix.apk');
  const apkPath = fs.existsSync(rootMovieFlix) ? rootMovieFlix : serverMovieFlix;
  if (fs.existsSync(apkPath)) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    return res.download(apkPath, 'MovieFlix.apk');
  }
  return res.status(404).send('APK not found on server');
});

// App version & update manifest endpoint.
// ?platform=tv serves the dedicated Android TV app's track; the default
// (mobile) track serves the phone app. The two are separate installs
// (uk.vikyflix.app / uk.vikyflix.tv) and must never cross-update.
app.get('/api/app/version', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const isTv = req.query.platform === 'tv';
  const apkNames = isTv ? ['MovieFlixTV.apk', 'MovieFlixTv.apk'] : ['MovieFlix.apk'];
  let apkPath = null;
  for (const name of apkNames) {
    const root = path.join(__dirname, '..', name);
    const local = path.join(__dirname, name);
    if (fs.existsSync(root)) { apkPath = root; break; }
    if (fs.existsSync(local)) { apkPath = local; break; }
  }
  const stats = apkPath ? fs.statSync(apkPath) : null;
  const apkSha256 = apkPath ? crypto.createHash('sha256').update(fs.readFileSync(apkPath)).digest('hex') : null;
  res.json({
    versionCode: 66,
    versionName: '2.9.9',
    packageName: isTv ? 'uk.vikyflix.tv' : 'uk.vikyflix.app',
    apkUrl: isTv ? 'https://vikyflix.uk/download/tv' : 'https://vikyflix.uk/download',
    apkSha256,
    fileSize: stats?.size || 5501048,
    releaseDate: stats?.mtime?.toISOString() || new Date().toISOString(),
    releaseNotes: isTv
      ? 'MovieFlix TV — dedicated Android TV app built for remote navigation.'
      : 'Phone layout pass: cleaner two-row filters, a readable section header, two-line card titles and no more clipped text on rails.'
  });
});

// Share build: identical app without REQUEST_INSTALL_PACKAGES — the one
// permission Play Protect uses to show the blocking "harmful app" screen.
// Send this link to other people; in-app updates fall back to the browser.
app.get(['/download/share', '/movieflix-share.apk'], (req, res) => {
  const candidates = [
    path.join(__dirname, '..', 'MovieFlix-Share.apk'),
    path.join(__dirname, 'MovieFlix-Share.apk')
  ];
  const shared = candidates.find(p => fs.existsSync(p));
  if (shared) return res.download(shared, 'MovieFlix-Share.apk');
  return res.status(404).send('Share build not found');
});

// Android TV APK download (MovieFlix TV, uk.vikyflix.tv)
app.get(['/download/tv', '/movieflixtv.apk'], (req, res) => {
  const candidates = [
    path.join(__dirname, '..', 'MovieFlixTV.apk'),
    path.join(__dirname, 'MovieFlixTV.apk'),
    path.join(__dirname, 'MovieFlixTv.apk')
  ];
  const tvPath = candidates.find(p => fs.existsSync(p));
  if (tvPath) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    return res.download(tvPath, 'MovieFlixTV.apk');
  }
  return res.status(404).send('MovieFlix TV APK not found on server');
});

// Direct download endpoint for LG webOS Smart TV package (.ipk)
app.get(['/download/lg', '/download/webos', '/vikyflix.ipk'], (req, res) => {
  const ipkPath = path.join(__dirname, 'VikyFlix.ipk');
  if (fs.existsSync(ipkPath)) {
    return res.download(ipkPath, 'VikyFlix.ipk');
  }
  return res.status(404).send('LG webOS IPK not found on server');
});

// Global CORS & Cache headers for streaming
app.use('/api/stream', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Serve promotional media kit and marketing assets (/promo)
const PROMO_DIR = path.join(__dirname, '..', 'promo');
if (fs.existsSync(PROMO_DIR)) {
  console.log(`[Server] Serving promotional media kit from: ${PROMO_DIR}`);
  app.use('/promo', express.static(PROMO_DIR));
}

// Serve frontend static assets with aggressive caching for hashed assets and fresh index.html
if (fs.existsSync(WEB_DIST)) {
  console.log(`[Server] Serving frontend build from: ${WEB_DIST}`);
  app.use(express.static(WEB_DIST, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      } else if (filePath.match(/\.(js|css|woff2|woff|ttf|png|jpg|jpeg|svg|webp|ico)$/)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    }
  }));
}


// Immediate initial sync for latest online releases + standing 20-minute interval
setTimeout(() => {
  refreshLatestReleases(15).catch(() => {});
  refreshLatestFeed(5).catch(() => {});
}, 3000);

// Standing automated background online catalog refresh every 20 minutes
setInterval(() => {
  refreshLatestReleases(15).catch(err => console.warn('[MovieBox] Automated background sync error:', err.message));
}, 20 * 60 * 1000);

// Genuinely-new arrivals: the source's "recently added" ordering, every 20 minutes.
setInterval(() => {
  refreshLatestFeed(5).catch(err => console.warn('[MovieBox] Latest feed sync error:', err.message));
}, 20 * 60 * 1000);

// Weekly-deep coverage harvest: walk far down the popularity pages so the
// catalog keeps absorbing titles that never touch the front pages.
setInterval(() => {
  refreshLatestReleases(40).catch(err => console.warn('[MovieBox] Deep harvest error:', err.message));
}, 6 * 60 * 60 * 1000);

// Dedicated audio-edition sweeper: pulls each title's authoritative dubs
// list (movies AND web series) so every available language gets synced.
setInterval(() => {
  enrichEditionSweep(400, 240000).catch(err => console.warn('[MovieBox] Edition sweep error:', err.message));
}, 5 * 60 * 1000);

app.get('/api/health', (req, res) => {
  const snap = getMovieBoxCatalogSnapshot();
  res.json({
    status: 'ok',
    mode: 'cloud-stremio',
    onlineMoviesCount: snap?.length || 0
  });
});

// The local library was discontinued — these endpoints remain as empty
// shells so older clients polling them get a clean, empty response.
app.get('/api/movies', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json({ movies: [], series: [], directories: [], discontinued: true });
});

app.get('/api/series', (req, res) => {
  res.json({ series: [], directories: [], discontinued: true });
});
// ==========================================================================
// MovieBox Online Streaming & Metadata API
// ==========================================================================
// Lightweight freshness probe: apps compare fetchedAt with what they already
// have and only download the full catalog when something actually changed.
app.get('/api/moviebox/catalog/meta', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json(getMovieBoxCatalogMeta());
});

app.get('/api/moviebox/catalog', async (req, res) => {
  try {
    // Revalidate rather than re-download: Express' ETag turns an unchanged
    // catalog into a tiny 304, so devices can check for new releases cheaply.
    res.setHeader('Cache-Control', 'no-cache');
    const force = req.query.refresh === '1' || req.query.force === 'true';
    const catalog = await fetchMovieBoxCatalog(force);
    res.json(catalog);
  } catch (err) {
    console.error('[MovieBox] Catalog error:', err.message);
    res.status(500).json({ error: 'Failed to fetch MovieBox catalog', message: err.message });
  }
});

app.get('/api/moviebox/search', async (req, res) => {
  try {
    const q = req.query.q || req.query.keyword || '';
    const results = await searchMovieBox(q);
    res.json({ query: q, total: results.length, results });
  } catch (err) {
    console.error('[MovieBox] Search error:', err.message);
    res.status(500).json({ error: 'Search failed', message: err.message });
  }
});

app.post('/api/moviebox/refresh', requireAdmin, async (req, res) => {
  try {
    const pages = parseInt(req.query.pages || req.body?.pages, 10) || 12;
    const result = await refreshLatestReleases(pages);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/moviebox/detail/:id', async (req, res) => {
  try {
    const { movie } = await findMovieBoxItem(req.params.id);
    if (!movie) return res.status(404).json({ error: 'MovieBox movie not found' });
    res.json({ movie });
  } catch (err) {
    res.status(500).json({ error: 'Detail fetch failed', message: err.message });
  }
});

// Season & episode list for a web series. Dub editions share one catalog card,
// so ?audio=<subjectId> selects which edition's detail record to read; every
// edition carries the same episode map. Returns raw season records
// [{se, maxEp}] — the client expands 1..maxEp into playable episodes.
app.get('/api/moviebox/episodes/:id', async (req, res) => {
  try {
    const { movie } = await findMovieBoxItem(req.params.id);
    if (!movie) return res.status(404).json({ error: 'Title not found' });

    let target = movie;
    const audioId = req.query.audio ? String(req.query.audio) : null;
    if (audioId && Array.isArray(movie.audioVersions)) {
      const version = movie.audioVersions.find(v => String(v.subjectId) === audioId);
      if (version && version.detailPath) target = version;
    }

    if (target.isSeries !== true && target.subjectType !== 2) {
      return res.json({ seasons: [] });
    }

    // fetchSeriesSeasons talks to the upstream BFF directly; a single transient
    // network hiccup shouldn't blank the episode list the client already shows.
    let seasons = [];
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        seasons = await fetchSeriesSeasons(target.detailPath);
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        if (attempt === 0) await new Promise(r => setTimeout(r, 700));
      }
    }
    if (lastError) throw lastError;

    res.json({
      seasons: seasons.map(s => ({ se: s.se, maxEp: s.maxEp }))
    });
  } catch (err) {
    console.error('[MovieBox] Episodes error:', err.message);
    res.status(500).json({ error: 'Episodes fetch failed', message: err.message });
  }
});

// MovieBox Poster Proxy: caches remote posters on this server so clients (Android
// app on ISPs that block the CDN) only ever load images from vikyflix.uk.
const mbPosterInFlight = new Map();

/**
 * Generated artwork for titles whose poster is missing upstream or whose
 * fetch failed. The client always receives a valid image (never a broken
 * <img>), styled to match the app's dark cinematic surface.
 */
const posterPlaceholderSvg = (title) => {
  const safe = String(title || 'VikyFlix')
    .replace(/[&<>"']/g, '')
    .slice(0, 34);
  const initial = (safe.trim().charAt(0) || 'V').toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#181d2c"/>
      <stop offset="55%" stop-color="#10141f"/>
      <stop offset="100%" stop-color="#06070c"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="34%" r="62%">
      <stop offset="0%" stop-color="rgba(255,77,109,0.26)"/>
      <stop offset="100%" stop-color="rgba(255,77,109,0)"/>
    </radialGradient>
  </defs>
  <rect width="600" height="900" fill="url(#bg)"/>
  <rect width="600" height="900" fill="url(#glow)"/>
  <g fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="3">
    <rect x="250" y="330" width="100" height="78" rx="10"/>
    <circle cx="300" cy="369" r="13"/>
  </g>
  <text x="300" y="500" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="150" font-weight="800" fill="rgba(255,255,255,0.16)">${initial}</text>
  <text x="300" y="560" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="26" font-weight="600" fill="rgba(255,255,255,0.38)">${safe}</text>
</svg>`;
};

const sendPosterPlaceholder = (res, title) => {
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  // Short-lived: placeholders are a bridge, not a final answer. Once the real
  // artwork is cached server-side the next request must fetch it, not reuse a
  // week-old dark card (which is exactly how sections looked "broken").
  res.setHeader('Cache-Control', 'public, max-age=60');
  return res.status(200).send(posterPlaceholderSvg(title));
};

/**
 * MovieBox Poster Warmer — root-cause fix for first-open artwork shimmer:
 * after the catalog loads (and every 20 minutes), pre-download any artwork
 * the proxy hasn't cached yet, so clients skip the upstream fetch entirely.
 */
let posterWarmRunning = false;

async function warmMovieBoxPosters() {
  if (posterWarmRunning) return;
  const rows = getMovieBoxCatalogSnapshot();
  if (!Array.isArray(rows) || rows.length === 0) return;
  posterWarmRunning = true;

  try {
    const targets = [];
    for (const row of rows) {
      if (!row) continue;
      const remote = row.posterUrl
        || (typeof row.poster === 'string' && row.poster.startsWith('http') ? row.poster : null);
      if (!remote) continue; // no upstream artwork — the placeholder serves those instantly
      const hash = crypto.createHash('md5').update(remote).digest('hex').substring(0, 20);
      if (fs.existsSync(path.join(POSTERS_DIR, `mb_${hash}.jpg`))) continue;
      targets.push({ hash, remote });
    }
    // Backfill variants for a rotating slice of already-cached originals so
    // cards hit a ready thumbnail instead of waiting for generation.
    try {
      const cached = fs.readdirSync(POSTERS_DIR)
        .filter(f => /^mb_[a-f0-9]{20}\.jpg$/.test(f))
        .slice(0, 120);
      for (const f of cached) {
        const base = f.replace(/\.jpg$/, '');
        queuePosterVariant(path.join(POSTERS_DIR, f), path.join(POSTERS_DIR, `${base}_w700.jpg`), 700);
      }
    } catch (e) {}

    if (!targets.length) return;

    console.log(`[MovieBox] Poster warmer: fetching ${targets.length} missing artwork file(s) in background…`);
    const startedAt = Date.now();
    let ok = 0;
    let failed = 0;
    let cursor = 0;

    const worker = async () => {
      while (cursor < targets.length) {
        const job = targets[cursor++];
        try {
          const upstream = await fetch(job.remote, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              'Referer': 'https://movie-box.tv/',
              'Accept': 'image/*,*/*;q=0.8'
            },
            signal: AbortSignal.timeout(20000)
          });
          if (!upstream.ok) throw new Error(`Upstream ${upstream.status}`);
          const buffer = Buffer.from(await upstream.arrayBuffer());
          if (buffer.length < 1024) throw new Error('Suspiciously small artwork');
          if (!fs.existsSync(POSTERS_DIR)) fs.mkdirSync(POSTERS_DIR, { recursive: true });
          const origPath = path.join(POSTERS_DIR, `mb_${job.hash}.jpg`);
          fs.writeFileSync(origPath, buffer);
          queuePosterVariant(origPath, path.join(POSTERS_DIR, `mb_${job.hash}_w700.jpg`), 700);
          ok++;
        } catch (e) {
          failed++;
        }
        // Stay gentle on the CDN between downloads
        await new Promise(r => setTimeout(r, 30));
      }
    };

    await Promise.all(Array.from({ length: 8 }, () => worker()));
    console.log(`[MovieBox] Poster warmer done in ${Math.round((Date.now() - startedAt) / 1000)}s (ok ${ok}, fail ${failed}).`);
  } catch (e) {
    console.warn('[MovieBox] Poster warmer error:', e.message);
  } finally {
    posterWarmRunning = false;
  }
}

// Warm shortly after boot, then re-check after every catalog refresh window.
setTimeout(() => warmMovieBoxPosters().catch(() => {}), 15000);
setInterval(() => warmMovieBoxPosters().catch(() => {}), 20 * 60 * 1000);

app.get('/api/moviebox/poster/:id', async (req, res) => {
  try {
    const { movie } = await findMovieBoxItem(req.params.id);
    const remote = movie
      ? (movie.posterUrl || (typeof movie.poster === 'string' && movie.poster.startsWith('http') ? movie.poster : null))
      : null;
    if (!remote) return sendPosterPlaceholder(res, movie?.title);

    const hash = crypto.createHash('md5').update(remote).digest('hex').substring(0, 20);
    const localFile = path.join(POSTERS_DIR, `mb_${hash}.jpg`);
    // Thumbnail variants: phones don't need multi-MB originals on a rail.
    const wantW = Math.min(1600, Math.max(120, parseInt(req.query.w, 10) || 0));
    const variantFile = wantW ? path.join(POSTERS_DIR, `mb_${hash}_w${wantW}.jpg`) : null;
    if (variantFile && fs.existsSync(variantFile)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Content-Type', 'image/jpeg');
      return res.sendFile(variantFile);
    }

    const ensureOriginal = async () => {
      if (fs.existsSync(localFile)) return true;
      if (!mbPosterInFlight.has(hash)) {
        const download = (async () => {
          let lastError = null;
          // Upstream CDN occasionally refuses/slow-times one request under
          // burst load (a 900-card series grid fires hundreds at once). One
          // quiet retry turns a dark placeholder into real artwork.
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const upstream = await fetch(remote, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                  'Referer': 'https://movie-box.tv/',
                  'Accept': 'image/*,*/*;q=0.8'
                },
                signal: AbortSignal.timeout(20000)
              });
              if (!upstream.ok) throw new Error(`Upstream ${upstream.status}`);
              const buffer = Buffer.from(await upstream.arrayBuffer());
              if (buffer.length < 1024) throw new Error('Suspiciously small artwork');
              if (!fs.existsSync(POSTERS_DIR)) fs.mkdirSync(POSTERS_DIR, { recursive: true });
              fs.writeFileSync(localFile, buffer);
              return;
            } catch (e) {
              lastError = e;
              if (attempt === 0) await new Promise(r => setTimeout(r, 600));
            }
          }
          throw lastError;
        })().finally(() => mbPosterInFlight.delete(hash));
        mbPosterInFlight.set(hash, download);
      }
      await mbPosterInFlight.get(hash);
    }

    if (!fs.existsSync(localFile)) return sendPosterPlaceholder(res, movie?.title);
    // Serve the right-sized variant (?w=). Generation is QUED AND ASYNC:
    // the first request gets the original instantly and the resized file is
    // ready for the next visit — inline ffmpeg made a 30-card grid burst
    // wait seconds per image and time out into placeholder art.
    if (variantFile && fs.existsSync(variantFile)) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.sendFile(variantFile);
    }
    if (variantFile) queuePosterVariant(localFile, variantFile, wantW);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    return res.sendFile(localFile);
  } catch (err) {
    console.warn('[MovieBox] Poster proxy error:', err.message);
    // Degrade to designed artwork instead of a failed image request.
    return sendPosterPlaceholder(res, null);
  }
});

app.get('/api/moviebox/backdrop/:id', async (req, res) => {
  try {
    const { movie } = await findMovieBoxItem(req.params.id);
    const remote = movie
      ? (movie.backdropUrl || (typeof movie.backdrop === 'string' && movie.backdrop.startsWith('http') ? movie.backdrop : null) || movie.posterUrl || (typeof movie.poster === 'string' && movie.poster.startsWith('http') ? movie.poster : null))
      : null;
    if (!remote) return sendPosterPlaceholder(res, movie?.title);

    const hash = crypto.createHash('md5').update(remote).digest('hex').substring(0, 20);
    const localFile = path.join(POSTERS_DIR, `mb_bd_${hash}.jpg`);

    if (!fs.existsSync(localFile)) {
      if (!mbPosterInFlight.has(`bd_${hash}`)) {
        const download = (async () => {
          let lastError = null;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const upstream = await fetch(remote, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                  'Referer': 'https://movie-box.tv/',
                  'Accept': 'image/*,*/*;q=0.8'
                },
                signal: AbortSignal.timeout(20000)
              });
              if (!upstream.ok) throw new Error(`Upstream ${upstream.status}`);
              const buffer = Buffer.from(await upstream.arrayBuffer());
              if (buffer.length < 1024) throw new Error('Suspiciously small artwork');
              if (!fs.existsSync(POSTERS_DIR)) fs.mkdirSync(POSTERS_DIR, { recursive: true });
              fs.writeFileSync(localFile, buffer);
              return;
            } catch (e) {
              lastError = e;
              if (attempt === 0) await new Promise(r => setTimeout(r, 600));
            }
          }
          throw lastError;
        })().finally(() => mbPosterInFlight.delete(`bd_${hash}`));
        mbPosterInFlight.set(`bd_${hash}`, download);
      }
      await mbPosterInFlight.get(`bd_${hash}`);
    }

    if (!fs.existsSync(localFile)) return sendPosterPlaceholder(res, movie?.title);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    return res.sendFile(localFile);
  } catch (err) {
    console.warn('[MovieBox] Backdrop proxy error:', err.message);
    return sendPosterPlaceholder(res, null);
  }
});

// MovieBox Video Proxy: resolves the signed full-movie stream at play time and
// pipes it through this server with Range support. The upstream CDN sends no
// CORS headers and is unreachable from many mobile networks, so the player
// pulls video from vikyflix.uk instead.
app.options('/api/moviebox/stream/:id', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.sendStatus(200);
});

app.get('/api/moviebox/stream/:id', async (req, res) => {
  try {
    console.log(`[MovieBox] Stream request for ${req.params.id} (range: ${req.headers.range || 'none'})`);
    const found = await findMovieBoxItem(req.params.id);
    let movie = found && found.movie;
    if (!movie) return res.status(404).json({ error: 'Title not found' });

    // Sleeping editions (an original the channel listing never surfaced) are
    // pulled in via search right before playback so the default audio matches
    // the film's own language.
    movie = await enrichCardEditions(movie);

    // An alternate audio edition can be requested via ?audio=<subjectId>.
    // Dub editions are separate upstream subjects sharing one catalog card,
    // so switching the audio track simply resolves the chosen edition's stream.
    let target = { subjectId: movie.subjectId, detailPath: movie.detailPath };
    const audioId = req.query.audio ? String(req.query.audio) : null;
    if (audioId && Array.isArray(movie.audioVersions)) {
      const version = movie.audioVersions.find(v => String(v.subjectId) === audioId);
      if (version && version.detailPath) {
        target = { subjectId: version.subjectId, detailPath: version.detailPath };
      }
    }

    // Web series resolve a concrete season/episode (?se=&ep=) — plain
    // se=0/ep=0 returns no resource upstream. Defaults to the first episode
    // of the first season so tapping Play just works.
    let seParam = null;
    let epParam = null;
    const isSeriesTitle = movie.isSeries || movie.subjectType === 2;
    if (isSeriesTitle) {
      let seasons = [];
      try {
        seasons = await fetchSeriesSeasons(target.detailPath || target.subjectId);
      } catch (e) {
        console.warn(`[MovieBox] Season list failed for ${movie.title}:`, e.message);
      }
      let se = req.query.se ? parseInt(req.query.se, 10) : null;
      let ep = req.query.ep ? parseInt(req.query.ep, 10) : null;
      if (se == null && seasons.length) se = seasons[0].se;
      if (se == null) se = 1;
      if (ep == null) ep = 1;
      seParam = se;
      epParam = ep;
    }

    let resolved;
    try {
      if (req.query.r || req.query.refresh) {
        invalidateStreamCache(target.subjectId, seParam, epParam, req.query.res);
      }
      resolved = await resolveMovieBoxStream(target.subjectId, target.detailPath, seParam, epParam, req.query.res);
    } catch (e) {
      console.warn(`[MovieBox] Stream resolve failed for ${movie.title}:`, e.message);
      if (movie.videoUrl) {
        resolved = { url: movie.videoUrl, resolution: 'trailer' };
      } else {
        return res.status(404).json({ error: 'Stream not available', message: e.message });
      }
    }

    const targetStreamUrl = (resolved && (resolved.url || resolved.streamUrl)) || movie.videoUrl;
    if (!targetStreamUrl) {
      return res.status(404).json({ error: 'Stream not available' });
    }

    const upstreamHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Referer': 'https://mzfi.me/',
      'Accept': '*/*'
    };
    if (req.headers.range) upstreamHeaders.Range = req.headers.range;

    let upstream = await fetch(targetStreamUrl, { headers: upstreamHeaders });
    if (upstream.status === 416) {
      // Range past EOF: the URL is healthy, the player just seeked beyond the
      // end. Answer 416 (the correct semantic) instead of masking it as 502,
      // which players treat as a dead stream.
      return res.status(416).json({ error: 'Requested range not satisfiable' });
    }
    if (!upstream.ok && upstream.status !== 206) {
      // Only CDN-token expiry (401/403/410) warrants a re-resolve; other
      // statuses are passed through so players see the real reason.
      if (upstream.status === 401 || upstream.status === 403 || upstream.status === 410) {
        console.warn(`[MovieBox] Upstream returned ${upstream.status} for ${movie.title}, invalidating cache and retrying...`);
        invalidateStreamCache(target.subjectId, seParam, epParam, req.query.res);
        try {
          const fresh = await resolveMovieBoxStream(target.subjectId, target.detailPath, seParam, epParam, req.query.res);
          if (fresh && (fresh.url || fresh.streamUrl)) {
            upstream = await fetch(fresh.url || fresh.streamUrl, { headers: upstreamHeaders });
          }
        } catch (retryErr) {
          console.warn(`[MovieBox] Stream retry failed:`, retryErr.message);
        }
        if (!upstream.ok && upstream.status !== 206) {
          return res.status(502).json({ error: `Upstream responded ${upstream.status}` });
        }
      } else {
        return res.status(upstream.status >= 500 ? 502 : upstream.status).json({ error: `Upstream responded ${upstream.status}` });
      }
    }

    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS, HEAD',
      'Access-Control-Allow-Headers': '*',
      'Accept-Ranges': upstream.headers.get('accept-ranges') || 'bytes',
      'Content-Type': upstream.headers.get('content-type') || 'video/mp4',
      'Cache-Control': 'no-store',
      'X-Stream-Resolution': resolved.resolution || ''
    };
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) headers['Content-Range'] = contentRange;
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) headers['Content-Length'] = contentLength;

    res.writeHead(upstream.status, headers);
    if (req.method === 'HEAD' || !upstream.body) return res.end();

    const nodeStream = Readable.fromWeb(upstream.body);
    nodeStream.pipe(res);
    req.on('close', () => nodeStream.destroy());
  } catch (err) {
    console.error('[MovieBox] Stream proxy error:', err.message);
    if (!res.headersSent) res.status(502).json({ error: 'Stream fetch failed', message: err.message });
  }
});

// Rescan (admin-gated: triggers a full library scan)

// Search Online Subtitles
app.get('/api/movies/:id/subtitles/online', async (req, res) => {
  // Catalog ids are cloud ids (mb_*) — the title travels in the query.
  const queryTitle = req.query.query;
  const queryYear = req.query.year;

  if (!queryTitle) return res.status(400).json({ error: 'Title required for search' });

  try {
    const subtitles = await searchOnlineSubtitles(queryTitle, queryYear);
    res.json({ subtitles });
  } catch (err) {
    res.status(500).json({ error: 'Failed to search subtitles', details: err.message });
  }
});

// Download Online Subtitle
app.post('/api/movies/:id/subtitles/download', async (req, res) => {
  const { sourceUrl, lang, name } = req.body;
  if (!sourceUrl) return res.status(400).json({ error: 'sourceUrl required' });

  try {
    const subHash = crypto.createHash('md5').update(sourceUrl).digest('hex').substring(0, 10);
    const vttFilename = `online_${subHash}.vtt`;
    const targetDir = path.join(CACHE_DIR, req.params.id);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    const targetVttPath = path.join(targetDir, vttFilename);

    if (!fs.existsSync(targetVttPath)) {
      await downloadAndConvertSubtitle(sourceUrl, targetVttPath);
    }

    res.json({
      success: true,
      vttUrl: `/api/movies/${req.params.id}/subtitles/custom/${vttFilename}`,
      label: `${lang || 'Online'} Subtitle`,
      name: name || `${lang} Subtitle`
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to download subtitle', details: err.message });
  }
});

// Custom Subtitle Upload / Import Endpoint
app.post('/api/movies/:id/subtitles/upload', (req, res) => {
  // Works for any id (mb_* included): custom subtitles are stored per id.
  const { text, filename, label } = req.body;
  if (!text) return res.status(400).json({ error: 'Subtitle text required' });

  try {
    const isVtt = text.trim().startsWith('WEBVTT');
    const vttContent = isVtt ? text : srtToVtt(text);

    const subHash = crypto.createHash('md5').update(text).digest('hex').substring(0, 10);
    const vttFilename = `custom_${subHash}.vtt`;
    const targetVttPath = path.join(CACHE_DIR, movie.id, vttFilename);

    const dir = path.dirname(targetVttPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(targetVttPath, vttContent, 'utf8');

    res.json({
      success: true,
      vttUrl: `/api/movies/${movie.id}/subtitles/custom/${vttFilename}`,
      label: label || filename || 'Imported Subtitle'
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to process custom subtitle', details: err.message });
  }
});

// Serve Custom / Downloaded WebVTT files
app.get('/api/movies/:id/subtitles/custom/:filename', (req, res) => {
  const { id, filename } = req.params;
  const vttPath = path.join(CACHE_DIR, id, filename);

  if (fs.existsSync(vttPath)) {
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(vttPath);
  } else {
    res.status(404).send('Subtitle not found');
  }
});

// HLS Stream with Quality & Audio Selection
// SPA Fallback
if (fs.existsSync(WEB_DIST)) {
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'Endpoint not found' });
    }
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(WEB_DIST, 'index.html'));
  });
}

process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception:', err?.message || err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled rejection:', reason?.message || reason);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎬 VickyFlix Server running on port ${PORT}`);
});
