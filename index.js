const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Readable } = require('stream');
require('dotenv').config();

const { scanMediaDirs, groupSeries } = require('./scanner');
const { startHlsTranscode, stopMovieTranscodes, touchMovieTranscode, pruneCache, generateLocalThumbnail, extractSubtitleTrack } = require('./transcoder');
const { fetchMovieMetadata, getCachedMetadata, downloadAndCachePoster, inspectMediaTracks } = require('./metadata');
const { searchOnlineSubtitles, downloadAndConvertSubtitle, srtToVtt } = require('./subtitles');
const { recordHeartbeat, removeSession, getActiveSessions, getSystemMetrics, extractClientIp } = require('./sessions');
const { fetchMovieBoxCatalog, findMovieBoxItem, searchMovieBox, resolveMovieBoxStream, fetchSeriesSeasons, enrichCardEditions, getMovieBoxCatalogSnapshot } = require('./moviebox');

const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 5000;
const rawMediaDirs = process.env.MEDIA_DIRS || process.env.MEDIA_DIR || 'E:/Downloaded Movie,F:/Recent Movies';
const MEDIA_DIRS = rawMediaDirs.split(',').map(s => s.trim()).filter(Boolean);
const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, 'cache');
const POSTERS_DIR = path.join(CACHE_DIR, 'posters');
const WEB_DIST = path.join(__dirname, '../web/dist');

if (!fs.existsSync(POSTERS_DIR)) {
  fs.mkdirSync(POSTERS_DIR, { recursive: true });
}

// Cap the transcode cache so it can never fill the disk again (was 157 GB!).
// Override with CACHE_MAX_GB in .env. Prune on startup and every 10 minutes.
const CACHE_MAX_BYTES = (parseFloat(process.env.CACHE_MAX_GB) || 15) * 1e9;
pruneCache(CACHE_DIR, CACHE_MAX_BYTES);
setInterval(() => pruneCache(CACHE_DIR, CACHE_MAX_BYTES), 10 * 60 * 1000);

app.use(compression());
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// High-speed local poster cache delivery with immutable 1-year browser cache
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
  const movieFlixPath = path.join(__dirname, 'MovieFlix.apk');
  const vikyFlixPath = path.join(__dirname, 'VikyFlix.apk');
  if (fs.existsSync(movieFlixPath)) {
    return res.download(movieFlixPath, 'MovieFlix.apk');
  }
  if (fs.existsSync(vikyFlixPath)) {
    return res.download(vikyFlixPath, 'MovieFlix.apk');
  }
  return res.status(404).send('APK not found on server');
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

let moviesDatabase = [];
let seriesDatabase = [];
let refreshPromise = null;
let scanTimeout = null;
let isRefreshing = false;

