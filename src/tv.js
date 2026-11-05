import { useEffect } from 'react';
import { IS_NATIVE_APP } from './config';

/**
 * Android TV support: D-pad spatial navigation + TV performance mode.
 *
 * TV remotes send Arrow keys + Enter + Back. The web content is mostly
 * clickable <div>s which a remote cannot operate, so we:
 *  1. Detect TV devices (dedicated TV APK appends "MovieFlixTV" to the
 *     WebView UA; TV device UAs and ?tv=1 also count).
 *  2. Add `tv-mode` to <html> — CSS shows a bold focus ring, scales the
 *     focused card, and disables GPU-heavy effects (backdrop-filter,
 *     infinite shimmer animations) that stall weak TV GPUs.
 *  3. Implement spatial navigation: arrows move focus to the nearest
 *     focusable element in that direction, the focused card is scrolled
 *     cleanly into view (clear of the sticky header and bottom dock),
 *     and Enter/Space clicks whatever is focused — even plain div cards.
 */

export const IS_TV = (() => {
  if (typeof window === 'undefined') return false;
  if (new URLSearchParams(window.location.search).get('tv') === '1') return true;
  if (!IS_NATIVE_APP) return false;
  const ua = navigator.userAgent || '';
  // "MovieFlixTV" is appended by the dedicated TV APK's capacitor config.
  return ua.includes('MovieFlixTV') || /TV|BRAVIA|AFT|FireTV|Chromecast|Android TV/i.test(ua) || ua.includes('CrKey');
})();

const FOCUSABLE = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled]):not([type=hidden])',
  'select:not([disabled])',
  '[tabindex="0"]',
  // click-target cards (divs with onClick) used across the app
  '.cine-card',
  '.moviebox-card',
  '.series-card',
  '.movie-list-item',
  '.continue-card',
  '.ep-num-btn',
  '.universe-tile-card',
  '.lang-hub-card',
  '.vf-nav-link',
  '.cine-dock-item',
  '.hub-filter-btn',
  '.menu-option'
].join(', ');

function isVisible(el) {
  const r = el.getBoundingClientRect();
  if (r.width <= 2 || r.height <= 2) return false;
  if (r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity || '1') > 0.05;
}

