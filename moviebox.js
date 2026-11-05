const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CATALOG_HOST = 'https://moviebox.ac';
const PLAY_HOST = 'https://mzfi.me';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const PAGE_SIZE = 30;

const DEFAULT_MIRRORS = [
  'https://moviebox.ac',
  'https://moviebox.ph',
  'https://moviebox.ng',
  'https://moviebox.re',
  'https://hifimove.io'
];
const HOSTS_FILE = path.join(__dirname, 'moviebox_hosts.json');

const CACHE_FILE = path.join(__dirname, 'cache', 'moviebox_cache.json');
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// Tagalog grammar markers — used by both the load-time purge and the
// new-item gates to drop Filipino/Vivamax-style titles whose metadata
// pretends to be a plain "Drama" with no country.
let inMemoryCache = null;
let lastFetchTime = 0;

const AUDIO_LANGS = {
  english: 'English', hindi: 'Hindi', tamil: 'Tamil', telugu: 'Telugu',
  malayalam: 'Malayalam', kannada: 'Kannada', bengali: 'Bengali',
  punjabi: 'Punjabi', marathi: 'Marathi', spanish: 'Spanish',
  french: 'French', german: 'German', japanese: 'Japanese',
  korean: 'Korean', mandarin: 'Mandarin', chinese: 'Chinese',
  cantonese: 'Cantonese', russian: 'Russian', arabic: 'Arabic',
  portuguese: 'Portuguese', italian: 'Italian', turkish: 'Turkish',
  thai: 'Thai', indonesian: 'Indonesian', vietnamese: 'Vietnamese',
  filipino: 'Filipino', tagalog: 'Filipino', urdu: 'Urdu', dutch: 'Dutch',
  polish: 'Polish', original: 'Original', dual: 'Dual Audio',
  'dual audio': 'Dual Audio'
};

const TRAILING_LANG_RE = /\b(english|hindi|tamil|telugu|malayalam|kannada|bengali|punjabi|marathi|japanese|korean|mandarin|chinese|cantonese|spanish|french|german|italian|turkish|russian|arabic|portuguese|filipino|tagalog|indonesian|vietnamese|thai|urdu|dutch|polish)\b\s*$/i;

// Filipino/Tagalog title scoring: STRONG markers are distinctively Tagalog
// (one hit decides); WEAK markers are common function words that need two or
// more distinct hits — "Si Malakas, Si Maganda at Si Mahinhin" scores si+at.
const TAGALOG_STRONG_RE = /\b(ang|ng|mga|alindog|dilag|lihim|pag-ibig|pagibig|puso|sinta|halik|tinik|baliw|tahanan|akong|ikaw|vivamax|teleserye|pinoy|kagandahan|kahindik)\b/i;
const TAGALOG_WEAK_RE = /\b(si|ni|sa|kay|ko|mo|ka|rin|din|daw|ba|yung|nung|ako|siya|kami|tayo|sila|ito|iyan|iyon|doon|dito|kung|dahil|namin|amin|iyo|kanila|pala|naman|at)\b/gi;
const TAGALOG_LANGTAG_RE = /\[\s*(hindi|tamil|telugu|malayalam|kannada|english|korean|japanese|chinese|spanish|french|bengali|punjabi|urdu|original|dubbed|cam|hd)\s*\]|(hindi|tamil|telugu|malayalam|kannada|english)\s*$/i;

function filipinoTitleScore(title) {
  // Strip language/quality tags first so "Hindi Medium" is never scored as
  // Tagalog just because "hindi" is also a Tagalog word meaning "no".
  const bare = normalizeDubKey(String(title || ''));
  if (TAGALOG_LANGTAG_RE.test(String(title || '')) && !TAGALOG_STRONG_RE.test(bare)) {
    // Title carries an explicit non-Filipino language tag — require strong
    // evidence even so (normalizeDubKey already removed the tag).
  }
  if (TAGALOG_STRONG_RE.test(bare)) return 2;
  const weak = new Set((bare.match(TAGALOG_WEAK_RE) || []).map(w => w.toLowerCase()));
  return weak.size >= 2 ? 1 : 0;
}
const NIGERIAN_STRONG_RE = /\b(nollywood|yoruba|igbo|hausa|naija|nigerian|ghallywood|onye|odinaka|chineke|chukwu|ekene|ikenga|odogwu|olorisa|orisa|orisha|obatala|iyami|aladura|abeni|ayaba|sango|osun)\b/i;
const NIGERIAN_WEAK_RE = /\b(emeka|ngozi|uche|ife|nwa|obi|ezinne|amaka|somto)\b/gi;

function nigerianTitleScore(title) {
  const bare = normalizeDubKey(String(title || ''));
  if (NIGERIAN_STRONG_RE.test(bare)) return 2;
  const weak = new Set((bare.match(NIGERIAN_WEAK_RE) || []).map(w => w.toLowerCase()));
  return weak.size >= 2 ? 1 : 0;
}

try {
  if (fs.existsSync(CACHE_FILE)) {
    inMemoryCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    lastFetchTime = Date.now();
    globalThis.__purgeLog = [];
    // Purge animation content from the persisted catalog (owner never uses it)
    if (Array.isArray(inMemoryCache.movies)) {
      const before = inMemoryCache.movies.length;
      inMemoryCache.movies = inMemoryCache.movies
        .filter(m => { const g = (m.genres || []).join(' ').toLowerCase(); return !(g.includes('animation') || g.includes('anime')); })
        .filter(m => !/doraemon|doremon|shin chan|crayon shin|detective conan|case closed|ben 10|tom and jerry|scooby-doo|scooby doo|oggy|motu patlu|chhota bheem|grizzy|baby shark|peppa pig|bananas in pyjamas|avatar: the last airbender|avatar the last airbender|the legend of korra|paramavatar|tenali raman|shinchan/i.test(String(m.title || '')))
        .filter(m => {
          if (isFilipino(m)) { if (globalThis.__purgeLog?.length < 25) globalThis.__purgeLog.push('FILIPINO: ' + (m.title || '')); return false; }
          if (isNigerian(m)) { if (globalThis.__purgeLog?.length < 25) globalThis.__purgeLog.push('NIGERIAN: ' + (m.title || '')); return false; }
          return true;
        })
        // Scraped entries with no artwork, no year and no release date are
        // unidentifiable junk — they only ever render placeholder posters.
        .filter(m => {
          const hasArt = typeof m.posterUrl === 'string' && m.posterUrl.startsWith('http');
          const identifiable = Boolean(m.year || m.releaseDate);
          return hasArt || identifiable;
        })
        .map(m => {
          let out = m;
          if (m.posterUrl != null && typeof m.posterUrl !== 'string') out = { ...out, posterUrl: null, poster: '/favicon.svg' };
          // Backfill human-readable runtime for items cached before the
          // formattedDuration field existed (fixes absurd "155h 0m" displays).
          if (!out.formattedDuration && out.duration > 0) {
            const d = out.duration;
            const h = Math.floor(d / 3600);
            const mm = Math.round((d % 3600) / 60);
            out = { ...out, formattedDuration: h > 0 ? `${h}h ${mm}m` : `${mm}m` };
          }
          return out;
        });
      for (const key of Object.keys(inMemoryCache.categories || {})) {
        inMemoryCache.categories[key] = inMemoryCache.categories[key].filter(m => { const g = (m.genres || []).join(' ').toLowerCase(); return !(g.includes('animation') || g.includes('anime')); });
      }
      inMemoryCache.banners = (inMemoryCache.banners || []).filter(b => { const g = (b.genres || []).join(' ').toLowerCase(); return !(g.includes('animation') || g.includes('anime')); });
      inMemoryCache.total = inMemoryCache.movies.length;
      if (before !== inMemoryCache.movies.length) {
        console.log(`[MovieBox] Purged ${before - inMemoryCache.movies.length} titles from persisted catalog.`);
        console.log(globalThis.__purgeLog.join(' | '));
      }
      // One-time migration: merge language-dub editions still stored
      // separately in caches written before the improved merge. Deferred out
      // of the boot path — this used to freeze the server for ~20s at every
      // restart while it merged, sorted and rewrote the multi-MB cache.
      setImmediate(() => {
        try {
          const beforeMerge = inMemoryCache.movies.length;
          const mergedAtLoad = mergeDubVersions(inMemoryCache.movies);
          if (mergedAtLoad.length !== beforeMerge) {
            inMemoryCache.movies = mergedAtLoad;
            inMemoryCache.total = mergedAtLoad.length;
            inMemoryCache.fetchedAt = new Date().toISOString();
            fs.writeFile(CACHE_FILE, JSON.stringify(inMemoryCache), 'utf8', () => {});
            console.log(`[MovieBox] Merged ${beforeMerge - mergedAtLoad.length} dub editions at load.`);
          }
        } catch (e) {
          console.warn('[MovieBox] Post-boot merge failed:', e.message);
        }
      });
    }
    console.log(`[MovieBox] Loaded ${inMemoryCache.movies?.length || 0} movies from disk cache.`);
  }
} catch (e) {
  console.warn('[MovieBox] Could not load disk cache:', e.message);
}

