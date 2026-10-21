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
let inMemoryCache = null;
let lastFetchTime = 0;

try {
  if (fs.existsSync(CACHE_FILE)) {
    inMemoryCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    lastFetchTime = Date.now();
    console.log(`[MovieBox] Loaded ${inMemoryCache.movies?.length || 0} movies from disk cache.`);
  }
} catch (e) {
  console.warn('[MovieBox] Could not load disk cache:', e.message);
}

const streamCache = new Map();
const STREAM_CACHE_TTL_MS = 15 * 60 * 1000;

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
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'Origin': host,
    'Referer': `${host}/`,
    'X-Client-Token': clientToken(),
    ...extra
  };
}

const sessionCache = new Map();
async function getSession(host, forceNew = false) {
  const cached = sessionCache.get(host);
  if (!forceNew && cached && cached.expiresAt > Date.now()) return cached;
  try {
    const res = await fetch(`${host}/wefeed-h5api-bff/country-code`, {
      headers: baseHeaders(host)
    });
    const xUser = res.headers.get('x-user') || '';
    const setCookie = res.headers.get('set-cookie') || '';
    const token = xUser || (setCookie.match(/token=([^;]+)/) || [])[1] || '';
    const entry = { token, cookie: setCookie, expiresAt: Date.now() + 2 * 60 * 60 * 1000 };
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
    headers
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return await res.json();
}

function mapItem(it) {
  if (!it || !it.subjectId || !it.title) return null;
  const subjectId = String(it.subjectId);
  const id = `mb_${subjectId}`;
  const poster = it.cover && typeof it.cover === 'object' ? (it.cover.url || it.cover.thumbnail) : null;
  const backdrop = (it.stills && typeof it.stills === 'object' && it.stills.url)
    ? it.stills.url
    : (it.trailer && typeof it.trailer === 'object' && it.trailer.cover && it.trailer.cover.url
      ? it.trailer.cover.url
      : null);
  const genres = typeof it.genre === 'string' && it.genre.trim()
    ? it.genre.split(',').map(s => s.trim()).filter(Boolean)
    : ['Movie'];
  const year = it.releaseDate ? String(it.releaseDate).slice(0, 4) : '';

  return {
    id,
    subjectId,
    title: String(it.title).trim(),
    year,
    releaseDate: it.releaseDate || '',
    description: typeof it.description === 'string' && it.description.trim()
      ? it.description
      : `Watch ${it.title} online in high definition on VikyFlix MovieBox.`,
    genres: genres.length ? genres : ['Movie'],
    rating: it.imdbRatingValue ? parseFloat(it.imdbRatingValue).toFixed(1) : '7.5',
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
    isSeries: it.subjectType === 2,
    source: 'MovieBox'
  };
}

async function fetchMovieBoxCatalog(force = false) {
  const now = Date.now();
  if (!force && inMemoryCache && (now - lastFetchTime < CACHE_TTL_MS)) {
    return inMemoryCache;
  }
  if (!inMemoryCache && fs.existsSync(CACHE_FILE)) {
    try {
      inMemoryCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      lastFetchTime = now;
      return inMemoryCache;
    } catch (e) {}
  }
  if (inMemoryCache) {
    refreshCatalogInBackground();
    return inMemoryCache;
  }
  await buildCatalog();
  return inMemoryCache;
}

let isRefreshing = false;
function refreshCatalogInBackground() {
  if (isRefreshing) return;
  isRefreshing = true;
  buildCatalog().catch(err => console.warn('[MovieBox] Background refresh error:', err.message)).finally(() => { isRefreshing = false; });
}

function isAudiobook(m) {
  const genres = (m.genres || []).map(g => g.toLowerCase());
  return genres.some(g => /audiobook|erotic audio|dj mix|podcast/i.test(g));
}

function isAdult(m) {
  const genres = (m.genres || []).map(g => g.toLowerCase());
  return genres.some(g => /adult|erotic/i.test(g));
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
  // 4. Audio versions tagged as Bengali
  if (Array.isArray(m.audioVersions) && m.audioVersions.some(a => /\b(bengali|bangla)\b/i.test(String(a.language || '')))) return true;
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
  if (Array.isArray(m.audioVersions) && m.audioVersions.some(a => /\burdu\b/i.test(String(a.language || '')))) return true;
  return false;
}

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

function isAnime(m) {
  const genres = (m.genres || m.genre || []).map(g => (typeof g === 'string' ? g : g.name || '').toLowerCase());
  const isAnim = genres.includes('animation');
  const title = String(m.title || '');
  const country = String(m.countryName || '');

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

function parseAudioLabel(title) {
  const m = String(title).match(/[[(]([^\])]+)[\])]/);
  if (m) return AUDIO_LANGS[m[1].trim().toLowerCase()] || null;
  const tail = TRAILING_LANG_RE.exec(String(title));
  if (tail) return AUDIO_LANGS[tail[1].toLowerCase()] || null;
  return null;
}

const TRAILING_LANG_RE = /\b(english|hindi|tamil|telugu|malayalam|kannada|bengali|punjabi|marathi|japanese|korean|mandarin|chinese|cantonese|spanish|french|german|italian|turkish|russian|arabic|portuguese|filipino|tagalog|indonesian|vietnamese|thai|urdu|dutch|polish)\b\s*$/i;

