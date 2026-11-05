import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { App as CapApp } from '@capacitor/app';
import { StatusBar } from '@capacitor/status-bar';
// Legacy stylesheet first: every component stylesheet (shell/catalog/details/
// home/player) and the Aurora system must be able to override it.
import './App.css';
import VideoPlayer from './VideoPlayer';
import Navbar from './components/Navbar';
import BottomNav from './components/BottomNav';
import HeroBillboard from './components/HeroBillboard';
import ShelfRow from './components/ShelfRow';
import MovieCard from './components/MovieCard';
import AllMoviesView from './components/AllMoviesView';
import WebSeriesView from './components/WebSeriesView';
import SeriesDetailsView from './components/SeriesDetailsView';
import MovieDetailsView from './components/MovieDetailsView';
import SearchModal from './components/SearchModal';
import AppUpdateModal from './components/AppUpdateModal';
import CuratorBento from './components/CuratorBento';
import VikyFlixLogo from './components/VikyFlixLogo';
import { decorateOnlineMovie, getItemRecency, isItemNew, cleanCatalogTitle, mapCatalogGenres } from './onlineLibrary';
import {
  Film,
  Tv,
  Bookmark,
  Play,
  Crown,
  Layers,
  Languages as LangIcon,
  ArrowRight,
  Flame,
  Star,
  Check,
  X,
  Wifi,
  WifiOff,
  Clapperboard
} from 'lucide-react';
import { API_BASE, IS_NATIVE_APP } from './config';
import { useTvNavigation, IS_TV } from './tv';
import { consumeBack } from './backNav';
import { getMediaPoster, formatCleanTitle } from './utils/mediaUtils';
import Poster from './components/Poster';

/**
 * Home shelf series card — the unified home rows fold a few web series into
 * the movie shelves; series open the full details page.
 */
const HomeSeriesCard = React.memo(function HomeSeriesCard({ show, onOpen, onPlayEpisode }) {
  const firstEp = show.seasons?.[0]?.episodes?.[0];
  const isOnlineSeries = show._online || show.source === 'MovieBox' || String(show.id || '').startsWith('mb_');

  const handlePlay = useCallback(() => {
    if (isOnlineSeries) onOpen(show);
    else if (firstEp) onPlayEpisode(firstEp, show);
    else onOpen(show);
  }, [isOnlineSeries, onOpen, firstEp, onPlayEpisode, show]);

  const handleOpenDetails = useCallback(() => {
    onOpen(show);
  }, [onOpen, show]);

  return (
    <MovieCard
      movie={show}
      layout="portrait"
      onPlay={handlePlay}
      onOpenDetails={handleOpenDetails}
    />
  );
});

function SectionHead({ eyebrow, title, count }) {
  return (
    <div className="vf-section-head">
      <span className="vf-section-eyebrow">{eyebrow}</span>
      <h2 className="vf-section-title">{title}</h2>
      {count != null && <span className="vf-section-count">{count}</span>}
    </div>
  );
}

const GENRE_RULES = [
  { id: 'Action', label: 'Action', icon: '🔥', color: 'linear-gradient(135deg, #ef4444, #b91c1c)', keywords: ['action', 'superhero', 'martial', 'fight', 'war', 'mission', 'combat', 'avengers', 'strike', 'soldier', 'battle', 'army', 'gun', 'furious', 'agent', 'spy', 'assassin', 'drive', 'fast', 'hunt', 'deadpool', 'batman', 'spider', 'iron', 'thor', 'captain', 'rambo', 'terminator', 'die hard', 'matrix', 'bond', 'wick'] },
  { id: 'Sci-Fi', label: 'Sci-Fi', icon: '🚀', color: 'linear-gradient(135deg, #06b6d4, #0284c7)', keywords: ['sci-fi', 'science fiction', 'alien', 'cyber', 'space', 'future', 'robot', 'planet', 'galaxy', 'time travel', 'matrix', 'avatar', 'dystopia', 'star wars', 'interstellar', 'apocalypse', 'jurassic', 'terminator', 'dune', 'ai', 'clone', 'superhuman', 'mars'] },
  { id: 'Thriller', label: 'Thriller', icon: '😱', color: 'linear-gradient(135deg, #8b5cf6, #6d28d9)', keywords: ['thriller', 'mystery', 'suspense', 'detective', 'murder', 'investigation', 'heist', 'conspiracy', 'hostage', 'stalker', 'killer', 'secret', 'clue', 'dark', 'revenge', 'psycho', 'shutter', 'gone girl', 'zodiac', 'se7en', 'knives', 'trap'] },
  { id: 'Comedy', label: 'Comedy', icon: '😂', color: 'linear-gradient(135deg, #f59e0b, #d97706)', keywords: ['comedy', 'humorous', 'sitcom', 'spoof', 'hilarious', 'laugh', 'satirical', 'parody', 'funny', 'fun', 'party', 'ted', 'hangover', 'friends', 'joke', 'dictator', 'borat', 'deadpool', 'superbad', 'dumb', 'crazy'] },
  { id: 'Drama', label: 'Drama', icon: '🎭', color: 'linear-gradient(135deg, #ec4899, #be185d)', keywords: ['drama', 'tragedy', 'emotional', 'historical', 'biographical', 'struggle', 'family', 'courtroom', 'heartfelt', 'life', 'story', 'journey', 'biography', 'award', 'godfather', 'shawshank', 'forrest', 'schindler', 'fight club', 'oppenheimer'] },
  { id: 'Horror', label: 'Horror', icon: '👻', color: 'linear-gradient(135deg, #64748b, #334155)', keywords: ['horror', 'ghost', 'haunted', 'demon', 'zombie', 'monster', 'witch', 'possessed', 'slasher', 'vampire', 'terror', 'evil', 'conjuring', 'creepy', 'curse', 'nightmare', 'evil', 'blood', 'annabelle', 'insidious', 'nun', 'saw', 'scream', 'exorcist', 'it', 'quiet'] },
  { id: 'Romance', label: 'Romance', icon: '❤️', color: 'linear-gradient(135deg, #f43f5e, #e11d48)', keywords: ['romance', 'romantic', 'love', 'couple', 'affair', 'wedding', 'lover', 'passion', 'relationship', 'kiss', 'valentine', 'titanic', 'notebook', 'la la land', 'fault', 'me before you', 'pride', 'about time'] },
  { id: 'Crime', label: 'Crime', icon: '🕵️', color: 'linear-gradient(135deg, #475569, #1e293b)', keywords: ['crime', 'gangster', 'mafia', 'cartel', 'robbery', 'drug', 'police', 'mob', 'underworld', 'godfather', 'cop', 'prison', 'jail', 'law', 'heist', 'irishman', 'scarface', 'goodfellas', 'narcos', 'peaky', 'detective', 'fbi'] },
  { id: 'Fantasy', label: 'Fantasy', icon: '🧙', color: 'linear-gradient(135deg, #a855f7, #7e22ce)', keywords: ['fantasy', 'magic', 'wizard', 'mythical', 'dragon', 'kingdom', 'fairy', 'legend', 'potter', 'rings', 'hobbit', 'beast', 'witch', 'lord of the rings', 'game of thrones', 'narnia', 'percy', 'avatar', 'aladdin', 'wonder'] }
];

// --- Catalog deduplication helpers (local + MovieBox editions) ---
function _catalogYear(item) {
  if (!item) return 0;
  const raw = item.metadata?.year || item.year || (item.releaseDate ? String(item.releaseDate).slice(0, 4) : 0);
  const p = parseInt(raw, 10);
  return !isNaN(p) && p > 1900 ? p : 0;
}

const _CANONICAL_GENRES = new Set(['Action', 'Sci-Fi', 'Thriller', 'Comedy', 'Drama', 'Horror', 'Romance', 'Crime', 'Fantasy']);
function _canonGenre(g) {
  const s = String(g || '').trim();
  if (!s) return s;
  for (const c of _CANONICAL_GENRES) {
    if (c.toLowerCase() === s.toLowerCase()) return c;
  }
  return s;
}

