/**
 * VIKYFLIX - Media & Poster Resolution Utilities
 * Ensures robust image loading across desktop web, LG webOS TVs, and Android mobile (Capacitor)
 */
import { API_BASE } from '../config';

/**
 * Bump this when the poster cache policy or proxy semantics change: it forces
 * clients (especially the Android WebView) to re-request artwork that may have
 * been cached as a fallback placeholder during an upstream hiccup.
 */
const POSTER_CACHE_VERSION = '3';

function withPosterVersion(url) {
  if (!url || typeof url !== 'string') return url;
  if (!url.includes('/api/moviebox/poster/') && !url.includes('/api/moviebox/backdrop/')) return url;
  return `${url}${url.includes('?') ? '&' : '?'}pv=${POSTER_CACHE_VERSION}`;
}

/**
 * Cleanly extracts and normalizes poster URL from any movie/series object.
 * Handles MovieBox online items, local transcode posters, and series episode thumbnails.
 * Eliminates broken favicon fallbacks and hotlinking failures.
 */
export function getMediaPoster(item) {
  if (!item) return '';

  const isOnline = Boolean(
    item.source === 'MovieBox' ||
    item._online ||
    (item.id && String(item.id).startsWith('mb_')) ||
    item.subjectId
  );

  // 1. MovieBox online item: ALWAYS route through server's dedicated caching proxy
  if (isOnline && (item.id || item.subjectId)) {
    const mbId = item.id ? String(item.id) : `mb_${item.subjectId}`;
    return withPosterVersion(`${API_BASE}/api/moviebox/poster/${mbId}`);
  }

  // 2. Direct poster properties for local items
  const raw = item.poster || item.metadata?.poster || item.image || item.imageUrl || item.posterUrl;
  if (raw && typeof raw === 'string' && raw.trim()) {
    const trimmed = raw.trim();
    // Ignore placeholder favicon references
    if (!trimmed.includes('favicon.svg')) {
      if (trimmed.startsWith('//')) {
        return `https:${trimmed}`;
      } else if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        return trimmed;
      } else {
        const cleanPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
        return withPosterVersion(`${API_BASE}${cleanPath}`);
      }
    }
  }

  // 3. Local generated video thumbnail fallback
  if (item.localThumbUrl && typeof item.localThumbUrl === 'string') {
    const cleanThumb = item.localThumbUrl.startsWith('/') ? item.localThumbUrl : `/${item.localThumbUrl}`;
    return `${API_BASE}${cleanThumb}`;
  }

  // 4. Web series first episode thumbnail
  const firstEp = item.seasons?.[0]?.episodes?.[0];
  if (firstEp?.localThumbUrl && typeof firstEp.localThumbUrl === 'string') {
    const cleanThumb = firstEp.localThumbUrl.startsWith('/') ? firstEp.localThumbUrl : `/${firstEp.localThumbUrl}`;
    return `${API_BASE}${cleanThumb}`;
  }

  // 5. Local movie ID thumbnail endpoint
  if (item.id && !isOnline) {
    return `${API_BASE}/api/movies/${item.id}/thumbnail`;
  }

  return '';
}

/**
 * Resolves high-definition horizontal backdrop imagery for hero billboards & detail pages.
 * Falls back to dedicated poster when a 16:9 landscape still is unavailable.
 */
export function getMediaBackdrop(item) {
  if (!item) return '';

  const isOnline = Boolean(
    item.source === 'MovieBox' ||
    item._online ||
    (item.id && String(item.id).startsWith('mb_')) ||
    item.subjectId
  );

  // 1. MovieBox online item: check dedicated backdrop proxy
  if (isOnline && (item.id || item.subjectId)) {
    const mbId = item.id ? String(item.id) : `mb_${item.subjectId}`;
    return withPosterVersion(`${API_BASE}/api/moviebox/backdrop/${mbId}`);
  }

  // 2. Local or direct backdrop property
  const raw = item.backdrop || item.backdropUrl || item.metadata?.backdrop;
  if (raw && typeof raw === 'string' && raw.trim()) {
    const trimmed = raw.trim();
    if (!trimmed.includes('favicon.svg')) {
      if (trimmed.startsWith('//')) return `https:${trimmed}`;
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
      const cleanPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
      return withPosterVersion(`${API_BASE}${cleanPath}`);
    }
  }

  // Fallback to crisp poster
  return getMediaPoster(item);
}

/**
 * Normalizes title for clean display by stripping rip tags, resolutions, and codec names
 */
export function formatCleanTitle(title) {
  if (!title) return '';
  return title
    .replace(/^www\.[a-z0-9\.\-_]+\s*-\s*/gi, '')
    .replace(/[\(\[\s\.\-_](19\d{2}|20[0-3]\d)\b.*$/i, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^\)]*\)/g, ' ')
    .replace(/\b\d+(?:[\.\s]+\d+)?\s*(?:gb|mb|gib|mib|kbps)\b/gi, ' ')
    .replace(/\b(1080p|720p|480p|2160p|4k|bluray|brrip|bdrip|web-dl|webrip|hdrip|hq|dvdrip|x264|x265|hevc|h264|h265|avc|av1|aac|aac5\.1|dd5\.1|dd\+5\.1|atmos|yts|yify|bokutox|cmrg|vxt|rmteam|regret|lama|afm72|esub|esubs|org aud|unrated|true|extended|remastered|explicit|internal|repack)\b.*$/i, '')
    .replace(/[\._\-]/g, ' ')
    .replace(/\b\d+(?:[\.\s]+\d+)?\s*(?:gb|mb)\b/gi, ' ')
    .replace(/[\(\[\{\)\]\}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || title;
}
