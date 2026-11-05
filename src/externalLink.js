import { Browser } from '@capacitor/browser';

/**
 * Open an external URL. Inside the Android app this opens a Chrome Custom
 * Tab (via @capacitor/browser); on the web it opens a new browser tab.
 */
export function openExternalUrl(url) {
  if (!url) return;
  try {
    if (window.Capacitor?.isNativePlatform?.()) {
      Browser.open({ url }).catch(() => window.open(url, '_blank', 'noopener'));
    } else {
      window.open(url, '_blank', 'noopener');
    }
  } catch (e) {
    window.open(url, '_blank', 'noopener');
  }
}

export function openFullMovie(movie) {
  if (!movie) return;
  const url = movie.detailUrl ||
    `https://moviebox.ac/web/searchResult?keyword=${encodeURIComponent(movie.title || '')}`;
  openExternalUrl(url);
}
