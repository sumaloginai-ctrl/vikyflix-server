import React, { useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * ShelfRow — a titled band: a small uppercase eyebrow (icon + title), a
 * "See all" text action and a horizontally scrolling rail whose artwork
 * dissolves into the screen edges behind a CSS mask.
 */
function ShelfRow({
  title,
  icon,
  badge,
  count,
  onViewAll,
  children
}) {
  const rowRef = useRef(null);

  const scrollBy = useCallback((offset) => {
    const track = rowRef.current;
    if (!track) return;
    track.scrollBy({ left: offset, behavior: 'smooth' });
  }, []);

  const scrollStep = () => {
    const track = rowRef.current;
    const width = track ? track.clientWidth : window.innerWidth;
    return Math.max(240, width * 0.7);
  };

  return (
    <section className="home-shelf" aria-label={title || undefined}>
      <header className="home-shelf__head">
        <div className="home-shelf__eyebrow">
          {icon ? (
            <span className="home-shelf__icon" aria-hidden="true">
              {icon}
            </span>
          ) : null}
          <h3 className="home-shelf__title">{title}</h3>
          {badge ? <span className="home-shelf__badge">{badge}</span> : null}
        </div>

        <div className="home-shelf__endcap">
          {count !== undefined && count !== null ? (
            <span className="home-shelf__count">{count}</span>
          ) : null}

          <div className="home-shelf__actions">
            {onViewAll ? (
              <button type="button" className="home-shelf__see-all" onClick={onViewAll}>
                <span>See all</span>
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            ) : null}

            {/* Arrows are a pointer affordance — CSS keeps them hidden on touch. */}
            <div className="home-shelf__arrows">
              <button
                type="button"
                className="home-shelf__arrow"
                onClick={() => scrollBy(-scrollStep())}
                aria-label={`Scroll ${title || 'shelf'} left`}
              >
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="home-shelf__arrow"
                onClick={() => scrollBy(scrollStep())}
                aria-label={`Scroll ${title || 'shelf'} right`}
              >
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <div
        className="home-shelf__track"
        ref={rowRef}
        onFocusCapture={(e) => {
          try {
            if (e.target && typeof e.target.scrollIntoView === 'function') {
              e.target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }
          } catch (err) {}
        }}
      >
        {children}
      </div>
    </section>
  );
}

export default React.memo(ShelfRow);
