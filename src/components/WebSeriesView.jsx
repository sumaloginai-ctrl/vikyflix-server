import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Play,
  Star,
  SearchX,
  ArrowLeft,
  LayoutGrid,
  Grid,
  Layers
} from 'lucide-react';

import { useBackHandler } from '../backNav';
import CatalogFilterHub from './CatalogFilterHub';
import ShelfRow from './ShelfRow';
import Poster from './Poster';
import { getMediaPoster, formatCleanTitle } from '../utils/mediaUtils';
import { getItemRecency, isItemNew } from '../onlineLibrary';

const getMediaYear = (s) => {
  if (!s) return 0;
  const raw = s.metadata?.year || s.year || (s.releaseDate ? String(s.releaseDate).slice(0, 4) : 0);
  const parsed = parseInt(raw, 10);
  return !isNaN(parsed) && parsed > 1900 ? parsed : 0;
};

const SORT_OPTIONS = [
  { id: 'recent', label: 'Latest Releases' },
  { id: 'rating-desc', label: 'Highest Rated' },
  { id: 'title-asc', label: 'Title (A → Z)' },
  { id: 'title-desc', label: 'Title (Z → A)' },
  { id: 'episodes-desc', label: 'Most Episodes' },
  { id: 'year-desc', label: 'Year (Newest First)' },
  { id: 'year-asc', label: 'Year (Oldest First)' }
];

/** Season / episode counts, tolerating both the aggregated and the
 *  nested `seasons[].episodes[]` shapes the catalog can carry. */
function seriesCounts(show) {
  const seasons = Array.isArray(show.seasons) ? show.seasons : [];
  const seasonCount = show.totalSeasons || seasons.length || 0;
  const episodeCount =
    show.totalEpisodes ||
    seasons.reduce((n, s) => n + (Array.isArray(s.episodes) ? s.episodes.length : 0), 0) ||
    0;
  return { seasonCount, episodeCount };
}

const PAGE_SIZE = 36;

/**
 * Series card — reads as a SERIES by layout: a small season/episode badge
 * anchored to the artwork instead of a loud text tag.
 */
const CatalogSeriesCard = React.memo(function CatalogSeriesCard({ show, onOpen, onPlay, onPlayEpisode, className = '' }) {
  const poster = getMediaPoster(show);
  const title = formatCleanTitle(show.title);
  const year = show.metadata?.year || show.year || '';
  const genres = show.metadata?.genres || (show.metadata?.genre ? show.metadata.genre.split(',').map(s => s.trim()) : []);
  const rating = show.metadata?.rating || show.rating;
  const { seasonCount, episodeCount } = seriesCounts(show);

  const epsLabel = episodeCount
    ? (seasonCount > 1 ? `S${seasonCount} · ${episodeCount} Eps` : seasonCount === 1 ? `S1 · ${episodeCount} Eps` : `${episodeCount} Eps`)
    : '';

  const meta = [year, genres[0], epsLabel].filter(Boolean).join(' · ');

  const firstEpisode = show.seasons?.[0]?.episodes?.[0];
  const startWatching = () => {
    if (firstEpisode && onPlayEpisode) onPlayEpisode(firstEpisode, show);
    else if (onPlay) onPlay(show);
    else if (onOpen) onOpen(show);
  };

  return (
    <article
      className={`cat-card cat-card--series ${className}`}
      role="button"
      tabIndex={0}
      aria-label={title}
      onClick={() => onOpen && onOpen(show)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (onOpen) onOpen(show);
        }
      }}
    >
      <div className="cat-card-media">
        <Poster
          item={show}
          src={poster}
          alt={title}
          className="cat-card-poster"
          imgClassName="cat-card-img"
          ratio="2 / 3"
        />

        <div className="cine-card-top-badges">
          <div />
          {rating && parseFloat(rating) > 0 && (
            <div className="cat-card-badge">
              <Star size={11} fill="currentColor" />
              <span>{rating}</span>
            </div>
          )}
        </div>

        <div className="cat-card-overlay">
          <button
            className="cat-card-play"
            onClick={(e) => {
              e.stopPropagation();
              startWatching();
            }}
            title={firstEpisode ? 'Play first episode' : 'Open series'}
            aria-label={firstEpisode ? `Play ${title}` : `Open ${title}`}
          >
            <Play size={20} fill="currentColor" />
          </button>
        </div>
      </div>

      <div className="cat-card-caption">
        <h3 className="cat-card-title" title={title}>{title}</h3>
        <p className="cat-card-meta">{meta || 'Series'}</p>
      </div>
    </article>
  );
});

