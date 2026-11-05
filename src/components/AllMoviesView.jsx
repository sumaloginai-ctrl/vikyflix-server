import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useBackHandler } from '../backNav';
import CatalogFilterHub from './CatalogFilterHub';
import ShelfRow from './ShelfRow';
import Poster from './Poster';
import {
  Grid,
  List,
  Play,
  Star,
  SearchX,
  ArrowLeft,
  LayoutGrid
} from 'lucide-react';

import { getMediaPoster, formatCleanTitle } from '../utils/mediaUtils';
import { getItemRecency, isItemNew } from '../onlineLibrary';
import '../styles/catalog.css';

const getMediaYear = (m) => {
  if (!m) return 0;
  const raw = m.metadata?.year || m.year || (m.releaseDate ? String(m.releaseDate).slice(0, 4) : 0);
  const parsed = parseInt(raw, 10);
  return !isNaN(parsed) && parsed > 1900 ? parsed : 0;
};

const SORT_OPTIONS = [
  { id: 'recent', label: 'Latest Releases' },
  { id: 'rating-desc', label: 'Highest Rated' },
  { id: 'title-asc', label: 'Title (A → Z)' },
  { id: 'title-desc', label: 'Title (Z → A)' },
  { id: 'year-desc', label: 'Year (Newest First)' },
  { id: 'year-asc', label: 'Year (Oldest First)' },
  { id: 'duration-desc', label: 'Runtime (Longest)' },
  { id: 'duration-asc', label: 'Runtime (Shortest)' }
];

const PAGE_SIZE = 36;

/**
 * Catalog poster card — one line of title, one line of meta, hover lift and
 * a 3% artwork zoom. Artwork is clean: only a small rating is allowed on it.
 */
const CatalogMovieCard = React.memo(function CatalogMovieCard({ movie, rank, onOpen, onPlay, className = '' }) {
  const poster = getMediaPoster(movie);
  const title = formatCleanTitle(movie.title);
  const year = movie.metadata?.year || movie.year || '';
  const genre = (movie._genres || movie.metadata?.genres || [])[0] || '';
  const rating = movie.metadata?.rating || movie.rating;

  const meta = [year, genre].filter(Boolean).join(' · ') || 'Feature';

  return (
    <article
      className={`cat-card ${className}`}
      role="button"
      tabIndex={0}
      aria-label={title}
      onClick={() => onOpen && onOpen(movie)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (onOpen) onOpen(movie);
        }
      }}
    >
      <div className="cat-card-media">
        <Poster
          item={movie}
          src={poster}
          alt={title}
          className="cat-card-poster"
          imgClassName="cat-card-img"
          ratio="2 / 3"
        />

        <div className="cine-card-top-badges">
          {rank ? (
            <div className="cat-card-rank-badge">
              #{rank}
            </div>
          ) : <div />}
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
              if (onPlay) onPlay(movie);
            }}
            title="Play now"
            aria-label={`Play ${title}`}
          >
            <Play size={20} fill="currentColor" />
          </button>
        </div>
      </div>

      <div className="cat-card-caption">
        <h3 className="cat-card-title" title={title}>{title}</h3>
        <p className="cat-card-meta">{meta}</p>
      </div>
    </article>
  );
});

/**
 * Detailed list row for the alternate 'list' view mode.
 */
const CatalogMovieRow = React.memo(function CatalogMovieRow({ movie, isSaved, onOpen, onPlay, onToggleWatchlist }) {
  const poster = getMediaPoster(movie);
  const title = formatCleanTitle(movie.title);
  const year = movie.metadata?.year || movie.year || '';
  const genres = movie._genres || movie.metadata?.genres || [];
  const rating = movie.metadata?.rating || movie.rating;
  const duration = movie.duration ? `${Math.floor(movie.duration / 60)} min` : '';

  return (
    <div
      className="cat-row"
      role="button"
      tabIndex={0}
      onClick={() => onOpen && onOpen(movie)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (onOpen) onOpen(movie);
        }
      }}
    >
      <Poster
        item={movie}
        src={poster}
        alt={title}
        className="cat-row-poster"
        imgClassName="cat-row-img"
        ratio="2 / 3"
      />
      <div className="cat-row-info">
        <h4 className="cat-row-title">{title}</h4>
        <div className="cat-row-chips">
          {rating && parseFloat(rating) > 0 && (
            <span className="cat-row-chip rating">
              <Star size={11} fill="currentColor" />
              <span>{rating}</span>
            </span>
          )}
          {year && <span className="cat-row-chip">{year}</span>}
          {duration && <span className="cat-row-chip">{duration}</span>}
          {genres.slice(0, 2).map((g) => (
            <span key={g} className="cat-row-chip">{g}</span>
          ))}
        </div>
      </div>
      <div className="cat-row-actions">
        <button
          className="cat-row-btn play"
          onClick={(e) => {
            e.stopPropagation();
            if (onPlay) onPlay(movie);
          }}
          title="Play now"
          aria-label={`Play ${title}`}
        >
          <Play size={15} fill="currentColor" />
          <span>Play</span>
        </button>
      </div>
    </div>
  );
});

