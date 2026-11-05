/**
 * Centralized API & Server Configuration for Web & Native Android App (Capacitor)
 */
export const getApiBase = () => {
  if (typeof window === 'undefined') return '';

  // 1. Check if user configured a custom server URL in local storage
  const customUrl = localStorage.getItem('vickyflix_server_url');
  if (customUrl && customUrl.trim()) {
    return customUrl.trim().replace(/\/+$/, '');
  }

  // 2. Detect if running inside Capacitor Android APK
  const isCapacitorNative = Boolean(
    window.Capacitor?.isNativePlatform?.() ||
    window.location.protocol === 'capacitor:' ||
    (window.location.hostname === 'localhost' && (!window.location.port || window.location.port === '80'))
  );

  if (isCapacitorNative) {
    // Android App default: Connect to live production cloud server
    return 'https://vikyflix.uk';
  }

  // 3. Local Vite dev environment (e.g., port 5173 -> point to port 5000)
  if (window.location.port === '5173') {
    return `http://${window.location.hostname}:5000`;
  }

  // 4. Default web browser: use current domain
  return window.location.origin;
};

export const API_BASE = getApiBase();

// True when running inside the packaged Android app (Capacitor WebView).
// MovieBox online streaming is app-only: the plain website never shows it.
// ?app=1 is the intentional browser preview of the Android app experience.
export const IS_NATIVE_APP = (() => {
  if (typeof window === 'undefined') return false;
  return Boolean(
    window.Capacitor?.isNativePlatform?.() ||
    window.location.protocol === 'capacitor:' ||
    (window.location.hostname === 'localhost' && (!window.location.port || window.location.port === '80')) ||
    new URLSearchParams(window.location.search).get('app') === '1'
  );
})();

export default API_BASE;
