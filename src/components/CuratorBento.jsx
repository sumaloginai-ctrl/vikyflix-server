import React from 'react';
import { Play, Star, Plus, Check, Info, Sparkles, Compass } from 'lucide-react';
import { formatCleanTitle } from '../utils/mediaUtils';
import Poster from './Poster';

/**
 * CuratorBento — the asymmetric editorial grid: one large 16:9 lead tile
 * with the title and metadata overlaid on the artwork, plus a column of
 * smaller tiles. All artwork comes from the shared <Poster> surface.
 */
function CuratorBento({
  featuredItem,
  secondaryItems = [],
  onPlay,
  onOpenDetails,
  watchlist = [],
  onToggleWatchlist
}) {
  if (!featuredItem && (!secondaryItems || secondaryItems.length === 0)) {
    return null;
  }

  const mainItem = featuredItem || secondaryItems[0];
  const sideItems = (featuredItem ? secondaryItems : secondaryItems.slice(1)).slice(0, 2);

  const mainTitle = formatCleanTitle(mainItem.title);
  const mainRating = mainItem.metadata?.rating || mainItem.rating;
  const mainYear =
    mainItem.metadata?.year ||
    mainItem.year ||
    (mainItem.releaseDate ? String(mainItem.releaseDate).slice(0, 4) : '');
  const mainGenres =
    mainItem._genres ||
    mainItem.metadata?.genres ||
    (typeof mainItem.genre === 'string' ? [mainItem.genre] : []);
  const mainIsBookmarked = watchlist.includes(mainItem.id);
  const mainSynopsis =
    mainItem.metadata?.overview ||
    mainItem.metadata?.summary ||
    mainItem.overview ||
    mainItem.description ||
    '';

  return (
    <section className="home-bento" aria-label="Curators' Choice">
      <header className="home-bento__head">
        <span className="home-bento__eyebrow">
          <Compass size={13} aria-hidden="true" />
          <span>Editorial Selection</span>
        </span>
        <h2 className="home-bento__heading">Curators&apos; Picks</h2>
        <p className="home-bento__subtext">
          A closer look at titles worth your evening.
        </p>
      </header>

      <div className="home-bento__grid">
        {/* Lead — large 16:9 tile with overlaid title and metadata */}
        {mainItem ? (
          <article
            className="home-bento__lead"
            onClick={() => onOpenDetails && onOpenDetails(mainItem)}
          >
            <div className="home-bento__lead-media">
              <Poster
                item={mainItem}
                alt={mainTitle}
                ratio="16 / 9"
                className="home-bento__lead-art"
                imgClassName="home-bento__lead-img"
              />
              <div className="home-bento__lead-scrim" />
            </div>

            <div className="home-bento__lead-body">
              <span className="home-bento__lead-tag">
                <Sparkles size={12} aria-hidden="true" />
                <span>Spotlight</span>
              </span>

              <h3 className="home-bento__lead-title" title={mainTitle}>
                {mainTitle}
              </h3>

              <div className="home-bento__lead-meta">
                {mainRating && parseFloat(mainRating) > 0 ? (
                  <span className="home-bento__lead-meta-star">
                    <Star size={13} fill="currentColor" color="currentColor" aria-hidden="true" />
                    <span>{mainRating}</span>
                  </span>
                ) : null}
                {mainYear ? <span>{mainYear}</span> : null}
                {mainGenres.length ? (
                  <span>{mainGenres.slice(0, 2).join(' / ')}</span>
                ) : null}
              </div>

              {mainSynopsis ? <p className="home-bento__lead-desc">{mainSynopsis}</p> : null}

              <div className="home-bento__lead-actions" onClick={(event) => event.stopPropagation()}>
                <button
                  type="button"
                  className="vf-btn primary"
                  onClick={() => onPlay && onPlay(mainItem)}
                  aria-label={`Play ${mainTitle}`}
                >
                  <Play size={16} fill="currentColor" aria-hidden="true" />
                  <span>Play</span>
                </button>

                <button
                  type="button"
                  className="home-bento__icon-btn"
                  onClick={() => onOpenDetails && onOpenDetails(mainItem)}
                  title="More Details"
                  aria-label="More Details"
                >
                  <Info size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          </article>
        ) : null}

        {/* Column of smaller tiles */}
        <div className="home-bento__column">
          {sideItems.map((item, index) => {
            const sideTitle = formatCleanTitle(item.title);
            const sideRating = item.metadata?.rating || item.rating;
            const sideYear =
              item.metadata?.year ||
              item.year ||
              (item.releaseDate ? String(item.releaseDate).slice(0, 4) : '');
            const sideGenres =
              item._genres ||
              item.metadata?.genres ||
              (typeof item.genre === 'string' ? [item.genre] : []);
            const sideBookmarked = watchlist.includes(item.id);

            return (
              <article
                key={item.id || index}
                className="home-bento__tile"
                onClick={() => onOpenDetails && onOpenDetails(item)}
              >
                <div className="home-bento__tile-media">
                  <Poster
                    item={item}
                    alt={sideTitle}
                    ratio="16 / 9"
                    className="home-bento__tile-art"
                    imgClassName="home-bento__tile-img"
                  />
                  <button
                    type="button"
                    className="home-bento__tile-play"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (onPlay) onPlay(item);
                    }}
                    title={`Play ${sideTitle}`}
                    aria-label={`Play ${sideTitle}`}
                  >
                    <Play size={15} fill="currentColor" aria-hidden="true" />
                  </button>
                </div>

                <div className="home-bento__tile-body">
                  <span className="home-bento__tile-tag">Editor&apos;s Note #{index + 1}</span>
                  <h4 className="home-bento__tile-title" title={sideTitle}>
                    {sideTitle}
                  </h4>
                  <div className="home-bento__tile-meta">
                    {sideRating && parseFloat(sideRating) > 0 ? (
                      <span className="home-bento__tile-meta-star">
                        <Star size={11} fill="currentColor" color="currentColor" aria-hidden="true" />
                        <span>{sideRating}</span>
                      </span>
                    ) : null}
                    {sideYear ? <span>{sideYear}</span> : null}
                    {sideGenres.length ? <span>{sideGenres[0]}</span> : null}
                  </div>
                  <div className="home-bento__tile-actions" onClick={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      className="home-bento__tile-link"
                      onClick={() => onOpenDetails && onOpenDetails(item)}
                      aria-label={`Explore ${sideTitle}`}
                    >
                      <span>Explore</span>
                      <Info size={13} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default React.memo(CuratorBento);
