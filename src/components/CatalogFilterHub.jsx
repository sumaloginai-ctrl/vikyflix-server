import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  SlidersHorizontal,
  Languages as LangIcon,
  ArrowUpDown,
  ChevronDown,
  Check,
  X,
  RotateCcw
} from 'lucide-react';

/**
 * Shared filter & sort hub for the catalog pages (All Movies / Web Series).
 *
 * Design (DESIGN_SPEC §5 "Catalog"):
 *  · a compact, minimal live-search pill
 *  · filter chips that make their active state obvious
 *  · a sort control whose current value is readable at a glance
 *  · an active-filter chip row with one clear "reset"
 *
 * Behaviour kept from the previous implementation: on phones the dropdown
 * cards anchor right under the tapped button — absolute-positioned menus
 * inside the horizontally scrolled filter row get clipped, and the old
 * bottom-sheet landed far away. The phone menus are therefore positioned
 * with inline fixed styles measured from the button's rect.
 */
export default function CatalogFilterHub({
  searchPlaceholder = 'Search…',
  searchQuery = '',
  onSearchChange,
  genresList = [],
  selectedGenres = [],
  toggleGenre,
  clearGenres,
  languagesList = [],
  selectedLanguages = [],
  toggleLanguage,
  clearLanguages,
  sortOptions = [],
  sortBy,
  onSortChange,
  extraControls = null
}) {
  const [showGenreMenu, setShowGenreMenu] = useState(false);
  const [showLanguageMenu, setShowLanguageMenu] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);

  const closeAllMenus = useCallback(() => {
    setShowGenreMenu(false);
    setShowLanguageMenu(false);
    setShowSortMenu(false);
  }, []);

  // Phones open the dropdowns anchored to the button instead of the
  // desktop's absolute-under-the-row mode.
  const [isPhone, setIsPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const upd = () => setIsPhone(mq.matches);
    upd();
    mq.addEventListener('change', upd);
    return () => mq.removeEventListener('change', upd);
  }, []);

  const [menuPos, setMenuPos] = useState(null);
  const openMenuAt = (setter, e) => {
    closeAllMenus();
    try {
      const r = e.currentTarget.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(Math.max(r.width + 170, 240), vw - 16);
      setMenuPos({
        left: Math.max(8, Math.min(r.left, vw - width - 8)),
        top: Math.min(r.bottom + 6, Math.max(8, vh - 270)),
        width
      });
    } catch {
      setMenuPos(null);
    }
    setter(true);
  };

  const menuStyle = isPhone && menuPos
    ? {
        position: 'fixed',
        top: menuPos.top,
        left: menuPos.left,
        width: menuPos.width,
        maxWidth: '90vw',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '58vh'
      }
    : undefined;

  // The sort value shown on the control — leading emoji/decorative glyphs
  // are dropped so the label stays readable at a glance.
  const sortLabel = useMemo(() => {
    const opt = sortOptions.find(s => s.id === sortBy);
    if (!opt) return '';
    return String(opt.label || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
  }, [sortOptions, sortBy]);

  const hasActiveFilters = Boolean(selectedGenres.length || selectedLanguages.length);

  // One clear "reset" for the whole active-filter row.
  const resetFilters = useCallback(() => {
    if (clearGenres) clearGenres();
    if (clearLanguages) clearLanguages();
  }, [clearGenres, clearLanguages]);

  const languageIcon = useCallback(
    (name) => (languagesList.find(l => l.name === name)?.icon) || '🌐',
    [languagesList]
  );

  return (
    <>
      <div className="cat-hub">
        <div className="cat-hub-bar">
          {/* Genre Filter */}
          <div className="cat-dropdown">
            <button
              className={`cat-chip-btn ${selectedGenres.length > 0 ? 'is-active' : ''}`}
              onClick={(e) => openMenuAt(setShowGenreMenu, e)}
              aria-expanded={showGenreMenu}
              aria-haspopup="true"
            >
              <SlidersHorizontal size={15} />
              <span>Genres</span>
              {selectedGenres.length > 0 && <span className="cat-chip-count">{selectedGenres.length}</span>}
              <ChevronDown size={14} className="cat-chip-caret" />
            </button>

            {showGenreMenu && (
              <div className="cat-menu cat-menu--wide" style={menuStyle}>
                <div className="cat-menu-head">
                  <span>Genre</span>
                  {selectedGenres.length > 0 && (
                    <button onClick={clearGenres}>Reset</button>
                  )}
                </div>
                <div className="cat-menu-list">
                  {genresList.map((g) => {
                    const checked = selectedGenres.includes(g.id);
                    return (
                      <button
                        key={g.id}
                        className={`cat-menu-item ${checked ? 'is-selected' : ''}`}
                        onClick={() => { toggleGenre(g.id); closeAllMenus(); }}
                      >
                        <span className="cat-menu-check">{checked && <Check size={12} />}</span>
                        <span className="cat-menu-label">{g.icon} {g.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Language Filter */}
          <div className="cat-dropdown">
            <button
              className={`cat-chip-btn ${selectedLanguages.length > 0 ? 'is-active' : ''}`}
              onClick={(e) => openMenuAt(setShowLanguageMenu, e)}
              aria-expanded={showLanguageMenu}
              aria-haspopup="true"
            >
              <LangIcon size={15} />
              <span>Languages</span>
              {selectedLanguages.length > 0 && <span className="cat-chip-count">{selectedLanguages.length}</span>}
              <ChevronDown size={14} className="cat-chip-caret" />
            </button>

            {showLanguageMenu && (
              <div className="cat-menu cat-menu--wide" style={menuStyle}>
                <div className="cat-menu-head">
                  <span>Language</span>
                  {selectedLanguages.length > 0 && (
                    <button onClick={clearLanguages}>Reset</button>
                  )}
                </div>
                <div className="cat-menu-list">
                  {languagesList.map((l) => {
                    const checked = selectedLanguages.includes(l.name);
                    return (
                      <button
                        key={l.name}
                        className={`cat-menu-item ${checked ? 'is-selected' : ''}`}
                        onClick={() => { toggleLanguage(l.name); closeAllMenus(); }}
                      >
                        <span className="cat-menu-check">{checked && <Check size={12} />}</span>
                        <span className="cat-menu-label">{l.icon} {l.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Sort By Order — the current value is always on the control */}
          <div className="cat-dropdown cat-dropdown--end">
            <button
              className="cat-chip-btn cat-sort-btn"
              onClick={(e) => openMenuAt(setShowSortMenu, e)}
              aria-expanded={showSortMenu}
              aria-haspopup="true"
            >
              <ArrowUpDown size={15} />
              <span className="cat-sort-label">Sort</span>
              <strong className="cat-sort-value">{sortLabel || 'Order'}</strong>
              <ChevronDown size={14} className="cat-chip-caret" />
            </button>

            {showSortMenu && (
              <div className="cat-menu cat-menu--end" style={menuStyle}>
                <div className="cat-menu-head"><span>Sort by</span></div>
                <div className="cat-menu-list">
                  {sortOptions.map((opt) => (
                    <button
                      key={opt.id}
                      className={`cat-menu-item ${sortBy === opt.id ? 'is-selected' : ''}`}
                      onClick={() => { onSortChange(opt.id); closeAllMenus(); }}
                    >
                      <span className="cat-menu-check cat-menu-check--radio">
                        {sortBy === opt.id && <Check size={11} />}
                      </span>
                      <span className="cat-menu-label">{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {extraControls}
        </div>

        {/* Active filter chips — one clear reset for the whole row */}
        {hasActiveFilters && (
          <div className="cat-active">
            <span className="cat-active-label">Active</span>
            {selectedGenres.map((g) => (
              <button
                key={`g-${g}`}
                className="cat-active-chip"
                onClick={() => toggleGenre(g)}
                title={`Remove ${g}`}
              >
                <span>{g}</span>
                <X size={12} />
              </button>
            ))}
            {selectedLanguages.map((l) => (
              <button
                key={`l-${l}`}
                className="cat-active-chip"
                onClick={() => toggleLanguage(l)}
                title={`Remove ${l}`}
              >
                <span>{languageIcon(l)} {l}</span>
                <X size={12} />
              </button>
            ))}
            <button className="cat-active-reset" onClick={resetFilters} title="Clear every filter">
              <RotateCcw size={13} />
              <span>Reset</span>
            </button>
          </div>
        )}
      </div>

      {/* Backdrop for open menus */}
      {(showGenreMenu || showLanguageMenu || showSortMenu) && (
        <div className="cat-menu-backdrop" onClick={closeAllMenus} />
      )}
    </>
  );
}