function normalizeDubKey(title) {
  return String(title)
    .replace(/[[(][^\])]*[\])]/g, ' ')
    .replace(TRAILING_LANG_RE, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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

  const dropped = new Set();
  for (const members of groups.values()) {
    if (members.length < 2) continue;

    // Pick primary: preferring original uploads without language brackets
    const primary = members.find(m => !parseAudioLabel(m.title)) || members[0];
    const primaryYear = parseInt(primary.year, 10) || 0;
    const kin = members.filter(m => {
      const y = parseInt(m.year, 10) || 0;
      return !primaryYear || !y || Math.abs(y - primaryYear) <= 1;
    });
    if (kin.length < 2) continue;

    const versions = [];
    const addEdition = (m) => {
      const lang = m.corner && AUDIO_LANGS[m.corner.toLowerCase()]
        ? AUDIO_LANGS[m.corner.toLowerCase()]
        : (parseAudioLabel(m.title) || 'Original');
      if (versions.some(v => v.language === lang)) return false;
      versions.push({
        language: lang,
        subjectId: m.subjectId,
        detailPath: m.detailPath,
        title: m.title
      });
      return true;
    };
    for (const m of kin) addEdition(m);
    for (const m of members) {
      if (kin.includes(m)) continue;
      const l = m.corner && AUDIO_LANGS[m.corner.toLowerCase()] ? AUDIO_LANGS[m.corner.toLowerCase()] : null;
      if (l && !versions.some(v => v.language === l)) addEdition(m);
    }

    for (const m of members) if (m !== primary && kin.includes(m)) dropped.add(m.id);
    if (versions.length > 1) primary.audioVersions = versions;
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
        if (m && m.subjectType === section.subjectType && !seen.has(m.subjectId) && !isAudiobook(m) && !isAnime(m) && !isAdult(m) && !isBengali(m) && !isUrdu(m)) {
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

  const sorted = [...merged].sort((a, b) => movieScore(b) - movieScore(a) || (b.rating - a.rating));

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
    String(m.subjectId || '') === rawId
  ) || null;
  return { movie };
}

function getMovieBoxCatalogSnapshot() {
  return Array.isArray(inMemoryCache?.movies) ? inMemoryCache.movies : null;
}

const seriesResourceCache = new Map();

async function fetchSeriesSeasons(detailPath) {
  const cached = seriesResourceCache.get(detailPath);
  if (cached && (Date.now() - cached.fetchedAt) < 30 * 60 * 1000) return cached.seasons;
  const body = await bffFetch(`https://h5-api.aoneroom.com/wefeed-h5api-bff/detail?detailPath=${encodeURIComponent(detailPath)}`);
  const res = (body && body.data && body.data.resource) || {};
  const seasons = Array.isArray(res.seasons) ? res.seasons.filter(s => s && s.maxEp > 0) : [];
  seriesResourceCache.set(detailPath, { seasons, fetchedAt: Date.now() });
  return seasons;
}

async function resolveMovieBoxStream(subjectId, detailPath, se = null, ep = null, wantRes = null) {
  const isEpisode = se != null && ep != null;
  const resTag = ['360', '480', '720', '1080'].includes(String(wantRes)) ? String(wantRes) : null;
  const cacheKey = `${isEpisode ? `${subjectId}:${se}:${ep}` : subjectId}${resTag ? `@${resTag}` : ''}`;
  const cached = streamCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached;
  if (!detailPath) throw new Error('No detail path for this title');

  try {
    await bffFetch(`https://h5-api.aoneroom.com/wefeed-h5api-bff/detail?detailPath=${encodeURIComponent(detailPath)}`);
  } catch (e) {}

  const playUrl = `${PLAY_HOST}/wefeed-h5api-bff/subject/play` +
    `?subjectId=${encodeURIComponent(subjectId)}&se=${isEpisode ? se : 0}&ep=${isEpisode ? ep : 0}` +
    `&detailPath=${encodeURIComponent(detailPath)}` +
    `&streamSignType=1&supportCodecs%5Bhevc%5D=1&supportCodecs%5Bh264%5D=1`;
  const referer = isEpisode
    ? `${PLAY_HOST}/spa/videoPlayPage/series/${detailPath}?id=${subjectId}&se=${se}&ep=${ep}`
    : `${PLAY_HOST}/spa/videoPlayPage/movies/${detailPath}?id=${subjectId}`;

  const body = await bffFetch(playUrl, { headers: { Referer: referer } }, PLAY_HOST);
  const data = body && body.data;
  const streams = (data && data.streams) || [];

  if (!data || !data.hasResource || !streams.length) {
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

async function enrichCardEditions(card) {
  if (!card || !card.title || card.audioVersions?.length > 1) return card;
  const baseKey = normalizeDubKey(card.title);
  if (!baseKey) return card;

  const last = cardEnrichAt.get(card.id);
  if (last && (Date.now() - last) < CARD_ENRICH_TTL_MS) return card;
  cardEnrichAt.set(card.id, Date.now());

  try {
    const siblings = await searchMovieBox(baseKey);
    const related = siblings.filter(m =>
      m && m.subjectType === card.subjectType &&
      normalizeDubKey(m.title) === baseKey
    );
    if (related.length > 1) {
      const merged = mergeDubVersions([card, ...related]);
      const found = merged.find(m => m.id === card.id || normalizeDubKey(m.title) === baseKey);
      if (found && found.audioVersions?.length) {
        card.audioVersions = found.audioVersions;
      }
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
  findMovieBoxItem,
  searchMovieBox,
  matchMovieBoxMetadata,
  resolveMovieBoxStream,
  fetchSeriesSeasons,
  enrichCardEditions,
  getMovieBoxCatalogSnapshot,
  bffFetch,
  isBengali,
  isUrdu
};
