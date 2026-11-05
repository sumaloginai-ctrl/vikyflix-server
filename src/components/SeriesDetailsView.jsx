import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  X,
  Play,
  Star,
  Bookmark,
  Check,
  ChevronDown,
  Layers,
  RotateCcw,
  TriangleAlert,
  Film,
  Tv,
  Volume2,
  Clock,
  ShieldCheck,
  Grid,
  List
} from 'lucide-react';

import { API_BASE } from '../config';
import { getMediaPoster, formatCleanTitle } from '../utils/mediaUtils';
import Poster from './Poster';
import '../styles/details.css';

/** How many skeleton tiles to draw while the online season tree loads. */
const SKELETON_TILES = 12;

/** How many suggestions the "More Web Series" rail shows. */
const MORE_SERIES_LIMIT = 12;

export default function SeriesDetailsView({
  series,
  onBack,
  onPlayEpisode,
  isWatchlist = false,
  onToggleWatchlist,
  allSeries = [],
  onSelectSeries
}) {
  const isOnline = Boolean(
    series?._online ||
      series?.source === 'MovieBox' ||
      String(series?.id || '').startsWith('mb_')
  );
  const subjectId = series?.subjectId;

  // Instantly scroll to top when opening or switching series
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
  }, [series?.id]);

  const [reloadToken, setReloadToken] = useState(0);
  const [onlineState, setOnlineState] = useState({ key: null, seasons: null, error: false });
  const onlineKey = isOnline && subjectId ? `${subjectId}#${reloadToken}` : null;

  useEffect(() => {
    if (!onlineKey || !subjectId) return undefined;
    let dead = false;
    fetch(`${API_BASE}/api/moviebox/episodes/${subjectId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (dead) return;
        const seasons = (d.seasons || [])
          .map((s) => ({
            seasonNumber: s.se,
            episodes: Array.from({ length: s.maxEp || 0 }, (_, i) => ({
              id: `${subjectId}-${s.se}-${i + 1}`,
              episodeNumber: i + 1,
              seasonNumber: s.se,
              title: `Episode ${i + 1}`,
              filename: 'Episode',
              localThumbUrl: ''
            }))
          }))
          .filter((s) => s.episodes.length);
        setOnlineState({ key: onlineKey, seasons, error: false });
      })
      .catch(() => {
        if (dead) return;
        setOnlineState({ key: onlineKey, seasons: [], error: true });
      });
    return () => {
      dead = true;
    };
  }, [onlineKey, subjectId]);

  const onlineSeasons = onlineState.key === onlineKey ? onlineState.seasons : null;
  const onlineError = onlineState.key === onlineKey ? onlineState.error : false;

  /* ========================================================================
     Season / episode state
     ======================================================================== */
  const [selectedSeasonNum, setSelectedSeasonNum] = useState(
    series?.seasons?.[0]?.seasonNumber || 1
  );
  const [seasonMenuOpen, setSeasonMenuOpen] = useState(false);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState(null);
  const [epViewMode, setEpViewMode] = useState('cards'); // 'cards' | 'grid'
  const [selectedAudioVersion, setSelectedAudioVersion] = useState(0);

  const seasons = useMemo(() => {
    const list = isOnline ? onlineSeasons : series?.seasons;
    return Array.isArray(list) ? list : [];
  }, [isOnline, onlineSeasons, series]);

  const activeSeason =
    seasons.find((s) => s.seasonNumber === selectedSeasonNum) || seasons[0] || null;
  const episodes = activeSeason?.episodes || [];

  // Audio versions / editions
  const audioVersions = useMemo(() => {
    if (Array.isArray(series?.audioVersions) && series.audioVersions.length > 0) {
      return series.audioVersions;
    }
    const fromCatalog = Array.isArray(series?._languages) ? series._languages : [];
    if (fromCatalog.length > 0) {
      return fromCatalog.map((lang, idx) => ({ language: lang, subjectId: series?.id || idx }));
    }
    const corner = series?.corner || '';
    if (corner) {
      return [{ language: corner, subjectId: series?.id || 0 }];
    }
    return [{ language: 'Original Audio', subjectId: series?.id || 0 }];
  }, [series]);

  // Presentation data
  const posterSrc = getMediaPoster(series);
  const cleanTitle = formatCleanTitle(series?.title || '');
  const year = series?.metadata?.year || series?.year || '2025';
  const rating = series?.metadata?.rating || series?.rating || '';

  const genres = useMemo(() => {
    const raw =
      series?.metadata?.genres ||
      series?.genres ||
      series?._genres ||
      (series?.metadata?.genre ? String(series.metadata.genre).split(',') : []);
    const list = Array.isArray(raw) ? raw : [raw];
    return [
      ...new Set(
        list
          .map((g) => String(g || '').trim())
          .filter(Boolean)
      )
    ].slice(0, 3);
  }, [series]);

  const rawSummary = series?.metadata?.summary || series?.description || '';
  const synopsis = String(rawSummary)
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim() || `Experience ${cleanTitle} in pristine cinematic high definition with multi-channel immersive surround sound directly on MovieFlix.`;

  const stars = series?.metadata?.stars || null;
  const audioLabel = series?.corner || (series?._languages?.[0] || 'Multi-Audio');
  const seasonCount = seasons.length || series?.totalSeasons || 1;
  const totalEpisodes =
    seasons.reduce((n, s) => n + (s.episodes?.length || 0), 0) ||
    series?.totalEpisodes ||
    episodes.length ||
    0;

  const isEpisodesLoading = isOnline && onlineSeasons === null;
  const firstEpisode = episodes[0] || null;

  // More like this rail
  const otherSeries = useMemo(() => {
    const pool = Array.isArray(allSeries) ? allSeries : [];
    if (!pool.length) return [];
    const currentId = series?.id || '';
    const currentSubject = series?.subjectId || '';
    const currentTitle = formatCleanTitle(series?.title || '');

    const seen = new Set();
    const withArt = [];
    for (const show of pool) {
      if (!show || !show.title) continue;
      const key = show.id || show.subjectId || show.title;
      if (seen.has(key)) continue;
      seen.add(key);
      if (show.id && currentId && show.id === currentId) continue;
      if (show.subjectId && currentSubject && String(show.subjectId) === String(currentSubject)) continue;
      if (currentTitle && formatCleanTitle(show.title) === currentTitle) continue;
      withArt.push(show);
    }
    return withArt.slice(0, MORE_SERIES_LIMIT);
  }, [allSeries, series]);

  const handlePlaySelectedEpisode = (targetEp) => {
    const epToPlay = targetEp || firstEpisode || {
      id: `${series?.subjectId || series?.id}-1-1`,
      seasonNumber: 1,
      episodeNumber: 1,
      title: 'Full Video / Feature',
      filename: series?.title || 'Feature'
    };
    if (!onPlayEpisode) return;

    const chosenVersion = audioVersions[selectedAudioVersion];
    const seriesPayload = {
      ...series,
      detailPath: chosenVersion?.detailPath || series.detailPath,
      ...(chosenVersion?.subjectId && chosenVersion.subjectId !== series.id
        ? {
            id: `mb_${chosenVersion.subjectId}`,
            subjectId: chosenVersion.subjectId,
            detailPath: chosenVersion.detailPath || series.detailPath
          }
        : {})
    };
    onPlayEpisode(epToPlay, seriesPayload);
  };

  return (
    <div className="det-page" style={{ position: 'relative', minHeight: '100vh', paddingBottom: '120px' }}>
      {/* ==================== STICKY TOP APP BAR ==================== */}
      <header className="det-sticky-header">
        <button
          type="button"
          className="det-sticky-back"
          onClick={onBack}
          aria-label="Back"
        >
          <ArrowLeft size={16} />
          <span>Back</span>
        </button>
      </header>

      {/* ==================== CINEMATIC HERO STAGE ==================== */}
      <section className="det-hero-cinema-stage">
        {/* Backdrop Artwork with Deep Scrim */}
        <div className="det-hero-backdrop-wrap" aria-hidden="true">
          <Poster
            item={series}
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

        {/* Hero Foreground Content */}
        <div className="det-hero-content-cluster det-shell">
          {/* Floating 3D Portrait Poster */}
          <div className="det-hero-poster-anchor">
            <Poster
              item={series}
              src={posterSrc}
              alt={cleanTitle}
              ratio="2 / 3"
              eager
              className="det-hero-portrait-poster"
            />
            <div className="det-poster-corner-quality">
              <span>1080p HD</span>
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
              <span className="det-meta-year">{year}</span>

              {genres.length > 0 && (
                <>
                  <span className="det-sep">•</span>
                  <span className="det-meta-genres">{genres.join(' / ')}</span>
                </>
              )}

              <span className="det-sep">•</span>
              <span className="det-meta-runtime">
                <Clock size={12} />
                <span>{seasonCount} {seasonCount === 1 ? 'Season' : 'Seasons'}{totalEpisodes > 0 ? ` · ${totalEpisodes} Eps` : ''}</span>
              </span>
            </div>

            {/* Audio Editions Strip */}
            {audioVersions.length > 0 && (
              <div className="det-audio-editions-group">
                <span className="det-audio-editions-label">
                  <Volume2 size={13} />
                  <span>AUDIO EDITIONS:</span>
                </span>
                <div className="det-audio-pills-row">
                  {audioVersions.map((v, idx) => (
                    <button
                      key={`audio-${idx}`}
                      type="button"
                      className={`det-audio-pill ${selectedAudioVersion === idx ? 'active' : ''}`}
                      onClick={() => setSelectedAudioVersion(idx)}
                    >
                      {v.language || `Edition ${idx + 1}`}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Primary Action Buttons */}
            <div className="det-cta-actions-row">
              <button
                type="button"
                className="det-play-primary-btn"
                onClick={() => handlePlaySelectedEpisode(firstEpisode)}
                aria-label={
                  firstEpisode
                    ? `Play Season ${activeSeason?.seasonNumber || 1}, Episode ${firstEpisode.episodeNumber}`
                    : 'Play Full Video'
                }
              >
                <Play size={18} fill="currentColor" />
                <span>
                  {firstEpisode 
                    ? `Play S${activeSeason?.seasonNumber || 1}:E${firstEpisode.episodeNumber}`
                    : 'Play Movie / Video'}
                </span>
              </button>

              <button
                type="button"
                className={`det-watchlist-ghost-btn ${isWatchlist ? 'is-saved' : ''}`}
                onClick={() => onToggleWatchlist && onToggleWatchlist(series)}
                aria-pressed={Boolean(isWatchlist)}
              >
                {isWatchlist ? <Check size={16} /> : <Bookmark size={16} />}
                <span>{isWatchlist ? 'In My List' : 'Add to List'}</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ==================== SPECS & SYNOPSIS BODY ==================== */}
      <div className="det-shell det-scroll-body">
        {/* Story & Synopsis */}
        <section className="det-body-segment">
          <h2 className="det-section-eyebrow">STORYLINE</h2>
          <p className="det-synopsis-paragraph">{synopsis}</p>

          {stars && (
            <p className="det-body-text" style={{ marginTop: 12, fontSize: '0.86rem' }}>
              <strong style={{ color: '#ffffff' }}>Starring: </strong>
              <span style={{ color: '#94a3b8' }}>{stars}</span>
            </p>
          )}
        </section>



        {/* ==================== EPISODES EXPLORER ==================== */}
        <section className="det-body-segment" aria-labelledby="det-eps-title">
          <div className="det-sec-head">
            <div>
              <h2 id="det-eps-title" className="det-sec-title">
                Episodes
              </h2>
              <p className="det-sec-sub">
                {isEpisodesLoading
                  ? 'Fetching episode directory…'
                  : `Season ${activeSeason?.seasonNumber ?? 1} · ${episodes.length} Episodes available`}
              </p>
            </div>

            {/* View Mode & Season Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {/* Card / Grid Toggle */}
              <div className="det-mode-toggle-group" role="group" aria-label="Episode view mode">
                <button
                  type="button"
                  className={`det-mode-toggle-btn ${epViewMode === 'cards' ? 'active' : ''}`}
                  onClick={() => setEpViewMode('cards')}
                  title="Detailed Episode Cards"
                >
                  <List size={13} />
                  <span>Cards</span>
                </button>
                <button
                  type="button"
                  className={`det-mode-toggle-btn ${epViewMode === 'grid' ? 'active' : ''}`}
                  onClick={() => setEpViewMode('grid')}
                  title="Compact Episode Grid"
                >
                  <Grid size={13} />
                  <span>Grid</span>
                </button>
              </div>

              {/* Season Selector Dropdown */}
              {seasons.length > 1 && (
                <div className="det-season">
                  {seasonMenuOpen && (
                    <div className="det-season-backdrop" onClick={() => setSeasonMenuOpen(false)} />
                  )}
                  <button
                    type="button"
                    className="det-season-btn"
                    onClick={() => setSeasonMenuOpen((o) => !o)}
                    aria-haspopup="listbox"
                    aria-expanded={seasonMenuOpen}
                  >
                    <Layers size={14} />
                    <span>Season {activeSeason?.seasonNumber ?? 1}</span>
                    <span className="det-season-count">{episodes.length} Eps</span>
                    <ChevronDown
                      size={14}
                      className={`det-season-caret ${seasonMenuOpen ? 'is-open' : ''}`}
                    />
                  </button>

                  {seasonMenuOpen && (
                    <div className="det-season-menu" role="listbox" aria-label="Select season">
                      {seasons.map((season) => (
                        <button
                          key={season.seasonNumber}
                          type="button"
                          role="option"
                          aria-selected={activeSeason?.seasonNumber === season.seasonNumber}
                          className="det-season-item"
                          onClick={() => {
                            setSelectedSeasonNum(season.seasonNumber);
                            setSelectedEpisodeId(null);
                            setSeasonMenuOpen(false);
                          }}
                        >
                          <span>Season {season.seasonNumber}</span>
                          <span className="det-season-count">
                            {season.episodes.length} Episodes
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Season Quick Tabs (for 2-6 seasons) */}
          {seasons.length > 1 && seasons.length <= 6 && (
            <div className="det-seasons-bar" style={{ marginBottom: 12 }}>
              {seasons.map((season) => (
                <button
                  key={`tab-${season.seasonNumber}`}
                  type="button"
                  className={`det-season-tab-pill ${activeSeason?.seasonNumber === season.seasonNumber ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedSeasonNum(season.seasonNumber);
                    setSelectedEpisodeId(null);
                  }}
                >
                  Season {season.seasonNumber} ({season.episodes.length})
                </button>
              ))}
            </div>
          )}

          {/* Loading Skeletons */}
          {isEpisodesLoading && (
            <div className={epViewMode === 'cards' ? 'det-ep-cards-grid' : 'det-eps-grid'}>
              {Array.from({ length: SKELETON_TILES }, (_, i) => (
                <div key={`skel-${i}`} className="det-ep-skel vf-skeleton" style={{ height: epViewMode === 'cards' ? 76 : 46 }} />
              ))}
            </div>
          )}

          {/* Rich Episode Cards View */}
          {!isEpisodesLoading && epViewMode === 'cards' && episodes.length > 0 && (
            <div className="det-ep-cards-grid">
              {episodes.map((ep) => {
                const isSelected = selectedEpisodeId === ep.id;
                return (
                  <button
                    key={ep.id}
                    type="button"
                    className={`det-rich-ep-card ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => {
                      setSelectedEpisodeId(ep.id);
                      handlePlaySelectedEpisode(ep);
                    }}
                    aria-label={`Play Season ${ep.seasonNumber || 1}, Episode ${ep.episodeNumber}`}
                  >
                    <div className="det-rich-ep-thumb">
                      <span className="det-rich-ep-num-label">EP</span>
                      <span className="det-rich-ep-num-val">{ep.episodeNumber}</span>
                      <div className="det-rich-ep-play-overlay">
                        <Play size={18} fill="currentColor" />
                      </div>
                    </div>

                    <div className="det-rich-ep-details">
                      <h3 className="det-rich-ep-title">{ep.title || `Episode ${ep.episodeNumber}`}</h3>
                      <p className="det-rich-ep-meta">
                        {ep.duration && ep.duration > 0 ? `${Math.round(ep.duration / 60)} min` : `Episode ${ep.episodeNumber || 1}`}
                      </p>
                    </div>

                    <div className="det-rich-ep-action-btn">
                      <Play size={14} fill="currentColor" style={{ marginLeft: 2 }} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Compact Grid View */}
          {!isEpisodesLoading && epViewMode === 'grid' && episodes.length > 0 && (
            <div className="det-eps-grid">
              {episodes.map((ep) => (
                <button
                  key={ep.id}
                  type="button"
                  className="det-ep"
                  onClick={() => {
                    setSelectedEpisodeId(ep.id);
                    handlePlaySelectedEpisode(ep);
                  }}
                  title={`Play ${ep.title}`}
                  aria-label={`Play episode ${ep.episodeNumber}`}
                  aria-pressed={selectedEpisodeId === ep.id}
                >
                  <span>{ep.episodeNumber}</span>
                </button>
              ))}
            </div>
          )}

          {/* Error retry */}
          {!isEpisodesLoading && onlineError && (
            <div className="det-state">
              <TriangleAlert size={24} className="det-state-icon" />
              <p>Unable to load episodes from the streaming provider.</p>
              <button
                type="button"
                className="vf-btn quiet"
                onClick={() => setReloadToken((t) => t + 1)}
              >
                <RotateCcw size={15} />
                <span>Retry Loading</span>
              </button>
            </div>
          )}

          {/* Empty state */}
          {!isEpisodesLoading && !onlineError && episodes.length === 0 && (
            <div className="det-state">
              <Film size={24} className="det-state-icon" />
              <p>No episodes available for this season yet.</p>
            </div>
          )}
        </section>

        {/* ==================== MORE WEB SERIES ==================== */}
        {otherSeries.length > 0 && onSelectSeries && (
          <section className="det-body-segment" aria-labelledby="det-rec-series-title">
            <div className="det-rec-header">
              <h2 id="det-rec-series-title" className="det-sec-title">
                More Web Series
              </h2>
              <span className="det-rec-subtitle">
                {otherSeries.length} recommendations from your library
              </span>
            </div>

            <div className="det-recommendations-rail">
              {otherSeries.map((show) => {
                const showPoster = getMediaPoster(show);
                const showYear = show?.metadata?.year || show?.year || '';
                const showGenres = show?.metadata?.genres || show?.genres || [];
                const showGenre = Array.isArray(showGenres) ? showGenres[0] : showGenres;
                const showMeta = [showYear, showGenre].filter(Boolean).join(' • ');

                return (
                  <div
                    key={show.id || show.subjectId || show.title}
                    className="det-rec-card"
                    onClick={() => {
                      onSelectSeries(show);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="det-rec-poster-box">
                      <Poster
                        item={show}
                        src={showPoster}
                        alt={formatCleanTitle(show.title)}
                        ratio="2 / 3"
                      />
                      <div className="det-rec-play-pill">
                        <Play size={14} fill="currentColor" style={{ marginLeft: 2 }} />
                      </div>
                    </div>
                    <p className="det-rec-title" title={show.title}>
                      {formatCleanTitle(show.title)}
                    </p>
                    <span className="det-rec-meta">{showMeta}</span>
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