export default function AllMoviesView({
  movies = [],
  genresList = [],
  languagesList = [],
  initialGenre = null,
  initialLanguage = null,
  initialSection = null,
  onPlay,
  onOpenDetails,
  watchlist = [],
  onToggleWatchlist
}) {
  const [selectedGenres, setSelectedGenres] = useState(initialGenre ? [initialGenre] : []);
  const [selectedLanguages, setSelectedLanguages] = useState(initialLanguage ? [initialLanguage] : []);
  const [selectedSection, setSelectedSection] = useState(initialSection || null);

  // Back gesture inside a section returns to the catalog view, not Home
  const backToCatalog = useCallback(() => {
    setSelectedSection(null);
    return true;
  }, []);
  useBackHandler(Boolean(selectedSection), backToCatalog);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('recent');
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'list'
  const [viewLayout, setViewLayout] = useState(
    initialGenre || initialLanguage || initialSection ? 'grid' : 'sections'
  );

  // Progressive pagination — auto-loaded as the user scrolls (no button).
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const loadMoreRef = useRef(null);

  // Strictly Top 10 blockbusters based on rating
  // Rolling Top 10: recent releases compete first, all-time greats fill.
  const top10List = useMemo(() => {
    const withPoster = movies.filter(m => Boolean(m.poster || m.posterUrl || m.image || m.metadata?.poster || (m._online && (m.id || m.subjectId))));
    const now = Date.now();
    const RECENT_WINDOW = 45 * 86400000;
    const tsOf = (m) => {
      if (typeof m.discoveredAt === 'number' && m.discoveredAt > 0) return m.discoveredAt;
      const t = getItemRecency(m);
      return t > 0 ? t : 0;
    };
    const rank = (pool) => [...pool]
      .sort((a, b) => {
        const rA = parseFloat(a.metadata?.rating || a.rating) || 0;
        const rB = parseFloat(b.metadata?.rating || b.rating) || 0;
        if (rB !== rA) return rB - rA;
        return tsOf(b) - tsOf(a);
      })
      .slice(0, 10);
    const fresh = withPoster.filter(m => now - tsOf(m) <= RECENT_WINDOW && tsOf(m) > 0);
    const list = rank(fresh);
    if (list.length < 10) {
      const seen = new Set(list.map(m => m.id));
      for (const m of rank(withPoster)) {
        if (list.length >= 10) break;
        if (!seen.has(m.id)) { list.push(m); seen.add(m.id); }
      }
    }
    return list;
  }, [movies]);

  const top10IdSet = useMemo(() => new Set(top10List.map(m => m.id)), [top10List]);

  // Sync if initial props change
  useEffect(() => {
    if (initialGenre) {
      setSelectedGenres([initialGenre]);
      setSelectedSection(null);
      setViewLayout('grid');
    }
  }, [initialGenre]);

  useEffect(() => {
    if (initialLanguage) {
      setSelectedLanguages([initialLanguage]);
      setSelectedSection(null);
      setViewLayout('grid');
    }
  }, [initialLanguage]);

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

  // Reset page size when filters change
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

  // Filter & Sort Pipeline
  // Comparable runtime in MINUTES: MovieBox carries seconds, local library
  // files carry minutes — mixing them made every MovieBox title outrank the
  // entire local library in the runtime sorts.
  const normDuration = (m) => Math.round(
    (m._online || m.source === 'MovieBox') ? ((m.duration || 0) / 60) : (m.duration || 0)
  );

  const filteredMovies = useMemo(() => {
    // If user selected top-10 section, preserve top 10 order unless search is active
    if (selectedSection === 'top-10' && !searchQuery.trim()) {
      return top10List;
    }

    const q = searchQuery.toLowerCase().trim();
    return movies
      .filter((movie) => {
        if (selectedSection === 'new-releases') {
          if (!isItemNew(movie)) return false;
        } else if (selectedSection === 'top-10') {
          if (!top10IdSet.has(movie.id)) return false;
        }

        if (q) {
          const title = String(movie.title || '').toLowerCase();
          const year = String(movie.metadata?.year || movie.year || '');
          const genres = (movie._genres || []).join(' ').toLowerCase();
          if (!title.includes(q) && !genres.includes(q) && !year.includes(q)) return false;
        }

        if (selectedGenres.length > 0 && !selectedGenres.some(g => (movie._genres || []).includes(g))) {
          return false;
        }

        if (selectedLanguages.length > 0 && !selectedLanguages.some(l => (movie._languages || []).includes(l))) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        switch (sortBy) {
          case 'recent': {
            // "Latest Releases" should rank by when a title actually entered
            // the catalog, not by its printed year.
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
            return getItemRecency(a) - getItemRecency(b);
          }
          case 'duration-desc': {
            const r = normDuration(b) - normDuration(a);
            return r !== 0 ? r : getItemRecency(b) - getItemRecency(a);
          }
          case 'duration-asc': {
            const r = normDuration(a) - normDuration(b);
            return r !== 0 ? r : getItemRecency(b) - getItemRecency(a);
          }
          default:
            return 0;
        }
      });
  }, [movies, searchQuery, selectedGenres, selectedLanguages, selectedSection, top10List, top10IdSet, sortBy]);

  // Categorized Sections for default segmented view (Deduplicated across shelves)
  const categorizedSections = useMemo(() => {
    const list = [];
    const assignedIds = new Set();
    const currentYear = new Date().getFullYear();
    const yearOf = (m) => parseInt(m.metadata?.year || m.year) || 0;

    // 1. New Releases (strictly titles released/added within the last 7 days)
    const discoveryTs = (m) => (typeof m.discoveredAt === 'number' && m.discoveredAt > 0)
      ? m.discoveredAt
      : getItemRecency(m);
    const freshCandidates = movies
      .filter(m => (m.poster || m.posterUrl) && isItemNew(m) && parseFloat(m.metadata?.rating || m.rating || 0) > 0)
      .sort((a, b) => discoveryTs(b) - discoveryTs(a));

    if (freshCandidates.length > 0) {
      // Dedup all 7-day new releases so they are exclusive to this dedicated section
      freshCandidates.forEach(m => assignedIds.add(m.id));
      list.push({
        id: 'new-releases',
        title: 'New Releases (Last 7 Days)',
        icon: '✨',
        genreId: null,
        count: freshCandidates.length,
        items: freshCandidates
      });
    }

    // 2. Shelf per major genre rule — deduplicated!
    // Each movie belongs to its primary matching shelf so no title is repeated across multiple rows.
    for (const genre of genresList) {
      const match = movies.filter(m => {
        if (assignedIds.has(m.id)) return false;
        return (m._genres || []).includes(genre.id);
      });

      if (match.length >= 2) {
        const sortedMatch = [...match].sort((a, b) => {
          const ya = getMediaYear(a), yb = getMediaYear(b);
          if (ya !== yb) return yb - ya;
          return getItemRecency(b) - getItemRecency(a);
        });
        const rowItems = sortedMatch.slice(0, 16);
        rowItems.forEach(m => assignedIds.add(m.id));
        list.push({
          id: genre.id,
          title: `${genre.label} Movies`,
          icon: genre.icon,
          genreId: genre.id,
          count: match.length,
          items: rowItems
        });
      }
    }

    return list;
  }, [movies, genresList]);

  const visibleMovies = useMemo(
    () => filteredMovies.slice(0, displayCount),
    [filteredMovies, displayCount]
  );

  const hasMore = visibleMovies.length < filteredMovies.length;

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
  }, [hasMore, filteredMovies, displayCount]);

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
        searchPlaceholder="Search movies…"
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
              className={`cat-seg-btn ${!isShowingSections && !selectedSection && viewMode === 'grid' ? 'is-active' : ''}`}
              onClick={() => {
                setSelectedSection(null);
                setViewLayout('grid');
                setViewMode('grid');
              }}
              title="Full 3-Column Grid"
              aria-pressed={!isShowingSections && !selectedSection && viewMode === 'grid'}
            >
              <Grid size={15} />
              <span>All Grid</span>
            </button>
            <button
              type="button"
              className={`cat-seg-btn ${!isShowingSections && !selectedSection && viewMode === 'list' ? 'is-active' : ''}`}
              onClick={() => {
                setSelectedSection(null);
                setViewLayout('grid');
                setViewMode('list');
              }}
              title="List View"
              aria-pressed={!isShowingSections && !selectedSection && viewMode === 'list'}
            >
              <List size={15} />
              <span>List</span>
            </button>
          </div>
        }
      />

      {/* Active Section Banner (New Releases / Top 10) */}
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
              {selectedSection === 'new-releases' ? '✨ New Releases (Last 7 Days)' : '🏆 Top 10 on MovieFlix'}
            </h2>
            <span className="cat-genre-sub">
              {filteredMovies.length} {selectedSection === 'new-releases' ? 'new movies added this week' : 'top-rated blockbusters'}
            </span>
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
              {activeGenreInfo.icon} {activeGenreInfo.label} Movies
            </h2>
            <span className="cat-genre-sub">{filteredMovies.length} titles in this genre</span>
          </div>
        </div>
      )}

      {/* Result counter when in full grid mode without single genre/section breadcrumb */}
      {!isShowingSections && !selectedSection && !activeGenreInfo && filteredMovies.length > 0 && (
        <p className="cat-results">
          <span>Showing</span>
          <strong>{visibleMovies.length}</strong>
          <span>of</span>
          <strong>{filteredMovies.length}</strong>
          <span>movies</span>
        </p>
      )}

      {/* Empty State */}
      {filteredMovies.length === 0 ? (
        <div className="cat-empty vf-enter">
          <span className="cat-empty-icon">
            <SearchX size={26} />
          </span>
          <h3 className="cat-empty-title">No movies match these filters</h3>
          <p className="cat-empty-text">
            Loosen a filter or clear them all to see the rest of the library.
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
              count={sec.count ? `${sec.count} movies` : undefined}
              onViewAll={() => {
                if (sec.genreId) {
                  setSelectedSection(null);
                  handleOpenGenreGrid(sec.genreId);
                } else if (sec.id === 'new-releases') {
                  setSelectedSection('new-releases');
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
              {sec.items.map((movie) => (
                <CatalogMovieCard
                  key={movie.id}
                  movie={movie}
                  onOpen={onOpenDetails}
                  onPlay={onPlay}
                  className="cat-shelf-card"
                />
              ))}
            </ShelfRow>
          ))}
        </div>
      ) : viewMode === 'grid' ? (
        /* Poster Grid View */
        <div className="cat-grid vf-enter">
          {visibleMovies.map((movie, index) => (
            <CatalogMovieCard
              key={movie.id}
              movie={movie}
              rank={selectedSection === 'top-10' ? index + 1 : undefined}
              onOpen={onOpenDetails}
              onPlay={onPlay}
            />
          ))}
        </div>
      ) : (
        /* Detailed List / Table View */
        <div className="cat-list vf-enter">
          {visibleMovies.map((movie) => (
            <CatalogMovieRow
              key={movie.id}
              movie={movie}
              isSaved={watchlist.includes(movie.id)}
              onOpen={onOpenDetails}
              onPlay={onPlay}
              onToggleWatchlist={onToggleWatchlist}
            />
          ))}
        </div>
      )}

      {/* Auto-load sentinel — shimmer skeleton posters stream in with the
          next chunk (same visual language as the poster grid) */}
      {!isShowingSections && hasMore && (
        <div className="cat-tail" ref={loadMoreRef} aria-live="polite">
          <div className="vf-skeleton-grid" aria-hidden="true">
            <div className="vf-skeleton" />
            <div className="vf-skeleton" />
            <div className="vf-skeleton" />
          </div>
          <span className="vf-loader-text">Loading more movies…</span>
        </div>
      )}
    </div>
  );
}