function dedupeCatalogItems(items) {
  if (!Array.isArray(items) || items.length === 0) return items || [];
  const groups = new Map();
  let anonymousIndex = 0;
  for (const m of items) {
    const base = String(cleanCatalogTitle(m?.title || '') || m?.title || '')
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    const year = _catalogYear(m);
    // Never group unrelated non-Latin titles that all normalized to an empty
    // ASCII key, or same-titled records whose year is unknown.
    const key = base && year
      ? `${base}|${year}`
      : `unique:${m?.id || m?.subjectId || anonymousIndex++}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  const result = [];
  for (const group of groups.values()) {
    if (group.length === 1) { result.push(group[0]); continue; }
    const score = (m) => {
      let s = 0;
      if (!m?._online) s += 100;
      const hasPoster = Boolean(m?.poster || m?.posterUrl || m?.image || m?.metadata?.poster);
      if (hasPoster) s += 50;
      const r = parseFloat(m?.metadata?.rating || m?.rating);
      if (!isNaN(r)) s += r;
      if (Array.isArray(m?.audioVersions) && m.audioVersions.length > 1) s += 5;
      return s;
    };
    const sorted = group.slice().sort((a, b) => score(b) - score(a));
    const kept = { ...sorted[0] };
    const genreSet = new Set();
    const genreList = [];
    const addGenre = (g) => {
      const c = _canonGenre(g);
      if (!c) return;
      const lc = c.toLowerCase();
      if (genreSet.has(lc)) return;
      genreSet.add(lc);
      genreList.push(c);
    };
    for (const m of group) {
      const gs = m?._genres || m?.metadata?.genres || (typeof m?.genre === 'string' ? [m.genre] : []);
      if (Array.isArray(gs)) for (const g of gs) addGenre(g);
      if (Array.isArray(m?.metadata?.genres)) for (const g of m.metadata.genres) addGenre(g);
    }
    if (genreList.length) {
      kept._genres = genreList;
      if (kept.metadata) kept.metadata = { ...kept.metadata, genres: genreList };
    }
    const langSet = new Set();
    const langList = [];
    for (const m of group) {
      const ls = m?._languages || [];
      if (Array.isArray(ls)) for (const l of ls) { if (!langSet.has(l)) { langSet.add(l); langList.push(l); } }
    }
    if (langList.length) kept._languages = langList;
    const avMap = new Map();
    for (const m of group) {
      if (Array.isArray(m?.audioVersions)) {
        for (const v of m.audioVersions) {
          if (v && v.language && !avMap.has(v.language)) avMap.set(v.language, v);
        }
      }
    }
    if (avMap.size) {
      const mergedAv = [...avMap.values()];
      if (!kept.audioVersions || mergedAv.length >= (kept.audioVersions?.length || 0)) {
        kept.audioVersions = mergedAv;
      }
    }
    result.push(kept);
  }
  return result;
}

const LANGUAGE_CARDS = [
  { name: 'Tamil', label: 'Tamil Cinema', code: 'TAM', bg: 'linear-gradient(135deg, #0c4a6e, #0284c7)', icon: '🎬' },
  { name: 'Telugu', label: 'Telugu Cinema', code: 'TEL', bg: 'linear-gradient(135deg, #831843, #db2777)', icon: '⚡' },
  { name: 'English', label: 'Hollywood English', code: 'ENG', bg: 'linear-gradient(135deg, #14532d, #16a34a)', icon: '🌐' },
  { name: 'Hindi', label: 'Bollywood Hindi', code: 'HIN', bg: 'linear-gradient(135deg, #581c87, #9333ea)', icon: '✨' },
  { name: 'Malayalam', label: 'Malayalam Cinema', code: 'MAL', bg: 'linear-gradient(135deg, #7c2d12, #ea580c)', icon: '🌴' },
  { name: 'Kannada', label: 'Kannada Cinema', code: 'KAN', bg: 'linear-gradient(135deg, #312e81, #6366f1)', icon: '🌟' },
  { name: 'Korean', label: 'K-Drama & Korean', code: 'KOR', bg: 'linear-gradient(135deg, #881337, #e11d48)', icon: '🏮' }
];

const LANGUAGE_NAMES = {
  eng: 'English', tam: 'Tamil', tel: 'Telugu', hin: 'Hindi', mal: 'Malayalam',
  kan: 'Kannada', kor: 'Korean', jpn: 'Japanese', jap: 'Japanese',
  fre: 'French', fra: 'French', ger: 'German', deu: 'German', spa: 'Spanish',
  ind: 'Indonesian', chi: 'Chinese', zho: 'Chinese', rus: 'Russian',
  ita: 'Italian', por: 'Portuguese', ara: 'Arabic', tha: 'Thai',
  vie: 'Vietnamese', mar: 'Marathi', pan: 'Punjabi',
  guj: 'Gujarati', lit: 'Lithuanian'
};

const LANGUAGE_KEYWORDS = [
  ['Tamil', 'tamil'], ['Telugu', 'telugu'], ['Hindi', 'hindi'],
  ['Malayalam', 'malayalam'], ['Kannada', 'kannada'], ['Korean', 'korean'],
  ['Japanese', 'japanese'], ['English', 'english'], ['Spanish', 'spanish'],
  ['French', 'french'], ['Chinese', 'chinese'], ['German', 'german'],
  ['Russian', 'russian']
];

// Precompiled genre keyword matchers with word boundaries. The old code
// used plain substring matching, so short keywords polluted everything:
// Horror's keyword "it" matched every title containing the letters "it",
// Comedy's "fun" matched "function" etc.
const GENRE_KEYWORD_RES = GENRE_RULES.map(g => ({
  id: g.id,
  // Keywords are plain words/phrases (a-z, 0-9, space, hyphen) so no
  // regex escaping is needed; boundaries keep 'it'/'fun'/'gun' honest.
  re: new RegExp('(^|[^a-z0-9])(' + g.keywords.join('|') + ')(?=$|[^a-z0-9])', 'i')
}));

function getMovieGenres(movie) {
  if (Array.isArray(movie.metadata?.genres) && movie.metadata.genres.length > 0) {
    return mapCatalogGenres(movie.metadata.genres);
  }
  if (typeof movie.metadata?.genre === 'string' && movie.metadata.genre.length > 0) {
    const list = movie.metadata.genre.split(',').map(s => s.trim()).filter(Boolean);
    if (list.length > 0) return mapCatalogGenres(list);
  }
  const textToScan = `${movie.title || ''} ${movie.filename || ''} ${movie.metadata?.summary || ''} ${movie.metadata?.stars || ''}`.toLowerCase();
  const matched = [];
  for (const g of GENRE_KEYWORD_RES) {
    if (g.re.test(textToScan)) {
      matched.push(g.id);
      if (matched.length >= 2) break;
    }
  }
  // No real signal = no genre. Never invent one: the old code assigned a
  // pseudo-random pair from a title hash, which put untagged titles into
  // completely wrong category shelves.
  return matched;
}

function getMovieLanguages(movie) {
  const langs = new Set();
  const tracks = movie.tracks?.audioTracks || [];
  for (const t of tracks) {
    const code = String(t.language || '').toLowerCase();
    if (!code) continue;
    langs.add(LANGUAGE_NAMES[code] || code);
  }
  // Title tags and keyword markers catch items without probed tracks
  // (online catalog rows in particular): "[Hindi]", trailing "English"…
  for (const [name, kw] of LANGUAGE_KEYWORDS) {
    const re = new RegExp('(^|[^a-z0-9])' + kw + '(?=$|[^a-z0-9])', 'i');
    if (re.test(movie.title || '')) langs.add(name);
  }
  return [...langs];
}

// Catalog persistence keys + helper. (These were referenced but no longer
// defined after a refactor — the ReferenceErrors silently froze client
// catalog syncing: stamps never advanced and boot caches never persisted.)
const CATALOG_CACHE_KEY = 'vikyflix_cached_catalog_v2';
const CATALOG_STAMP_KEY = 'vikyflix_cached_catalog_synced_at';
const CATALOG_DB_NAME = 'movieflix-catalog-db';
const CATALOG_DB_STORE = 'catalog';

function openCatalogDb() {
  return new Promise((resolve) => {
    try {
      const rq = indexedDB.open(CATALOG_DB_NAME, 1);
      rq.onupgradeneeded = () => {
        if (!rq.result.objectStoreNames.contains(CATALOG_DB_STORE)) {
          rq.result.createObjectStore(CATALOG_DB_STORE);
        }
      };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => resolve(null);
      rq.onblocked = () => resolve(null);
    } catch (e) { resolve(null); }
  });
}

async function readFullCatalogCache() {
  const db = await openCatalogDb();
  if (!db) return [];
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(CATALOG_DB_STORE, 'readonly');
      const request = tx.objectStore(CATALOG_DB_STORE).get('latest');
      request.onsuccess = () => resolve(Array.isArray(request.result?.movies) ? request.result.movies : []);
      request.onerror = () => reject(request.error || new Error('Could not read catalog cache'));
    });
  } finally {
    db.close();
  }
}

async function writeFullCatalogCache(movies) {
  const db = await openCatalogDb();
  if (!db) return false;
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(CATALOG_DB_STORE, 'readwrite');
      tx.objectStore(CATALOG_DB_STORE).put({ movies, savedAt: Date.now() }, 'latest');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Could not persist catalog cache'));
      tx.onabort = () => reject(tx.error || new Error('Catalog cache write aborted'));
    });
    return true;
  } finally {
    db.close();
  }
}

// Instant-boot snapshot kept in localStorage; the full catalog lives in
// IndexedDB. Must stay small — localStorage has a ~5MB quota and a quota
// throw used to skip the sync-stamp write below, freezing client updates.
const CATALOG_BOOT_LIMIT = 3000;

function buildCatalogBootCache(list) {
  return list.slice(0, CATALOG_BOOT_LIMIT).map((m) => ({
    id: m.id,
    subjectId: m.subjectId,
    title: m.title,
    year: m.year,
    releaseDate: m.releaseDate,
    addedAt: m.addedAt,
    genres: m.genres,
    rating: m.rating,
    poster: m.poster,
    backdrop: m.backdrop,
    subjectType: m.subjectType,
    duration: m.duration,
    isSeries: m.isSeries,
    hasResource: m.hasResource,
    corner: m.corner,
    countryName: m.countryName,
    detailPath: m.detailPath,
    description: m.description,
    ...(m.audioVersions ? { audioVersions: m.audioVersions } : {})
  }));
}

function readCatalogSyncedAt() {
  try {
    const value = Number(localStorage.getItem(CATALOG_STAMP_KEY));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch (e) {
    return 0;
  }
}

export default function App() {
  useTvNavigation();
  const [movies, setMovies] = useState([]);
  const [series, setSeries] = useState([]);
  const readySignaledRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [activeTab, setActiveTab] = useState('home'); // 'home' | 'movies' | 'series' | 'genres' | 'languages' | 'watchlist'
  
  // Navigation filters passed to the catalog views (quality dropdown removed)
  const [catalogInitialGenre, setCatalogInitialGenre] = useState(null);
  const [catalogInitialLanguage, setCatalogInitialLanguage] = useState(null);
  const [catalogInitialSection, setCatalogInitialSection] = useState(null);

  // Modals & Overlays
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [selectedMovieForDetails, setSelectedMovieForDetails] = useState(null);
  const [selectedSeriesForDetails, setSelectedSeriesForDetails] = useState(null);
  const [activePlayingMovie, setActivePlayingMovie] = useState(null);

  // Instant scroll-to-top details navigation
  const handleOpenMovieDetails = useCallback((m) => {
    setSelectedSeriesForDetails(null);
    setSelectedMovieForDetails(m);
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
  }, []);

  const handleOpenSeriesDetails = useCallback((show) => {
    setSelectedMovieForDetails(null);
    setSelectedSeriesForDetails(show);
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
  }, []);
  // Hide Android Status Bar across the app for true full-screen cinema mode
  useEffect(() => {
    try {
      StatusBar.hide().catch(() => {});
    } catch (e) {}
  }, []);

  // Hardware Android Back Button & Edge Swipe Gesture Handling
  useEffect(() => {
    let listenerPromise = null;
    try {
      listenerPromise = CapApp.addListener('backButton', () => {
        if (activePlayingMovie) {
          setActivePlayingMovie(null);
        } else if (selectedMovieForDetails) {
          setSelectedMovieForDetails(null);
        } else if (selectedSeriesForDetails) {
          setSelectedSeriesForDetails(null);
        } else if (isSearchOpen) {
          setIsSearchOpen(false);
        } else if (consumeBack()) {
          // an internal view state (e.g. a See All section) handled the back
          return;
        } else if (activeTab !== 'home') {
          setActiveTab('home');
        } else {
          CapApp.exitApp();
        }
      });
    } catch (e) {}

    return () => {
      if (listenerPromise && typeof listenerPromise.then === 'function') {
        listenerPromise.then(l => l && l.remove && l.remove()).catch(() => {});
      }
    };
  }, [activePlayingMovie, selectedMovieForDetails, selectedSeriesForDetails, isSearchOpen, activeTab]);


  // Theme & Watchlist State
  const [theme, setTheme] = useState(() => localStorage.getItem('vickyflix_theme') || 'dark');
  const [watchlist, setWatchlist] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('vickyflix_watchlist') || '[]');
    } catch (e) {
      return [];
    }
  });

  // Continue Watching Progress
  const [continueWatchingList, setContinueWatchingList] = useState([]);

  // Connectivity state — designed offline / reconnected feedback
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  const [reconnected, setReconnected] = useState(false);
  useEffect(() => {
    const goOnline = () => {
      setIsOnline(true);
      setReconnected(true);
      window.setTimeout(() => setReconnected(false), 2600);
    };
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const [isRescanning, setIsRescanning] = useState(false);

  // Sync theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.body.className = `theme-${theme}`;
    localStorage.setItem('vickyflix_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  // Watchlist persistence
  const toggleWatchlist = (movie) => {
    setWatchlist((prev) => {
      const exists = prev.includes(movie.id);
      const next = exists ? prev.filter(id => id !== movie.id) : [...prev, movie.id];
      localStorage.setItem('vickyflix_watchlist', JSON.stringify(next));
      return next;
    });
  };

  // The app is cloud-first: the build PC's local library was discontinued.
  // Boot readiness signals immediately and the catalog hydrates from the
  // MovieBox sync (fetchCatalog) + the on-device IndexedDB boot cache.
  const fetchMovies = async () => {
    setMovies([]);
    setSeries([]);
    setLoading(false);
    setLoadError(false);
    if (!readySignaledRef.current) {
      readySignaledRef.current = true;
      window.dispatchEvent(new Event('movieflix-ready'));
    }
  };

  // Check for in-app APK updates
  const checkAppUpdate = useCallback(async (isManual = false) => {
    try {
      // The TV APK updates from its own track — never from the mobile build.
      const platform = IS_TV ? 'tv' : 'mobile';
      const endpoints = [
        `${API_BASE}/api/app/version?t=${Date.now()}&platform=${platform}`,
        `https://vikyflix.uk/api/app/version?t=${Date.now()}&platform=${platform}`,
        `https://vikyflix-server.onrender.com/api/app/version?t=${Date.now()}&platform=${platform}`
      ];
      for (const ep of endpoints) {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 6000);
          const res = await fetch(ep, { signal: ctrl.signal });
          clearTimeout(timer);
          if (res.ok) {
            const data = await res.json();
            const serverCode = parseInt(data.versionCode, 10) || 0;
            let localCode = 0;

            if (window.AndroidStreamBridge?.getAppVersionCode) {
              try {
                localCode = window.AndroidStreamBridge.getAppVersionCode();
              } catch (e) {}
            }
            if (!localCode) {
              try {
                const info = await CapApp.getInfo();
                localCode = parseInt(info.build, 10) || 0;
              } catch (e) {}
            }

            // Fallback for native Android container
            const isNative = Boolean(
              IS_NATIVE_APP ||
              window.AndroidStreamBridge ||
              (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) ||
              /Android/i.test(navigator.userAgent)
            );
            if (!localCode && isNative) {
              localCode = 1;
            }

            console.log(`[AppUpdate] Server: ${serverCode}, Local: ${localCode}, isNative: ${isNative}`);

            if (serverCode > localCode && isNative) {
              setAvailableUpdate(data);
              setShowUpdateModal(true);
              return true;
            }
          }
        } catch (e) {}
      }
    } catch (e) {}
    return false;
  }, []);

  const handleRescan = async () => {
    setIsRescanning(true);
    try {
      const hasUpdate = await checkAppUpdate(true);
      await fetchCatalog(true);
      if (!hasUpdate) {
        setCatalogUpdateToast('✨ Latest catalog synced!');
        setTimeout(() => setCatalogUpdateToast(null), 5000);
      }
    } catch (err) {
      alert('Error refreshing media library');
    } finally {
      setIsRescanning(false);
    }
  };

  useEffect(() => {
    fetchMovies();
    const t1 = setTimeout(checkAppUpdate, 1500);
    const t2 = setTimeout(checkAppUpdate, 5000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkAppUpdate();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [checkAppUpdate]);

  // Keyboard shortcut Ctrl+K for search
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsSearchOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Decorate movies once with genres/languages
  const decoratedMovies = useMemo(() => {
    return movies.map(m => ({
      ...m,
      _genres: getMovieGenres(m),
      _languages: getMovieLanguages(m)
    }));
  }, [movies]);

  // Decorate series once with genres/languages
  const decoratedSeries = useMemo(() => {
    return series.map(s => {
      const firstEp = s.seasons?.[0]?.episodes?.[0];
      return {
        ...s,
        _genres: mapCatalogGenres(s.metadata?.genres || (s.metadata?.genre ? s.metadata.genre.split(',').map(x=>x.trim()) : ['Drama', 'Thriller'])),
        _languages: firstEp ? getMovieLanguages(firstEp) : ['English']
      };
    });
  }, [series]);

  // Online library (MovieBox catalog) — instant boot from a compact local
  // snapshot, then a freshness-checked sync against the live server.
  const [catalogUpdateToast, setCatalogUpdateToast] = useState(null);
  const [onlineTitles, setOnlineTitles] = useState(() => {
    try {
      localStorage.removeItem('vikyflix_cached_catalog'); // Clean legacy stale cache
      const cached = localStorage.getItem(CATALOG_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    return [];
  });
  const onlineTitlesRef = useRef(onlineTitles);
  useEffect(() => { onlineTitlesRef.current = onlineTitles; }, [onlineTitles]);
  const catalogHydratedRef = useRef(false);      // full live catalog loaded this session?
  const catalogFetchInFlightRef = useRef(false);

  const fetchCatalog = useCallback(async (force = false) => {
    if (catalogFetchInFlightRef.current) return false;
    catalogFetchInFlightRef.current = true;
    try {
      // Already hydrated this session? Poll the tiny metadata probe first and
      // skip the multi-megabyte download when nothing changed server-side.
      if (!force && catalogHydratedRef.current) {
        try {
          const metaCtrl = new AbortController();
          const metaTimer = setTimeout(() => metaCtrl.abort(), 5000);
          let metaRes;
          try {
            metaRes = await fetch(`${API_BASE}/api/moviebox/catalog/meta`, { signal: metaCtrl.signal, cache: 'no-store' });
          } finally {
            clearTimeout(metaTimer);
          }
          if (metaRes.ok) {
            const meta = await metaRes.json();
            const serverStamp = Date.parse(meta.fetchedAt || '') || 0;
            if (!serverStamp || serverStamp === readCatalogSyncedAt()) return true;
          }
        } catch (e) {}
      }

      // The live catalog is large; a short timeout used to abort it mid-flight
      // and silently swap in a days-old mirror snapshot — which is exactly how
      // new releases "stopped syncing". Give the live server real time, and
      // use the mirrors only on a cold install where nothing exists yet.
      const hasBootCache = (() => {
        try { return (localStorage.getItem(CATALOG_CACHE_KEY) || '').length > 2; } catch (e) { return false; }
      })();
      const syncedAt = readCatalogSyncedAt();

      const catalogQs = force ? '?refresh=1' : '';
      const candidates = [
        { url: `${API_BASE}/api/moviebox/catalog${catalogQs}`, timeout: force ? 120000 : 90000 },
        { url: `https://vikyflix.uk/api/moviebox/catalog${catalogQs}`, timeout: force ? 120000 : 90000 },
        // Always-on cloud fallback (Render): catalog + updates keep working
        // when the build PC is offline. Playback itself resolves on-device.
        { url: `https://vikyflix-server.onrender.com/api/moviebox/catalog${catalogQs}`, timeout: 90000 }
      ];


      const tried = new Set();
      for (const { url, timeout } of candidates) {
        if (tried.has(url)) continue; // API_BASE can already be the production domain
        tried.add(url);
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), timeout);
          let res;
          try {
            res = await fetch(url, { signal: ctrl.signal, cache: 'no-cache' });
          } finally {
            clearTimeout(timer);
          }
          if (!res.ok) continue;

          const data = await res.json();
          const list = Array.isArray(data.movies) ? data.movies : (Array.isArray(data) ? data : []);
          if (!list.length) continue;

          const incomingAt = Date.parse(data.fetchedAt || '') || 0;
          if (syncedAt && incomingAt && incomingAt < syncedAt) {
            // Older than what this device already synced — never downgrade.
            continue;
          }

          const previous = onlineTitlesRef.current;
          if (previous.length && previous.length >= list.length * 0.8) {
            const prevSet = new Set(previous.map((m) => m.id));
            const newItems = list.filter((m) => !prevSet.has(m.id));
            if (newItems.length > 0) {
              setCatalogUpdateToast(`✨ ${newItems.length} new title${newItems.length > 1 ? 's' : ''} added!`);
              setTimeout(() => setCatalogUpdateToast(null), 6000);
            }
          }

          setOnlineTitles(list);
          onlineTitlesRef.current = list;
          catalogHydratedRef.current = true;
          // Keep the full catalog in IndexedDB (not localStorage's small quota)
          // so future cold starts can meta-check and avoid re-downloading it.
          writeFullCatalogCache(list).catch((err) => console.warn('[CatalogSync] Could not persist full catalog cache:', err));
          // Stamp FIRST and independently: if the boot-cache write ever hits
          // a storage quota, sync state must still advance.
          try { localStorage.setItem(CATALOG_STAMP_KEY, String(incomingAt || Date.now())); } catch (e) {}
          try {
            localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(buildCatalogBootCache(list)));
          } catch (e) {
            console.warn('[CatalogSync] Boot cache too large; IndexedDB copy is authoritative.');
          }
          return true;
        } catch (err) {
          // Try the next tier quietly.
        }
      }
      return false;
    } finally {
      catalogFetchInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const hydrateAndSync = async () => {
      try {
        const cachedFullCatalog = await readFullCatalogCache();
        if (!cancelled && cachedFullCatalog.length) {
          onlineTitlesRef.current = cachedFullCatalog;
          catalogHydratedRef.current = true;
          setOnlineTitles(cachedFullCatalog);
        }
      } catch (err) {
        console.warn('[CatalogSync] Full catalog cache unavailable; fetching fresh catalog:', err);
      }
      if (!cancelled) fetchCatalog(false);
    };
    hydrateAndSync();
    // Auto-refresh catalog when app gains focus / becomes visible
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchCatalog(false);
        fetchMovies();
      }
    };
    // Periodic background sync every 10 minutes while app is running
    const syncInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchCatalog(false);
      }
    }, 10 * 60 * 1000);

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      cancelled = true;
      clearInterval(syncInterval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchCatalog]);

  
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

