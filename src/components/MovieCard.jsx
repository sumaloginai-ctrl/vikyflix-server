import React from 'react';
import { Star, Play } from 'lucide-react';
import { getMediaPoster, formatCleanTitle } from '../utils/mediaUtils';
import Poster from './Poster';

function MovieCard({
  movie,
  onPlay,
  onOpenDetails,
  isWatchlist = false,
  onToggleWatchlist,
  layout = 'portrait' // 'portrait' | 'landscape'
}) {
  const posterSrc = getMediaPoster(movie);
  const genres = movie._genres || movie.metadata?.genres || (typeof movie.genre === 'string' ? [movie.genre] : []);
  const year = movie.metadata?.year || movie.year || (movie.releaseDate ? movie.releaseDate.slice(0, 4) : '');
  const rating = movie.metadata?.rating || movie.rating;

  const isSeries = movie.isSeries || movie.subjectType === 2 || (Array.isArray(movie.seasons) && movie.seasons.length > 0);

  const metaSubtitle = [year, genres[0] || (isSeries ? 'Series' : 'Movie')].filter(Boolean).join(' • ');

  const cleanTitle = formatCleanTitle(movie.title);

  return (
    <div
      className={`cine-card ${layout === 'landscape' ? 'layout-landscape' : 'layout-portrait'}`}
      onClick={() => onOpenDetails && onOpenDetails(movie)}
      tabIndex={0}
      role="button"
      aria-label={`View details for ${cleanTitle}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenDetails && onOpenDetails(movie);
        }
      }}
    >
      <div className="cine-card-media">
        {/* Shared poster surface: reserved box → shimmer → artwork → fallback.
            Artwork stays CLEAN — no type, source or action badges on the art. */}
        <Poster
          item={movie}
          src={posterSrc}
          alt={movie.title}
          className="cine-card-poster"
          imgClassName="cine-card-img"
          ratio={layout === 'landscape' ? '16 / 9' : '2 / 3'}
        />

        {/* Top Badges: only the tiny rating chip belongs on artwork. */}
        <div className="cine-card-top-badges">
          <div />
          {rating && parseFloat(rating) > 0 && (
            <div className="cine-card-rating">
              <Star size={10} fill="#ffc15e" color="#ffc15e" />
              <span>{rating}</span>
            </div>
          )}
        </div>

        {/* Desktop & TV Hover Action Overlay */}
        <div className="cine-card-hover-overlay">
          <button
            className="cine-card-play-btn"
            onClick={(e) => {
              e.stopPropagation();
              onPlay && onPlay(movie);
            }}
            title="Play Now"
            aria-label={`Play ${cleanTitle}`}
          >
            <Play size={20} fill="#ffffff" />
          </button>
        </div>
      </div>

      <div className="cine-card-caption">
        <h4 className="cine-card-title" title={cleanTitle}>{cleanTitle}</h4>
        <div className="cine-card-meta">
          <span className="cine-card-year">{metaSubtitle || 'Feature'}</span>
        </div>
      </div>
    </div>
  );
}

export default React.memo(MovieCard);
