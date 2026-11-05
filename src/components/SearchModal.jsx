import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Search, X, Film, Tv, Play, Star, Clock, CornerDownLeft } from 'lucide-react';
import { formatCleanTitle } from '../utils/mediaUtils';
import Poster from './Poster';

import '../styles/search.css';

const QUICK_PICKS = ['Action', 'Sci-Fi', 'Thriller', 'Horror', 'Comedy', 'Tamil', 'Telugu', 'English'];

export default function SearchModal({
  isOpen,
  onClose,
  movies = [],
  series = [],
  onPlay,
  onOpenDetails,
  onOpenSeriesDetails
}) {
  const [query, setQuery] = useState('');
  // Debounced mirror of the input — the 7,000-title scan runs when typing
  // pauses, not on every keystroke (critical on TV chipsets).
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 160);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 40);
    } else {
      setQuery('');
      setDebouncedQuery('');
      setActiveIndex(0);
    }
  }, [isOpen]);

  // One precomputed haystack per catalog item — built when the catalog
  // arrives, NOT per keystroke. Scanning lowercase-joined genre/language/
  // arrays across 7,000 titles on every key press was the search lag.
  const movieIndex = useMemo(() => movies.map(m => ({
    item: m,
    title: String(m.title || '').toLowerCase(),
    hay: [
      m.title,
      (m._genres || m.metadata?.genres || []).join(' '),
      (m._languages || []).join(' '),
      m.metadata?.year || m.year || '',
      m.metadata?.stars || '',
      m.metadata?.summary || ''
    ].join(' ').toLowerCase()
  })), [movies]);
  const seriesIndex = useMemo(() => series.map(s => ({
    item: s,
    title: String(s.title || '').toLowerCase(),
    hay: [
      s.title,
      (s._genres || s.metadata?.genres || []).join(' '),
      (s._languages || []).join(' '),
      s.metadata?.year || s.year || '',
      s.metadata?.stars || '',
      s.metadata?.summary || ''
    ].join(' ').toLowerCase()
  })), [series]);

  const results = useMemo(() => {
    const q = debouncedQuery.toLowerCase().trim();
    if (!q) return [];

    // Relevance scoring: exact title > title prefix > title substring >
    // genre/language/actor/other fields. Ties break by rating then year,
    // and movies and series interleave instead of series-first dumping.
    const scored = [];
    const collect = (index, mediaType) => {
      for (const e of index) {
        if (scored.length >= 120) break; // perf cap; slice to 40 below
        if (!e.hay.includes(q)) continue;
        let score = 15; // matched somewhere in the haystack
        if (e.title === q) score = 100;
        else if (e.title.startsWith(q)) score = 80;
        else if (e.title.includes(q)) score = 60;
        const rating = parseFloat(e.item.metadata?.rating || e.item.rating) || 0;
        const year = parseInt(e.item.metadata?.year || e.item.year, 10) || 0;
        scored.push({ entry: e, mediaType, score: score + Math.min(rating, 10), year });
      }
    };
    collect(seriesIndex, 'series');
    collect(movieIndex, 'movie');

    // Typo tolerance: when the exact pass finds almost nothing, retry with
    // a one-character edit distance against individual title words.
    if (scored.length < 3 && q.length >= 4) {
      const lev = (a, b) => {
        if (Math.abs(a.length - b.length) > 1) return 99;
        const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
        for (let j = 0; j <= b.length; j++) dp[0][j] = j;
        for (let i = 1; i <= a.length; i++) {
          for (let j = 1; j <= b.length; j++) {
            dp[i][j] = Math.min(
              dp[i - 1][j] + 1,
              dp[i][j - 1] + 1,
              dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
          }
        }
        return dp[a.length][b.length];
      };
      const fuzzy = (index, mediaType) => {
        for (const e of index) {
          if (scored.length >= 40) break;
          const words = e.title.split(/[^a-z0-9]+/).filter(w => w.length >= 4);
          if (!words.some(w => lev(q, w) <= 1)) continue;
          if (scored.some(x => x.entry === e)) continue;
          const rating = parseFloat(e.item.metadata?.rating || e.item.rating) || 0;
          const year = parseInt(e.item.metadata?.year || e.item.year, 10) || 0;
          scored.push({ entry: e, mediaType, score: 40 + Math.min(rating, 10), year });
        }
      };
      fuzzy(seriesIndex, 'series');
      fuzzy(movieIndex, 'movie');
    }

    scored.sort((a, b) => (b.score - a.score) || (b.year - a.year));
    return scored.slice(0, 40).map(x => ({ ...x.entry.item, _mediaType: x.mediaType }));
  }, [debouncedQuery, movieIndex, seriesIndex]);

  useEffect(() => {
    setActiveIndex(0);
  }, [debouncedQuery]);

  const openItem = useCallback((item) => {
    if (!item) return;
    if (item._mediaType === 'series' && onOpenSeriesDetails) onOpenSeriesDetails(item);
    else if (onOpenDetails) onOpenDetails(item);
    onClose();
  }, [onOpenSeriesDetails, onOpenDetails, onClose]);

  const playItem = useCallback((item) => {
    if (!item) return;
    if (item._mediaType === 'series' && onOpenSeriesDetails) onOpenSeriesDetails(item);
    else if (onPlay) onPlay(item);
    onClose();
  }, [onOpenSeriesDetails, onPlay, onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex(i => Math.min(i + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && results.length) {
        e.preventDefault();
        openItem(results[activeIndex]);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, results, activeIndex, openItem, onClose]);

  useEffect(() => {
    const el = listRef.current?.querySelector('.sr-item.is-active');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!isOpen) return null;

  const totalCatalogCount = movies.length + series.length;
  const hasQuery = query.trim().length > 0;

  return (
    <div className="sr-backdrop" onClick={onClose}>
      <div className="sr-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Search">
        {/* Field */}
        <div className="sr-field">
          <Search size={20} className="sr-field-icon" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search movies, web series, genres, languages…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="sr-input"
            aria-label="Search the library"
          />
          {hasQuery && (
            <button className="sr-clear" onClick={() => setQuery('')} aria-label="Clear search">
              <X size={15} />
            </button>
          )}
          <button className="sr-esc" onClick={onClose} aria-label="Close search">ESC</button>
        </div>

        {/* Quick picks */}
        {!hasQuery && (
          <div className="sr-quick">
            <span className="sr-quick-label">Jump to a mood</span>
            <div className="sr-quick-list">
              {QUICK_PICKS.map((g) => (
                <button
                  key={g}
                  className="sr-chip"
                  onClick={() => setQuery(g)}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Results */}
        <div className="sr-results" ref={listRef}>
          {!hasQuery ? (
            <div className="sr-empty">
              <Film size={30} />
              <p>
                Search across <strong>{totalCatalogCount.toLocaleString()}</strong> movies and web series —
                by title, actor, genre, language or year.
              </p>
            </div>
          ) : results.length === 0 ? (
            <div className="sr-empty">
              <Tv size={30} />
              <p>No match for <strong>“{query}”</strong>. Try another title, actor or genre.</p>
            </div>
          ) : (
            <ul className="sr-list" role="listbox" aria-label="Search results">
              {results.map((item, idx) => {
                const isSeries = item._mediaType === 'series';
                const year = item.metadata?.year || item.year || '';
                const genre = (item._genres || item.metadata?.genres || [])[0] || '';
                const rating = item.metadata?.rating;
                return (
                  <li
                    key={item.id}
                    className={`sr-item ${idx === activeIndex ? 'is-active' : ''}`}
                    role="option"
                    aria-selected={idx === activeIndex}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => openItem(item)}
                  >
                    <div className="sr-item-poster">
                      <Poster
                        item={item}
                        alt={item.title}
                        className="sr-poster"
                        imgClassName="sr-poster-img"
                        ratio="2 / 3"
                      />
                    </div>

                    <div className="sr-item-body">
                      <div className="sr-item-title-row">
                        <h4 className="sr-item-title">{formatCleanTitle(item.title)}</h4>
                        <span className={`sr-type ${isSeries ? 'is-series' : 'is-movie'}`}>
                          {isSeries ? 'Series' : 'Movie'}
                        </span>
                      </div>
                      <div className="sr-item-meta">
                        {year && <span>{year}</span>}
                        {genre && <span>{genre}</span>}
                        {rating && (
                          <span className="sr-item-rating">
                            <Star size={10} fill="#ffc15e" color="#ffc15e" />
                            {rating}
                          </span>
                        )}
                        {!isSeries && item.formattedDuration && (
                          <span className="sr-item-time"><Clock size={10} />{item.formattedDuration}</span>
                        )}
                        {isSeries && item.totalEpisodes ? <span>{item.totalEpisodes} eps</span> : null}
                      </div>
                    </div>

                    <div className="sr-item-actions">
                      <button
                        className="sr-play"
                        onClick={(e) => { e.stopPropagation(); playItem(item); }}
                        aria-label={`Play ${formatCleanTitle(item.title)}`}
                      >
                        <Play size={15} fill="#14090d" />
                      </button>
                      {idx === activeIndex && (
                        <span className="sr-enter-hint" aria-hidden="true">
                          <CornerDownLeft size={13} />
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