const streamCache = new Map();
// Remember recent resolve failures so re-tapping an unplayable title fails
// in milliseconds instead of burning every upstream timeout again.
const streamFailAt = new Map();
const STREAM_FAIL_TTL_MS = 90 * 1000;
// Short TTL (2.5 mins) so CDN expiration signatures are refreshed proactively
const STREAM_CACHE_TTL_MS = 2.5 * 60 * 1000;

function invalidateStreamCache(subjectId, se = null, ep = null, wantRes = null) {
  const isEpisode = se != null && ep != null;
  const resTag = ['360', '480', '720', '1080'].includes(String(wantRes)) ? String(wantRes) : null;
  const cacheKey = `${isEpisode ? `${subjectId}:${se}:${ep}` : subjectId}${resTag ? `@${resTag}` : ''}`;
  streamCache.delete(cacheKey);
  // Also delete base key
  streamCache.delete(String(subjectId));
}

function loadHostCandidates() {
  try {
    const parsed = JSON.parse(fs.readFileSync(HOSTS_FILE, 'utf8'));
    const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed._mirrors) ? parsed._mirrors : null);
    if (list && list.length) return list.map(String).filter(h => /^https?:\/\//.test(h));
  } catch (e) {}
  return null;
}

let catalogOrigin = null;

async function probeOrigin(origin) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(`${origin}/wefeed-h5api-bff/country-code`, {
      headers: baseHeaders(origin),
      signal: ctrl.signal
    });
    return r.ok && r.status === 200;
  } catch (e) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function siteOrigin() {
  if (catalogOrigin) return catalogOrigin;
  const candidates = loadHostCandidates() || DEFAULT_MIRRORS;
  for (const c of candidates) {
    if (await probeOrigin(c)) {
      catalogOrigin = c;
      return c;
    }
  }
  catalogOrigin = CATALOG_HOST;
  return CATALOG_HOST;
}

function clientToken() {
  const ts = Math.floor(Date.now() / 1000);
  return `${ts}:${crypto.createHash('md5').update(`${ts}:wefeed-h5api-bff`).digest('hex')}`;
}

function baseHeaders(host, extra = {}) {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Content-Type': 'application/json',
    'Origin': host,
    'Referer': `${host}/`,
    'X-Client-Token': clientToken(),
    'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    ...extra
  };
}

const sessionCache = new Map();
async function getSession(host, forceNew = false) {
  const cached = sessionCache.get(host);
  if (!forceNew && cached && cached.expiresAt > Date.now()) return cached;
  try {
    const res = await fetch(`${host}/wefeed-h5api-bff/country-code`, {
      headers: baseHeaders(host),
      signal: AbortSignal.timeout(8000)
    });
    const xUser = res.headers.get('x-user') || '';
    const setCookie = res.headers.get('set-cookie') || '';
    const token = xUser || (setCookie.match(/token=([^;]+)/) || [])[1] || '';
    const cleanCookie = token ? `token=${token}` : '';
    const entry = { token, cookie: cleanCookie, expiresAt: Date.now() + 2 * 60 * 60 * 1000 };
    sessionCache.set(host, entry);
    return entry;
  } catch (e) {
    return { token: '', cookie: '', expiresAt: 0 };
  }
}

