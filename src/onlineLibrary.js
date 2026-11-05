// Online library (MovieBox catalog) integration.
// The online titles are merged straight into the app's All Movies and
// Web Series pages so the whole catalog behaves like the web setup — one
// unified library of local files + online content, with no separate tab.
// Unicode script ranges → language (titles written in native scripts)
const LANG_SCRIPT_TESTS = [
  { re: /[\u0900-\u097F]/, lang: 'Hindi' },        // Devanagari
  { re: /[\u0B80-\u0BFF]/, lang: 'Tamil' },        // Tamil
  { re: /[\u0C00-\u0C7F]/, lang: 'Telugu' },       // Telugu
  { re: /[\u0C80-\u0CFF]/, lang: 'Kannada' },      // Kannada
  { re: /[\u0D00-\u0D7F]/, lang: 'Malayalam' },    // Malayalam
  { re: /[\u0A00-\u0A7F]/, lang: 'Punjabi' },      // Gurmukhi
  { re: /[\u0600-\u06FF]/, lang: 'Arabic' },       // Arabic
  { re: /[\uAC00-\uD7AF\u1100-\u11FF]/, lang: 'Korean' },   // Hangul
  { re: /[\u3040-\u30FF]/, lang: 'Japanese' },     // Kana
  { re: /[\u4E00-\u9FFF]/, lang: 'Chinese' },      // CJK
  { re: /[\u0400-\u04FF]/, lang: 'Russian' },      // Cyrillic
  { re: /[\u0E00-\u0E7F]/, lang: 'Thai' }          // Thai
];

const LANG_WORD_RE = /\b(hindi|tamil|telugu|malayalam|kannada|punjabi|korean|japanese|chinese|mandarin|cantonese|spanish|espanol|filipino|tagalog|indonesian|arabic|turkish|russian|french|german|deutsch)\b/i;

const LANG_SYNONYMS = {
  hindi: 'Hindi', tamil: 'Tamil', telugu: 'Telugu', malayalam: 'Malayalam',
  kannada: 'Kannada', punjabi: 'Punjabi',
  korean: 'Korean', japanese: 'Japanese', chinese: 'Chinese', mandarin: 'Chinese',
  cantonese: 'Chinese', spanish: 'Spanish', espanol: 'Spanish', filipino: 'Filipino',
  tagalog: 'Filipino', indonesian: 'Indonesian', arabic: 'Arabic', turkish: 'Turkish',
  russian: 'Russian', french: 'French', german: 'German', deutsch: 'German'
};

const normLang = (word) => LANG_SYNONYMS[String(word || '').toLowerCase()] || null;

export function detectOnlineLanguage(movie) {
  const title = (movie && movie.title) || '';

  // 1. Explicit "[Language]" / "(Language)" annotation or trailing tag
  const annotation = (title.match(/[\[\(]([^\]\)]{2,24})[\]\)]/) || [null, null])[1];
  if (annotation) {
    const word = (annotation.match(LANG_WORD_RE) || [null])[0];
    if (word) return normLang(word);
    for (const t of LANG_SCRIPT_TESTS) if (t.re.test(annotation)) return t.lang;
  }
  const trail = title.match(/\b(hindi|tamil|telugu|malayalam|kannada|bengali|punjabi|english|korean|japanese|chinese|spanish|french|filipino|indonesian|turkish|arabic|russian)\b\s*$/i);
  if (trail) return normLang(trail[1]) || (trail[1][0] + trail[1].slice(1).toLowerCase());

  // 2. Title written natively in another script
  for (const t of LANG_SCRIPT_TESTS) if (t.re.test(title)) return t.lang;

  // 3. Industry genre markers imply the language
  const genreText = (movie && movie.genres ? movie.genres.join(' ') : '') || '';
  if (/bollywood|qawwali|ghazal/i.test(genreText)) return 'Hindi';
  if (/kollywood/i.test(genreText)) return 'Tamil';
  if (/\btollywood\b/i.test(genreText)) return 'Telugu';

  // 4. Language keywords anywhere in the title
  const word = (title.match(LANG_WORD_RE) || [null])[0];
  if (word) return normLang(word);

  return 'English';
}