async function refreshLibrary() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      console.log(`[Server] Scanning media directories:`, MEDIA_DIRS);
      const scanned = scanMediaDirs(MEDIA_DIRS);

      const updatedDatabase = scanned.map(item => {
        const cached = getCachedMetadata(`${item.title.toLowerCase()}_${item.year || ''}`) || getCachedMetadata(`${item.title.toLowerCase()}_`);
        if (cached) {
          item.metadata = cached;
        }
        return item;
      });

      const updatedSeries = groupSeries(updatedDatabase);
      
      // Update in-memory state immediately so newly discovered media is available instantly
      moviesDatabase = updatedDatabase;
      seriesDatabase = updatedSeries;

      console.log(`[Server] Found ${moviesDatabase.length} item(s) (${seriesDatabase.length} web series, ${moviesDatabase.filter(m => !m.isSeries).length} movies). Pre-fetching posters...`);

      // 1. Fast Priority: Pre-fetch all movie and series posters in parallel batches
      const metaBatchSize = 30;
      for (let i = 0; i < moviesDatabase.length; i += metaBatchSize) {
        const batch = moviesDatabase.slice(i, i + metaBatchSize);
        await Promise.all(batch.map(async (movie) => {
          try {
            if (!movie.metadata || !movie.metadata.poster) {
              movie.metadata = await fetchMovieMetadata(movie.title, movie.year);
            } else if (movie.metadata.poster && movie.metadata.poster.startsWith('http')) {
              movie.metadata.poster = await downloadAndCachePoster(movie.metadata.poster, movie.title, movie.year);
            }
            if (movie.metadata?.poster) {
              movie.poster = movie.metadata.poster;
              movie.posterUrl = movie.metadata.poster;
            }
          } catch (e) {}
        }));
      }

      for (const show of seriesDatabase) {
        try {
          if (!show.metadata || !show.metadata.poster) {
            show.metadata = await fetchMovieMetadata(show.title, show.year);
          } else if (show.metadata.poster && show.metadata.poster.startsWith('http')) {
            show.metadata.poster = await downloadAndCachePoster(show.metadata.poster, show.title, show.year);
          }
          if (show.metadata?.poster) {
            show.poster = show.metadata.poster;
            show.posterUrl = show.metadata.poster;
          }
        } catch (e) {}
      }

      console.log(`[Server] Finished loading and caching posters locally. Probing media tracks...`);

      // 2. Secondary: Probe durations in background
      const probeBatchSize = 10;
      for (let i = 0; i < moviesDatabase.length; i += probeBatchSize) {
        const batch = moviesDatabase.slice(i, i + probeBatchSize);
        await Promise.all(batch.map(async (movie) => {
          try {
            if (!movie.duration) {
              const probed = inspectMediaTracks(movie.filePath);
              movie.duration = probed.duration;
              movie.formattedDuration = probed.formattedDuration;
              movie.tracks = probed;
            }
          } catch (e) {}
        }));
      }
      console.log(`[Server] Finished probing all media tracks.`);
    } catch (err) {
      console.error(`[Server] Error during library refresh:`, err.message);
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

function scheduleAutoRefresh(delayMs = 3000) {
  if (scanTimeout) clearTimeout(scanTimeout);
  scanTimeout = setTimeout(async () => {
    if (isRefreshing) return;
    isRefreshing = true;
    try {
      console.log(`[Watcher] Directory changes detected, auto-refreshing media library...`);
      await refreshLibrary();
    } catch (e) {
      console.error(`[Watcher] Auto-refresh error:`, e.message);
    } finally {
      isRefreshing = false;
    }
  }, delayMs);
}

function initMediaWatchers() {
  for (const dir of MEDIA_DIRS) {
    if (fs.existsSync(dir)) {
      try {
        fs.watch(dir, { recursive: true }, (eventType, filename) => {
          if (filename && /\.(mp4|mkv|avi|mov|webm|m4v|srt|vtt)$/i.test(filename)) {
            console.log(`[Watcher] Media file event (${eventType}): ${filename}`);
            scheduleAutoRefresh(3000);
          }
        });
        console.log(`[Watcher] Actively watching '${dir}' for new movies & series.`);
      } catch (err) {
        console.warn(`[Watcher] Recursive watch unavailable for '${dir}', falling back to polling:`, err.message);
      }
    }
  }

  // Periodic polling fallback every 60 seconds to catch any newly added files
  setInterval(() => {
    try {
      const scanned = scanMediaDirs(MEDIA_DIRS);
      if (scanned.length !== moviesDatabase.length) {
        console.log(`[Watcher] File count changed (${moviesDatabase.length} -> ${scanned.length}), auto-refreshing...`);
        scheduleAutoRefresh(500);
      }
    } catch (e) {}
  }, 60 * 1000);
}

// Initial scan and setup watchers
refreshLibrary().then(() => {
  initMediaWatchers();
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    moviesCount: moviesDatabase.filter(m => !m.isSeries).length, 
    seriesCount: seriesDatabase.length,
    totalFiles: moviesDatabase.length, 
    directories: MEDIA_DIRS 
  });
});