async function bffFetch(url, options = {}, host = new URL(url).origin) {
  const session = await getSession(host);
  const headers = baseHeaders(host, {
    ...(session.token ? { 'X-User': session.token, 'Cookie': session.cookie || `token=${session.token}` } : {}),
    ...(options.headers || {})
  });
  const res = await fetch(url, {
    ...options,
    headers,
    // Hard ceiling on every upstream call: a sick mirror used to hang for
    // 30-90s, which blocked play start and catalog sync alike.
    signal: AbortSignal.timeout(12000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return await res.json();
}

function mapItem(it) {
  if (!it || !it.subjectId || !it.title) return null;
  const subjectId = String(it.subjectId);
  const id = `mb_${subjectId}`;
  const posterRaw = it.cover && typeof it.cover === 'object' ? (it.cover.url || it.cover.thumbnail) : null;
  const poster = typeof posterRaw === 'string' && posterRaw.startsWith('http') ? posterRaw : null;
  const backdrop = (it.stills && typeof it.stills === 'object' && it.stills.url)
    ? it.stills.url
    : (it.trailer && typeof it.trailer === 'object' && it.trailer.cover && it.trailer.cover.url
      ? it.trailer.cover.url
      : null);
  const genres = typeof it.genre === 'string' && it.genre.trim()
    ? it.genre.split(',').map(s => s.trim()).filter(Boolean)
    : ['Movie'];
  const year = it.releaseDate ? String(it.releaseDate).slice(0, 4) : '';
  const releaseTs = it.releaseDate ? new Date(it.releaseDate).getTime() : 0;
  const addedAt = !isNaN(releaseTs) && releaseTs > 0
    ? releaseTs
    : (year ? new Date(`${year}-06-15`).getTime() : Date.now());

  const rawRating = parseFloat(it.imdbRatingValue);
  const rating = !isNaN(rawRating) && rawRating > 0 ? rawRating.toFixed(1) : null;

  return {
    id,
    subjectId,
    title: String(it.title).trim(),
    year,
    releaseDate: it.releaseDate || '',
    addedAt,
    description: typeof it.description === 'string' && it.description.trim()
      ? it.description
      : `Watch ${it.title} online in high definition on VikyFlix MovieBox.`,
    genres: genres.length ? genres : ['Movie'],
    rating: rating || null,
    poster: poster ? `/api/moviebox/poster/${id}` : '/favicon.svg',
    posterUrl: poster || null,
    backdrop: backdrop ? `/api/moviebox/backdrop/${id}` : (poster ? `/api/moviebox/poster/${id}` : '/favicon.svg'),
    backdropUrl: backdrop || poster || null,
    subjectType: parseInt(it.subjectType, 10) || 1,
    videoUrl: null,
    detailPath: it.detailPath || '',
    hasResource: Boolean(it.hasResource),
    corner: typeof it.corner === 'string' ? it.corner.trim() : '',
    countryName: it.countryName || '',
    detailUrl: it.detailPath ? `https://moviebox.ac/moviedetail/${it.detailPath}` : '',
    duration: parseInt(it.duration, 10) || 0,
    formattedDuration: (() => {
      const d = parseInt(it.duration, 10) || 0;
      if (d <= 0) return '';
      const h = Math.floor(d / 3600);
      const m = Math.round((d % 3600) / 60);
      return h > 0 ? `${h}h ${m}m` : `${m}m`;
    })(),
    isSeries: it.subjectType === 2,
    source: 'MovieBox'
  };
}

async function fetchMovieBoxCatalog(force = false) {
  const now = Date.now();
  if (force) {
    await refreshLatestReleases(12);
    return inMemoryCache;
  }
  if (!inMemoryCache && fs.existsSync(CACHE_FILE)) {
    try {
      inMemoryCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (Array.isArray(inMemoryCache.movies)) {
        inMemoryCache.movies.forEach(m => {
          if (!m.addedAt) {
            const rts = m.releaseDate ? new Date(m.releaseDate).getTime() : 0;
            const y = parseInt(m.year, 10) || 0;
            m.addedAt = !isNaN(rts) && rts > 0 ? rts : (y > 1900 ? new Date(`${y}-06-15`).getTime() : Date.now());
          }
        });
        const beforeMerge = inMemoryCache.movies.length;
      inMemoryCache.movies = mergeDubVersions(inMemoryCache.movies);
      if (inMemoryCache.movies.length !== beforeMerge) {
        inMemoryCache.total = inMemoryCache.movies.length;
        inMemoryCache.fetchedAt = new Date().toISOString();
        try { fs.writeFileSync(CACHE_FILE, JSON.stringify(inMemoryCache), 'utf8'); } catch (e) {}
        console.log(`[MovieBox] Merged ${beforeMerge - inMemoryCache.movies.length} dub editions at load.`);
      }
      inMemoryCache.movies = sortCatalogByRecency(inMemoryCache.movies);
      }
      lastFetchTime = now;
      console.log(`[MovieBox] Loaded and recency-sorted ${inMemoryCache.movies?.length || 0} movies from disk cache.`);
    } catch (e) {}
  }
  if (inMemoryCache) {
    // Proactively refresh latest releases in background every 20 minutes
    if (now - lastFetchTime > 20 * 60 * 1000) {
      refreshLatestReleases(15).catch(() => {});
    }
    return inMemoryCache;
  }
  await refreshLatestReleases(15);
  return inMemoryCache;
}

let isRefreshing = false;
function refreshCatalogInBackground() {
  if (isRefreshing) return;
  refreshLatestReleases(15).catch(err => console.warn('[MovieBox] Background refresh error:', err.message));
}

function sortCatalogByRecency(items) {
  const MUSIC_RE = /playlist|\bdj\b|\bmix\b|songs|jukebox|\bfm\b|radio|lyric|love songs|soundtrack|score\b|\bcover\b|reacts|podcast/i;
  const movieScore = (m) =>
    (m.duration >= 2400 ? 4 : m.duration >= 900 ? 2 : 0) +
    (!MUSIC_RE.test(m.title) ? 3 : 0) +
    (m.hasResource ? 1 : 0);

  const getTs = (m) => {
    if (typeof m.addedAt === 'number' && m.addedAt > 0) return m.addedAt;
    if (m.releaseDate) {
      const ts = new Date(m.releaseDate).getTime();
      if (!isNaN(ts) && ts > 0) return ts;
    }
    const y = parseInt(m.year, 10);
    return !isNaN(y) && y > 1900 ? new Date(`${y}-06-15`).getTime() : 0;
  };

  return [...items].sort((a, b) => {
    const scoreA = movieScore(a);
    const scoreB = movieScore(b);
    if (scoreA < 3 && scoreB >= 3) return 1;
    if (scoreB < 3 && scoreA >= 3) return -1;

    const ya = parseInt(a.year, 10) || 0;
    const yb = parseInt(b.year, 10) || 0;
    if (ya !== yb) return yb - ya;

    const ra = parseFloat(a.rating) || 0;
    const rb = parseFloat(b.rating) || 0;
    const hasRa = ra > 0 ? 1 : 0;
    const hasRb = rb > 0 ? 1 : 0;
    if (hasRa !== hasRb) return hasRb - hasRa;

    const da = getTs(a);
    const db = getTs(b);
    if (da !== db) return db - da;

    return rb - ra;
  });
}

/**
 * Resolve a pointer in Nuxt 3 SSR __NUXT_DATA__ payloads.
 */
function resolveNuxtValue(val, data, depth = 0, seen = new Set()) {
  if (depth > 6) return val;
  if (typeof val === 'number' && val >= 0 && val < data.length) {
    if (seen.has(val)) return null;
    seen.add(val);
    const t = data[val];
    if (typeof t === 'object' && t !== null) {
      if (Array.isArray(t)) return t.map(x => resolveNuxtValue(x, data, depth + 1, new Set(seen)));
      const o = {};
      for (const k of Object.keys(t)) o[k] = resolveNuxtValue(t[k], data, depth + 1, new Set(seen));
      return o;
    }
    return t;
  }
  if (typeof val === 'object' && val !== null) {
    if (Array.isArray(val)) return val.map(x => resolveNuxtValue(x, data, depth + 1, seen));
    const o = {};
    for (const k of Object.keys(val)) o[k] = resolveNuxtValue(val[k], data, depth + 1, seen);
    return o;
  }
  return val;
}

/**
 * Scrape a MovieBox SSR listing page (e.g. /web/movie, /web/tv-series).
 * The site's own front-line lineup — genuinely NEW titles — lives here and
 * never appears in the popularity-ordered filter API, so the incremental
 * sync scrapes these pages on every refresh.
 */
async function scrapeListingPage(origin, listingPath) {
  try {
    const res = await fetch(`${origin}${listingPath}`, {
      headers: baseHeaders(origin),
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) return [];
    const html = await res.text();
    const m = html.match(/id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return [];
    const data = JSON.parse(m[1]);
    const out = [];
    for (let i = 0; i < data.length; i++) {
      const raw = data[i];
      if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'subjectId' in raw && 'title' in raw) {
        try {
          const resolved = resolveNuxtValue(raw, data);
          if (!resolved || typeof resolved.title !== 'string' || resolved.title.length < 2) continue;
          const item = mapItem(resolved);
          if (item) out.push(item);
        } catch (e) {}
      }
    }
    return out;
  } catch (e) {
    console.warn(`[MovieBox] Listing scrape ${listingPath} failed:`, e.message);
    return [];
  }
}

/**
 * Stable identity for "the same movie/show in any language edition":
 * normalized title + subject type + release year. Dub editions of an
 * existing title must not be re-added as new rows every sync cycle —
 * that churn was inflating the catalog by ~120 titles per refresh.
 */
function canonicalDubKey(m) {
  const t = normalizeDubKey(m.title);
  let y = parseInt(m.year, 10);
  if (isNaN(y) || y <= 1900) {
    const ry = m.releaseDate ? parseInt(String(m.releaseDate).slice(0, 4), 10) : NaN;
    y = !isNaN(ry) && ry > 1900 ? ry : 0;
  }
  return `${m.subjectType}|${t}|${y || 'unknown'}`;
}

/** Read a card's edition language from its title tag: "Akka [Tamil]" -> Tamil. */
function editionLanguageFromTitle(title) {
  const t = String(title || '');
  const m = t.match(/\[([^\]]+)\]/);
  if (!m) return 'Original';
  return AUDIO_LANGS[m[1].trim().toLowerCase()] || m[1].trim();
}

/** Title+type only — used to catch year-less scraped rows that duplicate
 *  an existing year-carrying catalog entry (front-page scrapes often
 *  arrive without release dates). */
function yearlessDubKey(m) {
  return `${m.subjectType}|${normalizeDubKey(m.title)}`;
}

/**
 * Source "recently added" feed: the filter API sorted by releaseDate with
 * sortType 0 returns titles in the order MovieBox ADDS them (yesterday's
 * arrivals first, regardless of each film's own release year). This is how
 * genuinely new titles like "Sigma" get captured on every cycle instead of
 * waiting for them to climb the popularity pages.
 */
async function refreshLatestFeed(pageCount = 5) {
  const origin = await siteOrigin().catch(() => CATALOG_HOST);
  const existing = Array.isArray(inMemoryCache?.movies) ? inMemoryCache.movies : [];
  const existingMap = new Map();
  for (const item of existing) existingMap.set(String(item.subjectId || item.id), item);

  const canonicalCardMap = new Map();
  for (const item of existing) canonicalCardMap.set(canonicalDubKey(item), item);

  let addedCount = 0;
  let updatedCount = 0;
  for (const section of [{ channelId: 1, subjectType: 1 }, { channelId: 2, subjectType: 2 }]) {
    for (let page = 1; page <= pageCount; page++) {
      let items = [];
      try {
        const body = await bffFetch(`${origin}/wefeed-h5api-bff/subject/filter`, {
          method: 'post',
          body: JSON.stringify({ page, perPage: PAGE_SIZE, channelId: section.channelId, sortBy: 'releaseDate', sortType: 0 })
        });
        items = (body && body.data && body.data.items) || [];
      } catch (e) {
        break;
      }
      if (!items.length) break;
      for (const it of items) {
        const m = mapItem(it);
        if (!m || m.subjectType !== section.subjectType) continue;
        const hasArt = typeof m.posterUrl === 'string' && m.posterUrl.startsWith('http');
        if (!hasArt) continue;
        if (isAudiobook(m) || isAnime(m) || isAdult(m) || isBengali(m) || isUrdu(m) || isNigerian(m) || isFilipino(m)) continue;
        const key = String(m.subjectId || m.id);
        const previous = existingMap.get(key);
        if (previous) {
          m.addedAt = previous.addedAt || m.addedAt;
          m.discoveredAt = previous.discoveredAt || Date.now();
          if ((!m.audioVersions || !m.audioVersions.length) && previous.audioVersions?.length) {
            m.audioVersions = previous.audioVersions;
          }
          if (previous.dubsEnriched) m.dubsEnriched = true;
          if (!m.description || /^Watch .* online in high definition/.test(m.description)) {
            m.description = previous.description || m.description;
          }
          if (JSON.stringify(m) !== JSON.stringify(previous)) updatedCount++;
          existingMap.set(key, m);
          continue;
        }
        // Same title in another language edition: attach as audio, don't add.
        const host = canonicalCardMap.get(canonicalDubKey(m));
        if (host) {
          host.audioVersions = host.audioVersions || [];
          if (!host.audioVersions.some(a => String(a.subjectId) === String(m.subjectId))) {
            host.audioVersions.push({
              subjectId: m.subjectId,
              language: editionLanguageFromTitle(m.title),
              detailPath: m.detailPath
            });
            updatedCount++;
          }
          continue;
        }
        m.discoveredAt = Date.now();
        addedCount++;
        canonicalCardMap.set(canonicalDubKey(m), m);
        existingMap.set(key, m);
      }
    }
  }

  if (!addedCount && !updatedCount) return { addedCount: 0, total: existing.length };

  const merged = mergeDubVersions(Array.from(existingMap.values()));
  for (const m of merged) {
    if (!m.addedAt) {
      const rts = m.releaseDate ? new Date(m.releaseDate).getTime() : 0;
      const y = parseInt(m.year, 10) || 0;
      m.addedAt = !isNaN(rts) && rts > 0 ? rts : (y > 1900 ? new Date(`${y}-06-15`).getTime() : Date.now());
    }
  }
  const sorted = sortCatalogByRecency(merged);
  inMemoryCache = { ...(inMemoryCache || {}), fetchedAt: new Date().toISOString(), total: sorted.length, movies: sorted };
  if (inMemoryCache.categories) {
    const hasPoster = (m) => Boolean(m.posterUrl);
    const MUSIC_RE = /playlist|\bdj\b|\bmix\b|songs|jukebox|\bfm\b|radio|lyric|love songs|soundtrack|score\b|\bcover\b|reacts|podcast/i;
    inMemoryCache.categories = {
      ...inMemoryCache.categories,
      trending: sorted.filter(m => hasPoster(m) && !MUSIC_RE.test(m.title) && m.duration >= 1800).slice(0, 36)
    };
  }
  lastFetchTime = Date.now();
  try {
    await fs.promises.writeFile(CACHE_FILE, JSON.stringify(inMemoryCache), 'utf8');
    console.log(`[MovieBox] Latest feed synced: ${addedCount} new, ${updatedCount} updated (total: ${sorted.length}).`);
  } catch (e) {
    console.warn('[MovieBox] Could not write cache after latest feed:', e.message);
  }
  return { addedCount, updatedCount, total: sorted.length };
}

async function refreshLatestReleases(pageCount = 10) {
  if (isRefreshing) return false;
  isRefreshing = true;
  try {
    const origin = await siteOrigin().catch(() => CATALOG_HOST);
    console.log(`[MovieBox] Refreshing newest releases from ${origin} (pages 1..${pageCount})...`);
    const newItems = [];
    const seenNew = new Set();

    for (const section of [
      { channelId: 1, subjectType: 1, label: 'Movies' },
      { channelId: 2, subjectType: 2, label: 'TV Series' }
    ]) {
      for (let page = 1; page <= pageCount; page++) {
        try {
          const body = await bffFetch(`${origin}/wefeed-h5api-bff/subject/filter`, {
            method: 'post',
            body: JSON.stringify({ page, perPage: PAGE_SIZE, channelId: section.channelId })
          });
          const items = (body && body.data && body.data.items) || [];
          if (!items.length) break;
          for (const it of items) {
            const m = mapItem(it);
            // A "new release" needs real artwork — artless entries would
            // surface as placeholder posters in the New Releases shelf.
            const hasArt = m && typeof m.posterUrl === 'string' && m.posterUrl.startsWith('http');
            if (m && hasArt && m.subjectType === section.subjectType && !seenNew.has(m.subjectId) &&
                !isAudiobook(m) && !isAnime(m) && !isAdult(m) && !isBengali(m) && !isUrdu(m) && !isNigerian(m) && !isFilipino(m)) {
              seenNew.add(m.subjectId);
              newItems.push(m);
            }
          }
        } catch (e) {
          console.warn(`[MovieBox] Page ${page} (${section.label}) fetch failed:`, e.message);
        }
      }
    }

    // The filter API is popularity-ordered, so truly new titles never show up
    // in its pages. The SSR listing pages carry the site's actual new lineup —
    // scrape both and merge them into the incremental pool.
    const listingNew = [
      ...await scrapeListingPage(origin, '/web/movie'),
      ...await scrapeListingPage(origin, '/web/tv-series')
    ];
    let listingAdded = 0;
    for (const item of listingNew) {
      if (!item || seenNew.has(item.subjectId)) continue;
      const expectedType = item.subjectType === 2 ? 2 : 1;
      if (item.subjectType !== expectedType) continue;
      if (typeof item.posterUrl !== 'string' || !item.posterUrl.startsWith('http')) continue;
      if (isAudiobook(item) || isAnime(item) || isAdult(item) || isBengali(item) || isUrdu(item) || isNigerian(item) || isFilipino(item)) continue;
      seenNew.add(item.subjectId);
      newItems.push(item);
      listingAdded++;
    }
    if (listingAdded > 0) {
      console.log(`[MovieBox] Listing scrape: ${listingAdded} fresh titles captured from the site front pages.`);
    }

    if (!newItems.length) {
      console.log('[MovieBox] No items received during incremental refresh.');
      return false;
    }

    // Merge newly fetched releases with existing inMemoryCache
    const existing = Array.isArray(inMemoryCache?.movies) ? inMemoryCache.movies : [];
    const existingMap = new Map();
    for (const item of existing) {
      existingMap.set(String(item.subjectId || item.id), item);
    }

    const canonicalCardMap = new Map();
    const yearlessCardMap = new Map();
    for (const item of existing) {
      canonicalCardMap.set(canonicalDubKey(item), item);
      yearlessCardMap.set(yearlessDubKey(item), item);
    }

    let addedCount = 0;
    let updatedCount = 0;
    const fingerprint = (m) => JSON.stringify({
      title: m.title,
      year: m.year,
      releaseDate: m.releaseDate,
      rating: m.rating,
      posterUrl: m.posterUrl,
      backdropUrl: m.backdropUrl,
      description: m.description,
      genres: m.genres,
      duration: m.duration,
      subjectType: m.subjectType,
      detailPath: m.detailPath,
      corner: m.corner,
      countryName: m.countryName,
      audioVersions: m.audioVersions,
      hasResource: m.hasResource
    });
    for (const item of newItems) {
      const key = String(item.subjectId || item.id);
      const previousItem = existingMap.get(key);
      if (!previousItem) {
        // Same title+type already catalogued under another edition id
        // (dub variants share one row) — skip, don't re-add every cycle.
        // Year-less scraped rows match any existing year for the same title.
        const itemYear = (parseInt(item.year, 10) > 1900)
          || (item.releaseDate && parseInt(String(item.releaseDate).slice(0, 4), 10) > 1900);
        const isDup = canonicalCardMap.has(canonicalDubKey(item))
          || (!itemYear && yearlessCardMap.has(yearlessDubKey(item)));
        if (isDup) {
          // Attach the edition to the existing card instead of dropping it.
          const host = canonicalCardMap.get(canonicalDubKey(item))
            || (!itemYear ? yearlessCardMap.get(yearlessDubKey(item)) : null);
          if (host) {
            host.audioVersions = host.audioVersions || [];
            if (!host.audioVersions.some(a => String(a.subjectId) === String(item.subjectId))) {
              host.audioVersions.push({
                subjectId: item.subjectId,
                language: editionLanguageFromTitle(item.title),
                detailPath: item.detailPath
              });
              updatedCount++;
            }
          }
          continue;
        }
        item.discoveredAt = Date.now();
        addedCount++;
        canonicalCardMap.set(canonicalDubKey(item), item);
        yearlessCardMap.set(yearlessDubKey(item), item);
      } else {
        // Preserve the first-seen recency while allowing updated genre, poster,
        // rating and edition metadata to reach devices through the catalog.
        item.addedAt = previousItem.addedAt || item.addedAt;
        item.discoveredAt = previousItem.discoveredAt || Date.now();
        // A re-scraped row arrives bare — never let it wipe the enriched
        // audio editions or the enrichment marker from the live card.
        if ((!item.audioVersions || !item.audioVersions.length) && previousItem.audioVersions?.length) {
          item.audioVersions = previousItem.audioVersions;
        }
        if (previousItem.dubsEnriched) item.dubsEnriched = true;
        if (fingerprint(previousItem) !== fingerprint(item)) updatedCount++;
      }
      existingMap.set(key, item);
    }

    // No genuinely new titles? Then there is nothing to sync: keep the cache
    // byte-identical so devices get a 304 instead of re-downloading megabytes,
    // and "new releases" only appear when the catalog actually changed.
    if (addedCount === 0 && updatedCount === 0) {
      console.log('[MovieBox] Sync check complete — no new titles since last refresh.');
      // Nothing new upstream — ideal moment to discover missing editions.
      enrichEditionSweep().catch(() => {});
      return { addedCount: 0, total: existing.length };
    }

    const merged = mergeDubVersions(Array.from(existingMap.values()));
    for (const m of merged) {
      if (!m.addedAt) {
        const rts = m.releaseDate ? new Date(m.releaseDate).getTime() : 0;
        const y = parseInt(m.year, 10) || 0;
        m.addedAt = !isNaN(rts) && rts > 0 ? rts : (y > 1900 ? new Date(`${y}-06-15`).getTime() : Date.now());
      }
    }
    const sorted = sortCatalogByRecency(merged);

    const MUSIC_RE = /playlist|\bdj\b|\bmix\b|songs|jukebox|\bfm\b|radio|lyric|love songs|soundtrack|score\b|\bcover\b|reacts|podcast/i;
    const hasPoster = (m) => Boolean(m.posterUrl);
    const categories = {
      trending: sorted.filter(m => hasPoster(m) && !MUSIC_RE.test(m.title) && m.duration >= 1800).slice(0, 36),
      action: sorted.filter(m => m.genres.some(g => /action|adventure|crime/i.test(g))).slice(0, 24),
      drama: sorted.filter(m => m.genres.some(g => /drama|romance|thriller/i.test(g))).slice(0, 24),
      comedy: sorted.filter(m => m.genres.some(g => /comedy|animation/i.test(g))).slice(0, 24),
      series: sorted.filter(m => m.subjectType === 2).slice(0, 24),
      topRated: sorted.filter(hasPoster).sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating)).slice(0, 24)
    };

    const banners = categories.trending.slice(0, 6).map(m => ({
      title: m.title,
      image: m.poster,
      movieId: m.id,
      subjectId: m.subjectId,
      description: m.description,
      rating: m.rating,
      year: m.year
    }));

    inMemoryCache = {
      source: origin,
      fetchedAt: new Date().toISOString(),
      total: sorted.length,
      banners,
      categories,
      movies: sorted
    };
    lastFetchTime = Date.now();

    try {
      await fs.promises.writeFile(CACHE_FILE, JSON.stringify(inMemoryCache), 'utf8');
      console.log(`[MovieBox] Incremental update saved: ${addedCount} new title(s), ${updatedCount} existing title(s) refreshed (total catalog: ${sorted.length}).`);
    } catch (e) {
      console.warn('[MovieBox] Could not write cache file:', e.message);
    }

    // Discover missing audio editions in the background after every sync.
    enrichEditionSweep().catch(() => {});
    return { addedCount, updatedCount, total: sorted.length };
  } catch (err) {
    console.error('[MovieBox] refreshLatestReleases error:', err.message);
    return false;
  } finally {
    isRefreshing = false;
  }
}

function isAudiobook(m) {
  const genres = (m.genres || []).map(g => g.toLowerCase());
  return genres.some(g => /audiobook|erotic audio|dj mix|podcast/i.test(g));
}

function isAdult(m) {
  const genres = (m.genres || []).map(g => g.toLowerCase());
  return genres.some(g => /adult|erotic/i.test(g));
}

// Filipino/Tagalog content (Vivamax-style mature dramas). Their metadata is
// often blank — genre "Drama", no country — so the genre-based adult filter
// can't see them and English marker words never appear in native titles.
// Detect Tagalog grammar instead: ang / ng / mga and distinctive nouns.
function isFilipino(m) {
  if (!m) return false;
  const title = String(m.title || '');
  const desc = String(m.description || '');
  const country = String(m.countryName || '');
  if (/philippines|filipino|tagalog/i.test(country)) return true;
  if (/(philippines|filipino|tagalog|pinoy|vivaone|vivamax|teleserye)/i.test(title) ||
      /(philippines|filipino|tagalog|pinoy|vivaone|vivamax|teleserye)/i.test(desc)) return true;
  if (filipinoTitleScore(title) > 0) return true;
  return false;
}

function isBengali(m) {
  if (!m) return false;
  const title = String(m.title || '');
  const desc = String(m.description || '');
  const country = String(m.countryName || '');
  const genres = (m.genres || []).map(g => (typeof g === 'string' ? g : g.name || '')).join(' ');
  // 1. Explicit Bengali / Bangla words in title, description, or genres
  if (/\b(bengali|bangla)\b/i.test(title) || /\b(bengali|bangla)\b/i.test(desc) || /\b(bengali|bangla)\b/i.test(genres)) return true;
  // 2. Unicode Bengali script (U+0980 to U+09FF)
  if (/[\u0980-\u09FF]/.test(title) || /[\u0980-\u09FF]/.test(desc)) return true;
  // 3. Country of origin Bangladesh
  if (/bangladesh/i.test(country)) return true;
  return false;
}

function isUrdu(m) {
  if (!m) return false;
  const title = String(m.title || '');
  const desc = String(m.description || '');
  const country = String(m.countryName || '');
  const genres = (m.genres || []).map(g => (typeof g === 'string' ? g : g.name || '')).join(' ');
  // 1. Explicit Urdu tags in title, description, or genres
  if (/\burdu\b/i.test(title) || /\burdu\b/i.test(desc) || /\burdu\b/i.test(genres)) return true;
  // 2. Country of origin Pakistan (unless Indian release like The Greatest Rivalry)
  if (/pakistan/i.test(country) && !/india/i.test(title)) return true;
  // 3. Audio versions tagged as Urdu
  return false;
}

function isNigerian(m) {
  if (!m) return false;
  const country = String(m.countryName || m.country || '').toLowerCase();
  if (country.includes('nigeria') || country === 'ng' || country === 'nga' || country.includes('ghana') ||
      country.includes('ivory coast') || country.includes("côte d'ivoire") || country.includes('congo') || country.includes('cameroon') ||
      country.includes('south africa') || country === 'za' || country === 'zaf' ||
      country.includes('kenya') || country.includes('tanzania') || country.includes('uganda') ||
      country.includes('zambia') || country.includes('zimbabwe') || country.includes('senegal') ||
      country.includes('ethiopia') || country.includes('mozambique') || country.includes('botswana') ||
      country.includes('namibia') || country.includes('rwanda') || country.includes('somalia')) return true;
  if (country.includes('indonesia') || country === 'id' || country === 'idn') return true;
  if (country.includes('philippines') || country.includes('filipino') || country.includes('tagalog') || country === 'ph' || country === 'phl') return true;

  const title = String(m.title || '').toLowerCase();
  const desc = String(m.description || '').toLowerCase();
  const genres = (m.genres || []).map(g => (typeof g === 'string' ? g : g.name || '')).join(' ').toLowerCase();
  const allText = `${title} ${desc} ${genres}`;

  if (/\b(nollywood|yoruba|igbo|hausa|naija|nigerian|ghallywood|african movie|bongo movie|south african|kenyan|tanzanian)\b/.test(allText)) return true;
  if (/\b(indonesia|indonesian|bahasa|sinetron)\b/.test(allText)) return true;
  if (nigerianTitleScore(title) > 0) return true;
  if (/\b(philippines|filipino|tagalog|pinoy|vivaone|vivamax|teleserye|calapan)\b/.test(allText)) return true;

  // Punjabi / Marathi titles (title text only — a Punjabi DUB on a Hindi
  // blockbuster must never remove the film itself)
  if (/\b(punjabi|pollywood|marathi)\b/.test(allText)) return true;
  if (/[\u0A00-\u0A7F]/.test(title) || /[\u0A00-\u0A7F]/.test(desc)) return true;

  return false;
}
const isExcludedForeign = isNigerian;

/**
 * Anime-tagged rows and Japanese/Chinese anime franchises are filtered out —
 * the user requested removing anime while preserving western & family animation
 * (Disney, Pixar, Marvel, DC, Arcane, Rick and Morty, Indian animation like Hanuman, etc.).
 */
const ANIME_FRANCHISE_REGEX = new RegExp([
  '\\banime\\b', '\\bmanga\\b', '\\bisekai\\b', '\\bdonghua\\b',
  'akame ga kill', '\\bjojo\\b', 'naruto', 'boruto', 'one piece', 'dragon ball',
  'demon slayer', 'kimetsu', 'jujutsu', 'attack on titan', 'shingeki',
  '\\bbleach\\b', 'death note', 'hero academia', 'hunter x hunter', 'tokyo ghoul',
  'chainsaw man', 'tokyo revengers', 'fullmetal', 'haikyu', 'gintama',
  'evangelion', 'code geass', 'fate/zero', 'fate/stay', 'black clover',
  'fairy tail', 'steins;gate', 'vinland saga', 'spy x family', 'mob psycho',
  're:zero', 'bungo stray dogs', 'dr. stone', 'blue lock',
  'hell\'s paradise', 'kaiju no. 8', 'frieren', 'dandadan', 'lookism',
  'wind breaker', 'solo leveling', 'one punch man', 'sword art online',
  'berserk', 'inuyasha', 'yu yu hakusho', 'gundam',
  'sailor moon', 'digimon', 'pokemon', 'yu-gi-oh', 'beyblade',
  'martial peak', 'battle through the heavens', 'a mortal\'s journey',
  'dragon prince yuan', 'world of immortals', 'swallowed star',
  'perfect world', 'soul land', 'tales of demons', 'legend of xianwu',
  'slay the gods', 'god of ten thousand', 'qin\'s moon', 'tales of herding',
  'demon\'s ascension', 'my journey in an alternate world', 'honey lemon soda',
  'i parry everything', 'to be hero x', 'seduced by my best friend',
  'girls bravo', 'tokimeki tonight', 'yamada-kun', 'aki sora',
  'kill blue', 'caged character', 'false memory', 'fog hill of five elements',
  'smile down the runway', 'lord of the mysteries', 'lord of mysteries',
  'aotu', 'scissor seven', 'rpg densetsu'
].join('|'), 'i');

// Unambiguous animation franchises matched on TITLE ALONE — scraped entries
// often arrive with empty genre fields, so the genre gate can't catch them.
const ANIME_TITLE_ONLY_REGEX = new RegExp([
  'doraemon', 'doremon', 'shin chan', 'crayon shin', 'detective conan',
  'case closed', 'ben 10', 'tom and jerry', 'scooby-doo', 'scooby doo',
  'oggy', 'motu patlu', 'chhota bheem', 'grizzy', 'baby shark',
  'peppa pig', 'mr. bean animated', 'bananas in pyjamas', 'shinchan',
  'avatar: the last airbender', 'avatar the last airbender', 'the legend of korra',
  'paramavatar', 'tenali raman'
].join('|'), 'i');

function isAnime(m) {
  const genres = (m.genres || m.genre || []).map(g => (typeof g === 'string' ? g : g.name || '').toLowerCase());
  const isAnim = genres.includes('animation');
  const title = String(m.title || '');
  const country = String(m.countryName || '');

  // The owner never watches animation content (western or anime) — purge all
  if (isAnim) return true;

  // 0. Unambiguous animation franchises by title alone (genre data is often missing)
  if (ANIME_TITLE_ONLY_REGEX.test(title)) return true;

  // 1. Explicit genre anime
  if (genres.some(g => /\banime\b/i.test(g))) return true;

  // 2. Animated title matching anime/donghua keywords
  if (isAnim && ANIME_FRANCHISE_REGEX.test(title)) return true;

  // 3. Animation from Japan
  if (isAnim && (country === 'Japan' || /japan/i.test(country))) return true;

  // 4. Standalone franchise match even if genre list missed animation tag
  if (['naruto', 'one piece', 'dragon ball', 'demon slayer', 'jujutsu kaisen', 'attack on titan', 'solo leveling', 'akame ga kill'].some(k => new RegExp('\\b' + k + '\\b', 'i').test(title))) {
    return true;
  }

  return false;
}

function parseAudioLabel(title) {
  const m = String(title).match(/[[(]([^\])]+)[\])]/);
  if (m) return AUDIO_LANGS[m[1].trim().toLowerCase()] || null;
  const tail = TRAILING_LANG_RE.exec(String(title));
  if (tail) return AUDIO_LANGS[tail[1].toLowerCase()] || null;
  return null;
}

