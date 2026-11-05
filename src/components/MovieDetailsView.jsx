import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  Play,
  Plus,
  Check,
  Star,
  Clock,
  Globe,
  Languages,
  ShieldCheck,
  Tv,
  ArrowLeft,
  Sparkles,
  Volume2
} from 'lucide-react';

import { getMediaPoster, formatCleanTitle } from '../utils/mediaUtils';
import Poster from './Poster';
import '../styles/details.css';

/**
 * MovieDetailsView — full-page immersive film detail (series already have one;
 * films upgrade from the old bottom-sheet modal to the same immersive stage).
 *
 * Structure mirrors SeriesDetailsView so both detail pages read as one system:
 * sticky top bar → cinematic hero stage → synopsis → honest spec cards →
 * a "More Like This" rail of same-genre films.
 */
export default function MovieDetailsView({
  movie,
  onClose,
  onPlay,
  isWatchlist = false,
  onToggleWatchlist,
  allMovies = [],
  onSelectMovie,
  resumePercent = null
}) {
  const [selectedAudioVersion, setSelectedAudioVersion] = useState(0);

  // Instantly scroll to top when opening or switching movies
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
  }, [movie?.id]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const isOnline = Boolean(
    movie?.source === 'MovieBox' || String(movie?.id || '').startsWith('mb_') || movie?._online
  );
  const posterSrc = getMediaPoster(movie);
  const cleanTitle = formatCleanTitle(movie?.title || '');

  const genres = useMemo(() => {
    const raw = movie?._genres || movie?.genres || movie?.metadata?.genres || [];
    const list = Array.isArray(raw) ? raw : [raw];
    return [...new Set(list.map((g) => String(g || '').trim()).filter(Boolean))].slice(0, 3);
  }, [movie]);

  // Audio versions / editions — the player's Audio menu mirrors this list.
  const audioVersions = useMemo(() => {
    if (Array.isArray(movie?.audioVersions) && movie.audioVersions.length > 0) {
      return movie.audioVersions;
    }
    const fromCatalog = Array.isArray(movie?._languages) ? movie._languages : [];
    if (fromCatalog.length > 0) {
      return fromCatalog.map((lang, idx) => ({ language: lang, subjectId: movie?.id || idx }));
    }
    return [{ language: movie?.corner || 'Original', subjectId: movie?.id || 0 }];
  }, [movie]);

  // More Like This — same-genre films from the merged catalog.
  const recommendations = useMemo(() => {
    if (!allMovies || !allMovies.length || !movie) return [];
    const currentGenre = genres[0] || '';
    const currentId = movie.id;
    return allMovies
      .filter((m) => m.id !== currentId && (
        (m._genres && m._genres.includes(currentGenre)) ||
        (m.metadata?.genres && m.metadata.genres.includes(currentGenre))
      ))
      .slice(0, 10);
  }, [allMovies, genres, movie?.id]);

  if (!movie) return null;

  const rating = movie.metadata?.rating || movie.rating;
  const year = movie.metadata?.year || movie.year || (movie.releaseDate ? movie.releaseDate.slice(0, 4) : '');

  const rawSummary = movie.metadata?.summary || movie.description || '';
  const summary = rawSummary.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim() ||
    'Full quality details and playback options for this title.';

  const is4k = (movie.filename || '').toLowerCase().includes('2160p') || (movie.filename || '').toLowerCase().includes('4k');
  const qualityLabel = is4k ? '4K ULTRA HD' : 'HD 1080p';

  const runtime =
    movie.formattedDuration ||
    (movie.duration > 60
      ? `${Math.floor(movie.duration / 3600) ? `${Math.floor(movie.duration / 3600)}h ` : ''}${Math.round(
          (movie.duration % 3600) / 60
        )}m`
      : '');

  const country = movie.countryName || movie.metadata?.country || 'Cinema';
  const saved = Boolean(isWatchlist);

  const handlePlaySelected = () => {
    // If an alternative audio edition was chosen from MovieBox
    const chosenVersion = audioVersions[selectedAudioVersion];
    if (chosenVersion && chosenVersion.subjectId && chosenVersion.subjectId !== movie.id) {
      onPlay({
        ...movie,
        id: `mb_${chosenVersion.subjectId}`,
        subjectId: chosenVersion.subjectId,
        audioLanguage: chosenVersion.language
      });
    } else {
      onPlay(movie);
    }
    onClose();
  };

  const primaryLabel = resumePercent != null && resumePercent > 0
    ? `Resume · ${resumePercent}% watched`
    : 'Play';

  return (
    <div className="det-page" style={{ position: 'relative', minHeight: '100vh', paddingBottom: '120px' }}>
      {/* ==================== STICKY TOP APP BAR ==================== */}
      <header className="det-sticky-header">
        <button
          type="button"
          className="det-sticky-back"
          onClick={onClose}
          aria-label="Back"
        >
          <ArrowLeft size={16} />
          <span>Back</span>
        </button>
      </header>

      {/* ==================== CINEMATIC HERO STAGE ==================== */}
      <section className="det-hero-cinema-stage">
        <div className="det-hero-backdrop-wrap" aria-hidden="true">
          <Poster
            item={movie}
            src={posterSrc}
            alt=""
            ratio="16 / 9"
            eager
            className="det-hero-backdrop-img"
          />
          <div className="det-hero-vignette-bottom" />
          <div className="det-hero-vignette-sides" />
          <div className="det-hero-color-glow" />
        </div>

        <div className="det-hero-content-cluster det-shell">
          {/* Poster Card */}
          <div className="det-hero-poster-anchor">
            <Poster
              item={movie}
              src={posterSrc}
              alt={cleanTitle}
              ratio="2 / 3"
              eager
              className="det-hero-portrait-poster"
            />
            <div className="det-poster-corner-quality">
              <span>{qualityLabel}</span>
            </div>
          </div>

          {/* Details & Actions */}
          <div className="det-hero-text-block">


            <h1 className="det-title-heading">{cleanTitle}</h1>

            {/* Meta Row */}
            <div className="det-meta-strip">
              {rating && parseFloat(rating) > 0 && (
                <>
                  <span className="det-rating-badge">
                    <Star size={13} fill="currentColor" />
                    <strong>{rating}</strong>
                    <span className="det-imdb-label">IMDb</span>
                  </span>
                  <span className="det-sep">•</span>
                </>
              )}
              {year && <span className="det-meta-year">{year}</span>}
              {genres.length > 0 && (
                <>
                  <span className="det-sep">•</span>
                  <span className="det-meta-genres">{genres.join(' / ')}</span>
                </>
              )}
              {runtime && (
                <>
                  <span className="det-sep">•</span>
                  <span className="det-meta-runtime">
                    <Clock size={12} />
                    <span>{runtime}</span>
                  </span>
                </>
              )}
            </div>

            {/* Actions */}
            <div className="det-cta-actions-row">
              <button
                type="button"
                className="det-play-primary-btn"
                onClick={handlePlaySelected}
                aria-label={`Play ${cleanTitle}`}
              >
                <Play size={20} fill="#ffffff" />
                <span>{primaryLabel}</span>
              </button>

              {onToggleWatchlist && (
                <button
                  type="button"
                  className={`det-watchlist-ghost-btn ${saved ? 'is-saved' : ''}`}
                  onClick={() => onToggleWatchlist(movie)}
                  aria-pressed={saved}
                >
                  {saved ? <Check size={18} /> : <Plus size={18} />}
                  <span>{saved ? 'In My List' : 'Add to List'}</span>
                </button>
              )}
            </div>

            {/* Audio Editions (multi-audio online titles) */}
            {audioVersions.length > 1 && (
              <div className="det-audio-editions-group">
                <span className="det-audio-editions-label">
                  <Volume2 size={13} />
                  <span>AUDIO EDITIONS:</span>
                </span>
                <div className="det-audio-pills-row">
                  {audioVersions.map((ver, idx) => (
                    <button
                      key={ver.subjectId || idx}
                      type="button"
                      className={`det-audio-pill ${selectedAudioVersion === idx ? 'active' : ''}`}
                      onClick={() => setSelectedAudioVersion(idx)}
                    >
                      <span>{ver.language}</span>
                      {selectedAudioVersion === idx && <Check size={12} />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ==================== BODY ==================== */}
      <div className="det-scroll-body det-shell">
        {/* Synopsis */}
        <section className="det-body-segment">
          <h3 className="det-section-eyebrow">STORYLINE &amp; SYNOPSIS</h3>
          <p className="det-synopsis-paragraph">{summary}</p>
        </section>



        {/* ==================== MORE LIKE THIS ==================== */}
        {recommendations.length > 0 && onSelectMovie && (
          <section className="det-body-segment" aria-labelledby="det-rec-movies-title">
            <div className="det-rec-header">
              <h2 id="det-rec-movies-title" className="det-sec-title">
                More Like This
              </h2>
              <span className="det-rec-subtitle">
                {recommendations.length} {genres[0] ? `${genres[0]} titles` : 'titles'} from your library
              </span>
            </div>

            <div className="det-recommendations-rail">
              {recommendations.map((rec) => {
                const recPoster = getMediaPoster(rec);
                const recClean = formatCleanTitle(rec.title);
                const recYear = rec?.metadata?.year || rec?.year || '';
                const recGenres = rec?._genres || rec?.metadata?.genres || [];
                const recGenre = Array.isArray(recGenres) ? recGenres[0] : recGenres;
                const recMeta = [recYear, recGenre].filter(Boolean).join(' • ');

                return (
                  <div
                    key={rec.id || rec.title}
                    className="det-rec-card"
                    onClick={() => {
                      onSelectMovie(rec);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="det-rec-poster-box">
                      <Poster
                        item={rec}
                        src={recPoster}
                        alt={recClean}
                        ratio="2 / 3"
                      />
                      <div className="det-rec-play-pill">
                        <Play size={14} fill="currentColor" style={{ marginLeft: 2 }} />
                      </div>
                    </div>
                    <p className="det-rec-title" title={recClean}>
                      {recClean}
                    </p>
                    <span className="det-rec-meta">{recMeta || 'Feature'}</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