const INDUSTRY_BY_LANGUAGE = {  English: 'Hollywood',
  Hindi: 'Bollywood',
  Tamil: 'Kollywood',
  Telugu: 'Tollywood',
  Malayalam: 'Mollywood',
  Kannada: 'Sandalwood',
  Punjabi: 'Punjabi Cinema',
  Korean: 'Korean Cinema',
  Japanese: 'Japanese Cinema',
  Chinese: 'Chinese Cinema',
  Spanish: 'Spanish Cinema',
  Filipino: 'Filipino Cinema',
  Indonesian: 'Indonesian Cinema',
  Arabic: 'Arabic Cinema',
  Turkish: 'Turkish Cinema',
  Russian: 'Russian Cinema',
  French: 'French Cinema',
  German: 'German Cinema'
};

export function detectOnlineIndustry(movie) {
  const genreText = ((movie && movie.genres) || []).join(' ');
  if (/nollywood/i.test(genreText)) return 'Nollywood';
  return INDUSTRY_BY_LANGUAGE[detectOnlineLanguage(movie)] || 'International';
}

// MovieBox/local genre tokens → all matching catalog genre ids. A single raw
// genre field can contain several values, and membership is intentionally
// multi-label (e.g. "Action, Crime, Thriller" belongs to all three).
const GENRE_ALIASES = [
  [/\b(science fiction|sci[ -]?fi)\b/i, 'Sci-Fi'],
  [/\b(thriller|mystery|suspense)\b/i, 'Thriller'],
  [/\b(action|adventure|martial arts|war)\b/i, 'Action'],
  [/\b(crime|heist|gangster|police|investigation)\b/i, 'Crime'],
  [/\b(comedy|sitcom)\b/i, 'Comedy'],
  [/\bdrama\b/i, 'Drama'],
  [/\b(horror|supernatural)\b/i, 'Horror'],
  [/\b(romance|romantic)\b/i, 'Romance'],
  [/\b(animation|animated|cartoon)\b/i, 'Animation'],
  [/\b(fantasy|myth)\b/i, 'Fantasy']
];

export function mapCatalogGenres(rawGenres) {
  const values = Array.isArray(rawGenres) ? rawGenres : String(rawGenres || '').split(/[,;|/]+/);
  const raw = values
    .map((genre) => typeof genre === 'string' ? genre.trim() : String(genre?.name || '').trim())
    .filter(Boolean);
  const mapped = new Set();
  for (const value of raw) {
    for (const [re, label] of GENRE_ALIASES) {
      if (re.test(value)) mapped.add(label);
    }
  }
  return [...mapped, ...raw.filter((genre) => !mapped.has(genre))];
}

// The MovieBox site slaps language/quality brackets onto titles —
// "Gatta Kusthi [Hindi]", "The Vvaan [Hindi][CAM]" — even when the row's
// audio is the original language. The app keeps the display name clean
// (audio edition stays available in the player's Audio menu).
const TITLE_LANG_RE = /^[a-z\s]*\b(hindi|english|tamil|telugu|malayalam|kannada|bengali|bangla|punjabi|korean|japanese|chinese|mandarin|cantonese|spanish|filipino|tagalog|indonesian|turkish|arabic|russian|urdu|dutch|polish|marathi|dual\s*audio)(\s+dubbed)?\b/i;
const TITLE_QUALITY_RE = /^(cam|camrip|ts|hdtv|hd|4k|uhd|hdrip|webrip|web[ -]?dl|hdr|bluray|blu[ -]?ray|1080p|720p|480p|360p|hq|dubbed)$/i;
const TITLE_FORMAT_RE = /^(full movie|full episode|full episodes|full series|complete series|movie|web series|tv series)$/i;

export function cleanCatalogTitle(raw) {
  let t = String(raw || '');
  // Drop bracketed language/quality tags: [Hindi], (English Dubbed), [CAM]…
  t = t.replace(/[\[\(]([^\]\)]{1,32})[\]\)]/g, (full, inner) => {
    const w = inner.trim();
    return TITLE_LANG_RE.test(w) || TITLE_QUALITY_RE.test(w) || TITLE_FORMAT_RE.test(w) ? ' ' : full;
  });
  // Trailing language word: "The Traitors Telugu" → "The Traitors"
  t = t.replace(/\s*[-–]?\s*\b(hindi|english|tamil|telugu|malayalam|kannada|bengali|bangla|punjabi|korean|japanese|chinese|mandarin|spanish|filipino|indonesian|turkish|arabic|russian|urdu|marathi)\s*(dubbed)?\s*$/i, '');
  return t.replace(/\s{2,}/g, ' ').replace(/[\s\-–]+$/, '').trim();
}


