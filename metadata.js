const fs = require('fs');
const path = require('path');
const axios = require('axios');
const https = require('https');
const crypto = require('crypto');
const { execSync, spawnSync } = require('child_process');
const CACHE_FILE = path.join(__dirname, 'metadata_cache.json');
const POSTERS_DIR = path.join(__dirname, 'cache', 'posters');

if (!fs.existsSync(POSTERS_DIR)) {
  fs.mkdirSync(POSTERS_DIR, { recursive: true });
}

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const metadataCache = new Map();

// Load cache from disk on startup
try {
  if (fs.existsSync(CACHE_FILE)) {
    const rawData = fs.readFileSync(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(rawData);
    for (const [k, v] of Object.entries(parsed)) {
      if (v && v.poster) {
        metadataCache.set(k, v);
      }
    }
    console.log(`[Metadata] Loaded ${metadataCache.size} cached movie posters from disk.`);
  }
} catch (e) {
  console.warn('[Metadata] Failed to read metadata cache:', e.message);
}

let saveTimer = null;
function persistMetadataCache() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const obj = Object.fromEntries(metadataCache);
      fs.writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2), 'utf8');
    } catch (e) {}
  }, 500);
}

async function downloadAndCachePoster(remoteUrl, title, year) {
  if (!remoteUrl) return null;
  if (remoteUrl.startsWith('/api/poster/')) return remoteUrl;

  try {
    const key = `${(title || '').toLowerCase()}_${year || ''}`;
    const hash = crypto.createHash('md5').update(key || remoteUrl).digest('hex');
    const localFile = path.join(POSTERS_DIR, `${hash}.jpg`);

    if (fs.existsSync(localFile) && fs.statSync(localFile).size > 200) {
      return `/api/poster/${hash}`;
    }

    const response = await axios.get(remoteUrl, {
      responseType: 'arraybuffer',
      timeout: 6000,
      httpsAgent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (response.status === 200 && response.data && response.data.length > 200) {
      fs.writeFileSync(localFile, Buffer.from(response.data));
      return `/api/poster/${hash}`;
    }
  } catch (err) {
    // If download fails, fallback to remoteUrl
  }
  return remoteUrl;
}

function getCachedMetadata(cleanTitle, year) {
  const cacheKey = `${(cleanTitle || '').toLowerCase()}_${year || ''}`;
  return metadataCache.get(cacheKey) || metadataCache.get(`${(cleanTitle || '').toLowerCase()}_`) || null;
}

// High-accuracy movie title and year parser
function parseTitleAndYear(filename, parentDir = '') {
  let raw = filename.replace(/\.(mp4|mkv|avi|mov|webm|m4v|ts|flv)$/i, '');
  raw = raw.replace(/^www\.[a-z0-9\.\-_]+\s*-\s*/gi, '');

  let year = null;
  const yearMatch = raw.match(/[\(\[\s\.\-_](19\d{2}|20[0-3]\d)(?:[\)\]\s\.\-_]|$)/) || raw.match(/\b(19\d{2}|20[0-3]\d)\b/);
  if (yearMatch) {
    year = yearMatch[1];
    raw = raw.substring(0, yearMatch.index);
  } else if (parentDir) {
    const parentYearMatch = parentDir.match(/[\(\[\s\.\-_](19\d{2}|20[0-3]\d)(?:[\)\]\s\.\-_]|$)/);
    if (parentYearMatch) {
      year = parentYearMatch[1];
    }
  }

  let title = raw
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^\)]*\)/g, ' ')
    .replace(/\b\d+(?:[\.\s]+\d+)?\s*(?:gb|mb|gib|mib|kbps)\b/gi, ' ')
    .replace(/\b(1080p|720p|480p|2160p|4k|bluray|brrip|bdrip|web-dl|webrip|hdrip|hq|dvdrip|x264|x265|hevc|h264|h265|avc|av1|aac|aac5\.1|dd5\.1|dd\+5\.1|atmos|yts|yify|bokutox|cmrg|vxt|rmteam|regret|lama|afm72|esub|esubs|org aud|unrated|true|extended|remastered|explicit|internal|repack)\b.*$/i, ' ')
    .replace(/\b(1080p|720p|480p|2160p|4k|bluray|brrip|bdrip|web-dl|webrip|hdrip|hq|dvdrip|x264|x265|hevc|h264|h265|avc|av1|aac|aac5\.1|dd5\.1|dd\+5\.1|atmos|yts|yify|bokutox|cmrg|vxt|rmteam|regret|lama|afm72|esub|esubs|org aud|unrated|true|extended|remastered|explicit|internal|repack)\b/gi, ' ')
    .replace(/[\._\-]/g, ' ')
    .replace(/\b\d+(?:[\.\s]+\d+)?\s*(?:gb|mb)\b/gi, ' ')
    .replace(/[\(\[\{]/g, ' ')
    .replace(/[\)\]\}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!title || title.length < 1) {
    title = path.parse(filename).name.replace(/[\._\-]/g, ' ').replace(/[\(\[\{\)\]\}]/g, ' ').trim();
  }

  return { cleanTitle: title, year };
}

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return null;
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) {
    return `${h}h ${m}m`;
  }
  return `${m}m`;
}

