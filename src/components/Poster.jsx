import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Film } from 'lucide-react';
import { getMediaPoster } from '../utils/mediaUtils';

// Global cache of successfully loaded and decoded artwork URLs.
// Avoids re-showing skeletons or triggering redundant state updates on scroll.
const loadedPosterUrls = new Set();

/**
 * Poster — the single place artwork enters the UI.
 *
 * Optimized for silky 60fps scrolling:
 *  - Fast in-memory cache check: cached artwork renders instantly with no skeleton flash.
 *  - decoding="async" + loading="lazy" for native GPU texture streaming.
 *  - Zero duplicate render cycles during fast scroll.
 *  - Custom React.memo equality to avoid re-renders when parent states change.
 */
function Poster({
  item,
  src,
  alt,
  className = '',
  imgClassName = '',
  ratio = '2 / 3',
  eager = false,
  onClick
}) {
  const resolved = useMemo(() => {
    const raw = src || getMediaPoster(item);
    if (!raw) return '';
    let trimmed = String(raw).trim();
    if (trimmed.startsWith('//')) trimmed = `https:${trimmed}`;
    // Cards never need multi-MB originals: ask the poster proxy for a
    // right-sized thumbnail (heroes/backdrops still get a big one).
    if (trimmed.includes('/api/moviebox/poster/') && !/[?&]w=/.test(trimmed)) {
      trimmed += `${trimmed.includes('?') ? '&' : '?'}w=${eager ? 1400 : 700}`;
    }
    return trimmed;
  }, [src, item, eager]);

  const title = alt || item?.title || '';
  const imgRef = useRef(null);
  const [attempt, setAttempt] = useState(0);

  const finalSrc = useMemo(() => {
    if (!resolved) return '';
    if (attempt > 0 && resolved.startsWith('/')) return `${resolved}?retry=${attempt}`;
    return resolved;
  }, [resolved, attempt]);

  const [status, setStatus] = useState(() => {
    if (!resolved) return 'error';
    if (loadedPosterUrls.has(resolved)) return 'ready';
    return 'loading';
  });

  // A new URL resets state and checks if it's already in the decoded cache
  useEffect(() => {
    if (!resolved) {
      setStatus('error');
    } else if (loadedPosterUrls.has(resolved)) {
      setStatus('ready');
    } else {
      setStatus('loading');
    }
    setAttempt(0);
  }, [resolved]);

  const handleLoad = useCallback(() => {
    if (finalSrc) loadedPosterUrls.add(finalSrc);
    setStatus('ready');
  }, [finalSrc]);

  const handleError = useCallback(() => {
    console.warn(`[Poster] failed to load artwork: ${finalSrc}`);
    setStatus('error');
  }, [finalSrc]);

  // Synchronous ref callback handles browser-cached images before paint
  const setImgNode = useCallback((img) => {
    imgRef.current = img;
    if (img && img.complete) {
      if (img.naturalWidth > 0) {
        if (finalSrc) loadedPosterUrls.add(finalSrc);
        setStatus('ready');
      } else {
        setStatus('error');
      }
    }
  }, [finalSrc]);

  const retry = useCallback((e) => {
    e.stopPropagation();
    if (!resolved) return;
    setStatus('loading');
    setAttempt(a => a + 1);
  }, [resolved]);

  const initial = (title || '?').trim().charAt(0).toUpperCase();

  return (
    <div
      className={`vf-poster ${className}`}
      style={{ aspectRatio: ratio }}
      onClick={onClick}
    >
      {status === 'loading' && <div className="vf-skeleton vf-poster-skeleton" />}

      {resolved && status !== 'error' && (
        <img
          key={`${finalSrc}-${attempt}`}
          ref={setImgNode}
          src={finalSrc}
          alt={title}
          className={`vf-poster-img ${imgClassName} ${status === 'ready' ? 'is-ready' : ''}`}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={eager ? 'high' : 'auto'}
          referrerPolicy="no-referrer"
          onLoad={handleLoad}
          onError={handleError}
        />
      )}

      {status === 'error' && (
        <div className="vf-poster-fallback" onClick={retry} role="img" aria-label={title}>
          <div className="vf-poster-fallback-glow" />
          <div className="vf-poster-fallback-emblem">
            <Film size={24} className="vf-poster-fallback-icon" />
            <span className="vf-poster-fallback-initial">{initial}</span>
          </div>
          <span className="vf-poster-fallback-title">{title}</span>
        </div>
      )}
    </div>
  );
}

function arePosterPropsEqual(prevProps, nextProps) {
  if (prevProps.src !== nextProps.src) return false;
  if (prevProps.alt !== nextProps.alt) return false;
  if (prevProps.className !== nextProps.className) return false;
  if (prevProps.imgClassName !== nextProps.imgClassName) return false;
  if (prevProps.ratio !== nextProps.ratio) return false;
  if (prevProps.eager !== nextProps.eager) return false;
  if (prevProps.onClick !== nextProps.onClick) return false;

  const prevId = prevProps.item?.id || prevProps.item?.title;
  const nextId = nextProps.item?.id || nextProps.item?.title;
  if (prevId !== nextId) return false;

  const prevPoster = prevProps.item?.poster || prevProps.item?.posterUrl || prevProps.item?.cover;
  const nextPoster = nextProps.item?.poster || nextProps.item?.posterUrl || nextProps.item?.cover;
  if (prevPoster !== nextPoster) return false;

  return true;
}

export default React.memo(Poster, arePosterPropsEqual);
