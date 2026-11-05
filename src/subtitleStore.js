/**
 * Persistent per-title subtitle storage.
 *
 * Downloaded/imported subtitles used to live only in the player's React
 * state as blob: URLs — closing the player threw them away and the user
 * had to download again. This store keeps the actual VTT text in
 * localStorage keyed per title (and per episode for series), so the
 * "Imported & Downloaded" list survives leaving the player and even
 * app restarts. Blob URLs are regenerated on load — they cannot be
 * persisted themselves.
 */

const PREFIX = 'movieflix_subs_';
const MAX_AGE_DAYS = 180;

/** Stable storage key for whatever the player is currently playing. */
export function subtitleKeyFor(media, seasonNumber, episodeNumber) {
  const id = String(media?.id || media?.subjectId || 'unknown');
  const isEpisode = seasonNumber != null && episodeNumber != null;
  return `${PREFIX}${id}${isEpisode ? `_s${seasonNumber}e${episodeNumber}` : ''}`;
}

function readList(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    // Drop entries older than the retention window (stale subtitle
    // hoards should not quietly eat the localStorage quota).
    const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;
    return list.filter(s => s && typeof s.vtt === 'string' && (s.savedAt || 0) >= cutoff);
  } catch {
    return [];
  }
}

function writeList(key, list) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
    return true;
  } catch (e) {
    // Quota exceeded — evict the oldest entries and retry once.
    try {
      const sorted = [...list].sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
      while (sorted.length > 1) {
        sorted.shift();
        try {
          localStorage.setItem(key, JSON.stringify(sorted));
          return true;
        } catch { /* keep evicting */ }
      }
    } catch { /* give up silently — playback must not break */ }
    console.warn('[Subtitles] Could not persist subtitle:', e.message);
    return false;
  }
}

function vttToBlobUrl(vtt) {
  const blob = new Blob([vtt], { type: 'text/vtt;charset=utf-8' });
  return URL.createObjectURL(blob);
}

/** Persist one subtitle; returns the stored entry (with id) or null. */
export function storeSubtitle(key, { label, vtt }) {
  if (!key || typeof vtt !== 'string' || !vtt.trim()) return null;
  const list = readList(key);
  const entry = {
    id: `subs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    label: label || 'Subtitle',
    vtt,
    savedAt: Date.now()
  };
  writeList(key, [...list, entry]);
  return entry;
}

/** All stored subtitles for the key, revived as playable custom tracks. */
export function reviveStoredSubtitles(key) {
  return readList(key).map(s => ({
    type: 'custom',
    _storedId: s.id,
    url: vttToBlobUrl(s.vtt),
    label: s.label
  }));
}

/** Forget one stored subtitle by its revived track's _storedId. */
export function removeStoredSubtitle(key, storedId) {
  if (!key || !storedId) return;
  writeList(key, readList(key).filter(s => s.id !== storedId));
}