// Title-language scoring for the content we never show: Philippines/Tagalog
// and Nollywood/Igbo titles often arrive with blank country + generic
// "Drama" genre, so grammar markers are the only reliable signal.
const __TAG_STRONG = /\b(ang|ng|mga|alindog|dilag|lihim|pag-ibig|pagibig|puso|sinta|halik|tinik|baliw|tahanan|akong|ikaw|vivamax|teleserye|pinoy|kagandahan|kahindik)\b/i;
const __TAG_WEAK = /\b(si|ni|sa|kay|ko|mo|ka|rin|din|daw|ba|yung|nung|ako|siya|kami|tayo|sila|ito|iyan|iyon|doon|dito|kung|dahil|namin|amin|iyo|kanila|pala|naman|at)\b/gi;
const __NG_STRONG = /\b(nollywood|yoruba|igbo|hausa|naija|nigerian|ghallywood|onye|odinaka|chineke|chukwu|ekene|ikenga|odogwu|olorisa|orisa|orisha|obatala|iyami|aladura|abeni|ayaba|sango|osun)\b/i;
const __NG_WEAK = /\b(emeka|ngozi|uche|ife|nwa|obi|ezinne|amaka|somto)\b/gi;
function __foreignTitle(title) {
  const t = String(title || '').toLowerCase();
  if (__TAG_STRONG.test(t) || __NG_STRONG.test(t)) return true;
  const tagWeak = new Set((t.match(__TAG_WEAK) || []).map(w => w.toLowerCase()));
  if (tagWeak.size >= 2) return true;
  const ngWeak = new Set((t.match(__NG_WEAK) || []).map(w => w.toLowerCase()));
  return ngWeak.size >= 2;
}