function center(r) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Pick the best candidate strictly in the given direction from `cur`. */
function nearestInDirection(cur, candidates, dx, dy) {
  const from = center(cur);
  let best = null;
  let bestScore = Infinity;
  for (const el of candidates) {
    const r = el.getBoundingClientRect();
    const c = center(r);
    const ddx = c.x - from.x;
    const ddy = c.y - from.y;
    // must be genuinely in the direction (allow small perpendicular jitter)
    const primary = dx !== 0 ? ddx * dx : ddy * dy;
    const cross = dx !== 0 ? Math.abs(ddy) : Math.abs(ddx);
    if (dx !== 0 && Math.sign(ddx) !== dx) continue;
    if (dy !== 0 && Math.sign(ddy) !== dy) continue;
    if (primary < 4 && cross < 4) continue; // same element
    const score = Math.sqrt(primary) + cross * 2.2;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

/** Focus `el` and scroll it into a comfortable on-screen position:
 *  centered inside its horizontal shelf row, and vertically clear of the
 *  sticky header (top) and the mobile dock (bottom). */
function focusAndReveal(el, instant) {
  el.focus({ preventScroll: true });
  const behavior = instant ? 'auto' : 'smooth';
  el.scrollIntoView({ block: 'nearest', inline: 'center', behavior });
  if (instant) return;
  requestAnimationFrame(() => {
    const r = el.getBoundingClientRect();
    if (r.top < 90 || r.bottom > window.innerHeight - 110) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  });
}

/** Scroll the page (or the app's scrollable container, if it isn't the
 *  window) by one shelf row. Returns false when already at that edge. */
function scrollPageBy(dy, instant) {
  let node = document.activeElement?.parentElement || null;
  let scroller = null;
  while (node && node !== document.body && node !== document.documentElement) {
    const cs = getComputedStyle(node);
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 4) {
      scroller = node;
      break;
    }
    node = node.parentElement;
  }
  const t = scroller || document.scrollingElement || document.documentElement;
  const atEdge = dy > 0
    ? (t.scrollHeight - t.scrollTop - t.clientHeight < 8)
    : (t.scrollTop < 8);
  if (atEdge) return false;
  t.scrollBy({ top: dy, behavior: instant ? 'auto' : 'smooth' });
  return true;
}

export function useTvNavigation() {
  useEffect(() => {
    if (!IS_TV) return undefined;

    document.documentElement.classList.add('tv-mode');

    // Land focus on the first card shortly after boot so the user
    // immediately sees where the remote cursor is.
    const bootFocus = setTimeout(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      const first = [...document.querySelectorAll(FOCUSABLE)].find(isVisible);
      if (first) {
        if (!first.hasAttribute('tabindex') && first.tabIndex < 0) first.setAttribute('tabindex', '-1');
        focusAndReveal(first);
      }
    }, 1400);

    // Perf: scanning the whole DOM per key press is expensive on TV
    // chipsets, so the focusable-candidate list is cached briefly and
    // held-down keys (e.repeat) are rate-limited with instant scrolling.
    let candidateCache = null;
    let candidateCacheAt = 0;
    const CANDIDATE_TTL = 200;
    let lastMoveAt = 0;
    const REPEAT_MIN_MS = 90;

    let rafPending = false;
    const onKeyDown = (e) => {
      const dir = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
      const active = document.activeElement;

      // The search modal runs its own keyboard system (arrow-highlight +
      // Enter opens) — spatial navigation must not fight it.
      if (document.querySelector('.sr-panel')) return;

      // Let text inputs keep caret movement
      if (active && active.tagName === 'INPUT' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.altKey) {
        return;
      }

      // Enter/Space must click div-based cards. Native controls (button,
      // a, input…) already act on these keys themselves, and card
      // components with their own Enter handlers are bypassed by
      // stopPropagation so the action fires exactly once.
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        const el = active;
        if (!el || el === document.body) return;
        const tag = el.tagName;
        if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        e.stopPropagation();
        el.click();
        return;
      }

      if (dir) {
        if (rafPending) return;
        // Rate-limit held-down keys: every repeat used to run a full DOM
        // scan + smooth-scroll retarget, which made holding a direction
        // feel like wading through mud on TVs.
        const now = Date.now();
        if (e.repeat) {
          if (now - lastMoveAt < REPEAT_MIN_MS) return;
          lastMoveAt = now;
        } else {
          lastMoveAt = now;
        }
        rafPending = true;
        requestAnimationFrame(() => { rafPending = false; });
        e.preventDefault();

        let cur = (active && active !== document.body && isVisible(active))
          ? active.getBoundingClientRect()
          : null;
        if (!cur) {
          // no focus yet: start from viewport centre
          cur = { left: window.innerWidth / 2 - 1, right: window.innerWidth / 2 + 1, top: window.innerHeight / 2 - 1, bottom: window.innerHeight / 2 + 1 };
        }

        if (!candidateCache || (now - candidateCacheAt) > CANDIDATE_TTL) {
          candidateCache = [...document.querySelectorAll(FOCUSABLE)].map(el => {
            // temporarily ensure focusability
            if (!el.hasAttribute('tabindex') && el.tabIndex < 0) el.setAttribute('tabindex', '-1');
            return el;
          });
          candidateCacheAt = now;
        }
        const next = nearestInDirection(cur, candidateCache, dir[0], dir[1]);
        if (next && isVisible(next)) {
          focusAndReveal(next, e.repeat);
        } else if (dir[1] !== 0) {
          // Past the last visible row: page down/up by one shelf row so the
          // next press can reach the rows that were offscreen.
          const moved = scrollPageBy(dir[1] * Math.round(window.innerHeight * 0.38), e.repeat);
          if (moved) candidateCacheAt = 0; // the page moved — rescan next press
        }
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      clearTimeout(bootFocus);
      window.removeEventListener('keydown', onKeyDown, true);
      document.documentElement.classList.remove('tv-mode');
    };
  }, []);
}