// List all movies and series with no-cache headers
app.get('/api/movies', async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.query.rescan === 'true' || req.query.refresh === '1') {
    await refreshLibrary();
  }

  res.json({ 
    movies: moviesDatabase.filter(m => !m.isSeries), 
    allMedia: moviesDatabase,
    series: seriesDatabase, 
    directories: MEDIA_DIRS 
  });
});

// List web series only
app.get('/api/series', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json({ series: seriesDatabase, directories: MEDIA_DIRS });
});

// Single series details
app.get('/api/series/:id', (req, res) => {
  const show = seriesDatabase.find(s => s.id === req.params.id);
  if (!show) return res.status(404).json({ error: 'Series not found' });
  res.json({ series: show });
});

// ==========================================================================
// MovieBox Online Streaming & Metadata API
// ==========================================================================
app.get('/api/moviebox/catalog', async (req, res) => {
  try {
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
          fs.writeFileSync(path.join(POSTERS_DIR, `mb_${job.hash}.jpg`), buffer);
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

    if (!fs.existsSync(localFile)) {
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
        seasons = await fetchSeriesSeasons(target.detailPath);
      } catch (e) {
        console.warn(`[MovieBox] Season list failed for ${movie.title}:`, e.message);
      }
      let se = req.query.se ? parseInt(req.query.se, 10) : null;
      let ep = req.query.ep ? parseInt(req.query.ep, 10) : null;
      if ((se == null || ep == null) && seasons.length) {
        const first = seasons[0];
        se = se == null ? first.se : se;
        ep = ep == null ? 1 : ep;
      }
      if (se != null && ep != null) {
        seParam = se;
        epParam = ep;
      }
    }

    let resolved;
    try {
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

    const upstream = await fetch(targetStreamUrl, { headers: upstreamHeaders });
    if (!upstream.ok && upstream.status !== 206) {
      return res.status(502).json({ error: `Upstream responded ${upstream.status}` });
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

// Rescan
app.post('/api/movies/scan', async (req, res) => {
  await refreshLibrary();
  res.json({ 
    message: 'Library refreshed', 
    moviesCount: moviesDatabase.filter(m => !m.isSeries).length, 
    seriesCount: seriesDatabase.length,
    movies: moviesDatabase.filter(m => !m.isSeries),
    series: seriesDatabase
  });
});

// Single movie details
app.get('/api/movies/:id', async (req, res) => {
  const movie = moviesDatabase.find(m => m.id === req.params.id);
  if (!movie) return res.status(404).json({ error: 'Movie not found' });

  if (!movie.tracks || !movie.duration) {
    const probed = inspectMediaTracks(movie.filePath);
    movie.duration = probed.duration;
    movie.formattedDuration = probed.formattedDuration;
    movie.tracks = probed;
  }

  if (!movie.metadata || !movie.metadata.poster) {
    movie.metadata = await fetchMovieMetadata(movie.title, movie.year);
  }

  res.json({ movie });
});

// Video Thumbnail Endpoint
app.get('/api/movies/:id/thumbnail', (req, res) => {
  const movie = moviesDatabase.find(m => m.id === req.params.id);
  if (!movie) return res.status(404).send('Movie not found');

  generateLocalThumbnail(movie, CACHE_DIR, (err, thumbPath) => {
    if (err || !thumbPath) {
      return res.status(404).send('Thumbnail error');
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(thumbPath);
  });
});

// Embedded Subtitle WebVTT Endpoint
app.get('/api/movies/:id/subtitles/:index.vtt', (req, res) => {
  const movie = moviesDatabase.find(m => m.id === req.params.id);
  if (!movie) return res.status(404).send('Movie not found');

  const subIndex = req.params.index;
  extractSubtitleTrack(movie, CACHE_DIR, subIndex, (err, vttPath) => {
    if (err || !vttPath) {
      return res.status(404).send('Subtitle error');
    }
    res.setHeader('Content-Type', 'text/vtt');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(vttPath);
  });
});

// Search Online Subtitles
app.get('/api/movies/:id/subtitles/online', async (req, res) => {
  const movie = moviesDatabase.find(m => m.id === req.params.id);
  const queryTitle = req.query.query || movie?.title;
  const queryYear = req.query.year || movie?.year;

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
  const movie = moviesDatabase.find(m => m.id === req.params.id);
  if (!movie) return res.status(404).json({ error: 'Movie not found' });

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
app.get('/api/stream/:id/audio/:audioIndex/quality/:quality/index.m3u8', (req, res) => {
  const movie = moviesDatabase.find(m => m.id === req.params.id);
  if (!movie) return res.status(404).json({ error: 'Movie not found' });

  const { audioIndex, quality } = req.params;
  const startTime = req.query.start || 0;
  startHlsTranscode(movie, CACHE_DIR, audioIndex, quality, startTime, (playlistPath) => {
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(playlistPath);
  });
});

app.get('/api/stream/:id/quality/:quality/index.m3u8', (req, res) => {
  const movie = moviesDatabase.find(m => m.id === req.params.id);
  if (!movie) return res.status(404).json({ error: 'Movie not found' });

  const quality = req.params.quality;
  const audioIndex = req.query.audioIndex || null;
  const startTime = req.query.start || 0;
  startHlsTranscode(movie, CACHE_DIR, audioIndex, quality, startTime, (playlistPath) => {
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(playlistPath);
  });
});

app.get('/api/stream/:id/audio/:audioIndex/index.m3u8', (req, res) => {
  const movie = moviesDatabase.find(m => m.id === req.params.id);
  if (!movie) return res.status(404).json({ error: 'Movie not found' });

  const audioIndex = req.params.audioIndex;
  const quality = req.query.quality || null;
  const startTime = req.query.start || 0;
  startHlsTranscode(movie, CACHE_DIR, audioIndex, quality, startTime, (playlistPath) => {
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(playlistPath);
  });
});

app.get('/api/stream/:id/index.m3u8', (req, res) => {
  const movie = moviesDatabase.find(m => m.id === req.params.id);
  if (!movie) return res.status(404).json({ error: 'Movie not found' });

  const audioIndex = req.query.audioIndex || null;
  const quality = req.query.quality || null;
  const startTime = req.query.start || 0;
  startHlsTranscode(movie, CACHE_DIR, audioIndex, quality, startTime, (playlistPath) => {
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(playlistPath);
  });
});

// Live Playback Heartbeat Ping (called by player every 10s)
app.post('/api/stream/:id/ping', (req, res) => {
  const movie = moviesDatabase.find(m => m.id === req.params.id);
  const { sessionId, currentTime, quality, duration } = req.body || {};
  const ip = extractClientIp(req);
  const userAgent = req.headers['user-agent'] || '';

  touchMovieTranscode(req.params.id);

  recordHeartbeat({
    sessionId: sessionId || `${ip}_${req.params.id}`,
    ip,
    userAgent,
    movieId: req.params.id,
    movieTitle: movie?.title || 'Movie Stream',
    poster: movie?.metadata?.poster || null,
    quality: quality || 'AUTO',
    currentTime: currentTime || 0,
    duration: duration || movie?.duration || 0
  });

  res.json({ success: true, active: true });
});

// Admin Live Stream Monitoring Stats
app.get('/api/admin/stats', (req, res) => {
  const sessions = getActiveSessions();
  const system = getSystemMetrics();
  res.json({
    sessions,
    system,
    moviesCount: moviesDatabase.length,
    timestamp: Date.now()
  });
});

// Admin Kick / Terminate Specific Stream
app.post('/api/admin/sessions/:sessionId/kill', (req, res) => {
  const { sessionId } = req.params;
  const { movieId } = req.body || {};
  if (movieId) {
    stopMovieTranscodes(movieId);
  }
  removeSession(sessionId);
  res.json({ success: true, message: `Session ${sessionId} terminated.` });
});

// Stop / Release Stream Transcode (Immediate RAM & CPU release)
app.all('/api/stream/:id/stop', (req, res) => {
  const ip = extractClientIp(req);
  const sessionId = req.body?.sessionId || req.query?.sessionId || `${ip}_${req.params.id}`;
  stopMovieTranscodes(req.params.id);
  removeSession(sessionId);
  res.json({ success: true, message: `Terminated transcode processes for ${req.params.id}` });
});

// Helper: Locate HLS Video Segment File on disk
function findSegmentFile(movieId, segmentName) {
  const movieFolder = path.join(CACHE_DIR, movieId);
  if (!fs.existsSync(movieFolder)) return null;

  const direct = path.join(movieFolder, segmentName);
  if (fs.existsSync(direct)) return direct;

  try {
    const subdirs = fs.readdirSync(movieFolder, { withFileTypes: true });
    for (const d of subdirs) {
      if (d.isDirectory()) {
        const subFile = path.join(movieFolder, d.name, segmentName);
        if (fs.existsSync(subFile)) {
          return subFile;
        }
      }
    }
  } catch (e) {}
  return null;
}

// Helper: Serve HLS Video Segment Chunks with Async In-Flight Transcode Waiting
function serveSegmentChunk(movieId, segmentName, req, res) {
  touchMovieTranscode(movieId);

  const initialFile = findSegmentFile(movieId, segmentName);
  if (initialFile) {
    res.setHeader('Content-Type', 'video/MP2T');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(initialFile);
  }

  // If segment is currently being encoded by FFmpeg, poll for up to 10 seconds
  let attempts = 0;
  const maxAttempts = 100; // 100 * 100ms = 10 seconds
  let finished = false;

  const interval = setInterval(() => {
    attempts++;
    const file = findSegmentFile(movieId, segmentName);
    if (file && !finished) {
      finished = true;
      clearInterval(interval);
      if (!res.headersSent) {
        res.setHeader('Content-Type', 'video/MP2T');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.sendFile(file);
      }
    } else if (attempts >= maxAttempts && !finished) {
      finished = true;
      clearInterval(interval);
      if (!res.headersSent) {
        res.status(404).send('Segment not ready yet');
      }
    }
  }, 100);

  req.on('close', () => {
    finished = true;
    clearInterval(interval);
  });
}

// Universal HLS Video Segment Route Resolvers
app.get('/api/stream/:id/audio/:audioIndex/quality/:quality/:segment', (req, res) => serveSegmentChunk(req.params.id, req.params.segment, req, res));
app.get('/api/stream/:id/quality/:quality/:segment', (req, res) => serveSegmentChunk(req.params.id, req.params.segment, req, res));
app.get('/api/stream/:id/audio/:audioIndex/:segment', (req, res) => serveSegmentChunk(req.params.id, req.params.segment, req, res));
app.get('/api/stream/:id/:subfolder/:segment', (req, res) => serveSegmentChunk(req.params.id, req.params.segment, req, res));
app.get('/api/stream/:id/:segment', (req, res) => serveSegmentChunk(req.params.id, req.params.segment, req, res));

// Direct Video Stream (HTTP Range 206)
app.get('/api/stream/:id/direct', (req, res) => {
  const movie = moviesDatabase.find(m => m.id === req.params.id);
  if (!movie || !fs.existsSync(movie.filePath)) {
    return res.status(404).send('Movie file not found');
  }

  const stat = fs.statSync(movie.filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(movie.filePath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': movie.filename.endsWith('.mkv') ? 'video/x-matroska' : 'video/mp4',
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': movie.filename.endsWith('.mkv') ? 'video/x-matroska' : 'video/mp4',
    };
    res.writeHead(200, head);
    fs.createReadStream(movie.filePath).pipe(res);
  }
});

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