function _isExcludedItemImpl(t) {
    if (!t) return false;
    const title = String(t.title || '');
    const desc = String(t.metadata?.summary || t.description || '');
    const country = String(t.countryName || '');
    const langs = (t._languages || []).join(' ');
    // Bengali / Bangla
    if (/\b(bengali|bangla)\b/i.test(title) || /\b(bengali|bangla)\b/i.test(desc) || /\b(bengali|bangla)\b/i.test(langs)) return true;
    if (/[\u0980-\u09FF]/.test(title) || /[\u0980-\u09FF]/.test(desc)) return true;
    if (/bangladesh/i.test(country)) return true;
    // Urdu / Pakistani
    if (/\burdu\b/i.test(title) || /\burdu\b/i.test(desc) || /\burdu\b/i.test(langs)) return true;
    if (/pakistan/i.test(country) && !/india/i.test(title)) return true;
    // Nigerian / Nollywood / African Web Uploads
    if (/nigeria|ghana|ivory coast|côte d'ivoire|congo|cameroon|south africa|kenya|tanzania|uganda|zambia|zimbabwe|senegal|ethiopia|mozambique|botswana|namibia|rwanda|somalia/i.test(country)) return true;
    if (/\b(nollywood|yoruba|igbo|hausa|naija|nigerian|ghallywood|african movie)\b/i.test(title) ||
        /\b(nollywood|yoruba|igbo|hausa|naija|nigerian|ghallywood|african movie)\b/i.test(desc)) return true;
    // Exclude unrated 0.0 titles
    const rVal = parseFloat(t.metadata?.rating || t.rating);
    if (!isNaN(rVal) && rVal <= 0) return true;
    if (t.rating === '0.0' || t.rating === '0') return true;
    if (!country && (!t.rating || rVal <= 0)) return true;
    // Indonesian
    if (/indonesia/i.test(country) || /\b(indonesia|indonesian|bahasa|sinetron)\b/i.test(title) || /\b(indonesia|indonesian|bahasa|sinetron)\b/i.test(desc)) return true;
    // Philippines / Filipino / Tagalog
    if (/philippines|filipino|tagalog/i.test(country) || /\b(philippines|filipino|tagalog|pinoy|vivaone|vivamax|teleserye|calapan)\b/i.test(title) || /\b(philippines|filipino|tagalog|pinoy|vivaone|vivamax|teleserye|calapan)\b/i.test(desc)) return true;

    // Punjabi / Pollywood
    if (/\b(punjabi|pollywood)\b/i.test(title) || /\b(punjabi|pollywood)\b/i.test(desc) || /\b(punjabi|pollywood)\b/i.test(langs)) return true;
    if (/[\u0A00-\u0A7F]/.test(title) || /[\u0A00-\u0A7F]/.test(desc)) return true;
    // Marathi
    if (/\bmarathi\b/i.test(title) || /\bmarathi\b/i.test(desc) || /\bmarathi\b/i.test(langs)) return true;
    return false;
  }

  const isExcludedItem = (t) => _isExcludedItemImpl(t) || (t && __foreignTitle(t.title));


  const onlineDecorated = useMemo(
    () => onlineTitles.map(decorateOnlineMovie).filter(t => t && !isExcludedItem(t)),
    [onlineTitles]
  );

  const getMediaYear = (m) => {
    if (!m) return 0;
    const raw = m.metadata?.year || m.year || (m.releaseDate ? String(m.releaseDate).slice(0, 4) : 0);
    const parsed = parseInt(raw, 10);
    return !isNaN(parsed) && parsed > 1900 ? parsed : 0;
  };

  // The merged catalog pools for the dedicated pages (online movies + series),
  // sorted strictly with the newest year and most recent releases first!
  const allCatalogMovies = useMemo(
    () => {
      const combined = [...decoratedMovies, ...onlineDecorated.filter(t => t.subjectType !== 2)].filter(m => !isExcludedItem(m));
      const deduped = dedupeCatalogItems(combined);
      return deduped.sort((a, b) => {
        const ya = getMediaYear(a);
        const yb = getMediaYear(b);
        if (ya !== yb) return yb - ya;
        return getItemRecency(b) - getItemRecency(a);
      });
    },
    [decoratedMovies, onlineDecorated]
  );
  const allCatalogSeries = useMemo(
    () => {
      const combined = [...decoratedSeries, ...onlineDecorated.filter(t => t.subjectType === 2)].filter(s => !isExcludedItem(s));
      const deduped = dedupeCatalogItems(combined);
      return deduped.sort((a, b) => {
        const ya = getMediaYear(a);
        const yb = getMediaYear(b);
        if (ya !== yb) return yb - ya;
        return getItemRecency(b) - getItemRecency(a);
      });
    },
    [decoratedSeries, onlineDecorated]
  );

  // Play a specific episode of a series. For online (MovieBox) series the
  // show's identity rides along so the player resolves the proxy stream for
  // exactly that season/episode (+ ?audio= edition switching keeps working).
  const handlePlayEpisode = useCallback((episode, show) => {
    const isOnline = Boolean(
      show?._online ||
      show?.source === 'MovieBox' ||
      String(show?.id || '').startsWith('mb_')
    );
    setActivePlayingMovie({
      ...show,
      ...episode,
      id: show?.id || episode.id,
      subjectId: show?.subjectId || episode.subjectId,
      detailPath: show?.detailPath || episode.detailPath,
      seriesTitle: show?.title || episode.seriesTitle,
      title: episode.title && episode.title !== 'Episode' ? `${show?.title || ''} - ${episode.title}` : (show?.title || episode.title),
      seasonNumber: episode.seasonNumber || 1,
      episodeNumber: episode.episodeNumber || 1,
      isSeries: true,
      subjectType: 2,
      source: isOnline ? 'MovieBox' : (show?.source || 'Local'),
      _online: isOnline,
      poster: show?.poster || episode.localThumbUrl,
      backdrop: show?.backdrop || show?.poster
    });
  }, []);

  const handlePlayAnyMedia = useCallback((m) => {
    if (!m) return;
    if (m.subjectType === 2 || m.isSeries === true) {
      handlePlayEpisode({
        id: `${m.subjectId || m.id}-1-1`,
        seasonNumber: m.seasonNumber || 1,
        episodeNumber: m.episodeNumber || 1,
        title: 'Episode 1',
        filename: 'Episode 1'
      }, m);
    } else {
      setActivePlayingMovie(m);
    }
  }, [handlePlayEpisode]);



  const removeContinueWatching = (movieId, e) => {
    if (e) e.stopPropagation();
    try {
      const stored = JSON.parse(localStorage.getItem('vickyflix_watch_progress') || '{}');
      delete stored[movieId];
      localStorage.setItem('vickyflix_watch_progress', JSON.stringify(stored));
      setContinueWatchingList(prev => prev.filter(m => m.id !== movieId));
    } catch (err) {}
  };

  // Switch to All Movies tab with specific pre-filter or section
  const navigateToAllMovies = useCallback((options = {}) => {
    setCatalogInitialGenre(options.genre || null);
    setCatalogInitialLanguage(options.language || null);
    setCatalogInitialSection(options.section || null);
    setActiveTab('movies');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Home shelves draw from the UNIFIED catalog (local + online movies and
  // series) — mirroring the merged library instead of the old local-only pool.
  const unifiedCatalog = useMemo(() => {
    const combined = [...allCatalogMovies, ...allCatalogSeries];
    return combined.sort((a, b) => {
      const ya = getMediaYear(a);
      const yb = getMediaYear(b);
      if (ya !== yb) return yb - ya;
      return getItemRecency(b) - getItemRecency(a);
    });
  }, [allCatalogMovies, allCatalogSeries]);

  // Load Continue Watching from localStorage
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('vickyflix_watch_progress') || '{}');
      const items = Object.values(stored)
        .map(item => {
          // Look across the unified catalog so online (MovieBox) titles resume too
          const m = unifiedCatalog.find(x => x.id === item.movieId) || decoratedMovies.find(x => x.id === item.movieId);
          if (!m) return null;
          const isItemSeries = Boolean(item.isSeries || m.isSeries || m.subjectType === 2 || m.seriesTitle);
          return {
            ...m,
            watchProgress: item.currentTime,
            watchDuration: item.duration,
            seasonNumber: isItemSeries ? (item.seasonNumber || m.seasonNumber || 1) : null,
            episodeNumber: isItemSeries ? (item.episodeNumber || m.episodeNumber || 1) : null,
            isSeries: isItemSeries,
            watchPct: item.duration > 0 ? Math.min(100, Math.round((item.currentTime / item.duration) * 100)) : 0,
            lastWatched: item.lastWatched || 0
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.lastWatched - a.lastWatched);
      setContinueWatchingList(items);
    } catch (e) {}
  }, [unifiedCatalog, decoratedMovies, activePlayingMovie]);

  const isSeriesItem = useCallback((m) => (
    m._online ? String(m.subjectType) === '2' : Array.isArray(m.seasons) && m.seasons.length > 0
  ), []);

  const itemHasPoster = useCallback((m) => {
    if (!m) return false;
    // Online (MovieBox) items must actually carry artwork — the poster proxy
    // can only serve what the upstream catalog has. Without this check,
    // artless entries render as placeholder cards in every shelf.
    if (m._online) {
      return Boolean((m.poster || m.posterUrl || m.image || m.metadata?.poster) && (m.id || m.subjectId));
    }
    return Boolean(m.poster || m.posterUrl || m.image || m.metadata?.poster || m.localThumbUrl);
  }, []);

  // A themed home row: strictly sorted by year from recent to older across the unified catalog.
  // Titles released in the last 7 days are kept exclusively in "New Releases"
  // until their 7 days pass, at which point they graduate into these genre shelves.
  const buildMixedShelf = useCallback((predicate) => {
    return unifiedCatalog
      .filter(m => predicate(m) && itemHasPoster(m) && !isItemNew(m) && !isExcludedItem(m))
      .sort((a, b) => {
        const ya = getMediaYear(a);
        const yb = getMediaYear(b);
        if (ya !== yb) return yb - ya;
        return getItemRecency(b) - getItemRecency(a);
      })
      .slice(0, 18);
  }, [unifiedCatalog, itemHasPoster]);

  // 1. Hero Spotlight movies (strictly 5 curated top movies)
  const heroSpotlightMovies = useMemo(() => {
    if (!allCatalogMovies.length) return [];
    const withPoster = allCatalogMovies.filter(itemHasPoster);
    const pool = withPoster.length >= 5 ? withPoster : allCatalogMovies;
    const sorted = [...pool]
      .filter(m => {
        const genres = (m._genres || m.genres || []).map(g => String(g).toLowerCase());
        if (genres.includes('reality') || genres.includes('talk-show')) return false;
        return true;
      })
      .sort((a, b) => {
        const rA = parseFloat(a.metadata?.rating || a.rating || 0);
        const rB = parseFloat(b.metadata?.rating || b.rating || 0);
        if (rA >= 6.0 && rB < 6.0) return -1;
        if (rB >= 6.0 && rA < 6.0) return 1;
        const ya = parseInt(a.metadata?.year || a.year) || 0;
        const yb = parseInt(b.metadata?.year || b.year) || 0;
        if (ya !== yb) return yb - ya;
        const recA = getItemRecency(a);
        const recB = getItemRecency(b);
        if (recA !== recB) return recB - recA;
        return rB - rA;
      });
    return sorted.slice(0, 5);
  }, [allCatalogMovies, itemHasPoster]);

  // 2. Top 10 Blockbusters (strictly 10)
  // Top 10 — ROLLING. Ranking only among recently released/added titles so
  // the shelf refreshes as new films arrive; all-time greats only fill the
  // remaining slots. (Before this, the whole catalog was ranked by all-time
  // rating, so the list could not change for months.)
  const top10Movies = useMemo(() => {
    const withPoster = allCatalogMovies.filter(itemHasPoster);
    const now = Date.now();
    const RECENT_WINDOW = 45 * 86400000; // 45 days
    const tsOf = (m) => {
      // Anchor recency on when the title entered the catalog when known.
      if (typeof m.discoveredAt === 'number' && m.discoveredAt > 0) return m.discoveredAt;
      const t = getItemRecency(m);
      return t > 0 ? t : 0;
    };
    const rank = (pool) => [...pool]
      .sort((a, b) => {
        // Real ratings only (unrated titles carry null now, not a fake 7.5).
        const rA = parseFloat(a.metadata?.rating || a.rating) || 0;
        const rB = parseFloat(b.metadata?.rating || b.rating) || 0;
        if (rB !== rA) return rB - rA;
        return tsOf(b) - tsOf(a);
      })
      .slice(0, 10);
    const fresh = withPoster.filter(m => now - tsOf(m) <= RECENT_WINDOW && tsOf(m) > 0);
    const list = rank(fresh);
    if (list.length < 10) {
      const seen = new Set(list.map(m => m.id));
      for (const m of rank(withPoster)) {
        if (list.length >= 10) break;
        if (!seen.has(m.id)) { list.push(m); seen.add(m.id); }
      }
    }
    return list;
  }, [allCatalogMovies, itemHasPoster]);

  // 3. New Releases — strictly titles released/added within the last 7 days (1 week).
  // Once the 7 days pass, they graduate out of this shelf and into their respective genres.
  const freshReleasesShelf = useMemo(() => {
    // Lead with the titles discovered most recently — a film that entered the
    // catalog today belongs at the FRONT of New Releases even if it premiered
    // months ago (release-date sorting used to bury it at the rail's end).
    const discoveryTs = (m) => (typeof m.discoveredAt === 'number' && m.discoveredAt > 0)
      ? m.discoveredAt
      : getItemRecency(m);
    return unifiedCatalog
      .filter(m => isItemNew(m) && itemHasPoster(m) && !isExcludedItem(m) && parseFloat(m.metadata?.rating || m.rating || 0) > 0)
      .sort((a, b) => discoveryTs(b) - discoveryTs(a))
      .slice(0, 24);
  }, [unifiedCatalog, itemHasPoster]);

  // 5. Action & High-Octane — merged shelf: movies + a few series
  const actionShelf = useMemo(
    () => buildMixedShelf(m => (m._genres || []).includes('Action')),
    [buildMixedShelf]
  );

  // 6. South Cinema Showcase (Tamil / Telugu / Malayalam / Kannada) — merged
  const southCinemaShelf = useMemo(
    () => buildMixedShelf(m => {
      // Strictly Indian cinema origin (not Hollywood/foreign movies dubbed into South languages)
      const isIndianOrigin = m.countryName === 'India' || (!m.countryName && !m._online) || ['Kollywood', 'Tollywood', 'Mollywood', 'Sandalwood'].includes(m._industry);
      if (!isIndianOrigin) return false;
      return (m._languages || []).some(l => ['Tamil', 'Telugu', 'Malayalam', 'Kannada'].includes(l));
    }),
    [buildMixedShelf]
  );

  // 7. Sci-Fi & Mind-Bending — merged
  const sciFiShelf = useMemo(
    () => buildMixedShelf(m => (m._genres || []).includes('Sci-Fi')),
    [buildMixedShelf]
  );

  // 8. Dark Thrillers & Mystery — merged
  const thrillerShelf = useMemo(
    () => buildMixedShelf(m => (m._genres || []).includes('Thriller')),
    [buildMixedShelf]
  );

  // Watchlist movies
  const watchlistMovies = useMemo(() => {
    return [...allCatalogMovies, ...allCatalogSeries].filter(m => watchlist.includes(m.id));
  }, [allCatalogMovies, allCatalogSeries, watchlist]);

  // Genre counts calculation (merged catalog so the tabs show real totals)
  const genreCounts = useMemo(() => {
    const counts = {};
    for (const m of unifiedCatalog) {
      for (const g of (m._genres || [])) {
        counts[g] = (counts[g] || 0) + 1;
      }
    }
    return counts;
  }, [unifiedCatalog]);

  // Language counts calculation (merged catalog so the tabs show real totals)
  const langCounts = useMemo(() => {
    const counts = {};
    for (const m of unifiedCatalog) {
      for (const l of (m._languages || [])) {
        counts[l] = (counts[l] || 0) + 1;
      }
    }
    return counts;
  }, [unifiedCatalog]);

  // Curators' Choice Bento Block items
  const curatorBentoData = useMemo(() => {
    const featured = top10Movies[1] || allCatalogMovies[1] || null;
    const secondary = [allCatalogMovies[3], allCatalogMovies[4]].filter(Boolean);
    return { featured, secondary };
  }, [top10Movies, allCatalogMovies]);

  return (
    <div className="cine-platform-root">
      {catalogUpdateToast && (
        <div className="catalog-update-toast">
          <span>{catalogUpdateToast}</span>
        </div>
      )}

      {/* Launch animation: single ignition intro lives in index.html (app only). */}

      {/* Universal Top Glass Navbar */}
      {!selectedSeriesForDetails && !selectedMovieForDetails && !activePlayingMovie && (
        <Navbar
          activeTab={selectedSeriesForDetails ? 'series' : activeTab}
          onTabChange={(tab) => {
            setSelectedSeriesForDetails(null);
            setCatalogInitialGenre(null);
            setCatalogInitialLanguage(null);
            setCatalogInitialSection(null);
            setActiveTab(tab);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          onOpenSearch={() => setIsSearchOpen(true)}
          theme={theme}
          onToggleTheme={toggleTheme}
          onRescan={handleRescan}
          isRescanning={isRescanning}
          watchlistCount={watchlist.length}
          onReplayIntro={() => setShowIntro(true)}
          updateAvailable={Boolean(availableUpdate)}
          onOpenUpdate={() => setShowUpdateModal(true)}
        />
      )}

      {/* Connectivity feedback */}
      {!isOnline && (
        <div className="vf-net-banner is-offline" role="status">
          <WifiOff size={15} />
          <span>You’re offline — showing what’s already loaded</span>
        </div>
      )}
      {isOnline && reconnected && (
        <div className="vf-net-banner is-online" role="status">
          <Wifi size={15} />
          <span>Back online</span>
        </div>
      )}

      {/* Main Experience Viewport */}
      <main className={`cine-main-viewport ${activeTab === 'home' || selectedSeriesForDetails || selectedMovieForDetails ? 'is-bleed' : ''}`}>
        {/* Branded first-load state */}
        {loading && !movies.length && !onlineTitles.length && !loadError && (
          <div className="vf-splash" role="status" aria-live="polite">
            <div className="vf-splash-mark" style={{ background: 'transparent', boxShadow: 'none' }}>
              <VikyFlixLogo size={38} variant="mark" animated glow />
            </div>
            <span className="vf-splash-word">MOVIE<span>FLIX</span></span>
            <div className="vf-splash-bar" />
            <span className="vf-splash-note">Preparing your cinema</span>
          </div>
        )}
        {loadError && !movies.length && !onlineTitles.length && (
          <div className="all-movies-empty" style={{ marginTop: '6rem' }}>
            <Film size={50} />
            <h3>Can't reach MovieFlix servers</h3>
            <p>The connection failed after several attempts. Check your internet and try again.</p>
            <button className="hero-btn-primary" onClick={() => { fetchMovies(); fetchAdminStats(); }}>
              Retry Connection
            </button>
          </div>
        )}
        {selectedSeriesForDetails ? (
          /* ========================================================
              FULL-PAGE IMMERSIVE SERIES DETAILS VIEW
             ======================================================== */
          <SeriesDetailsView
            key={selectedSeriesForDetails.id}
            series={selectedSeriesForDetails}
            onBack={() => {
              setSelectedSeriesForDetails(null);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            onPlayEpisode={handlePlayEpisode}
            isWatchlist={watchlist.includes(selectedSeriesForDetails.id)}
            onToggleWatchlist={toggleWatchlist}
            allSeries={allCatalogSeries}
            onSelectSeries={(show) => {
              setSelectedSeriesForDetails(show);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        ) : selectedMovieForDetails ? (
          /* ========================================================
              FULL-PAGE IMMERSIVE FILM DETAILS VIEW
             ======================================================== */
          <MovieDetailsView
            key={selectedMovieForDetails.id}
            movie={selectedMovieForDetails}
            onClose={() => {
              setSelectedMovieForDetails(null);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            onPlay={handlePlayAnyMedia}
            isWatchlist={watchlist.includes(selectedMovieForDetails.id)}
            onToggleWatchlist={toggleWatchlist}
            allMovies={allCatalogMovies}
            onSelectMovie={(m) => {
              setSelectedMovieForDetails(m);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            resumePercent={
              continueWatchingList.find((x) => x.id === selectedMovieForDetails.id)?.watchPct ?? null
            }
          />
        ) : (
          <>
            {/* ========================================================
                TAB 1: HOME (Curated, Clean, Limited Showcase)
               ======================================================== */}
            {activeTab === 'home' && (
          <div className="cine-tab-home">
            {/* Cinematic Hero Spotlight Carousel */}
            {heroSpotlightMovies.length > 0 && (
              <HeroBillboard
                movies={heroSpotlightMovies}
                onPlay={handlePlayAnyMedia}
                onOpenDetails={handleOpenMovieDetails}
                watchlist={watchlist}
                onToggleWatchlist={toggleWatchlist}
              />
            )}

            {/* Genre quick-strip — one tap into any mood */}
            <div className="vf-genre-strip" role="toolbar" aria-label="Browse by genre">
              {GENRE_RULES.map((genre) => (
                <button
                  key={genre.id}
                  type="button"
                  className="vf-genre-chip"
                  onClick={() => navigateToAllMovies({ genre: genre.id })}
                >
                  <span aria-hidden="true">{genre.icon}</span>
                  <span>{genre.label}</span>
                </button>
              ))}
            </div>

            {/* Content Rails Container */}
            <div className="cine-shelves-container">
              {/* 1. Continue Watching Rail (Only if user has active history) */}
              {continueWatchingList.length > 0 && (
                <ShelfRow 
                  title="Continue Watching" 
                  icon="⏱️" 
                >
                  {continueWatchingList.map((movie) => {
                    return (
                      <div 
                        key={movie.id} 
                        className="continue-card"
                        onClick={() => {
                          if (movie.isSeries || movie.subjectType === 2) {
                            handlePlayEpisode({
                              seasonNumber: movie.seasonNumber || 1,
                              episodeNumber: movie.episodeNumber || 1,
                              watchProgress: movie.watchProgress
                            }, movie);
                          } else {
                            setActivePlayingMovie(movie);
                          }
                        }}
                      >
                        <div className="continue-card-media">
                          <Poster
                            item={movie}
                            alt={movie.title}
                            className="continue-card-poster"
                            imgClassName="continue-card-img"
                            ratio="16 / 9"
                          />
                          <div className="continue-card-overlay">
                            <button className="continue-play-circle" aria-label="Resume playback">
                              <Play size={22} fill="#ffffff" />
                            </button>
                            <button 
                              className="continue-remove-btn" 
                              onClick={(e) => removeContinueWatching(movie.id, e)}
                              title="Remove from history"
                            >
                              <X size={14} />
                            </button>
                          </div>
                          <span className="continue-badge">RESUME</span>
                          <div className="continue-progress-track">
                            <div className="continue-progress-fill" style={{ width: `${movie.watchPct}%` }} />
                          </div>
                        </div>

                        <div className="continue-card-meta">
                          <h4 className="continue-title">{formatCleanTitle(movie.title)}</h4>
                          <span className="continue-subtitle">{movie.watchPct}% completed</span>
                        </div>
                      </div>
                    );
                  })}
                </ShelfRow>
              )}

              {/* 2. New Releases — strictly titles released/added within the last 7 days */}
              {freshReleasesShelf.length > 0 && (
                <ShelfRow
                  title="New Releases (Last 7 Days)"
                  icon="✨"
                  count={`${freshReleasesShelf.length} titles`}
                  onViewAll={() => navigateToAllMovies({ section: 'new-releases' })}
                >
                  {freshReleasesShelf.map((item) => isSeriesItem(item) ? (
                    <HomeSeriesCard
                      key={item.id}
                      show={item}
                      onOpen={handleOpenSeriesDetails}
                      onPlayEpisode={handlePlayEpisode}
                    />
                  ) : (
                    <MovieCard
                      key={item.id}
                      movie={item}
                      onPlay={handlePlayAnyMedia}
                      onOpenDetails={handleOpenMovieDetails}
                    />
                  ))}
                </ShelfRow>
              )}

              {/* 3. Top 10 Blockbusters on MovieFlix (Strictly Top 10) */}
              {top10Movies.length > 0 && (
                <ShelfRow 
                  title="Top 10 on MovieFlix" 
                  icon="🏆" 
                  onViewAll={() => navigateToAllMovies({ section: 'top-10' })}
                >
                  {top10Movies.map((movie, rankIdx) => {
                    return (
                      <div 
                        key={movie.id} 
                        className="top10-poster-card"
                        tabIndex={0}
                        role="button"
                        aria-label={`Top ${rankIdx + 1}: ${formatCleanTitle(movie.title)}`}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleOpenMovieDetails(movie);
                          }
                        }}
                        onClick={() => handleOpenMovieDetails(movie)}
                      >
                        <div className="top10-num-badge">{rankIdx + 1}</div>
                        <div className="top10-poster-wrap">
                          <Poster
                            item={movie}
                            alt={movie.title}
                            className="top10-poster"
                            imgClassName="top10-poster-img"
                            ratio="2 / 3"
                          />
                          <div className="top10-hover-overlay">
                            <button 
                              className="top10-quick-play"
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePlayAnyMedia(movie);
                              }}
                              aria-label="Play movie"
                            >
                              <Play size={20} fill="#ffffff" />
                            </button>
                          </div>
                          <span className="top10-pill-rank">TOP #{rankIdx + 1}</span>
                          <div className="top10-info-caption">
                            <h4>{formatCleanTitle(movie.title)}</h4>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </ShelfRow>
              )}

              {/* Asymmetrical Curators' Choice Bento Block */}
              {curatorBentoData.featured && (
                <CuratorBento
                  featuredItem={curatorBentoData.featured}
                  secondaryItems={curatorBentoData.secondary}
                  onPlay={handlePlayAnyMedia}
                  onOpenDetails={handleOpenMovieDetails}
                  watchlist={watchlist}
                  onToggleWatchlist={toggleWatchlist}
                />
              )}

              {/* 4. High-Octane Action & Thrillers */}
              {actionShelf.length > 0 && (
                <ShelfRow 
                  title="Action & Thrillers" 
                  icon="💥" 
                  onViewAll={() => navigateToAllMovies({ genre: 'Action' })}
                >
                  {actionShelf.map((item) => isSeriesItem(item) ? (
                    <HomeSeriesCard
                      key={item.id}
                      show={item}
                      onOpen={handleOpenSeriesDetails}
                      onPlayEpisode={handlePlayEpisode}
                    />
                  ) : (
                    <MovieCard
                      key={item.id}
                      movie={item}
                      onPlay={handlePlayAnyMedia}
                      onOpenDetails={handleOpenMovieDetails}
                    />
                  ))}
                </ShelfRow>
              )}

              {/* 5. South Cinema Gems */}
              {southCinemaShelf.length > 0 && (
                <ShelfRow 
                  title="South Cinema Gems" 
                  icon="⭐" 
                  onViewAll={() => navigateToAllMovies({ language: 'Tamil' })}
                >
                  {southCinemaShelf.map((item) => isSeriesItem(item) ? (
                    <HomeSeriesCard
                      key={item.id}
                      show={item}
                      onOpen={handleOpenSeriesDetails}
                      onPlayEpisode={handlePlayEpisode}
                    />
                  ) : (
                    <MovieCard
                      key={item.id}
                      movie={item}
                      onPlay={handlePlayAnyMedia}
                      onOpenDetails={handleOpenMovieDetails}
                    />
                  ))}
                </ShelfRow>
              )}

              {/* 6. Sci-Fi & Mind-Bending Worlds */}
              {sciFiShelf.length > 0 && (
                <ShelfRow 
                  title="Sci-Fi & Fantasy" 
                  icon="🚀" 
                  onViewAll={() => navigateToAllMovies({ genre: 'Sci-Fi' })}
                >
                  {sciFiShelf.map((item) => isSeriesItem(item) ? (
                    <HomeSeriesCard
                      key={item.id}
                      show={item}
                      onOpen={handleOpenSeriesDetails}
                      onPlayEpisode={handlePlayEpisode}
                    />
                  ) : (
                    <MovieCard
                      key={item.id}
                      movie={item}
                      onPlay={handlePlayAnyMedia}
                      onOpenDetails={handleOpenMovieDetails}
                    />
                  ))}
                </ShelfRow>
              )}

              {/* 7. Dark Thrillers & Mystery */}
              {thrillerShelf.length > 0 && (
                <ShelfRow 
                  title="Dark Thrillers & Mystery" 
                  icon="🔍" 
                  onViewAll={() => navigateToAllMovies({ genre: 'Thriller' })}
                >
                  {thrillerShelf.map((item) => isSeriesItem(item) ? (
                    <HomeSeriesCard
                      key={item.id}
                      show={item}
                      onOpen={handleOpenSeriesDetails}
                      onPlayEpisode={handlePlayEpisode}
                    />
                  ) : (
                    <MovieCard
                      key={item.id}
                      movie={item}
                      onPlay={handlePlayAnyMedia}
                      onOpenDetails={handleOpenMovieDetails}
                    />
                  ))}
                </ShelfRow>
              )}
            </div>
          </div>
        )}

        {/* ========================================================
            TAB 2: DEDICATED ALL MOVIES CATALOG VIEW
           ======================================================== */}
        {activeTab === 'movies' && (
          <AllMoviesView
            movies={allCatalogMovies}
            genresList={GENRE_RULES}
            languagesList={LANGUAGE_CARDS}
            initialGenre={catalogInitialGenre}
            initialLanguage={catalogInitialLanguage}
            initialSection={catalogInitialSection}
            onPlay={handlePlayAnyMedia}
            onOpenDetails={handleOpenMovieDetails}
            watchlist={watchlist}
            onToggleWatchlist={toggleWatchlist}
          />
        )}

        {/* ========================================================
            TAB 2.5: DEDICATED WEB SERIES VIEW
           ======================================================== */}
        {activeTab === 'series' && (
          <WebSeriesView
            seriesList={allCatalogSeries}
            genresList={GENRE_RULES}
            languagesList={LANGUAGE_CARDS}
            onOpenSeriesDetails={handleOpenSeriesDetails}
            onPlay={handlePlayAnyMedia}
            onPlayEpisode={handlePlayEpisode}
          />
        )}

        {/* ========================================================
            TAB 3: GENRES DIRECTORY
           ======================================================== */}
        {activeTab === 'genres' && (
          <div className="all-movies-view">
            <SectionHead
              eyebrow="Genre Universe"
              title="Browse by Genre"
              count={`${GENRE_RULES.length} collections`}
            />

            {/* Genre Tiles Grid */}
            <div className="cine-genre-grid">
              {GENRE_RULES.map((genre) => (
                <div
                  key={genre.id}
                  className="universe-tile-card"
                  data-genre={genre.id}
                  style={{ background: genre.color }}
                  onClick={() => navigateToAllMovies({ genre: genre.id })}
                >
                  <div className="universe-tile-top">
                    <span className="universe-tile-icon">{genre.icon}</span>
                  </div>
                  <div className="universe-tile-bottom">
                    <span className="universe-tile-name">{genre.label}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Preview shelves per genre — drawn from the merged catalog */}
            <div className="cine-shelves-container">
              {GENRE_RULES.map((genre) => {
                const genreMovies = allCatalogMovies.filter(m => (m._genres || []).includes(genre.id)).slice(0, 8);
                if (genreMovies.length === 0) return null;
                return (
                  <ShelfRow
                    key={genre.id}
                    title={`${genre.icon} ${genre.label} Movies`}
                    onViewAll={() => navigateToAllMovies({ genre: genre.id })}
                  >
                    {genreMovies.map((movie) => (
                      <MovieCard
                        key={movie.id}
                        movie={movie}
                        onPlay={handlePlayAnyMedia}
                        onOpenDetails={handleOpenMovieDetails}
                        isWatchlist={watchlist.includes(movie.id)}
                        onToggleWatchlist={toggleWatchlist}
                      />
                    ))}
                  </ShelfRow>
                );
              })}
            </div>
          </div>
        )}

        {/* ========================================================
            TAB 4: LANGUAGES DIRECTORY
           ======================================================== */}
        {activeTab === 'languages' && (
          <div className="all-movies-view">
            <SectionHead
              eyebrow="Regional Collections"
              title="Browse by Language"
              count={`${LANGUAGE_CARDS.length} languages`}
            />

            {/* Language Hub Cards Grid */}
            <div className="cine-lang-grid">
              {LANGUAGE_CARDS.map((lang) => (
                <div
                  key={lang.name}
                  className="lang-hub-card"
                  data-lang={lang.name}
                  data-code={lang.code}
                  style={{ background: lang.bg }}
                  onClick={() => navigateToAllMovies({ language: lang.name })}
                >
                  <div className="lang-hub-top">
                    <span className="lang-hub-flag">{lang.icon}</span>
                    <span className="lang-hub-code">{lang.code}</span>
                  </div>
                  <div className="lang-hub-bottom">
                    <span className="lang-hub-name">{lang.name}</span>
                    <span className="lang-hub-sub">{lang.label}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Preview shelves per language — drawn from the merged catalog */}
            <div className="cine-shelves-container">
              {LANGUAGE_CARDS.map((lang) => {
                const langMovies = allCatalogMovies.filter(m => (m._languages || []).includes(lang.name)).slice(0, 8);
                if (langMovies.length === 0) return null;
                return (
                  <ShelfRow
                    key={lang.name}
                    title={`${lang.icon} ${lang.label}`}
                    onViewAll={() => navigateToAllMovies({ language: lang.name })}
                  >
                    {langMovies.map((movie) => (
                      <MovieCard
                        key={movie.id}
                        movie={movie}
                        onPlay={handlePlayAnyMedia}
                        onOpenDetails={handleOpenMovieDetails}
                        isWatchlist={watchlist.includes(movie.id)}
                        onToggleWatchlist={toggleWatchlist}
                      />
                    ))}
                  </ShelfRow>
                );
              })}
            </div>
          </div>
        )}

        {/* ========================================================
            TAB 5: MY LIST (Personal Watchlist)
           ======================================================== */}
        {activeTab === 'watchlist' && (
          <div className="all-movies-view">
            <SectionHead
              eyebrow="Personal Watchlist"
              title="My List"
              count={`${watchlistMovies.length} saved`}
            />

            {watchlistMovies.length === 0 ? (
              <div className="all-movies-empty">
                <Bookmark size={50} />
                <h3>Your List is Empty</h3>
                <p>Tap “My List” on any movie, series or detail page to save it here.</p>
                <button className="hero-btn-primary" onClick={() => setActiveTab('home')}>
                  Explore the catalog
                </button>
              </div>
            ) : (
              <div className="cine-catalog-grid">
                {watchlistMovies.map((movie) => (
                  <MovieCard
                    key={movie.id}
                    movie={movie}
                    onPlay={handlePlayAnyMedia}
                    onOpenDetails={(m) => {
                      // Series in the list open the full series page, not the movie sheet
                      if (m.subjectType === 2 || m.isSeries === true || (Array.isArray(m.seasons) && m.seasons.length > 0)) {
                        setSelectedSeriesForDetails(m);
                      } else {
                        setSelectedMovieForDetails(m);
                      }
                    }}
                    isWatchlist={true}
                    onToggleWatchlist={toggleWatchlist}
                  />
                ))}
              </div>
            )}
          </div>
        )}

          </>
        )}
      </main>

      {/* Floating Mobile Bottom Navigation Dock */}
      <BottomNav
        activeTab={selectedSeriesForDetails ? 'series' : activeTab}
        onTabChange={(tab) => {
          setSelectedSeriesForDetails(null);
          setActiveTab(tab);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onOpenSearch={() => setIsSearchOpen(true)}
        watchlistCount={watchlist.length}
      />

      {/* Command Palette Live Search Modal */}
      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        movies={allCatalogMovies}
        series={allCatalogSeries}
        onPlay={handlePlayAnyMedia}
        onOpenDetails={handleOpenMovieDetails}
        onOpenSeriesDetails={handleOpenSeriesDetails}
      />

      {/* Pro Video Player */}
      {activePlayingMovie && (
        <VideoPlayer
          movie={activePlayingMovie}
          onClose={() => setActivePlayingMovie(null)}
        />
      )}

      {/* User-confirmed APK download handoff */}
      {availableUpdate && showUpdateModal && (
        <AppUpdateModal
          updateInfo={availableUpdate}
          onClose={() => setShowUpdateModal(false)}
        />
      )}
    </div>
  );
}