export function isExcludedOnline(m) {
  if (!m) return false;
  const title = String(m.title || '');
  const desc = String(m.description || m.summary || '');
  const country = String(m.countryName || '');
  const genres = (m.genres || []).map(g => (typeof g === 'string' ? g : g.name || '')).join(' ');
  // Bengali / Bangla
  if (/\b(bengali|bangla)\b/i.test(title) || /\b(bengali|bangla)\b/i.test(desc) || /\b(bengali|bangla)\b/i.test(genres)) return true;
  if (/[\u0980-\u09FF]/.test(title) || /[\u0980-\u09FF]/.test(desc)) return true;
  if (/bangladesh/i.test(country)) return true;
  // Urdu / Pakistani
  if (/\burdu\b/i.test(title) || /\burdu\b/i.test(desc) || /\burdu\b/i.test(genres)) return true;
  if (/pakistan/i.test(country) && !/india/i.test(title)) return true;
  // Nigerian / Nollywood / African Web Uploads
  if (/nigeria|ghana|ivory coast|côte d'ivoire|congo|cameroon|south africa|kenya|tanzania|uganda|zambia|zimbabwe|senegal|ethiopia|mozambique|botswana|namibia|rwanda|somalia/i.test(country)) return true;
  if (/\b(nollywood|yoruba|igbo|hausa|naija|nigerian|ghallywood)\b/i.test(title) ||
      /\b(nollywood|yoruba|igbo|hausa|naija|nigerian|ghallywood)\b/i.test(desc) ||
      /\b(nollywood|yoruba|igbo|hausa|naija|nigerian|ghallywood)\b/i.test(genres)) return true;
  // Indonesian
  if (/indonesia/i.test(country) || /\b(indonesia|indonesian|bahasa|sinetron)\b/i.test(title) || /\b(indonesia|indonesian|bahasa|sinetron)\b/i.test(desc)) return true;
  // Philippines / Filipino / Tagalog
  if (/philippines|filipino|tagalog/i.test(country) || /\b(philippines|filipino|tagalog|pinoy|vivaone|vivamax|teleserye)\b/i.test(title) || /\b(philippines|filipino|tagalog|pinoy|vivaone|vivamax|teleserye)\b/i.test(desc)) return true;
  if (__foreignTitle(title)) return true;
  // Punjabi / Pollywood
  if (/\b(punjabi|pollywood)\b/i.test(title) || /\b(punjabi|pollywood)\b/i.test(desc) || /\b(punjabi|pollywood)\b/i.test(genres)) return true;
  if (/[\u0A00-\u0A7F]/.test(title) || /[\u0A00-\u0A7F]/.test(desc)) return true;
  // Marathi
  if (/\bmarathi\b/i.test(title) || /\bmarathi\b/i.test(desc) || /\bmarathi\b/i.test(genres)) return true;
  return false;
}

export const isBengaliOnline = isExcludedOnline;

/**
 * Adapt a flat online record (poster / genres / year at the top level) to the
 * shared library card shape (metadata + _genres + _languages) so the merged
 * cards render identically to local files.
 */
export function decorateOnlineMovie(m) {
  if (isExcludedOnline(m)) return null;
  const rawGenres = Array.isArray(m.genres) ? m.genres : (m.genres ? [m.genres] : []);
  const mappedGenres = mapCatalogGenres(rawGenres);
  // The card's language = the audio it will actually play — the primary
  // edition's language from the server's dub merge ("corner"-verified),
  // falling back to title-based detection when no editions were merged.
  const isForeignOrigin = Boolean(m.countryName && m.countryName !== "India" && m.countryName !== "Pakistan");
  const primaryVoice = m.audioVersions?.[0]?.language;
  const language =
    primaryVoice && primaryVoice !== 'Original'
      ? primaryVoice
      : detectOnlineLanguage(m);
  const industry = isForeignOrigin ? "Hollywood" : detectOnlineIndustry(m);
  const releaseTs = m.releaseDate ? new Date(m.releaseDate).getTime() : 0;
  const y = parseInt(m.year, 10);
  const fallbackTs = !isNaN(y) && y > 1900 ? new Date(`${y}-06-15`).getTime() : 0;
  const calculatedAddedAt = (!isNaN(releaseTs) && releaseTs > 0)
    ? releaseTs
    : ((typeof m.addedAt === 'number' && m.addedAt > 0) ? m.addedAt : fallbackTs);
  return {
    ...m,
    addedAt: calculatedAddedAt,
    title: cleanCatalogTitle(m.title) || m.title,
    seriesTitle: m.seriesTitle ? cleanCatalogTitle(m.seriesTitle) : m.seriesTitle,
    poster: m.posterUrl || m.poster,
    backdrop: m.backdropUrl || m.posterUrl || m.backdrop,
    metadata: {
      poster: m.posterUrl || m.poster,
      backdrop: m.backdropUrl || m.posterUrl || m.backdrop,
      rating: m.rating,
      year: m.year,
      summary: m.description,
      genres: rawGenres
    },
    // Web catalog labels first (drive the genre filters), raw tags kept too
    _genres: mappedGenres,
    _languages: [language],
    _industry: industry,
    _online: true
  };
}

export function getItemRecency(item) {
  if (!item) return 0;
  if (item.releaseDate) {
    const ts = new Date(item.releaseDate).getTime();
    if (!isNaN(ts) && ts > 0) return ts;
  }
  if (typeof item.addedAt === 'number' && item.addedAt > 0) return item.addedAt;
  const y = parseInt(item.metadata?.year || item.year, 10);
  if (!isNaN(y) && y > 1900) {
    return new Date(`${y}-06-15`).getTime();
  }
  return 0;
}

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Returns true strictly if the title was released or added within the last 7 days (1 week).
 * After 1 week has passed, it is no longer marked as NEW.
 */
export function isItemNew(item) {
  if (!item) return false;
  const currentYear = new Date().getFullYear();
  const year = parseInt(item.metadata?.year || item.year || (item.releaseDate ? String(item.releaseDate).slice(0, 4) : 0), 10);
  if (year && year < currentYear) {
    return false;
  }
  // "New" means newly ADDED to our catalog — a film that hit the source this
  // week belongs on the New Releases shelf even if it premiered months ago
  // (the old releaseDate-only rule silently hid them; the "Sigma" bug).
  const discTs = typeof item.discoveredAt === 'number' ? item.discoveredAt : 0;
  const relTs = item.releaseDate ? new Date(item.releaseDate).getTime() : 0;
  const ts = discTs > 0 ? discTs : ((relTs > 0) ? relTs : (typeof item.addedAt === 'number' ? item.addedAt : 0));
  if (!ts) return false;
  const ageMs = Date.now() - ts;
  return ageMs >= -86400000 * 2 && ageMs <= ONE_WEEK_MS;
}