const QUALITY_RE = /^(cam|camrip|ts|hdtv|hd|4k|uhd|hdrip|webrip|web[ -]?dl|hdr|bluray|blu[ -]?ray|1080p|720p|480p|360p|hq|dubbed)$/i;

function normalizeDubKey(title) {
  let t = String(title || '');
  // Drop only bracketed LANGUAGE or QUALITY tags; keep subtitles, years and
  // other distinguishing text so different films/sequels don't collapse.
  t = t.replace(/[[(]([^\]\)]{1,32})[\])]/g, (full, inner) => {
    const w = String(inner).trim();
    const isLang = /^(english|hindi|tamil|telugu|malayalam|kannada|bengali|bangla|punjabi|marathi|japanese|korean|mandarin|chinese|cantonese|spanish|french|german|italian|turkish|russian|arabic|portuguese|filipino|tagalog|indonesian|vietnamese|thai|urdu|dutch|polish|original|dual|dual audio)$/i.test(w);
    if (isLang || /^(cam|camrip|ts|hdtv|hd|4k|uhd|hdrip|webrip|web[ -]?dl|hdr|bluray|blu[ -]?ray|1080p|720p|480p|360p|hq|dubbed|full movie|full episode|full episodes|full series|complete series|movie|web series|tv series)$/i.test(w)) return ' ';
    return full;
  });
  // Trailing language word (no brackets).
  t = t.replace(/\s*[-–]?\s*\b(english|hindi|tamil|telugu|malayalam|kannada|bengali|punjabi|marathi|japanese|korean|mandarin|chinese|cantonese|spanish|french|german|italian|turkish|russian|arabic|portuguese|filipino|tagalog|indonesian|vietnamese|thai|urdu|dutch|polish)\s*(dubbed)?\s*$/i, '');
  return t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function mergeDubVersions(list) {
  const groups = new Map();
  for (const m of list) {
    const base = normalizeDubKey(m.title);
    if (!base) continue;
    const key = `${m.subjectType}|${base}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }

  const yearOf = (m) => {
    const y = parseInt(m.year, 10);
    if (!isNaN(y) && y > 1900) return y;
    const r = m.releaseDate ? parseInt(String(m.releaseDate).slice(0, 4), 10) : NaN;
    return !isNaN(r) && r > 1900 ? r : 0;
  };

  const dropped = new Set();
  for (const members of groups.values()) {
    if (members.length < 2) continue;

    // Cluster by release year so a same-titled film from another year (or
    // sequel/dub of another era) can't block or hijack the merge.
    const buckets = new Map();
    for (const m of members) {
      const y = yearOf(m);
      const k = y > 1900 ? y : 'unknown';
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(m);
    }
    const years = [...buckets.keys()].filter(k => k !== 'unknown').sort((a, b) => a - b);
    const used = new Set();
    const clusters = [];
    for (const y of years) {
      if (used.has(y)) continue;
      const cl = [...buckets.get(y)];
      used.add(y);
      for (const y2 of years) {
        if (used.has(y2) || Math.abs(y2 - y) > 1) continue;
        cl.push(...buckets.get(y2));
        used.add(y2);
      }
      clusters.push(cl);
    }
    // Unknown-year rows are unsafe to collapse by title alone: two unrelated
    // works can share a name. Only merge an unknown-year cluster when every
    // member explicitly identifies a distinct audio language in its title.
    if (buckets.has('unknown')) {
      const unknown = buckets.get('unknown');
      const labeled = unknown.length > 1 && unknown.every(m => parseAudioLabel(m.title));
      if (labeled) clusters.push(unknown);
    }

    for (const cluster of clusters) {
      if (cluster.length < 2) continue;

      const primary =
        cluster.find(m => !parseAudioLabel(m.title)) ||
        cluster.find(m => Array.isArray(m.audioVersions) && m.audioVersions.length) ||
        cluster[0];

      const primaryYear = yearOf(primary);
      const kin = cluster.filter(m => {
        const y = yearOf(m);
        return !primaryYear || !y || Math.abs(y - primaryYear) <= 1;
      });
      if (kin.length < 2) continue;

      const versions = [];
      const addEdition = (lang, subjectId, detailPath, title) => {
        if (versions.some(v => v.language === lang)) return;
        versions.push({ language: lang, subjectId, detailPath, title });
      };
      // Preserve any editions already merged into the primary.
      if (Array.isArray(primary.audioVersions)) {
        for (const v of primary.audioVersions) addEdition(v.language, v.subjectId, v.detailPath, v.title);
      }
      for (const m of kin) {
        const lang = m.corner && AUDIO_LANGS[m.corner.toLowerCase()]
          ? AUDIO_LANGS[m.corner.toLowerCase()]
          : (parseAudioLabel(m.title) || 'Original');
        addEdition(lang, m.subjectId, m.detailPath, m.title);
      }
      for (const m of cluster) {
        if (kin.includes(m)) continue;
        const l = m.corner && AUDIO_LANGS[m.corner.toLowerCase()] ? AUDIO_LANGS[m.corner.toLowerCase()] : null;
        if (l && !versions.some(v => v.language === l)) addEdition(l, m.subjectId, m.detailPath, m.title);
      }

      for (const m of cluster) if (m !== primary && kin.includes(m)) dropped.add(m.id);
      if (versions.length > 1) primary.audioVersions = versions;
    }
  }

  return list.filter(m => !dropped.has(m.id));
}

async function buildCatalog() {
  const now = Date.now();
  const movies = [];
  const seen = new Set();
  const previousCount = Array.isArray(inMemoryCache?.movies) ? inMemoryCache.movies.length : 0;

  const origin = await siteOrigin().catch(() => CATALOG_HOST);

  let pageFailures = 0;
  for (const section of [
    { channelId: 1, subjectType: 1, maxPages: 170, label: 'Movies' },
    { channelId: 2, subjectType: 2, maxPages: 170, label: 'TV Series' }
  ]) {
    for (let page = 1; page <= section.maxPages; page++) {
      let items = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const body = await bffFetch(`${origin}/wefeed-h5api-bff/subject/filter`, {
            method: 'post',
            body: JSON.stringify({ page, perPage: PAGE_SIZE, channelId: section.channelId })
          });
          items = (body && body.data && body.data.items) || [];
          break;
        } catch (e) {
          if (attempt === 2) console.warn(`[MovieBox] Page ${page} (${section.label}) attempt ${attempt + 1} failed:`, e.message);
          await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
        }
      }

      if (!items) {
        pageFailures++;
        continue;
      }

      if (!items.length) {
        console.log(`[MovieBox] ${section.label} listing exhausted at page ${page}.`);
        break;
      }

      for (const it of items) {
        const m = mapItem(it);
        if (m && m.subjectType === section.subjectType && !seen.has(m.subjectId) && !isAudiobook(m) && !isAnime(m) && !isAdult(m) && !isBengali(m) && !isUrdu(m) && !isNigerian(m) && !isFilipino(m)) {
          seen.add(m.subjectId);
          movies.push(m);
        }
      }

      if (page % 10 === 0 || page === section.maxPages) {
        console.log(`[MovieBox] ${section.label} page ${page}/${section.maxPages}: accumulated ${movies.length} titles...`);
      }
    }
  }

  if (!movies.length) {
    return false;
  }

  if (pageFailures >= 35) {
    console.warn(`[MovieBox] Rejected catalog rebuild: ${pageFailures} page failure(s). Keeping existing catalog.`);
    return false;
  }

  const merged = mergeDubVersions(movies);
  const MUSIC_RE = /playlist|\bdj\b|\bmix\b|songs|jukebox|\bfm\b|radio|lyric|love songs|soundtrack|score\b|\bcover\b|reacts|podcast/i;
  const movieScore = (m) =>
    (m.duration >= 2400 ? 4 : m.duration >= 900 ? 2 : 0) +
    (!MUSIC_RE.test(m.title) ? 3 : 0) +
    (m.hasResource ? 1 : 0);

  const sorted = sortCatalogByRecency(merged);

  if (previousCount >= 500 && sorted.length < previousCount * 0.6) {
    console.warn(`[MovieBox] Rejected partial catalog rebuild (${sorted.length} vs ${previousCount} cached titles). Keeping existing catalog.`);
    return false;
  }

  const hasPoster = (m) => Boolean(m.posterUrl);
  const categories = {
    trending: sorted.filter(m => hasPoster(m) && !MUSIC_RE.test(m.title) && m.duration >= 1800).slice(0, 36),
    action: sorted.filter(m => m.genres.some(g => /action|adventure|crime/i.test(g))).slice(0, 24),
    drama: sorted.filter(m => m.genres.some(g => /drama|romance|thriller/i.test(g))).slice(0, 24),
    comedy: sorted.filter(m => m.genres.some(g => /comedy|animation/i.test(g))).slice(0, 24),
    series: sorted.filter(m => m.subjectType === 2).slice(0, 24),
    topRated: sorted.filter(hasPoster).sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating)).slice(0, 24)
  };

  const banners = categories.trending.slice(0, 6).map(m => ({
    title: m.title,
    image: m.poster,
    movieId: m.id,
    subjectId: m.subjectId,
    description: m.description,
    rating: m.rating,
    year: m.year
  }));

  inMemoryCache = {
    source: origin,
    fetchedAt: new Date().toISOString(),
    total: sorted.length,
    banners,
    categories,
    movies: sorted
  };
  lastFetchTime = now;

  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(inMemoryCache), 'utf8');
    console.log(`[MovieBox] Cached ${sorted.length} movies to ${CACHE_FILE}`);
  } catch (e) {
    console.warn('[MovieBox] Could not write cache file:', e.message);
  }

  return true;
}

async function findMovieBoxItem(id) {
  const catalog = await fetchMovieBoxCatalog();
  const rawId = String(id || '');
  const cleanId = rawId.replace(/^mb_/, '');
  const movie = (catalog.movies || []).find(m => 
    m.id === id || 
    String(m.id || '').replace(/^mb_/, '') === cleanId || 
    String(m.subjectId || '') === cleanId ||
    String(m.subjectId || '') === rawId ||
    (m.detailPath && m.detailPath === rawId)
  ) || null;
  return { movie };
}

function getMovieBoxCatalogSnapshot() {
  return Array.isArray(inMemoryCache?.movies) ? inMemoryCache.movies : null;
}

// Tiny payload the apps poll to detect genuinely new releases before pulling
// the (multi-megabyte) catalog again.
function getMovieBoxCatalogMeta() {
  return {
    total: Array.isArray(inMemoryCache?.movies) ? inMemoryCache.movies.length : 0,
    fetchedAt: inMemoryCache?.fetchedAt || null
  };
}

const seriesResourceCache = new Map();

async function fetchSeriesSeasons(detailPathOrSubjectId) {
  const raw = String(detailPathOrSubjectId || '').trim();
  if (!raw) return [];
  const cached = seriesResourceCache.get(raw);
  if (cached && (Date.now() - cached.fetchedAt) < 30 * 60 * 1000) return cached.seasons;

  const cleanSubjectId = raw.replace(/^mb_/, '');
  const isSubjectId = /^\d+$/.test(cleanSubjectId);
  const detailUrl = isSubjectId
    ? `https://h5-api.aoneroom.com/wefeed-h5api-bff/detail?subjectId=${encodeURIComponent(cleanSubjectId)}`
    : `https://h5-api.aoneroom.com/wefeed-h5api-bff/detail?detailPath=${encodeURIComponent(raw)}`;

  let body = null;
  try {
    body = await bffFetch(detailUrl);
  } catch (e) {
    // If detailPath failed, try subjectId fallback if possible
    if (!isSubjectId && cleanSubjectId && /^\d+$/.test(cleanSubjectId)) {
      try {
        body = await bffFetch(`https://h5-api.aoneroom.com/wefeed-h5api-bff/detail?subjectId=${encodeURIComponent(cleanSubjectId)}`);
      } catch (e2) {}
    }
  }

  const res = (body && body.data && body.data.resource) || {};
  const seasons = Array.isArray(res.seasons) ? res.seasons.filter(s => s && s.maxEp > 0) : [];
  seriesResourceCache.set(raw, { seasons, fetchedAt: Date.now() });
  return seasons;
}

async function resolveMovieBoxStream(subjectId, detailPath, se = null, ep = null, wantRes = null) {
  const __t0 = Date.now();
  const __log = (m) => console.log(`[StreamTiming] +${Date.now() - __t0}ms ${m}`);
  __log(`start ${subjectId}`);
  let isEpisode = se != null && ep != null && Number(se) > 0 && Number(ep) > 0;
  
  // Auto-resolve missing detailPath or series status if not specified
  if ((!detailPath || !isEpisode) && subjectId) {
    try {
      const cleanSubId = String(subjectId).replace(/^mb_/, '');
      const info = await bffFetch(`https://h5-api.aoneroom.com/wefeed-h5api-bff/detail?subjectId=${encodeURIComponent(cleanSubId)}`);
      if (info && info.data && info.data.subject) {
        if (!detailPath && info.data.subject.detailPath) {
          detailPath = info.data.subject.detailPath;
        }
        if (!isEpisode && info.data.subject.subjectType === 2) {
          se = 1;
          ep = 1;
          isEpisode = true;
        }
      }
      __log('detail(subjectId) done');
    } catch (e) { __log('detail(subjectId) FAILED: ' + e.message); }
  }

  const resTag = ['360', '480', '720', '1080'].includes(String(wantRes)) ? String(wantRes) : null;
  const cacheKey = `${isEpisode ? `${subjectId}:${se}:${ep}` : subjectId}${resTag ? `@${resTag}` : ''}`;
  const cached = streamCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const failedAt = streamFailAt.get(cacheKey);
  if (failedAt && Date.now() - failedAt < STREAM_FAIL_TTL_MS) {
    throw new Error('This title has no playable stream (checked recently)');
  }
  if (!detailPath) {
    streamFailAt.set(cacheKey, Date.now());
    throw new Error('No detail path for this title');
  }

  try {
    await bffFetch(`https://h5-api.aoneroom.com/wefeed-h5api-bff/detail?detailPath=${encodeURIComponent(detailPath)}`);
    __log('detail(detailPath) warm done');
  } catch (e) { __log('detail(detailPath) warm FAILED: ' + e.message); }

  const playHosts = [PLAY_HOST, 'https://hifimove.io', 'https://moviebox.ph', 'https://moviebox.ac'];
  // Race every play host concurrently. The old sequential loop could stall
  // 12s per dead host (up to ~48s) before a healthy one answered — the main
  // reason play start felt slow. Concurrent racing bounds the wall time at
  // the single slowest host (~12s) and typically resolves in 1-3s.
  const attempts = await Promise.allSettled(playHosts.map(async (host) => {
    const playUrl = `${host}/wefeed-h5api-bff/subject/play` +
      `?subjectId=${encodeURIComponent(subjectId)}&se=${isEpisode ? se : 0}&ep=${isEpisode ? ep : 0}` +
      `&detailPath=${encodeURIComponent(detailPath)}` +
      `&streamSignType=1&supportCodecs%5Bhevc%5D=1&supportCodecs%5Bh264%5D=1`;
    const referer = isEpisode
      ? `${host}/spa/videoPlayPage/series/${detailPath}?id=${subjectId}&se=${se}&ep=${ep}`
      : `${host}/spa/videoPlayPage/movies/${detailPath}?id=${subjectId}`;
    return { host, body: await bffFetch(playUrl, { headers: { Referer: referer } }, host) };
  }));
  const good = attempts
    .filter(r => r.status === 'fulfilled' && r.value && r.value.body)
    .map(r => r.value);
  __log('play hosts raced, good=' + good.length);
  const withStreams = good.find(g => g.body?.data?.streams?.length);
  let body = withStreams ? withStreams.body : (good[0] ? good[0].body : null);
  if (!body) {
    streamFailAt.set(cacheKey, Date.now());
    const rejected = attempts.find(r => r.status === 'rejected');
    throw (rejected && rejected.reason) || new Error('Stream request failed');
  }
  const data = body && body.data;
  const streams = (data && data.streams) || [];

  if (!data || !data.hasResource || !streams.length) {
    streamFailAt.set(cacheKey, Date.now());
    throw new Error(data && data.vipLocked ? 'Stream is VIP locked' : 'No stream resource for this title');
  }

  const byRes = (r) => streams.find(s => String(s.resolutions) === r && s.url);
  let picked = null;
  if (resTag) {
    const ladder = ['1080', '720', '480', '360'];
    const idx = ladder.indexOf(resTag);
    for (let i = idx; i < ladder.length; i++) {
      picked = byRes(ladder[i]);
      if (picked) break;
    }
    if (!picked) {
      for (let i = idx - 1; i >= 0; i--) {
        picked = byRes(ladder[i]);
        if (picked) break;
      }
    }
  }
  if (!picked) {
    picked = byRes('720') || byRes('1080') || byRes('480') || streams[0];
  }

  const entry = {
    url: picked.url,
    streamUrl: picked.url,
    resolution: picked.resolutions,
    format: picked.format,
    availableResolutions: streams.map(s => s.resolutions).filter(Boolean),
    expiresAt: Date.now() + STREAM_CACHE_TTL_MS
  };
  streamCache.set(cacheKey, entry);
  return entry;
}

async function searchMovieBox(keyword) {
  if (!keyword || !keyword.trim()) return [];
  try {
    const origin = await siteOrigin().catch(() => CATALOG_HOST);
    const body = await bffFetch(`${origin}/wefeed-h5api-bff/subject/search`, {
      method: 'post',
      body: JSON.stringify({ keyword: keyword.trim(), page: 1, perPage: 40 })
    });
    const items = (body && body.data && (body.data.items || body.data.result)) || [];
    const results = items
      .map(mapItem)
      .filter(m => m && [1, 2].includes(m.subjectType) && !isAudiobook(m) && !isAnime(m) && !isAdult(m));
    if (results.length) return mergeDubVersions(results);
  } catch (e) {
    console.warn('[MovieBox] API search error:', e.message);
  }
  const catalog = await fetchMovieBoxCatalog();
  const q = keyword.toLowerCase().trim();
  return catalog.movies.filter(m =>
    m.title.toLowerCase().includes(q) ||
    m.genres.some(g => g.toLowerCase().includes(q)) ||
    (m.year && m.year.includes(q))
  );
}

const cardEnrichAt = new Map();
const CARD_ENRICH_TTL_MS = 30 * 60 * 1000;
let editionSweepCursor = 0;

/** Background sweeper: pull the authoritative dubs list for cards that
 *  still have few known editions. Rotating cursor covers the whole catalog
 *  over successive syncs. */
async function enrichEditionSweep(maxCards = 400, budgetMs = 240000) {
  const all = inMemoryCache?.movies || [];
  if (!all.length) return 0;
  const t0 = Date.now();
  let idx = editionSweepCursor % all.length;
  let done = 0;
  let seriesDone = 0;
  while (done < maxCards && Date.now() - t0 < budgetMs) {
    const card = all[idx];
    if (card && !card.dubsEnriched) {
      await enrichCardEditions(card);
      done++;
      if (card.subjectType === 2) seriesDone++;
    }
    idx = (idx + 1) % all.length;
    if (idx === editionSweepCursor) break;
  }
  editionSweepCursor = idx;
  if (done) {
    console.log(`[MovieBox] Edition sweep: enriched ${done} card(s) (${seriesDone} series) from dubs lists`);
    // Persist immediately — the next sync's save would otherwise write a
    // pre-sweep snapshot and freshly discovered editions would be lost on
    // restart.
    try {
      if (inMemoryCache) {
        inMemoryCache.fetchedAt = new Date().toISOString();
        fs.promises.writeFile(CACHE_FILE, JSON.stringify(inMemoryCache), 'utf8').catch(() => {});
      }
    } catch (e) {}
  }
  return done;
}

/**
 * Discover a card's audio editions from the detail API's authoritative
 * `dubs` array (subjectId + language code + detailPath per edition).
 * This replaced the old search-based discovery after MovieBox started
 * rejecting the search endpoint with "invalid token" — the dubs array is
 * faster, complete and needs no search at all.
 */
async function enrichCardEditions(card) {
  // A card can carry 2 editions from sibling merges and still be missing
  // ten more — track enrichment with an explicit marker, never a count.
  if (!card || !card.title || card.dubsEnriched) return card;
  const cleanSubId = String(card.subjectId || card.id || '').replace(/^mb_/, '');
  if (!cleanSubId) return card;

  const last = cardEnrichAt.get(card.id);
  if (last && (Date.now() - last) < CARD_ENRICH_TTL_MS) return card;
  cardEnrichAt.set(card.id, Date.now());

  try {
    // One detail fetch serves both paths: the race keeps playback under a
    // 4.5s ceiling, and the background attach adds the editions even when
    // the race is lost (a slow upstream must not lose the Tamil dub).
    const detailPromise = bffFetch(
      `https://h5-api.aoneroom.com/wefeed-h5api-bff/detail?subjectId=${encodeURIComponent(cleanSubId)}`
    ).catch(() => null);

    const attach = (detail) => {
      const dubs = detail?.data?.subject?.dubs;
      if (!Array.isArray(dubs)) return;            // network/parse failure — retry later
      if (dubs.length <= 1) {                       // upstream has no other editions
        card.dubsEnriched = true;
        return;
      }
      const editions = [];
      const seen = new Set([cleanSubId]);
      for (const dub of dubs) {
        const sid = String(dub.subjectId || '');
        if (!sid || seen.has(sid) || !dub.detailPath) continue;
        seen.add(sid);
        const langName = AUDIO_LANGS[String(dub.lanCode || '').toLowerCase()]
          || (dub.lanName ? String(dub.lanName).replace(/\s+(dub|audio)$/i, '').trim() : '')
          || 'Original';
        editions.push({ subjectId: sid, language: langName, detailPath: dub.detailPath });
      }
      if (!editions.length) return;
      const existing = card.audioVersions || [];
      const known = new Set(existing.map(a => String(a.subjectId)).concat([cleanSubId]));
      const fresh = editions.filter(e => !known.has(e.subjectId));
      if (fresh.length) card.audioVersions = [...existing, ...fresh];
      card.dubsEnriched = true;
    };

    const backfill = (detail) => {
      const subj = detail?.data?.subject;
      if (!subj) return;
      // Real synopsis beats the generic fallback — improves search, the
      // details page and region checks (Yoruba/Nollywood tags live here).
      const realDesc = typeof subj.description === 'string' ? subj.description.trim() : '';
      const generic = !card.description || /^Watch .* online in high definition/.test(card.description);
      if (realDesc && generic) card.description = realDesc;
      const detailGenre = typeof subj.genre === 'string' ? subj.genre.trim() : '';
      const thinGenres = !card.genres || card.genres.length === 0 ||
        (card.genres.length <= 1 && /^(drama|movie)$/i.test(String(card.genres[0] || '')));
      if (detailGenre && thinGenres) {
        const list = detailGenre.split(',').map(g => g.trim()).filter(Boolean);
        if (list.length) card.genres = list;
      }
      if (!card.countryName && typeof subj.countryName === 'string' && subj.countryName.trim()) {
        card.countryName = subj.countryName.trim();
      }
    };

    const raced = await Promise.race([
      detailPromise,
      new Promise(resolve => setTimeout(() => resolve(undefined), 4500))
    ]);
    if (raced !== undefined) {
      attach(raced);
      backfill(raced);
    } else {
      detailPromise.then((detail) => { attach(detail); backfill(detail); });
    }
  } catch (e) {}
  return card;
}

async function matchMovieBoxMetadata(title, year) {
  if (!title) return null;
  try {
    const results = await searchMovieBox(title);
    const cleanTitle = title.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();

    const match = results.find(m => {
      const mbClean = m.title.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
      const titleMatches = cleanTitle.includes(mbClean) || mbClean.includes(cleanTitle);
      if (year && m.year) {
        return titleMatches && Math.abs(parseInt(m.year) - parseInt(year)) <= 1;
      }
      return titleMatches;
    });

    if (match) {
      return {
        title: match.title,
        year: match.year,
        poster: match.posterUrl || match.poster,
        summary: match.description,
        rating: match.rating,
        genres: match.genres,
        source: 'MovieBox'
      };
    }
  } catch (e) {
    console.warn('[MovieBox] Match error:', e.message);
  }
  return null;
}

module.exports = {
  fetchMovieBoxCatalog,
  refreshLatestReleases,
  refreshLatestFeed,
  sortCatalogByRecency,
  findMovieBoxItem,
  searchMovieBox,
  matchMovieBoxMetadata,
  resolveMovieBoxStream,
  invalidateStreamCache,
  fetchSeriesSeasons,
  enrichCardEditions,
  enrichEditionSweep,
  getMovieBoxCatalogSnapshot,
  getMovieBoxCatalogMeta,
  bffFetch,
  isBengali,
  isUrdu,
  isNigerian
};

module.exports.__debug = { isNigerian, isFilipino, nigerianTitleScore, filipinoTitleScore };
