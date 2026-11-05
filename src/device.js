/**
 * Friendly device description for reports — e.g. "Android / SM-S918B",
 * "Android TV / AFTMM", "iPhone", "Windows / Chrome".
 *
 * Derived from the user-agent string only: no unique hardware id, no serial,
 * no location. Purely so the owner knows "which phone" without identifying who.
 */
import { IS_NATIVE_APP } from './config.js';

function browserName(ua) {
  if (/EdgA?\//i.test(ua)) return 'Edge';
  if (/OPR\//i.test(ua)) return 'Opera';
  if (/Firefox\//i.test(ua)) return 'Firefox';
  if (/Chrome\//i.test(ua)) return 'Chrome';
  if (/Safari\//i.test(ua)) return 'Safari';
  return 'browser';
}

function androidModel(ua) {
  // "Linux; Android 14; SM-S918B Build/..." / "...; Pixel 8 Pro)" / "; wv;"
  const match = ua.match(/Android[^;]*;\s*([^;)]+?)(?:\s+Build\/|\)|;|$)/i);
  if (!match) return '';
  return match[1]
    .replace(/^wv\s*;?\s*/i, '')
    .replace(/\s+Build\/.*$/i, '')
    .trim();
}

export function describeDevice() {
  try {
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    if (!ua) return 'Unknown device';

    const tv = ua.match(/(AFT[A-Z0-9]+|BRAVIA[^;)]*|FireTV[^;)]*|Chromecast[^;)]*)/i);
    if (tv || /MovieFlixTV|Android TV|CrKey/i.test(ua)) {
      return 'Android TV' + (tv ? ` / ${tv[1].trim()}` : '');
    }

    if (/Android/i.test(ua)) {
      const model = androidModel(ua);
      return 'Android' + (model ? ` / ${model}` : '');
    }

    if (/iPhone/i.test(ua)) return 'iPhone';
    if (/iPad/i.test(ua)) return 'iPad';
    if (/Windows NT/i.test(ua)) return `Windows / ${browserName(ua)}`;
    if (/Mac OS X/i.test(ua)) return `macOS / ${browserName(ua)}`;
    if (/Linux/i.test(ua)) return `Linux / ${browserName(ua)}`;
    if (IS_NATIVE_APP) return 'Android app';
    return `Web / ${browserName(ua)}`;
  } catch (e) {
    return 'Unknown device';
  }
}