const GENRE_RULES = [
  { name: 'Action', keywords: ['action', 'superhero', 'martial arts', 'fight', 'war', 'mission', 'combat', 'avengers', 'strike', 'soldier', 'battle', 'army', 'gun', 'furious'] },
  { name: 'Sci-Fi', keywords: ['sci-fi', 'science fiction', 'alien', 'cyber', 'space', 'future', 'robot', 'planet', 'galaxy', 'time travel', 'matrix', 'avatar', 'dystopia', 'star wars', 'interstellar'] },
  { name: 'Thriller', keywords: ['thriller', 'mystery', 'suspense', 'detective', 'murder', 'investigation', 'heist', 'conspiracy', 'hostage', 'assassin', 'stalker'] },
  { name: 'Comedy', keywords: ['comedy', 'humorous', 'sitcom', 'spoof', 'hilarious', 'laugh', 'satirical', 'parody', 'funny'] },
  { name: 'Drama', keywords: ['drama', 'tragedy', 'emotional', 'historical', 'biographical', 'struggle', 'family', 'courtroom', 'heartfelt'] },
  { name: 'Horror', keywords: ['horror', 'ghost', 'haunted', 'demon', 'zombie', 'monster', 'witch', 'possessed', 'slasher', 'vampire', 'terror', 'evil', 'conjuring', 'creepy'] },
  { name: 'Romance', keywords: ['romance', 'romantic', 'love', 'couple', 'affair', 'wedding', 'lover', 'passion'] },
  { name: 'Animation', keywords: ['animation', 'animated', 'anime', 'cartoon', 'pixar', 'disney', 'dreamworks', 'cgi'] },
  { name: 'Adventure', keywords: ['adventure', 'quest', 'exploration', 'treasure', 'island', 'journey', 'jungle', 'survival', 'expedition'] },
  { name: 'Crime', keywords: ['crime', 'gangster', 'mafia', 'cartel', 'robbery', 'drug', 'police', 'mob', 'underworld', 'godfather', 'cop'] },
  { name: 'Fantasy', keywords: ['fantasy', 'magic', 'wizard', 'mythical', 'dragon', 'kingdom', 'fairy', 'legend', 'potter'] }
];

function extractGenres(textToSearch, title) {
  const combined = `${title} ${textToSearch || ''}`.toLowerCase();
  const matched = [];

  for (const rule of GENRE_RULES) {
    if (rule.keywords.some(kw => combined.includes(kw))) {
      matched.push(rule.name);
      if (matched.length >= 3) break;
    }
  }

  if (matched.length === 0) {
    const defaultPairs = [
      ['Action', 'Thriller'],
      ['Drama', 'Thriller'],
      ['Action', 'Sci-Fi'],
      ['Comedy', 'Drama'],
      ['Adventure', 'Action'],
      ['Crime', 'Drama'],
      ['Sci-Fi', 'Adventure'],
      ['Horror', 'Mystery']
    ];
    let hash = 0;
    for (let i = 0; i < title.length; i++) hash += title.charCodeAt(i);
    return defaultPairs[hash % defaultPairs.length];
  }

  return matched;
}

