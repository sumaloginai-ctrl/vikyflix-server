import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Play, Info, Plus, Check, Star } from 'lucide-react';
import { formatCleanTitle, getMediaBackdrop, getMediaPoster } from '../utils/mediaUtils';
import Poster from './Poster';
import '../styles/home.css';

const SLIDE_INTERVAL = 8000;
const MAX_RAIL_STOPS = 8;
const SWIPE_THRESHOLD = 48;

/**
 * Tracks the user's motion preference so the hero never auto-advances and
 * never drifts when the OS asks for reduced motion.
 */
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handle = (event) => setReduced(event.matches);
    if (mq.addEventListener) mq.addEventListener('change', handle);
    else if (mq.addListener) mq.addListener(handle);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handle);
      else if (mq.removeListener) mq.removeListener(handle);
    };
  }, []);

  return reduced;
}

function HeroBillboard({
  movies = [],
  onPlay,
  onOpenDetails,
  watchlist = [],
  onToggleWatchlist
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [interacting, setInteracting] = useState(false);
  const [isMobilePortrait, setIsMobilePortrait] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false
  );
  const touchStartXRef = useRef(0);
  const touchEndXRef = useRef(0);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const handleResize = () => setIsMobilePortrait(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const total = movies.length;
  const index = total > 0 ? Math.min(currentIndex, total - 1) : 0;
  const activeMovie = movies[index];

  // Auto-advance. Paused while the pointer or keyboard focus is inside the
  // stage, and never started when the OS asks for reduced motion.
  useEffect(() => {
    if (total < 2 || interacting || reducedMotion) return undefined;
    const timer = setTimeout(() => {
      setCurrentIndex((index + 1) % total);
    }, SLIDE_INTERVAL);
    return () => clearTimeout(timer);
  }, [total, index, interacting, reducedMotion]);

  const goTo = useCallback(
    (target) => {
      if (!total) return;
      setCurrentIndex(((target % total) + total) % total);
    },
    [total]
  );

  const nextSlide = useCallback(() => goTo(index + 1), [goTo, index]);
  const prevSlide = useCallback(() => goTo(index - 1), [goTo, index]);

  const handleTouchStart = (event) => {
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    touchStartXRef.current = touch.clientX;
    touchEndXRef.current = touch.clientX;
    setInteracting(true);
  };

  const handleTouchMove = (event) => {
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    touchEndXRef.current = touch.clientX;
  };

  const handleTouchEnd = () => {
    const diffX = touchStartXRef.current - touchEndXRef.current;
    if (diffX > SWIPE_THRESHOLD) nextSlide();
    else if (diffX < -SWIPE_THRESHOLD) prevSlide();
    setTimeout(() => setInteracting(false), 2000);
  };

  // A slim rail replaces the old dots. Long feeds are sampled down to a
  // readable number of stops so the rail never turns into a comb.
  const railStops = useMemo(() => {
    if (total <= 1) return [];
    if (total <= MAX_RAIL_STOPS) return Array.from({ length: total }, (_, i) => i);
    const step = (total - 1) / (MAX_RAIL_STOPS - 1);
    return Array.from({ length: MAX_RAIL_STOPS }, (_, i) => Math.round(i * step));
  }, [total]);

  const activeStop = useMemo(() => {
    let found = 0;
    railStops.forEach((stop, i) => {
      if (stop <= index) found = i;
    });
    return found;
  }, [railStops, index]);

  if (!activeMovie) return null;

  const genres = activeMovie._genres || activeMovie.metadata?.genres || (typeof activeMovie.genre === 'string' ? [activeMovie.genre] : []);
  const isBookmarked = watchlist.includes(activeMovie.id);
  const rating = activeMovie.metadata?.rating || activeMovie.rating;
  const year =
    activeMovie.metadata?.year ||
    activeMovie.year ||
    (activeMovie.releaseDate ? String(activeMovie.releaseDate).slice(0, 4) : '');
  // Catalog entries carry formattedDuration now; the fallback handles the
  // legacy mixed units: values above ~500 are seconds (MovieBox convention),
  // smaller ones are already minutes. Misreading seconds as minutes was
  // producing absurd runtimes like "155h 0m".
  const runtime =
    activeMovie.formattedDuration ||
    (typeof activeMovie.duration === 'number' && activeMovie.duration > 0
      ? (activeMovie.duration > 500
          ? `${Math.floor(activeMovie.duration / 3600)}h ${Math.round((activeMovie.duration % 3600) / 60)}m`
          : `${Math.floor(activeMovie.duration / 60)}h ${activeMovie.duration % 60}m`)
      : '') ||
    (typeof activeMovie.duration === 'string' ? activeMovie.duration : '');
  const cleanTitle = formatCleanTitle(activeMovie.title);
  const synopsis =
    activeMovie.metadata?.summary ||
    activeMovie.metadata?.overview ||
    activeMovie.description ||
    activeMovie.overview ||
    '';

  // Responsive hero artwork: on mobile portrait, use the crisp native 2:3 poster
  // so the vertical screen displays razor-sharp artwork without blur or pixelation.
  const heroImageSrc = isMobilePortrait
    ? (getMediaPoster(activeMovie) || getMediaBackdrop(activeMovie))
    : (getMediaBackdrop(activeMovie) || getMediaPoster(activeMovie));

  // One single metadata line: year · genre · runtime.
  const metaLine = [year, genres[0] || '', runtime].filter(Boolean).join(' · ');

  return (
    <section
      className={`home-hero ${reducedMotion ? 'home-hero--static' : ''}`}
      style={{ '--home-slide-interval': `${SLIDE_INTERVAL}ms` }}
      aria-roledescription="carousel"
      aria-label="Featured spotlight"
      onMouseEnter={() => setInteracting(true)}
      onMouseLeave={() => setInteracting(false)}
      onFocusCapture={() => setInteracting(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setInteracting(false);
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Full-bleed ambient backdrop */}
      <div className="home-hero__media" aria-hidden="true">
        <Poster
          item={activeMovie}
          src={heroImageSrc}
          alt=""
          ratio={isMobilePortrait ? "2 / 3" : "16 / 9"}
          className="home-hero__art"
          imgClassName="home-hero__img"
          eager
        />
        <div className="home-hero__scrim home-hero__scrim--bottom" />
        <div className="home-hero__scrim home-hero__scrim--top" />
      </div>

      {/* Copy + Crisp Featured Poster Card */}
      <div className="home-hero__body">
        <div className="home-hero__inner">
          <div className="home-hero__cluster">
            {/* Crisp Featured Poster */}
            {!isMobilePortrait && (
              <div
                className="home-hero__poster-card"
                onClick={() => onOpenDetails && onOpenDetails(activeMovie)}
                role="button"
                tabIndex={0}
                aria-label={`View details for ${cleanTitle}`}
              >
                <Poster
                  item={activeMovie}
                  src={getMediaPoster(activeMovie)}
                  alt={cleanTitle}
                  ratio="2 / 3"
                  eager
                  className="home-hero__poster-thumb"
                />
              </div>
            )}

            <div className="home-hero__content">
              <div className="home-hero__eyebrow">
                <span className="home-hero__eyebrow-tag">Spotlight</span>
                {rating && parseFloat(rating) > 0 ? (
                  <span className="home-hero__rating">
                    <Star size={12} fill="currentColor" color="currentColor" aria-hidden="true" />
                    <span>{rating}</span>
                  </span>
                ) : null}
              </div>

              <h1 className="home-hero__title">{cleanTitle}</h1>

              {metaLine ? <p className="home-hero__meta">{metaLine}</p> : null}

              {!isMobilePortrait && synopsis ? <p className="home-hero__synopsis">{synopsis}</p> : null}

              <div className="home-hero__actions">
                <button
                  type="button"
                  className="vf-btn primary"
                  onClick={() => onPlay && onPlay(activeMovie)}
                  aria-label={`Watch ${cleanTitle}`}
                >
                  <Play size={18} fill="currentColor" aria-hidden="true" />
                  <span>Watch Now</span>
                </button>

                <button
                  type="button"
                  className="vf-btn ghost"
                  onClick={() => onOpenDetails && onOpenDetails(activeMovie)}
                  aria-label={`More details about ${cleanTitle}`}
                >
                  <Info size={17} aria-hidden="true" />
                  <span>Details</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Slim progress rail — shows position, doubles as a jump control */}
      {railStops.length > 1 && (
        <div className="home-hero__rail" role="tablist" aria-label="Spotlight slides">
          {railStops.map((stop, stopIndex) => (
            <button
              key={`${stop}-${stopIndex}`}
              type="button"
              role="tab"
              aria-selected={stopIndex === activeStop}
              aria-label={`Go to slide ${stop + 1} of ${total}`}
              className={`home-hero__rail-item ${stopIndex === activeStop ? 'is-active' : ''}`}
              onClick={() => goTo(stop)}
            >
              <span className="home-hero__rail-bar">
                {stopIndex === activeStop && !reducedMotion ? (
                  <span
                    key={`fill-${index}-${stopIndex}`}
                    className="home-hero__rail-fill"
                    aria-hidden="true"
                  />
                ) : null}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export default React.memo(HeroBillboard);