export default function WebSeriesView({
  seriesList = [],
  genresList = [],
  languagesList = [],
  initialSection = null,
  onOpenSeriesDetails,
  onPlay,
  onPlayEpisode
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGenres, setSelectedGenres] = useState([]);
  const [selectedLanguages, setSelectedLanguages] = useState([]);
  const [selectedSection, setSelectedSection] = useState(initialSection || null);

  // Back gesture inside a section returns to the series catalog, not Home
  const backToCatalog = useCallback(() => {
    setSelectedSection(null);
    return true;
  }, []);
  useBackHandler(Boolean(selectedSection), backToCatalog);
  const [sortBy, setSortBy] = useState('recent');
  const [viewLayout, setViewLayout] = useState(initialSection ? 'grid' : 'sections'); // 'sections' | 'grid'
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const loadMoreRef = useRef(null);

  useEffect(() => {
    if (initialSection) {
      setSelectedSection(initialSection);
      setSelectedGenres([]);
      setSelectedLanguages([]);
      setViewLayout('grid');
    } else {
      setSelectedSection(null);
    }
  }, [initialSection]);

  useEffect(() => {
    setDisplayCount(PAGE_SIZE);
  }, [selectedGenres, selectedLanguages, selectedSection, sortBy, searchQuery]);

  const toggleGenre = useCallback((g) => {
    setSelectedSection(null);
    setSelectedGenres(prev => {
      const next = prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g];
      if (next.length > 0) setViewLayout('grid');
      return next;
    });
  }, []);

  const toggleLanguage = useCallback((l) => {
    setSelectedSection(null);
    setSelectedLanguages(prev => {
      const next = prev.includes(l) ? prev.filter(x => x !== l) : [...prev, l];
      if (next.length > 0) setViewLayout('grid');
      return next;
    });
  }, []);

  const handleSearchChange = useCallback((val) => {
    setSearchQuery(val);
    if (val.trim()) setViewLayout('grid');
  }, []);

  // Filter and sort series
  const filteredSeries = useMemo(() => {
    return seriesList
      .filter((show) => {
        if (selectedSection === 'new-series') {
          if (!isItemNew(show)) return false;
        }

        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const title = (show.title || '').toLowerCase();
          const stars = (show.metadata?.stars || '').toLowerCase();
          const summary = (show.metadata?.summary || '').toLowerCase();
          const year = String(show.metadata?.year || show.year || '');
          if (!title.includes(q) && !stars.includes(q) && !summary.includes(q) && !year.includes(q)) {
            return false;
          }
        }

        if (selectedGenres.length > 0) {
          const showGenres = (show._genres || []).length
            ? show._genres
            : (show.metadata?.genres || (show.metadata?.genre ? show.metadata.genre.split(',').map(s=>s.trim()) : []));
          if (!selectedGenres.some(g => showGenres.includes(g))) return false;
        }

        if (selectedLanguages.length > 0) {
          const showLangs = show._languages || [];
          if (!selectedLanguages.some(l => showLangs.includes(l))) return false;
        }

        return true;
      })
      .sort((a, b) => {
        switch (sortBy) {
          case 'recent': {
            const r = getItemRecency(b) - getItemRecency(a);
            if (r !== 0) return r;
            const ay = getMediaYear(a);
            const by = getMediaYear(b);
            return by - ay;
          }
          case 'rating-desc': {
            const r = (parseFloat(b.metadata?.rating) || 0) - (parseFloat(a.metadata?.rating) || 0);
            return r !== 0 ? r : getItemRecency(b) - getItemRecency(a);
          }
          case 'title-asc':
            return a.title.localeCompare(b.title);
          case 'title-desc':
            return b.title.localeCompare(a.title);
          case 'episodes-desc':
            return (b.totalEpisodes || 0) - (a.totalEpisodes || 0);
          case 'year-desc': {
            const ay = getMediaYear(a);
            const by = getMediaYear(b);
            if (ay !== by) return by - ay;
            return getItemRecency(b) - getItemRecency(a);
          }
          case 'year-asc': {
            const ay = getMediaYear(a);
            const by = getMediaYear(b);
            if (ay !== by) return ay - by;
            return getItemRecency(b) - getItemRecency(a);
          }
          default:
            return 0;
        }
      });
  }, [seriesList, searchQuery, selectedGenres, selectedLanguages, selectedSection, sortBy]);

  // Categorized Shelves for default segmented view (Deduplicated across shelves)
  const categorizedSections = useMemo(() => {
    const list = [];
    const assignedIds = new Set();

    // 1. New Series Releases (strictly series released/added within the last 7 days)
    const newCandidates = seriesList
      .filter(s => (s.poster || s.posterUrl) && isItemNew(s) && parseFloat(s.metadata?.rating || s.rating || 0) > 0)
      .sort((a, b) => {
        const ya = getMediaYear(a), yb = getMediaYear(b);
        if (ya !== yb) return yb - ya;
        const timeA = getItemRecency(a);
        const timeB = getItemRecency(b);
        if (timeA !== timeB) return timeB - timeA;
        const rA = parseFloat(a.metadata?.rating || a.rating || 0);
        const rB = parseFloat(b.metadata?.rating || b.rating || 0);
        return rB - rA;
      });

    if (newCandidates.length > 0) {
      // Dedup all 7-day new series releases so they are exclusive to this dedicated section
      newCandidates.forEach(s => assignedIds.add(s.id));
      list.push({
        id: 'new-series',
        title: 'New Series Releases (Last 7 Days)',
        icon: '✨',
        genreId: null,
        count: newCandidates.length,
        items: newCandidates
      });
    }

    // 2. Shelf per major genre rule — deduplicated!
    for (const genre of genresList) {
      const match = seriesList.filter((s) => {
        if (assignedIds.has(s.id)) return false;
        const showGenres = (s._genres || []).length
          ? s._genres
          : (s.metadata?.genres || (s.metadata?.genre ? s.metadata.genre.split(',').map(x=>x.trim()) : []));
        return showGenres.includes(genre.id);
      });

      if (match.length >= 2) {
        const sortedMatch = [...match].sort((a, b) => {
          const ya = getMediaYear(a), yb = getMediaYear(b);
          if (ya !== yb) return yb - ya;
          const timeA = getItemRecency(a);
          const timeB = getItemRecency(b);
          if (timeA !== timeB) return timeB - timeA;
          const rA = parseFloat(a.metadata?.rating || a.rating || 0);
          const rB = parseFloat(b.metadata?.rating || b.rating || 0);
          return rB - rA;
        });
        const rowItems = sortedMatch.slice(0, 16);
        rowItems.forEach(s => assignedIds.add(s.id));
        list.push({
          id: genre.id,
          title: `${genre.label} Web Series`,
          icon: genre.icon,
          genreId: genre.id,
          count: match.length,
          items: rowItems
        });
      }
    }

    return list;
  }, [seriesList, genresList]);

  const resetAllFilters = useCallback(() => {
    setSearchQuery('');
    setSelectedGenres([]);
    setSelectedLanguages([]);
    setSelectedSection(null);
    setSortBy('recent');
    setViewLayout('sections');
  }, []);

  const handleOpenGenreGrid = useCallback((genreId) => {
    setSelectedSection(null);
    setSelectedGenres([genreId]);
    setViewLayout('grid');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const visibleSeries = useMemo(
    () => filteredSeries.slice(0, displayCount),
    [filteredSeries, displayCount]
  );

  const hasMore = visibleSeries.length < filteredSeries.length;

  useEffect(() => {
    if (!hasMore) return undefined;
    const el = loadMoreRef.current;
    if (!el) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some(en => en.isIntersecting)) {
        setDisplayCount(prev => (prev + PAGE_SIZE));
      }
    }, { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, filteredSeries, displayCount]);

  const activeGenreInfo = useMemo(() => {
    if (selectedGenres.length === 1) {
      return genresList.find(g => g.id === selectedGenres[0]) || { label: selectedGenres[0], icon: '🎬' };
    }
    return null;
  }, [selectedGenres, genresList]);

  const isShowingSections = viewLayout === 'sections' && !searchQuery.trim() && selectedGenres.length === 0 && selectedLanguages.length === 0 && !selectedSection;

  return (
    <div className="cat-catalog">
      {/* Search, Filters & Sort Hub */}
      <CatalogFilterHub
        searchPlaceholder="Search web series…"
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        genresList={genresList}
        selectedGenres={selectedGenres}
        toggleGenre={toggleGenre}
        clearGenres={() => setSelectedGenres([])}
        languagesList={languagesList}
        selectedLanguages={selectedLanguages}
        toggleLanguage={toggleLanguage}
        clearLanguages={() => setSelectedLanguages([])}
        sortOptions={SORT_OPTIONS}
        sortBy={sortBy}
        onSortChange={setSortBy}
        extraControls={
          <div className="cat-seg" role="group" aria-label="Layout">
            <button
              type="button"
              className={`cat-seg-btn ${isShowingSections ? 'is-active' : ''}`}
              onClick={() => {
                setSelectedGenres([]);
                setSelectedLanguages([]);
                setSelectedSection(null);
                setSearchQuery('');
                setViewLayout('sections');
              }}
              title="Categorized Sections"
              aria-pressed={isShowingSections}
            >
              <LayoutGrid size={15} />
              <span>Sections</span>
            </button>
            <button
              type="button"
              className={`cat-seg-btn ${!isShowingSections && !selectedSection ? 'is-active' : ''}`}
              onClick={() => {
                setSelectedSection(null);
                setViewLayout('grid');
              }}
              title="Full 3-Column Grid"
              aria-pressed={!isShowingSections && !selectedSection}
            >
              <Grid size={15} />
              <span>All Grid</span>
            </button>
          </div>
        }
      />

      {/* Active Section Banner (New Series) */}
      {!isShowingSections && selectedSection && (
        <div className="cat-genre-breadcrumb vf-enter">
          <button
            type="button"
            className="cat-back-btn"
            onClick={() => {
              setSelectedSection(null);
              setSelectedGenres([]);
              setSelectedLanguages([]);
              setViewLayout('sections');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          >
            <ArrowLeft size={15} />
            <span>All Categories</span>
          </button>
          <div className="cat-genre-title-wrap">
            <h2 className="cat-genre-heading">
              ✨ New Series Releases (Last 7 Days)
            </h2>
            <span className="cat-genre-sub">{filteredSeries.length} new web series added this week</span>
          </div>
        </div>
      )}

      {/* Active Genre Banner when in dedicated View All mode */}
      {!isShowingSections && !selectedSection && activeGenreInfo && (
        <div className="cat-genre-breadcrumb vf-enter">
          <button
            type="button"
            className="cat-back-btn"
            onClick={() => {
              setSelectedGenres([]);
              setViewLayout('sections');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          >
            <ArrowLeft size={15} />
            <span>All Categories</span>
          </button>
          <div className="cat-genre-title-wrap">
            <h2 className="cat-genre-heading">
              {activeGenreInfo.icon} {activeGenreInfo.label} Web Series
            </h2>
            <span className="cat-genre-sub">{filteredSeries.length} titles in this genre</span>
          </div>
        </div>
      )}

      {/* Result counter when in full grid mode without single genre/section breadcrumb */}
      {!isShowingSections && !selectedSection && !activeGenreInfo && filteredSeries.length > 0 && (
        <p className="cat-results">
          <span>Showing</span>
          <strong>{filteredSeries.length}</strong>
          <span>web series</span>
          <span>·</span>
          <span>Multi-Season HD Streaming</span>
        </p>
      )}

      {/* Empty State */}
      {filteredSeries.length === 0 ? (
        <div className="cat-empty vf-enter">
          <span className="cat-empty-icon">
            <SearchX size={26} />
          </span>
          <h3 className="cat-empty-title">No web series match these filters</h3>
          <p className="cat-empty-text">
            Try a different search term or clear the filters to see every show.
          </p>
          <button className="vf-btn primary cat-empty-action" onClick={resetAllFilters}>
            Reset filters
          </button>
        </div>
      ) : isShowingSections ? (
        /* Categorized Shelves with "View All" on each section */
        <div className="cat-shelves-container vf-enter">
          {categorizedSections.map((sec) => (
            <ShelfRow
              key={sec.id}
              title={sec.title}
              icon={sec.icon}
              count={sec.count ? `${sec.count} series` : undefined}
              onViewAll={() => {
                if (sec.genreId) {
                  setSelectedSection(null);
                  handleOpenGenreGrid(sec.genreId);
                } else if (sec.id === 'new-series') {
                  setSelectedSection('new-series');
                  setSelectedGenres([]);
                  setSelectedLanguages([]);
                  setViewLayout('grid');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                } else {
                  setSelectedSection(null);
                  setViewLayout('grid');
                }
              }}
            >
              {sec.items.map((show) => (
                <CatalogSeriesCard
                  key={show.id}
                  show={show}
                  onOpen={onOpenSeriesDetails}
                  onPlay={onPlay}
                  onPlayEpisode={onPlayEpisode}
                  className="cat-shelf-card"
                />
              ))}
            </ShelfRow>
          ))}
        </div>
      ) : (
        /* Full 3-Column Portrait Grid View */
        <>
          <div className="cat-grid cat-grid--series vf-enter">
            {visibleSeries.map((show) => (
              <CatalogSeriesCard
                key={show.id}
                show={show}
                onOpen={onOpenSeriesDetails}
                onPlay={onPlay}
                onPlayEpisode={onPlayEpisode}
              />
            ))}
          </div>
          {!isShowingSections && hasMore && (
            <div className="cat-tail" ref={loadMoreRef} aria-live="polite">
              <span className="cat-tail-spinner" />
              <span>Loading more series…</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