// Fetch poster, summary, rating, and genres from IMDb & Wikipedia
async function fetchMovieMetadata(cleanTitle, year) {
  const cacheKey = `${cleanTitle.toLowerCase()}_${year || ''}`;
  if (metadataCache.has(cacheKey)) {
    return metadataCache.get(cacheKey);
  }

  const result = {
    poster: null,
    rating: null,
    summary: '',
    year: year || null,
    stars: '',
    genres: [],
    genre: ''
  };

  let rawContextText = '';

  // 1. Provider A: IMDb Suggestion API (Primary high-res poster database)
  try {
    const query = cleanTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const firstChar = query.charAt(0) || 'a';
    const imdbUrl = `https://v3.sg.media-imdb.com/suggestion/${firstChar}/${query}.json`;
    const res = await axios.get(imdbUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      httpsAgent,
      timeout: 4000
    });

    if (res.data?.d && res.data.d.length > 0) {
      const item = res.data.d.find(d => (d.q === 'feature' || d.q === 'movie' || d.q === 'TV movie') && d.i?.imageUrl) 
                || res.data.d.find(d => d.i?.imageUrl)
                || res.data.d[0];

      if (item?.i?.imageUrl) {
        result.poster = item.i.imageUrl;
      }
      if (item?.y && !result.year) {
        result.year = item.y.toString();
      }
      if (item?.s) {
        result.stars = item.s;
        rawContextText += ` ${item.s}`;
      }
      if (item?.q) {
        rawContextText += ` ${item.q}`;
      }
    }
  } catch (e) {}

  // 1.5 Provider B: Cinemeta IMDb Catalog API
  if (!result.poster) {
    try {
      const cinemetaUrl = `https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(cleanTitle)}.json`;
      const cRes = await axios.get(cinemetaUrl, { httpsAgent, timeout: 3500 });
      const metas = cRes.data?.metas || [];
      if (metas.length > 0) {
        const match = metas.find(m => {
          if (!year) return true;
          return m.year === year || m.releaseInfo === year;
        }) || metas[0];

        if (match?.poster) {
          result.poster = match.poster;
        }
        if (match?.year && !result.year) {
          result.year = String(match.year);
        }
        if (match?.imdbRating && !result.rating) {
          result.rating = String(match.imdbRating);
        }
        if (match?.description && !result.summary) {
          result.summary = match.description;
          rawContextText += ` ${match.description}`;
        }
        if (Array.isArray(match?.genres) && match.genres.length > 0) {
          result.genres = match.genres;
        }
      }
    } catch (e) {}
  }

  // 2. Provider C: Apple iTunes Search API (Fallback)
  if (!result.poster) {
    try {
      const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(cleanTitle + (year ? ' ' + year : ''))}&media=movie&entity=movie&limit=3`;
      const itunesRes = await axios.get(itunesUrl, { httpsAgent, timeout: 3500 });
      if (itunesRes.data?.results?.length > 0) {
        const match = itunesRes.data.results.find(m => {
          const titleMatch = m.trackName?.toLowerCase().includes(cleanTitle.toLowerCase()) || cleanTitle.toLowerCase().includes(m.trackName?.toLowerCase());
          return titleMatch;
        }) || itunesRes.data.results[0];

        if (match?.artworkUrl100) {
          result.poster = match.artworkUrl100.replace(/100x100bb\.(jpg|png)/gi, '600x900bb.$1');
        }
        if (match?.releaseDate && !result.year) {
          result.year = match.releaseDate.slice(0, 4);
        }
        if (match?.longDescription || match?.shortDescription) {
          result.summary = match.longDescription || match.shortDescription;
          rawContextText += ` ${result.summary}`;
        }
      }
    } catch (e) {}
  }

  // 3. Provider C: Wikipedia API (Fallback for summary & poster)
  if (!result.poster || !result.summary) {
    try {
      const searchTerms = [
        year ? `${cleanTitle} (${year} film)` : `${cleanTitle} (film)`,
        `${cleanTitle} film`,
        cleanTitle
      ];

      for (const st of searchTerms) {
        const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(st)}&limit=2&namespace=0&format=json`;
        const sRes = await axios.get(searchUrl, {
          headers: { 'User-Agent': 'VickyFlixPersonal/3.0' },
          httpsAgent,
          timeout: 3000
        });

        if (sRes.data?.[1]?.[0]) {
          const pageTitle = sRes.data[1][0];
          const sumUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`;
          const sumRes = await axios.get(sumUrl, {
            headers: { 'User-Agent': 'VickyFlixPersonal/3.0' },
            httpsAgent,
            timeout: 3000
          });

          if (sumRes.data?.thumbnail?.source && !result.poster) {
            result.poster = sumRes.data.thumbnail.source.replace(/\/\d+px-/, '/600px-');
          }
          if (sumRes.data?.description) {
            rawContextText += ` ${sumRes.data.description}`;
          }
          if (sumRes.data?.extract && !result.summary) {
            result.summary = sumRes.data.extract;
            rawContextText += ` ${sumRes.data.extract}`;
          }
          if (result.poster && result.summary) break;
        }
      }
    } catch (e) {}
  }

  // 4. Provider D: MovieBox Metadata Match (Fallback)
  if (!result.poster || !result.summary) {
    try {
      const { matchMovieBoxMetadata } = require('./moviebox');
      const mbMatch = await matchMovieBoxMetadata(cleanTitle, year);
      if (mbMatch) {
        if (!result.poster && mbMatch.poster) result.poster = mbMatch.poster;
        if (!result.summary && mbMatch.summary) result.summary = mbMatch.summary;
        if (!result.rating && mbMatch.rating) result.rating = mbMatch.rating;
        if (mbMatch.genres && mbMatch.genres.length > 0) {
          rawContextText += ` ${mbMatch.genres.join(' ')}`;
        }
      }
    } catch (e) {}
  }

  // Calculated rating
  if (!result.rating) {
    let hash = 0;
    for (let i = 0; i < cleanTitle.length; i++) hash += cleanTitle.charCodeAt(i);
    result.rating = (7.5 + (hash % 20) / 10).toFixed(1);
  }

  if (!result.summary) {
    result.summary = result.stars 
      ? `Starring ${result.stars}. Stream in full high definition with crystal clear surround audio.`
      : `Stream ${cleanTitle} directly from your Viky Flix collection with high definition surround audio.`;
  }

  // Extract intelligent genre tags
  result.genres = extractGenres(rawContextText, cleanTitle);
  result.genre = result.genres.join(', ');

  // Download and cache poster to local disk for 0ms instant loading
  if (result.poster) {
    result.poster = await downloadAndCachePoster(result.poster, cleanTitle, year);
  }

  metadataCache.set(cacheKey, result);
  persistMetadataCache();
  return result;
}

function getCachedMetadata(cacheKey) {
  return metadataCache.get(cacheKey);
}

// Media track inspection (ffprobe)
function inspectMediaTracks(filePath) {
  try {
    const res = spawnSync('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ], { timeout: 6000, encoding: 'utf8' });

    if (!res.stdout) {
      return {
        duration: 0,
        formattedDuration: null,
        audioTracks: [],
        subtitleTracks: []
      };
    }

    const data = JSON.parse(res.stdout);
    const audioTracks = [];
    const subtitleTracks = [];

    const duration = parseFloat(data.format?.duration || 0);

    for (const stream of data.streams || []) {
      if (stream.codec_type === 'audio') {
        const lang = stream.tags?.language || stream.tags?.LANGUAGE || 'und';
        const title = stream.tags?.title || stream.tags?.TITLE || '';
        audioTracks.push({
          index: stream.index,
          language: lang,
          title: title,
          label: formatTrackLabel(lang, title, stream.index, 'Audio'),
          codec: stream.codec_name,
          channels: stream.channels
        });
      } else if (stream.codec_type === 'subtitle') {
        const lang = stream.tags?.language || stream.tags?.LANGUAGE || 'und';
        const title = stream.tags?.title || stream.tags?.TITLE || '';
        subtitleTracks.push({
          index: stream.index,
          language: lang,
          title: title,
          label: formatTrackLabel(lang, title, stream.index, 'Subtitle'),
          codec: stream.codec_name
        });
      }
    }

    return {
      duration,
      formattedDuration: formatDuration(duration),
      audioTracks,
      subtitleTracks
    };
  } catch (err) {
    return {
      duration: 0,
      formattedDuration: null,
      audioTracks: [],
      subtitleTracks: []
    };
  }
}

function formatTrackLabel(lang, title, index, type) {
  const langMap = {
    eng: 'English',
    tam: 'Tamil',
    tel: 'Telugu',
    hin: 'Hindi',
    mal: 'Malayalam',
    kan: 'Kannada',
    kor: 'Korean',
    jpn: 'Japanese',
    fre: 'French',
    ger: 'German',
    spa: 'Spanish',
    und: 'Default'
  };

  const name = langMap[lang.toLowerCase()] || lang.toUpperCase();
  if (title && !title.includes('www.')) {
    return `${name} (${title})`;
  }
  return `${name} (${type} Track ${index})`;
}

module.exports = {
  parseTitleAndYear,
  formatDuration,
  fetchMovieMetadata,
  getCachedMetadata,
  downloadAndCachePoster,
  inspectMediaTracks
};
